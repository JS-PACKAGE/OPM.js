// Cascaded polyphase half-band FIR decimators. Each 2:1 stage is a linear-phase
// half-band filter: h[c] = 1/2, h[c +/- (2k-1)] = g_k, every other tap zero, so
// an output costs one multiply per unique g_k and odd inputs are only stored.
// Outputs are computed only on the input that completes an output sample.
export type QualityProfile = 'eco' | 'standard' | 'high';

// Equiripple g_k (Parks-McClellan, Vaidyanathan-Nguyen half-band construction:
// a length-(N+1)/2 lowpass with band [0, 2fp] interleaved with a 1/2 centre
// tap), listed from the centre outward. Band edges are fractions of the stage
// input rate; every profile keeps 0.40 output Fs flat and rejects products
// that would fold below it.
//   FINAL: 47 taps, pass 0.20, stop 0.30, ripple 0.0008 dB, rejection 81 dB
//   ECO:   35 taps, pass 0.20, stop 0.30, ripple 0.006 dB, rejection 63 dB
//   PRE2:  15 taps, pass 0.10, stop 0.40, rejection 89 dB (4 Fs -> 2 Fs)
//   PRE4:  11 taps, pass 0.05, stop 0.45, rejection 106 dB (8 Fs -> 4 Fs)
const F1 = 0.3164573107101666, F2 = -0.10065728471315669, F3 = 0.0549446763048627, F4 = -0.033979806226539004,
  F5 = 0.021712921010146796, F6 = -0.013788305731458304, F7 = 0.008499280637105077, F8 = -0.004988038667681774,
  F9 = 0.0027290679355723955, F10 = -0.0013520687478027022, F11 = 0.0005767494872103538,
  F12 = -0.00019798241915629897;
const FINAL = [F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12];
const E1 = 0.31592690197407713, E2 = -0.0991305576955315, E3 = 0.05260390642405356, E4 = -0.031093817211975745,
  E5 = 0.018592309126297762, E6 = -0.010736380821098112, E7 = 0.005768228021105346, E8 = -0.0027484154637114067,
  E9 = 0.0011561225412616445;
const ECO = [E1, E2, E3, E4, E5, E6, E7, E8, E9];
const P1 = 0.3031702759394068, P2 = -0.06767845839954242, P3 = 0.016965306028530937, P4 = -0.002474169844978839;
const PRE2 = [P1, P2, P3, P4];
const Q1 = 0.29440468859312763, Q2 = -0.05103558374381977, Q3 = 0.006633361103115076;
const PRE4 = [Q1, Q2, Q3];

// State: [ring write position per stage (3 slots), the last output, then each
// stage's doubled ring of N samples]. Writing every input at p and p+N keeps the
// newest N inputs contiguous, so taps are read without wrapping.
/** Index of the state slot holding the last decimated sample. */
export const DECIMATOR_OUTPUT = 3;
const OUTPUT = DECIMATOR_OUTPUT, HEADER = 4, RINGS = HEADER;
const ringSize = (taps: readonly number[]) => 2 * (4 * taps.length - 1);
// Sized for the deepest (high) cascade; shallower profiles use a prefix.
export const DECIMATOR_STATE_SIZE = RINGS + ringSize(PRE4) + ringSize(PRE2) + ringSize(FINAL);

export function qualityOversample(quality: QualityProfile): number {
  if (quality !== 'eco' && quality !== 'standard' && quality !== 'high') throw new RangeError('quality must be eco, standard or high');
  return quality === 'eco' ? 2 : quality === 'high' ? 8 : 4;
}

// Describes the cascade, input stage first: [oversampling factor, then per
// stage: unique tap count M, g_1..g_M]. decimateFrame dispatches on the
// factor and uses the same g_k through its unrolled kernels.
export function createDecimatorCoefficients(sampleRate: number, quality: QualityProfile = 'standard'): Float64Array {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive and finite');
  const oversample = qualityOversample(quality);
  const stages = oversample === 2 ? [ECO] : oversample === 4 ? [PRE2, FINAL] : [PRE4, PRE2, FINAL];
  const coefficients = new Float64Array(1 + stages.reduce((sum, taps) => sum + 1 + taps.length, 0));
  coefficients[0] = oversample;
  let offset = 1;
  for (const taps of stages) {
    coefficients[offset] = taps.length;
    coefficients.set(taps, offset + 1);
    offset += 1 + taps.length;
  }
  return coefficients;
}

// Ring offsets: each profile packs its stages in order after the frame inputs.
const STANDARD_FINAL = RINGS + ringSize(PRE2);
const HIGH_PRE2 = RINGS + ringSize(PRE4), HIGH_FINAL = HIGH_PRE2 + ringSize(PRE2);

// Frame kernels are written out by hand with integer ring positions. s[c] is
// the centre of an oldest-first window; x holds the frame's inputs.
function ecoFrame(x: Float64Array, s: Float64Array): void {
  let p = s[0] | 0;
  for (let k = 0; k < 2; k++) {
    const v = x[k];
    s[RINGS + p] = v; s[RINGS + p + 35] = v;
    p = p === 34 ? 0 : p + 1;
  }
  s[0] = p;
  const c = RINGS + p + 17;
  s[OUTPUT] = 0.5 * s[c] + E1 * (s[c - 1] + s[c + 1]) + E2 * (s[c - 3] + s[c + 3]) + E3 * (s[c - 5] + s[c + 5])
    + E4 * (s[c - 7] + s[c + 7]) + E5 * (s[c - 9] + s[c + 9]) + E6 * (s[c - 11] + s[c + 11])
    + E7 * (s[c - 13] + s[c + 13]) + E8 * (s[c - 15] + s[c + 15]) + E9 * (s[c - 17] + s[c + 17]);
}

function standardFrame(x: Float64Array, s: Float64Array): void {
  let p = s[0] | 0, q = s[1] | 0;
  for (let k = 0; k < 4; k++) {
    const v = x[k];
    s[RINGS + p] = v; s[RINGS + p + 15] = v;
    p = p === 14 ? 0 : p + 1;
    if ((k & 1) === 0) continue;
    const c = RINGS + p + 7;
    const y = 0.5 * s[c] + P1 * (s[c - 1] + s[c + 1]) + P2 * (s[c - 3] + s[c + 3]) + P3 * (s[c - 5] + s[c + 5])
      + P4 * (s[c - 7] + s[c + 7]);
    s[STANDARD_FINAL + q] = y; s[STANDARD_FINAL + q + 47] = y;
    q = q === 46 ? 0 : q + 1;
  }
  s[0] = p; s[1] = q;
  const c = STANDARD_FINAL + q + 23;
  s[OUTPUT] = 0.5 * s[c] + F1 * (s[c - 1] + s[c + 1]) + F2 * (s[c - 3] + s[c + 3]) + F3 * (s[c - 5] + s[c + 5])
    + F4 * (s[c - 7] + s[c + 7]) + F5 * (s[c - 9] + s[c + 9]) + F6 * (s[c - 11] + s[c + 11])
    + F7 * (s[c - 13] + s[c + 13]) + F8 * (s[c - 15] + s[c + 15]) + F9 * (s[c - 17] + s[c + 17])
    + F10 * (s[c - 19] + s[c + 19]) + F11 * (s[c - 21] + s[c + 21]) + F12 * (s[c - 23] + s[c + 23]);
}

function highFrame(x: Float64Array, s: Float64Array): void {
  let p = s[0] | 0, q = s[1] | 0, r = s[2] | 0;
  for (let k = 0; k < 8; k++) {
    const v = x[k];
    s[RINGS + p] = v; s[RINGS + p + 11] = v;
    p = p === 10 ? 0 : p + 1;
    if ((k & 1) === 0) continue;
    const c = RINGS + p + 5;
    const y = 0.5 * s[c] + Q1 * (s[c - 1] + s[c + 1]) + Q2 * (s[c - 3] + s[c + 3]) + Q3 * (s[c - 5] + s[c + 5]);
    s[HIGH_PRE2 + q] = y; s[HIGH_PRE2 + q + 15] = y;
    q = q === 14 ? 0 : q + 1;
    if ((k & 3) !== 3) continue;
    const d = HIGH_PRE2 + q + 7;
    const z = 0.5 * s[d] + P1 * (s[d - 1] + s[d + 1]) + P2 * (s[d - 3] + s[d + 3]) + P3 * (s[d - 5] + s[d + 5])
      + P4 * (s[d - 7] + s[d + 7]);
    s[HIGH_FINAL + r] = z; s[HIGH_FINAL + r + 47] = z;
    r = r === 46 ? 0 : r + 1;
  }
  s[0] = p; s[1] = q; s[2] = r;
  const c = HIGH_FINAL + r + 23;
  s[OUTPUT] = 0.5 * s[c] + F1 * (s[c - 1] + s[c + 1]) + F2 * (s[c - 3] + s[c + 3]) + F3 * (s[c - 5] + s[c + 5])
    + F4 * (s[c - 7] + s[c + 7]) + F5 * (s[c - 9] + s[c + 9]) + F6 * (s[c - 11] + s[c + 11])
    + F7 * (s[c - 13] + s[c + 13]) + F8 * (s[c - 15] + s[c + 15]) + F9 * (s[c - 17] + s[c + 17])
    + F10 * (s[c - 19] + s[c + 19]) + F11 * (s[c - 21] + s[c + 21]) + F12 * (s[c - 23] + s[c + 23]);
}

// Decimates one output frame from its `factor` oversampled inputs (oldest first),
// running the whole cascade once, and stores it in state[DECIMATOR_OUTPUT].
// Admission resets all entries; release must drain all entries, not retire at an
// output crossing. Nothing is returned: callers read the output with a typed-array
// load, because V8 boxes a double returned from a call it did not inline, and a
// merge with such a result would box every frame's sample.
export function decimateFrame(inputs: Float64Array, state: Float64Array, coefficients: Float64Array): void {
  const factor = coefficients[0];
  if (factor === 4) standardFrame(inputs, state);
  else if (factor === 2) ecoFrame(inputs, state);
  else highFrame(inputs, state);
}

/** Largest buffered sample magnitude, excluding ring positions and the derived
 * DECIMATOR_OUTPUT slot (a function of the history, overwritten every frame). */
export function decimatorPeak(state: Float64Array): number {
  let peak = 0;
  for (let index = HEADER; index < state.length; index++) peak = Math.max(peak, Math.abs(state[index]));
  return peak;
}
