import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth, VoiceAdmissionError, renderNote, renderSequence } from '../src/core/index.js';
import type { SequenceEvent } from '../src/core/index.js';
import type { Voice } from '../src/voices/schema.js';

const voice: Voice = { version: 7, name: 'priority-tone', algorithm: 7, feedback: 0, modIndex: 0,
lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
ops: [1, 0, 0, 0].map(level => ({ ratio: 1, level, detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.05 } })) as unknown as Voice['ops'], };
const audio = (synth: Synth, frames: number) => {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  synth.render(left, right);
  return { left, right };
};

test('lower priority never displaces a protected voice and refusal leaves the engine untouched', () => {
  const synth = new Synth(16000, 2);
  const ended: [number, string][] = [];
  synth.onVoiceEnded = (id, reason) => { ended.push([id, reason]); };
  synth.noteOn(voice, 60, 1, { voicePriority: 10 });
  synth.noteOn(voice, 64, 2, { voicePriority: 10 });
  audio(synth, 64);
  const reference = new Synth(16000, 2);
  reference.noteOn(voice, 60, 1, { voicePriority: 10 });
  reference.noteOn(voice, 64, 2, { voicePriority: 10 });
  audio(reference, 64);
  assert.throws(() => synth.noteOn(voice, 67, 3, { voicePriority: 9 }), VoiceAdmissionError);
  assert.equal(synth.voices.length, 2);
  assert.equal(synth.lastStolenId, null);
  assert.deepEqual(ended, []);
  // The refused explicit ID was never consumed, so the next automatic ID is still 3.
  assert.equal(synth.noteOn(voice, 67, undefined, { voicePriority: 10 }), 3, 'equal priority may steal the oldest voice');
  assert.deepEqual(ended, [[1, 'stolen']]);
  const a = audio(synth, 256);
  const b = audio(reference, 256);
  assert.notDeepEqual(a.left, b.left, 'the equal-priority replacement changes the mix');
  assert.equal(synth.errorCount, 0);
});

test('the lowest priority is stolen before older higher priority voices', () => {
  const synth = new Synth(16000, 3, { stealing: 'oldest' });
  synth.noteOn(voice, 60, 1, { voicePriority: 50 });
  synth.noteOn(voice, 62, 2, { voicePriority: 1 });
  synth.noteOn(voice, 64, 3, { voicePriority: 20 });
  synth.noteOn(voice, 66, 4, { voicePriority: 30 });
  assert.deepEqual(synth.voices.map(active => active.id).sort(), [1, 3, 4]);
  synth.noteOn(voice, 68, 5, { voicePriority: 20 });
  assert.deepEqual(synth.voices.map(active => active.id).sort(), [1, 4, 5], 'priority 20 is the lowest eligible victim');
  assert.throws(() => synth.noteOn(voice, 70, 6, { voicePriority: 0 }), VoiceAdmissionError);
});

test('stealing policies break ties only inside the lowest eligible priority', () => {
  for (const stealing of ['oldest', 'release-first', 'quietest'] as const) {
    const synth = new Synth(16000, 2, { stealing });
    synth.noteOn(voice, 60, 1, { voicePriority: 7 });
    synth.noteOn(voice, 61, 2, { voicePriority: 3 });
    audio(synth, 32);
    synth.noteOff(1);
    synth.noteOn(voice, 62, 3, { voicePriority: 5 });
    assert.deepEqual(synth.voices.map(active => active.id).sort(), [1, 3], `${stealing}: released high priority outlives lower priority`);
  }
});

test('priority bounds are strict own data and validation happens before sounding state changes', () => {
  const synth = new Synth(16000);
  for (const bad of [-1, 128, 1.5, NaN, Infinity, '1', null, undefined, {}]) {
    assert.throws(() => synth.noteOn(voice, 60, undefined, { voicePriority: bad as number }), /voicePriority|integer/);
  }
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'voicePriority', { enumerable: true, get() { reads++; return 1; } });
  assert.throws(() => synth.noteOn(voice, 60, undefined, accessor), TypeError);
  assert.equal(reads, 0);
  assert.equal(synth.voices.length, 0);
  assert.equal(synth.noteOn(voice, 60, undefined, { voicePriority: 127 }), 1, 'rejected input consumes no IDs');
  assert.throws(() => renderNote({ voice, voicePriority: 128 }), RangeError);
});

test('opt-in 32-voice polyphony keeps eight bounded fades and the default 8-voice sound is unchanged', () => {
  assert.throws(() => new Synth(16000, 33), RangeError);
  const wide = new Synth(16000, 32);
  for (let id = 1; id <= 40; id++) wide.noteOn(voice, 36 + id, id);
  assert.equal(wide.voices.length, 32);
  assert.ok(wide.fades.length <= 8, 'eight stealing fades are the preallocated ceiling');
  const samples = audio(wide, 512);
  assert.ok(samples.left.every(Number.isFinite) && samples.left.every(value => Math.abs(value) <= 0.7 + 1e-6));
  assert.equal(wide.errorCount, 0);

  const defaultRender = new Synth(16000), explicit = new Synth(16000, 8);
  for (const synth of [defaultRender, explicit]) for (let id = 1; id <= 10; id++) synth.noteOn(voice, 48 + id, id);
  const a = audio(defaultRender, 1024), b = audio(explicit, 1024);
  assert.deepEqual(a.left, b.left);
  assert.deepEqual(a.right, b.right);
});

test('offline scores honor maxVoices and priority admission deterministically', () => {
  const score: SequenceEvent[] = [
    { type: 'note', id: 1, time: 0, duration: 0.2, note: 72, voice, voicePriority: 100 },
    { type: 'note', id: 2, time: 0.01, duration: 0.2, note: 48, voice },
    { type: 'note', id: 3, time: 0.02, duration: 0.2, note: 50, voice },
  ];
  const protectedMelody = renderSequence(score, { sampleRate: 16000, maxVoices: 1 });
  const melodyOnly = renderSequence(score.slice(0, 1), { sampleRate: 16000, maxVoices: 1 });
  assert.deepEqual(protectedMelody.left.subarray(0, melodyOnly.left.length), melodyOnly.left, 'rejected accompaniment leaves the protected melody bitwise intact');
  assert.ok(protectedMelody.left.subarray(melodyOnly.left.length).every(value => value === 0));
  assert.equal(protectedMelody.diagnostics.errors, 0);
  const repeat = renderSequence(score, { sampleRate: 16000, maxVoices: 1 });
  assert.deepEqual(repeat.left, protectedMelody.left);
  assert.throws(() => renderSequence(score, { sampleRate: 16000, maxVoices: 33 }), RangeError);
  assert.throws(() => renderSequence([{ ...score[0]!, voicePriority: 1.5 } as SequenceEvent], { sampleRate: 16000 }), RangeError);
  const unprotected = renderSequence(score.map(event => event.type === 'note' ? { ...event, voicePriority: 0 } : event), { sampleRate: 16000, maxVoices: 1 });
  assert.notDeepEqual(unprotected.left, melodyOnly.left);
});
