import { sequenceOwnData } from './sequence.js';

export interface TempoPoint { beat: number; bpm: number }
export interface TimeSignature { numerator: number; denominator: number }
/** One-based bars and beats; beat may contain a fractional subdivision. */
export interface BarBeat { bar: number; beat: number }
export const MAX_TRANSPORT_BEATS = 86400;
export const MAX_TEMPO_POINTS = 1024;

export function transportNumber(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be finite in ${min}..${max}`);
  }
  return value;
}

/** Read dense own-data arrays without executing element getters or iteration overrides. */
export function transportArray(input: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(input)) throw new TypeError(`${label} must be an array`);
  const length = Object.getOwnPropertyDescriptor(input, 'length')!.value as number;
  if (length > max) throw new RangeError(`${label} exceeds its entry budget`);
  for (const key of Reflect.ownKeys(input)) {
    if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) {
      throw new TypeError(`${label} has an unknown field`);
    }
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} must contain own data`);
    result.push(descriptor.value);
  }
  return result;
}

/** Strictly increasing piecewise-constant quarter-note tempo, always beginning at zero. */
export function normalizeTempoMap(input?: readonly TempoPoint[], bpm = 120): readonly Readonly<TempoPoint>[] {
  transportNumber(bpm, 1, 1000, 'bpm');
  const points = input === undefined ? [{ beat: 0, bpm }] : transportArray(input, MAX_TEMPO_POINTS, 'tempoMap');
  if (points.length === 0) throw new RangeError('tempoMap must begin at beat zero');
  let previous = -1;
  const result = points.map(point => {
    const data = sequenceOwnData(point, ['beat', 'bpm'], ['beat', 'bpm'], 'tempo point');
    const beat = transportNumber(data.beat, 0, MAX_TRANSPORT_BEATS, 'tempo beat');
    const tempo = transportNumber(data.bpm, 1, 1000, 'bpm');
    if (beat <= previous || previous === -1 && beat !== 0) throw new RangeError('tempoMap must begin at zero and increase strictly');
    previous = beat;
    return Object.freeze({ beat, bpm: tempo });
  });
  return Object.freeze(result);
}

export function normalizeTimeSignature(input: TimeSignature = { numerator: 4, denominator: 4 }): Readonly<TimeSignature> {
  const data = sequenceOwnData(input, ['numerator', 'denominator'], ['numerator', 'denominator'], 'time signature');
  const numerator = transportNumber(data.numerator, 1, 32, 'numerator');
  const denominator = transportNumber(data.denominator, 1, 32, 'denominator');
  if (!Number.isInteger(numerator) || ![1, 2, 4, 8, 16, 32].includes(denominator)) throw new RangeError('time signature requires integer numerator and power-of-two denominator');
  return Object.freeze({ numerator, denominator });
}

/** Integral of 60/BPM across tempo boundaries. */
export function beatsToSeconds(beat: number, tempoMap?: readonly TempoPoint[]): number {
  transportNumber(beat, 0, MAX_TRANSPORT_BEATS, 'beat');
  return tempoSeconds(beat, normalizeTempoMap(tempoMap));
}

/** Internal validated-map form avoids recopying a map on each scheduler tick. */
export function tempoSeconds(beat: number, map: readonly Readonly<TempoPoint>[]): number {
  let seconds = 0;
  for (let index = 0; index < map.length; index++) {
    const point = map[index];
    const end = Math.min(beat, map[index + 1]?.beat ?? beat);
    if (end > point.beat) seconds += (end - point.beat) * 60 / point.bpm;
    if (end === beat) break;
  }
  return seconds;
}

export function secondsToBeats(seconds: number, tempoMap?: readonly TempoPoint[]): number {
  const map = normalizeTempoMap(tempoMap);
  transportNumber(seconds, 0, tempoSeconds(MAX_TRANSPORT_BEATS, map), 'seconds');
  return tempoBeat(seconds, map);
}

export function tempoBeat(seconds: number, map: readonly Readonly<TempoPoint>[]): number {
  let remaining = seconds;
  for (let index = 0; index < map.length; index++) {
    const point = map[index];
    const span = ((map[index + 1]?.beat ?? MAX_TRANSPORT_BEATS) - point.beat) * 60 / point.bpm;
    if (remaining <= span || index === map.length - 1) return point.beat + remaining * point.bpm / 60;
    remaining -= span;
  }
  return MAX_TRANSPORT_BEATS;
}

export function beatToBarBeat(beat: number, signature?: TimeSignature): Readonly<BarBeat> {
  transportNumber(beat, 0, MAX_TRANSPORT_BEATS, 'beat');
  const meter = normalizeTimeSignature(signature);
  const units = beat * meter.denominator / 4;
  const bar = Math.floor(units / meter.numerator);
  return Object.freeze({ bar: bar + 1, beat: units - bar * meter.numerator + 1 });
}

export function barBeatToBeat(position: BarBeat, signature?: TimeSignature): number {
  const meter = normalizeTimeSignature(signature);
  const data = sequenceOwnData(position, ['bar', 'beat'], ['bar', 'beat'], 'bar/beat');
  const bar = transportNumber(data.bar, 1, MAX_TRANSPORT_BEATS * 8 + 1, 'bar');
  const beat = transportNumber(data.beat, 1, meter.numerator + 1, 'bar beat');
  if (!Number.isInteger(bar) || beat >= meter.numerator + 1) throw new RangeError('bar must be an integer and beat within its bar');
  return transportNumber(((bar - 1) * meter.numerator + beat - 1) * 4 / meter.denominator, 0, MAX_TRANSPORT_BEATS, 'beat');
}
