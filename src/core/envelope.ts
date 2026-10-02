import type { ADSR } from '../voices/schema.js';

export interface PreparedEnvelope extends ADSR {
  sustainDB: number; sustainGain: number; decayEnd: number; releaseEnd: number;
  releaseDB: number; releaseSpanDB: number;
}

export const FLOOR_DB = -96;
const amplitude = (db: number): number => 10 ** (db / 20);

function heldDB(time: number, a: number, d: number, sustainDB: number, decayEnd: number): number {
  if (a > 0 && time < a) return FLOOR_DB * (1 - time / a);
  if (d > 0 && time < decayEnd) return sustainDB * ((time - a) / d);
  return sustainDB;
}

// The offline renderer prepares this once per validated operator, not per subsample.
export function prepareEnvelope(a: number, d: number, s: number, r: number, gate: number): PreparedEnvelope {
  const sustainDB = s === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(s));
  const decayEnd = a + d;
  const releaseDB = heldDB(gate, a, d, sustainDB, decayEnd);
  return { a, d, s, r, sustainDB, sustainGain: s === 0 ? 0 : amplitude(sustainDB), decayEnd, releaseEnd: gate + r,
    releaseDB, releaseSpanDB: FLOOR_DB - releaseDB };
}

export function preparedEnvelopeAt(time: number, gate: number, envelope: PreparedEnvelope): number {
  const { a, d, s, r, sustainDB, decayEnd, releaseEnd, releaseDB, releaseSpanDB } = envelope;
  if (time >= gate) {
    if (r === 0 || time >= releaseEnd || gate === 0 || s === 0 && gate >= decayEnd) return 0;
    return amplitude(releaseDB + releaseSpanDB * ((time - gate) / r));
  }
  if (time === 0 && a > 0 || s === 0 && time >= decayEnd) return 0;
  if (time >= decayEnd) return envelope.sustainGain;
  return amplitude(heldDB(time, a, d, sustainDB, decayEnd));
}

// Linear movement in dB gives exponential amplitude: gain = 10^(dB/20).
// The -96 dB floor becomes exact zero at note-on and at release completion.
export function envelopeAt(time: number, gate: number, adsr: ADSR): number {
  if (!Number.isFinite(time) || !Number.isFinite(gate) || time < 0 || gate < 0) return 0;
  const { a, d, s, r } = adsr;
  if (!Number.isFinite(a) || !Number.isFinite(d) || !Number.isFinite(s) || !Number.isFinite(r) ||
      a < 0 || d < 0 || r < 0 || s < 0 || s > 1) return 0;
  return preparedEnvelopeAt(time, gate, prepareEnvelope(a, d, s, r, gate));
}
