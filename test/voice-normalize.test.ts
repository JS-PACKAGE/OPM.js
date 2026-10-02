import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoice, prepareVoice, preparedVoiceValue } from '../src/voices/normalize.js';
import { brass } from '../src/voices/brass.js';
import { validateVoice } from '../src/voices/schema.js';
import type { FourOperators, Operator, VoiceInput } from '../src/voices/schema.js';

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

test('legacy formats retain their old operator and LFO boundaries and canonicalize to v5', () => {
  const { waveform: _, ...lfo } = voice().lfo;
  for (const version of [1, 2, 3] as const) {
    const source = { ...voice(), version, lfo };
    const normalized = normalizeVoice(source as VoiceInput);
    assert.deepEqual(normalized, { ...voice(), version: 5 });
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
  for (const version of [undefined, 4, 5] as const) {
    const source = { ...voice(), lfo };
    const input = version === undefined ? { algorithm: source.algorithm, feedback: source.feedback, ops: source.ops, lfo } : { ...source, version } as VoiceInput;
    assert.equal(normalizeVoice(input).lfo.waveform, 'sine');
  }
  assert.equal(validateVoice({ ...voice(), lfo }).lfo.waveform, 'sine');
  for (const waveform of ['sine', 'triangle', 'saw', 'square'] as const) {
    const source = { ...voice(), lfo: { ...lfo, waveform } };
    assert.equal(normalizeVoice(source).lfo.waveform, waveform);
    assert.equal(validateVoice(source).lfo.waveform, waveform);
  }
  for (const waveform of ['noise', '', null, undefined, 0, {}, []]) {
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
  assert.throws(() => preparedVoiceValue({ ...voice(), lfo: { ...voice().lfo, waveform: 'noise' } } as unknown as VoiceInput));
});
