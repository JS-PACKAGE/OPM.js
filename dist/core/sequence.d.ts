import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
import type { NoteControls, SynthOptions } from './synth.js';
import type { RenderResult } from './index.js';
export interface SequenceNoteEvent {
    type: 'note';
    id: number;
    time: number;
    duration: number;
    voice?: string | VoiceInput;
    note: number;
    velocity?: number;
    pan?: number;
}
export interface SequenceStopEvent {
    type: 'stop';
    id: number;
    time: number;
}
export interface SequenceControlEvent {
    type: 'control';
    id: number;
    time: number;
    controls: NoteControls;
}
export type SequenceEvent = SequenceNoteEvent | SequenceStopEvent | SequenceControlEvent;
export type SequenceVoices = ReadonlyMap<string, VoiceInput>;
export interface SequenceOptions extends SynthOptions {
    voices?: SequenceVoices;
    sampleRate?: number;
}
export type PreparedSequenceEvent = Readonly<Omit<SequenceNoteEvent, 'voice' | 'velocity' | 'pan'> & {
    voice: PreparedVoice;
    velocity: number;
    pan: number;
}> | Readonly<SequenceStopEvent> | Readonly<Omit<SequenceControlEvent, 'controls'> & {
    controls: Readonly<NoteControls>;
}>;
export interface SequenceSnapshot {
    readonly events: readonly PreparedSequenceEvent[];
    readonly noteCount: number;
    /** Notes reserve both onset and automatic release, even if explicitly cancelled. */
    readonly reservedSlots: number;
    readonly endTime: number;
}
export declare const MAX_SEQUENCE_NOTES = 128;
export declare const MAX_SEQUENCE_SLOTS = 256;
export declare const MAX_SEQUENCE_SECONDS = 60;
export declare const MAX_RENDER_SAMPLES = 4000000;
export declare function sampleRateValue(value: number): number;
/** Validate the entire score without invoking accessors, and detach every patch/control. */
export declare function prepareSequence(events: readonly SequenceEvent[], options?: Pick<SequenceOptions, 'voices'>): SequenceSnapshot;
/** Pure score rendering through the same bounded Synth used by the AudioWorklet. */
export declare function renderSequence(events: readonly SequenceEvent[], options?: SequenceOptions): RenderResult;
