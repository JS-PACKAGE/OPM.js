import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADROOM, Synth } from '../src/core/index.js';

function voice() {
  return {
    algorithm: 7, feedback: 0,
    ops: Array.from({ length: 4 }, (_, index) => ({
      ratio: 1, level: index === 0 ? 1 : 0, detune: 0,
      adsr: { a: 0, d: 0, s: 1, r: 0.05 },
    })),
  };
}

function render(synth, length) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  synth.render(left, right);
  assert.deepEqual(right, left);
  return left;
}

function peak(samples) {
  let maximum = 0;
  for (const sample of samples) maximum = Math.max(maximum, Math.abs(sample));
  return maximum;
}

test('a released voice still occupies a slot and can be stolen without silencing survivors', () => {
  const synth = new Synth(16000, 2);
  synth.noteOn(voice(), 60, 11);
  synth.noteOn(voice(), 64, 12);
  render(synth, 128);
  assert.equal(synth.noteOff(11), true);
  synth.noteOn(voice(), 67, 13);
  assert.equal(synth.noteOff(11), false, 'stolen release no longer owns its note ID');
  assert.equal(synth.noteOff(12), true);
  assert.equal(synth.noteOff(12), false, 'a note can only be released once');
  const remaining = render(synth, 1200);
  assert.ok(peak(remaining.subarray(100)) > 0.02, 'third note remains audible after the other release');
  assert.equal(synth.noteOff(13), true);
  render(synth, 1200);
  assert.equal(synth.voices.length, 0, 'completed releases free their voice slots');
  assert.equal(synth.noteOff(13), false);
  synth.noteOn(voice(), 69, 11);
  assert.equal(synth.noteOff(11), true, 'stolen IDs are available to new notes');
});

test('stealing follows voice age even when the younger voice is already releasing', () => {
  const synth = new Synth(16000, 2);
  synth.noteOn(voice(), 60, 1);
  synth.noteOn(voice(), 64, 2);
  assert.equal(synth.noteOff(2), true);
  synth.noteOn(voice(), 67, 3);
  assert.equal(synth.noteOff(1), false, 'oldest held note was stolen');
  assert.equal(synth.noteOff(2), false, 'younger releasing note remains in release');
  assert.equal(synth.noteOff(3), true);
});

test('mixing coincident notes grows audibly but saturates before polyphonic clipping', () => {
  const single = new Synth(16000);
  single.noteOn(voice(), 60);
  const onePeak = peak(render(single, 512));
  const many = new Synth(16000);
  for (let id = 1; id <= 8; id++) many.noteOn(voice(), 60, id);
  const mixed = render(many, 512);
  assert.ok(onePeak > 0.02);
  assert.ok(peak(mixed) > onePeak * 2, 'polyphony should add energy');
  assert.ok(peak(mixed) < onePeak * 8, 'summed notes should saturate, not clip');
  assert.ok(mixed.every(sample => Number.isFinite(sample) && Math.abs(sample) <= HEADROOM));
});
