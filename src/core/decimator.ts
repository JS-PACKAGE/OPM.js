// Four low-Q-first biquads at 4x output rate. The .30 Fs cutoff preserves
// the former controlled alias gates while flattening the upper passband.
export const DECIMATOR_STATE_SIZE = 8;

export function createDecimatorCoefficients(sampleRate: number): Float64Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive and finite');
  const coefficients = new Float64Array(20);
  const warped = Math.tan(Math.PI * 0.30 / 4);
  const square = warped * warped;
  for (let section = 0; section < 4; section++) {
    const damping = 2 * Math.cos((2 * section + 1) * Math.PI / 16);
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
  for (let section = 0; section < 4; section++) {
    const coefficient = section * 5, memory = section * 2;
    const output = coefficients[coefficient] * input + state[memory];
    state[memory] = coefficients[coefficient + 1] * input - coefficients[coefficient + 3] * output + state[memory + 1];
    state[memory + 1] = coefficients[coefficient + 2] * input - coefficients[coefficient + 4] * output;
    input = output;
  }
  return input;
}
