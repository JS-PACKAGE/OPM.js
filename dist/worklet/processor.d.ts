import './worklet-globals.js';
import { Synth } from '../core/synth.js';
import type { NoteControls, NoteOptions, VoiceEndReason } from '../core/synth.js';
import type { PreparedVoice } from '../voices/schema.js';
import type { CommandEvent, DiagnosticsEvent, NoteEvent, NoteState, ResetEvent } from '../api/index.js';
type RawMessage = {
    type: 'prepareVoice';
    voiceId: unknown;
    voice: unknown;
} | {
    type: 'noteOn';
    id: unknown;
    voice?: unknown;
    voiceId?: unknown;
    note: unknown;
    at: unknown;
    duration: unknown;
    velocity?: unknown;
    pan?: unknown;
    voicePriority?: unknown;
    late?: unknown;
} | {
    type: 'noteOff';
    id: unknown;
    at?: unknown;
    cancelControls?: unknown;
    commandId?: unknown;
} | {
    type: 'updateNote';
    id: unknown;
    controls: unknown;
    at?: unknown;
    commandId?: unknown;
} | {
    type: 'allNotesOff';
    commandId?: unknown;
} | {
    type: 'panic';
    commandId?: unknown;
    reason?: unknown;
} | {
    type: 'setMixGain';
    gain: unknown;
    commandId?: unknown;
} | {
    type: 'setTuning';
    tuning: unknown;
    commandId?: unknown;
} | {
    type: 'diagnostics';
    requestId: unknown;
} | {
    type: 'close';
};
type ScheduledEvent = {
    type: 'noteOn';
    id: number;
    frame: number;
    note: number;
    voice: PreparedVoice;
    options: NoteOptions;
    late: 'start' | 'drop';
    durationFrames: number | null;
} | {
    type: 'noteOff';
    id: number;
    frame: number;
    automatic: boolean;
} | {
    type: 'updateNote';
    id: number;
    frame: number;
    controls: NoteControls;
};
interface TrackedNote {
    state: 'pending' | 'started' | 'released';
    startFrame: number;
}
export type { OPMProcessor };
declare const COMMAND_TYPES: Readonly<{
    readonly noteOff: "stop";
    readonly updateNote: "updateNote";
    readonly allNotesOff: "allNotesOff";
    readonly panic: "panic";
    readonly setMixGain: "setMixGain";
    readonly setTuning: "setTuning";
}>;
type CommandMessage = Extract<RawMessage, {
    type: keyof typeof COMMAND_TYPES;
}>;
declare class OPMProcessor extends AudioWorkletProcessor {
    synth: Synth | null;
    events: ScheduledEvent[];
    notes: Map<number, TrackedNote>;
    patches: Map<number, PreparedVoice>;
    errorCount: number;
    rejectedNotes: number;
    closed: boolean;
    dispatchFrame: number;
    renderFrameBase: number;
    rendering: boolean;
    constructor(options?: AudioWorkletNodeOptions);
    send(message: NoteEvent | DiagnosticsEvent | CommandEvent | ResetEvent): void;
    noteEvent(id: number, state: NoteState, reason?: string, frame?: number): void;
    reject(id: unknown, reason: string): void;
    commandEvent(data: CommandMessage, state: CommandEvent['state'], reason?: string): void;
    panic(reason: 'panic' | 'interruption', commandId?: unknown): void;
    insert(event: ScheduledEvent): void;
    removeEvents(id: number, mode?: 'all' | 'automatic' | 'controls'): void;
    ended(id: number, reason: VoiceEndReason): void;
    release(id: number, cancelControls?: boolean): void;
    receive(raw: unknown): void;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
