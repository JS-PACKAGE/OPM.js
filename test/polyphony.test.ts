import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADROOM, Synth } from '../src/core/index.js';
import type { VoiceInput } from '../src/voices/schema.js';

function voice(): VoiceInput {
  return {
    algorithm: 7, feedback: 0,
    ops: Array.from({ length: 4 }, (_, index) => ({
      ratio: 1, level: index === 0 ? 1 : 0, detune: 0,
      adsr: { a: 0, d: 0, s: 1, r: 0.05 },
    })) as unknown as VoiceInput['ops'],
  };
}

function render(synth: Synth, length: number) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  synth.render(left, right);
  assert.deepEqual(right, left);
  return left;
}

function peak(samples: Float32Array) {
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

test('release-first steals released gates by age before held notes', () => {
  const synth = new Synth(16000, 3, { stealing: 'release-first' });
  const terminal: [number, string][] = [];
  synth.onVoiceEnded = (id, reason) => terminal.push([id, reason]);
  for (let id = 1; id <= 3; id++) synth.noteOn(voice(), 60 + id, id);
  synth.noteOff(3);
  synth.noteOff(2);
  synth.noteOn(voice(), 65, 4);
  synth.noteOn(voice(), 67, 5);
  assert.deepEqual(terminal, [[2, 'stolen'], [3, 'stolen']]);
  assert.equal(synth.noteOff(1), true, 'older held gate survived both released voices');
  synth.noteOn(voice(), 69, 6);
  assert.deepEqual(terminal[2], [1, 'stolen']);
});

test('quietest uses envelope, velocity and current expression instead of waveform crossings', () => {
  const synth = new Synth(16000, 3, { stealing: 'quietest' });
  const stolen: number[] = [];
  synth.onVoiceEnded = (id, reason) => { if (reason === 'stolen') stolen.push(id); };
  synth.noteOn(voice(), 60, 1, { velocity: 1 });
  synth.noteOn(voice(), 64, 2, { velocity: 0.1 });
  synth.noteOn(voice(), 67, 3, { velocity: 0.5 });
  // All oscillators still have the same zero initial sample.
  synth.noteOn(voice(), 69, 4);
  synth.updateNote(1, { expression: 0 });
  synth.noteOn(voice(), 72, 5);
  synth.updateNote(4, { expression: 0.5 });
  synth.noteOn(voice(), 74, 6);
  assert.deepEqual(stolen, [2, 1, 3], 'equal audibility breaks ties by oldest admission');
  assert.equal(synth.noteOff(4), true);
  assert.equal(synth.noteOff(5), true);
  assert.equal(synth.noteOff(6), true);
});

test('allNotesOff closes every logical gate without restarting existing release tails', () => {
  const synth = new Synth(16000, 2), reference = new Synth(16000, 2);
  const terminal: [number, string][] = [];
  synth.onVoiceEnded = (id, reason) => terminal.push([id, reason]);
  for (const instance of [synth, reference]) {
    instance.noteOn(voice(), 60, 1);
    instance.noteOn(voice(), 67, 2);
    render(instance, 128);
  }
  synth.allNotesOff();
  reference.noteOff(1);
  reference.noteOff(2);
  assert.deepEqual(render(synth, 128), render(reference, 128));
  synth.allNotesOff();
  assert.equal(synth.noteOff(1), false);
  assert.equal(synth.noteOff(2), false);
  assert.deepEqual(render(synth, 1024), render(reference, 1024));
  assert.deepEqual(terminal.sort((a, b) => a[0] - b[0]), [[1, 'ended'], [2, 'ended']]);
  assert.ok(render(synth, 128).every(sample => sample === 0));
});

test('panic clears stolen tails and spill before reentrant cancellation callbacks and recycles cleanly', () => {
  const synth = new Synth(16000, 2);
  const terminal = new Map<number, string>();
  synth.onVoiceEnded = (id, reason) => {
    assert.equal(terminal.has(id), false, `note ${id} receives exactly one logical terminal event`);
    terminal.set(id, reason);
    if (id === 11 && reason === 'cancelled') {
      synth.noteOn(voice(), 67, 13);
      synth.panic();
    }
    if (id === 13 && reason === 'cancelled') synth.noteOn(voice(), 69, 14);
  };
  synth.noteOn(voice(), 60, 1);
  render(synth, 128);
  for (let id = 2; id <= 12; id++) {
    synth.noteOn(voice(), 60 + id, id);
    render(synth, 1);
  }
  synth.panic();
  for (let id = 1; id <= 10; id++) assert.equal(terminal.get(id), 'stolen');
  for (const id of [11, 12, 13]) assert.equal(terminal.get(id), 'cancelled');
  assert.equal(terminal.has(14), false, 'callback-admitted replacement is a new logical gate');
  assert.ok(peak(render(synth, 256)) > 0.02);
  synth.panic();
  assert.equal(terminal.get(14), 'cancelled');
  assert.equal(synth.noteOff(14), false);
  assert.ok(render(synth, 512).every(sample => sample === 0), 'no hidden fade or spill survives panic');
  assert.equal(synth.errorCount, 0, 'no cancellation callback assertion was swallowed');
  const fresh = new Synth(16000, 2);
  synth.noteOn(voice(), 57.5, 15);
  fresh.noteOn(voice(), 57.5, 15);
  assert.deepEqual(render(synth, 512), render(fresh, 512), 'recycled DSP starts with fresh phase and filters');
});

test('recycled voices replace every modulation edge and carrier after topology changes', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const pooled = new Synth(16000, 1, { quality });
    for (const previous of [7, 1, 5, 0, 2, 6, 3, 4] as const) {
      const patch = voice();
      patch.algorithm = previous;
      patch.ops.forEach((op, index) => { op.level = 0.2 + index * 0.1; op.ratio = index + 1; });
      for (let id = 1; id <= 12; id++) {
        pooled.noteOn(patch, 60, id);
        render(pooled, 1);
      }
      pooled.panic();
      for (const algorithm of [0, 1, 2, 3, 4, 5, 6, 7] as const) {
        patch.algorithm = algorithm;
        const fresh = new Synth(16000, 1, { quality });
        pooled.noteOn(patch, 63, 20);
        fresh.noteOn(patch, 63, 20);
        assert.deepEqual(render(pooled, 256), render(fresh, 256),
          `${quality}: ${previous} to ${algorithm} must use only the new topology`);
        pooled.panic();
      }
    }
  }
});
