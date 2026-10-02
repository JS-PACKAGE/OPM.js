import './worklet-globals.js';
import { Synth } from '../core/synth.js';
import type { NoteControls, NoteOptions, VoiceEndReason } from '../core/synth.js';
import type { PreparedVoice } from '../voices/schema.js';
import type { DiagnosticsEvent, NoteEvent, NoteState } from '../api/index.js';
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
    constructor();
    send(message: NoteEvent | DiagnosticsEvent): void;
    noteEvent(id: number, state: NoteState, reason?: string, frame?: number): void;
    reject(id: unknown, reason: string): void;
    insert(event: ScheduledEvent): void;
    removeEvents(id: number, onlyAutomatic?: boolean): void;
    ended(id: number, reason: VoiceEndReason): void;
    release(id: number): void;
    receive(raw: unknown): void;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
