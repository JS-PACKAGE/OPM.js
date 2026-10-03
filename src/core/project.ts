import { prepareVoice } from '../voices/normalize.js';
import { MAX_BANK_BYTES, MAX_BANK_VOICES } from '../voices/schema.js';
import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
import { MAX_LONG_SEQUENCE_SECONDS, sampleRateValue, sequenceOwnData } from './sequence.js';
import type { BeatSequenceEvent, SequenceEvent, SequenceVoices } from './sequence.js';
import { prepareArrangementDefinition, prepareBeatSequence, validateBeatHorizon } from './arrangement-definition.js';
import type { ArrangementDefinition, ArrangementLayer, ArrangementSection } from './arrangement-definition.js';
import { readSynthOptions, validateMaxVoices } from './synth.js';
import type { QualityProfile, SynthOptions } from './synth.js';
import { normalizeTuning } from './tuning.js';
import type { NormalizedTuning } from './tuning.js';
import { normalizeTempoMap, normalizeTimeSignature, tempoSeconds } from './transport.js';
import type { TempoPoint, TimeSignature } from './transport.js';

export const MAX_SCORE_PROJECT_BYTES = 8 * 1024 * 1024;
export const MAX_SCORE_PROJECT_VOICES = MAX_BANK_VOICES;
export const MAX_ARRANGEMENT_PROJECT_BYTES = MAX_SCORE_PROJECT_BYTES;
export const MAX_ARRANGEMENT_PROJECT_VOICES = MAX_BANK_VOICES;
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

/** Version 1 stores a replayable definition; no live cursor, pending commands or DSP state. */
export interface ArrangementProject extends ArrangementDefinition {
  readonly version: 1;
  readonly layers: readonly Readonly<Required<ArrangementLayer>>[];
  readonly sections: readonly Readonly<ArrangementSection>[];
  readonly tempoMap: readonly Readonly<TempoPoint>[];
  readonly timeSignature: Readonly<TimeSignature>;
  readonly voices: Readonly<Record<string, PreparedVoice>>;
  readonly settings: ScoreProjectSettings;
}

/** Compile musical gates by integrating both endpoints; control ramp/glide remain seconds. */
export function compileBeatSequence(events: readonly BeatSequenceEvent[], options: BeatSequenceOptions = {}): SequenceEvent[] {
  const config = sequenceOwnData(options, ['tempoMap', 'bpm', 'voices'], [], 'beat sequence options');
  const map = normalizeTempoMap(config.tempoMap as readonly TempoPoint[] | undefined, config.bpm === undefined ? 120 : config.bpm as number);
  const snapshot = prepareBeatSequence(events, config.voices as SequenceVoices | undefined).events;
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

function boundedJSON(project: ScoreProject | ArrangementProject, label = 'Score'): string {
  const json = JSON.stringify(project);
  // Accepted textual fields are ASCII names; normalized snapshots contain no caller serialization hooks.
  if (json.length > MAX_SCORE_PROJECT_BYTES) throw new RangeError(`${label} project exceeds byte budget`);
  return json;
}

function projectInput(source: string | object, label: string): unknown {
  if (typeof source !== 'string') return source;
  if (source.length > MAX_SCORE_PROJECT_BYTES || new TextEncoder().encode(source).byteLength > MAX_SCORE_PROJECT_BYTES) {
    throw new RangeError(`${label} project exceeds byte budget`);
  }
  return JSON.parse(source) as unknown;
}

function voicesSnapshot(rawVoices: unknown, label = 'Score'): { voices: Readonly<Record<string, PreparedVoice>>; registry: SequenceVoices } {
  if (rawVoices === null || typeof rawVoices !== 'object' || Array.isArray(rawVoices) ||
      (Object.getPrototypeOf(rawVoices) !== Object.prototype && Object.getPrototypeOf(rawVoices) !== null)) {
    throw new TypeError('project voices must be a plain data object');
  }
  const keys = Reflect.ownKeys(rawVoices);
  if (keys.length > MAX_SCORE_PROJECT_VOICES) throw new RangeError(`${label} project exceeds voice budget`);
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
  return { voices: Object.freeze(voices), registry };
}

function requireNamedVoices(events: readonly BeatSequenceEvent[]): void {
  for (const event of events) {
    if (event.type === 'note' && typeof event.voice !== 'string') throw new TypeError('Project notes must reference named voices');
  }
}

/** Parse strict versioned own-data input, detach all nested data and freeze the snapshot. */
export function parseScoreProject(source: string | object): ScoreProject {
  const input = projectInput(source, 'Score');
  const data = sequenceOwnData(input, ['version', 'events', 'tempoMap', 'timeSignature', 'voices', 'settings'],
    ['version', 'events', 'voices'], 'score project');
  if (data.version !== 1) throw new RangeError('Unsupported score project version');
  const { voices, registry } = voicesSnapshot(data.voices);
  const events = prepareBeatSequence(data.events as readonly BeatSequenceEvent[], registry).events;
  requireNamedVoices(events);
  const tempoMap = normalizeTempoMap(data.tempoMap as readonly TempoPoint[] | undefined);
  // Reject scores that cannot be replayed by the long offline/Worker consumers.
  validateBeatHorizon(events, tempoMap);
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

/** Parse a self-contained arrangement using the same definition boundary as createArrangement. */
export function parseArrangementProject(source: string | object): ArrangementProject {
  const data = sequenceOwnData(projectInput(source, 'Arrangement'),
    ['version', 'layers', 'sections', 'initialSection', 'tempoMap', 'timeSignature', 'voices', 'settings'],
    ['version', 'layers', 'sections', 'initialSection', 'voices'], 'arrangement project');
  if (data.version !== 1) throw new RangeError('Unsupported arrangement project version');
  const { voices, registry } = voicesSnapshot(data.voices, 'Arrangement');
  const { definition } = prepareArrangementDefinition({
    layers: data.layers, sections: data.sections, initialSection: data.initialSection,
    tempoMap: data.tempoMap, timeSignature: data.timeSignature,
  }, registry);
  for (const layer of definition.layers) requireNamedVoices(layer.events);
  const result: ArrangementProject = Object.freeze({
    version: 1, layers: definition.layers, sections: definition.sections, initialSection: definition.initialSection,
    tempoMap: definition.tempoMap, timeSignature: definition.timeSignature, voices,
    settings: settingsSnapshot(data.settings === undefined ? {} : data.settings),
  });
  boundedJSON(result, 'Arrangement');
  return result;
}

/** Canonical compact JSON for a definition, never a live Arrangement object. */
export function serializeArrangementProject(project: ArrangementProject): string {
  return boundedJSON(parseArrangementProject(project), 'Arrangement');
}
