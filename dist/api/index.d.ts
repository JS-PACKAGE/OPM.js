import type { CompleteVoiceInput, NormalizedVoice, VoiceInput } from '../voices/schema.js';
import type { NoteControls, QualityProfile, SynthOptions } from '../core/synth.js';
import type { TuningOptions } from '../core/tuning.js';
export type { ADSR, LFO, LFOInput, LegacyLFO, LegacyLFOV5, LFOTargets, LFOTargetsInput, KeyScale, Operator, Voice, VoiceInput, FrozenVoice, FrozenOperator, NormalizedVoice, PreparedVoice, PitchEnvelope, LegacyVoiceV3, LegacyVoiceV4, LegacyVoiceV5 } from '../voices/schema.js';
export type { NoteControls, SynthOptions, QualityProfile } from '../core/synth.js';
export type { TuningOptions, NormalizedTuning } from '../core/tuning.js';
export { playSequence, streamSequence } from './sequence.js';
export type { PlaySequenceOptions, SequencePlayback, SequenceStreamOptions, SequenceStream } from './sequence.js';
export type { SequenceEvent, SequenceNoteEvent, SequenceStopEvent, SequenceControlEvent } from '../core/sequence.js';
export { createTransport, beatsToSeconds, secondsToBeats, beatToBarBeat, barBeatToBeat, normalizeTempoMap, quantizeBeat, swingBeat, swingBeatEvents } from './transport.js';
export type { BeatSequenceEvent, TransportLoop, TransportState, TransportOptions, TransportSnapshot, MusicalTransport, TempoPoint, TimeSignature, BarBeat, BeatQuantization } from './transport.js';
export { createArrangement } from './arrangement.js';
export type { Arrangement, ArrangementLayer, ArrangementSection, ArrangementOptions, ArrangementChangeOptions, ArrangementGainOptions, ArrangementState, ArrangementSnapshot } from './arrangement.js';
export { createMidiAdapter, requestMidiAccess } from './midi.js';
export type { MidiAdapter, MidiAdapterOptions, MidiAdapterSnapshot, MidiAccessLike, MidiInputLike, MidiMessageEventLike, MidiNavigatorLike } from './midi.js';
export { importMidiFile, exportMidiFile, MAX_MIDI_FILE_BYTES, MAX_MIDI_FILE_TRACKS, MAX_MIDI_FILE_EVENTS } from '../core/midi-file.js';
export type { MidiFileWarningCode, MidiFileWarning, MidiImportOptions, MidiImportResult, MidiExportOptions } from '../core/midi-file.js';
export { parseScoreProject, serializeScoreProject, compileBeatSequence, MAX_SCORE_PROJECT_BYTES, MAX_SCORE_PROJECT_VOICES } from '../core/project.js';
export type { ScoreProject, ScoreProjectSettings, BeatSequenceOptions } from '../core/project.js';
export { VERSION } from '../version.js';
export { createPerformance } from './performance.js';
export type { Performance, PerformanceOptions, PerformancePartOptions, PerformancePartControls, PerformanceNoteOptions, PerformanceKeySnapshot, PerformancePartSnapshot } from './performance.js';
export { renderSequenceInWorker } from './render-worker.js';
export type { WavSink, WorkerRenderOptions, WorkerRenderProgress, WorkerRenderResult, WorkerRenderPhase, WorkerRenderPhaseStatus, WorkerRenderPhaseDiagnostics } from './render-worker.js';
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
export type CommandName = 'stop' | 'updateNote' | 'allNotesOff' | 'panic' | 'setMixGain' | 'setTuning';
export interface CommandEvent {
    type: 'command';
    command: CommandName;
    commandId?: number;
    id?: number;
    /** Accepted means admitted or immediately applied, not a future execution guarantee. */
    state: 'accepted' | 'rejected';
    reason?: string;
    frame: number;
    time: number;
}
export type ContextState = AudioContextState | 'interrupted';
export interface ContextEvent {
    type: 'context';
    state: ContextState;
    frame: number;
    time: number;
}
export interface ResetEvent {
    type: 'reset';
    reason: 'close' | 'failure' | 'panic' | 'interruption';
    frame: number;
    time: number;
    /** Initiating panic command, when available; independent of receipt-cache eviction. */
    commandId?: number;
}
export type OPMEvent = NoteEvent | DiagnosticsEvent | CommandEvent | ContextEvent | ResetEvent | ErrorEvent;
export interface CommandWaitOptions {
    /** Milliseconds, default 5000; an integer in 1..60000. */
    timeout?: number;
    signal?: AbortSignal;
}
/** Admission rejection, not an audio execution/completion result. */
export declare class CommandRejectedError extends Error {
    readonly event: Readonly<CommandEvent>;
    constructor(event: CommandEvent);
}
export interface OPMOptions {
    sampleRate?: number;
    /** Borrowed context: OPM never closes or suspends it. */
    context?: AudioContext;
    /** Omit to connect to context.destination; null disables automatic connection. */
    destination?: AudioNode | null;
    /** Same-origin HTTPS (or secure loopback HTTP) module; default stays relative to this API module. */
    workletUrl?: string | URL;
    mixGain?: number;
    tuning?: TuningOptions;
    stealing?: SynthOptions['stealing'];
    /** Immutable synthesis profile; standard preserves the default sound. */
    quality?: QualityProfile;
    /** Logical polyphony, an integer in 1..32; default 8. Release tails occupy voices. */
    maxVoices?: number;
    /** Cancel all voices/events on interruption, or preserve direct-note state until resume. */
    interruption?: 'cancel' | 'preserve';
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
    /** Admission importance, integer 0..127; larger values cannot be stolen by lower-priority notes. Default 0. */
    voicePriority?: number;
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
/** Explicit cancellation is immediate-only; ordinary stops preserve tail automation. */
export type StopOptions = ScheduledNoteOptions & {
    cancelControls?: never;
} | {
    at?: never;
    cancelControls?: boolean;
};
/** Browser-facing facade. Import Synth from ../core/synth.js for offline rendering. */
export declare class OPM {
    readonly sampleRate: number | undefined;
    get quality(): QualityProfile;
    get maxVoices(): number;
    /** Defensive map snapshot; loaded patches are deeply frozen. Use loadVoice to replace one. */
    get voices(): ReadonlyMap<string, NormalizedVoice>;
    readonly context: AudioContext | null;
    readonly node: AudioWorkletNode | null;
    onEvent?: (event: OPMEvent) => void;
    constructor(options?: OPMOptions);
    loadVoice(name: string, voice: VoiceInput): void;
    /** Atomically replaces the registry. Only an empty plain array (not JSON "[]") clears it. */
    replaceVoiceBank(source: string | readonly CompleteVoiceInput[]): void;
    removeVoice(name: string): boolean;
    /** Canonical versioned entries, detached from the immutable registry and UTF-8 bounded. */
    exportVoiceBank(): string;
    /** Independent subscription; close preserves it for restart, dispose removes it permanently. */
    subscribe(listener: (event: OPMEvent) => void): () => void;
    start(): Promise<void>;
    resume(): Promise<void>;
    connect(destination: AudioNode): this;
    disconnect(destination?: AudioNode): this;
    playNote(options: PlayNoteOptions): number;
    stop(id: number, options?: StopOptions): number;
    /** Pending updates apply at onset. At equal frames stop precedes onset, then controls. */
    updateNote(id: number, controls: NoteControls, options?: ScheduledNoteOptions): number;
    /** Cancel all pending events and release all active gates, preserving release tails. */
    allNotesOff(): number;
    /** Immediate silence, including release/stealing tails; routing and patch cache survive. */
    panic(): number;
    setMixGain(gain: number): number;
    setTuning(tuning: TuningOptions): number;
    /** Wait for admission only. At most 128 receipts and 64 live waits; live waits prevent eviction. */
    waitForCommand(commandId: number, options?: CommandWaitOptions): Promise<CommandEvent>;
    getDiagnostics(): Promise<DiagnosticsEvent>;
    close(): Promise<void>;
    /** Permanently closes OPM and releases host callbacks; never closes a borrowed context. */
    dispose(): Promise<void>;
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
