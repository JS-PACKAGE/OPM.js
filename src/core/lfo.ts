import type { LFO } from '../voices/schema.js';
import { fastSin, sinPi } from './operator.js';

const TAU = 2 * Math.PI;
const LFO_WAVEFORMS: readonly LFO['waveform'][] = ['sine', 'triangle', 'saw', 'square'];

/** Integer LFO shape codes are resolved once at note admission, never per frame. */
export function lfoWaveformCode(waveform: LFO['waveform']): number {
  const code = LFO_WAVEFORMS.indexOf(waveform);
  if (code < 0) throw new RangeError('Unsupported LFO waveform');
  return code;
}

/** LFO shape at a unit phase in [0, 1) for the audio loop: a small branch-only
 * body that inlines into the per-frame voice path. */
export function lfoAt(unit: number, code: number): number {
  if (code === 0) return sinPi(2 * unit);
  if (code === 1) return unit < 0.25 ? 4 * unit : unit < 0.75 ? 2 - 4 * unit : 4 * unit - 4;
  return code === 2 ? 2 * unit - 1 : unit < 0.5 ? 1 : -1;
}

/** Radian phase; sine and triangle start at zero rising, saw at -1, square at +1.
 * Sine uses the operators' deterministic polynomial (|error| <= 1.4e-11), so LFO
 * output does not depend on the engine's Math.sin. */
export function lfoValue(phase: number, waveform: LFO['waveform']): number {
  if (!Number.isFinite(phase)) throw new RangeError('LFO phase must be finite');
  const code = lfoWaveformCode(waveform);
  if (code === 0) return fastSin(phase);
  const cycles = phase / TAU;
  return lfoAt(cycles - Math.floor(cycles), code);
}
