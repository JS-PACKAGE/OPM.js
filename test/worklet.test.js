import assert from 'node:assert/strict';
import test from 'node:test';
import { brass } from '../src/voices/brass.js';

let Processor;
globalThis.sampleRate = 44100;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.port = {}; }
};
globalThis.registerProcessor = (name, constructor) => {
  assert.equal(name, 'opm-processor');
  Processor = constructor;
};
await import('../src/worklet/processor.js');

function block(processor, frame) {
  globalThis.currentFrame = frame;
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  processor.process([], [[left, right]]);
  assert.deepEqual(left, right);
  assert.ok(left.every(Number.isFinite));
  return left;
}

test('scheduled note starts at its requested frame and expires after release', () => {
  const processor = new Processor();
  processor.receive({ type: 'noteOn', id: 1, voice: brass, note: 69, at: 128 / 44100, duration: 0.02 });
  assert.ok(block(processor, 0).every(sample => sample === 0));
  assert.ok(block(processor, 128).some(sample => sample !== 0));
  for (let frame = 256; frame < 12000; frame += 128) block(processor, frame);
  assert.ok(block(processor, 12000).every(sample => sample === 0));
});

test('cancelling a future note prevents it from sounding; malformed messages are ignored', () => {
  const processor = new Processor();
  const accessor = { get type() { throw new Error('Unexpected accessor'); }, id: 9 };
  for (const input of [null, [], {}, accessor, { type: 'noteOn', id: 2, note: 60, at: 0, duration: 1, voice: { ops: [] } },
    { type: 'noteOn', id: 3, note: 60, at: Infinity, duration: 1, voice: brass }]) {
    assert.doesNotThrow(() => processor.receive(input));
  }
  processor.receive({ type: 'noteOn', id: 4, voice: brass, note: 60, at: 0.1, duration: 0.1 });
  processor.receive({ type: 'noteOff', id: 4 });
  assert.equal(processor.events.length, 0);
  assert.ok(block(processor, 4410).every(sample => sample === 0));
});

test('pending events cannot exceed the worklet cap', () => {
  const processor = new Processor();
  for (let id = 1; id <= 200; id++) {
    processor.receive({ type: 'noteOn', id, voice: brass, note: 60, at: 10 + id / 100, duration: 0.1 });
  }
  assert.equal(processor.events.length, 256);
});
