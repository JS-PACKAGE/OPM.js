import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth, renderNote, normalizeVoice, encodeWav } from '../src/core/index.js';
import { validateVoice } from '../src/voices/schema.js';
import type { LegacyVoice, LegacyVoiceV2, Voice } from '../src/voices/schema.js';

function voice(): Voice {
  return { version: 6, name: 'features', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: Array.from({ length: 4 }, (_, i) => ({ ratio: 1, level: i === 0 ? 1 : 0,
      detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.03 } })) as Voice['ops'] };
}
function audio(synth: Synth, frames: number) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  synth.render(left, right);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  return { left, right };
}
function rms(values: Float32Array) {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / values.length);
}

test('steals preserve the waveform at the boundary and fade without resetting phase', () => {
  const synth = new Synth(8000, 1), reference = new Synth(8000, 1);
  synth.noteOn(voice(), 60, 1);
  reference.noteOn(voice(), 60, 1);
  audio(synth, 173); audio(reference, 173);
  synth.noteOn(voice(), 64, 2, { velocity: 0 });
  const tail = audio(synth, 50).left;
  const continuation = audio(reference, 50).left;
  assert.equal(tail[0], continuation[0], 'first stolen sample retains complete DSP state');
  assert.ok(rms(tail.subarray(20, 40)) < rms(continuation.subarray(20, 40)));
  assert.ok(tail.subarray(40).every(sample => sample === 0));
  assert.equal(synth.noteOff(1), false);
});

test('exhausted tail pool carries nonzero sound through rapid steals with bounded work', () => {
  const synth = new Synth(8000), reference = new Synth(8000);
  for (let id = 1; id <= 8; id++) {
    synth.noteOn(voice(), 0, id, { velocity: 0.1 });
    reference.noteOn(voice(), 0, id, { velocity: 0.1 });
  }
  audio(synth, 220); audio(reference, 220);
  for (let id = 9; id <= 16; id++) synth.noteOn(voice(), 0, id, { velocity: 0 });
  audio(synth, 1); audio(reference, 1);
  for (let id = 17; id <= 24; id++) synth.noteOn(voice(), 0, id, { velocity: 0 });
  assert.equal(synth.voices.length, 8);
  assert.equal(synth.fades.length, 8);
  const first = audio(synth, 1).left[0];
  const expected = audio(reference, 1).left[0];
  assert.ok(Math.abs(expected) > 0.02, 'exhaustion occurs during audible output');
  assert.ok(Math.abs(first - expected) < 0.01, 'collapsed tails must not abruptly disappear');
  const tail = audio(synth, 50).left;
  assert.ok(tail.subarray(40).every(sample => sample === 0));
  assert.equal(synth.fades.length, 0);
});

test('logical terminal callbacks occur exactly once, including reused stolen IDs and errors', () => {
  const synth = new Synth(8000, 1);
  const events: Array<[number, string]> = [];
  synth.onVoiceEnded = (id, reason) => events.push([id, reason]);
  synth.noteOn(voice(), 60, 1);
  audio(synth, 50);
  synth.noteOn(voice(), 64, 2);
  assert.equal(synth.lastStolenId, 1);
  synth.fades[0].filters[0] = Infinity;
  audio(synth, 1);
  synth.noteOff(2);
  audio(synth, 400);
  synth.noteOn(voice(), 60, 1);
  assert.equal(synth.lastStolenId, null);
  synth.voices[0].filters[0] = Infinity;
  audio(synth, 200);
  assert.deepEqual(events, [[1, 'stolen'], [2, 'ended'], [1, 'error']]);
  assert.equal(synth.errorCount, 2);
});

test('terminal callbacks can start replacement notes without exceeding the voice limit', () => {
  for (const maxVoices of [1, 8]) {
    const synth = new Synth(8000, maxVoices);
    const events: Array<[number, string]> = [];
    for (let id = 1; id <= maxVoices; id++) synth.noteOn(voice(), 60, id);
    synth.onVoiceEnded = (id, reason) => {
      events.push([id, reason]);
      if (id === 1 && reason === 'stolen') synth.noteOn(voice(), 64, maxVoices + 2);
    };
    synth.noteOn(voice(), 62, maxVoices + 1);
    assert.equal(synth.voices.length, maxVoices);
    assert.ok(synth.voices.some(active => active.id === maxVoices + 2));
    assert.equal(new Set(synth.voices.map(active => active.id)).size, maxVoices);
    assert.deepEqual(events, [[1, 'stolen'], [2, 'stolen']]);
    assert.equal(synth.lastStolenId, 2, 'last admission is the nested callback note');
    audio(synth, 100);
  }
});

test('held gates, fractional MIDI, velocity and stereo pan have audible bounded behavior', () => {
  const input = voice();
  const synth = new Synth(8000);
  const id = synth.noteOn(input, 60.25, undefined, { velocity: 0.5, pan: -1 });
  const held = audio(synth, 2000);
  assert.ok(rms(held.left.subarray(1000)) > 0.01);
  assert.ok(held.right.every(sample => sample === 0));
  synth.noteOff(id);
  assert.ok(audio(synth, 400).left.subarray(320).every(sample => sample === 0));
  const center = renderNote({ voice: input, sampleRate: 8000, duration: 0.1 });
  assert.deepEqual(center.left, center.right);
  const right = renderNote({ voice: input, sampleRate: 8000, duration: 0.1, pan: 1 });
  assert.ok(right.left.every(sample => sample === 0));
  assert.ok(rms(right.right) > rms(center.right));
  for (const options of [{ velocity: -0.1 }, { velocity: Infinity }, { pan: 2 }, { pan: NaN }]) {
    assert.throws(() => synth.noteOn(input, 60, undefined, options));
  }
});

test('offline audio exactly follows Synth LFO, pan, velocity and fractional gate timing', () => {
  const input = voice();
  input.feedback = 4;
  input.algorithm = 0;
  input.ops.forEach(op => { op.level = 0.6; });
  input.lfo = { rate: 7, amDepth: 0.5, pmDepth: 200, waveform: 'sine' };
  const duration = 0.10003, sampleRate = 8000;
  const offline = renderNote({ voice: input, note: 60.4, duration, velocity: 0.7, pan: 0.4, sampleRate });
  const synth = new Synth(sampleRate);
  const id = synth.noteOn(input, 60.4, undefined, { velocity: 0.7, pan: 0.4 });
  const left = new Float32Array(offline.left.length), right = new Float32Array(left.length);
  const gate = Math.ceil(duration * sampleRate);
  synth.render(left, right, 0, gate);
  synth.noteOff(id);
  synth.render(left, right, gate, left.length - gate);
  assert.strictEqual(offline.samples, offline.left);
  assert.deepEqual(offline.left, left);
  assert.deepEqual(offline.right, right);
  const flat = structuredClone(input);
  flat.lfo = { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' };
  const unmodulated = renderNote({ voice: flat, note: 60.4, duration, velocity: 0.7, pan: 0.4, sampleRate });
  assert.ok(offline.left.some((sample, i) => Math.abs(sample - unmodulated.left[i]) > 0.001));
  assert.ok(renderNote({ voice: input, duration: 0 }).left.every(sample => sample === 0));
  assert.ok(renderNote({ voice: input, velocity: -20, pan: 20 }).left.every(sample => sample === 0));
});

test('key scaling attenuates on each side of the breakpoint and defaults to flat', () => {
  const base = voice(), scaled = voice();
  scaled.ops[0].keyScale = { breakpoint: 60, leftDbPerOctave: 12, rightDbPerOctave: 6 };
  const options = { duration: 0.2, sampleRate: 16000, velocity: 0.1 };
  assert.deepEqual(renderNote({ ...options, voice: base, note: 60 }).left,
    renderNote({ ...options, voice: scaled, note: 60 }).left);
  for (const [note, gain] of [[48, 10 ** (-12 / 20)], [72, 10 ** (-6 / 20)]]) {
    const flat = renderNote({ ...options, voice: base, note }).left;
    const attenuated = renderNote({ ...options, voice: scaled, note }).left;
    assert.ok(Math.abs(rms(attenuated) / rms(flat) - gain) < 0.003);
  }
  const normalized = normalizeVoice(scaled);
  scaled.ops[0].keyScale.rightDbPerOctave = 24;
  assert.equal(normalized.ops[0].keyScale!.rightDbPerOctave, 6);
});

test('legacy versions retain old shapes; keyScale validates strict versus clamped bounds', () => {
  const source = voice();
  const legacy = { ...source, version: 1,
    lfo: { rate: source.lfo.rate, amDepth: source.lfo.amDepth, pmDepth: source.lfo.pmDepth } };
  const normalized = normalizeVoice(legacy as unknown as Parameters<typeof normalizeVoice>[0]);
  assert.deepEqual(normalized.ops, legacy.ops);
  assert.deepEqual(validateVoice(legacy).ops, legacy.ops);
  legacy.ops[0].keyScale = { breakpoint: 60, leftDbPerOctave: 0, rightDbPerOctave: 6 };
  assert.throws(() => normalizeVoice(legacy as unknown as Parameters<typeof normalizeVoice>[0]));
  assert.throws(() => validateVoice(legacy));
  const input = voice();
  input.ops[0].keyScale = { breakpoint: 60, leftDbPerOctave: -2, rightDbPerOctave: 100 };
  assert.throws(() => normalizeVoice(input));
  assert.deepEqual(validateVoice(input).ops[0].keyScale,
    { breakpoint: 60, leftDbPerOctave: 0, rightDbPerOctave: 24 });
  input.ops[0].keyScale.breakpoint = 300;
  assert.throws(() => normalizeVoice(input));
  assert.equal(validateVoice(input).ops[0].keyScale!.breakpoint, 127);
  input.ops[0].keyScale.breakpoint = 60.5;
  assert.throws(() => validateVoice(input));
  input.ops[0].keyScale.breakpoint = 60;
  Object.defineProperty(input.ops[0].keyScale, 'rightDbPerOctave', { get() { throw Error('getter invoked'); } });
  assert.throws(() => normalizeVoice(input), /must be data/);
  assert.throws(() => validateVoice(input), /must be data/);
});

test('v1/v2 input shapes preserve old audio and only current operators accept velocity sensitivity', () => {
  const current = voice();
  const legacy1: LegacyVoice = { name: current.name, algorithm: current.algorithm, feedback: current.feedback, modIndex: current.modIndex, version: 1,
    lfo: { rate: current.lfo.rate, amDepth: current.lfo.amDepth, pmDepth: current.lfo.pmDepth },
    ops: current.ops.map(({ ratio, level, detune, adsr }) => ({ ratio, level, detune, adsr })) as LegacyVoice['ops'] };
  const legacy2: LegacyVoiceV2 = { ...legacy1, version: 2 };
  const options = { duration: 0.06, sampleRate: 8000, velocity: 0.4 };
  assert.deepEqual(renderNote({ ...options, voice: legacy1 }).left,
    renderNote({ ...options, voice: current }).left);
  assert.deepEqual(renderNote({ ...options, voice: legacy2 }).left,
    renderNote({ ...options, voice: current }).left);
  current.ops[0].velocitySensitivity = 12;
  assert.equal(normalizeVoice(current).ops[0].velocitySensitivity, 12);
  assert.equal(validateVoice(current).ops[0].velocitySensitivity, 12);
  for (const version of [1, 2]) {
    const invalid = { ...current, version };
    assert.throws(() => normalizeVoice(invalid as unknown as Parameters<typeof normalizeVoice>[0]));
    assert.throws(() => validateVoice(invalid));
  }
  for (const value of [NaN, Infinity, undefined, null, '1', -1, 49]) {
    const invalid = structuredClone(current);
    Object.defineProperty(invalid.ops[0], 'velocitySensitivity', { value, enumerable: true });
    assert.throws(() => normalizeVoice(invalid));
    if (typeof value !== 'number' || !Number.isFinite(value)) assert.throws(() => validateVoice(invalid));
    else assert.equal(validateVoice(invalid).ops[0].velocitySensitivity, value < 0 ? 0 : 48);
  }
  let reads = 0;
  Object.defineProperty(current.ops[0], 'velocitySensitivity', { get() { reads++; return 12; } });
  assert.throws(() => normalizeVoice(current), /must be data/);
  assert.throws(() => validateVoice(current), /must be data/);
  assert.equal(reads, 0);
});


test('WAV headers and PCM16 mono/stereo endpoints are interoperable and interleaved', () => {
  const left = Float32Array.of(-1, -0.5, 0, 0.5, 1);
  const mono = encodeWav({ left, sampleRate: 44100 });
  const m = new DataView(mono.buffer);
  const ascii = (start: number, end: number) => String.fromCharCode(...mono.subarray(start, end));
  assert.equal(ascii(0, 4), 'RIFF'); assert.equal(ascii(8, 12), 'WAVE');
  assert.equal(ascii(12, 16), 'fmt '); assert.equal(ascii(36, 40), 'data');
  assert.equal(m.getUint32(4, true), mono.length - 8);
  assert.equal(m.getUint16(20, true), 1);
  assert.equal(m.getUint16(22, true), 1);
  assert.equal(m.getUint32(24, true), 44100);
  assert.equal(m.getUint32(28, true), 88200);
  assert.equal(m.getUint16(32, true), 2);
  assert.equal(m.getUint16(34, true), 16);
  assert.equal(m.getUint32(40, true), 10);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => m.getInt16(44 + i * 2, true)),
    [-32768, -16384, 0, 16384, 32767]);
  const stereo = encodeWav({ left: Float32Array.of(-1, 0.5), right: Float32Array.of(1, -0.5), sampleRate: 8000 });
  const s = new DataView(stereo.buffer);
  assert.equal(s.getUint16(22, true), 2);
  assert.equal(s.getUint16(32, true), 4);
  assert.equal(s.getUint32(28, true), 32000);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => s.getInt16(44 + i * 2, true)),
    [-32768, 32767, 16384, -16384]);
});

test('WAV rejects malformed audio and enforces its frame and rate budgets', () => {
  for (const left of [[], new Float32Array(0), Float32Array.of(NaN), Float32Array.of(Infinity),
    Float32Array.of(1.01), new Float32Array(4_000_001)]) {
    assert.throws(() => encodeWav({ left, sampleRate: 8000 } as unknown as Parameters<typeof encodeWav>[0]));
  }
  const left = Float32Array.of(0);
  for (const sampleRate of [7999, 192001, 8000.5, NaN]) assert.throws(() => encodeWav({ left, sampleRate }));
  for (const right of [null, [], new Float32Array(2), Float32Array.of(-Infinity)]) {
    assert.throws(() => encodeWav({ left, right, sampleRate: 8000 } as unknown as Parameters<typeof encodeWav>[0]));
  }
  let getterCalls = 0;
  const input = { left, sampleRate: 8000 };
  Object.defineProperty(input, 'left', { get() { getterCalls++; return left; } });
  assert.throws(() => encodeWav(input));
  assert.equal(getterCalls, 0);
  const maximum = encodeWav({ left: new Float32Array(4_000_000), sampleRate: 192000 });
  assert.equal(maximum.byteLength, 8_000_044);
});
