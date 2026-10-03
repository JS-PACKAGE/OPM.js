import type { CompleteVoiceInput, FrozenVoice } from '../voices/schema.js';
import type { SynthOptions } from './synth.js';
export type { ADSR, PitchEnvelope, LFO, LFOInput, LegacyLFO, LegacyLFOV5, LFOTargets, LFOTargetsInput, KeyScale, Operator, OperatorWaveform, Voice, LegacyVoice, LegacyVoiceV2, LegacyVoiceV3, LegacyVoiceV4, LegacyVoiceV5, LegacyVoiceV6, VoiceInput, FrozenVoice, PreparedVoice } from '../voices/schema.js';
export type { NoteOptions, NoteControls, VoiceEndReason, SynthOptions, QualityProfile } from './synth.js';
export type { TuningOptions, NormalizedTuning } from './tuning.js';
export { createStereoEffects, applyEffects } from './fx.js';
export type { StereoEffects, StereoEffectsOptions, ChorusOptions, ReverbOptions } from './fx.js';
export { normalizeTuning, tuningFrequency } from './tuning.js';
export { lfoValue } from './lfo.js';
export type { BeatSequenceEvent, SequenceEvent, SequenceNoteEvent, SequenceStopEvent, SequenceControlEvent, SequenceVoices, SequenceOptions, PreparedSequenceEvent, SequenceSnapshot, SequenceCapacity, ChunkedSequenceOptions, SequenceChunk, ChunkedSequenceRender } from './sequence.js';
export { prepareSequence, renderSequence, prepareLongSequence, estimateSequenceCapacity, renderSequenceChunks, MAX_SEQUENCE_NOTES, MAX_SEQUENCE_SLOTS, MAX_SEQUENCE_SECONDS, MAX_RENDER_SAMPLES, MAX_LONG_SEQUENCE_SECONDS, MAX_LONG_SEQUENCE_EVENTS, MAX_SEQUENCE_CHUNK_FRAMES, sampleRateValue } from './sequence.js';
export type { WavOptions, WavFormat, WavEncoderOptions, WavEncoder, WavChunk } from './wav.js';
export type { TempoPoint, TimeSignature, BarBeat } from './transport.js';
export { beatsToSeconds, secondsToBeats, beatToBarBeat, barBeatToBeat, normalizeTempoMap } from './transport.js';
export { importMidiFile, exportMidiFile, MAX_MIDI_FILE_BYTES, MAX_MIDI_FILE_TRACKS, MAX_MIDI_FILE_EVENTS } from './midi-file.js';
export type { MidiFileWarningCode, MidiFileWarning, MidiImportOptions, MidiImportResult, MidiExportOptions, MidiFileControlKind, MidiFilePreservedControl, MidiFileLossSummary } from './midi-file.js';
export type { MidiVoiceMap } from './midi-state.js';
export { gmProgramVoices, gmDrumVoices } from '../voices/gm-map.js';
export { parseScoreProject, serializeScoreProject, compileBeatSequence, MAX_SCORE_PROJECT_BYTES, MAX_SCORE_PROJECT_VOICES, parseArrangementProject, serializeArrangementProject, MAX_ARRANGEMENT_PROJECT_BYTES, MAX_ARRANGEMENT_PROJECT_VOICES } from './project.js';
export type { ScoreProject, ScoreProjectSettings, BeatSequenceOptions, ArrangementProject } from './project.js';
export type { ArrangementLayer, ArrangementSection, ArrangementDefinition } from './arrangement-definition.js';
export interface RenderNoteOptions extends SynthOptions {
    voice: CompleteVoiceInput | FrozenVoice;
    note?: number;
    duration?: number;
    velocity?: number;
    pan?: number;
    voicePriority?: number;
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
export { Synth, VoiceAdmissionError, normalizeVoice, prepareVoice, validateMaxVoices, validateNoteControls, validateVoicePriority } from './synth.js';
export { encodeWav, createWavEncoder } from './wav.js';
export declare const HEADROOM = 0.7;
export declare const OVERSAMPLE = 4;
export declare function renderNote(options: RenderNoteOptions): RenderResult;
