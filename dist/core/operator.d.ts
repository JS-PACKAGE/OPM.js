import type { OperatorWaveform } from '../voices/schema.js';
export declare const TAU: number;
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
export declare function sinPi(u: number): number;
/** sin(x) for x in radians through `sinPi`; rounding x/pi adds ~|x|*1e-16
 * (negligible for FM and LFO phases). */
export declare function fastSin(x: number): number;
/**
 * Deterministic 2^x for audio-rate pitch and gain curves. Split x = n + f with
 * integer n and f in [-1/2, 1/2]; 2^f = 1 + f*q(f) is a degree-9 near-minimax
 * polynomial with relative error <= 2e-14, scaled exactly by a table power 2^n.
 * q is evaluated in Estrin form (pairs combined by f^2, f^4 and f^8), which
 * shortens the dependent chain on per-frame LFO and pitch paths.
 * Outside |n| <= 64 (and for non-finite x) it defers to the ** operator. */
export declare function fastExp2(x: number): number;
export declare function sineOperator(phase: number, modulation: number, gain: number): number;
/** Integer oscillator codes are resolved once at admission, never in the audio loop. */
export declare function waveformCode(waveform?: OperatorWaveform): number;
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
export declare function periodicWaveform(theta: number, code: number, dt?: number): number;
export declare const NOISE_SEED = 131071;
export declare function advanceNoise(state: number): number;
export declare function finiteOrSilence(value: number, diagnostics: {
    errors: number;
}): number;
