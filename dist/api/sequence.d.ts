import type { OPM } from './index.js';
import type { SequenceEvent } from '../core/sequence.js';
export interface PlaySequenceOptions {
    /** Absolute AudioContext origin; omitted means currentTime at submission. */
    at?: number;
}
export interface SequencePlayback {
    /** Score IDs mapped to submitted OPM IDs, not an acknowledgement of admission. */
    readonly ids: ReadonlyMap<number, number>;
    /** Release started notes and immediately cancel pending onsets. Idempotent. */
    stop(): void;
}
/** Submit one bounded, wholly validated score; lifecycle acknowledgements remain OPM events. */
export declare function playSequence(opm: OPM, events: readonly SequenceEvent[], options?: PlaySequenceOptions): SequencePlayback;
export interface SequenceStreamOptions {
    /** Absolute origin, at most60 seconds ahead; defaults to currentTime at start. */
    at?: number;
    /** Lookahead seconds in0.01..10, default0.2. */
    horizon?: number;
    /** Timer interval seconds in0.001..horizon/2, default0.025 (or horizon/2). */
    interval?: number;
    /** Maximum own queued commands, integer1..256; default256. */
    maxSlots?: number;
    signal?: AbortSignal;
    onError?: (error: Error) => void;
}
export interface SequenceStream {
    readonly running: boolean;
    /** Live/pending owned score IDs only; terminal IDs are pruned. Detached snapshot. */
    readonly ids: ReadonlyMap<number, number>;
    /** One-shot start. stop/dispose/reset/interruption permanently cancel this score. */
    start(): Promise<void>;
    /** Optional explicit pump for hosts driving their own clock; timers still run. */
    pump(): void;
    stop(): void;
    dispose(): void;
}
/**
 * Stream a fully validated long score in bounded mixed-event windows.
 * A missed onset/window or rejected command stops the stream instead of silently retiming.
 */
export declare function streamSequence(opm: OPM, events: readonly SequenceEvent[], options?: SequenceStreamOptions): SequenceStream;
