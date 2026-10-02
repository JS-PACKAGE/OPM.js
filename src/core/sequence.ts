import { brass } from '../voices/brass.js';
import { prepareVoice } from '../voices/normalize.js';
import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
import { Synth, VoiceAdmissionError, operatorDuration, readSynthOptions, validateMaxVoices, validateNoteControls, validateVoicePriority } from './synth.js';
import type { NoteControls, SynthOptions } from './synth.js';
import type { RenderResult } from './index.js';
import { normalizeTuning } from './tuning.js';

export interface SequenceNoteEvent {
  type: 'note'; id: number; time: number; duration: number;
  voice?: string | VoiceInput;
  note: number; velocity?: number; pan?: number; voicePriority?: number;
}
export interface SequenceStopEvent { type: 'stop'; id: number; time: number }
export interface SequenceControlEvent { type: 'control'; id: number; time: number; controls: NoteControls }
export type SequenceEvent = SequenceNoteEvent | SequenceStopEvent | SequenceControlEvent;
export type SequenceVoices = ReadonlyMap<string, VoiceInput>;
export interface SequenceOptions extends SynthOptions {
  voices?: SequenceVoices; sampleRate?: number;
  /** Logical polyphony, integer1..32; default8. Stolen fades remain bounded to eight. */
  maxVoices?: number;
}
export type PreparedSequenceEvent =
  Readonly<Omit<SequenceNoteEvent, 'voice' | 'velocity' | 'pan' | 'voicePriority'> & { voice: PreparedVoice; velocity: number; pan: number; voicePriority: number }> |
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
export const MAX_LONG_SEQUENCE_SECONDS = 24 * 60 * 60;
export const MAX_LONG_SEQUENCE_EVENTS = 65536;
export const MAX_SEQUENCE_CHUNK_FRAMES = 65536;

export function sampleRateValue(value: number): number {
  if (!Number.isInteger(value) || value < 8000 || value > 96000) {
    throw new RangeError('sampleRate must be an integer in 8000..96000');
  }
  return value;
}

export function sequenceOwnData(input: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
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
  return prepareScore(events, options, false);
}

/** Long scores have a separate input budget; this does not enlarge worklet queues. */
export function prepareLongSequence(events: readonly SequenceEvent[], options: Pick<SequenceOptions, 'voices'> = {}): SequenceSnapshot {
  return prepareScore(events, options, true);
}

function prepareScore(events: readonly SequenceEvent[], options: Pick<SequenceOptions, 'voices'>, long: boolean): SequenceSnapshot {
  const config = sequenceOwnData(options, ['voices'], [], 'sequence options');
  const maxSeconds = long ? MAX_LONG_SEQUENCE_SECONDS : MAX_SEQUENCE_SECONDS;
  const maxEvents = long ? MAX_LONG_SEQUENCE_EVENTS : MAX_SEQUENCE_SLOTS;
  const voices = config.voices;
  // Use the native operation, not an overridable registry.get accessor or method.
  if (voices !== undefined) {
    try { Map.prototype.has.call(voices, 'brass'); }
    catch { throw new TypeError('voices must be a Map'); }
  }
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  const length = Object.getOwnPropertyDescriptor(events, 'length')?.value as number;
  if (!Number.isInteger(length) || length > maxEvents) throw new RangeError('Sequence exceeds event budget');
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
    const allowed = type === 'note' ? ['type', 'id', 'time', 'duration', 'voice', 'note', 'velocity', 'pan', 'voicePriority']
      : type === 'stop' ? ['type', 'id', 'time'] : type === 'control' ? ['type', 'id', 'time', 'controls'] : null;
    if (!allowed) throw new TypeError('Unknown sequence event type');
    const data = sequenceOwnData(input, allowed, type === 'note' ? ['type', 'id', 'time', 'duration', 'note']
      : type === 'control' ? ['type', 'id', 'time', 'controls'] : ['type', 'id', 'time'], 'sequence event');
    const id = data.id as number;
    if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('Sequence id must be a positive safe integer');
    const time = finite(data.time, 0, maxSeconds, 'time');
    endTime = Math.max(endTime, time);
    if (type === 'note') {
      if (notes.has(id)) throw new RangeError('Duplicate sequence note id');
      notes.add(id);
      reservedSlots += 2;
      if (!long && notes.size > MAX_SEQUENCE_NOTES) throw new RangeError('Sequence exceeds note budget');
      const duration = finite(data.duration, 0, maxSeconds, 'duration');
      if (duration === 0) throw new RangeError('duration must be greater than zero');
      endTime = Math.max(endTime, time + duration);
      const note = finite(data.note, 0, 127, 'note');
      const velocity = finite(data.velocity === undefined ? 1 : data.velocity, 0, 1, 'velocity');
      const pan = finite(data.pan === undefined ? 0 : data.pan, -1, 1, 'pan');
      const voicePriority = Object.hasOwn(data, 'voicePriority') ? validateVoicePriority(data.voicePriority) : 0;
      let voice: unknown = data.voice === undefined ? 'brass' : data.voice;
      if (typeof voice === 'string') {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(voice)) throw new TypeError('Invalid voice name');
        voice = voices === undefined ? (voice === 'brass' ? brass : undefined) : Map.prototype.get.call(voices, voice);
        if (voice === undefined) throw new RangeError('Unknown sequence voice');
      }
      snapshot.push(Object.freeze({ type: 'note', id, time, duration, note, velocity, pan, voicePriority, voice: prepareVoice(voice as VoiceInput) }));
    } else {
      reservedSlots++;
      snapshot.push(type === 'stop' ? Object.freeze({ type: 'stop', id, time })
        : Object.freeze({ type: 'control', id, time, controls: Object.freeze(validateNoteControls(data.controls as NoteControls)) }));
    }
    if (!long && reservedSlots > MAX_SEQUENCE_SLOTS) throw new RangeError('Sequence exceeds worklet slot budget');
    if (endTime > maxSeconds) throw new RangeError(`Sequence exceeds ${maxSeconds} second horizon`);
  }
  for (const event of snapshot) {
    if (event.type !== 'note' && !notes.has(event.id)) throw new RangeError('Unknown sequence note id');
  }
  return Object.freeze({ events: Object.freeze(snapshot), noteCount: notes.size, reservedSlots, endTime });
}

export type SequenceFrameEvent = { frame: number; order: number; event: PreparedSequenceEvent };
const EVENT_ORDER = { stop: 0, note: 1, control: 2 } as const;

/** Shared sample-frame ordering, including automatic releases and pending controls. */
export function sequenceFrameEvents(score: SequenceSnapshot, sampleRate: number, origin = 0): { queue: SequenceFrameEvent[]; length: number } {
  const onsets = new Map<number, { frame: number; event: Extract<PreparedSequenceEvent, { type: 'note' }> }>();
  const queue: SequenceFrameEvent[] = [];
  let lastFrame = 0;
  for (const event of score.events) {
    if (event.type !== 'note') continue;
    const frame = Math.round((origin + event.time) * sampleRate);
    const endFrame = frame + Math.max(1, Math.ceil(event.duration * sampleRate));
    const onset = { frame, order: EVENT_ORDER.note, event };
    onsets.set(event.id, onset);
    queue.push(onset);
    queue.push({ frame: endFrame, order: EVENT_ORDER.stop, event: { type: 'stop', id: event.id, time: endFrame / sampleRate - origin } });
    let release = 0;
    for (const op of event.voice.ops) release = Math.max(release, operatorDuration(op.adsr.r, event.note, op.rateKeyScale));
    lastFrame = Math.max(lastFrame, endFrame + Math.ceil(release * sampleRate));
  }
  for (const event of score.events) {
    if (event.type === 'note') continue;
    const frame = event.type === 'control' ? Math.max(Math.round((origin + event.time) * sampleRate), onsets.get(event.id)!.frame)
      : Math.round((origin + event.time) * sampleRate);
    queue.push({ frame, order: EVENT_ORDER[event.type], event });
    lastFrame = Math.max(lastFrame, frame);
    if (event.type === 'control' && event.controls.operatorADSR !== undefined) {
      const onset = onsets.get(event.id)!;
      const note = onset.event;
      let release = 0;
      for (let index = 0; index < 4; index++) {
        release = Math.max(release, operatorDuration(event.controls.operatorADSR[index].r, note.note, note.voice.ops[index].rateKeyScale));
      }
      // A released envelope can be reanchored by later controls. Keep a conservative
      // tail bound even if an explicit stop or stealing ends this gate sooner.
      const gateEnd = onset.frame + Math.max(1, Math.ceil(note.duration * sampleRate));
      lastFrame = Math.max(lastFrame, Math.max(gateEnd, frame) + Math.ceil(release * sampleRate));
    }
  }
  queue.sort((a, b) => a.frame - b.frame || a.order - b.order);
  return { queue, length: lastFrame + Math.ceil(0.01 * sampleRate) };
}

/** Peak submissions in any half-open window; includes automatic releases. */
export function sequenceWindowCapacity(queue: readonly SequenceFrameEvent[], sampleRate: number, horizon: number) {
  let first = 0;
  let windowNotes = 0;
  let peakWindowSlots = 0;
  let peakWindowNotes = 0;
  const windowFrames = Math.ceil(horizon * sampleRate);
  for (let last = 0; last < queue.length; last++) {
    while (queue[last].frame - queue[first].frame >= windowFrames) {
      if (queue[first].event.type === 'note') windowNotes--;
      first++;
    }
    if (queue[last].event.type === 'note') windowNotes++;
    peakWindowSlots = Math.max(peakWindowSlots, last - first + 1);
    peakWindowNotes = Math.max(peakWindowNotes, windowNotes);
  }
  return { peakWindowSlots, peakWindowNotes };
}

export interface ChunkedSequenceOptions extends SequenceOptions {
  /** Integer 1..65536; default4096. Two buffers are reused for the entire render. */
  chunkFrames?: number;
  /** Optional hard cumulative frame budget, checked before allocation/advancement. */
  maxFrames?: number;
  signal?: AbortSignal;
}
export interface SequenceCapacity {
  readonly sampleRate: number;
  readonly frames: number;
  readonly pcmBytes: number;
  readonly chunkFrames: number;
  readonly chunkBytes: number;
  readonly eventCount: number;
  readonly noteCount: number;
  readonly reservedSlots: number;
  readonly fullBufferAllowed: boolean;
  readonly singleBatchAllowed: boolean;
  /** Default0.2s-window preflight eligibility, not guaranteed live worklet admission. */
  readonly streamAllowed: boolean;
  readonly peakWindowSlots: number;
  readonly peakWindowNotes: number;
  readonly limits: Readonly<{ fullBufferFrames: number; batchNotes: number; batchSlots: number; longEvents: number; longSeconds: number; chunkFrames: number; streamHorizonSeconds: number; streamSlots: number; streamNotes: number }>;
}
export interface SequenceChunk {
  /** Borrowed arrays, overwritten by the next next(). Copy only if retention is required. */
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly offset: number;
  readonly frames: number;
  readonly sampleRate: number;
  readonly diagnostics: Readonly<{ errors: number; processedEvents: number; renderedFrames: number }>;
}
export interface ChunkedSequenceRender extends IterableIterator<SequenceChunk> {
  readonly capacity: SequenceCapacity;
  readonly diagnostics: Readonly<{ errors: number; processedEvents: number; renderedFrames: number }>;
  /** Idempotent. Subsequent next() returns done without advancing the synth. */
  cancel(): void;
}

interface SequenceRenderPlan {
  score: SequenceSnapshot;
  engine: SynthOptions;
  maxVoices: number;
  queue: SequenceFrameEvent[];
  capacity: SequenceCapacity;
  signal: AbortSignal | undefined;
}

function renderPlan(events: readonly SequenceEvent[], options: ChunkedSequenceOptions, long: boolean): SequenceRenderPlan {
  const config = sequenceOwnData(options, ['voices', 'sampleRate', 'maxVoices', 'mixGain', 'tuning', 'stealing', 'quality', 'chunkFrames', 'maxFrames', 'signal'], [], 'render sequence options');
  const score = prepareScore(events, { voices: config.voices as SequenceVoices | undefined }, long);
  const sampleRate = sampleRateValue(config.sampleRate === undefined ? 44100 : config.sampleRate as number);
  const maxVoices = Object.hasOwn(config, 'maxVoices') ? validateMaxVoices(config.maxVoices) : 8;
  const chunkFrames = config.chunkFrames === undefined ? 4096 : config.chunkFrames;
  if (typeof chunkFrames !== 'number' || !Number.isInteger(chunkFrames) || chunkFrames < 1 || chunkFrames > MAX_SEQUENCE_CHUNK_FRAMES) {
    throw new RangeError('chunkFrames must be an integer in 1..65536');
  }
  const engine: SynthOptions = {};
  if (config.mixGain !== undefined) engine.mixGain = config.mixGain as SynthOptions['mixGain'];
  if (config.tuning !== undefined) engine.tuning = config.tuning as SynthOptions['tuning'];
  if (config.stealing !== undefined) engine.stealing = config.stealing as SynthOptions['stealing'];
  if (config.quality !== undefined) engine.quality = config.quality as SynthOptions['quality'];
  const settings = readSynthOptions(engine);
  if (settings.tuning !== undefined) settings.tuning = normalizeTuning(settings.tuning);
  const { queue, length } = sequenceFrameEvents(score, sampleRate);
  const absoluteMaxFrames = Math.ceil((MAX_LONG_SEQUENCE_SECONDS + 10.01) * sampleRate);
  const maxFrames = config.maxFrames === undefined ? absoluteMaxFrames : config.maxFrames;
  if (typeof maxFrames !== 'number' || !Number.isSafeInteger(maxFrames) || maxFrames < 0 || maxFrames > absoluteMaxFrames) {
    throw new RangeError('maxFrames must be a safe bounded nonnegative integer');
  }
  if (length > maxFrames) throw new RangeError('Render exceeds cumulative frame budget');
  const signal = config.signal as AbortSignal | undefined;
  if (signal !== undefined) {
    // Native brand check; never invoke a user-supplied aborted accessor.
    const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
    try { getter.call(signal); } catch { throw new TypeError('signal must be an AbortSignal'); }
  }
  const windowCapacity = sequenceWindowCapacity(queue, sampleRate, 0.2);
  const capacity: SequenceCapacity = Object.freeze({
    sampleRate, frames: length, pcmBytes: length * 8, chunkFrames, chunkBytes: chunkFrames * 8,
    eventCount: score.events.length, noteCount: score.noteCount, reservedSlots: score.reservedSlots,
    fullBufferAllowed: length <= MAX_RENDER_SAMPLES && score.endTime <= MAX_SEQUENCE_SECONDS &&
      score.noteCount <= MAX_SEQUENCE_NOTES && score.reservedSlots <= MAX_SEQUENCE_SLOTS,
    singleBatchAllowed: score.endTime <= MAX_SEQUENCE_SECONDS && score.noteCount <= MAX_SEQUENCE_NOTES && score.reservedSlots <= MAX_SEQUENCE_SLOTS,
    ...windowCapacity,
    streamAllowed: windowCapacity.peakWindowSlots <= MAX_SEQUENCE_SLOTS && windowCapacity.peakWindowNotes <= MAX_SEQUENCE_NOTES,
    limits: Object.freeze({ fullBufferFrames: MAX_RENDER_SAMPLES, batchNotes: MAX_SEQUENCE_NOTES, batchSlots: MAX_SEQUENCE_SLOTS,
      longEvents: MAX_LONG_SEQUENCE_EVENTS, longSeconds: MAX_LONG_SEQUENCE_SECONDS, chunkFrames: MAX_SEQUENCE_CHUNK_FRAMES,
      streamHorizonSeconds: 0.2, streamSlots: MAX_SEQUENCE_SLOTS, streamNotes: MAX_SEQUENCE_NOTES }),
  });
  return { score, engine: settings, maxVoices, queue, capacity, signal };
}

/** Validate and estimate without allocating any PCM or advancing a synth. */
export function estimateSequenceCapacity(events: readonly SequenceEvent[], options: ChunkedSequenceOptions = {}): SequenceCapacity {
  return renderPlan(events, options, true).capacity;
}

function chunkRenderer(plan: SequenceRenderPlan, output?: { left: Float32Array; right: Float32Array }): ChunkedSequenceRender {
  const { score, engine, maxVoices, queue, capacity, signal } = plan;
  const synth = new Synth(capacity.sampleRate, maxVoices, engine);
  const aborted = signal === undefined ? undefined : Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
  const left = output?.left ?? new Float32Array(capacity.chunkFrames);
  const right = output?.right ?? new Float32Array(capacity.chunkFrames);
  const state = new Map<number, 'pending' | 'started' | 'released'>();
  for (const event of score.events) if (event.type === 'note') state.set(event.id, 'pending');
  synth.onVoiceEnded = id => { state.delete(id); };
  let position = 0;
  let cursor = 0;
  let cancelled = false;
  const diagnostics = () => Object.freeze({ errors: synth.errorCount, processedEvents: cursor, renderedFrames: position });
  const renderer: ChunkedSequenceRender = {
    capacity,
    get diagnostics() { return diagnostics(); },
    cancel() { cancelled = true; state.clear(); },
    return() { renderer.cancel(); return { done: true, value: undefined }; },
    [Symbol.iterator]() { return this; },
    next() {
      if (cancelled || position >= capacity.frames) return { done: true, value: undefined };
      if (aborted?.call(signal)) { renderer.cancel(); throw new DOMException('Sequence render aborted', 'AbortError'); }
      const offset = position;
      const end = output ? capacity.frames : Math.min(offset + capacity.chunkFrames, capacity.frames);
      while (cursor < queue.length && queue[cursor].frame < end) {
        const next = queue[cursor];
        if (next.frame > position) {
          synth.render(left, right, position - offset, next.frame - position);
          position = next.frame;
        }
        cursor++;
        if (!state.has(next.event.id)) continue;
        const event = next.event;
        if (event.type === 'note') {
          try {
            synth.noteOn(event.voice, event.note, event.id, { velocity: event.velocity, pan: event.pan, voicePriority: event.voicePriority });
            state.set(event.id, 'started');
          } catch (error) {
            if (!(error instanceof VoiceAdmissionError)) throw error;
            state.delete(event.id);
          }
        } else if (event.type === 'stop') {
          if (state.get(event.id) === 'pending') state.delete(event.id);
          else if (synth.noteOff(event.id)) state.set(event.id, 'released');
        } else synth.updateNote(event.id, event.controls);
      }
      if (position < end) synth.render(left, right, position - offset, end - position);
      position = end;
      const frames = end - offset;
      return { done: false, value: Object.freeze({ left: frames === left.length ? left : left.subarray(0, frames),
        right: frames === right.length ? right : right.subarray(0, frames), offset, frames, sampleRate: capacity.sampleRate, diagnostics: diagnostics() }) };
    },
  };
  return renderer;
}

/** Fully validate first; each next() advances at most chunkFrames, never allocates full PCM. */
export function renderSequenceChunks(events: readonly SequenceEvent[], options: ChunkedSequenceOptions = {}): ChunkedSequenceRender {
  return chunkRenderer(renderPlan(events, options, true));
}

/** Convenience full-buffer rendering retains the original score and allocation budgets. */
export function renderSequence(events: readonly SequenceEvent[], options: SequenceOptions = {}): RenderResult {
  sequenceOwnData(options, ['voices', 'sampleRate', 'maxVoices', 'mixGain', 'tuning', 'stealing', 'quality'], [], 'render sequence options');
  const plan = renderPlan(events, options, false);
  if (plan.capacity.frames > MAX_RENDER_SAMPLES) throw new RangeError('Render exceeds sample budget');
  const left = new Float32Array(plan.capacity.frames);
  const right = new Float32Array(plan.capacity.frames);
  const renderer = chunkRenderer(plan, { left, right });
  renderer.next();
  return { samples: left, left, right, sampleRate: plan.capacity.sampleRate, diagnostics: { errors: renderer.diagnostics.errors } };
}
