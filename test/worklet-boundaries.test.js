import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { brass } from '../src/voices/brass.js';

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
  assert.equal(processor.synth.voices[0].releaseTime, 32 / 16000);
  assert.equal(processor.events.length, 0);
  for (let frame = 128; frame < 4096; frame += 128) block(processor, frame);
  assert.ok(block(processor, 4096).every(sample => sample === 0));
});

test('noteOff stops an already active note before its scheduled duration', () => {
  const processor = new Processor();
  processor.receive({ type: 'noteOn', id: 12, voice: brass, note: 69, at: 0, duration: 1 });
  assert.ok(block(processor, 0).some(sample => sample !== 0));
  assert.equal(processor.synth.voices[0].releaseTime, -1);
  processor.receive({ type: 'noteOff', id: 12 });
  assert.equal(processor.events.length, 0);
  assert.equal(processor.synth.voices[0].releaseTime, 128 / 16000);
  for (let frame = 128; frame < 4096; frame += 128) block(processor, frame);
  assert.ok(block(processor, 4096).every(sample => sample === 0));
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
  assert.equal(processor.synth.voices[0].releaseTime, -1);
  processor.receive({ type: 'noteOff', id: 13 });
  assert.ok(processor.synth.voices[0].releaseTime >= 0);
});
