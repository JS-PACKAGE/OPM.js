import type { Algorithm, Voice } from './schema.js';
export interface DX7ImportDescription {
    name: string;
    /** Original DX7 algorithm, 1..32. */
    sourceAlgorithm: number;
    algorithm: Algorithm;
    /** DX7 operator numbers 1..6 in converted OPM signal order. */
    selectedOperators: number[];
    droppedOperators: number[];
    warnings: string[];
}
/** Import exactly one standard DX7 single/bank dump as approximate four-op voices. */
export declare function importDX7(input: Uint8Array): Voice[];
/** Report losses separately so imported voices retain the strict normal voice shape. */
export declare function describeDX7(input: Uint8Array): DX7ImportDescription[];
