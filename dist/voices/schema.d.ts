export type Algorithm = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface ADSR {
    a: number;
    d: number;
    s: number;
    r: number;
}
export interface LegacyLFO {
    rate: number;
    amDepth: number;
    pmDepth: number;
    waveform?: never;
}
export interface LFO {
    rate: number;
    amDepth: number;
    pmDepth: number;
    waveform: 'sine' | 'triangle' | 'saw' | 'square';
}
export type LFOInput = Omit<LFO, 'waveform'> & {
    waveform?: LFO['waveform'];
};
export interface KeyScale {
    breakpoint: number;
    leftDbPerOctave: number;
    rightDbPerOctave: number;
}
export interface LegacyOperator {
    ratio: number;
    level: number;
    detune: number;
    adsr: ADSR;
    keyScale?: never;
    velocitySensitivity?: never;
}
export interface LegacyOperatorV2 extends Omit<LegacyOperator, 'keyScale'> {
    keyScale?: KeyScale;
}
export interface Operator extends Omit<LegacyOperatorV2, 'velocitySensitivity'> {
    velocitySensitivity?: number;
}
export type FourOperators<T = Operator> = [T, T, T, T];
interface VoiceBase {
    name?: string;
    algorithm: Algorithm;
    feedback: Algorithm;
    modIndex?: number;
}
/** Strict single-voice input; omitted version uses the current shape. */
export type VoiceInput = (VoiceBase & {
    version?: 4;
    lfo?: LFOInput;
    ops: readonly [Operator, Operator, Operator, Operator];
}) | (VoiceBase & {
    version: 3;
    lfo?: LegacyLFO;
    ops: readonly [Operator, Operator, Operator, Operator];
}) | (VoiceBase & {
    version: 2;
    lfo?: LegacyLFO;
    ops: readonly [LegacyOperatorV2, LegacyOperatorV2, LegacyOperatorV2, LegacyOperatorV2];
}) | (VoiceBase & {
    version: 1;
    lfo?: LegacyLFO;
    ops: readonly [LegacyOperator, LegacyOperator, LegacyOperator, LegacyOperator];
});
export interface Voice {
    version: 4;
    name: string;
    algorithm: Algorithm;
    feedback: Algorithm;
    modIndex: number;
    lfo: LFO;
    ops: FourOperators;
}
export interface LegacyVoice {
    version: 1;
    name: string;
    algorithm: Algorithm;
    feedback: Algorithm;
    modIndex: number;
    lfo: LegacyLFO;
    ops: FourOperators<LegacyOperator>;
}
export interface LegacyVoiceV2 extends Omit<LegacyVoice, 'version' | 'ops'> {
    version: 2;
    ops: FourOperators<LegacyOperatorV2>;
}
export interface LegacyVoiceV3 extends Omit<LegacyVoice, 'version' | 'ops'> {
    version: 3;
    ops: FourOperators;
}
export interface NormalizedVoice {
    version: 4;
    name?: string;
    algorithm: Algorithm;
    feedback: Algorithm;
    modIndex: number;
    lfo: LFO;
    ops: FourOperators;
}
export type CompleteVoiceInput = Voice | LegacyVoice | LegacyVoiceV2 | LegacyVoiceV3;
export type FrozenVoice = Readonly<Omit<Voice, 'lfo' | 'ops'>> & {
    readonly lfo: Readonly<LFO>;
    readonly ops: readonly [FrozenOperator, FrozenOperator, FrozenOperator, FrozenOperator];
};
export type FrozenOperator = Readonly<Omit<Operator, 'adsr' | 'keyScale'>> & {
    readonly adsr: Readonly<ADSR>;
    readonly keyScale?: Readonly<KeyScale>;
};
declare const preparedVoiceBrand: unique symbol;
/** Immutable validated snapshot. Only prepareVoice can create the trusted identity. */
export type PreparedVoice = Readonly<Omit<NormalizedVoice, 'lfo' | 'ops'>> & {
    readonly lfo: Readonly<LFO>;
    readonly ops: readonly [FrozenOperator, FrozenOperator, FrozenOperator, FrozenOperator];
    readonly [preparedVoiceBrand]: true;
};
export { prepareVoice } from './normalize.js';
export declare const MAX_BANK_BYTES = 262144;
export declare const MAX_BANK_VOICES = 128;
type LimitKey = 'ratio' | 'level' | 'detune' | 'velocitySensitivity' | 'a' | 'd' | 's' | 'r' | 'modIndex' | 'rate' | 'amDepth' | 'pmDepth' | 'breakpoint' | 'leftDbPerOctave' | 'rightDbPerOctave';
export declare const LIMITS: Readonly<Record<LimitKey, readonly [number, number]>>;
export declare function bounded(value: unknown, min: number, max: number, label?: string): number;
export declare function lfoWaveform(value: unknown): LFO['waveform'];
export declare function validateVoice(input: unknown): FrozenVoice;
export declare function parseVoiceBank(source: string | readonly unknown[]): Map<string, FrozenVoice>;
