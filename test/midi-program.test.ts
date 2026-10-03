import test from 'node:test';
import assert from 'node:assert/strict';
import { importMidiFile } from '../src/core/midi-file.js';
import type { MidiImportOptions } from '../src/core/midi-file.js';
import { gmProgramVoices, gmDrumVoices } from '../src/voices/gm-map.js';
import { examples } from '../src/voices/examples.js';

function smf(track: number[]): Uint8Array {
  const bytes = new Uint8Array(22 + track.length + 4);
  bytes.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 120, 77, 84, 114, 107]);
  new DataView(bytes.buffer).setUint32(18, track.length + 4);
  bytes.set(track, 22); bytes.set([0, 255, 47, 0], 22 + track.length);
  return bytes;
}
const voices = (bytes: Uint8Array, options: MidiImportOptions = {}) => importMidiFile(bytes, options).events.flatMap(event => event.type === 'note' ? [event.voice] : []);

test('program selection is per channel, takes effect at onset and falls back when unmapped', () => {
  const bytes = smf([
    0, 0x90, 60, 127, 0, 0xc0, 8, 0, 0x90, 62, 127,
    0, 0x91, 64, 127, 0, 0xc0, 127, 0, 0x90, 65, 127,
    120, 0x80, 60, 0, 0, 0x80, 62, 0, 0, 0x81, 64, 0, 0, 0x80, 65, 0,
  ]);
  const options = { programVoices: { 0: 'electric_piano', 8: 'bell' }, channelVoices: { 0: 'bass' }, defaultVoice: 'brass' };
  assert.deepEqual(voices(bytes, options), ['electric_piano', 'bell', 'electric_piano', 'bass']);
  assert.deepEqual(voices(bytes, { ...options, programVoices: new Map([[0, 'electric_piano'], [8, 'bell']]) }), voices(bytes, options));
  const result = importMidiFile(bytes, options);
  assert.equal(result.lossSummary.preservedControls.find(entry => entry.kind === 'program-change')?.count, 1);
  assert.equal(result.lossSummary.omissions.find(entry => entry.code === 'ignored-program')?.count, 1);
  assert.deepEqual(voices(bytes), ['brass', 'brass', 'brass', 'brass']);
  const withoutPrograms = smf([0, 0x90, 60, 127, 0, 0x90, 62, 127, 0, 0x91, 64, 127, 0, 0x90, 65, 127, 120, 0x80, 60, 0, 0, 0x80, 62, 0, 0, 0x81, 64, 0, 0, 0x80, 65, 0]);
  assert.deepEqual(importMidiFile(bytes).events, importMidiFile(withoutPrograms).events);
});

test('drum mapping has note priority only on channel 9, then program/channel/default fallback', () => {
  const bytes = smf([0, 0x99, 38, 127, 0, 0x99, 39, 127, 0, 0x90, 38, 127, 120, 0x89, 38, 0, 0, 0x89, 39, 0, 0, 0x80, 38, 0]);
  assert.deepEqual(voices(bytes, { drumVoices: { 38: 'membrane_tom' }, programVoices: { 0: 'bell' } }), ['membrane_tom', 'bell', 'bell']);
  assert.deepEqual(voices(bytes, { drumVoices: new Map([[38, 'membrane_tom']]), channelVoices: { 9: 'bass' } }), ['membrane_tom', 'bass', 'brass']);
});

test('voice maps reject untrusted entries without evaluating accessors and snapshot native Maps', () => {
  const empty = smf([]);
  let invoked = false;
  const getter = Object.defineProperty({}, '0', { get() { invoked = true; return 'bell'; } });
  const bad = [null, [], { '01': 'bell' }, { 128: 'bell' }, { '-1': 'bell' }, { 0: '' }, { 0: 'not a voice' }, { 0: Infinity }, getter, Object.create({ 0: 'bell' }), new Map([[0.5, 'bell']]), new Map([[128, 'bell']]), new Map(Array.from({ length: 129 }, (_, i) => [i, 'bell']))];
  for (const value of bad) for (const field of ['programVoices', 'drumVoices']) {
    assert.throws(() => importMidiFile(empty, { [field]: value } as MidiImportOptions));
  }
  assert.equal(invoked, false);
  const all = Object.fromEntries(Array.from({ length: 128 }, (_, i) => [i, 'bell']));
  assert.doesNotThrow(() => importMidiFile(empty, { programVoices: all }));
  assert.doesNotThrow(() => importMidiFile(empty, { programVoices: Object.assign(Object.create(null), { 127: 'bell' }) }));
});

test('RPN 0 changes subsequent bends per channel, supports cents, null and NRPN deselection, clamps', () => {
  const cc = (channel: number, number: number, value: number) => [0, 0xb0 + channel, number, value];
  const bytes = smf([
    0, 0x90, 60, 127, 0, 0x91, 64, 127,
    ...cc(0, 101, 0), ...cc(0, 100, 0), ...cc(0, 6, 12), ...cc(0, 38, 50),
    0, 0xe0, 127, 127, 0, 0xe1, 0, 0,
    ...cc(0, 101, 127), ...cc(0, 100, 127), ...cc(0, 6, 1), 0, 0xe0, 0, 0,
    ...cc(0, 101, 0), ...cc(0, 100, 0), ...cc(0, 6, 127), ...cc(0, 38, 127), 0, 0xe0, 127, 127,
    ...cc(0, 99, 0), ...cc(0, 6, 1), 0, 0xe0, 0, 0,
    120, 0x80, 60, 0, 0, 0x81, 64, 0,
  ]);
  const result = importMidiFile(bytes, { controls: 'preserve', channelVoices: { 0: 'brass', 1: 'brass' } });
  assert.deepEqual(result.events.flatMap(event => event.type === 'control' ? [event.controls.pitch] : []), [0, 0, 12.5, -2, -12.5, 48, -48]);
  assert.equal(result.lossSummary.preservedControls.find(entry => entry.kind === 'pitch-bend-range')?.count, 10);
  assert.equal(importMidiFile(bytes).events.length, 2);
});

test('GM starter maps are frozen and all program entries reference bundled voices', () => {
  const names = new Set(examples.map(voice => voice.name));
  assert.equal(Object.keys(gmProgramVoices).length, 128);
  for (let i = 0; i < 128; i++) assert.ok(names.has(gmProgramVoices[i]!));
  assert.ok(Object.isFrozen(gmProgramVoices)); assert.ok(Object.isFrozen(gmDrumVoices));
  for (const [key, value] of Object.entries(gmDrumVoices)) {
    assert.ok(Number(key) >= 0 && Number(key) <= 127);
    assert.ok(names.has(value) || value === 'noise-snare' || value === 'noise-hihat');
  }
});
