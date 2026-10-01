import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { brass } from '../src/voices/brass.js';
import { renderNote } from '../src/core/index.js';

const globals = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor'];
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let Processor;
globalThis.sampleRate = 16000;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = {}; } };
globalThis.registerProcessor = (name, constructor) => {
  assert.equal(name, 'opm-processor');
  Processor = constructor;
};
try {
  await import('../src/worklet/processor.js');
} catch (error) {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  throw error;
}
after(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function block(processor, frame) {
  globalThis.currentFrame = frame;
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  assert.equal(processor.process([], [[left, right]]), true);
  assert.deepEqual(left, right);
  assert.ok(left.every(Number.isFinite));
  return left;
}

test('a note starts and finishes at exact mid-block frame boundaries', () => {
  const processor = new Processor();
  processor.receive({ type: 'noteOn', id: 11, voice: brass, note: 69, at: 32 / 16000, duration: 32 / 16000 });
  const samples = block(processor, 0);
  assert.ok(samples.subarray(0, 32).every(sample => sample === 0));
  assert.ok(samples.subarray(32, 64).some(sample => sample !== 0));
  assert.equal(processor.events.length, 0);
  for (let frame = 128; frame < 4096; frame += 128) block(processor, frame);
  assert.ok(block(processor, 4096).every(sample => sample === 0));
});

test('noteOff stops an already active note before its scheduled duration', () => {
  const processor = new Processor();
  processor.receive({ type: 'noteOn', id: 12, voice: brass, note: 69, at: 0, duration: 1 });
  assert.ok(block(processor, 0).some(sample => sample !== 0));
  processor.receive({ type: 'noteOff', id: 12 });
  assert.equal(processor.events.length, 0);
  for (let frame = 128; frame < 4096; frame += 128) block(processor, frame);
  assert.ok(block(processor, 4096).every(sample => sample === 0));
});

test('late, repeated and unknown stops are harmless and do not report rejected admissions', () => {
  globalThis.currentFrame = 0;
  const processor = new Processor();
  const replies = [];
  processor.port.postMessage = message => replies.push(message);
  processor.receive({ type: 'noteOn', id: 1, voice: brass, note: 69, at: 0, duration: 32 / 16000 });
  for (let frame = 0; frame <= 4096; frame += 128) block(processor, frame);
  assert.ok(replies.some(message => message.id === 1 && message.state === 'ended'));
  const lifecycle = replies.slice();
  for (const id of [1, 1, 999]) processor.receive({ type: 'noteOff', id });
  assert.deepEqual(replies, lifecycle);
  processor.receive({ type: 'diagnostics', requestId: 1 });
  assert.equal(replies.at(-1).rejectedNotes, 0);
  assert.equal(replies.at(-1).activeVoices, 0);
  assert.equal(replies.at(-1).pendingEvents, 0);
  assert.ok(block(processor, 4224).every(sample => sample === 0));
});

test('messages with extra or accessor fields cannot schedule or stop notes', () => {
  const processor = new Processor();
  let reads = 0;
  const base = { type: 'noteOn', id: 13, voice: brass, note: 69, at: 0, duration: 1 };
  processor.receive({ ...base, surprise: true });
  const accessor = { ...base };
  Object.defineProperty(accessor, 'note', { enumerable: true, get() { reads++; throw Error('getter ran'); } });
  processor.receive(accessor);
  assert.equal(reads, 0);
  assert.equal(processor.events.length, 0);
  assert.ok(block(processor, 0).every(sample => sample === 0));

  processor.receive(base);
  block(processor, 128);
  processor.receive({ type: 'noteOff', id: 13, surprise: true });
  const offAccessor = { type: 'noteOff', id: 13 };
  Object.defineProperty(offAccessor, 'id', { enumerable: true, get() { reads++; throw Error('getter ran'); } });
  processor.receive(offAccessor);
  assert.equal(reads, 0);
  for (let frame = 256; frame < 8192; frame += 128) block(processor, frame);
  assert.ok(block(processor, 8192).some(sample => sample !== 0), 'malformed offs must leave the gate held');
  processor.receive({ type: 'noteOff', id: 13 });
  for (let frame = 8320; frame < 12416; frame += 128) block(processor, frame);
  assert.ok(block(processor, 12416).every(sample => sample === 0));
});

test('out-of-order same-frame starts survive partial consumption, cancellation, and queue refill', () => {
  const processor = new Processor();
  const expected = new Processor();
  const note = (id, pitch, frame, frames = 128) => ({
    type: 'noteOn', id, voice: brass, note: pitch, at: frame / 16000, duration: frames / 16000
  });

  processor.receive(note(1, 60, 32, 300));
  expected.receive(note(1, 60, 32, 300));
  processor.receive(note(2, 84, 192));
  processor.receive(note(1, 72, 32, 300)); // First same-frame start wins the duplicate ID.
  processor.receive(note(3, 53, 640));
  expected.receive(note(3, 53, 640));
  for (let id = 4; id <= 127; id++) processor.receive(note(id, 60, 16000 + id * 128));

  const first = block(processor, 0);
  assert.deepEqual(first, block(expected, 0));
  assert.ok(first.subarray(0, 32).every(sample => sample === 0));
  assert.ok(first.subarray(32).some(sample => sample !== 0));

  processor.receive({ type: 'noteOff', id: 2 });
  for (const [id, pitch, frame] of [[200, 69, 384], [201, 76, 512]]) {
    processor.receive(note(id, pitch, frame));
    expected.receive(note(id, pitch, frame));
  }
  for (let frame = 128; frame < 896; frame += 128) {
    assert.deepEqual(block(processor, frame), block(expected, frame), `audio differs at frame ${frame}`);
  }
});

test('fractional absolute starts preserve exact offline gate, velocity and stereo rendering', () => {
  globalThis.currentFrame = 0;
  const processor = new Processor();
  const duration = 32.2 / 16000;
  const offline = renderNote({ voice: brass, note: 69, duration, sampleRate: 16000, velocity: 0.6, pan: 0.4 });
  processor.receive({ type: 'noteOn', id: 1, voice: brass, note: 69, at: 32.4 / 16000,
    duration, velocity: 0.6, pan: 0.4 });
  const left = new Float32Array(offline.left.length + 32);
  const right = new Float32Array(offline.right.length + 32);
  processor.process([], [[left, right]]);
  assert.ok(left.subarray(0, 32).every(sample => sample === 0));
  assert.ok(right.subarray(0, 32).every(sample => sample === 0));
  assert.deepEqual(left.subarray(32), offline.left);
  assert.deepEqual(right.subarray(32), offline.right);
});
