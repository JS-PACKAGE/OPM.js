import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { HEADROOM, Synth, renderNote } from '../src/core/index.js';
import type { QualityProfile, NoteControls } from '../src/core/index.js';
import type { Voice } from '../src/voices/schema.js';
import { QUALITY_SAMPLE_RATES, matrixVoice, controlledTone, binAmplitude, signalMetrics, decibels } from '../test/quality-fixtures.js';
import { FM_REFERENCE_RATES, FM_QUALITY_PROFILES, acceptedFilterMagnitude } from '../test/fm-reference-fixtures.js';
import { verifyPMSpectrum } from '../test/fm-reference-quality.js';
import { verifyLongStream } from '../test/fm-reference-streaming.js';
import { verifyFeedbackSpectrum } from '../test/fm-reference-feedback.js';
import { verifyFourOperator } from '../test/fm-reference-four-operator.js';
import { verifyDecimator } from '../test/decimator-quality.js';

const started = performance.now();
const matrix: object[] = [];
const controlled: object[] = [];
const liveControls: object[] = [];

/** One deterministic held/released render; every profile uses the same gates, ordering and invariants. */
function matrixCase(quality: QualityProfile, sampleRate: number, voice: Voice, note: number, velocity: number, polyphony: number, maxVoices: number) {
  const length = Math.ceil(sampleRate * 0.12);
  const gate = Math.ceil(sampleRate * 0.06);
  const run = (chunked: boolean) => {
    const synth = new Synth(sampleRate, maxVoices, { quality });
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    const terminal = new Map<number, string>();
    synth.onVoiceEnded = (id, reason) => {
      assert.ok(!terminal.has(id), `duplicate terminal event ${id}`);
      terminal.set(id, reason);
    };
    const ids = Array.from({ length: polyphony }, (_, i) => synth.noteOn(voice, note + i % 3, undefined,
      { velocity, pan: i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 1 }));
    for (const [start, end] of [[0, gate], [gate, length]]) {
      if (start === gate) ids.forEach(id => synth.noteOff(id));
      for (let frame = start; frame < end;) {
        const count = chunked ? Math.min(127, end - frame) : end - frame;
        synth.render(left, right, frame, count);
        frame += count;
      }
    }
    assert.equal(synth.errorCount, 0);
    assert.equal(synth.currentFrame, length);
    assert.equal(terminal.size, polyphony, 'all stolen/released voices must terminate');
    assert.equal([...terminal.values()].filter(reason => reason === 'stolen').length, Math.max(0, polyphony - maxVoices));
    assert.ok([...terminal.values()].every(reason => reason === 'ended' || reason === 'stolen'));
    return { left, right };
  };
  const result = run(false);
  const replay = run(true);
  assert.deepEqual(result.left, replay.left, `${quality}: deterministic, render-chunk-independent left signal`);
  assert.deepEqual(result.right, replay.right, `${quality}: deterministic, render-chunk-independent right signal`);
  const left = signalMetrics(result.left);
  const right = signalMetrics(result.right);
  for (const metrics of [left, right]) {
    assert.ok(metrics.finite && metrics.peak <= HEADROOM + 1e-6, 'finite output within headroom');
    if (velocity === 0) assert.equal(metrics.peak, 0, 'zero velocity must be silent');
  }
  if (velocity > 0) assert.ok(Math.max(left.rms, right.rms) > 1e-5, 'musical registers must remain audible');
  assert.ok(signalMetrics(result.left, length - 128, 128).peak < 1e-5, 'released left tail must settle');
  assert.ok(signalMetrics(result.right, length - 128, 128).peak < 1e-5, 'released right tail must settle');
  matrix.push({ quality, sampleRate, algorithm: voice.algorithm, feedback: voice.feedback, note, velocity, polyphony, maxVoices,
    peak: Math.max(left.peak, right.peak), rmsLeft: left.rms, rmsRight: right.rms,
    rmsDbFSLeft: decibels(left.rms), rmsDbFSRight: decibels(right.rms) });
}

/**
 * Live controls between independent sample boundaries: chunking must not change PCM, and the same
 * ramp/ADSR/ratio/feedback edits must remain finite, headroom-bounded and fully terminal for every profile.
 */
function liveControlCase(quality: QualityProfile, algorithm: Voice['algorithm']) {
  const sampleRate = 48000;
  const voice = matrixVoice(algorithm, 3);
  voice.lfo = { rate: 5, amDepth: 0.2, pmDepth: 30, waveform: 'triangle', amTargets: [0, 0.5, 1, 0], pmTargets: [1, 0, 0.5, 0] };
  const edits: [number, NoteControls][] = [
    [1200, { pitch: 7, glide: 0.02 }],
    [2400, { operatorRatios: [1.5, 2, 2.5, 0.5], ramp: 0.01 }],
    [3600, { feedback: 6, ramp: 0.01 }],
    [4800, { operatorADSR: voice.ops.map(op => ({ ...op.adsr, s: 0.3, r: 0.01 })) as unknown as NoteControls['operatorADSR'] }],
    [6000, { operatorLevels: [0.4, 1, 0.5, 1], expression: 0.6, pan: -0.5, ramp: 0.005 }],
    [7200, { operatorFrequencies: [440, null, 880, null] }],
  ];
  const total = Math.ceil(sampleRate * 0.35);
  const run = (chunk: number) => {
    const synth = new Synth(sampleRate, 8, { quality });
    const reasons: string[] = [];
    synth.onVoiceEnded = (_id, reason) => { reasons.push(reason); };
    const id = synth.noteOn(voice, 57);
    const left = new Float32Array(total), right = new Float32Array(total);
    const gate = 9600;
    const marks = [...edits.map(edit => edit[0]), gate, total];
    let frame = 0;
    for (const mark of marks) {
      while (frame < mark) {
        const count = Math.min(chunk, mark - frame);
        synth.render(left, right, frame, count);
        frame += count;
      }
      const edit = edits.find(item => item[0] === mark);
      if (edit) synth.updateNote(id, edit[1]);
      if (mark === gate) synth.noteOff(id);
    }
    assert.equal(synth.errorCount, 0);
    assert.deepEqual(reasons, ['ended'], 'the edited voice must terminate exactly once');
    return { left, right };
  };
  const whole = run(total), chunked = run(127);
  assert.deepEqual(whole.left, chunked.left, `${quality}: live-control PCM is render-chunk independent`);
  assert.deepEqual(whole.right, chunked.right);
  const metrics = signalMetrics(whole.left);
  assert.ok(metrics.finite && metrics.peak <= HEADROOM + 1e-6 && metrics.rms > 1e-4, 'live controls stay audible, finite and bounded');
  assert.ok(signalMetrics(whole.left, total - 256, 256).peak < 1e-5, 'edited voice tail settles');
  liveControls.push({ quality, algorithm, edits: edits.length, peak: metrics.peak, rmsDbFS: decibels(metrics.rms) });
}

for (const quality of FM_QUALITY_PROFILES) {
  // Standard retains the complete original grid. Eco/high use the same invariants at 48 kHz, plus the two
  // sample-rate extremes that change the internal rate most, to bound full-suite time.
  const rates = quality === 'standard' ? QUALITY_SAMPLE_RATES : [22050, 48000, 96000] as const;
  const velocities = quality === 'standard' ? [0, 0.35, 1] : [0, 1];
  for (const sampleRate of rates) {
    for (let algorithm = 0; algorithm < 8; algorithm++) {
      for (const feedback of [0, 7] as const) {
        const voice = matrixVoice(algorithm as Voice['algorithm'], feedback);
        for (const note of [24, 60, 96]) for (const velocity of velocities) for (const polyphony of [1, 8, 16]) {
          if (quality !== 'standard' && sampleRate !== 48000 && (polyphony !== 8 || velocity !== 1)) continue;
          matrixCase(quality, sampleRate, voice, note, velocity, polyphony, 8);
        }
      }
    }
  }
  // Opt-in 32-voice boundary: exactly full, one over (one steal), and eight over (eight bounded fades).
  for (const polyphony of [32, 33, 40]) matrixCase(quality, 48000, matrixVoice(4, 3), 60, 1, polyphony, 32);
  for (let algorithm = 0; algorithm < 8; algorithm++) liveControlCase(quality, algorithm as Voice['algorithm']);
}

for (const quality of FM_QUALITY_PROFILES) for (const sampleRate of quality === 'standard' ? QUALITY_SAMPLE_RATES : [44100, 48000, 96000] as const) {
  const baselineHz = Math.round(sampleRate * 0.025);
  const baseline = renderNote({ ...controlledTone(sampleRate, baselineHz), quality });
  assert.equal(baseline.diagnostics.errors, 0);
  const reference = binAmplitude(baseline.samples, sampleRate, baselineHz);
  assert.ok(reference > 0.02 && reference < 0.04, 'low-level reference must be audible without saturating');
  const passband: object[] = [];
  const measuredPassbandDb: number[] = [];
  for (const fraction of [0.05, 0.1, 0.2, 0.35]) {
    const frequency = Math.round(sampleRate * fraction);
    const result = renderNote({ ...controlledTone(sampleRate, frequency), quality });
    assert.equal(result.diagnostics.errors, 0);
    assert.ok(signalMetrics(result.samples).finite);
    const amplitude = binAmplitude(result.samples, sampleRate, frequency);
    const lossDb = 20 * Math.log10(amplitude / reference);
    // Independent bilinear Butterworth magnitude, normalized by the same low-frequency control tone.
    const expectedDb = 20 * Math.log10(acceptedFilterMagnitude(frequency, sampleRate, quality) / acceptedFilterMagnitude(baselineHz, sampleRate, quality));
    assert.ok(Number.isFinite(lossDb) && lossDb <= 0.02, 'settled passband does not boost controlled tones');
    assert.ok(Math.abs(lossDb - expectedDb) < (fraction <= 0.2 ? 0.03 : 0.15), `${quality}: measured response follows the independent filter equation (${lossDb} dB vs ${expectedDb} dB)`);
    if (quality === 'standard') {
      if (fraction <= 0.2) assert.ok(lossDb > -0.03, 'flat passband through 0.2 Fs');
      if (fraction === 0.35) assert.ok(lossDb > -12 && lossDb < -11, 'documented steep transition band');
    }
    passband.push({ frequency, fractionOfSampleRate: fraction, lossDb, expectedDb });
    measuredPassbandDb.push(lossDb);
  }
  let harmonicEnergy = 0;
  assert.ok(measuredPassbandDb[2] - measuredPassbandDb[3] > (quality === 'eco' ? 5 : 10), 'passband and transition band remain distinct');
  for (let harmonic = 2; harmonic <= 8; harmonic++) {
    harmonicEnergy += binAmplitude(baseline.samples, sampleRate, baselineHz * harmonic) ** 2;
  }
  const thd = Math.sqrt(harmonicEnergy) / reference;
  assert.ok(thd < 0.01, 'low-level pure tone THD (harmonics 2..8) below 1%');
  const aliases: object[] = [];
  for (const fraction of [0.625, 1.125]) {
    const sourceHz = Math.round(sampleRate * fraction);
    const foldedHz = Math.abs(sourceHz - sampleRate);
    const result = renderNote({ ...controlledTone(sampleRate, sourceHz), quality });
    assert.equal(result.diagnostics.errors, 0);
    assert.ok(signalMetrics(result.samples).finite);
    const relative = binAmplitude(result.samples, sampleRate, foldedHz) / reference;
    // Eco's fourth-order filter at a 2x internal rate is the only profile that cannot promise 30 dB at .625 Fs.
    // Its bound is the independent filter equation, not a relaxed constant.
    const predicted = acceptedFilterMagnitude(sourceHz, sampleRate, quality) / acceptedFilterMagnitude(baselineHz, sampleRate, quality);
    assert.ok(relative < Math.max(10 ** (-30 / 20), predicted * 1.5), `${quality}: ultrasonic alias is bounded by the independent equation`);
    assert.ok(relative < 10 ** (-30 / 20) || quality === 'eco', 'standard and high keep the 30 dB controlled alias floor');
    aliases.push({ sourceHz, foldedHz, relativeDb: decibels(relative), predictedDb: decibels(predicted) });
  }
  controlled.push({ quality, sampleRate, baselineHz, passband, thdPercent: thd * 100, thdDb: decibels(thd), aliases });
}
const independentFM = FM_QUALITY_PROFILES.flatMap(quality => FM_REFERENCE_RATES.flatMap(sampleRate => verifyPMSpectrum(sampleRate, quality)));
const independentFeedback = FM_QUALITY_PROFILES.flatMap(quality => FM_REFERENCE_RATES.map(sampleRate => verifyFeedbackSpectrum(sampleRate, quality)));
const independentFourOperator = FM_QUALITY_PROFILES.flatMap(quality => FM_REFERENCE_RATES.flatMap(sampleRate => verifyFourOperator(sampleRate, quality)));
const decimatorComparison = QUALITY_SAMPLE_RATES.map(sampleRate => verifyDecimator(sampleRate));
const longStreaming = FM_QUALITY_PROFILES.map(quality => verifyLongStream(quality));
console.log(JSON.stringify({ passed: true, elapsedMs: performance.now() - started,
  profiles: FM_QUALITY_PROFILES, matrixCases: matrix.length, liveControlCases: liveControls.length,
  controlled, independentFM, independentFeedback, independentFourOperator, decimatorComparison, longStreaming, liveControls, matrix,
  limitations: [
    'Synthetic clean-room fixtures, not hardware fidelity or perceptual preset evaluation.',
    'Standard retains the original complete sample-rate/register/velocity/polyphony grid. Eco and high run the same invariants over a bounded 22.05/48/96 kHz subset plus opt-in 32-voice rows, not every grid cell.',
    'Controlled passband loss includes the Butterworth decimation filter and output saturation and is compared with an independent bilinear-transform equation per profile; decimatorComparison still isolates measured linear response, folded aliases, phase and impulse delay for the standard profile.',
    'THD measures harmonics 2..8 of one settled low-level pure tone, not noise, THD+N, or arbitrary FM distortion.',
    'Eco uses a fourth-order filter at 2x internal rate; its controlled alias bound follows the independent equation and is weaker than the 30 dB floor retained for standard and high.',
    'Independent FM gates cover original zero-feedback two-operator PM at index 16, two frequency layouts and coherent one-second windows at 44.1/48/96 kHz per profile. They are not a blanket alias-free claim.',
    'The Bessel reference and independent Butterworth transfer separate attenuated in-band brightness from folded ultrasonic energy; the conservative .30 internal-rate cutoff flattens the upper passband without relaxing the controlled alias gates.',
    'The documented memoryless output tanh is inverted for independent FM, feedback and settled-stream analysis, isolating pre-saturation products rather than claiming nonlinear output spectra are ideal PM.',
    'Feedback7 at level 0.25 uses independent converged periodic phase grids with the same physical two-tap delays and a proven contraction; its harmonics, brightness loss, DC and aliases are checked per profile, not PCM identity.',
    'Full-level feedback7 has a filter/Parseval-derived high-band energy gate. Its chaotic aliases cannot be uniquely separated from true in-band harmonics, so only the mathematical alias bound is reported; no chaotic PCM-convergence claim.',
    'Independent explicit four-op nested chain, branched leaves and two-carrier equations cover unequal ratios, indices 1.5/4/8, two registers and attack/decay/interrupted-attack/release boundaries for each profile; they do not certify arbitrary patches or listening quality.',
    'The standard long-stream gate renders two deterministic 120-second offline replays; eco and high render bounded 12-second replays with reused buffers, held AM/PM LFO, interrupted glides, settled sine residual and terminal/silence checks. They do not measure browser suspension or real-device underruns.',
    'Live-control rows apply glide, ratio, feedback, ADSR, level/expression/pan and fixed-Hz edits at sample boundaries and prove chunk independence, finiteness, headroom, audibility and termination; they are not a perceptual smoothness test.',
    'RMS dBFS is unweighted channel energy over a short held/released note, not LUFS or perceived loudness; null denotes silence.',
    'Elapsed time is offline wall time, not realtime worklet CPU cost, GC, underruns, or latency.'
  ] }, null, 2));
