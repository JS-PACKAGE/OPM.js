import { MAX_LONG_SEQUENCE_EVENTS, MAX_LONG_SEQUENCE_SECONDS, prepareLongSequence, sequenceOwnData } from './sequence.js';
import type { BeatSequenceEvent, SequenceEvent, SequenceSnapshot, SequenceVoices } from './sequence.js';
import { validateVoicePriority } from './synth.js';
import {
  MAX_TRANSPORT_BEATS, normalizeTempoMap, normalizeTimeSignature, tempoSeconds, transportArray, transportNumber,
} from './transport.js';
import type { TempoPoint, TimeSignature } from './transport.js';

export interface ArrangementLayer {
  name: string;
  /** Loop length in quarter notes, 1/1024 <= length <= 256; aligned to the global beat grid. */
  length: number;
  /** Note onsets lie inside [0, length). Durations and owned controls may cross a loop boundary. */
  events: readonly BeatSequenceEvent[];
  /** Admission importance 0..127, combined with each note's value by taking the maximum. */
  voicePriority?: number;
  /** Per-layer gain 0..1, default 1; independent of authored note expression. */
  gain?: number;
}
export interface ArrangementSection { name: string; layers: readonly string[] }
/** Musical definition shared by projects and live options, without scheduler callbacks or audio state. */
export interface ArrangementDefinition {
  readonly layers: readonly ArrangementLayer[];
  readonly sections: readonly ArrangementSection[];
  readonly initialSection: string;
  readonly tempoMap?: readonly TempoPoint[];
  readonly timeSignature?: TimeSignature;
}
interface NormalizedArrangementDefinition extends ArrangementDefinition {
  readonly layers: readonly Readonly<Required<ArrangementLayer>>[];
  readonly sections: readonly Readonly<ArrangementSection>[];
  readonly tempoMap: readonly Readonly<TempoPoint>[];
  readonly timeSignature: Readonly<TimeSignature>;
}
export const MAX_ARRANGEMENT_LAYERS = 16;
export const MAX_ARRANGEMENT_SECTIONS = 32;
export const MAX_ARRANGEMENT_LAYER_LENGTH = 256;

export function arrangementName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new TypeError(`${label} must match [A-Za-z0-9_-]{1,64}`);
  }
  return value;
}

/** One beat-event boundary for portable projects and live arrangements. */
export function prepareBeatSequence(events: readonly BeatSequenceEvent[], voices?: SequenceVoices): {
  events: readonly BeatSequenceEvent[]; score: SequenceSnapshot;
} {
  const input = transportArray(events, MAX_LONG_SEQUENCE_EVENTS, 'beat events').map(event => {
    const type = event !== null && typeof event === 'object' ? Object.getOwnPropertyDescriptor(event, 'type')?.value : undefined;
    const keys = type === 'note' ? ['type', 'id', 'beat', 'duration', 'voice', 'note', 'velocity', 'pan', 'voicePriority']
      : type === 'control' ? ['type', 'id', 'beat', 'controls'] : type === 'stop' ? ['type', 'id', 'beat'] : [];
    const data = sequenceOwnData(event, keys, type === 'note' ? ['type', 'id', 'beat', 'duration', 'note']
      : type === 'control' ? ['type', 'id', 'beat', 'controls'] : ['type', 'id', 'beat'], 'beat event');
    const beat = transportNumber(data.beat, 0, MAX_TRANSPORT_BEATS, 'event beat');
    if (type === 'note') transportNumber(data.duration, 0, MAX_TRANSPORT_BEATS - beat, 'note duration');
    const { beat: _beat, ...rest } = data;
    return { ...rest, time: beat } as unknown as SequenceEvent;
  });
  const score = prepareLongSequence(input, voices === undefined ? {} : { voices });
  const snapshot = score.events.map((event, index): BeatSequenceEvent => {
    const { time, ...rest } = event;
    if (event.type === 'note') {
      const original = input[index];
      const voice = original.type === 'note' ? original.voice ?? 'brass' : event.voice;
      // Keep registry names stable; inline patches come only from the detached validator snapshot.
      return Object.freeze({ ...rest, beat: time, voice: typeof voice === 'string' ? voice : event.voice }) as BeatSequenceEvent;
    }
    if (event.type === 'control') {
      const controls = Object.fromEntries(Object.entries(event.controls).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
      return Object.freeze({ ...rest, beat: time, controls: Object.freeze(controls) }) as BeatSequenceEvent;
    }
    return Object.freeze({ ...rest, beat: time }) as BeatSequenceEvent;
  });
  return { events: Object.freeze(snapshot), score };
}

/** Reject definitions that cannot be converted through their complete tempo map. */
export function validateBeatHorizon(events: readonly BeatSequenceEvent[], map: readonly Readonly<TempoPoint>[]): void {
  for (const event of events) {
    const end = tempoSeconds(event.beat + (event.type === 'note' ? event.duration : 0), map);
    if (end > MAX_LONG_SEQUENCE_SECONDS) throw new RangeError('Compiled sequence exceeds second horizon');
    if (event.type === 'note' && end <= tempoSeconds(event.beat, map)) throw new RangeError('Compiled duration must be greater than zero');
  }
}

/** Validate all references and resource bounds before a scheduler can own any notes. */
export function prepareArrangementDefinition(input: unknown, voices?: SequenceVoices): {
  definition: NormalizedArrangementDefinition; scores: readonly SequenceSnapshot[];
} {
  const data = sequenceOwnData(input, ['layers', 'sections', 'initialSection', 'bpm', 'tempoMap', 'timeSignature'],
    ['layers', 'sections', 'initialSection'], 'arrangement definition');
  const tempoMap = normalizeTempoMap(data.tempoMap as readonly TempoPoint[] | undefined, data.bpm === undefined ? 120 : data.bpm as number);
  const timeSignature = normalizeTimeSignature(data.timeSignature as TimeSignature | undefined);
  const names = new Set<string>();
  const scores: SequenceSnapshot[] = [];
  let totalEvents = 0;
  const layers = transportArray(data.layers, MAX_ARRANGEMENT_LAYERS, 'layers').map(raw => {
    const layer = sequenceOwnData(raw, ['name', 'length', 'events', 'voicePriority', 'gain'], ['name', 'length', 'events'], 'arrangement layer');
    const name = arrangementName(layer.name, 'layer name');
    if (names.has(name)) throw new TypeError('Duplicate arrangement layer');
    names.add(name);
    const length = transportNumber(layer.length, 1 / 1024, MAX_ARRANGEMENT_LAYER_LENGTH, 'layer length');
    const voicePriority = validateVoicePriority(layer.voicePriority === undefined ? 0 : layer.voicePriority);
    const gain = transportNumber(layer.gain === undefined ? 1 : layer.gain, 0, 1, 'layer gain');
    const prepared = prepareBeatSequence(layer.events as readonly BeatSequenceEvent[], voices);
    totalEvents += prepared.events.length;
    if (totalEvents > MAX_LONG_SEQUENCE_EVENTS) throw new RangeError('Arrangement exceeds its event budget');
    for (const event of prepared.events) {
      if (event.type === 'note' && event.beat >= length) throw new RangeError('Layer notes must start inside the loop length');
      if (event.type === 'control' && event.controls.gain !== undefined) {
        throw new TypeError('Arrangement reserves note gain for the layer; use expression in layer events');
      }
    }
    validateBeatHorizon(prepared.events, tempoMap);
    scores.push(prepared.score);
    return Object.freeze({ name, length, events: prepared.events, voicePriority, gain });
  });
  if (layers.length === 0) throw new RangeError('An arrangement requires at least one layer');
  const sectionNames = new Set<string>();
  const sections = transportArray(data.sections, MAX_ARRANGEMENT_SECTIONS, 'sections').map(raw => {
    const section = sequenceOwnData(raw, ['name', 'layers'], ['name', 'layers'], 'arrangement section');
    const name = arrangementName(section.name, 'section name');
    if (sectionNames.has(name)) throw new TypeError('Duplicate arrangement section');
    sectionNames.add(name);
    const members = new Set<string>();
    for (const member of transportArray(section.layers, MAX_ARRANGEMENT_LAYERS, 'section layers')) {
      const layer = arrangementName(member, 'section layer');
      if (!names.has(layer)) throw new RangeError('Section references an unknown layer');
      members.add(layer);
    }
    return Object.freeze({ name, layers: Object.freeze([...members]) });
  });
  const initialSection = arrangementName(data.initialSection, 'initialSection');
  if (!sectionNames.has(initialSection)) throw new RangeError('Unknown initial section');
  return { definition: Object.freeze({ layers: Object.freeze(layers), sections: Object.freeze(sections), initialSection, tempoMap, timeSignature }),
    scores: Object.freeze(scores) };
}
