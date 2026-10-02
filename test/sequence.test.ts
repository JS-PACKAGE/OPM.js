import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, prepareSequence, renderNote, renderSequence, MAX_SEQUENCE_NOTES, MAX_SEQUENCE_SLOTS } from '../src/core/index.js';
import type { SequenceEvent, SequenceNoteEvent } from '../src/core/sequence.js';
import type { Voice } from '../src/voices/schema.js';

function toneVoice(release = 0.006): Voice {
  return {
    version: 4, name: 'score', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { waveform: 'sine', rate: 0, amDepth: 0, pmDepth: 0 },
    ops: Array.from({ length: 4 }, (_, index) => ({ ratio: 1, level: index === 0 ? 1 : 0, detune: 0,
      adsr: { a: 0, d: 0, s: 1, r: release } })) as Voice['ops'],
  };
}

const sampleRate = 8000;

test('a short fractional-note chord has exact onsets, ceil gates, release tails and deterministic stereo WAV audio', () => {
  const voice = toneVoice();
  const events: SequenceEvent[] = [
    { type: 'note', id: 1, time: 16.4 / sampleRate, duration: 32.2 / sampleRate, voice, note: 60.5, pan: -1 },
    { type: 'note', id: 2, time: 16.4 / sampleRate, duration: 32.2 / sampleRate, voice, note: 67.25, pan: 1 },
  ];
  const result = renderSequence(events, { sampleRate });
  assert.deepEqual(renderSequence(events, { sampleRate }).left, result.left);
  assert.deepEqual(renderSequence(events, { sampleRate }).right, result.right);
  assert.deepEqual(result.diagnostics, { errors: 0 });
  assert.ok(result.left.subarray(0, 16).every(value => value === 0));
  assert.ok(result.right.subarray(0, 16).every(value => value === 0));
  assert.ok(result.left.subarray(16, 49).some(value => Math.abs(value) > 0.01));
  assert.ok(result.right.subarray(16, 49).some(value => Math.abs(value) > 0.01));
  assert.notDeepEqual(result.left, result.right);
  const leftNote = renderNote({ voice, note: 60.5, duration: 32.2 / sampleRate, pan: -1, sampleRate });
  const rightNote = renderNote({ voice, note: 67.25, duration: 32.2 / sampleRate, pan: 1, sampleRate });
  assert.deepEqual(result.left.subarray(16, 16 + leftNote.left.length), leftNote.left);
  assert.deepEqual(result.right.subarray(16, 16 + rightNote.right.length), rightNote.right);
  assert.ok(result.left.subarray(49, 65).some(value => value !== 0), 'release starts after the full 33-frame gate');
  assert.ok(result.left.subarray(-32).every(value => value === 0));
  const wav = encodeWav({ left: result.left, right: result.right, sampleRate });
  const pcm = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(pcm.getUint16(22, true), 2);
  assert.equal(pcm.getUint32(40, true), result.left.length * 4);
  for (let frame = 0; frame < result.left.length; frame++) {
    const left = result.left[frame];
    const right = result.right[frame];
    assert.equal(pcm.getInt16(44 + frame * 4, true), Math.round(left * (left < 0 ? 32768 : 32767)) | 0);
    assert.equal(pcm.getInt16(46 + frame * 4, true), Math.round(right * (right < 0 ? 32768 : 32767)) | 0);
  }
});

test('pending controls clamp to onset and expression automation still applies during a release tail', () => {
  const events: SequenceEvent[] = [
    { type: 'control', id: 9, time: 0, controls: { expression: 0 } },
    { type: 'note', id: 9, time: 32 / sampleRate, duration: 80 / sampleRate, voice: toneVoice(), note: 69 },
    { type: 'control', id: 9, time: 48 / sampleRate, controls: { expression: 1, pan: 1 } },
    { type: 'control', id: 9, time: 120 / sampleRate, controls: { expression: 0 } },
  ];
  const result = renderSequence(events, { sampleRate });
  assert.ok(result.left.every(value => value === 0));
  assert.ok(result.right.subarray(0, 48).every(value => value === 0));
  assert.ok(result.right.subarray(48, 112).some(value => Math.abs(value) > 0.01));
  assert.ok(result.right.subarray(112, 120).some(value => Math.abs(value) > 1e-6));
  assert.ok(result.right.subarray(120).every(value => value === 0));
});

test('stops before or tied with an onset cancel only their targeted notes regardless of input ordering', () => {
  for (const stopFrame of [0, 32]) {
    const events: SequenceEvent[] = [
      { type: 'stop', id: 1, time: stopFrame / sampleRate },
      { type: 'note', id: 1, time: 32 / sampleRate, duration: 0.01, voice: toneVoice(), note: 69, pan: -1 },
      { type: 'note', id: 2, time: 32 / sampleRate, duration: 0.01, voice: toneVoice(), note: 72, pan: 1 },
      { type: 'control', id: 1, time: 0, controls: { expression: 1 } },
    ];
    const result = renderSequence(events, { sampleRate });
    assert.ok(result.left.every(value => value === 0));
    assert.ok(result.right.subarray(32, 112).some(value => Math.abs(value) > 0.01));
  }
});

test('the ninth simultaneous note steals the oldest with a bounded fade instead of leaving its gate alive', () => {
  const events: SequenceNoteEvent[] = Array.from({ length: 9 }, (_, index) => ({
    type: 'note', id: index + 1, time: 0, duration: 0.02, voice: toneVoice(), note: 48 + index * 3,
  }));
  const stolen = renderSequence(events, { sampleRate });
  const surviving = renderSequence(events.slice(1), { sampleRate });
  assert.notDeepEqual(stolen.left.subarray(0, 40), surviving.left.subarray(0, 40));
  assert.deepEqual(stolen.left.subarray(40), surviving.left.subarray(40));
  assert.ok(stolen.left.subarray(-32).every(value => value === 0));
});

test('whole-score preparation rejects malformed or over-budget data without invoking accessors', () => {
  const note: SequenceNoteEvent = { type: 'note', id: 1, time: 0, duration: 0.01, voice: toneVoice(), note: 60.5 };
  const limit = Array.from({ length: MAX_SEQUENCE_NOTES }, (_, index) => ({ ...note, id: index + 1 }));
  assert.equal(prepareSequence(limit).reservedSlots, MAX_SEQUENCE_SLOTS);
  assert.throws(() => prepareSequence([...limit, { type: 'control', id: 1, time: 0, controls: { pan: 0 } }]), /slot budget/);
  assert.throws(() => prepareSequence([...limit, { ...note, id: 129 }]), /note budget/);
  assert.throws(() => prepareSequence([note, note]), /Duplicate/);
  assert.throws(() => prepareSequence([{ ...note, time: 59, duration: 2 }]), /horizon/);
  assert.throws(() => prepareSequence([{ ...note, duration: 0 }]), /greater than zero/);
  assert.throws(() => prepareSequence([note, { type: 'stop', id: 2, time: 0 }]), /Unknown sequence note id/);
  assert.throws(() => prepareSequence([{ ...note, voice: 'missing' }]), /Unknown sequence voice/);
  let reads = 0;
  const accessor = { ...note };
  Object.defineProperty(accessor, 'note', { get() { reads++; return 60; } });
  assert.throws(() => prepareSequence([note, accessor]), /must be data/);
  const arrayAccessor: SequenceEvent[] = [note];
  Object.defineProperty(arrayAccessor, '0', { get() { reads++; return note; } });
  assert.throws(() => prepareSequence(arrayAccessor), /own data/);
  const control: SequenceEvent = { type: 'control', id: 1, time: 0, controls: { pan: 0 } };
  Object.defineProperty(control.controls, 'pan', { get() { reads++; return 0; } });
  assert.throws(() => prepareSequence([note, control]), /must be data/);
  assert.equal(reads, 0);
});

test('prepared score owns immutable snapshots and native named-voice resolution bypasses registry getters', () => {
  const voice = toneVoice();
  const controls = { expression: 0.5 };
  const events: SequenceEvent[] = [
    { type: 'note', id: 1, time: 0, duration: 0.01, voice: 'custom', note: 69 },
    { type: 'control', id: 1, time: 0, controls },
  ];
  const voices = new Map([['custom', voice]]);
  Object.defineProperty(voices, 'get', { get() { throw Error('registry getter executed'); } });
  const snapshot = prepareSequence(events, { voices });
  voice.ops[0].ratio = 2;
  controls.expression = 0;
  events.length = 0;
  assert.equal(snapshot.events.length, 2);
  const note = snapshot.events[0];
  const control = snapshot.events[1];
  assert.equal(note.type, 'note');
  assert.equal(control.type, 'control');
  if (note.type !== 'note' || control.type !== 'control') throw Error('Unexpected score shape');
  assert.equal(note.voice.ops[0].ratio, 1);
  assert.equal(control.controls.expression, 0.5);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.events));
  assert.ok(Object.isFrozen(note.voice.ops[0].adsr) && Object.isFrozen(control.controls));
});

test('render budgets include release/filter tails and reject invalid engine configuration before rendering', () => {
  const events: SequenceNoteEvent[] = [{ type: 'note', id: 1, time: 0, duration: 60, voice: toneVoice(10), note: 69 }];
  assert.throws(() => renderSequence(events, { sampleRate: 96000 }), /sample budget/);
  assert.throws(() => renderSequence([], { sampleRate: 7999 }), /sampleRate/);
  assert.throws(() => renderSequence([], { mixGain: 2 }), /mixGain/);
  assert.throws(() => renderSequence([], { tuning: { referenceHz: NaN } }), /referenceHz/);
  const mute = renderSequence([{ ...events[0], duration: 0.01 }], { sampleRate, mixGain: 0 });
  assert.ok(mute.left.every(value => value === 0) && mute.right.every(value => value === 0));
});
