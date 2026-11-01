import assert from 'node:assert/strict';
import test from 'node:test';
import { OPM } from '../src/api/index.js';
import { beatsToSeconds, normalizeTempoMap } from '../src/api/transport.js';
import { prepareArrangementDefinition } from '../src/core/arrangement-definition.js';
import { prepareSequence } from '../src/core/sequence.js';
import { validateNoteControls } from '../src/core/synth.js';
import type { NoteControls } from '../src/core/synth.js';
import { replaceTempoFrom } from '../src/core/transport.js';
import { normalizeTuning, tuningFrequency } from '../src/core/tuning.js';
import { brass } from '../src/voices/brass.js';
import { prepareVoice } from '../src/voices/normalize.js';
import { parseVoiceBank } from '../src/voices/schema.js';
import { withIndexedAccessors } from './indexed-accessors-harness.js';

// Every assertion runs after the accessors are removed; copies must already be own data then.
test('tempo snapshots copy dense input as own data despite inherited index accessors', () => {
  const input = [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60, curve: 'linear' as const, endBpm: 90 }, { beat: 8, bpm: 90 }];
  const clean = normalizeTempoMap(input);
  const polluted = withIndexedAccessors(() => normalizeTempoMap(input));
  assert.deepStrictEqual(polluted.value, clean);
  assert.equal(polluted.setterHits + polluted.getterReads, 0);
  assert.equal(beatsToSeconds(10, polluted.value), beatsToSeconds(10, clean));
  const replaced = withIndexedAccessors(() => replaceTempoFrom(2, 150, clean));
  assert.deepStrictEqual(replaced.value, replaceTempoFrom(2, 150, clean));
  assert.equal(replaced.setterHits + replaced.getterReads, 0);
});

test('prepared and bank voices keep their own operator slots despite inherited index accessors', async () => {
  const prepared = withIndexedAccessors(() => prepareVoice(brass));
  assert.deepStrictEqual(prepared.value, prepareVoice(brass));
  assert.equal(prepared.setterHits + prepared.getterReads, 0);
  assert.ok(Object.isFrozen(prepared.value.ops));
  const bank = withIndexedAccessors(() => parseVoiceBank([brass]));
  assert.deepStrictEqual(bank.value, parseVoiceBank([brass]));
  assert.equal(bank.setterHits + bank.getterReads, 0);
  const opm = new OPM();
  try {
    opm.replaceVoiceBank([brass]);
    const clean = opm.exportVoiceBank();
    const replaced = withIndexedAccessors(() => {
      opm.replaceVoiceBank([brass]);
      return opm.exportVoiceBank();
    });
    assert.equal(replaced.value, clean);
    assert.equal(replaced.setterHits + replaced.getterReads, 0);
  } finally { await opm.dispose(); }
});

test('control tuples keep their own slots despite inherited index accessors', () => {
  const adsr = { a: 0.1, d: 0.2, s: 0.5, r: 0.3 };
  const input: NoteControls = {
    operatorLevels: [0.1, 0.2, 0.3, 0.4],
    operatorRatios: [1, 2, 3, 4],
    operatorFrequencies: [440, null, 880, 1000],
    operatorADSR: [adsr, { ...adsr, sr: 1 }, adsr, adsr],
  };
  const clean = validateNoteControls(input);
  const polluted = withIndexedAccessors(() => validateNoteControls(input));
  assert.deepStrictEqual(polluted.value, clean);
  assert.equal(polluted.setterHits + polluted.getterReads, 0);
  assert.ok(Object.isFrozen(polluted.value.operatorLevels));
});

test('prepared sequences keep their own events despite inherited index accessors', () => {
  const voice = prepareVoice(brass);
  const events = [
    { type: 'note' as const, id: 1, time: 0, duration: 0.5, note: 60, voice },
    { type: 'control' as const, id: 1, time: 0.25, controls: { expression: 0.5 } },
    { type: 'stop' as const, id: 1, time: 0.4 },
  ];
  const clean = prepareSequence(events);
  const polluted = withIndexedAccessors(() => prepareSequence(events));
  assert.deepStrictEqual(polluted.value, clean);
  assert.equal(polluted.setterHits + polluted.getterReads, 0);
  assert.ok(Object.isFrozen(polluted.value.events));
});

test('tuning tables keep their own cents despite inherited index accessors', () => {
  const offsets = Array.from({ length: 128 }, (_, index) => (index % 12) * 5 - 20);
  const clean = normalizeTuning({ offsets });
  const polluted = withIndexedAccessors(() => normalizeTuning({ offsets }));
  assert.deepStrictEqual(polluted.value, clean);
  assert.equal(polluted.setterHits + polluted.getterReads, 0);
  // A previously validated table is detached by slicing; its copy must stay own data too.
  const reused = withIndexedAccessors(() => normalizeTuning({ offsets: polluted.value.offsets }));
  assert.deepStrictEqual(reused.value, clean);
  assert.equal(reused.setterHits + reused.getterReads, 0);
  assert.equal(tuningFrequency(64.5, polluted.value), tuningFrequency(64.5, clean));
});

test('arrangement definitions keep their own prepared scores despite inherited index accessors', () => {
  // Five points keep tempo conversion on its cached path; the accessors only cover indices 0..3.
  const definition = {
    layers: [{ name: 'lead', length: 4, events: [{ type: 'note' as const, id: 1, beat: 0, duration: 1, note: 60 }] }],
    sections: [{ name: 'main', layers: ['lead'] }],
    initialSection: 'main',
    tempoMap: [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 100 }, { beat: 8, bpm: 90 }, { beat: 16, bpm: 80 }, { beat: 32, bpm: 70 }],
  };
  const clean = prepareArrangementDefinition(definition);
  const polluted = withIndexedAccessors(() => prepareArrangementDefinition(definition));
  assert.deepStrictEqual(polluted.value, clean);
  assert.equal(polluted.setterHits + polluted.getterReads, 0);
  assert.ok(Object.isFrozen(polluted.value.scores));
});
