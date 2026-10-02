export interface TempoPoint {
    beat: number;
    bpm: number;
}
export interface TimeSignature {
    numerator: number;
    denominator: number;
}
/** One-based bars and beats; beat may contain a fractional subdivision. */
export interface BarBeat {
    bar: number;
    beat: number;
}
export declare const MAX_TRANSPORT_BEATS = 86400;
export declare const MAX_TEMPO_POINTS = 1024;
export declare function transportNumber(value: unknown, min: number, max: number, label: string): number;
/** Read dense own-data arrays without executing element getters or iteration overrides. */
export declare function transportArray(input: unknown, max: number, label: string): unknown[];
/** Strictly increasing piecewise-constant quarter-note tempo, always beginning at zero. */
export declare function normalizeTempoMap(input?: readonly TempoPoint[], bpm?: number): readonly Readonly<TempoPoint>[];
export declare function normalizeTimeSignature(input?: TimeSignature): Readonly<TimeSignature>;
/** Integral of 60/BPM across tempo boundaries. */
export declare function beatsToSeconds(beat: number, tempoMap?: readonly TempoPoint[]): number;
/** Internal validated-map form avoids recopying a map on each scheduler tick. */
export declare function tempoSeconds(beat: number, map: readonly Readonly<TempoPoint>[]): number;
export declare function secondsToBeats(seconds: number, tempoMap?: readonly TempoPoint[]): number;
export declare function tempoBeat(seconds: number, map: readonly Readonly<TempoPoint>[]): number;
export declare function beatToBarBeat(beat: number, signature?: TimeSignature): Readonly<BarBeat>;
export declare function barBeatToBeat(position: BarBeat, signature?: TimeSignature): number;
