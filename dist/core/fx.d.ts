export interface ChorusOptions {
    rate: number;
    depth: number;
    mix: number;
    feedback?: number;
    voices?: number;
}
export interface ReverbOptions {
    size: number;
    damping: number;
    mix: number;
    preDelay?: number;
    width?: number;
}
export interface StereoEffectsOptions {
    chorus?: ChorusOptions;
    reverb?: ReverbOptions;
    order?: 'chorus-reverb' | 'reverb-chorus';
}
export interface StereoEffects {
    process(left: Float32Array, right: Float32Array, offset?: number, length?: number): void;
    /** Replaces the complete configuration; omitted sections fade to bypass. */
    update(params: StereoEffectsOptions): void;
    reset(): void;
    readonly tailSeconds: number;
    readonly params: Readonly<StereoEffectsOptions>;
}
/** Internal trust-boundary helper, also used by the worklet protocol. */
export declare function effectsData(input: unknown, keys: readonly string[], label: string): Record<string, unknown>;
export declare function normalizeEffectsOptions(input?: StereoEffectsOptions): Readonly<StereoEffectsOptions>;
export declare function createStereoEffects(sampleRate: number, options?: StereoEffectsOptions): StereoEffects;
export declare function applyEffects(left: Float32Array, right: Float32Array, sampleRate: number, params: StereoEffectsOptions): {
    left: Float32Array;
    right: Float32Array;
};
