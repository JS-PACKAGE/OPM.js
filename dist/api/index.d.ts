import type { NormalizedVoice, VoiceInput } from '../voices/schema.js';
export type { ADSR, LFO, KeyScale, Operator, Voice, VoiceInput, FrozenVoice } from '../voices/schema.js';
export type NoteState = 'accepted' | 'started' | 'released' | 'ended' | 'stolen' | 'cancelled' | 'rejected';
export interface NoteEvent { type: 'note'; id: number; state: NoteState; reason?: string }
export interface DiagnosticsEvent {
  type: 'diagnostics'; requestId: number; activeVoices: number;
  pendingEvents: number; errors: number; rejectedNotes: number;
}
export interface ErrorEvent { type: 'error'; error: Error }
export type OPMEvent = NoteEvent | DiagnosticsEvent | ErrorEvent;
export interface OPMOptions {
  sampleRate?: number;
  /** Borrowed context: OPM never closes or suspends it. */
  context?: AudioContext;
  /** Omit to connect to context.destination; null disables automatic connection. */
  destination?: AudioNode | null;
  onEvent?: (event: OPMEvent) => void;
}
export interface PlayNoteOptions {
  voice?: string | VoiceInput;
  note: number;
  time?: number;
  /** null (the default) holds until stop; a number sets a duration before release. */
  duration?: number | null;
  velocity?: number;
  pan?: number;
}
export class OPM {
  constructor(options?: OPMOptions);
  readonly sampleRate: number | undefined;
  readonly voices: Map<string, NormalizedVoice>;
  readonly context: AudioContext | null;
  readonly node: AudioWorkletNode | null;
  onEvent?: (event: OPMEvent) => void;
  loadVoice(name: string, voice: VoiceInput): void;
  start(): Promise<void>;
  resume(): Promise<void>;
  connect(destination: AudioNode): this;
  disconnect(destination?: AudioNode): this;
  playNote(options: PlayNoteOptions): number;
  stop(id: number): void;
  getDiagnostics(): Promise<DiagnosticsEvent>;
  close(): Promise<void>;
}
