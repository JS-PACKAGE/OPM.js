export type QualityProfile = 'eco' | 'standard' | 'high';
/** Index of the state slot holding the last decimated sample. */
export declare const DECIMATOR_OUTPUT = 3;
export declare const DECIMATOR_STATE_SIZE: number;
export declare function qualityOversample(quality: QualityProfile): number;
export declare function createDecimatorCoefficients(sampleRate: number, quality?: QualityProfile): Float64Array;
export declare function decimateFrame(inputs: Float64Array, state: Float64Array, coefficients: Float64Array): void;
/** Largest buffered sample magnitude, excluding ring positions and the derived
 * DECIMATOR_OUTPUT slot (a function of the history, overwritten every frame). */
export declare function decimatorPeak(state: Float64Array): number;
