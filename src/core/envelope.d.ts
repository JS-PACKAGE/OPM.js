import type { ADSR } from '../voices/schema.js';
export const FLOOR_DB: -96;
export interface PreparedEnvelope extends ADSR {
  sustainDB: number; sustainGain: number; decayEnd: number; releaseEnd: number;
  releaseDB: number; releaseSpanDB: number;
}
export function prepareEnvelope(a: number, d: number, s: number, r: number, gate: number): PreparedEnvelope;
export function preparedEnvelopeAt(time: number, gate: number, envelope: PreparedEnvelope): number;
export function envelopeAt(time: number, gate: number, adsr: ADSR): number;
