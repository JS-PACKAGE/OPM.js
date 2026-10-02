import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
export type VoiceEndReason = 'stolen' | 'ended' | 'error';
export interface NoteOptions {
    velocity?: number;
    pan?: number;
}
export interface NoteControls {
    pitch?: number;
    glide?: number;
    expression?: number;
    pan?: number;
    modulation?: number;
}
/** Copy strict own-data controls at the API/dispatch boundary without invoking getters. */
export declare function validateNoteControls(input: NoteControls): NoteControls;
export { normalizeVoice, prepareVoice } from '../voices/normalize.js';
export declare class Synth {
    readonly sampleRate: number;
    readonly maxVoices: number;
    readonly currentFrame: number;
    readonly errorCount: number;
    readonly lastStolenId: number | null;
    onVoiceEnded?: ((id: number, reason: VoiceEndReason) => void) | null;
    constructor(sampleRate: number, maxVoices?: number);
    noteOn(input: VoiceInput | PreparedVoice, note: number, id?: number, { velocity, pan }?: NoteOptions): number;
    noteOff(id: number): boolean;
    updateNote(id: number, input: NoteControls): boolean;
    render(left: Float32Array, right: Float32Array, offset?: number, length?: number): void;
}
