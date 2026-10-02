import { normalizeVoice } from './normalize.js';
import { ALGORITHMS } from '../core/algorithms.js';
import type { Algorithm, LFO, Operator, Voice } from './schema.js';

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


// Clean-room format references (protocol tables, not emulator implementations):
// https://data.yamaha.com/files/download/other_assets/9/333979/DX7E1.pdf pp. 13–17, 30–31
// https://data.yamaha.com/files/download/other_assets/7/320817/DX7IIE.PDF Add-11 (VMEM)
// Routing concepts: Yamaha PLG150-DX manual pp. 34–35, compatible DX7 algorithm chart:
// https://data.yamaha.com/files/download/brochure/6/317206/PLG150DX_catalogue.pdf
// Each decimal pair is source→target, using Yamaha operator numbers 1..6.
const DX7_EDGES = [
  [21, 43, 54, 65], [21, 43, 54, 65], [21, 32, 54, 65], [21, 32, 54, 65],
  [21, 43, 65], [21, 43, 65], [21, 43, 53, 65], [21, 43, 53, 65], [21, 43, 53, 65],
  [21, 32, 54, 64], [21, 32, 54, 64], [21, 43, 53, 63], [21, 43, 53, 63],
  [21, 43, 54, 64], [21, 43, 54, 64], [21, 31, 43, 51, 65], [21, 31, 43, 51, 65],
  [21, 31, 41, 54, 65], [21, 32, 64, 65], [31, 32, 54, 64], [31, 32, 64, 65],
  [21, 63, 64, 65], [32, 64, 65], [63, 64, 65], [64, 65], [32, 54, 64],
  [32, 54, 64], [21, 43, 54], [43, 65], [43, 54], [65], [],
];
const OP_MAX = [99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 3, 3, 7, 3, 7, 99, 1, 31, 99, 14];
const GLOBAL_MAX = [99, 99, 99, 99, 99, 99, 99, 99, 31, 7, 1, 99, 99, 99, 99, 1, 5, 7, 48];
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get! as (this: unknown) => number;
const typedArrayKind = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get! as (this: unknown) => string | undefined;

function parse(input: unknown): { data: Uint8Array; name: string }[] {
  // Intrinsic getters reject proxies, wrong element types, and spoofed length properties.
  if (typedArrayKind.call(input) !== 'Uint8Array') throw new TypeError('DX7 input must be a Uint8Array');
  const length = typedArrayLength.call(input);
  if (length !== 163 && length !== 4104) throw new RangeError('DX7 input must be one 163-byte single or 4104-byte bank');
  const bytes = new Uint8Array(length);
  Uint8Array.prototype.set.call(bytes, input as Uint8Array);
  if (bytes[0] !== 0xf0 || bytes[length - 1] !== 0xf7 || bytes[1] !== 0x43 || bytes[2] > 15) {
    throw new TypeError('Invalid Yamaha DX7 SysEx framing');
  }
  for (let i = 2; i < length - 1; i++) {
    if (bytes[i] > 127) throw new RangeError('DX7 SysEx data must be 7-bit');
  }
  const bank = bytes[3] === 9;
  const payloadLength = bank ? 4096 : 155;
  if ((!bank && bytes[3] !== 0) || length !== payloadLength + 8 ||
      bytes[4] * 128 + bytes[5] !== payloadLength) {
    throw new RangeError('Invalid DX7 format or byte count');
  }
  let sum = bytes[length - 2];
  for (let i = 6; i < length - 2; i++) sum += bytes[i];
  if ((sum & 127) !== 0) throw new RangeError('Invalid DX7 checksum');
  const patches: { data: Uint8Array; name: string }[] = [];
  const names = new Set<string>();
  for (let i = 0; i < (bank ? 32 : 1); i++) {
    const data = bank ? unpack(bytes, 6 + i * 128) : bytes.subarray(6, 161);
    validateParameters(data);
    let rawName = '';
    for (let n = 145; n < 155; n++) rawName += String.fromCharCode(data[n]);
    const base = rawName.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'DX7';
    let name = base;
    for (let suffix = 2; names.has(name); suffix++) name = `${base}_${suffix}`;
    names.add(name);
    patches.push({ data, name });
  }
  return patches;
}

function unpack(bytes: Uint8Array, start: number): Uint8Array {
  const data = new Uint8Array(155);
  for (let slot = 0; slot < 6; slot++) {
    const source = start + slot * 17;
    const target = slot * 21;
    for (let n = 0; n < 11; n++) data[target + n] = bytes[source + n];
    if (bytes[source + 11] > 15 || bytes[source + 13] > 31 || bytes[source + 15] > 63) {
      throw new RangeError('Invalid DX7 reserved operator bits');
    }
    data[target + 11] = bytes[source + 11] & 3;
    data[target + 12] = (bytes[source + 11] >> 2) & 3;
    data[target + 13] = bytes[source + 12] & 7;
    data[target + 20] = bytes[source + 12] >> 3;
    data[target + 14] = bytes[source + 13] & 3;
    data[target + 15] = bytes[source + 13] >> 2;
    data[target + 16] = bytes[source + 14];
    data[target + 17] = bytes[source + 15] & 1;
    data[target + 18] = bytes[source + 15] >> 1;
    data[target + 19] = bytes[source + 16];
  }
  for (let n = 0; n < 8; n++) data[126 + n] = bytes[start + 102 + n];
  if (bytes[start + 111] > 15) throw new RangeError('Invalid DX7 reserved voice bits');
  data[134] = bytes[start + 110];
  data[135] = bytes[start + 111] & 7;
  data[136] = bytes[start + 111] >> 3;
  for (let n = 0; n < 4; n++) data[137 + n] = bytes[start + 112 + n];
  data[141] = bytes[start + 116] & 1;
  data[142] = (bytes[start + 116] >> 1) & 7;
  data[143] = bytes[start + 116] >> 4;
  data[144] = bytes[start + 117];
  for (let n = 0; n < 10; n++) data[145 + n] = bytes[start + 118 + n];
  return data;
}

function validateParameters(data: Uint8Array): void {
  for (let slot = 0; slot < 6; slot++) {
    for (let n = 0; n < 21; n++) {
      if (data[slot * 21 + n] > OP_MAX[n]) throw new RangeError('DX7 operator parameter out of range');
    }
  }
  for (let n = 0; n < 19; n++) {
    if (data[126 + n] > GLOBAL_MAX[n]) throw new RangeError('DX7 voice parameter out of range');
  }
}

const operatorOffset = (number: number): number => (6 - number) * 21;
const clampRatio = (ratio: number): number => Math.max(0.125, Math.min(32, ratio));
const amplitude = (level: number): number => level === 0 ? 0 : 10 ** ((level - 99) * 0.75 / 20);
// Musical heuristics, not Yamaha's envelope-rate or output-level transfer curves.
const seconds = (rate: number): number => Math.min(10, 10 * 2 ** (-rate / 10));
const DX7_LFO_WAVES: readonly LFO['waveform'][] = ['triangle', 'saw', 'saw', 'square', 'sine', 'sine'];
// The manual specifies levels 0/50/99 as -4/0/+4 octaves; intermediate
// linear cents and seconds below are explicit musical approximations.
const pitchCents = (level: number): number => (level - 50) * 4800 / (level < 50 ? 50 : 49);

function selection(data: Uint8Array): { algorithm: Algorithm; selected: number[] } {
  const edges = DX7_EDGES[data[134]];
  const carriers = [1, 2, 3, 4, 5, 6].filter(number => !edges.some(edge => Math.floor(edge / 10) === number));
  const loudness = (number: number): number => {
    const at = operatorOffset(number);
    return amplitude(data[at + 16]) * amplitude(Math.max(data[at + 4], data[at + 5], data[at + 6]));
  };
  carriers.sort((a, b) => loudness(b) - loudness(a) || a - b);
  const selected = carriers.slice(0, 4);
  if (selected.length === 4) return { algorithm: 7, selected };
  // Preserve carriers first, then their nearest ancestors, loudest first at each depth.
  const distance = new Array<number>(7).fill(Infinity);
  for (const number of selected) distance[number] = 0;
  for (let pass = 0; pass < 6; pass++) {
    for (const edge of edges) {
      const source = Math.floor(edge / 10);
      distance[source] = Math.min(distance[source], distance[edge % 10] + 1);
    }
  }
  const modulators = [1, 2, 3, 4, 5, 6].filter(number => !carriers.includes(number));
  modulators.sort((a, b) => distance[a] - distance[b] || loudness(b) - loudness(a) || a - b);
  selected.push(...modulators.slice(0, 4 - selected.length));
  // Search all 24 orders and eight OPM topologies. Carrier identity is mandatory;
  // minimize inserted/deleted retained edges, with deterministic iteration ties.
  let bestScore = Infinity;
  let bestAlgorithm: Algorithm = 7;
  let bestOrder: number[] | undefined;
  for (const a of selected) for (const b of selected) {
    if (b === a) continue;
    for (const c of selected) {
      if (c === a || c === b) continue;
      const d = selected.find(number => number !== a && number !== b && number !== c)!;
      const order = [a, b, c, d];
      for (let algorithm = 0; algorithm < ALGORITHMS.length; algorithm++) {
        const graph = ALGORITHMS[algorithm];
        if (order.some((number, index) => graph.carriers.includes(index) !== carriers.includes(number))) continue;
        let score = 0;
        for (let source = 0; source < 4; source++) for (let target = 0; target < 4; target++) {
          const original = edges.includes(order[source] * 10 + order[target]);
          const converted = graph.inputs[target].includes(source);
          if (original !== converted) score++;
        }
        if (score < bestScore) {
          bestScore = score;
          bestAlgorithm = algorithm as Algorithm;
          bestOrder = order;
        }
      }
    }
  }
  return { algorithm: bestAlgorithm, selected: bestOrder! };
}

function convertOperator(data: Uint8Array, number: number): Operator {
  const at = operatorOffset(number);
  const coarse = data[at + 18];
  const fine = data[at + 19];
  const fixed = data[at + 17] === 1;
  const ratio = (coarse === 0 ? 0.5 : coarse) * (1 + fine / 100);
  const peak = Math.max(data[at + 4], data[at + 5], data[at + 6]);
  const peakAmplitude = amplitude(peak);
  const operator: Operator = {
    ratio: fixed ? 1 : clampRatio(ratio),
    level: amplitude(data[at + 16]) * peakAmplitude,
    detune: (data[at + 20] - 7) * 3,
    // Linear dB response is a musical approximation, not Yamaha's transfer curve.
    velocitySensitivity: data[at + 15] / 7 * 48,
    rateKeyScale: data[at + 13] / 7 * 4,
    adsr: {
      a: seconds(data[at]),
      d: Math.min(10, seconds(data[at + 1]) + seconds(data[at + 2])),
      s: peakAmplitude === 0 ? 0 : amplitude(data[at + 6]) / peakAmplitude,
      r: seconds(data[at + 3]),
    },
    keyScale: {
      breakpoint: data[at + 8] + 21,
      // Negative curves become linear dB attenuation; positive curves cannot boost.
      leftDbPerOctave: data[at + 11] < 2 ? data[at + 9] / 99 * 24 : 0,
      rightDbPerOctave: data[at + 12] < 2 ? data[at + 10] / 99 * 24 : 0,
    },
  };
  if (fixed) operator.frequency = 10 ** ((coarse & 3) + fine / 100);
  return operator;
}

/** Import exactly one standard DX7 single/bank dump as approximate four-op voices. */
export function importDX7(input: Uint8Array): Voice[] {
  return parse(input).map(({ data, name }) => {
    const { algorithm, selected } = selection(data);
    let amSensitivity = 0;
    for (const number of selected) amSensitivity = Math.max(amSensitivity, data[operatorOffset(number) + 14] / 3);
    const voice: Voice = {
      version: 6, name, algorithm, feedback: data[135] as Algorithm, modIndex: 4,
      ops: selected.map(number => convertOperator(data, number)) as Voice['ops'],
      lfo: {
        rate: data[137] / 99 * 20,
        amDepth: data[140] / 99 * amSensitivity,
        pmDepth: data[139] / 99 * data[143] / 7 * 1200,
        waveform: DX7_LFO_WAVES[data[142]],
        delay: data[138] / 99 * 10,
        sync: data[141] === 1 ? 'note' : 'global',
      },
    };
    if (data[130] !== 50 || data[131] !== 50 || data[132] !== 50 || data[133] !== 50) {
      voice.pitchEnvelope = {
        a: seconds(data[126]), d: Math.min(10, seconds(data[127]) + seconds(data[128])), r: seconds(data[129]),
        initial: pitchCents(data[133]), peak: pitchCents(data[130]), sustain: pitchCents(data[132]), final: pitchCents(data[133]),
      };
    }
    return normalizeVoice(voice) as Voice;
  });
}

/** Report losses separately so imported voices retain the strict normal voice shape. */
export function describeDX7(input: Uint8Array): DX7ImportDescription[] {
  return parse(input).map(({ data, name }) => {
    const { algorithm, selected } = selection(data);
    const warnings = [
      'Approximate 6-to-4-operator conversion; not DX7 synthesis or lossless import.',
      'Retain the loudest carriers, then nearest/loudest upstream modulators; choose the closest four-op topology preserving carrier roles. Ties use lowest operator number and deterministic graph order.',
      'Envelope rates/levels, detune, output levels, feedback and LFO use musical heuristics, not hardware transfer curves.',
      'Feedback loop placement is replaced by feedback on the first retained OPM operator.',
      'Pitch envelope keeps L4→L1→L3→L4, merging R2+R3 and omitting L2; levels use piecewise linear -4800/0/+4800 cents at 0/50/99 and heuristic seconds, not Yamaha transfer curves.',
      'Keyboard rate scaling maps 0..7 to continuous 0..4 octave duration scaling, capped at ten seconds; LFO delay maps 0..99 to 0..10 seconds with a depth gate, not Yamaha delay shaping.',
      'LFO sync maps key-sync on to note and off to deterministic global frame phase, not hardware free-running/random phase; oscillator phase carry is not reproduced.',
    ];
    for (let number = 1; number <= 6; number++) {
      const at = operatorOffset(number);
      if (data[at + 17] && selected.includes(number)) warnings.push(`OP${number} fixed Hz retained independently of playback MIDI note; detune remains approximate.`);
      if (data[at + 15]) warnings.push(`OP${number} per-operator velocity sensitivity approximated as linear 0..48 dB attenuation if retained; not Yamaha response curves.`);
      if (data[at + 7]) warnings.push(`OP${number} nonzero final envelope level ignored; release ends at silence.`);
      if ((data[at + 9] && data[at + 11] >= 2) || (data[at + 10] && data[at + 12] >= 2)) {
        warnings.push(`OP${number} positive keyboard scaling ignored; negative curves become linear 0..24 dB/octave attenuation.`);
      } else if (data[at + 9] || data[at + 10]) {
        warnings.push(`OP${number} keyboard scaling approximated as linear 0..24 dB/octave attenuation.`);
      }
      const coarse = data[at + 18];
      const ratio = (coarse || 0.5) * (1 + data[at + 19] / 100);
      if (!data[at + 17] && ratio !== clampRatio(ratio)) warnings.push(`OP${number} ratio clipped to 0.125..32 if retained.`);
    }
    if (data[144] !== 24) warnings.push('Transpose ignored; transpose playback MIDI notes explicitly.');
    if (data[142] === 1) warnings.push('Descending saw LFO is replaced by rising saw; modulation direction changes.');
    if (data[142] === 5) warnings.push('Sample-and-hold LFO is unsupported and replaced by sine.');
    if (data[140]) warnings.push('Per-operator amplitude modulation sensitivity becomes voice-wide AM using the maximum retained sensitivity.');
    return {
      name, sourceAlgorithm: data[134] + 1, algorithm,
      selectedOperators: selected,
      droppedOperators: [1, 2, 3, 4, 5, 6].filter(number => !selected.includes(number)),
      warnings,
    };
  });
}
