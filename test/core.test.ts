import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth, normalizeVoice } from '../src/core/synth.js';
import type { Algorithm, VoiceInput } from '../src/voices/schema.js';

function voice<T extends object>(overrides: T = {} as T) {
  return {
    algorithm: 0 as Algorithm,
    feedback: 0 as Algorithm,
    ops: Array.from({ length: 4 }, (_, i) => ({
      ratio: i + 1, level: i === 3 ? 0.8 : 0.5, detune: 0,
      adsr: { a: 0.005, d: 0.02, s: 0.7, r: 0.05 },
    })) as unknown as VoiceInput['ops'],
    ...overrides,
  };
}

function audio(synth: Synth, length: number) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  synth.render(left, right);
  assert.deepEqual(left, right);
  assert.ok(left.every(Number.isFinite));
  return left;
}

function rms(array: Float32Array, start: number, end: number) {
  let sum = 0;
  for (let i = start; i < end; i++) sum += array[i] ** 2;
  return Math.sqrt(sum / (end - start));
}

function differs(a: Float32Array, b: Float32Array) {
  return a.some((value, index) => Math.abs(value - b[index]) > 1e-5);
}

test('note-on, sustain, and note-off follow per-operator attack, decay, and release', () => {
  const sampleRate = 16000;
  const v = voice({ algorithm: 7, ops: Array.from({ length: 4 }, (_, i) => ({
    ratio: i + 1, level: i === 0 ? 1 : 0, detune: 0,
    adsr: { a: 0.05, d: 0.06, s: 0.15, r: 0.08 },
  })) });
  const synth = new Synth(sampleRate);
  const id = synth.noteOn(v, 60, 100);
  assert.equal(id, 100);
  const held = audio(synth, 4000);
  assert.ok(rms(held, 0, 160) < rms(held, 600, 800) * 0.2, 'attack grows in dB');
  assert.ok(rms(held, 2000, 2600) < rms(held, 850, 1050) * 0.35, 'decay reaches sustain');
  assert.ok(rms(held, 2800, 3400) > 0.005, 'sustain remains audible');
  assert.equal(synth.noteOff(id), true);
  assert.equal(synth.noteOff(id), false);
  const released = audio(synth, 2400);
  assert.ok(rms(released, 1700, 2000) < rms(released, 0, 300) * 0.02, 'release fades to silence');
  assert.ok(released.subarray(2100).every(value => value === 0));
});


test('all eight algorithms route distinct carrier/modulator topologies, and feedback changes timbre', () => {
  const outputs = Array.from({ length: 8 }, (_, algorithm) => {
    const synth = new Synth(22050);
    synth.noteOn(voice({ algorithm }), 60);
    return audio(synth, 1024);
  });
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      assert.ok(differs(outputs[i], outputs[j]), `algorithms ${i} and ${j} must differ`);
    }
  }
  const withFeedback = new Synth(22050);
  withFeedback.noteOn(voice({ feedback: 7 }), 60);
  assert.ok(differs(outputs[0], audio(withFeedback, 1024)), 'feedback changes audio');
});

test('detune and LFO AM/PM change audio without introducing nonfinite samples', () => {
  const base = new Synth(22050);
  base.noteOn(voice(), 69);
  const reference = audio(base, 8192);
  for (const variation of [
    { ops: voice().ops.map(op => ({ ...op, detune: 70 })) },
    { lfo: { rate: 8, amDepth: 0.9, pmDepth: 0 } },
    { lfo: { rate: 8, amDepth: 0, pmDepth: 500 } },
  ]) {
    const synth = new Synth(22050);
    synth.noteOn(voice(variation), 69);
    assert.ok(differs(reference, audio(synth, 8192)));
    assert.equal(synth.errorCount, 0);
  }
});

test('normalization rejects malformed numbers and objects without invoking getters', () => {
  const valid = normalizeVoice(voice());
  assert.equal(valid.ops.length, 4);
  for (const bad of [
    voice({ algorithm: 8 }), voice({ feedback: -1 }), voice({ ops: [] }),
    voice({ ops: voice().ops.map((op, i) => i ? op : { ...op, ratio: Infinity }) }),
    voice({ ops: voice().ops.map((op, i) => i ? op : { ...op, level: -1 }) }),
    voice({ ops: voice().ops.map((op, i) => i ? op : { ...op, adsr: { ...op.adsr, s: NaN } }) }),
    voice({ lfo: { rate: 200, amDepth: 0, pmDepth: 0 } }),
    voice({ constructor: { prototype: { polluted: true } } }),
    Object.assign(Object.create({ algorithm: 0 }) as object, voice()),
  ]) {
    assert.throws(() => normalizeVoice(bad as unknown as Parameters<typeof normalizeVoice>[0]));
  }
  const accessor = voice();
  Object.defineProperty(accessor, 'algorithm', { get() { throw Error('getter invoked'); } });
  assert.throws(() => normalizeVoice(accessor), /must be data/);
});

test('notes own snapshots; finite stereo is deterministic across chunks and render offsets', () => {
  const v = voice({ lfo: { rate: 4, amDepth: 0.1, pmDepth: 50 } });
  const first = new Synth(16000);
  first.noteOn(v, 64);
  v.ops[0].ratio = 23;
  v.lfo.rate = 19;
  const output = audio(first, 1024);
  const second = new Synth(16000);
  second.noteOn(voice({ lfo: { rate: 4, amDepth: 0.1, pmDepth: 50 } }), 64);
  const left = new Float32Array(1044).fill(0.25);
  const right = new Float32Array(1044).fill(0.25);
  second.render(left, right, 10, 1024);
  assert.deepEqual(left.subarray(10, 1034), output);
  assert.ok(left.subarray(0, 10).every(value => value === 0.25));
  assert.ok(left.subarray(1034).every(value => value === 0.25));
  assert.deepEqual(left, right);
  const again = new Synth(16000);
  again.noteOn(voice({ lfo: { rate: 4, amDepth: 0.1, pmDepth: 50 } }), 64);
  const pieces = new Float32Array(1024);
  again.render(pieces, pieces, 0, 400);
  again.render(pieces, pieces, 400, 624);
  assert.deepEqual(Buffer.from(pieces.buffer), Buffer.from(output.buffer));
  assert.equal(again.currentFrame, 1024);
  const silent = new Synth(16000);
  const silence = audio(silent, 16);
  assert.ok(silence.every(value => value === 0));
  assert.equal(silent.currentFrame, 16);
});

test('voice ceiling steals the oldest note and preserves headroom with eight voices', () => {
  assert.throws(() => new Synth(0));
  assert.throws(() => new Synth(48000, 9));
  const synth = new Synth(16000, 2);
  synth.noteOn(voice(), 60, 1);
  synth.noteOn(voice(), 64, 2);
  synth.noteOn(voice(), 67, 3);
  assert.equal(synth.voices.length, 2);
  assert.equal(synth.noteOff(1), false);
  assert.equal(synth.noteOff(2), true);
  assert.throws(() => synth.noteOn(voice(), 128));
  assert.throws(() => synth.noteOn(voice(), 60, -1));
  assert.throws(() => synth.noteOn(voice(), 60, 3), /already active/);
  const many = new Synth(16000);
  for (let id = 1; id <= 8; id++) many.noteOn(voice({ algorithm: 7 }), 60, id);
  const samples = audio(many, 1024);
  assert.ok(samples.some(value => value !== 0));
  assert.ok(samples.every(value => Math.abs(value) <= 0.7));
});

test('nonfinite DSP state snaps to silence and increments the error count', () => {
  const synth = new Synth(16000);
  synth.noteOn(voice(), 60);
  synth.voices[0].filters[0] = Infinity;
  assert.ok(audio(synth, 128).every(value => value === 0));
  assert.equal(synth.errorCount, 1);
  assert.equal(synth.voices.length, 0);
});

test('native buffer bounds ignore shadow metadata and reject forged channels without advancing sound', () => {
  const synth = new Synth(8000), reference = new Synth(8000);
  synth.noteOn(voice(), 60.5);
  reference.noteOn(voice(), 60.5);
  const left = new Float32Array(6), right = new Float32Array(6);
  let reads = 0;
  for (const channel of [left, right]) {
    Object.defineProperty(channel, 'length', { get() { reads++; return 64; } });
  }
  synth.render(left, right);
  const expectedLeft = new Float32Array(6), expectedRight = new Float32Array(6);
  reference.render(expectedLeft, expectedRight);
  assert.equal(reads, 0);
  assert.equal(synth.currentFrame, 6);
  assert.deepEqual(left.subarray(0), expectedLeft);
  assert.deepEqual(right.subarray(0), expectedRight);
  for (const invalid of [Object.create(Float32Array.prototype), new Proxy(new Float32Array(6), {}), new Float64Array(6)]) {
    assert.throws(() => synth.render(invalid as Float32Array, right), RangeError);
  }
  assert.throws(() => synth.render(left, right, 0, 7), RangeError);
  const hostileOffset = { valueOf() { reads++; return 0; } };
  assert.throws(() => synth.render(left, right, hostileOffset as unknown as number), RangeError);
  assert.equal(reads, 0);
  assert.equal(synth.currentFrame, 6);
  synth.render(left, right);
  reference.render(expectedLeft, expectedRight);
  assert.deepEqual(left.subarray(0), expectedLeft);
  assert.deepEqual(right.subarray(0), expectedRight);
  const idle = new Synth(8000);
  const silent = new Float32Array(6).fill(1);
  Object.defineProperty(silent, 'fill', { get() { reads++; throw Error('host method invoked'); } });
  idle.render(silent, right);
  assert.equal(reads, 0);
  assert.ok(silent.subarray(0).every(value => value === 0));
  assert.ok(right.subarray(0).every(value => value === 0));
  assert.equal(idle.currentFrame, 6);
});
