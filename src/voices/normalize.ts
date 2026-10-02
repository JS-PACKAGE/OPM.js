import { LIMITS } from './schema.js';
import type { Algorithm, LFO, NormalizedVoice, Operator, VoiceInput } from './schema.js';

const ZERO_LFO = Object.freeze({ rate: 0, amDepth: 0, pmDepth: 0 });

function object(value: unknown, required: readonly string[], optional: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !required.includes(key) && !optional.includes(key)) throw new TypeError(`${label} has an unknown field`);
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')) {
      throw new TypeError(`${label}.${String(key)} must be data`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`);
  }
}

function number(value: unknown, key: keyof typeof LIMITS): number {
  const [min, max] = LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${key} must be finite and in ${min}..${max}`);
  }
  return value;
}

function field(value: object, key: PropertyKey): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

// Copy only approved own data fields: callers may mutate or reuse their voice after noteOn.
export function normalizeVoice(source: VoiceInput): NormalizedVoice {
  const input: unknown = source;
  object(input, ['algorithm', 'feedback', 'ops'], ['name', 'lfo', 'version', 'modIndex'], 'voice');
  const algorithm = field(input, 'algorithm');
  const feedback = field(input, 'feedback');
  if (!Number.isInteger(algorithm) || typeof algorithm !== 'number' || algorithm < 0 || algorithm > 7 ||
      !Number.isInteger(feedback) || typeof feedback !== 'number' || feedback < 0 || feedback > 7) {
    throw new RangeError('algorithm and feedback must be integers in 0..7');
  }
  const name = field(input, 'name');
  if (Object.hasOwn(input, 'name') && (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name))) {
    throw new TypeError('name must contain 1..64 letters, digits, underscores or hyphens');
  }
  if (Object.hasOwn(input, 'version') && ![1, 2].includes(field(input, 'version') as number)) {
    throw new RangeError('Unsupported voice version');
  }
  const rawOps = field(input, 'ops');
  if (!Array.isArray(rawOps) || rawOps.length !== 4) throw new TypeError('ops must contain four operators');
  const ops = new Array<Operator>(4);
  for (let i = 0; i < 4; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(rawOps, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('ops must contain four data operators');
    const op: unknown = descriptor.value;
    object(op, ['ratio', 'level', 'detune', 'adsr'], field(input, 'version') === 1 ? [] : ['keyScale'], 'operator');
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
    if (Object.hasOwn(op, 'keyScale')) {
      const scale = field(op, 'keyScale');
      object(scale, ['breakpoint', 'leftDbPerOctave', 'rightDbPerOctave'], [], 'keyScale');
      const breakpoint = number(field(scale, 'breakpoint'), 'breakpoint');
      if (!Number.isInteger(breakpoint)) throw new RangeError('breakpoint must be a MIDI integer');
      ops[i].keyScale = { breakpoint,
        leftDbPerOctave: number(field(scale, 'leftDbPerOctave'), 'leftDbPerOctave'),
        rightDbPerOctave: number(field(scale, 'rightDbPerOctave'), 'rightDbPerOctave') };
    }
  }
  let lfo: LFO = ZERO_LFO;
  if (Object.hasOwn(input, 'lfo')) {
    const rawLfo = field(input, 'lfo');
    object(rawLfo, ['rate', 'amDepth', 'pmDepth'], [], 'lfo');
    lfo = {
      rate: number(field(rawLfo, 'rate'), 'rate'),
      amDepth: number(field(rawLfo, 'amDepth'), 'amDepth'),
      pmDepth: number(field(rawLfo, 'pmDepth'), 'pmDepth'),
    };
  }
  const voice: NormalizedVoice = { algorithm: algorithm as Algorithm, feedback: feedback as Algorithm, ops: ops as NormalizedVoice['ops'], lfo,
    modIndex: Object.hasOwn(input, 'modIndex') ? number(field(input, 'modIndex'), 'modIndex') : 4 };
  if (name !== undefined) voice.name = name as string;
  if (Object.hasOwn(input, 'version')) voice.version = 2;
  return voice;
}
