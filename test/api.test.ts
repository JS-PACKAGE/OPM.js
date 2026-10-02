import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { OPM, createLookaheadScheduler, type LookaheadNote, type OPMEvent, type OPMOptions, type PlayNoteOptions } from '../src/api/index.js';
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
  sampleRate = 16000;
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

test('absolute scheduling, pending controls and same-frame cancellation affect real stereo output', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const events: OPMEvent[] = [];
  const opm = new OPM({ onEvent: event => events.push(event) });
  await opm.start();
  try {
    const cancelled = opm.playNote({ note: 60, at: 32 / sampleRate });
    opm.stop(cancelled, { at: 32 / sampleRate });
    assert.equal((await opm.getDiagnostics()).pendingEvents, 2, 'scheduled stop cannot cancel early');
    const id = opm.playNote({ note: 69, at: 32 / sampleRate, duration: 64 / sampleRate });
    opm.updateNote(id, { expression: 0 }, { at: 0 });
    opm.updateNote(id, { pitch: 12, glide: 0.001, expression: 0.5, pan: 1, modulation: 0 }, { at: 64 / sampleRate });
    const first = render(opm);
    assert.ok(first.left.every(sample => sample === 0));
    assert.ok(first.right.subarray(0, 64).every(sample => sample === 0), 'early pending expression must apply on onset');
    assert.ok(audible(first.right.subarray(64, 96)));
    const cancelledEvents = events.flatMap(event => event.type === 'note' && event.id === cancelled ? [event] : []);
    assert.deepEqual(cancelledEvents.map(event => [event.state, event.frame]), [['accepted', 0], ['cancelled', 32]]);
    assert.deepEqual(events.flatMap(event => event.type === 'note' && event.id === id && event.state !== 'ended' ? [[event.state, event.frame]] : []),
      [['accepted', 0], ['started', 32], ['released', 96]]);
    for (const event of events) if (event.type === 'note') assert.equal(event.time, event.frame / sampleRate);
    opm.updateNote(id, { expression: 0 });
    assert.ok(render(opm).right.every(sample => sample === 0), 'released tails still accept controls');
    for (let block = 0; block < 40; block++) render(opm);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
  } finally { await opm.close(); }
});

test('late starts retain full gates and late drops cover both admission and delayed processing', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const events: OPMEvent[] = [];
  const opm = new OPM({ onEvent: event => events.push(event) });
  await opm.start();
  try {
    contextOf(opm).frame = 160;
    contextOf(opm).currentTime = 160 / sampleRate;
    Object.assign(globalThis, { currentFrame: 160 });
    const id = opm.playNote({ note: 69, at: 0, duration: 64 / sampleRate });
    const dropped = opm.playNote({ note: 69, at: 0, duration: 1, late: 'drop' });
    const delayed = opm.playNote({ note: 69, at: 320 / sampleRate, duration: 1, late: 'drop' });
    const delayedStart = opm.playNote({ note: 69, at: 320 / sampleRate, duration: 64 / sampleRate });
    render(opm);
    contextOf(opm).frame = 384;
    contextOf(opm).currentTime = 384 / sampleRate;
    render(opm);
    assert.deepEqual(events.flatMap(event => event.type === 'note' && event.id === id ? [[event.state, event.frame]] : []),
      [['accepted', 160], ['started', 160], ['released', 224]]);
    for (const id of [dropped, delayed]) {
      const rejected = events.find(event => event.type === 'note' && event.id === id && event.state === 'rejected');
      assert.ok(rejected?.type === 'note' && rejected.reason === 'late');
      assert.ok(!events.some(event => event.type === 'note' && event.id === id && event.state === 'started'));
    }
    assert.deepEqual(events.flatMap(event => event.type === 'note' && event.id === delayedStart && ['started', 'released'].includes(event.state) ? [[event.state, event.frame]] : []),
      [['started', 384], ['released', 448]]);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
  } finally { await opm.close(); }
});

test('raw public options and controls reject accessors without reserving an ID', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM();
  await opm.start();
  try {
    let reads = 0;
    const accessor = { note: 60 };
    Object.defineProperty(accessor, 'at', { get() { reads++; throw Error('getter ran'); } });
    const inherited = Object.assign(Object.create({ at: 1 }), { note: 60 });
    for (const input of [accessor, inherited, { note: 60, at: 0, time: 0 }, { note: 60, at: -1 },
      { note: 60, at: Infinity }, { note: 60, at: 61 }, { note: 60, late: 'other' }, { note: 60, surprise: true }]) {
      assert.throws(() => opm.playNote(input as PlayNoteOptions));
    }
    const id = opm.playNote({ note: 60 });
    assert.equal(id, 1);
    const controls = {};
    Object.defineProperty(controls, 'expression', { get() { reads++; return 1; } });
    for (const invalid of [controls, {}, { glide: 1 }, { pan: NaN }, { expression: 2 }, { modulation: Infinity }, { unknown: 1 }]) {
      assert.throws(() => opm.updateNote(id, invalid));
    }
    const stopOptions = {};
    Object.defineProperty(stopOptions, 'at', { get() { reads++; return 0; } });
    assert.throws(() => opm.stop(id, stopOptions));
    assert.throws(() => opm.updateNote(id, { expression: 0 }, stopOptions));
    assert.equal(reads, 0);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 1);
  } finally { await opm.close(); }
});

test('bounded lookahead uses disjoint windows, cancels pending gates and surfaces callback failure', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM();
  const callbacks = new Map<number, () => void>();
  const savedSetTimeout = globalThis.setTimeout;
  const savedClearTimeout = globalThis.clearTimeout;
  let nextTimer = 1;
  Object.assign(globalThis, {
    setTimeout: (callback: () => void) => { const id = nextTimer++; callbacks.set(id, callback); return id; },
    clearTimeout: (id: number) => { callbacks.delete(id); },
  });
  const windows: [number, number][] = [];
  const errors: Error[] = [];
  let fail = false;
  const scheduler = createLookaheadScheduler(opm, ({ from, to }) => {
    if (fail) throw Error('score failed');
    windows.push([from, to]);
    return [{ note: 60, at: from + 0.01, duration: 0.1 }] satisfies LookaheadNote[];
  }, { onError: error => errors.push(error) });
  try {
    await scheduler.start();
    assert.deepEqual(windows, [[0, 0.2]]);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 2);
    contextOf(opm).currentTime = 0.05;
    const first = callbacks.entries().next().value!;
    callbacks.delete(first[0]);
    first[1]();
    assert.deepEqual(windows[1], [0.2, 0.25]);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 4);
    contextOf(opm).currentTime = 1;
    const stalled = callbacks.entries().next().value!;
    callbacks.delete(stalled[0]);
    stalled[1]();
    assert.deepEqual(windows[2], [1, 1.2], 'a stalled pump must skip the missed window');
    assert.equal((await opm.getDiagnostics()).pendingEvents, 6);
    scheduler.stop();
    assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
    assert.equal(callbacks.size, 0);
    await scheduler.start();
    fail = true;
    contextOf(opm).currentTime = 1.05;
    const second = callbacks.entries().next().value!;
    callbacks.delete(second[0]);
    second[1]();
    assert.equal(scheduler.running, false);
    assert.equal(errors[0].message, 'score failed');
    assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
    scheduler.dispose();
    await assert.rejects(scheduler.start(), /disposed/);
  } finally {
    scheduler.dispose();
    Object.assign(globalThis, { setTimeout: savedSetTimeout, clearTimeout: savedClearTimeout });
    await opm.close();
  }
});

test('named snapshots resist host mutation and bounded registrations survive node recreation', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const events: OPMEvent[] = [];
  const opm = new OPM({ onEvent: event => events.push(event) });
  const source = structuredClone(brass);
  opm.loadVoice('snapshot', source);
  source.ops.forEach(op => { op.level = 0; });
  const exposed = opm.voices as Map<string, typeof brass>;
  assert.throws(() => { exposed.get('snapshot')!.ops[0].adsr.a = 1; }, TypeError);
  exposed.delete('snapshot');
  await opm.start();
  try {
    opm.playNote({ voice: 'snapshot', note: 69 });
    assert.ok(audible(render(opm).left), 'source/map mutation must not silence the loaded patch');
    await opm.close();
    Object.assign(globalThis, { currentFrame: 0 });
    await opm.start();
    opm.playNote({ voice: 'snapshot', note: 69 });
    assert.ok(audible(render(opm).left), 'recreated nodes must re-register cached named patches');
    const raw = structuredClone(brass);
    const rawId = opm.playNote({ voice: raw, note: 69, time: 1 });
    opm.stop(rawId);
    let reads = 0;
    Object.defineProperty(raw, 'feedback', { get() { reads++; throw Error('raw getter ran'); } });
    assert.throws(() => opm.playNote({ voice: raw, note: 69 }));
    assert.equal(reads, 0, 'previous registration cannot bypass a changed raw boundary');
    for (let index = 0; index < 129; index++) {
      const id = opm.playNote({ voice: { ...brass, name: `cache_${index}` }, note: 60, time: 1 });
      opm.stop(id);
    }
    const inline = opm.playNote({ voice: { ...brass, name: 'beyond_cache' }, note: 69 });
    assert.ok(audible(render(opm).left));
    assert.ok(events.some(event => event.type === 'note' && event.id === inline && event.state === 'started'));
    const diagnostics = await opm.getDiagnostics();
    assert.equal(diagnostics.errors, 0);
    assert.equal(diagnostics.rejectedNotes, 0);
  } finally { await opm.close(); }
});

test('lookahead refuses over-capacity or accessor batches before they can enqueue notes', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM();
  const errors: Error[] = [];
  let reads = 0;
  const accessor: LookaheadNote[] = [];
  Object.defineProperty(accessor, '0', { get() { reads++; throw Error('array getter ran'); } });
  const oversized = Array.from({ length: 129 }, () => ({ note: 60, at: 0.01, duration: 1 }));
  try {
    for (const batch of [accessor, oversized, [{ note: 60, at: 1, duration: 1 }]]) {
      const scheduler = createLookaheadScheduler(opm, () => batch, { maxNotes: 128, onError: error => errors.push(error) });
      await scheduler.start();
      assert.equal(scheduler.running, false);
      assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
      scheduler.dispose();
    }
    assert.equal(reads, 0);
    assert.equal(errors.length, 3);
    assert.match(errors[0].message, /data array/);
    assert.match(errors[1].message, /capacity/);
    assert.match(errors[2].message, /inside the window/);
  } finally { await opm.close(); }
});
