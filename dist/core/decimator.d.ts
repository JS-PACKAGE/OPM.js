export declare const DECIMATOR_STATE_SIZE = 8;
export declare function createDecimatorCoefficients(sampleRate: number): Float64Array;
export declare function decimateSample(input: number, state: Float64Array, coefficients: Float64Array): number;
