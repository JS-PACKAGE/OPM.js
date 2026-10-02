import type { CompleteVoiceInput, FrozenVoice } from '../voices/schema.js';
export type { ADSR, LFO, KeyScale, Operator, Voice, LegacyVoice, LegacyVoiceV2, VoiceInput, FrozenVoice, PreparedVoice } from '../voices/schema.js';
export type { NoteOptions, NoteControls, VoiceEndReason } from './synth.js';
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
    diagnostics: {
        errors: number;
    };
}
export { envelopeAt } from './envelope.js';
export { ALGORITHMS } from './algorithms.js';
export { Synth, normalizeVoice, prepareVoice, validateNoteControls } from './synth.js';
export { encodeWav } from './wav.js';
export declare const HEADROOM = 0.7;
export declare const OVERSAMPLE = 4;
export declare const MAX_RENDER_SAMPLES = 4000000;
export declare function sampleRateValue(value: number): number;
export declare function renderNote(options: RenderNoteOptions): RenderResult;
