import type { ADSR } from '../voices/schema.js';

export interface PreparedEnvelope extends ADSR {
  sustainDB: number; sustainGain: number; decayEnd: number; releaseEnd: number;
  releaseDB: number; releaseSpanDB: number;
}

export const FLOOR_DB = -96;
const amplitude = (db: number): number => 10 ** (db / 20);

// After decay, a sustain rate `sr` lowers the held level by 96 dB per `sr` seconds.
function heldDB(time: number, a: number, d: number, sustainDB: number, decayEnd: number, sr: number): number {
  if (a > 0 && time < a) return FLOOR_DB * (1 - time / a);
  if (d > 0 && time < decayEnd) return sustainDB * ((time - a) / d);
  if (sr > 0 && time > decayEnd) return Math.max(FLOOR_DB, sustainDB + FLOOR_DB * ((time - decayEnd) / sr));
  return sustainDB;
}

// The offline renderer prepares this once per validated operator, not per subsample.
// `sr` omitted (or 0) holds the sustain level until release.
export function prepareEnvelope(a: number, d: number, s: number, r: number, gate: number, sr = 0): PreparedEnvelope {
  const sustainDB = s === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(s));
  const decayEnd = a + d;
  const releaseDB = heldDB(gate, a, d, sustainDB, decayEnd, sr);
  const envelope: PreparedEnvelope = { a, d, s, r, sustainDB, sustainGain: s === 0 ? 0 : amplitude(sustainDB), decayEnd, releaseEnd: gate + r,
    releaseDB, releaseSpanDB: FLOOR_DB - releaseDB };
  if (sr > 0) envelope.sr = sr;
  return envelope;
}

export function preparedEnvelopeAt(time: number, gate: number, envelope: PreparedEnvelope): number {
  const { a, d, s, r, sustainDB, decayEnd, releaseEnd, releaseDB, releaseSpanDB } = envelope;
  const sr = envelope.sr ?? 0;
  if (time >= gate) {
    if (r === 0 || time >= releaseEnd || gate === 0 || s === 0 && gate >= decayEnd || sr > 0 && releaseDB <= FLOOR_DB) return 0;
    return amplitude(releaseDB + releaseSpanDB * ((time - gate) / r));
  }
  if (time === 0 && a > 0 || s === 0 && time >= decayEnd) return 0;
  if (time >= decayEnd && sr === 0) return envelope.sustainGain;
  const db = heldDB(time, a, d, sustainDB, decayEnd, sr);
  return sr > 0 && db <= FLOOR_DB ? 0 : amplitude(db);
}

// Linear movement in dB gives exponential amplitude: gain = 10^(dB/20).
// The -96 dB floor becomes exact zero at note-on and at release completion.
export function envelopeAt(time: number, gate: number, adsr: ADSR): number {
  if (!Number.isFinite(time) || !Number.isFinite(gate) || time < 0 || gate < 0) return 0;
  const { a, d, s, r } = adsr;
  const sr = adsr.sr ?? 0;
  if (!Number.isFinite(a) || !Number.isFinite(d) || !Number.isFinite(s) || !Number.isFinite(r) || !Number.isFinite(sr) ||
      a < 0 || d < 0 || r < 0 || s < 0 || s > 1 || sr < 0) return 0;
  return preparedEnvelopeAt(time, gate, prepareEnvelope(a, d, s, r, gate, sr));
}
