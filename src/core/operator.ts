export const TAU = 2 * Math.PI;
export function sineOperator(phase: number, modulation: number, gain: number): number {
  return Math.sin(phase + modulation) * gain;
}

// Any numerical failure is audible silence, and observable through diagnostics.
export function finiteOrSilence(value: number, diagnostics: { errors: number }): number {
  if (Number.isFinite(value)) return value;
  diagnostics.errors++;
  return 0;
}
