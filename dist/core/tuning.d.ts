export interface TuningOptions {
    referenceHz?: number;
    offsets?: readonly number[];
}
export interface NormalizedTuning {
    readonly referenceHz: number;
    readonly offsets: readonly number[];
}
/** Validate own data only and detach the cents table from its caller. */
export declare function normalizeTuning(input: TuningOptions): NormalizedTuning;
/** Fractional MIDI notes interpolate cents, not frequencies, between adjacent keys. */
export declare function tuningFrequency(note: number, tuning: NormalizedTuning): number;
