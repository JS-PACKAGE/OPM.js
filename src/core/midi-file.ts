import type { BeatSequenceEvent } from './sequence.js';
import { sequenceOwnData, MAX_LONG_SEQUENCE_EVENTS } from './sequence.js';
import { MAX_TRANSPORT_BEATS, MAX_TEMPO_POINTS, transportArray, transportNumber, normalizeTempoMap, normalizeTimeSignature } from './transport.js';
import type { TempoPoint, TimeSignature } from './transport.js';

export const MAX_MIDI_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_MIDI_FILE_TRACKS = 128;
/** Counts all wire events, including skipped messages and end-of-track markers. */
export const MAX_MIDI_FILE_EVENTS = 65536;

export type MidiFileWarningCode = 'header-extension' | 'ignored-meta' | 'ignored-sysex' | 'ignored-channel' | 'release-velocity' | 'default-voice' | 'sustain-applied' | 'tempo-conflict' | 'meter-detail' | 'unclosed-notes';
export interface MidiFileWarning { code: MidiFileWarningCode; message: string; count: number }
export interface MidiImportOptions {
  /** Zero-based MIDI channels, written as decimal object keys, to OPM voice names. */
  channelVoices?: Readonly<Record<string, string>>;
  defaultVoice?: string;
  /** Unsupported musical/metadata content is reported, or rejects the entire file. */
  unsupported?: 'warn' | 'reject';
  /** Includes keys held by sustain at the final end-of-track tick. */
  unclosedNotes?: 'reject' | 'close-at-end';
  sustain?: 'apply' | 'reject';
}
export interface MidiImportResult {
  events: BeatSequenceEvent[];
  tempoMap: readonly Readonly<TempoPoint>[];
  timeSignature: Readonly<TimeSignature>;
  warnings: readonly Readonly<MidiFileWarning>[];
}
export interface MidiExportOptions {
  format?: 0 | 1;
  ppqn?: number;
  tempoMap?: readonly TempoPoint[];
  bpm?: number;
  timeSignature?: TimeSignature;
  /** Named voices to zero-based MIDI channels. Only brass -> channel 0 is implicit. */
  voiceChannels?: Readonly<Record<string, number>>;
}

const MAX_VLQ = 0x0fffffff;
const META_LENGTHS: Readonly<Record<number, number>> = { 0: 2, 0x20: 1, 0x21: 1, 0x2f: 0, 0x51: 3, 0x54: 5, 0x58: 4, 0x59: 2 };
const typedPrototype: object = Object.getPrototypeOf(Uint8Array.prototype);
const typedKind = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag)!.get! as (this: unknown) => string | undefined;
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, 'byteLength')!.get! as (this: unknown) => number;
const typedOffset = Object.getOwnPropertyDescriptor(typedPrototype, 'byteOffset')!.get! as (this: unknown) => number;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, 'buffer')!.get! as (this: unknown) => ArrayBuffer;
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get! as (this: unknown) => number;

function voiceName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new TypeError('MIDI voice must be a named voice');
  return value;
}
function channel(value: unknown): number {
  const result = transportNumber(value, 0, 15, 'MIDI channel');
  if (!Number.isInteger(result)) throw new RangeError('MIDI channel must be an integer');
  return result;
}
function dictionary(input: unknown, channels: boolean): Map<string, string | number> {
  const result = new Map<string, string | number>();
  if (input === undefined) return result;
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) throw new TypeError('MIDI mapping must be a plain data object');
  const keys = Reflect.ownKeys(input);
  if (keys.length > (channels ? 16 : 256)) throw new RangeError('MIDI mapping exceeds its entry budget');
  for (const key of keys) {
    if (typeof key !== 'string') throw new TypeError('MIDI mapping keys must be strings');
    if (channels ? !/^(?:[0-9]|1[0-5])$/.test(key) : !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new TypeError('Invalid MIDI mapping key');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('MIDI mapping must contain own data');
    result.set(key, channels ? voiceName(descriptor.value) : channel(descriptor.value));
  }
  return result;
}

class Reader {
  offset: number;
  constructor(readonly view: DataView, readonly end: number, offset = 0) { this.offset = offset; }
  need(length: number): void {
    if (length > this.end - this.offset) throw new RangeError('Truncated MIDI file');
  }
  byte(): number { this.need(1); return this.view.getUint8(this.offset++); }
  data(): number {
    const value = this.byte();
    if (value >= 128) throw new RangeError('MIDI data byte contains a status bit');
    return value;
  }
  u16(): number { this.need(2); const value = this.view.getUint16(this.offset); this.offset += 2; return value; }
  u32(): number { this.need(4); const value = this.view.getUint32(this.offset); this.offset += 4; return value; }
  tag(expected: string): void {
    for (let index = 0; index < expected.length; index++) if (this.byte() !== expected.charCodeAt(index)) throw new TypeError(`Expected MIDI ${expected} chunk`);
  }
  vlq(): number {
    let value = 0;
    for (let count = 0; count < 4; count++) {
      const byte = this.byte();
      value = value * 128 + (byte & 127);
      if (byte < 128) return value;
    }
    throw new RangeError('MIDI VLQ exceeds four bytes');
  }
}
interface WireEvent { tick: number; track: number; order: number; kind: 'on' | 'off' | 'sustain' | 'tempo' | 'meter'; channel: number; a: number; b: number }
type BeatNote = Extract<BeatSequenceEvent, { type: 'note' }>;
interface HeldNote { event: BeatNote; tick: number }
interface NoteQueue { notes: HeldNote[]; head: number }

/** Strict SMF 0/1 PPQN adapter, not a General MIDI synthesizer or device driver. */
export function importMidiFile(source: Uint8Array, options: MidiImportOptions = {}): MidiImportResult {
  const config = sequenceOwnData(options, ['channelVoices', 'defaultVoice', 'unsupported', 'unclosedNotes', 'sustain'], [], 'MIDI import options');
  const voices = dictionary(config.channelVoices, true);
  const fallback = voiceName(config.defaultVoice === undefined ? 'brass' : config.defaultVoice);
  const unsupported = config.unsupported === undefined ? 'warn' : config.unsupported;
  const unclosed = config.unclosedNotes === undefined ? 'reject' : config.unclosedNotes;
  const sustain = config.sustain === undefined ? 'apply' : config.sustain;
  if (unsupported !== 'warn' && unsupported !== 'reject') throw new TypeError('unsupported must be warn or reject');
  if (unclosed !== 'reject' && unclosed !== 'close-at-end') throw new TypeError('unclosedNotes must be reject or close-at-end');
  if (sustain !== 'apply' && sustain !== 'reject') throw new TypeError('sustain must be apply or reject');
  if (typedKind.call(source) !== 'Uint8Array') throw new TypeError('MIDI source must be a native Uint8Array');
  const length = typedLength.call(source);
  if (length > MAX_MIDI_FILE_BYTES) throw new RangeError('MIDI file exceeds byte budget');
  const buffer = typedBuffer.call(source);
  // Shared input could change lengths/status bytes between validation and use.
  try { arrayBufferLength.call(buffer); } catch { throw new TypeError('MIDI source must not use shared memory'); }
  const reader = new Reader(new DataView(buffer, typedOffset.call(source), length), length);
  const warnings = new Map<MidiFileWarningCode, MidiFileWarning>();
  function warn(code: MidiFileWarningCode, message: string, loss = true, count = 1): void {
    if (loss && unsupported === 'reject') throw new RangeError(`Unsupported MIDI content: ${message}`);
    const existing = warnings.get(code);
    if (existing) existing.count += count;
    else warnings.set(code, { code, message, count });
  }
  reader.tag('MThd');
  const headerLength = reader.u32();
  if (headerLength < 6) throw new RangeError('MIDI header must contain six bytes');
  reader.need(headerLength);
  const format = reader.u16();
  const trackCount = reader.u16();
  const ppqn = reader.u16();
  if (format !== 0 && format !== 1) throw new RangeError('Only MIDI format 0 and 1 are supported');
  if (trackCount < 1 || trackCount > MAX_MIDI_FILE_TRACKS || format === 0 && trackCount !== 1) throw new RangeError('Invalid MIDI track count or track budget');
  if (ppqn === 0 || ppqn & 0x8000) throw new RangeError('Only positive PPQN MIDI timing is supported; SMPTE is unsupported');
  if (headerLength > 6) { warn('header-extension', 'Additional MIDI header data was omitted'); reader.offset += headerLength - 6; }
  const wire: WireEvent[] = [];
  let eventCount = 0;
  let tempoCount = 0;
  let endTick = 0;
  for (let track = 0; track < trackCount; track++) {
    reader.tag('MTrk');
    const trackLength = reader.u32();
    reader.need(trackLength);
    const input = new Reader(reader.view, reader.offset + trackLength, reader.offset);
    reader.offset += trackLength;
    let tick = 0;
    let running = 0;
    let ended = false;
    for (let order = 0; input.offset < input.end; order++) {
      if (++eventCount > MAX_MIDI_FILE_EVENTS) throw new RangeError('MIDI file exceeds event budget');
      tick += input.vlq();
      if (tick > MAX_TRANSPORT_BEATS * ppqn) throw new RangeError('MIDI file exceeds beat horizon');
      let status = input.byte();
      let first: number | undefined;
      if (status < 128) {
        if (running === 0) throw new RangeError('MIDI running status has no channel status');
        first = status; status = running;
      } else if (status < 0xf0) running = status;
      else running = 0;
      if (status < 0xf0) {
        const command = status & 0xf0;
        const a = first === undefined ? input.data() : first;
        const b = command === 0xc0 || command === 0xd0 ? 0 : input.data();
        if (command === 0x90 && b > 0) wire.push({ tick, track, order, kind: 'on', channel: status & 15, a, b });
        else if (command === 0x80 || command === 0x90) {
          wire.push({ tick, track, order, kind: 'off', channel: status & 15, a, b });
          if (command === 0x80 && b !== 0) warn('release-velocity', 'Note-off release velocity was omitted');
        } else if (command === 0xb0 && a === 64) {
          if (sustain === 'reject') throw new RangeError('MIDI sustain is rejected by policy');
          wire.push({ tick, track, order, kind: 'sustain', channel: status & 15, a, b });
          warn('sustain-applied', 'Sustain CC64 was flattened into note gate durations', false);
        } else warn('ignored-channel', 'Program, pressure, pitch bend and controllers other than CC64 were omitted');
      } else if (status === 0xff) {
        const type = input.data();
        const size = input.vlq();
        input.need(size);
        const payload = input.offset;
        if (Object.hasOwn(META_LENGTHS, type) && size !== META_LENGTHS[type]) throw new RangeError('Invalid MIDI meta-event length');
        input.offset += size;
        if (type === 0x2f) {
          if (input.offset !== input.end) throw new RangeError('MIDI bytes follow end-of-track');
          ended = true; endTick = Math.max(endTick, tick); break;
        } else if (type === 0x51) {
          if (++tempoCount > MAX_TEMPO_POINTS) throw new RangeError('MIDI file exceeds tempo point budget');
          const microseconds = input.view.getUint8(payload) * 65536 + input.view.getUint8(payload + 1) * 256 + input.view.getUint8(payload + 2);
          if (microseconds === 0) throw new RangeError('MIDI tempo must be positive');
          transportNumber(60000000 / microseconds, 1, 1000, 'MIDI bpm');
          wire.push({ tick, track, order, kind: 'tempo', channel: 0, a: microseconds, b: 0 });
        } else if (type === 0x58) {
          const numerator = input.view.getUint8(payload);
          const exponent = input.view.getUint8(payload + 1);
          if (exponent > 5) throw new RangeError('MIDI meter denominator exceeds supported range');
          normalizeTimeSignature({ numerator, denominator: 2 ** exponent });
          wire.push({ tick, track, order, kind: 'meter', channel: 0, a: numerator, b: 2 ** exponent });
          if (input.view.getUint8(payload + 2) !== 24 || input.view.getUint8(payload + 3) !== 8) warn('meter-detail', 'MIDI metronome click and thirty-second-note fields were omitted');
        } else {
          if (type === 0x20 && input.view.getUint8(payload) > 15) throw new RangeError('Invalid MIDI channel prefix');
          if (type === 0x21 && input.view.getUint8(payload) > 127) throw new RangeError('Invalid MIDI port');
          if (type === 0x54) {
            const hour = input.view.getUint8(payload);
            const rateCode = hour >> 5 & 3;
            const frameLimit = rateCode === 0 ? 24 : rateCode === 1 ? 25 : 30;
            if (hour > 127 || (hour & 31) > 23 || input.view.getUint8(payload + 1) > 59 ||
                input.view.getUint8(payload + 2) > 59 || input.view.getUint8(payload + 3) >= frameLimit ||
                input.view.getUint8(payload + 4) > 99) throw new RangeError('Invalid MIDI SMPTE offset');
          }
          if (type === 0x59 && (Math.abs(input.view.getInt8(payload)) > 7 || input.view.getUint8(payload + 1) > 1)) throw new RangeError('Invalid MIDI key signature');
          warn('ignored-meta', 'Text, key signatures, sequence/port/channel metadata and other meta events were omitted');
        }
      } else if (status === 0xf0 || status === 0xf7) {
        const size = input.vlq(); input.need(size); input.offset += size;
        warn('ignored-sysex', 'Length-framed SysEx and escaped system data were omitted; no messages are transmitted');
      } else throw new RangeError('System status is not a framed MIDI file event');
    }
    if (!ended) throw new RangeError('MIDI track is missing end-of-track');
  }
  if (reader.offset !== reader.end) throw new RangeError('MIDI file has trailing bytes or undeclared tracks');
  wire.sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
  const events: BeatSequenceEvent[] = [];
  const queues = new Map<number, NoteQueue>();
  const live = new Set<HeldNote>();
  const sustained = Array.from({ length: 16 }, () => new Set<HeldNote>());
  const pedals = new Array<boolean>(16).fill(false);
  const tempos: TempoPoint[] = [{ beat: 0, bpm: 120, curve: 'step' }];
  let hasTempo = false;
  let meter: Readonly<TimeSignature> = normalizeTimeSignature();
  let hasMeter = false;
  let nextId = 1;
  function close(held: HeldNote, tick: number): void {
    if (tick <= held.tick) throw new RangeError('MIDI note has a zero-length gate');
    held.event.duration = (tick - held.tick) / ppqn;
    live.delete(held);
  }
  for (const item of wire) {
    const beat = item.tick / ppqn;
    if (item.kind === 'tempo') {
      const bpm = 60000000 / item.a;
      const last = tempos[tempos.length - 1];
      if (last.beat === beat) {
        if (last.bpm !== bpm && (beat !== 0 || hasTempo)) warn('tempo-conflict', 'Simultaneous MIDI tempo events use the last file-track/event order');
        last.bpm = bpm;
      } else tempos.push({ beat, bpm, curve: 'step' });
      hasTempo = true;
    } else if (item.kind === 'meter') {
      if (item.tick !== 0 && (meter.numerator !== item.a || meter.denominator !== item.b)) throw new RangeError('Changing MIDI time signatures cannot be represented by a single timeSignature');
      if (item.tick === 0 && hasMeter && (meter.numerator !== item.a || meter.denominator !== item.b)) throw new RangeError('Conflicting MIDI time signatures at beat zero');
      meter = normalizeTimeSignature({ numerator: item.a, denominator: item.b });
      hasMeter = true;
    } else if (item.kind === 'sustain') {
      pedals[item.channel] = item.b >= 64;
      if (!pedals[item.channel]) {
        for (const held of sustained[item.channel]) close(held, item.tick);
        sustained[item.channel].clear();
      }
    } else if (item.kind === 'on') {
      const name = voices.get(String(item.channel));
      if (name === undefined) warn('default-voice', 'Unmapped MIDI channels (including percussion) use defaultVoice, not General MIDI programs');
      const event: BeatNote = { type: 'note', id: nextId++, beat, duration: 0, note: item.a, velocity: item.b / 127, voice: name === undefined ? fallback : name as string };
      events.push(event);
      const held = { event, tick: item.tick };
      live.add(held);
      const key = item.channel * 128 + item.a;
      const queue = queues.get(key);
      if (queue) queue.notes.push(held);
      else queues.set(key, { notes: [held], head: 0 });
    } else {
      const key = item.channel * 128 + item.a;
      const queue = queues.get(key);
      if (!queue || queue.head === queue.notes.length) throw new RangeError('MIDI note-off has no owned note-on');
      const held = queue.notes[queue.head++];
      if (queue.head === queue.notes.length) queues.delete(key);
      if (pedals[item.channel]) sustained[item.channel].add(held);
      else close(held, item.tick);
    }
  }
  if (live.size !== 0) {
    if (unclosed === 'reject') throw new RangeError('MIDI contains unclosed notes or sustain gates');
    warn('unclosed-notes', 'Unclosed notes and sustain gates were closed at the final end-of-track tick', false, live.size);
    for (const held of live) close(held, endTick);
  }
  return { events, tempoMap: normalizeTempoMap(tempos), timeSignature: meter, warnings: Object.freeze([...warnings.values()].map(warning => Object.freeze(warning))) };
}

interface ExportNote { id: number; start: number; end: number; channel: number; pitch: number; velocity: number; index: number }
interface OutputEvent { tick: number; order: number; index: number; bytes: readonly number[] }
function vlqSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_VLQ) throw new RangeError('MIDI delta exceeds four-byte VLQ range');
  return value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : 4;
}
function writeVlq(target: Uint8Array, offset: number, value: number): number {
  const size = vlqSize(value);
  for (let index = size - 1; index >= 0; index--) { target[offset + index] = (value % 128) | (index === size - 1 ? 0 : 128); value = Math.floor(value / 128); }
  return offset + size;
}

/** Deterministic type 0/1 notes, stepped tempo and one meter; unsupported controls reject. */
export function exportMidiFile(events: readonly BeatSequenceEvent[], options: MidiExportOptions = {}): Uint8Array {
  const config = sequenceOwnData(options, ['format', 'ppqn', 'tempoMap', 'bpm', 'timeSignature', 'voiceChannels'], [], 'MIDI export options');
  const format = config.format === undefined ? 1 : config.format;
  if (format !== 0 && format !== 1) throw new RangeError('MIDI export format must be 0 or 1');
  const ppqn = transportNumber(config.ppqn === undefined ? 480 : config.ppqn, 1, 32767, 'ppqn');
  if (!Number.isInteger(ppqn)) throw new RangeError('ppqn must be an integer');
  const map = normalizeTempoMap(config.tempoMap as readonly TempoPoint[] | undefined, config.bpm === undefined ? 120 : config.bpm as number);
  const meter = normalizeTimeSignature(config.timeSignature as TimeSignature | undefined);
  const channels = dictionary(config.voiceChannels, false);
  const notes = new Map<number, ExportNote>();
  const stops: { id: number; beat: number }[] = [];
  const input = transportArray(events, MAX_LONG_SEQUENCE_EVENTS, 'MIDI beat events');
  for (let index = 0; index < input.length; index++) {
    const event = input[index];
    const type = event !== null && typeof event === 'object' ? Object.getOwnPropertyDescriptor(event, 'type')?.value : undefined;
    if (type === 'control') throw new RangeError('MIDI export cannot represent OPM note controls');
    if (type !== 'note' && type !== 'stop') throw new TypeError('Invalid MIDI beat event type');
    const data = sequenceOwnData(event, type === 'note' ? ['type', 'id', 'beat', 'duration', 'voice', 'note', 'velocity', 'pan', 'voicePriority'] : ['type', 'id', 'beat'], type === 'note' ? ['type', 'id', 'beat', 'duration', 'note'] : ['type', 'id', 'beat'], 'MIDI beat event');
    const id = data.id as number;
    if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('MIDI note id must be a positive safe integer');
    const beat = transportNumber(data.beat, 0, MAX_TRANSPORT_BEATS, 'MIDI beat');
    if (type === 'stop') { stops.push({ id, beat }); continue; }
    if (notes.has(id)) throw new RangeError('Duplicate MIDI note id');
    const duration = transportNumber(data.duration, 0, MAX_TRANSPORT_BEATS - beat, 'MIDI note duration');
    if (duration === 0) throw new RangeError('MIDI note duration must be positive');
    const pitch = transportNumber(data.note, 0, 127, 'MIDI pitch');
    if (!Number.isInteger(pitch)) throw new RangeError('MIDI export requires integer pitches');
    const velocity = transportNumber(data.velocity === undefined ? 1 : data.velocity, 0, 1, 'MIDI velocity');
    if (velocity === 0) throw new RangeError('Zero velocity would become a MIDI note-off');
    if (data.pan !== undefined && transportNumber(data.pan, -1, 1, 'MIDI pan') !== 0) throw new RangeError('MIDI export cannot represent per-note pan');
    if (data.voicePriority !== undefined && transportNumber(data.voicePriority, -128, 127, 'voicePriority') !== 0) throw new RangeError('MIDI export cannot represent voice priority');
    const name = voiceName(data.voice === undefined ? 'brass' : data.voice);
    const midiChannel = channels.get(name) ?? (name === 'brass' ? 0 : undefined);
    if (midiChannel === undefined) throw new RangeError(`MIDI voice ${name} needs a voiceChannels mapping`);
    notes.set(id, { id, start: Math.round(beat * ppqn), end: Math.round((beat + duration) * ppqn), channel: midiChannel as number, pitch, velocity: Math.max(1, Math.round(velocity * 127)), index });
  }
  for (const stop of stops) {
    const note = notes.get(stop.id);
    if (!note) throw new RangeError('MIDI stop has no owned note');
    const tick = Math.round(stop.beat * ppqn);
    if (tick < note.start) throw new RangeError('MIDI stop precedes note onset');
    note.end = Math.min(note.end, tick);
  }
  const sorted = [...notes.values()].sort((a, b) => a.start - b.start || a.index - b.index);
  const previous = new Map<number, ExportNote>();
  for (const note of sorted) {
    if (note.end <= note.start) throw new RangeError('MIDI note gate collapses at the selected PPQN');
    const key = note.channel * 128 + note.pitch;
    const before = previous.get(key);
    if (before && before.end > note.end) throw new RangeError('Crossing same-channel/pitch note ownership cannot roundtrip through FIFO MIDI note-offs');
    previous.set(key, note);
  }
  const conductor: OutputEvent[] = [{ tick: 0, order: 0, index: 0, bytes: [0xff, 0x58, 4, meter.numerator, Math.log2(meter.denominator), 24, 8] }];
  let lastTempoTick = -1;
  for (let index = 0; index < map.length; index++) {
    const point = map[index];
    if (point.curve === 'linear') throw new RangeError('MIDI export cannot represent linear tempo curves; supply an explicitly discretized step map');
    const tick = Math.round(point.beat * ppqn);
    if (tick <= lastTempoTick) throw new RangeError('MIDI tempo points collide at the selected PPQN');
    lastTempoTick = tick;
    const microseconds = Math.round(60000000 / point.bpm);
    if (microseconds > 0xffffff) throw new RangeError('MIDI tempo exceeds its three-byte field');
    conductor.push({ tick, order: 1, index, bytes: [0xff, 0x51, 3, microseconds >>> 16, microseconds >>> 8 & 255, microseconds & 255] });
  }
  const musical = new Map<number, OutputEvent[]>();
  for (const note of sorted) {
    let track = musical.get(note.channel);
    if (!track) { track = []; musical.set(note.channel, track); }
    track.push({ tick: note.start, order: 3, index: note.index, bytes: [0x90 | note.channel, note.pitch, note.velocity] });
    track.push({ tick: note.end, order: 2, index: note.index, bytes: [0x80 | note.channel, note.pitch, 0] });
  }
  let endTick = lastTempoTick;
  for (const note of sorted) endTick = Math.max(endTick, note.end);
  const tracks = format === 0 ? [[...conductor, ...[...musical.values()].flat()]] : [conductor, ...[...musical.entries()].sort((a, b) => a[0] - b[0]).map(([, track]) => track)];
  let wireCount = 0;
  let byteLength = 14;
  const sizes: number[] = [];
  for (const track of tracks) {
    track.push({ tick: endTick, order: 4, index: 0, bytes: [0xff, 0x2f, 0] });
    track.sort((a, b) => a.tick - b.tick || a.order - b.order || a.index - b.index);
    wireCount += track.length;
    if (wireCount > MAX_MIDI_FILE_EVENTS) throw new RangeError('MIDI export exceeds event budget');
    let tick = 0;
    let size = 0;
    for (const event of track) { size += vlqSize(event.tick - tick) + event.bytes.length; tick = event.tick; }
    sizes.push(size); byteLength += 8 + size;
  }
  if (byteLength > MAX_MIDI_FILE_BYTES) throw new RangeError('MIDI export exceeds byte budget');
  const result = new Uint8Array(byteLength);
  const view = new DataView(result.buffer);
  const tag = (offset: number, text: string): void => { for (let index = 0; index < text.length; index++) result[offset + index] = text.charCodeAt(index); };
  tag(0, 'MThd'); view.setUint32(4, 6); view.setUint16(8, format); view.setUint16(10, tracks.length); view.setUint16(12, ppqn);
  let offset = 14;
  for (let index = 0; index < tracks.length; index++) {
    tag(offset, 'MTrk'); view.setUint32(offset + 4, sizes[index]); offset += 8;
    let tick = 0;
    for (const event of tracks[index]) { offset = writeVlq(result, offset, event.tick - tick); result.set(event.bytes, offset); offset += event.bytes.length; tick = event.tick; }
  }
  return result;
}
