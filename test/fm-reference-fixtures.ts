// Original mathematical fixtures. No chip/emulator tables or DSP implementation
// helpers are used: the reference is sin(wc*t + beta*sin(wm*t)).
import type { Voice } from '../src/voices/schema.js';
import type { QualityProfile } from '../src/core/decimator.js';

// Independent design contract; deliberately not read from production tables.
export const FM_QUALITY_PROFILES = ['eco', 'standard', 'high'] as const;
export function referenceProfile(quality: QualityProfile = 'standard') {
  return quality === 'eco' ? { factor: 2, order: 4 } : { factor: quality === 'high' ? 8 : 4, order: 8 };
}

export const FM_REFERENCE_RATES = [44100, 48000, 96000] as const;
export const FM_INDEX = 16;
export const FM_LEVEL = 0.02;
export const FM_ORDER = 48;
// Normalized to the unsaturated carrier level, not to a measured engine bin.
// This covers Float32 quantization, Fourier accumulation and phase rounding;
// it is not a percentage of the observed alias or an engine-output snapshot.
export const COEFFICIENT_TOLERANCE = 2e-5;

export interface PMFixture { name: string; carrierHz: number; modulatorHz: number; index: number }
export function pmFixtures(sampleRate: number): PMFixture[] {
  return [
    { name: 'high-index-passband', carrierHz: Math.round(sampleRate * 0.043) + 1,
      modulatorHz: Math.round(sampleRate * 0.0014) + 1, index: FM_INDEX },
    { name: 'high-index-wideband', carrierHz: Math.round(sampleRate * 0.031) + 3,
      modulatorHz: Math.round(sampleRate * 0.049) + 1, index: FM_INDEX },
  ];
}

export function pmVoice(fixture: PMFixture): Voice {
  return { version: 7, name: fixture.name, algorithm: 0, feedback: 0, modIndex: fixture.index,
  lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
  ops: Array.from({ length: 4 }, (_, op) => ({
    ratio: (op === 2 ? fixture.modulatorHz : fixture.carrierHz) / 440,
    level: op === 2 ? 1 : op === 3 ? FM_LEVEL : 0,
    detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.05 },
  })) as Voice['ops'], };
}

export function streamVoice(): Voice {
  return { version: 7, name: 'long-held-lfo-glide', algorithm: 7, feedback: 0, modIndex: 0,
  lfo: { rate: 5, amDepth: 0.4, pmDepth: 14, waveform: 'sine' },
  ops: Array.from({ length: 4 }, () => ({ ratio: 1, level: 0.08,
    detune: 0, adsr: { a: 0.01, d: 0, s: 1, r: 0.05 } })) as Voice['ops'], };
}

// Fourier integral for integer-order J_n, evaluated with periodic trapezoidal
// quadrature. This avoids the high-index cancellation of a factorial series.
export function besselJ(order: number, index: number): number {
  const points = 4096;
  let sum = 0;
  for (let i = 0; i < points; i++) {
    const theta = 2 * Math.PI * i / points;
    sum += Math.cos(order * theta - index * Math.sin(theta));
  }
  return sum / points;
}

export function besselTailBound(index: number, lastOrder: number): number {
  // |J_n(x)| <= (|x|/2)^n/n!; bound both tails by a geometric majorant.
  const half = Math.abs(index) / 2;
  let first = 1;
  for (let n = 1; n <= lastOrder + 1; n++) first *= half / n;
  return 2 * first / (1 - half / (lastOrder + 2));
}

// Legacy four-pole transfer retained only for explicit design comparisons.
export function legacyFilterMagnitude(frequency: number, sampleRate: number): number {
  const pole = Math.exp(-2 * Math.PI * 0.2 / 4);
  const numerator = (1 - pole) ** 2;
  const denominator = numerator + 4 * pole * Math.sin(Math.PI * frequency / (4 * sampleRate)) ** 2;
  return (numerator / denominator) ** 2;
}

// Independent bilinear Butterworth magnitude. The periodic tan also accounts
// for source products folding at the profile's INTERNAL Nyquist before filtering.
export function acceptedFilterMagnitude(frequency: number, sampleRate: number, quality: QualityProfile = 'standard'): number {
  const { factor, order } = referenceProfile(quality);
  const normalized = Math.tan(Math.PI * frequency / (factor * sampleRate)) / Math.tan(Math.PI * 0.30 / factor);
  return 1 / Math.sqrt(1 + normalized ** (2 * order));
}

export function foldedFrequency(frequency: number, sampleRate: number): number {
  const wrapped = ((frequency + sampleRate / 2) % sampleRate + sampleRate) % sampleRate - sampleRate / 2;
  return Math.abs(wrapped);
}

export interface Sideband {
  order: number; sourceHz: number; binHz: number; coefficient: number;
  expected: number; alias: boolean;
}
export function referenceSidebands(fixture: PMFixture, sampleRate: number, quality: QualityProfile = 'standard'): Sideband[] {
  const rows: Sideband[] = [];
  for (let order = -FM_ORDER; order <= FM_ORDER; order++) {
    const sourceHz = fixture.carrierHz + order * fixture.modulatorHz;
    const coefficient = besselJ(order, fixture.index);
    rows.push({ order, sourceHz, binHz: foldedFrequency(sourceHz, sampleRate), coefficient,
      expected: Math.abs(coefficient) * acceptedFilterMagnitude(sourceHz, sampleRate, quality),
      alias: Math.abs(sourceHz) >= sampleRate / 2 });
  }
  return rows;
}

// A coherent integer-second Fourier projection. Only one trig pair is needed
// per bin; the complex rotation is independent of the engine oscillator.
export function fourierBin(samples: Float32Array | Float64Array, sampleRate: number, frequency: number) {
  const angle = 2 * Math.PI * frequency / sampleRate;
  const stepReal = Math.cos(angle), stepImaginary = -Math.sin(angle);
  let real = 0, imaginary = 0, rotationReal = 1, rotationImaginary = 0;
  for (let i = 0; i < samples.length; i++) {
    real += samples[i] * rotationReal;
    imaginary += samples[i] * rotationImaginary;
    const nextReal = rotationReal * stepReal - rotationImaginary * stepImaginary;
    rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal;
    rotationReal = nextReal;
  }
  return { real: 2 * real / samples.length, imaginary: 2 * imaginary / samples.length,
    amplitude: 2 * Math.hypot(real, imaginary) / samples.length };
}

export function unsaturatedWindow(samples: Float32Array, headroom: number, offset = 0, length = samples.length - offset) {
  const result = new Float64Array(length);
  // Undo only the documented memoryless stereo output tanh. The spectral
  // target remains the independent Bessel expansion, not another FM engine.
  for (let i = 0; i < length; i++) result[i] = headroom * Math.atanh(samples[offset + i] / headroom);
  return result;
}

export function energyDb(numerator: number, denominator: number): number | null {
  return numerator === 0 ? null : 10 * Math.log10(numerator / denominator);
}
