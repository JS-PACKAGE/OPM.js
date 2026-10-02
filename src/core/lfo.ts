import type { LFO } from '../voices/schema.js';

const TAU = 2 * Math.PI;

/** Radian phase; sine and triangle start at zero rising, saw at -1, square at +1. */
export function lfoValue(phase: number, waveform: LFO['waveform']): number {
  if (!Number.isFinite(phase)) throw new RangeError('LFO phase must be finite');
  if (waveform === 'sine') return Math.sin(phase);
  const cycles = phase / TAU;
  const unit = cycles - Math.floor(cycles);
  switch (waveform) {
    case 'triangle': return unit < 0.25 ? 4 * unit : unit < 0.75 ? 2 - 4 * unit : 4 * unit - 4;
    case 'saw': return 2 * unit - 1;
    case 'square': return unit < 0.5 ? 1 : -1;
    default: throw new RangeError('Unsupported LFO waveform');
  }
}
