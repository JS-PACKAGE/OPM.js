import type { LFO } from '../voices/schema.js';
/** Radian phase; sine and triangle start at zero rising, saw at -1, square at +1.
 * Sine uses the operators' deterministic polynomial (|error| <= 1.4e-11), so LFO
 * output does not depend on the engine's Math.sin. */
export declare function lfoValue(phase: number, waveform: LFO['waveform']): number;
