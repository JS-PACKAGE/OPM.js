import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth, renderNote, prepareVoice, normalizeVoice, validateNoteControls } from '../src/core/index.js';
import { validateVoice } from '../src/voices/schema.js';
import type { NoteControls, Voice, VoiceInput } from '../src/core/index.js';
import type { FourOperators, LegacyOperatorV6 } from '../src/voices/schema.js';

function tone(): Voice {
  return { version: 7, name: 'expressive-v5', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: [0, 1, 2, 3].map(index => ({ ratio: 1, level: index === 0 ? 0.4 : 0, detune: 0,
      adsr: { a: 0, d: 0, s: 1, r: 0.6 } })) as Voice['ops'] };
}
function audio(synth: Synth, frames: number): Float32Array {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  synth.render(left, right);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  return left;
}
function frequency(samples: Float32Array, sampleRate: number, from: number, to: number): number {
  const crossings: number[] = [];
  for (let frame = Math.ceil(from * sampleRate) + 1; frame < Math.floor(to * sampleRate); frame++) {
    if (samples[frame - 1] <= 0 && samples[frame] > 0) {
      crossings.push(frame - 1 - samples[frame - 1] / (samples[frame] - samples[frame - 1]));
    }
  }
  assert.ok(crossings.length >= 3, 'window contains enough audible cycles');
  return (crossings.length - 1) * sampleRate / (crossings.at(-1)! - crossings[0]);
}
function closeAudio(actual: Float32Array, expected: Float32Array, tolerance = 2e-7): void {
  assert.equal(actual.length, expected.length);
  for (let frame = 0; frame < actual.length; frame++) assert.ok(Math.abs(actual[frame] - expected[frame]) <= tolerance, `frame ${frame}`);
}

test('fixed Hz ignores note transposition and tuning but composes detune, live pitch and pitch envelope', () => {
  const patch = tone();
  patch.ops[0].frequency = 440;
  const low = new Synth(16000), high = new Synth(16000);
  low.noteOn(patch, 24); high.noteOn(patch, 96);
  high.setTuning({ referenceHz: 432 });
  assert.deepEqual(audio(low, 1600), audio(high, 1600));
  const bent = new Synth(16000);
  patch.ops[0].detune = 100;
  patch.pitchEnvelope = { a: 0, d: 0, r: 0, initial: 0, peak: 0, sustain: 600, final: 600 };
  const id = bent.noteOn(patch, 12);
  bent.updateNote(id, { pitch: 12 });
  const samples = audio(bent, 3200);
  const expected = 440 * 2 ** (100 / 1200 + 600 / 1200 + 12 / 12);
  assert.ok(Math.abs(frequency(samples, 16000, 0.05, 0.18) / expected - 1) < 0.001);
});

test('rate scaling applies independently to attack, decay and release and bounds low-note tails', () => {
  const scaled = tone(), reference = tone();
  scaled.ops[0].frequency = reference.ops[0].frequency = 330;
  scaled.ops.forEach(op => { op.adsr = { a: 0.04, d: 0.08, s: 0.6, r: 0.08 }; op.rateKeyScale = 1; });
  reference.ops.forEach(op => { op.adsr = { a: 0.02, d: 0.04, s: 0.6, r: 0.04 }; });
  const fast = new Synth(16000), flat = new Synth(16000);
  const id = fast.noteOn(scaled, 72), other = flat.noteOn(reference, 60);
  assert.deepEqual(audio(fast, 1400), audio(flat, 1400));
  fast.noteOff(id); flat.noteOff(other);
  assert.deepEqual(audio(fast, 1000), audio(flat, 1000));
  assert.equal(fast.updateNote(id, { expression: 1 }), false);
  const bounded = tone();
  bounded.ops.forEach(op => { op.rateKeyScale = 4; op.adsr.r = 0.001; });
  const output = renderNote({ voice: bounded, note: 0, duration: 0.001, sampleRate: 8000 });
  assert.equal(output.left.length, Math.ceil((0.001 + 10 + 0.01) * 8000));
  assert.ok(output.left.subarray(-32).every(sample => sample === 0));
});

test('pitch-envelope release starts at the current cents value, including an interrupted attack', () => {
  const patch = tone();
  patch.ops[0].frequency = 800;
  patch.ops[0].adsr.r = 0.6;
  patch.pitchEnvelope = { a: 0.4, d: 0.2, r: 0.4, initial: 0, peak: 1200, sustain: -600, final: -1200 };
  const synth = new Synth(16000);
  const id = synth.noteOn(patch, 60);
  const held = audio(synth, 3200);
  synth.noteOff(id);
  const released = audio(synth, 7200);
  assert.ok(Math.abs(frequency(held, 16000, 0.16, 0.18) / (800 * 2 ** (510 / 1200)) - 1) < 0.015);
  for (const midpoint of [0.03, 0.13, 0.33]) {
    const cents = 600 + (-1200 - 600) * midpoint / 0.4;
    const measured = frequency(released, 16000, midpoint - 0.01, midpoint + 0.01);
    assert.ok(Math.abs(measured / (800 * 2 ** (cents / 1200)) - 1) < 0.02, `release time ${midpoint}`);
  }
  assert.ok(Math.abs(frequency(released, 16000, 0.41, 0.44) / 400 - 1) < 0.002, 'final cents persist for the operator release');
});

test('LFO delay gates depth without freezing note or deterministic global phase', () => {
  const patch = tone();
  patch.lfo = { rate: 2, amDepth: 0.8, pmDepth: 0, waveform: 'sine', delay: 0.125, phase: 0.1 };
  const delayed = new Synth(16000), dry = new Synth(16000), wet = new Synth(16000);
  const flat = tone();
  delayed.noteOn(patch, 69); dry.noteOn(flat, 69);
  wet.noteOn({ ...patch, lfo: { ...patch.lfo, delay: 0 } }, 69);
  assert.deepEqual(audio(delayed, 2000), audio(dry, 2000));
  audio(wet, 2000);
  closeAudio(audio(delayed, 1280).subarray(128), audio(wet, 1280).subarray(128));
  const global = new Synth(16000), note = new Synth(16000);
  audio(global, 1280);
  global.noteOn({ ...patch, lfo: { ...patch.lfo, sync: 'global' } }, 69);
  note.noteOn({ ...patch, lfo: { ...patch.lfo, phase: 0.26, sync: 'note' } }, 69);
  closeAudio(audio(global, 4000), audio(note, 4000));
  const pitch = tone();
  pitch.lfo = { rate: 0, amDepth: 0, pmDepth: 1200, waveform: 'sine', delay: 0.125, phase: 0.25 };
  const stepped = new Synth(16000), staticTone = new Synth(16000);
  stepped.noteOn(pitch, 69); staticTone.noteOn(tone(), 69);
  assert.deepEqual(audio(stepped, 2000), audio(staticTone, 2000));
  const pitched = audio(stepped, 1600);
  assert.ok(Math.abs(frequency(pitched, 16000, 0.02, 0.08) / 880 - 1) < 0.001);
});

test('operator level ramps are independent of other controls, interrupt continuously and retain chunk determinism', () => {
  const patch = tone();
  patch.ops.forEach((op, index) => { op.frequency = 330 * (index + 1); op.level = 0.2; });
  patch.pitchEnvelope = { a: 0.1, d: 0.2, r: 0.2, initial: -300, peak: 300, sustain: 0, final: -100 };
  const whole = new Synth(16000), chunked = new Synth(16000);
  const id = whole.noteOn(patch, 60), other = chunked.noteOn(patch, 60);
  const controls: NoteControls = { operatorLevels: [0, 0.5, 1, 2], ramp: 0.2 };
  whole.updateNote(id, controls); chunked.updateNote(other, controls);
  const expected = audio(whole, 1600), actual = new Float32Array(1600);
  for (let offset = 0; offset < actual.length; offset += 37) chunked.render(actual, actual, offset, Math.min(37, actual.length - offset));
  assert.deepEqual(actual, expected);
  whole.updateNote(id, { expression: 0.5 }); chunked.updateNote(other, { expression: 0.5 });
  whole.updateNote(id, { operatorLevels: [2, 0, 0.5, 1], ramp: 0.1 });
  chunked.updateNote(other, { operatorLevels: [2, 0, 0.5, 1], ramp: 0.1 });
  assert.deepEqual(audio(whole, 4000), audio(chunked, 4000));
  const final = structuredClone(patch);
  final.ops.forEach((op, index) => { op.level *= [2, 0, 0.5, 1][index]; });
  const reference = new Synth(16000);
  const referenceId = reference.noteOn(final, 60);
  reference.updateNote(referenceId, { expression: 0.5 });
  audio(reference, 5600);
  closeAudio(audio(whole, 512), audio(reference, 512));
  whole.panic();
  whole.noteOn(tone(), 57);
  const fresh = new Synth(16000);
  fresh.noteOn(tone(), 57);
  assert.deepEqual(audio(whole, 512), audio(fresh, 512), 'recycled expressive state cannot leak into plain voices');
});

test('expressive snapshots detach data and explicit v1–v4 reject later shapes', () => {
  const patch = tone();
  patch.ops[0].frequency = 330; patch.ops[0].rateKeyScale = 2;
  patch.pitchEnvelope = { a: 0.1, d: 0.2, r: 0.3, initial: -4800, peak: 4800, sustain: 0, final: -100 };
  patch.lfo = { ...patch.lfo, delay: 1, sync: 'global', phase: 1 };
  const prepared = prepareVoice(patch), bank = validateVoice(patch), normalized = normalizeVoice(patch);
  patch.pitchEnvelope.peak = 0; patch.ops[0].frequency = 999; patch.lfo.delay = 0;
  for (const snapshot of [prepared, bank, normalized]) {
    assert.equal(snapshot.pitchEnvelope!.peak, 4800); assert.equal(snapshot.ops[0].frequency, 330); assert.equal(snapshot.lfo.delay, 1);
  }
  for (const snapshot of [prepared, bank]) assert.throws(() => Object.assign(snapshot.pitchEnvelope!, { peak: 0 }), TypeError);
  for (const version of [1, 2, 3, 4] as const) {
    const legacy = { ...tone(), version, lfo: { rate: 0, amDepth: 0, pmDepth: 0 } };
    for (const convert of [normalizeVoice, validateVoice]) {
      assert.throws(() => convert({ ...legacy, pitchEnvelope: prepared.pitchEnvelope } as unknown as VoiceInput));
      for (const key of ['frequency', 'rateKeyScale'] as const) {
        const invalid = structuredClone(legacy); Object.assign(invalid.ops[0], { [key]: key === 'frequency' ? 330 : 1 });
        assert.throws(() => convert(invalid as unknown as VoiceInput));
      }
      for (const [key, value] of [['delay', 1], ['sync', 'global'], ['phase', 0.5]] as const) {
        assert.throws(() => convert({ ...legacy, lfo: { ...legacy.lfo, [key]: value } } as unknown as VoiceInput));
      }
    }
  }
});

test('legacy v5 and implicit all-operator LFO targets preserve identical expressive audio', () => {
  const patch = tone();
  patch.ops[0].frequency = 330;
  patch.ops[0].rateKeyScale = 1.5;
  patch.ops[0].adsr = { a: 0.02, d: 0.08, s: 0.7, r: 0.2 };
  patch.pitchEnvelope = { a: 0.04, d: 0.1, r: 0.1, initial: -200, peak: 300, sustain: 0, final: -100 };
  const lfo = { rate: 3, amDepth: 0.6, pmDepth: 20, waveform: 'triangle' as const, delay: 0.02, sync: 'global' as const, phase: 0.125 };
  patch.lfo = lfo;
  const legacy: VoiceInput = { ...patch, version: 5, lfo,
    ops: patch.ops.map(({ waveform: _waveform, noiseRate: _noiseRate, ...op }) => op) as FourOperators<LegacyOperatorV6> };
  const explicit = structuredClone(patch);
  explicit.lfo.amTargets = explicit.lfo.pmTargets = [1, 1, 1, 1];
  const { version: _, ...omitted } = patch;
  const inputs = [legacy, patch, explicit, omitted];
  const synths = inputs.map(() => new Synth(16000));
  const ids = synths.map((synth, index) => {
    audio(synth, 320);
    return synth.noteOn(inputs[index], 67, undefined, { velocity: 0.7 });
  });
  const held = synths.map(synth => audio(synth, 4000));
  for (const samples of held.slice(1)) assert.deepEqual(samples, held[0]);
  synths.forEach((synth, index) => synth.noteOff(ids[index]));
  const released = synths.map(synth => audio(synth, 6400));
  for (const samples of released.slice(1)) assert.deepEqual(samples, released[0]);
});

test('new numeric fields preserve strict versus clamped parser bounds and never invoke getters', () => {
  for (const [key, low, high] of [['frequency', 1, 20000], ['rateKeyScale', 0, 4]] as const) {
    for (const value of [low - 1, high + 1]) {
      const patch = tone(); patch.ops[0][key] = value;
      assert.throws(() => normalizeVoice(patch), RangeError);
      assert.equal(validateVoice(patch).ops[0][key], value < low ? low : high);
    }
  }
  for (const [key, low, high] of [['delay', 0, 10], ['phase', 0, 1]] as const) {
    const patch = tone(); patch.lfo[key] = high + 1;
    assert.throws(() => normalizeVoice(patch), RangeError);
    assert.equal(validateVoice(patch).lfo[key], high);
    patch.lfo[key] = low - 1;
    assert.equal(validateVoice(patch).lfo[key], low);
  }
  for (const key of ['a', 'd', 'r', 'initial', 'peak', 'sustain', 'final'] as const) {
    const patch = tone();
    patch.pitchEnvelope = { a: 0, d: 0, r: 0, initial: 0, peak: 0, sustain: 0, final: 0 };
    const limit = key === 'a' || key === 'd' || key === 'r' ? 10 : 4800;
    patch.pitchEnvelope[key] = limit + 1;
    assert.throws(() => normalizeVoice(patch), RangeError);
    assert.equal(validateVoice(patch).pitchEnvelope![key], limit);
  }
  for (const sync of ['wall', null, undefined, 0]) {
    const patch = tone(); Object.assign(patch.lfo, { sync });
    assert.throws(() => normalizeVoice(patch));
    assert.throws(() => validateVoice(patch));
  }
  let reads = 0;
  const getter = () => { reads++; return 0; };
  for (const convert of [normalizeVoice, validateVoice]) {
    const patch = tone();
    patch.pitchEnvelope = { a: 0, d: 0, r: 0, initial: 0, peak: 0, sustain: 0, final: 0 };
    Object.defineProperty(patch.pitchEnvelope, 'peak', { get: getter });
    assert.throws(() => convert(patch), TypeError);
    const lfo = tone(); Object.defineProperty(lfo.lfo, 'delay', { get: getter });
    assert.throws(() => convert(lfo), TypeError);
  }
  assert.equal(reads, 0);
  const values = [1, 0.5, 0, 2] as [number, number, number, number];
  const controls = validateNoteControls({ operatorLevels: values, ramp: 0.1 });
  values[0] = 0;
  assert.equal(controls.operatorLevels![0], 1);
  assert.throws(() => Object.assign(controls.operatorLevels!, { 0: 0 }), TypeError);
  const sparse = [1, 1, 1, 1]; delete (sparse as Array<number | undefined>)[1];
  const accessor = [1, 1, 1, 1]; Object.defineProperty(accessor, '0', { get: getter });
  for (const operatorLevels of [sparse, accessor, [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, NaN], Object.assign([1, 1, 1, 1], { extra: 1 })]) {
    assert.throws(() => validateNoteControls({ operatorLevels } as unknown as NoteControls));
  }
  assert.equal(reads, 0);
});

test('operator ramps move linearly from current multipliers rather than jumping or restarting from old targets', () => {
  const synth = new Synth(16000), reference = new Synth(16000);
  const id = synth.noteOn(tone(), 69);
  reference.noteOn(tone(), 69);
  synth.updateNote(id, { operatorLevels: [0, 1, 1, 1], ramp: 0.2 });
  const first = audio(synth, 1600), dryFirst = audio(reference, 1600);
  synth.updateNote(id, { operatorLevels: [1, 1, 1, 1], ramp: 0.2 });
  const second = audio(synth, 1600), drySecond = audio(reference, 1600);
  for (const [samples, dry, start, target] of [[first, dryFirst, 1, 0], [second, drySecond, 0.5, 1]] as const) {
    let projected = 0, energy = 0, expected = 0;
    for (let frame = 1000; frame < 1500; frame++) {
      const actualSignal = Math.atanh(samples[frame] / 0.7);
      const drySignal = Math.atanh(dry[frame] / 0.7);
      const weight = drySignal * drySignal;
      projected += actualSignal * drySignal;
      energy += weight;
      expected += weight * (start + (target - start) * frame / 16000 / 0.2);
    }
    assert.ok(Math.abs(projected / energy - expected / energy) < 0.003, 'demodulated gain follows the continuous linear multiplier');
  }
});
