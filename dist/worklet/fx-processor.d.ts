import './worklet-globals.js';
import type { StereoEffectsOptions } from '../core/fx.js';
export type EffectsMessage = {
    type: 'update';
    params: Readonly<StereoEffectsOptions>;
} | {
    type: 'reset' | 'close';
};
/** Strict bounded protocol: no queued commands or unvalidated DSP parameters. */
export declare function validateEffectsMessage(raw: unknown): EffectsMessage;
export declare class EffectsProcessor extends AudioWorkletProcessor {
    private effects;
    private messages;
    private messageFrame;
    constructor(options?: AudioWorkletNodeOptions);
    receive(raw: unknown): void;
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
