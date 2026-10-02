import type { ChunkedSequenceOptions, SequenceCapacity, SequenceEvent } from '../core/sequence.js';
import type { WavFormat } from '../core/wav.js';
export interface WavSink {
    /** Takes ownership of bytes; transferring/detaching their buffer is supported. */
    write(bytes: Uint8Array): Promise<void> | void;
    close?(): Promise<void> | void;
    /** Must invalidate outstanding writes. Called once on failure, without waiting for them. */
    abort?(reason: unknown): Promise<void> | void;
}
export interface WorkerRenderProgress {
    readonly frames: number;
    readonly totalFrames: number;
    readonly bytesWritten: number;
    readonly errors: number;
}
export interface WorkerRenderOptions extends ChunkedSequenceOptions {
    format?: WavFormat;
    sink: WavSink;
    onProgress?: (progress: WorkerRenderProgress) => void;
    /** Reviewed same-origin secure HTTP(S) static module, never a blob/data URL. */
    workerUrl?: string | URL;
}
export interface WorkerRenderResult {
    readonly capacity: SequenceCapacity;
    readonly format: WavFormat;
    readonly bytesWritten: number;
    readonly diagnostics: Readonly<{
        errors: number;
        processedEvents: number;
        renderedFrames: number;
    }>;
}
/** Browser-only, backpressured offline rendering; importing this module allocates nothing. */
export declare function renderSequenceInWorker(events: readonly SequenceEvent[], options: WorkerRenderOptions): Promise<WorkerRenderResult>;
