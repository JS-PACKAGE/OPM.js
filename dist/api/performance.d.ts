import type { OPM } from './index.js';
import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
import type { NoteControls } from '../core/synth.js';
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
    /** Optional owned-voice budget, including audible release tails, 1..32. */
    voiceLimit?: number;
    /** Admission importance, 0..127; larger values protect against lower-priority notes. */
    voicePriority?: number;
}
export interface PerformanceNoteOptions {
    velocity?: number;
}
export interface PerformanceNoteOffOptions {
    force?: boolean;
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
    readonly voiceLimit: number | undefined;
    readonly voicePriority: number;
    readonly selectedKey: number | null;
    readonly keys: readonly PerformanceKeySnapshot[];
}
export interface Performance {
    /** preserveNotes keeps existing gates when only the voice changes; default false. */
    configurePart(part: number, options: Partial<PerformancePartOptions>, policy?: {
        preserveNotes?: boolean;
    }): void;
    updatePart(part: number, controls: PerformancePartControls): void;
    /** Update one physical key; inactive mono keys store controls without touching the selected gate. */
    updateKey(part: number, key: number, controls: NoteControls): boolean;
    /** Update owned sounding notes and defaults for future notes, including release tails. */
    updatePartNotes(part: number, controls: NoteControls): void;
    /** Independent key identity, not an OPM admission receipt. OPM must already be started. */
    noteOn(part: number, note: number, options?: PerformanceNoteOptions): number;
    noteOff(part: number, key: number, options?: PerformanceNoteOffOptions): boolean;
    sustain(part: number, on: boolean): void;
    allNotesOff(part?: number): void;
    getPart(part: number): PerformancePartSnapshot;
    /** Detached effective part defaults, including resolved voice operator controls (not per-key overrides). */
    getPartControls(part: number): Readonly<NoteControls>;
    dispose(): void;
}
/** Device-agnostic key policy. No context, timers, MIDI driver or global panic is created. */
export declare function createPerformance(opm: OPM, options?: PerformanceOptions): Performance;
