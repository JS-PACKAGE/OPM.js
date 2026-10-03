import type { OperatorWaveform } from '../voices/schema.js';

export const TAU = 2 * Math.PI;
export function sineOperator(phase: number, modulation: number, gain: number): number {
  return Math.sin(phase + modulation) * gain;
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
    case 0: return Math.sin(theta);
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
