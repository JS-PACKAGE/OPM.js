export type QualityProfile = 'eco' | 'standard' | 'high';
export declare const DECIMATOR_STATE_SIZE = 8;
export declare function qualityOversample(quality: QualityProfile): number;
export declare function createDecimatorCoefficients(sampleRate: number, quality?: QualityProfile): Float64Array;
export declare function decimateSample(input: number, state: Float64Array, coefficients: Float64Array): number;
