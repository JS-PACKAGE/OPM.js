import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OPM, playSequence } from '../src/api/index.js';
import type { OPMEvent, OPMOptions } from '../src/api/index.js';
import { renderSequence } from '../src/core/index.js';
import type { SequenceEvent, SequenceNoteEvent } from '../src/core/sequence.js';
import type { Voice } from '../src/voices/schema.js';

interface Port {
  postMessage(message: unknown): void;
  close(): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
}
interface ProcessorInstance {
  port: Port;
  receive(message: unknown): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
const sampleRate = 16000;
let Processor: new (options?: AudioWorkletNodeOptions) => ProcessorInstance;
class Context {
  currentTime = 0;
  sampleRate = sampleRate;
  frame = 0;
  state = 'suspended';
  destination = {};
  audioWorklet = { addModule: async () => {} };
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
class Node {
  processor: ProcessorInstance;
  port: Port;
  constructor(_context: Context, _name: string, options: AudioWorkletNodeOptions) {
    this.processor = new Processor(options);
    this.port = {
      postMessage: message => this.processor.receive(structuredClone(message)),
      close: () => { this.port.onmessage = null; },
      onmessage: null,
    };
    this.processor.port.postMessage = message => this.port.onmessage?.({ data: structuredClone(message) });
    this.processor.port.close = () => {};
  }
  connect() {}
  disconnect() {}
}
const globals = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor', 'AudioContext', 'AudioWorkletNode'];
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, {
  sampleRate, currentFrame: 0,
  AudioWorkletProcessor: class { port: Partial<Port> = {}; },
  registerProcessor: (_name: string, constructor: unknown) => { Processor = constructor as typeof Processor; },
});
try {
  // Static import cannot work: processor evaluation requires the worklet globals installed above.
  await import('../src/worklet/processor.js');
  Object.assign(globalThis, { AudioContext: Context, AudioWorkletNode: Node });
} catch (error) {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  throw error;
}
after(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function toneVoice(): Voice {
  return { version: 4, name: 'sequence-api', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { waveform: 'triangle', rate: 3, amDepth: 0.1, pmDepth: 8 },
    ops: Array.from({ length: 4 }, (_, index) => ({ ratio: 1, level: index === 0 ? 1 : 0, detune: 0,
      adsr: { a: 0, d: 0, s: 1, r: 0.008 } })) as Voice['ops'] };
}
function render(opm: OPM, frames: number) {
  const context = opm.context as unknown as Context;
  const node = opm.node as unknown as Node;
  Object.assign(globalThis, { currentFrame: context.frame });
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  assert.equal(node.processor.process([], [[left, right]]), true);
  context.frame += frames;
  context.currentTime = context.frame / sampleRate;
  return { left, right };
}

for (const stealing of ['oldest', 'release-first', 'quietest'] as const) {
  test(`live scores match offline chord/automation/cancellation/stealing audio with ${stealing} and fractional tuning`, async () => {
    Object.assign(globalThis, { currentFrame: 0 });
    const options: OPMOptions = { sampleRate, mixGain: 0.35, tuning: { referenceHz: 432,
      offsets: Array.from({ length: 128 }, (_, index) => index % 2 === 0 ? -12 : 18) }, stealing };
    const events: OPMEvent[] = [];
    const opm = new OPM({ ...options, onEvent: event => events.push(event) });
    await opm.start();
    try {
      opm.loadVoice('custom', toneVoice());
      const notes: SequenceNoteEvent[] = Array.from({ length: 10 }, (_, index) => ({
        type: 'note', id: index + 1, time: index === 9 ? 32.4 / sampleRate : 16.4 / sampleRate,
        duration: (index === 0 ? 8.2 : 96.2) / sampleRate, voice: 'custom', note: 48.5 + index * 2.25,
        velocity: index === 1 ? 0.05 : 0.5, pan: index % 2 === 0 ? -0.5 : 0.5,
      }));
      const score: SequenceEvent[] = [
        { type: 'stop', id: 10, time: 0 },
        ...notes,
        { type: 'control', id: 3, time: 0, controls: { expression: 0.25 } },
        { type: 'control', id: 8, time: 48 / sampleRate, controls: { pitch: 2.5, glide: 0.001, pan: 1, ramp: 0.001 } },
        { type: 'stop', id: 7, time: 80 / sampleRate },
        { type: 'control', id: 9, time: 120 / sampleRate, controls: { expression: 0.1 } },
      ];
      const offline = renderSequence(score, { voices: opm.voices, sampleRate, mixGain: options.mixGain,
        tuning: options.tuning, stealing });
      const playback = playSequence(opm, score);
      const live = render(opm, offline.left.length);
      assert.deepEqual(live.left, offline.left);
      assert.deepEqual(live.right, offline.right);
      assert.ok(live.left.some(value => Math.abs(value) > 0.01));
      assert.ok(events.some(event => event.type === 'note' && event.id === playback.ids.get(10) && event.state === 'cancelled'));
      assert.ok(events.some(event => event.type === 'note' && event.state === 'stolen'));
      const diagnostics = await opm.getDiagnostics();
      assert.equal(diagnostics.pendingEvents, 0);
      assert.equal(diagnostics.activeVoices, 0);
      assert.equal(diagnostics.errors, 0);
      assert.equal(diagnostics.rejectedNotes, 0);
    } finally { await opm.close(); }
  });
}

test('fractional absolute origins round the combined onset rather than origin and delay separately', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM({ sampleRate });
  await opm.start();
  try {
    const origin = 32.4 / sampleRate;
    const score: SequenceEvent[] = [
      { type: 'note', id: 1, time: 16.4 / sampleRate, duration: 32.2 / sampleRate, voice: toneVoice(), note: 69.5 },
    ];
    const offline = renderSequence(score.map(event => ({ ...event, time: origin + event.time })), { sampleRate });
    playSequence(opm, score, { at: origin });
    const live = render(opm, offline.left.length);
    assert.ok(live.left.subarray(0, 49).every(value => value === 0));
    assert.ok(live.left.subarray(49, 82).some(value => value !== 0));
    assert.deepEqual(live.left, offline.left);
    assert.deepEqual(live.right, offline.right);
  } finally { await opm.close(); }
});

test('malformed trailing events and absolute horizon violations cannot partially admit a score', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const events: OPMEvent[] = [];
  const opm = new OPM({ sampleRate, onEvent: event => events.push(event) });
  await opm.start();
  try {
    const note: SequenceNoteEvent = { type: 'note', id: 1, time: 0, duration: 0.01, voice: toneVoice(), note: 69 };
    assert.throws(() => playSequence(opm, [note, { ...note, id: 2, voice: 'unknown' }]), /Unknown sequence voice/);
    assert.throws(() => playSequence(opm, [note, { type: 'control', id: 1, time: 0, controls: { expression: NaN } }]), /expression/);
    assert.throws(() => playSequence(opm, [{ ...note, time: 59, duration: 1 }], { at: 1 }), /horizon/);
    assert.equal(events.filter(event => event.type === 'note' && event.state === 'accepted').length, 0);
    assert.ok(render(opm, 128).left.every(value => value === 0));
    const diagnostics = await opm.getDiagnostics();
    assert.equal(diagnostics.activeVoices, 0);
    assert.equal(diagnostics.pendingEvents, 0);
    assert.equal(diagnostics.rejectedNotes, 0);
  } finally { await opm.close(); }
});

test('a sequence stop cancels pending onsets and releases started notes, independently of a mutated IDs snapshot', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM({ sampleRate });
  await opm.start();
  try {
    const playback = playSequence(opm, [
      { type: 'note', id: 1, time: 0, duration: 1, voice: toneVoice(), note: 69, pan: -1 },
      { type: 'note', id: 2, time: 0.02, duration: 1, voice: toneVoice(), note: 72, pan: 1 },
    ]);
    assert.ok(render(opm, 128).left.some(value => Math.abs(value) > 0.01));
    (playback.ids as Map<number, number>).clear();
    assert.equal(playback.ids.size, 2);
    playback.stop();
    playback.stop();
    const released = render(opm, 1024);
    assert.ok(released.left.subarray(0, 64).some(value => value !== 0));
    assert.ok(released.left.subarray(-64).every(value => value === 0));
    assert.ok(released.right.every(value => value === 0));
    const diagnostics = await opm.getDiagnostics();
    assert.equal(diagnostics.activeVoices, 0);
    assert.equal(diagnostics.pendingEvents, 0);
  } finally { await opm.close(); }
});
