import type { ADSR, PreparedVoice, VoiceInput } from '../voices/schema.js';
import type { TuningOptions } from './tuning.js';
import type { QualityProfile } from './decimator.js';
export type { QualityProfile } from './decimator.js';
export type VoiceEndReason = 'stolen' | 'ended' | 'error' | 'cancelled';
export interface NoteOptions {
    velocity?: number;
    pan?: number;
    voicePriority?: number;
}
export interface NoteControls {
    pitch?: number;
    glide?: number;
    expression?: number;
    pan?: number;
    modulation?: number;
    ramp?: number;
    /** Independent per-note amplitude, 0..1 (default 1), multiplied with expression before mix saturation. */
    gain?: number;
    operatorLevels?: readonly [number, number, number, number];
    feedback?: number;
    lfoRate?: number;
    amDepth?: number;
    pmDepth?: number;
    operatorRatios?: readonly [number, number, number, number];
    /** A number enables fixed Hz; null restores the operator's live ratio. Pitch still applies. */
    operatorFrequencies?: readonly [number | null, number | null, number | null, number | null];
    operatorADSR?: readonly [ADSR, ADSR, ADSR, ADSR];
}
export interface SynthOptions {
    mixGain?: number;
    tuning?: TuningOptions;
    stealing?: 'oldest' | 'release-first' | 'quietest';
    quality?: QualityProfile;
}
/** A valid note could not displace any higher-priority logical voice. */
export declare class VoiceAdmissionError extends Error {
    constructor();
}
export declare function validateMaxVoices(value: unknown): number;
export declare function validateVoicePriority(value: unknown): number;
/** Copy strict own-data controls at the API/dispatch boundary without invoking getters. */
export declare function validateNoteControls(input: NoteControls): NoteControls;
export { normalizeVoice, prepareVoice } from '../voices/normalize.js';
export declare class Synth {
    readonly sampleRate: number;
    readonly maxVoices: number;
    readonly quality: QualityProfile;
    readonly currentFrame: number;
    readonly errorCount: number;
    readonly lastStolenId: number | null;
    onVoiceEnded?: ((id: number, reason: VoiceEndReason) => void) | null;
    constructor(sampleRate: number, maxVoices?: number, options?: SynthOptions);
    setMixGain(gain: number): void;
    setTuning(tuning: TuningOptions): void;
    noteOn(input: VoiceInput | PreparedVoice, note: number, id?: number, options?: NoteOptions): number;
    noteOff(id: number): boolean;
    allNotesOff(): void;
    panic(): void;
    updateNote(id: number, input: NoteControls): boolean;
    render(left: Float32Array, right: Float32Array, offset?: number, length?: number): void;
}
