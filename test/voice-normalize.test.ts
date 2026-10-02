import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoice } from '../src/core/synth.js';
import { brass } from '../src/voices/brass.js';
import type { FourOperators, Operator } from '../src/voices/schema.js';

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
  assert.throws(() => normalizeVoice(nested), /must be data/);
  assert.equal(getterCalls, 0);

  const sparse = voice();
  delete (sparse.ops as Array<Operator | undefined>)[2];
  assert.throws(() => normalizeVoice(sparse as unknown as Parameters<typeof normalizeVoice>[0]), /four data operators/);

  const accessorSlot = voice();
  Object.defineProperty(accessorSlot.ops, '2', { get() { getterCalls++; throw Error('slot getter ran'); } });
  assert.throws(() => normalizeVoice(accessorSlot), /four data operators/);
  assert.equal(getterCalls, 0);
});
