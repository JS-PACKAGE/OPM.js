import type { ADSR, FrozenOperator, PreparedVoice, VoiceInput } from '../voices/schema.js';
import type { AlgorithmGraph } from './algorithms.js';

export type VoiceEndReason = 'stolen' | 'ended' | 'error';
export interface NoteOptions { velocity?: number; pan?: number }
export interface NoteControls { pitch?: number; glide?: number; expression?: number; pan?: number; modulation?: number }

const CONTROL_LIMITS = Object.freeze({
  pitch: [-48, 48], glide: [0, 10], expression: [0, 1], pan: [-1, 1], modulation: [0, 2],
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
    if (typeof key !== 'string' || !Object.hasOwn(CONTROL_LIMITS, key)) throw new TypeError('controls has an unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`controls.${key} must be data`);
    const control = key as keyof NoteControls;
    const value: unknown = descriptor.value;
    const [min, max] = CONTROL_LIMITS[control];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`controls.${key} must be finite and in ${min}..${max}`);
    }
    result[control] = value;
  }
  if (Object.hasOwn(result, 'glide') && !Object.hasOwn(result, 'pitch')) throw new TypeError('glide requires pitch');
  return result;
}

interface ActiveVoice {
  id: number; sequence: number; voice: PreparedVoice; graph: AlgorithmGraph;
  baseIncrements: Float64Array; increments: Float64Array; steps: Float64Array; sustainDb: Float64Array; sustainGain: Float64Array;
  attackStep: Float64Array; decayStep: Float64Array; releaseStep: Float64Array; gains: Float64Array;
  levels: Float64Array; leftGain: number; rightGain: number; lastSample: number; fadeRemaining: number;
  lastFadeGain?: number; carrierGain: number; phases: Float64Array; values: Float64Array; filters: Float64Array;
  releaseDb: Float64Array; previous: number; older: number; lfoPhase: number; lfoIncrement: number;
  feedbackScale: number; elapsed: number; releaseTime: number; releaseEnd: number;
  velocity: number; expression: number; pan: number;
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

const OVERSAMPLE = 4;
const HEADROOM = 0.7;
const MAX_VOICES = 8;
const AMPLITUDE_FLOOR = 10 ** (FLOOR_DB / 20);
const DB_TO_LOG_GAIN = Math.LN10 / 20;
const DEFAULT_NOTE_OPTIONS: NoteOptions = Object.freeze({ velocity: 1, pan: 0 });

function createVoiceSlot(): ActiveVoice {
  return {
    id: 0, sequence: 0, voice: null!, graph: ALGORITHMS[0],
    baseIncrements: new Float64Array(4), increments: new Float64Array(4), steps: new Float64Array(4),
    sustainDb: new Float64Array(4), sustainGain: new Float64Array(4),
    attackStep: new Float64Array(4), decayStep: new Float64Array(4), releaseStep: new Float64Array(4),
    gains: new Float64Array(4 * OVERSAMPLE), levels: new Float64Array(4),
    leftGain: 0, rightGain: 0, lastSample: 0, fadeRemaining: 0, lastFadeGain: 1, carrierGain: 0,
    phases: new Float64Array(4), values: new Float64Array(4), filters: new Float64Array(4), releaseDb: new Float64Array(4),
    previous: 0, older: 0, lfoPhase: 0, lfoIncrement: 0, feedbackScale: 0,
    elapsed: 0, releaseTime: -1, releaseEnd: -1, velocity: 1, expression: 1, pan: 0,
    modIndex: 0, amDepth: 0, pmDepth: 0, pitchFrom: 0, pitchTarget: 0, pitchStart: 0, pitchFrames: 0,
  };
}

function pitchAt(active: ActiveVoice, frame: number): number {
  if (active.pitchFrames === 0 || frame >= active.pitchStart + active.pitchFrames) return active.pitchTarget;
  return active.pitchFrom + (active.pitchTarget - active.pitchFrom) * (frame - active.pitchStart) / active.pitchFrames;
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

function heldDb(time: number, adsr: ADSR, sustainDb: number): number {
  if (adsr.a > 0 && time < adsr.a) return FLOOR_DB * (1 - time / adsr.a);
  if (adsr.d > 0 && time < adsr.a + adsr.d) return sustainDb * ((time - adsr.a) / adsr.d);
  return sustainDb;
}

function gainAt(time: number, op: FrozenOperator, sustainDb: number, sustainGain: number, releaseTime: number, releaseDb: number): number {
  const adsr = op.adsr;
  if (releaseTime >= 0) {
    if (adsr.r === 0 || time >= releaseTime + adsr.r) return 0;
    const db = releaseDb + (FLOOR_DB - releaseDb) * ((time - releaseTime) / adsr.r);
    return db <= FLOOR_DB ? 0 : Math.exp(db * DB_TO_LOG_GAIN);
  }
  if (time >= adsr.a + adsr.d) return sustainGain;
  if (time === 0 && adsr.a > 0) return 0;
  const db = heldDb(time, adsr, sustainDb);
  return db <= FLOOR_DB ? 0 : Math.exp(db * DB_TO_LOG_GAIN);
}

function prepareGains(active: ActiveVoice, time: number, subTimes: Float64Array): void {
  const { voice, sustainDb, sustainGain, releaseDb, gains, attackStep, decayStep, releaseStep } = active;
  const lastTime = time + subTimes[OVERSAMPLE - 1];
  for (let op = 0; op < 4; op++) {
    const source = voice.ops[op];
    const adsr = source.adsr;
    let step: number | undefined;
    if (active.releaseTime >= 0) {
      if (adsr.r === 0 || time >= active.releaseTime + adsr.r) {
        gains[op] = gains[op + 4] = gains[op + 8] = gains[op + 12] = 0;
        continue;
      }
      if (lastTime < active.releaseTime + adsr.r) step = releaseStep[op];
    } else if (time >= adsr.a + adsr.d) {
      gains[op] = gains[op + 4] = gains[op + 8] = gains[op + 12] = sustainGain[op];
      continue;
    } else if (time > 0 && lastTime < adsr.a) {
      step = attackStep[op];
    } else if (time >= adsr.a && lastTime < adsr.a + adsr.d) {
      step = decayStep[op];
    }
    // Re-anchor every output frame, so rounding cannot accumulate across time
    // or depend on render chunking. Boundary-crossing frames keep exact dB rules.
    if (step !== undefined) {
      let gain = gainAt(time, source, sustainDb[op], sustainGain[op], active.releaseTime, releaseDb[op]);
      for (let sub = 0; sub < OVERSAMPLE; sub++) {
        gains[op + sub * 4] = gain;
        gain *= step;
      }
    } else {
      for (let sub = 0; sub < OVERSAMPLE; sub++) {
        gains[op + sub * 4] = gainAt(time + subTimes[sub], source, sustainDb[op], sustainGain[op],
          active.releaseTime, releaseDb[op]);
      }
    }
  }
}

export class Synth {
  declare readonly sampleRate: number;
  declare readonly maxVoices: number;
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
  declare filterAlpha: number;
  /** @internal Bounded spare slots include one admission scratch slot. */
  declare freeVoices: ActiveVoice[];
  /** @internal Preallocated notifications are drained after each stable frame. */
  declare terminalIds: Float64Array;
  /** @internal */
  declare terminalErrors: Uint8Array;
  /** @internal */
  declare rendering: boolean;

  constructor(sampleRate: number, maxVoices = MAX_VOICES) {
    if (typeof sampleRate !== 'number' || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
      throw new RangeError('sampleRate must be finite and in 8000..192000');
    }
    if (!Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > MAX_VOICES) {
      throw new RangeError('maxVoices must be an integer in 1..8');
    }
    this.sampleRate = sampleRate;
    this.maxVoices = maxVoices;
    this.voices = [];
    this.fades = [];
    this.freeVoices = Array.from({ length: maxVoices + MAX_VOICES + 1 }, createVoiceSlot);
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
    this.subTimes = Float64Array.from({ length: OVERSAMPLE }, (_, sub) => sub / (sampleRate * OVERSAMPLE));
    this.sequence = 0;
    // Four one-pole filters at the 4x internal rate attenuate ultrasonic FM
    // products before decimation. The cutoff is 0.2 times the output rate.
    this.filterAlpha = 1 - Math.exp(-TAU * 0.2 / OVERSAMPLE);
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
    const frequency = 440 * 2 ** ((note - 69) / 12);
    const rate = this.sampleRate * OVERSAMPLE;
    for (let i = 0; i < 4; i++) {
      const op = voice.ops[i];
      const scale = op.keyScale;
      const attenuation = scale ? Math.abs(note - scale.breakpoint) / 12 *
        (note < scale.breakpoint ? scale.leftDbPerOctave : scale.rightDbPerOctave) : 0;
      levels[i] = op.level * 10 ** (-(attenuation + (op.velocitySensitivity ?? 0) * (1 - velocity)) / 20);
      const operatorFrequency = frequency * op.ratio * 2 ** (op.detune / 1200);
      baseIncrements[i] = TAU * operatorFrequency / rate;
      // Retain the original pre-PM cap, but keep unclipped pitch bases so a
      // downward bend can bring high-ratio operators back into audible range.
      increments[i] = TAU * Math.min(rate * 0.45, operatorFrequency) / rate;
      sustainDb[i] = op.adsr.s === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(op.adsr.s));
      sustainGain[i] = sustainDb[i] <= FLOOR_DB ? 0 : 10 ** (sustainDb[i] / 20);
      steps[i] = Math.min(TAU * 0.45, increments[i]);
      attackStep[i] = op.adsr.a === 0 ? 1 : 10 ** (-FLOOR_DB / (20 * op.adsr.a * rate));
      decayStep[i] = op.adsr.d === 0 ? 1 : 10 ** (sustainDb[i] / (20 * op.adsr.d * rate));
    }
    active.id = id;
    active.sequence = this.sequence++;
    active.voice = voice;
    active.graph = ALGORITHMS[voice.algorithm];
    active.velocity = velocity;
    active.expression = 1;
    active.pan = pan;
    active.modIndex = voice.modIndex;
    active.amDepth = voice.lfo.amDepth;
    active.pmDepth = voice.lfo.pmDepth;
    active.pitchFrom = active.pitchTarget = active.pitchStart = active.pitchFrames = 0;
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
    active.previous = active.older = active.lfoPhase = active.elapsed = 0;
    active.lfoIncrement = TAU * voice.lfo.rate / this.sampleRate;
    active.feedbackScale = voice.feedback === 0 ? 0 : 0.5 * 2 ** (voice.feedback - 7) * Math.PI;
    active.releaseTime = active.releaseEnd = -1;
    (this as MutableCounters).lastStolenId = null;
    if (this.voices.length >= this.maxVoices) {
      let oldest = 0;
      for (let i = 1; i < this.voices.length; i++) {
        if (this.voices[i].sequence < this.voices[oldest].sequence) oldest = i;
      }
      const stolen = removeAt(this.voices, oldest);
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
    active.releaseTime = active.elapsed / this.sampleRate;
    let maxRelease = 0;
    for (let op = 0; op < 4; op++) maxRelease = Math.max(maxRelease, active.voice.ops[op].adsr.r);
    active.releaseEnd = active.releaseTime + maxRelease;
    for (let op = 0; op < 4; op++) {
      active.releaseDb[op] = heldDb(active.releaseTime, active.voice.ops[op].adsr, active.sustainDb[op]);
      const release = active.voice.ops[op].adsr.r;
      active.releaseStep[op] = release === 0 ? 0 :
        10 ** ((FLOOR_DB - active.releaseDb[op]) / (20 * release * this.sampleRate * OVERSAMPLE));
    }
    return true;
  }

  updateNote(id: number, input: NoteControls): boolean {
    const controls = validateNoteControls(input);
    let active: ActiveVoice | undefined;
    for (const item of this.voices) if (item.id === id) { active = item; break; }
    if (!active) return false;
    if (controls.pitch !== undefined) {
      active.pitchFrom = pitchAt(active, active.elapsed);
      active.pitchTarget = controls.pitch;
      active.pitchStart = active.elapsed;
      active.pitchFrames = (controls.glide ?? 0) * this.sampleRate;
    }
    if (controls.expression !== undefined) active.expression = controls.expression;
    if (controls.pan !== undefined) active.pan = controls.pan;
    if (controls.expression !== undefined || controls.pan !== undefined) updatePan(active);
    if (controls.modulation !== undefined) {
      active.modIndex = active.voice.modIndex * controls.modulation;
      active.amDepth = Math.min(1, active.voice.lfo.amDepth * controls.modulation);
      active.pmDepth = Math.min(1200, active.voice.lfo.pmDepth * controls.modulation);
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
    const time = active.elapsed / this.sampleRate;
    const finished = active.releaseTime >= 0 && time >= active.releaseEnd;
    let tremolo = 0;
    if (active.lfoIncrement !== 0) {
      if (active.amDepth !== 0 || active.pmDepth !== 0) tremolo = Math.sin(active.lfoPhase);
      const phase = active.lfoPhase + active.lfoIncrement;
      active.lfoPhase = phase < TAU ? phase : phase - TAU;
    }
    const amGain = active.amDepth === 0 ? 1 : 1 - active.amDepth * (0.5 + 0.5 * tremolo);
    const pmFactor = active.pmDepth === 0 ? 1 : 2 ** (active.pmDepth * tremolo / 1200);
    const gliding = active.pitchFrames !== 0;
    if (!gliding && active.pmDepth !== 0) {
      for (let op = 0; op < 4; op++) steps[op] = Math.min(TAU * 0.45, increments[op] * pmFactor);
    }
    if (!finished) prepareGains(active, time, this.subTimes);
    for (let sub = 0; sub < OVERSAMPLE; sub++) {
      if (gliding) {
        const factor = 2 ** (pitchAt(active, active.elapsed + sub / OVERSAMPLE) / 12);
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
          values[op] = Math.sin(phases[op] + modulation) * gains[op + sub * 4] * levels[op] * amGain;
          const phase = phases[op] + steps[op];
          phases[op] = phase < TAU ? phase : phase - TAU;
          if (!Number.isFinite(values[op]) || !Number.isFinite(phases[op])) return NaN;
        }
        active.older = active.previous;
        active.previous = values[0];
        for (let j = 0; j < graph.carriers.length; j++) sample += values[graph.carriers[j]];
        sample *= active.carrierGain;
      }
      for (let pole = 0; pole < 4; pole++) {
        filters[pole] += this.filterAlpha * (sample - filters[pole]);
        sample = filters[pole];
      }
      if (!Number.isFinite(sample)) return NaN;
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
    active.lastSample = filters[3];
    return active.lastSample;
  }

  render(left: Float32Array, right: Float32Array, offset = 0, length = left.length - offset): void {
    if (this.rendering) throw new Error('render cannot be called reentrantly');
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) ||
        !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
        offset + length > left.length || offset + length > right.length) {
      throw new RangeError('render requires Float32Arrays and an in-bounds offset and length');
    }
    if (this.voices.length === 0 && this.fades.length === 0 && this.spillRemaining === 0) {
      left.fill(0, offset, offset + length);
      if (right !== left) right.fill(0, offset, offset + length);
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
          if (active.releaseTime >= 0 && (active.elapsed - 1) / this.sampleRate >= active.releaseEnd &&
              Math.abs(sample) < AMPLITUDE_FLOOR) {
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
        left[frame] = Number.isFinite(mixedLeft) ? HEADROOM * Math.tanh(mixedLeft / HEADROOM) : 0;
        right[frame] = Number.isFinite(mixedRight) ? HEADROOM * Math.tanh(mixedRight / HEADROOM) : 0;
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
