import './worklet-globals.js';
import { Synth, validateNoteControls } from '../core/synth.js';
import { prepareVoice } from '../voices/schema.js';
import type { NoteControls, NoteOptions, VoiceEndReason, SynthOptions } from '../core/synth.js';
import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
import type { CommandEvent, CommandName, DiagnosticsEvent, NoteEvent, NoteState, ResetEvent } from '../api/index.js';
import type { TuningOptions } from '../core/tuning.js';

type RawMessage =
  | { type: 'prepareVoice'; voiceId: unknown; voice: unknown }
  | { type: 'noteOn'; id: unknown; voice?: unknown; voiceId?: unknown; note: unknown; at: unknown; duration: unknown; velocity?: unknown; pan?: unknown; late?: unknown }
  | { type: 'noteOff'; id: unknown; at?: unknown; commandId?: unknown }
  | { type: 'updateNote'; id: unknown; controls: unknown; at?: unknown; commandId?: unknown }
  | { type: 'allNotesOff'; commandId?: unknown }
  | { type: 'panic'; commandId?: unknown; reason?: unknown }
  | { type: 'setMixGain'; gain: unknown; commandId?: unknown }
  | { type: 'setTuning'; tuning: unknown; commandId?: unknown }
  | { type: 'diagnostics'; requestId: unknown }
  | { type: 'close' };
type ScheduledEvent =
  | { type: 'noteOn'; id: number; frame: number; note: number; voice: PreparedVoice; options: NoteOptions; late: 'start' | 'drop'; durationFrames: number | null }
  | { type: 'noteOff'; id: number; frame: number; automatic: boolean }
  | { type: 'updateNote'; id: number; frame: number; controls: NoteControls };
interface TrackedNote { state: 'pending' | 'started' | 'released'; startFrame: number }

export type { OPMProcessor };

const MAX_PENDING_EVENTS = 256;
const MAX_NOTE_IDS = 256;
const MAX_REGISTERED_VOICES = 128;
const MAX_DURATION = 60;
const MESSAGE_FIELDS: Record<RawMessage['type'], readonly [readonly string[], readonly string[]]> = {
  prepareVoice: [['type', 'voiceId', 'voice'], []],
  noteOn: [['type', 'id', 'note', 'at', 'duration'], ['voice', 'voiceId', 'velocity', 'pan', 'late']],
  noteOff: [['type', 'id'], ['at', 'commandId']],
  updateNote: [['type', 'id', 'controls'], ['at', 'commandId']],
  allNotesOff: [['type'], ['commandId']],
  panic: [['type'], ['commandId', 'reason']],
  setMixGain: [['type', 'gain'], ['commandId']],
  setTuning: [['type', 'tuning'], ['commandId']],
  diagnostics: [['type', 'requestId'], []],
  close: [['type'], []],
};
const EVENT_ORDER: Record<ScheduledEvent['type'], number> = { noteOff: 0, noteOn: 1, updateNote: 2 };
const COMMAND_TYPES = Object.freeze({
  noteOff: 'stop', updateNote: 'updateNote', allNotesOff: 'allNotesOff',
  panic: 'panic', setMixGain: 'setMixGain', setTuning: 'setTuning',
} as const);
type CommandMessage = Extract<RawMessage, { type: keyof typeof COMMAND_TYPES }>;

function messageData(data: unknown): RawMessage | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const type = Object.getOwnPropertyDescriptor(data, 'type');
  if (!type || !Object.hasOwn(type, 'value') || typeof type.value !== 'string' || !Object.hasOwn(MESSAGE_FIELDS, type.value)) return null;
  const [required, optional] = MESSAGE_FIELDS[type.value as RawMessage['type']];
  const result: Record<PropertyKey, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(data)) {
    if (typeof key !== 'string' || !required.includes(key) && !optional.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(data, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(result, key)) return null;
  if (result.type === 'noteOn' && Object.hasOwn(result, 'voice') === Object.hasOwn(result, 'voiceId')) return null;
  return result as RawMessage;
}

function validId(id: unknown): id is number {
  return Number.isSafeInteger(id) && (id as number) > 0;
}

function scheduledFrame(at: unknown): number | null {
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > currentFrame / sampleRate + MAX_DURATION) return null;
  const frame = Math.round(at * sampleRate);
  return Number.isSafeInteger(frame) && frame <= currentFrame + MAX_DURATION * sampleRate ? frame : null;
}

class OPMProcessor extends AudioWorkletProcessor {
  declare synth: Synth | null;
  declare events: ScheduledEvent[];
  declare notes: Map<number, TrackedNote>;
  declare patches: Map<number, PreparedVoice>;
  declare errorCount: number;
  declare rejectedNotes: number;
  declare closed: boolean;
  declare dispatchFrame: number;
  declare renderFrameBase: number;
  declare rendering: boolean;

  constructor(options: AudioWorkletNodeOptions = {}) {
    super();
    this.synth = new Synth(sampleRate, 8, options.processorOptions as SynthOptions | undefined);
    this.events = [];
    this.notes = new Map();
    this.patches = new Map();
    this.errorCount = 0;
    this.rejectedNotes = 0;
    this.closed = false;
    this.dispatchFrame = currentFrame;
    this.renderFrameBase = currentFrame;
    this.rendering = false;
    this.synth.onVoiceEnded = (id, reason) => this.ended(id, reason);
    this.port.onmessage = (event) => this.receive(event.data);
  }

  send(message: NoteEvent | DiagnosticsEvent | CommandEvent | ResetEvent): void {
    try { this.port.postMessage(message); } catch { /* Broken ports cannot interrupt rendering. */ }
  }

  noteEvent(id: number, state: NoteState, reason?: string, frame = this.dispatchFrame): void {
    const message: NoteEvent = { type: 'note', id, state, frame, time: frame / sampleRate };
    if (reason !== undefined) message.reason = reason;
    this.send(message);
  }

  reject(id: unknown, reason: string): void {
    this.rejectedNotes++;
    if (validId(id)) this.noteEvent(id, 'rejected', reason);
  }

  commandEvent(data: CommandMessage, state: CommandEvent['state'], reason?: string): void {
    const message: CommandEvent = {
      type: 'command', command: COMMAND_TYPES[data.type] as CommandName, state,
      frame: this.dispatchFrame, time: this.dispatchFrame / sampleRate,
    };
    if (validId(data.commandId)) message.commandId = data.commandId;
    if ('id' in data && validId(data.id)) message.id = data.id;
    if (reason !== undefined) message.reason = reason;
    this.send(message);
  }

  panic(reason: 'panic' | 'interruption'): void {
    this.events.length = 0;
    for (const id of this.notes.keys()) this.noteEvent(id, 'cancelled', reason);
    this.notes.clear();
    this.synth!.panic();
    this.send({ type: 'reset', reason, frame: this.dispatchFrame, time: this.dispatchFrame / sampleRate });
  }

  insert(event: ScheduledEvent): void {
    let index = this.events.length;
    // Stops precede onset, then controls; admission order breaks remaining ties.
    while (index > 0) {
      const previous = this.events[index - 1];
      if (previous.frame < event.frame || previous.frame === event.frame && EVENT_ORDER[previous.type] <= EVENT_ORDER[event.type]) break;
      index--;
    }
    this.events.splice(index, 0, event);
  }

  removeEvents(id: number, onlyAutomatic = false): void {
    let kept = 0;
    for (let index = 0; index < this.events.length; index++) {
      const event = this.events[index];
      if (event.id !== id || onlyAutomatic && !(event.type === 'noteOff' && event.automatic)) this.events[kept++] = event;
    }
    this.events.length = kept;
  }

  ended(id: number, reason: VoiceEndReason): void {
    if (!this.notes.delete(id)) return;
    this.removeEvents(id);
    const frame = this.rendering ? this.renderFrameBase + this.synth!.currentFrame : this.dispatchFrame;
    this.noteEvent(id, reason === 'stolen' ? 'stolen' : reason === 'cancelled' ? 'cancelled' : 'ended', reason === 'error' ? 'error' : undefined, frame);
  }

  release(id: number): void {
    const note = this.notes.get(id);
    if (!note) return;
    if (note.state === 'pending') {
      this.notes.delete(id);
      this.removeEvents(id);
      this.noteEvent(id, 'cancelled');
    } else {
      // Keep scheduled controls for the release tail, but no redundant automatic off.
      this.removeEvents(id, true);
      if (this.synth!.noteOff(id)) {
        note.state = 'released';
        this.noteEvent(id, 'released');
      }
    }
  }

  receive(raw: unknown): void {
    if (this.closed) return;
    this.dispatchFrame = currentFrame;
    let data: RawMessage | null = null;
    try { data = messageData(raw); } catch { /* Revoked proxies are not messages. */ }
    if (!data) {
      this.errorCount++;
      // Descriptor-only reporting never executes a malformed message's getters.
      try {
        if (raw !== null && typeof raw === 'object' && Object.getOwnPropertyDescriptor(raw, 'type')?.value === 'noteOn') {
          this.reject(Object.getOwnPropertyDescriptor(raw, 'id')?.value, 'invalid-message');
        } else if (raw !== null && typeof raw === 'object') {
          const type = Object.getOwnPropertyDescriptor(raw, 'type')?.value;
          if (typeof type === 'string' && Object.hasOwn(COMMAND_TYPES, type)) {
            const command = { type,
              id: Object.getOwnPropertyDescriptor(raw, 'id')?.value,
              commandId: Object.getOwnPropertyDescriptor(raw, 'commandId')?.value } as CommandMessage;
            this.commandEvent(command, 'rejected', 'invalid-message');
          }
        }
      } catch { /* Non-records cannot identify an admission. */ }
      return;
    }
    if (data.type === 'close') {
      this.closed = true;
      this.events.length = 0;
      this.notes.clear();
      this.patches.clear();
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
      } else this.errorCount++;
      return;
    }
    if ('commandId' in data && !validId(data.commandId)) {
      this.errorCount++;
      this.commandEvent(data as CommandMessage, 'rejected', 'invalid-command-id');
      return;
    }
    if (data.type === 'allNotesOff') {
      this.events.length = 0;
      for (const id of this.notes.keys()) this.release(id);
      this.commandEvent(data, 'accepted');
      return;
    }
    if (data.type === 'panic') {
      if (data.reason !== undefined && data.reason !== 'interruption') {
        this.errorCount++;
        this.commandEvent(data, 'rejected', 'invalid-reason');
        return;
      }
      this.panic(data.reason === 'interruption' ? 'interruption' : 'panic');
      this.commandEvent(data, 'accepted');
      return;
    }
    if (data.type === 'setMixGain' || data.type === 'setTuning') {
      try {
        if (data.type === 'setMixGain') this.synth!.setMixGain(data.gain as number);
        else this.synth!.setTuning(data.tuning as TuningOptions);
        this.commandEvent(data, 'accepted');
      } catch {
        this.errorCount++;
        this.commandEvent(data, 'rejected', 'invalid-configuration');
      }
      return;
    }
    if (data.type === 'prepareVoice') {
      if (!validId(data.voiceId) || !this.patches.has(data.voiceId) && this.patches.size >= MAX_REGISTERED_VOICES) {
        this.errorCount++;
        return;
      }
      try { this.patches.set(data.voiceId, prepareVoice(data.voice as VoiceInput)); }
      catch { this.errorCount++; }
      return;
    }
    if (data.type === 'noteOff' || data.type === 'updateNote') {
      if (!validId(data.id)) { this.errorCount++; this.commandEvent(data, 'rejected', 'invalid-note-id'); return; }
      let controls: NoteControls | undefined;
      if (data.type === 'updateNote') {
        try { controls = validateNoteControls(data.controls as NoteControls); }
        catch { this.errorCount++; this.commandEvent(data, 'rejected', 'invalid-controls'); return; }
      }
      const frame = Object.hasOwn(data, 'at') ? scheduledFrame(data.at) : currentFrame;
      if (frame === null) { this.errorCount++; this.commandEvent(data, 'rejected', 'invalid-time'); return; }
      const note = this.notes.get(data.id);
      if (!note) { this.commandEvent(data, 'rejected', 'inactive'); return; }
      if (data.type === 'noteOff' && !Object.hasOwn(data, 'at')) {
        this.release(data.id);
        this.commandEvent(data, 'accepted');
        return;
      }
      if (data.type === 'updateNote' && !Object.hasOwn(data, 'at') && note.state !== 'pending') {
        this.synth!.updateNote(data.id, controls!);
        this.commandEvent(data, 'accepted');
        return;
      }
      if (this.events.length >= MAX_PENDING_EVENTS) {
        this.errorCount++;
        this.commandEvent(data, 'rejected', 'capacity');
        return;
      }
      if (data.type === 'noteOff') this.insert({ type: 'noteOff', id: data.id, frame, automatic: false });
      else this.insert({ type: 'updateNote', id: data.id, frame: note.state === 'pending' ? Math.max(frame, note.startFrame) : frame, controls: controls! });
      this.commandEvent(data, 'accepted');
      return;
    }

    if (!validId(data.id) || typeof data.note !== 'number' || !Number.isFinite(data.note) || data.note < 0 || data.note > 127 ||
        (data.duration !== null && (typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration <= 0 || data.duration > MAX_DURATION))) {
      this.reject(data.id, 'invalid-note');
      return;
    }
    const velocity = Object.hasOwn(data, 'velocity') ? data.velocity : 1;
    const pan = Object.hasOwn(data, 'pan') ? data.pan : 0;
    const late = Object.hasOwn(data, 'late') ? data.late : 'start';
    if (typeof velocity !== 'number' || !Number.isFinite(velocity) || velocity < 0 || velocity > 1 ||
        typeof pan !== 'number' || !Number.isFinite(pan) || pan < -1 || pan > 1 || late !== 'start' && late !== 'drop') {
      this.reject(data.id, 'invalid-note');
      return;
    }
    if (this.notes.has(data.id)) { this.reject(data.id, 'duplicate-id'); return; }
    const frame = scheduledFrame(data.at);
    const durationFrames = data.duration === null ? null : Math.max(1, Math.ceil(data.duration * sampleRate));
    const end = durationFrames === null ? null : Math.max(frame ?? 0, currentFrame) + durationFrames;
    if (frame === null || end !== null && !Number.isSafeInteger(end)) { this.reject(data.id, 'invalid-time'); return; }
    if (late === 'drop' && frame < currentFrame) { this.reject(data.id, 'late'); return; }
    const needed = durationFrames === null ? 1 : 2;
    if (this.events.length + needed > MAX_PENDING_EVENTS || this.notes.size >= MAX_NOTE_IDS) { this.reject(data.id, 'capacity'); return; }
    let voice: PreparedVoice;
    try {
      if (Object.hasOwn(data, 'voiceId')) {
        const registered = validId(data.voiceId) ? this.patches.get(data.voiceId) : undefined;
        if (!registered) throw new TypeError('Unknown voice ID');
        voice = registered;
      } else voice = prepareVoice(data.voice as VoiceInput);
    } catch { this.reject(data.id, 'invalid-voice'); return; }
    this.notes.set(data.id, { state: 'pending', startFrame: frame });
    this.insert({ type: 'noteOn', id: data.id, note: data.note as number, voice, frame,
      options: { velocity, pan }, late, durationFrames });
    if (end !== null) this.insert({ type: 'noteOff', id: data.id, frame: end, automatic: true });
    this.noteEvent(data.id, 'accepted');
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.closed) return false;
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    const start = currentFrame;
    this.renderFrameBase = start - this.synth!.currentFrame;
    let position = 0;
    while (position < left.length) {
      this.dispatchFrame = start + position;
      const next = this.events[0];
      if (next && next.frame <= this.dispatchFrame) {
        // Pop before dispatch: core callbacks may reclaim other queued events.
        this.events.shift();
        const note = this.notes.get(next.id);
        if (!note) continue;
        if (next.type === 'noteOn') {
          if (next.late === 'drop' && next.frame < this.dispatchFrame) {
            this.notes.delete(next.id);
            this.removeEvents(next.id);
            this.reject(next.id, 'late');
            continue;
          }
          try {
            if (next.durationFrames !== null && next.frame < this.dispatchFrame) {
              const end = this.dispatchFrame + next.durationFrames;
              if (!Number.isSafeInteger(end)) throw new RangeError('Unsafe end frame');
              this.removeEvents(next.id, true);
              this.insert({ type: 'noteOff', id: next.id, frame: end, automatic: true });
            }
            this.synth!.noteOn(next.voice, next.note, next.id, next.options);
            note.state = 'started';
            this.noteEvent(next.id, 'started');
          } catch {
            this.errorCount++;
            this.notes.delete(next.id);
            this.removeEvents(next.id);
            this.reject(next.id, 'synthesis-error');
          }
        } else if (next.type === 'noteOff') this.release(next.id);
        else this.synth!.updateNote(next.id, next.controls);
        continue;
      }
      const length = next ? Math.min(left.length - position, next.frame - start - position) : left.length - position;
      this.rendering = true;
      this.synth!.render(left, right, position, length);
      this.rendering = false;
      position += length;
    }
    return true;
  }
}

registerProcessor('opm-processor', OPMProcessor);
