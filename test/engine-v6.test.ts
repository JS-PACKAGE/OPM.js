import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth, validateNoteControls } from '../src/core/synth.js';
import type { NoteControls } from '../src/core/synth.js';
import { createDecimatorCoefficients, decimateSample } from '../src/core/decimator.js';
import type { QualityProfile } from '../src/core/decimator.js';
import type { ADSR, Voice } from '../src/voices/schema.js';
import { fft, filterByFourier } from './decimator-reference.js';

function tone(): Voice {
  return { version: 6, name: 'engine-test', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { rate: 4, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: Array.from({ length: 4 }, (_, index) => ({ ratio: 1, level: index === 0 ? 0.7 : 0,
      detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.1 } })) as Voice['ops'] };
}
function audio(synth: Synth, frames: number, chunk = frames): Float32Array {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += chunk) synth.render(left, right, offset, Math.min(chunk, frames - offset));
  return left;
}
function reference(source: Float64Array): Float32Array {
  const filtered = filterByFourier(source, 16000);
  return Float32Array.from({ length: source.length / 4 }, (_, frame) => 0.7 * Math.tanh(filtered[frame * 4 + 3] / 0.7));
}
function near(actual: Float32Array, expected: Float32Array, tolerance = 2e-7): void {
  assert.equal(actual.length, expected.length);
  for (let frame = 0; frame < actual.length; frame++) assert.ok(Math.abs(actual[frame] - expected[frame]) < tolerance, `frame ${frame}`);
}

function filterStateTailBound(): number {
  // A sub-floor delay scalar can ring above that floor. Independently transform
  // the analog poles and invert each state-to-output transfer. For section i:
  // z1 contributes (1/A_i) * downstream H; z2 contributes its one-sample shift.
  const length = 4096, warped = Math.tan(Math.PI * 0.30 / 4);
  const poles = Array.from({ length: 4 }, (_, section) => {
    const angle = (2 * section + 1) * Math.PI / 16;
    const real = -Math.cos(angle), imaginary = Math.sin(angle);
    const denominator = (1 - warped * real) ** 2 + (warped * imaginary) ** 2;
    const digitalReal = (1 - warped ** 2) / denominator;
    const digitalImaginary = 2 * warped * imaginary / denominator;
    const power = digitalReal ** 2 + digitalImaginary ** 2;
    return { real: digitalReal, power, dcNumerator: (1 - 2 * digitalReal + power) / 4 };
  });
  const bound = new Float64Array(length);
  for (let initial = 0; initial < 4; initial++) {
    const real = new Float64Array(length), imaginary = new Float64Array(length);
    for (let bin = 0; bin < length; bin++) {
      const omega = 2 * Math.PI * bin / length;
      let transferReal = 1, transferImaginary = 0;
      for (let section = initial; section < 4; section++) {
        const pole = poles[section];
        const denominatorReal = 1 - 2 * pole.real * Math.cos(omega) + pole.power * Math.cos(2 * omega);
        const denominatorImaginary = 2 * pole.real * Math.sin(omega) - pole.power * Math.sin(2 * omega);
        const power = denominatorReal ** 2 + denominatorImaginary ** 2;
        const numeratorReal = section === initial ? 1 : pole.dcNumerator * (1 + 2 * Math.cos(omega) + Math.cos(2 * omega));
        const numeratorImaginary = section === initial ? 0 : -pole.dcNumerator * (2 * Math.sin(omega) + Math.sin(2 * omega));
        const factorReal = (numeratorReal * denominatorReal + numeratorImaginary * denominatorImaginary) / power;
        const factorImaginary = (numeratorImaginary * denominatorReal - numeratorReal * denominatorImaginary) / power;
        const nextReal = transferReal * factorReal - transferImaginary * factorImaginary;
        transferImaginary = transferReal * factorImaginary + transferImaginary * factorReal;
        transferReal = nextReal;
      }
      real[bin] = transferReal; imaginary[bin] = transferImaginary;
    }
    fft(real, imaginary, true);
    assert.ok(real.subarray(length / 2).every(value => Math.abs(value) < 1e-12), 'independent state response settles within inversion window');
    for (let sample = 0; sample < length; sample++) bound[sample] += Math.abs(real[sample]) + (sample === 0 ? 0 : Math.abs(real[sample - 1]));
  }
  let maximum = 0;
  for (const sample of bound) maximum = Math.max(maximum, sample);
  return 10 ** (-96 / 20) * (maximum + 1e-12);
}
const tuple = (value: number): readonly [number, number, number, number] => [value, value, value, value];
const envelopes = (value: ADSR): readonly [ADSR, ADSR, ADSR, ADSR] => [value, value, value, value];

test('profile decimators meet independently derived Butterworth passband and folded-product transfer', () => {
  const sampleRate = 16000;
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const factor = quality === 'eco' ? 2 : quality === 'high' ? 8 : 4;
    const order = quality === 'eco' ? 4 : 8;
    for (const fraction of [0.1, 0.25, 0.625]) {
      const hz = fraction * sampleRate, folded = hz - Math.round(hz / sampleRate) * sampleRate;
      const coefficients = createDecimatorCoefficients(sampleRate, quality), state = new Float64Array(order);
      let real = 0, imaginary = 0;
      for (let frame = 0; frame < sampleRate + 2048; frame++) {
        let output = 0;
        for (let sub = 0; sub < factor; sub++) output = decimateSample(Math.sin(2 * Math.PI * hz * (frame + sub / factor) / sampleRate), state, coefficients);
        if (frame >= 2048) {
          const phase = 2 * Math.PI * folded * (frame - 2048) / sampleRate;
          real += output * Math.cos(phase); imaginary += output * Math.sin(phase);
        }
      }
      const measured = 2 * Math.hypot(real, imaginary) / sampleRate;
      const warped = Math.tan(Math.PI * fraction / factor) / Math.tan(Math.PI * 0.30 / factor);
      const expected = 1 / Math.sqrt(1 + warped ** (2 * order));
      assert.ok(Math.abs(measured - expected) < 2e-9, `${quality} at ${fraction} Fs`);
      if (fraction === 0.1) assert.ok(measured > 0.999);
      if (fraction === 0.625) assert.ok(measured < 0.02, 'controlled folded product is attenuated, including eco');
      for (let sample = 0; sample < 4096; sample++) decimateSample(0, state, coefficients);
      assert.ok(state.every(value => Math.abs(value) < 1e-12), 'entire causal filter tail drains');
    }
  }
});

test('per-operator LFO targets and interrupted live rate retain integrated phase against independent audio reference', () => {
  const patch = tone();
  const frequencies = [400, 600, 900, 1300], am = [0, 0.25, 0.5, 1], pm = [1, 0.5, 0.25, 0];
  patch.ops.forEach((op, index) => { op.frequency = frequencies[index]; op.level = 0.2; });
  patch.lfo = { rate: 4, amDepth: 0.8, pmDepth: 300, phase: 0.17, waveform: 'sine',
    amTargets: [0, 0.25, 0.5, 1], pmTargets: [1, 0.5, 0.25, 0] };
  const synth = new Synth(16000); synth.noteOn(patch, 69, 1);
  const frames = 1600, result = new Float32Array(frames), source = new Float64Array(frames * 4), phases = [0, 0, 0, 0];
  for (let frame = 0; frame < frames; frame++) {
    if (frame === 400) synth.updateNote(1, { lfoRate: 8, ramp: 0.025 });
    if (frame === 600) synth.updateNote(1, { lfoRate: 2, ramp: 0.025 });
    result[frame] = audio(synth, 1)[0];
    const first = Math.min(200, Math.max(0, frame - 400)), second = Math.min(400, Math.max(0, frame - 600));
    const cycles = (4 * Math.min(frame, 400) + 4 * first + 0.01 * first * (first - 1) / 2 +
      6 * second - 0.01 * second * (second - 1) / 2 + 2 * Math.max(0, frame - 1000)) / 16000;
    const wave = Math.sin(2 * Math.PI * (0.17 + cycles));
    for (let sub = 0; sub < 4; sub++) {
      let sum = 0;
      for (let op = 0; op < 4; op++) {
        sum += Math.sin(phases[op]) * 0.2 * (1 - 0.8 * am[op] * (0.5 + 0.5 * wave));
        phases[op] += 2 * Math.PI * frequencies[op] * 2 ** (300 * pm[op] * wave / 1200) / 64000;
      }
      source[frame * 4 + sub] = sum * 0.7 / 4;
    }
  }
  near(result, reference(source));
});

test('live ratios, interrupted fixed Hz ramps and restoring ratio mode preserve phase against Fourier reference', () => {
  const synth = new Synth(16000);
  const frames = 2000, source = new Float64Array(frames * 4), result = new Float32Array(frames);
  synth.noteOn(tone(), 69, 1);
  const changes = new Map<number, NoteControls>([
    [400, { operatorRatios: tuple(2), ramp: 0.05 }],
    [600, { operatorFrequencies: tuple(880), ramp: 0.025 }],
    [800, { operatorRatios: tuple(1), ramp: 0.025 }],
    [1000, { operatorFrequencies: [null, null, null, null], ramp: 0.025 }],
    [1600, { pitch: 12 }],
  ]);
  let phase = 0;
  for (let frame = 0; frame < frames; frame++) {
    const controls = changes.get(frame);
    if (controls) synth.updateNote(1, controls);
    result[frame] = audio(synth, 1)[0];
    for (let sub = 0; sub < 4; sub++) {
      const time = frame + sub / 4;
      const ratio = time < 400 ? 1 : time < 800 ? 1 + (time - 400) / 800 : time < 1200 ? 1.5 - 0.5 * (time - 800) / 400 : 1;
      const hz = time < 600 ? 440 * ratio : time < 1000 ? 550 + 330 * (time - 600) / 400 :
        time < 1400 ? 880 + (440 * ratio - 880) * (time - 1000) / 400 : 440;
      source[frame * 4 + sub] = Math.sin(phase) * 0.7 * 0.7 / 4;
      phase += 2 * Math.PI * hz * (time >= 1600 ? 2 : 1) / 64000;
    }
  }
  near(result, reference(source));
  // Replay the same scheduled boundaries with differently sized render blocks.
  const replay = new Synth(16000); replay.noteOn(tone(), 69, 1);
  const replayed = new Float32Array(frames);
  let offset = 0;
  for (const [boundary, controls] of [...changes, [frames, undefined] as const]) {
    replayed.set(audio(replay, boundary - offset, 37), offset);
    if (controls) replay.updateNote(1, controls);
    offset = boundary;
  }
  assert.deepEqual(result, replayed);
});

test('ADSR interruptions begin at current dB and released updates obey their new bounded release', () => {
  const patch = tone(); patch.ops[0].adsr = { a: 0.05, d: 0, s: 1, r: 0.1 };
  const synth = new Synth(16000); synth.noteOn(patch, 69, 1);
  let endedFrame = -1;
  synth.onVoiceEnded = () => { endedFrame = synth.currentFrame; };
  const frames = 2200, source = new Float64Array(frames * 4), result = new Float32Array(frames);
  const sustain = 20 * Math.log10(0.25), releaseDb = sustain + (-96 - sustain) * 200 / 1600;
  for (let frame = 0; frame < frames; frame++) {
    if (frame === 400) synth.updateNote(1, { operatorADSR: envelopes({ a: 0.025, d: 0.025, s: 0.25, r: 0.1 }) });
    if (frame === 1300) synth.noteOff(1);
    if (frame === 1500) synth.updateNote(1, { operatorADSR: envelopes({ a: 10, d: 10, s: 1, r: 0.02 }) });
    result[frame] = audio(synth, 1)[0];
    for (let sub = 0; sub < 4; sub++) {
      const time = frame + sub / 4;
      const db = time < 400 ? -96 * (1 - time / 800) : time < 800 ? -48 * (1 - (time - 400) / 400) :
        time < 1200 ? sustain * (time - 800) / 400 : time < 1300 ? sustain :
        time < 1500 ? sustain + (-96 - sustain) * (time - 1300) / 1600 :
        time < 1820 ? releaseDb + (-96 - releaseDb) * (time - 1500) / 320 : -96;
      const gain = db <= -96 ? 0 : 10 ** (db / 20);
      source[frame * 4 + sub] = Math.sin(2 * Math.PI * 440 * time / 16000) * gain * 0.7 * 0.7 / 4;
    }
  }
  const expected = reference(source);
  assert.ok(endedFrame >= 1820 && endedFrame < 2100, 'new release ends its bounded gate and drains the filter');
  near(result.subarray(0, endedFrame + 1), expected.subarray(0, endedFrame + 1));
  // Infinite Fourier ringdown is intentionally cut at bounded state-floor
  // retirement. Its remaining audio must satisfy the independent causal bound.
  const tailBound = filterStateTailBound();
  assert.ok(expected.subarray(endedFrame + 1).every(value => Math.abs(value) < tailBound));
  assert.ok(result.subarray(endedFrame + 1).every(value => value === 0));
  assert.equal(synth.noteOff(1), false, 'release edit cannot reopen a logical gate');
});

test('zero attack/decay updates bridge the current dB for one frame and zero release only drains filter history', () => {
  const patch = tone(); patch.ops[0].adsr.s = 0.5;
  const synth = new Synth(16000); synth.noteOn(patch, 69, 1);
  let endedFrame = -1;
  synth.onVoiceEnded = () => { endedFrame = synth.currentFrame; };
  const frames = 600, source = new Float64Array(frames * 4), result = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    if (frame === 200) synth.updateNote(1, { operatorADSR: envelopes({ a: 0, d: 0, s: 0.25, r: 0 }) });
    if (frame === 400) synth.noteOff(1);
    result[frame] = audio(synth, 1)[0];
    for (let sub = 0; sub < 4; sub++) {
      const time = frame + sub / 4;
      const gain = time < 200 ? 0.5 : time < 201 ? 0.5 * 0.5 ** (time - 200) : time < 400 ? 0.25 : 0;
      source[frame * 4 + sub] = Math.sin(2 * Math.PI * 440 * time / 16000) * gain * 0.7 * 0.7 / 4;
    }
  }
  const expected = reference(source);
  assert.ok(endedFrame >= 400 && endedFrame < 550, 'zero release drains filter state before retirement');
  near(result.subarray(0, endedFrame + 1), expected.subarray(0, endedFrame + 1));
  const tailBound = filterStateTailBound();
  assert.ok(expected.subarray(endedFrame + 1).every(value => Math.abs(value) < tailBound));
  assert.ok(result.subarray(endedFrame + 1).every(value => value === 0));
});

test('independent feedback and LFO ramp interruption matches instantaneous continuous controls across chunks', () => {
  const patch = tone(); patch.feedback = 3; patch.lfo.amDepth = 0.2; patch.lfo.pmDepth = 80;
  const ramped = new Synth(16000), stepped = new Synth(16000);
  for (const instance of [ramped, stepped]) instance.noteOn(patch, 69, 1);
  near(audio(ramped, 100), audio(stepped, 100));
  ramped.updateNote(1, { feedback: 5.5, ramp: 0.05 });
  ramped.updateNote(1, { lfoRate: 8, amDepth: 0.8, pmDepth: 400, ramp: 0.025 });
  const expected = new Float32Array(900), actual = new Float32Array(900);
  for (let frame = 0; frame < 900; frame++) {
    if (frame === 200) ramped.updateNote(1, { feedback: 0, ramp: 0.025 });
    const feedback = frame < 200 ? 3 + 2.5 * frame / 800 : frame < 600 ? 3.625 * (1 - (frame - 200) / 400) : 0;
    stepped.updateNote(1, { feedback, lfoRate: frame < 400 ? 4 + 4 * frame / 400 : 8,
      amDepth: frame < 400 ? 0.2 + 0.6 * frame / 400 : 0.8, pmDepth: frame < 400 ? 80 + 320 * frame / 400 : 400 });
    expected[frame] = audio(stepped, 1)[0]; actual[frame] = audio(ramped, 1)[0];
  }
  near(actual, expected);
});

test('quality profiles and live controls reject hostile shapes atomically and detach nested scheduled data', () => {
  let reads = 0;
  assert.throws(() => new Synth(16000, 8, { get quality(): QualityProfile { reads++; return 'eco'; } }));
  assert.equal(reads, 0);
  for (const quality of ['fast', null, 1]) assert.throws(() => new Synth(16000, 8, { quality } as unknown as { quality: QualityProfile }));
  const ratios: [number, number, number, number] = [1, 2, 3, 4];
  const adsr: ADSR = { a: 0.2, d: 0.3, s: 0.4, r: 0.5 };
  const snapshot = validateNoteControls({ operatorRatios: ratios, operatorADSR: envelopes(adsr), feedback: 2.5 });
  ratios[0] = 32; adsr.a = 10;
  assert.equal(snapshot.operatorRatios![0], 1); assert.equal(snapshot.operatorADSR![0].a, 0.2);
  assert.ok(Object.isFrozen(snapshot.operatorADSR![0]));
  const malicious = [1, 1, 1, 1]; Object.defineProperty(malicious, '0', { get() { reads++; return 1; } });
  assert.throws(() => validateNoteControls({ operatorRatios: malicious } as unknown as NoteControls));
  assert.equal(reads, 0);
  const synth = new Synth(16000), unchanged = new Synth(16000);
  for (const instance of [synth, unchanged]) instance.noteOn(tone(), 69, 1);
  assert.throws(() => synth.updateNote(1, { expression: 0, feedback: 8 }));
  assert.deepEqual(audio(synth, 256), audio(unchanged, 256));
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const whole = new Synth(16000, 1, { quality }), split = new Synth(16000, 1, { quality });
    for (const instance of [whole, split]) instance.noteOn(tone(), 69, 1);
    assert.deepEqual(audio(whole, 1000), audio(split, 1000, 29));
  }
});
