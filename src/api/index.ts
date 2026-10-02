import { normalizeVoice } from '../voices/normalize.js';
import { brass } from '../voices/brass.js';
import type { NormalizedVoice, VoiceInput } from '../voices/schema.js';
import { validateNoteControls } from '../core/synth.js';
import type { NoteControls } from '../core/synth.js';
export type { ADSR, LFO, KeyScale, Operator, Voice, VoiceInput, FrozenVoice } from '../voices/schema.js';
export type { NoteControls } from '../core/synth.js';

export type NoteState = 'accepted' | 'started' | 'released' | 'ended' | 'stolen' | 'cancelled' | 'rejected';
export interface NoteEvent {
  type: 'note'; id: number; state: NoteState; reason?: string;
  /** Actual AudioContext sample frame and seconds at admission, dispatch or completion. */
  frame: number; time: number;
}
export interface DiagnosticsEvent {
  type: 'diagnostics'; requestId: number; activeVoices: number;
  pendingEvents: number; errors: number; rejectedNotes: number;
}
export interface ErrorEvent { type: 'error'; error: Error }
export type OPMEvent = NoteEvent | DiagnosticsEvent | ErrorEvent;
export interface OPMOptions {
  sampleRate?: number;
  /** Borrowed context: OPM never closes or suspends it. */
  context?: AudioContext;
  /** Omit to connect to context.destination; null disables automatic connection. */
  destination?: AudioNode | null;
  onEvent?: (event: OPMEvent) => void;
}
interface PlayNoteBase {
  voice?: string | VoiceInput;
  note: number;
  /** A late start keeps its full duration; drop rejects even if processing is delayed. */
  late?: 'start' | 'drop';
  /** null (the default) holds until stop; a number sets a duration before release. */
  duration?: number | null;
  velocity?: number;
  pan?: number;
}
export type PlayNoteOptions = PlayNoteBase & (
  /** Relative delay in seconds; cannot be combined with at. */
  { time?: number; at?: never } |
  /** Absolute AudioContext seconds, at most 60 seconds ahead. Past times are allowed. */
  { at: number; time?: never }
);
export interface ScheduledNoteOptions {
  /** Absolute AudioContext seconds. Stop without at is immediate, including cancellation. */
  at?: number;
}
interface MutableAudioState {
  context: AudioContext | null;
  node: AudioWorkletNode | null;
}
interface DiagnosticsRequest {
  resolve: (event: DiagnosticsEvent) => void;
  reject: (error: unknown) => void;
}

const MAX_DURATION = 60;
const MAX_DIAGNOSTICS_REQUESTS = 64;
const NOTE_STATES = ['accepted', 'started', 'released', 'ended', 'stolen', 'cancelled', 'rejected'];
const MAX_REGISTERED_VOICES = 128;
const NOTE_OBSERVERS = new WeakMap<OPM, Set<(event: NoteEvent) => void>>();

function ownData(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label} must be a plain data object`);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError(`${label} has an unknown field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label}.${key} must be data`);
    result[key] = descriptor.value;
  }
  return result;
}

function frozenPatch(input: VoiceInput): NormalizedVoice {
  const patch = normalizeVoice(input);
  for (const op of patch.ops) {
    Object.freeze(op.adsr);
    if (op.keyScale) Object.freeze(op.keyScale);
    Object.freeze(op);
  }
  Object.freeze(patch.ops);
  Object.freeze(patch.lfo);
  return Object.freeze(patch);
}

function absoluteTime(value: unknown, context: AudioContext): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      value > context.currentTime + MAX_DURATION ||
      !Number.isSafeInteger(Math.round(value * context.sampleRate))) {
    throw new RangeError('at must be finite, nonnegative, safely framed and at most 60 seconds ahead');
  }
  return value;
}

function noteId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('Invalid note id');
}

function replyData(data: unknown): NoteEvent | DiagnosticsEvent | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const type = Object.getOwnPropertyDescriptor(data, 'type');
  if (!type || !Object.hasOwn(type, 'value')) return null;
  const required = type.value === 'note' ? ['type', 'id', 'state', 'frame', 'time']
    : type.value === 'diagnostics' ? ['type', 'requestId', 'activeVoices', 'pendingEvents', 'errors', 'rejectedNotes'] : null;
  if (!required) return null;
  const result: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(data)) {
    if (!required.includes(key as string) && !(type.value === 'note' && key === 'reason')) return null;
    const descriptor = Object.getOwnPropertyDescriptor(data, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(result, key)) return null;
  if (result.type === 'note') {
    if (!Number.isSafeInteger(result.id) || (result.id as number) <= 0 || !NOTE_STATES.includes(result.state as string) ||
        (Object.hasOwn(result, 'reason') && typeof result.reason !== 'string') ||
        !Number.isSafeInteger(result.frame) || (result.frame as number) < 0 ||
        typeof result.time !== 'number' || !Number.isFinite(result.time) || result.time < 0) return null;
  } else {
    if (!Number.isSafeInteger(result.requestId) || (result.requestId as number) <= 0) return null;
    for (const key of ['activeVoices', 'pendingEvents', 'errors', 'rejectedNotes']) {
      if (!Number.isSafeInteger(result[key]) || (result[key] as number) < 0) return null;
    }
  }
  return result as unknown as NoteEvent | DiagnosticsEvent;
}

/** Browser-facing facade. Import Synth from ../core/synth.js for offline rendering. */
export class OPM {
  declare readonly sampleRate: number | undefined;
  /** Defensive map snapshot; loaded patches are deeply frozen. Use loadVoice to replace one. */
  get voices(): ReadonlyMap<string, NormalizedVoice> { return new Map(this._voices); }
  /** @internal */
  declare private _voices: Map<string, NormalizedVoice>;
  /** @internal */
  declare private _voiceIds: Map<NormalizedVoice, number>;
  /** @internal */
  declare private _rawVoices: Map<string, NormalizedVoice>;
  /** @internal */
  declare private _nextVoiceId: number;
  declare readonly context: AudioContext | null;
  declare readonly node: AudioWorkletNode | null;
  /** @internal */
  declare private nextId: number;
  declare onEvent?: (event: OPMEvent) => void;
  /** @internal */
  declare private _providedContext: AudioContext | null;
  /** @internal */
  declare private _destination: AudioNode | null | undefined;
  /** @internal */
  declare private _startPromise: Promise<void> | null;
  /** @internal */
  declare private _closePromise: Promise<void> | null;
  /** @internal */
  declare private _processorFailure: Error | null;
  /** @internal */
  declare private _diagnostics: Map<number, DiagnosticsRequest>;
  /** @internal */
  declare private _nextRequestId: number;
  /** @internal */
  declare private _contextListener: {
    context: AudioContext; node: AudioWorkletNode; listener: () => void;
  } | null | undefined;

  constructor(options: OPMOptions = {}) {
    const { sampleRate, context, destination, onEvent } = ownData(options,
      ['sampleRate', 'context', 'destination', 'onEvent'], 'OPM options') as OPMOptions;
    if (sampleRate !== undefined && (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000)) {
      throw new RangeError('sampleRate must be an integer in 8000..96000');
    }
    if (context !== undefined && (context === null || typeof context !== 'object' ||
        typeof context.resume !== 'function' || typeof context.audioWorklet?.addModule !== 'function')) {
      throw new TypeError('context must be an AudioContext with AudioWorklet support');
    }
    if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
    this.sampleRate = sampleRate;
    this._voices = new Map([['brass', frozenPatch(brass)]]);
    this._voiceIds = new Map();
    this._rawVoices = new Map();
    this._nextVoiceId = 1;
    (this as MutableAudioState).context = context ?? null;
    (this as MutableAudioState).node = null;
    this.nextId = 1;
    this.onEvent = onEvent;
    this._providedContext = context ?? null;
    this._destination = destination;
    this._startPromise = null;
    this._closePromise = null;
    this._processorFailure = null;
    this._diagnostics = new Map();
    this._nextRequestId = 1;
  }

  loadVoice(name: string, voice: VoiceInput): void {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new TypeError('Invalid voice name');
    this._voices.set(name, frozenPatch(voice));
  }

  /** @internal */
  private _emit(event: OPMEvent): void {
    const observers = NOTE_OBSERVERS.get(this);
    if (event.type === 'note' && observers) for (const observe of observers) observe(event);
    try { this.onEvent?.(event); } catch { /* Host callbacks cannot break audio lifecycle handling. */ }
  }

  /** @internal */
  private _rejectDiagnostics(error: unknown): void {
    for (const request of this._diagnostics.values()) request.reject(error);
    this._diagnostics.clear();
  }

  /** @internal */
  private _disposeNode(node: AudioWorkletNode | null): void {
    this._voiceIds.clear();
    this._rawVoices.clear();
    this._nextVoiceId = 1;
    if (!node) return;
    if (this._contextListener?.node === node) {
      const { context, listener } = this._contextListener;
      context.removeEventListener('statechange', listener);
      this._contextListener = null;
    }
    node.onprocessorerror = null;
    node.port.onmessage = null;
    node.port.onmessageerror = null;
    // Port closure alone does not stop a processor in a borrowed, running context.
    try { node.port.postMessage({ type: 'close' }); } catch { /* Failed ports still need local cleanup. */ }
    try { node.disconnect(); } catch { /* It may already be disconnected. */ }
    try { node.port.close(); } catch { /* It may already be closed. */ }
  }

  /** @internal */
  private _handleFailure(node: AudioWorkletNode, error: Error): void {
    if (this.node !== node) return;
    this._processorFailure = error;
    (this as MutableAudioState).node = null;
    this._rejectDiagnostics(error);
    this._disposeNode(node);
    this._emit({ type: 'error', error });
  }

  /** @internal */
  private _receive(raw: unknown): void {
    let event: NoteEvent | DiagnosticsEvent | null;
    try { event = replyData(raw); } catch { return; }
    if (!event) return;
    if (event.type === 'diagnostics') {
      const request = this._diagnostics.get(event.requestId);
      if (request) {
        this._diagnostics.delete(event.requestId);
        request.resolve(event);
      }
    }
    this._emit(event);
  }

  start(): Promise<void> {
    if (this._closePromise) return this._closePromise.then(() => this.start());
    if (this._startPromise) return this._startPromise;
    const promise = Promise.resolve().then(() => this._start());
    this._startPromise = promise;
    const clear = () => { if (this._startPromise === promise) this._startPromise = null; };
    promise.then(clear, clear);
    return promise;
  }

  /** @internal */
  private async _start(): Promise<void> {
    if (this.context?.state === 'closed') {
      this._disposeNode(this.node);
      (this as MutableAudioState).node = null;
      if (this._providedContext) throw new Error('The provided AudioContext is closed');
      (this as MutableAudioState).context = null;
    }
    this._processorFailure = null;
    if (this.node) {
      const node = this.node;
      try {
        await this.context!.resume();
        if (this._processorFailure || this.node !== node) throw this._processorFailure ?? new Error('AudioWorklet stopped');
      } catch (error) {
        this._rejectDiagnostics(error);
        throw error;
      }
      return;
    }
    if (typeof globalThis.AudioWorkletNode !== 'function' ||
        (!this._providedContext && typeof globalThis.AudioContext !== 'function')) {
      throw new Error('AudioWorklet is not available in this environment; use Synth for offline rendering');
    }
    const context = this.context ?? new globalThis.AudioContext(this.sampleRate === undefined ? undefined : { sampleRate: this.sampleRate });
    (this as MutableAudioState).context = context;
    let node: AudioWorkletNode | null = null;
    try {
      await context.audioWorklet.addModule(new URL('../worklet/processor.js', import.meta.url));
      node = new globalThis.AudioWorkletNode(context, 'opm-processor', { outputChannelCount: [2] });
      (this as MutableAudioState).node = node;
      node.port.onmessage = (event) => { if (this.node === node) this._receive(event.data); };
      node.port.onmessageerror = () => this._handleFailure(node!, new Error('AudioWorklet message could not be decoded'));
      node.onprocessorerror = () => this._handleFailure(node!, new Error('AudioWorklet processor failed'));
      if (typeof context.addEventListener === 'function') {
        const listener = () => {
          if (context.state === 'closed') this._handleFailure(node!, new Error('AudioContext is closed'));
          else if (context.state !== 'running') this._rejectDiagnostics(new Error('AudioContext is not running; call resume() before getDiagnostics()'));
        };
        context.addEventListener('statechange', listener);
        this._contextListener = { context, node, listener };
      }
      const destination = this._destination === undefined ? context.destination : this._destination;
      if (destination !== null) node.connect(destination);
      await context.resume();
      if (this._processorFailure || this.node !== node) throw this._processorFailure ?? new Error('AudioWorklet stopped');
    } catch (error) {
      if (this.node === node) {
        (this as MutableAudioState).node = null;
        this._disposeNode(node);
      }
      this._rejectDiagnostics(error);
      if (!this._providedContext) {
        (this as MutableAudioState).context = null;
        try { await context.close(); } catch { /* Preserve the initialization failure. */ }
      }
      throw error;
    }
  }

  resume(): Promise<void> {
    return this.start();
  }

  /** @internal */
  private _requireNode(): AudioWorkletNode {
    if (this._processorFailure) throw this._processorFailure;
    if (!this.node || this._closePromise || this.context?.state === 'closed') throw new Error('Call start() before using the audio node');
    return this.node;
  }

  connect(destination: AudioNode): this {
    this._requireNode().connect(destination);
    return this;
  }

  disconnect(destination?: AudioNode): this {
    const node = this._requireNode();
    if (destination === undefined) node.disconnect();
    else node.disconnect(destination);
    return this;
  }

  playNote(options: PlayNoteOptions): number {
    const node = this._requireNode();
    const data = ownData(options, ['voice', 'note', 'time', 'at', 'late', 'duration', 'velocity', 'pan'], 'note options');
    const voice = data.voice === undefined ? 'brass' : data.voice;
    const note = data.note;
    const duration = data.duration === undefined ? null : data.duration;
    const velocity = data.velocity === undefined ? 1 : data.velocity;
    const pan = data.pan === undefined ? 0 : data.pan;
    const late = data.late === undefined ? 'start' : data.late;
    if (!Number.isInteger(note) || (note as number) < 0 || (note as number) > 127) throw new RangeError('note must be a MIDI integer in 0..127');
    if (Object.hasOwn(data, 'at') && Object.hasOwn(data, 'time')) throw new TypeError('at and time are mutually exclusive');
    const time = data.time === undefined ? 0 : data.time;
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > MAX_DURATION) throw new RangeError('time must be a delay in 0..60 seconds');
    const at = absoluteTime(Object.hasOwn(data, 'at') ? data.at : this.context!.currentTime + time, this.context!);
    if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION)) {
      throw new RangeError('duration must be null or in (0, 60] seconds');
    }
    if (typeof velocity !== 'number' || !Number.isFinite(velocity) || velocity < 0 || velocity > 1) throw new RangeError('velocity must be in 0..1');
    if (typeof pan !== 'number' || !Number.isFinite(pan) || pan < -1 || pan > 1) throw new RangeError('pan must be in -1..1');
    if (late !== 'start' && late !== 'drop') throw new TypeError('late must be start or drop');
    const endFrame = Math.max(Math.round(at * this.context!.sampleRate), Math.round(this.context!.currentTime * this.context!.sampleRate)) +
      (duration === null ? 0 : Math.max(1, Math.ceil(duration * this.context!.sampleRate)));
    if (!Number.isSafeInteger(endFrame)) throw new RangeError('duration exceeds safe sample frames');
    if (!Number.isSafeInteger(this.nextId) || this.nextId <= 0) throw new RangeError('Note ID space exhausted');
    let patch: NormalizedVoice | undefined;
    let rawKey: string | undefined;
    if (typeof voice === 'string') patch = this._voices.get(voice);
    else {
      // Every raw call validates a fresh snapshot; mutations must not bypass validation.
      patch = frozenPatch(voice as VoiceInput);
      rawKey = JSON.stringify(patch);
      patch = this._rawVoices.get(rawKey) ?? patch;
    }
    if (!patch) throw new RangeError('Unknown voice');
    let voiceId = this._voiceIds.get(patch);
    if (voiceId === undefined && this._voiceIds.size < MAX_REGISTERED_VOICES) {
      voiceId = this._nextVoiceId++;
      node.port.postMessage({ type: 'prepareVoice', voiceId, voice: patch });
      this._voiceIds.set(patch, voiceId);
      if (rawKey !== undefined) this._rawVoices.set(rawKey, patch);
    }
    const id = this.nextId++;
    node.port.postMessage({ type: 'noteOn', id, ...(voiceId === undefined ? { voice: patch } : { voiceId }),
      note, at, duration, velocity, pan, late });
    return id;
  }

  stop(id: number, options: ScheduledNoteOptions = {}): void {
    const node = this._requireNode();
    noteId(id);
    const data = ownData(options, ['at'], 'stop options');
    const at = Object.hasOwn(data, 'at') ? absoluteTime(data.at, this.context!) : undefined;
    node.port.postMessage({ type: 'noteOff', id, ...(at === undefined ? {} : { at }) });
  }

  /** Pending updates apply at onset. At equal frames stop precedes onset, then controls. */
  updateNote(id: number, controls: NoteControls, options: ScheduledNoteOptions = {}): void {
    const node = this._requireNode();
    noteId(id);
    const snapshot = validateNoteControls(controls);
    const data = ownData(options, ['at'], 'update options');
    const at = Object.hasOwn(data, 'at') ? absoluteTime(data.at, this.context!) : undefined;
    node.port.postMessage({ type: 'updateNote', id, controls: snapshot, ...(at === undefined ? {} : { at }) });
  }

  getDiagnostics(): Promise<DiagnosticsEvent> {
    let node: AudioWorkletNode;
    try {
      node = this._requireNode();
      if (this.context!.state !== undefined && this.context!.state !== 'running') {
        throw new Error('AudioContext is not running; call resume() before getDiagnostics()');
      }
      if (this._diagnostics.size >= MAX_DIAGNOSTICS_REQUESTS) throw new Error('Too many pending diagnostics requests');
      if (!Number.isSafeInteger(this._nextRequestId) || this._nextRequestId <= 0) throw new RangeError('Diagnostics request ID space exhausted');
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = this._nextRequestId++;
    return new Promise<DiagnosticsEvent>((resolve, reject) => {
      this._diagnostics.set(requestId, { resolve, reject });
      try {
        node.port.postMessage({ type: 'diagnostics', requestId });
      } catch (error) {
        this._diagnostics.delete(requestId);
        reject(error);
      }
    });
  }

  close(): Promise<void> {
    if (this._closePromise) return this._closePromise;
    this._rejectDiagnostics(new Error('OPM is closed'));
    const promise = Promise.resolve().then(() => this._close());
    this._closePromise = promise;
    const clear = () => { if (this._closePromise === promise) this._closePromise = null; };
    promise.then(clear, clear);
    return promise;
  }

  /** @internal */
  private async _close(): Promise<void> {
    if (this._startPromise) {
      try { await this._startPromise; } catch { /* Initialization already releases failed resources. */ }
    }
    const node = this.node;
    const context = this.context;
    (this as MutableAudioState).node = null;
    (this as MutableAudioState).context = this._providedContext;
    this._processorFailure = null;
    this._rejectDiagnostics(new Error('OPM is closed'));
    this._disposeNode(node);
    if (context && !this._providedContext && context.state !== 'closed') await context.close();
  }
}

export interface LookaheadWindow {
  /** Half-open absolute AudioContext time window. Missed windows are skipped after a stall. */
  from: number; to: number;
  /** Maximum notes the callback may return in this batch. */
  maxNotes: number;
}
export type LookaheadNote = PlayNoteOptions & { at: number; duration: number };
export interface LookaheadOptions {
  /** Seconds, default 0.2; bounded to 0.02..10 and greater than interval. */
  horizon?: number;
  /** Seconds between pumps, default 0.025; bounded to 0.005..1. */
  interval?: number;
  /** Maximum batch size, default 32; bounded to 1..128. */
  maxNotes?: number;
  /** Timer/callback failures stop scheduling and are delivered here. */
  onError: (error: Error) => void;
}
export interface LookaheadScheduler {
  readonly running: boolean;
  /** Call from a user gesture; initializes/resumes OPM, then fills the first window. */
  start(): Promise<void>;
  /** Cancels pending notes and releases this scheduler's active gates, not other notes. */
  stop(): void;
  /** Stops and permanently prevents restart; does not close OPM. */
  dispose(): void;
}

/** Bounded timer-driven admission, not timer-driven note release. Audio frames own all gates. */
export function createLookaheadScheduler(
  opm: OPM,
  schedule: (window: LookaheadWindow) => readonly LookaheadNote[],
  options: LookaheadOptions,
): LookaheadScheduler {
  const data = ownData(options, ['horizon', 'interval', 'maxNotes', 'onError'], 'lookahead options');
  const rawHorizon = data.horizon === undefined ? 0.2 : data.horizon;
  const rawInterval = data.interval === undefined ? 0.025 : data.interval;
  const rawMaxNotes = data.maxNotes === undefined ? 32 : data.maxNotes;
  const rawOnError = data.onError;
  if (typeof schedule !== 'function' || typeof rawOnError !== 'function') throw new TypeError('schedule and onError must be functions');
  if (typeof rawHorizon !== 'number' || !Number.isFinite(rawHorizon) || rawHorizon < 0.02 || rawHorizon > 10 ||
      typeof rawInterval !== 'number' || !Number.isFinite(rawInterval) || rawInterval < 0.005 || rawInterval > 1 || rawInterval >= rawHorizon) {
    throw new RangeError('lookahead requires horizon in 0.02..10, interval in 0.005..1, and interval < horizon');
  }
  if (typeof rawMaxNotes !== 'number' || !Number.isInteger(rawMaxNotes) || rawMaxNotes < 1 || rawMaxNotes > 128) throw new RangeError('maxNotes must be an integer in 1..128');
  const horizon: number = rawHorizon;
  const interval: number = rawInterval;
  const maxNotes: number = rawMaxNotes;
  const onError = rawOnError as (error: Error) => void;
  let running = false;
  let disposed = false;
  let generation = 0;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let starting: Promise<void> | null = null;
  const gates = new Set<number>();
  const observers = NOTE_OBSERVERS.get(opm) ?? new Set<(event: NoteEvent) => void>();
  NOTE_OBSERVERS.set(opm, observers);
  let admitting = false;
  let admissionTerminal: number | null = null;
  const observe = (event: NoteEvent) => {
    if (event.state === 'ended' || event.state === 'stolen' || event.state === 'cancelled' || event.state === 'rejected') {
      gates.delete(event.id);
      if (admitting) admissionTerminal = event.id;
    }
  };

  function stop(reportFailure = true): void {
    running = false;
    generation++;
    clearTimeout(timer);
    timer = undefined;
    observers.delete(observe);
    let failure: unknown;
    for (const id of gates) {
      try { opm.stop(id); } catch (error) { failure ??= error; }
    }
    gates.clear();
    if (reportFailure && failure !== undefined) onError(failure instanceof Error ? failure : new Error(String(failure)));
  }

  function pump(): void {
    if (!running) return;
    try {
      const context = opm.context;
      if (!context || !opm.node || context.state !== 'running') throw new Error('Lookahead AudioContext is not running');
      const now = context.currentTime;
      const from = Math.max(cursor, now);
      const to = now + horizon;
      if (from < to) {
        const notes = schedule({ from, to, maxNotes });
        if (!Array.isArray(notes) || notes.length > maxNotes || gates.size + notes.length > 128) {
          throw new RangeError('Lookahead batch or outstanding gates exceed their bounded capacity');
        }
        // Snapshot batch data and timing before admission; never invoke array/option accessors.
        const batch: LookaheadNote[] = [];
        for (let index = 0; index < notes.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(notes, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Lookahead notes must be data array entries');
          const note = ownData(descriptor.value, ['voice', 'note', 'at', 'late', 'duration', 'velocity', 'pan'], 'lookahead note');
          if (typeof note.at !== 'number' || !Number.isFinite(note.at) || note.at < from || note.at >= to ||
              typeof note.duration !== 'number' || !Number.isFinite(note.duration) || note.duration <= 0 || note.duration > 60) {
            throw new RangeError('Lookahead notes require an at inside the window and duration in (0, 60]');
          }
          batch.push(note as unknown as LookaheadNote);
        }
        // A callback may stop/dispose its scheduler reentrantly.
        if (!running) return;
        cursor = to;
        for (const note of batch) {
          admissionTerminal = null;
          admitting = true;
          let id: number;
          try { id = opm.playNote(note); } finally { admitting = false; }
          if (admissionTerminal !== id) gates.add(id);
          if (!running) { opm.stop(id); gates.delete(id); return; }
        }
      }
      timer = setTimeout(pump, interval * 1000);
    } catch (error) {
      stop(false);
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return {
    get running() { return running; },
    start() {
      if (disposed) return Promise.reject(new Error('Lookahead scheduler is disposed'));
      if (starting) return starting;
      if (running) return Promise.resolve();
      const token = generation;
      const pending = opm.start().then(() => {
        if (disposed || token !== generation) return;
        running = true;
        observers.add(observe);
        cursor = opm.context!.currentTime;
        pump();
      });
      starting = pending;
      const clear = () => { if (starting === pending) starting = null; };
      pending.then(clear, clear);
      return pending;
    },
    stop,
    dispose() { disposed = true; stop(); },
  };
}
