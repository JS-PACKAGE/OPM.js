import { sequenceOwnData } from './sequence.js';

export interface TempoPoint { beat: number; bpm: number; curve?: 'step' | 'linear'; endBpm?: number }
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

/** Strictly increasing quarter-note tempo; linear curves interpolate BPM in beat space. */
export function normalizeTempoMap(input?: readonly TempoPoint[], bpm = 120): readonly Readonly<TempoPoint>[] {
  transportNumber(bpm, 1, 1000, 'bpm');
  const points = input === undefined ? [{ beat: 0, bpm }] : transportArray(input, MAX_TEMPO_POINTS, 'tempoMap');
  if (points.length === 0) throw new RangeError('tempoMap must begin at beat zero');
  let previous = -1;
  const result = points.map((point, index) => {
    const data = sequenceOwnData(point, ['beat', 'bpm', 'curve', 'endBpm'], ['beat', 'bpm'], 'tempo point');
    const beat = transportNumber(data.beat, 0, MAX_TRANSPORT_BEATS, 'tempo beat');
    const tempo = transportNumber(data.bpm, 1, 1000, 'bpm');
    if (data.curve !== undefined && data.curve !== 'step' && data.curve !== 'linear') throw new TypeError('tempo curve must be step or linear');
    if (data.curve === 'linear' && index === points.length - 1) throw new RangeError('last tempo point cannot have a linear curve');
    if (data.endBpm !== undefined) {
      transportNumber(data.endBpm, 1, 1000, 'endBpm');
      if (data.curve !== 'linear') throw new TypeError('endBpm requires a linear curve');
    }
    if (beat <= previous || previous === -1 && beat !== 0) throw new RangeError('tempoMap must begin at zero and increase strictly');
    previous = beat;
    return Object.freeze({ beat, bpm: tempo, ...(data.curve === undefined ? {} : { curve: data.curve as 'step' | 'linear' }), ...(data.endBpm === undefined ? {} : { endBpm: data.endBpm as number }) });
  });
  for (let index = 0; index + 1 < result.length; index++) {
    if (!Number.isFinite(slope(result[index], result[index + 1]))) {
      throw new RangeError('linear tempo slope must be finite');
    }
  }
  return Object.freeze(result);
}

export function normalizeTimeSignature(input: TimeSignature = { numerator: 4, denominator: 4 }): Readonly<TimeSignature> {
  const data = sequenceOwnData(input, ['numerator', 'denominator'], ['numerator', 'denominator'], 'time signature');
  const numerator = transportNumber(data.numerator, 1, 32, 'numerator');
  const denominator = transportNumber(data.denominator, 1, 32, 'denominator');
  if (!Number.isInteger(numerator) || ![1, 2, 4, 8, 16, 32].includes(denominator)) throw new RangeError('time signature requires integer numerator and power-of-two denominator');
  return Object.freeze({ numerator, denominator });
}

function slope(point: Readonly<TempoPoint>, next?: Readonly<TempoPoint>): number {
  return point.curve === 'linear' && next ? ((point.endBpm ?? next.bpm) - point.bpm) / (next.beat - point.beat) : 0;
}

function integral(point: Readonly<TempoPoint>, next: Readonly<TempoPoint> | undefined, beats: number): number {
  const rate = slope(point, next);
  return rate === 0 ? beats * 60 / point.bpm : 60 * Math.log1p(rate * beats / point.bpm) / rate;
}

/** BPM at a beat in an already validated map. */
export function tempoBPM(beat: number, map: readonly Readonly<TempoPoint>[]): number {
  let index = 0;
  while (index + 1 < map.length && map[index + 1].beat <= beat) index++;
  const point = map[index];
  return point.bpm + slope(point, map[index + 1]) * (beat - point.beat);
}

/** Insert a step without changing the elapsed portion of a linear ramp. */
export function replaceTempoFrom(beat: number, bpm: number, map: readonly Readonly<TempoPoint>[]): readonly Readonly<TempoPoint>[] {
  transportNumber(beat, 0, MAX_TRANSPORT_BEATS, 'beat');
  transportNumber(bpm, 1, 1000, 'bpm');
  const points: TempoPoint[] = map.filter(point => point.beat < beat).map(point => ({ ...point }));
  const previous = points[points.length - 1];
  if (previous?.curve === 'linear') previous.endBpm = tempoBPM(beat, map);
  points.push({ beat, bpm });
  return normalizeTempoMap(points);
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
    if (end > point.beat) seconds += integral(point, map[index + 1], end - point.beat);
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
    const next = map[index + 1];
    const beats = (next?.beat ?? MAX_TRANSPORT_BEATS) - point.beat;
    const span = integral(point, next, beats);
    if (remaining <= span || index === map.length - 1) {
      const rate = slope(point, next);
      return point.beat + Math.min(beats, rate === 0 ? remaining * point.bpm / 60 : point.bpm * Math.expm1(remaining * rate / 60) / rate);
    }
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

export type BeatQuantization = 'floor' | 'ceil' | 'nearest' | 'next';
/** Grid in quarter-note beats; next is strictly later even at an exact boundary. */
export function quantizeBeat(beat: number, quantum = 1, mode: BeatQuantization = 'ceil'): number {
  transportNumber(beat, 0, MAX_TRANSPORT_BEATS, 'beat');
  transportNumber(quantum, 1 / 1024, MAX_TRANSPORT_BEATS, 'quantum');
  if (!['floor', 'ceil', 'nearest', 'next'].includes(mode)) throw new TypeError('invalid quantization mode');
  const unit = beat / quantum;
  const value = mode === 'floor' ? Math.floor(unit) : mode === 'nearest' ? Math.round(unit) : mode === 'next' ? Math.floor(unit) + 1 : Math.ceil(unit);
  return transportNumber(value * quantum, 0, MAX_TRANSPORT_BEATS, 'quantized beat');
}

/** Warp each pair of subdivisions; ratio .5 is straight, 2/3 is triplet swing. */
export function swingBeat(beat: number, subdivision = 0.5, ratio = 2 / 3): number {
  transportNumber(beat, 0, MAX_TRANSPORT_BEATS, 'beat');
  transportNumber(subdivision, 1 / 1024, MAX_TRANSPORT_BEATS / 2, 'subdivision');
  transportNumber(ratio, 0.05, 0.95, 'swing ratio');
  const pair = subdivision * 2;
  const start = Math.floor(beat / pair) * pair;
  const fraction = (beat - start) / subdivision;
  return transportNumber(start + (fraction <= 1 ? fraction * ratio : ratio + (fraction - 1) * (1 - ratio)) * pair, 0, MAX_TRANSPORT_BEATS, 'swung beat');
}
