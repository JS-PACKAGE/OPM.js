import type { CompleteVoiceInput, FrozenVoice } from '../voices/schema.js';

export type { ADSR, LFO, KeyScale, Operator, Voice, LegacyVoice, VoiceInput, FrozenVoice } from '../voices/schema.js';
export type { WavOptions } from './wav.js';

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

import { validateVoice, bounded } from '../voices/schema.js';
import { Synth } from './synth.js';
export { envelopeAt } from './envelope.js';
export { ALGORITHMS } from './algorithms.js';
export { Synth, normalizeVoice } from './synth.js';
export { encodeWav } from './wav.js';
export const HEADROOM = 0.7; // -3.098 dB, with margin for Float32 rounding.
export const OVERSAMPLE = 4;
export const MAX_RENDER_SAMPLES = 4_000_000;

export function sampleRateValue(value: number): number {
  if (!Number.isInteger(value) || value < 8000 || value > 96000) {
    throw new RangeError('sampleRate must be an integer in 8000..96000');
  }
  return value;
}

// Pure offline renderer: no globals, IO, randomness or Web Audio dependencies.
// The returned buffer includes the longest release and a short filter tail.
export function renderNote(options: RenderNoteOptions): RenderResult;
export function renderNote({ voice, note = 60, duration = 0.5, velocity = 1, pan = 0, sampleRate = 44100 }: Partial<RenderNoteOptions> = {}): RenderResult {
  voice = validateVoice(voice);
  sampleRate = sampleRateValue(sampleRate);
  note = bounded(note, 0, 127, 'note');
  duration = bounded(duration, 0, 30, 'duration');
  velocity = bounded(velocity, 0, 1, 'velocity');
  pan = bounded(pan, -1, 1, 'pan');
  let release = 0;
  for (const op of voice.ops) release = Math.max(release, op.adsr.r);
  const length = Math.ceil((duration + release + 0.01) * sampleRate);
  if (length > MAX_RENDER_SAMPLES) throw new RangeError('Render exceeds sample budget');
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const synth = new Synth(sampleRate);
  if (duration > 0) {
    const id = synth.noteOn(voice, note, undefined, { velocity, pan });
    // Gate changes occur on output-frame boundaries, exactly as in the worklet.
    const gateFrame = Math.ceil(duration * sampleRate);
    synth.render(left, right, 0, gateFrame);
    synth.noteOff(id);
    synth.render(left, right, gateFrame, length - gateFrame);
  }
  return { samples: left, left, right, sampleRate, diagnostics: { errors: synth.errorCount } };
}
