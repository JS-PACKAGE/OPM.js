import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OPM, playSequence } from '../src/api/index.js';
import type { OPMEvent, OPMOptions } from '../src/api/index.js';
import { renderSequence } from '../src/core/index.js';
import type { SequenceEvent, SequenceNoteEvent } from '../src/core/sequence.js';
import { streamSequence } from '../src/api/sequence.js';
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
  return { version: 6, name: 'sequence-api', algorithm: 7, feedback: 0, modIndex: 0,
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

test('mixed stream windows preserve ids and exact offline stop/onset/control ordering', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const failures: Error[] = [];
  const opm = new OPM({ sampleRate });
  await opm.start();
  const score: SequenceEvent[] = [
    { type: 'note', id: 1, time: 0, duration: 0.12, note: 69, voice: toneVoice() },
    { type: 'control', id: 1, time: 0.05, controls: { pan: -1, expression: 0.4, ramp: 0.003 } },
    { type: 'note', id: 2, time: 0.09, duration: 0.04, note: 72, voice: toneVoice() },
    { type: 'control', id: 2, time: 0, controls: { expression: 0.2, pan: 1 } },
    { type: 'stop', id: 3, time: 0.04 },
    { type: 'note', id: 3, time: 0.1, duration: 0.04, note: 76, voice: toneVoice() },
    { type: 'stop', id: 1, time: 0.08 },
  ];
  const offline = renderSequence(score, { sampleRate });
  const handle = streamSequence(opm, score, { horizon: 0.02, interval: 0.005, onError: error => failures.push(error) });
  try {
    await handle.start();
    const id1 = handle.ids.get(1);
    assert.ok(id1);
    const left = new Float32Array(offline.left.length);
    const right = new Float32Array(offline.right.length);
    for (let offset = 0; offset < left.length; offset += 80) {
      handle.pump();
      if (offset < 0.08 * sampleRate) assert.equal(handle.ids.get(1), id1);
      const block = render(opm, Math.min(80, left.length - offset));
      left.set(block.left, offset);
      right.set(block.right, offset);
    }
    handle.pump();
    assert.deepEqual(failures, []);
    assert.deepEqual(left, offline.left);
    assert.deepEqual(right, offline.right);
    assert.equal(handle.ids.size, 0);
    const diagnostics = await opm.getDiagnostics();
    assert.equal(diagnostics.pendingEvents, 0);
    assert.equal(diagnostics.rejectedNotes, 0);
  } finally { handle.dispose(); await opm.close(); }
});

test('stream cancellation targets only its own ids and reset permanently prevents restarting', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM({ sampleRate });
  await opm.start();
  const unrelated = opm.playNote({ note: 69, voice: toneVoice(), pan: -1 });
  const stream = streamSequence(opm, [{ type: 'note', id: 9, time: 0.01, duration: 120, note: 72, voice: toneVoice(), pan: 1 }]);
  try {
    await stream.start();
    stream.stop();
    const audio = render(opm, 1024);
    assert.ok(audio.left.some(value => Math.abs(value) > 0.01));
    assert.ok(audio.right.every(value => value === 0));
    assert.equal(stream.ids.size, 0);
    await assert.rejects(stream.start(), /cancelled/);
    opm.stop(unrelated);
    const reset = streamSequence(opm, [{ type: 'note', id: 10, time: 1, duration: 1, note: 69 }]);
    await reset.start();
    opm.panic();
    assert.equal(reset.running, false);
    await assert.rejects(reset.start(), /cancelled/);
    reset.dispose();
  } finally { stream.dispose(); await opm.close(); }
});

test('stream eagerly rejects hostile, oversized and capacity-exceeding scores without initialization', () => {
  const opm = new OPM({ sampleRate });
  const note: SequenceNoteEvent = { type: 'note', id: 1, time: 0, duration: 1, note: 69, voice: toneVoice() };
  let reads = 0;
  const bad = { ...note, id: 2 };
  Object.defineProperty(bad, 'note', { get() { reads++; return 60; } });
  assert.throws(() => streamSequence(opm, [note, bad]), /must be data/);
  assert.throws(() => streamSequence(opm, Array(65537).fill(note)), /event budget/);
  assert.throws(() => streamSequence(opm, Array.from({ length: 129 }, (_, index) => ({ ...note, id: index + 1 }))), /slot capacity/);
  assert.equal(reads, 0);
  assert.equal(opm.node, null);
});

test('stop during asynchronous start and AbortSignal cannot admit any old stream notes', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const observed: OPMEvent[] = [];
  const opm = new OPM({ sampleRate, onEvent: event => observed.push(event) });
  const score: SequenceEvent[] = [{ type: 'note', id: 1, time: 0, duration: 1, note: 69 }];
  const stream = streamSequence(opm, score);
  const starting = stream.start();
  stream.stop();
  await starting;
  try {
    assert.equal(stream.ids.size, 0);
    assert.equal(observed.some(event => event.type === 'note' && event.state === 'accepted'), false);
    const controller = new AbortController();
    const abortable = streamSequence(opm, score, { signal: controller.signal });
    controller.abort();
    await abortable.start();
    assert.equal(abortable.running, false);
    assert.equal(observed.some(event => event.type === 'note' && event.state === 'accepted'), false);
    abortable.dispose();
  } finally { await opm.close(); }
});

test('interruption and missed windows cancel owned playback instead of replaying old events', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const failures: Error[] = [];
  const opm = new OPM({ sampleRate });
  await opm.start();
  try {
    const missed = streamSequence(opm, [{ type: 'note', id: 1, time: 0.1, duration: 1, note: 69 }],
      { horizon: 0.02, interval: 0.005, onError: error => failures.push(error) });
    await missed.start();
    render(opm, 0.2 * sampleRate);
    missed.pump();
    assert.equal(missed.running, false);
    assert.match(failures[0].message, /missed/);
    assert.equal(missed.ids.size, 0);
    assert.ok(render(opm, 128).left.every(value => value === 0));
    const interrupted = streamSequence(opm, [{ type: 'note', id: 2, time: 0, duration: 1, note: 72 }]);
    await interrupted.start();
    (opm.context as unknown as Context).state = 'suspended';
    interrupted.pump();
    assert.equal(interrupted.running, false);
    assert.equal(interrupted.ids.size, 0);
    (opm.context as unknown as Context).state = 'running';
    await assert.rejects(interrupted.start(), /cancelled/);
    render(opm, 4000);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
    missed.dispose();
    interrupted.dispose();
  } finally { await opm.close(); }
});
