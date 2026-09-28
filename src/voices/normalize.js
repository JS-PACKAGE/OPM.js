import { LIMITS } from './schema.js';

const ZERO_LFO = Object.freeze({ rate: 0, amDepth: 0, pmDepth: 0 });

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
