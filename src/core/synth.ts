import type { ADSR, PreparedVoice, VoiceInput } from '../voices/schema.js';
import type { AlgorithmGraph } from './algorithms.js';
import { normalizeTuning, tuningFrequency } from './tuning.js';
import type { NormalizedTuning, TuningOptions } from './tuning.js';
import { lfoValue } from './lfo.js';
import { DECIMATOR_STATE_SIZE, createDecimatorCoefficients, decimateSample, qualityOversample } from './decimator.js';
import type { QualityProfile } from './decimator.js';
export type { QualityProfile } from './decimator.js';

const typedArrayPrototype: object = Object.getPrototypeOf(Float32Array.prototype);
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get! as (this: unknown) => number;
const typedArrayKind = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get! as (this: unknown) => string | undefined;
const typedArrayFill = Float32Array.prototype.fill;

export type VoiceEndReason = 'stolen' | 'ended' | 'error' | 'cancelled';
export interface NoteOptions { velocity?: number; pan?: number; voicePriority?: number }
export interface NoteControls {
  pitch?: number; glide?: number; expression?: number; pan?: number; modulation?: number; ramp?: number;
  operatorLevels?: readonly [number, number, number, number];
  feedback?: number; lfoRate?: number; amDepth?: number; pmDepth?: number;
  operatorRatios?: readonly [number, number, number, number];
  /** A number enables fixed Hz; null restores the operator's live ratio. Pitch still applies. */
  operatorFrequencies?: readonly [number | null, number | null, number | null, number | null];
  operatorADSR?: readonly [ADSR, ADSR, ADSR, ADSR];
}
export interface SynthOptions {
  mixGain?: number;
  tuning?: TuningOptions;
  stealing?: 'oldest' | 'release-first' | 'quietest';
  quality?: QualityProfile;
}

/** A valid note could not displace any higher-priority logical voice. */
export class VoiceAdmissionError extends Error {
  constructor() {
    super('All active voices have higher voicePriority');
    this.name = 'VoiceAdmissionError';
  }
}

export function validateMaxVoices(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 32) {
    throw new RangeError('maxVoices must be an integer in 1..32');
  }
  return value;
}

export function validateVoicePriority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 127) {
    throw new RangeError('voicePriority must be an integer in 0..127');
  }
  return value;
}

/** Snapshot note admission controls without invoking inherited values/accessors. */
function readNoteOptions(input: NoteOptions): Required<NoteOptions> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError('note options must be a plain data object');
  }
  const result = { velocity: 1, pan: 0, voicePriority: 0 };
  for (const key of Reflect.ownKeys(input)) {
    if (key !== 'velocity' && key !== 'pan' && key !== 'voicePriority') throw new TypeError('note options has an unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`note options.${key} must be data`);
    const value: unknown = descriptor.value;
    if (key === 'voicePriority') result.voicePriority = validateVoicePriority(value);
    else {
      const min = key === 'pan' ? -1 : 0;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > 1) {
        throw new RangeError(`${key} must be finite and in ${min}..1`);
      }
      result[key] = value;
    }
  }
  return result;
}

const CONTROL_LIMITS = Object.freeze({
  pitch: [-48, 48], glide: [0, 10], expression: [0, 1], pan: [-1, 1], modulation: [0, 2], ramp: [0, 10],
  feedback: [0, 7], lfoRate: [0, 20], amDepth: [0, 1], pmDepth: [0, 1200],
} as const);

/** Copy strict own-data controls at the API/dispatch boundary without invoking getters. */
export function validateNoteControls(input: NoteControls): NoteControls {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError('controls must be a plain object');
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length === 0) throw new TypeError('controls must not be empty');
  const result: NoteControls = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !['operatorLevels', 'operatorRatios', 'operatorFrequencies', 'operatorADSR'].includes(key) && !Object.hasOwn(CONTROL_LIMITS, key)) throw new TypeError('controls has an unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`controls.${key} must be data`);
    const value: unknown = descriptor.value;
    if (key === 'operatorLevels' || key === 'operatorRatios' || key === 'operatorFrequencies' || key === 'operatorADSR') {
      if (!Array.isArray(value) || value.length !== 4 || Reflect.ownKeys(value).length !== 5 ||
          Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${key} must be a dense four-element tuple`);
      const tuple: unknown[] = [];
      for (let op = 0; op < 4; op++) {
        const element = Object.getOwnPropertyDescriptor(value, String(op));
        if (!element || !Object.hasOwn(element, 'value')) throw new TypeError(`${key} must contain data`);
        const item: unknown = element.value;
        if (key === 'operatorADSR') {
          if (!item || typeof item !== 'object' || Array.isArray(item) ||
              (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) ||
              Reflect.ownKeys(item).length !== 4) throw new TypeError('operatorADSR requires full plain ADSR objects');
          const adsr: ADSR = { a: 0, d: 0, s: 0, r: 0 };
          for (const field of ['a', 'd', 's', 'r'] as const) {
            const data = Object.getOwnPropertyDescriptor(item, field);
            if (!data || !Object.hasOwn(data, 'value')) throw new TypeError('operatorADSR must contain data');
            const number: unknown = data.value;
            if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > (field === 's' ? 1 : 10)) {
              throw new RangeError('operatorADSR has an out-of-range value');
            }
            adsr[field] = number;
          }
          tuple.push(Object.freeze(adsr));
        } else {
          const min = key === 'operatorRatios' ? 0.125 : key === 'operatorFrequencies' ? 1 : 0;
          const max = key === 'operatorRatios' ? 32 : key === 'operatorFrequencies' ? 20000 : 2;
          if (key !== 'operatorFrequencies' || item !== null) {
            if (typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max) throw new RangeError(`${key} must be finite and in ${min}..${max}`);
          }
          tuple.push(item);
        }
      }
      Object.defineProperty(result, key, { value: Object.freeze(tuple), enumerable: true });
      continue;
    }
    const control = key as keyof typeof CONTROL_LIMITS;
    const [min, max] = CONTROL_LIMITS[control];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`controls.${key} must be finite and in ${min}..${max}`);
    }
    result[control] = value;
  }
  if (Object.hasOwn(result, 'glide') && !Object.hasOwn(result, 'pitch')) throw new TypeError('glide requires pitch');
  if (Object.hasOwn(result, 'ramp') && !Reflect.ownKeys(result).some(key => key !== 'ramp' && key !== 'pitch' && key !== 'glide' && key !== 'operatorADSR')) {
    throw new TypeError('ramp requires a rampable control');
  }
  return Object.freeze(result);
}

interface ActiveVoice {
  id: number; sequence: number; note: number; voicePriority: number; voice: PreparedVoice; graph: AlgorithmGraph;
  baseIncrements: Float64Array; increments: Float64Array; steps: Float64Array; sustainDb: Float64Array; sustainGain: Float64Array;
  attackStep: Float64Array; decayStep: Float64Array; releaseStep: Float64Array; gains: Float64Array;
  attackTimes: Float64Array; decayTimes: Float64Array; releaseTimes: Float64Array;
  operatorLevels: Float64Array; operatorFrom: Float64Array; operatorTargets: Float64Array;
  operatorStart: number; operatorFrames: number;
  levels: Float64Array; leftGain: number; rightGain: number; lastSample: number; fadeRemaining: number;
  lastFadeGain?: number; carrierGain: number; phases: Float64Array; values: Float64Array; filters: Float64Array;
  releaseDb: Float64Array; previous: number; older: number; pitchRelease: number;
  feedbackScale: number; elapsed: number; releaseTime: number; releaseEnd: number;
  velocity: number; expression: number; pan: number;
  expressionFrom: number; expressionTarget: number; expressionStart: number; expressionFrames: number;
  panFrom: number; panTarget: number; panStart: number; panFrames: number;
  modulation: number; modulationFrom: number; modulationTarget: number; modulationStart: number; modulationFrames: number;
  controlRamps: number;
  modIndex: number; amDepth: number; pmDepth: number;
  pitchFrom: number; pitchTarget: number; pitchStart: number; pitchFrames: number;
  scalarValues: Float64Array; scalarFrom: Float64Array; scalarTargets: Float64Array; scalarStarts: Float64Array; scalarFrames: Float64Array;
  ratios: Float64Array; ratioFrom: Float64Array; ratioTargets: Float64Array; ratioStart: number; ratioFrames: number;
  frequencies: Float64Array; frequencyFrom: Float64Array; frequencyTargets: Float64Array; frequencyStart: number; frequencyFrames: number;
  envelopeStart: Float64Array; envelopeFromDb: Float64Array; envelopeEdited: Uint8Array; releaseStarts: Float64Array;
  lfoTurns: number; lfoLive: boolean;
  tunedFrequency: number;
  frequencyScales: Float64Array;
  amGains: Float64Array; pmFactors: Float64Array;
}

interface MutableCounters {
  currentFrame: number; errorCount: number; lastStolenId: number | null;
}

import { ALGORITHMS } from './algorithms.js';
import { FLOOR_DB } from './envelope.js';
import { TAU } from './operator.js';
import { preparedVoiceValue } from '../voices/normalize.js';
export { normalizeVoice, prepareVoice } from '../voices/normalize.js';

const HEADROOM = 0.7;
const DEFAULT_MAX_VOICES = 8;
const MAX_FADES = 8;
const AMPLITUDE_FLOOR = 10 ** (FLOOR_DB / 20);
const DB_TO_LOG_GAIN = Math.LN10 / 20;
const DEFAULT_NOTE_OPTIONS: NoteOptions = Object.freeze({ velocity: 1, pan: 0, voicePriority: 0 });
const DEFAULT_TUNING = normalizeTuning({});
const EXPRESSION_RAMP = 1;
const PAN_RAMP = 2;
const MODULATION_RAMP = 4;
const OPERATOR_RAMP = 8;
const ENGINE_RAMP = 16;
const RATIO_RAMP = 32;
const FREQUENCY_RAMP = 64;
const SCALAR_FIELDS = ['feedback', 'lfoRate', 'amDepth', 'pmDepth'] as const;

function feedbackGain(value: number): number {
  return value <= 1 ? value * 0.5 * 2 ** -6 * Math.PI : 0.5 * 2 ** (value - 7) * Math.PI;
}

/** @internal Scale once per admission; low-note durations never exceed the voice's ten-second budget. */
export function operatorDuration(seconds: number, note: number, rateKeyScale = 0): number {
  return Math.min(10, seconds * 2 ** (-rateKeyScale * (note - 60) / 12));
}

function validateMixGain(gain: number): void {
  if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0 || gain > 1) {
    throw new RangeError('mixGain must be finite and in 0..1');
  }
}

/** @internal Validate structural settings without allocating voice slots; tuning is validated separately by normalizeTuning. */
export function readSynthOptions(input: SynthOptions): SynthOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError('options must be a plain object');
  }
  const result: SynthOptions = {};
  for (const key of Reflect.ownKeys(input)) {
    if (key !== 'mixGain' && key !== 'tuning' && key !== 'stealing' && key !== 'quality') throw new TypeError('options has an unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`options.${key} must be data`);
    if (key === 'mixGain') {
      validateMixGain(descriptor.value);
      result.mixGain = descriptor.value;
    } else if (key === 'quality') {
      qualityOversample(descriptor.value);
      result.quality = descriptor.value;
    } else if (key === 'stealing') {
      if (descriptor.value !== 'oldest' && descriptor.value !== 'release-first' && descriptor.value !== 'quietest') {
        throw new TypeError('stealing must be oldest, release-first or quietest');
      }
      result.stealing = descriptor.value;
    } else {
      result.tuning = descriptor.value;
    }
  }
  return result;
}

function createVoiceSlot(oversample: number): ActiveVoice {
  return {
    id: 0, sequence: 0, note: 0, voicePriority: 0, voice: null!, graph: ALGORITHMS[0],
    baseIncrements: new Float64Array(4), increments: new Float64Array(4), steps: new Float64Array(4),
    sustainDb: new Float64Array(4), sustainGain: new Float64Array(4),
    attackStep: new Float64Array(4), decayStep: new Float64Array(4), releaseStep: new Float64Array(4),
    attackTimes: new Float64Array(4), decayTimes: new Float64Array(4), releaseTimes: new Float64Array(4),
    operatorLevels: new Float64Array(4), operatorFrom: new Float64Array(4), operatorTargets: new Float64Array(4),
    operatorStart: 0, operatorFrames: 0,
    gains: new Float64Array(4 * oversample), levels: new Float64Array(4),
    leftGain: 0, rightGain: 0, lastSample: 0, fadeRemaining: 0, lastFadeGain: 1, carrierGain: 0,
    phases: new Float64Array(4), values: new Float64Array(4), filters: new Float64Array(oversample === 2 ? 4 : DECIMATOR_STATE_SIZE), releaseDb: new Float64Array(4),
    previous: 0, older: 0, pitchRelease: 0, feedbackScale: 0,
    elapsed: 0, releaseTime: -1, releaseEnd: -1, velocity: 1, expression: 1, pan: 0,
    expressionFrom: 1, expressionTarget: 1, expressionStart: 0, expressionFrames: 0,
    panFrom: 0, panTarget: 0, panStart: 0, panFrames: 0,
    modulation: 1, modulationFrom: 1, modulationTarget: 1, modulationStart: 0, modulationFrames: 0,
    controlRamps: 0,
    modIndex: 0, amDepth: 0, pmDepth: 0, pitchFrom: 0, pitchTarget: 0, pitchStart: 0, pitchFrames: 0,
    scalarValues: new Float64Array(4), scalarFrom: new Float64Array(4), scalarTargets: new Float64Array(4), scalarStarts: new Float64Array(4), scalarFrames: new Float64Array(4),
    ratios: new Float64Array(4), ratioFrom: new Float64Array(4), ratioTargets: new Float64Array(4), ratioStart: 0, ratioFrames: 0,
    frequencies: new Float64Array(4), frequencyFrom: new Float64Array(4), frequencyTargets: new Float64Array(4), frequencyStart: 0, frequencyFrames: 0,
    envelopeStart: new Float64Array(4), envelopeFromDb: new Float64Array(4), envelopeEdited: new Uint8Array(4), releaseStarts: new Float64Array(4),
    lfoTurns: 0, lfoLive: false,
    tunedFrequency: 0,
    frequencyScales: new Float64Array(4),
    amGains: new Float64Array(4), pmFactors: new Float64Array(4),
  };
}

function pitchAt(active: ActiveVoice, frame: number): number {
  if (active.pitchFrames === 0 || frame >= active.pitchStart + active.pitchFrames) return active.pitchTarget;
  return active.pitchFrom + (active.pitchTarget - active.pitchFrom) * (frame - active.pitchStart) / active.pitchFrames;
}
function rampAt(from: number, target: number, start: number, frames: number, frame: number): number {
  if (frames === 0 || frame >= start + frames) return target;
  return from + (target - from) * (frame - start) / frames;
}

function pitchEnvelopeAt(active: ActiveVoice, time: number): number {
  const envelope = active.voice.pitchEnvelope;
  if (!envelope) return 0;
  if (active.releaseTime >= 0) {
    if (envelope.r === 0 || time >= active.releaseTime + envelope.r) return envelope.final;
    return active.pitchRelease + (envelope.final - active.pitchRelease) * (time - active.releaseTime) / envelope.r;
  }
  if (envelope.a > 0 && time < envelope.a) return envelope.initial + (envelope.peak - envelope.initial) * time / envelope.a;
  if (envelope.d > 0 && time < envelope.a + envelope.d) return envelope.peak + (envelope.sustain - envelope.peak) * (time - envelope.a) / envelope.d;
  return envelope.sustain;
}

function updateModulation(active: ActiveVoice): void {
  active.modIndex = active.voice.modIndex * active.modulation;
  active.amDepth = Math.min(1, active.scalarValues[2] * active.modulation);
  active.pmDepth = Math.min(1200, active.scalarValues[3] * active.modulation);
  if (active.pmDepth === 0) {
    for (let op = 0; op < 4; op++) active.steps[op] = active.increments[op];
  }
}

function advanceControls(active: ActiveVoice): void {
  const ramps = active.controlRamps;
  const frame = active.elapsed;
  if (ramps & EXPRESSION_RAMP) {
    active.expression = rampAt(active.expressionFrom, active.expressionTarget, active.expressionStart, active.expressionFrames, frame);
    if (frame >= active.expressionStart + active.expressionFrames) active.controlRamps &= ~EXPRESSION_RAMP;
  }
  if (ramps & PAN_RAMP) {
    active.pan = rampAt(active.panFrom, active.panTarget, active.panStart, active.panFrames, frame);
    if (frame >= active.panStart + active.panFrames) active.controlRamps &= ~PAN_RAMP;
  }
  if (ramps & (EXPRESSION_RAMP | PAN_RAMP)) updatePan(active);
  if (ramps & MODULATION_RAMP) {
    active.modulation = rampAt(active.modulationFrom, active.modulationTarget, active.modulationStart, active.modulationFrames, frame);
    if (frame >= active.modulationStart + active.modulationFrames) active.controlRamps &= ~MODULATION_RAMP;
    updateModulation(active);
  }
  if (ramps & OPERATOR_RAMP) {
    for (let op = 0; op < 4; op++) {
      active.operatorLevels[op] = rampAt(active.operatorFrom[op], active.operatorTargets[op], active.operatorStart, active.operatorFrames, frame);
    }
    if (frame >= active.operatorStart + active.operatorFrames) active.controlRamps &= ~OPERATOR_RAMP;
  }
  if (ramps & ENGINE_RAMP) {
    let pending = false, modulationChanged = false;
    for (let field = 0; field < 4; field++) {
      if (active.scalarFrames[field] === 0) continue;
      active.scalarValues[field] = rampAt(active.scalarFrom[field], active.scalarTargets[field], active.scalarStarts[field], active.scalarFrames[field], frame);
      if (frame < active.scalarStarts[field] + active.scalarFrames[field]) pending = true;
      else active.scalarFrames[field] = 0;
      if (field === 0) active.feedbackScale = feedbackGain(active.scalarValues[0]);
      if (field >= 2) modulationChanged = true;
    }
    if (modulationChanged) updateModulation(active);
    if (!pending) active.controlRamps &= ~ENGINE_RAMP;
  }
  if (ramps & RATIO_RAMP) {
    for (let op = 0; op < 4; op++) active.ratios[op] = rampAt(active.ratioFrom[op], active.ratioTargets[op], active.ratioStart, active.ratioFrames, frame);
    if (frame >= active.ratioStart + active.ratioFrames) active.controlRamps &= ~RATIO_RAMP;
  }
}

function updatePan(active: ActiveVoice): void {
  const gain = active.velocity * active.expression;
  const angle = (active.pan + 1) * Math.PI / 4;
  active.leftGain = active.pan === 1 ? 0 : active.pan === 0 ? gain : gain * Math.SQRT2 * Math.cos(angle);
  active.rightGain = active.pan === -1 ? 0 : active.pan === 0 ? gain : gain * Math.SQRT2 * Math.sin(angle);
}
function removeAt<T>(items: T[], index: number): T {
  const removed = items[index];
  for (let i = index + 1; i < items.length; i++) items[i - 1] = items[i];
  items.pop();
  return removed;
}

function heldDb(time: number, attack: number, decay: number, sustainDb: number): number {
  if (attack > 0 && time < attack) return FLOOR_DB * (1 - time / attack);
  if (decay > 0 && time < attack + decay) return sustainDb * ((time - attack) / decay);
  return sustainDb;
}

function envelopeDbAt(active: ActiveVoice, time: number, op: number): number {
  if (active.releaseTime >= 0) {
    const release = active.releaseTimes[op], start = active.releaseStarts[op];
    if (release === 0 || time >= start + release) return FLOOR_DB;
    return active.releaseDb[op] + (FLOOR_DB - active.releaseDb[op]) * ((time - start) / release);
  }
  if (!active.envelopeEdited[op]) return heldDb(time, active.attackTimes[op], active.decayTimes[op], active.sustainDb[op]);
  const elapsed = time - active.envelopeStart[op], attack = active.attackTimes[op], decay = active.decayTimes[op];
  // A zero attack still preserves the boundary value: the new decay starts at
  // the interrupted dB instead of jumping to full scale.
  if (attack > 0 && elapsed < attack) return active.envelopeFromDb[op] * (1 - elapsed / attack);
  const from = attack > 0 ? 0 : active.envelopeFromDb[op];
  if (decay > 0 && elapsed < attack + decay) return from + (active.sustainDb[op] - from) * (elapsed - attack) / decay;
  return active.sustainDb[op];
}

function gainAt(active: ActiveVoice, time: number, op: number): number {
  if (active.envelopeEdited[op]) {
    const db = envelopeDbAt(active, time, op);
    return db <= FLOOR_DB ? 0 : Math.exp(db * DB_TO_LOG_GAIN);
  }
  const release = active.releaseTimes[op];
  if (active.releaseTime >= 0) {
    if (release === 0 || time >= active.releaseTime + release) return 0;
    const db = active.releaseDb[op] + (FLOOR_DB - active.releaseDb[op]) * ((time - active.releaseTime) / release);
    return db <= FLOOR_DB ? 0 : Math.exp(db * DB_TO_LOG_GAIN);
  }
  if (time >= active.attackTimes[op] + active.decayTimes[op]) return active.sustainGain[op];
  if (time === 0 && active.attackTimes[op] > 0) return 0;
  const db = heldDb(time, active.attackTimes[op], active.decayTimes[op], active.sustainDb[op]);
  return db <= FLOOR_DB ? 0 : Math.exp(db * DB_TO_LOG_GAIN);
}

function prepareGains(active: ActiveVoice, time: number, subTimes: Float64Array): void {
  const { sustainGain, gains, attackStep, decayStep, releaseStep, attackTimes, decayTimes, releaseTimes } = active;
  const oversample = subTimes.length;
  const lastTime = time + subTimes[oversample - 1];
  for (let op = 0; op < 4; op++) {
    if (active.envelopeEdited[op]) {
      for (let sub = 0; sub < oversample; sub++) gains[op + sub * 4] = gainAt(active, time + subTimes[sub], op);
      continue;
    }
    const attack = attackTimes[op], decay = decayTimes[op], release = releaseTimes[op];
    let step: number | undefined;
    if (active.releaseTime >= 0) {
      if (release === 0 || time >= active.releaseTime + release) {
        for (let sub = 0; sub < oversample; sub++) gains[op + sub * 4] = 0;
        continue;
      }
      if (lastTime < active.releaseTime + release) step = releaseStep[op];
    } else if (time >= attack + decay) {
      for (let sub = 0; sub < oversample; sub++) gains[op + sub * 4] = sustainGain[op];
      continue;
    } else if (time > 0 && lastTime < attack) {
      step = attackStep[op];
    } else if (time >= attack && lastTime < attack + decay) {
      step = decayStep[op];
    }
    // Re-anchor every output frame, so rounding cannot accumulate across time
    // or depend on render chunking. Boundary-crossing frames keep exact dB rules.
    if (step !== undefined) {
      let gain = gainAt(active, time, op);
      for (let sub = 0; sub < oversample; sub++) {
        gains[op + sub * 4] = gain;
        gain *= step;
      }
    } else {
      for (let sub = 0; sub < oversample; sub++) {
        gains[op + sub * 4] = gainAt(active, time + subTimes[sub], op);
      }
    }
  }
}
// Carrier-envelope energy avoids stealing a loud note merely at a zero crossing.
function voiceAudibility(active: ActiveVoice, sampleRate: number): number {
  const time = active.elapsed / sampleRate;
  let gain = 0;
  for (let index = 0; index < active.graph.carriers.length; index++) {
    const op = active.graph.carriers[index];
    const level = active.controlRamps & OPERATOR_RAMP ?
      rampAt(active.operatorFrom[op], active.operatorTargets[op], active.operatorStart, active.operatorFrames, active.elapsed) : active.operatorLevels[op];
    gain += active.levels[op] * level * gainAt(active, time, op);
  }
  const expression = active.controlRamps & EXPRESSION_RAMP ?
    rampAt(active.expressionFrom, active.expressionTarget, active.expressionStart, active.expressionFrames, active.elapsed) :
    active.expression;
  return gain * active.carrierGain * active.velocity * expression;
}


export class Synth {
  declare readonly sampleRate: number;
  declare readonly maxVoices: number;
  declare readonly quality: QualityProfile;
  /** @internal */
  declare oversample: number;
  declare readonly currentFrame: number;
  declare readonly errorCount: number;
  declare readonly lastStolenId: number | null;
  declare onVoiceEnded?: ((id: number, reason: VoiceEndReason) => void) | null;
  /** @internal */
  declare voices: ActiveVoice[];
  /** @internal */
  declare fades: ActiveVoice[];
  /** @internal */
  declare fadeFrames: number;
  /** @internal */
  declare spillLeft: number;
  /** @internal */
  declare spillRight: number;
  /** @internal */
  declare spillRemaining: number;
  /** @internal */
  declare nextId: number;
  /** @internal */
  declare subTimes: Float64Array;
  /** @internal */
  declare sequence: number;
  /** @internal */
  declare decimatorCoefficients: Float64Array;
  /** @internal Bounded spare slots include one admission scratch slot. */
  declare freeVoices: ActiveVoice[];
  /** @internal Preallocated notifications are drained after each stable frame. */
  declare terminalIds: Float64Array;
  /** @internal */
  declare terminalErrors: Uint8Array;
  /** @internal */
  declare rendering: boolean;
  /** @internal */
  declare mixGain: number;
  /** @internal */
  declare tuning: NormalizedTuning;
  /** @internal */
  declare stealing: NonNullable<SynthOptions['stealing']>;

  constructor(sampleRate: number, maxVoices = DEFAULT_MAX_VOICES, options: SynthOptions = {}) {
    if (typeof sampleRate !== 'number' || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
      throw new RangeError('sampleRate must be finite and in 8000..192000');
    }
    validateMaxVoices(maxVoices);
    const settings = readSynthOptions(options);
    this.quality = settings.quality ?? 'standard';
    this.oversample = qualityOversample(this.quality);
    this.mixGain = settings.mixGain ?? 1;
    this.tuning = settings.tuning === undefined ? DEFAULT_TUNING : normalizeTuning(settings.tuning);
    this.stealing = settings.stealing ?? 'oldest';
    this.sampleRate = sampleRate;
    this.maxVoices = maxVoices;
    this.voices = [];
    this.fades = [];
    this.freeVoices = Array.from({ length: maxVoices + MAX_FADES + 1 }, () => createVoiceSlot(this.oversample));
    this.terminalIds = new Float64Array(maxVoices);
    this.terminalErrors = new Uint8Array(maxVoices);
    this.rendering = false;
    this.fadeFrames = Math.ceil(sampleRate * 0.005);
    this.spillLeft = 0;
    this.spillRight = 0;
    this.spillRemaining = 0;
    this.lastStolenId = null;
    this.onVoiceEnded = null;
    this.currentFrame = 0;
    this.errorCount = 0;
    this.nextId = 1;
    this.subTimes = Float64Array.from({ length: this.oversample }, (_, sub) => sub / (sampleRate * this.oversample));
    this.sequence = 0;
    this.decimatorCoefficients = createDecimatorCoefficients(sampleRate, this.quality);
  }
  setMixGain(gain: number): void {
    validateMixGain(gain);
    this.mixGain = gain;
  }

  setTuning(tuning: TuningOptions): void {
    const normalized = normalizeTuning(tuning);
    this.tuning = normalized;
    for (let index = 0; index < this.voices.length; index++) this.retuneVoice(this.voices[index]);
    for (let index = 0; index < this.fades.length; index++) this.retuneVoice(this.fades[index]);
  }

  /** @internal */
  retuneVoice(active: ActiveVoice): void {
    const frequency = tuningFrequency(active.note, this.tuning);
    active.tunedFrequency = frequency;
    const rate = this.sampleRate * this.oversample;
    const factor = 2 ** (pitchAt(active, active.elapsed) / 12);
    for (let op = 0; op < 4; op++) {
      const source = active.voice.ops[op];
      const ratio = rampAt(active.ratioFrom[op], active.ratioTargets[op], active.ratioStart, active.ratioFrames, active.elapsed);
      const target = active.frequencyTargets[op] || frequency * ratio;
      const hz = rampAt(active.frequencyFrom[op], target, active.frequencyStart, active.frequencyFrames, active.elapsed);
      active.baseIncrements[op] = TAU * hz * 2 ** (source.detune / 1200) / rate;
      active.increments[op] = Math.min(TAU * 0.45, active.baseIncrements[op] * factor);
      active.steps[op] = active.increments[op];
    }
  }

  /** @internal */
  stealingIndex(voicePriority: number): number {
    let chosen = -1;
    let quietest = 0;
    for (let index = 0; index < this.voices.length; index++) {
      const candidate = this.voices[index];
      if (candidate.voicePriority > voicePriority) continue;
      const current = chosen < 0 ? undefined : this.voices[chosen];
      let preferred = !current || candidate.voicePriority < current.voicePriority;
      let audibility = 0;
      if (this.stealing === 'quietest') audibility = voiceAudibility(candidate, this.sampleRate);
      if (current && candidate.voicePriority === current.voicePriority) {
        preferred = candidate.sequence < current.sequence;
        if (this.stealing === 'release-first') {
          const released = candidate.releaseTime >= 0, currentReleased = current.releaseTime >= 0;
          if (released !== currentReleased) preferred = released;
        } else if (this.stealing === 'quietest' && audibility !== quietest) preferred = audibility < quietest;
      }
      if (preferred) {
        chosen = index;
        quietest = audibility;
      }
    }
    return chosen;
  }


  noteOn(input: VoiceInput | PreparedVoice, note: number, id?: number, options: NoteOptions = DEFAULT_NOTE_OPTIONS): number {
    const { velocity, pan, voicePriority } = readNoteOptions(options);
    const voice = preparedVoiceValue(input);
    if (typeof note !== 'number' || !Number.isFinite(note) || note < 0 || note > 127) {
      throw new RangeError('note must be finite and in 0..127');
    }
    if (id === undefined && this.nextId > Number.MAX_SAFE_INTEGER) throw new RangeError('Note ID space exhausted');
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) throw new RangeError('id must be a positive safe integer');
    for (const active of this.voices) if (active.id === id) throw new RangeError('id already active');
    const stolenIndex = this.voices.length >= this.maxVoices ? this.stealingIndex(voicePriority) : -1;
    if (this.voices.length >= this.maxVoices && stolenIndex < 0) throw new VoiceAdmissionError();
    if (id === undefined) id = this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    // Initialize the spare before changing admission state. No slot can be reused
    // while it is still active or fading, including during terminal callbacks.
    const active = this.freeVoices.pop()!;
    const { baseIncrements, increments, sustainDb, sustainGain, steps, attackStep, decayStep, levels } = active;
    const frequency = tuningFrequency(note, this.tuning);
    const rate = this.sampleRate * this.oversample;
    for (let i = 0; i < 4; i++) {
      const op = voice.ops[i];
      active.ratios[i] = active.ratioFrom[i] = active.ratioTargets[i] = op.ratio;
      active.frequencyTargets[i] = op.frequency ?? 0;
      active.frequencies[i] = active.frequencyFrom[i] = op.frequency ?? frequency * op.ratio;
      const scale = op.keyScale;
      const attenuation = scale ? Math.abs(note - scale.breakpoint) / 12 *
        (note < scale.breakpoint ? scale.leftDbPerOctave : scale.rightDbPerOctave) : 0;
      levels[i] = op.level * 10 ** (-(attenuation + (op.velocitySensitivity ?? 0) * (1 - velocity)) / 20);
      const operatorFrequency = (op.frequency ?? frequency * op.ratio) * 2 ** (op.detune / 1200);
      active.frequencyScales[i] = TAU * 2 ** (op.detune / 1200) / rate;
      baseIncrements[i] = TAU * operatorFrequency / rate;
      // Retain the original pre-PM cap, but keep unclipped pitch bases so a
      // downward bend can bring high-ratio operators back into audible range.
      increments[i] = TAU * Math.min(rate * 0.45, operatorFrequency) / rate;
      sustainDb[i] = op.adsr.s === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(op.adsr.s));
      sustainGain[i] = sustainDb[i] <= FLOOR_DB ? 0 : 10 ** (sustainDb[i] / 20);
      steps[i] = Math.min(TAU * 0.45, increments[i]);
      const attack = active.attackTimes[i] = operatorDuration(op.adsr.a, note, op.rateKeyScale);
      const decay = active.decayTimes[i] = operatorDuration(op.adsr.d, note, op.rateKeyScale);
      active.releaseTimes[i] = operatorDuration(op.adsr.r, note, op.rateKeyScale);
      attackStep[i] = attack === 0 ? 1 : 10 ** (-FLOOR_DB / (20 * attack * rate));
      decayStep[i] = decay === 0 ? 1 : 10 ** (sustainDb[i] / (20 * decay * rate));
    }
    active.id = id;
    active.voicePriority = voicePriority;
    active.note = note;
    active.sequence = this.sequence++;
    active.voice = voice;
    active.graph = ALGORITHMS[voice.algorithm];
    active.velocity = velocity;
    active.expression = 1;
    active.pan = pan;
    active.expressionFrom = active.expressionTarget = 1;
    active.expressionStart = active.expressionFrames = 0;
    active.panFrom = active.panTarget = pan;
    active.panStart = active.panFrames = 0;
    active.modulation = active.modulationFrom = active.modulationTarget = 1;
    active.modulationStart = active.modulationFrames = active.controlRamps = 0;
    active.modIndex = voice.modIndex;
    active.amDepth = voice.lfo.amDepth;
    active.pmDepth = voice.lfo.pmDepth;
    active.pitchFrom = active.pitchTarget = active.pitchStart = active.pitchFrames = 0;
    active.operatorLevels.fill(1);
    active.operatorFrom.fill(1);
    active.operatorTargets.fill(1);
    active.operatorStart = active.operatorFrames = 0;
    active.tunedFrequency = frequency;
    active.ratioStart = active.ratioFrames = active.frequencyStart = active.frequencyFrames = 0;
    active.scalarValues[0] = voice.feedback;
    active.scalarValues[1] = voice.lfo.rate;
    active.scalarValues[2] = voice.lfo.amDepth;
    active.scalarValues[3] = voice.lfo.pmDepth;
    active.scalarFrom.set(active.scalarValues);
    active.scalarTargets.set(active.scalarValues);
    active.scalarStarts.fill(0);
    active.scalarFrames.fill(0);
    active.envelopeStart.fill(0);
    active.envelopeFromDb.fill(FLOOR_DB);
    active.envelopeEdited.fill(0);
    active.releaseStarts.fill(0);
    active.lfoTurns = 0;
    active.lfoLive = false;
    active.pitchRelease = 0;
    updatePan(active);
    active.lastSample = active.fadeRemaining = 0;
    active.lastFadeGain = 1;
    active.carrierGain = HEADROOM / active.graph.carriers.length;
    active.phases.fill(0);
    active.values.fill(0);
    active.filters.fill(0);
    active.releaseDb.fill(0);
    active.releaseStep.fill(0);
    active.gains.fill(0);
    active.previous = active.older = active.elapsed = 0;
    active.feedbackScale = feedbackGain(voice.feedback);
    active.releaseTime = active.releaseEnd = -1;
    (this as MutableCounters).lastStolenId = null;
    if (this.voices.length >= this.maxVoices) {
      const stolen = removeAt(this.voices, stolenIndex);
      (this as MutableCounters).lastStolenId = stolen.id;
      // Preserve the old DSP state. Exhausted tails collapse into the existing
      // bounded spill ramp, then recycle before callbacks can admit more notes.
      if (this.fades.length === MAX_FADES) {
        const retired = removeAt(this.fades, 0);
        const gain = retired.lastFadeGain!;
        this.spillLeft += retired.lastSample * retired.leftGain * gain;
        this.spillRight += retired.lastSample * retired.rightGain * gain;
        this.spillRemaining = this.fadeFrames;
        this.freeVoices.push(retired);
      }
      stolen.fadeRemaining = this.fadeFrames;
      stolen.lastFadeGain = 1;
      this.fades.push(stolen);
    }
    this.voices.push(active);
    // Notify only after admission: callbacks may start another note reentrantly.
    if (this.lastStolenId !== null) this.ended(this.lastStolenId, 'stolen');
    return id;
  }

  noteOff(id: number): boolean {
    let active: ActiveVoice | undefined;
    for (const item of this.voices) if (item.id === id) { active = item; break; }
    if (!active || active.releaseTime >= 0) return false;
    this.releaseVoice(active);
    return true;
  }

  /** @internal */
  releaseVoice(active: ActiveVoice): void {
    const time = active.elapsed / this.sampleRate;
    active.pitchRelease = pitchEnvelopeAt(active, time);
    let maxRelease = 0;
    for (let op = 0; op < 4; op++) {
      active.releaseDb[op] = envelopeDbAt(active, time, op);
      active.releaseStarts[op] = time;
      const release = active.releaseTimes[op];
      maxRelease = Math.max(maxRelease, release);
      active.releaseStep[op] = release === 0 ? 0 :
        10 ** ((FLOOR_DB - active.releaseDb[op]) / (20 * release * this.sampleRate * this.oversample));
    }
    active.releaseTime = time;
    active.releaseEnd = time + maxRelease;
  }
  allNotesOff(): void {
    for (let index = 0; index < this.voices.length; index++) {
      const active = this.voices[index];
      if (active.releaseTime < 0) this.releaseVoice(active);
    }
  }

  panic(): void {
    while (this.fades.length > 0) this.freeVoices.push(this.fades.pop()!);
    this.spillLeft = this.spillRight = this.spillRemaining = 0;
    (this as MutableCounters).lastStolenId = null;
    this.cancelVoices();
  }

  /** @internal */
  cancelVoices(): void {
    if (this.voices.length === 0) return;
    const active = this.voices.pop()!;
    const id = active.id;
    this.freeVoices.push(active);
    // At most maxVoices (32) stack-local IDs survive recycling. Unlike shared
    // scratch storage, they cannot be overwritten by reentrant callbacks.
    this.cancelVoices();
    this.ended(id, 'cancelled');
  }


  updateNote(id: number, input: NoteControls): boolean {
    const controls = validateNoteControls(input);
    let active: ActiveVoice | undefined;
    for (const item of this.voices) if (item.id === id) { active = item; break; }
    if (!active) return false;
    if (active.controlRamps !== 0) advanceControls(active);
    if (controls.pitch !== undefined) {
      active.pitchFrom = pitchAt(active, active.elapsed);
      active.pitchTarget = controls.pitch;
      active.pitchStart = active.elapsed;
      active.pitchFrames = (controls.glide ?? 0) * this.sampleRate;
    }
    const frames = (controls.ramp ?? 0) * this.sampleRate;
    if (controls.lfoRate !== undefined && !active.lfoLive) {
      const lfo = active.voice.lfo;
      const clock = lfo.sync === 'global' ? this.currentFrame : active.elapsed;
      active.lfoTurns = clock / this.sampleRate * active.scalarValues[1] + (lfo.phase ?? 0);
      active.lfoTurns -= Math.floor(active.lfoTurns);
      active.lfoLive = true;
    }
    for (let field = 0; field < SCALAR_FIELDS.length; field++) {
      const value = controls[SCALAR_FIELDS[field]];
      if (value === undefined) continue;
      active.scalarFrom[field] = active.scalarValues[field];
      active.scalarTargets[field] = value;
      active.scalarStarts[field] = active.elapsed;
      active.scalarFrames[field] = active.scalarValues[field] === value ? 0 : frames;
      if (active.scalarFrames[field] === 0) {
        active.scalarValues[field] = value;
        if (field === 0) active.feedbackScale = feedbackGain(value);
        if (field >= 2) updateModulation(active);
      }
      active.controlRamps |= ENGINE_RAMP;
    }
    if (active.controlRamps & ENGINE_RAMP) advanceControls(active);
    if (controls.operatorRatios !== undefined || controls.operatorFrequencies !== undefined) {
      // Sample ongoing pitch-independent Hz before changing either timeline.
      for (let op = 0; op < 4; op++) {
        const ratio = rampAt(active.ratioFrom[op], active.ratioTargets[op], active.ratioStart, active.ratioFrames, active.elapsed);
        const target = active.frequencyTargets[op] || active.tunedFrequency * ratio;
        active.frequencies[op] = rampAt(active.frequencyFrom[op], target, active.frequencyStart, active.frequencyFrames, active.elapsed);
      }
    }
    if (controls.operatorRatios !== undefined) {
      for (let op = 0; op < 4; op++) {
        active.ratioFrom[op] = active.ratios[op];
        active.ratioTargets[op] = controls.operatorRatios[op];
        if (frames === 0) active.ratios[op] = controls.operatorRatios[op];
      }
      active.ratioStart = active.elapsed;
      active.ratioFrames = frames;
      if (frames !== 0) active.controlRamps |= RATIO_RAMP;
      else active.controlRamps &= ~RATIO_RAMP;
    }
    if (controls.operatorFrequencies !== undefined) {
      for (let op = 0; op < 4; op++) {
        active.frequencyFrom[op] = active.frequencies[op];
        active.frequencyTargets[op] = controls.operatorFrequencies[op] ?? 0;
      }
      active.frequencyStart = active.elapsed;
      active.frequencyFrames = frames;
      if (frames !== 0) active.controlRamps |= FREQUENCY_RAMP;
      else active.controlRamps &= ~FREQUENCY_RAMP;
    }
    if (controls.operatorRatios !== undefined || controls.operatorFrequencies !== undefined) this.retuneVoice(active);
    if (controls.operatorADSR !== undefined) {
      const time = active.elapsed / this.sampleRate;
      for (let op = 0; op < 4; op++) {
        const db = envelopeDbAt(active, time, op), adsr = controls.operatorADSR[op];
        const keyScale = active.voice.ops[op].rateKeyScale;
        active.envelopeFromDb[op] = db;
        active.envelopeStart[op] = time;
        active.envelopeEdited[op] = 1;
        active.attackTimes[op] = operatorDuration(adsr.a, active.note, keyScale);
        active.decayTimes[op] = operatorDuration(adsr.d, active.note, keyScale);
        if (active.attackTimes[op] === 0 && active.decayTimes[op] === 0) active.decayTimes[op] = 1 / this.sampleRate;
        active.sustainDb[op] = adsr.s === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(adsr.s));
        active.sustainGain[op] = active.sustainDb[op] <= FLOOR_DB ? 0 : 10 ** (active.sustainDb[op] / 20);
        active.releaseTimes[op] = operatorDuration(adsr.r, active.note, keyScale);
        if (active.releaseTime >= 0) {
          active.releaseDb[op] = db;
          active.releaseStarts[op] = time;
        }
      }
      if (active.releaseTime >= 0) {
        active.releaseEnd = time;
        for (let op = 0; op < 4; op++) active.releaseEnd = Math.max(active.releaseEnd, time + active.releaseTimes[op]);
      }
    }
    if (controls.expression !== undefined) {
      active.expressionFrom = active.expression;
      active.expressionTarget = controls.expression;
      active.expressionStart = active.elapsed;
      active.expressionFrames = active.expression === controls.expression ? 0 : frames;
      if (active.expressionFrames === 0) {
        active.expression = controls.expression;
        active.controlRamps &= ~EXPRESSION_RAMP;
      } else active.controlRamps |= EXPRESSION_RAMP;
    }
    if (controls.pan !== undefined) {
      active.panFrom = active.pan;
      active.panTarget = controls.pan;
      active.panStart = active.elapsed;
      active.panFrames = active.pan === controls.pan ? 0 : frames;
      if (active.panFrames === 0) {
        active.pan = controls.pan;
        active.controlRamps &= ~PAN_RAMP;
      } else active.controlRamps |= PAN_RAMP;
    }
    if (controls.expression !== undefined || controls.pan !== undefined) updatePan(active);
    if (controls.modulation !== undefined) {
      active.modulationFrom = active.modulation;
      active.modulationTarget = controls.modulation;
      active.modulationStart = active.elapsed;
      active.modulationFrames = active.modulation === controls.modulation ? 0 : frames;
      if (active.modulationFrames === 0) {
        active.modulation = controls.modulation;
        active.controlRamps &= ~MODULATION_RAMP;
      } else active.controlRamps |= MODULATION_RAMP;
      updateModulation(active);
    }
    if (controls.operatorLevels !== undefined) {
      let changed = false;
      for (let op = 0; op < 4; op++) {
        active.operatorFrom[op] = active.operatorLevels[op];
        active.operatorTargets[op] = controls.operatorLevels[op];
        if (active.operatorFrom[op] !== active.operatorTargets[op]) changed = true;
        if (frames === 0) active.operatorLevels[op] = controls.operatorLevels[op];
      }
      active.operatorStart = active.elapsed;
      active.operatorFrames = changed ? frames : 0;
      if (active.operatorFrames === 0) active.controlRamps &= ~OPERATOR_RAMP;
      else active.controlRamps |= OPERATOR_RAMP;
    }
    // Reset a former PM/glide step even when modulation becomes zero.
    if (controls.pitch !== undefined || controls.modulation !== undefined) {
      const factor = 2 ** (pitchAt(active, active.elapsed) / 12);
      for (let op = 0; op < 4; op++) {
        active.increments[op] = Math.min(TAU * 0.45, active.baseIncrements[op] * factor);
        active.steps[op] = active.increments[op];
      }
    }
    return true;
  }

  /** @internal */
  ended(id: number, reason: VoiceEndReason): void {
    if (typeof this.onVoiceEnded === 'function') {
      try { this.onVoiceEnded(id, reason); } catch { (this as MutableCounters).errorCount++; }
    }
  }

  // One output frame, with no temporary arrays or objects in the hot path.
  /** @internal */
  renderVoice(active: ActiveVoice): number {
    const { graph, phases, values, filters, increments, steps, gains, levels } = active;
    if (active.controlRamps !== 0) advanceControls(active);
    const time = active.elapsed / this.sampleRate;
    const finished = active.releaseTime >= 0 && time >= active.releaseEnd;
    const lfo = active.voice.lfo;
    const lfoEnabled = time >= (lfo.delay ?? 0);
    let tremolo = 0;
    if (lfoEnabled && (active.amDepth !== 0 || active.pmDepth !== 0)) {
      const clock = lfo.sync === 'global' ? this.currentFrame : active.elapsed;
      const turns = active.lfoLive ? active.lfoTurns : clock / this.sampleRate * lfo.rate + (lfo.phase ?? 0);
      tremolo = lfoValue((turns - Math.floor(turns)) * TAU, lfo.waveform);
    }
    const amGain = !lfoEnabled || active.amDepth === 0 ? 1 : 1 - active.amDepth * (0.5 + 0.5 * tremolo);
    const pmFactor = !lfoEnabled || active.pmDepth === 0 ? 1 : 2 ** (active.pmDepth * tremolo / 1200);
    if (lfo.amTargets || lfo.pmTargets) {
      for (let op = 0; op < 4; op++) {
        const am = lfo.amTargets?.[op] ?? 1, pm = lfo.pmTargets?.[op] ?? 1;
        active.amGains[op] = am === 1 ? amGain : !lfoEnabled ? 1 : 1 - active.amDepth * am * (0.5 + 0.5 * tremolo);
        active.pmFactors[op] = pm === 1 ? pmFactor : !lfoEnabled ? 1 : 2 ** (active.pmDepth * pm * tremolo / 1200);
      }
    }
    const gliding = active.pitchFrames !== 0;
    const frequencyRamping = active.ratioFrames !== 0 || active.frequencyFrames !== 0;
    const dynamicPitch = gliding || active.voice.pitchEnvelope !== undefined || frequencyRamping;
    if (!dynamicPitch && active.pmDepth !== 0) {
      for (let op = 0; op < 4; op++) {
        const factor = lfo.pmTargets ? active.pmFactors[op] : pmFactor;
        steps[op] = Math.min(TAU * 0.45, increments[op] * factor);
      }
    }
    const operatorRamping = (active.controlRamps & OPERATOR_RAMP) !== 0;
    if (!finished) prepareGains(active, time, this.subTimes);
    let output = 0;
    for (let sub = 0; sub < this.oversample; sub++) {
      const frame = active.elapsed + sub / this.oversample;
      if (dynamicPitch) {
        const factor = 2 ** (pitchAt(active, frame) / 12 + pitchEnvelopeAt(active, time + this.subTimes[sub]) / 1200);
        for (let op = 0; op < 4; op++) {
          if (frequencyRamping) {
            const ratio = rampAt(active.ratioFrom[op], active.ratioTargets[op], active.ratioStart, active.ratioFrames, frame);
            const target = active.frequencyTargets[op] || active.tunedFrequency * ratio;
            const hz = rampAt(active.frequencyFrom[op], target, active.frequencyStart, active.frequencyFrames, frame);
            active.baseIncrements[op] = hz * active.frequencyScales[op];
          }
          const pm = lfo.pmTargets ? active.pmFactors[op] : pmFactor;
          steps[op] = Math.min(TAU * 0.45, Math.min(TAU * 0.45, active.baseIncrements[op] * factor) * pm);
        }
      }
      let sample = 0;
      if (!finished) {
        for (let op = 0; op < 4; op++) {
          let modulation = op === 0 ? (active.previous + active.older) * active.feedbackScale : 0;
          const inputs = graph.inputs[op];
          for (let j = 0; j < inputs.length; j++) modulation += values[inputs[j]] * active.modIndex;
          const operatorLevel = operatorRamping ?
            rampAt(active.operatorFrom[op], active.operatorTargets[op], active.operatorStart, active.operatorFrames, frame) : active.operatorLevels[op];
          const am = lfo.amTargets ? active.amGains[op] : amGain;
          values[op] = Math.sin(phases[op] + modulation) * gains[op + sub * 4] * levels[op] * operatorLevel * am;
          const phase = phases[op] + steps[op];
          phases[op] = phase < TAU ? phase : phase - TAU;
          if (!Number.isFinite(values[op]) || !Number.isFinite(phases[op])) return NaN;
        }
        active.older = active.previous;
        active.previous = values[0];
        for (let j = 0; j < graph.carriers.length; j++) sample += values[graph.carriers[j]];
        sample *= active.carrierGain;
      }
      output = decimateSample(sample, filters, this.decimatorCoefficients);
      if (!Number.isFinite(output)) return NaN;
    }
    if (active.lfoLive) {
      active.lfoTurns += active.scalarValues[1] / this.sampleRate;
      active.lfoTurns -= Math.floor(active.lfoTurns);
    }
    active.elapsed++;
    if (gliding && active.elapsed >= active.pitchStart + active.pitchFrames) {
      active.pitchFrames = 0;
      const factor = 2 ** (active.pitchTarget / 12);
      for (let op = 0; op < 4; op++) {
        increments[op] = Math.min(TAU * 0.45, active.baseIncrements[op] * factor);
        steps[op] = increments[op];
      }
    }
    if (frequencyRamping) {
      if (active.elapsed >= active.ratioStart + active.ratioFrames) active.ratioFrames = 0;
      if (active.elapsed >= active.frequencyStart + active.frequencyFrames) {
        active.frequencyFrames = 0;
        active.controlRamps &= ~FREQUENCY_RAMP;
      }
      if (active.ratioFrames === 0 && active.frequencyFrames === 0) this.retuneVoice(active);
    }
    active.lastSample = output;
    return active.lastSample;
  }

  render(left: Float32Array, right: Float32Array, offset = 0, length?: number): void {
    if (this.rendering) throw new Error('render cannot be called reentrantly');
    if (typedArrayKind.call(left) !== 'Float32Array' || typedArrayKind.call(right) !== 'Float32Array') {
      throw new RangeError('render requires native Float32Arrays');
    }
    const leftLength = typedArrayLength.call(left), rightLength = typedArrayLength.call(right);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError('render requires an in-bounds offset and length');
    }
    if (length === undefined) length = leftLength - offset;
    if (!Number.isSafeInteger(length) || length < 0 ||
        offset + length > leftLength || offset + length > rightLength) {
      throw new RangeError('render requires an in-bounds offset and length');
    }
    if (this.voices.length === 0 && this.fades.length === 0 && this.spillRemaining === 0) {
      typedArrayFill.call(left, 0, offset, offset + length);
      if (right !== left) typedArrayFill.call(right, 0, offset, offset + length);
      (this as MutableCounters).currentFrame += length;
      return;
    }
    this.rendering = true;
    try {
      for (let frame = offset, end = offset + length; frame < end; frame++) {
        let mixedLeft = 0, mixedRight = 0, terminalCount = 0;
        for (let index = 0; index < this.voices.length; index++) {
          const active = this.voices[index];
          const sample = this.renderVoice(active);
          if (!Number.isFinite(sample)) {
            (this as MutableCounters).errorCount++;
            this.terminalIds[terminalCount] = active.id;
            this.terminalErrors[terminalCount++] = 1;
            this.freeVoices.push(removeAt(this.voices, index--));
            continue;
          }
          mixedLeft += sample * active.leftGain;
          mixedRight += sample * active.rightGain;
          let tailPeak = Math.abs(sample);
          if (active.releaseTime >= 0 && (active.elapsed - 1) / this.sampleRate >= active.releaseEnd) {
            for (let state = 0; state < active.filters.length; state++) tailPeak = Math.max(tailPeak, Math.abs(active.filters[state]));
          } else tailPeak = Infinity;
          if (tailPeak < AMPLITUDE_FLOOR) {
            this.terminalIds[terminalCount] = active.id;
            this.terminalErrors[terminalCount++] = 0;
            this.freeVoices.push(removeAt(this.voices, index--));
          }
        }
        for (let index = 0; index < this.fades.length; index++) {
          const active = this.fades[index];
          const sample = this.renderVoice(active);
          if (!Number.isFinite(sample)) {
            (this as MutableCounters).errorCount++;
            this.freeVoices.push(removeAt(this.fades, index--));
            continue;
          }
          const gain = active.fadeRemaining / this.fadeFrames;
          active.lastFadeGain = gain;
          mixedLeft += sample * active.leftGain * gain;
          mixedRight += sample * active.rightGain * gain;
          if (--active.fadeRemaining === 0) this.freeVoices.push(removeAt(this.fades, index--));
        }
        if (this.spillRemaining > 0) {
          mixedLeft += this.spillLeft;
          mixedRight += this.spillRight;
          const next = --this.spillRemaining;
          this.spillLeft *= next / (next + 1);
          this.spillRight *= next / (next + 1);
        }
        // Saturate each stereo sum independently, preserving center dual mono.
        left[frame] = Number.isFinite(mixedLeft) ? HEADROOM * Math.tanh(mixedLeft * this.mixGain / HEADROOM) : 0;
        right[frame] = Number.isFinite(mixedRight) ? HEADROOM * Math.tanh(mixedRight * this.mixGain / HEADROOM) : 0;
        if (!Number.isFinite(mixedLeft) || !Number.isFinite(mixedRight)) (this as MutableCounters).errorCount++;
        // Callbacks may admit/release notes, but replacements first render on the
        // next frame. Live traversal would let a zero-release chain run forever.
        for (let index = 0; index < terminalCount; index++) {
          this.ended(this.terminalIds[index], this.terminalErrors[index] ? 'error' : 'ended');
        }
        (this as MutableCounters).currentFrame++;
      }
    } finally {
      this.rendering = false;
    }
  }
}
