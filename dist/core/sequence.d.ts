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
    voicePriority?: number;
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
export type BeatSequenceEvent = SequenceEvent extends infer E ? E extends SequenceEvent ? Omit<E, 'time'> & {
    beat: number;
} : never : never;
export type SequenceVoices = ReadonlyMap<string, VoiceInput>;
export interface SequenceOptions extends SynthOptions {
    voices?: SequenceVoices;
    sampleRate?: number;
    /** Logical polyphony, integer1..32; default8. Stolen fades remain bounded to eight. */
    maxVoices?: number;
}
export type PreparedSequenceEvent = Readonly<Omit<SequenceNoteEvent, 'voice' | 'velocity' | 'pan' | 'voicePriority'> & {
    voice: PreparedVoice;
    velocity: number;
    pan: number;
    voicePriority: number;
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
export declare const MAX_LONG_SEQUENCE_SECONDS: number;
export declare const MAX_LONG_SEQUENCE_EVENTS = 65536;
export declare const MAX_SEQUENCE_CHUNK_FRAMES = 65536;
export declare function sampleRateValue(value: number): number;
export declare function sequenceOwnData(input: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown>;
/** Validate the entire score without invoking accessors, and detach every patch/control. */
export declare function prepareSequence(events: readonly SequenceEvent[], options?: Pick<SequenceOptions, 'voices'>): SequenceSnapshot;
/** Long scores have a separate input budget; this does not enlarge worklet queues. */
export declare function prepareLongSequence(events: readonly SequenceEvent[], options?: Pick<SequenceOptions, 'voices'>): SequenceSnapshot;
export type SequenceFrameEvent = {
    frame: number;
    order: number;
    event: PreparedSequenceEvent;
};
/** Shared sample-frame ordering, including automatic releases and pending controls. */
export declare function sequenceFrameEvents(score: SequenceSnapshot, sampleRate: number, origin?: number): {
    queue: SequenceFrameEvent[];
    length: number;
};
/** Peak submissions in any half-open window; includes automatic releases. */
export declare function sequenceWindowCapacity(queue: readonly SequenceFrameEvent[], sampleRate: number, horizon: number): {
    peakWindowSlots: number;
    peakWindowNotes: number;
};
export interface ChunkedSequenceOptions extends SequenceOptions {
    /** Integer 1..65536; default4096. Two buffers are reused for the entire render. */
    chunkFrames?: number;
    /** Optional hard cumulative frame budget, checked before allocation/advancement. */
    maxFrames?: number;
    signal?: AbortSignal;
}
export interface SequenceCapacity {
    readonly sampleRate: number;
    readonly frames: number;
    readonly pcmBytes: number;
    readonly chunkFrames: number;
    readonly chunkBytes: number;
    readonly eventCount: number;
    readonly noteCount: number;
    readonly reservedSlots: number;
    readonly fullBufferAllowed: boolean;
    readonly singleBatchAllowed: boolean;
    /** Default0.2s-window preflight eligibility, not guaranteed live worklet admission. */
    readonly streamAllowed: boolean;
    readonly peakWindowSlots: number;
    readonly peakWindowNotes: number;
    readonly limits: Readonly<{
        fullBufferFrames: number;
        batchNotes: number;
        batchSlots: number;
        longEvents: number;
        longSeconds: number;
        chunkFrames: number;
        streamHorizonSeconds: number;
        streamSlots: number;
        streamNotes: number;
    }>;
}
export interface SequenceChunk {
    /** Borrowed arrays, overwritten by the next next(). Copy only if retention is required. */
    readonly left: Float32Array;
    readonly right: Float32Array;
    readonly offset: number;
    readonly frames: number;
    readonly sampleRate: number;
    readonly diagnostics: Readonly<{
        errors: number;
        processedEvents: number;
        renderedFrames: number;
    }>;
}
export interface ChunkedSequenceRender extends IterableIterator<SequenceChunk> {
    readonly capacity: SequenceCapacity;
    readonly diagnostics: Readonly<{
        errors: number;
        processedEvents: number;
        renderedFrames: number;
    }>;
    /** Idempotent. Subsequent next() returns done without advancing the synth. */
    cancel(): void;
}
/** Validate and estimate without allocating any PCM or advancing a synth. */
export declare function estimateSequenceCapacity(events: readonly SequenceEvent[], options?: ChunkedSequenceOptions): SequenceCapacity;
/** Fully validate first; each next() advances at most chunkFrames, never allocates full PCM. */
export declare function renderSequenceChunks(events: readonly SequenceEvent[], options?: ChunkedSequenceOptions): ChunkedSequenceRender;
/** Convenience full-buffer rendering retains the original score and allocation budgets. */
export declare function renderSequence(events: readonly SequenceEvent[], options?: SequenceOptions): RenderResult;
