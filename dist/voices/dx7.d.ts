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
/** Approximate conversion of one framed 163-byte single or 4104-byte 32-voice bank. */
export function importDX7(input: Uint8Array): Voice[];
/** Validate the same input and describe conversion choices without voice-schema metadata. */
export function describeDX7(input: Uint8Array): DX7ImportDescription[];
