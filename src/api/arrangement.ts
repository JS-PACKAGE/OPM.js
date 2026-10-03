import type { OPM, OPMEvent } from './index.js';
import { MAX_ARRANGEMENT_LAYER_LENGTH as MAX_LAYER_LENGTH, arrangementName as name, prepareArrangementDefinition } from '../core/arrangement-definition.js';
import type { ArrangementDefinition } from '../core/arrangement-definition.js';
export type { ArrangementLayer, ArrangementSection } from '../core/arrangement-definition.js';
import { MAX_LONG_SEQUENCE_EVENTS, MAX_SEQUENCE_NOTES, MAX_SEQUENCE_SLOTS, sequenceOwnData } from '../core/sequence.js';
import type { PreparedSequenceEvent } from '../core/sequence.js';
import type { NoteControls } from '../core/synth.js';
import {
  MAX_TRANSPORT_BEATS, normalizeTempoMap, quantizeBeat, tempoBeat, tempoSeconds,
  beatToBarBeat, replaceTempoFrom, transportNumber,
} from '../core/transport.js';
import type { BarBeat, TempoPoint } from '../core/transport.js';

export interface ArrangementOptions extends ArrangementDefinition {
  bpm?: number;
  horizon?: number;
  interval?: number;
  onError?: (error: Error) => void;
}
export interface ArrangementChangeOptions {
  /** Boundary in quarter notes, or the meter-defined beat/bar; default bar. Never earlier than already admitted notes. */
  quantize?: 'beat' | 'bar' | number;
  /** Removed layers may finish naturally instead of being released at the boundary. Default false. */
  preserveNotes?: boolean;
  /** Linear gain fade in seconds, 0..10; default 0. Shared layers remain continuous. */
  fade?: number;
}
export interface ArrangementGainOptions {
  quantize?: 'beat' | 'bar' | number;
  fade?: number;
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
  setLayerGain(name: string, gain: number, options?: ArrangementGainOptions): number;
  /** Replaces tempo from the current beat onward; notes already admitted keep their admitted audio times. */
  setTempo(bpm: number): void;
  setTempoMap(map: readonly TempoPoint[]): void;
  pump(): void;
  dispose(): void;
}

type Note = Extract<PreparedSequenceEvent, { type: 'note' }>;
interface Pattern { name: string; length: number; priority: number; gain: number; notes: Track[] }
interface Track { note: Note; end: number; controls: { beat: number; controls: NoteControls }[] }
interface Gate { pattern: Pattern; track: Track; start: number; end: number; nextControl: number; id?: number; offAt?: number; cutAt?: number; cutBeat?: number }
interface Command { beat: number; order: 0 | 1 | 2; gate: Gate; controls?: NoteControls; at?: number }
interface Change { beat: number; section: string; layers: ReadonlySet<string> }
interface GainChange { beat: number; layer: string; target: number; fade: number; from: number; at?: number; applied: boolean; forcedFrom?: number; activation?: boolean }

const EPSILON = 1e-9;


/**
 * Looping, quantized adaptive music for one OPM instance. Layers are aligned to the global beat grid, so a layer
 * shared by two sections is one continuous schedule: its sounding gates are neither retriggered nor stopped when
 * unrelated layers change. Changes are committed at a boundary no earlier than the notes already admitted.
 */
export function createArrangement(opm: OPM, options: ArrangementOptions): Arrangement {
  const config = sequenceOwnData(options, ['layers', 'sections', 'initialSection', 'bpm', 'tempoMap', 'timeSignature', 'horizon', 'interval', 'onError'],
    ['layers', 'sections', 'initialSection'], 'arrangement options');
  const { definition, scores } = prepareArrangementDefinition({
    layers: config.layers, sections: config.sections, initialSection: config.initialSection,
    bpm: config.bpm, tempoMap: config.tempoMap, timeSignature: config.timeSignature,
  }, opm.voices);
  let map = definition.tempoMap;
  const signature = definition.timeSignature;
  const horizon = transportNumber(config.horizon === undefined ? 0.2 : config.horizon, 0.01, 10, 'horizon');
  const interval = transportNumber(config.interval === undefined ? Math.min(0.025, horizon / 2) : config.interval, 0.001, horizon / 2, 'interval');
  if (config.onError !== undefined && typeof config.onError !== 'function') throw new TypeError('onError must be a function');
  const onError = config.onError as ((error: Error) => void) | undefined;

  const patterns = new Map<string, Pattern>();
  for (let index = 0; index < definition.layers.length; index++) {
    const layer = definition.layers[index]!;
    const score = scores[index]!;
    const tracks = new Map<number, Track>();
    for (const event of score.events) if (event.type === 'note') {
      tracks.set(event.id, { note: event, end: event.time + event.duration, controls: [] });
    }
    for (const event of score.events) {
      const track = tracks.get(event.id)!;
      if (event.type === 'stop') track.end = Math.min(track.end, event.time);
      else if (event.type === 'control') {
        track.controls.push({ beat: Math.max(event.time, track.note.time), controls: event.controls });
      }
    }
    for (const track of tracks.values()) {
      track.controls = track.controls.filter(control => control.beat >= track.note.time);
      track.controls.sort((a, b) => a.beat - b.beat);
    }
    patterns.set(layer.name, { name: layer.name, length: layer.length, priority: layer.voicePriority, gain: layer.gain,
      notes: [...tracks.values()].sort((a, b) => a.note.time - b.note.time || a.note.id - b.note.id) });
  }
  const sections = new Map<string, ReadonlySet<string>>(definition.sections.map(section => [section.name, new Set(section.layers)]));
  const initial = definition.initialSection;

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
  let anchor = 0;
  let gains: GainChange[] = initialGains();

  function initialGains(): GainChange[] {
    return [...patterns.values()].map(pattern => ({ beat: 0, layer: pattern.name,
      target: sections.get(initial)!.has(pattern.name) ? pattern.gain : 0, fade: 0, from: 0, applied: true }));
  }
  function gainAt(layer: string, at: number, before?: GainChange): { value: number; target: number; remaining: number } {
    let value = 0;
    let target = 0;
    let remaining = 0;
    for (const change of gains) {
      if (change === before) break;
      if (change.layer !== layer) continue;
      const begin = change.at ?? audioTime(change.beat);
      if (begin > at + EPSILON) break;
      const progress = change.fade === 0 ? 1 : Math.max(0, Math.min(1, (at - begin) / change.fade));
      value = change.from + (change.target - change.from) * progress;
      target = change.target;
      remaining = Math.max(0, begin + change.fade - at);
    }
    return { value, target, remaining };
  }
  function addGain(layer: string, target: number, beat: number, fade: number, activation = false): void {
    if (gains.length >= MAX_SEQUENCE_SLOTS) throw new RangeError('Arrangement exceeds pending gain capacity');
    const at = audioTime(beat);
    const from = gainAt(layer, at).value;
    gains.push({ beat, layer, target, fade, from, applied: false, activation });
    gains.sort((a, b) => a.beat - b.beat);
  }
  function applyGain(id: number, value: number, target: number, remaining: number, at: number): number {
    opm.updateNote(id, { gain: remaining > 0 ? value : target }, { at });
    if (remaining > 0) opm.updateNote(id, { gain: target, ramp: remaining }, { at });
    return remaining > 0 ? 2 : 1;
  }

  const barBeats = signature.numerator * 4 / signature.denominator;
  function ensure(): void { if (state === 'disposed') throw new Error('Arrangement is disposed'); }
  function nowBeat(): number {
    if (state !== 'running' || !context) return position;
    if (context.currentTime <= anchor) return position;
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
      const before = previous.at ?? audioTime(previous.beat);
      const after = command.at ?? audioTime(command.beat);
      if (before < after || before === after && previous.order <= command.order) break;
      index--;
    }
    queue.splice(index, 0, command);
  }
  function scheduleNext(gate: Gate): void {
    const control = gate.track.controls[gate.nextControl++];
    const beat = control ? gate.start - gate.track.note.time + control.beat : gate.end;
    if (control && (gate.cutAt === undefined || audioTime(beat) < gate.cutAt)) {
      insert({ beat, order: 2, gate, controls: control.controls });
    }
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
    if (state === 'running' && context) {
      const at = Math.max(anchor, context.currentTime);
      const future = gains.filter(change => change.beat > beat + EPSILON).map(change => ({ ...change, at: undefined, applied: false }));
      gains = [...patterns.keys()].map(layer => {
        const current = gainAt(layer, at);
        return { beat, layer, from: current.value, target: current.target, fade: current.remaining, applied: true };
      });
      gains.push(...future);
    }
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
      const admitGains = (until: number): void => {
        for (const change of gains) {
          if (change.applied) continue;
          const at = Math.round(audioTime(change.beat) * sampleRate) / sampleRate;
          if (at > until || at >= limit) continue;
          change.from = change.forcedFrom ?? gainAt(change.layer, at, change).value;
          if (at < now - 0.5 / sampleRate) throw new Error('Arrangement lookahead missed a layer gain event');
          change.at = at;
          change.applied = true;
          for (const [id, gate] of owned) if (gate.pattern.name === change.layer) {
            const count = change.fade > 0 ? 2 : 1;
            if (dispatched + count > MAX_SEQUENCE_SLOTS) throw new RangeError('Arrangement exceeds lookahead command density');
            dispatched += applyGain(id, change.from, change.target, change.fade, at);
          }
        }
      };
      while (queue.length > 0 && state === 'running') {
        const command = queue[0]!;
        const at = Math.round((command.at ?? audioTime(command.beat)) * sampleRate) / sampleRate;
        if (at >= limit) break;
        admitGains(at);
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
          const gain = gainAt(gate.pattern.name, at);
          if (gain.value !== 1 || gain.remaining > 0) {
            const count = gain.remaining > 0 ? 2 : 1;
            if (dispatched + count > MAX_SEQUENCE_SLOTS) throw new RangeError('Arrangement exceeds lookahead command density');
            dispatched += applyGain(id, gain.value, gain.target, gain.remaining, at);
          }
          scheduleNext(gate);
          insert({ beat: gate.end, order: 0, gate, at: gate.cutAt });
        } else if (gate.id !== undefined && owned.has(gate.id)) {
          if (command.order === 0) { gate.offAt = at; opm.stop(gate.id, { at }); }
          else {
            opm.updateNote(gate.id, command.controls!, { at });
            if (owned.has(gate.id) && state === 'running') scheduleNext(gate);
          }
        }
      }
      admitGains(limit);
      const played = nowBeat();
      changes = changes.filter((change, index) => index === changes.length - 1 || changes[index + 1]!.beat > played + EPSILON);
      gains = gains.filter((change, index) => !gains.slice(index + 1).some(next =>
        next.layer === change.layer && next.beat <= played + EPSILON));
      if (state === 'running') timer = setTimeout(pump, interval * 1000);
    } catch (error) { fail(error); }
  }
  function initialize(): void {
    context = opm.context;
    node = opm.node;
    if (!context || !node || context.state !== 'running') throw new Error('Arrangement requires a running AudioContext');
    lastPump = context.currentTime;
    anchor = context.currentTime + lead;
    origin = anchor - tempoSeconds(position, map);
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
  function boundary(options: ArrangementChangeOptions | undefined): { beat: number; preserve: boolean; fade: number } {
    const data = sequenceOwnData(options ?? {}, ['quantize', 'preserveNotes', 'fade'], [], 'arrangement change options');
    if (data.preserveNotes !== undefined && typeof data.preserveNotes !== 'boolean') throw new TypeError('preserveNotes must be boolean');
    const fade = data.fade === undefined ? 0 : transportNumber(data.fade, 0, 10, 'fade');
    const mode = data.quantize === undefined ? 'bar' : data.quantize;
    const quantum = mode === 'beat' ? 1 : mode === 'bar' ? barBeats : transportNumber(mode, 1 / 1024, MAX_LAYER_LENGTH, 'quantize');
    const last = changes[changes.length - 1]!;
    const gainBeat = gains.reduce((maximum, change) => Math.max(maximum, change.beat), 0);
    const floor = state === 'running' ? Math.max(cursor, nowBeat(), last.beat, gainBeat) : position;
    return { beat: state === 'running' ? quantizeBeat(floor, quantum, 'ceil') : position, preserve: data.preserveNotes === true, fade };
  }
  function commit(section: string, layers: ReadonlySet<string>, options: ArrangementChangeOptions | undefined): number {
    ensure();
    const { beat, preserve, fade } = boundary(options);
    if (state !== 'running') {
      changes = [{ beat: 0, section, layers }];
      gains = [...patterns.values()].map(pattern => ({ beat: position, layer: pattern.name, from: 0,
        target: layers.has(pattern.name) ? pattern.gain : 0, fade: 0, applied: true }));
      return beat;
    }
    const previous = changes[changes.length - 1]!;
    let before = changes[0]!;
    for (const change of changes) if (change.beat < beat - EPSILON) before = change; else break;
    if (changes.length >= MAX_SEQUENCE_SLOTS || gains.length + patterns.size > MAX_SEQUENCE_SLOTS) {
      throw new RangeError('Arrangement exceeds pending change capacity');
    }
    if (previous.beat === beat) {
      // An unadmitted boundary can be retargeted repeatedly without leaving an obsolete cut or fade behind.
      gains = gains.filter(change => !change.activation || change.beat !== beat);
      for (const gate of new Set([...queue.map(command => command.gate), ...owned.values()])) {
        if (gate.cutBeat !== beat || gate.offAt !== undefined) continue;
        gate.end = gate.start - gate.track.note.time + gate.track.end;
        gate.cutAt = undefined;
        gate.cutBeat = undefined;
        queue = queue.filter(command => command.gate !== gate || command.order === 1 || command.order === 2 && command.beat < beat);
        gate.nextControl = gate.track.controls.findIndex(control => gate.start - gate.track.note.time + control.beat >= beat);
        if (gate.nextControl < 0) gate.nextControl = gate.track.controls.length;
        if (gate.id !== undefined) {
          insert({ beat: gate.end, order: 0, gate });
          if (!queue.some(command => command.gate === gate && command.order === 2)) scheduleNext(gate);
        }
      }
    }
    if (previous.beat === beat) changes[changes.length - 1] = { beat, section, layers };
    else changes.push({ beat, section, layers });
    for (const pattern of patterns.values()) {
      if (before.layers.has(pattern.name) !== layers.has(pattern.name) && (layers.has(pattern.name) || fade > 0)) {
        addGain(pattern.name, layers.has(pattern.name) ? pattern.gain : 0, beat, fade, true);
        if (layers.has(pattern.name) && fade > 0) {
          const timeline = gains.filter(change => change.layer === pattern.name);
          const latest = timeline.at(-1)!;
          if (timeline.at(-2)?.target !== 0) { latest.from = 0; latest.forcedFrom = 0; }
        }
      }
    }
    if (!preserve) {
      const truncated = [...patterns.keys()].filter(layer => before.layers.has(layer) && !layers.has(layer));
      const stopAt = audioTime(beat) + fade;
      const stopBeat = tempoBeat(Math.max(0, stopAt - origin), map);
      for (const gate of new Set([...queue.map(command => command.gate), ...owned.values()])) {
        if (!truncated.includes(gate.pattern.name) || gate.end <= stopBeat + EPSILON || gate.start >= beat) continue;
        gate.end = stopBeat;
        gate.cutAt = stopAt;
        gate.cutBeat = beat;
        if (gate.offAt === undefined) {
          // Preserve independent controls throughout the fade; release after the seconds-based envelope.
          queue = queue.filter(command => command.gate !== gate || command.order === 1 || command.order === 2 && command.beat < stopBeat);
          if (gate.id !== undefined) {
            insert({ beat: stopBeat, order: 0, gate, at: stopAt });
          }
        } else if (gate.id !== undefined && owned.has(gate.id)) {
          // The natural release was already admitted; an earlier explicit stop supersedes it.
          gate.offAt = Math.max(context!.currentTime, Math.min(gate.offAt, stopAt));
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
    if (state === 'running' && context) origin = Math.max(anchor, context.currentTime) - tempoSeconds(beat, next);
    queue.sort((a, b) => (a.at ?? audioTime(a.beat)) - (b.at ?? audioTime(b.beat)) || a.order - b.order);
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
    stop() {
      if (state !== 'disposed') {
        cancel('stopped', 0);
        changes = [{ beat: 0, section: initial, layers: sections.get(initial)! }];
        gains = initialGains();
      }
    },
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
    setLayerGain(layerName, value, options) {
      ensure();
      name(layerName, 'layer');
      const pattern = patterns.get(layerName);
      if (!pattern) throw new RangeError('Unknown arrangement layer');
      const gain = transportNumber(value, 0, 1, 'layer gain');
      const data = sequenceOwnData(options ?? {}, ['quantize', 'fade'], [], 'arrangement gain options');
      const { beat, fade } = boundary(data as ArrangementChangeOptions);
      if (state === 'running') {
        addGain(layerName, effective(beat).layers.has(layerName) ? gain : 0, beat, fade);
      } else {
        gains = gains.filter(change => change.layer !== layerName);
        gains.push({ beat: position, layer: layerName, from: gain,
          target: effective(position).layers.has(layerName) ? gain : 0, fade: 0, applied: true });
        gains.sort((a, b) => a.beat - b.beat);
      }
      pattern.gain = gain;
      return beat;
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
