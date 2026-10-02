// Reference mathematics only: analog Butterworth poles and Fourier convolution.
// Neither the production coefficient generator nor its recurrence is imported.
import type { QualityProfile } from '../src/core/decimator.js';
import { referenceProfile } from './fm-reference-fixtures.js';

export function filterResponse(frequency: number, sampleRate: number, cutoff = 0.30, quality: QualityProfile = 'standard') {
  const { factor, order } = referenceProfile(quality);
  const warpedFrequency = Math.tan(Math.PI * frequency / (factor * sampleRate)) / Math.tan(Math.PI * cutoff / factor);
  let real = 1, imaginary = 0;
  for (let pole = 0; pole < order; pole++) {
    const angle = Math.PI * (2 * pole + order + 1) / (2 * order);
    const poleReal = Math.cos(angle), poleImaginary = Math.sin(angle);
    const denominatorReal = -poleReal, denominatorImaginary = warpedFrequency - poleImaginary;
    const power = denominatorReal ** 2 + denominatorImaginary ** 2;
    const factorReal = (poleReal ** 2 - poleImaginary * denominatorImaginary) / power;
    const factorImaginary = (poleReal * denominatorImaginary + poleReal * poleImaginary) / power;
    const nextReal = real * factorReal - imaginary * factorImaginary;
    imaginary = real * factorImaginary + imaginary * factorReal;
    real = nextReal;
  }
  return { real, imaginary, magnitude: Math.hypot(real, imaginary) };
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
  // slowest pole's settling time, even for envelope/release transitions.
  const length = 2 ** Math.ceil(Math.log2(source.length + 4096));
  const real = new Float64Array(length), imaginary = new Float64Array(length);
  real.set(source);
  fft(real, imaginary);
  for (let bin = 0; bin < length; bin++) {
    const frequency = (bin <= length / 2 ? bin : bin - length) * referenceProfile(quality).factor * sampleRate / length;
    const response = filterResponse(frequency, sampleRate, 0.30, quality);
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

export function filterGroupDelayFrames(fraction: number): number {
  const before = filterResponse(fraction - 1e-6, 1), after = filterResponse(fraction + 1e-6, 1);
  const crossReal = after.real * before.real + after.imaginary * before.imaginary;
  const crossImaginary = after.imaginary * before.real - after.real * before.imaginary;
  return -Math.atan2(crossImaginary, crossReal) / (4 * Math.PI * 1e-6);
}
