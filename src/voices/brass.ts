import type { Voice } from './schema.js';

export const brass: Voice = {
  version: 3,
  name: 'brass',
  algorithm: 4,
  feedback: 3,
  modIndex: 4,
  lfo: { rate: 5.2, amDepth: 0, pmDepth: 12 },
  ops: [
    { ratio: 1, level: 0.8, detune: 0, adsr: { a: 0.01, d: 0.2, s: 0.6, r: 0.1 } },
    { ratio: 1, level: 0.6, detune: 3, adsr: { a: 0.01, d: 0.15, s: 0.5, r: 0.1 } },
    { ratio: 2, level: 0.4, detune: -3, adsr: { a: 0.02, d: 0.3, s: 0.4, r: 0.15 } },
    { ratio: 1, level: 0.7, detune: 0, adsr: { a: 0.01, d: 0.2, s: 0.55, r: 0.1 } },
  ],
};
