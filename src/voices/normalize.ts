import { LIMITS, lfoSync, lfoTargets, lfoWaveform, operatorWaveform } from './schema.js';
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
  const bounds = LIMITS[key];
  const min = bounds[0], max = bounds[1];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${key} must be finite and in ${min}..${max}`);
  }
  return value;
}

function field(value: object, key: PropertyKey): unknown {
  // A Proxy can change the descriptor after the earlier shape scan.
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor !== undefined && !Object.hasOwn(descriptor, 'value')) throw new TypeError('voice fields must be data');
  return descriptor?.value;
}

function optionalField(value: object, key: PropertyKey, forbidden?: string): PropertyDescriptor | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor !== undefined) {
    if (forbidden !== undefined) throw new TypeError(forbidden);
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('voice fields must be data');
  }
  return descriptor;
}

function keyScaleValue(scale: object, known: boolean): NonNullable<Operator['keyScale']> {
  if (!known) object(scale, ['breakpoint', 'leftDbPerOctave', 'rightDbPerOctave'], [], 'keyScale');
  const breakpoint = number(field(scale, 'breakpoint'), 'breakpoint');
  if (!Number.isInteger(breakpoint)) throw new RangeError('breakpoint must be a MIDI integer');
  return { breakpoint,
    leftDbPerOctave: number(field(scale, 'leftDbPerOctave'), 'leftDbPerOctave'),
    rightDbPerOctave: number(field(scale, 'rightDbPerOctave'), 'rightDbPerOctave') };
}

function pitchEnvelopeValue(envelope: object, known: boolean): NonNullable<NormalizedVoice['pitchEnvelope']> {
  if (!known) object(envelope, ['a', 'd', 'r', 'initial', 'peak', 'sustain', 'final'], [], 'pitchEnvelope');
  return { a: number(field(envelope, 'a'), 'a'), d: number(field(envelope, 'd'), 'd'), r: number(field(envelope, 'r'), 'r'),
    initial: number(field(envelope, 'initial'), 'initial'), peak: number(field(envelope, 'peak'), 'peak'),
    sustain: number(field(envelope, 'sustain'), 'sustain'), final: number(field(envelope, 'final'), 'final') };
}

// Copy only approved own data fields: callers may mutate or reuse their voice after noteOn.
export function normalizeVoice(source: VoiceInput): NormalizedVoice {
  const input = source;
  // Only private frozen producer identities skip shape scans; checks and fresh copies remain.
  const known = preparedVoices.has(input);
  if (!known) object(input, ['algorithm', 'feedback', 'ops'], ['name', 'lfo', 'version', 'modIndex', 'pitchEnvelope', 'pan'], 'voice');
  const algorithm = field(input, 'algorithm');
  const feedback = field(input, 'feedback');
  if (!Number.isInteger(algorithm) || typeof algorithm !== 'number' || algorithm < 0 || algorithm > 7 ||
      !Number.isInteger(feedback) || typeof feedback !== 'number' || feedback < 0 || feedback > 7) {
    throw new RangeError('algorithm and feedback must be integers in 0..7');
  }
  // Presence and validation must describe the same value, even if a Proxy changes later.
  const nameDescriptor = Object.getOwnPropertyDescriptor(input, 'name');
  if (nameDescriptor !== undefined && !Object.hasOwn(nameDescriptor, 'value')) throw new TypeError('voice.name must be data');
  const name: unknown = nameDescriptor?.value;
  if (nameDescriptor !== undefined && (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name))) {
    throw new TypeError('name must contain 1..64 letters, digits, underscores or hyphens');
  }
  // Validate the same snapshot used by every gate, even if a Proxy changes later descriptors.
  const versionDescriptor = Object.getOwnPropertyDescriptor(input, 'version');
  if (versionDescriptor !== undefined && !Object.hasOwn(versionDescriptor, 'value')) throw new TypeError('voice.version must be data');
  const version: unknown = versionDescriptor === undefined ? 8 : versionDescriptor.value;
  if (versionDescriptor !== undefined && ![1, 2, 3, 4, 5, 6, 7, 8].includes(version as number)) {
    throw new RangeError('Unsupported voice version');
  }
  const pitchEnvelope = optionalField(input, 'pitchEnvelope',
    (version as number) < 5 ? 'pitchEnvelope requires voice version 5 or later' : undefined);
  const pan = optionalField(input, 'pan', (version as number) < 8 ? 'voice pan requires voice version 8' : undefined);
  const rawOps = field(input, 'ops');
  if (!Array.isArray(rawOps) || (known ? rawOps.length : field(rawOps, 'length')) !== 4) {
    throw new TypeError('ops must contain four operators');
  }
  if (!known && Reflect.ownKeys(rawOps).length !== 5) throw new TypeError('ops has unknown fields');
  // Own placeholder slots: later index writes cannot reach inherited indexed accessors.
  const ops = [undefined, undefined, undefined, undefined] as unknown as Operator[];
  for (let i = 0; i < 4; i++) {
    let op: object;
    // Private producers freeze their owned data slots before root registration.
    if (known) op = rawOps[i] as object;
    else {
      const descriptor = Object.getOwnPropertyDescriptor(rawOps, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('ops must contain four data operators');
      op = descriptor.value as object;
    }
    const waveform = op && typeof op === 'object' ? optionalField(op, 'waveform',
      (version as number) < 7 ? 'operator waveform and noiseRate requires voice version 7' : undefined) : undefined;
    const noiseRate = op && typeof op === 'object' ? optionalField(op, 'noiseRate',
      (version as number) < 7 ? 'operator waveform and noiseRate requires voice version 7' : undefined) : undefined;
    if (!known) object(op, ['ratio', 'level', 'detune', 'adsr'],
      (version as number) >= 7 ? ['keyScale', 'velocitySensitivity', 'frequency', 'rateKeyScale', 'waveform', 'noiseRate'] :
      version === 1 ? [] : version === 2 ? ['keyScale'] : version === 5 || version === 6 ?
        ['keyScale', 'velocitySensitivity', 'frequency', 'rateKeyScale'] : ['keyScale', 'velocitySensitivity'], 'operator');
    const adsr = field(op, 'adsr') as object;
    if (!known) object(adsr, ['a', 'd', 's', 'r'], ['sr'], 'adsr');
    const sr = optionalField(adsr, 'sr', (version as number) < 8 ? 'adsr.sr requires voice version 8' : undefined);
    const velocitySensitivity = optionalField(op, 'velocitySensitivity', (version as number) < 3 ? 'operator has an unknown field' : undefined);
    const frequency = optionalField(op, 'frequency', (version as number) < 5 ? 'operator has an unknown field' : undefined);
    const rateKeyScale = optionalField(op, 'rateKeyScale', (version as number) < 5 ? 'operator has an unknown field' : undefined);
    const keyScale = optionalField(op, 'keyScale', version === 1 ? 'operator has an unknown field' : undefined);
    // Conditional object spreads define own data (CreateDataProperty): no inherited setter
    // or descriptor-field hook can intercept an approved optional field.
    ops[i] = {
      ratio: number(field(op, 'ratio'), 'ratio'),
      level: number(field(op, 'level'), 'level'),
      detune: number(field(op, 'detune'), 'detune'),
      adsr: {
        a: number(field(adsr, 'a'), 'a'), d: number(field(adsr, 'd'), 'd'),
        s: number(field(adsr, 's'), 's'), r: number(field(adsr, 'r'), 'r'),
        ...(sr !== undefined ? { sr: number(sr.value, 'sr') } : {}),
      },
      ...(velocitySensitivity !== undefined ? { velocitySensitivity: number(velocitySensitivity.value, 'velocitySensitivity') } : {}),
      ...(frequency !== undefined ? { frequency: number(frequency.value, 'frequency') } : {}),
      ...(rateKeyScale !== undefined ? { rateKeyScale: number(rateKeyScale.value, 'rateKeyScale') } : {}),
      ...(waveform !== undefined ? { waveform: operatorWaveform(waveform.value) } : {}),
      ...(noiseRate !== undefined ? { noiseRate: number(noiseRate.value, 'noiseRate') } : {}),
      ...(keyScale !== undefined ? { keyScale: keyScaleValue(keyScale.value as object, known) } : {}),
    };
  }
  let lfo: LFO = ZERO_LFO;
  const lfoDescriptor = optionalField(input, 'lfo');
  if (lfoDescriptor !== undefined) {
    const rawLfo = lfoDescriptor.value as object;
    if (!known) object(rawLfo, ['rate', 'amDepth', 'pmDepth'], (version as number) >= 6 ? ['waveform', 'delay', 'sync', 'phase', 'amTargets', 'pmTargets'] :
      version === 5 ? ['waveform', 'delay', 'sync', 'phase'] : version === 4 ? ['waveform'] : [], 'lfo');
    const rate = number(field(rawLfo, 'rate'), 'rate');
    const amDepth = number(field(rawLfo, 'amDepth'), 'amDepth');
    const pmDepth = number(field(rawLfo, 'pmDepth'), 'pmDepth');
    const waveformDescriptor = optionalField(rawLfo, 'waveform', (version as number) < 4 ? 'lfo has an unknown field' : undefined);
    const waveform = waveformDescriptor !== undefined ? lfoWaveform(waveformDescriptor.value) : 'sine';
    const delay = optionalField(rawLfo, 'delay', (version as number) < 5 ? 'lfo has an unknown field' : undefined);
    const sync = optionalField(rawLfo, 'sync', (version as number) < 5 ? 'lfo has an unknown field' : undefined);
    const phase = optionalField(rawLfo, 'phase', (version as number) < 5 ? 'lfo has an unknown field' : undefined);
    const amTargets = optionalField(rawLfo, 'amTargets', (version as number) < 6 ? 'lfo has an unknown field' : undefined);
    const pmTargets = optionalField(rawLfo, 'pmTargets', (version as number) < 6 ? 'lfo has an unknown field' : undefined);
    if ((version as number) < 8 && waveform === 'noise') throw new RangeError('noise LFO requires voice version 8');
    lfo = { rate, amDepth, pmDepth, waveform,
      ...(delay !== undefined ? { delay: number(delay.value, 'delay') } : {}),
      ...(sync !== undefined ? { sync: lfoSync(sync.value) } : {}),
      ...(phase !== undefined ? { phase: number(phase.value, 'phase') } : {}),
      ...(amTargets !== undefined ? { amTargets: lfoTargets(amTargets.value) } : {}),
      ...(pmTargets !== undefined ? { pmTargets: lfoTargets(pmTargets.value) } : {}) };
  }
  const modIndex = optionalField(input, 'modIndex');
  return { version: 8, algorithm: algorithm as Algorithm, feedback: feedback as Algorithm, ops: ops as NormalizedVoice['ops'], lfo,
    modIndex: modIndex !== undefined ? number(modIndex.value, 'modIndex') : 4,
    ...(pan !== undefined ? { pan: number(pan.value, 'pan') } : {}),
    ...(name !== undefined ? { name: name as string } : {}),
    ...(pitchEnvelope !== undefined ? { pitchEnvelope: pitchEnvelopeValue(pitchEnvelope.value as object, known) } : {}) };
}

const preparedVoices = new WeakSet<object>();

/** Validate once and retain a deeply immutable, caller-independent snapshot. */
export function prepareVoice(input: VoiceInput): PreparedVoice {
  const voice = normalizeVoice(input);
  Object.freeze(voice.lfo);
  if (Object.hasOwn(voice, 'pitchEnvelope')) Object.freeze(voice.pitchEnvelope);
  for (const op of voice.ops) {
    Object.freeze(op.adsr);
    if (Object.hasOwn(op, 'keyScale')) Object.freeze(op.keyScale);
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
