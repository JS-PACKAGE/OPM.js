import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBeatSequence, parseScoreProject, serializeScoreProject, MAX_SCORE_PROJECT_BYTES, MAX_SCORE_PROJECT_VOICES } from '../src/core/project.js';
import type { BeatSequenceEvent } from '../src/core/sequence.js';
import { beatsToSeconds } from '../src/core/transport.js';
import { renderSequence, renderSequenceChunks, MAX_LONG_SEQUENCE_EVENTS } from '../src/core/sequence.js';
import { createWavEncoder } from '../src/core/wav.js';
import { brass } from '../src/voices/brass.js';

function source() {
  return { version: 1, events: [
    { type: 'note', id: 1, beat: 0, duration: 0.25, note: 60, voice: 'lead', velocity: 0.5 },
    { type: 'control', id: 1, beat: 0.1, controls: { expression: 0.7, ramp: 0.02 } },
  ], voices: { lead: structuredClone(brass) }, settings: { sampleRate: 8000, mixGain: 0.15 } };
}

test('canonical score roundtrip is detached, deep-frozen and self-contained', () => {
  const input = source();
  const project = parseScoreProject(input);
  input.events[0].note = 90;
  input.voices.lead.ops[0].level = 0;
  assert.equal(project.events[0].type === 'note' && project.events[0].note, 60);
  assert.notEqual(project.voices.lead.ops[0].level, 0);
  for (const nested of [project, project.events, project.events[0], project.voices, project.voices.lead,
    project.voices.lead.ops, project.voices.lead.ops[0].adsr, project.settings, project.settings.tuning.offsets]) {
    assert.equal(Object.isFrozen(nested), true);
  }
  assert.deepEqual(project.timeSignature, { numerator: 4, denominator: 4 });
  assert.deepEqual(project.tempoMap, [{ beat: 0, bpm: 120 }]);
  const json = serializeScoreProject(project);
  assert.deepEqual(parseScoreProject(json), project);
  assert.equal(serializeScoreProject(parseScoreProject(json)), json);
});

test('canonical voice and control order does not depend on input property order', () => {
  const first = source();
  first.voices = { lead: first.voices.lead, ...{ bass: structuredClone(brass) } };
  const second = source();
  second.voices = { ...{ bass: structuredClone(brass) }, lead: second.voices.lead };
  second.events[1].controls = { ramp: 0.02, expression: 0.7 };
  assert.equal(serializeScoreProject(parseScoreProject(first)), serializeScoreProject(parseScoreProject(second)));
});

test('legacy/unversioned projects, malformed JSON and unknown fields are rejected', () => {
  assert.throws(() => parseScoreProject('{'), SyntaxError);
  for (const version of [undefined, 0, 2, '1']) assert.throws(() => parseScoreProject({ ...source(), version }));
  assert.throws(() => parseScoreProject({ ...source(), title: 'unrecognized' }), /unknown field/);
  assert.throws(() => parseScoreProject({ ...source(), timeSignature: { numerator: 4, denominator: 3 } }));
  assert.throws(() => parseScoreProject({ ...source(), tempoMap: [{ beat: 1, bpm: 120 }] }));
  assert.throws(() => parseScoreProject({ ...source(), tempoMap: [{ beat: 0, bpm: 120, curve: 'linear' }] }));
});

test('own-data project validation rejects accessors, prototypes and pollution keys without getters', () => {
  let reads = 0;
  const input = source();
  assert.throws(() => parseScoreProject({ ...input, get events() { reads++; return input.events; } }), /data/);
  assert.throws(() => parseScoreProject(Object.create(input)), /plain data/);
  assert.throws(() => parseScoreProject({ ...input, voices: { get lead() { reads++; return brass; } } }), /data/);
  assert.throws(() => parseScoreProject('{"version":1,"events":[],"voices":{"__proto__":{}}}'), /voice name/);
  const array = [{ type: 'note', id: 1, beat: 0, duration: 1, note: 60, voice: 'lead' }];
  Object.defineProperty(array, '0', { get() { reads++; return null; } });
  assert.throws(() => parseScoreProject({ ...input, events: array }), /own data/);
  assert.throws(() => parseScoreProject({ ...input, settings: { get mixGain() { reads++; return 0.5; } } }), /data/);
  assert.equal(reads, 0);
});

test('project rejects unknown voice/ID references, duplicate IDs and inline patches', () => {
  const note = { type: 'note', id: 1, beat: 0, duration: 1, note: 60, voice: 'missing' };
  assert.throws(() => parseScoreProject({ ...source(), events: [note] }), /Unknown sequence voice/);
  assert.throws(() => parseScoreProject({ ...source(), events: [{ ...note, voice: brass }] }), /named voices/);
  assert.throws(() => parseScoreProject({ ...source(), events: [{ type: 'stop', id: 9, beat: 0 }] }), /Unknown sequence note id/);
  assert.throws(() => parseScoreProject({ ...source(), events: [{ ...note, voice: 'lead' }, { ...note, voice: 'lead' }] }), /Duplicate/);
  assert.throws(() => parseScoreProject({ ...source(), events: [{ ...note, voice: 'lead', duration: 0 }] }), /greater than zero/);
});

test('settings and all input budgets are enforced', () => {
  for (const settings of [{ maxVoices: 0 }, { maxVoices: 33 }, { sampleRate: 7999 }, { mixGain: 1.1 },
    { quality: 'ultra' }, { stealing: 'random' }, { tuning: { offsets: [0] } }, { tuning: { referenceHz: Infinity } }, { unknown: true }]) {
    assert.throws(() => parseScoreProject({ ...source(), settings }));
  }
  assert.throws(() => parseScoreProject(' '.repeat(MAX_SCORE_PROJECT_BYTES + 1)), /byte budget/);
  assert.throws(() => parseScoreProject('é'.repeat(MAX_SCORE_PROJECT_BYTES / 2 + 1)), /byte budget/);
  assert.throws(() => parseScoreProject({ ...source(), events: new Array(MAX_LONG_SEQUENCE_EVENTS + 1) }), /budget/);
  const voices = Object.fromEntries(Array.from({ length: MAX_SCORE_PROJECT_VOICES + 1 }, (_, index) => [`voice${index}`, brass]));
  assert.throws(() => parseScoreProject({ ...source(), voices }), /voice budget/);
  assert.throws(() => parseScoreProject({ ...source(), events: [{ type: 'note', id: 1, voice: 'lead', note: 60, beat: 2000, duration: 1 }], tempoMap: [{ beat: 0, bpm: 1 }] }), /second horizon/);
});

test('note gates integrate onset and end across tempo ramps and step boundaries', () => {
  const tempoMap = [{ beat: 0, bpm: 60, curve: 'linear' as const }, { beat: 4, bpm: 180 }, { beat: 6, bpm: 90 }];
  const events: BeatSequenceEvent[] = [
    { type: 'note', id: 1, beat: 2, duration: 5, voice: 'lead', note: 64 },
    { type: 'control', id: 1, beat: 3, controls: { pitch: 2, glide: 0.4, expression: 0.6, ramp: 0.7 } },
    { type: 'stop', id: 1, beat: 6.5 },
  ];
  const result = compileBeatSequence(events, { tempoMap, voices: new Map([['lead', brass]]) });
  assert.equal(result[0].time, beatsToSeconds(2, tempoMap));
  assert.equal(result[0].type === 'note' && result[0].duration, beatsToSeconds(7, tempoMap) - beatsToSeconds(2, tempoMap));
  assert.equal(result[0].type === 'note' && result[0].voice, 'lead');
  assert.equal(result[1].type === 'control' && result[1].controls.glide, 0.4);
  assert.equal(result[1].type === 'control' && result[1].controls.ramp, 0.7);
  assert.equal(result[2].time, beatsToSeconds(6.5, tempoMap));
});

test('standalone compiler validates options, supports default brass and detaches inline voices', () => {
  const patch = structuredClone(brass);
  const compiled = compileBeatSequence([{ type: 'note', id: 1, beat: 0, duration: 1, note: 60, voice: patch }], { bpm: 60 });
  patch.ops[0].level = 0;
  assert.notEqual(compiled[0].type === 'note' && typeof compiled[0].voice === 'object' && compiled[0].voice.ops[0].level, 0);
  const defaultVoice = compileBeatSequence([{ type: 'note', id: 1, beat: 0, duration: 1, note: 60 }]);
  assert.equal(defaultVoice[0].type === 'note' && defaultVoice[0].voice, 'brass');
  assert.throws(() => compileBeatSequence([], { bpm: 0 }));
  assert.throws(() => compileBeatSequence([], { voices: {} as Map<string, typeof brass> }));
  assert.throws(() => compileBeatSequence([{ type: 'stop', id: 1, beat: 0 }]));
  assert.throws(() => compileBeatSequence([{ type: 'note', id: 1, beat: 1, duration: Number.MIN_VALUE, note: 60 }]), /greater than zero/);
});

test('Node-only project consumers render deterministic full/chunk PCM and streamed WAV', () => {
  const project = parseScoreProject(source());
  const voices = new Map(Object.entries(project.voices));
  const score = compileBeatSequence(project.events, { tempoMap: project.tempoMap, voices });
  const options = { ...project.settings, voices };
  const full = renderSequence(score, options);
  const replay = parseScoreProject(serializeScoreProject(project));
  const second = renderSequence(compileBeatSequence(replay.events, { tempoMap: replay.tempoMap, voices }), options);
  assert.deepEqual(full.left, second.left);
  assert.deepEqual(full.right, second.right);
  assert.equal(full.diagnostics.errors, 0);
  assert.ok(full.left.some(value => value !== 0));
  const chunks = renderSequenceChunks(score, { ...options, chunkFrames: 127 });
  const encoder = createWavEncoder({ sampleRate: full.sampleRate, channels: 2, totalFrames: chunks.capacity.frames });
  const parts = [encoder.header()];
  let at = 0;
  for (const chunk of chunks) {
    assert.deepEqual(chunk.left, full.left.subarray(at, at + chunk.frames));
    assert.deepEqual(chunk.right, full.right.subarray(at, at + chunk.frames));
    parts.push(encoder.encode({ left: chunk.left, right: chunk.right }));
    at += chunk.frames;
  }
  parts.push(encoder.finalize());
  assert.equal(at, full.left.length);
  assert.equal(parts.reduce((bytes, part) => bytes + part.length, 0), 44 + full.left.length * 4);
});
