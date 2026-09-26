import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth } from '../src/core/index.js';

function voice(algorithm, levels, feedback = 0) {
  return {
    algorithm, feedback, modIndex: 12,
    ops: levels.map((level, index) => ({
      ratio: index + 1, level, detune: 0,
      adsr: { a: 0, d: 0, s: 1, r: 0.02 },
    })),
  };
}

function render(input) {
  const synth = new Synth(16000);
  synth.noteOn(input, 57);
  const left = new Float32Array(1024);
  const right = new Float32Array(1024);
  synth.render(left, right);
  assert.deepEqual(right, left);
  return left;
}

function rms(samples) {
  let power = 0;
  for (const sample of samples) power += sample * sample;
  return Math.sqrt(power / samples.length);
}

function distance(a, b) {
  let power = 0;
  for (let i = 0; i < a.length; i++) power += (a[i] - b[i]) ** 2;
  return Math.sqrt(power / a.length);
}

test('a silent intermediate operator blocks a chain but not a direct modulator route', () => {
  const carrierOnly = [0, 0, 0, 1];
  const withModulator = [1, 0, 0, 1];
  const chain = render(voice(0, withModulator));
  const chainWithoutModulator = render(voice(0, carrierOnly));
  assert.deepEqual(chain, chainWithoutModulator, 'silent intermediate operators cannot relay modulation');

  const direct = render(voice(2, withModulator));
  const directWithoutModulator = render(voice(2, carrierOnly));
  assert.ok(rms(directWithoutModulator) > 0.03);
  assert.ok(distance(direct, directWithoutModulator) > 0.02,
    'an operator with a direct path to the carrier changes its waveform');
});

test('only carriers sound alone, and feedback changes waveform shape when operator one is audible', () => {
  const loneModulator = [1, 0, 0, 0];
  assert.ok(render(voice(0, loneModulator)).every(sample => sample === 0));
  assert.ok(rms(render(voice(7, loneModulator))) > 0.01,
    'the same operator is audible when routed as a carrier');

  const plain = render(voice(7, loneModulator));
  const fedBack = render(voice(7, loneModulator, 7));
  const plainRms = rms(plain);
  const feedbackRms = rms(fedBack);
  assert.ok(feedbackRms > 0.01);
  let shapeError = 0;
  for (let i = 0; i < plain.length; i++) {
    shapeError += (plain[i] / plainRms - fedBack[i] / feedbackRms) ** 2;
  }
  assert.ok(Math.sqrt(shapeError / plain.length) > 0.05,
    'feedback changes timbre, not just overall amplitude');
  assert.deepEqual(render(voice(7, [0, 0, 0, 1])), render(voice(7, [0, 0, 0, 1], 7)),
    'feedback of an inaudible operator does not alter an independent carrier');
});
