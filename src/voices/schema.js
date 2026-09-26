// Canonicalization uses explicit keys; no untrusted objects are merged.
export const MAX_BANK_BYTES = 256 * 1024;
export const MAX_BANK_VOICES = 128;
export const LIMITS = Object.freeze({
  ratio: [0.125, 32], level: [0, 1], detune: [-1200, 1200],
  a: [0, 10], d: [0, 10], s: [0, 1], r: [0, 10],
  modIndex: [0, 16], rate: [0, 20], amDepth: [0, 1], pmDepth: [0, 1200],
});

function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) {
    throw new TypeError(`${label} has missing or unknown fields`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) {
      throw new TypeError(`${label}.${key} must be data`);
    }
  }
}

export function bounded(value, min, max, label = 'number') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  return Math.min(max, Math.max(min, value));
}
const numeric = (value, key) => bounded(value, ...LIMITS[key], key);
function integer(value, max, label) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be an integer in 0..${max}`);
  }
  return value;
}
function array(value, min, max, label) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${label} has invalid length`);
  }
  // Reject sparse arrays and accessor elements without invoking accessors.
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} must contain data`);
  }
}

export function validateVoice(input) {
  record(input, ['version', 'name', 'algorithm', 'feedback', 'modIndex', 'lfo', 'ops'], 'voice');
  if (input.version !== 1) throw new RangeError('Unsupported voice version');
  if (typeof input.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.name)) {
    throw new TypeError('Voice name must contain 1..64 letters, digits, underscores or hyphens');
  }
  array(input.ops, 4, 4, 'ops');
  record(input.lfo, ['rate', 'amDepth', 'pmDepth'], 'lfo');
  const lfo = Object.freeze({ rate: numeric(input.lfo.rate, 'rate'),
    amDepth: numeric(input.lfo.amDepth, 'amDepth'), pmDepth: numeric(input.lfo.pmDepth, 'pmDepth') });
  const ops = [];
  for (let i = 0; i < 4; i++) {
    const op = input.ops[i];
    record(op, ['ratio', 'level', 'detune', 'adsr'], 'operator');
    record(op.adsr, ['a', 'd', 's', 'r'], 'adsr');
    ops.push(Object.freeze({ ratio: numeric(op.ratio, 'ratio'), level: numeric(op.level, 'level'),
      detune: numeric(op.detune, 'detune'), adsr: Object.freeze({
        a: numeric(op.adsr.a, 'a'), d: numeric(op.adsr.d, 'd'),
        s: numeric(op.adsr.s, 's'), r: numeric(op.adsr.r, 'r'),
      }) }));
  }
  return Object.freeze({ version: 1, name: input.name,
    algorithm: integer(input.algorithm, 7, 'algorithm'), feedback: integer(input.feedback, 7, 'feedback'),
    modIndex: numeric(input.modIndex, 'modIndex'), lfo, ops: Object.freeze(ops) });
}

export function parseVoiceBank(input) {
  if (typeof input === 'string') {
    if (input.length > MAX_BANK_BYTES || new TextEncoder().encode(input).length > MAX_BANK_BYTES) {
      throw new RangeError('Voice bank exceeds 256 KiB');
    }
    input = JSON.parse(input);
  }
  array(input, 1, MAX_BANK_VOICES, 'voice bank');
  const bank = new Map();
  for (let i = 0; i < input.length; i++) {
    const voice = validateVoice(input[i]);
    if (bank.has(voice.name)) throw new TypeError(`Duplicate voice: ${voice.name}`);
    bank.set(voice.name, voice);
  }
  return bank;
}
