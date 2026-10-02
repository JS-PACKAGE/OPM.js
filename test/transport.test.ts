import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OPM } from '../src/api/index.js';
import type { OPMEvent } from '../src/api/index.js';
import { createTransport, beatsToSeconds, secondsToBeats, beatToBarBeat, barBeatToBeat } from '../src/api/transport.js';
import type { BeatSequenceEvent, MusicalTransport } from '../src/api/transport.js';
import { renderSequence } from '../src/core/index.js';
import type { VoiceInput } from '../src/voices/schema.js';

interface Port { postMessage(message: unknown): void; close(): void; onmessage?: ((event: { data: unknown }) => void) | null }
interface ProcessorInstance {
  port: Port;
  receive(message: unknown): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
const sampleRate = 16000;
let Processor: new (options?: AudioWorkletNodeOptions) => ProcessorInstance;
let resumeGate: Promise<void> | undefined;
let enteredResume: (() => void) | undefined;
class Context extends EventTarget {
  currentTime = 0;
  sampleRate = sampleRate;
  frame = 0;
  state = 'suspended';
  destination = {};
  audioWorklet = { addModule: async () => {} };
  async resume() {
    enteredResume?.();
    if (resumeGate) await resumeGate;
    this.state = 'running';
    this.dispatchEvent(new Event('statechange'));
  }
  async close() { this.state = 'closed'; this.dispatchEvent(new Event('statechange')); }
  suspend() { this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); }
}
class Node {
  processor: ProcessorInstance;
  port: Port;
  constructor(_context: Context, _name: string, options: AudioWorkletNodeOptions) {
    this.processor = new Processor(options);
    this.port = {
      postMessage: message => this.processor.receive(structuredClone(message)),
      close: () => { this.port.onmessage = null; }, onmessage: null,
    };
    this.processor.port.postMessage = message => this.port.onmessage?.({ data: structuredClone(message) });
    this.processor.port.close = () => {};
  }
  connect() {}
  disconnect() {}
}
const keys = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor', 'AudioContext', 'AudioWorkletNode'];
const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, {
  sampleRate, currentFrame: 0,
  AudioWorkletProcessor: class { port: Partial<Port> = {}; },
  registerProcessor: (_name: string, constructor: unknown) => { Processor = constructor as typeof Processor; },
});
try {
  // Worklet evaluation requires globals installed above; static import runs too early.
  await import('../src/worklet/processor.js');
  Object.assign(globalThis, { AudioContext: Context, AudioWorkletNode: Node });
} catch (error) { restore(); throw error; }
function restore() {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
after(restore);
const voice: VoiceInput = {
  version: 5, name: 'transport-tone', algorithm: 7, feedback: 0, modIndex: 0,
  lfo: { waveform: 'triangle', rate: 0, amDepth: 0, pmDepth: 0 },
  ops: [1, 0, 0, 0].map(level => ({ ratio: 1, level, detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.008 } })) as unknown as VoiceInput['ops'],
};
function note(duration = 4): BeatSequenceEvent { return { type: 'note', id: 1, beat: 0, duration, note: 69, voice }; }
function render(opm: OPM, frames: number): { left: Float32Array; right: Float32Array } {
  const context = opm.context as unknown as Context;
  const node = opm.node as unknown as Node;
  Object.assign(globalThis, { currentFrame: context.frame });
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  assert.equal(node.processor.process([], [[left, right]]), true);
  context.frame += frames;
  context.currentTime = context.frame / sampleRate;
  Object.assign(globalThis, { currentFrame: context.frame });
  return { left, right };
}
function advance(opm: OPM, transport: MusicalTransport, frames: number): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += 128) {
    transport.pump();
    const block = render(opm, Math.min(128, frames - offset));
    left.set(block.left, offset);
    right.set(block.right, offset);
  }
  transport.pump();
  return { left, right };
}
async function engine(events: OPMEvent[] = [], interruption: 'cancel' | 'preserve' = 'cancel'): Promise<OPM> {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM({ sampleRate, interruption, onEvent: event => events.push(event) });
  await opm.start();
  return opm;
}

test('piecewise tempo integral and inverse cross exact boundaries; meter uses quarter-note beats', () => {
  const map = [{ beat: 0, bpm: 120 }, { beat: 4, bpm: 60 }, { beat: 7, bpm: 240 }];
  assert.equal(beatsToSeconds(4, map), 2);
  assert.equal(beatsToSeconds(7, map), 5);
  assert.equal(beatsToSeconds(9, map), 5.5);
  for (const beat of [0, 1.25, 4, 6.5, 7, 10]) assert.equal(secondsToBeats(beatsToSeconds(beat, map), map), beat);
  assert.equal(beatsToSeconds(3), 1.5);
  assert.deepEqual(beatToBarBeat(3.75, { numerator: 6, denominator: 8 }), { bar: 2, beat: 2.5 });
  assert.equal(barBeatToBeat({ bar: 2, beat: 2.5 }, { numerator: 6, denominator: 8 }), 3.75);
  assert.throws(() => beatsToSeconds(1, [{ beat: 1, bpm: 120 }]), /zero/);
  assert.throws(() => secondsToBeats(-1), /seconds/);
  assert.throws(() => barBeatToBeat({ bar: 1, beat: 7 }, { numerator: 6, denominator: 8 }), /within/);
});

test('actual worklet audio follows tempo-boundary gate conversion', async () => {
  const events: OPMEvent[] = [];
  const opm = await engine(events);
  const transport = createTransport(opm, [note(3)], { tempoMap: [{ beat: 0, bpm: 120 }, { beat: 1, bpm: 240 }] });
  try {
    await transport.start();
    const expected = renderSequence([{ type: 'note', id: 1, time: 0, duration: 1, note: 69, voice }], { sampleRate });
    const actual = advance(opm, transport, expected.left.length);
    assert.deepEqual(actual.left, expected.left);
    assert.deepEqual(actual.right, expected.right);
    const release = events.find(event => event.type === 'note' && event.state === 'released');
    assert.ok(release && release.type === 'note');
    assert.equal(release.frame, sampleRate);
    assert.equal(transport.position, 3);
    assert.equal(transport.running, false);
  } finally { transport.dispose(); await opm.dispose(); }
});

test('release-tied expression, late ADSR edits and a final-endpoint control match sequence PCM', async () => {
  const opm = await engine();
  const tailVoice: VoiceInput = { ...voice, version: 5,
    ops: voice.ops.map(op => ({ ...op, adsr: { ...op.adsr, r: 0.1 } })) as unknown as VoiceInput['ops'] };
  const adsr = [{ a: 0, d: 0, s: 0.8, r: 0.2 }, { a: 0, d: 0, s: 1, r: 0.2 },
    { a: 0, d: 0, s: 1, r: 0.2 }, { a: 0, d: 0, s: 1, r: 0.2 }] as const;
  assert.throws(() => createTransport(opm, [
    { type: 'note', id: 1, beat: 0, duration: 0.02, note: 69, voice: tailVoice },
    { type: 'control', id: 1, beat: 0.02, controls: { expression: 0.5 } },
    { type: 'control', id: 1, beat: 0.08, controls: { operatorADSR: adsr } },
  ], { maxSlots: 3 }), /density/);
  const transport = createTransport(opm, [
    { type: 'note', id: 1, beat: 0, duration: 0.02, note: 69, voice: tailVoice },
    { type: 'control', id: 1, beat: 0.02, controls: { expression: 0.5 } },
    { type: 'control', id: 1, beat: 0.08, controls: { operatorADSR: adsr } },
    { type: 'control', id: 1, beat: 0.12, controls: { expression: 0.25, ramp: 0.01 } },
  ]);
  try {
    await transport.start();
    const expected = renderSequence([
      { type: 'note', id: 1, time: 0, duration: 0.01, note: 69, voice: tailVoice },
      { type: 'control', id: 1, time: 0.01, controls: { expression: 0.5 } },
      { type: 'control', id: 1, time: 0.04, controls: { operatorADSR: adsr } },
      { type: 'control', id: 1, time: 0.06, controls: { expression: 0.25, ramp: 0.01 } },
    ], { sampleRate });
    const actual = advance(opm, transport, expected.left.length);
    assert.deepEqual(actual.left, expected.left);
    assert.deepEqual(actual.right, expected.right);
    assert.equal(transport.position, 0.12);
    assert.equal(transport.running, false);
    assert.ok(actual.left.subarray(2000, 2400).some(value => Math.abs(value) > 1e-6));
    assert.equal((await opm.getDiagnostics()).activeVoices, 0);
  } finally { transport.dispose(); await opm.dispose(); }
});

test('loop release-tail controls apply before the seam but endpoint controls do not leak across it', async () => {
  const opm = await engine();
  const tailVoice: VoiceInput = { ...voice, version: 5,
    ops: voice.ops.map(op => ({ ...op, adsr: { ...op.adsr, r: 0.2 } })) as unknown as VoiceInput['ops'] };
  const transport = createTransport(opm, [
    { type: 'note', id: 1, beat: 0, duration: 0.0625, note: 69, voice: tailVoice },
    { type: 'control', id: 1, beat: 0.125, controls: { expression: 0 } },
    { type: 'control', id: 1, beat: 0.25, controls: { expression: 1 } },
  ], { loop: { enabled: true, from: 0, to: 0.25 } });
  try {
    await transport.start();
    const expected = renderSequence([0, 0.125, 0.25].flatMap((time, index) => [
      { type: 'note' as const, id: index + 1, time, duration: 0.03125, note: 69, voice: tailVoice },
      { type: 'control' as const, id: index + 1, time: time + 0.0625, controls: { expression: 0 } },
    ]), { sampleRate });
    const actual = advance(opm, transport, 6000);
    assert.deepEqual(actual.left, expected.left.subarray(0, 6000));
    assert.deepEqual(actual.right, expected.right.subarray(0, 6000));
    assert.ok(actual.left.subarray(1100, 1900).every(value => value === 0));
  } finally { transport.dispose(); await opm.dispose(); }
});

test('pause preserves musical cursor; resume restarts held gates with offset durations', async () => {
  const events: OPMEvent[] = [];
  const opm = await engine(events);
  const transport = createTransport(opm, [note(2)]);
  try {
    await transport.start();
    advance(opm, transport, 4000);
    transport.pause();
    assert.equal(transport.position, 0.5);
    assert.equal(transport.state, 'paused');
    render(opm, 4000);
    assert.equal(transport.position, 0.5);
    await transport.resume();
    assert.equal(transport.position, 0.5);
    const currentId = transport.ids.get(1);
    advance(opm, transport, 12500);
    const release = events.find(event => event.type === 'note' && event.id === currentId && event.state === 'released');
    assert.ok(release && release.type === 'note');
    assert.equal(release.frame, 20000);
    assert.equal(transport.position, 2);
    transport.stop();
    assert.equal(transport.position, 0);
  } finally { transport.dispose(); await opm.dispose(); }
});

test('seeking into ramped automation reconstructs current values and remaining ramps in actual audio', async () => {
  const opm = await engine();
  const transport = createTransport(opm, [note(4),
    { type: 'control', id: 1, beat: 0, controls: { pitch: 12, glide: 1, expression: 0, pan: 1, ramp: 1 } },
  ]);
  try {
    transport.seek(1);
    await transport.start();
    const expected = renderSequence([
      { type: 'note', id: 1, time: 0, duration: 1.5, note: 69, voice },
      { type: 'control', id: 1, time: 0, controls: { pitch: 6, expression: 0.5, pan: 0.5, modulation: 1, operatorLevels: [1, 1, 1, 1] } },
      { type: 'control', id: 1, time: 0, controls: { pitch: 12, glide: 0.5 } },
      { type: 'control', id: 1, time: 0, controls: { expression: 0, ramp: 0.5 } },
      { type: 'control', id: 1, time: 0, controls: { pan: 1, ramp: 0.5 } },
    ], { sampleRate });
    const actual = advance(opm, transport, 12000);
    assert.deepEqual(actual.left, expected.left.subarray(0, 12000));
    assert.deepEqual(actual.right, expected.right.subarray(0, 12000));
  } finally { transport.dispose(); await opm.dispose(); }
});

for (const destination of [1, 2]) {
  test(`seek beat ${destination} restores expanded timbre ramps, fixed/ratio mode and edited ADSR`, async () => {
    const opm = await engine();
    const adsr = [{ a: 0, d: 0, s: 0.6, r: 0.008 }, { a: 0, d: 0, s: 1, r: 0.008 },
      { a: 0, d: 0, s: 1, r: 0.008 }, { a: 0, d: 0, s: 1, r: 0.008 }] as const;
    const transport = createTransport(opm, [note(4),
      { type: 'control', id: 1, beat: 0, controls: {
        feedback: 7, lfoRate: 8, amDepth: 0.6, pmDepth: 600, operatorRatios: [2, 2, 2, 2], ramp: 1,
      } },
      { type: 'control', id: 1, beat: 0.25, controls: { operatorFrequencies: [330, null, null, null], ramp: 1 } },
      { type: 'control', id: 1, beat: 0.5, controls: { operatorADSR: adsr } },
      { type: 'control', id: 1, beat: 1.5, controls: { operatorFrequencies: [null, null, null, null] } },
    ]);
    try {
      transport.seek(destination);
      await transport.start();
      const progress = destination / 2;
      const ratio = 1 + progress;
      const expected = renderSequence([
        { type: 'note', id: 1, time: 0, duration: (4 - destination) / 2, note: 69, voice },
        { type: 'control', id: 1, time: 0, controls: {
          pitch: 0, expression: 1, pan: 0, modulation: 1, operatorLevels: [1, 1, 1, 1],
          feedback: 7 * progress, lfoRate: 8 * progress, amDepth: 0.6 * progress, pmDepth: 600 * progress,
          operatorRatios: [ratio, ratio, ratio, ratio],
          operatorFrequencies: [destination === 1 ? 330 : null, null, null, null], operatorADSR: adsr,
        } },
        ...(destination === 1 ? [
          { type: 'control' as const, id: 1, time: 0, controls: { feedback: 7, ramp: 0.5 } },
          { type: 'control' as const, id: 1, time: 0, controls: { lfoRate: 8, ramp: 0.5 } },
          { type: 'control' as const, id: 1, time: 0, controls: { amDepth: 0.6, ramp: 0.5 } },
          { type: 'control' as const, id: 1, time: 0, controls: { pmDepth: 600, ramp: 0.5 } },
          { type: 'control' as const, id: 1, time: 0, controls: { operatorRatios: [2, 2, 2, 2] as const, ramp: 0.5 } },
        ] : []),
      ], { sampleRate });
      const actual = advance(opm, transport, 3000);
      assert.deepEqual(actual.left, expected.left.subarray(0, 3000));
      assert.deepEqual(actual.right, expected.right.subarray(0, 3000));
    } finally { transport.dispose(); await opm.dispose(); }
  });
}

test('expanded seek reconstruction rejects density before altering a running score', async () => {
  const opm = await engine();
  const score: BeatSequenceEvent[] = [];
  for (let id = 1; id <= 32; id++) {
    score.push({ ...note(4), id }, { type: 'control', id, beat: 1, controls: {
      pitch: 12, glide: 1, expression: 0, pan: 1, modulation: 2, feedback: 7,
      lfoRate: 8, amDepth: 0.6, pmDepth: 600, operatorRatios: [2, 2, 2, 2], ramp: 1,
    } });
  }
  const transport = createTransport(opm, score);
  try {
    await transport.start();
    const before = [...transport.ids];
    assert.throws(() => transport.seek(2), /density/);
    assert.equal(transport.running, true);
    assert.equal(transport.position, 0);
    assert.deepEqual([...transport.ids], before);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 32);
  } finally { transport.dispose(); await opm.dispose(); }
});

test('loop wraps reconstruct crossing gates without carrying previous iteration pan automation', async () => {
  const events: OPMEvent[] = [];
  const opm = await engine(events);
  const transport = createTransport(opm, [note(2), { type: 'control', id: 1, beat: 0.125, controls: { pan: 1 } }],
    { loop: { enabled: true, from: 0, to: 0.25 } });
  try {
    await transport.start();
    const audio = advance(opm, transport, 6400);
    const starts = events.filter(event => event.type === 'note' && event.state === 'started');
    assert.deepEqual(starts.map(event => event.type === 'note' ? event.frame : -1), [0, 2000, 4000, 6000]);
    // After the old tail finishes, the next loop starts at its original center pan.
    assert.equal(audio.left[2400], audio.right[2400]);
    assert.equal(audio.left[3600], 0);
    assert.notEqual(audio.right[3600], 0);
    assert.ok(Math.abs(transport.position - 0.05) < 1e-12);
    assert.equal((await opm.getDiagnostics()).errors, 0);
  } finally { transport.dispose(); await opm.dispose(); }
});

test('tempo edits preserve position and cancel only owned future notes and automation', async () => {
  const events: OPMEvent[] = [];
  const opm = await engine(events);
  const unrelated = opm.playNote({ voice, note: 48, duration: null });
  const transport = createTransport(opm, [note(4), { type: 'control', id: 1, beat: 0.6, controls: { expression: 0 } }]);
  try {
    await transport.start();
    advance(opm, transport, 4000);
    const old = transport.ids.get(1)!;
    transport.setTempo(60);
    assert.equal(transport.position, 0.5);
    assert.deepEqual(transport.snapshot.tempoMap, [{ beat: 0, bpm: 120 }, { beat: 0.5, bpm: 60 }]);
    advance(opm, transport, 800);
    assert.ok(Math.abs(transport.position - 0.55) < 1e-12);
    transport.setTempoMap([{ beat: 0, bpm: 240 }]);
    assert.ok(Math.abs(transport.position - 0.55) < 1e-12);
    transport.pause();
    render(opm, 2000);
    assert.equal(events.some(event => event.type === 'note' && event.id === unrelated && event.state === 'released'), false);
    assert.equal(events.some(event => event.type === 'command' && event.id === old && event.command === 'updateNote' && event.state === 'rejected'), false);
    assert.equal((await opm.getDiagnostics()).activeVoices, 1);
  } finally { transport.dispose(); opm.stop(unrelated); await opm.dispose(); }
});

test('preserved-context interruption and engine reset stop transport until explicit restart', async () => {
  const opm = await engine([], 'preserve');
  const transport = createTransport(opm, [note(4)]);
  try {
    await transport.start();
    advance(opm, transport, 800);
    (opm.context as unknown as Context).suspend();
    assert.equal(transport.state, 'stopped');
    const cursor = transport.position;
    await opm.resume();
    assert.equal(transport.running, false);
    assert.equal(transport.position, cursor);
    await transport.resume();
    assert.equal(transport.running, true);
    opm.panic();
    assert.equal(transport.state, 'stopped');
    assert.equal(transport.ids.size, 0);
    await transport.start();
    assert.equal(transport.running, true);
  } finally { transport.dispose(); await opm.dispose(); }
});

test('changing loop bounds preserves current beat and rebuilds future wraps', async () => {
  const events: OPMEvent[] = [];
  const opm = await engine(events);
  const transport = createTransport(opm, [note(2)]);
  try {
    await transport.start();
    advance(opm, transport, 800);
    assert.equal(transport.position, 0.1);
    transport.setLoop({ enabled: true, from: 0, to: 0.25 });
    assert.equal(transport.position, 0.1);
    const detached = transport.ids as Map<number, number>;
    detached.clear();
    assert.ok(transport.ids.has(1));
    advance(opm, transport, 1800);
    const starts = events.filter(event => event.type === 'note' && event.state === 'started');
    assert.deepEqual(starts.map(event => event.type === 'note' ? event.frame : -1), [0, 800, 2000]);
    transport.setLoop({ enabled: false, from: 0, to: 0.25 });
    assert.ok(Math.abs(transport.position - 0.075) < 1e-12);
    advance(opm, transport, 1000);
    assert.ok(transport.position > 0.075);
  } finally { transport.dispose(); await opm.dispose(); }
});

test('seeking beyond an explicit stop never resurrects its held note', async () => {
  const opm = await engine();
  const transport = createTransport(opm, [note(4), { type: 'stop', id: 1, beat: 1 }]);
  try {
    transport.seek(2);
    await transport.start();
    assert.ok(advance(opm, transport, 1024).left.every(value => value === 0));
    assert.equal((await opm.getDiagnostics()).activeVoices, 0);
  } finally { transport.dispose(); await opm.dispose(); }
});

test('engine reset during pending startup cannot resurrect a transport', async () => {
  const opm = await engine();
  let resolve!: () => void;
  resumeGate = new Promise<void>(done => { resolve = done; });
  const entered = new Promise<void>(done => { enteredResume = done; });
  const transport = createTransport(opm, [note()]);
  try {
    const pending = transport.start();
    await entered;
    opm.panic();
    resolve();
    await pending;
    assert.equal(transport.state, 'stopped');
    assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
    assert.ok(render(opm, 128).left.every(value => value === 0));
  } finally {
    resolve(); resumeGate = undefined; enteredResume = undefined;
    transport.dispose(); await opm.dispose();
  }
});

for (const action of ['pause', 'stop', 'dispose'] as const) {
  test(`${action} during asynchronous startup prevents stale admission`, async () => {
    Object.assign(globalThis, { currentFrame: 0 });
    let resolve!: () => void;
    resumeGate = new Promise<void>(done => { resolve = done; });
    const entered = new Promise<void>(done => { enteredResume = done; });
    const opm = new OPM({ sampleRate });
    const transport = createTransport(opm, [note()]);
    try {
      const pending = transport.start();
      await entered;
      transport[action]();
      resolve();
      await pending;
      assert.equal(transport.running, false);
      assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
      assert.ok(render(opm, 128).left.every(value => value === 0));
      if (action === 'dispose') await assert.rejects(transport.resume(), /disposed/);
    } finally {
      resolve(); resumeGate = undefined; enteredResume = undefined;
      transport.dispose(); await opm.dispose();
    }
  });
}

test('eager safety boundaries, detached snapshots, and missed windows are consumer-visible', async () => {
  const errors: Error[] = [];
  const opm = await engine();
  let invoked = false;
  try {
    const accessor = Object.defineProperty({}, 'beat', { enumerable: true, get() { invoked = true; return 0; } });
    assert.throws(() => createTransport(opm, [accessor as BeatSequenceEvent]), /type|field|required/);
    assert.equal(invoked, false);
    assert.throws(() => createTransport(opm, [note()], { bpm: 0 }), /bpm/);
    assert.throws(() => createTransport(opm, [note()], { tempoMap: [{ beat: 0, bpm: 120 }, { beat: 0, bpm: 240 }] }), /strictly/);
    assert.throws(() => createTransport(opm, [note()], { loop: { enabled: true, from: 0, to: 0.0001 } }), /wraps/);
    assert.throws(() => createTransport(opm, Array.from({ length: 130 }, (_, index) => ({ ...note(), id: index + 1 }))), /density/);
    const transport = createTransport(opm, [{ ...note(1), beat: 1 }], { onError: error => errors.push(error) });
    try {
      assert.throws(() => transport.seek(3), /seek/);
      await transport.start();
      const snapshot = transport.snapshot;
      assert.equal(Reflect.set(snapshot.tempoMap[0], 'bpm', 1), false);
      render(opm, 9000); // Host misses the unsubmitted onset at 0.5 seconds.
      transport.pump();
      assert.equal(transport.state, 'stopped');
      assert.match(errors[0].message, /missed/);
      assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
      assert.equal(transport.ids.size, 0);
      transport.dispose();
      assert.throws(() => transport.seek(0), /disposed/);
    } finally { transport.dispose(); }
  } finally { await opm.dispose(); }
});
