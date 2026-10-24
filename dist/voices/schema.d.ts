export type Algorithm = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** v1–v7 envelope: no sustain rate. */
export interface LegacyADSR {
    a: number;
    d: number;
    s: number;
    r: number;
    sr?: never;
}
/** `sr` (v8, optional): seconds for a held level to fall the full 96 dB after
 * decay; omitted holds the sustain level until release. */
export interface ADSR extends Omit<LegacyADSR, 'sr'> {
    sr?: number;
}
export type LFOTargets = readonly [number, number, number, number];
export type LFOTargetsInput = readonly [number | boolean, number | boolean, number | boolean, number | boolean];
export interface LegacyLFO {
    rate: number;
    amDepth: number;
    pmDepth: number;
    waveform?: never;
    delay?: never;
    sync?: never;
    phase?: never;
    amTargets?: never;
    pmTargets?: never;
}
export type LegacyLFOWaveform = 'sine' | 'triangle' | 'saw' | 'square';
/** v8 adds `noise`: a deterministic pseudo-random level held for each LFO cycle. */
export type LFOWaveform = LegacyLFOWaveform | 'noise';
export interface LegacyLFOV4 extends Omit<LegacyLFO, 'waveform'> {
    waveform: LegacyLFOWaveform;
}
export interface LegacyLFOV5 extends Omit<LegacyLFOV4, 'delay' | 'sync' | 'phase'> {
    delay?: number;
    sync?: 'note' | 'global';
    phase?: number;
}
export interface LegacyLFOV7 extends Omit<LegacyLFOV5, 'amTargets' | 'pmTargets'> {
    amTargets?: LFOTargets;
    pmTargets?: LFOTargets;
}
export interface LFO extends Omit<LegacyLFOV7, 'waveform'> {
    waveform: LFOWaveform;
}
export type LegacyLFOInput = Omit<LegacyLFOV7, 'waveform' | 'amTargets' | 'pmTargets'> & {
    waveform?: LegacyLFOWaveform;
    amTargets?: LFOTargetsInput;
    pmTargets?: LFOTargetsInput;
};
export type LFOInput = Omit<LegacyLFOInput, 'waveform'> & {
    waveform?: LFOWaveform;
};
export interface PitchEnvelope {
    a: number;
    d: number;
    r: number;
    initial: number;
    peak: number;
    sustain: number;
    final: number;
}
export interface KeyScale {
    breakpoint: number;
    leftDbPerOctave: number;
    rightDbPerOctave: number;
}
export type OperatorWaveform = 'sine' | 'half' | 'abs' | 'quarter' | 'alternating' | 'camel' | 'square' | 'saw' | 'noise';
export interface LegacyOperator {
    ratio: number;
    level: number;
    detune: number;
    adsr: LegacyADSR;
    keyScale?: never;
    velocitySensitivity?: never;
    frequency?: never;
    rateKeyScale?: never;
    waveform?: never;
    noiseRate?: never;
}
export interface LegacyOperatorV2 extends Omit<LegacyOperator, 'keyScale'> {
    keyScale?: KeyScale;
}
export interface LegacyOperatorV3 extends Omit<LegacyOperatorV2, 'velocitySensitivity'> {
    velocitySensitivity?: number;
}
export interface LegacyOperatorV6 extends Omit<LegacyOperatorV3, 'frequency' | 'rateKeyScale'> {
    frequency?: number;
    rateKeyScale?: number;
}
export interface LegacyOperatorV7 extends Omit<LegacyOperatorV6, 'waveform' | 'noiseRate'> {
    waveform?: OperatorWaveform;
    noiseRate?: number;
}
export interface Operator extends Omit<LegacyOperatorV7, 'adsr'> {
    adsr: ADSR;
}
export type FourOperators<T = Operator> = [T, T, T, T];
interface VoiceBase {
    name?: string;
    algorithm: Algorithm;
    feedback: Algorithm;
    modIndex?: number;
    pan?: never;
}
/** Strict single-voice input; omitted version uses the current shape. */
export type VoiceInput = (Omit<VoiceBase, 'pan'> & {
    version?: 8;
    pan?: number;
    lfo?: LFOInput;
    pitchEnvelope?: PitchEnvelope;
    ops: readonly [Operator, Operator, Operator, Operator];
}) | (VoiceBase & {
    version: 7;
    lfo?: LegacyLFOInput;
    pitchEnvelope?: PitchEnvelope;
    ops: readonly [LegacyOperatorV7, LegacyOperatorV7, LegacyOperatorV7, LegacyOperatorV7];
}) | (VoiceBase & {
    version: 6;
    lfo?: LegacyLFOInput;
    pitchEnvelope?: PitchEnvelope;
    ops: readonly [LegacyOperatorV6, LegacyOperatorV6, LegacyOperatorV6, LegacyOperatorV6];
}) | (VoiceBase & {
    version: 5;
    lfo?: Omit<LegacyLFOV5, 'waveform'> & {
        waveform?: LegacyLFOWaveform;
    };
    pitchEnvelope?: PitchEnvelope;
    ops: readonly [LegacyOperatorV6, LegacyOperatorV6, LegacyOperatorV6, LegacyOperatorV6];
}) | (VoiceBase & {
    version: 4;
    lfo?: Omit<LegacyLFOV4, 'waveform'> & {
        waveform?: LegacyLFOWaveform;
    };
    pitchEnvelope?: never;
    ops: readonly [LegacyOperatorV3, LegacyOperatorV3, LegacyOperatorV3, LegacyOperatorV3];
}) | (VoiceBase & {
    version: 3;
    lfo?: LegacyLFO;
    pitchEnvelope?: never;
    ops: readonly [LegacyOperatorV3, LegacyOperatorV3, LegacyOperatorV3, LegacyOperatorV3];
}) | (VoiceBase & {
    version: 2;
    lfo?: LegacyLFO;
    pitchEnvelope?: never;
    ops: readonly [LegacyOperatorV2, LegacyOperatorV2, LegacyOperatorV2, LegacyOperatorV2];
}) | (VoiceBase & {
    version: 1;
    lfo?: LegacyLFO;
    pitchEnvelope?: never;
    ops: readonly [LegacyOperator, LegacyOperator, LegacyOperator, LegacyOperator];
});
/** `pan` (v8, optional, -1..1): voice-level stereo offset added to each note's pan, clamped to -1..1. */
export interface Voice {
    version: 8;
    name: string;
    algorithm: Algorithm;
    feedback: Algorithm;
    modIndex: number;
    pan?: number;
    lfo: LFO;
    pitchEnvelope?: PitchEnvelope;
    ops: FourOperators;
}
export interface LegacyVoiceV7 {
    version: 7;
    name: string;
    algorithm: Algorithm;
    feedback: Algorithm;
    modIndex: number;
    pan?: never;
    lfo: LegacyLFOV7;
    pitchEnvelope?: PitchEnvelope;
    ops: FourOperators<LegacyOperatorV7>;
}
export interface LegacyVoice {
    version: 1;
    name: string;
    algorithm: Algorithm;
    feedback: Algorithm;
    modIndex: number;
    lfo: LegacyLFO;
    pitchEnvelope?: never;
    ops: FourOperators<LegacyOperator>;
}
export interface LegacyVoiceV2 extends Omit<LegacyVoice, 'version' | 'ops'> {
    version: 2;
    ops: FourOperators<LegacyOperatorV2>;
}
export interface LegacyVoiceV3 extends Omit<LegacyVoice, 'version' | 'ops'> {
    version: 3;
    ops: FourOperators<LegacyOperatorV3>;
}
export interface LegacyVoiceV4 extends Omit<LegacyVoiceV3, 'version' | 'lfo'> {
    version: 4;
    lfo: LegacyLFOV4;
}
export interface LegacyVoiceV6 extends Omit<LegacyVoiceV7, 'version' | 'ops'> {
    version: 6;
    ops: FourOperators<LegacyOperatorV6>;
}
export interface LegacyVoiceV5 extends Omit<LegacyVoiceV6, 'version' | 'lfo'> {
    version: 5;
    lfo: LegacyLFOV5;
}
export interface NormalizedVoice {
    version: 8;
    name?: string;
    algorithm: Algorithm;
    feedback: Algorithm;
    modIndex: number;
    pan?: number;
    lfo: LFO;
    pitchEnvelope?: PitchEnvelope;
    ops: FourOperators;
}
export type CompleteVoiceInput = Voice | LegacyVoice | LegacyVoiceV2 | LegacyVoiceV3 | LegacyVoiceV4 | LegacyVoiceV5 | LegacyVoiceV6 | LegacyVoiceV7;
export type FrozenVoice = Readonly<Omit<Voice, 'lfo' | 'ops' | 'pitchEnvelope'>> & {
    readonly lfo: Readonly<LFO>;
    readonly pitchEnvelope?: Readonly<PitchEnvelope>;
    readonly ops: readonly [FrozenOperator, FrozenOperator, FrozenOperator, FrozenOperator];
};
export type FrozenOperator = Readonly<Omit<Operator, 'adsr' | 'keyScale'>> & {
    readonly adsr: Readonly<ADSR>;
    readonly keyScale?: Readonly<KeyScale>;
};
declare const preparedVoiceBrand: unique symbol;
/** Immutable validated snapshot. Only prepareVoice can create the trusted identity. */
export type PreparedVoice = Readonly<Omit<NormalizedVoice, 'lfo' | 'ops' | 'pitchEnvelope'>> & {
    readonly lfo: Readonly<LFO>;
    readonly pitchEnvelope?: Readonly<PitchEnvelope>;
    readonly ops: readonly [FrozenOperator, FrozenOperator, FrozenOperator, FrozenOperator];
    readonly [preparedVoiceBrand]: true;
};
export { prepareVoice } from './normalize.js';
export declare const MAX_BANK_BYTES = 262144;
export declare const MAX_BANK_VOICES = 128;
type LimitKey = 'noiseRate' | 'ratio' | 'level' | 'detune' | 'velocitySensitivity' | 'frequency' | 'rateKeyScale' | 'a' | 'd' | 's' | 'r' | 'sr' | 'pan' | 'modIndex' | 'rate' | 'amDepth' | 'pmDepth' | 'delay' | 'phase' | 'initial' | 'peak' | 'sustain' | 'final' | 'breakpoint' | 'leftDbPerOctave' | 'rightDbPerOctave';
export declare const LIMITS: Readonly<Record<LimitKey, readonly [number, number]>>;
export declare function bounded(value: unknown, min: number, max: number, label?: string): number;
/** Callers gate `noise` to voice version 8. */
export declare function lfoWaveform(value: unknown): LFO['waveform'];
export declare function lfoSync(value: unknown): NonNullable<LFO['sync']>;
export declare function operatorWaveform(value: unknown): OperatorWaveform;
export declare function validateVoice(input: unknown): FrozenVoice;
export declare function parseVoiceBank(source: string | readonly unknown[]): Map<string, FrozenVoice>;
