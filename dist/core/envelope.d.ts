import type { ADSR } from '../voices/schema.js';
export interface PreparedEnvelope extends ADSR {
    sustainDB: number;
    sustainGain: number;
    decayEnd: number;
    releaseEnd: number;
    releaseDB: number;
    releaseSpanDB: number;
}
export declare const FLOOR_DB = -96;
export declare function prepareEnvelope(a: number, d: number, s: number, r: number, gate: number): PreparedEnvelope;
export declare function preparedEnvelopeAt(time: number, gate: number, envelope: PreparedEnvelope): number;
export declare function envelopeAt(time: number, gate: number, adsr: ADSR): number;
