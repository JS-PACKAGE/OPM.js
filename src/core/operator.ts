import type { OperatorWaveform } from '../voices/schema.js';

export const TAU = 2 * Math.PI;
const INV_PI = 1 / Math.PI;
// Adding then subtracting 1.5 * 2^52 rounds |y| < 2^51 to the nearest integer
// (ties to even) in two exact-order IEEE additions, symmetric in sign.
const ROUND_MAGIC = 6755399441055744;
/**
 * Deterministic sin(pi*u) for a phase u in half-turns. Reduce u = k + f with
 * integer k and f in [-1/2, 1/2], so sin(pi*u) = (-1)^k sin(pi*f), then evaluate
 * an odd degree-11 near-minimax polynomial in f (fitted on sin(a) for a = pi*f in
 * [0, pi/2] by iteratively reweighted least squares, with pi folded into the
 * coefficients): |error| <= 1.4e-11 (about -217 dB, far below Float32
 * resolution) and |result| <= 1. The reduction itself is exact, so half-turn
 * operator phases need no multiply by pi or 1/pi.
 * The polynomial in z = f^2 is evaluated in Estrin form,
 * (c0 + c1 z) + z^2 (c2 + c3 z) + z^4 (c4 + c5 z), which halves the dependent
 * multiply-add chain of Horner form for feedback and modulation chains.
 * Pure arithmetic keeps results identical across JS engines, unlike Math.sin
 * whose last bits are implementation-defined. Non-finite input yields NaN, which
 * Synth reports through its error counter. */
export function sinPi(u: number): number {
  const k = (u + ROUND_MAGIC) - ROUND_MAGIC;
  const f = u - k;
  const z = f * f, z2 = z * z;
  const p = f * ((3.141592653243751 + z * -5.1677127412212185) + z2 * (2.5501627947124317 + z * -0.5992474048092294) +
    (z2 * z2) * (0.08203122969596048 + z * -0.007000499610629468));
  // ToInt32 wraps modulo 2^32, which preserves parity of any exactly representable k.
  return (k & 1) === 0 ? p : -p;
}

/** sin(x) for x in radians through `sinPi`; rounding x/pi adds ~|x|*1e-16
 * (negligible for FM and LFO phases). */
export function fastSin(x: number): number {
  return sinPi(x * INV_PI);
}

const EXP2_RANGE = 64;
// Powers of two by repeated exact doubling/halving (IEEE-exact, unlike `**`,
// whose accuracy ECMAScript leaves implementation-defined).
const EXP2_INTEGERS = new Float64Array(2 * EXP2_RANGE + 1);
EXP2_INTEGERS[EXP2_RANGE] = 1;
for (let n = 1; n <= EXP2_RANGE; n++) {
  EXP2_INTEGERS[EXP2_RANGE + n] = EXP2_INTEGERS[EXP2_RANGE + n - 1] * 2;
  EXP2_INTEGERS[EXP2_RANGE - n] = EXP2_INTEGERS[EXP2_RANGE - n + 1] / 2;
}
/**
 * Deterministic 2^x for audio-rate pitch and gain curves. Split x = n + f with
 * integer n and f in [-1/2, 1/2]; 2^f = 1 + f*q(f) is a degree-9 near-minimax
 * polynomial with relative error <= 2e-14, scaled exactly by a table power 2^n.
 * q is evaluated in Estrin form (pairs combined by f^2, f^4 and f^8), which
 * shortens the dependent chain on per-frame LFO and pitch paths.
 * Outside |n| <= 64 (and for non-finite x) it defers to the ** operator. */
export function fastExp2(x: number): number {
  const n = (x + ROUND_MAGIC) - ROUND_MAGIC;
  if (!(n >= -EXP2_RANGE && n <= EXP2_RANGE)) return 2 ** x;
  const f = x - n;
  const f2 = f * f, f4 = f2 * f2;
  const q = (0.6931471805598848 + f * 0.24022650695722692) + f2 * (0.05550410866843088 + f * 0.009618129181193839) +
    f4 * ((0.0013333557622879529 + f * 0.00015403440862087186) + f2 * (1.5252991540055915e-5 + f * 1.3258340763777297e-6)) +
    (f4 * f4) * 1.0148052384218113e-7;
  return (1 + f * q) * EXP2_INTEGERS[n + EXP2_RANGE];
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
  // Unary + types each case as a number: when the JIT inlines this dispatcher, a
  // never-taken case's un-inlined call would otherwise make the merged result
  // generic and box every sample, whichever shape is playing.
  switch (code) {
    case 0: return +fastSin(theta);
    case 1: return +halfWave(t, dt);
    case 2: return Math.abs(fastSin(t * TAU));
    case 3: return (t * 2 - Math.floor(t * 2)) < 0.5 ? Math.abs(fastSin(t * TAU)) : 0;
    case 4: return t < 0.5 ? +fastSin(t * TAU * 2) : 0;
    case 5: return t < 0.5 ? Math.abs(fastSin(t * TAU * 2)) : 0;
    case 6: return +squareWave(t, dt);
    case 7: return +sawWave(t, dt);
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
