import type { StereoEffectsOptions } from '../core/fx.js';
export interface EffectsEvent {
    type: 'error';
    error: Error;
}
export interface EffectsOptions {
    workletUrl?: string | URL;
    params?: StereoEffectsOptions;
    onEvent?: (event: EffectsEvent) => void;
}
export interface OpmEffects {
    readonly input: AudioNode;
    readonly output: AudioNode;
    /** Resolves once the module/node have been created; context playback is host-owned. */
    readonly ready: Promise<void>;
    update(params: StereoEffectsOptions): void;
    reset(): void;
    dispose(): void;
}
/** Optional stereo effect insert. Does not connect, resume, suspend or close the host context. */
export declare function createEffects(context: BaseAudioContext, options?: EffectsOptions): Promise<OpmEffects>;
