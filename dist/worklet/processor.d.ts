import './worklet-globals.js';
import { Synth } from '../core/synth.js';
import type { NoteOptions, VoiceEndReason } from '../core/synth.js';
import type { NormalizedVoice } from '../voices/schema.js';
import type { DiagnosticsEvent, NoteEvent, NoteState } from '../api/index.js';
type ScheduledEvent = {
    type: 'noteOn';
    id: number;
    frame: number;
    note: number;
    voice: NormalizedVoice;
    options: NoteOptions;
} | {
    type: 'noteOff';
    id: number;
    frame: number;
};
interface TrackedNote {
    state: 'pending' | 'started' | 'released';
}
export type { OPMProcessor };
declare class OPMProcessor extends AudioWorkletProcessor {
    synth: Synth | null;
    events: ScheduledEvent[];
    notes: Map<number, TrackedNote>;
    errorCount: number;
    rejectedNotes: number;
    closed: boolean;
    constructor();
    send(message: NoteEvent | DiagnosticsEvent): void;
    noteEvent(id: number, state: NoteState, reason?: string): void;
    reject(id: unknown, reason: string): void;
    insert(event: ScheduledEvent): void;
    removeEvents(id: number): void;
    ended(id: number, reason: VoiceEndReason): void;
    receive(raw: unknown): void;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
