export type Algorithm = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** v1–v7 envelope: no sustain rate. */
export interface LegacyADSR { a: number; d: number; s: number; r: number; sr?: never }
/** `sr` (v8, optional): seconds for a held level to fall the full 96 dB after
 * decay; omitted holds the sustain level until release. */
export interface ADSR extends Omit<LegacyADSR, 'sr'> { sr?: number }
export type LFOTargets = readonly [number, number, number, number];
export type LFOTargetsInput = readonly [number | boolean, number | boolean, number | boolean, number | boolean];
export interface LegacyLFO { rate: number; amDepth: number; pmDepth: number; waveform?: never; delay?: never; sync?: never; phase?: never; amTargets?: never; pmTargets?: never }
export type LegacyLFOWaveform = 'sine' | 'triangle' | 'saw' | 'square';
/** v8 adds `noise`: a deterministic pseudo-random level held for each LFO cycle. */
export type LFOWaveform = LegacyLFOWaveform | 'noise';
export interface LegacyLFOV4 extends Omit<LegacyLFO, 'waveform'> { waveform: LegacyLFOWaveform }
export interface LegacyLFOV5 extends Omit<LegacyLFOV4, 'delay' | 'sync' | 'phase'> { delay?: number; sync?: 'note' | 'global'; phase?: number }
export interface LegacyLFOV7 extends Omit<LegacyLFOV5, 'amTargets' | 'pmTargets'> { amTargets?: LFOTargets; pmTargets?: LFOTargets }
export interface LFO extends Omit<LegacyLFOV7, 'waveform'> { waveform: LFOWaveform }
export type LegacyLFOInput = Omit<LegacyLFOV7, 'waveform' | 'amTargets' | 'pmTargets'> & { waveform?: LegacyLFOWaveform; amTargets?: LFOTargetsInput; pmTargets?: LFOTargetsInput };
export type LFOInput = Omit<LegacyLFOInput, 'waveform'> & { waveform?: LFOWaveform };
export interface PitchEnvelope { a: number; d: number; r: number; initial: number; peak: number; sustain: number; final: number }
export interface KeyScale { breakpoint: number; leftDbPerOctave: number; rightDbPerOctave: number }
export type OperatorWaveform = 'sine' | 'half' | 'abs' | 'quarter' | 'alternating' | 'camel' | 'square' | 'saw' | 'noise';
export interface LegacyOperator { ratio: number; level: number; detune: number; adsr: LegacyADSR; keyScale?: never; velocitySensitivity?: never; frequency?: never; rateKeyScale?: never; waveform?: never; noiseRate?: never }
export interface LegacyOperatorV2 extends Omit<LegacyOperator, 'keyScale'> { keyScale?: KeyScale }
export interface LegacyOperatorV3 extends Omit<LegacyOperatorV2, 'velocitySensitivity'> { velocitySensitivity?: number }
export interface LegacyOperatorV6 extends Omit<LegacyOperatorV3, 'frequency' | 'rateKeyScale'> { frequency?: number; rateKeyScale?: number }
export interface LegacyOperatorV7 extends Omit<LegacyOperatorV6, 'waveform' | 'noiseRate'> { waveform?: OperatorWaveform; noiseRate?: number }
export interface Operator extends Omit<LegacyOperatorV7, 'adsr'> { adsr: ADSR }
export type FourOperators<T = Operator> = [T, T, T, T];
interface VoiceBase { name?: string; algorithm: Algorithm; feedback: Algorithm; modIndex?: number; pan?: never }
/** Strict single-voice input; omitted version uses the current shape. */
export type VoiceInput = (Omit<VoiceBase, 'pan'> & { version?: 8; pan?: number; lfo?: LFOInput; pitchEnvelope?: PitchEnvelope; ops: readonly [Operator, Operator, Operator, Operator] }) |
  (VoiceBase & { version: 7; lfo?: LegacyLFOInput; pitchEnvelope?: PitchEnvelope; ops: readonly [LegacyOperatorV7, LegacyOperatorV7, LegacyOperatorV7, LegacyOperatorV7] }) |
  (VoiceBase & { version: 6; lfo?: LegacyLFOInput; pitchEnvelope?: PitchEnvelope; ops: readonly [LegacyOperatorV6, LegacyOperatorV6, LegacyOperatorV6, LegacyOperatorV6] }) |
  (VoiceBase & { version: 5; lfo?: Omit<LegacyLFOV5, 'waveform'> & { waveform?: LegacyLFOWaveform }; pitchEnvelope?: PitchEnvelope; ops: readonly [LegacyOperatorV6, LegacyOperatorV6, LegacyOperatorV6, LegacyOperatorV6] }) |
  (VoiceBase & { version: 4; lfo?: Omit<LegacyLFOV4, 'waveform'> & { waveform?: LegacyLFOWaveform }; pitchEnvelope?: never; ops: readonly [LegacyOperatorV3, LegacyOperatorV3, LegacyOperatorV3, LegacyOperatorV3] }) |
  (VoiceBase & { version: 3; lfo?: LegacyLFO; pitchEnvelope?: never; ops: readonly [LegacyOperatorV3, LegacyOperatorV3, LegacyOperatorV3, LegacyOperatorV3] }) |
  (VoiceBase & { version: 2; lfo?: LegacyLFO; pitchEnvelope?: never; ops: readonly [LegacyOperatorV2, LegacyOperatorV2, LegacyOperatorV2, LegacyOperatorV2] }) |
  (VoiceBase & { version: 1; lfo?: LegacyLFO; pitchEnvelope?: never; ops: readonly [LegacyOperator, LegacyOperator, LegacyOperator, LegacyOperator] });
/** `pan` (v8, optional, -1..1): voice-level stereo offset added to each note's pan, clamped to -1..1. */
export interface Voice { version: 8; name: string; algorithm: Algorithm; feedback: Algorithm; modIndex: number; pan?: number; lfo: LFO; pitchEnvelope?: PitchEnvelope; ops: FourOperators }
export interface LegacyVoiceV7 { version: 7; name: string; algorithm: Algorithm; feedback: Algorithm; modIndex: number; pan?: never; lfo: LegacyLFOV7; pitchEnvelope?: PitchEnvelope; ops: FourOperators<LegacyOperatorV7> }
export interface LegacyVoice { version: 1; name: string; algorithm: Algorithm; feedback: Algorithm; modIndex: number; lfo: LegacyLFO; pitchEnvelope?: never; ops: FourOperators<LegacyOperator> }
export interface LegacyVoiceV2 extends Omit<LegacyVoice, 'version' | 'ops'> { version: 2; ops: FourOperators<LegacyOperatorV2> }
export interface LegacyVoiceV3 extends Omit<LegacyVoice, 'version' | 'ops'> { version: 3; ops: FourOperators<LegacyOperatorV3> }
export interface LegacyVoiceV4 extends Omit<LegacyVoiceV3, 'version' | 'lfo'> { version: 4; lfo: LegacyLFOV4 }
export interface LegacyVoiceV6 extends Omit<LegacyVoiceV7, 'version' | 'ops'> { version: 6; ops: FourOperators<LegacyOperatorV6> }
export interface LegacyVoiceV5 extends Omit<LegacyVoiceV6, 'version' | 'lfo'> { version: 5; lfo: LegacyLFOV5 }
export interface NormalizedVoice { version: 8; name?: string; algorithm: Algorithm; feedback: Algorithm; modIndex: number; pan?: number; lfo: LFO; pitchEnvelope?: PitchEnvelope; ops: FourOperators }
export type CompleteVoiceInput = Voice | LegacyVoice | LegacyVoiceV2 | LegacyVoiceV3 | LegacyVoiceV4 | LegacyVoiceV5 | LegacyVoiceV6 | LegacyVoiceV7;
export type FrozenVoice = Readonly<Omit<Voice, 'lfo' | 'ops' | 'pitchEnvelope'>> & {
  readonly lfo: Readonly<LFO>;
  readonly pitchEnvelope?: Readonly<PitchEnvelope>;
  readonly ops: readonly [FrozenOperator, FrozenOperator, FrozenOperator, FrozenOperator];
};
export type FrozenOperator = Readonly<Omit<Operator, 'adsr' | 'keyScale'>> & {
  readonly adsr: Readonly<ADSR>; readonly keyScale?: Readonly<KeyScale>;
};
declare const preparedVoiceBrand: unique symbol;
/** Immutable validated snapshot. Only prepareVoice can create the trusted identity. */
export type PreparedVoice = Readonly<Omit<NormalizedVoice, 'lfo' | 'ops' | 'pitchEnvelope'>> & {
  readonly lfo: Readonly<LFO>;
  readonly pitchEnvelope?: Readonly<PitchEnvelope>;
  readonly ops: readonly [FrozenOperator, FrozenOperator, FrozenOperator, FrozenOperator];
  readonly [preparedVoiceBrand]: true;
};
export { prepareVoice } from './normalize.js';

// Canonicalization uses explicit keys; no untrusted objects are merged.
export const MAX_BANK_BYTES = 262144;
export const MAX_BANK_VOICES = 128;
type LimitKey = 'noiseRate' | 'ratio' | 'level' | 'detune' | 'velocitySensitivity' | 'frequency' | 'rateKeyScale' | 'a' | 'd' | 's' | 'r' | 'sr' | 'pan' | 'modIndex' | 'rate' | 'amDepth' | 'pmDepth' | 'delay' | 'phase' | 'initial' | 'peak' | 'sustain' | 'final' | 'breakpoint' | 'leftDbPerOctave' | 'rightDbPerOctave';
export const LIMITS: Readonly<Record<LimitKey, readonly [number, number]>> = Object.freeze({
  noiseRate: [20, 20000],
  ratio: [0.125, 32], level: [0, 1], detune: [-1200, 1200], velocitySensitivity: [0, 48],
  frequency: [1, 20000], rateKeyScale: [0, 4],
  a: [0, 10], d: [0, 10], s: [0, 1], r: [0, 10], sr: [0.01, 100], pan: [-1, 1],
  modIndex: [0, 16], rate: [0, 20], amDepth: [0, 1], pmDepth: [0, 1200],
  delay: [0, 10], phase: [0, 1], initial: [-4800, 4800], peak: [-4800, 4800], sustain: [-4800, 4800], final: [-4800, 4800],
  breakpoint: [0, 127], leftDbPerOctave: [0, 24], rightDbPerOctave: [0, 24],
});

function record(value: unknown, keys: readonly string[], label: string, optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const own = Reflect.ownKeys(value);
  if (own.length < keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key) && !optional.includes(key))) {
    throw new TypeError(`${label} has missing or unknown fields`);
  }
  for (const key of keys) {
    if (!own.includes(key)) throw new TypeError(`${label}.${key} is required`);
  }
  const data: Record<string, unknown> = Object.create(null);
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label}.${String(key)} must be data`);
    }
    data[key as string] = descriptor.value;
  }
  return data;
}

export function bounded(value: unknown, min: number, max: number, label = 'number'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  return Math.min(max, Math.max(min, value));
}
const numeric = (value: unknown, key: LimitKey) => {
  const bounds = LIMITS[key];
  return bounded(value, bounds[0], bounds[1], key);
};
function integer(value: unknown, max: number, label: string): Algorithm {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > max) {
    throw new RangeError(`${label} must be an integer in 0..${max}`);
  }
  return value as Algorithm;
}
function array(value: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} has invalid length`);
  const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < min || length > max) {
    throw new TypeError(`${label} has invalid length`);
  }
  const values: unknown[] = Reflect.ownKeys(value);
  if (values.length !== length + 1) throw new TypeError(`${label} has unknown fields`);
  // Reuse the native dense key array: these own slots cannot reach inherited setters.
  // Capture each checked value before another descriptor trap can change its source.
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} must contain data`);
    values[i] = descriptor.value;
  }
  values.length = length;
  return values;
}

/** @internal Canonical immutable targets; only bank parsing clamps finite numbers. */
export function lfoTargets(value: unknown, clamp = false): LFOTargets {
  const targets = array(value, 4, 4, 'LFO targets');
  for (let i = 0; i < 4; i++) {
    const item = targets[i];
    if (typeof item === 'boolean') {
      targets[i] = item ? 1 : 0;
    } else {
      const target = bounded(item, 0, 1, 'LFO target');
      if (!clamp && target !== item) throw new RangeError('LFO target must be in 0..1');
      targets[i] = target;
    }
  }
  return Object.freeze(targets) as LFOTargets;
}

/** Callers gate `noise` to voice version 8. */
export function lfoWaveform(value: unknown): LFO['waveform'] {
  if (value !== 'sine' && value !== 'triangle' && value !== 'saw' && value !== 'square' && value !== 'noise') {
    throw new RangeError('Unsupported LFO waveform');
  }
  return value;
}
export function lfoSync(value: unknown): NonNullable<LFO['sync']> {
  if (value !== 'note' && value !== 'global') throw new RangeError('Unsupported LFO sync');
  return value;
}

export function operatorWaveform(value: unknown): OperatorWaveform {
  if (value !== 'sine' && value !== 'half' && value !== 'abs' && value !== 'quarter' &&
      value !== 'alternating' && value !== 'camel' && value !== 'square' && value !== 'saw' && value !== 'noise') {
    throw new RangeError('Unsupported operator waveform');
  }
  return value;
}

function frozenKeyScale(scale: unknown): NonNullable<Operator['keyScale']> {
  const data = record(scale, ['breakpoint', 'leftDbPerOctave', 'rightDbPerOctave'], 'keyScale');
  if (!Number.isInteger(data.breakpoint)) throw new RangeError('breakpoint must be a MIDI integer');
  return Object.freeze({
    breakpoint: numeric(data.breakpoint, 'breakpoint'),
    leftDbPerOctave: numeric(data.leftDbPerOctave, 'leftDbPerOctave'),
    rightDbPerOctave: numeric(data.rightDbPerOctave, 'rightDbPerOctave'),
  });
}

function frozenPitchEnvelope(envelope: unknown): NonNullable<Voice['pitchEnvelope']> {
  const data = record(envelope, ['a', 'd', 'r', 'initial', 'peak', 'sustain', 'final'], 'pitchEnvelope');
  return Object.freeze({ a: numeric(data.a, 'a'), d: numeric(data.d, 'd'), r: numeric(data.r, 'r'),
    initial: numeric(data.initial, 'initial'), peak: numeric(data.peak, 'peak'),
    sustain: numeric(data.sustain, 'sustain'), final: numeric(data.final, 'final') });
}

export function validateVoice(input: unknown): FrozenVoice {
  const data = record(input, ['version', 'name', 'algorithm', 'feedback', 'modIndex', 'lfo', 'ops'], 'voice', ['pitchEnvelope', 'pan']);
  const version = data.version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8) throw new RangeError('Unsupported voice version');
  if (version < 5 && Object.hasOwn(data, 'pitchEnvelope')) throw new TypeError('pitchEnvelope requires voice version 5 or later');
  if (version < 8 && Object.hasOwn(data, 'pan')) throw new TypeError('voice pan requires voice version 8');
  const name = data.name;
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new TypeError('Voice name must contain 1..64 letters, digits, underscores or hyphens');
  }
  const operators = array(data.ops, 4, 4, 'ops');
  const lfoData = record(data.lfo, ['rate', 'amDepth', 'pmDepth'], 'lfo',
    version >= 6 ? ['waveform', 'delay', 'sync', 'phase', 'amTargets', 'pmTargets'] :
      version === 5 ? ['waveform', 'delay', 'sync', 'phase'] : version === 4 ? ['waveform'] : []);
  // Conditional object spreads define own data (CreateDataProperty): no inherited setter
  // or descriptor-field hook can intercept an approved optional field.
  const rate = numeric(lfoData.rate, 'rate');
  const amDepth = numeric(lfoData.amDepth, 'amDepth');
  const pmDepth = numeric(lfoData.pmDepth, 'pmDepth');
  const waveform = Object.hasOwn(lfoData, 'waveform') ? lfoWaveform(lfoData.waveform) : 'sine';
  if (version < 8 && waveform === 'noise') throw new RangeError('noise LFO requires voice version 8');
  const lfo: LFO = Object.freeze({ rate, amDepth, pmDepth, waveform,
    ...(Object.hasOwn(lfoData, 'delay') ? { delay: numeric(lfoData.delay, 'delay') } : {}),
    ...(Object.hasOwn(lfoData, 'sync') ? { sync: lfoSync(lfoData.sync) } : {}),
    ...(Object.hasOwn(lfoData, 'phase') ? { phase: numeric(lfoData.phase, 'phase') } : {}),
    ...(Object.hasOwn(lfoData, 'amTargets') ? { amTargets: lfoTargets(lfoData.amTargets, true) } : {}),
    ...(Object.hasOwn(lfoData, 'pmTargets') ? { pmTargets: lfoTargets(lfoData.pmTargets, true) } : {}) });
  // Own placeholder slots: later index writes cannot reach inherited indexed accessors.
  const ops = [undefined, undefined, undefined, undefined] as unknown as FrozenOperator[];
  for (let i = 0; i < 4; i++) {
    const source = operators[i];
    if (source && typeof source === 'object' && version < 7 && (Object.hasOwn(source, 'waveform') || Object.hasOwn(source, 'noiseRate'))) throw new TypeError('operator waveform and noiseRate require voice version 7');
    const op = record(source, ['ratio', 'level', 'detune', 'adsr'], 'operator',
      version >= 7 ? ['keyScale', 'velocitySensitivity', 'frequency', 'rateKeyScale', 'waveform', 'noiseRate'] :
      version === 1 ? [] : version === 2 ? ['keyScale'] : version === 5 || version === 6 ?
        ['keyScale', 'velocitySensitivity', 'frequency', 'rateKeyScale'] : ['keyScale', 'velocitySensitivity']);
    const envelope = record(op.adsr, ['a', 'd', 's', 'r'], 'adsr', ['sr']);
    const hasSr = Object.hasOwn(envelope, 'sr');
    if (hasSr && version < 8) throw new TypeError('adsr.sr requires voice version 8');
    const adsr: ADSR = { a: numeric(envelope.a, 'a'), d: numeric(envelope.d, 'd'), s: numeric(envelope.s, 's'), r: numeric(envelope.r, 'r'),
      ...(hasSr ? { sr: numeric(envelope.sr, 'sr') } : {}) };
    ops[i] = Object.freeze({ ratio: numeric(op.ratio, 'ratio'), level: numeric(op.level, 'level'),
      detune: numeric(op.detune, 'detune'), adsr: Object.freeze(adsr),
      ...(Object.hasOwn(op, 'velocitySensitivity') ? { velocitySensitivity: numeric(op.velocitySensitivity, 'velocitySensitivity') } : {}),
      ...(Object.hasOwn(op, 'frequency') ? { frequency: numeric(op.frequency, 'frequency') } : {}),
      ...(Object.hasOwn(op, 'rateKeyScale') ? { rateKeyScale: numeric(op.rateKeyScale, 'rateKeyScale') } : {}),
      ...(Object.hasOwn(op, 'waveform') ? { waveform: operatorWaveform(op.waveform) } : {}),
      ...(Object.hasOwn(op, 'noiseRate') ? { noiseRate: numeric(op.noiseRate, 'noiseRate') } : {}),
      ...(Object.hasOwn(op, 'keyScale') ? { keyScale: frozenKeyScale(op.keyScale) } : {}) });
  }
  // Canonical key order: an optional voice pan sits between modIndex and lfo.
  return Object.freeze({ version: 8, name,
    algorithm: integer(data.algorithm, 7, 'algorithm'), feedback: integer(data.feedback, 7, 'feedback'),
    modIndex: numeric(data.modIndex, 'modIndex'),
    ...(Object.hasOwn(data, 'pan') ? { pan: numeric(data.pan, 'pan') } : {}),
    lfo, ops: Object.freeze(ops) as unknown as Voice['ops'],
    ...(Object.hasOwn(data, 'pitchEnvelope') ? { pitchEnvelope: frozenPitchEnvelope(data.pitchEnvelope) } : {}) } as Voice);
}

export function parseVoiceBank(source: string | readonly unknown[]): Map<string, FrozenVoice> {
  let input: unknown = source;
  if (typeof input === 'string') {
    // Three UTF-8 bytes per UTF-16 code unit is an upper bound; small inputs need no buffer.
    if (input.length > MAX_BANK_BYTES || (input.length * 3 > MAX_BANK_BYTES && new TextEncoder().encode(input).length > MAX_BANK_BYTES)) {
      throw new RangeError('Voice bank exceeds 256 KiB');
    }
    input = JSON.parse(input);
  }
  const values = array(input, 1, MAX_BANK_VOICES, 'voice bank');
  const bank = new Map<string, FrozenVoice>();
  for (let i = 0; i < values.length; i++) {
    const voice = validateVoice(values[i]);
    if (bank.has(voice.name)) throw new TypeError(`Duplicate voice: ${voice.name}`);
    bank.set(voice.name, voice);
  }
  return bank;
}
