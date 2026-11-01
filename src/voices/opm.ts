import { normalizeVoice } from './normalize.js';
import { MAX_BANK_BYTES, MAX_BANK_VOICES } from './schema.js';
import type { Algorithm, LFO, Operator, Voice } from './schema.js';

export interface OPMImportDescription {
  name: string;
  program: number;
  algorithm: Algorithm;
  /** Source labels in destination operator order. */
  operators: readonly string[];
  warnings: string[];
}

// Clean-room parameter references, not emulator/converter source:
// https://tanalin.com/en/articles/third-party/vopm-manual/
// https://archive.org/details/yamaha-ym2151-technical-reference
// Text-layout header: https://raw.githubusercontent.com/vampirefrog/libfmvoice/master/tests/test.opm
// Application manual figs. 2.5–2.16. Raw MUL differs from VOPM's displayed
// multiplier: use the hardware table (0 = 0.5), not the GUI's doubled values.
const LABELS = ['M1', 'C1', 'M2', 'C2'] as const;
const MAXIMUMS: Readonly<Record<string, readonly number[]>> = {
  LFO: [255, 127, 127, 3, 31], CH: [255, 7, 7, 3, 7, 120, 1],
  M1: [31, 31, 31, 15, 15, 127, 3, 15, 7, 3, 1],
  C1: [31, 31, 31, 15, 15, 127, 3, 15, 7, 3, 1],
  M2: [31, 31, 31, 15, 15, 127, 3, 15, 7, 3, 1],
  C2: [31, 31, 31, 15, 15, 127, 3, 15, 7, 3, 1],
};
const DT2 = [0, 600, 781, 950];
// Fixed musical approximation to pitch-dependent DT1 (manual fig. 2.6).
const DT1 = [0, 1, 2, 3, 0, -1, -2, -3];
const PMS = [0, 5, 10, 20, 50, 100, 400, 700];
const AMS = [0, 23.90625, 47.8125, 95.625];
const WAVES: readonly LFO['waveform'][] = ['saw', 'square', 'triangle', 'noise'];
const CLOCK = 3579545;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get! as (this: unknown) => number;
const typedArrayKind = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get! as (this: unknown) => string | undefined;
interface Patch { name: string; program: number; line: number; sections: Map<string, number[]>; renamed: boolean }
const encoder = new TextEncoder();

function sourceText(source: unknown): string {
  if (typeof source === 'string') {
    // UTF-8 uses at most three bytes per UTF-16 code unit, including lone surrogates.
    if (source.length > MAX_BANK_BYTES || (source.length * 3 > MAX_BANK_BYTES && encoder.encode(source).length > MAX_BANK_BYTES)) throw new RangeError('OPM input exceeds 262144 bytes');
    return source;
  }
  if (typedArrayKind.call(source) !== 'Uint8Array') throw new TypeError('OPM input must be a string or Uint8Array');
  const length = typedArrayLength.call(source);
  if (length > MAX_BANK_BYTES) throw new RangeError('OPM input exceeds 262144 bytes');
  const bytes = new Uint8Array(length);
  Uint8Array.prototype.set.call(bytes, source as Uint8Array);
  // Explicit Latin-1, unlike TextDecoder's windows-1252 alias; never UTF-8 loss.
  let text = '';
  let index = 0;
  // Fixed small groups avoid one concatenation per byte without argument-spread limits or decoder remapping.
  for (; index + 8 <= length; index += 8) {
    text += String.fromCharCode(bytes[index], bytes[index + 1], bytes[index + 2], bytes[index + 3],
      bytes[index + 4], bytes[index + 5], bytes[index + 6], bytes[index + 7]);
  }
  for (; index < length; index++) text += String.fromCharCode(bytes[index]);
  return text;
}
function integer(token: string, max: number, line: number): number {
  if (!/^[0-9]+$/.test(token)) throw new RangeError(`OPM line ${line}: expected decimal integer in 0..${max}`);
  const value = Number(token);
  if (!Number.isSafeInteger(value) || value > max) throw new RangeError(`OPM line ${line}: integer outside 0..${max}`);
  return value;
}
function parse(source: unknown): Patch[] {
  const text = sourceText(source);
  const patches: Patch[] = [], names = new Set<string>();
  let current: Patch | undefined;
  const complete = () => {
    if (current && current.sections.size !== 6) throw new RangeError(`OPM line ${current.line}: missing patch sections`);
  };
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1, raw = lines[index];
    if (raw.length > 512 || (typeof source === 'string' && raw.length * 3 > 512 && encoder.encode(raw).length > 512)) throw new RangeError(`OPM line ${line}: line exceeds 512 bytes`);
    if (raw.includes('\0')) throw new RangeError(`OPM line ${line}: NUL is forbidden`);
    const content = raw.trim();
    if (!content || content.startsWith('//')) continue;
    const colon = content.indexOf(':');
    if (colon < 0) throw new RangeError(`OPM line ${line}: missing section colon`);
    const section = content.slice(0, colon), body = content.slice(colon + 1).trim();
    if (section === '@') {
      complete();
      if (patches.length >= MAX_BANK_VOICES) throw new RangeError(`OPM line ${line}: more than 128 patches`);
      const gap = body.search(/\s/);
      const program = integer(gap < 0 ? body : body.slice(0, gap), 127, line);
      const original = gap < 0 ? '' : body.slice(gap).trim();
      const base = original.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'OPM';
      let name = base;
      for (let suffix = 2; names.has(name); suffix++) {
        const tail = `_${suffix}`;
        name = base.slice(0, 64 - tail.length) + tail;
      }
      names.add(name);
      current = { name, program, line, sections: new Map(), renamed: name !== original };
      patches.push(current);
    } else {
      if (!current) throw new RangeError(`OPM line ${line}: section before patch header`);
      const maxima = Object.hasOwn(MAXIMUMS, section) ? MAXIMUMS[section] : undefined;
      if (!maxima) throw new RangeError(`OPM line ${line}: unknown section`);
      if (current.sections.has(section)) throw new RangeError(`OPM line ${line}: duplicate ${section} section`);
      const tokens = body ? body.split(/\s+/) : [];
      if (tokens.length !== maxima.length) throw new RangeError(`OPM line ${line}: ${section} requires ${maxima.length} fields`);
      const values = tokens.map((token, field) => integer(token, maxima[field], line));
      if (section === 'CH' && (values[5] & ~120)) throw new RangeError(`OPM line ${line}: SLOT permits only key-on bits 3..6`);
      current.sections.set(section, values);
    }
  }
  complete();
  if (!patches.length) throw new RangeError('OPM input contains no patches');
  return patches;
}

// Original monotone musical heuristic, not hardware envelope timings.
// RR first becomes the manual's input rate 2*RR+1; zero AR/D1R is infinite.
const seconds = (rate: number): number => rate === 0 ? 10 : Math.min(10, 10 * 2 ** (-rate / 3));
// The same curve for nonzero D2R as seconds per 96 dB (voice v8 `adsr.sr`); zero holds.
const sustainSeconds = (rate: number): number => Math.max(0.01, 10 * 2 ** (-rate / 3));
const gain = (db: number): number => 10 ** (-db / 20);
// PAN stays unmapped: converters commonly write a fixed default (64) rather than
// the register RL bits, so file values do not reliably encode L/R placement.
// Fits application-manual fig. 2.16, including fractional low-nibble interpolation.
const sourceLFORate = (frequency: number): number => CLOCK / 2 ** 32 * 2 ** (frequency >> 4) * (1 + (frequency & 15) / 16);
// The manual's noise divider is interpreted as an inverted 32-step countdown.
const sourceNoiseRate = (frequency: number): number => CLOCK / (32 * (32 - frequency));

function convert(patch: Patch): Voice {
  const lfo = patch.sections.get('LFO')!, ch = patch.sections.get('CH')!;
  // Manual fig. 2.9: CON0 M1→C1→M2→C2; CON1 (M1+C1)→M2→C2;
  // CON2 C1→M2, (M1+M2)→C2; CON3 M1→C1, (C1+M2)→C2;
  // CON4 M1→C1 and M2→C2; CON5 M1→(C1,M2,C2);
  // CON6 M1→C1 plus M2,C2; CON7 all carriers. Comparing ALGORITHMS
  // proves file order M1,C1,M2,C2 is signal order for every CON. Do NOT
  // reorder to hardware register order M1,M2,C1,C2. SLOT uses key-on order.
  const ops = LABELS.map((label, index): Operator => {
    const [ar, d1r, d2r, rr, d1l, tl, ks, mul, dt1, dt2] = patch.sections.get(label)!;
    let noise: { waveform: 'noise'; noiseRate: number } | undefined;
    if (label === 'C2' && ch[6]) {
      noise = { waveform: 'noise', noiseRate: Math.min(20000, Math.max(20, sourceNoiseRate(lfo[4]))) };
    }
    // Spreads define own data; assigning sustain-rate or noise fields could reach an inherited setter.
    return {
      ratio: mul || 0.5, level: ch[5] & (8 << index) ? gain(0.75 * tl) : 0,
      detune: DT1[dt1] + DT2[dt2], rateKeyScale: ks / 3 * 4,
      adsr: { a: seconds(ar), d: seconds(d1r), s: gain(d1l === 15 ? 93 : d1l * 3), r: seconds(2 * rr + 1),
        ...(d2r ? { sr: sustainSeconds(d2r) } : {}) },
      ...noise,
    };
  }) as Voice['ops'];
  const rate = sourceLFORate(lfo[0]);
  const voice: Voice = {
    version: 8, name: patch.name, algorithm: ch[2] as Algorithm, feedback: ch[1] as Algorithm,
    // Level is linear amplitude for carriers and phase sources; retain the
    // same TL attenuation for both with the engine's default four-radian index.
    modIndex: 4, ops,
    lfo: { rate: Math.min(20, rate), waveform: WAVES[lfo[3]], sync: 'global',
      amDepth: 1 - gain(AMS[ch[3]] * lfo[1] / 128), pmDepth: PMS[ch[4]] * lfo[2] / 128,
      amTargets: LABELS.map(label => patch.sections.get(label)![10]) as [number, number, number, number] },
  };
  return normalizeVoice(voice) as Voice;
}

function describe(patch: Patch): OPMImportDescription {
  const lfo = patch.sections.get('LFO')!, ch = patch.sections.get('CH')!;
  const warnings = new Set<string>([
    'Approximate OPM conversion, not register-level YM2151 emulation; no hardware-fidelity claim.',
    'Envelope times, fixed-cent DT1, key-rate scaling, feedback and modulation index use musical approximations.',
    'LFO depth and deterministic global phase approximate hardware modulation; AM/PM waveform phase relationships differ.',
    'PAN is ignored (files often carry a converter default, not L/R bits); set voice or note pan explicitly.',
    'Raw MUL uses the hardware multiplier table, not the VOPM GUI doubled display convention.',
  ]);
  if (patch.renamed) warnings.add('Name sanitized, shortened or de-duplicated to the voice-name rule.');
  for (let index = 0; index < LABELS.length; index++) {
    const label = LABELS[index];
    const [ar, d1r, d2r] = patch.sections.get(label)!;
    if (d2r) warnings.add(`${label}: D2R mapped to an approximate sustain rate (adsr.sr).`);
    if (!(ch[5] & (8 << index))) warnings.add(`${label}: disabled SLOT bit mapped to zero level.`);
    if (ar === 0 || d1r === 0) warnings.add(`${label}: infinite zero-rate stage clamped to ten seconds.`);
    if (label === 'C2' && ch[6]) {
      const rate = sourceNoiseRate(lfo[4]);
      warnings.add('NE maps C2 to OPM.js noise extension on any channel; hardware channel-8 LFSR/envelope are not reproduced.');
      warnings.add('NFRQ uses an approximate inverted 32-step divider; published noise equation does not specify zero encoding.');
      if (Math.min(20000, Math.max(20, rate)) !== rate) warnings.add('Noise rate clamped to 20..20000 Hz.');
    }
  }
  if (sourceLFORate(lfo[0]) > 20) warnings.add('LFO rate clamped to 20 Hz.');
  if (lfo[3] === 3) warnings.add('Noise LFO uses a deterministic per-cycle sample-and-hold, not the hardware LFSR.');
  return { name: patch.name, program: patch.program, algorithm: ch[2] as Algorithm, operators: [...LABELS], warnings: [...warnings] };
}

/** Import bounded decimal VOPM/MXDRV-family text patches as approximate v8 voices. */
export function importOPM(source: string | Uint8Array): Voice[] {
  return parse(source).map(convert);
}
/** Report source program metadata and bounded, de-duplicated conversion losses. */
export function describeOPM(source: string | Uint8Array): OPMImportDescription[] {
  return parse(source).map(describe);
}
