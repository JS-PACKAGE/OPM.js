import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADROOM, Synth } from '../src/core/index.js';
import type { NoteControls, Voice } from '../src/core/index.js';

function tone(): Voice {
  return { version: 7, name: 'dsp-controls', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: Array.from({ length: 4 }, (_, index) => ({ ratio: 1, level: index === 0 ? 1 : 0,
      detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.06 } })) as Voice['ops'] };
}

function audio(synth: Synth, frames: number, chunk = frames) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += chunk) {
    synth.render(left, right, offset, Math.min(chunk, frames - offset));
  }
  return { left, right };
}

function near(actual: Float32Array, expected: Float32Array, tolerance = 2e-7): void {
  assert.equal(actual.length, expected.length);
  for (let frame = 0; frame < actual.length; frame++) {
    assert.ok(Math.abs(actual[frame] - expected[frame]) < tolerance,
      `frame ${frame}: ${actual[frame]} differs from ${expected[frame]}`);
  }
}

function peak(samples: Float32Array): number {
  let result = 0;
  for (const sample of samples) result = Math.max(result, Math.abs(sample));
  return result;
}

test('expression and pan ramps retarget continuously and keep independent timelines across chunks', () => {
  const synth = new Synth(16000), chunked = new Synth(16000), reference = new Synth(16000);
  for (const instance of [synth, chunked, reference]) {
    instance.noteOn(tone(), 69, 1);
    audio(instance, 53);
  }
  for (const instance of [synth, chunked]) {
    instance.updateNote(1, { expression: 0.2, ramp: 0.1 });
    instance.updateNote(1, { pan: 1, ramp: 0.2 });
  }
  const segments = [400, 400, 1800];
  let elapsed = 0;
  for (let segment = 0; segment < segments.length; segment++) {
    if (segment === 1) {
      for (const instance of [synth, chunked]) instance.updateNote(1, { expression: 0.4, ramp: 0.05 });
    } else if (segment === 2) {
      for (const instance of [synth, chunked]) instance.updateNote(1, { pan: -1, ramp: 0.1 });
    }
    const actual = audio(synth, segments[segment]);
    assert.deepEqual(actual, audio(chunked, segments[segment], 37));
    const unchanged = audio(reference, segments[segment]);
    for (let frame = 0; frame < segments[segment]; frame++) {
      const time = elapsed + frame;
      const expression = time < 400 ? 1 - 0.8 * time / 1600 :
        time < 1200 ? 0.8 - 0.4 * (time - 400) / 800 : 0.4;
      const pan = time < 800 ? time / 3200 :
        time < 2400 ? 0.25 - 1.25 * (time - 800) / 1600 : -1;
      const dry = HEADROOM * Math.atanh(unchanged.left[frame] / HEADROOM);
      const angle = (pan + 1) * Math.PI / 4;
      const leftGain = pan === 1 ? 0 : Math.SQRT2 * Math.cos(angle);
      const rightGain = pan === -1 ? 0 : Math.SQRT2 * Math.sin(angle);
      const expectedLeft = HEADROOM * Math.tanh(dry * expression * leftGain / HEADROOM);
      const expectedRight = HEADROOM * Math.tanh(dry * expression * rightGain / HEADROOM);
      assert.ok(Math.abs(actual.left[frame] - expectedLeft) < 2e-7, `left timeline at ${time}`);
      assert.ok(Math.abs(actual.right[frame] - expectedRight) < 2e-7, `right timeline at ${time}`);
    }
    elapsed += segments[segment];
  }
  const settled = audio(synth, 128);
  assert.ok(settled.right.every(sample => sample === 0));
  assert.ok(peak(settled.left) > 0.02);
});

test('modulation ramps retain FM history, retarget from the current amount and settle through release', () => {
  const patch = tone();
  patch.algorithm = 4;
  patch.modIndex = 5;
  patch.ops[1].level = 0.8;
  patch.lfo = { rate: 5, amDepth: 0.4, pmDepth: 600, waveform: 'triangle' };
  const synth = new Synth(48000), chunked = new Synth(48000), reference = new Synth(48000);
  for (const instance of [synth, chunked, reference]) instance.noteOn(patch, 57.5, 1);
  for (const instance of [synth, chunked]) instance.updateNote(1, { modulation: 0, ramp: 0.01 });
  const segments = [192, 128, 400];
  let elapsed = 0;
  for (let segment = 0; segment < segments.length; segment++) {
    if (segment === 1) {
      for (const instance of [synth, chunked]) instance.updateNote(1, { modulation: 1.7, ramp: 0.008 });
    } else if (segment === 2) {
      for (const instance of [synth, chunked]) instance.updateNote(1, { expression: 0.4, ramp: 0.002 });
    }
    const expectedLeft = new Float32Array(segments[segment]), expectedRight = new Float32Array(segments[segment]);
    for (let frame = 0; frame < segments[segment]; frame++) {
      const time = elapsed + frame;
      const modulation = time < 192 ? 1 - time / 480 :
        time < 576 ? 0.6 + 1.1 * (time - 192) / 384 : 1.7;
      const expression = time < 320 ? 1 : time < 416 ? 1 - 0.6 * (time - 320) / 96 : 0.4;
      reference.updateNote(1, { modulation, expression });
      reference.render(expectedLeft, expectedRight, frame, 1);
    }
    const actual = audio(synth, segments[segment]);
    assert.deepEqual(actual, audio(chunked, segments[segment], 31));
    near(actual.left, expectedLeft);
    near(actual.right, expectedRight);
    elapsed += segments[segment];
  }
  for (const instance of [synth, chunked, reference]) {
    instance.noteOff(1);
    instance.updateNote(1, { modulation: 0, ramp: 0.002 });
  }
  const released = audio(synth, 3200);
  assert.deepEqual(released, audio(chunked, 3200, 43));
  const expectedLeft = new Float32Array(3200), expectedRight = new Float32Array(3200);
  for (let frame = 0; frame < 3200; frame++) {
    reference.updateNote(1, { modulation: frame < 96 ? 1.7 - 1.7 * frame / 96 : 0 });
    reference.render(expectedLeft, expectedRight, frame, 1);
  }
  near(released.left, expectedLeft);
  near(released.right, expectedRight);
  assert.ok(released.left.subarray(3100).every(sample => sample === 0));
});

function harmonicAmplitude(samples: Float32Array, frequency: number, sampleRate: number): number {
  let real = 0, imaginary = 0;
  for (let frame = 0; frame < samples.length; frame++) {
    const phase = 2 * Math.PI * frequency * frame / sampleRate;
    real += samples[frame] * Math.cos(phase);
    imaginary += samples[frame] * Math.sin(phase);
  }
  return 2 * Math.hypot(real, imaginary) / samples.length;
}

function harmonicDistortion(samples: Float32Array): number {
  const fundamental = harmonicAmplitude(samples, 375, 48000);
  assert.ok(fundamental > 0.01, 'non-muted coherent fundamental');
  let harmonics = 0;
  for (const order of [3, 5, 7, 9]) harmonics += harmonicAmplitude(samples, 375 * order, 48000) ** 2;
  return Math.sqrt(harmonics) / fundamental;
}

test('premix gain reduces coincident-note saturation distortion rather than attenuating it afterward', () => {
  const loud = new Synth(48000), quiet = new Synth(48000, 8, { mixGain: 0.125 });
  const note = 69 + 12 * Math.log2(375 / 440);
  for (const instance of [loud, quiet]) {
    for (let id = 1; id <= 8; id++) instance.noteOn(tone(), note, id);
    audio(instance, 2048);
  }
  const saturated = audio(loud, 4096).left, premixed = audio(quiet, 4096).left;
  const attenuated = Float32Array.from(saturated, sample => sample * 0.125);
  assert.ok(harmonicDistortion(premixed) < harmonicDistortion(attenuated) / 10);
  assert.ok(peak(saturated) <= HEADROOM && peak(premixed) <= HEADROOM);
  loud.setMixGain(0.125);
  assert.deepEqual(audio(loud, 4096), audio(quiet, 4096), 'live gain leaves phase, envelope and filters intact');
  loud.setMixGain(0);
  assert.ok(audio(loud, 128).left.every(sample => sample === 0));
});

test('retuning fractional notes preserves attack, decay, release and phase without changing key scaling', () => {
  const patch = tone();
  patch.ops[0].adsr = { a: 0.02, d: 0.1, s: 0.4, r: 0.06 };
  patch.ops[0].keyScale = { breakpoint: 60, leftDbPerOctave: 6, rightDbPerOctave: 6 };
  const synth = new Synth(48000), reference = new Synth(48000);
  const offsets = Array<number>(128).fill(0);
  offsets[69] = 20;
  offsets[70] = 40;
  for (const instance of [synth, reference]) {
    instance.noteOn(patch, 69.5, 1, { velocity: 0.7, pan: -0.2 });
    audio(instance, 600);
  }
  synth.setTuning({ referenceHz: 880, offsets });
  reference.updateNote(1, { pitch: 12.3 });
  offsets[69] = offsets[70] = -4800;
  const attack = audio(synth, 1200), expectedAttack = audio(reference, 1200);
  near(attack.left, expectedAttack.left);
  near(attack.right, expectedAttack.right);
  for (const instance of [synth, reference]) instance.noteOff(1);
  near(audio(synth, 128).left, audio(reference, 128).left);
  synth.setTuning({ referenceHz: 440 });
  reference.updateNote(1, { pitch: 0 });
  const release = audio(synth, 3200), expectedRelease = audio(reference, 3200);
  near(release.left, expectedRelease.left);
  near(release.right, expectedRelease.right);
  assert.ok(release.left.subarray(3100).every(sample => sample === 0));
});

test('retuning at a steal boundary includes the detached audible tail without restarting it', () => {
  const synth = new Synth(48000, 1), reference = new Synth(48000, 1);
  const controls: NoteControls = { pitch: 7, glide: 0.03 };
  for (const instance of [synth, reference]) {
    instance.noteOn(tone(), 60.5, 1);
    instance.updateNote(1, controls);
    audio(instance, 333);
  }
  synth.noteOn(tone(), 67.5, 2);
  synth.setTuning({ referenceHz: 442 });
  reference.setTuning({ referenceHz: 442 });
  reference.noteOn(tone(), 67.5, 2);
  const actual = audio(synth, 512), expected = audio(reference, 512);
  near(actual.left, expected.left);
  near(actual.right, expected.right);
  assert.equal(synth.noteOff(1), false, 'retuning does not resurrect a stolen logical gate');
});

test('square-wave AM alternates real silent and audible half-cycles', () => {
  const patch = tone();
  patch.lfo = { rate: 4, amDepth: 1, pmDepth: 0, waveform: 'square' };
  const synth = new Synth(16000);
  synth.noteOn(patch, 69);
  assert.ok(audio(synth, 1900).left.every(sample => sample === 0));
  const secondHalf = audio(synth, 600).left;
  assert.ok(peak(secondHalf.subarray(150)) > 0.02);
});

test('independent note gain composes exact ramps with expression and survives mute and retarget', () => {
  const synth = new Synth(16000), chunked = new Synth(16000), reference = new Synth(16000);
  for (const instance of [synth, chunked, reference]) {
    instance.noteOn(tone(), 69, 1);
    audio(instance, 53);
  }
  for (const instance of [synth, chunked]) {
    instance.updateNote(1, { gain: 0, ramp: 0.1 });
    instance.updateNote(1, { expression: 0.5, ramp: 0.2 });
  }
  let elapsed = 0;
  for (const frames of [400, 1200, 800]) {
    if (elapsed === 400) {
      for (const instance of [synth, chunked]) instance.updateNote(1, { gain: 0.25, ramp: 0.05 });
    }
    const actual = audio(synth, frames);
    assert.deepEqual(actual, audio(chunked, frames, 37));
    const dry = audio(reference, frames);
    for (let frame = 0; frame < frames; frame++) {
      const time = elapsed + frame;
      const gain = time < 400 ? 1 - time / 1600 : time < 1200 ? 0.75 - 0.5 * (time - 400) / 800 : 0.25;
      const expression = 1 - 0.5 * Math.min(time / 3200, 1);
      const source = HEADROOM * Math.atanh(dry.left[frame] / HEADROOM);
      const expected = HEADROOM * Math.tanh(source * gain * expression / HEADROOM);
      assert.ok(Math.abs(actual.left[frame] - expected) < 2e-7, `gain × expression at ${time}`);
    }
    elapsed += frames;
  }
  synth.updateNote(1, { gain: 0 });
  assert.ok(audio(synth, 128).left.every(sample => sample === 0));
  audio(reference, 128);
  synth.updateNote(1, { gain: 1, expression: 1 });
  assert.deepEqual(audio(synth, 128), audio(reference, 128), 'mute does not reset oscillator or envelope state');
});

test('quietest stealing includes independent gain and rejects invalid gain without changing audio', () => {
  const synth = new Synth(16000, 2, { stealing: 'quietest' });
  synth.noteOn(tone(), 69, 1);
  synth.noteOn(tone(), 72, 2);
  audio(synth, 64);
  for (const gain of [-1, 1.01, NaN, Infinity]) assert.throws(() => synth.updateNote(1, { gain }), RangeError);
  synth.updateNote(2, { gain: 0 });
  synth.noteOn(tone(), 76, 3);
  assert.equal(synth.lastStolenId, 2, 'muted layer is the quietest eligible victim');
  const output = audio(synth, 256);
  assert.ok(peak(output.left) > 0.02);
  assert.equal(synth.errorCount, 0);
});
