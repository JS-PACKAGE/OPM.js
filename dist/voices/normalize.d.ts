import type { NormalizedVoice, PreparedVoice, VoiceInput } from './schema.js';
export declare function normalizeVoice(source: VoiceInput): NormalizedVoice;
/** Validate once and retain a deeply immutable, caller-independent snapshot. */
export declare function prepareVoice(input: VoiceInput): PreparedVoice;
