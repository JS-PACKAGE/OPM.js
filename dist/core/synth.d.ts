import type { VoiceInput } from '../voices/schema.js';
export type VoiceEndReason = 'stolen' | 'ended' | 'error';
export interface NoteOptions {
    velocity?: number;
    pan?: number;
}
export { normalizeVoice } from '../voices/normalize.js';
export declare class Synth {
    readonly sampleRate: number;
    readonly maxVoices: number;
    readonly currentFrame: number;
    readonly errorCount: number;
    readonly lastStolenId: number | null;
    onVoiceEnded?: ((id: number, reason: VoiceEndReason) => void) | null;
    constructor(sampleRate: number, maxVoices?: number);
    noteOn(input: VoiceInput, note: number, id?: number, { velocity, pan }?: NoteOptions): number;
    noteOff(id: number): boolean;
    render(left: Float32Array, right: Float32Array, offset?: number, length?: number): void;
}
