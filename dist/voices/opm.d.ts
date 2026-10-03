import type { Algorithm, Voice } from './schema.js';
export interface OPMImportDescription {
    name: string;
    program: number;
    algorithm: Algorithm;
    /** Source labels in destination operator order. */
    operators: readonly string[];
    warnings: string[];
}
/** Import bounded decimal VOPM/MXDRV-family text patches as approximate v7 voices. */
export declare function importOPM(source: string | Uint8Array): Voice[];
/** Report source program metadata and bounded, de-duplicated conversion losses. */
export declare function describeOPM(source: string | Uint8Array): OPMImportDescription[];
