import assert from 'node:assert/strict';
import { createDecimatorCoefficients, decimateSample, DECIMATOR_STATE_SIZE } from '../src/core/decimator.js';
import { acceptedFilterMagnitude, legacyFilterMagnitude, fourierBin } from './fm-reference-fixtures.js';
import { filterResponse, filterImpulseBounds, filterGroupDelayFrames } from './decimator-reference.js';

export function verifyDecimator(sampleRate: number) {
  const coefficients = createDecimatorCoefficients(sampleRate);
  const response = [0.1, 0.2, 0.25, 0.35, 0.5, 0.625, 1.125].map(fraction => {
    const sourceHz = Math.round(fraction * sampleRate);
    const signedFoldedHz = sourceHz - Math.round(sourceHz / sampleRate) * sampleRate;
    // Nyquist has only one quadrature; evaluate its transfer analytically.
    if (Math.abs(signedFoldedHz) === sampleRate / 2) return {
      fraction, sourceHz, expectedDb: 20 * Math.log10(acceptedFilterMagnitude(sourceHz, sampleRate)),
      legacyDb: 20 * Math.log10(legacyFilterMagnitude(sourceHz, sampleRate)), measuredDb: null, phaseError: null,
    };
    const offset = Math.ceil(sampleRate / 4), samples = new Float64Array(sampleRate);
    const state = new Float64Array(DECIMATOR_STATE_SIZE);
    for (let frame = 0; frame < offset + sampleRate; frame++) {
      let output = 0;
      for (let sub = 0; sub < 4; sub++) output = decimateSample(Math.sin(2 * Math.PI * sourceHz * (4 * frame + sub) / (4 * sampleRate)), state, coefficients);
      if (frame >= offset) samples[frame - offset] = output;
    }
    const measured = fourierBin(samples, sampleRate, signedFoldedHz);
    const expected = filterResponse(sourceHz, sampleRate);
    assert.ok(Math.abs(measured.amplitude - expected.magnitude) < 2e-9, 'actual filter magnitude matches independent analog-pole transfer');
    const phase = Math.atan2(expected.imaginary, expected.real) + 2 * Math.PI * sourceHz * (offset + 0.75) / sampleRate - Math.PI / 2;
    const phaseError = Math.atan2(Math.sin(Math.atan2(measured.imaginary, measured.real) - phase), Math.cos(Math.atan2(measured.imaginary, measured.real) - phase));
    if (expected.magnitude > 1e-5) assert.ok(Math.abs(phaseError) < 2e-7, 'actual phase includes causal delay and fourth-substep sampling');
    const legacy = legacyFilterMagnitude(sourceHz, sampleRate);
    if (fraction <= 0.35) assert.ok(expected.magnitude > legacy, 'upper passband is flatter than the former cascade');
    else assert.ok(expected.magnitude <= legacy && measured.amplitude < 10 ** (-30 / 20), 'controlled folded aliases retain or improve accepted rejection');
    return { fraction, sourceHz, expectedDb: 20 * Math.log10(expected.magnitude), legacyDb: 20 * Math.log10(legacy),
      measuredDb: 20 * Math.log10(measured.amplitude), phaseError };
  });
  const reference = filterImpulseBounds(), state = new Float64Array(DECIMATOR_STATE_SIZE);
  let energy = 0, firstMoment = 0, maxError = 0;
  for (let i = 0; i < 4096; i++) {
    const sample = decimateSample(i === 0 ? 1 : 0, state, coefficients);
    maxError = Math.max(maxError, Math.abs(sample - reference.impulse[i]));
    energy += sample ** 2; firstMoment += i * sample ** 2;
  }
  assert.ok(maxError < 1e-12, 'causal impulse agrees with independent Fourier inversion');
  assert.ok(state.every(value => Math.abs(value) < 1e-12), 'all preallocated filter state drains after the input ends');
  const energyDelayOutputFrames = firstMoment / energy / 4;
  assert.ok(Math.abs(energyDelayOutputFrames - reference.energyDelayOutputFrames) < 1e-10);
  // Closed-form former impulse: choose(n+3,3) (1-p)^4 p^n.
  const legacyPole = Math.exp(-2 * Math.PI * 0.2 / 4);
  let legacyEnergy = 0, legacyFirstMoment = 0;
  for (let n = 0; n < 4096; n++) {
    const impulse = (n + 1) * (n + 2) * (n + 3) / 6 * (1 - legacyPole) ** 4 * legacyPole ** n;
    legacyEnergy += impulse ** 2; legacyFirstMoment += n * impulse ** 2;
  }
  return { sampleRate, design: '8th-order bilinear Butterworth, cutoff .30 output Fs, internal 4 Fs',
    stateScalars: DECIMATOR_STATE_SIZE, sections: 4, response, impulseMaximumError: maxError,
    latency: { dcGroupDelayFrames: filterGroupDelayFrames(0), upperRegisterGroupDelayFrames: filterGroupDelayFrames(0.25),
      energyDelayOutputFrames, energyDelaySeconds: energyDelayOutputFrames / sampleRate,
      formerFilterTheory: { dcGroupDelayFrames: legacyPole / (1 - legacyPole),
        energyDelayOutputFrames: legacyFirstMoment / legacyEnergy / 4 },
      caveat: 'Frequency-dependent IIR phase/group delay, not a fixed linear-phase or host audio latency.' },
    theory: { impulseL1: reference.l1, absoluteImpulseFirstMoment: reference.absoluteFirstMoment,
      rejectedCandidate: { cutoff: 0.32, nyquistDb: 20 * Math.log10(filterResponse(sampleRate / 2, sampleRate, 0.32).magnitude),
        reason: 'Slightly weaker Nyquist rejection than the former filter; .30 is conservative.' } } };
}
