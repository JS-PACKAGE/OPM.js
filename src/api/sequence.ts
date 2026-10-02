import type { OPM } from './index.js';
import { MAX_SEQUENCE_SECONDS, prepareSequence } from '../core/sequence.js';
import type { SequenceEvent } from '../core/sequence.js';

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
