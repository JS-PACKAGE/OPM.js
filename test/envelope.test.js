import test from 'node:test';
import assert from 'node:assert/strict';
import { envelopeAt } from '../src/core/index.js';

function near(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
}

test('attack, decay, and release interpolate in dB, including a release during attack', () => {
  const adsr = { a: 0.04, d: 0.06, s: 0.25, r: 0.08 };
  const floor = 10 ** (-96 / 20);
  const attackMidpoint = 10 ** (-48 / 20);
  near(envelopeAt(0, 0.17, adsr), 0);
  near(envelopeAt(0.02, 0.17, adsr), attackMidpoint);
  near(envelopeAt(0.04, 0.17, adsr), 1);
  near(envelopeAt(0.07, 0.17, adsr), Math.sqrt(adsr.s));
  near(envelopeAt(0.1, 0.17, adsr), adsr.s);
  near(envelopeAt(0.17, 0.17, adsr), adsr.s);
  near(envelopeAt(0.21, 0.17, adsr), Math.sqrt(adsr.s * floor));
  near(envelopeAt(0.25, 0.17, adsr), 0);

  near(envelopeAt(0.02, 0.02, adsr), attackMidpoint);
  near(envelopeAt(0.06, 0.02, adsr), Math.sqrt(attackMidpoint * floor));
  near(envelopeAt(0.1, 0.02, adsr), 0);
});

test('ADSR boundaries land on the same elapsed time at different sample rates', () => {
  const adsr = { a: 0.025, d: 0.05, s: 0.5, r: 0.075 };
  const gate = 0.125;
  for (const sampleRate of [8000, 48000]) {
    const atFrame = frame => envelopeAt(frame / sampleRate, gate, adsr);
    near(atFrame(0), 0);
    near(atFrame(0.025 * sampleRate), 1);
    near(atFrame(0.075 * sampleRate), 0.5);
    near(atFrame(gate * sampleRate), 0.5);
    assert.ok(atFrame((gate + adsr.r) * sampleRate - 1) > 0);
    near(atFrame((gate + adsr.r) * sampleRate), 0);
  }

  const noSustain = { a: 0, d: 0.02, s: 0, r: 0.1 };
  near(envelopeAt(0.02, 0.1, noSustain), 0);
  near(envelopeAt(0.05, 0.1, noSustain), 0);
  near(envelopeAt(0.01, 0, adsr), 0);
  near(envelopeAt(0.1, 0.1, { ...adsr, r: 0 }), 0);
});
