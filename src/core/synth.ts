import type { ADSR, PreparedVoice, VoiceInput } from '../voices/schema.js';
import type { AlgorithmGraph } from './algorithms.js';
import { normalizeTuning, tuningFrequency } from './tuning.js';
import type { NormalizedTuning, TuningOptions } from './tuning.js';
import { lfoAt, lfoWaveformCode } from './lfo.js';
import { DECIMATOR_OUTPUT, DECIMATOR_STATE_SIZE, createDecimatorCoefficients, decimateFrame, decimatorPeak, qualityOversample } from './decimator.js';
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
  /** Independent per-note amplitude, 0..1 (default 1), multiplied with expression before mix saturation. */
  gain?: number;
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
  /** Output stage: `tanh` (default) saturates the whole range; `soft-knee` is
   * exactly linear below 0.5 and compresses only toward HEADROOM. */
  saturation?: 'tanh' | 'soft-knee';
  /** Remove DC and subsonic content from the mix before the output stage with a
   * 3 Hz one-pole high-pass (default false, which preserves the original output). */
  dcBlock?: boolean;
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
  feedback: [0, 7], lfoRate: [0, 20], amDepth: [0, 1], pmDepth: [0, 1200], gain: [0, 1],
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
  inputIndices: Int8Array; carrierIndices: Uint8Array;
  baseIncrements: Float64Array; incrementDeltas: Float64Array; incrementCurves: Float64Array; increments: Float64Array; steps: Float64Array; sustainDb: Float64Array; sustainGain: Float64Array;
  attackStep: Float64Array; decayStep: Float64Array; releaseStep: Float64Array; gains: Float64Array;
  /** Geometric segment gain at the next frame start, valid while `envelopeSegment` (1 attack, 2 decay, 3 release) matches. */
  envelopeGain: Float64Array; envelopeSegment: Uint8Array;
  /** Exclusive frame index up to which each operator certainly stays inside its current
   * geometric segment, with its per-substep ratio; zeroed by release and ADSR edits. */
  envelopeUntil: Float64Array; envelopeRatio: Float64Array;
  /** Exclusive frame index up to which every operator continues its geometric or constant
   * gain from the previous frame (0 when some operator needs reclassification). */
  envelopeFastUntil: number;
  attackTimes: Float64Array; decayTimes: Float64Array; releaseTimes: Float64Array;
  operatorLevels: Float64Array; operatorFrom: Float64Array; operatorTargets: Float64Array;
  operatorStart: number; operatorFrames: number;
  levels: Float64Array; leftGain: number; rightGain: number; lastSample: number; fadeRemaining: number;
  lastFadeGain?: number; carrierGain: number; phases: Float64Array; values: Float64Array;
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
  /** Note-on snapshot of the voice LFO: delay, rate, phase, global sync and waveform code. */
  lfoDelay: number; lfoRate: number; lfoPhase: number; lfoGlobal: boolean; lfoCode: number;
  /** Per-operator LFO depth scales (1 when the voice omits targets). */
  amTargeted: boolean; pmTargeted: boolean; amTargets: Float64Array; pmTargets: Float64Array;
  tunedFrequency: number;
  /** Every operator gain is constant until release or an ADSR edit. */
  gainsSteady: boolean;
  /** The prepared frame gains of every operator are exactly zero. */
  silentGains: boolean;
  /** The pitch envelope has reached a constant value folded into `increments`. */
  pitchSettled: boolean;
  /** Per-frame scratch: folded operator amplitudes 0..3, PM factor 4, pitch factor 5 and step 6. */
  sineFrame: Float64Array;
  /** This note's sine or periodic-waveform frame for its algorithm, or null when any operator is noise. */
  frameKernel: FrameKernel | null;
  /** The note's pitch envelope, snapshotted from its voice (whose shape varies). */
  pitchEnvelope: PreparedVoice['pitchEnvelope'];
  frequencyScales: Float64Array;
  amGains: Float64Array; pmFactors: Float64Array;
  waveforms: Uint8Array; noiseStates: Uint32Array; noiseTurns: Float64Array; noiseSteps: Float64Array;
}

interface MutableCounters {
  currentFrame: number; errorCount: number; lastStolenId: number | null;
}

import { ALGORITHMS } from './algorithms.js';
import { FLOOR_DB } from './envelope.js';
import { waveformCode, periodicWaveform, sinPi, fastExp2, NOISE_SEED, advanceNoise } from './operator.js';
import { preparedVoiceValue } from '../voices/normalize.js';
export { normalizeVoice, prepareVoice } from '../voices/normalize.js';

// Optimized code re-checks imported bindings (initialization and identity) at
// every use, so the hot loops use module-local constants and functions.
const TAU = 2 * Math.PI;
const ROUND_MAGIC = 6755399441055744;
// Operator phases, increments and phase modulation are in half-turns (units of
// pi radians): sinPi reduces them without multiplying by pi or 1/pi.
const PHASE_CYCLE = 2;
const HALF_TURNS_PER_RADIAN = 1 / Math.PI;
// The pre-PM and per-substep increment cap: 0.45 cycle per oversampled sample.
const MAX_STEP = 0.45 * PHASE_CYCLE;

const HEADROOM = 0.7;
// Linear LFO depth fade after a nonzero `lfo.delay`, in seconds.
const LFO_DELAY_FADE = 0.02;
// Soft-knee output stage: exactly linear up to SOFT_KNEE (−6 dBFS), then
// y = K + (H − K)·tanh((|x| − K)/(H − K)), which matches value, slope and
// curvature at the knee and approaches HEADROOM.
const SOFT_KNEE = 0.5;
function softKnee(x: number): number {
  const magnitude = Math.abs(x);
  if (magnitude <= SOFT_KNEE) return x;
  const shoulder = SOFT_KNEE + (HEADROOM - SOFT_KNEE) * Math.tanh((magnitude - SOFT_KNEE) / (HEADROOM - SOFT_KNEE));
  return x < 0 ? -shoulder : shoulder;
}
// Optional output DC blocker: H(z) = g·(1 − z⁻¹)/(1 − R·z⁻¹) with R = e^(−2π·fc/fs)
// and g = (1 + R)/2 for unity gain at Nyquist. fc = 3 Hz keeps loss at 20 Hz
// below 0.1 dB. A silent input settles the state to exact zero below DC_FLUSH.
const DC_BLOCK_HZ = 3;
const DC_FLUSH = 1e-10;
// Writes the output to state[index + 1]. Callers read it back from there: merging
// a (possibly non-inlined) call result into the mixed sample would make V8 box
// every frame's sample even while the blocker is disabled.
function dcBlockStep(state: Float64Array, index: number, input: number, gain: number, pole: number): void {
  let output = gain * (input - state[index]) + pole * state[index + 1];
  if (input === 0 && output > -DC_FLUSH && output < DC_FLUSH) output = 0;
  state[index] = input;
  state[index + 1] = output;
}
const DEFAULT_MAX_VOICES = 8;
const MAX_FADES = 8;
const TURNS_PER_HALF_TURN = 1 / PHASE_CYCLE;
const AMPLITUDE_FLOOR = 10 ** (FLOOR_DB / 20);
// Envelope segments restart their running geometric gain from the exact dB rule
// every this many output frames (a power of two).
const ENVELOPE_ANCHOR_FRAMES = 64;
// log2 of the amplitude per dB, for fastExp2: gain = 2^(dB * log2(10) / 20).
const DB_TO_LOG2_GAIN = Math.LN10 * Math.LOG2E / 20;
const DEFAULT_NOTE_OPTIONS: NoteOptions = Object.freeze({ velocity: 1, pan: 0, voicePriority: 0 });
const DEFAULT_TUNING = normalizeTuning({});
const EXPRESSION_RAMP = 1;
const PAN_RAMP = 2;
const MODULATION_RAMP = 4;
const OPERATOR_RAMP = 8;
const ENGINE_RAMP = 16;
const RATIO_RAMP = 32;
const FREQUENCY_RAMP = 64;
const SCALAR_FIELDS = ['feedback', 'lfoRate', 'amDepth', 'pmDepth', 'gain'] as const;

/** Feedback scale in half-turns per unit output: pi/128 * value up to 1, then
 * pi/2 * 2^(value - 7) radians. */
function feedbackGain(value: number): number {
  return value <= 1 ? value * 2 ** -7 : 2 ** (value - 8);
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
    if (key !== 'mixGain' && key !== 'tuning' && key !== 'stealing' && key !== 'quality' && key !== 'saturation' && key !== 'dcBlock') {
      throw new TypeError('options has an unknown field');
    }
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
    } else if (key === 'saturation') {
      if (descriptor.value !== 'tanh' && descriptor.value !== 'soft-knee') throw new TypeError('saturation must be tanh or soft-knee');
      result.saturation = descriptor.value;
    } else if (key === 'dcBlock') {
      if (typeof descriptor.value !== 'boolean') throw new TypeError('dcBlock must be a boolean');
      result.dcBlock = descriptor.value;
    } else {
      result.tuning = descriptor.value;
    }
  }
  return result;
}

function createVoiceSlot(oversample: number): ActiveVoice {
  return {
    id: 0, sequence: 0, note: 0, voicePriority: 0, voice: null!, graph: ALGORITHMS[0],
    inputIndices: new Int8Array(8), carrierIndices: new Uint8Array(4),
    baseIncrements: new Float64Array(4), incrementDeltas: new Float64Array(4), incrementCurves: new Float64Array(4), increments: new Float64Array(4), steps: new Float64Array(4),
    sustainDb: new Float64Array(4), sustainGain: new Float64Array(4),
    attackStep: new Float64Array(4), decayStep: new Float64Array(4), releaseStep: new Float64Array(4),
    envelopeGain: new Float64Array(4), envelopeSegment: new Uint8Array(4),
    envelopeUntil: new Float64Array(4), envelopeRatio: new Float64Array(4), envelopeFastUntil: 0,
    attackTimes: new Float64Array(4), decayTimes: new Float64Array(4), releaseTimes: new Float64Array(4),
    operatorLevels: new Float64Array(4), operatorFrom: new Float64Array(4), operatorTargets: new Float64Array(4),
    operatorStart: 0, operatorFrames: 0,
    gains: new Float64Array(4 * oversample), levels: new Float64Array(4),
    leftGain: 0, rightGain: 0, lastSample: 0, fadeRemaining: 0, lastFadeGain: 1, carrierGain: 0,
    phases: new Float64Array(4), values: new Float64Array(4), releaseDb: new Float64Array(4),
    previous: 0, older: 0, pitchRelease: 0, feedbackScale: 0,
    elapsed: 0, releaseTime: -1, releaseEnd: -1, velocity: 1, expression: 1, pan: 0,
    expressionFrom: 1, expressionTarget: 1, expressionStart: 0, expressionFrames: 0,
    panFrom: 0, panTarget: 0, panStart: 0, panFrames: 0,
    modulation: 1, modulationFrom: 1, modulationTarget: 1, modulationStart: 0, modulationFrames: 0,
    controlRamps: 0,
    modIndex: 0, amDepth: 0, pmDepth: 0, pitchFrom: 0, pitchTarget: 0, pitchStart: 0, pitchFrames: 0,
    scalarValues: new Float64Array(SCALAR_FIELDS.length), scalarFrom: new Float64Array(SCALAR_FIELDS.length),
    scalarTargets: new Float64Array(SCALAR_FIELDS.length), scalarStarts: new Float64Array(SCALAR_FIELDS.length), scalarFrames: new Float64Array(SCALAR_FIELDS.length),
    ratios: new Float64Array(4), ratioFrom: new Float64Array(4), ratioTargets: new Float64Array(4), ratioStart: 0, ratioFrames: 0,
    frequencies: new Float64Array(4), frequencyFrom: new Float64Array(4), frequencyTargets: new Float64Array(4), frequencyStart: 0, frequencyFrames: 0,
    envelopeStart: new Float64Array(4), envelopeFromDb: new Float64Array(4), envelopeEdited: new Uint8Array(4), releaseStarts: new Float64Array(4),
    lfoTurns: 0, lfoLive: false,
    lfoDelay: 0, lfoRate: 0, lfoPhase: 0, lfoGlobal: false, lfoCode: 0,
    amTargeted: false, pmTargeted: false, amTargets: new Float64Array(4), pmTargets: new Float64Array(4),
    tunedFrequency: 0, gainsSteady: false, silentGains: false, pitchSettled: false, sineFrame: new Float64Array(7),
    frameKernel: null, pitchEnvelope: undefined,
    frequencyScales: new Float64Array(4),
    amGains: new Float64Array(4), pmFactors: new Float64Array(4),
    waveforms: new Uint8Array(4), noiseStates: new Uint32Array(4), noiseTurns: new Float64Array(4), noiseSteps: new Float64Array(4),
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

function rampedFrequency(active: ActiveVoice, op: number, frame: number): number {
  const ratio = rampAt(active.ratioFrom[op], active.ratioTargets[op], active.ratioStart, active.ratioFrames, frame);
  const target = active.frequencyTargets[op] || active.tunedFrequency * ratio;
  return rampAt(active.frequencyFrom[op], target, active.frequencyStart, active.frequencyFrames, frame);
}

function pitchEnvelopeAt(active: ActiveVoice, time: number): number {
  const envelope = active.pitchEnvelope;
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
  active.modIndex = active.voice.modIndex * active.modulation * HALF_TURNS_PER_RADIAN;
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
    for (let field = 0; field < SCALAR_FIELDS.length; field++) {
      if (active.scalarFrames[field] === 0) continue;
      active.scalarValues[field] = rampAt(active.scalarFrom[field], active.scalarTargets[field], active.scalarStarts[field], active.scalarFrames[field], frame);
      if (frame < active.scalarStarts[field] + active.scalarFrames[field]) pending = true;
      else active.scalarFrames[field] = 0;
      if (field === 0) active.feedbackScale = feedbackGain(active.scalarValues[0]);
      if (field === 2 || field === 3) modulationChanged = true;
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
    return db <= FLOOR_DB ? 0 : fastExp2(db * DB_TO_LOG2_GAIN);
  }
  const release = active.releaseTimes[op];
  if (active.releaseTime >= 0) {
    if (release === 0 || time >= active.releaseTime + release) return 0;
    const db = active.releaseDb[op] + (FLOOR_DB - active.releaseDb[op]) * ((time - active.releaseTime) / release);
    return db <= FLOOR_DB ? 0 : fastExp2(db * DB_TO_LOG2_GAIN);
  }
  if (time >= active.attackTimes[op] + active.decayTimes[op]) return active.sustainGain[op];
  if (time === 0 && active.attackTimes[op] > 0) return 0;
  const db = heldDb(time, active.attackTimes[op], active.decayTimes[op], active.sustainDb[op]);
  return db <= FLOOR_DB ? 0 : fastExp2(db * DB_TO_LOG2_GAIN);
}

/** Stores `gainAt` at `elapsed / sampleRate` (plus `subTimes[sub]` when `sub >= 0`)
 * in `out[index]`. prepareGains calls this rather than gainAt: with no double
 * arguments or result, a call the JIT leaves out of line boxes nothing. */
function storeGain(active: ActiveVoice, op: number, sampleRate: number, subTimes: Float64Array, sub: number, out: Float64Array, index: number): void {
  const time = active.elapsed / sampleRate;
  out[index] = gainAt(active, sub < 0 ? time : time + subTimes[sub], op);
}

/** Released output is silent once every audible carrier finishes its release:
 * modulators cannot sound through a silent carrier, and a carrier with zero
 * static level or already at the floor stays exactly zero. Requires every
 * operator's release to start at `time`. */
function carrierReleaseEnd(active: ActiveVoice, time: number): number {
  let end = time;
  for (let index = 0; index < active.graph.carriers.length; index++) {
    const op = active.carrierIndices[index];
    if (active.levels[op] !== 0 && active.releaseDb[op] > FLOOR_DB) end = Math.max(end, time + active.releaseTimes[op]);
  }
  return end;
}

/** Writes four independent geometric sequences (start gain in envelopeGain, per-substep
 * ratio in envelopeRatio; ratio 1 holds a constant) and stores each next-frame start gain. */
function fillGains(active: ActiveVoice, oversample: number): void {
  const { gains, envelopeGain, envelopeRatio } = active;
  let g0 = envelopeGain[0], g1 = envelopeGain[1], g2 = envelopeGain[2], g3 = envelopeGain[3];
  const r0 = envelopeRatio[0], r1 = envelopeRatio[1], r2 = envelopeRatio[2], r3 = envelopeRatio[3];
  for (let sub = 0, base = 0; sub < oversample; sub++, base += 4) {
    gains[base] = g0; gains[base + 1] = g1; gains[base + 2] = g2; gains[base + 3] = g3;
    g0 *= r0; g1 *= r1; g2 *= r2; g3 *= r3;
  }
  envelopeGain[0] = g0; envelopeGain[1] = g1; envelopeGain[2] = g2; envelopeGain[3] = g3;
}

/** Returns true when every operator gain is constant until release or an ADSR edit.
 * Takes no double arguments: a non-inlined call would box them every frame. */
function prepareGains(active: ActiveVoice, subTimes: Float64Array, sampleRate: number): boolean {
  const { sustainGain, gains, attackStep, decayStep, releaseStep, attackTimes, decayTimes, releaseTimes, envelopeGain, envelopeSegment } = active;
  const { envelopeUntil, envelopeRatio } = active;
  const oversample = subTimes.length, elapsed = active.elapsed, time = elapsed / sampleRate;
  // Frames on the anchor grid restart a geometric segment from the exact dB rule,
  // so rounding from the running product is bounded and independent of chunking.
  const anchor = (elapsed & (ENVELOPE_ANCHOR_FRAMES - 1)) === 0;
  // Every operator continues exactly as its classification below would: geometric
  // segments from the stored gain and ratio, constants with ratio 1.
  if (!anchor && elapsed < active.envelopeFastUntil) {
    fillGains(active, oversample);
    return false;
  }
  const lastTime = time + subTimes[oversample - 1];
  let steady = true, exact = 0, fastUntil = Infinity;
  // Classify each operator's frame as a start gain in envelopeGain and a
  // per-substep ratio in envelopeRatio (1 when constant), or as bit `op` of
  // `exact` for per-substep dB evaluation.
  for (let op = 0; op < 4; op++) {
    let gain = 0, ratio = 1;
    // A frame known to lie inside the previous frame's geometric segment skips
    // reclassification; it continues exactly as the step branch below would.
    const until = envelopeUntil[op];
    if (elapsed < until) {
      steady = false;
      ratio = envelopeRatio[op];
      if (anchor) storeGain(active, op, sampleRate, subTimes, -1, envelopeGain, op);
      gain = envelopeGain[op];
      fastUntil = Math.min(fastUntil, until);
    } else if (active.levels[op] === 0) {
      // A zero static level silences the operator for the whole note (live levels
      // only multiply it), so its envelope cannot change the output.
      envelopeSegment[op] = 0;
    } else if (active.envelopeEdited[op]) {
      steady = false;
      exact |= 1 << op;
      envelopeSegment[op] = 0;
    } else {
      const attack = attackTimes[op], decay = decayTimes[op], release = releaseTimes[op];
      // Per-substep gain ratio, or −1 for exact per-substep evaluation. A number
      // sentinel keeps the variable an unboxed double.
      let step = -1, segment = 0, end = 0;
      if (active.releaseTime >= 0) {
        if (release === 0 || time >= active.releaseTime + release) step = -2;
        else if (lastTime < active.releaseTime + release) { step = releaseStep[op]; segment = 3; end = active.releaseTime + release; }
      } else if (time >= attack + decay) {
        step = -2;
        gain = sustainGain[op];
      } else if (time > 0 && lastTime < attack) {
        step = attackStep[op]; segment = 1; end = attack;
      } else if (time >= attack && lastTime < attack + decay) {
        step = decayStep[op]; segment = 2; end = attack + decay;
      }
      if (step >= 0) {
        steady = false;
        // Inside one dB-linear segment the gain is geometric: continue the previous
        // frame's product instead of re-evaluating 2^(dB) every frame.
        if (anchor || envelopeSegment[op] !== segment) storeGain(active, op, sampleRate, subTimes, -1, envelopeGain, op);
        gain = envelopeGain[op];
        ratio = step;
        envelopeSegment[op] = segment;
        // Each later frame's last substep is 1/sampleRate later; two spare frames
        // absorb rounding, so every counted frame takes this branch again.
        const later = elapsed + 1 + Math.max(0, Math.floor((end - lastTime) * sampleRate) - 2);
        envelopeUntil[op] = later;
        fastUntil = Math.min(fastUntil, later);
      } else {
        // Released-out and sustained operators (−2) hold a constant until release
        // or an edit; frames crossing a segment boundary (−1) keep exact dB rules.
        if (step === -1) {
          steady = false;
          exact |= 1 << op;
        }
        envelopeSegment[op] = 0;
      }
    }
    envelopeGain[op] = gain;
    envelopeRatio[op] = ratio;
  }
  active.envelopeFastUntil = exact === 0 && !steady ? fastUntil : 0;
  if (exact === 0) {
    active.silentGains = envelopeGain[0] === 0 && envelopeGain[1] === 0 && envelopeGain[2] === 0 && envelopeGain[3] === 0;
    fillGains(active, oversample);
    return steady;
  }
  active.silentGains = false;
  for (let op = 0; op < 4; op++) {
    if ((exact & (1 << op)) !== 0) {
      for (let sub = 0; sub < oversample; sub++) storeGain(active, op, sampleRate, subTimes, sub, gains, op + sub * 4);
      continue;
    }
    let gain = envelopeGain[op];
    const ratio = envelopeRatio[op];
    for (let sub = 0; sub < oversample; sub++) {
      gains[op + sub * 4] = gain;
      gain *= ratio;
    }
    envelopeGain[op] = gain;
  }
  return steady;
}

/** Stores the frame's pitch factor in `frame[5]` and its per-substep ratio in
 * `frame[6]` for stepPitch. Called with no double arguments and no result, so
 * renderVoice boxes nothing when this is not inlined. */
function preparePitch(active: ActiveVoice, frame: Float64Array, sampleRate: number, oversample: number): void {
  const next = active.elapsed + 1;
  const start = pitchAt(active, active.elapsed) / 12 + pitchEnvelopeAt(active, active.elapsed / sampleRate) / 1200;
  const end = pitchAt(active, next) / 12 + pitchEnvelopeAt(active, next / sampleRate) / 1200;
  frame[5] = fastExp2(start);
  frame[6] = end !== start ? fastExp2((end - start) / oversample) : 1;
}

/** Per-substep steps for glide, pitch envelopes and operator frequency ramps:
 * applies the pitch factor in `frame[5]` (then advances it by `frame[6]`), the
 * PM factor in `frame[4]` and the per-frame Hz parabola prepared by renderVoice. */
function stepPitch(active: ActiveVoice, sub: number, oversample: number, frame: Float64Array): void {
  const x = sub / oversample;
  const frequencyRamping = active.ratioFrames !== 0 || active.frequencyFrames !== 0;
  const pmTargets = active.pmTargeted;
  const { baseIncrements, incrementDeltas, incrementCurves, pmFactors, steps } = active;
  const pitchFactor = frame[5], pmFactor = frame[4];
  for (let op = 0; op < 4; op++) {
    const base = frequencyRamping ? baseIncrements[op] + x * (incrementDeltas[op] + x * incrementCurves[op]) : baseIncrements[op];
    const pm = pmTargets ? pmFactors[op] : pmFactor;
    steps[op] = Math.min(MAX_STEP, Math.min(MAX_STEP, base * pitchFactor) * pm);
  }
  frame[5] = pitchFactor * frame[6];
}

/** A silent operator (zero envelope, level or AM gain) outputs exact zero
 * without evaluating its oscillator; its phase still advances. Otherwise this
 * is exactly `sinPi(phase) * gain`, repeated here so the sine frames inline it
 * without per-call import checks; the generic path keeps `sinPi`, and the
 * fast/generic identity test pins the two together. */
function sineOp(phase: number, gain: number): number {
  if (gain === 0) return 0;
  const k = (phase + ROUND_MAGIC) - ROUND_MAGIC;
  const f = phase - k;
  const z = f * f, z2 = z * z;
  const p = f * ((3.141592653243751 + z * -5.1677127412212185) + z2 * (2.5501627947124317 + z * -0.5992474048092294) +
    (z2 * z2) * (0.08203122969596048 + z * -0.007000499610629468));
  return ((k & 1) === 0 ? p : -p) * gain;
}

/* All-sine operators with static operator levels: one output frame of
 * oversampled samples with oscillator state held in locals. renderVoice stores
 * the folded per-frame amplitudes and pitch factors in `sineFrame` and the
 * frame's static steps in `steps`. Each algorithm has its own function so every
 * oscillator call is inlined within the optimizing compiler's per-function
 * budget (a single shared switch exceeded it, leaving calls that box doubles),
 * and independent operators are not serialized behind masked terms. Sums keep the
 * graph's ascending input/carrier order. Each returns false on non-finite output;
 * a silent operator masks non-finite inputs, so the frame end also checks the
 * state it keeps. */
type FrameKernel = (active: ActiveVoice, out: Float64Array, dynamicPitch: boolean) => boolean;

function sineFrame0(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame } = active;
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    v0 = sineOp(p0 + (previous + older) * feedbackScale, gains[base] * q0);
    v1 = sineOp(p1 + v0 * m, gains[base + 1] * q1);
    v2 = sineOp(p2 + v1 * m, gains[base + 2] * q2);
    v3 = sineOp(p3 + v2 * m, gains[base + 3] * q3);
    const sample = v3 * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function sineFrame1(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame } = active;
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    v0 = sineOp(p0 + (previous + older) * feedbackScale, gains[base] * q0);
    v1 = sineOp(p1, gains[base + 1] * q1);
    v2 = sineOp(p2 + (v0 * m + v1 * m), gains[base + 2] * q2);
    v3 = sineOp(p3 + v2 * m, gains[base + 3] * q3);
    const sample = v3 * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function sineFrame2(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame } = active;
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    v0 = sineOp(p0 + (previous + older) * feedbackScale, gains[base] * q0);
    v1 = sineOp(p1, gains[base + 1] * q1);
    v2 = sineOp(p2 + v1 * m, gains[base + 2] * q2);
    v3 = sineOp(p3 + (v0 * m + v2 * m), gains[base + 3] * q3);
    const sample = v3 * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function sineFrame3(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame } = active;
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    v0 = sineOp(p0 + (previous + older) * feedbackScale, gains[base] * q0);
    v1 = sineOp(p1 + v0 * m, gains[base + 1] * q1);
    v2 = sineOp(p2, gains[base + 2] * q2);
    v3 = sineOp(p3 + (v1 * m + v2 * m), gains[base + 3] * q3);
    const sample = v3 * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function sineFrame4(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame } = active;
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    v0 = sineOp(p0 + (previous + older) * feedbackScale, gains[base] * q0);
    v1 = sineOp(p1 + v0 * m, gains[base + 1] * q1);
    v2 = sineOp(p2, gains[base + 2] * q2);
    v3 = sineOp(p3 + v2 * m, gains[base + 3] * q3);
    const sample = (v1 + v3) * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function sineFrame5(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame } = active;
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    v0 = sineOp(p0 + (previous + older) * feedbackScale, gains[base] * q0);
    const modulation = v0 * m;
    v1 = sineOp(p1 + modulation, gains[base + 1] * q1);
    v2 = sineOp(p2 + modulation, gains[base + 2] * q2);
    v3 = sineOp(p3 + modulation, gains[base + 3] * q3);
    const sample = (v1 + v2 + v3) * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function sineFrame6(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame } = active;
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    v0 = sineOp(p0 + (previous + older) * feedbackScale, gains[base] * q0);
    v1 = sineOp(p1 + v0 * m, gains[base + 1] * q1);
    v2 = sineOp(p2, gains[base + 2] * q2);
    v3 = sineOp(p3, gains[base + 3] * q3);
    const sample = (v1 + v2 + v3) * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function sineFrame7(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame } = active;
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    v0 = sineOp(p0 + (previous + older) * feedbackScale, gains[base] * q0);
    v1 = sineOp(p1, gains[base + 1] * q1);
    v2 = sineOp(p2, gains[base + 2] * q2);
    v3 = sineOp(p3, gains[base + 3] * q3);
    const sample = (v0 + v1 + v2 + v3) * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

const SINE_FRAMES: readonly FrameKernel[] = [sineFrame0, sineFrame1, sineFrame2, sineFrame3, sineFrame4, sineFrame5, sineFrame6, sineFrame7];

/* Voices mixing sine with other periodic waveforms (no noise) and static operator
 * levels. Each mirrors the same-numbered sine frame operation for operation; an
 * operator evaluates the local sine or, for other codes, `periodicWaveform` with
 * its unmodulated step as the band-limiting width, exactly as the generic loop.
 * Every operator keeps its own call sites: the optimizing compiler then inlines
 * only the waveform calls a voice actually takes, within its per-function budget,
 * and unary + keeps a never-taken branch's call from boxing the merged value.
 * These are separate functions so all-sine voices keep frames whose machine code
 * never contains a waveform dispatch; identity tests pin both sets to the generic loop.
 * As in the generic loop, a non-sine operator maps a non-finite modulated phase to
 * 0 (`periodicWaveform`'s guard). The end-of-frame check still sees the corrupt
 * modulator, because non-finite gains and phases persist through every substep. */
function waveFrame0(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame, waveforms } = active;
  const c0 = waveforms[0], c1 = waveforms[1], c2 = waveforms[2], c3 = waveforms[3];
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    const x0 = p0 + (previous + older) * feedbackScale, g0 = gains[base] * q0;
    v0 = c0 === 0 ? +sineOp(x0, g0) : g0 === 0 ? 0 : +periodicWaveform(x0 * Math.PI, c0, s0 * TURNS_PER_HALF_TURN) * g0;
    const x1 = p1 + v0 * m, g1 = gains[base + 1] * q1;
    v1 = c1 === 0 ? +sineOp(x1, g1) : g1 === 0 ? 0 : +periodicWaveform(x1 * Math.PI, c1, s1 * TURNS_PER_HALF_TURN) * g1;
    const x2 = p2 + v1 * m, g2 = gains[base + 2] * q2;
    v2 = c2 === 0 ? +sineOp(x2, g2) : g2 === 0 ? 0 : +periodicWaveform(x2 * Math.PI, c2, s2 * TURNS_PER_HALF_TURN) * g2;
    const x3 = p3 + v2 * m, g3 = gains[base + 3] * q3;
    v3 = c3 === 0 ? +sineOp(x3, g3) : g3 === 0 ? 0 : +periodicWaveform(x3 * Math.PI, c3, s3 * TURNS_PER_HALF_TURN) * g3;
    const sample = v3 * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function waveFrame1(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame, waveforms } = active;
  const c0 = waveforms[0], c1 = waveforms[1], c2 = waveforms[2], c3 = waveforms[3];
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    const x0 = p0 + (previous + older) * feedbackScale, g0 = gains[base] * q0;
    v0 = c0 === 0 ? +sineOp(x0, g0) : g0 === 0 ? 0 : +periodicWaveform(x0 * Math.PI, c0, s0 * TURNS_PER_HALF_TURN) * g0;
    const x1 = p1, g1 = gains[base + 1] * q1;
    v1 = c1 === 0 ? +sineOp(x1, g1) : g1 === 0 ? 0 : +periodicWaveform(x1 * Math.PI, c1, s1 * TURNS_PER_HALF_TURN) * g1;
    const x2 = p2 + (v0 * m + v1 * m), g2 = gains[base + 2] * q2;
    v2 = c2 === 0 ? +sineOp(x2, g2) : g2 === 0 ? 0 : +periodicWaveform(x2 * Math.PI, c2, s2 * TURNS_PER_HALF_TURN) * g2;
    const x3 = p3 + v2 * m, g3 = gains[base + 3] * q3;
    v3 = c3 === 0 ? +sineOp(x3, g3) : g3 === 0 ? 0 : +periodicWaveform(x3 * Math.PI, c3, s3 * TURNS_PER_HALF_TURN) * g3;
    const sample = v3 * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function waveFrame2(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame, waveforms } = active;
  const c0 = waveforms[0], c1 = waveforms[1], c2 = waveforms[2], c3 = waveforms[3];
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    const x0 = p0 + (previous + older) * feedbackScale, g0 = gains[base] * q0;
    v0 = c0 === 0 ? +sineOp(x0, g0) : g0 === 0 ? 0 : +periodicWaveform(x0 * Math.PI, c0, s0 * TURNS_PER_HALF_TURN) * g0;
    const x1 = p1, g1 = gains[base + 1] * q1;
    v1 = c1 === 0 ? +sineOp(x1, g1) : g1 === 0 ? 0 : +periodicWaveform(x1 * Math.PI, c1, s1 * TURNS_PER_HALF_TURN) * g1;
    const x2 = p2 + v1 * m, g2 = gains[base + 2] * q2;
    v2 = c2 === 0 ? +sineOp(x2, g2) : g2 === 0 ? 0 : +periodicWaveform(x2 * Math.PI, c2, s2 * TURNS_PER_HALF_TURN) * g2;
    const x3 = p3 + (v0 * m + v2 * m), g3 = gains[base + 3] * q3;
    v3 = c3 === 0 ? +sineOp(x3, g3) : g3 === 0 ? 0 : +periodicWaveform(x3 * Math.PI, c3, s3 * TURNS_PER_HALF_TURN) * g3;
    const sample = v3 * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function waveFrame3(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame, waveforms } = active;
  const c0 = waveforms[0], c1 = waveforms[1], c2 = waveforms[2], c3 = waveforms[3];
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    const x0 = p0 + (previous + older) * feedbackScale, g0 = gains[base] * q0;
    v0 = c0 === 0 ? +sineOp(x0, g0) : g0 === 0 ? 0 : +periodicWaveform(x0 * Math.PI, c0, s0 * TURNS_PER_HALF_TURN) * g0;
    const x1 = p1 + v0 * m, g1 = gains[base + 1] * q1;
    v1 = c1 === 0 ? +sineOp(x1, g1) : g1 === 0 ? 0 : +periodicWaveform(x1 * Math.PI, c1, s1 * TURNS_PER_HALF_TURN) * g1;
    const x2 = p2, g2 = gains[base + 2] * q2;
    v2 = c2 === 0 ? +sineOp(x2, g2) : g2 === 0 ? 0 : +periodicWaveform(x2 * Math.PI, c2, s2 * TURNS_PER_HALF_TURN) * g2;
    const x3 = p3 + (v1 * m + v2 * m), g3 = gains[base + 3] * q3;
    v3 = c3 === 0 ? +sineOp(x3, g3) : g3 === 0 ? 0 : +periodicWaveform(x3 * Math.PI, c3, s3 * TURNS_PER_HALF_TURN) * g3;
    const sample = v3 * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function waveFrame4(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame, waveforms } = active;
  const c0 = waveforms[0], c1 = waveforms[1], c2 = waveforms[2], c3 = waveforms[3];
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    const x0 = p0 + (previous + older) * feedbackScale, g0 = gains[base] * q0;
    v0 = c0 === 0 ? +sineOp(x0, g0) : g0 === 0 ? 0 : +periodicWaveform(x0 * Math.PI, c0, s0 * TURNS_PER_HALF_TURN) * g0;
    const x1 = p1 + v0 * m, g1 = gains[base + 1] * q1;
    v1 = c1 === 0 ? +sineOp(x1, g1) : g1 === 0 ? 0 : +periodicWaveform(x1 * Math.PI, c1, s1 * TURNS_PER_HALF_TURN) * g1;
    const x2 = p2, g2 = gains[base + 2] * q2;
    v2 = c2 === 0 ? +sineOp(x2, g2) : g2 === 0 ? 0 : +periodicWaveform(x2 * Math.PI, c2, s2 * TURNS_PER_HALF_TURN) * g2;
    const x3 = p3 + v2 * m, g3 = gains[base + 3] * q3;
    v3 = c3 === 0 ? +sineOp(x3, g3) : g3 === 0 ? 0 : +periodicWaveform(x3 * Math.PI, c3, s3 * TURNS_PER_HALF_TURN) * g3;
    const sample = (v1 + v3) * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function waveFrame5(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame, waveforms } = active;
  const c0 = waveforms[0], c1 = waveforms[1], c2 = waveforms[2], c3 = waveforms[3];
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    const x0 = p0 + (previous + older) * feedbackScale, g0 = gains[base] * q0;
    v0 = c0 === 0 ? +sineOp(x0, g0) : g0 === 0 ? 0 : +periodicWaveform(x0 * Math.PI, c0, s0 * TURNS_PER_HALF_TURN) * g0;
    const modulation = v0 * m;
    const x1 = p1 + modulation, g1 = gains[base + 1] * q1;
    v1 = c1 === 0 ? +sineOp(x1, g1) : g1 === 0 ? 0 : +periodicWaveform(x1 * Math.PI, c1, s1 * TURNS_PER_HALF_TURN) * g1;
    const x2 = p2 + modulation, g2 = gains[base + 2] * q2;
    v2 = c2 === 0 ? +sineOp(x2, g2) : g2 === 0 ? 0 : +periodicWaveform(x2 * Math.PI, c2, s2 * TURNS_PER_HALF_TURN) * g2;
    const x3 = p3 + modulation, g3 = gains[base + 3] * q3;
    v3 = c3 === 0 ? +sineOp(x3, g3) : g3 === 0 ? 0 : +periodicWaveform(x3 * Math.PI, c3, s3 * TURNS_PER_HALF_TURN) * g3;
    const sample = (v1 + v2 + v3) * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function waveFrame6(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame, waveforms } = active;
  const c0 = waveforms[0], c1 = waveforms[1], c2 = waveforms[2], c3 = waveforms[3];
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const m = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    const x0 = p0 + (previous + older) * feedbackScale, g0 = gains[base] * q0;
    v0 = c0 === 0 ? +sineOp(x0, g0) : g0 === 0 ? 0 : +periodicWaveform(x0 * Math.PI, c0, s0 * TURNS_PER_HALF_TURN) * g0;
    const x1 = p1 + v0 * m, g1 = gains[base + 1] * q1;
    v1 = c1 === 0 ? +sineOp(x1, g1) : g1 === 0 ? 0 : +periodicWaveform(x1 * Math.PI, c1, s1 * TURNS_PER_HALF_TURN) * g1;
    const x2 = p2, g2 = gains[base + 2] * q2;
    v2 = c2 === 0 ? +sineOp(x2, g2) : g2 === 0 ? 0 : +periodicWaveform(x2 * Math.PI, c2, s2 * TURNS_PER_HALF_TURN) * g2;
    const x3 = p3, g3 = gains[base + 3] * q3;
    v3 = c3 === 0 ? +sineOp(x3, g3) : g3 === 0 ? 0 : +periodicWaveform(x3 * Math.PI, c3, s3 * TURNS_PER_HALF_TURN) * g3;
    const sample = (v1 + v2 + v3) * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

function waveFrame7(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean): boolean {
  const { phases, values, gains, steps, sineFrame: frame, waveforms } = active;
  const c0 = waveforms[0], c1 = waveforms[1], c2 = waveforms[2], c3 = waveforms[3];
  const q0 = frame[0], q1 = frame[1], q2 = frame[2], q3 = frame[3];
  const feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  let previous = active.previous, older = active.older, v0 = 0, v1 = 0, v2 = 0, v3 = 0;
  for (let sub = 0, base = 0; sub < out.length; sub++, base += 4) {
    if (dynamicPitch) { stepPitch(active, sub, out.length, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    const x0 = p0 + (previous + older) * feedbackScale, g0 = gains[base] * q0;
    v0 = c0 === 0 ? +sineOp(x0, g0) : g0 === 0 ? 0 : +periodicWaveform(x0 * Math.PI, c0, s0 * TURNS_PER_HALF_TURN) * g0;
    const x1 = p1, g1 = gains[base + 1] * q1;
    v1 = c1 === 0 ? +sineOp(x1, g1) : g1 === 0 ? 0 : +periodicWaveform(x1 * Math.PI, c1, s1 * TURNS_PER_HALF_TURN) * g1;
    const x2 = p2, g2 = gains[base + 2] * q2;
    v2 = c2 === 0 ? +sineOp(x2, g2) : g2 === 0 ? 0 : +periodicWaveform(x2 * Math.PI, c2, s2 * TURNS_PER_HALF_TURN) * g2;
    const x3 = p3, g3 = gains[base + 3] * q3;
    v3 = c3 === 0 ? +sineOp(x3, g3) : g3 === 0 ? 0 : +periodicWaveform(x3 * Math.PI, c3, s3 * TURNS_PER_HALF_TURN) * g3;
    const sample = (v0 + v1 + v2 + v3) * carrierGain;
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    older = previous; previous = v0;
    if (!Number.isFinite(sample)) return false;
    out[sub] = sample;
  }
  if (!Number.isFinite(p0 + p1 + p2 + p3 + v0 + v1 + v2 + v3 + older)) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = v0; values[1] = v1; values[2] = v2; values[3] = v3;
  active.previous = previous; active.older = older;
  return true;
}

const WAVE_FRAMES: readonly FrameKernel[] = [waveFrame0, waveFrame1, waveFrame2, waveFrame3, waveFrame4, waveFrame5, waveFrame6, waveFrame7];

/** Every operator gain is zero for the whole frame, so every operator value and
 * the output are exactly +0, as either path would compute. This advances the
 * state they keep (phases with the same sums and wraps, live noise clocks and
 * the feedback history) without evaluating oscillators, and returns false on
 * non-finite phase state. */
function silentFrame(active: ActiveVoice, out: Float64Array, dynamicPitch: boolean, frame: Float64Array): boolean {
  const { phases, steps, values, levels, waveforms, noiseStates, noiseTurns, noiseSteps } = active;
  const oversample = out.length;
  let p0 = phases[0], p1 = phases[1], p2 = phases[2], p3 = phases[3];
  let s0 = steps[0], s1 = steps[1], s2 = steps[2], s3 = steps[3];
  for (let sub = 0; sub < oversample; sub++) {
    if (dynamicPitch) { stepPitch(active, sub, oversample, frame); s0 = steps[0]; s1 = steps[1]; s2 = steps[2]; s3 = steps[3]; }
    p0 += s0; if (p0 >= PHASE_CYCLE) p0 -= PHASE_CYCLE; p1 += s1; if (p1 >= PHASE_CYCLE) p1 -= PHASE_CYCLE;
    p2 += s2; if (p2 >= PHASE_CYCLE) p2 -= PHASE_CYCLE; p3 += s3; if (p3 >= PHASE_CYCLE) p3 -= PHASE_CYCLE;
    out[sub] = 0;
  }
  // Noise keeps its own clock while silent; a zero static level never sounds.
  for (let op = 0; op < 4; op++) {
    if (waveforms[op] !== 8 || levels[op] === 0) continue;
    for (let sub = 0; sub < oversample; sub++) {
      const turns = noiseTurns[op] + noiseSteps[op];
      const ticks = Math.floor(turns);
      for (let tick = 0; tick < ticks; tick++) noiseStates[op] = advanceNoise(noiseStates[op]);
      noiseTurns[op] = turns - ticks;
    }
  }
  // Folded amplitudes multiply a zero gain here; keep their non-finite state counted.
  if (!Number.isFinite(p0 + p1 + p2 + p3 + frame[0] + frame[1] + frame[2] + frame[3])) return false;
  phases[0] = p0; phases[1] = p1; phases[2] = p2; phases[3] = p3;
  values[0] = values[1] = values[2] = values[3] = 0;
  // Two or more zero substeps leave both feedback taps at zero.
  active.previous = active.older = 0;
  return true;
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
  const layerGain = rampAt(active.scalarFrom[4], active.scalarTargets[4], active.scalarStarts[4], active.scalarFrames[4], active.elapsed);
  return gain * active.carrierGain * active.velocity * expression * layerGain;
}

/** True when the buffered history is (now) exactly zero. With nothing left
 *  sounding, sub-floor residue is cleared; a live silent voice instead flushes
 *  the finite FIR to exact zeros so its envelope tail stays intact. */
function settleDecimator(state: Float64Array, clear: boolean): boolean {
  const peak = decimatorPeak(state);
  if (peak !== 0 && (!clear || peak >= AMPLITUDE_FLOOR)) return false;
  if (peak !== 0) state.fill(0);
  return true;
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
  /** @internal Oversampled stereo mix for the current output frame. */
  declare mixLeft: Float64Array;
  /** @internal */
  declare mixRight: Float64Array;
  /** @internal One voice's oversampled samples for the current output frame. */
  declare subSamples: Float64Array;
  /** @internal Shared post-mix decimator state, one per output channel. */
  declare filterLeft: Float64Array;
  /** @internal */
  declare filterRight: Float64Array;
  /** @internal True once both decimator states have drained below the floor. */
  declare decimatorIdle: boolean;
  /** @internal filterRight is stale and logically equals filterLeft (dual mono). */
  declare decimatorMirrored: boolean;
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
  /** @internal */
  declare saturation: NonNullable<SynthOptions['saturation']>;
  /** @internal */
  declare dcBlock: boolean;
  /** @internal DC blocker [previous input, previous output] per channel. */
  declare dcState: Float64Array;
  /** @internal */
  declare dcPole: number;
  /** @internal */
  declare dcGain: number;

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
    this.saturation = settings.saturation ?? 'tanh';
    this.dcBlock = settings.dcBlock ?? false;
    this.dcState = new Float64Array(4);
    this.dcPole = Math.exp(-TAU * DC_BLOCK_HZ / sampleRate);
    this.dcGain = (1 + this.dcPole) / 2;
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
    this.mixLeft = new Float64Array(this.oversample);
    this.mixRight = new Float64Array(this.oversample);
    this.subSamples = new Float64Array(this.oversample);
    this.filterLeft = new Float64Array(DECIMATOR_STATE_SIZE);
    this.filterRight = new Float64Array(DECIMATOR_STATE_SIZE);
    this.decimatorIdle = true;
    this.decimatorMirrored = true;
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
    active.pitchSettled = false;
    const rate = this.sampleRate * this.oversample;
    const factor = 2 ** (pitchAt(active, active.elapsed) / 12);
    for (let op = 0; op < 4; op++) {
      const source = active.voice.ops[op];
      const ratio = rampAt(active.ratioFrom[op], active.ratioTargets[op], active.ratioStart, active.ratioFrames, active.elapsed);
      const target = active.frequencyTargets[op] || frequency * ratio;
      const hz = rampAt(active.frequencyFrom[op], target, active.frequencyStart, active.frequencyFrames, active.elapsed);
      active.baseIncrements[op] = PHASE_CYCLE * hz * 2 ** (source.detune / 1200) / rate;
      active.increments[op] = Math.min(MAX_STEP, active.baseIncrements[op] * factor);
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
    // Resolved before a slot is taken, so a throw cannot leak the spare.
    const lfoCode = lfoWaveformCode(voice.lfo.waveform);
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
      active.waveforms[i] = waveformCode(op.waveform);
      active.noiseSteps[i] = (op.noiseRate ?? 8000) / rate;
      const operatorFrequency = (op.frequency ?? frequency * op.ratio) * 2 ** (op.detune / 1200);
      active.frequencyScales[i] = PHASE_CYCLE * 2 ** (op.detune / 1200) / rate;
      baseIncrements[i] = PHASE_CYCLE * operatorFrequency / rate;
      // Retain the original pre-PM cap, but keep unclipped pitch bases so a
      // downward bend can bring high-ratio operators back into audible range.
      increments[i] = PHASE_CYCLE * Math.min(rate * 0.45, operatorFrequency) / rate;
      sustainDb[i] = op.adsr.s === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(op.adsr.s));
      sustainGain[i] = sustainDb[i] <= FLOOR_DB ? 0 : 10 ** (sustainDb[i] / 20);
      steps[i] = Math.min(MAX_STEP, increments[i]);
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
    active.pitchEnvelope = voice.pitchEnvelope;
    active.graph = ALGORITHMS[voice.algorithm];
    const { waveforms } = active;
    active.frameKernel = waveforms[0] === 0 && waveforms[1] === 0 && waveforms[2] === 0 && waveforms[3] === 0 ? SINE_FRAMES[voice.algorithm] :
      waveforms[0] !== 8 && waveforms[1] !== 8 && waveforms[2] !== 8 && waveforms[3] !== 8 ? WAVE_FRAMES[voice.algorithm] : null;
    // Cache the fixed topology in pooled typed storage; frozen graph-array
    // indexing otherwise repeats for every operator at every oversampled frame.
    for (let op = 0; op < 4; op++) {
      active.inputIndices[op * 2] = active.graph.inputs[op][0] ?? -1;
      active.inputIndices[op * 2 + 1] = active.graph.inputs[op][1] ?? -1;
    }
    active.carrierIndices.set(active.graph.carriers);
    active.velocity = velocity;
    active.expression = 1;
    active.pan = pan;
    active.expressionFrom = active.expressionTarget = 1;
    active.expressionStart = active.expressionFrames = 0;
    active.panFrom = active.panTarget = pan;
    active.panStart = active.panFrames = 0;
    active.modulation = active.modulationFrom = active.modulationTarget = 1;
    active.modulationStart = active.modulationFrames = active.controlRamps = 0;
    active.modIndex = voice.modIndex * HALF_TURNS_PER_RADIAN;
    active.amDepth = voice.lfo.amDepth;
    active.pmDepth = voice.lfo.pmDepth;
    // Snapshot the LFO shape into fixed numeric slots: voice LFO objects differ in
    // optional fields, and per-frame reads through them go polymorphic.
    const lfo = voice.lfo;
    active.lfoDelay = lfo.delay ?? 0;
    active.lfoRate = lfo.rate;
    active.lfoPhase = lfo.phase ?? 0;
    active.lfoGlobal = lfo.sync === 'global';
    active.lfoCode = lfoCode;
    active.amTargeted = lfo.amTargets !== undefined;
    active.pmTargeted = lfo.pmTargets !== undefined;
    for (let i = 0; i < 4; i++) {
      active.amTargets[i] = lfo.amTargets?.[i] ?? 1;
      active.pmTargets[i] = lfo.pmTargets?.[i] ?? 1;
    }
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
    active.scalarValues[4] = 1;
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
    active.silentGains = false;
    updatePan(active);
    active.lastSample = active.fadeRemaining = 0;
    active.lastFadeGain = 1;
    active.carrierGain = HEADROOM / active.graph.carriers.length;
    active.phases.fill(0);
    active.noiseStates.fill(NOISE_SEED);
    active.noiseTurns.fill(0);
    active.values.fill(0);
    active.releaseDb.fill(0);
    active.releaseStep.fill(0);
    active.envelopeSegment.fill(0);
    active.envelopeUntil.fill(0);
    active.envelopeFastUntil = 0;
    active.gains.fill(0);
    active.gainsSteady = false;
    active.pitchSettled = false;
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
    for (let op = 0; op < 4; op++) {
      active.releaseDb[op] = envelopeDbAt(active, time, op);
      active.releaseStarts[op] = time;
      const release = active.releaseTimes[op];
      active.releaseStep[op] = release === 0 ? 0 :
        10 ** ((FLOOR_DB - active.releaseDb[op]) / (20 * release * this.sampleRate * this.oversample));
    }
    active.releaseTime = time;
    active.envelopeUntil.fill(0);
    active.envelopeFastUntil = 0;
    active.gainsSteady = false;
    active.pitchSettled = false;
    active.releaseEnd = carrierReleaseEnd(active, time);
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
    this.resetDecimator();
    this.dcState.fill(0);
    (this as MutableCounters).lastStolenId = null;
    this.cancelVoices();
  }

  /** @internal Drop the shared decimator tail, as panic dropped per-voice filters. */
  resetDecimator(): void {
    this.filterLeft.fill(0);
    this.filterRight.fill(0);
    this.decimatorIdle = true;
    this.decimatorMirrored = true;
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
      const clock = active.lfoGlobal ? this.currentFrame : active.elapsed;
      active.lfoTurns = clock / this.sampleRate * active.scalarValues[1] + active.lfoPhase;
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
        if (field === 2 || field === 3) updateModulation(active);
      }
      active.controlRamps |= ENGINE_RAMP;
    }
    if (active.controlRamps & ENGINE_RAMP) advanceControls(active);
    if (controls.operatorRatios !== undefined || controls.operatorFrequencies !== undefined) {
      // Sample ongoing pitch-independent Hz before changing either timeline.
      for (let op = 0; op < 4; op++) active.frequencies[op] = rampedFrequency(active, op, active.elapsed);
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
        active.envelopeUntil[op] = 0;
        active.envelopeFastUntil = 0;
        active.gainsSteady = false;
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
      if (active.releaseTime >= 0) active.releaseEnd = carrierReleaseEnd(active, time);
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
      active.pitchSettled = false;
      const factor = 2 ** (pitchAt(active, active.elapsed) / 12);
      for (let op = 0; op < 4; op++) {
        active.increments[op] = Math.min(MAX_STEP, active.baseIncrements[op] * factor);
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
  // Oversampled samples are panned into mixLeft/mixRight; the shared post-mix
  // decimator then runs once per channel instead of once per voice. Stores the
  // last undecimated sample (for steal spill) in `lastSample` and returns false
  // on corrupt state. A boolean result avoids boxing a double on every call.
  /** @internal */
  renderVoice(active: ActiveVoice, fading = false): boolean {
    const { graph, inputIndices, carrierIndices, phases, values, increments, steps, gains, levels } = active;
    if (active.controlRamps !== 0) advanceControls(active);
    const voiceGain = active.scalarValues[4] * (fading ? active.fadeRemaining / this.fadeFrames : 1);
    const panLeft = active.leftGain * voiceGain, panRight = active.rightGain * voiceGain;
    const mixLeft = this.mixLeft, mixRight = this.mixRight;
    const time = active.elapsed / this.sampleRate;
    const finished = active.releaseTime >= 0 && time >= active.releaseEnd;
    const lfoDelay = active.lfoDelay;
    const lfoEnabled = time >= lfoDelay;
    // Depth fades in linearly over LFO_DELAY_FADE after a nonzero delay, so the
    // gate opens without an instantaneous gain or pitch step.
    const fade = lfoDelay > 0 && time < lfoDelay + LFO_DELAY_FADE ? (time - lfoDelay) / LFO_DELAY_FADE : 1;
    const amDepth = active.amDepth * fade, pmDepth = active.pmDepth * fade;
    let tremolo = 0;
    if (lfoEnabled && (active.amDepth !== 0 || active.pmDepth !== 0)) {
      const clock = active.lfoGlobal ? this.currentFrame : active.elapsed;
      const turns = active.lfoLive ? active.lfoTurns : clock / this.sampleRate * active.lfoRate + active.lfoPhase;
      tremolo = lfoAt(turns - Math.floor(turns), active.lfoCode);
    }
    const amGain = !lfoEnabled || active.amDepth === 0 ? 1 : 1 - amDepth * (0.5 + 0.5 * tremolo);
    const pmFactor = !lfoEnabled || active.pmDepth === 0 ? 1 : fastExp2(pmDepth * tremolo / 1200);
    const targeted = active.amTargeted, pmTargeted = active.pmTargeted;
    if (targeted || pmTargeted) {
      const amTargets = active.amTargets, pmTargets = active.pmTargets;
      for (let op = 0; op < 4; op++) {
        const am = amTargets[op], pm = pmTargets[op];
        active.amGains[op] = am === 1 ? amGain : !lfoEnabled ? 1 : 1 - amDepth * am * (0.5 + 0.5 * tremolo);
        active.pmFactors[op] = pm === 1 ? pmFactor : !lfoEnabled ? 1 : fastExp2(pmDepth * pm * tremolo / 1200);
      }
    }
    const gliding = active.pitchFrames !== 0;
    const frequencyRamping = active.ratioFrames !== 0 || active.frequencyFrames !== 0;
    const envelope = active.pitchEnvelope;
    if (envelope !== undefined && !active.pitchSettled && !gliding && !frequencyRamping &&
        (active.releaseTime >= 0 ? envelope.r === 0 || time >= active.releaseTime + envelope.r : time >= envelope.a + envelope.d)) {
      // The envelope holds sustain or final for every later frame until release,
      // a glide or a retune: fold its constant cents into the static increments,
      // using the same factor and caps as the per-frame path.
      const factor = fastExp2(pitchAt(active, active.elapsed) / 12 + pitchEnvelopeAt(active, time) / 1200);
      for (let op = 0; op < 4; op++) {
        increments[op] = Math.min(MAX_STEP, active.baseIncrements[op] * factor);
        steps[op] = increments[op];
      }
      active.pitchSettled = true;
    }
    const dynamicPitch = gliding || frequencyRamping || (envelope !== undefined && !active.pitchSettled);
    if (!dynamicPitch && active.pmDepth !== 0) {
      // Unrolled with the target choice hoisted: this runs every frame of every vibrato voice.
      const pmFactors = active.pmFactors;
      const f0 = pmTargeted ? pmFactors[0] : pmFactor, f1 = pmTargeted ? pmFactors[1] : pmFactor;
      const f2 = pmTargeted ? pmFactors[2] : pmFactor, f3 = pmTargeted ? pmFactors[3] : pmFactor;
      steps[0] = Math.min(MAX_STEP, increments[0] * f0); steps[1] = Math.min(MAX_STEP, increments[1] * f1);
      steps[2] = Math.min(MAX_STEP, increments[2] * f2); steps[3] = Math.min(MAX_STEP, increments[3] * f3);
    }
    const operatorRamping = (active.controlRamps & OPERATOR_RAMP) !== 0;
    if (!finished && !active.gainsSteady) active.gainsSteady = prepareGains(active, this.subTimes, this.sampleRate);
    const oversample = this.oversample, frame = active.sineFrame, waveforms = active.waveforms;
    const operatorLevels = active.operatorLevels, amGains = active.amGains;
    // The pitch exponent e = glide/12 + envelope/1200 is piecewise linear in time, so
    // 2^e(n + s/O) = 2^e(n) * r^s with r = 2^((e(n+1) - e(n)) / O): two pows per
    // output frame instead of O. Ramped Hz is piecewise linear, or quadratic while a
    // Hz ramp chases a ratio ramp, so the parabola through x = 0, 1/2, 1 gives
    // hz(n + x) = h0 + x * (b + c * x) with c = 2 * (h1 - 2 * hm + h0), b = h1 - h0 - c.
    // Both are exact to rounding except in a frame holding a segment corner, which
    // is smoothed over that single frame. stepPitch applies them per substep.
    const incrementDeltas = active.incrementDeltas, incrementCurves = active.incrementCurves;
    if (dynamicPitch) {
      const next = active.elapsed + 1;
      preparePitch(active, frame, this.sampleRate, oversample);
      if (frequencyRamping) {
        for (let op = 0; op < 4; op++) {
          const scale = active.frequencyScales[op];
          const from = rampedFrequency(active, op, active.elapsed) * scale;
          const middle = rampedFrequency(active, op, active.elapsed + 0.5) * scale;
          const to = rampedFrequency(active, op, next) * scale;
          const curve = 2 * (to - 2 * middle + from);
          active.baseIncrements[op] = from;
          incrementDeltas[op] = to - from - curve;
          incrementCurves[op] = curve;
        }
      }
    }
    frame[4] = pmFactor;
    // Fold static level, operator level and shared or per-operator AM once per frame.
    if (!operatorRamping) {
      const a0 = targeted ? amGains[0] : amGain, a1 = targeted ? amGains[1] : amGain;
      const a2 = targeted ? amGains[2] : amGain, a3 = targeted ? amGains[3] : amGain;
      frame[0] = levels[0] * operatorLevels[0] * a0; frame[1] = levels[1] * operatorLevels[1] * a1;
      frame[2] = levels[2] * operatorLevels[2] * a2; frame[3] = levels[3] * operatorLevels[3] * a3;
    }
    let output = 0;
    if (finished) {
      if (dynamicPitch) for (let sub = 0; sub < oversample; sub++) stepPitch(active, sub, oversample, frame);
    } else {
      const subSamples = this.subSamples;
      if (active.silentGains) {
        if (!silentFrame(active, subSamples, dynamicPitch, frame)) return false;
      } else if (active.frameKernel !== null && !operatorRamping) {
        // Noise-free voices with static operator levels take the per-algorithm frames.
        if (!active.frameKernel(active, subSamples, dynamicPitch)) return false;
      } else {
        const modIndex = active.modIndex, feedbackScale = active.feedbackScale, carrierGain = active.carrierGain;
        const carrierCount = graph.carriers.length;
        let previous = active.previous, older = active.older;
        for (let sub = 0; sub < oversample; sub++) {
          const position = active.elapsed + sub / oversample;
          if (dynamicPitch) stepPitch(active, sub, oversample, frame);
          for (let op = 0; op < 4; op++) {
            if (levels[op] === 0) {
              // A zero static level never sounds (live levels only multiply it): skip
              // its oscillator and noise clock, but keep advancing and checking its phase.
              values[op] = 0;
              const phase = phases[op] + steps[op];
              const wrapped = phase < PHASE_CYCLE ? phase : phase - PHASE_CYCLE;
              phases[op] = wrapped;
              if (!Number.isFinite(wrapped)) return false;
              continue;
            }
            let modulation = op === 0 ? (previous + older) * feedbackScale : 0;
            const first = inputIndices[op * 2], second = inputIndices[op * 2 + 1];
            if (first >= 0) modulation += values[first] * modIndex;
            if (second >= 0) modulation += values[second] * modIndex;
            const factor = !operatorRamping ? frame[op] : levels[op] *
              rampAt(active.operatorFrom[op], active.operatorTargets[op], active.operatorStart, active.operatorFrames, position) *
              (targeted ? amGains[op] : amGain);
            const amplitude = gains[op + sub * 4] * factor;
            const code = waveforms[op];
            // Each branch multiplies its own oscillator: merging a sinPi result with
            // the boxed result of the non-inlined periodicWaveform would box both.
            let value = 0;
            if (code === 8) {
              // Noise keeps its own clock even while silent.
              const oscillator = (active.noiseStates[op] & 1) === 0 ? -1 : 1;
              const turns = active.noiseTurns[op] + active.noiseSteps[op];
              // At the minimum clock a 20 kHz hold rate needs at most two ticks.
              const ticks = Math.floor(turns);
              for (let tick = 0; tick < ticks; tick++) active.noiseStates[op] = advanceNoise(active.noiseStates[op]);
              active.noiseTurns[op] = turns - ticks;
              if (amplitude !== 0) value = oscillator * amplitude;
            } else if (amplitude !== 0) {
              const theta = phases[op] + modulation;
              value = code === 0 ? sinPi(theta) * amplitude :
                periodicWaveform(theta * Math.PI, code, steps[op] * TURNS_PER_HALF_TURN) * amplitude;
            }
            values[op] = value;
            const phase = phases[op] + steps[op];
            const wrapped = phase < PHASE_CYCLE ? phase : phase - PHASE_CYCLE;
            phases[op] = wrapped;
            if (!Number.isFinite(value) || !Number.isFinite(wrapped)) return false;
          }
          older = previous;
          previous = values[0];
          let sample = 0;
          for (let j = 0; j < carrierCount; j++) sample += values[carrierIndices[j]];
          sample *= carrierGain;
          // Non-finite operator state always reaches a carrier through modulation or the mix.
          if (!Number.isFinite(sample)) return false;
          subSamples[sub] = sample;
        }
        active.previous = previous;
        active.older = older;
      }
      for (let sub = 0; sub < oversample; sub++) {
        mixLeft[sub] += subSamples[sub] * panLeft;
        mixRight[sub] += subSamples[sub] * panRight;
      }
      output = subSamples[oversample - 1];
    }
    if (active.lfoLive) {
      active.lfoTurns += active.scalarValues[1] / this.sampleRate;
      active.lfoTurns -= Math.floor(active.lfoTurns);
    }
    if (frequencyRamping) {
      const x = (oversample - 1) / oversample;
      for (let op = 0; op < 4; op++) active.baseIncrements[op] += x * (incrementDeltas[op] + x * incrementCurves[op]);
    }
    active.elapsed++;
    if (gliding && active.elapsed >= active.pitchStart + active.pitchFrames) {
      active.pitchFrames = 0;
      const factor = 2 ** (active.pitchTarget / 12);
      for (let op = 0; op < 4; op++) {
        increments[op] = Math.min(MAX_STEP, active.baseIncrements[op] * factor);
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
    active.lastSample = output * active.scalarValues[4];
    return Number.isFinite(active.lastSample);
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
    const dcState = this.dcState;
    if (this.voices.length === 0 && this.fades.length === 0 && this.spillRemaining === 0 && this.decimatorIdle &&
        dcState[0] === 0 && dcState[1] === 0 && dcState[2] === 0 && dcState[3] === 0) {
      typedArrayFill.call(left, 0, offset, offset + length);
      if (right !== left) typedArrayFill.call(right, 0, offset, offset + length);
      (this as MutableCounters).currentFrame += length;
      return;
    }
    this.rendering = true;
    const oversample = this.oversample, coefficients = this.decimatorCoefficients;
    const mixLeft = this.mixLeft, mixRight = this.mixRight, filterLeft = this.filterLeft, filterRight = this.filterRight;
    const softKneeMode = this.saturation === 'soft-knee', dcBlock = this.dcBlock, dcGain = this.dcGain, dcPole = this.dcPole;
    try {
      for (let frame = offset, end = offset + length; frame < end; frame++) {
        let terminalCount = 0;
        // A plain loop: a builtin fill call per output frame costs more than four stores.
        for (let sub = 0; sub < oversample; sub++) mixLeft[sub] = mixRight[sub] = 0;
        for (let index = 0; index < this.voices.length; index++) {
          const active = this.voices[index];
          if (!this.renderVoice(active)) {
            (this as MutableCounters).errorCount++;
            this.terminalIds[terminalCount] = active.id;
            this.terminalErrors[terminalCount++] = 1;
            this.freeVoices.push(removeAt(this.voices, index--));
            continue;
          }
          // Envelope-based retirement: once every operator release has ended the
          // voice contributes silence; the shared decimator drains its tail.
          if (active.releaseTime >= 0 && (active.elapsed - 1) / this.sampleRate >= active.releaseEnd) {
            this.terminalIds[terminalCount] = active.id;
            this.terminalErrors[terminalCount++] = 0;
            this.freeVoices.push(removeAt(this.voices, index--));
          }
        }
        for (let index = 0; index < this.fades.length; index++) {
          const active = this.fades[index];
          const gain = active.fadeRemaining / this.fadeFrames;
          if (!this.renderVoice(active, true)) {
            (this as MutableCounters).errorCount++;
            this.freeVoices.push(removeAt(this.fades, index--));
            continue;
          }
          active.lastFadeGain = gain;
          if (--active.fadeRemaining === 0) this.freeVoices.push(removeAt(this.fades, index--));
        }
        if (this.spillRemaining > 0) {
          for (let sub = 0; sub < oversample; sub++) {
            mixLeft[sub] += this.spillLeft;
            mixRight[sub] += this.spillRight;
          }
          const next = --this.spillRemaining;
          this.spillLeft *= next / (next + 1);
          this.spillRight *= next / (next + 1);
        }
        let silentLeft = true, silentRight = true, differ = false;
        for (let sub = 0; sub < oversample; sub++) {
          const inputLeft = mixLeft[sub], inputRight = mixRight[sub];
          if (inputLeft !== 0) silentLeft = false;
          if (inputRight !== 0) silentRight = false;
          if (inputLeft !== inputRight) differ = true;
        }
        // Identical channel histories give identical outputs: centered mixes
        // filter once until the inputs first differ.
        let mirrored = this.decimatorMirrored;
        if (mirrored && differ) {
          filterRight.set(filterLeft);
          mirrored = false;
        }
        decimateFrame(mixLeft, filterLeft, coefficients);
        if (!mirrored) decimateFrame(mixRight, filterRight, coefficients);
        let mixedLeft = filterLeft[DECIMATOR_OUTPUT];
        let mixedRight = mirrored ? mixedLeft : filterRight[DECIMATOR_OUTPUT];
        this.decimatorMirrored = mirrored;
        if (dcBlock) {
          // Non-finite sums bypass the filter and keep its state; they still output 0 below.
          if (Number.isFinite(mixedLeft)) {
            dcBlockStep(dcState, 0, mixedLeft, dcGain, dcPole);
            mixedLeft = dcState[1];
          }
          if (Number.isFinite(mixedRight)) {
            dcBlockStep(dcState, 2, mixedRight, dcGain, dcPole);
            mixedRight = dcState[3];
          }
        }
        // Saturate each stereo sum independently, preserving center dual mono;
        // an equal (centered) mix reuses the left result.
        left[frame] = !Number.isFinite(mixedLeft) ? 0 : softKneeMode ? softKnee(mixedLeft * this.mixGain) :
          HEADROOM * Math.tanh(mixedLeft * this.mixGain / HEADROOM);
        right[frame] = mixedRight === mixedLeft ? left[frame] : !Number.isFinite(mixedRight) ? 0 :
          softKneeMode ? softKnee(mixedRight * this.mixGain) : HEADROOM * Math.tanh(mixedRight * this.mixGain / HEADROOM);
        if (!Number.isFinite(mixedLeft) || !Number.isFinite(mixedRight)) {
          (this as MutableCounters).errorCount++;
          this.resetDecimator();
          this.dcState.fill(0);
        } else {
          // A silent channel goes idle once its FIR history is zero. After the
          // last source retires, history below the -96 dB floor snaps to zero.
          const clear = this.voices.length === 0 && this.fades.length === 0 && this.spillRemaining === 0;
          const idleLeft = silentLeft && settleDecimator(filterLeft, clear);
          const idleRight = mirrored ? idleLeft : silentRight && settleDecimator(filterRight, clear);
          this.decimatorIdle = idleLeft && idleRight;
          if (this.decimatorIdle) this.decimatorMirrored = true;
        }
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
