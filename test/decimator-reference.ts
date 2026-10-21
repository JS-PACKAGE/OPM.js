// Reference mathematics only: the half-band taps are the design contract and
// are read from the coefficient table, but the transfer is evaluated directly
// as each linear-phase stage's DTFT. The polyphase rings are not used.
import { createDecimatorCoefficients } from '../src/core/decimator.js';
import type { QualityProfile } from '../src/core/decimator.js';
import { referenceProfile } from './fm-reference-fixtures.js';

/** Unique half-band taps per stage, input stage first, with every stage's input-rate multiple. */
export function halfBandStages(quality: QualityProfile = 'standard') {
  const table = createDecimatorCoefficients(1, quality), stages: { taps: Float64Array; rate: number }[] = [];
  const { factor } = referenceProfile(quality);
  for (let stage = 0, offset = 1; stage < Math.log2(table[0]); stage++) {
    const count = table[offset];
    stages.push({ taps: table.slice(offset + 1, offset + 1 + count), rate: factor / 2 ** stage });
    offset += 1 + count;
  }
  return stages;
}

// H_s(w) = e^{-jwc} (1/2 + 2 sum_k g_k cos((2k-1) w)), w at the stage input rate
// and c = 2M-1 its centre delay. The cascade is evaluated at the internal rate,
// so source products fold at the profile's INTERNAL Nyquist before filtering.
export function filterResponse(frequency: number, sampleRate: number, quality: QualityProfile = 'standard') {
  let magnitude = 1, phase = 0;
  for (const { taps, rate } of halfBandStages(quality)) {
    const omega = 2 * Math.PI * frequency / (rate * sampleRate);
    let amplitude = 0.5;
    for (let k = 0; k < taps.length; k++) amplitude += 2 * taps[k] * Math.cos((2 * k + 1) * omega);
    magnitude *= amplitude;
    phase -= omega * (2 * taps.length - 1);
  }
  return { real: magnitude * Math.cos(phase), imaginary: magnitude * Math.sin(phase), magnitude: Math.abs(magnitude) };
}

/** Linear-phase delay of the cascade in output frames. */
export function filterGroupDelayFrames(quality: QualityProfile = 'standard'): number {
  return halfBandStages(quality).reduce((sum, { taps, rate }) => sum + (2 * taps.length - 1) / rate, 0);
}

export function fft(real: Float64Array, imaginary: Float64Array, inverse = false): void {
  const length = real.length;
  for (let i = 1, reversed = 0; i < length; i++) {
    let bit = length / 2;
    while (reversed >= bit) { reversed -= bit; bit /= 2; }
    reversed += bit;
    if (i < reversed) {
      [real[i], real[reversed]] = [real[reversed], real[i]];
      [imaginary[i], imaginary[reversed]] = [imaginary[reversed], imaginary[i]];
    }
  }
  for (let width = 2; width <= length; width *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / width;
    const stepReal = Math.cos(angle), stepImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += width) {
      let rotationReal = 1, rotationImaginary = 0;
      for (let i = 0; i < width / 2; i++) {
        const a = start + i, b = a + width / 2;
        const productReal = real[b] * rotationReal - imaginary[b] * rotationImaginary;
        const productImaginary = real[b] * rotationImaginary + imaginary[b] * rotationReal;
        real[b] = real[a] - productReal; imaginary[b] = imaginary[a] - productImaginary;
        real[a] += productReal; imaginary[a] += productImaginary;
        const nextReal = rotationReal * stepReal - rotationImaginary * stepImaginary;
        rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal;
        rotationReal = nextReal;
      }
    }
  }
  if (inverse) for (let i = 0; i < length; i++) { real[i] /= length; imaginary[i] /= length; }
}

export function filterByFourier(source: Float64Array, sampleRate: number, quality: QualityProfile = 'standard'): Float64Array {
  // At least 4096 zero input samples remove circular wrap well beyond the
  // longest cascade's finite impulse response.
  const length = 2 ** Math.ceil(Math.log2(source.length + 4096));
  const real = new Float64Array(length), imaginary = new Float64Array(length);
  real.set(source);
  fft(real, imaginary);
  for (let bin = 0; bin < length; bin++) {
    const frequency = (bin <= length / 2 ? bin : bin - length) * referenceProfile(quality).factor * sampleRate / length;
    const response = filterResponse(frequency, sampleRate, quality);
    const nextReal = real[bin] * response.real - imaginary[bin] * response.imaginary;
    imaginary[bin] = real[bin] * response.imaginary + imaginary[bin] * response.real;
    real[bin] = nextReal;
  }
  fft(real, imaginary, true);
  return real.subarray(0, source.length);
}

export function filterImpulseBounds(quality: QualityProfile = 'standard') {
  const source = new Float64Array(4096); source[0] = 1;
  const impulse = filterByFourier(source, 48000, quality);
  let l1 = 0, absoluteFirstMoment = 0, energy = 0, energyFirstMoment = 0;
  for (let i = 0; i < impulse.length; i++) {
    l1 += Math.abs(impulse[i]); absoluteFirstMoment += i * Math.abs(impulse[i]);
    energy += impulse[i] ** 2; energyFirstMoment += i * impulse[i] ** 2;
  }
  return { impulse, l1, absoluteFirstMoment, energyDelayOutputFrames: energyFirstMoment / energy / referenceProfile(quality).factor };
}
