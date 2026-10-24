import type { LFO } from '../voices/schema.js';
import { fastSin, sinPi } from './operator.js';

const TAU = 2 * Math.PI;
const LFO_WAVEFORMS: readonly LFO['waveform'][] = ['sine', 'triangle', 'saw', 'square', 'noise'];

/** Integer LFO shape codes are resolved once at note admission, never per frame. */
export function lfoWaveformCode(waveform: LFO['waveform']): number {
  const code = LFO_WAVEFORMS.indexOf(waveform);
  if (code < 0) throw new RangeError('Unsupported LFO waveform');
  return code;
}

/** Sample-and-hold level in [-1, 1) for an integer LFO cycle: a stateless 32-bit
 * integer hash (xorshift-multiply finalizer), so seeking, chunking and global
 * sync reproduce the same sequence without stored generator state. */
function lfoNoise(cycle: number): number {
  let x = (cycle >>> 0) ^ Math.imul(Math.floor(cycle / 4294967296), 0x27d4eb2d) ^ 0x6d2b79f5;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 2147483648 - 1;
}

/** LFO shape at a unit phase in [0, 1) of integer cycle `cycle` for the audio
 * loop: a small branch-only body that inlines into the per-frame voice path. */
export function lfoAt(unit: number, code: number, cycle: number): number {
  if (code === 0) return sinPi(2 * unit);
  if (code === 1) return unit < 0.25 ? 4 * unit : unit < 0.75 ? 2 - 4 * unit : 4 * unit - 4;
  if (code === 2) return 2 * unit - 1;
  return code === 3 ? unit < 0.5 ? 1 : -1 : lfoNoise(cycle);
}

/** Radian phase; sine and triangle start at zero rising, saw at -1, square at +1;
 * noise holds one pseudo-random level per cycle. Sine uses the operators'
 * deterministic polynomial (|error| <= 1.4e-11), so LFO output does not depend
 * on the engine's Math.sin. */
export function lfoValue(phase: number, waveform: LFO['waveform']): number {
  if (!Number.isFinite(phase)) throw new RangeError('LFO phase must be finite');
  const code = lfoWaveformCode(waveform);
  if (code === 0) return fastSin(phase);
  const cycles = phase / TAU, whole = Math.floor(cycles);
  return lfoAt(cycles - whole, code, whole);
}
