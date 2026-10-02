import type { NormalizedVoice, VoiceInput } from '../voices/schema.js';
import type { NoteControls } from '../core/synth.js';
export type { ADSR, LFO, KeyScale, Operator, Voice, VoiceInput, FrozenVoice } from '../voices/schema.js';
export type { NoteControls } from '../core/synth.js';
export type NoteState = 'accepted' | 'started' | 'released' | 'ended' | 'stolen' | 'cancelled' | 'rejected';
export interface NoteEvent {
    type: 'note';
    id: number;
    state: NoteState;
    reason?: string;
    /** Actual AudioContext sample frame and seconds at admission, dispatch or completion. */
    frame: number;
    time: number;
}
export interface DiagnosticsEvent {
    type: 'diagnostics';
    requestId: number;
    activeVoices: number;
    pendingEvents: number;
    errors: number;
    rejectedNotes: number;
}
export interface ErrorEvent {
    type: 'error';
    error: Error;
}
export type OPMEvent = NoteEvent | DiagnosticsEvent | ErrorEvent;
export interface OPMOptions {
    sampleRate?: number;
    /** Borrowed context: OPM never closes or suspends it. */
    context?: AudioContext;
    /** Omit to connect to context.destination; null disables automatic connection. */
    destination?: AudioNode | null;
    onEvent?: (event: OPMEvent) => void;
}
interface PlayNoteBase {
    voice?: string | VoiceInput;
    note: number;
    /** A late start keeps its full duration; drop rejects even if processing is delayed. */
    late?: 'start' | 'drop';
    /** null (the default) holds until stop; a number sets a duration before release. */
    duration?: number | null;
    velocity?: number;
    pan?: number;
}
export type PlayNoteOptions = PlayNoteBase & (
/** Relative delay in seconds; cannot be combined with at. */
{
    time?: number;
    at?: never;
} | 
/** Absolute AudioContext seconds, at most 60 seconds ahead. Past times are allowed. */
{
    at: number;
    time?: never;
});
export interface ScheduledNoteOptions {
    /** Absolute AudioContext seconds. Stop without at is immediate, including cancellation. */
    at?: number;
}
/** Browser-facing facade. Import Synth from ../core/synth.js for offline rendering. */
export declare class OPM {
    readonly sampleRate: number | undefined;
    /** Defensive map snapshot; loaded patches are deeply frozen. Use loadVoice to replace one. */
    get voices(): ReadonlyMap<string, NormalizedVoice>;
    readonly context: AudioContext | null;
    readonly node: AudioWorkletNode | null;
    onEvent?: (event: OPMEvent) => void;
    constructor(options?: OPMOptions);
    loadVoice(name: string, voice: VoiceInput): void;
    start(): Promise<void>;
    resume(): Promise<void>;
    connect(destination: AudioNode): this;
    disconnect(destination?: AudioNode): this;
    playNote(options: PlayNoteOptions): number;
    stop(id: number, options?: ScheduledNoteOptions): void;
    /** Pending updates apply at onset. At equal frames stop precedes onset, then controls. */
    updateNote(id: number, controls: NoteControls, options?: ScheduledNoteOptions): void;
    getDiagnostics(): Promise<DiagnosticsEvent>;
    close(): Promise<void>;
}
export interface LookaheadWindow {
    /** Half-open absolute AudioContext time window. Missed windows are skipped after a stall. */
    from: number;
    to: number;
    /** Maximum notes the callback may return in this batch. */
    maxNotes: number;
}
export type LookaheadNote = PlayNoteOptions & {
    at: number;
    duration: number;
};
export interface LookaheadOptions {
    /** Seconds, default 0.2; bounded to 0.02..10 and greater than interval. */
    horizon?: number;
    /** Seconds between pumps, default 0.025; bounded to 0.005..1. */
    interval?: number;
    /** Maximum batch size, default 32; bounded to 1..128. */
    maxNotes?: number;
    /** Timer/callback failures stop scheduling and are delivered here. */
    onError: (error: Error) => void;
}
export interface LookaheadScheduler {
    readonly running: boolean;
    /** Call from a user gesture; initializes/resumes OPM, then fills the first window. */
    start(): Promise<void>;
    /** Cancels pending notes and releases this scheduler's active gates, not other notes. */
    stop(): void;
    /** Stops and permanently prevents restart; does not close OPM. */
    dispose(): void;
}
/** Bounded timer-driven admission, not timer-driven note release. Audio frames own all gates. */
export declare function createLookaheadScheduler(opm: OPM, schedule: (window: LookaheadWindow) => readonly LookaheadNote[], options: LookaheadOptions): LookaheadScheduler;
