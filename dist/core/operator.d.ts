import type { OperatorWaveform } from '../voices/schema.js';
export declare const TAU: number;
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
export declare function fastSin(x: number): number;
export declare function sineOperator(phase: number, modulation: number, gain: number): number;
/** Integer oscillator codes are resolved once at admission, never in the audio loop. */
export declare function waveformCode(waveform?: OperatorWaveform): number;
/** Pure periodic shapes. Noise is stateful and handled by Synth, not this function.
 * With t=frac(theta/TAU): half=max(0,sin); abs=|sin|;
 * quarter=|sin| when frac(theta/pi)<1/2; alternating=sin(2theta) when t<1/2;
 * camel=|sin(2theta)| when t<1/2; square=sign(sin), zero maps to +1;
 * saw=2*frac(t+1/2)-1, rising through zero at theta=0.
 * Discontinuous shapes are naive, not alias-free.
 */
export declare function periodicWaveform(theta: number, code: number): number;
export declare const NOISE_SEED = 131071;
export declare function advanceNoise(state: number): number;
export declare function finiteOrSilence(value: number, diagnostics: {
    errors: number;
}): number;
