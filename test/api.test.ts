import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { OPM, type OPMEvent, type OPMOptions } from '../src/api/index.js';
import { brass } from '../src/voices/brass.js';


interface MockPort {
  postMessage: (message: unknown) => void;
  close: () => void;
  onmessage?: ((event: { data: unknown }) => void) | null;
}
interface TestProcessor {
  port: MockPort;
  receive(data: unknown): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

class MockContext {
  currentTime = 0;
  frame = 0;
  state = 'suspended';
  destination = {};
  audioWorklet = { addModule: async () => {} };
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}
class MockNode {
  processor: TestProcessor;
  context: MockContext;
  port: { postMessage: (message: unknown) => void; close: () => void; onmessage: ((event: { data: unknown }) => void) | null };
  constructor(context: MockContext) {
    this.context = context;
    this.processor = new Processor();
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
function contextOf(opm: OPM): MockContext { return opm.context as unknown as MockContext; }
function nodeOf(opm: OPM): MockNode { return opm.node as unknown as MockNode; }

const globals = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor', 'AudioContext', 'AudioWorkletNode'];
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let Processor: new () => TestProcessor;
const sampleRate = 16000;
Object.assign(globalThis, { sampleRate });
Object.assign(globalThis, { currentFrame: 0 });
Object.assign(globalThis, { AudioWorkletProcessor: class { port: Partial<MockPort> = {}; } });
Object.assign(globalThis, { registerProcessor: (_name: string, constructor: unknown) => { Processor = constructor as new () => TestProcessor; } });
await import('../src/worklet/processor.js');
Object.assign(globalThis, { AudioContext: MockContext, AudioWorkletNode: MockNode });
after(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function render(opm: OPM, length = 128) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  Object.assign(globalThis, { currentFrame: contextOf(opm).frame });
  nodeOf(opm).processor.process([], [[left, right]]);
  contextOf(opm).frame += length;
  contextOf(opm).currentTime = contextOf(opm).frame / sampleRate;
  return { left, right };
}

function audible(samples: Float32Array) { return samples.some(sample => Math.abs(sample) > 1e-6); }

test('public held gates, stereo options, scheduling and lifecycle diagnostics render through the worklet', async () => {
  const events: OPMEvent[] = [];
  const opm = new OPM({ sampleRate: 16000, onEvent: event => events.push(event) });
  await opm.start();
  try {
    const id = opm.playNote({ note: 69, time: 32 / sampleRate, pan: 1, velocity: 0.5 });
    const first = render(opm);
    assert.ok(first.right.subarray(0, 32).every(sample => sample === 0));
    assert.ok(audible(first.right.subarray(32)));
    assert.ok(first.left.every(sample => Math.abs(sample) < 1e-10));
    for (let block = 0; block < 40; block++) render(opm);
    assert.ok(audible(render(opm).right), 'a default held gate must not expire');
    const held = await opm.getDiagnostics();
    assert.equal(held.activeVoices, 1);
    assert.equal(held.pendingEvents, 0);
    opm.stop(id);
    for (let block = 0; block < 40; block++) render(opm);
    assert.ok(render(opm).right.every(sample => sample === 0));
    assert.deepEqual(events.flatMap(event => event.type === 'note' && event.id === id ? [event.state] : []),
      ['accepted', 'started', 'released', 'ended']);
    const ended = await opm.getDiagnostics();
    assert.equal(ended.activeVoices, 0);
    assert.equal(ended.pendingEvents, 0);
    assert.equal(ended.errors, 0);
    opm.loadVoice('custom', brass);
    const silent = opm.playNote({ voice: 'custom', note: 60, velocity: 0, duration: 0.01 });
    assert.ok(render(opm).left.every(sample => sample === 0));
    opm.stop(silent);
  } finally {
    await opm.close();
  }
});

test('public admission failures are observable and cancelled future notes cannot sound', async () => {
  const events: OPMEvent[] = [];
  const opm = new OPM({ onEvent: event => {
    events.push(event);
    if (event.type === 'note') throw Error('host callback failed');
  } });
  await opm.start();
  try {
    const id = opm.playNote({ note: 69, time: 1 });
    opm.stop(id);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
    contextOf(opm).frame = sampleRate;
    assert.ok(render(opm).left.every(sample => sample === 0));
    for (let index = 0; index < 257; index++) opm.playNote({ note: 60, time: 1 });
    assert.equal(events.filter(event => event.type === 'note' && event.state === 'rejected').length, 1);
    const diagnostics = await opm.getDiagnostics();
    assert.equal(diagnostics.pendingEvents, 256);
    assert.equal(diagnostics.rejectedNotes, 1);
    assert.ok(events.some(event => event.type === 'note' && event.id === id && event.state === 'cancelled'));
  } finally {
    await opm.close();
  }
});

test('invalid public note arguments cannot admit a note or exhaust an ID', async () => {
  const opm = new OPM();
  assert.throws(() => opm.playNote({ note: 60 }), /start/);
  assert.throws(() => new OPM({ sampleRate: 0 }), /sampleRate/);
  assert.throws(() => new OPM({ context: null } as unknown as OPMOptions), /context/);
  assert.throws(() => new OPM({ onEvent: true } as unknown as OPMOptions), /onEvent/);
  await opm.start();
  try {
    for (const args of [
      { note: 128 }, { note: 60.5 }, { note: 60, time: -1 }, { note: 60, time: 61 },
      { note: 60, duration: 0 }, { note: 60, duration: 61 }, { note: 60, duration: NaN },
      { note: 60, velocity: -0.1 }, { note: 60, velocity: Infinity }, { note: 60, pan: 1.1 },
      { note: 60, voice: 'missing' },
    ]) assert.throws(() => opm.playNote(args));
    assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
    assert.equal(opm.playNote({ note: 60 }), 1);
    const internals = opm as unknown as { nextId: number };
    internals.nextId = Number.MAX_SAFE_INTEGER;
    assert.equal(opm.playNote({ note: 61 }), Number.MAX_SAFE_INTEGER);
    assert.throws(() => opm.playNote({ note: 62 }), /ID space exhausted/);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 2);
  } finally {
    await opm.close();
  }
});
