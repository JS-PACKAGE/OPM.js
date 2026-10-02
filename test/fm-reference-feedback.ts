// Original delayed-feedback mathematics and Fourier analysis; no engine graph,
// oscillator, feedback, filter recurrence or emulator implementation is reused.
import assert from 'node:assert/strict';
import { HEADROOM, Synth } from '../src/core/index.js';
import type { Voice } from '../src/voices/schema.js';
import {
  COEFFICIENT_TOLERANCE, acceptedFilterMagnitude, energyDb, foldedFrequency, fourierBin, unsaturatedWindow,
} from './fm-reference-fixtures.js';

const FEEDBACK_LEVEL = 0.25;
const HARMONICS = 96;

function feedbackVoice(frequency: number, level: number): Voice {
  return {
    version: 4, name: 'independent-feedback-7', algorithm: 7, feedback: 7, modIndex: 0,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: Array.from({ length: 4 }, (_, i) => ({ ratio: frequency / 880, level: i === 0 ? level : 0,
      detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.05 } })) as Voice['ops'],
  };
}

function periodicFeedback(frequency: number, sampleRate: number, points: number) {
  // Solve y(theta)=a*sin(theta+pi/2*(y(theta-d)+y(theta-2d)))
  // on the entire periodic phase grid by Jacobi iteration, not chronological
  // engine sampling. Keep the physical delays d=2pi*f/(4Fs) at both grids.
  // a*pi<1 gives a unique periodic solution and an a-posteriori error bound.
  const lipschitz = FEEDBACK_LEVEL * Math.PI;
  const firstDelay = frequency / (4 * sampleRate) * points;
  const secondDelay = firstDelay * 2;
  const firstShift = Math.floor(firstDelay), firstFraction = firstDelay - firstShift;
  const secondShift = Math.floor(secondDelay), secondFraction = secondDelay - secondShift;
  let previous = new Float64Array(points), next = new Float64Array(points);
  const phases = Float64Array.from({ length: points }, (_, i) => 2 * Math.PI * i / points);
  let iterations = 0, errorBound = Infinity;
  do {
    let maximumChange = 0;
    for (let i = 0; i < points; i++) {
      const a = (i - firstShift + points) % points, b = (i - secondShift + points) % points;
      const delayedOnce = previous[a] * (1 - firstFraction) + previous[(a - 1 + points) % points] * firstFraction;
      const delayedTwice = previous[b] * (1 - secondFraction) + previous[(b - 1 + points) % points] * secondFraction;
      next[i] = FEEDBACK_LEVEL * Math.sin(phases[i] + Math.PI / 2 * (delayedOnce + delayedTwice));
      maximumChange = Math.max(maximumChange, Math.abs(next[i] - previous[i]));
    }
    const swap = previous;
    previous = next;
    next = swap;
    errorBound = maximumChange / (1 - lipschitz);
    iterations++;
  } while (errorBound > 1e-10 && iterations < 200);
  assert.ok(errorBound <= 1e-10, 'contractive periodic feedback reference converges');
  return { samples: previous, iterations, errorBound, lipschitz };
}

function verifyStableFeedback(sampleRate: number) {
  const frequency = Math.round(sampleRate * 0.079) + 1;
  const coarse = periodicFeedback(frequency, sampleRate, 32768);
  const fine = periodicFeedback(frequency, sampleRate, 65536);
  const synth = new Synth(sampleRate);
  synth.noteOn(feedbackVoice(frequency, FEEDBACK_LEVEL), 81);
  const offset = Math.ceil(sampleRate / 4);
  const left = new Float32Array(offset + sampleRate), right = new Float32Array(left.length);
  synth.render(left, right);
  assert.equal(synth.errorCount, 0);
  const window = unsaturatedWindow(left, HEADROOM, offset, sampleRate);
  const normalization = HEADROOM * FEEDBACK_LEVEL / 4;
  // Delayed sine feedback can have DC; excluding it would mistake a genuine
  // mean shift for an unresolved high-harmonic tail.
  let referenceMean = 0, measuredMean = 0;
  for (const value of fine.samples) referenceMean += value / (fine.samples.length * FEEDBACK_LEVEL);
  for (const value of window) measuredMean += value / (window.length * normalization);
  assert.ok(Math.abs(referenceMean - measuredMean) < COEFFICIENT_TOLERANCE, 'feedback DC matches the independent delayed reference');
  let maximumGridDifference = 0, maximumEngineError = 0;
  let idealPassbandEnergy = 2 * referenceMean ** 2, expectedPassbandEnergy = idealPassbandEnergy;
  let measuredPassbandEnergy = 2 * measuredMean ** 2;
  let idealUltrasonicEnergy = 0, expectedAliasEnergy = 0, measuredAliasEnergy = 0;
  const bins = new Set<number>();
  const harmonics = [];
  for (let harmonic = 1; harmonic <= HARMONICS; harmonic++) {
    const sourceHz = harmonic * frequency, binHz = foldedFrequency(sourceHz, sampleRate);
    assert.ok(binHz > 0 && binHz < sampleRate / 2 && !bins.has(binHz), 'feedback fixture bins must be distinct');
    bins.add(binHz);
    const coefficient = fourierBin(fine.samples, fine.samples.length, harmonic).amplitude / FEEDBACK_LEVEL;
    const coarseCoefficient = fourierBin(coarse.samples, coarse.samples.length, harmonic).amplitude / FEEDBACK_LEVEL;
    const gridDifference = Math.abs(coefficient - coarseCoefficient);
    maximumGridDifference = Math.max(maximumGridDifference, gridDifference);
    assert.ok(gridDifference < COEFFICIENT_TOLERANCE / 4, 'independent phase-grid harmonics converge');
    const expected = coefficient * acceptedFilterMagnitude(sourceHz, sampleRate);
    const measured = fourierBin(window, sampleRate, binHz).amplitude / normalization;
    const error = Math.abs(measured - expected);
    maximumEngineError = Math.max(maximumEngineError, error);
    assert.ok(error < COEFFICIENT_TOLERANCE,
      `${sampleRate} feedback7 harmonic ${harmonic}: ${measured}, independent ${expected}, error ${error}`);
    const alias = sourceHz >= sampleRate / 2;
    if (alias) {
      idealUltrasonicEnergy += coefficient ** 2;
      expectedAliasEnergy += expected ** 2;
      measuredAliasEnergy += measured ** 2;
    } else {
      idealPassbandEnergy += coefficient ** 2;
      expectedPassbandEnergy += expected ** 2;
      measuredPassbandEnergy += measured ** 2;
    }
    if (coefficient >= 1e-4) harmonics.push({ harmonic, sourceHz, binHz, alias, coefficient, expected, measured, error });
  }
  // Resolved source power beyond the measured harmonic range is an independent
  // tail check, not a blanket claim about unconstrained feedback spectra.
  let sourceEnergy = 0;
  for (const value of fine.samples) sourceEnergy += (value / FEEDBACK_LEVEL) ** 2 / fine.samples.length;
  const accountedEnergy = (idealPassbandEnergy + idealUltrasonicEnergy) / 2;
  const resolvedTailEnergy = Math.max(0, sourceEnergy - accountedEnergy);
  assert.ok(resolvedTailEnergy < COEFFICIENT_TOLERANCE ** 2 / 4, 'resolved reference tail cannot hide a material alias');
  return {
    sampleRate, feedback: 7, operatorLevel: FEEDBACK_LEVEL, frequency,
    reference: { phaseGridPoints: [32768, 65536], physicalDelaySeconds: [1 / (4 * sampleRate), 2 / (4 * sampleRate)],
      equivalentInternalSampleRates: [frequency * 32768, frequency * 65536],
      iterations: [coarse.iterations, fine.iterations], contractionFactor: fine.lipschitz,
      iterationErrorBound: fine.errorBound, maximumGridDifference, resolvedTailEnergy },
    maximumEngineError, coefficientTolerance: COEFFICIENT_TOLERANCE, dc: { referenceMean, measuredMean },
    passband: { expectedBrightnessLossDb: energyDb(expectedPassbandEnergy, idealPassbandEnergy),
      measuredBrightnessLossDb: energyDb(measuredPassbandEnergy, idealPassbandEnergy) },
    aliases: { idealUltrasonicEnergy, expectedAliasEnergy, measuredAliasEnergy,
      measuredRejectionDb: energyDb(measuredAliasEnergy, idealUltrasonicEnergy),
      measuredRelativeToFilteredPassbandDb: energyDb(measuredAliasEnergy, measuredPassbandEnergy) }, harmonics,
  };
}

function fftPower(real: Float64Array) {
  const length = real.length, imaginary = new Float64Array(length);
  for (let i = 1, reversed = 0; i < length; i++) {
    let bit = length / 2;
    while (reversed >= bit) { reversed -= bit; bit /= 2; }
    reversed += bit;
    if (i < reversed) { const swap = real[i]; real[i] = real[reversed]; real[reversed] = swap; }
  }
  for (let width = 2; width <= length; width *= 2) {
    const stepReal = Math.cos(-2 * Math.PI / width), stepImaginary = Math.sin(-2 * Math.PI / width);
    for (let start = 0; start < length; start += width) {
      let rotationReal = 1, rotationImaginary = 0;
      for (let i = 0; i < width / 2; i++) {
        const a = start + i, b = a + width / 2;
        const productReal = real[b] * rotationReal - imaginary[b] * rotationImaginary;
        const productImaginary = real[b] * rotationImaginary + imaginary[b] * rotationReal;
        real[b] = real[a] - productReal;
        imaginary[b] = imaginary[a] - productImaginary;
        real[a] += productReal;
        imaginary[a] += productImaginary;
        const nextReal = rotationReal * stepReal - rotationImaginary * stepImaginary;
        rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal;
        rotationReal = nextReal;
      }
    }
  }
  const powers = new Float64Array(length);
  for (let i = 0; i < length; i++) powers[i] = (real[i] ** 2 + imaginary[i] ** 2) / length ** 2;
  return powers;
}

function verifyFullFeedbackEnergy(sampleRate: number) {
  const frames = 32768, offset = Math.ceil(sampleRate / 4);
  const frequency = sampleRate * 0.18;
  const synth = new Synth(sampleRate);
  synth.noteOn(feedbackVoice(frequency, 1), 81);
  const left = new Float32Array(offset + frames), right = new Float32Array(left.length);
  synth.render(left, right);
  assert.equal(synth.errorCount, 0);
  const window = unsaturatedWindow(left, HEADROOM, offset, frames);
  const carrierGain = HEADROOM / 4;
  let timeEnergy = 0, normalizedPeak = 0;
  for (let i = 0; i < frames; i++) {
    normalizedPeak = Math.max(normalizedPeak, Math.abs(window[i] / carrierGain));
    window[i] *= (0.5 - 0.5 * Math.cos(2 * Math.PI * i / frames)) / carrierGain;
    timeEnergy += window[i] ** 2 / frames;
  }
  assert.ok(normalizedPeak <= 1 + COEFFICIENT_TOLERANCE, 'unit-bounded feedback source and convex filtering bound output');
  const powers = fftPower(window);
  let totalEnergy = 0, highBandEnergy = 0, maximumHighBandTransferPower = 0, maximumAliasTransferPower = 0;
  for (let bin = 0; bin < frames; bin++) {
    totalEnergy += powers[bin];
    const foldedHz = Math.min(bin, frames - bin) * sampleRate / frames;
    if (foldedHz >= sampleRate * 0.25) highBandEnergy += powers[bin];
    const branches = [foldedHz, foldedHz + sampleRate, foldedHz - sampleRate, foldedHz - 2 * sampleRate];
    let transferPower = 0, aliasTransferPower = 0;
    for (let branch = 0; branch < branches.length; branch++) {
      const power = acceptedFilterMagnitude(branches[branch], sampleRate) ** 2;
      transferPower += power;
      if (branch > 0) aliasTransferPower += power;
    }
    if (foldedHz >= sampleRate * 0.25) maximumHighBandTransferPower = Math.max(maximumHighBandTransferPower, transferPower);
    maximumAliasTransferPower = Math.max(maximumAliasTransferPower, aliasTransferPower);
  }
  assert.ok(Math.abs(totalEnergy - timeEnergy) < 1e-10, 'Fourier energy agrees with independent time-domain Parseval energy');
  assert.ok(totalEnergy > 1e-8, 'full feedback fixture produces real, windowed waveform energy');
  // For any bounded (including chaotic) feedback source, Cauchy-Schwarz across
  // the four decimation branches bounds band power by max(sum |H|^2)*input
  // power. Hann mean-square is 3/8. The explicit commutator/boundary allowance
  // is twice window Lipschitz pi/(4N) times the filter's impulse first moment.
  const pole = Math.exp(-2 * Math.PI * 0.2 / 4);
  const filterDelayInternalSamples = 4 * pole / (1 - pole);
  const windowBoundaryRmsAllowance = 2 * Math.PI / (4 * frames) * filterDelayInternalSamples;
  const sourceWindowRmsBound = Math.sqrt(3 / 8);
  const highBandEnergyBound = (Math.sqrt(maximumHighBandTransferPower) * sourceWindowRmsBound + windowBoundaryRmsAllowance) ** 2;
  const mathematicalAliasEnergyBound = (Math.sqrt(maximumAliasTransferPower) * sourceWindowRmsBound + windowBoundaryRmsAllowance) ** 2;
  assert.ok(highBandEnergy <= highBandEnergyBound,
    `${sampleRate} full feedback7 high-band energy ${highBandEnergy} exceeds independent bound ${highBandEnergyBound}`);
  return { sampleRate, feedback: 7, operatorLevel: 1, frequency, windowFrames: frames, window: 'periodic Hann',
    normalizedPeak, totalEnergy, highBandEnergy, highBandEnergyBound,
    highBandRelativeDb: energyDb(highBandEnergy, totalEnergy), mathematicalAliasEnergyBound,
    sourceWindowRmsBound, windowBoundaryRmsAllowance,
    limitation: 'High-band energy combines real upper-passband harmonics and folded aliases. The alias bound is mathematical, not a uniquely measured decomposition or chaotic PCM-convergence claim.' };
}

export function verifyFeedbackSpectrum(sampleRate: number) {
  return { stable: verifyStableFeedback(sampleRate), fullLevel: verifyFullFeedbackEnergy(sampleRate) };
}
