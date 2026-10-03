import test from 'node:test';
import assert from 'node:assert/strict';
import { importMidiFile, exportMidiFile, MAX_MIDI_FILE_BYTES, MAX_MIDI_FILE_TRACKS, MAX_MIDI_FILE_EVENTS } from '../src/core/midi-file.js';
import { compileBeatSequence } from '../src/core/project.js';
import type { BeatSequenceEvent } from '../src/core/sequence.js';

const end = [0, 0xff, 0x2f, 0];
const mapped = { channelVoices: { 0: 'brass' } };
function smf(tracks: readonly (readonly number[])[], format = tracks.length === 1 ? 0 : 1, ppqn = 480): Uint8Array {
  const result = new Uint8Array(14 + tracks.reduce((sum, track) => sum + track.length + 8, 0));
  const view = new DataView(result.buffer);
  const tag = (offset: number, value: string): void => { for (let index = 0; index < value.length; index++) result[offset + index] = value.charCodeAt(index); };
  tag(0, 'MThd'); view.setUint32(4, 6); view.setUint16(8, format); view.setUint16(10, tracks.length); view.setUint16(12, ppqn);
  let offset = 14;
  for (const track of tracks) { tag(offset, 'MTrk'); view.setUint32(offset + 4, track.length); result.set(track, offset + 8); offset += track.length + 8; }
  return result;
}
function note(id = 1, beat = 0, duration = 1, pitch = 60): Extract<BeatSequenceEvent, { type: 'note' }> {
  return { type: 'note', id, beat, duration, note: pitch, voice: 'brass', velocity: 1 };
}
function importedNotes(bytes: Uint8Array) {
  return importMidiFile(bytes, mapped).events.map(event => {
    assert.equal(event.type, 'note');
    if (event.type !== 'note') throw new Error('Expected imported note');
    return event;
  });
}

test('SMF running status and velocity-zero note-off own overlapping same-pitch gates FIFO', () => {
  const bytes = smf([[0, 0x90, 60, 96, 120, 60, 64, 120, 60, 0, 120, 0x80, 60, 0, ...end]]);
  const result = importMidiFile(bytes, mapped);
  assert.deepEqual(result.events, [
    { type: 'note', id: 1, beat: 0, duration: 0.5, note: 60, velocity: 96 / 127, voice: 'brass' },
    { type: 'note', id: 2, beat: 0.25, duration: 0.5, note: 60, velocity: 64 / 127, voice: 'brass' },
  ]);
  assert.deepEqual(result.warnings, []);
});

test('format 1 tempo/meter/channel tracks compile into actual elapsed note seconds', () => {
  const bytes = smf([
    [0, 0xff, 0x58, 4, 3, 2, 24, 8, 0, 0xff, 0x51, 3, 7, 0xa1, 0x20, 0x83, 0x60, 0xff, 0x51, 3, 15, 0x42, 0x40, 0x83, 0x60, 0xff, 0x2f, 0],
    [0, 0x92, 60, 127, 0x87, 0x40, 0x82, 60, 0, ...end],
  ]);
  const result = importMidiFile(bytes, { channelVoices: { 2: 'brass' } });
  assert.deepEqual(result.tempoMap.map(point => [point.beat, point.bpm]), [[0, 120], [1, 60]]);
  assert.deepEqual(result.timeSignature, { numerator: 3, denominator: 4 });
  const seconds = compileBeatSequence(result.events, { tempoMap: result.tempoMap });
  assert.equal(seconds[0].type, 'note');
  if (seconds[0].type === 'note') assert.equal(seconds[0].duration, 1.5);
  for (const format of [0, 1] as const) {
    const exported = exportMidiFile(result.events, { format, tempoMap: result.tempoMap, timeSignature: result.timeSignature, voiceChannels: { brass: 2 } });
    const reloaded = importMidiFile(exported, { channelVoices: { 2: 'brass' } });
    assert.deepEqual(reloaded.events, result.events);
    assert.deepEqual(reloaded.tempoMap, result.tempoMap);
    assert.deepEqual(reloaded.timeSignature, result.timeSignature);
    assert.deepEqual(exported, exportMidiFile(result.events, { format, tempoMap: result.tempoMap, timeSignature: result.timeSignature, voiceChannels: { brass: 2 } }));
  }
});

test('sustain gates defer releases independently of repeated-pitch key ownership', () => {
  const bytes = smf([[0, 0x90, 60, 127, 120, 0xb0, 64, 127, 120, 0x80, 60, 0, 0, 0x90, 60, 64, 120, 0x90, 60, 0, 120, 0xb0, 64, 0, ...end]]);
  const result = importMidiFile(bytes, mapped);
  assert.deepEqual(result.events.map(event => event.type === 'note' ? [event.beat, event.duration] : []), [[0, 1], [0.5, 0.5]]);
  assert.deepEqual(result.warnings.map(warning => [warning.code, warning.count]), [['sustain-applied', 2]]);
  assert.throws(() => importMidiFile(bytes, { ...mapped, sustain: 'reject' }), /sustain/);
  assert.equal(importMidiFile(bytes, { ...mapped, unsupported: 'reject' }).events.length, 2);
});

test('channel sustain does not hold another channel and notes can pair across format 1 tracks', () => {
  const bytes = smf([
    [0, 0xb0, 64, 127, 0, 0x90, 60, 127, 0, 0x91, 60, 127, 0x83, 0x60, 0xff, 0x2f, 0],
    [120, 0x80, 60, 0, 0, 0x81, 60, 0, 120, 0xb0, 64, 0, ...end],
  ]);
  const result = importMidiFile(bytes, { channelVoices: { 0: 'brass', 1: 'brass' } });
  assert.deepEqual(result.events.map(event => event.type === 'note' ? event.duration : -1), [0.5, 0.25]);
});

test('unclosed keys and sustain require an explicit bounded end-of-file closure policy', () => {
  for (const bytes of [
    smf([[0, 0x90, 60, 127, 0x87, 0x40, 0xff, 0x2f, 0]]),
    smf([[0, 0x90, 60, 127, 0, 0xb0, 64, 127, 0x83, 0x60, 0x80, 60, 0, 0x83, 0x60, 0xff, 0x2f, 0]]),
  ]) {
    assert.throws(() => importMidiFile(bytes, mapped), /unclosed/);
    const result = importMidiFile(bytes, { ...mapped, unclosedNotes: 'close-at-end' });
    assert.equal(result.events[0].type, 'note');
    if (result.events[0].type === 'note') assert.equal(result.events[0].duration, 2);
    assert.equal(result.warnings.find(warning => warning.code === 'unclosed-notes')?.count, 1);
  }
  assert.throws(() => importMidiFile(smf([[0, 0x80, 60, 0, ...end]]), { ...mapped, unclosedNotes: 'close-at-end' }), /no owned/);
  assert.throws(() => importMidiFile(smf([[0, 0x90, 60, 127, ...end]]), { ...mapped, unclosedNotes: 'close-at-end' }), /zero-length/);
  assert.throws(() => importMidiFile(smf([[0, 0x90, 60, 127, 0, 0x80, 60, 0, ...end]]), mapped), /zero-length/);
});

test('omitted programs/controllers/metadata/SysEx and release velocity are exposed, not silently dropped', () => {
  const bytes = smf([[0, 0xc0, 10, 0, 0xd0, 32, 0, 0xe0, 0, 64, 0, 0xb0, 7, 100, 0, 0xff, 1, 3, 65, 66, 67, 0, 0xf0, 3, 1, 2, 0xf7, 0, 0x90, 60, 127, 120, 0x80, 60, 64, ...end]]);
  const result = importMidiFile(bytes);
  assert.deepEqual(result.warnings.map(warning => [warning.code, warning.count]), [
    ['ignored-channel', 4], ['ignored-meta', 1], ['ignored-sysex', 1], ['release-velocity', 1], ['default-voice', 1],
  ]);
  assert.throws(() => importMidiFile(bytes, { ...mapped, unsupported: 'reject' }), /Unsupported/);
  assert.throws(() => importMidiFile(smf([[0, 0x99, 36, 127, 120, 0x89, 36, 0, ...end]]), { unsupported: 'reject' }), /defaultVoice/);
  const percussion = importMidiFile(smf([[0, 0x99, 36, 127, 120, 0x89, 36, 0, ...end]]), { channelVoices: { 9: 'drum' } });
  assert.equal(percussion.events[0].type === 'note' && percussion.events[0].voice, 'drum');
});

test('all truncated prefixes, malformed framing and illegal running status reject', () => {
  const good = smf([[0, 0x90, 60, 127, 120, 0x80, 60, 0, ...end]]);
  for (let length = 0; length < good.length; length++) assert.throws(() => importMidiFile(good.subarray(0, length), mapped));
  const invalid = [
    [0, 60, 127, ...end],
    [0, 0x90, 60, 0x80, ...end],
    [0, 0xf1, 1, ...end],
    [0, 0xf0, 5, 1, 2],
    [0, 0xff, 0x51, 2, 7, 0xa1, ...end],
    [0, 0xff, 0x2f, 1, 0],
    [...end, 0],
    [0, 0x90, 60, 127],
    [0, 0x90, 60, 127, 0, 0xff, 1, 0, 120, 60, 0, ...end],
    [0, 0x90, 60, 127, 0, 0xf7, 0, 120, 60, 0, ...end],
    [0x81, 0x80, 0x80, 0x80, 0, 0xff, 0x2f, 0],
    [0, 0xff, 1, 0x81, 0x80, 0x80, 0x80, 0],
    [0, 0xff, 0x80, 0, ...end],
    [0, 0xff, 0x20, 1, 16, ...end],
    [0, 0xff, 0x59, 2, 8, 0, ...end],
    [0, 0xff, 0x54, 5, 24, 0, 0, 0, 0, ...end],
  ];
  for (const track of invalid) assert.throws(() => importMidiFile(smf([track]), mapped));
  const trailing = new Uint8Array(good.length + 1); trailing.set(good);
  assert.throws(() => importMidiFile(trailing, mapped), /trailing/);
});

test('SMF unsupported formats, timing, headers, tempo and meter errors reject explicitly', () => {
  assert.throws(() => importMidiFile(smf([end], 2)), /format/);
  assert.throws(() => importMidiFile(smf([end], 0, 0)), /PPQN/);
  assert.throws(() => importMidiFile(smf([end], 0, 0xe728)), /SMPTE/);
  assert.throws(() => importMidiFile(smf([], 1)), /track/);
  assert.throws(() => importMidiFile(smf([end, end], 0)), /track/);
  const header = smf([end]); new DataView(header.buffer).setUint32(4, 5);
  assert.throws(() => importMidiFile(header), /header/);
  assert.throws(() => importMidiFile(smf([[0, 0xff, 0x51, 3, 0, 0, 0, ...end]])), /tempo/);
  assert.throws(() => importMidiFile(smf([[0, 0xff, 0x51, 3, 0, 0, 1, ...end]])), /bpm/);
  assert.throws(() => importMidiFile(smf([[120, 0xff, 0x58, 4, 3, 2, 24, 8, ...end]])), /Changing/);
  assert.throws(() => importMidiFile(smf([[0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff, 0x58, 4, 3, 2, 24, 8, ...end]])), /Conflicting/);
  assert.throws(() => importMidiFile(smf([[0, 0xff, 0x58, 4, 4, 6, 24, 8, ...end]])), /denominator/);
});

test('simultaneous tempo conflicts use stable track order with an explicit warning', () => {
  const bytes = smf([[0, 0xff, 0x51, 3, 7, 0xa1, 0x20, ...end], [0, 0xff, 0x51, 3, 15, 0x42, 0x40, ...end]]);
  const result = importMidiFile(bytes);
  assert.equal(result.tempoMap[0].bpm, 60);
  assert.equal(result.warnings.find(warning => warning.code === 'tempo-conflict')?.count, 1);
  assert.throws(() => importMidiFile(bytes, { unsupported: 'reject' }), /Simultaneous/);
});

test('type 0 deterministic bytes put release before the next onset at the same tick', () => {
  const bytes = exportMidiFile([note(1, 0, 0.25), note(2, 0.25, 0.25)], { format: 0 });
  assert.deepEqual(bytes, smf([[
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
    0, 0xff, 0x51, 3, 7, 0xa1, 0x20,
    0, 0x90, 60, 127,
    120, 0x80, 60, 0,
    0, 0x90, 60, 127,
    120, 0x80, 60, 0,
    ...end,
  ]]));
  assert.deepEqual(importedNotes(bytes).map(event => [event.beat, event.duration]), [[0, 0.25], [0.25, 0.25]]);
});

test('explicit stops, FIFO overlaps and channel mappings survive export reload', () => {
  const events: BeatSequenceEvent[] = [note(1, 0, 2), note(2, 0.5, 1.5), { type: 'stop', id: 1, beat: 1 }, { ...note(3, 0, 1, 67), voice: 'lead' }];
  const bytes = exportMidiFile(events, { voiceChannels: { brass: 0, lead: 3 }, ppqn: 960 });
  const result = importMidiFile(bytes, { channelVoices: { 0: 'brass', 3: 'lead' } });
  assert.deepEqual(result.events.map(event => event.type === 'note' ? [event.beat, event.duration, event.note, event.voice] : []), [[0, 1, 60, 'brass'], [0, 1, 67, 'lead'], [0.5, 1.5, 60, 'brass']]);
  assert.throws(() => exportMidiFile([note(1, 0, 2), note(2, 0.5, 0.5)]), /FIFO/);
});

test('PPQN rounding is monotone and unrepresentable gates/tempos/controls reject', () => {
  const bytes = exportMidiFile([note(1, 0.11, 0.51), note(2, 0.62, 0.49)], { ppqn: 10 });
  assert.deepEqual(importedNotes(bytes).map(event => [event.beat, event.duration]), [[0.1, 0.5], [0.6, 0.5]]);
  assert.throws(() => exportMidiFile([note(1, 0, 0.001)], { ppqn: 1 }), /collapses/);
  assert.throws(() => exportMidiFile([note()], { tempoMap: [{ beat: 0, bpm: 120, curve: 'linear' }, { beat: 1, bpm: 90 }] }), /linear/);
  assert.throws(() => exportMidiFile([note()], { tempoMap: [{ beat: 0, bpm: 120 }, { beat: 0.001, bpm: 90 }], ppqn: 1 }), /collide/);
  assert.throws(() => exportMidiFile([note()], { bpm: 1 }), /three-byte/);
  for (const unsupported of [
    { ...note(), note: 60.5 }, { ...note(), velocity: 0 }, { ...note(), pan: 0.5 }, { ...note(), voicePriority: 1 },
    { ...note(), voice: 'lead' }, { type: 'control', id: 1, beat: 0, controls: { pitch: 1 } },
  ]) assert.throws(() => exportMidiFile([unsupported as BeatSequenceEvent]));
});

test('export validates identities, options and reference ownership before emitting a file', () => {
  for (const invalid of [
    [note(), note()], [{ ...note(), id: 0 }], [{ ...note(), duration: 0 }], [{ ...note(), duration: Infinity }],
    [{ type: 'stop', id: 2, beat: 1 }], [note(1, 1, 1), { type: 'stop', id: 1, beat: 0 }],
    [note(), { type: 'stop', id: 1, beat: 0 }],
  ]) assert.throws(() => exportMidiFile(invalid as BeatSequenceEvent[]));
  for (const ppqn of [0, 1.5, 32768, NaN]) assert.throws(() => exportMidiFile([note()], { ppqn }));
  assert.throws(() => exportMidiFile([note()], { format: 2 as 0 }), /format/);
  assert.throws(() => exportMidiFile([note()], { voiceChannels: { brass: 16 } }), /channel/);
  assert.throws(() => importMidiFile(smf([end]), { channelVoices: { '01': 'brass' } }), /key/);
});

test('native bytes and own-data validators do not invoke caller accessors or iterator overrides', () => {
  let reads = 0;
  const bytes = smf([[0, 0x90, 60, 127, 120, 0x80, 60, 0, ...end]]);
  Object.defineProperty(bytes, 'byteLength', { get() { reads++; return MAX_MIDI_FILE_BYTES + 1; } });
  assert.equal(importMidiFile(bytes, mapped).events.length, 1);
  assert.throws(() => importMidiFile(new Proxy(bytes, {})));
  assert.throws(() => importMidiFile(new Int8Array(32) as unknown as Uint8Array));
  assert.throws(() => importMidiFile(new Uint8Array(new SharedArrayBuffer(32))), /shared/);
  assert.throws(() => importMidiFile(bytes, { get defaultVoice() { reads++; return 'brass'; } }), /data/);
  const voices = { get brass() { reads++; return 0; } };
  assert.throws(() => exportMidiFile([note()], { voiceChannels: voices }), /data/);
  const events = [note()];
  Object.defineProperty(events, '0', { get() { reads++; return note(); } });
  assert.throws(() => exportMidiFile(events), /own data/);
  assert.equal(reads, 0);
});

test('byte, track, all-wire-event, tempo and beat/VLQ budgets are hard bounds', () => {
  assert.throws(() => importMidiFile(new Uint8Array(MAX_MIDI_FILE_BYTES + 1)), /byte budget/);
  assert.equal(importMidiFile(smf(Array.from({ length: MAX_MIDI_FILE_TRACKS }, () => end))).events.length, 0);
  assert.throws(() => importMidiFile(smf(Array.from({ length: MAX_MIDI_FILE_TRACKS + 1 }, () => end))), /track/);
  const metas = Array.from({ length: MAX_MIDI_FILE_EVENTS - 1 }, () => [0, 0xff, 1, 0]).flat();
  const accepted = importMidiFile(smf([[...metas, ...end]]));
  assert.equal(accepted.warnings[0].count, MAX_MIDI_FILE_EVENTS - 1);
  assert.throws(() => importMidiFile(smf([[...metas, 0, 0xff, 1, 0, ...end]])), /event budget/);
  const tempos = Array.from({ length: 1025 }, () => [0, 0xff, 0x51, 3, 7, 0xa1, 0x20]).flat();
  assert.throws(() => importMidiFile(smf([[...tempos, ...end]])), /tempo point budget/);
  assert.throws(() => importMidiFile(smf([[0xff, 0xff, 0xff, 0x7f, 0xff, 0x2f, 0]], 0, 1)), /beat horizon/);
  const limit = importMidiFile(smf([[0, 0x90, 60, 127, 0x85, 0xa3, 0, 0x80, 60, 0, ...end]], 0, 1), mapped);
  assert.equal(limit.events[0].type === 'note' && limit.events[0].duration, 86400);
  assert.throws(() => exportMidiFile([note(1, 86400 - 1, 1)], { ppqn: 32767 }), /VLQ/);
  assert.throws(() => exportMidiFile(Array.from({ length: 65537 }, () => note())), /entry budget/);
  const many = Array.from({ length: 32767 }, (_, index) => note(index + 1, 0, 1, index % 128));
  assert.throws(() => exportMidiFile(many, { format: 0 }), /event budget/);
});

const midiPolicy = { controls: 'preserve' as const, pitchBendRange: 2 };
const expressive = { ...mapped, ...midiPolicy };
function control(id: number, beat: number, controls: Extract<BeatSequenceEvent, { type: 'control' }>['controls']): BeatSequenceEvent {
  return { type: 'control', id, beat, controls };
}
function controlRows(events: readonly BeatSequenceEvent[]) {
  return events.flatMap(event => event.type === 'control' ? [[event.id, event.beat, event.controls]] : []);
}

test('expressive import snapshots pre-onset state, including silent expression, without changing legacy defaults', () => {
  const bytes = smf([[
    0, 0xe0, 127, 127, 0, 0xb0, 7, 100, 0, 0xb0, 11, 0,
    0, 0xb0, 10, 127, 0, 0xb0, 1, 64, 0, 0x90, 60, 96,
    120, 0x80, 60, 0, ...end,
  ]]);
  const legacy = importMidiFile(bytes, mapped);
  assert.equal(legacy.events.length, 1);
  assert.equal(legacy.warnings.find(warning => warning.code === 'ignored-channel')?.count, 5);
  const result = importMidiFile(bytes, { ...expressive, unsupported: 'reject' });
  assert.deepEqual(result.events, [
    { ...note(), duration: 0.25, velocity: 96 / 127 },
    control(1, 0, { pitch: 2, expression: 0, pan: 1, modulation: 1 + 64 / 127 }),
  ]);
  const compiled = compileBeatSequence(result.events);
  assert.equal(compiled[1].type === 'control' && compiled[1].controls.expression, 0);
  assert.deepEqual(result.lossSummary.omissions, []);
  assert.deepEqual(result.lossSummary.approximations, []);
  assert.deepEqual(result.lossSummary.preservedControls, [
    { kind: 'pitch-bend', count: 1 }, { kind: 'expression', count: 2 },
    { kind: 'pan', count: 1 }, { kind: 'modulation', count: 1 },
  ]);
  assert.ok(Object.isFrozen(result.lossSummary));
  assert.ok(Object.isFrozen(result.lossSummary.preservedControls[0]));
});

test('held and sustained channel gates receive updates, while poly pressure addresses the newest pressed duplicate', () => {
  const bytes = smf([[
    0, 0x90, 60, 127, 0, 0x90, 60, 96,
    120, 0xb0, 64, 127, 0, 0x80, 60, 0,
    0, 0xa0, 60, 127, 0, 0xd0, 32, 0, 0xb0, 1, 64,
    0, 0xb0, 7, 100, 0, 0xb0, 11, 80, 0, 0xe0, 0, 0,
    120, 0x80, 60, 0, 120, 0xb0, 10, 0,
    120, 0xb0, 64, 0, ...end,
  ]]);
  const result = importMidiFile(bytes, expressive);
  assert.deepEqual(result.events.filter(event => event.type === 'note').map(event => event.duration), [1, 1]);
  assert.deepEqual(controlRows(result.events).slice(2), [
    [2, 0.25, { modulation: 2 }],
    [1, 0.25, { modulation: 1 + 32 / 127 }], [2, 0.25, { modulation: 2 }],
    [1, 0.25, { modulation: 1 + 64 / 127 }], [2, 0.25, { modulation: 2 }],
    [1, 0.25, { expression: 100 / 127 }], [2, 0.25, { expression: 100 / 127 }],
    [1, 0.25, { expression: 100 / 127 * (80 / 127) }], [2, 0.25, { expression: 100 / 127 * (80 / 127) }],
    [1, 0.25, { pitch: -2 }], [2, 0.25, { pitch: -2 }],
    [1, 0.75, { pan: -1 }], [2, 0.75, { pan: -1 }],
  ]);
  assert.equal(result.lossSummary.approximations[0].code, 'sustain-applied');
  assert.equal(result.lossSummary.preservedControls.find(entry => entry.kind === 'expression')?.count, 2);
  assert.equal(result.lossSummary.preservedControls.find(entry => entry.kind === 'channel-pressure')?.count, 1);
});

test('format 1 channel state and control order follow tick, track, then wire order', () => {
  const bytes = smf([
    [0, 0xe0, 0, 0, 120, 0xb0, 10, 127, 0, 0xd0, 127, 120, 0xff, 0x2f, 0],
    [0, 0x90, 60, 127, 120, 0xe0, 0, 64, 120, 0x80, 60, 0, ...end],
  ]);
  const result = importMidiFile(bytes, expressive);
  assert.deepEqual(controlRows(result.events), [
    [1, 0, { pitch: -2, expression: 1, pan: 0, modulation: 1 }],
    [1, 0.25, { pan: 1 }], [1, 0.25, { modulation: 2 }], [1, 0.25, { pitch: 0 }],
  ]);
});

test('loss summary separates omissions, approximations and recognized source controls', () => {
  const bytes = smf([[
    0, 0xc0, 7, 0, 0xb0, 0, 1, 0, 0xb0, 101, 0, 0, 0xb0, 6, 12,
    0, 0xb0, 64, 127, 0, 0xe0, 0, 64, 0, 0x90, 60, 127,
    120, 0x80, 60, 0, 120, 0xb0, 64, 0, ...end,
  ]]);
  const result = importMidiFile(bytes, expressive);
  assert.deepEqual(result.lossSummary.omissions.map(entry => [entry.code, entry.count]), [['ignored-channel', 4]]);
  assert.deepEqual(result.lossSummary.approximations.map(entry => [entry.code, entry.count]), [['sustain-applied', 2]]);
  assert.deepEqual(result.lossSummary.preservedControls, [{ kind: 'pitch-bend', count: 1 }]);
  for (const message of [[0xc0, 7], [0xb0, 0, 1], [0xb0, 101, 0], [0xb0, 6, 12], [0xb0, 121, 0]]) {
    assert.throws(() => importMidiFile(smf([[0, ...message, ...end]]), { ...expressive, unsupported: 'reject' }), /Unsupported/);
  }
});

test('post-release channel updates report unknown-tail approximation and do not resurrect owned gates', () => {
  const bytes = smf([[
    0, 0x90, 60, 127, 120, 0x80, 60, 0,
    120, 0xe0, 127, 127, 120, 0x90, 62, 127, 120, 0x80, 62, 0, ...end,
  ]]);
  const result = importMidiFile(bytes, expressive);
  assert.deepEqual(controlRows(result.events), [
    [1, 0, { pitch: 0, expression: 1, pan: 0, modulation: 1 }],
    [2, 0.75, { pitch: 2, expression: 1, pan: 0, modulation: 1 }],
  ]);
  assert.equal(result.lossSummary.approximations.find(entry => entry.code === 'release-tail-controls')?.count, 1);
  assert.throws(() => importMidiFile(bytes, { ...expressive, unsupported: 'reject' }), /release tails/);
  assert.throws(() => exportMidiFile([note(1, 0, 0.25), control(1, 0.5, { pitch: 1 })], midiPolicy), /release-tail/);
});

test('expressive export orders initial controllers before onset and release before reset/new onset', () => {
  const events = [note(1, 0, 0.25), control(1, 0, { pitch: 2, expression: 0, pan: 1, modulation: 2 }), note(2, 0.25, 0.25)];
  const bytes = exportMidiFile(events, { controls: 'preserve', format: 0 });
  assert.deepEqual(bytes, smf([[
    0, 0xff, 0x58, 4, 4, 2, 24, 8, 0, 0xff, 0x51, 3, 7, 0xa1, 0x20,
    0, 0xe0, 127, 127, 0, 0xb0, 7, 127, 0, 0xb0, 11, 0,
    0, 0xb0, 10, 127, 0, 0xb0, 1, 127, 0, 0x90, 60, 127,
    120, 0x80, 60, 0,
    0, 0xe0, 0, 64, 0, 0xb0, 7, 127, 0, 0xb0, 11, 127,
    0, 0xb0, 10, 64, 0, 0xb0, 1, 0, 0, 0x90, 60, 127,
    120, 0x80, 60, 0, ...end,
  ]]));
  assert.deepEqual(controlRows(importMidiFile(bytes, expressive).events), [
    [1, 0, { pitch: 2, expression: 0, pan: 1, modulation: 2 }],
    [2, 0.25, { pitch: 0, expression: 1, pan: 0, modulation: 1 }],
  ]);
});

test('bend, CC7*CC11, pan and pressure meaning survives expressive file-score-file with overlapping gates', () => {
  const bytes = smf([[
    0, 0xb0, 7, 100, 0, 0xb0, 11, 80, 0, 0xe0, 0, 96, 0, 0xb0, 10, 32,
    0, 0xd0, 40, 0, 0x90, 60, 127, 120, 0x90, 64, 96,
    120, 0xa0, 64, 100, 120, 0xb0, 1, 0,
    120, 0x80, 60, 0, 0, 0x80, 64, 0, ...end,
  ]]);
  const score = importMidiFile(bytes, expressive);
  for (const format of [0, 1] as const) {
    const exported = exportMidiFile(score.events, { format, controls: 'preserve' });
    const reloaded = importMidiFile(exported, expressive);
    assert.equal(reloaded.events.length, score.events.length);
    for (let index = 0; index < score.events.length; index++) {
      const before = score.events[index];
      const after = reloaded.events[index];
      if (before.type !== 'control' || after.type !== 'control') { assert.deepEqual(after, before); continue; }
      assert.equal(after.id, before.id);
      assert.equal(after.beat, before.beat);
      assert.deepEqual(Object.keys(after.controls), Object.keys(before.controls));
      for (const key of Object.keys(before.controls) as ('pitch' | 'expression' | 'pan' | 'modulation')[]) {
        assert.ok(Math.abs(after.controls[key]! - before.controls[key]!) < 1e-12);
      }
    }
    assert.deepEqual(exportMidiFile(score.events, { format, controls: 'preserve' }), exported);
  }
});

test('expressive export rejects incompatible channel overlap and unaddressable repeated-pitch pressure', () => {
  for (const field of ['pitch', 'expression', 'pan'] as const) {
    const value = field === 'expression' ? 0.5 : 1;
    assert.throws(() => exportMidiFile([note(1, 0, 2), note(2, 0, 2, 64), control(1, 1, { [field]: value })], midiPolicy), /conflicts/);
  }
  assert.throws(() => exportMidiFile([note(1, 0, 2), { ...note(2, 0.5, 2, 64), pan: 1 }], midiPolicy), /overlapping/);
  assert.throws(() => exportMidiFile([note(1, 0, 2), note(2, 0.5, 2), control(1, 1, { modulation: 2 })], midiPolicy), /older repeated-pitch/);
  assert.doesNotThrow(() => exportMidiFile([
    note(1, 0, 2), note(2, 0.5, 2),
    control(1, 1, { pitch: 1 }), control(2, 1, { pitch: 1 }),
  ], midiPolicy));
});

test('explicit expressive export quantizes controls and rejects non-MIDI automation and ownership loss', () => {
  const events = [note(), control(1, 0.11, { pitch: 0.123, expression: 0.317, pan: 0.123, modulation: 1.123 })];
  const result = importMidiFile(exportMidiFile(events, { ...midiPolicy, ppqn: 10 }), expressive);
  const update = result.events.find(event => event.type === 'control' && event.beat === 0.1);
  assert.ok(update && update.type === 'control');
  if (update?.type === 'control') {
    // Export can use separate wire events; inspect the final state instead.
    const state = Object.assign({}, ...result.events.flatMap(event => event.type === 'control' ? [event.controls] : []));
    assert.ok(Math.abs(state.pitch - 0.123) <= 2 / 8191);
    assert.ok(Math.abs(state.expression - 0.317) <= 1 / 127);
    assert.ok(Math.abs(state.pan - 0.123) <= 1 / 63);
    assert.ok(Math.abs(state.modulation - 1.123) <= 1 / 127);
  }
  for (const controls of [{ ramp: 0 }, { glide: 0 }, { gain: 1 }, { operatorLevels: [1, 1, 1, 1] }, { modulation: 0.5 }, { pitch: 3 }]) {
    assert.throws(() => exportMidiFile([note(), control(1, 0.25, controls as Extract<BeatSequenceEvent, { type: 'control' }>['controls'])], midiPolicy));
  }
  assert.throws(() => exportMidiFile([note(), control(1, 0.99, { pitch: 1 })], { ...midiPolicy, ppqn: 10 }), /inside/);
  assert.throws(() => exportMidiFile([note(), control(2, 0.5, { pitch: 1 })], midiPolicy), /owned note/);
});

test('expression policies reject malicious options/accessors and bound generated fanout separately from wire input', () => {
  let reads = 0;
  const bytes = smf([[0, 0x90, 60, 127, 120, 0x80, 60, 0, ...end]]);
  for (const pitchBendRange of [-1, 49, NaN, Infinity, null, '2']) {
    assert.throws(() => importMidiFile(bytes, { ...expressive, pitchBendRange: pitchBendRange as number }));
    assert.throws(() => exportMidiFile([note()], { ...midiPolicy, pitchBendRange: pitchBendRange as number }));
  }
  assert.throws(() => importMidiFile(bytes, { controls: 'guess' as 'preserve' }));
  assert.throws(() => exportMidiFile([note()], { controls: 'guess' as 'preserve' }));
  assert.throws(() => importMidiFile(bytes, { get controls() { reads++; return 'preserve' as const; } }), /data/);
  assert.throws(() => exportMidiFile([note(), control(1, 0, { get pitch() { reads++; return 1; } })], midiPolicy), /data/);
  assert.equal(reads, 0);
  const onsets = Array.from({ length: 128 }, (_, pitch) => [0, 0x90, pitch, 127]).flat();
  const bends = Array.from({ length: 512 }, () => [1, 0xe0, 0, 64]).flat();
  const releases = Array.from({ length: 128 }, (_, pitch) => [0, 0x80, pitch, 0]).flat();
  assert.throws(() => importMidiFile(smf([[...onsets, ...bends, ...releases, ...end]]), expressive), /generated beat events/);
  assert.equal(importMidiFile(bytes, { ...expressive, pitchBendRange: 0 }).events.length, 2);
});

test('poly overrides persist through sustain and channel pressure while new keys inherit channel defaults', () => {
  const bytes = smf([[
    0, 0x90, 60, 127, 0, 0xb0, 64, 127, 120, 0xa0, 60, 127,
    120, 0x80, 60, 0, 0, 0xa0, 60, 0, 0, 0xd0, 32,
    0, 0x90, 64, 127, 120, 0x80, 64, 0, 120, 0xb0, 64, 0, ...end,
  ]]);
  const result = importMidiFile(bytes, expressive);
  assert.deepEqual(controlRows(result.events), [
    [1, 0, { pitch: 0, expression: 1, pan: 0, modulation: 1 }],
    [1, 0.25, { modulation: 2 }],
    [1, 0.5, { modulation: 2 }],
    [2, 0.5, { pitch: 0, expression: 1, pan: 0, modulation: 1 + 32 / 127 }],
  ]);
  assert.equal(result.lossSummary.preservedControls.find(entry => entry.kind === 'poly-pressure')?.count, 2);
});
