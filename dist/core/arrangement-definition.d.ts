import type { BeatSequenceEvent, SequenceSnapshot, SequenceVoices } from './sequence.js';
import type { TempoPoint, TimeSignature } from './transport.js';
export interface ArrangementLayer {
    name: string;
    /** Loop length in quarter notes, 1/1024 <= length <= 256; aligned to the global beat grid. */
    length: number;
    /** Note onsets lie inside [0, length). Durations and owned controls may cross a loop boundary. */
    events: readonly BeatSequenceEvent[];
    /** Admission importance 0..127, combined with each note's value by taking the maximum. */
    voicePriority?: number;
    /** Per-layer gain 0..1, default 1; independent of authored note expression. */
    gain?: number;
}
export interface ArrangementSection {
    name: string;
    layers: readonly string[];
}
/** Musical definition shared by projects and live options, without scheduler callbacks or audio state. */
export interface ArrangementDefinition {
    readonly layers: readonly ArrangementLayer[];
    readonly sections: readonly ArrangementSection[];
    readonly initialSection: string;
    readonly tempoMap?: readonly TempoPoint[];
    readonly timeSignature?: TimeSignature;
}
interface NormalizedArrangementDefinition extends ArrangementDefinition {
    readonly layers: readonly Readonly<Required<ArrangementLayer>>[];
    readonly sections: readonly Readonly<ArrangementSection>[];
    readonly tempoMap: readonly Readonly<TempoPoint>[];
    readonly timeSignature: Readonly<TimeSignature>;
}
export declare const MAX_ARRANGEMENT_LAYERS = 16;
export declare const MAX_ARRANGEMENT_SECTIONS = 32;
export declare const MAX_ARRANGEMENT_LAYER_LENGTH = 256;
export declare function arrangementName(value: unknown, label: string): string;
/** One beat-event boundary for portable projects and live arrangements. */
export declare function prepareBeatSequence(events: readonly BeatSequenceEvent[], voices?: SequenceVoices): {
    events: readonly BeatSequenceEvent[];
    score: SequenceSnapshot;
};
/** Reject definitions that cannot be converted through their complete tempo map. */
export declare function validateBeatHorizon(events: readonly BeatSequenceEvent[], map: readonly Readonly<TempoPoint>[]): void;
/** Validate all references and resource bounds before a scheduler can own any notes. */
export declare function prepareArrangementDefinition(input: unknown, voices?: SequenceVoices): {
    definition: NormalizedArrangementDefinition;
    scores: readonly SequenceSnapshot[];
};
export {};
