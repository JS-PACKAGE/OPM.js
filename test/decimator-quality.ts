import assert from 'node:assert/strict';
import { createDecimatorCoefficients, decimateFrame, decimatorPeak, DECIMATOR_OUTPUT, DECIMATOR_STATE_SIZE } from '../src/core/decimator.js';
import { butterworthFilterMagnitude, fourierBin } from './fm-reference-fixtures.js';
import { filterResponse, filterImpulseBounds, filterGroupDelayFrames } from './decimator-reference.js';

const db = (magnitude: number) => 20 * Math.log10(magnitude);

export function verifyDecimator(sampleRate: number) {
  const coefficients = createDecimatorCoefficients(sampleRate);
  const response = [0.1, 0.2, 0.25, 0.35, 0.4, 0.45, 0.5, 0.6, 0.625, 1.125, 1.6].map(fraction => {
    const sourceHz = Math.round(fraction * sampleRate);
    const signedFoldedHz = sourceHz - Math.round(sourceHz / sampleRate) * sampleRate;
    const expected = filterResponse(sourceHz, sampleRate);
    // Nyquist has only one quadrature; evaluate its transfer analytically.
    if (Math.abs(signedFoldedHz) === sampleRate / 2) return {
      fraction, sourceHz, expectedDb: db(expected.magnitude), butterworthDb: db(butterworthFilterMagnitude(sourceHz, sampleRate)),
      measuredDb: null, phaseError: null,
    };
    const offset = Math.ceil(sampleRate / 4), samples = new Float64Array(sampleRate);
    const state = new Float64Array(DECIMATOR_STATE_SIZE), inputs = new Float64Array(4);
    for (let frame = 0; frame < offset + sampleRate; frame++) {
      for (let sub = 0; sub < 4; sub++) inputs[sub] = Math.sin(2 * Math.PI * sourceHz * (4 * frame + sub) / (4 * sampleRate));
      decimateFrame(inputs, state, coefficients);
      if (frame >= offset) samples[frame - offset] = state[DECIMATOR_OUTPUT];
    }
    const measured = fourierBin(samples, sampleRate, signedFoldedHz);
    assert.ok(Math.abs(measured.amplitude - expected.magnitude) < 2e-9, 'actual filter magnitude matches the direct half-band transfer');
    const phase = Math.atan2(expected.imaginary, expected.real) + 2 * Math.PI * sourceHz * (offset + 0.75) / sampleRate - Math.PI / 2;
    const phaseError = Math.atan2(Math.sin(Math.atan2(measured.imaginary, measured.real) - phase), Math.cos(Math.atan2(measured.imaginary, measured.real) - phase));
    if (expected.magnitude > 1e-5) assert.ok(Math.abs(phaseError) < 2e-7, 'actual phase includes the linear-phase delay and fourth-substep sampling');
    const butterworth = butterworthFilterMagnitude(sourceHz, sampleRate);
    if (fraction <= 0.4) assert.ok(Math.abs(db(measured.amplitude)) < 0.002 && expected.magnitude >= butterworth, 'passband is flat to .40 Fs and flatter than the former Butterworth');
    // Products at or above .60 Fs fold below .40 Fs. Near output Nyquist the
    // former filter gave only -52.3/-55.6 dB at .60/.625 Fs; far above it (its
    // bilinear zero at the internal Nyquist) it was steeper than this FIR.
    if (fraction >= 0.6) assert.ok(measured.amplitude < 10 ** (-80 / 20), 'folded aliases are rejected by at least 80 dB');
    if (fraction >= 0.6 && fraction < 1) assert.ok(measured.amplitude < butterworth / 10, 'near-Nyquist folds are 20 dB below the former filter');
    return { fraction, sourceHz, expectedDb: db(expected.magnitude), butterworthDb: db(butterworth),
      measuredDb: db(measured.amplitude), phaseError };
  });
  const reference = filterImpulseBounds(), state = new Float64Array(DECIMATOR_STATE_SIZE), inputs = new Float64Array(4);
  let energy = 0, firstMoment = 0, maxError = 0;
  for (let i = 0; i < 4096; i++) {
    // The cascade emits once per four substeps; compare it with the fourth-substep phase of the full-rate impulse.
    inputs[0] = i === 0 ? 1 : 0;
    decimateFrame(inputs, state, coefficients);
    const sample = state[DECIMATOR_OUTPUT];
    const expected = reference.impulse[4 * i + 3] ?? 0;
    maxError = Math.max(maxError, Math.abs(sample - expected));
    energy += sample ** 2; firstMoment += i * sample ** 2;
  }
  assert.ok(maxError < 1e-12, 'decimated impulse agrees with independent Fourier inversion');
  assert.equal(decimatorPeak(state), 0, 'all preallocated filter history drains to exact zero after the input ends');
  let passbandRippleDb = 0, stopbandDb = -Infinity;
  for (let i = 0; i <= 4000; i++) {
    const fraction = 4 * i / 4000;
    const magnitude = filterResponse(fraction * sampleRate, sampleRate).magnitude;
    // Only inputs that fold below .40 Fs matter for the stopband; the internal 4 Fs repeat is the source's own alias.
    const folded = Math.abs(fraction - Math.round(fraction));
    if (fraction <= 0.4) passbandRippleDb = Math.max(passbandRippleDb, Math.abs(db(magnitude)));
    else if (fraction >= 0.6 && fraction <= 3.4 && folded <= 0.4) stopbandDb = Math.max(stopbandDb, db(magnitude));
  }
  assert.ok(passbandRippleDb < 0.002 && stopbandDb < -80);
  return { sampleRate, design: 'polyphase half-band FIR cascade, 15 taps at 4 Fs then 47 taps at 2 Fs; passband .40 Fs, stopband from .60 Fs',
    stateScalars: DECIMATOR_STATE_SIZE, stages: Math.log2(coefficients[0]), response, impulseMaximumError: maxError,
    passbandRippleDb, stopbandDb, butterworthNyquistDb: db(butterworthFilterMagnitude(sampleRate / 2, sampleRate)),
    latency: { groupDelayFrames: filterGroupDelayFrames(), groupDelaySeconds: filterGroupDelayFrames() / sampleRate,
      energyDelayOutputFrames: firstMoment / energy,
      caveat: 'Constant linear-phase group delay of the filter, not host audio latency.' },
    theory: { impulseL1: reference.l1, absoluteImpulseFirstMoment: reference.absoluteFirstMoment } };
}
