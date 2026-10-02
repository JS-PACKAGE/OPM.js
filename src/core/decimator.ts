// Low-Q-first bilinear Butterworth sections. Standard retains the original
// 4x/order-8 coefficients exactly; eco trades rejection for reduced work.
export type QualityProfile = 'eco' | 'standard' | 'high';
export const DECIMATOR_STATE_SIZE = 8;

export function qualityOversample(quality: QualityProfile): number {
  if (quality !== 'eco' && quality !== 'standard' && quality !== 'high') throw new RangeError('quality must be eco, standard or high');
  return quality === 'eco' ? 2 : quality === 'high' ? 8 : 4;
}

export function createDecimatorCoefficients(sampleRate: number, quality: QualityProfile = 'standard'): Float64Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive and finite');
  const oversample = qualityOversample(quality), sections = quality === 'eco' ? 2 : 4;
  const coefficients = new Float64Array(sections * 5);
  const warped = Math.tan(Math.PI * 0.30 / oversample);
  const square = warped * warped;
  for (let section = 0; section < sections; section++) {
    const damping = 2 * Math.cos((2 * section + 1) * Math.PI / (sections * 4));
    const inverse = 1 / (1 + damping * warped + square);
    const offset = section * 5;
    coefficients[offset] = square * inverse;
    coefficients[offset + 1] = 2 * square * inverse;
    coefficients[offset + 2] = square * inverse;
    coefficients[offset + 3] = 2 * (square - 1) * inverse;
    coefficients[offset + 4] = (1 - damping * warped + square) * inverse;
  }
  return coefficients;
}

// DF-II transposed: state contains [z1,z2] for each section. Admission resets
// all entries; release must drain all entries, not retire at an output crossing.
export function decimateSample(input: number, state: Float64Array, coefficients: Float64Array): number {
  for (let section = 0; section < coefficients.length / 5; section++) {
    const coefficient = section * 5, memory = section * 2;
    const output = coefficients[coefficient] * input + state[memory];
    state[memory] = coefficients[coefficient + 1] * input - coefficients[coefficient + 3] * output + state[memory + 1];
    state[memory + 1] = coefficients[coefficient + 2] * input - coefficients[coefficient + 4] * output;
    input = output;
  }
  return input;
}
