import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { HEADROOM, Synth, renderNote } from '../src/core/index.js';
import type { Voice } from '../src/voices/schema.js';
import { QUALITY_SAMPLE_RATES, matrixVoice, controlledTone, binAmplitude, signalMetrics, decibels } from '../test/quality-fixtures.js';

const started = performance.now();
const matrix: object[] = [];
const controlled: object[] = [];
for (const sampleRate of QUALITY_SAMPLE_RATES) {
  for (let algorithm = 0; algorithm < 8; algorithm++) {
    for (const feedback of [0, 7] as const) {
      const voice = matrixVoice(algorithm as Voice['algorithm'], feedback);
      for (const note of [24, 60, 96]) for (const velocity of [0, 0.35, 1]) for (const polyphony of [1, 8, 16]) {
        const length = Math.ceil(sampleRate * 0.12);
        const gate = Math.ceil(sampleRate * 0.06);
        const run = (chunked: boolean) => {
          const synth = new Synth(sampleRate);
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
          assert.equal([...terminal.values()].filter(reason => reason === 'stolen').length, Math.max(0, polyphony - 8));
          assert.ok([...terminal.values()].every(reason => reason === 'ended' || reason === 'stolen'));
          return { left, right };
        };
        const result = run(false);
        const replay = run(true);
        assert.deepEqual(result.left, replay.left, 'deterministic, render-chunk-independent left signal');
        assert.deepEqual(result.right, replay.right, 'deterministic, render-chunk-independent right signal');
        const left = signalMetrics(result.left);
        const right = signalMetrics(result.right);
        for (const metrics of [left, right]) {
          assert.ok(metrics.finite && metrics.peak <= HEADROOM + 1e-6, 'finite output within headroom');
          if (velocity === 0) assert.equal(metrics.peak, 0, 'zero velocity must be silent');
        }
        if (velocity > 0) assert.ok(Math.max(left.rms, right.rms) > 1e-5, 'musical registers must remain audible');
        assert.ok(signalMetrics(result.left, length - 128, 128).peak < 1e-5, 'released left tail must settle');
        assert.ok(signalMetrics(result.right, length - 128, 128).peak < 1e-5, 'released right tail must settle');
        matrix.push({ sampleRate, algorithm, feedback, note, velocity, polyphony,
          peak: Math.max(left.peak, right.peak), rmsLeft: left.rms, rmsRight: right.rms,
          rmsDbFSLeft: decibels(left.rms), rmsDbFSRight: decibels(right.rms) });
      }
    }
  }
  const baselineHz = Math.round(sampleRate * 0.025);
  const baseline = renderNote(controlledTone(sampleRate, baselineHz));
  assert.equal(baseline.diagnostics.errors, 0);
  const reference = binAmplitude(baseline.samples, sampleRate, baselineHz);
  assert.ok(reference > 0.02 && reference < 0.04, 'low-level reference must be audible without saturating');
  const passband: object[] = [];
  let previous = reference;
  for (const fraction of [0.05, 0.1, 0.2, 0.35]) {
    const frequency = Math.round(sampleRate * fraction);
    const result = renderNote(controlledTone(sampleRate, frequency));
    assert.equal(result.diagnostics.errors, 0);
    assert.ok(signalMetrics(result.samples).finite);
    const amplitude = binAmplitude(result.samples, sampleRate, frequency);
    const lossDb = 20 * Math.log10(amplitude / reference);
    assert.ok(amplitude > 0 && amplitude < previous, 'controlled low-level rolloff must be monotonic');
    if (fraction <= 0.1) assert.ok(lossDb > -8 && lossDb < 0, 'usable controlled passband through 0.1 Fs');
    passband.push({ frequency, fractionOfSampleRate: fraction, lossDb });
    previous = amplitude;
  }
  let harmonicEnergy = 0;
  for (let harmonic = 2; harmonic <= 8; harmonic++) {
    harmonicEnergy += binAmplitude(baseline.samples, sampleRate, baselineHz * harmonic) ** 2;
  }
  const thd = Math.sqrt(harmonicEnergy) / reference;
  assert.ok(thd < 0.01, 'low-level pure tone THD (harmonics 2..8) below 1%');
  const aliases: object[] = [];
  for (const fraction of [0.625, 1.125]) {
    const sourceHz = Math.round(sampleRate * fraction);
    const foldedHz = Math.abs(sourceHz - sampleRate);
    const result = renderNote(controlledTone(sampleRate, sourceHz));
    assert.equal(result.diagnostics.errors, 0);
    assert.ok(signalMetrics(result.samples).finite);
    const relative = binAmplitude(result.samples, sampleRate, foldedHz) / reference;
    assert.ok(relative < 10 ** (-30 / 20), 'controlled ultrasonic alias at least 30 dB below low-frequency control');
    aliases.push({ sourceHz, foldedHz, relativeDb: decibels(relative) });
  }
  controlled.push({ sampleRate, baselineHz, passband, thdPercent: thd * 100, thdDb: decibels(thd), aliases });
}
console.log(JSON.stringify({ passed: true, elapsedMs: performance.now() - started,
  matrixCases: matrix.length, controlled, matrix,
  limitations: [
    'Synthetic clean-room fixtures, not hardware fidelity or perceptual preset evaluation.',
    'Passband loss is relative to a low-frequency control and includes the existing four-pole filter and output saturation; no DSP was changed.',
    'THD measures harmonics 2..8 of one settled low-level pure tone, not noise, THD+N, or arbitrary FM distortion.',
    'Alias bounds cover two isolated ultrasonic sine oscillators only; high-index FM and feedback are not claimed alias-free.',
    'RMS dBFS is unweighted channel energy over a short held/released note, not LUFS or perceived loudness; null denotes silence.',
    'Elapsed time is offline wall time, not realtime worklet CPU cost, GC, underruns, or latency.'
  ] }, null, 2));
