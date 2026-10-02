import { LIMITS, lfoSync, lfoTargets, lfoWaveform } from './schema.js';
import type { Algorithm, LFO, NormalizedVoice, Operator, PreparedVoice, VoiceInput } from './schema.js';

const ZERO_LFO: Readonly<LFO> = Object.freeze({ rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' });

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
  object(input, ['algorithm', 'feedback', 'ops'], ['name', 'lfo', 'version', 'modIndex', 'pitchEnvelope'], 'voice');
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
  const version = field(input, 'version') ?? 6;
  if (Object.hasOwn(input, 'version') && ![1, 2, 3, 4, 5, 6].includes(field(input, 'version') as number)) {
    throw new RangeError('Unsupported voice version');
  }
  if (version !== 5 && version !== 6 && Object.hasOwn(input, 'pitchEnvelope')) throw new TypeError('pitchEnvelope requires voice version 5 or later');
  const rawOps = field(input, 'ops');
  if (!Array.isArray(rawOps) || rawOps.length !== 4) throw new TypeError('ops must contain four operators');
  if (Reflect.ownKeys(rawOps).length !== 5) throw new TypeError('ops has unknown fields');
  const ops = new Array<Operator>(4);
  for (let i = 0; i < 4; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(rawOps, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('ops must contain four data operators');
    const op: unknown = descriptor.value;
    object(op, ['ratio', 'level', 'detune', 'adsr'],
      version === 1 ? [] : version === 2 ? ['keyScale'] : version === 5 || version === 6 ?
        ['keyScale', 'velocitySensitivity', 'frequency', 'rateKeyScale'] : ['keyScale', 'velocitySensitivity'], 'operator');
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
    if (Object.hasOwn(op, 'velocitySensitivity')) {
      ops[i].velocitySensitivity = number(field(op, 'velocitySensitivity'), 'velocitySensitivity');
    }
    if (Object.hasOwn(op, 'frequency')) ops[i].frequency = number(field(op, 'frequency'), 'frequency');
    if (Object.hasOwn(op, 'rateKeyScale')) ops[i].rateKeyScale = number(field(op, 'rateKeyScale'), 'rateKeyScale');
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
    object(rawLfo, ['rate', 'amDepth', 'pmDepth'], version === 6 ? ['waveform', 'delay', 'sync', 'phase', 'amTargets', 'pmTargets'] :
      version === 5 ? ['waveform', 'delay', 'sync', 'phase'] : version === 4 ? ['waveform'] : [], 'lfo');
    lfo = {
      rate: number(field(rawLfo, 'rate'), 'rate'),
      amDepth: number(field(rawLfo, 'amDepth'), 'amDepth'),
      pmDepth: number(field(rawLfo, 'pmDepth'), 'pmDepth'),
      waveform: Object.hasOwn(rawLfo, 'waveform') ? lfoWaveform(field(rawLfo, 'waveform')) : 'sine',
    };
    if (Object.hasOwn(rawLfo, 'delay')) lfo.delay = number(field(rawLfo, 'delay'), 'delay');
    if (Object.hasOwn(rawLfo, 'sync')) lfo.sync = lfoSync(field(rawLfo, 'sync'));
    if (Object.hasOwn(rawLfo, 'phase')) lfo.phase = number(field(rawLfo, 'phase'), 'phase');
    if (Object.hasOwn(rawLfo, 'amTargets')) lfo.amTargets = lfoTargets(field(rawLfo, 'amTargets'));
    if (Object.hasOwn(rawLfo, 'pmTargets')) lfo.pmTargets = lfoTargets(field(rawLfo, 'pmTargets'));
  }
  const voice: NormalizedVoice = { version: 6, algorithm: algorithm as Algorithm, feedback: feedback as Algorithm, ops: ops as NormalizedVoice['ops'], lfo,
    modIndex: Object.hasOwn(input, 'modIndex') ? number(field(input, 'modIndex'), 'modIndex') : 4 };
  if (name !== undefined) voice.name = name as string;
  if (Object.hasOwn(input, 'pitchEnvelope')) {
    const envelope = field(input, 'pitchEnvelope');
    object(envelope, ['a', 'd', 'r', 'initial', 'peak', 'sustain', 'final'], [], 'pitchEnvelope');
    voice.pitchEnvelope = { a: number(field(envelope, 'a'), 'a'), d: number(field(envelope, 'd'), 'd'), r: number(field(envelope, 'r'), 'r'),
      initial: number(field(envelope, 'initial'), 'initial'), peak: number(field(envelope, 'peak'), 'peak'),
      sustain: number(field(envelope, 'sustain'), 'sustain'), final: number(field(envelope, 'final'), 'final') };
  }
  return voice;
}

const preparedVoices = new WeakSet<object>();

/** Validate once and retain a deeply immutable, caller-independent snapshot. */
export function prepareVoice(input: VoiceInput): PreparedVoice {
  const voice = normalizeVoice(input);
  Object.freeze(voice.lfo);
  if (voice.pitchEnvelope) Object.freeze(voice.pitchEnvelope);
  for (const op of voice.ops) {
    Object.freeze(op.adsr);
    if (op.keyScale) Object.freeze(op.keyScale);
    Object.freeze(op);
  }
  Object.freeze(voice.ops);
  Object.freeze(voice);
  preparedVoices.add(voice);
  return voice as unknown as PreparedVoice;
}

/** @internal Identity, not a public property or structural shape, grants trust. */
export function preparedVoiceValue(input: VoiceInput | PreparedVoice): PreparedVoice {
  return preparedVoices.has(input) ? input as PreparedVoice : prepareVoice(input);
}
