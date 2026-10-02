import type { OPM, OPMEvent } from './index.js';
import { MAX_SEQUENCE_SECONDS, MAX_SEQUENCE_NOTES, MAX_SEQUENCE_SLOTS, prepareSequence, prepareLongSequence, sequenceOwnData, sequenceFrameEvents, sequenceWindowCapacity } from '../core/sequence.js';
import type { SequenceEvent, SequenceFrameEvent } from '../core/sequence.js';

export interface PlaySequenceOptions {
  /** Absolute AudioContext origin; omitted means currentTime at submission. */
  at?: number;
}
export interface SequencePlayback {
  /** Score IDs mapped to submitted OPM IDs, not an acknowledgement of admission. */
  readonly ids: ReadonlyMap<number, number>;
  /** Release started notes and immediately cancel pending onsets. Idempotent. */
  stop(): void;
}

/** Submit one bounded, wholly validated score; lifecycle acknowledgements remain OPM events. */
export function playSequence(opm: OPM, events: readonly SequenceEvent[], options: PlaySequenceOptions = {}): SequencePlayback {
  if (options === null || typeof options !== 'object' || Array.isArray(options) ||
      (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)) {
    throw new TypeError('sequence playback options must be a plain data object');
  }
  let origin: unknown;
  for (const key of Reflect.ownKeys(options)) {
    if (key !== 'at') throw new TypeError('sequence playback options has an unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('sequence playback at must be data');
    origin = descriptor.value;
  }
  const context = opm.context;
  const node = opm.node;
  if (!context || !node || context.state === 'closed') throw new Error('Call start() before playing a sequence');
  const at = origin === undefined ? context.currentTime : origin;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 ||
      at > context.currentTime + MAX_SEQUENCE_SECONDS || !Number.isSafeInteger(Math.round(at * context.sampleRate))) {
    throw new RangeError('sequence at must be finite, nonnegative, safely framed and at most 60 seconds ahead');
  }
  const score = prepareSequence(events, { voices: opm.voices });
  if (at + score.endTime > context.currentTime + MAX_SEQUENCE_SECONDS) {
    throw new RangeError('Sequence exceeds 60 second scheduling horizon');
  }
  // Check every derived frame before the first playNote can post a patch or onset.
  for (const event of score.events) {
    const frame = Math.round((at + event.time) * context.sampleRate);
    const endFrame = frame + (event.type === 'note' ? Math.max(1, Math.ceil(event.duration * context.sampleRate)) : 0);
    if (!Number.isSafeInteger(frame) || !Number.isSafeInteger(endFrame)) throw new RangeError('Sequence exceeds safe sample frames');
  }
  const ids = new Map<number, number>();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    // A close/reset must not turn an old handle into commands against a replacement node.
    if (opm.context !== context || opm.node !== node || context.state === 'closed') return;
    let failure: unknown;
    for (const id of ids.values()) {
      try { opm.stop(id); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  };
  try {
    // All references exist before stops/controls are queued. The worklet orders equal
    // sample frames as off/on/control and clamps pending controls to their onset.
    for (const event of score.events) {
      if (event.type !== 'note') continue;
      ids.set(event.id, opm.playNote({ voice: event.voice, note: event.note, at: at + event.time,
        duration: event.duration, velocity: event.velocity, pan: event.pan }));
    }
    for (const event of score.events) {
      if (event.type === 'stop') opm.stop(ids.get(event.id)!, { at: at + event.time });
      else if (event.type === 'control') opm.updateNote(ids.get(event.id)!, event.controls, { at: at + event.time });
    }
  } catch (error) {
    try { stop(); } catch { /* Preserve the submission failure; do not claim admission. */ }
    throw error;
  }
  return Object.freeze({ get ids(): ReadonlyMap<number, number> { return new Map(ids); }, stop });
}

export interface SequenceStreamOptions {
  /** Absolute origin, at most60 seconds ahead; defaults to currentTime at start. */
  at?: number;
  /** Lookahead seconds in0.01..10, default0.2. */
  horizon?: number;
  /** Timer interval seconds in0.001..horizon/2, default0.025 (or horizon/2). */
  interval?: number;
  /** Maximum own queued commands, integer1..256; default256. */
  maxSlots?: number;
  signal?: AbortSignal;
  onError?: (error: Error) => void;
}
export interface SequenceStream {
  readonly running: boolean;
  /** Live/pending owned score IDs only; terminal IDs are pruned. Detached snapshot. */
  readonly ids: ReadonlyMap<number, number>;
  /** One-shot start. stop/dispose/reset/interruption permanently cancel this score. */
  start(): Promise<void>;
  /** Optional explicit pump for hosts driving their own clock; timers still run. */
  pump(): void;
  stop(): void;
  dispose(): void;
}

/**
 * Stream a fully validated long score in bounded mixed-event windows.
 * A missed onset/window or rejected command stops the stream instead of silently retiming.
 */
export function streamSequence(opm: OPM, events: readonly SequenceEvent[], options: SequenceStreamOptions = {}): SequenceStream {
  const config = sequenceOwnData(options, ['at', 'horizon', 'interval', 'maxSlots', 'signal', 'onError'], [], 'sequence stream options');
  const horizonValue = config.horizon === undefined ? 0.2 : config.horizon;
  if (typeof horizonValue !== 'number' || !Number.isFinite(horizonValue) || horizonValue < 0.01 || horizonValue > 10) throw new RangeError('horizon must be in0.01..10');
  const horizon = horizonValue;
  const intervalValue = config.interval === undefined ? Math.min(0.025, horizon / 2) : config.interval;
  if (typeof intervalValue !== 'number' || !Number.isFinite(intervalValue) || intervalValue < 0.001 || intervalValue > horizon / 2) throw new RangeError('interval must be in0.001..horizon/2');
  const interval = intervalValue;
  const maxSlotsValue = config.maxSlots === undefined ? MAX_SEQUENCE_SLOTS : config.maxSlots;
  if (typeof maxSlotsValue !== 'number' || !Number.isInteger(maxSlotsValue) || maxSlotsValue < 1 || maxSlotsValue > MAX_SEQUENCE_SLOTS) throw new RangeError('maxSlots must be an integer in1..256');
  const maxSlots = maxSlotsValue;
  const origin = config.at;
  if (origin !== undefined && (typeof origin !== 'number' || !Number.isFinite(origin) || origin < 0)) throw new RangeError('at must be finite and nonnegative');
  if (config.onError !== undefined && typeof config.onError !== 'function') throw new TypeError('onError must be a function');
  const onError = config.onError as ((error: Error) => void) | undefined;
  const signal = config.signal as AbortSignal | undefined;
  const aborted = signal === undefined ? undefined : Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
  if (aborted) {
    try { aborted.call(signal); } catch { throw new TypeError('signal must be an AbortSignal'); }
  }
  // Validation is eager, before start() can initialize or post to an AudioWorklet.
  const score = prepareLongSequence(events, { voices: opm.voices });
  const preflight = sequenceFrameEvents(score, opm.context?.sampleRate ?? 44100);
  const density = sequenceWindowCapacity(preflight.queue, opm.context?.sampleRate ?? 44100, horizon);
  if (density.peakWindowSlots > maxSlots || density.peakWindowNotes > MAX_SEQUENCE_NOTES) {
    throw new RangeError('Sequence score exceeds lookahead slot capacity');
  }
  const ids = new Map<number, number>();
  const runtimeIds = new Map<number, number>();
  const cancelledNotes = new Set<number>();
  const pendingNotes = new Set(score.events.filter(event => event.type === 'note').map(event => event.id));
  let queued: { frame: number; id: number }[] = [];
  let queue: SequenceFrameEvent[] = [];
  let cursor = 0;
  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let cancelled = false;
  let begun = false;
  let starting: Promise<void> | undefined;
  let admissionTerminal: number | undefined;
  let admitting = false;

  function stop(): void {
    if (cancelled) return;
    cancelled = true;
    running = false;
    clearTimeout(timer);
    timer = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    if (signal) EventTarget.prototype.removeEventListener.call(signal, 'abort', stop);
    let failure: unknown;
    if (opm.context === context && opm.node === node && context?.state !== 'closed') {
      for (const id of ids.values()) {
        try { opm.stop(id); } catch (error) { failure ??= error; }
      }
    }
    ids.clear();
    runtimeIds.clear();
    cancelledNotes.clear();
    pendingNotes.clear();
    queued = [];
    queue = [];
    if (failure !== undefined) throw failure;
  }
  function fail(error: unknown): void {
    try { stop(); } catch { /* Preserve the scheduling failure. */ }
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }
  function observe(event: OPMEvent): void {
    if (event.type === 'reset') {
      ids.clear();
      runtimeIds.clear();
      stop();
      return;
    }
    if (event.type === 'context' && event.state !== 'running') { stop(); return; }
    if (event.type === 'command' && event.state === 'rejected' && event.id !== undefined && runtimeIds.has(event.id)) {
      fail(new Error(`Sequence command rejected: ${event.reason ?? 'unknown'}`));
      return;
    }
    if (event.type !== 'note') return;
    if (event.state === 'ended' || event.state === 'stolen' || event.state === 'cancelled' || event.state === 'rejected') {
      if (admitting) admissionTerminal = event.id;
      const scoreId = runtimeIds.get(event.id);
      if (scoreId !== undefined) {
        ids.delete(scoreId);
        runtimeIds.delete(event.id);
        queued = queued.filter(entry => entry.id !== event.id);
        if (event.state === 'rejected') fail(new Error(`Sequence note rejected: ${event.reason ?? 'unknown'}`));
      }
    }
  }
  function pump(): void {
    clearTimeout(timer);
    timer = undefined;
    if (!running || cancelled) return;
    if (aborted?.call(signal)) { stop(); return; }
    try {
      if (opm.context !== context || opm.node !== node || !context || context.state !== 'running') throw new Error('Sequence context changed or interrupted');
      const nowFrame = Math.round(context.currentTime * context.sampleRate);
      const toFrame = Math.round((context.currentTime + horizon) * context.sampleRate);
      queued = queued.filter(entry => entry.frame > nowFrame);
      let end = cursor;
      while (end < queue.length && queue[end].frame < toFrame) end++;
      if (end > cursor && queue[cursor].frame < nowFrame) throw new Error('Sequence lookahead missed a score event');
      if (queued.length + end - cursor > maxSlots) throw new RangeError('Sequence lookahead exceeds queued slot capacity');
      while (cursor < end && running && !cancelled) {
        const next = queue[cursor++];
        const event = next.event;
        const at = next.frame / context.sampleRate;
        if (event.type === 'note') {
          pendingNotes.delete(event.id);
          if (cancelledNotes.delete(event.id)) continue;
          if (ids.size >= MAX_SEQUENCE_NOTES) throw new RangeError('Sequence exceeds outstanding note capacity');
          admissionTerminal = undefined;
          admitting = true;
          let id: number;
          try {
            id = opm.playNote({ voice: event.voice, note: event.note, at, duration: null, velocity: event.velocity, pan: event.pan, late: 'drop' });
          } finally { admitting = false; }
          if (admissionTerminal === id) throw new Error('Sequence onset was rejected during admission');
          if (!running || cancelled) { opm.stop(id); return; }
          ids.set(event.id, id);
          runtimeIds.set(id, event.id);
          queued.push({ frame: next.frame, id });
        } else {
          const id = ids.get(event.id);
          if (id === undefined) {
            if (event.type === 'stop' && pendingNotes.has(event.id)) cancelledNotes.add(event.id);
            continue;
          }
          if (event.type === 'stop') opm.stop(id, { at });
          else opm.updateNote(id, event.controls, { at });
          if (!running || cancelled) return;
          queued.push({ frame: next.frame, id });
        }
      }
      if (cursor === queue.length && ids.size === 0) { stop(); return; }
      timer = setTimeout(pump, interval * 1000);
    } catch (error) { fail(error); }
  }
  const handle: SequenceStream = Object.freeze({
    get running() { return running; },
    get ids(): ReadonlyMap<number, number> { return new Map(ids); },
    start() {
      if (cancelled) return Promise.reject(new Error('Sequence stream is cancelled'));
      if (starting) return starting;
      if (begun) return Promise.resolve();
      begun = true;
      const pending = opm.start().then(() => {
        if (cancelled || aborted?.call(signal)) { stop(); return; }
        context = opm.context;
        node = opm.node;
        if (!context || !node || context.state !== 'running') throw new Error('Sequence requires a running AudioContext');
        const at = origin === undefined ? context.currentTime : origin as number;
        if (at < context.currentTime || at > context.currentTime + MAX_SEQUENCE_SECONDS) throw new RangeError('Sequence origin must be current or at most60 seconds ahead');
        queue = sequenceFrameEvents(score, context.sampleRate, at).queue;
        for (const event of queue) if (!Number.isSafeInteger(event.frame)) throw new RangeError('Sequence exceeds safe sample frames');
        const density = sequenceWindowCapacity(queue, context.sampleRate, horizon);
        if (density.peakWindowSlots > maxSlots || density.peakWindowNotes > MAX_SEQUENCE_NOTES) {
          throw new RangeError('Sequence score exceeds lookahead slot capacity');
        }
        unsubscribe = opm.subscribe(observe);
        running = true;
        if (signal) EventTarget.prototype.addEventListener.call(signal, 'abort', stop, { once: true });
        pump();
      }).catch(error => { fail(error); throw error; });
      starting = pending;
      return pending;
    },
    pump,
    stop,
    dispose: stop,
  });
  return handle;
}
