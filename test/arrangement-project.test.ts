import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArrangementProject, serializeArrangementProject, parseScoreProject, serializeScoreProject,
  MAX_ARRANGEMENT_PROJECT_BYTES, MAX_ARRANGEMENT_PROJECT_VOICES } from '../src/core/project.js';
import type { BeatSequenceEvent } from '../src/core/sequence.js';
import { MAX_LONG_SEQUENCE_EVENTS } from '../src/core/sequence.js';
import { brass } from '../src/voices/brass.js';
import { prepareVoice } from '../src/voices/normalize.js';
import { MAX_BANK_BYTES } from '../src/voices/schema.js';

function source() {
  return { version: 1, voices: { lead: structuredClone(brass) },
    layers: [{ name: 'melody', length: 4, gain: 0.65, voicePriority: 100, events: [
      { type: 'note', id: 1, beat: 0, duration: 6, note: 72, voice: 'lead' },
      { type: 'control', id: 1, beat: 1, controls: { expression: 0.5, ramp: 0.25 } },
    ] }], sections: [{ name: 'quiet', layers: [] as string[] }, { name: 'active', layers: ['melody'] }],
    initialSection: 'active', settings: { sampleRate: 16000, maxVoices: 4, mixGain: 0.2 } };
}

test('portable arrangement roundtrip preserves detached immutable musical data and normalized defaults', () => {
  const input = source();
  const project = parseArrangementProject(input);
  input.layers[0].gain = 0;
  input.layers[0].events[0].note = 10;
  input.sections[1].layers.length = 0;
  input.voices.lead.ops[0].level = 0;
  assert.equal(project.layers[0].gain, 0.65);
  assert.equal(project.layers[0].voicePriority, 100);
  assert.equal(project.layers[0].events[0].type === 'note' && project.layers[0].events[0].note, 72);
  assert.deepEqual(project.sections[1].layers, ['melody']);
  assert.notEqual(project.voices.lead.ops[0].level, 0);
  assert.deepEqual(project.tempoMap, [{ beat: 0, bpm: 120 }]);
  assert.deepEqual(project.timeSignature, { numerator: 4, denominator: 4 });
  assert.equal(project.settings.sampleRate, 16000);
  assert.equal(project.settings.quality, 'standard');
  for (const value of [project, project.layers, project.layers[0], project.layers[0].events,
    project.layers[0].events[1].type === 'control' && project.layers[0].events[1].controls,
    project.sections, project.sections[1], project.sections[1].layers, project.voices,
    project.voices.lead.ops[0].adsr, project.settings, project.settings.tuning.offsets, project.tempoMap[0]]) {
    assert.equal(Object.isFrozen(value), true);
  }
  const json = serializeArrangementProject(project);
  assert.deepEqual(parseArrangementProject(json), project);
  assert.equal(serializeArrangementProject(parseArrangementProject(json)), json);
  assert.equal(Object.hasOwn(project, 'position'), false);
});

test('arrangement canonical order ignores property order but retains array order and distinct score schema', () => {
  const first = source();
  const second = source();
  const a = parseArrangementProject({ ...first, voices: { zebra: brass, lead: brass } });
  const b = parseArrangementProject({ ...second, voices: { lead: brass, zebra: brass }, layers: [{ ...second.layers[0],
    events: [second.layers[0].events[0], { type: 'control', id: 1, beat: 1, controls: { ramp: 0.25, expression: 0.5 } }] }] });
  assert.equal(serializeArrangementProject(a), serializeArrangementProject(b));
  assert.deepEqual(a.sections.map(section => section.name), ['quiet', 'active']);
  const repeated = parseArrangementProject({ ...first, sections: [{ name: 'active', layers: ['melody', 'melody'] }] });
  assert.deepEqual(repeated.sections[0].layers, ['melody'], 'section membership retains the first occurrence');
  assert.equal(serializeArrangementProject(repeated), serializeArrangementProject(
    parseArrangementProject({ ...first, sections: [{ name: 'active', layers: ['melody'] }] })));
  const score = parseScoreProject({ version: 1, events: first.layers[0].events, voices: first.voices });
  assert.equal(serializeScoreProject(parseScoreProject(serializeScoreProject(score))), serializeScoreProject(score));
  assert.throws(() => parseScoreProject(a), /unknown field/);
  assert.throws(() => parseArrangementProject(score), /unknown field/);
  assert.throws(() => parseArrangementProject('{'), SyntaxError);
  for (const version of [undefined, 0, 2, '1']) assert.throws(() => parseArrangementProject({ ...source(), version }));
});

test('portable definitions reject executable properties, sparse arrays and unknown nested fields without getters', () => {
  let reads = 0;
  const input = source();
  const getter = { get() { reads++; return input.layers; } };
  assert.throws(() => parseArrangementProject(Object.defineProperty({ ...input }, 'layers', getter)), /data/);
  assert.throws(() => parseArrangementProject(Object.create(input)), /plain data/);
  assert.throws(() => parseArrangementProject({ ...input, voices: { get lead() { reads++; return brass; } } }), /data/);
  assert.throws(() => parseArrangementProject({ ...input, settings: { get mixGain() { reads++; return 0.5; } } }), /data/);
  assert.throws(() => parseArrangementProject({ ...input, sections: [Object.defineProperty({ ...input.sections[1] }, 'layers', getter)] }), /data/);
  const layers = [input.layers[0]];
  Object.defineProperty(layers, '0', getter);
  assert.throws(() => parseArrangementProject({ ...input, layers }), /own data/);
  for (const bad of [
    { ...input, layers: new Array(1) },
    { ...input, sections: [{ name: 'active', layers: new Array(1) }] },
    { ...input, layers: [{ ...input.layers[0], events: new Array(1) }] },
    { ...input, pending: [] },
    { ...input, layers: [{ ...input.layers[0], fade: 1 }] },
    { ...input, sections: [{ ...input.sections[1], gain: 0.5 }] },
    { ...input, timeSignature: { numerator: 3, denominator: 3 } },
    { ...input, tempoMap: [{ beat: 0, bpm: 120, extra: true }] },
    { ...input, settings: { extra: true } },
    { ...input, voices: JSON.parse('{"__proto__":{}}') },
  ]) assert.throws(() => parseArrangementProject(bad));
  assert.throws(() => parseArrangementProject({ ...input, layers: Object.assign([input.layers[0]], { extra: true }) }), /unknown field/);
  assert.equal(reads, 0);
});

test('references, duplicate names and note IDs, reserved gain, and numeric layer bounds reject', () => {
  const input = source();
  const layer = input.layers[0];
  const note = layer.events[0];
  for (const bad of [
    { ...input, layers: [] },
    { ...input, layers: [layer, layer] },
    { ...input, sections: [input.sections[1], input.sections[1]] },
    { ...input, sections: [{ name: 'active', layers: ['missing'] }] },
    { ...input, initialSection: 'missing' },
    { ...input, layers: [{ ...layer, name: 'invalid name' }] },
    ...[0, 1 / 2048, 257, Infinity].map(length => ({ ...input, layers: [{ ...layer, length }] })),
    ...[-1, 1.1, NaN].map(gain => ({ ...input, layers: [{ ...layer, gain }] })),
    ...[-1, 1.5, 128].map(voicePriority => ({ ...input, layers: [{ ...layer, voicePriority }] })),
    { ...input, layers: [{ ...layer, events: [note, note] }] },
    { ...input, layers: [{ ...layer, events: [{ ...note, beat: 4 }] }] },
    { ...input, layers: [{ ...layer, events: [{ ...note, duration: 0 }] }] },
    { ...input, layers: [{ ...layer, events: [{ ...note, voice: 'missing' }] }] },
    { ...input, layers: [{ ...layer, events: [{ ...note, voice: brass }] }] },
    { ...input, layers: [{ ...layer, events: [{ type: 'stop', id: 9, beat: 0 }] }] },
    { ...input, layers: [{ ...layer, events: [note, { type: 'control', id: 1, beat: 1, controls: { gain: 0.5 } }] }] },
    { ...input, layers: [{ ...layer, events: [{ ...note, duration: 2000 }] }], tempoMap: [{ beat: 0, bpm: 1 }] },
    { ...input, settings: { maxVoices: 33 } },
  ]) assert.throws(() => parseArrangementProject(bad));
  assert.throws(() => parseArrangementProject({ ...input, layers: [{ ...layer, events: [{ ...note, voice: undefined }] }] }), /Unknown sequence voice/);
  const withDefault = parseArrangementProject({ ...input, voices: { brass }, layers: [{ ...layer, events: [{ ...note, voice: undefined }] }] });
  assert.equal(withDefault.layers[0].events[0].type === 'note' && withDefault.layers[0].events[0].voice, 'brass');
});

test('arrangement enforces aggregate event, layer, section, voice and UTF-8 input budgets', () => {
  const input = source();
  const layer = input.layers[0];
  assert.throws(() => parseArrangementProject(' '.repeat(MAX_ARRANGEMENT_PROJECT_BYTES + 1)), /byte budget/);
  assert.throws(() => parseArrangementProject('é'.repeat(MAX_ARRANGEMENT_PROJECT_BYTES / 2 + 1)), /byte budget/);
  assert.throws(() => parseArrangementProject({ ...input, layers: Array.from({ length: 17 }, (_, index) => ({ ...layer, name: `layer${index}` })) }), /budget/);
  assert.throws(() => parseArrangementProject({ ...input, sections: Array.from({ length: 33 }, (_, index) => ({ name: `section${index}`, layers: [] })) }), /budget/);
  assert.throws(() => parseArrangementProject({ ...input, voices: Object.fromEntries(Array.from({ length: MAX_ARRANGEMENT_PROJECT_VOICES + 1 }, (_, index) => [`voice${index}`, brass])) }), /voice budget/);
  assert.throws(() => parseArrangementProject({ ...input, layers: [{ ...layer, events: new Array(MAX_LONG_SEQUENCE_EVENTS + 1) }] }), /budget/);
  const events: BeatSequenceEvent[] = [layer.events[0] as BeatSequenceEvent,
    ...Array.from({ length: MAX_LONG_SEQUENCE_EVENTS / 2 }, (): BeatSequenceEvent => ({ type: 'control', id: 1, beat: 1, controls: { expression: 0.5 } }))];
  assert.throws(() => parseArrangementProject({ ...input, layers: [{ ...layer, events }, { ...layer, name: 'second', events }] }), /event budget/);
});

test('object input cannot bypass the normalized voice-bank or total serialized byte budgets', () => {
  const input = source();
  const fraction = 0.12345678901234568;
  const patch = { ...brass, name: 'a'.repeat(64), lfo: { ...brass.lfo, rate: fraction, amDepth: fraction,
    pmDepth: fraction, delay: fraction, phase: fraction, amTargets: [fraction, fraction, fraction, fraction] as const,
    pmTargets: [fraction, fraction, fraction, fraction] as const },
    pitchEnvelope: { a: fraction, d: fraction, r: fraction, initial: fraction, peak: fraction, sustain: fraction, final: fraction },
    ops: brass.ops.map(op => ({ ...op, ratio: 1 + fraction, level: fraction, detune: fraction,
      frequency: 440 + fraction, rateKeyScale: fraction, velocitySensitivity: fraction,
      keyScale: { breakpoint: 60, leftDbPerOctave: fraction, rightDbPerOctave: fraction },
      adsr: { a: fraction, d: fraction, s: fraction, r: fraction } })) as typeof brass.ops };
  const voices = Object.fromEntries(Array.from({ length: MAX_ARRANGEMENT_PROJECT_VOICES }, (_, index) => [`voice${index}`, patch]));
  const normalized = Object.fromEntries(Object.entries(voices).map(([name, voice]) => [name, prepareVoice(voice)]));
  assert.ok(JSON.stringify(normalized).length > MAX_BANK_BYTES);
  assert.throws(() => parseArrangementProject({ ...input, voices }), /256 KiB/);
  const adsr = { a: fraction, d: fraction, s: fraction, r: fraction };
  const controls = { operatorADSR: [adsr, adsr, adsr, adsr] as const,
    operatorLevels: [fraction, fraction, fraction, fraction] as const,
    operatorRatios: [1 + fraction, 1 + fraction, 1 + fraction, 1 + fraction] as const };
  const events: BeatSequenceEvent[] = [input.layers[0].events[0] as BeatSequenceEvent,
    ...Array.from({ length: 40000 }, (): BeatSequenceEvent => ({ type: 'control', id: 1, beat: 1, controls }))];
  assert.throws(() => parseArrangementProject({ ...input, layers: [{ ...input.layers[0], events }] }), /byte budget/);
});
