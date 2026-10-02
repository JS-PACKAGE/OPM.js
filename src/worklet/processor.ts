import './worklet-globals.js';
import { Synth } from '../core/synth.js';
import { normalizeVoice } from '../voices/normalize.js';
import type { NoteOptions, VoiceEndReason } from '../core/synth.js';
import type { NormalizedVoice, VoiceInput } from '../voices/schema.js';
import type { DiagnosticsEvent, NoteEvent, NoteState } from '../api/index.js';

type RawMessage =
  | { type: 'noteOn'; id: unknown; voice: unknown; note: unknown; at: unknown; duration: unknown; velocity?: unknown; pan?: unknown }
  | { type: 'noteOff'; id: unknown }
  | { type: 'diagnostics'; requestId: unknown }
  | { type: 'close' };
type ScheduledEvent =
  | { type: 'noteOn'; id: number; frame: number; note: number; voice: NormalizedVoice; options: NoteOptions }
  | { type: 'noteOff'; id: number; frame: number };
interface TrackedNote { state: 'pending' | 'started' | 'released' }

export type { OPMProcessor };

const MAX_PENDING_EVENTS = 256;
const MAX_NOTE_IDS = 256;
const MAX_DURATION = 60;
const MESSAGE_FIELDS: Record<RawMessage['type'], readonly [readonly string[], readonly string[]]> = {
  noteOn: [['type', 'id', 'voice', 'note', 'at', 'duration'], ['velocity', 'pan']],
  noteOff: [['type', 'id'], []],
  diagnostics: [['type', 'requestId'], []],
  close: [['type'], []],
};

function messageData(data: unknown): RawMessage | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const type = Object.getOwnPropertyDescriptor(data, 'type');
  if (!type || !Object.hasOwn(type, 'value') || typeof type.value !== 'string' || !Object.hasOwn(MESSAGE_FIELDS, type.value)) return null;
  const [required, optional] = MESSAGE_FIELDS[type.value as RawMessage['type']];
  const result: Record<PropertyKey, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(data)) {
    if (!required.includes(key as string) && !optional.includes(key as string)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(data, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(result, key)) return null;
  return result as RawMessage;
}

function validId(id: unknown): id is number {
  return Number.isSafeInteger(id) && (id as number) > 0;
}

class OPMProcessor extends AudioWorkletProcessor {
  declare synth: Synth | null;
  declare events: ScheduledEvent[];
  declare notes: Map<number, TrackedNote>;
  declare errorCount: number;
  declare rejectedNotes: number;
  declare closed: boolean;

  constructor() {
    super();
    this.synth = new Synth(sampleRate);
    this.events = [];
    this.notes = new Map();
    this.errorCount = 0;
    this.rejectedNotes = 0;
    this.closed = false;
    this.synth.onVoiceEnded = (id, reason) => this.ended(id, reason);
    this.port.onmessage = (event) => this.receive(event.data);
  }

  send(message: NoteEvent | DiagnosticsEvent): void {
    try {
      this.port.postMessage(message);
    } catch {
      // A closed or broken port must not interrupt the audio callback.
    }
  }

  noteEvent(id: number, state: NoteState, reason?: string): void {
    const message: NoteEvent = { type: 'note', id, state };
    if (reason !== undefined) message.reason = reason;
    this.send(message);
  }

  reject(id: unknown, reason: string): void {
    this.rejectedNotes++;
    if (validId(id)) this.noteEvent(id, 'rejected', reason);
  }

  insert(event: ScheduledEvent): void {
    let index = this.events.length;
    while (index > 0 && this.events[index - 1].frame > event.frame) index--;
    this.events.splice(index, 0, event);
  }

  removeEvents(id: number): void {
    let kept = 0;
    for (let index = 0; index < this.events.length; index++) {
      const event = this.events[index];
      if (event.id !== id) this.events[kept++] = event;
    }
    this.events.length = kept;
  }

  ended(id: number, reason: VoiceEndReason): void {
    if (!this.notes.delete(id)) return;
    this.removeEvents(id);
    this.noteEvent(id, reason === 'stolen' ? 'stolen' : 'ended', reason === 'error' ? 'error' : undefined);
  }

  receive(raw: unknown): void {
    if (this.closed) return;
    let data: RawMessage | null;
    try {
      data = messageData(raw);
    } catch {
      return;
    }
    if (!data) {
      // Inspect descriptors only, even when reporting malformed note admissions.
      try {
        const type = Object.getOwnPropertyDescriptor(raw, 'type');
        const id = Object.getOwnPropertyDescriptor(raw, 'id');
        if (type?.value === 'noteOn') this.reject(id?.value, 'invalid-message');
      } catch {
        // Non-records and revoked proxies are not messages.
      }
      return;
    }
    if (data.type === 'close') {
      this.closed = true;
      this.events.length = 0;
      this.notes.clear();
      this.synth!.onVoiceEnded = null;
      this.synth = null;
      this.port.onmessage = null;
      try { this.port.close(); } catch { /* Already closed. */ }
      return;
    }
    if (data.type === 'diagnostics') {
      if (validId(data.requestId)) {
        this.send({ type: 'diagnostics', requestId: data.requestId,
          activeVoices: this.synth!.voices.length, pendingEvents: this.events.length,
          errors: this.errorCount + this.synth!.errorCount, rejectedNotes: this.rejectedNotes });
      }
      return;
    }
    if (data.type === 'noteOff') {
      if (!validId(data.id)) return;
      const note = this.notes.get(data.id);
      // Late/repeated stops are idempotent, including notes already stolen or ended.
      if (!note) return;
      this.removeEvents(data.id);
      if (note.state === 'pending') {
        this.notes.delete(data.id);
        this.noteEvent(data.id, 'cancelled');
      } else if (this.synth!.noteOff(data.id)) {
        note.state = 'released';
        this.noteEvent(data.id, 'released');
      }
      return;
    }

    if (!validId(data.id) || !Number.isInteger(data.note) || (data.note as number) < 0 || (data.note as number) > 127 ||
        !Number.isFinite(data.at) || (data.at as number) < 0 ||
        (data.duration !== null && (!Number.isFinite(data.duration) || (data.duration as number) <= 0 || (data.duration as number) > MAX_DURATION))) {
      this.reject(data.id, 'invalid-note');
      return;
    }
    const velocity = Object.hasOwn(data, 'velocity') ? data.velocity : 1;
    const pan = Object.hasOwn(data, 'pan') ? data.pan : 0;
    if (!Number.isFinite(velocity) || (velocity as number) < 0 || (velocity as number) > 1 ||
        !Number.isFinite(pan) || (pan as number) < -1 || (pan as number) > 1) {
      this.reject(data.id, 'invalid-note');
      return;
    }
    // Reserve an ID only after all validation; duplicates never insert even an off.
    if (this.notes.has(data.id)) {
      this.reject(data.id, 'duplicate-id');
      return;
    }
    const needed = data.duration === null ? 1 : 2;
    if (this.events.length + needed > MAX_PENDING_EVENTS || this.notes.size >= MAX_NOTE_IDS) {
      this.reject(data.id, 'capacity');
      return;
    }
    try {
      const voice = normalizeVoice(data.voice as VoiceInput);
      const frame = Math.round((data.at as number) * sampleRate);
      const end = data.duration === null ? null : frame + Math.max(1, Math.ceil((data.duration as number) * sampleRate));
      if (!Number.isSafeInteger(frame) || (end !== null && !Number.isSafeInteger(end)) ||
          frame > currentFrame + MAX_DURATION * sampleRate) {
        this.reject(data.id, 'invalid-time');
        return;
      }
      this.notes.set(data.id, { state: 'pending' });
      this.insert({ type: 'noteOn', id: data.id, note: data.note as number, voice, frame, options: { velocity: velocity as number, pan: pan as number } });
      if (end !== null) this.insert({ type: 'noteOff', id: data.id, frame: end });
      this.noteEvent(data.id, 'accepted');
    } catch {
      this.reject(data.id, 'invalid-voice');
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.closed) return false;
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    const start = currentFrame;
    let position = 0;
    while (position < left.length) {
      const next = this.events[0];
      if (next && next.frame <= start + position) {
        // Pop before dispatch: Synth callbacks can reclaim other queued events.
        this.events.shift();
        const note = this.notes.get(next.id);
        if (!note) continue;
        if (next.type === 'noteOn') {
          try {
            this.synth!.noteOn(next.voice, next.note, next.id, next.options);
            note.state = 'started';
            this.noteEvent(next.id, 'started');
          } catch {
            this.errorCount++;
            this.notes.delete(next.id);
            this.removeEvents(next.id);
            this.reject(next.id, 'synthesis-error');
          }
        } else if (this.synth!.noteOff(next.id)) {
          note.state = 'released';
          this.noteEvent(next.id, 'released');
        }
        continue;
      }
      const length = next ? Math.min(left.length - position, next.frame - start - position) : left.length - position;
      this.synth!.render(left, right, position, length);
      position += length;
    }
    return true;
  }
}

registerProcessor('opm-processor', OPMProcessor);
