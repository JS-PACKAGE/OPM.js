import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createPerformance } from '../src/api/performance.js';
import type { Performance } from '../src/api/performance.js';
import type { OPM } from '../src/api/index.js';
import type { NoteControls } from '../src/api/index.js';
import { installWorkletHarness, startedEngine, renderFrames } from './worklet-harness.js';

const restore = await installWorkletHarness();
after(restore);

async function setup(maxVoices = 8): Promise<{ opm: OPM; performance: Performance; updates: { id: number; controls: NoteControls }[] }> {
  const opm = await startedEngine({ maxVoices });
  const updates: { id: number; controls: NoteControls }[] = [];
  const original = opm.updateNote.bind(opm);
  opm.updateNote = (id, controls, options) => { updates.push({ id, controls }); return original(id, controls, options); };
  return { opm, performance: createPerformance(opm), updates };
}

test('part voice limits count release tails and free as soon as the tail ends', async () => {
  const { opm, performance } = await setup();
  try {
    performance.configurePart(0, { voice: 'brass', voiceLimit: 2 });
    const first = performance.noteOn(0, 60);
    performance.noteOn(0, 64);
    renderFrames(opm, 256);
    assert.throws(() => performance.noteOn(0, 67), /voice limit/);
    assert.equal(performance.getPart(0).voiceLimit, 2);
    performance.noteOff(0, first);
    assert.throws(() => performance.noteOn(0, 67), /voice limit/, 'a releasing gate still owns a voice');
    renderFrames(opm, 16000 * 2);
    performance.noteOn(0, 67);
    performance.noteOn(1, 67);
    assert.throws(() => performance.configurePart(0, { voiceLimit: 33 }), RangeError);
    assert.throws(() => performance.configurePart(0, { voicePriority: 128 }), RangeError);
  } finally { performance.dispose(); await opm.dispose(); }
});

test('part priority protects a held melody from lower-priority accompaniment', async () => {
  const { opm, performance } = await setup(1);
  try {
    performance.configurePart(0, { voice: 'brass', voicePriority: 100 });
    performance.configurePart(1, { voice: 'brass', voicePriority: 0 });
    const melody = performance.noteOn(0, 72);
    renderFrames(opm, 512);
    performance.noteOn(1, 48);
    renderFrames(opm, 512);
    assert.deepEqual(performance.getPart(1).keys, [], 'rejected accompaniment leaves no phantom held key');
    const snapshot = performance.getPart(0).keys.find(key => key.key === melody)!;
    assert.equal(snapshot.held, true);
    assert.notEqual(snapshot.gateId, null);
    assert.equal((await opm.getDiagnostics()).activeVoices, 1);
    performance.noteOn(0, 74);
    renderFrames(opm, 512);
    assert.equal((await opm.getDiagnostics()).activeVoices, 1, 'an equal-or-higher priority note may displace the melody');
  } finally { performance.dispose(); await opm.dispose(); }
});

test('per-key and per-part controls address sounding gates and later notes without cross-talk', async () => {
  const { opm, performance, updates } = await setup();
  try {
    const a = performance.noteOn(0, 60);
    const b = performance.noteOn(0, 64);
    const ids = new Map(performance.getPart(0).keys.map(key => [key.key, key.gateId!]));
    updates.length = 0;
    assert.equal(performance.updateKey(0, a, { feedback: 5 }), true);
    assert.deepEqual(updates.map(update => update.id), [ids.get(a)]);
    assert.equal(updates[0]!.controls.feedback, 5);
    updates.length = 0;
    performance.updatePartNotes(0, { operatorRatios: [2, 1, 1, 1] });
    assert.deepEqual(new Set(updates.map(update => update.id)), new Set([ids.get(a), ids.get(b)]));
    assert.ok(updates.every(update => update.controls.operatorRatios?.[0] === 2));
    assert.equal(updates.find(update => update.id === ids.get(a))!.controls.feedback, 5, 'key-specific state survives part updates');
    assert.equal(updates.find(update => update.id === ids.get(b))!.controls.feedback, undefined);
    const c = performance.noteOn(0, 67);
    assert.equal(updates.at(-1)!.controls.operatorRatios?.[0], 2, 'future notes inherit part controls');
    assert.equal(performance.updateKey(0, 99999, { feedback: 1 }), false);
    assert.throws(() => performance.updateKey(0, c, { feedback: 99 }), RangeError);
    assert.throws(() => performance.updateKey(0, c, {}), TypeError);
    renderFrames(opm, 512);
  } finally { performance.dispose(); await opm.dispose(); }
});

test('mono legato retargets controls to the selected key and keeps inactive key state separate', async () => {
  const { opm, performance, updates } = await setup();
  try {
    performance.configurePart(0, { voice: 'brass', mode: 'mono', legato: true, glide: 0 });
    const low = performance.noteOn(0, 60);
    const high = performance.noteOn(0, 67);
    const gate = performance.getPart(0).keys.find(key => key.key === high)!.gateId!;
    updates.length = 0;
    performance.updateKey(0, low, { feedback: 3 });
    assert.equal(updates.length, 0, 'an inactive mono key must not alter the sounding gate');
    performance.noteOff(0, high);
    const retarget = updates.find(update => update.id === gate && update.controls.feedback === 3);
    assert.ok(retarget, 'releasing the selected key hands the shared gate to the remaining key controls');
    assert.ok(Math.abs(retarget.controls.pitch!) < 1e-9, 'the shared gate was anchored on the low key, so no offset remains');
  } finally { performance.dispose(); await opm.dispose(); }
});
