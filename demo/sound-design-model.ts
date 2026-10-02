import { normalizeVoice } from '../src/voices/normalize.js';
import type { NormalizedVoice, VoiceInput } from '../src/voices/schema.js';
import { ALGORITHMS } from '../src/core/algorithms.js';
import { envelopeAt, FLOOR_DB } from '../src/core/envelope.js';

export const MAX_PATCH_BYTES = 16384;
/** Strict input path, unlike the bank parser's intentional finite-number clamping. */
export function designerPatch(input: unknown): NormalizedVoice {
  const voice = normalizeVoice(input as VoiceInput);
  return { ...voice, name: voice.name ?? 'user_patch' };
}
export function parseDesignerPatch(text: string): NormalizedVoice {
  if (text.length > MAX_PATCH_BYTES || new TextEncoder().encode(text).length > MAX_PATCH_BYTES) {
    throw new RangeError('Patch exceeds 16 KiB');
  }
  return designerPatch(JSON.parse(text));
}
export { ALGORITHMS };
/** Ideal fresh-note envelope, using the engine's own dB/time evaluator. */
export function envelopePoints(voice: NormalizedVoice, operator: number, gate: number): { time: number; db: number; silent: boolean }[] {
  const adsr = voice.ops[operator]!.adsr;
  const end = gate + adsr.r;
  const times = new Set([0, Math.min(adsr.a, gate), Math.min(adsr.a + adsr.d, gate), gate, end]);
  for (let i = 0; i <= 200; i++) times.add(end * i / 200);
  return [...times].sort((a, b) => a - b).map(time => {
    const gain = envelopeAt(time, gate, adsr);
    return { time, db: gain === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(gain)), silent: gain === 0 };
  });
}
