import type { LFO } from '../voices/schema.js';
/** Radian phase; sine and triangle start at zero rising, saw at -1, square at +1. */
export declare function lfoValue(phase: number, waveform: LFO['waveform']): number;
