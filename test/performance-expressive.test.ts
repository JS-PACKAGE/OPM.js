import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createPerformance } from '../src/api/performance.js';
import type { Performance } from '../src/api/performance.js';
import type { OPM } from '../src/api/index.js';
import type { NoteControls } from '../src/api/index.js';
import { installWorkletHarness, startedEngine, renderFrames } from './worklet-harness.js';
import { withNamedAccessor } from './named-accessors-harness.js';

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

test('mono legato retarget keeps pitch and glide despite inherited setters', async () => {
  async function retarget(key?: string): Promise<{ controls: NoteControls; setterHits: number }> {
    const { opm, performance, updates } = await setup();
    try {
      performance.configurePart(0, { voice: 'brass', mode: 'mono', legato: true, glide: 0.25 });
      const low = performance.noteOn(0, 60);
      const high = performance.noteOn(0, 67);
      const gate = performance.getPart(0).keys.find(item => item.key === high)!.gateId!;
      performance.updateKey(0, low, { feedback: 3 });
      updates.length = 0;
      const release = (): boolean => performance.noteOff(0, high);
      const setterHits = key === undefined ? 0 : withNamedAccessor(key, release).setterHits;
      if (key === undefined) release();
      const update = updates.find(item => item.id === gate && item.controls.feedback === 3);
      assert.ok(update, 'the shared gate must be retargeted');
      return { controls: update.controls, setterHits };
    } finally { performance.dispose(); await opm.dispose(); }
  }
  const clean = await retarget();
  assert.equal(clean.controls.glide, 0.25);
  for (const key of ['pitch', 'glide']) {
    const polluted = await retarget(key);
    assert.equal(polluted.setterHits, 0, key);
    assert.deepStrictEqual(polluted.controls, clean.controls, key);
  }
});

test('part and key controls never read omitted fields through Object.prototype', async () => {
  // Getters answer with plausible but wrong values: a clean run is the only valid answer.
  async function run(key?: string, inherited?: unknown): Promise<unknown> {
    const { opm, performance, updates } = await setup();
    const plays: unknown[] = [];
    const playNote = opm.playNote.bind(opm);
    opm.playNote = ((options: Parameters<OPM['playNote']>[0]) => {
      plays.push(JSON.parse(JSON.stringify(options)));
      return playNote(options);
    }) as OPM['playNote'];
    try {
      performance.configurePart(0, { voice: 'brass', mode: 'mono', legato: true, glide: 0.25 });
      const play = (): void => {
        const low = performance.noteOn(0, 60);
        const high = performance.noteOn(0, 67);
        performance.updateKey(0, low, { feedback: 3 });
        performance.updatePart(0, { expression: 0.5 });
        performance.noteOff(0, high);
        performance.noteOff(0, low);
      };
      if (key === undefined) play(); else withNamedAccessor(key, play, inherited);
      return JSON.parse(JSON.stringify({ plays, updates }));
    } finally { performance.dispose(); await opm.dispose(); }
  }
  const clean = await run();
  for (const [key, inherited] of [['pitch', 36], ['glide', 5], ['expression', 0.1], ['pan', 1], ['gain', 0.1],
    ['modulation', 2], ['ramp', 5], ['frequency', 40], ['feedback', 7]] as const) {
    assert.deepStrictEqual(await run(key, inherited), clean, key);
  }
});
