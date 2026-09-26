export const TAU = 2 * Math.PI;
export function sineOperator(phase, modulation, gain) {
  return Math.sin(phase + modulation) * gain;
}

// Any numerical failure is audible silence, and observable through diagnostics.
export function finiteOrSilence(value, diagnostics) {
  if (Number.isFinite(value)) return value;
  diagnostics.errors++;
  return 0;
}
