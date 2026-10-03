import type { Performance } from './performance.js';
export type MidiScalarControl = 'pitch' | 'expression' | 'gain' | 'pan' | 'modulation' | 'feedback' | 'lfoRate' | 'amDepth' | 'pmDepth';
export type MidiOperatorControl = 'operatorLevels' | 'operatorRatios' | 'operatorFrequencies';
interface MidiControllerRange {
    /** CC number 0..127, excluding pedal/reset/panic CC64/120/121/123. */
    controller: number;
    /** CC0 maps to min and CC127 to max; both endpoints must be valid engine controls. */
    min: number;
    max: number;
    /** Seconds 0..10; pitch uses glide, other fields use the engine control ramp. */
    ramp: number;
}
/** One CC targets one scalar or one operator element; no executable callbacks are accepted. */
export type MidiControllerMapping = MidiControllerRange & ({
    field: MidiScalarControl;
    reset?: number;
} | {
    field: MidiOperatorControl;
    operator: 0 | 1 | 2 | 3;
    reset?: number | null;
});
/** Structural subset of Web MIDI, so hosts and tests can inject a real or simulated access object. */
export interface MidiMessageEventLike {
    readonly data: Uint8Array | null;
}
export interface MidiInputLike {
    readonly id: string;
    readonly name?: string | null;
    readonly state?: string;
    readonly connection?: string;
    open?(): Promise<unknown>;
    addEventListener(type: 'midimessage', listener: (event: MidiMessageEventLike) => void): void;
    removeEventListener(type: 'midimessage', listener: (event: MidiMessageEventLike) => void): void;
}
export interface MidiAccessLike {
    readonly inputs: ReadonlyMap<string, MidiInputLike>;
    addEventListener(type: 'statechange', listener: () => void): void;
    removeEventListener(type: 'statechange', listener: () => void): void;
}
export interface MidiNavigatorLike {
    requestMIDIAccess?(options?: {
        sysex?: boolean;
        software?: boolean;
    }): Promise<MidiAccessLike>;
}
export interface MidiAdapterOptions {
    /** Channels 1..16 map to zero-based Performance parts below this count; default 16. */
    parts?: number;
    /** Semitones for full pitch-bend deflection, 0..48; default 2. */
    pitchBendRange?: number;
    /** Restrict to these stable port IDs; default every currently and subsequently connected input. */
    inputIds?: readonly string[];
    /** At most 128 own-data mappings. Ordinary CC defaults are overridden only for listed CCs. */
    controllerMap?: readonly MidiControllerMapping[];
    onError?: (error: Error) => void;
}
export interface MidiAdapterSnapshot {
    readonly inputs: readonly string[];
    readonly heldKeys: number;
    /** Messages outside the supported channel-voice subset or malformed packets. */
    readonly ignoredMessages: number;
    readonly disposed: boolean;
}
export interface MidiAdapter {
    readonly snapshot: MidiAdapterSnapshot;
    /** Releases only keys owned by this adapter; unrelated Performance parts and host notes stay untouched. */
    releaseAll(): void;
    dispose(): void;
}
/**
 * Request MIDI access without SysEx. Call from an explicit user action; browsers may show a permission prompt.
 * Importing this module never requests access.
 */
export declare function requestMidiAccess(host?: MidiNavigatorLike | undefined): Promise<MidiAccessLike>;
/**
 * Map channel-voice MIDI from user-granted inputs onto Performance parts. It is an adapter, not a MIDI driver:
 * no SysEx, clock, program-change or hardware-specific behavior is implemented.
 *
 * Note-off releases the oldest still-held key of the same input/channel/pitch. CC1, channel pressure and polyphonic
 * pressure all scale LFO depth 1x..2x (never below the patch default). CC7/CC11 multiply into part expression, CC10 pans,
 * CC64 is sustain, CC120/123 release only this adapter's keys for the channel, and CC121 resets its controllers.
 */
export declare function createMidiAdapter(performance: Performance, access: MidiAccessLike, options?: MidiAdapterOptions): MidiAdapter;
export {};
