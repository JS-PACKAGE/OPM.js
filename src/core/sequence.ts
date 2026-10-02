import { brass } from '../voices/brass.js';
import { prepareVoice } from '../voices/normalize.js';
import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
import { Synth, validateNoteControls } from './synth.js';
import type { NoteControls, SynthOptions } from './synth.js';
import type { RenderResult } from './index.js';

export interface SequenceNoteEvent {
  type: 'note'; id: number; time: number; duration: number;
  voice?: string | VoiceInput;
  note: number; velocity?: number; pan?: number;
}
export interface SequenceStopEvent { type: 'stop'; id: number; time: number }
export interface SequenceControlEvent { type: 'control'; id: number; time: number; controls: NoteControls }
export type SequenceEvent = SequenceNoteEvent | SequenceStopEvent | SequenceControlEvent;
export type SequenceVoices = ReadonlyMap<string, VoiceInput>;
export interface SequenceOptions extends SynthOptions { voices?: SequenceVoices; sampleRate?: number }
export type PreparedSequenceEvent =
  Readonly<Omit<SequenceNoteEvent, 'voice' | 'velocity' | 'pan'> & { voice: PreparedVoice; velocity: number; pan: number }> |
  Readonly<SequenceStopEvent> |
  Readonly<Omit<SequenceControlEvent, 'controls'> & { controls: Readonly<NoteControls> }>;
export interface SequenceSnapshot {
  readonly events: readonly PreparedSequenceEvent[];
  readonly noteCount: number;
  /** Notes reserve both onset and automatic release, even if explicitly cancelled. */
  readonly reservedSlots: number;
  readonly endTime: number;
}

export const MAX_SEQUENCE_NOTES = 128;
export const MAX_SEQUENCE_SLOTS = 256;
export const MAX_SEQUENCE_SECONDS = 60;
export const MAX_RENDER_SAMPLES = 4_000_000;

export function sampleRateValue(value: number): number {
  if (!Number.isInteger(value) || value < 8000 || value > 96000) {
    throw new RangeError('sampleRate must be an integer in 8000..96000');
  }
  return value;
}

function ownData(input: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError(`${label} must be a plain data object`);
  }
  const data: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError(`${label} has an unknown field`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label}.${key} must be data`);
    data[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(data, key)) throw new TypeError(`${label}.${key} is required`);
  return data;
}

function finite(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be finite and in ${min}..${max}`);
  }
  return value;
}

/** Validate the entire score without invoking accessors, and detach every patch/control. */
export function prepareSequence(events: readonly SequenceEvent[], options: Pick<SequenceOptions, 'voices'> = {}): SequenceSnapshot {
  const config = ownData(options, ['voices'], [], 'sequence options');
  const voices = config.voices;
  // Use the native operation, not an overridable registry.get accessor or method.
  if (voices !== undefined) {
    try { Map.prototype.has.call(voices, 'brass'); }
    catch { throw new TypeError('voices must be a Map'); }
  }
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  const length = Object.getOwnPropertyDescriptor(events, 'length')?.value as number;
  if (!Number.isInteger(length) || length > MAX_SEQUENCE_SLOTS) throw new RangeError('Sequence exceeds event budget');
  for (const key of Reflect.ownKeys(events)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
      throw new TypeError('events has an unknown field');
    }
  }
  const snapshot: PreparedSequenceEvent[] = [];
  const notes = new Set<number>();
  let reservedSlots = 0;
  let endTime = 0;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(events, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('events must contain own data events');
    const input: unknown = descriptor.value;
    const type = input !== null && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'type')?.value : undefined;
    const allowed = type === 'note' ? ['type', 'id', 'time', 'duration', 'voice', 'note', 'velocity', 'pan']
      : type === 'stop' ? ['type', 'id', 'time'] : type === 'control' ? ['type', 'id', 'time', 'controls'] : null;
    if (!allowed) throw new TypeError('Unknown sequence event type');
    const data = ownData(input, allowed, type === 'note' ? ['type', 'id', 'time', 'duration', 'note']
      : type === 'control' ? ['type', 'id', 'time', 'controls'] : ['type', 'id', 'time'], 'sequence event');
    const id = data.id as number;
    if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('Sequence id must be a positive safe integer');
    const time = finite(data.time, 0, MAX_SEQUENCE_SECONDS, 'time');
    endTime = Math.max(endTime, time);
    if (type === 'note') {
      if (notes.has(id)) throw new RangeError('Duplicate sequence note id');
      notes.add(id);
      reservedSlots += 2;
      if (notes.size > MAX_SEQUENCE_NOTES) throw new RangeError('Sequence exceeds note budget');
      const duration = finite(data.duration, 0, MAX_SEQUENCE_SECONDS, 'duration');
      if (duration === 0) throw new RangeError('duration must be greater than zero');
      endTime = Math.max(endTime, time + duration);
      const note = finite(data.note, 0, 127, 'note');
      const velocity = finite(data.velocity === undefined ? 1 : data.velocity, 0, 1, 'velocity');
      const pan = finite(data.pan === undefined ? 0 : data.pan, -1, 1, 'pan');
      let voice: unknown = data.voice === undefined ? 'brass' : data.voice;
      if (typeof voice === 'string') {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(voice)) throw new TypeError('Invalid voice name');
        voice = voices === undefined ? (voice === 'brass' ? brass : undefined) : Map.prototype.get.call(voices, voice);
        if (voice === undefined) throw new RangeError('Unknown sequence voice');
      }
      snapshot.push(Object.freeze({ type: 'note', id, time, duration, note, velocity, pan, voice: prepareVoice(voice as VoiceInput) }));
    } else {
      reservedSlots++;
      snapshot.push(type === 'stop' ? Object.freeze({ type: 'stop', id, time })
        : Object.freeze({ type: 'control', id, time, controls: Object.freeze(validateNoteControls(data.controls as NoteControls)) }));
    }
    if (reservedSlots > MAX_SEQUENCE_SLOTS) throw new RangeError('Sequence exceeds worklet slot budget');
    if (endTime > MAX_SEQUENCE_SECONDS) throw new RangeError('Sequence exceeds 60 second horizon');
  }
  for (const event of snapshot) {
    if (event.type !== 'note' && !notes.has(event.id)) throw new RangeError('Unknown sequence note id');
  }
  return Object.freeze({ events: Object.freeze(snapshot), noteCount: notes.size, reservedSlots, endTime });
}

type FrameEvent = { frame: number; order: number; event: PreparedSequenceEvent };
const EVENT_ORDER = { stop: 0, note: 1, control: 2 } as const;

/** Pure score rendering through the same bounded Synth used by the AudioWorklet. */
export function renderSequence(events: readonly SequenceEvent[], options: SequenceOptions = {}): RenderResult {
  const config = ownData(options, ['voices', 'sampleRate', 'mixGain', 'tuning', 'stealing'], [], 'render sequence options');
  const score = prepareSequence(events, { voices: config.voices as SequenceVoices | undefined });
  const sampleRate = sampleRateValue(config.sampleRate === undefined ? 44100 : config.sampleRate as number);
  const engine: SynthOptions = {};
  if (config.mixGain !== undefined) engine.mixGain = config.mixGain as SynthOptions['mixGain'];
  if (config.tuning !== undefined) engine.tuning = config.tuning as SynthOptions['tuning'];
  if (config.stealing !== undefined) engine.stealing = config.stealing as SynthOptions['stealing'];
  const synth = new Synth(sampleRate, 8, engine);
  const onsets = new Map<number, number>();
  const state = new Map<number, 'pending' | 'started' | 'released'>();
  const queue: FrameEvent[] = [];
  let lastFrame = 0;
  // Admit every note before explicit stops/controls, just as playSequence does.
  for (const event of score.events) {
    if (event.type !== 'note') continue;
    const frame = Math.round(event.time * sampleRate);
    const endFrame = frame + Math.max(1, Math.ceil(event.duration * sampleRate));
    onsets.set(event.id, frame);
    state.set(event.id, 'pending');
    queue.push({ frame, order: EVENT_ORDER.note, event });
    queue.push({ frame: endFrame, order: EVENT_ORDER.stop, event: { type: 'stop', id: event.id, time: endFrame / sampleRate } });
    let release = 0;
    for (const op of event.voice.ops) release = Math.max(release, op.adsr.r);
    lastFrame = Math.max(lastFrame, endFrame + Math.ceil(release * sampleRate));
  }
  for (const event of score.events) {
    if (event.type === 'note') continue;
    const frame = event.type === 'control' ? Math.max(Math.round(event.time * sampleRate), onsets.get(event.id)!)
      : Math.round(event.time * sampleRate);
    queue.push({ frame, order: EVENT_ORDER[event.type], event });
    lastFrame = Math.max(lastFrame, frame);
  }
  const length = lastFrame + Math.ceil(0.01 * sampleRate);
  if (length > MAX_RENDER_SAMPLES) throw new RangeError('Render exceeds sample budget');
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  queue.sort((a, b) => a.frame - b.frame || a.order - b.order);
  synth.onVoiceEnded = id => { state.delete(id); };
  let position = 0;
  for (const next of queue) {
    if (next.frame > position) {
      synth.render(left, right, position, next.frame - position);
      position = next.frame;
    }
    if (!state.has(next.event.id)) continue;
    const event = next.event;
    if (event.type === 'note') {
      synth.noteOn(event.voice, event.note, event.id, { velocity: event.velocity, pan: event.pan });
      state.set(event.id, 'started');
    } else if (event.type === 'stop') {
      if (state.get(event.id) === 'pending') state.delete(event.id);
      else if (synth.noteOff(event.id)) state.set(event.id, 'released');
    } else synth.updateNote(event.id, event.controls);
  }
  if (position < length) synth.render(left, right, position, length - position);
  return { samples: left, left, right, sampleRate, diagnostics: { errors: synth.errorCount } };
}
