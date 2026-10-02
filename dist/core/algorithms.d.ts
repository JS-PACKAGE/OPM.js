export interface AlgorithmGraph {
    readonly inputs: readonly (readonly number[])[];
    readonly carriers: readonly number[];
}
export declare const ALGORITHMS: readonly [AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph];
export declare function feedbackPhase(previous: number, older: number, amount: number): number;
