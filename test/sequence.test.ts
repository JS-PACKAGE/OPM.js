import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth, encodeWav, prepareSequence, renderNote, renderSequence, MAX_SEQUENCE_NOTES, MAX_SEQUENCE_SLOTS } from '../src/core/index.js';
import type { SequenceEvent, SequenceNoteEvent, SequenceControlEvent } from '../src/core/sequence.js';
import { estimateSequenceCapacity, prepareLongSequence, renderSequenceChunks, MAX_LONG_SEQUENCE_EVENTS } from '../src/core/sequence.js';
import type { Voice, ADSR } from '../src/voices/schema.js';

function toneVoice(release = 0.006): Voice {
  return {
    version: 8, name: 'score', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { waveform: 'sine', rate: 0, amDepth: 0, pmDepth: 0 },
    ops: Array.from({ length: 4 }, (_, index) => ({ ratio: 1, level: index === 0 ? 1 : 0, detune: 0,
      adsr: { a: 0, d: 0, s: 1, r: release } })) as Voice['ops'],
  };
}

const sampleRate = 8000;

// A hard gain step rings through the shared post-mix decimator before it snaps to zero.
const DECIMATOR_SETTLE_FRAMES = 64;

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
  assert.ok(result.right.subarray(120 + DECIMATOR_SETTLE_FRAMES).every(value => value === 0));
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
  // After the 40-frame fade, only decimator history of the stolen note remains.
  const settled = 40 + DECIMATOR_SETTLE_FRAMES;
  assert.ok(stolen.left.subarray(settled).every((value, index) => Math.abs(value - surviving.left[settled + index]) < 2e-7));
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

test('negative sequence lengths reject before inspecting event keys', () => {
  let traversals = 0;
  const events = new Proxy<SequenceEvent[]>([], {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'length') return { value: -1, writable: true, enumerable: false, configurable: false };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    ownKeys(target) { traversals++; return Reflect.ownKeys(target); },
  });
  assert.throws(() => prepareSequence(events), RangeError);
  assert.equal(traversals, 0);
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

test('omitted preparation options ignore inherited registries without changing sound', () => {
  const events: SequenceNoteEvent[] = [{ type: 'note', id: 1, time: 0, duration: 0.01, note: 69 }];
  const expected = prepareSequence(events);
  const inherited = Object.getOwnPropertyDescriptor(Object.prototype, 'voices');
  let reads = 0;
  let actual: typeof expected;
  Object.defineProperty(Object.prototype, 'voices', {
    configurable: true,
    get() { reads++; throw Error('Inherited registry must not be read'); },
  });
  try {
    actual = prepareSequence(events);
  } finally {
    if (inherited) Object.defineProperty(Object.prototype, 'voices', inherited);
    else Reflect.deleteProperty(Object.prototype, 'voices');
  }
  assert.equal(reads, 0);
  assert.deepEqual(actual.events, expected.events);
  const before = renderSequence(expected.events, { sampleRate });
  const after = renderSequence(actual.events, { sampleRate });
  assert.ok(before.left.some(value => value !== 0));
  assert.deepEqual(after.left, before.left);
  assert.deepEqual(after.right, before.right);
});

test('raw patches detach per occurrence when later event descriptors mutate the caller source', () => {
  const voice = toneVoice();
  const first: SequenceNoteEvent = { type: 'note', id: 1, time: 0, duration: 0.01, voice, note: 69 };
  let changed = false;
  const later = new Proxy<SequenceNoteEvent>({ ...first, id: 2, time: 0.01 }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'type' && !changed) {
        changed = true;
        voice.ops[0].ratio = 2;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const snapshot = prepareSequence([first, later]);
  const before = snapshot.events[0], after = snapshot.events[1];
  if (before.type !== 'note' || after.type !== 'note') throw Error('Expected notes');
  assert.equal(before.voice.ops[0].ratio, 1);
  assert.equal(after.voice.ops[0].ratio, 2);
  voice.ops[0].ratio = 3;
  assert.equal(before.voice.ops[0].ratio, 1);
  assert.equal(after.voice.ops[0].ratio, 2);
});

test('raw controls detach per occurrence before later event descriptors change their sound', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const voice = toneVoice();
    const levels: [number, number, number, number] = [0.5, 0, 0, 0];
    const controls = { expression: 0.25, operatorLevels: levels };
    const note: SequenceNoteEvent = { type: 'note', id: 1, time: 0, duration: 0.04, note: 69, voice };
    const first: SequenceControlEvent = { type: 'control', id: 1, time: 0, controls };
    let changed = false;
    const later = new Proxy<SequenceControlEvent>({ type: 'control', id: 1, time: 0.02, controls }, {
      getOwnPropertyDescriptor(target, key) {
        if (key === 'type' && !changed) {
          changed = true;
          controls.expression = 0.75;
          levels[0] = 1;
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const snapshot = prepareSequence([note, first, later]);
    controls.expression = 0;
    levels[0] = 0;
    const before = snapshot.events[1], after = snapshot.events[2];
    if (before.type !== 'control' || after.type !== 'control') throw Error('Expected controls');
    assert.equal(before.controls.expression, 0.25);
    assert.equal(before.controls.operatorLevels?.[0], 0.5);
    assert.equal(after.controls.expression, 0.75);
    assert.equal(after.controls.operatorLevels?.[0], 1);
    const result = renderSequence(snapshot.events, { sampleRate, quality });
    const reference = renderSequence([
      note,
      { type: 'control', id: 1, time: 0, controls: { expression: 0.25, operatorLevels: [0.5, 0, 0, 0] } },
      { type: 'control', id: 1, time: 0.02, controls: { expression: 0.75, operatorLevels: [1, 0, 0, 0] } },
    ], { sampleRate, quality });
    assert.deepEqual(result.left, reference.left);
    assert.deepEqual(result.right, reference.right);
    assert.equal(result.diagnostics.errors, 0);
    // Compare settled windows on either side of the 20 ms gain change.
    const rms = (start: number) => Math.sqrt(result.left.subarray(start, start + 80).reduce((sum, value) => sum + value * value, 0) / 80);
    const early = rms(DECIMATOR_SETTLE_FRAMES), late = rms(224);
    assert.ok(early > 0 && late > 3 * early);
  }
});

test('frozen raw event containers still observe changing note, voice and control sources on each call', () => {
  const voice = toneVoice();
  const note: SequenceNoteEvent = { type: 'note', id: 1, time: 0, duration: 0.01, voice, note: 69 };
  const levels: [number, number, number, number] = [1, 1, 1, 1];
  const control: SequenceEvent = { type: 'control', id: 1, time: 0, controls: { operatorLevels: levels } };
  const events = Object.freeze([note, control]);
  const first = prepareSequence(events);
  note.note = 72;
  voice.ops[0].ratio = 2;
  levels[0] = 0.25;
  const second = prepareSequence(events);
  const before = first.events[0], after = second.events[0];
  const beforeControl = first.events[1], afterControl = second.events[1];
  if (before.type !== 'note' || after.type !== 'note' || beforeControl.type !== 'control' || afterControl.type !== 'control') throw Error('Unexpected score');
  assert.equal(before.note, 69);
  assert.equal(after.note, 72);
  assert.equal(before.voice.ops[0].ratio, 1);
  assert.equal(after.voice.ops[0].ratio, 2);
  assert.equal(beforeControl.controls.operatorLevels?.[0], 1);
  assert.equal(afterControl.controls.operatorLevels?.[0], 0.25);
});

test('prepared long inputs retain short score, PCM and option validation boundaries', () => {
  const base: SequenceNoteEvent = { type: 'note', id: 1, time: 0, duration: 0.01, voice: toneVoice(), note: 69 };
  const notes = Array.from({ length: MAX_SEQUENCE_NOTES + 1 }, (_, index) => ({ ...base, id: index + 1 }));
  const allowed = prepareLongSequence(notes.slice(0, MAX_SEQUENCE_NOTES));
  const short = prepareSequence(allowed.events);
  assert.equal(short.noteCount, MAX_SEQUENCE_NOTES);
  assert.equal(short.reservedSlots, MAX_SEQUENCE_SLOTS);
  const control: SequenceEvent = { type: 'control', id: 1, time: 0, controls: { expression: 0.5 } };
  const overflowNotes = prepareLongSequence(notes);
  const overflowSlots = prepareLongSequence([...notes.slice(0, MAX_SEQUENCE_NOTES), control]);
  const overflowEvents = prepareLongSequence([base, ...Array.from({ length: MAX_SEQUENCE_SLOTS }, () => control)]);
  const overflowTime = prepareLongSequence([{ ...base, time: 60 }]);
  for (const score of [overflowNotes, overflowSlots, overflowEvents, overflowTime]) {
    assert.throws(() => prepareSequence(score.events), RangeError);
  }
  const fullPcm = prepareLongSequence([{ ...base, duration: 60 }]);
  assert.throws(() => renderSequence(fullPcm.events, { sampleRate: 96000 }), RangeError);
  assert.throws(() => prepareSequence(allowed.events, { voices: {} as Map<string, Voice> }), TypeError);
  let reads = 0;
  const options = Object.defineProperty({}, 'voices', { get() { reads++; return new Map(); } });
  assert.throws(() => prepareSequence(allowed.events, options), TypeError);
  assert.equal(reads, 0);
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

test('borrowed chunks concatenate bit-exactly across stop/onset/control boundaries with cumulative diagnostics', () => {
  const score: SequenceEvent[] = [
    { type: 'note', id: 1, time: 7 / sampleRate, duration: 25 / sampleRate, note: 69, voice: toneVoice() },
    { type: 'control', id: 1, time: 0, controls: { expression: 0.3, operatorLevels: [0.5, 1, 1, 1] } },
    { type: 'control', id: 1, time: 14 / sampleRate, controls: { pan: 1, ramp: 5 / sampleRate } },
    { type: 'stop', id: 2, time: 21 / sampleRate },
    { type: 'note', id: 2, time: 21 / sampleRate, duration: 0.01, note: 72, voice: toneVoice() },
  ];
  const full = renderSequence(score, { sampleRate });
  for (const chunkFrames of [1, 7, 32, 65536]) {
    const renderer = renderSequenceChunks(score, { sampleRate, chunkFrames });
    const left = new Float32Array(renderer.capacity.frames);
    const right = new Float32Array(renderer.capacity.frames);
    let firstBuffer: ArrayBufferLike | undefined;
    for (const chunk of renderer) {
      firstBuffer ??= chunk.left.buffer;
      assert.equal(chunk.left.buffer, firstBuffer);
      assert.equal(chunk.diagnostics.renderedFrames, chunk.offset + chunk.frames);
      left.set(chunk.left, chunk.offset);
      right.set(chunk.right, chunk.offset);
    }
    assert.deepEqual(left, full.left);
    assert.deepEqual(right, full.right);
    assert.equal(renderer.diagnostics.processedEvents, prepareLongSequence(score).reservedSlots);
    assert.equal(renderer.diagnostics.errors, 0);
    assert.equal(renderer.capacity.pcmBytes, left.byteLength + right.byteLength);
  }
});

test('live ADSR changes retain extended and reanchored release tails in offline output', () => {
  const voice = toneVoice(0.03);
  const first = voice.ops.map(op => ({ ...op.adsr, r: 0.2 })) as [ADSR, ADSR, ADSR, ADSR];
  const second = first.map(adsr => ({ ...adsr, r: 0.3 })) as typeof first;
  const score: SequenceEvent[] = [
    { type: 'note', id: 1, time: 0, duration: 0.1, note: 69, voice },
    { type: 'control', id: 1, time: 0.05, controls: { operatorADSR: first } },
    { type: 'control', id: 1, time: 0.12, controls: { operatorADSR: second } },
  ];
  const output = renderSequence(score, { sampleRate });
  const synth = new Synth(sampleRate);
  const id = synth.noteOn(voice, 69);
  const left = new Float32Array(output.left.length), right = new Float32Array(output.right.length);
  synth.render(left, right, 0, 400);
  synth.updateNote(id, { operatorADSR: first });
  synth.render(left, right, 400, 400);
  synth.noteOff(id);
  synth.render(left, right, 800, 160);
  synth.updateNote(id, { operatorADSR: second });
  synth.render(left, right, 960, left.length - 960);
  assert.deepEqual(output.left, left);
  assert.deepEqual(output.right, right);
  assert.ok(left.subarray(1040, 1440).some(value => Math.abs(value) > 0.001), 'extended release remains audible beyond the original tail');
  assert.ok(left.subarray(-32).every(value => value === 0), 'render retains the complete reanchored tail');
  assert.throws(() => renderSequenceChunks(score, { sampleRate, maxFrames: 1600 }));
});

test('60-second96k and beyond60-second scores use bounded reusable PCM with accurate capacity', () => {
  for (const duration of [60, 61]) {
    const score: SequenceEvent[] = [{ type: 'note', id: 1, time: duration - 0.001, duration: 0.001, note: 69, voice: toneVoice(0) }];
    const options = { sampleRate: 96000, chunkFrames: 65536, mixGain: 0 };
    const capacity = estimateSequenceCapacity(score, options);
    assert.equal(capacity.frames, duration * 96000 + 960);
    assert.equal(capacity.chunkBytes, 65536 * 8);
    assert.equal(capacity.fullBufferAllowed, false);
    assert.equal(capacity.singleBatchAllowed, duration === 60);
    const renderer = renderSequenceChunks(score, options);
    let consumed = 0;
    for (const chunk of renderer) {
      consumed += chunk.frames;
      assert.ok(chunk.left.byteLength <= 65536 * 4);
      assert.ok(chunk.left.every(value => value === 0));
    }
    assert.equal(consumed, capacity.frames);
    assert.equal(renderer.diagnostics.renderedFrames, capacity.frames);
  }
});

test('cancellation and work limits reject before advancement and hostile input never invokes accessors', () => {
  const note: SequenceNoteEvent = { type: 'note', id: 1, time: 0, duration: 1, note: 69, voice: toneVoice() };
  assert.throws(() => renderSequenceChunks([note], { sampleRate, maxFrames: 32 }), /cumulative/);
  assert.throws(() => prepareLongSequence(Array(MAX_LONG_SEQUENCE_EVENTS + 1).fill(note)), /event budget/);
  assert.throws(() => prepareLongSequence([{ ...note, time: 86400 }]), /horizon/);
  let reads = 0;
  const hostile = { ...note };
  Object.defineProperty(hostile, 'voice', { get() { reads++; return toneVoice(); } });
  assert.throws(() => renderSequenceChunks([note, hostile]), /must be data/);
  assert.equal(reads, 0);
  const controller = new AbortController();
  const renderer = renderSequenceChunks([note], { sampleRate, chunkFrames: 16, signal: controller.signal });
  renderer.next();
  const before = renderer.diagnostics;
  controller.abort();
  assert.throws(() => renderer.next(), { name: 'AbortError' });
  assert.deepEqual(renderer.diagnostics, before);
  assert.equal(renderer.next().done, true);
  const cancelled = renderSequenceChunks([note], { sampleRate, chunkFrames: 16 });
  cancelled.next();
  cancelled.cancel();
  assert.equal(cancelled.next().done, true);
  assert.equal(cancelled.diagnostics.renderedFrames, 16);
});

test('terminal iterators preserve yielded PCM and diagnostics without further advancement', () => {
  for (const terminal of ['complete', 'cancel', 'return', 'abort'] as const) {
    const controller = new AbortController();
    const score: SequenceEvent[] = [{ type: 'note', id: 1, time: 0, duration: 0.02, note: 60, pan: -0.25, voice: toneVoice() }];
    const renderer = renderSequenceChunks(score, {
      sampleRate, chunkFrames: terminal === 'complete' ? 65536 : 64, signal: controller.signal,
    });
    const yielded = renderer.next();
    if (yielded.done) assert.fail('Expected the rendered note');
    const chunk = yielded.value, left = chunk.left.slice(), right = chunk.right.slice();
    const before = renderer.diagnostics;
    if (terminal === 'complete') assert.equal(before.renderedFrames, renderer.capacity.frames);
    else if (terminal === 'cancel') renderer.cancel();
    else if (terminal === 'return') renderer.return!();
    else {
      controller.abort();
      assert.throws(() => renderer.next(), { name: 'AbortError' });
    }
    assert.deepEqual(renderer.diagnostics, before);
    assert.equal(renderer.next().done, true);
    renderer.cancel();
    assert.deepEqual(renderer.diagnostics, before);
    assert.deepEqual(chunk.left, left);
    assert.deepEqual(chunk.right, right);
  }
});

test('capacity includes note-scaled release tails and detached operator controls', () => {
  const voice = toneVoice(0.1);
  voice.ops[0].rateKeyScale = 1;
  for (const op of voice.ops.slice(1)) op.adsr.r = 0;
  const levels: [number, number, number, number] = [0.2, 0.4, 0.6, 0.8];
  const score: SequenceEvent[] = [
    { type: 'note', id: 1, time: 0, duration: 0.01, note: 72, voice },
    { type: 'control', id: 1, time: 0, controls: { operatorLevels: levels } },
  ];
  assert.equal(estimateSequenceCapacity(score, { sampleRate }).frames, 80 + 400 + 80);
  const snapshot = prepareLongSequence(score);
  levels[0] = 2;
  const control = snapshot.events[1];
  if (control.type !== 'control') throw Error('Expected controls');
  assert.deepEqual(control.controls.operatorLevels, [0.2, 0.4, 0.6, 0.8]);
  assert.ok(Object.isFrozen(control.controls.operatorLevels));
});

test('capacity separates full-buffer, convenience-batch and default-stream window budgets', () => {
  const note: SequenceNoteEvent = { type: 'note', id: 1, time: 61, duration: 0.001, note: 69, voice: toneVoice(0) };
  const sparse = estimateSequenceCapacity([note], { sampleRate: 96000 });
  assert.equal(sparse.fullBufferAllowed, false);
  assert.equal(sparse.singleBatchAllowed, false);
  assert.equal(sparse.streamAllowed, true);
  assert.equal(sparse.peakWindowSlots, 2);
  const dense = estimateSequenceCapacity(Array.from({ length: 129 }, (_, index) => ({ ...note, id: index + 1 })));
  assert.equal(dense.streamAllowed, false);
  assert.equal(dense.peakWindowNotes, 129);
  assert.equal(dense.peakWindowSlots, 258);
});
