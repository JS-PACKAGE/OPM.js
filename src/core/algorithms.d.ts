export interface AlgorithmGraph {
  readonly inputs: readonly (readonly number[])[];
  readonly carriers: readonly number[];
}
export const ALGORITHMS: readonly [AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph, AlgorithmGraph];
export function feedbackPhase(previous: number, older: number, amount: number): number;
