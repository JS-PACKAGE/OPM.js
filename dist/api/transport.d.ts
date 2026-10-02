import type { OPM } from './index.js';
import type { SequenceEvent } from '../core/sequence.js';
import type { TempoPoint, TimeSignature, BarBeat } from '../core/transport.js';
export { beatsToSeconds, secondsToBeats, beatToBarBeat, barBeatToBeat, normalizeTempoMap, quantizeBeat, swingBeat } from '../core/transport.js';
export type { TempoPoint, TimeSignature, BarBeat, BeatQuantization } from '../core/transport.js';
export type BeatSequenceEvent = SequenceEvent extends infer E ? E extends SequenceEvent ? Omit<E, 'time'> & {
    beat: number;
} : never : never;
export interface TransportLoop {
    enabled: boolean;
    from: number;
    to: number;
}
export type TransportState = 'stopped' | 'starting' | 'running' | 'paused' | 'disposed';
export interface TransportOptions {
    bpm?: number;
    tempoMap?: readonly TempoPoint[];
    timeSignature?: TimeSignature;
    loop?: TransportLoop;
    horizon?: number;
    interval?: number;
    maxSlots?: number;
    onError?: (error: Error) => void;
}
export interface TransportSnapshot {
    readonly position: number;
    readonly musicalPosition: Readonly<BarBeat>;
    readonly state: TransportState;
    readonly running: boolean;
    readonly tempoMap: readonly Readonly<TempoPoint>[];
    readonly timeSignature: Readonly<TimeSignature>;
    readonly loop: Readonly<TransportLoop>;
}
export interface MusicalTransport {
    readonly position: number;
    readonly running: boolean;
    readonly state: TransportState;
    readonly snapshot: TransportSnapshot;
    readonly ids: ReadonlyMap<number, number>;
    start(): Promise<void>;
    resume(): Promise<void>;
    pause(): void;
    stop(): void;
    seek(beat: number): void;
    /** Replace the tempo from the current musical position onward; retain preceding points. */
    setTempo(bpm: number): void;
    setTempoMap(map: readonly TempoPoint[]): void;
    setLoop(loop: TransportLoop): void;
    pump(): void;
    dispose(): void;
}
/** Internal shared preparation: beat durations remain beats until admitted to the audio clock. */
export declare function prepareBeatEvents(opm: OPM, beatEvents: readonly BeatSequenceEvent[]): import("../core/sequence.js").SequenceSnapshot;
/** Swing note starts AND ends, so adjacent gates retain their musical ordering. */
export declare function swingBeatEvents(events: readonly BeatSequenceEvent[], subdivision?: number, ratio?: number): BeatSequenceEvent[];
/** Restartable beat transport. Only owned IDs are ever stopped; the shared engine is not closed. */
export declare function createTransport(opm: OPM, beatEvents: readonly BeatSequenceEvent[], options?: TransportOptions): MusicalTransport;
