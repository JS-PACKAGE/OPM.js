import type { Voice } from './schema.js';

// Original four-operator recipes; operator levels shape timbre, never host loudness matching.
export const originalPresets: readonly Voice[] = [
  {
    version: 6, name: 'wood_mallet', algorithm: 4, feedback: 0, modIndex: 2.1,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: [
      { ratio: 3, level: 0.42, detune: 0, rateKeyScale: 0.7, velocitySensitivity: 12, adsr: { a: 0.001, d: 0.12, s: 0, r: 0.08 } },
      { ratio: 1, level: 0.82, detune: 0, rateKeyScale: 0.5, adsr: { a: 0.002, d: 0.7, s: 0, r: 0.2 } },
      { ratio: 5, level: 0.18, detune: 0, velocitySensitivity: 18, adsr: { a: 0.001, d: 0.055, s: 0, r: 0.06 } },
      { ratio: 2, level: 0.28, detune: 0, rateKeyScale: 0.5, adsr: { a: 0.002, d: 0.35, s: 0, r: 0.15 } },
    ],
  },
  {
    version: 6, name: 'glass_pluck', algorithm: 4, feedback: 0, modIndex: 2.8,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: [
      { ratio: 2, level: 0.56, detune: 0, velocitySensitivity: 15, rateKeyScale: 0.6, adsr: { a: 0.001, d: 0.18, s: 0, r: 0.1 } },
      { ratio: 1, level: 0.72, detune: 0, adsr: { a: 0.002, d: 0.9, s: 0, r: 0.25 } },
      { ratio: 6.3, level: 0.22, detune: 0, velocitySensitivity: 20, adsr: { a: 0.001, d: 0.07, s: 0, r: 0.08 } },
      { ratio: 2, level: 0.34, detune: 3, adsr: { a: 0.002, d: 0.55, s: 0, r: 0.2 } },
    ],
  },
  {
    version: 6, name: 'hollow_reed', algorithm: 4, feedback: 1, modIndex: 1.6,
    lfo: { rate: 5.1, amDepth: 0.025, pmDepth: 7, waveform: 'sine', delay: 0.3, sync: 'note', phase: 0 },
    ops: [
      { ratio: 2, level: 0.5, detune: 0, velocitySensitivity: 10, adsr: { a: 0.035, d: 0.15, s: 0.68, r: 0.12 } },
      { ratio: 1, level: 0.8, detune: 0, adsr: { a: 0.045, d: 0.15, s: 0.88, r: 0.18 } },
      { ratio: 2, level: 0.18, detune: 0, adsr: { a: 0.06, d: 0.2, s: 0.6, r: 0.15 } },
      { ratio: 3, level: 0.22, detune: -2, adsr: { a: 0.05, d: 0.2, s: 0.75, r: 0.18 } },
    ],
  },
  {
    version: 6, name: 'slow_air_pad', algorithm: 4, feedback: 0, modIndex: 1.2,
    lfo: { rate: 0.7, amDepth: 0.08, pmDepth: 5, waveform: 'triangle', delay: 0.4, sync: 'global', phase: 0.25 },
    pitchEnvelope: { a: 0.5, d: 0.5, r: 0.5, initial: -14, peak: 3, sustain: 0, final: -8 },
    ops: [
      { ratio: 1, level: 0.26, detune: -4, adsr: { a: 0.5, d: 0.5, s: 0.55, r: 0.7 } },
      { ratio: 1, level: 0.68, detune: -4, adsr: { a: 0.6, d: 0.5, s: 0.85, r: 0.8 } },
      { ratio: 2, level: 0.22, detune: 4, adsr: { a: 0.65, d: 0.5, s: 0.6, r: 0.8 } },
      { ratio: 1, level: 0.65, detune: 4, adsr: { a: 0.7, d: 0.5, s: 0.8, r: 0.9 } },
    ],
  },
  {
    version: 6, name: 'bronze_plate', algorithm: 4, feedback: 2, modIndex: 3.2,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: [
      { ratio: 2.73, level: 0.56, detune: 0, velocitySensitivity: 10, adsr: { a: 0.001, d: 0.3, s: 0, r: 0.2 } },
      { ratio: 1, level: 0.7, detune: 0, adsr: { a: 0.002, d: 1.6, s: 0, r: 0.5 } },
      { ratio: 5.19, level: 0.38, detune: 0, velocitySensitivity: 14, adsr: { a: 0.001, d: 0.12, s: 0, r: 0.15 } },
      { ratio: 1.41, level: 0.5, detune: 0, adsr: { a: 0.002, d: 1.1, s: 0, r: 0.4 } },
    ],
  },
  {
    version: 6, name: 'membrane_tom', algorithm: 4, feedback: 0, modIndex: 1.3,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    pitchEnvelope: { a: 0.001, d: 0.07, r: 0.06, initial: 650, peak: 350, sustain: 0, final: -60 },
    ops: [
      { ratio: 1.48, level: 0.45, detune: 0, velocitySensitivity: 12, adsr: { a: 0.001, d: 0.06, s: 0, r: 0.04 } },
      { ratio: 1, level: 0.88, detune: 0, rateKeyScale: 0.4, adsr: { a: 0.001, d: 0.24, s: 0, r: 0.1 } },
      { ratio: 3.17, level: 0.25, detune: 0, velocitySensitivity: 20, adsr: { a: 0.001, d: 0.025, s: 0, r: 0.03 } },
      { ratio: 1.59, level: 0.3, detune: 0, adsr: { a: 0.001, d: 0.12, s: 0, r: 0.08 } },
    ],
  },
  {
    version: 6, name: 'fixed_hz_chime', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: [
      { ratio: 1, frequency: 317, level: 0.72, detune: 0, adsr: { a: 0.003, d: 1.8, s: 0, r: 0.6 } },
      { ratio: 1, frequency: 523, level: 0.48, detune: 0, adsr: { a: 0.002, d: 1.4, s: 0, r: 0.5 } },
      { ratio: 1, frequency: 829, level: 0.32, detune: 0, adsr: { a: 0.002, d: 0.9, s: 0, r: 0.4 } },
      { ratio: 1, frequency: 1237, level: 0.2, detune: 0, adsr: { a: 0.001, d: 0.5, s: 0, r: 0.3 } },
    ],
  },
  {
    version: 6, name: 'wire_kalimba', algorithm: 4, feedback: 1, modIndex: 1.9,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: [
      { ratio: 4, level: 0.42, detune: 0, rateKeyScale: 0.7, velocitySensitivity: 15, adsr: { a: 0.001, d: 0.09, s: 0, r: 0.06 } },
      { ratio: 1, level: 0.8, detune: 0, rateKeyScale: 0.4, adsr: { a: 0.002, d: 0.85, s: 0, r: 0.25 } },
      { ratio: 1, frequency: 1723, level: 0.16, detune: 0, velocitySensitivity: 18, adsr: { a: 0.001, d: 0.045, s: 0, r: 0.05 } },
      { ratio: 2, level: 0.3, detune: -3, adsr: { a: 0.002, d: 0.4, s: 0, r: 0.15 } },
    ],
  },
  {
    version: 6, name: 'tide_keys', algorithm: 4, feedback: 1, modIndex: 1.8,
    lfo: { rate: 3.2, amDepth: 0.22, pmDepth: 9, waveform: 'sine', delay: 0.12, sync: 'note',
      amTargets: [0, 0, 0, 1], pmTargets: [1, 0, 0.35, 0] },
    ops: [
      { ratio: 2, level: 0.38, detune: 0, velocitySensitivity: 16, rateKeyScale: 0.5, adsr: { a: 0.003, d: 0.25, s: 0.12, r: 0.18 } },
      { ratio: 1, level: 0.76, detune: 0, adsr: { a: 0.006, d: 1.1, s: 0.18, r: 0.28 } },
      { ratio: 4, level: 0.19, detune: 0, velocitySensitivity: 20, keyScale: { breakpoint: 60, leftDbPerOctave: 0, rightDbPerOctave: 6 }, adsr: { a: 0.002, d: 0.16, s: 0.06, r: 0.12 } },
      { ratio: 2, level: 0.3, detune: 2, adsr: { a: 0.009, d: 0.8, s: 0.2, r: 0.3 } },
    ],
  },
  {
    version: 6, name: 'ember_bass', algorithm: 4, feedback: 2, modIndex: 1.5,
    lfo: { rate: 1.4, amDepth: 0.16, pmDepth: 14, waveform: 'triangle', delay: 0.08, sync: 'note',
      amTargets: [0.75, 0, 0.4, 0], pmTargets: [0, 0, 1, 0] },
    ops: [
      { ratio: 1, level: 0.34, detune: 0, velocitySensitivity: 14, adsr: { a: 0.004, d: 0.18, s: 0.25, r: 0.09 } },
      { ratio: 1, level: 0.86, detune: 0, adsr: { a: 0.008, d: 0.25, s: 0.68, r: 0.12 } },
      { ratio: 3, level: 0.24, detune: 0, velocitySensitivity: 20, adsr: { a: 0.003, d: 0.12, s: 0.15, r: 0.08 } },
      { ratio: 0.5, level: 0.32, detune: 0, adsr: { a: 0.012, d: 0.3, s: 0.6, r: 0.14 } },
    ],
  },
  {
    version: 6, name: 'orbit_pad', algorithm: 4, feedback: 0, modIndex: 1.1,
    lfo: { rate: 0.55, amDepth: 0.35, pmDepth: 12, waveform: 'sine', delay: 0.2, sync: 'global', phase: 0.25,
      amTargets: [0, 0.15, 1, 0.5], pmTargets: [1, 0, 0.7, 0] },
    ops: [
      { ratio: 1, level: 0.28, detune: -3, velocitySensitivity: 8, adsr: { a: 0.24, d: 0.5, s: 0.55, r: 0.6 } },
      { ratio: 1, level: 0.66, detune: -3, adsr: { a: 0.32, d: 0.6, s: 0.8, r: 0.7 } },
      { ratio: 3, level: 0.22, detune: 3, velocitySensitivity: 12, keyScale: { breakpoint: 60, leftDbPerOctave: 0, rightDbPerOctave: 6 }, adsr: { a: 0.38, d: 0.6, s: 0.6, r: 0.7 } },
      { ratio: 1, level: 0.58, detune: 3, adsr: { a: 0.42, d: 0.7, s: 0.75, r: 0.8 } },
    ],
  },
];
