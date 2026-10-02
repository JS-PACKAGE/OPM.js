import test from 'node:test';
import assert from 'node:assert/strict';
import { lfoValue } from '../src/core/lfo.js';
import type { LFO } from '../src/voices/schema.js';

const TAU = 2 * Math.PI;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);

test('waveforms follow their characteristic cycle shapes', () => {
  const phases = [0, Math.PI / 4, Math.PI / 2, Math.PI, 3 * Math.PI / 2, 7 * Math.PI / 4];
  const expected: Record<LFO['waveform'], number[]> = {
    sine: [0, Math.SQRT1_2, 1, 0, -1, -Math.SQRT1_2],
    triangle: [0, 0.5, 1, 0, -1, -0.5],
    saw: [-1, -0.75, -0.5, 0, 0.5, 0.75],
    square: [1, 1, 1, -1, -1, -1],
  };
  for (const waveform of Object.keys(expected) as LFO['waveform'][]) {
    phases.forEach((phase, index) => close(lfoValue(phase, waveform), expected[waveform][index]));
  }
});

test('every waveform is bounded and periodic across positive and negative phase', () => {
  for (const waveform of ['sine', 'triangle', 'saw', 'square'] as const) {
    for (let index = -257; index <= 257; index++) {
      const phase = (index + 0.137) * TAU / 256;
      const value = lfoValue(phase, waveform);
      assert.ok(value >= -1 && value <= 1);
      close(lfoValue(phase + 10 * TAU, waveform), value);
      close(lfoValue(phase - 10 * TAU, waveform), value);
    }
  }
  const epsilon = 1e-9;
  assert.ok(lfoValue(TAU - epsilon, 'saw') > 0.999999);
  assert.equal(lfoValue(TAU, 'saw'), -1);
  assert.equal(lfoValue(Math.PI - epsilon, 'square'), 1);
  assert.equal(lfoValue(Math.PI, 'square'), -1);
  close(lfoValue(TAU, 'triangle'), lfoValue(0, 'triangle'));
  for (const phase of [NaN, Infinity, -Infinity]) assert.throws(() => lfoValue(phase, 'sine'), RangeError);
});
