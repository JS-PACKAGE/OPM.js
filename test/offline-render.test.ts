import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADROOM, renderNote, Synth } from '../src/core/index.js';
import type { Voice } from '../src/voices/schema.js';

function voice(): Voice {
  return {
    version: 3, name: 'offline', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0 },
    ops: Array.from({ length: 4 }, (_, index) => ({
      ratio: 1, level: index === 0 ? 1 : 0, detune: 0,
      adsr: { a: 0, d: 0, s: 1, r: 0.06 },
    })) as unknown as Voice['ops'],
  };
}

function rms(samples: Float32Array) {
  let power = 0;
  for (const sample of samples) power += sample * sample;
  return Math.sqrt(power / samples.length);
}

test('offline buffers include held note, release and a silent filter tail', () => {
  const sampleRate = 8000;
  const duration = 0.1;
  const release = 0.06;
  const { samples, diagnostics, sampleRate: actualRate } = renderNote({ voice: voice(),
    note: 69, duration, sampleRate });
  assert.equal(actualRate, sampleRate);
  assert.deepEqual(diagnostics, { errors: 0 });
  assert.ok(samples instanceof Float32Array);
  assert.ok(samples.length > (duration + release) * sampleRate);
  assert.ok(samples.length < (duration + release + 0.02) * sampleRate);
  assert.ok(rms(samples.subarray(200, 600)) > 0.03, 'held note is audible');
  assert.ok(rms(samples.subarray(960, 1120)) < rms(samples.subarray(200, 600)) * 0.2,
    'release is quieter than the held note');
  assert.ok(samples.subarray(samples.length - 32).every(sample => Math.abs(sample) < 1e-5),
    'rendered buffer ends after the audible release');
});

test('offline velocity scales audible samples without clipping and repeated renders reproduce exactly', () => {
  const input = { voice: voice(), note: 60, duration: 0.04, sampleRate: 8000 };
  const full = renderNote(input);
  const half = renderNote({ ...input, velocity: 0.5 });
  const mute = renderNote({ ...input, velocity: 0 });
  assert.deepEqual(renderNote(input).samples, full.samples);
  assert.ok(rms(full.samples) > 0.01);
  assert.ok(full.samples.every(sample => Number.isFinite(sample) && Math.abs(sample) <= HEADROOM));
  assert.ok(mute.samples.every(sample => sample === 0));
  assert.ok(rms(half.samples) < rms(full.samples) && rms(half.samples) > rms(full.samples) * 0.45);
});
