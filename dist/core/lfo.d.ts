import type { LFO } from '../voices/schema.js';
/** Integer LFO shape codes are resolved once at note admission, never per frame. */
export declare function lfoWaveformCode(waveform: LFO['waveform']): number;
/** LFO shape at a unit phase in [0, 1) for the audio loop: a small branch-only
 * body that inlines into the per-frame voice path. */
export declare function lfoAt(unit: number, code: number): number;
/** Radian phase; sine and triangle start at zero rising, saw at -1, square at +1.
 * Sine uses the operators' deterministic polynomial (|error| <= 1.4e-11), so LFO
 * output does not depend on the engine's Math.sin. */
export declare function lfoValue(phase: number, waveform: LFO['waveform']): number;
