import type { CompleteVoiceInput, FrozenVoice } from '../voices/schema.js';
export { Synth, normalizeVoice } from './synth.js';
export { envelopeAt } from './envelope.js';
export { ALGORITHMS } from './algorithms.js';
export type { ADSR, LFO, KeyScale, Operator, Voice, LegacyVoice, VoiceInput, FrozenVoice } from '../voices/schema.js';
export interface RenderNoteOptions {
  voice: CompleteVoiceInput | FrozenVoice;
  note?: number;
  duration?: number;
  velocity?: number;
  pan?: number;
  sampleRate?: number;
}
export interface RenderResult {
  /** Same buffer as left, retained for compatibility. */
  samples: Float32Array;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  diagnostics: { errors: number };
}
export interface WavOptions { left: Float32Array; right?: Float32Array; sampleRate: number }
export const HEADROOM: 0.7;
export const OVERSAMPLE: 4;
export const MAX_RENDER_SAMPLES: 4000000;
export function sampleRateValue(value: number): number;
export function renderNote(options: RenderNoteOptions): RenderResult;
/** PCM16 little-endian RIFF/WAVE, mono if right is omitted, stereo otherwise. */
export function encodeWav(options: WavOptions): Uint8Array;
