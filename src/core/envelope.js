export const FLOOR_DB = -96;
const amplitude = db => 10 ** (db / 20);

// Linear movement in dB gives exponential amplitude: gain = 10^(dB/20).
// The -96 dB floor becomes exact zero at note-on and at release completion.
export function envelopeAt(time, gate, adsr) {
  if (!Number.isFinite(time) || !Number.isFinite(gate) || time < 0 || gate < 0) return 0;
  const { a, d, s, r } = adsr;
  if (![a, d, s, r].every(Number.isFinite) || a < 0 || d < 0 || r < 0 || s < 0 || s > 1) return 0;
  const sustainDB = s === 0 ? FLOOR_DB : Math.max(FLOOR_DB, 20 * Math.log10(s));
  function heldDB(t) {
    if (a > 0 && t < a) return FLOOR_DB * (1 - t / a);
    if (d > 0 && t < a + d) return sustainDB * ((t - a) / d);
    return sustainDB;
  }
  if (time >= gate) {
    if (r === 0 || time >= gate + r || gate === 0 || s === 0 && gate >= a + d) return 0;
    const start = heldDB(gate);
    return amplitude(start + (FLOOR_DB - start) * ((time - gate) / r));
  }
  if (time === 0 && a > 0 || s === 0 && time >= a + d) return 0;
  return amplitude(heldDB(time));
}
