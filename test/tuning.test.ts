import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTuning, tuningFrequency } from '../src/core/tuning.js';
import type { TuningOptions } from '../src/core/tuning.js';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < expected * 1e-12, `${actual} differs from ${expected}`);

test('standard tuning and reference changes apply across the full MIDI range', () => {
  const standard = normalizeTuning({});
  for (const note of [0, 60, 69, 69.5, 127]) close(tuningFrequency(note, standard), 440 * 2 ** ((note - 69) / 12));
  const alternate = normalizeTuning({ referenceHz: 432 });
  assert.equal(tuningFrequency(69, alternate), 432);
  close(tuningFrequency(81, alternate), 864);
  for (const referenceHz of [20, 20000]) assert.equal(tuningFrequency(69, normalizeTuning({ referenceHz })), referenceHz);
});

test('fractional MIDI interpolates adjacent cents with safe endpoint handling', () => {
  const offsets = new Array<number>(128).fill(0);
  offsets[0] = -4800;
  offsets[69] = 100;
  offsets[70] = -200;
  offsets[126] = 200;
  offsets[127] = 4800;
  const tuning = normalizeTuning({ offsets });
  close(tuningFrequency(0, tuning), 440 * 2 ** (-69 / 12 - 4));
  close(tuningFrequency(69, tuning), 440 * 2 ** (100 / 1200));
  close(tuningFrequency(69.25, tuning), 440 * 2 ** (0.25 / 12 + 25 / 1200));
  close(tuningFrequency(69.5, tuning), 440 * 2 ** (0.5 / 12 - 50 / 1200));
  close(tuningFrequency(126.5, tuning), 440 * 2 ** (57.5 / 12 + 2500 / 1200));
  close(tuningFrequency(127, tuning), 440 * 2 ** (58 / 12 + 4));
  for (const note of [-1, 127.01, NaN, Infinity, -Infinity]) assert.throws(() => tuningFrequency(note, tuning), RangeError);
});

test('normalized tuning is detached and immutable', () => {
  const offsets = new Array<number>(128).fill(0);
  offsets[69] = 100;
  const input = { referenceHz: 432, offsets };
  const tuning = normalizeTuning(input);
  const frequency = tuningFrequency(69, tuning);
  offsets[69] = -1200;
  input.referenceHz = 440;
  assert.equal(tuningFrequency(69, tuning), frequency);
  assert.notStrictEqual(tuning.offsets, offsets);
  assert.throws(() => Object.assign(tuning, { referenceHz: 440 }), TypeError);
  assert.throws(() => Object.assign(tuning.offsets, { 69: 0 }), TypeError);
});

test('malformed tuning rejects unknown fields, invalid values, sparse tables and accessors without execution', () => {
  for (const input of [null, [], 440, '440', { unknown: 0 }, { [Symbol('offsets')]: 0 }, Object.create({ referenceHz: 440 })]) {
    assert.throws(() => normalizeTuning(input as TuningOptions), TypeError);
  }
  for (const referenceHz of [undefined, null, '440', NaN, Infinity, 19.99, 20000.01]) {
    assert.throws(() => normalizeTuning({ referenceHz } as TuningOptions), RangeError);
  }
  for (const offsets of [undefined, null, new Float64Array(128), [], new Array(128), new Array(127).fill(0), new Array(129).fill(0)]) {
    assert.throws(() => normalizeTuning({ offsets } as TuningOptions), TypeError);
  }
  for (const cents of [undefined, null, '0', NaN, Infinity, -4800.01, 4800.01]) {
    const offsets: unknown[] = new Array(128).fill(0);
    offsets[64] = cents;
    assert.throws(() => normalizeTuning({ offsets } as TuningOptions), RangeError);
  }
  let calls = 0;
  for (const key of ['referenceHz', 'offsets']) {
    const input = {};
    Object.defineProperty(input, key, { get() { calls++; throw Error('getter executed'); } });
    assert.throws(() => normalizeTuning(input), TypeError);
  }
  const offsets = new Array<number>(128).fill(0);
  Object.defineProperty(offsets, '69', { get() { calls++; throw Error('getter executed'); } });
  assert.throws(() => normalizeTuning({ offsets }), TypeError);
  assert.equal(calls, 0);
  const extra = Object.assign(new Array<number>(128).fill(0), { unexpected: 0 });
  assert.throws(() => normalizeTuning({ offsets: extra }), TypeError);
  assert.equal(tuningFrequency(69, normalizeTuning(Object.assign(Object.create(null), { referenceHz: 432 }))), 432);
});
