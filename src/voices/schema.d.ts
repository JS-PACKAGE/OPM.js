export type Algorithm = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface ADSR { a: number; d: number; s: number; r: number }
export interface LFO { rate: number; amDepth: number; pmDepth: number }
export interface KeyScale { breakpoint: number; leftDbPerOctave: number; rightDbPerOctave: number }
export interface LegacyOperator { ratio: number; level: number; detune: number; adsr: ADSR; keyScale?: never }
export interface Operator { ratio: number; level: number; detune: number; adsr: ADSR; keyScale?: KeyScale }
export type FourOperators<T = Operator> = [T, T, T, T];
interface VoiceBase { name?: string; algorithm: Algorithm; feedback: Algorithm; modIndex?: number; lfo?: LFO }
/** Strict single-voice input; optional metadata and modulation have runtime defaults. */
export type VoiceInput = (VoiceBase & { version?: 2; ops: readonly [Operator, Operator, Operator, Operator] }) |
  (VoiceBase & { version: 1; ops: readonly [LegacyOperator, LegacyOperator, LegacyOperator, LegacyOperator] });
export interface Voice { version: 2; name: string; algorithm: Algorithm; feedback: Algorithm; modIndex: number; lfo: LFO; ops: FourOperators }
export interface LegacyVoice { version: 1; name: string; algorithm: Algorithm; feedback: Algorithm; modIndex: number; lfo: LFO; ops: FourOperators<LegacyOperator> }
export interface NormalizedVoice { version?: 2; name?: string; algorithm: Algorithm; feedback: Algorithm; modIndex: number; lfo: LFO; ops: FourOperators }
export type CompleteVoiceInput = Voice | LegacyVoice;
export type FrozenVoice = Readonly<Omit<Voice, 'lfo' | 'ops'>> & {
  readonly lfo: Readonly<LFO>;
  readonly ops: readonly [FrozenOperator, FrozenOperator, FrozenOperator, FrozenOperator];
};
export type FrozenOperator = Readonly<Omit<Operator, 'adsr' | 'keyScale'>> & {
  readonly adsr: Readonly<ADSR>; readonly keyScale?: Readonly<KeyScale>;
};
export const MAX_BANK_BYTES: 262144;
export const MAX_BANK_VOICES: 128;
export const LIMITS: Readonly<Record<'ratio' | 'level' | 'detune' | 'a' | 'd' | 's' | 'r' | 'modIndex' | 'rate' | 'amDepth' | 'pmDepth' | 'breakpoint' | 'leftDbPerOctave' | 'rightDbPerOctave', readonly [number, number]>>;
export function bounded(value: unknown, min: number, max: number, label?: string): number;
/** Validate a complete voice, clamp finite numeric fields, and freeze a detached v2 copy. */
export function validateVoice(input: unknown): FrozenVoice;
export function parseVoiceBank(input: string | readonly unknown[]): Map<string, FrozenVoice>;
