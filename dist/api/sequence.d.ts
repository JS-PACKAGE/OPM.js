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
