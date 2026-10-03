import type { PreparedVoice } from '../voices/schema.js';
import type { BeatSequenceEvent, SequenceEvent, SequenceVoices } from './sequence.js';
import type { QualityProfile, SynthOptions } from './synth.js';
import type { NormalizedTuning } from './tuning.js';
import type { TempoPoint, TimeSignature } from './transport.js';
export declare const MAX_SCORE_PROJECT_BYTES: number;
export declare const MAX_SCORE_PROJECT_VOICES = 128;
export interface BeatSequenceOptions {
    tempoMap?: readonly TempoPoint[];
    bpm?: number;
    voices?: SequenceVoices;
}
export interface ScoreProjectSettings {
    readonly sampleRate: number;
    readonly quality: QualityProfile;
    readonly maxVoices: number;
    readonly mixGain: number;
    readonly tuning: NormalizedTuning;
    readonly stealing: NonNullable<SynthOptions['stealing']>;
}
/** Version 1 is self-contained: every note names a patch stored in voices. */
export interface ScoreProject {
    readonly version: 1;
    readonly events: readonly BeatSequenceEvent[];
    readonly tempoMap: readonly Readonly<TempoPoint>[];
    readonly timeSignature: Readonly<TimeSignature>;
    readonly voices: Readonly<Record<string, PreparedVoice>>;
    readonly settings: ScoreProjectSettings;
}
/** Compile musical gates by integrating both endpoints; control ramp/glide remain seconds. */
export declare function compileBeatSequence(events: readonly BeatSequenceEvent[], options?: BeatSequenceOptions): SequenceEvent[];
/** Parse strict versioned own-data input, detach all nested data and freeze the snapshot. */
export declare function parseScoreProject(source: string | object): ScoreProject;
/** Canonical compact JSON: stable field order, sorted patch names, normalized defaults. */
export declare function serializeScoreProject(project: ScoreProject): string;
