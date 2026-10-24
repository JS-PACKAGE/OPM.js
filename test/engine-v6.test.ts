import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth, validateNoteControls } from '../src/core/synth.js';
import type { NoteControls } from '../src/core/synth.js';
import { DECIMATOR_OUTPUT, DECIMATOR_STATE_SIZE, createDecimatorCoefficients, decimateFrame, decimatorPeak } from '../src/core/decimator.js';
import type { QualityProfile } from '../src/core/decimator.js';
import type { ADSR, Voice } from '../src/voices/schema.js';
import { filterByFourier, filterResponse, halfBandStages } from './decimator-reference.js';

function tone(): Voice {
  return { version: 8, name: 'engine-test', algorithm: 7, feedback: 0, modIndex: 0,
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
  // Retirement leaves every stored stage input below the -96 dB floor. Each
  // linear-phase stage output is then at most its tap L1 norm times that floor,
  // and the next stage sees only such outputs or sub-floor history.
  let gain = 1;
  for (const { taps } of halfBandStages()) gain *= 0.5 + 2 * taps.reduce((sum, tap) => sum + Math.abs(tap), 0);
  return 10 ** (-96 / 20) * gain;
}
const tuple = (value: number): readonly [number, number, number, number] => [value, value, value, value];
const envelopes = (value: ADSR): readonly [ADSR, ADSR, ADSR, ADSR] => [value, value, value, value];

test('profile decimators meet the direct half-band transfer with a flat passband and folded-product rejection', () => {
  const sampleRate = 16000;
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const factor = quality === 'eco' ? 2 : quality === 'high' ? 8 : 4;
    for (const fraction of [0.1, 0.25, 0.4, 0.625, 0.9]) {
      const hz = fraction * sampleRate, folded = hz - Math.round(hz / sampleRate) * sampleRate;
      const coefficients = createDecimatorCoefficients(sampleRate, quality), state = new Float64Array(DECIMATOR_STATE_SIZE);
      const inputs = new Float64Array(factor);
      let real = 0, imaginary = 0;
      for (let frame = 0; frame < sampleRate + 2048; frame++) {
        for (let sub = 0; sub < factor; sub++) inputs[sub] = Math.sin(2 * Math.PI * hz * (frame + sub / factor) / sampleRate);
        decimateFrame(inputs, state, coefficients);
        const output = state[DECIMATOR_OUTPUT];
        if (frame >= 2048) {
          const phase = 2 * Math.PI * folded * (frame - 2048) / sampleRate;
          real += output * Math.cos(phase); imaginary += output * Math.sin(phase);
        }
      }
      const measured = 2 * Math.hypot(real, imaginary) / sampleRate;
      const expected = filterResponse(hz, sampleRate, quality).magnitude;
      assert.ok(Math.abs(measured - expected) < 2e-9, `${quality} at ${fraction} Fs`);
      if (fraction <= 0.4) assert.ok(Math.abs(20 * Math.log10(measured)) < 0.01, 'passband is flat to .40 Fs');
      else assert.ok(measured < (quality === 'eco' ? 10 ** (-60 / 20) : 10 ** (-80 / 20)), 'folded products below .40 Fs are rejected');
      inputs.fill(0);
      for (let frame = 0; frame < 4096 / factor; frame++) decimateFrame(inputs, state, coefficients);
      assert.equal(decimatorPeak(state), 0, 'entire finite filter history drains to exact zero');
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
  assert.equal(endedFrame, 400, 'zero release retires on its envelope end without waiting for filter history');
  // The shared post-mix decimator keeps draining the retired voice's history
  // until its state falls below the floor, then snaps to exact silence.
  let settled = endedFrame + 1;
  while (settled < frames && result.subarray(settled).some(value => value !== 0)) settled++;
  assert.ok(settled > endedFrame + 1 && settled < 550, 'filter history drains after retirement');
  near(result.subarray(0, settled), expected.subarray(0, settled));
  const tailBound = filterStateTailBound();
  assert.ok(expected.subarray(settled).every(value => Math.abs(value) < tailBound));
});

test('released voices retire once every audible carrier is silent', () => {
  const releaseFrames = (patch: Voice, held: number): number => {
    const synth = new Synth(16000);
    let endedFrame = -1;
    synth.onVoiceEnded = () => { endedFrame = synth.currentFrame; };
    synth.noteOn(patch, 69, 1);
    audio(synth, held);
    synth.noteOff(1);
    for (let block = 0; block < 400 && endedFrame < 0; block++) audio(synth, 160);
    assert.ok(endedFrame >= held);
    return endedFrame - held;
  };
  // Algorithm 0's only carrier is operator 3; slow modulator releases cannot sound through it.
  const chain = tone();
  chain.algorithm = 0; chain.modIndex = 1;
  chain.ops.forEach((op, index) => { op.level = 0.5; op.adsr.r = index === 3 ? 0.05 : 2; });
  const chainEnd = releaseFrames(chain, 1600);
  assert.ok(chainEnd >= 800 && chainEnd < 1600, `carrier release bounds retirement (${chainEnd} frames)`);
  // Zero-level carriers and a carrier already decayed to the floor contribute nothing.
  const decayed = tone();
  decayed.ops.forEach(op => { op.adsr.r = 2; });
  decayed.ops[0].adsr = { a: 0, d: 0.02, s: 0, r: 2 };
  const decayedEnd = releaseFrames(decayed, 1600);
  assert.ok(decayedEnd < 800, `a silent carrier retires promptly (${decayedEnd} frames)`);
  // An audible carrier still runs its full release.
  const sustained = tone();
  sustained.ops[0].adsr.r = 0.2;
  assert.ok(releaseFrames(sustained, 1600) >= 3200);
});

test('soft-knee output is linear below the knee and bounded by HEADROOM above it', () => {
  const render = (saturation: 'tanh' | 'soft-knee', notes: readonly number[], patch: Voice) => {
    const synth = new Synth(16000, 8, { saturation });
    for (const note of notes) synth.noteOn(patch, note);
    return audio(synth, 1600);
  };
  // One carrier at 0.7 · 0.7 stays below the 0.5 knee: soft-knee is the
  // linear mix that tanh would have compressed.
  const quiet = tone();
  const linear = render('soft-knee', [69], quiet), saturated = render('tanh', [69], quiet);
  let compression = 0;
  for (let frame = 0; frame < linear.length; frame++) {
    assert.ok(Math.abs(linear[frame]) < 0.5);
    assert.ok(Math.abs(0.7 * Math.atanh(saturated[frame] / 0.7) - linear[frame]) < 2e-7, `frame ${frame}`);
    compression = Math.max(compression, Math.abs(linear[frame]) - Math.abs(saturated[frame]));
  }
  assert.ok(compression > 1e-3, 'tanh compresses the same mix');
  // A dense full-level chord overdrives both stages; soft-knee stays below HEADROOM.
  const loud = tone();
  loud.ops.forEach(op => { op.level = 1; });
  const driven = render('soft-knee', [48, 52, 55, 60, 64, 67, 71, 72], loud);
  const peak = driven.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  assert.ok(peak > 0.6 && peak <= 0.7, `soft-knee peak ${peak}`);
  assert.throws(() => new Synth(16000, 8, { saturation: 'hard' as 'tanh' }), /saturation/);
});

test('optional DC blocker removes feedback DC, keeps audio-band content and settles to exact silence', () => {
  const patch = tone();
  patch.feedback = 6;
  patch.ops[0].adsr.r = 0.05;
  const run = (dcBlock: boolean) => {
    const synth = new Synth(16000, 8, { dcBlock });
    synth.noteOn(patch, 69, 1);
    return { synth, held: audio(synth, 32000).subarray(16000) };
  };
  const plain = run(false), blocked = run(true);
  const mean = (values: Float32Array) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const rms = (values: Float32Array) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  assert.ok(Math.abs(mean(plain.held)) > 0.1 * rms(plain.held), 'heavy feedback carries DC');
  assert.ok(Math.abs(mean(blocked.held)) < 0.01 * rms(blocked.held), 'the blocker removes it');
  // At 440 Hz the 3 Hz high-pass leaves the waveform apart from its offset.
  const offset = Float32Array.from(plain.held, (value, index) => value - blocked.held[index]);
  const centered = Float32Array.from(offset, value => value - mean(offset));
  assert.ok(rms(centered) < 0.02 * rms(blocked.held));
  blocked.synth.noteOff(1);
  const tail = audio(blocked.synth, 48000);
  assert.ok(tail.subarray(-16000).every(value => value === 0), 'the release and filter tail settle to exact zero');
  const panicked = run(true).synth;
  panicked.panic();
  assert.ok(audio(panicked, 64).every(value => value === 0), 'panic clears the blocker state');
  assert.throws(() => new Synth(16000, 8, { dcBlock: 1 as unknown as boolean }), /dcBlock/);
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
