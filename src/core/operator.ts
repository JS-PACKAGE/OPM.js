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

/** PolyBLEP residual for a +2 step at t=0 of a unit-period phase t in [0,1) advancing dt per sample:
 * with x=t/dt after the edge, -(1-x)^2; with x=(t-1)/dt before it, (1+x)^2; zero elsewhere.
 * Adding it replaces the naive jump with an integrated triangular (two-sample) kernel. */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = 1 - t / dt;
    return -x * x;
  }
  if (t > 1 - dt) {
    const x = 1 + (t - 1) / dt;
    return x * x;
  }
  return 0;
}
// Shape helpers stay separate so the hot dispatcher remains small enough for the JIT to inline.
function halfWave(t: number, dt: number): number {
  const value = t < 0.5 ? fastSin(t * TAU) : 0;
  if (!(dt > 0)) return value;
  // Both corners raise the slope by TAU per turn, TAU*step per sample. The polyBLAMP residual
  // (1-x)^3/6, x = samples to the nearest corner, integrates the unit-step polyBLEP residual.
  // step<=0.25 keeps the peak at t=1/4 outside both windows, so value<=1.
  const step = Math.min(dt, 0.25);
  const p = t < 0.5 ? t : t - 0.5;
  const x = (p < 0.25 ? p : 0.5 - p) / step;
  if (x >= 1) return value;
  const y = 1 - x;
  return value + TAU * step * y * y * y / 6;
}
function squareWave(t: number, dt: number): number {
  if (!(dt > 0)) return t <= 0.5 ? 1 : -1;
  // Each residual treats its edge sample as already past the jump. Edges are 0.5 turn apart and
  // Synth caps dt at 0.45, so the windows never overlap and |value|<=1.
  const q = t < 0.5 ? t + 0.5 : t - 0.5;
  return (t < 0.5 ? 1 : -1) + polyBlep(t, dt) - polyBlep(q, dt);
}
function sawWave(t: number, dt: number): number {
  const p = (t + 0.5) - Math.floor(t + 0.5);
  const value = 2 * p - 1;
  return p < dt || p > 1 - dt ? value - polyBlep(p, dt) : value;
}

/** Pure periodic shapes. Noise is stateful and handled by Synth, not this function.
 * With t=frac(theta/TAU): half=max(0,sin); abs=|sin|;
 * quarter=|sin| when frac(theta/pi)<1/2; alternating=sin(2theta) when t<1/2;
 * camel=|sin(2theta)| when t<1/2; square=+1 when t<=1/2, otherwise -1;
 * saw=2*frac(t+1/2)-1, rising through zero at theta=0.
 * dt is the nominal phase advance in turns per sample. When positive, square and saw add
 * polyBLEP residuals at their jumps and half adds polyBLAMP residuals at its two corners;
 * dt=0 returns the naive shapes. Residuals use the unmodulated rate, so they fit carriers and
 * only approximate modulated operators. Other discontinuous shapes stay naive; none is alias-free under arbitrary FM.
 */
export function periodicWaveform(theta: number, code: number, dt = 0): number {
  if (!Number.isFinite(theta)) return 0;
  const turns = theta / TAU;
  const t = turns - Math.floor(turns);
  switch (code) {
    case 0: return fastSin(theta);
    case 1: return halfWave(t, dt);
    case 2: return Math.abs(fastSin(t * TAU));
    case 3: return (t * 2 - Math.floor(t * 2)) < 0.5 ? Math.abs(fastSin(t * TAU)) : 0;
    case 4: return t < 0.5 ? fastSin(t * TAU * 2) : 0;
    case 5: return t < 0.5 ? Math.abs(fastSin(t * TAU * 2)) : 0;
    case 6: return squareWave(t, dt);
    case 7: return sawWave(t, dt);
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
