import { prepareVoice } from '../voices/normalize.js';
import { MAX_BANK_BYTES, MAX_BANK_VOICES } from '../voices/schema.js';
import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
import { MAX_LONG_SEQUENCE_EVENTS, MAX_LONG_SEQUENCE_SECONDS, prepareLongSequence, sampleRateValue, sequenceOwnData } from './sequence.js';
import type { BeatSequenceEvent, SequenceEvent, SequenceVoices } from './sequence.js';
import { readSynthOptions, validateMaxVoices } from './synth.js';
import type { QualityProfile, SynthOptions } from './synth.js';
import { normalizeTuning } from './tuning.js';
import type { NormalizedTuning } from './tuning.js';
import { MAX_TRANSPORT_BEATS, normalizeTempoMap, normalizeTimeSignature, tempoSeconds, transportArray, transportNumber } from './transport.js';
import type { TempoPoint, TimeSignature } from './transport.js';

export const MAX_SCORE_PROJECT_BYTES = 8 * 1024 * 1024;
export const MAX_SCORE_PROJECT_VOICES = MAX_BANK_VOICES;
export interface BeatSequenceOptions {
  tempoMap?: readonly TempoPoint[];
  bpm?: number;
  voices?: SequenceVoices;
}
export interface ScoreProjectSettings {
  readonly sampleRate: number;
  readonly quality: QualityProfile;
  readonly maxVoices: number;
  readonly mixGain: number;
  readonly tuning: NormalizedTuning;
  readonly stealing: NonNullable<SynthOptions['stealing']>;
}
/** Version 1 is self-contained: every note names a patch stored in voices. */
export interface ScoreProject {
  readonly version: 1;
  readonly events: readonly BeatSequenceEvent[];
  readonly tempoMap: readonly Readonly<TempoPoint>[];
  readonly timeSignature: Readonly<TimeSignature>;
  readonly voices: Readonly<Record<string, PreparedVoice>>;
  readonly settings: ScoreProjectSettings;
}

function beatSnapshot(events: readonly BeatSequenceEvent[], voices?: SequenceVoices) {
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
  const prepared = prepareLongSequence(input, voices === undefined ? {} : { voices });
  return prepared.events.map((event, index): BeatSequenceEvent => {
    const { time, ...rest } = event;
    if (event.type === 'note') {
      const original = input[index];
      const voice = original.type === 'note' ? original.voice ?? 'brass' : event.voice;
      // Keep names stable; inline patches must come from the detached validator snapshot.
      return Object.freeze({ ...rest, beat: time, voice: typeof voice === 'string' ? voice : event.voice }) as BeatSequenceEvent;
    }
    if (event.type === 'control') {
      const controls = Object.fromEntries(Object.entries(event.controls).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
      return Object.freeze({ ...rest, beat: time, controls: Object.freeze(controls) }) as BeatSequenceEvent;
    }
    return Object.freeze({ ...rest, beat: time }) as BeatSequenceEvent;
  });
}

/** Compile musical gates by integrating both endpoints; control ramp/glide remain seconds. */
export function compileBeatSequence(events: readonly BeatSequenceEvent[], options: BeatSequenceOptions = {}): SequenceEvent[] {
  const config = sequenceOwnData(options, ['tempoMap', 'bpm', 'voices'], [], 'beat sequence options');
  const map = normalizeTempoMap(config.tempoMap as readonly TempoPoint[] | undefined, config.bpm === undefined ? 120 : config.bpm as number);
  const snapshot = beatSnapshot(events, config.voices as SequenceVoices | undefined);
  return snapshot.map(event => {
    const { beat, ...rest } = event;
    const time = tempoSeconds(beat, map);
    const end = event.type === 'note' ? tempoSeconds(beat + event.duration, map) : time;
    if (end > MAX_LONG_SEQUENCE_SECONDS) throw new RangeError('Compiled sequence exceeds second horizon');
    if (event.type === 'note' && end <= time) throw new RangeError('Compiled duration must be greater than zero');
    return Object.freeze(event.type === 'note' ? { ...rest, time, duration: end - time } : { ...rest, time }) as SequenceEvent;
  });
}

function settingsSnapshot(input: unknown): ScoreProjectSettings {
  const data = sequenceOwnData(input, ['sampleRate', 'quality', 'maxVoices', 'mixGain', 'tuning', 'stealing'], [], 'project settings');
  const { sampleRate, maxVoices, ...synth } = data;
  const settings = readSynthOptions(synth as SynthOptions);
  return Object.freeze({
    sampleRate: sampleRateValue(sampleRate === undefined ? 44100 : sampleRate as number),
    quality: settings.quality ?? 'standard',
    maxVoices: validateMaxVoices(maxVoices === undefined ? 8 : maxVoices),
    mixGain: settings.mixGain ?? 1,
    tuning: normalizeTuning(settings.tuning === undefined ? {} : settings.tuning),
    stealing: settings.stealing ?? 'oldest',
  });
}

function boundedJSON(project: ScoreProject): string {
  const json = JSON.stringify(project);
  // All accepted textual fields are ASCII patch names; JSON numbers/keys are ASCII too.
  if (json.length > MAX_SCORE_PROJECT_BYTES) throw new RangeError('Score project exceeds byte budget');
  return json;
}

/** Parse strict versioned own-data input, detach all nested data and freeze the snapshot. */
export function parseScoreProject(source: string | object): ScoreProject {
  let input: unknown = source;
  if (typeof source === 'string') {
    if (source.length > MAX_SCORE_PROJECT_BYTES || new TextEncoder().encode(source).byteLength > MAX_SCORE_PROJECT_BYTES) {
      throw new RangeError('Score project exceeds byte budget');
    }
    input = JSON.parse(source) as unknown;
  }
  const data = sequenceOwnData(input, ['version', 'events', 'tempoMap', 'timeSignature', 'voices', 'settings'],
    ['version', 'events', 'voices'], 'score project');
  if (data.version !== 1) throw new RangeError('Unsupported score project version');
  const rawVoices = data.voices;
  if (rawVoices === null || typeof rawVoices !== 'object' || Array.isArray(rawVoices) ||
      (Object.getPrototypeOf(rawVoices) !== Object.prototype && Object.getPrototypeOf(rawVoices) !== null)) {
    throw new TypeError('project voices must be a plain data object');
  }
  const keys = Reflect.ownKeys(rawVoices);
  if (keys.length > MAX_SCORE_PROJECT_VOICES) throw new RangeError('Score project exceeds voice budget');
  const voices: Record<string, PreparedVoice> = Object.create(null);
  const registry = new Map<string, VoiceInput>();
  for (const key of keys) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new TypeError('Invalid project voice name');
    }
    const descriptor = Object.getOwnPropertyDescriptor(rawVoices, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('project voices must contain data');
    registry.set(key, prepareVoice(descriptor.value as VoiceInput));
  }
  for (const key of [...registry.keys()].sort()) voices[key] = registry.get(key) as PreparedVoice;
  if (JSON.stringify(voices).length > MAX_BANK_BYTES) throw new RangeError('Project voices exceed 256 KiB byte budget');
  const events = beatSnapshot(data.events as readonly BeatSequenceEvent[], registry);
  for (const event of events) {
    if (event.type === 'note' && typeof event.voice !== 'string') throw new TypeError('Project notes must reference named voices');
  }
  const tempoMap = normalizeTempoMap(data.tempoMap as readonly TempoPoint[] | undefined);
  // Reject scores that cannot be replayed by the long offline/Worker consumers.
  for (const event of events) {
    const end = tempoSeconds(event.beat + (event.type === 'note' ? event.duration : 0), tempoMap);
    if (end > MAX_LONG_SEQUENCE_SECONDS) throw new RangeError('Compiled sequence exceeds second horizon');
    if (event.type === 'note' && end <= tempoSeconds(event.beat, tempoMap)) throw new RangeError('Compiled duration must be greater than zero');
  }
  const result: ScoreProject = Object.freeze({ version: 1, events: Object.freeze(events), tempoMap,
    timeSignature: normalizeTimeSignature(data.timeSignature as TimeSignature | undefined),
    voices: Object.freeze(voices), settings: settingsSnapshot(data.settings === undefined ? {} : data.settings) });
  boundedJSON(result);
  return result;
}

/** Canonical compact JSON: stable field order, sorted patch names, normalized defaults. */
export function serializeScoreProject(project: ScoreProject): string {
  return boundedJSON(parseScoreProject(project));
}
