import type { OPM } from './index.js';
import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
export interface PerformanceOptions {
    /** Zero-based part count, 1..16; default 16. */
    parts?: number;
    /** Total physical/pedal key records, 1..128; default 128. */
    maxKeys?: number;
    /** Per-part key records, 1..128; default 128, also subject to maxKeys. */
    maxKeysPerPart?: number;
    /** Event-driven cleanup failures; synchronous operation failures still throw. */
    onError?: (error: Error) => void;
}
export interface PerformancePartControls {
    glide?: number;
    pan?: number;
    expression?: number;
}
export interface PerformancePartOptions extends PerformancePartControls {
    voice: string | VoiceInput;
    mode: 'poly' | 'mono';
    legato: boolean;
    priority: 'last' | 'high' | 'low';
}
export interface PerformanceNoteOptions {
    velocity?: number;
}
export interface PerformanceKeySnapshot {
    readonly key: number;
    readonly note: number;
    readonly velocity: number;
    readonly held: boolean;
    /** Only the currently sounding mono key owns its shared gate. */
    readonly gateId: number | null;
}
export interface PerformancePartSnapshot {
    readonly voice: string | PreparedVoice;
    readonly mode: 'poly' | 'mono';
    readonly legato: boolean;
    readonly priority: 'last' | 'high' | 'low';
    readonly glide: number;
    readonly pan: number;
    readonly expression: number;
    readonly sustain: boolean;
    readonly selectedKey: number | null;
    readonly keys: readonly PerformanceKeySnapshot[];
}
export interface Performance {
    configurePart(part: number, options: Partial<PerformancePartOptions>): void;
    updatePart(part: number, controls: PerformancePartControls): void;
    /** Independent key identity, not an OPM admission receipt. OPM must already be started. */
    noteOn(part: number, note: number, options?: PerformanceNoteOptions): number;
    noteOff(part: number, key: number): boolean;
    sustain(part: number, on: boolean): void;
    allNotesOff(part?: number): void;
    getPart(part: number): PerformancePartSnapshot;
    dispose(): void;
}
/** Device-agnostic key policy. No context, timers, MIDI driver or global panic is created. */
export declare function createPerformance(opm: OPM, options?: PerformanceOptions): Performance;
