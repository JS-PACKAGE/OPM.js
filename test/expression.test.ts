import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADROOM, Synth, prepareVoice, validateNoteControls } from '../src/core/index.js';
import type { NoteControls, Voice } from '../src/core/index.js';
import type { PreparedVoice } from '../src/voices/schema.js';

function tone(): Voice {
  return { version: 4, name: 'expression-tone', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: Array.from({ length: 4 }, (_, i) => ({ ratio: 1, level: i === 0 ? 0.8 : 0,
      detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.08 } })) as Voice['ops'] };
}

function audio(synth: Synth, frames: number) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  synth.render(left, right);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  return { left, right };
}

function rms(values: Float32Array): number {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / values.length);
}

test('prepared voices are deeply immutable snapshots and forged copies cannot bypass validation', () => {
  const input = tone();
  input.ops[0].keyScale = { breakpoint: 60, leftDbPerOctave: 3, rightDbPerOctave: 6 };
  const prepared = prepareVoice(input);
  const original = structuredClone(input);
  input.ops[0].ratio = 32;
  input.ops[0].adsr.s = 0;
  input.ops[0].keyScale.rightDbPerOctave = 24;
  input.lfo.pmDepth = 1200;
  assert.throws(() => Object.assign(prepared.ops[0].adsr, { s: 0 }), TypeError);
  assert.throws(() => Object.assign(prepared.ops[0].keyScale!, { rightDbPerOctave: 0 }), TypeError);
  assert.throws(() => Object.assign(prepared.lfo, { rate: 20 }), TypeError);
  const first = new Synth(16000), reference = new Synth(16000);
  first.noteOn(prepared, 69);
  reference.noteOn(original, 69);
  assert.deepEqual(audio(first, 1024), audio(reference, 1024));
  const forged = { ...prepared, ops: prepared.ops.map(op => ({ ...op })) };
  forged.ops[0].ratio = NaN;
  assert.throws(() => first.noteOn(forged as unknown as PreparedVoice, 60));
  let reads = 0;
  const accessor = { ...prepared };
  Object.defineProperty(accessor, 'algorithm', { get() { reads++; return 7; } });
  assert.throws(() => first.noteOn(accessor as PreparedVoice, 60), /must be data/);
  assert.equal(reads, 0);
});

test('prepared admissions never allocate typed state and remain bounded under reentrant steals and terminal errors', () => {
  const prepared = prepareVoice(tone());
  const synth = new Synth(8000);
  const capacity = synth.freeVoices.length;
  assert.ok(capacity <= 17, 'eight logical voices, eight tails and at most one admission spare');
  const left = new Float32Array(64), right = new Float32Array(64);
  const terminal = new Map<number, string>();
  synth.onVoiceEnded = (id, reason) => {
    assert.equal(terminal.has(id), false, `duplicate terminal event for ${id}`);
    terminal.set(id, reason);
    if (reason === 'error') synth.noteOn(prepared, 64, 1001);
    if (id === 1 && reason === 'stolen') synth.noteOn(prepared, 67, 1000);
  };
  const Original = globalThis.Float64Array;
  globalThis.Float64Array = new Proxy(Original, { construct() { throw Error('per-admission typed state allocation'); } });
  try {
    for (let id = 1; id <= 200; id++) {
      synth.noteOn(prepared, 60, id);
      assert.ok(synth.voices.length <= 8 && synth.fades.length <= 8);
      assert.equal(new Set([...synth.voices, ...synth.fades, ...synth.freeVoices]).size, capacity);
    }
    const invalidId = synth.voices[0].id;
    synth.voices[0].filters[0] = Infinity;
    synth.render(left, right);
    assert.equal(terminal.get(invalidId), 'error');
    assert.ok(synth.voices.some(active => active.id === 1001));
    for (const active of synth.voices) synth.noteOff(active.id);
    synth.render(left, right);
  } finally {
    globalThis.Float64Array = Original;
  }
  audio(synth, 1024);
  assert.equal(synth.voices.length, 0);
  assert.equal(synth.fades.length, 0);
  assert.equal(synth.freeVoices.length, capacity);
  const fresh = new Synth(8000);
  fresh.noteOn(prepared, 57);
  synth.noteOn(prepared, 57);
  assert.deepEqual(audio(synth, 256), audio(fresh, 256), 'recycled phases, filters, release and controls reset');
});

test('pitch stays relative to the original note and immediate controls preserve velocity and pan semantics', () => {
  const prepared = prepareVoice(tone());
  const synth = new Synth(16000), reference = new Synth(16000);
  const id = synth.noteOn(prepared, 57, undefined, { velocity: 0.4, pan: 0.2 });
  assert.equal(synth.updateNote(id, { pitch: 12 }), true);
  assert.equal(synth.updateNote(id, { pitch: -12 }), true);
  reference.noteOn(prepared, 45, undefined, { velocity: 0.4, pan: 0.2 });
  assert.deepEqual(audio(synth, 500), audio(reference, 500));
  const controls = { expression: 0.25, pan: 1 };
  synth.updateNote(id, controls);
  controls.expression = 1;
  const reduced = audio(synth, 256), unchanged = audio(reference, 256);
  assert.ok(reduced.left.every(value => value === 0));
  for (let i = 0; i < reduced.right.length; i++) {
    if (Math.abs(unchanged.right[i]) < 0.001) continue;
    const ratio = Math.atanh(reduced.right[i] / HEADROOM) / Math.atanh(unchanged.right[i] / HEADROOM);
    const expected = 0.25 / Math.sin((0.2 + 1) * Math.PI / 4);
    assert.ok(Math.abs(ratio - expected) < 0.00001);
  }
  synth.updateNote(id, { expression: 0, pan: -1 });
  assert.ok(audio(synth, 256).left.every(value => value === 0));
  synth.updateNote(id, { expression: 1, pan: 0.2 });
  audio(reference, 256);
  assert.deepEqual(audio(synth, 256), audio(reference, 256));
});

test('downward pitch bends recover the true operator frequency after an initially clipped high ratio', () => {
  const input = tone();
  input.ops[0].ratio = 8;
  const bent = new Synth(16000), reference = new Synth(16000);
  const id = bent.noteOn(input, 127);
  bent.updateNote(id, { pitch: -48 });
  reference.noteOn(input, 79);
  const actual = audio(bent, 1024).left, expected = audio(reference, 1024).left;
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 2e-7);
});

test('glides interpolate in semitones, can be interrupted, and remain chunk independent through release', () => {
  const prepared = prepareVoice(tone());
  const whole = new Synth(16000), chunked = new Synth(16000);
  const id = whole.noteOn(prepared, 57), other = chunked.noteOn(prepared, 57);
  whole.updateNote(id, { pitch: 12, glide: 0.4 });
  chunked.updateNote(other, { pitch: 12, glide: 0.4 });
  const first = audio(whole, 3200).left;
  const pieces = new Float32Array(3200);
  for (let offset = 0; offset < pieces.length;) {
    const frames = Math.min(37, pieces.length - offset);
    chunked.render(pieces, pieces, offset, frames);
    offset += frames;
  }
  assert.deepEqual(first, pieces);
  const crossings: number[] = [];
  for (let i = 1; i < first.length; i++) {
    if (first[i - 1] <= 0 && first[i] > 0) crossings.push(i - 1 - first[i - 1] / (first[i] - first[i - 1]));
  }
  for (let i = 1; i < crossings.length; i++) {
    const middle = (crossings[i - 1] + crossings[i]) / 2 / 16000;
    if (middle < 0.025) continue;
    const frequency = 16000 / (crossings[i] - crossings[i - 1]);
    assert.ok(Math.abs(frequency / (220 * 2 ** (middle / 0.4)) - 1) < 0.01, 'audible glide follows exponential Hz / linear semitones');
  }
  whole.updateNote(id, { pitch: -12, glide: 0.1, modulation: 0, expression: 0.6 });
  chunked.updateNote(other, { pitch: -12, glide: 0.1, modulation: 0, expression: 0.6 });
  const transition = audio(whole, 1700);
  const left = new Float32Array(1700), right = new Float32Array(1700);
  chunked.render(left, right, 0, 891);
  chunked.render(left, right, 891);
  assert.deepEqual(transition, { left, right });
  const interruptedCrossings: number[] = [];
  for (let i = 1; i < transition.left.length; i++) {
    if (transition.left[i - 1] <= 0 && transition.left[i] > 0) {
      interruptedCrossings.push(i - 1 - transition.left[i - 1] / (transition.left[i] - transition.left[i - 1]));
    }
  }
  for (let i = 1; i < interruptedCrossings.length; i++) {
    const middle = (interruptedCrossings[i - 1] + interruptedCrossings[i]) / 2 / 16000;
    if (middle < 0.01 || middle > 0.09) continue;
    const frequency = 16000 / (interruptedCrossings[i] - interruptedCrossings[i - 1]);
    const pitch = 6 - 18 * middle / 0.1;
    assert.ok(Math.abs(frequency / (220 * 2 ** (pitch / 12)) - 1) < 0.025, 'interrupted glide starts from current pitch');
  }
  assert.equal(whole.noteOff(id), true);
  assert.equal(chunked.noteOff(other), true);
  assert.equal(whole.updateNote(id, { pitch: 7, glide: 0.015, pan: -1 }), true);
  assert.equal(chunked.updateNote(other, { pitch: 7, glide: 0.015, pan: -1 }), true);
  assert.deepEqual(audio(whole, 1600), audio(chunked, 1600));
  assert.equal(whole.updateNote(id, { expression: 1 }), false);
  assert.equal(whole.updateNote(999, { expression: 1 }), false);
});

test('modulation scales patch FM and capped AM/PM and zero modulation restores static pitch steps', () => {
  const patch = tone();
  patch.algorithm = 4;
  patch.modIndex = 3;
  patch.ops.forEach(op => { op.level = 0.7; });
  patch.lfo = { rate: 6, amDepth: 0.8, pmDepth: 900, waveform: 'sine' };
  const expected = structuredClone(patch);
  expected.modIndex = 6;
  expected.lfo.amDepth = 1;
  expected.lfo.pmDepth = 1200;
  const synth = new Synth(16000), reference = new Synth(16000);
  const id = synth.noteOn(patch, 57);
  synth.updateNote(id, { modulation: 2, pitch: 12 });
  reference.noteOn(expected, 69);
  assert.deepEqual(audio(synth, 1024), audio(reference, 1024));
  const disabled = new Synth(16000), staticTone = new Synth(16000);
  const offId = disabled.noteOn(patch, 57);
  disabled.updateNote(offId, { pitch: 12, modulation: 2 });
  disabled.updateNote(offId, { modulation: 0 });
  expected.modIndex = 0;
  expected.lfo.amDepth = expected.lfo.pmDepth = 0;
  staticTone.noteOn(expected, 69);
  assert.deepEqual(audio(disabled, 1024), audio(staticTone, 1024));
});

test('operator velocity sensitivity changes brightness without replacing the final velocity gain', () => {
  const patch = tone();
  patch.algorithm = 4;
  patch.modIndex = 4;
  patch.ops[0].level = 1;
  patch.ops[0].velocitySensitivity = 24;
  patch.ops[1].level = 0.8;
  const flattened = structuredClone(patch);
  delete flattened.ops[0].velocitySensitivity;
  const velocity = 0.5;
  flattened.ops[0].level *= 10 ** (-24 * (1 - velocity) / 20);
  const synth = new Synth(16000), reference = new Synth(16000);
  synth.noteOn(patch, 69, undefined, { velocity });
  reference.noteOn(flattened, 69, undefined, { velocity });
  assert.deepEqual(audio(synth, 2048), audio(reference, 2048));
  const sensitive = tone(), insensitive = tone();
  sensitive.ops[0].velocitySensitivity = 24;
  const soft = new Synth(16000), flat = new Synth(16000);
  soft.noteOn(sensitive, 69, undefined, { velocity: 0.1 });
  flat.noteOn(insensitive, 69, undefined, { velocity: 0.1 });
  const ratio = rms(audio(soft, 2048).left) / rms(audio(flat, 2048).left);
  assert.ok(Math.abs(ratio - 10 ** (-24 * 0.9 / 20)) < 0.001);
  const hard = new Synth(16000), full = new Synth(16000);
  hard.noteOn(sensitive, 69);
  full.noteOn(insensitive, 69);
  assert.deepEqual(audio(hard, 1024), audio(full, 1024));
});

test('controls reject malformed boundaries without evaluating accessors or changing active sound', () => {
  const synth = new Synth(16000), reference = new Synth(16000);
  const id = synth.noteOn(tone(), 60);
  reference.noteOn(tone(), 60);
  const malformed: unknown[] = [null, [], {}, { unknown: 1 }, { glide: 0.1 }, { ramp: 0.1 },
    { pitch: 1, ramp: 1 }, Object.create({ pitch: 1 }), { [Symbol('pitch')]: 1 }];
  for (const [key, min, max] of [['pitch', -48, 48], ['glide', 0, 10], ['expression', 0, 1], ['pan', -1, 1], ['modulation', 0, 2], ['ramp', 0, 10]] as const) {
    for (const value of [undefined, null, '1', NaN, Infinity, min - 0.01, max + 0.01]) {
      malformed.push({ ...(key === 'glide' ? { pitch: 1 } : key === 'ramp' ? { expression: 1 } : {}), [key]: value });
    }
    for (const value of [min, max]) {
      const result = validateNoteControls({ ...(key === 'glide' ? { pitch: 1 } : key === 'ramp' ? { expression: 1 } : {}), [key]: value });
      assert.equal(result[key], value);
    }
  }
  let reads = 0;
  malformed.push(Object.defineProperty({}, 'pitch', { get() { reads++; return 1; } }));
  for (const controls of malformed) assert.throws(() => synth.updateNote(id, controls as NoteControls));
  assert.equal(reads, 0);
  assert.deepEqual(audio(synth, 1024), audio(reference, 1024));
  const single = new Synth(16000, 1);
  single.noteOn(tone(), 60, 1);
  single.noteOn(tone(), 64, 2);
  assert.equal(single.updateNote(1, { expression: 0 }), false, 'stolen tails are no longer addressable');
  assert.equal(single.updateNote(2, { expression: 0 }), true);
});

test('terminal callback replacements first render on the next frame and cannot replenish one-frame work', () => {
  for (const corrupt of [false, true]) {
    const patch = tone();
    patch.ops.forEach(op => { op.adsr.r = 0; });
    const prepared = prepareVoice(patch);
    const synth = new Synth(8000);
    let callbacks = 0;
    const admit = () => {
      const id = synth.noteOn(prepared, 60);
      if (corrupt) synth.voices[0].filters[0] = Infinity;
      else synth.noteOff(id);
    };
    synth.onVoiceEnded = (_id, reason) => {
      assert.equal(reason, corrupt ? 'error' : 'ended');
      if (++callbacks < 64) admit();
    };
    admit();
    audio(synth, 1);
    assert.equal(callbacks, 1, 'one frame cannot visit callback-admitted replacements');
    assert.equal(synth.voices.length, 1);
    audio(synth, 63);
    assert.equal(callbacks, 64);
    assert.equal(synth.voices.length, 0);
    assert.equal(synth.errorCount, corrupt ? 64 : 0);
  }
});

test('recursive rendering is rejected without corrupting notification state or future rendering', () => {
  const patch = tone();
  patch.ops.forEach(op => { op.adsr.r = 0; });
  const synth = new Synth(8000);
  synth.noteOff(synth.noteOn(patch, 60));
  let rejected = false;
  synth.onVoiceEnded = () => {
    try { synth.render(new Float32Array(1), new Float32Array(1)); }
    catch (error) { rejected = error instanceof Error; }
    synth.noteOn(tone(), 69);
  };
  const retired = audio(synth, 1);
  assert.equal(rejected, true);
  assert.equal(synth.currentFrame, 1);
  assert.equal(synth.errorCount, 0);
  assert.equal(rms(retired.left), 0);
  assert.ok(rms(audio(synth, 100).left) > 0.01);
});
