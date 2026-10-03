import type { CompleteVoiceInput, FrozenVoice } from '../voices/schema.js';
import type { SynthOptions } from './synth.js';
import { MAX_RENDER_SAMPLES, sampleRateValue } from './sequence.js';

export type { ADSR, PitchEnvelope, LFO, LFOInput, LegacyLFO, LegacyLFOV5, LFOTargets, LFOTargetsInput, KeyScale, Operator, OperatorWaveform, Voice, LegacyVoice, LegacyVoiceV2, LegacyVoiceV3, LegacyVoiceV4, LegacyVoiceV5, LegacyVoiceV6, VoiceInput, FrozenVoice, PreparedVoice } from '../voices/schema.js';
export type { NoteOptions, NoteControls, VoiceEndReason, SynthOptions, QualityProfile } from './synth.js';
export type { TuningOptions, NormalizedTuning } from './tuning.js';
export { normalizeTuning, tuningFrequency } from './tuning.js';
export { lfoValue } from './lfo.js';
export type { BeatSequenceEvent, SequenceEvent, SequenceNoteEvent, SequenceStopEvent, SequenceControlEvent, SequenceVoices, SequenceOptions, PreparedSequenceEvent, SequenceSnapshot, SequenceCapacity, ChunkedSequenceOptions, SequenceChunk, ChunkedSequenceRender } from './sequence.js';
export { prepareSequence, renderSequence, prepareLongSequence, estimateSequenceCapacity, renderSequenceChunks, MAX_SEQUENCE_NOTES, MAX_SEQUENCE_SLOTS, MAX_SEQUENCE_SECONDS, MAX_RENDER_SAMPLES, MAX_LONG_SEQUENCE_SECONDS, MAX_LONG_SEQUENCE_EVENTS, MAX_SEQUENCE_CHUNK_FRAMES, sampleRateValue } from './sequence.js';
export type { WavOptions, WavFormat, WavEncoderOptions, WavEncoder, WavChunk } from './wav.js';
export type { TempoPoint, TimeSignature, BarBeat } from './transport.js';
export { beatsToSeconds, secondsToBeats, beatToBarBeat, barBeatToBeat, normalizeTempoMap } from './transport.js';
export { importMidiFile, exportMidiFile, MAX_MIDI_FILE_BYTES, MAX_MIDI_FILE_TRACKS, MAX_MIDI_FILE_EVENTS } from './midi-file.js';
export type { MidiFileWarningCode, MidiFileWarning, MidiImportOptions, MidiImportResult, MidiExportOptions, MidiFileControlKind, MidiFilePreservedControl, MidiFileLossSummary } from './midi-file.js';
export { parseScoreProject, serializeScoreProject, compileBeatSequence, MAX_SCORE_PROJECT_BYTES, MAX_SCORE_PROJECT_VOICES, parseArrangementProject, serializeArrangementProject, MAX_ARRANGEMENT_PROJECT_BYTES, MAX_ARRANGEMENT_PROJECT_VOICES } from './project.js';
export type { ScoreProject, ScoreProjectSettings, BeatSequenceOptions, ArrangementProject } from './project.js';
export type { MidiVoiceMap } from './midi-state.js';
export { gmProgramVoices, gmDrumVoices } from '../voices/gm-map.js';
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
  diagnostics: { errors: number };
}

import { validateVoice, bounded } from '../voices/schema.js';
import { Synth, operatorDuration } from './synth.js';
export { envelopeAt } from './envelope.js';
export { ALGORITHMS } from './algorithms.js';
export { Synth, VoiceAdmissionError, normalizeVoice, prepareVoice, validateMaxVoices, validateNoteControls, validateVoicePriority } from './synth.js';
export { encodeWav, createWavEncoder } from './wav.js';
export const HEADROOM = 0.7; // -3.098 dB, with margin for Float32 rounding.
export const OVERSAMPLE = 4;

// Pure offline renderer: no globals, IO, randomness or Web Audio dependencies.
// The returned buffer includes the longest release and a short filter tail.
export function renderNote(options: RenderNoteOptions): RenderResult;
export function renderNote({ voice, note = 60, duration = 0.5, velocity = 1, pan = 0, sampleRate = 44100,
  mixGain, tuning, stealing, quality, voicePriority = 0 }: Partial<RenderNoteOptions> = {}): RenderResult {
  voice = validateVoice(voice);
  sampleRate = sampleRateValue(sampleRate);
  note = bounded(note, 0, 127, 'note');
  duration = bounded(duration, 0, 30, 'duration');
  velocity = bounded(velocity, 0, 1, 'velocity');
  pan = bounded(pan, -1, 1, 'pan');
  let release = 0;
  for (const op of voice.ops) release = Math.max(release, operatorDuration(op.adsr.r, note, op.rateKeyScale));
  const length = Math.ceil((duration + release + 0.01) * sampleRate);
  if (length > MAX_RENDER_SAMPLES) throw new RangeError('Render exceeds sample budget');
  const engine: SynthOptions = {};
  if (mixGain !== undefined) engine.mixGain = mixGain;
  if (tuning !== undefined) engine.tuning = tuning;
  if (stealing !== undefined) engine.stealing = stealing;
  if (quality !== undefined) engine.quality = quality;
  const synth = new Synth(sampleRate, 8, engine);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  if (duration > 0) {
    const id = synth.noteOn(voice, note, undefined, { velocity, pan, voicePriority });
    // Gate changes occur on output-frame boundaries, exactly as in the worklet.
    const gateFrame = Math.ceil(duration * sampleRate);
    synth.render(left, right, 0, gateFrame);
    synth.noteOff(id);
    synth.render(left, right, gateFrame, length - gateFrame);
  }
  return { samples: left, left, right, sampleRate, diagnostics: { errors: synth.errorCount } };
}
