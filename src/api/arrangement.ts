import type { OPM, OPMEvent } from './index.js';
import { prepareBeatEvents } from './transport.js';
import type { BeatSequenceEvent } from './transport.js';
import { MAX_LONG_SEQUENCE_EVENTS, MAX_SEQUENCE_NOTES, MAX_SEQUENCE_SLOTS, sequenceOwnData } from '../core/sequence.js';
import type { PreparedSequenceEvent } from '../core/sequence.js';
import type { NoteControls } from '../core/synth.js';
import {
  MAX_TRANSPORT_BEATS, normalizeTempoMap, normalizeTimeSignature, quantizeBeat, tempoBeat, tempoSeconds,
  beatToBarBeat, replaceTempoFrom, transportArray, transportNumber,
} from '../core/transport.js';
import type { BarBeat, TempoPoint, TimeSignature } from '../core/transport.js';

export interface ArrangementLayer {
  name: string;
  /** Loop length in quarter notes, 0 < length <= 256. Layers stay aligned to the global beat grid. */
  length: number;
  /** Beat events inside [0, length). Note durations may exceed the loop length. */
  events: readonly BeatSequenceEvent[];
  /** Admission importance 0..127 applied to every note in this layer (maximum with a note's own value). */
  voicePriority?: number;
}
export interface ArrangementSection { name: string; layers: readonly string[] }
export interface ArrangementOptions {
  layers: readonly ArrangementLayer[];
  sections: readonly ArrangementSection[];
  initialSection: string;
  bpm?: number;
  tempoMap?: readonly TempoPoint[];
  timeSignature?: TimeSignature;
  horizon?: number;
  interval?: number;
  onError?: (error: Error) => void;
}
export interface ArrangementChangeOptions {
  /** Boundary in quarter notes, or the meter-defined beat/bar; default bar. Never earlier than already admitted notes. */
  quantize?: 'beat' | 'bar' | number;
  /** Removed layers may finish naturally instead of being released at the boundary. Default false. */
  preserveNotes?: boolean;
}
export type ArrangementState = 'stopped' | 'starting' | 'running' | 'paused' | 'disposed';
export interface ArrangementSnapshot {
  readonly state: ArrangementState;
  /** Global quarter-note position; a paused arrangement reports where it will resume. */
  readonly position: number;
  readonly musicalPosition: Readonly<BarBeat>;
  readonly section: string;
  /** Layers effective at position. */
  readonly layers: readonly string[];
  /** Committed changes after the current position. */
  readonly pending: readonly Readonly<{ beat: number; section: string; layers: readonly string[] }>[];
  /** Notes refused by voice-priority admission; they are not an arrangement failure. */
  readonly priorityDrops: number;
  readonly tempoMap: readonly Readonly<TempoPoint>[];
}
export interface Arrangement {
  readonly state: ArrangementState;
  readonly snapshot: ArrangementSnapshot;
  start(): Promise<void>;
  resume(): Promise<void>;
  /** Releases owned notes. Resume restarts musically at the paused beat; no DSP checkpoint is restored. */
  pause(): void;
  /** Releases owned notes and rewinds to beat 0. */
  stop(): void;
  switchSection(name: string, options?: ArrangementChangeOptions): number;
  setLayer(name: string, enabled: boolean, options?: ArrangementChangeOptions): number;
  /** Replaces tempo from the current beat onward; notes already admitted keep their admitted audio times. */
  setTempo(bpm: number): void;
  setTempoMap(map: readonly TempoPoint[]): void;
  pump(): void;
  dispose(): void;
}

type Note = Extract<PreparedSequenceEvent, { type: 'note' }>;
interface Pattern { name: string; length: number; priority: number; notes: Track[] }
interface Track { note: Note; end: number; controls: { beat: number; controls: NoteControls }[] }
interface Gate { pattern: Pattern; track: Track; start: number; end: number; nextControl: number; id?: number; offAt?: number }
interface Command { beat: number; order: 0 | 1 | 2; gate: Gate; controls?: NoteControls }
interface Change { beat: number; section: string; layers: ReadonlySet<string> }

const MAX_LAYERS = 16;
const MAX_SECTIONS = 32;
const MAX_LAYER_LENGTH = 256;
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const EPSILON = 1e-9;

function name(value: unknown, label: string): string {
  if (typeof value !== 'string' || !NAME.test(value)) throw new TypeError(`${label} must match [A-Za-z0-9_-]{1,64}`);
  return value;
}

/**
 * Looping, quantized adaptive music for one OPM instance. Layers are aligned to the global beat grid, so a layer
 * shared by two sections is one continuous schedule: its sounding gates are neither retriggered nor stopped when
 * unrelated layers change. Changes are committed at a boundary no earlier than the notes already admitted.
 */
export function createArrangement(opm: OPM, options: ArrangementOptions): Arrangement {
  const config = sequenceOwnData(options, ['layers', 'sections', 'initialSection', 'bpm', 'tempoMap', 'timeSignature', 'horizon', 'interval', 'onError'],
    ['layers', 'sections', 'initialSection'], 'arrangement options');
  let map = normalizeTempoMap(config.tempoMap as readonly TempoPoint[] | undefined, config.bpm === undefined ? 120 : config.bpm as number);
  const signature = normalizeTimeSignature(config.timeSignature as TimeSignature | undefined);
  const horizon = transportNumber(config.horizon === undefined ? 0.2 : config.horizon, 0.01, 10, 'horizon');
  const interval = transportNumber(config.interval === undefined ? Math.min(0.025, horizon / 2) : config.interval, 0.001, horizon / 2, 'interval');
  if (config.onError !== undefined && typeof config.onError !== 'function') throw new TypeError('onError must be a function');
  const onError = config.onError as ((error: Error) => void) | undefined;

  const patterns = new Map<string, Pattern>();
  let totalEvents = 0;
  for (const raw of transportArray(config.layers, MAX_LAYERS, 'layers')) {
    const layer = sequenceOwnData(raw, ['name', 'length', 'events', 'voicePriority'], ['name', 'length', 'events'], 'arrangement layer');
    const layerName = name(layer.name, 'layer name');
    if (patterns.has(layerName)) throw new TypeError('Duplicate arrangement layer');
    const length = transportNumber(layer.length, 1 / 1024, MAX_LAYER_LENGTH, 'layer length');
    const priority = layer.voicePriority === undefined ? 0 : transportNumber(layer.voicePriority, 0, 127, 'voicePriority');
    if (!Number.isInteger(priority)) throw new RangeError('voicePriority must be an integer in 0..127');
    const events = layer.events as readonly BeatSequenceEvent[];
    const score = prepareBeatEvents(opm, events);
    totalEvents += score.events.length;
    if (totalEvents > 65536) throw new RangeError('Arrangement exceeds its event budget');
    const tracks = new Map<number, Track>();
    for (const event of score.events) if (event.type === 'note') {
      if (event.time >= length) throw new RangeError('Layer notes must start inside the loop length');
      tracks.set(event.id, { note: event, end: event.time + event.duration, controls: [] });
    }
    for (const event of score.events) {
      const track = tracks.get(event.id)!;
      if (event.type === 'stop') track.end = Math.min(track.end, event.time);
      else if (event.type === 'control') track.controls.push({ beat: Math.max(event.time, track.note.time), controls: event.controls });
    }
    for (const track of tracks.values()) {
      track.controls = track.controls.filter(control => control.beat > track.note.time && control.beat < track.end);
      track.controls.sort((a, b) => a.beat - b.beat);
    }
    patterns.set(layerName, { name: layerName, length, priority, notes: [...tracks.values()].sort((a, b) => a.note.time - b.note.time || a.note.id - b.note.id) });
  }
  if (patterns.size === 0) throw new RangeError('An arrangement requires at least one layer');
  const sections = new Map<string, ReadonlySet<string>>();
  for (const raw of transportArray(config.sections, MAX_SECTIONS, 'sections')) {
    const section = sequenceOwnData(raw, ['name', 'layers'], ['name', 'layers'], 'arrangement section');
    const sectionName = name(section.name, 'section name');
    if (sections.has(sectionName)) throw new TypeError('Duplicate arrangement section');
    const members = new Set<string>();
    for (const member of transportArray(section.layers, MAX_LAYERS, 'section layers')) {
      const layerName = name(member, 'section layer');
      if (!patterns.has(layerName)) throw new RangeError('Section references an unknown layer');
      members.add(layerName);
    }
    sections.set(sectionName, members);
  }
  const initial = name(config.initialSection, 'initialSection');
  if (!sections.has(initial)) throw new RangeError('Unknown initial section');

  let state: ArrangementState = 'stopped';
  let position = 0;
  let origin = 0;
  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let generation = 0;
  let starting: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Command[] = [];
  let cursor = 0;
  let changes: Change[] = [{ beat: 0, section: initial, layers: sections.get(initial)! }];
  let admitting = false;
  let terminal: number | undefined;
  let terminalReason: string | undefined;
  let lastPump = 0;
  let priorityDrops = 0;
  const owned = new Map<number, Gate>();
  const lead = Math.min(0.05, horizon / 2);

  const barBeats = signature.numerator * 4 / signature.denominator;
  function ensure(): void { if (state === 'disposed') throw new Error('Arrangement is disposed'); }
  function nowBeat(): number {
    if (state !== 'running' || !context) return position;
    return Math.min(MAX_TRANSPORT_BEATS, tempoBeat(Math.max(0, context.currentTime - origin), map));
  }
  function audioTime(beat: number): number { return origin + tempoSeconds(beat, map); }
  function effective(beat: number): Change {
    let result = changes[0]!;
    for (const change of changes) if (change.beat <= beat + EPSILON) result = change; else break;
    return result;
  }
  function insert(command: Command): void {
    if (queue.length >= MAX_SEQUENCE_SLOTS) throw new RangeError('Arrangement exceeds queued command capacity');
    let index = queue.length;
    while (index > 0) {
      const previous = queue[index - 1]!;
      if (previous.beat < command.beat || previous.beat === command.beat && previous.order <= command.order) break;
      index--;
    }
    queue.splice(index, 0, command);
  }
  function scheduleNext(gate: Gate): void {
    const control = gate.track.controls[gate.nextControl++];
    const beat = control ? gate.start - gate.track.note.time + control.beat : gate.end;
    if (control && beat < gate.end) {
      insert({ beat, order: 2, gate, controls: control.controls });
    } else insert({ beat: gate.end, order: 0, gate });
  }
  function generate(from: number, to: number): void {
    if (to <= from) return;
    let candidates = 0;
    for (const pattern of patterns.values()) {
      if (pattern.notes.length === 0) continue;
      const active = effective(from).layers.has(pattern.name) ||
        changes.some(change => change.beat >= from && change.beat < to && change.layers.has(pattern.name));
      if (!active) continue;
      const wraps = Math.ceil(to / pattern.length) - Math.floor(from / pattern.length);
      if (wraps > 32) throw new RangeError('Arrangement exceeds bounded wraps per window');
      candidates += wraps * pattern.notes.length;
      if (candidates > MAX_LONG_SEQUENCE_EVENTS) throw new RangeError('Arrangement exceeds generation work capacity');
    }
    for (const pattern of patterns.values()) {
      if (pattern.notes.length === 0) continue;
      if (!effective(from).layers.has(pattern.name) &&
          !changes.some(change => change.beat >= from && change.beat < to && change.layers.has(pattern.name))) continue;
      for (let loop = Math.floor(from / pattern.length); loop * pattern.length < to; loop++) {
        const base = loop * pattern.length;
        for (const track of pattern.notes) {
          const start = base + track.note.time;
          if (start < from || start >= to) continue;
          if (!effective(start).layers.has(pattern.name)) continue;
          const end = base + track.end;
          if (end <= start) continue;
          const gate: Gate = { pattern, track, start, end, nextControl: 0 };
          insert({ beat: start, order: 1, gate });
        }
      }
    }
  }
  function cancel(next: ArrangementState, beat = nowBeat()): void {
    generation++;
    starting = undefined;
    state = next;
    position = beat;
    clearTimeout(timer);
    timer = undefined;
    queue = [];
    const ids = [...owned.keys()];
    owned.clear();
    let failure: unknown;
    if (opm.context === context && opm.node === node && context?.state !== 'closed') {
      for (const id of ids) try { opm.stop(id, { cancelControls: true }); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  }
  function fail(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    try { cancel('stopped'); } catch { /* Preserve the original scheduling failure. */ }
    onError?.(failure);
  }
  const observe = (event: OPMEvent): void => {
    if (state === 'disposed') return;
    if (event.type === 'reset') { owned.clear(); cancel('stopped', nowBeat()); return; }
    if (event.type === 'context' && event.state !== 'running') {
      if (state === 'running' || state === 'starting') fail(new Error(`Arrangement AudioContext is ${event.state}; restart from a user gesture`));
      return;
    }
    if (event.type === 'command' && event.state === 'rejected' && event.id !== undefined && owned.has(event.id)) {
      fail(new Error(`Arrangement command rejected: ${event.reason ?? 'unknown'}`));
      return;
    }
    if (event.type === 'note' && ['ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) {
      if (admitting) { terminal = event.id; terminalReason = event.reason; }
      const gate = owned.get(event.id);
      if (gate) {
        owned.delete(event.id);
        queue = queue.filter(command => command.gate !== gate);
        if (event.state === 'rejected') {
          // Priority protection is an expected musical outcome, not an unsafe scheduler state.
          if (event.reason === 'priority') priorityDrops++;
          else fail(new Error(`Arrangement note rejected: ${event.reason ?? 'unknown'}`));
        }
      }
    }
  };
  const unsubscribe = opm.subscribe(observe);

  function pump(): void {
    clearTimeout(timer);
    timer = undefined;
    if (state !== 'running') return;
    try {
      if (!context || context !== opm.context || node !== opm.node || context.state !== 'running') throw new Error('Arrangement context changed or interrupted');
      const now = context.currentTime;
      if (now - lastPump > horizon + 0.5 / context.sampleRate) throw new Error('Arrangement lookahead missed a scheduling window');
      lastPump = now;
      const limit = now + horizon;
      const sampleRate = context.sampleRate;
      const reach = Math.min(MAX_TRANSPORT_BEATS, tempoBeat(Math.max(0, limit - origin), map));
      if (reach > cursor) { generate(cursor, reach); cursor = reach; }
      let dispatched = 0;
      while (queue.length > 0 && state === 'running') {
        const command = queue[0]!;
        const at = Math.round(audioTime(command.beat) * sampleRate) / sampleRate;
        if (at >= limit) break;
        if (++dispatched > MAX_SEQUENCE_SLOTS) throw new RangeError('Arrangement exceeds lookahead command density');
        queue.shift();
        if (at < now - 0.5 / sampleRate) throw new Error('Arrangement lookahead missed a score event');
        const gate = command.gate;
        if (command.order === 1) {
          if (owned.size >= MAX_SEQUENCE_NOTES) throw new RangeError('Arrangement exceeds outstanding note capacity');
          const note = gate.track.note;
          terminal = undefined;
          admitting = true;
          let id: number;
          const token = generation;
          try {
            id = opm.playNote({ voice: note.voice, note: note.note, velocity: note.velocity, pan: note.pan,
              voicePriority: Math.max(note.voicePriority, gate.pattern.priority), duration: null, at, late: 'drop' });
          } finally { admitting = false; }
          if (terminal === id) {
            if (terminalReason !== 'priority') throw new Error(`Arrangement onset rejected during admission: ${terminalReason ?? 'unknown'}`);
            priorityDrops++;
            continue;
          }
          if (token !== generation || state !== 'running') { opm.stop(id); return; }
          gate.id = id;
          owned.set(id, gate);
          scheduleNext(gate);
        } else if (gate.id !== undefined && owned.has(gate.id)) {
          if (command.order === 0) { gate.offAt = at; opm.stop(gate.id, { at }); }
          else {
            opm.updateNote(gate.id, command.controls!, { at });
            if (owned.has(gate.id) && state === 'running') scheduleNext(gate);
          }
        }
      }
      const played = Math.min(MAX_TRANSPORT_BEATS, tempoBeat(Math.max(0, now - origin), map));
      changes = changes.filter((change, index) => index === changes.length - 1 || changes[index + 1]!.beat > played + EPSILON);
      if (state === 'running') timer = setTimeout(pump, interval * 1000);
    } catch (error) { fail(error); }
  }
  function initialize(): void {
    context = opm.context;
    node = opm.node;
    if (!context || !node || context.state !== 'running') throw new Error('Arrangement requires a running AudioContext');
    lastPump = context.currentTime;
    origin = context.currentTime + lead - tempoSeconds(position, map);
    cursor = position;
    queue = [];
    // Resume with the effective layer set at the resume beat; later pending changes remain scheduled.
    const current = effective(position);
    changes = [{ ...current, beat: 0 }, ...changes.filter(change => change.beat > position + EPSILON)];
    state = 'running';
    pump();
    if (state !== 'running') throw new Error('Arrangement failed to start');
  }
  function start(): Promise<void> {
    ensure();
    if (starting) return starting;
    if (state === 'running') return Promise.resolve();
    const token = ++generation;
    state = 'starting';
    const pending = opm.start().then(() => {
      if (token !== generation || state === 'disposed') return;
      initialize();
    }).catch(error => {
      if (token === generation && state !== 'disposed') fail(error);
      throw error;
    });
    starting = pending;
    const clear = () => { if (starting === pending) starting = undefined; };
    pending.then(clear, clear);
    return pending;
  }
  function boundary(options: ArrangementChangeOptions | undefined): { beat: number; preserve: boolean } {
    const data = sequenceOwnData(options ?? {}, ['quantize', 'preserveNotes'], [], 'arrangement change options');
    if (data.preserveNotes !== undefined && typeof data.preserveNotes !== 'boolean') throw new TypeError('preserveNotes must be boolean');
    const mode = data.quantize === undefined ? 'bar' : data.quantize;
    const quantum = mode === 'beat' ? 1 : mode === 'bar' ? barBeats : transportNumber(mode, 1 / 1024, MAX_LAYER_LENGTH, 'quantize');
    const last = changes[changes.length - 1]!;
    const floor = state === 'running' ? Math.max(cursor, nowBeat(), last.beat) : position;
    return { beat: state === 'running' ? quantizeBeat(floor, quantum, 'ceil') : position, preserve: data.preserveNotes === true };
  }
  function commit(section: string, layers: ReadonlySet<string>, options: ArrangementChangeOptions | undefined): number {
    ensure();
    const { beat, preserve } = boundary(options);
    if (state !== 'running') {
      changes = [{ beat: 0, section, layers }];
      return beat;
    }
    const previous = changes[changes.length - 1]!;
    let before = changes[0]!;
    for (const change of changes) if (change.beat < beat - EPSILON) before = change; else break;
    if (previous.beat === beat) changes[changes.length - 1] = { beat, section, layers };
    else changes.push({ beat, section, layers });
    if (!preserve) {
      const truncated = [...patterns.keys()].filter(layer => before.layers.has(layer) && !layers.has(layer));
      for (const gate of new Set([...queue.map(command => command.gate), ...owned.values()])) {
        if (!truncated.includes(gate.pattern.name) || gate.end <= beat + EPSILON || gate.start >= beat) continue;
        gate.end = beat;
        if (gate.offAt === undefined) {
          // Keep controls that still occur before the boundary; the natural release is replaced.
          queue = queue.filter(command => command.gate !== gate || command.order === 1 || command.order === 2 && command.beat < beat);
          if (gate.id !== undefined && !queue.some(command => command.gate === gate && command.order === 2)) {
            insert({ beat, order: 0, gate });
          }
        } else if (gate.id !== undefined && owned.has(gate.id)) {
          // The natural release was already admitted; an earlier explicit stop supersedes it.
          gate.offAt = Math.max(context!.currentTime, Math.min(gate.offAt, audioTime(beat)));
          opm.stop(gate.id, { at: gate.offAt });
        }
      }
    }
    return beat;
  }
  function layersAfter(): { section: string; layers: Set<string> } {
    const last = changes[changes.length - 1]!;
    return { section: last.section, layers: new Set(last.layers) };
  }
  // Keep the current beat on the current audio time; commands not yet admitted follow the new map.
  function replaceTempo(next: readonly Readonly<TempoPoint>[]): void {
    const beat = nowBeat();
    map = next;
    if (state === 'running' && context) origin = context.currentTime - tempoSeconds(beat, next);
  }
  const api: Arrangement = {
    get state() { return state; },
    get snapshot(): ArrangementSnapshot {
      const beat = nowBeat();
      const current = effective(beat);
      return Object.freeze({
        state, position: beat, musicalPosition: beatToBarBeat(beat, signature), section: current.section,
        layers: Object.freeze([...current.layers]), priorityDrops, tempoMap: map,
        pending: Object.freeze(changes.filter(change => change.beat > beat + EPSILON).map(change => Object.freeze({
          beat: change.beat, section: change.section, layers: Object.freeze([...change.layers]) }))),
      });
    },
    start,
    resume: start,
    pause() { ensure(); cancel('paused'); },
    stop() { if (state !== 'disposed') { cancel('stopped', 0); changes = [{ beat: 0, section: initial, layers: sections.get(initial)! }]; } },
    switchSection(sectionName, change) {
      const target = sections.get(name(sectionName, 'section'));
      if (!target) throw new RangeError('Unknown arrangement section');
      return commit(sectionName, target, change);
    },
    setLayer(layerName, enabled, change) {
      ensure();
      name(layerName, 'layer');
      if (!patterns.has(layerName)) throw new RangeError('Unknown arrangement layer');
      if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
      const next = layersAfter();
      if (enabled) next.layers.add(layerName); else next.layers.delete(layerName);
      return commit(next.section, next.layers, change);
    },
    setTempo(bpm) {
      ensure();
      transportNumber(bpm, 1, 1000, 'bpm');
      replaceTempo(replaceTempoFrom(nowBeat(), bpm, map));
    },
    setTempoMap(input) { ensure(); replaceTempo(normalizeTempoMap(input)); },
    pump,
    dispose() {
      if (state === 'disposed') return;
      try { cancel('disposed'); } finally { unsubscribe(); }
    },
  };
  return Object.freeze(api);
}
