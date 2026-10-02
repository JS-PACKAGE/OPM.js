import type { ADSR, NormalizedVoice, Operator, VoiceInput } from '../voices/schema.js';
import type { AlgorithmGraph } from './algorithms.js';

export type VoiceEndReason = 'stolen' | 'ended' | 'error';
export interface NoteOptions { velocity?: number; pan?: number }

interface ActiveVoice {
  id: number; sequence: number; voice: NormalizedVoice; graph: AlgorithmGraph;
  increments: Float64Array; steps: Float64Array; sustainDb: Float64Array; sustainGain: Float64Array;
  attackStep: Float64Array; decayStep: Float64Array; releaseStep: Float64Array; gains: Float64Array;
  levels: Float64Array; leftGain: number; rightGain: number; lastSample: number; fadeRemaining: number;
  lastFadeGain?: number; carrierGain: number; phases: Float64Array; values: Float64Array; filters: Float64Array;
  releaseDb: Float64Array; previous: number; older: number; lfoPhase: number; lfoIncrement: number;
  feedbackScale: number; elapsed: number; releaseTime: number; releaseEnd: number;
}

interface MutableCounters {
  currentFrame: number; errorCount: number; lastStolenId: number | null;
}

import { ALGORITHMS } from './algorithms.js';
import { FLOOR_DB } from './envelope.js';
import { TAU } from './operator.js';
import { normalizeVoice } from '../voices/normalize.js';
export { normalizeVoice } from '../voices/normalize.js';

const OVERSAMPLE = 4;
const HEADROOM = 0.7;
const MAX_VOICES = 8;
const AMPLITUDE_FLOOR = 10 ** (FLOOR_DB / 20);
const DB_TO_LOG_GAIN = Math.LN10 / 20;

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

function gainAt(time: number, op: Operator, sustainDb: number, sustainGain: number, releaseTime: number, releaseDb: number): number {
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

  noteOn(input: VoiceInput, note: number, id?: number, { velocity = 1, pan = 0 }: NoteOptions = {}): number {
    const voice = normalizeVoice(input);
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
    if (this.voices.some(active => active.id === id)) throw new RangeError('id already active');
    if (id >= this.nextId) this.nextId = id + 1;
    (this as MutableCounters).lastStolenId = null;
    if (this.voices.length >= this.maxVoices) {
      let oldest = 0;
      for (let i = 1; i < this.voices.length; i++) {
        if (this.voices[i].sequence < this.voices[oldest].sequence) oldest = i;
      }
      const stolen = removeAt(this.voices, oldest);
      (this as MutableCounters).lastStolenId = stolen.id;
      // Retain oscillator, envelope and filter state while fading the old sound.
      // At extreme event rates, collapse the oldest tail into a bounded linear
      // spill ramp rather than dropping its last audible value discontinuously.
      if (this.fades.length === MAX_VOICES) {
        const retired = this.fades.shift()!;
        const gain = retired.lastFadeGain!;
        this.spillLeft += retired.lastSample * retired.leftGain * gain;
        this.spillRight += retired.lastSample * retired.rightGain * gain;
        this.spillRemaining = this.fadeFrames;
      }
      stolen.fadeRemaining = this.fadeFrames;
      stolen.lastFadeGain = 1;
      this.fades.push(stolen);
    }
    const frequency = 440 * 2 ** ((note - 69) / 12);
    const increments = new Float64Array(4);
    const sustainDb = new Float64Array(4);
    const sustainGain = new Float64Array(4);
    const steps = new Float64Array(4);
    const attackStep = new Float64Array(4);
    const decayStep = new Float64Array(4);
    const releaseStep = new Float64Array(4);
    const rate = this.sampleRate * OVERSAMPLE;
    const levels = new Float64Array(4);
    for (let i = 0; i < 4; i++) {
      const op = voice.ops[i];
      const scale = op.keyScale;
      const attenuation = scale ? Math.abs(note - scale.breakpoint) / 12 *
        (note < scale.breakpoint ? scale.leftDbPerOctave : scale.rightDbPerOctave) : 0;
      levels[i] = op.level * 10 ** (-attenuation / 20);
      increments[i] = TAU * Math.min(rate * 0.45, frequency * op.ratio * 2 ** (op.detune / 1200)) / rate;
      sustainDb[i] = op.adsr.s === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(op.adsr.s));
      sustainGain[i] = sustainDb[i] <= FLOOR_DB ? 0 : 10 ** (sustainDb[i] / 20);
      steps[i] = Math.min(TAU * 0.45, increments[i]);
      attackStep[i] = op.adsr.a === 0 ? 1 : 10 ** (-FLOOR_DB / (20 * op.adsr.a * rate));
      decayStep[i] = op.adsr.d === 0 ? 1 : 10 ** (sustainDb[i] / (20 * op.adsr.d * rate));
    }
    const graph = ALGORITHMS[voice.algorithm];
    // Constant-power pan normalized to preserve the previous dual-mono center.
    const angle = (pan + 1) * Math.PI / 4;
    const leftGain = pan === 1 ? 0 : pan === 0 ? velocity : velocity * Math.SQRT2 * Math.cos(angle);
    const rightGain = pan === -1 ? 0 : pan === 0 ? velocity : velocity * Math.SQRT2 * Math.sin(angle);
    this.voices.push({ id, sequence: this.sequence++, voice, graph, increments, steps, sustainDb, sustainGain,
      attackStep, decayStep, releaseStep, gains: new Float64Array(4 * OVERSAMPLE),
      levels, leftGain, rightGain, lastSample: 0, fadeRemaining: 0,
      carrierGain: HEADROOM / graph.carriers.length,
      phases: new Float64Array(4), values: new Float64Array(4), filters: new Float64Array(4),
      releaseDb: new Float64Array(4), previous: 0, older: 0, lfoPhase: 0,
      lfoIncrement: TAU * voice.lfo.rate / this.sampleRate,
      feedbackScale: voice.feedback === 0 ? 0 : 0.5 * 2 ** (voice.feedback - 7) * Math.PI,
      elapsed: 0, releaseTime: -1, releaseEnd: -1 });
    // Notify only after admission: callbacks may start another note reentrantly.
    if (this.lastStolenId !== null) this.ended(this.lastStolenId, 'stolen');
    return id;
  }

  noteOff(id: number): boolean {
    const active = this.voices.find(item => item.id === id);
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

  /** @internal */
  ended(id: number, reason: VoiceEndReason): void {
    if (typeof this.onVoiceEnded === 'function') {
      try { this.onVoiceEnded(id, reason); } catch { (this as MutableCounters).errorCount++; }
    }
  }

  // One output frame, with no temporary arrays or objects in the hot path.
  /** @internal */
  renderVoice(active: ActiveVoice): number {
    const { voice, graph, phases, values, filters, increments, steps, gains, levels } = active;
    const time = active.elapsed / this.sampleRate;
    const finished = active.releaseTime >= 0 && time >= active.releaseEnd;
    let tremolo = 0;
    if (active.lfoIncrement !== 0) {
      if (voice.lfo.amDepth !== 0 || voice.lfo.pmDepth !== 0) tremolo = Math.sin(active.lfoPhase);
      const phase = active.lfoPhase + active.lfoIncrement;
      active.lfoPhase = phase < TAU ? phase : phase - TAU;
    }
    const amGain = voice.lfo.amDepth === 0 ? 1 : 1 - voice.lfo.amDepth * (0.5 + 0.5 * tremolo);
    if (voice.lfo.pmDepth !== 0) {
      const pitch = 2 ** (voice.lfo.pmDepth * tremolo / 1200);
      for (let op = 0; op < 4; op++) steps[op] = Math.min(TAU * 0.45, increments[op] * pitch);
    }
    if (!finished) prepareGains(active, time, this.subTimes);
    for (let sub = 0; sub < OVERSAMPLE; sub++) {
      let sample = 0;
      if (!finished) {
        for (let op = 0; op < 4; op++) {
          let modulation = op === 0 ? (active.previous + active.older) * active.feedbackScale : 0;
          const inputs = graph.inputs[op];
          for (let j = 0; j < inputs.length; j++) modulation += values[inputs[j]] * voice.modIndex;
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
    active.lastSample = filters[3];
    return active.lastSample;
  }

  render(left: Float32Array, right: Float32Array, offset = 0, length = left.length - offset): void {
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
    for (let frame = offset, end = offset + length; frame < end; frame++) {
      let mixedLeft = 0, mixedRight = 0;
      for (let index = 0; index < this.voices.length; index++) {
        const active = this.voices[index];
        const sample = this.renderVoice(active);
        if (!Number.isFinite(sample)) {
          (this as MutableCounters).errorCount++;
          removeAt(this.voices, index--);
          this.ended(active.id, 'error');
          continue;
        }
        mixedLeft += sample * active.leftGain;
        mixedRight += sample * active.rightGain;
        if (active.releaseTime >= 0 && (active.elapsed - 1) / this.sampleRate >= active.releaseEnd &&
            Math.abs(sample) < AMPLITUDE_FLOOR) {
          removeAt(this.voices, index--);
          this.ended(active.id, 'ended');
        }
      }
      for (let index = 0; index < this.fades.length; index++) {
        const active = this.fades[index];
        const sample = this.renderVoice(active);
        if (!Number.isFinite(sample)) {
          (this as MutableCounters).errorCount++;
          removeAt(this.fades, index--);
          continue;
        }
        const gain = active.fadeRemaining / this.fadeFrames;
        active.lastFadeGain = gain;
        mixedLeft += sample * active.leftGain * gain;
        mixedRight += sample * active.rightGain * gain;
        if (--active.fadeRemaining === 0) removeAt(this.fades, index--);
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
      (this as MutableCounters).currentFrame++;
    }
  }
}
