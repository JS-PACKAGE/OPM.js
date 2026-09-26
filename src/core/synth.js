import { ALGORITHMS } from './algorithms.js';
import { FLOOR_DB } from './envelope.js';
import { TAU } from './operator.js';
import { LIMITS } from '../voices/schema.js';

const OVERSAMPLE = 4;
const HEADROOM = 0.7;
const MAX_VOICES = 8;
const ZERO_LFO = Object.freeze({ rate: 0, amDepth: 0, pmDepth: 0 });
const AMPLITUDE_FLOOR = 10 ** (FLOOR_DB / 20);

function object(value, required, optional, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!required.includes(key) && !optional.includes(key)) throw new TypeError(`${label} has an unknown field`);
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      throw new TypeError(`${label}.${String(key)} must be data`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
  }
}

function number(value, key) {
  const [min, max] = LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${key} must be finite and in ${min}..${max}`);
  }
  return value;
}

function field(value, key) {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

// Copy only approved own data fields: callers may mutate or reuse their voice after noteOn.
export function normalizeVoice(input) {
  object(input, ['algorithm', 'feedback', 'ops'], ['name', 'lfo', 'version', 'modIndex'], 'voice');
  const algorithm = field(input, 'algorithm');
  const feedback = field(input, 'feedback');
  if (!Number.isInteger(algorithm) || algorithm < 0 || algorithm > 7 ||
      !Number.isInteger(feedback) || feedback < 0 || feedback > 7) {
    throw new RangeError('algorithm and feedback must be integers in 0..7');
  }
  const name = field(input, 'name');
  if (Object.hasOwn(input, 'name') && (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name))) {
    throw new TypeError('name must contain 1..64 letters, digits, underscores or hyphens');
  }
  if (Object.hasOwn(input, 'version') && field(input, 'version') !== 1) {
    throw new RangeError('Unsupported voice version');
  }
  const rawOps = field(input, 'ops');
  if (!Array.isArray(rawOps) || rawOps.length !== 4) throw new TypeError('ops must contain four operators');
  const ops = new Array(4);
  for (let i = 0; i < 4; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(rawOps, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('ops must contain four data operators');
    const op = descriptor.value;
    object(op, ['ratio', 'level', 'detune', 'adsr'], [], 'operator');
    const adsr = field(op, 'adsr');
    object(adsr, ['a', 'd', 's', 'r'], [], 'adsr');
    ops[i] = {
      ratio: number(field(op, 'ratio'), 'ratio'),
      level: number(field(op, 'level'), 'level'),
      detune: number(field(op, 'detune'), 'detune'),
      adsr: {
        a: number(field(adsr, 'a'), 'a'), d: number(field(adsr, 'd'), 'd'),
        s: number(field(adsr, 's'), 's'), r: number(field(adsr, 'r'), 'r'),
      },
    };
  }
  let lfo = ZERO_LFO;
  if (Object.hasOwn(input, 'lfo')) {
    const rawLfo = field(input, 'lfo');
    object(rawLfo, ['rate', 'amDepth', 'pmDepth'], [], 'lfo');
    lfo = {
      rate: number(field(rawLfo, 'rate'), 'rate'),
      amDepth: number(field(rawLfo, 'amDepth'), 'amDepth'),
      pmDepth: number(field(rawLfo, 'pmDepth'), 'pmDepth'),
    };
  }
  const voice = { algorithm, feedback, ops, lfo,
    modIndex: Object.hasOwn(input, 'modIndex') ? number(field(input, 'modIndex'), 'modIndex') : 4 };
  if (name !== undefined) voice.name = name;
  if (Object.hasOwn(input, 'version')) voice.version = 1;
  return voice;
}

function heldDb(time, adsr, sustainDb) {
  if (adsr.a > 0 && time < adsr.a) return FLOOR_DB * (1 - time / adsr.a);
  if (adsr.d > 0 && time < adsr.a + adsr.d) return sustainDb * ((time - adsr.a) / adsr.d);
  return sustainDb;
}

function gainAt(time, op, sustainDb, releaseTime, releaseDb) {
  const adsr = op.adsr;
  if (releaseTime >= 0) {
    if (adsr.r === 0 || time >= releaseTime + adsr.r) return 0;
    const db = releaseDb + (FLOOR_DB - releaseDb) * ((time - releaseTime) / adsr.r);
    return db <= FLOOR_DB ? 0 : 10 ** (db / 20);
  }
  if (time === 0 && adsr.a > 0 || adsr.s === 0 && time >= adsr.a + adsr.d) return 0;
  const db = heldDb(time, adsr, sustainDb);
  return db <= FLOOR_DB ? 0 : 10 ** (db / 20);
}

export class Synth {
  constructor(sampleRate, maxVoices = MAX_VOICES) {
    if (typeof sampleRate !== 'number' || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
      throw new RangeError('sampleRate must be finite and in 8000..192000');
    }
    if (!Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > MAX_VOICES) {
      throw new RangeError('maxVoices must be an integer in 1..8');
    }
    this.sampleRate = sampleRate;
    this.maxVoices = maxVoices;
    this.voices = [];
    this.currentFrame = 0;
    this.errorCount = 0;
    this.nextId = 1;
    this.sequence = 0;
    // Four one-pole filters at the 4x internal rate attenuate ultrasonic FM
    // products before decimation. The cutoff is 0.2 times the output rate.
    this.filterAlpha = 1 - Math.exp(-TAU * 0.2 / OVERSAMPLE);
  }

  noteOn(input, note, id) {
    const voice = normalizeVoice(input);
    if (!Number.isInteger(note) || note < 0 || note > 127) throw new RangeError('note must be a MIDI integer in 0..127');
    if (id === undefined) {
      if (this.nextId > Number.MAX_SAFE_INTEGER) throw new RangeError('Note ID space exhausted');
      id = this.nextId++;
    } else if (!Number.isSafeInteger(id) || id <= 0) {
      throw new RangeError('id must be a positive safe integer');
    }
    if (this.voices.some(active => active.id === id)) throw new RangeError('id already active');
    if (id >= this.nextId) this.nextId = id + 1;
    if (this.voices.length >= this.maxVoices) {
      let oldest = 0;
      for (let i = 1; i < this.voices.length; i++) {
        if (this.voices[i].sequence < this.voices[oldest].sequence) oldest = i;
      }
      this.voices.splice(oldest, 1);
    }
    const frequency = 440 * 2 ** ((note - 69) / 12);
    const increments = new Float64Array(4);
    const sustainDb = new Float64Array(4);
    const rate = this.sampleRate * OVERSAMPLE;
    for (let i = 0; i < 4; i++) {
      const op = voice.ops[i];
      increments[i] = TAU * Math.min(rate * 0.45, frequency * op.ratio * 2 ** (op.detune / 1200)) / rate;
      sustainDb[i] = op.adsr.s === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(op.adsr.s));
    }
    this.voices.push({ id, sequence: this.sequence++, voice, increments, sustainDb,
      phases: new Float64Array(4), values: new Float64Array(4), filters: new Float64Array(4),
      releaseDb: new Float64Array(4), previous: 0, older: 0, lfoPhase: 0,
      lfoIncrement: TAU * voice.lfo.rate / this.sampleRate,
      feedbackScale: voice.feedback === 0 ? 0 : 0.5 * 2 ** (voice.feedback - 7) * Math.PI,
      elapsed: 0, releaseTime: -1, releaseEnd: -1 });
    return id;
  }

  noteOff(id) {
    const active = this.voices.find(item => item.id === id);
    if (!active || active.releaseTime >= 0) return false;
    active.releaseTime = active.elapsed / this.sampleRate;
    let maxRelease = 0;
    for (let op = 0; op < 4; op++) maxRelease = Math.max(maxRelease, active.voice.ops[op].adsr.r);
    active.releaseEnd = active.releaseTime + maxRelease;
    for (let op = 0; op < 4; op++) {
      active.releaseDb[op] = heldDb(active.releaseTime, active.voice.ops[op].adsr, active.sustainDb[op]);
    }
    return true;
  }

  render(left, right, offset = 0, length = left.length - offset) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) ||
        !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 ||
        offset + length > left.length || offset + length > right.length) {
      throw new RangeError('render requires Float32Arrays and an in-bounds offset and length');
    }
    for (let frame = offset, end = offset + length; frame < end; frame++) {
      let mixed = 0;
      for (let index = 0; index < this.voices.length; index++) {
        const active = this.voices[index];
        const voice = active.voice;
        const graph = ALGORITHMS[voice.algorithm];
        const time = active.elapsed / this.sampleRate;
        const finished = active.releaseTime >= 0 && time >= active.releaseEnd;
        let tremolo = 0;
        if (active.lfoIncrement !== 0) {
          if (voice.lfo.amDepth !== 0 || voice.lfo.pmDepth !== 0) tremolo = Math.sin(active.lfoPhase);
          active.lfoPhase = (active.lfoPhase + active.lfoIncrement) % TAU;
        }
        const amGain = voice.lfo.amDepth === 0 ? 1 : 1 - voice.lfo.amDepth * (0.5 + 0.5 * tremolo);
        const pitch = voice.lfo.pmDepth === 0 ? 1 : 2 ** (voice.lfo.pmDepth * tremolo / 1200);
        let bad = false;
        for (let sub = 0; sub < OVERSAMPLE; sub++) {
          let sample = 0;
          if (!finished) {
            for (let op = 0; op < 4; op++) {
              const source = voice.ops[op];
              let modulation = op === 0
                ? (active.previous + active.older) * active.feedbackScale : 0;
              const inputs = graph.inputs[op];
              for (let j = 0; j < inputs.length; j++) modulation += active.values[inputs[j]] * voice.modIndex;
              const gain = gainAt(time + sub / (this.sampleRate * OVERSAMPLE), source,
                active.sustainDb[op], active.releaseTime, active.releaseDb[op]);
              active.values[op] = Math.sin(active.phases[op] + modulation) * gain * source.level * amGain;
              active.phases[op] = (active.phases[op] + Math.min(TAU * 0.45, active.increments[op] * pitch)) % TAU;
              if (!Number.isFinite(active.values[op]) || !Number.isFinite(active.phases[op])) { bad = true; break; }
            }
            if (bad) break;
            active.older = active.previous;
            active.previous = active.values[0];
            for (let j = 0; j < graph.carriers.length; j++) sample += active.values[graph.carriers[j]];
            sample *= HEADROOM / graph.carriers.length;
          }
          for (let pole = 0; pole < 4; pole++) {
            active.filters[pole] += this.filterAlpha * (sample - active.filters[pole]);
            sample = active.filters[pole];
          }
          if (!Number.isFinite(sample)) { bad = true; break; }
        }
        if (bad) {
          this.errorCount++;
          this.voices.splice(index--, 1);
          continue;
        }
        mixed += active.filters[3];
        active.elapsed++;
        if (finished && Math.abs(active.filters[3]) < AMPLITUDE_FLOOR) {
          this.voices.splice(index--, 1);
        }
      }
      // Saturate polyphonic sums without allowing clipping or losing single-note headroom.
      const output = Number.isFinite(mixed) ? HEADROOM * Math.tanh(mixed / HEADROOM) : 0;
      if (!Number.isFinite(mixed)) this.errorCount++;
      left[frame] = output;
      right[frame] = output;
      this.currentFrame++;
    }
  }
}
