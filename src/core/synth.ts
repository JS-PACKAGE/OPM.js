import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
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
export interface NoteOptions { velocity?: number; pan?: number }
export interface NoteControls { pitch?: number; glide?: number; expression?: number; pan?: number; modulation?: number; ramp?: number; operatorLevels?: readonly [number, number, number, number] }
export interface SynthOptions {
  mixGain?: number;
  tuning?: TuningOptions;
  stealing?: 'oldest' | 'release-first' | 'quietest';
  quality?: QualityProfile;
}

const CONTROL_LIMITS = Object.freeze({
  pitch: [-48, 48], glide: [0, 10], expression: [0, 1], pan: [-1, 1], modulation: [0, 2], ramp: [0, 10],
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
    if (typeof key !== 'string' || key !== 'operatorLevels' && !Object.hasOwn(CONTROL_LIMITS, key)) throw new TypeError('controls has an unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`controls.${key} must be data`);
    const value: unknown = descriptor.value;
    if (key === 'operatorLevels') {
      if (!Array.isArray(value) || value.length !== 4 || Reflect.ownKeys(value).length !== 5) {
        throw new TypeError('operatorLevels must be a dense four-number tuple');
      }
      const levels: number[] = [];
      for (let op = 0; op < 4; op++) {
        const element = Object.getOwnPropertyDescriptor(value, String(op));
        if (!element || !Object.hasOwn(element, 'value')) throw new TypeError('operatorLevels must contain data');
        const level: unknown = element.value;
        if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 2) {
          throw new RangeError('operatorLevels must be finite and in 0..2');
        }
        levels.push(level);
      }
      result.operatorLevels = Object.freeze(levels) as NoteControls['operatorLevels'];
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
  if (Object.hasOwn(result, 'ramp') && !Object.hasOwn(result, 'expression') &&
      !Object.hasOwn(result, 'pan') && !Object.hasOwn(result, 'modulation') && !Object.hasOwn(result, 'operatorLevels')) {
    throw new TypeError('ramp requires expression, pan, modulation or operatorLevels');
  }
  return Object.freeze(result);
}

interface ActiveVoice {
  id: number; sequence: number; note: number; voice: PreparedVoice; graph: AlgorithmGraph;
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
const MAX_VOICES = 8;
const AMPLITUDE_FLOOR = 10 ** (FLOOR_DB / 20);
const DB_TO_LOG_GAIN = Math.LN10 / 20;
const DEFAULT_NOTE_OPTIONS: NoteOptions = Object.freeze({ velocity: 1, pan: 0 });
const DEFAULT_TUNING = normalizeTuning({});
const EXPRESSION_RAMP = 1;
const PAN_RAMP = 2;
const MODULATION_RAMP = 4;
const OPERATOR_RAMP = 8;

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
    id: 0, sequence: 0, note: 0, voice: null!, graph: ALGORITHMS[0],
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
  active.amDepth = Math.min(1, active.voice.lfo.amDepth * active.modulation);
  active.pmDepth = Math.min(1200, active.voice.lfo.pmDepth * active.modulation);
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

function gainAt(active: ActiveVoice, time: number, op: number): number {
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

  constructor(sampleRate: number, maxVoices = MAX_VOICES, options: SynthOptions = {}) {
    if (typeof sampleRate !== 'number' || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
      throw new RangeError('sampleRate must be finite and in 8000..192000');
    }
    if (!Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > MAX_VOICES) {
      throw new RangeError('maxVoices must be an integer in 1..8');
    }
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
    this.freeVoices = Array.from({ length: maxVoices + MAX_VOICES + 1 }, () => createVoiceSlot(this.oversample));
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
    const rate = this.sampleRate * this.oversample;
    const factor = 2 ** (pitchAt(active, active.elapsed) / 12);
    for (let op = 0; op < 4; op++) {
      const source = active.voice.ops[op];
      active.baseIncrements[op] = TAU * (source.frequency ?? frequency * source.ratio) * 2 ** (source.detune / 1200) / rate;
      active.increments[op] = Math.min(TAU * 0.45, active.baseIncrements[op] * factor);
      active.steps[op] = active.increments[op];
    }
  }

  /** @internal */
  stealingIndex(): number {
    let chosen = 0;
    let quietest = this.stealing === 'quietest' ? voiceAudibility(this.voices[0], this.sampleRate) : 0;
    for (let index = 1; index < this.voices.length; index++) {
      const candidate = this.voices[index], current = this.voices[chosen];
      let preferred = candidate.sequence < current.sequence;
      if (this.stealing === 'release-first') {
        const released = candidate.releaseTime >= 0, currentReleased = current.releaseTime >= 0;
        if (released !== currentReleased) preferred = released;
      } else if (this.stealing === 'quietest') {
        const audibility = voiceAudibility(candidate, this.sampleRate);
        if (audibility !== quietest) preferred = audibility < quietest;
        if (preferred) quietest = audibility;
      }
      if (preferred) chosen = index;
    }
    return chosen;
  }


  noteOn(input: VoiceInput | PreparedVoice, note: number, id?: number, { velocity = 1, pan = 0 }: NoteOptions = DEFAULT_NOTE_OPTIONS): number {
    const voice = preparedVoiceValue(input);
    if (typeof note !== 'number' || !Number.isFinite(note) || note < 0 || note > 127) {
      throw new RangeError('note must be finite and in 0..127');
    }
    if (typeof velocity !== 'number' || !Number.isFinite(velocity) || velocity < 0 || velocity > 1 ||
        typeof pan !== 'number' || !Number.isFinite(pan) || pan < -1 || pan > 1) {
      throw new RangeError('velocity must be in 0..1 and pan in -1..1');
    }
    if (id === undefined) {
      if (this.nextId > Number.MAX_SAFE_INTEGER) throw new RangeError('Note ID space exhausted');
      id = this.nextId++;
    } else if (!Number.isSafeInteger(id) || id <= 0) {
      throw new RangeError('id must be a positive safe integer');
    }
    for (const active of this.voices) if (active.id === id) throw new RangeError('id already active');
    if (id >= this.nextId) this.nextId = id + 1;
    // Initialize the spare before changing admission state. No slot can be reused
    // while it is still active or fading, including during terminal callbacks.
    const active = this.freeVoices.pop()!;
    const { baseIncrements, increments, sustainDb, sustainGain, steps, attackStep, decayStep, levels } = active;
    const frequency = tuningFrequency(note, this.tuning);
    const rate = this.sampleRate * this.oversample;
    for (let i = 0; i < 4; i++) {
      const op = voice.ops[i];
      const scale = op.keyScale;
      const attenuation = scale ? Math.abs(note - scale.breakpoint) / 12 *
        (note < scale.breakpoint ? scale.leftDbPerOctave : scale.rightDbPerOctave) : 0;
      levels[i] = op.level * 10 ** (-(attenuation + (op.velocitySensitivity ?? 0) * (1 - velocity)) / 20);
      const operatorFrequency = (op.frequency ?? frequency * op.ratio) * 2 ** (op.detune / 1200);
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
    active.feedbackScale = voice.feedback === 0 ? 0 : 0.5 * 2 ** (voice.feedback - 7) * Math.PI;
    active.releaseTime = active.releaseEnd = -1;
    (this as MutableCounters).lastStolenId = null;
    if (this.voices.length >= this.maxVoices) {
      const stolen = removeAt(this.voices, this.stealingIndex());
      (this as MutableCounters).lastStolenId = stolen.id;
      // Preserve the old DSP state. Exhausted tails collapse into the existing
      // bounded spill ramp, then recycle before callbacks can admit more notes.
      if (this.fades.length === MAX_VOICES) {
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
    active.pitchRelease = pitchEnvelopeAt(active, active.elapsed / this.sampleRate);
    active.releaseTime = active.elapsed / this.sampleRate;
    let maxRelease = 0;
    for (let op = 0; op < 4; op++) maxRelease = Math.max(maxRelease, active.releaseTimes[op]);
    active.releaseEnd = active.releaseTime + maxRelease;
    for (let op = 0; op < 4; op++) {
      active.releaseDb[op] = heldDb(active.releaseTime, active.attackTimes[op], active.decayTimes[op], active.sustainDb[op]);
      const release = active.releaseTimes[op];
      active.releaseStep[op] = release === 0 ? 0 :
        10 ** ((FLOOR_DB - active.releaseDb[op]) / (20 * release * this.sampleRate * this.oversample));
    }
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
    // At most eight stack-local IDs survive recycling. Unlike shared scratch
    // storage, they cannot be overwritten by noteOn/panic inside a callback.
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
      const turns = clock / this.sampleRate * lfo.rate + (lfo.phase ?? 0);
      tremolo = lfoValue((turns - Math.floor(turns)) * TAU, lfo.waveform);
    }
    const amGain = !lfoEnabled || active.amDepth === 0 ? 1 : 1 - active.amDepth * (0.5 + 0.5 * tremolo);
    const pmFactor = !lfoEnabled || active.pmDepth === 0 ? 1 : 2 ** (active.pmDepth * tremolo / 1200);
    const gliding = active.pitchFrames !== 0;
    const dynamicPitch = gliding || active.voice.pitchEnvelope !== undefined;
    if (!dynamicPitch && active.pmDepth !== 0) {
      for (let op = 0; op < 4; op++) steps[op] = Math.min(TAU * 0.45, increments[op] * pmFactor);
    }
    const operatorRamping = (active.controlRamps & OPERATOR_RAMP) !== 0;
    if (!finished) prepareGains(active, time, this.subTimes);
    let output = 0;
    for (let sub = 0; sub < this.oversample; sub++) {
      const frame = active.elapsed + sub / this.oversample;
      if (dynamicPitch) {
        const factor = 2 ** (pitchAt(active, frame) / 12 + pitchEnvelopeAt(active, time + this.subTimes[sub]) / 1200);
        for (let op = 0; op < 4; op++) {
          steps[op] = Math.min(TAU * 0.45, Math.min(TAU * 0.45, active.baseIncrements[op] * factor) * pmFactor);
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
          values[op] = Math.sin(phases[op] + modulation) * gains[op + sub * 4] * levels[op] * operatorLevel * amGain;
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
    active.elapsed++;
    if (gliding && active.elapsed >= active.pitchStart + active.pitchFrames) {
      active.pitchFrames = 0;
      const factor = 2 ** (active.pitchTarget / 12);
      for (let op = 0; op < 4; op++) {
        increments[op] = Math.min(TAU * 0.45, active.baseIncrements[op] * factor);
        steps[op] = increments[op];
      }
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
