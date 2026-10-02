export interface TempoPoint {
    beat: number;
    bpm: number;
    curve?: 'step' | 'linear';
    endBpm?: number;
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
/** Strictly increasing quarter-note tempo; linear curves interpolate BPM in beat space. */
export declare function normalizeTempoMap(input?: readonly TempoPoint[], bpm?: number): readonly Readonly<TempoPoint>[];
export declare function normalizeTimeSignature(input?: TimeSignature): Readonly<TimeSignature>;
/** BPM at a beat in an already validated map. */
export declare function tempoBPM(beat: number, map: readonly Readonly<TempoPoint>[]): number;
/** Insert a step without changing the elapsed portion of a linear ramp. */
export declare function replaceTempoFrom(beat: number, bpm: number, map: readonly Readonly<TempoPoint>[]): readonly Readonly<TempoPoint>[];
/** Integral of 60/BPM across tempo boundaries. */
export declare function beatsToSeconds(beat: number, tempoMap?: readonly TempoPoint[]): number;
/** Internal validated-map form avoids recopying a map on each scheduler tick. */
export declare function tempoSeconds(beat: number, map: readonly Readonly<TempoPoint>[]): number;
export declare function secondsToBeats(seconds: number, tempoMap?: readonly TempoPoint[]): number;
export declare function tempoBeat(seconds: number, map: readonly Readonly<TempoPoint>[]): number;
export declare function beatToBarBeat(beat: number, signature?: TimeSignature): Readonly<BarBeat>;
export declare function barBeatToBeat(position: BarBeat, signature?: TimeSignature): number;
export type BeatQuantization = 'floor' | 'ceil' | 'nearest' | 'next';
/** Grid in quarter-note beats; next is strictly later even at an exact boundary. */
export declare function quantizeBeat(beat: number, quantum?: number, mode?: BeatQuantization): number;
/** Warp each pair of subdivisions; ratio .5 is straight, 2/3 is triplet swing. */
export declare function swingBeat(beat: number, subdivision?: number, ratio?: number): number;
