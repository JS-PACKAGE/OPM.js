import type { OPM, OPMEvent } from './index.js';
import { prepareLongSequence, sequenceOwnData, MAX_LONG_SEQUENCE_EVENTS, MAX_SEQUENCE_NOTES } from '../core/sequence.js';
import type { SequenceEvent, PreparedSequenceEvent } from '../core/sequence.js';
import type { NoteControls } from '../core/synth.js';
import {
  MAX_TRANSPORT_BEATS, transportArray, transportNumber, normalizeTempoMap, normalizeTimeSignature,
  tempoSeconds, tempoBeat, beatToBarBeat, replaceTempoFrom, swingBeat,
} from '../core/transport.js';
import type { TempoPoint, TimeSignature, BarBeat } from '../core/transport.js';
export { beatsToSeconds, secondsToBeats, beatToBarBeat, barBeatToBeat, normalizeTempoMap, quantizeBeat, swingBeat } from '../core/transport.js';
export type { TempoPoint, TimeSignature, BarBeat, BeatQuantization } from '../core/transport.js';

export type BeatSequenceEvent = SequenceEvent extends infer E ? E extends SequenceEvent ? Omit<E, 'time'> & { beat: number } : never : never;
export interface TransportLoop { enabled: boolean; from: number; to: number }
export type TransportState = 'stopped' | 'starting' | 'running' | 'paused' | 'disposed';
export interface TransportOptions {
  bpm?: number;
  tempoMap?: readonly TempoPoint[];
  timeSignature?: TimeSignature;
  loop?: TransportLoop;
  horizon?: number;
  interval?: number;
  maxSlots?: number;
  onError?: (error: Error) => void;
}
export interface TransportSnapshot {
  readonly position: number;
  readonly musicalPosition: Readonly<BarBeat>;
  readonly state: TransportState;
  readonly running: boolean;
  readonly tempoMap: readonly Readonly<TempoPoint>[];
  readonly timeSignature: Readonly<TimeSignature>;
  readonly loop: Readonly<TransportLoop>;
}
export interface MusicalTransport {
  readonly position: number;
  readonly running: boolean;
  readonly state: TransportState;
  readonly snapshot: TransportSnapshot;
  readonly ids: ReadonlyMap<number, number>;
  start(): Promise<void>;
  resume(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(beat: number): void;
  /** Replace the tempo from the current musical position onward; retain preceding points. */
  setTempo(bpm: number): void;
  setTempoMap(map: readonly TempoPoint[]): void;
  setLoop(loop: TransportLoop): void;
  pump(): void;
  dispose(): void;
}

type Note = Extract<PreparedSequenceEvent, { type: 'note' }>;
type Control = Extract<PreparedSequenceEvent, { type: 'control' }>;
interface Track { note: Note; end: number; controls: Control[] }
interface Gate { track: Track; id?: number }
interface Command { at: number; order: number; gate: Gate; controls?: NoteControls }
const fields = ['pitch', 'expression', 'pan', 'modulation', 'feedback', 'lfoRate', 'amDepth', 'pmDepth'] as const;

function readLoop(input: TransportLoop | undefined): Readonly<TransportLoop> {
  if (input === undefined) return Object.freeze({ enabled: false, from: 0, to: 4 });
  const data = sequenceOwnData(input, ['enabled', 'from', 'to'], ['enabled', 'from', 'to'], 'transport loop');
  if (typeof data.enabled !== 'boolean') throw new TypeError('loop enabled must be boolean');
  const from = transportNumber(data.from, 0, MAX_TRANSPORT_BEATS, 'loop from');
  const to = transportNumber(data.to, 0, MAX_TRANSPORT_BEATS, 'loop to');
  if (to <= from) throw new RangeError('loop to must exceed from');
  return Object.freeze({ enabled: data.enabled, from, to });
}

/** Reconstruct linear ramps; fixed-Hz mode and edited ADSR use musical restart semantics. */
function reconstructed(track: Track, beat: number, map: readonly Readonly<TempoPoint>[]): NoteControls[] {
  const voice = track.note.voice;
  const values = [0, 1, track.note.pan, 1, voice.feedback, voice.lfo.rate, voice.lfo.amDepth, voice.lfo.pmDepth,
    1, 1, 1, 1, ...voice.ops.map(op => op.ratio)];
  const ramps = values.map(value => ({ from: value, target: value, at: 0, duration: 0 }));
  const edited = values.map(() => false);
  let frequencies: NoteControls['operatorFrequencies'];
  let adsr: NoteControls['operatorADSR'];
  const sample = (index: number, time: number) => {
    const ramp = ramps[index];
    return ramp.duration === 0 ? ramp.target : ramp.from + (ramp.target - ramp.from) * Math.max(0, Math.min(1, (time - ramp.at) / ramp.duration));
  };
  const onset = tempoSeconds(track.note.time, map);
  for (const event of track.controls) {
    const atBeat = Math.max(track.note.time, event.time);
    if (atBeat > beat) break;
    const at = tempoSeconds(atBeat, map) - onset;
    for (let index = 0; index < values.length; index++) {
      const target = index < 8 ? event.controls[fields[index]]
        : index < 12 ? event.controls.operatorLevels?.[index - 8] : event.controls.operatorRatios?.[index - 12];
      if (target === undefined) continue;
      edited[index] = true;
      ramps[index] = { from: sample(index, at), target, at, duration: index === 0 ? event.controls.glide ?? 0 : event.controls.ramp ?? 0 };
    }
    if (event.controls.operatorFrequencies !== undefined) frequencies = event.controls.operatorFrequencies;
    if (event.controls.operatorADSR !== undefined) adsr = event.controls.operatorADSR;
  }
  const elapsed = tempoSeconds(beat, map) - onset;
  const initial: NoteControls = {
    pitch: sample(0, elapsed), expression: sample(1, elapsed), pan: sample(2, elapsed), modulation: sample(3, elapsed),
    operatorLevels: [sample(8, elapsed), sample(9, elapsed), sample(10, elapsed), sample(11, elapsed)],
  };
  for (let index = 4; index < 8; index++) if (edited[index]) initial[fields[index]] = sample(index, elapsed);
  if (edited[12]) initial.operatorRatios = [sample(12, elapsed), sample(13, elapsed), sample(14, elapsed), sample(15, elapsed)];
  // null resolves against the reconstructed live ratio and the engine's current tuning.
  // The latest fixed/ratio policy wins immediately, rather than fabricating intermediate Hz.
  if (frequencies !== undefined) initial.operatorFrequencies = frequencies;
  if (adsr !== undefined) initial.operatorADSR = adsr;
  const result = [initial];
  // Scalar edits and each tuple can have independent outstanding ramp durations.
  for (let index = 0; index < 8; index++) {
    const ramp = ramps[index];
    const remaining = ramp.at + ramp.duration - elapsed;
    if (remaining > 0 && ramp.target !== sample(index, elapsed)) {
      result.push(index === 0 ? { pitch: ramp.target, glide: remaining } : { [fields[index]]: ramp.target, ramp: remaining });
    }
  }
  for (const index of [8, 12]) {
    const remaining = ramps[index].at + ramps[index].duration - elapsed;
    if (remaining <= 0) continue;
    const tuple: [number, number, number, number] = [ramps[index].target, ramps[index + 1].target, ramps[index + 2].target, ramps[index + 3].target];
    result.push(index === 8 ? { operatorLevels: tuple, ramp: remaining } : { operatorRatios: tuple, ramp: remaining });
  }
  return result;
}

/** Internal shared preparation: beat durations remain beats until admitted to the audio clock. */
export function prepareBeatEvents(opm: OPM, beatEvents: readonly BeatSequenceEvent[]) {
  const input = transportArray(beatEvents, MAX_LONG_SEQUENCE_EVENTS, 'beat events').map(event => {
    const type = event !== null && typeof event === 'object' ? Object.getOwnPropertyDescriptor(event, 'type')?.value : undefined;
    const keys = type === 'note' ? ['type', 'id', 'beat', 'duration', 'voice', 'note', 'velocity', 'pan', 'voicePriority']
      : type === 'control' ? ['type', 'id', 'beat', 'controls'] : type === 'stop' ? ['type', 'id', 'beat'] : [];
    const data = sequenceOwnData(event, keys, ['type', 'id', 'beat'], 'beat event');
    const beat = transportNumber(data.beat, 0, MAX_TRANSPORT_BEATS, 'event beat');
    if (data.type === 'note') transportNumber(data.duration, 0, MAX_TRANSPORT_BEATS - beat, 'note duration');
    const { beat: _beat, ...rest } = data;
    return { ...rest, time: beat } as unknown as SequenceEvent;
  });
  return prepareLongSequence(input, { voices: opm.voices });
}

/** Swing note starts AND ends, so adjacent gates retain their musical ordering. */
export function swingBeatEvents(events: readonly BeatSequenceEvent[], subdivision = 0.5, ratio = 2 / 3): BeatSequenceEvent[] {
  swingBeat(0, subdivision, ratio);
  return transportArray(events, MAX_LONG_SEQUENCE_EVENTS, 'beat events').map(event => {
    const type = event !== null && typeof event === 'object' ? Object.getOwnPropertyDescriptor(event, 'type')?.value : undefined;
    const keys = type === 'note' ? ['type', 'id', 'beat', 'duration', 'voice', 'note', 'velocity', 'pan', 'voicePriority']
      : type === 'control' ? ['type', 'id', 'beat', 'controls'] : ['type', 'id', 'beat'];
    const data = sequenceOwnData(event, keys, ['type', 'id', 'beat'], 'beat event');
    const beat = transportNumber(data.beat, 0, MAX_TRANSPORT_BEATS, 'event beat');
    const swung = swingBeat(beat, subdivision, ratio);
    if (type === 'note') {
      const duration = transportNumber(data.duration, 0, MAX_TRANSPORT_BEATS - beat, 'note duration');
      return { ...data, beat: swung, duration: swingBeat(beat + duration, subdivision, ratio) - swung } as unknown as BeatSequenceEvent;
    }
    if (type !== 'control' && type !== 'stop') throw new TypeError('invalid beat event type');
    return { ...data, beat: swung } as unknown as BeatSequenceEvent;
  });
}

/** Restartable beat transport. Only owned IDs are ever stopped; the shared engine is not closed. */
export function createTransport(opm: OPM, beatEvents: readonly BeatSequenceEvent[], options: TransportOptions = {}): MusicalTransport {
  const config = sequenceOwnData(options, ['bpm', 'tempoMap', 'timeSignature', 'loop', 'horizon', 'interval', 'maxSlots', 'onError'], [], 'transport options');
  let map = normalizeTempoMap(config.tempoMap as readonly TempoPoint[] | undefined, config.bpm === undefined ? 120 : config.bpm as number);
  const signature = normalizeTimeSignature(config.timeSignature as TimeSignature | undefined);
  let loop = readLoop(config.loop as TransportLoop | undefined);
  const horizon = transportNumber(config.horizon === undefined ? 0.2 : config.horizon, 0.01, 10, 'horizon');
  const interval = transportNumber(config.interval === undefined ? Math.min(0.025, horizon / 2) : config.interval, 0.001, horizon / 2, 'interval');
  const maxSlots = transportNumber(config.maxSlots === undefined ? 256 : config.maxSlots, 1, 256, 'maxSlots');
  if (!Number.isInteger(maxSlots)) throw new RangeError('maxSlots must be an integer');
  if (config.onError !== undefined && typeof config.onError !== 'function') throw new TypeError('onError must be a function');
  const onError = config.onError as ((error: Error) => void) | undefined;
  const score = prepareBeatEvents(opm, beatEvents);
  const tracks = new Map<number, Track>();
  for (const event of score.events) if (event.type === 'note') tracks.set(event.id, { note: event, end: event.time + event.duration, controls: [] });
  for (const event of score.events) {
    if (event.type === 'stop') tracks.get(event.id)!.end = Math.min(tracks.get(event.id)!.end, event.time);
    else if (event.type === 'control') tracks.get(event.id)!.controls.push(event);
  }
  for (const track of tracks.values()) track.controls.sort((a, b) => Math.max(a.time, track.note.time) - Math.max(b.time, track.note.time));
  const endBeat = score.endTime;
  let state: TransportState = 'stopped';
  let position = 0;
  let origin = 0;
  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let generation = 0;
  let starting: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Command[] = [];
  let cursor = 0;
  let segmentEnd = 0;
  let queued: { at: number; id: number }[] = [];
  const owned = new Map<number, Gate>();
  let admitting = false;
  let terminal: number | undefined;
  let lastError: Error | undefined;
  let lastPump = 0;

  function commands(from: number, to: number, at: number, tempo: readonly Readonly<TempoPoint>[], includeEndpoint = false): Command[] {
    const result: Command[] = [];
    const offset = tempoSeconds(from, tempo);
    for (const track of tracks.values()) {
      if (track.end <= from || track.end <= track.note.time || track.note.time >= to) continue;
      const gate: Gate = { track };
      const begin = Math.max(from, track.note.time);
      const onset = at + tempoSeconds(begin, tempo) - offset;
      result.push({ at: onset, order: 1, gate });
      if (track.note.time <= from && track.controls.some(event => Math.max(track.note.time, event.time) <= from)) {
        for (const controls of reconstructed(track, from, tempo)) result.push({ at: onset, order: 2, gate, controls });
      }
      for (const event of track.controls) {
        const beat = Math.max(event.time, track.note.time);
        if (beat < begin || track.note.time <= from && beat === from || beat > to || beat === to && !includeEndpoint) continue;
        result.push({ at: at + tempoSeconds(beat, tempo) - offset, order: 2, gate, controls: event.controls });
      }
      result.push({ at: at + tempoSeconds(Math.min(track.end, to), tempo) - offset, order: 0, gate });
    }
    result.sort((a, b) => a.at - b.at || a.order - b.order);
    return result;
  }
  function density(events: Command[]): void {
    let left = 0;
    let notes = 0;
    for (let right = 0; right < events.length; right++) {
      if (events[right].order === 1) notes++;
      while (events[right].at - events[left].at >= horizon) {
        if (events[left].order === 1) notes--;
        left++;
      }
      if (right - left + 1 > maxSlots || notes > MAX_SEQUENCE_NOTES) throw new RangeError('Transport score exceeds lookahead density');
    }
  }
  function preflight(tempo: readonly Readonly<TempoPoint>[], repeat: Readonly<TransportLoop>, from: number): void {
    const start = repeat.enabled && from >= repeat.to ? repeat.from : from;
    density(commands(start, repeat.enabled ? repeat.to : endBeat, 0, tempo, !repeat.enabled));
    if (!repeat.enabled) return;
    const duration = tempoSeconds(repeat.to, tempo) - tempoSeconds(repeat.from, tempo);
    if (duration < horizon / 32) throw new RangeError('Transport loop exceeds bounded wraps per window');
    const base = commands(repeat.from, repeat.to, 0, tempo);
    density(base);
    const events: Command[] = [];
    // Inspect both sides of a seam, including several repetitions of short loops.
    for (let at = -duration; at < horizon; at += duration) {
      for (const command of base) {
        const shifted = command.at + at;
        if (shifted >= -horizon && shifted < horizon) events.push({ ...command, at: shifted });
      }
      if (events.length > maxSlots * 4 + 32) throw new RangeError('Transport loop exceeds lookahead density');
    }
    events.sort((a, b) => a.at - b.at || a.order - b.order);
    density(events);
  }
  preflight(map, loop, 0);

  function current(): number {
    if (state !== 'running' || !context) return position;
    let seconds = Math.max(0, context.currentTime - origin);
    if (loop.enabled) {
      const to = tempoSeconds(loop.to, map);
      const from = tempoSeconds(loop.from, map);
      if (seconds >= to) seconds = from + (seconds - to) % (to - from);
    } else seconds = Math.min(seconds, tempoSeconds(endBeat, map));
    return Math.min(MAX_TRANSPORT_BEATS, tempoBeat(seconds, map));
  }
  function ensure(): void { if (state === 'disposed') throw new Error('Transport is disposed'); }
  function cancel(next: TransportState, beat = current(), release = true): void {
    generation++;
    starting = undefined;
    state = next;
    position = beat;
    clearTimeout(timer);
    timer = undefined;
    queue = [];
    queued = [];
    const ids = [...owned.keys()];
    owned.clear();
    let failure: unknown;
    if (release && opm.context === context && opm.node === node && context?.state !== 'closed') {
      for (const id of ids) try { opm.stop(id, { cancelControls: true }); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  }
  function fail(error: unknown): void {
    lastError = error instanceof Error ? error : new Error(String(error));
    try { cancel('stopped'); } catch { /* Preserve the original scheduling failure. */ }
    onError?.(lastError);
  }
  const observe = (event: OPMEvent): void => {
    if (state === 'disposed') return;
    if (event.type === 'reset') { cancel('stopped', current(), false); return; }
    if (event.type === 'context' && event.state !== 'running') {
      if (state === 'running' || state === 'starting') fail(new Error(`Transport AudioContext is ${event.state}; restart from a user gesture`));
      return;
    }
    if (event.type === 'command' && event.state === 'rejected' && event.id !== undefined && owned.has(event.id)) {
      fail(new Error(`Transport command rejected: ${event.reason ?? 'unknown'}`));
    }
    if (event.type === 'note' && ['ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) {
      if (admitting) terminal = event.id;
      if (owned.delete(event.id)) {
        queued = queued.filter(entry => entry.id !== event.id);
        if (event.state === 'rejected') fail(new Error(`Transport note rejected: ${event.reason ?? 'unknown'}`));
      }
    }
  };
  const unsubscribe = opm.subscribe(observe);
  function segment(from: number, at: number): void {
    const to = loop.enabled ? loop.to : endBeat;
    queue = commands(from, to, at, map, !loop.enabled);
    cursor = 0;
    segmentEnd = at + tempoSeconds(to, map) - tempoSeconds(from, map);
  }
  function initialize(): void {
    context = opm.context;
    node = opm.node;
    if (!context || !node || context.state !== 'running') throw new Error('Transport requires a running AudioContext');
    if (loop.enabled && position >= loop.to) position = loop.from;
    if (!loop.enabled) position = Math.min(position, endBeat);
    lastError = undefined;
    lastPump = context.currentTime;
    origin = context.currentTime - tempoSeconds(position, map);
    segment(position, context.currentTime);
    state = 'running';
    pump();
    if (state !== 'running' && lastError) throw lastError;
  }
  function pump(): void {
    clearTimeout(timer);
    timer = undefined;
    if (state !== 'running') return;
    try {
      if (!context || context !== opm.context || node !== opm.node || context.state !== 'running') throw new Error('Transport context changed or interrupted');
      const now = context.currentTime;
      if (now - lastPump > horizon + 0.5 / context.sampleRate) throw new Error('Transport lookahead missed a scheduling window');
      lastPump = now;
      const to = now + horizon;
      const sampleRate = context.sampleRate;
      queued = queued.filter(entry => entry.at > now);
      let wraps = 0;
      while (state === 'running') {
        while (cursor < queue.length && queue[cursor].at < to && state === 'running') {
          const command = queue[cursor++];
          if (command.at < now - 0.5 / sampleRate) throw new Error('Transport lookahead missed a score event');
          if (queued.length >= maxSlots) throw new RangeError('Transport exceeds owned queued command capacity');
          const at = Math.round(command.at * sampleRate) / sampleRate;
          if (!Number.isSafeInteger(Math.round(command.at * sampleRate))) throw new RangeError('Transport exceeds safe sample frames');
          const gate = command.gate;
          if (command.order === 1) {
            if (owned.size >= MAX_SEQUENCE_NOTES) throw new RangeError('Transport exceeds outstanding note capacity');
            const note = gate.track.note;
            terminal = undefined;
            admitting = true;
            let id: number;
            const token = generation;
            try { id = opm.playNote({ voice: note.voice, note: note.note, velocity: note.velocity, pan: note.pan, voicePriority: note.voicePriority, duration: null, at, late: 'drop' }); }
            finally { admitting = false; }
            if (terminal === id) throw new Error('Transport onset rejected during admission');
            if (token !== generation || state !== 'running') { opm.stop(id); return; }
            gate.id = id;
            owned.set(id, gate);
          } else if (gate.id !== undefined && owned.has(gate.id)) {
            if (command.order === 0) opm.stop(gate.id, { at });
            else opm.updateNote(gate.id, command.controls!, { at });
          } else continue;
          if (state !== 'running') return;
          queued.push({ at, id: gate.id! });
        }
        if (cursor < queue.length || segmentEnd >= to) break;
        if (!loop.enabled) {
          // Completion leaves admitted release-tail controls/IDs owned until terminal events.
          if (now >= segmentEnd) { state = 'stopped'; position = endBeat; return; }
          break;
        }
        if (segmentEnd < now - 0.5 / sampleRate) throw new Error('Transport lookahead missed a loop window');
        if (++wraps > 32) throw new RangeError('Transport exceeds bounded wraps per window');
        segment(loop.from, segmentEnd);
      }
      timer = setTimeout(pump, interval * 1000);
    } catch (error) { fail(error); }
  }
  function start(): Promise<void> {
    if (state === 'disposed') return Promise.reject(new Error('Transport is disposed'));
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
    void pending.then(() => { if (starting === pending) starting = undefined; }, () => { if (starting === pending) starting = undefined; });
    return pending;
  }
  function edit(tempo: readonly Readonly<TempoPoint>[], repeat: Readonly<TransportLoop>, beat: number): void {
    ensure();
    preflight(tempo, repeat, beat);
    const active = state === 'running';
    const previous = state === 'paused' ? 'paused' : 'stopped';
    cancel(previous, beat);
    map = tempo;
    loop = repeat;
    if (active) try { initialize(); } catch (error) { if (lastError !== error) fail(error); throw error; }
  }
  return Object.freeze({
    get position() { return current(); },
    get running() { return state === 'running'; },
    get state() { return state; },
    get snapshot(): TransportSnapshot {
      const beat = current();
      return Object.freeze({ position: beat, musicalPosition: beatToBarBeat(beat, signature), state, running: state === 'running', tempoMap: map, timeSignature: signature, loop });
    },
    get ids(): ReadonlyMap<number, number> {
      const result = new Map<number, number>();
      for (const [id, gate] of owned) result.set(gate.track.note.id, id);
      return result;
    },
    start,
    resume: start,
    pause() { ensure(); cancel('paused'); },
    stop() { if (state !== 'disposed') cancel('stopped', 0); },
    seek(beat: number) { ensure(); edit(map, loop, transportNumber(beat, 0, Math.max(endBeat, loop.enabled ? loop.to : 0), 'seek beat')); },
    setTempo(bpm: number) {
      ensure();
      transportNumber(bpm, 1, 1000, 'bpm');
      const beat = current();
      edit(replaceTempoFrom(beat, bpm, map), loop, beat);
    },
    setTempoMap(input: readonly TempoPoint[]) { ensure(); edit(normalizeTempoMap(input), loop, current()); },
    setLoop(input: TransportLoop) { ensure(); edit(map, readLoop(input), current()); },
    pump,
    dispose() {
      if (state === 'disposed') return;
      try { cancel('disposed'); } finally { unsubscribe(); }
    },
  });
}
