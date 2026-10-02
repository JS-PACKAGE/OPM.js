import type { Voice } from './schema.js';
import { originalPresets } from './original.js';

export const examples: readonly Voice[] = [
  {
    "version": 6,
    "name": "bell",
    "algorithm": 4,
    "feedback": 0,
    "modIndex": 5,
    "lfo": {
      "rate": 0,
      "amDepth": 0,
      "pmDepth": 0,
      "waveform": "sine"
    },
    "ops": [
      {
        "ratio": 3.5,
        "level": 0.7,
        "detune": 0,
        "adsr": {
          "a": 0.002,
          "d": 1.2,
          "s": 0,
          "r": 1.0
        }
      },
      {
        "ratio": 1,
        "level": 0.8,
        "detune": 0,
        "adsr": {
          "a": 0.002,
          "d": 1.8,
          "s": 0.05,
          "r": 1.2
        }
      },
      {
        "ratio": 7,
        "level": 0.4,
        "detune": 2,
        "adsr": {
          "a": 0.002,
          "d": 0.6,
          "s": 0,
          "r": 0.8
        }
      },
      {
        "ratio": 2,
        "level": 0.5,
        "detune": 0,
        "adsr": {
          "a": 0.002,
          "d": 1.2,
          "s": 0.03,
          "r": 1
        }
      }
    ]
  },
  {
    "version": 6,
    "name": "brass",
    "algorithm": 2,
    "feedback": 4,
    "modIndex": 4,
    "lfo": {
      "rate": 0,
      "amDepth": 0,
      "pmDepth": 0,
      "waveform": "sine"
    },
    "ops": [
      {
        "ratio": 1,
        "level": 0.8,
        "detune": 0,
        "adsr": {
          "a": 0.03,
          "d": 0.2,
          "s": 0.6,
          "r": 0.2
        }
      },
      {
        "ratio": 1,
        "level": 0.5,
        "detune": 3,
        "adsr": {
          "a": 0.02,
          "d": 0.2,
          "s": 0.4,
          "r": 0.2
        }
      },
      {
        "ratio": 2,
        "level": 0.4,
        "detune": -3,
        "adsr": {
          "a": 0.04,
          "d": 0.3,
          "s": 0.4,
          "r": 0.2
        }
      },
      {
        "ratio": 1,
        "level": 0.9,
        "detune": 0,
        "adsr": {
          "a": 0.03,
          "d": 0.2,
          "s": 0.7,
          "r": 0.25
        }
      }
    ]
  },
  {
    "version": 6,
    "name": "bass",
    "algorithm": 0,
    "feedback": 3,
    "modIndex": 3,
    "lfo": {
      "rate": 0,
      "amDepth": 0,
      "pmDepth": 0,
      "waveform": "sine"
    },
    "ops": [
      {
        "ratio": 1,
        "level": 0.5,
        "detune": 0,
        "adsr": {
          "a": 0.002,
          "d": 0.08,
          "s": 0.15,
          "r": 0.08
        }
      },
      {
        "ratio": 2,
        "level": 0.4,
        "detune": 0,
        "adsr": {
          "a": 0.003,
          "d": 0.1,
          "s": 0.2,
          "r": 0.08
        }
      },
      {
        "ratio": 1,
        "level": 0.65,
        "detune": 0,
        "adsr": {
          "a": 0.003,
          "d": 0.15,
          "s": 0.3,
          "r": 0.08
        }
      },
      {
        "ratio": 1,
        "level": 0.9,
        "detune": 0,
        "adsr": {
          "a": 0.005,
          "d": 0.2,
          "s": 0.5,
          "r": 0.12
        }
      }
    ]
  },
  {
    "version": 6, "name": "electric_piano", "algorithm": 4, "feedback": 1, "modIndex": 4,
    "lfo": { "rate": 3.5, "amDepth": 0.1, "pmDepth": 0, "waveform": "sine" },
    "ops": [
      { "ratio": 1, "level": 0.7, "detune": 0, "adsr": { "a": 0.002, "d": 1.2, "s": 0, "r": 0.2 },
        "keyScale": { "breakpoint": 60, "leftDbPerOctave": 0, "rightDbPerOctave": 6 } },
      { "ratio": 1, "level": 0.8, "detune": 0, "adsr": { "a": 0.003, "d": 2, "s": 0.08, "r": 0.3 } },
      { "ratio": 14, "level": 0.25, "detune": 3, "adsr": { "a": 0.001, "d": 0.25, "s": 0, "r": 0.1 },
        "keyScale": { "breakpoint": 60, "leftDbPerOctave": 0, "rightDbPerOctave": 9 } },
      { "ratio": 1, "level": 0.6, "detune": -2, "adsr": { "a": 0.003, "d": 1.5, "s": 0.05, "r": 0.3 } }
    ]
  },
  {
    "version": 6, "name": "organ", "algorithm": 7, "feedback": 0, "modIndex": 0,
    "lfo": { "rate": 5, "amDepth": 0.08, "pmDepth": 3, "waveform": "sine" },
    "ops": [
      { "ratio": 0.5, "level": 0.8, "detune": 0, "adsr": { "a": 0.008, "d": 0, "s": 1, "r": 0.08 } },
      { "ratio": 1, "level": 0.9, "detune": 0, "adsr": { "a": 0.008, "d": 0, "s": 1, "r": 0.08 } },
      { "ratio": 2, "level": 0.5, "detune": 0, "adsr": { "a": 0.008, "d": 0, "s": 1, "r": 0.08 } },
      { "ratio": 3, "level": 0.3, "detune": 0, "adsr": { "a": 0.008, "d": 0, "s": 1, "r": 0.08 } }
    ]
  },
  {
    "version": 6, "name": "lead", "algorithm": 0, "feedback": 5, "modIndex": 3,
    "lfo": { "rate": 5.5, "amDepth": 0, "pmDepth": 15, "waveform": "sine" },
    "ops": [
      { "ratio": 1, "level": 0.6, "detune": 0, "adsr": { "a": 0.01, "d": 0.1, "s": 0.6, "r": 0.1 } },
      { "ratio": 2, "level": 0.4, "detune": 0, "adsr": { "a": 0.01, "d": 0.15, "s": 0.5, "r": 0.1 } },
      { "ratio": 1, "level": 0.5, "detune": 0, "adsr": { "a": 0.01, "d": 0.15, "s": 0.7, "r": 0.1 },
        "keyScale": { "breakpoint": 60, "leftDbPerOctave": 0, "rightDbPerOctave": 6 } },
      { "ratio": 1, "level": 0.9, "detune": 0, "adsr": { "a": 0.01, "d": 0.1, "s": 0.8, "r": 0.15 } }
    ]
  },
  {
    "version": 6, "name": "strings", "algorithm": 4, "feedback": 2, "modIndex": 2.5,
    "lfo": { "rate": 4.8, "amDepth": 0.08, "pmDepth": 9, "waveform": "sine" },
    "ops": [
      { "ratio": 1, "level": 0.45, "detune": -5, "adsr": { "a": 0.2, "d": 0.4, "s": 0.6, "r": 0.5 } },
      { "ratio": 1, "level": 0.8, "detune": -5, "adsr": { "a": 0.3, "d": 0.4, "s": 0.8, "r": 0.6 } },
      { "ratio": 2, "level": 0.35, "detune": 5, "adsr": { "a": 0.2, "d": 0.4, "s": 0.6, "r": 0.5 } },
      { "ratio": 1, "level": 0.8, "detune": 5, "adsr": { "a": 0.3, "d": 0.4, "s": 0.8, "r": 0.6 } }
    ]
  },
  ...originalPresets,
];
