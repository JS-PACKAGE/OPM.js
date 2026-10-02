import type { CompleteVoiceInput, FrozenVoice } from '../voices/schema.js';
import type { SynthOptions } from './synth.js';
export type { ADSR, PitchEnvelope, LFO, LFOInput, LegacyLFO, LegacyLFOV5, LFOTargets, LFOTargetsInput, KeyScale, Operator, Voice, LegacyVoice, LegacyVoiceV2, LegacyVoiceV3, LegacyVoiceV4, LegacyVoiceV5, VoiceInput, FrozenVoice, PreparedVoice } from '../voices/schema.js';
export type { NoteOptions, NoteControls, VoiceEndReason, SynthOptions, QualityProfile } from './synth.js';
export type { TuningOptions, NormalizedTuning } from './tuning.js';
export { normalizeTuning, tuningFrequency } from './tuning.js';
export { lfoValue } from './lfo.js';
export type { SequenceEvent, SequenceNoteEvent, SequenceStopEvent, SequenceControlEvent, SequenceVoices, SequenceOptions, PreparedSequenceEvent, SequenceSnapshot, SequenceCapacity, ChunkedSequenceOptions, SequenceChunk, ChunkedSequenceRender } from './sequence.js';
export { prepareSequence, renderSequence, prepareLongSequence, estimateSequenceCapacity, renderSequenceChunks, MAX_SEQUENCE_NOTES, MAX_SEQUENCE_SLOTS, MAX_SEQUENCE_SECONDS, MAX_RENDER_SAMPLES, MAX_LONG_SEQUENCE_SECONDS, MAX_LONG_SEQUENCE_EVENTS, MAX_SEQUENCE_CHUNK_FRAMES, sampleRateValue } from './sequence.js';
export type { WavOptions, WavFormat, WavEncoderOptions, WavEncoder, WavChunk } from './wav.js';
export type { TempoPoint, TimeSignature, BarBeat } from './transport.js';
export { beatsToSeconds, secondsToBeats, beatToBarBeat, barBeatToBeat, normalizeTempoMap } from './transport.js';
export interface RenderNoteOptions extends SynthOptions {
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
export { encodeWav, createWavEncoder } from './wav.js';
export declare const HEADROOM = 0.7;
export declare const OVERSAMPLE = 4;
export declare function renderNote(options: RenderNoteOptions): RenderResult;
