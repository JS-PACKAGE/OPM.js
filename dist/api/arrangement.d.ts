import type { OPM } from './index.js';
import type { BeatSequenceEvent } from './transport.js';
import type { BarBeat, TempoPoint, TimeSignature } from '../core/transport.js';
export interface ArrangementLayer {
    name: string;
    /** Loop length in quarter notes, 0 < length <= 256. Layers stay aligned to the global beat grid. */
    length: number;
    /** Beat events inside [0, length). Note durations may exceed the loop length. */
    events: readonly BeatSequenceEvent[];
    /** Admission importance 0..127 applied to every note in this layer (maximum with a note's own value). */
    voicePriority?: number;
    /** Per-layer gain 0..1, default 1; independent of authored note expression. */
    gain?: number;
}
export interface ArrangementSection {
    name: string;
    layers: readonly string[];
}
export interface ArrangementOptions {
    layers: readonly ArrangementLayer[];
    sections: readonly ArrangementSection[];
    initialSection: string;
    bpm?: number;
    tempoMap?: readonly TempoPoint[];
    timeSignature?: TimeSignature;
    horizon?: number;
    interval?: number;
    onError?: (error: Error) => void;
}
export interface ArrangementChangeOptions {
    /** Boundary in quarter notes, or the meter-defined beat/bar; default bar. Never earlier than already admitted notes. */
    quantize?: 'beat' | 'bar' | number;
    /** Removed layers may finish naturally instead of being released at the boundary. Default false. */
    preserveNotes?: boolean;
    /** Linear gain fade in seconds, 0..10; default 0. Shared layers remain continuous. */
    fade?: number;
}
export interface ArrangementGainOptions {
    quantize?: 'beat' | 'bar' | number;
    fade?: number;
}
export type ArrangementState = 'stopped' | 'starting' | 'running' | 'paused' | 'disposed';
export interface ArrangementSnapshot {
    readonly state: ArrangementState;
    /** Global quarter-note position; a paused arrangement reports where it will resume. */
    readonly position: number;
    readonly musicalPosition: Readonly<BarBeat>;
    readonly section: string;
    /** Layers effective at position. */
    readonly layers: readonly string[];
    /** Committed changes after the current position. */
    readonly pending: readonly Readonly<{
        beat: number;
        section: string;
        layers: readonly string[];
    }>[];
    /** Notes refused by voice-priority admission; they are not an arrangement failure. */
    readonly priorityDrops: number;
    readonly tempoMap: readonly Readonly<TempoPoint>[];
}
export interface Arrangement {
    readonly state: ArrangementState;
    readonly snapshot: ArrangementSnapshot;
    start(): Promise<void>;
    resume(): Promise<void>;
    /** Releases owned notes. Resume restarts musically at the paused beat; no DSP checkpoint is restored. */
    pause(): void;
    /** Releases owned notes and rewinds to beat 0. */
    stop(): void;
    switchSection(name: string, options?: ArrangementChangeOptions): number;
    setLayer(name: string, enabled: boolean, options?: ArrangementChangeOptions): number;
    setLayerGain(name: string, gain: number, options?: ArrangementGainOptions): number;
    /** Replaces tempo from the current beat onward; notes already admitted keep their admitted audio times. */
    setTempo(bpm: number): void;
    setTempoMap(map: readonly TempoPoint[]): void;
    pump(): void;
    dispose(): void;
}
/**
 * Looping, quantized adaptive music for one OPM instance. Layers are aligned to the global beat grid, so a layer
 * shared by two sections is one continuous schedule: its sounding gates are neither retriggered nor stopped when
 * unrelated layers change. Changes are committed at a boundary no earlier than the notes already admitted.
 */
export declare function createArrangement(opm: OPM, options: ArrangementOptions): Arrangement;
