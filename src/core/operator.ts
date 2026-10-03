import type { OperatorWaveform } from '../voices/schema.js';

export const TAU = 2 * Math.PI;
const INV_PI = 1 / Math.PI;
/**
 * Deterministic sine used by sine operators. Reduce x = k*pi + a with
 * a in [-pi/2, pi/2], so sin(x) = (-1)^k sin(a), then evaluate an odd degree-13
 * polynomial. It is the Taylor series with the a^13 coefficient lowered
 * (1.58e-10 instead of 1/13!) so the peak at a = pi/2 stays below 1:
 * |error| <= 2.0e-10 (about -194 dB, below Float32 resolution) and |result| <= 1,
 * plus ~|x|*1e-16 from reducing by a double-precision pi (negligible for FM phases).
 * Pure arithmetic keeps results identical across JS engines, unlike Math.sin
 * whose last bits are implementation-defined. Non-finite input yields NaN, which
 * Synth reports through its error counter. */
export function fastSin(x: number): number {
  const k = Math.round(x * INV_PI);
  const a = x - k * Math.PI;
  const z = a * a;
  const p = a * (1 + z * (-0.16666666666666666 + z * (0.008333333333333333 + z * (-0.0001984126984126984 +
    z * (2.7557319223985893e-6 + z * (-2.505210838544172e-8 + z * 1.5815631986383464e-10))))));
  // ToInt32 wraps modulo 2^32, which preserves parity of any exactly representable k.
  return (k & 1) === 0 ? p : -p;
}
export function sineOperator(phase: number, modulation: number, gain: number): number {
  return fastSin(phase + modulation) * gain;
}

const WAVEFORM_NAMES: readonly OperatorWaveform[] = ['sine', 'half', 'abs', 'quarter', 'alternating', 'camel', 'square', 'saw', 'noise'];
/** Integer oscillator codes are resolved once at admission, never in the audio loop. */
export function waveformCode(waveform: OperatorWaveform = 'sine'): number {
  return WAVEFORM_NAMES.indexOf(waveform);
}

/** Pure periodic shapes. Noise is stateful and handled by Synth, not this function.
 * With t=frac(theta/TAU): half=max(0,sin); abs=|sin|;
 * quarter=|sin| when frac(theta/pi)<1/2; alternating=sin(2theta) when t<1/2;
 * camel=|sin(2theta)| when t<1/2; square=sign(sin), zero maps to +1;
 * saw=2*frac(t+1/2)-1, rising through zero at theta=0.
 * Discontinuous shapes are naive, not alias-free.
 */
export function periodicWaveform(theta: number, code: number): number {
  if (!Number.isFinite(theta)) return 0;
  const turns = theta / TAU;
  const t = turns - Math.floor(turns);
  const sine = Math.sin(t * TAU);
  switch (code) {
    case 0: return fastSin(theta);
    case 1: return Math.max(0, sine);
    case 2: return Math.abs(sine);
    case 3: return (t * 2 - Math.floor(t * 2)) < 0.5 ? Math.abs(sine) : 0;
    case 4: return t < 0.5 ? Math.sin(t * TAU * 2) : 0;
    case 5: return t < 0.5 ? Math.abs(Math.sin(t * TAU * 2)) : 0;
    case 6: return sine >= 0 ? 1 : -1;
    case 7: return 2 * ((t + 0.5) - Math.floor(t + 0.5)) - 1;
    default: return 0;
  }
}

// Primitive polynomial x^17+x^3+1: right shift, XOR bits 0 and 3 into bit 16.
export const NOISE_SEED = 0x1ffff;
export function advanceNoise(state: number): number {
  return (state >>> 1) | (((state ^ (state >>> 3)) & 1) << 16);
}

// Any numerical failure is audible silence, and observable through diagnostics.
export function finiteOrSilence(value: number, diagnostics: { errors: number }): number {
  if (Number.isFinite(value)) return value;
  diagnostics.errors++;
  return 0;
}
