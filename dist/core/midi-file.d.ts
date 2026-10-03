import type { BeatSequenceEvent } from './sequence.js';
import type { TempoPoint, TimeSignature } from './transport.js';
export declare const MAX_MIDI_FILE_BYTES: number;
export declare const MAX_MIDI_FILE_TRACKS = 128;
/** Counts all wire events, including skipped messages and end-of-track markers. */
export declare const MAX_MIDI_FILE_EVENTS = 65536;
export type MidiFileWarningCode = 'header-extension' | 'ignored-meta' | 'ignored-sysex' | 'ignored-channel' | 'release-velocity' | 'default-voice' | 'sustain-applied' | 'tempo-conflict' | 'meter-detail' | 'unclosed-notes';
export interface MidiFileWarning {
    code: MidiFileWarningCode;
    message: string;
    count: number;
}
export interface MidiImportOptions {
    /** Zero-based MIDI channels, written as decimal object keys, to OPM voice names. */
    channelVoices?: Readonly<Record<string, string>>;
    defaultVoice?: string;
    /** Unsupported musical/metadata content is reported, or rejects the entire file. */
    unsupported?: 'warn' | 'reject';
    /** Includes keys held by sustain at the final end-of-track tick. */
    unclosedNotes?: 'reject' | 'close-at-end';
    sustain?: 'apply' | 'reject';
}
export interface MidiImportResult {
    events: BeatSequenceEvent[];
    tempoMap: readonly Readonly<TempoPoint>[];
    timeSignature: Readonly<TimeSignature>;
    warnings: readonly Readonly<MidiFileWarning>[];
}
export interface MidiExportOptions {
    format?: 0 | 1;
    ppqn?: number;
    tempoMap?: readonly TempoPoint[];
    bpm?: number;
    timeSignature?: TimeSignature;
    /** Named voices to zero-based MIDI channels. Only brass -> channel 0 is implicit. */
    voiceChannels?: Readonly<Record<string, number>>;
}
/** Strict SMF 0/1 PPQN adapter, not a General MIDI synthesizer or device driver. */
export declare function importMidiFile(source: Uint8Array, options?: MidiImportOptions): MidiImportResult;
/** Deterministic type 0/1 notes, stepped tempo and one meter; unsupported controls reject. */
export declare function exportMidiFile(events: readonly BeatSequenceEvent[], options?: MidiExportOptions): Uint8Array;
