import type { OperatorWaveform } from '../voices/schema.js';
export declare const TAU: number;
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
