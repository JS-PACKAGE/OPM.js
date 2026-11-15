import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoice, prepareVoice, preparedVoiceValue } from '../src/voices/normalize.js';
import { brass } from '../src/voices/brass.js';
import { validateVoice } from '../src/voices/schema.js';
import type { FourOperators, Operator, Voice, VoiceInput } from '../src/voices/schema.js';

function voice() {
  return { ...brass, lfo: { ...brass.lfo }, ops: brass.ops.map(op => ({ ...op, adsr: { ...op.adsr } })) as FourOperators };
}


test('normalized operators, envelopes, and LFO do not share mutable caller state', () => {
  const source = voice();
  const normalized = normalizeVoice(source);
  const ratio = source.ops[1].ratio;
  const attack = source.ops[1].adsr.a;
  const rate = source.lfo.rate;
  source.ops[1].ratio = 17;
  source.ops[1].adsr.a = 9;
  source.lfo.rate = 19;
  assert.equal(normalized.ops[1].ratio, ratio);
  assert.equal(normalized.ops[1].adsr.a, attack);
  assert.equal(normalized.lfo.rate, rate);
  normalized.ops[0].adsr.s = 0.24;
  assert.equal(source.ops[0].adsr.s, brass.ops[0].adsr.s);
});

test('voice preparation never reads or freezes inherited optional objects', () => {
  for (const key of ['pitchEnvelope', 'keyScale'] as const) {
    const source = voice();
    delete source.pitchEnvelope;
    for (const op of source.ops) delete op.keyScale;
    const foreign = { mutable: 1 };
    const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
    let reads = 0;
    try {
      Object.defineProperty(Object.prototype, key, { configurable: true, get() { reads++; return foreign; } });
      prepareVoice(source);
      assert.equal(Reflect.set(foreign, 'mutable', 2), true);
      assert.equal(reads, 0);
    } finally {
      if (original) Object.defineProperty(Object.prototype, key, original);
      else Reflect.deleteProperty(Object.prototype, key);
    }
  }
});

test('nested accessors and sparse operator slots are rejected without reading getters', () => {
  const nested = voice();
  let getterCalls = 0;
  Object.defineProperty(nested.ops[1].adsr, 'r', { enumerable: true, get() { getterCalls++; throw Error('getter ran'); } });
  assert.throws(() => normalizeVoice(nested), TypeError);
  assert.equal(getterCalls, 0);

  const sparse = voice();
  delete (sparse.ops as Array<Operator | undefined>)[2];
  assert.throws(() => normalizeVoice(sparse as unknown as Parameters<typeof normalizeVoice>[0]), TypeError);

  const accessorSlot = voice();
  Object.defineProperty(accessorSlot.ops, '2', { get() { getterCalls++; throw Error('slot getter ran'); } });
  assert.throws(() => normalizeVoice(accessorSlot), TypeError);
  assert.equal(getterCalls, 0);
  const extraSlot = voice();
  Object.defineProperty(extraSlot.ops, 'extra', { get() { getterCalls++; throw Error('extra getter ran'); } });
  assert.throws(() => normalizeVoice(extraSlot), TypeError);
  assert.throws(() => validateVoice(extraSlot), TypeError);
  assert.equal(getterCalls, 0);
});

test('version gates reject the captured object even when later descriptors report a valid scalar', () => {
  let probes = 0, coercions = 0;
  const invalid = { valueOf() { coercions++; return 8; } };
  const input = new Proxy(voice(), {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (key === 'version' && ++probes < 4) return { ...descriptor, value: invalid };
      return descriptor;
    },
  });
  assert.throws(() => normalizeVoice(input), RangeError);
  assert.equal(coercions, 0);
});

test('a changing version accessor cannot read inherited descriptor values', () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
  let probes = 0, inheritedReads = 0, getterCalls = 0, failure: unknown;
  const accessor = { configurable: true, enumerable: true, get() { getterCalls++; return 8; } };
  Object.setPrototypeOf(accessor, null);
  const input = new Proxy(voice(), {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'version' && ++probes > 1) return accessor;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const hook: PropertyDescriptor = Object.create(null);
  hook.configurable = true;
  hook.get = () => { inheritedReads++; return 8; };
  Object.defineProperty(Object.prototype, 'value', hook);
  try {
    normalizeVoice(input);
  } catch (error) {
    failure = error;
  } finally {
    Reflect.deleteProperty(Object.prototype, 'value');
    if (original) Object.defineProperty(Object.prototype, 'value', original);
  }
  assert.ok(failure instanceof TypeError);
  assert.equal(inheritedReads, 0);
  assert.equal(getterCalls, 0);
});

test('changing field accessors cannot supply inherited descriptor values', () => {
  type Wrap = <T extends object>(value: T) => T;
  const cases: { key: string; input: (source: Voice, wrap: Wrap) => VoiceInput }[] = [
    { key: 'algorithm', input: (source, wrap) => wrap(source) },
    { key: 'name', input: (source, wrap) => wrap(source) },
    { key: 'ratio', input: (source, wrap) => { source.ops[0] = wrap(source.ops[0]); return source; } },
    { key: 's', input: (source, wrap) => { source.ops[0].adsr = wrap(source.ops[0].adsr); return source; } },
    { key: 'rate', input: (source, wrap) => { source.lfo = wrap(source.lfo); return source; } },
    { key: 'breakpoint', input: (source, wrap) => { source.ops[0].keyScale = wrap(source.ops[0].keyScale!); return source; } },
    { key: 'peak', input: (source, wrap) => { source.pitchEnvelope = wrap(source.pitchEnvelope!); return source; } },
  ];
  for (const convert of [normalizeVoice, prepareVoice, preparedVoiceValue]) for (const spec of cases) {
    const source = voice();
    source.ops[0].keyScale = { breakpoint: 60, leftDbPerOctave: 1, rightDbPerOctave: 2 };
    source.pitchEnvelope = { a: 0.1, d: 0.2, r: 0.3, initial: 0, peak: 100, sustain: 0, final: 0 };
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    let probes = 0, inheritedReads = 0, getterCalls = 0, failure: unknown;
    const accessor: PropertyDescriptor = Object.create(null);
    accessor.configurable = true;
    accessor.enumerable = true;
    accessor.get = () => { getterCalls++; throw new Error('caller getter ran'); };
    const wrap: Wrap = target => new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        if (key === spec.key && ++probes > 1) return accessor;
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
    });
    const input = spec.input(source, wrap), hook: PropertyDescriptor = Object.create(null);
    hook.configurable = true;
    hook.get = () => { inheritedReads++; throw new Error('inherited descriptor value ran'); };
    try {
      Object.defineProperty(Object.prototype, 'value', hook);
      convert(input);
    } catch (error) {
      failure = error;
    } finally {
      Reflect.deleteProperty(Object.prototype, 'value');
      if (original) Object.defineProperty(Object.prototype, 'value', original);
    }
    assert.ok(failure instanceof TypeError, spec.key);
    assert.equal(inheritedReads, 0, spec.key);
    assert.equal(getterCalls, 0, spec.key);
  }
});

test('a later missing-name report cannot hide the captured invalid name', () => {
  for (const convert of [normalizeVoice, prepareVoice, preparedVoiceValue]) {
    let probes = 0, coercions = 0;
    const foreign = { toString() { coercions++; return 'foreign'; } };
    const input = new Proxy(voice(), {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key === 'name') {
          probes++;
          if (probes === 2) return { ...descriptor, value: foreign };
          if (probes > 2) return undefined;
        }
        return descriptor;
      },
    });
    assert.throws(() => convert(input), TypeError);
    assert.equal(coercions, 0);
    assert.equal(Object.isFrozen(foreign), false);
  }
});

test('legacy formats retain their old operator and LFO boundaries', () => {
  const { waveform: _, ...lfo } = voice().lfo;
  for (const version of [1, 2, 3] as const) {
    const source = { ...voice(), version, lfo };
    const normalized = normalizeVoice(source as VoiceInput);
    assert.deepEqual(normalized.ops, voice().ops);
    assert.deepEqual(normalized.lfo, voice().lfo);
    assert.deepEqual(validateVoice(source), normalized);
    for (const convert of [normalizeVoice, validateVoice]) {
      assert.throws(() => convert({ ...source, lfo: { ...lfo, waveform: 'triangle' } } as unknown as VoiceInput));
    }
  }
  const old = { ...voice(), version: 1, lfo };
  old.ops[0].keyScale = { breakpoint: 60, leftDbPerOctave: 0, rightDbPerOctave: 6 };
  assert.throws(() => normalizeVoice(old as unknown as VoiceInput));
  assert.throws(() => validateVoice(old));
  const second = { ...old, version: 2 };
  assert.equal(normalizeVoice(second as VoiceInput).ops[0].keyScale!.rightDbPerOctave, 6);
  second.ops[0].velocitySensitivity = 12;
  assert.throws(() => normalizeVoice(second as VoiceInput));
  assert.throws(() => validateVoice(second));
  const third = { ...second, version: 3 as const };
  assert.equal(normalizeVoice(third as unknown as VoiceInput).ops[0].velocitySensitivity, 12);
});

test('current LFO inputs default to sine and preserve every supported waveform', () => {
  const { waveform: _, ...lfo } = voice().lfo;
  for (const version of [undefined, 4, 5, 6] as const) {
    const source = { ...voice(), lfo };
    const input = version === undefined ? { algorithm: source.algorithm, feedback: source.feedback, ops: source.ops, lfo } : { ...source, version } as VoiceInput;
    assert.equal(normalizeVoice(input).lfo.waveform, 'sine');
  }
  assert.equal(validateVoice({ ...voice(), lfo }).lfo.waveform, 'sine');
  for (const waveform of ['sine', 'triangle', 'saw', 'square', 'noise'] as const) {
    const source = { ...voice(), lfo: { ...lfo, waveform } };
    assert.equal(normalizeVoice(source).lfo.waveform, waveform);
    assert.equal(validateVoice(source).lfo.waveform, waveform);
  }
  for (const waveform of ['invalid', '', null, undefined, 0, {}, []]) {
    const source = { ...voice(), lfo: { ...lfo, waveform } };
    assert.throws(() => normalizeVoice(source as unknown as VoiceInput));
    assert.throws(() => validateVoice(source));
  }
});

test('waveform getters and unknown LFO fields never become trusted voice data', () => {
  for (const convert of [normalizeVoice, validateVoice]) {
    let calls = 0;
    const source = voice();
    Object.defineProperty(source.lfo, 'waveform', { get() { calls++; return 'square'; } });
    assert.throws(() => convert(source), TypeError);
    assert.equal(calls, 0);
    const unknownField = { ...voice(), lfo: { ...voice().lfo, unknown: true } };
    assert.throws(() => convert(unknownField));
  }
});

test('prepared identity is trusted only after validation and snapshots are deeply immutable', () => {
  const source = voice();
  const prepared = prepareVoice(source);
  assert.strictEqual(preparedVoiceValue(prepared), prepared);
  const detached = preparedVoiceValue(structuredClone(prepared));
  assert.notStrictEqual(detached, prepared);
  assert.deepEqual(detached, prepared);
  source.lfo.waveform = 'square';
  source.ops[0].adsr.s = 0;
  assert.equal(prepared.lfo.waveform, 'sine');
  assert.equal(prepared.ops[0].adsr.s, brass.ops[0].adsr.s);
  assert.throws(() => Object.assign(prepared.lfo, { waveform: 'triangle' }), TypeError);
  assert.throws(() => Object.assign(prepared.ops[0].adsr, { s: 0 }), TypeError);
  assert.throws(() => preparedVoiceValue({ ...voice(), lfo: { ...voice().lfo, waveform: 'invalid' } } as unknown as VoiceInput));
});

test('normalizing a prepared patch detaches mutable envelopes and expressive objects', () => {
  const source = voice();
  source.ops[0].keyScale = { breakpoint: 60, leftDbPerOctave: 1, rightDbPerOctave: 2 };
  source.pitchEnvelope = { a: 0.1, d: 0.2, r: 0.3, initial: 0, peak: 100, sustain: 0, final: 0 };
  const prepared = prepareVoice(source);
  const copy = normalizeVoice(prepared as unknown as VoiceInput);
  copy.ops[0].ratio = 3;
  copy.ops[0].adsr.s = 0.25;
  copy.ops[0].keyScale!.breakpoint = 48;
  copy.pitchEnvelope!.peak = 200;
  copy.lfo.rate = 7;
  assert.equal(copy.ops[0].ratio, 3);
  assert.equal(copy.ops[0].adsr.s, 0.25);
  assert.equal(copy.ops[0].keyScale!.breakpoint, 48);
  assert.equal(copy.pitchEnvelope!.peak, 200);
  assert.equal(copy.lfo.rate, 7);
  assert.equal(prepared.ops[0].ratio, source.ops[0].ratio);
  assert.equal(prepared.ops[0].adsr.s, source.ops[0].adsr.s);
  assert.equal(prepared.ops[0].keyScale!.breakpoint, 60);
  assert.equal(prepared.pitchEnvelope!.peak, 100);
  assert.equal(prepared.lfo.rate, source.lfo.rate);
});

test('current targets accept booleans and bounded weights as detached immutable numeric tuples', () => {
  const amTargets: [boolean, boolean, number, number] = [true, false, 0.5, 1];
  const pmTargets: [number, number, boolean, boolean] = [0, 0.25, true, false];
  const source = { ...voice(), lfo: { ...voice().lfo, amTargets, pmTargets } };
  const withoutVersion = { algorithm: source.algorithm, feedback: source.feedback, ops: source.ops, lfo: source.lfo };
  const snapshots = [normalizeVoice(source), normalizeVoice(withoutVersion), prepareVoice(source), validateVoice(source)];
  amTargets[0] = false;
  pmTargets[1] = 1;
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot.lfo.amTargets, [1, 0, 0.5, 1]);
    assert.deepEqual(snapshot.lfo.pmTargets, [0, 0.25, 1, 0]);
    assert.throws(() => Object.assign(snapshot.lfo.amTargets!, { 0: 0 }), TypeError);
    assert.throws(() => Object.assign(snapshot.lfo.pmTargets!, { 1: 0 }), TypeError);
  }
});

test('every explicit legacy LFO rejects operator targets rather than silently accepting new fields', () => {
  for (const version of [1, 2, 3, 4, 5] as const) {
    const source = { ...voice(), version, lfo: { rate: 1, amDepth: 0.5, pmDepth: 20 } };
    for (const key of ['amTargets', 'pmTargets'] as const) {
      const invalid = { ...source, lfo: { ...source.lfo, [key]: [true, false, 0.5, 1] } };
      assert.throws(() => normalizeVoice(invalid as unknown as VoiceInput), TypeError);
      assert.throws(() => validateVoice(invalid), TypeError);
    }
  }
});

test('target bounds stay strict for single voices and clamp only finite bank values', () => {
  for (const key of ['amTargets', 'pmTargets'] as const) {
    for (let index = 0; index < 4; index++) {
      for (const value of [-0.001, 1.001, -1e300, 1e300]) {
        const targets = [0, 0.25, 0.5, 1];
        targets[index] = value;
        const source = { ...voice(), lfo: { ...voice().lfo, [key]: targets } };
        assert.throws(() => normalizeVoice(source as unknown as VoiceInput), RangeError);
        const expected = targets.slice();
        expected[index] = value < 0 ? 0 : 1;
        assert.deepEqual(validateVoice(source).lfo[key], expected);
      }
      for (const value of [NaN, Infinity, -Infinity, undefined, null, '0.5', {}, []]) {
        const targets: unknown[] = [0, 0.25, 0.5, 1];
        targets[index] = value;
        const source = { ...voice(), lfo: { ...voice().lfo, [key]: targets } };
        assert.throws(() => normalizeVoice(source as unknown as VoiceInput), TypeError);
        assert.throws(() => validateVoice(source), TypeError);
      }
    }
  }
});

test('target tuples require dense own data and reject accessors without executing them', () => {
  let reads = 0;
  const getter = () => { reads++; return 1; };
  for (const key of ['amTargets', 'pmTargets'] as const) {
    for (const convert of [normalizeVoice, validateVoice]) {
      const accessorField = voice();
      Object.defineProperty(accessorField.lfo, key, { get: getter });
      assert.throws(() => convert(accessorField), TypeError);
      const sparse = [1, 1, 1, 1];
      delete (sparse as Array<number | undefined>)[1];
      const inherited = [1, 1, 1, 1];
      delete (inherited as Array<number | undefined>)[2];
      const prototype = Object.create(Array.prototype) as object;
      Object.defineProperty(prototype, '2', { get: getter });
      Object.setPrototypeOf(inherited, prototype);
      const accessor = [1, 1, 1, 1];
      Object.defineProperty(accessor, '0', { get: getter });
      const extra = [1, 1, 1, 1];
      Object.defineProperty(extra, 'extra', { get: getter });
      const symbol = Object.assign([1, 1, 1, 1], { [Symbol('extra')]: 1 });
      for (const targets of [sparse, inherited, accessor, extra, symbol, [], [1, 1, 1], [1, 1, 1, 1, 1], undefined, null, { 0: 1, 1: 1, 2: 1, 3: 1, length: 4 }]) {
        const source = { ...voice(), lfo: { ...voice().lfo, [key]: targets } };
        assert.throws(() => convert(source as unknown as VoiceInput), TypeError);
      }
    }
  }
  assert.equal(reads, 0);
});
