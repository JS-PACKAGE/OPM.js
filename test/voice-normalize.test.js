import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoice } from '../src/core/synth.js';
import { brass } from '../src/voices/brass.js';

function voice() {
  return { ...brass, lfo: { ...brass.lfo }, ops: brass.ops.map(op => ({ ...op, adsr: { ...op.adsr } })) };
}

test('optional metadata stays absent and default modulation is applied without mutating input', () => {
  const source = voice();
  delete source.name;
  delete source.version;
  delete source.modIndex;
  delete source.lfo;
  const normalized = normalizeVoice(source);
  assert.equal(normalized.modIndex, 4);
  assert.deepEqual(normalized.lfo, { rate: 0, amDepth: 0, pmDepth: 0 });
  assert.equal(Object.hasOwn(normalized, 'name'), false);
  assert.equal(Object.hasOwn(normalized, 'version'), false);
  assert.equal(Object.hasOwn(source, 'modIndex'), false);
  assert.equal(Object.hasOwn(source, 'lfo'), false);

  const named = normalizeVoice(voice());
  assert.equal(named.name, 'brass');
  assert.equal(named.version, 1);
  assert.equal(named.modIndex, brass.modIndex);
});

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
  assert.throws(() => normalizeVoice(nested), /must be data/);
  assert.equal(getterCalls, 0);

  const sparse = voice();
  delete sparse.ops[2];
  assert.throws(() => normalizeVoice(sparse), /four data operators/);

  const accessorSlot = voice();
  Object.defineProperty(accessorSlot.ops, '2', { get() { getterCalls++; throw Error('slot getter ran'); } });
  assert.throws(() => normalizeVoice(accessorSlot), /four data operators/);
  assert.equal(getterCalls, 0);
});
