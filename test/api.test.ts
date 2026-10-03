import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { OPM, createLookaheadScheduler } from '../src/api/index.js';
import type { LookaheadNote, OPMEvent, OPMOptions, PlayNoteOptions, StopOptions, Voice } from '../src/api/index.js';
import { brass } from '../src/voices/brass.js';
import { Synth } from '../src/core/synth.js';
import { MAX_BANK_BYTES, parseVoiceBank } from '../src/voices/schema.js';
import type { CompleteVoiceInput } from '../src/voices/schema.js';


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
  listeners = new Set<() => void>();
  addEventListener(type: string, listener: () => void) { if (type === 'statechange') this.listeners.add(listener); }
  removeEventListener(type: string, listener: () => void) { if (type === 'statechange') this.listeners.delete(listener); }
  setState(state: string) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async suspend() { this.setState('suspended'); }
  async resume() { this.setState('running'); }
  async close() { this.setState('closed'); }
}
class MockNode {
  processor: TestProcessor;
  context: MockContext;
  port: { postMessage: (message: unknown) => void; close: () => void; onmessage: ((event: { data: unknown }) => void) | null };
  constructor(context: MockContext, _name?: string, options?: AudioWorkletNodeOptions) {
    this.context = context;
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
function contextOf(opm: OPM): MockContext { return opm.context as unknown as MockContext; }
function nodeOf(opm: OPM): MockNode { return opm.node as unknown as MockNode; }

const globals = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor', 'AudioContext', 'AudioWorkletNode'];
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let Processor: new (options?: AudioWorkletNodeOptions) => TestProcessor;
const sampleRate = 16000;
Object.assign(globalThis, { sampleRate });
Object.assign(globalThis, { currentFrame: 0 });
Object.assign(globalThis, { AudioWorkletProcessor: class { port: Partial<MockPort> = {}; } });
Object.assign(globalThis, { registerProcessor: (_name: string, constructor: unknown) => {
  Processor = constructor as new (options?: AudioWorkletNodeOptions) => TestProcessor;
} });
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
      { note: 128 }, { note: NaN }, { note: 60, time: -1 }, { note: 60, time: 61 },
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
    const replacement = opm.playNote({ voice: { ...brass, name: 'beyond_cache' }, note: 69 });
    assert.ok(audible(render(opm).left));
    assert.ok(events.some(event => event.type === 'note' && event.id === replacement && event.state === 'started'));
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

test('public command failures identify the failed stop without rejecting its sounding note', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const events: OPMEvent[] = [];
  const opm = new OPM({ onEvent: event => events.push(event) });
  await opm.start();
  try {
    const id = opm.playNote({ note: 60.5 });
    render(opm);
    for (let index = 0; index < 256; index++) opm.updateNote(id, { expression: 0.5 }, { at: 10 });
    const failed = opm.stop(id, { at: 0.1 });
    assert.ok(events.some(event => event.type === 'command' && event.commandId === failed &&
      event.command === 'stop' && event.id === id && event.state === 'rejected' && event.reason === 'capacity'));
    assert.ok(audible(render(opm, 3200).left));
    assert.equal((await opm.getDiagnostics()).activeVoices, 1);
    assert.equal(events.filter(event => event.type === 'note' && event.state === 'rejected').length, 0);
    opm.panic();
    assert.ok(render(opm).left.every(value => value === 0));
  } finally { await opm.close(); }
});

test('interruption cancellation clears voices and pending events, preserve resumes the same gates', async () => {
  for (const interruption of ['cancel', 'preserve'] as const) {
    Object.assign(globalThis, { currentFrame: 0 });
    const context = new MockContext();
    const events: OPMEvent[] = [];
    const opm = new OPM({ context: context as unknown as AudioContext, interruption, onEvent: event => events.push(event) });
    await opm.start();
    try {
      const held = opm.playNote({ note: 69 });
      const pending = opm.playNote({ note: 60, time: 1 });
      assert.ok(audible(render(opm).left));
      context.setState('interrupted');
      await assert.rejects(opm.getDiagnostics());
      assert.ok(events.some(event => event.type === 'context' && event.state === 'interrupted'));
      await opm.resume();
      const output = render(opm);
      const diagnostics = await opm.getDiagnostics();
      if (interruption === 'cancel') {
        assert.ok(output.left.every(value => value === 0));
        assert.equal(diagnostics.activeVoices, 0);
        assert.equal(diagnostics.pendingEvents, 0);
        for (const id of [held, pending]) {
          assert.equal(events.filter(event => event.type === 'note' && event.id === id && event.state === 'cancelled').length, 1);
        }
        assert.ok(events.some(event => event.type === 'reset' && event.reason === 'interruption'));
      } else {
        assert.ok(audible(output.left));
        assert.equal(diagnostics.activeVoices, 1);
        assert.equal(diagnostics.pendingEvents, 1);
        assert.equal(events.filter(event => event.type === 'reset').length, 0);
      }
      await opm.close();
      assert.equal(context.state, 'running', 'borrowed contexts remain owned by the host');
      assert.equal(events.filter(event => event.type === 'reset' && event.reason === 'close').length, 1);
    } finally { await opm.close(); }
  }
});

test('delayed context statechange cannot replay cancelled gates through resume or initialized start', async () => {
  for (const method of ['resume', 'start'] as const) {
    for (const interruption of ['cancel', 'preserve'] as const) {
      for (const delivered of [false, true]) {
        Object.assign(globalThis, { currentFrame: 0 });
        const context = new MockContext();
        if (!delivered) context.resume = async () => { context.state = 'running'; };
        const events: OPMEvent[] = [];
        const opm = new OPM({ context: context as unknown as AudioContext, interruption, onEvent: event => events.push(event) });
        await opm.start();
        try {
          for (let cycle = 0; cycle < 2; cycle++) {
            const held = opm.playNote({ note: 69 });
            const pending = opm.playNote({ note: 60, time: 1 });
            assert.ok(audible(render(opm).left));
            // Native promises may settle before either suspended or running notifications.
            context.state = 'suspended';
            if (delivered) for (const listener of context.listeners) listener();
            await opm[method]();
            if (cycle === 1) for (const listener of context.listeners) listener();
            const output = render(opm);
            const diagnostics = await opm.getDiagnostics();
            assert.equal(diagnostics.errors, 0);
            if (interruption === 'cancel') {
              assert.ok(output.left.every(value => value === 0));
              assert.equal(diagnostics.activeVoices, 0);
              assert.equal(diagnostics.pendingEvents, 0);
              for (const id of [held, pending]) {
                assert.equal(events.filter(event => event.type === 'note' && event.id === id && event.state === 'cancelled').length, 1);
              }
              assert.equal(events.filter(event => event.type === 'reset' && event.reason === 'interruption').length, cycle + 1);
            } else {
              assert.ok(audible(output.left));
              assert.equal(diagnostics.activeVoices, cycle + 1);
              assert.equal(diagnostics.pendingEvents, cycle + 1);
              assert.equal(events.filter(event => event.type === 'reset').length, 0);
            }
            assert.equal(context.state, 'running');
          }
        } finally {
          await opm.close();
          assert.equal(context.state, 'running', 'the borrowed context remains host-owned');
        }
      }
    }
  }
});

test('cache replacement preserves an already accepted patch after more than 128 live edits', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM();
  const reference = new OPM();
  await opm.start();
  await reference.start();
  try {
    opm.loadVoice('editor', brass);
    opm.playNote({ voice: 'editor', note: 60.5, time: 64 / sampleRate });
    reference.playNote({ note: 60.5, time: 64 / sampleRate });
    for (let index = 0; index < 140; index++) {
      const patch = { ...brass, name: `edit_${index}` };
      opm.loadVoice('editor', patch);
      const id = opm.playNote({ voice: 'editor', note: 69, time: 1 });
      opm.stop(id);
    }
    assert.deepEqual(render(opm).left, render(reference).left, 'accepted notes retain the pre-edit snapshot');
    assert.equal((await opm.getDiagnostics()).errors, 0);
    opm.panic();
    const silent = structuredClone(brass);
    silent.ops.forEach(operator => { operator.level = 0; });
    opm.loadVoice('editor', silent);
    opm.playNote({ voice: 'editor', note: 69 });
    assert.ok(render(opm).left.every(value => value === 0), 'later notes receive the replacement');
  } finally { await opm.close(); await reference.close(); }
});

test('supplied null gain or tuning fails before an engine can default to audible settings', () => {
  assert.throws(() => new OPM({ mixGain: null } as unknown as OPMOptions), RangeError);
  assert.throws(() => new OPM({ tuning: null } as unknown as OPMOptions), TypeError);
});

test('immediate worklet acknowledgements stay awaitable without claiming future command execution', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const events: OPMEvent[] = [];
  const opm = new OPM({ onEvent: event => events.push(event) });
  await opm.start();
  try {
    const id = opm.playNote({ note: 69 });
    render(opm);
    const stop = opm.stop(id, { at: 0.1 });
    assert.equal((await opm.waitForCommand(stop)).state, 'accepted');
    assert.equal((await opm.getDiagnostics()).activeVoices, 1);
    assert.equal(events.some(event => event.type === 'note' && event.id === id && event.state === 'released'), false);
    render(opm, 2000);
    assert.ok(events.some(event => event.type === 'note' && event.id === id && event.state === 'released' && event.frame === 1600));
    const inactive = opm.stop(999);
    await assert.rejects(opm.waitForCommand(inactive), /inactive/);
    assert.equal((await opm.waitForCommand(opm.panic())).state, 'accepted', 'panic reset precedes its immediate acknowledgement');
    assert.ok(render(opm).left.every(sample => sample === 0));
  } finally { await opm.dispose(); }
});

test('evicted unwaited panic receipts cannot reject commands posted after their real worklet reset', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM();
  await opm.start();
  try {
    opm.playNote({ note: 69 });
    assert.ok(audible(render(opm).left));
    const node = nodeOf(opm);
    const deliver = node.port.postMessage;
    const queued: unknown[] = [];
    node.port.postMessage = message => { queued.push(structuredClone(message)); };
    const panic = opm.panic();
    const later = opm.setMixGain(0.3);
    const accepted = opm.waitForCommand(later);
    const outcome = accepted.then(event => event, error => error as Error);
    for (let index = 0; index < 127; index++) opm.setMixGain(0.2);
    await assert.rejects(opm.waitForCommand(panic), /Unknown or expired/);
    for (const message of queued) deliver(message);
    node.port.postMessage = deliver;
    const result = await outcome;
    assert.ok(!(result instanceof Error), result instanceof Error ? result.message : 'Later admission rejected');
    assert.equal(result.commandId, later);
    assert.equal(result.state, 'accepted');
    assert.ok(render(opm).left.every(sample => sample === 0), 'panic actually clears the held gate');
  } finally { await opm.dispose(); }
});

test('command waits use intrinsic AbortSignal state and never execute signal shadow accessors', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM();
  await opm.start();
  try {
    const node = nodeOf(opm);
    node.port.postMessage = () => {}; // Keep admission pending while cancellation is exercised.
    const command = opm.setMixGain(0.4);
    const controller = new AbortController();
    let reads = 0;
    for (const name of ['aborted', 'reason', 'addEventListener', 'removeEventListener']) {
      Object.defineProperty(controller.signal, name, { get() { reads++; throw Error(`shadow ${name}`); } });
    }
    const reason = Error('host lifetime ended');
    const wait = opm.waitForCommand(command, { signal: controller.signal });
    const result = wait.then(event => event, error => error as Error);
    controller.abort(reason);
    assert.equal(await result, reason);
    assert.equal(reads, 0);
    const fake = { aborted: true, reason, addEventListener() {}, removeEventListener() {} };
    await assert.rejects(opm.waitForCommand(command, { signal: fake as unknown as AbortSignal }), TypeError);
    for (let index = 0; index < 64; index++) {
      const abort = new AbortController();
      const cancelled = assert.rejects(opm.waitForCommand(command, { signal: abort.signal }), { name: 'AbortError' });
      abort.abort();
      await cancelled;
    }
    assert.equal((await opm.waitForCommand(command, { timeout: 1 }).catch(error => error)).name, 'TimeoutError');
  } finally { await opm.dispose(); }
});

test('named edits retain detached frozen ownership and register every expressive field by content', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const base: Voice = { version: 7, name: 'live', algorithm: 7, feedback: 0, modIndex: 0,
  lfo: { rate: 7, pmDepth: 0.1, amDepth: 0.1, waveform: 'sine' },
  ops: [
    { ratio: 1, level: 0.8, detune: 0, adsr: { a: 0.01, d: 0.03, s: 0.7, r: 0.02 } },
    { ratio: 1, level: 0, detune: 0, adsr: { a: 0, d: 0, s: 0, r: 0 } },
    { ratio: 1, level: 0, detune: 0, adsr: { a: 0, d: 0, s: 0, r: 0 } },
    { ratio: 1, level: 0, detune: 0, adsr: { a: 0, d: 0, s: 0, r: 0 } },
  ], };
  const changes: ((voice: Voice) => void)[] = [
    () => {},
    voice => { voice.ops[0].frequency = 880; },
    voice => { voice.ops[0].rateKeyScale = 1; },
    voice => { voice.ops[0].waveform = 'saw'; },
    voice => { voice.ops[0].waveform = 'noise'; voice.ops[0].noiseRate = 1234; },
    voice => { voice.ops[0].waveform = 'noise'; voice.ops[0].noiseRate = 20000; },
    voice => { voice.pitchEnvelope = { a: 0.02, d: 0.04, r: 0.03, initial: 300, peak: 700, sustain: 0, final: -300 }; },
    voice => { voice.lfo.delay = 0.02; },
    voice => { voice.lfo.phase = 0.25; },
    voice => { voice.lfo.sync = 'global'; },
  ];
  const opm = new OPM();
  await opm.start();
  let baseline: Float32Array | undefined;
  try {
    for (const change of changes) {
      const patch = structuredClone(base);
      change(patch);
      opm.panic();
      opm.loadVoice('live', patch);
      const expected = structuredClone(patch);
      const snapshot = opm.voices.get('live')!;
      if (snapshot.pitchEnvelope) {
        assert.throws(() => { snapshot.pitchEnvelope!.initial = 0; }, TypeError);
        patch.pitchEnvelope!.initial = -1200;
      }
      patch.ops[0].level = 0;
      const reference = new OPM();
      await reference.start();
      try {
        const elapsed = contextOf(opm).frame;
        if (elapsed > 0) render(reference, elapsed);
        opm.playNote({ voice: 'live', note: 72 });
        reference.playNote({ voice: expected, note: 72 });
        const actual = render(opm, 512).left;
        assert.deepEqual(actual, render(reference, 512).left);
        if (baseline) assert.notDeepEqual(actual, baseline, 'the edit must change audible synthesis, not reuse the old registration');
        else baseline = actual;
      } finally { await reference.dispose(); }
    }
  } finally { await opm.dispose(); }
});

test('quality and polyphony are immutable host settings whose rendered behavior survives restart', async () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const options: OPMOptions = { quality, maxVoices: 2 };
    const events: OPMEvent[] = [];
    options.onEvent = event => events.push(event);
    const opm = new OPM(options);
    options.quality = quality === 'eco' ? 'high' : 'eco';
    options.maxVoices = 8;
    assert.equal(Reflect.set(opm, 'quality', 'eco'), false);
    assert.equal(Reflect.set(opm, 'maxVoices', 8), false);
    try {
      for (let run = 0; run < 2; run++) {
        Object.assign(globalThis, { currentFrame: 0 });
        await opm.start();
        const reference = new Synth(sampleRate, 2, { quality });
        const ids = [60, 64, 67].map(note => {
          const id = opm.playNote({ note });
          reference.noteOn(brass, note, id);
          return id;
        });
        const actual = render(opm, 512);
        const left = new Float32Array(512), right = new Float32Array(512);
        reference.render(left, right);
        assert.deepEqual(actual.left, left);
        assert.deepEqual(actual.right, right);
        assert.ok(audible(actual.left));
        assert.equal((await opm.getDiagnostics()).activeVoices, 2);
        assert.ok(events.some(event => event.type === 'note' && event.id === ids[0] && event.state === 'stolen'));
        assert.equal(opm.quality, quality);
        assert.equal(opm.maxVoices, 2);
        await opm.close();
      }
    } finally { await opm.dispose(); }
  }
});

test('host quality and polyphony reject hostile options without getter or numeric coercion', () => {
  let reads = 0;
  const getter = () => { reads++; throw Error('getter ran'); };
  const quality = {};
  Object.defineProperty(quality, 'quality', { get: getter });
  const maxVoices = {};
  Object.defineProperty(maxVoices, 'maxVoices', { get: getter });
  for (const input of [
    quality, maxVoices, Object.assign(Object.create({ quality: 'eco' }), { maxVoices: 1 }),
    { quality: 'other' }, { quality: null }, { quality: { [Symbol.toPrimitive]: getter } },
    { maxVoices: 0 }, { maxVoices: 33 }, { maxVoices: 1.5 }, { maxVoices: NaN },
    { maxVoices: Infinity }, { maxVoices: '2' }, { maxVoices: true }, { maxVoices: null },
    { maxVoices: { valueOf: getter } }, { [Symbol('quality')]: 'eco' },
  ]) assert.throws(() => new OPM(input as OPMOptions));
  assert.equal(reads, 0);
});

test('bank replacement is atomic, bounded and own-data while single loads keep strict ranges', async () => {
  const opm = new OPM();
  const original = opm.exportVoiceBank();
  const entry = (JSON.parse(original) as CompleteVoiceInput[])[0]!;
  let reads = 0;
  const hostile = structuredClone(entry);
  Object.defineProperty(hostile, 'feedback', { get() { reads++; throw Error('getter ran'); } });
  const accessor: CompleteVoiceInput[] = [];
  Object.defineProperty(accessor, '0', { get() { reads++; throw Error('array getter ran'); } });
  const inherited: CompleteVoiceInput[] = [];
  Object.setPrototypeOf(inherited, Object.create(Array.prototype));
  const extra: CompleteVoiceInput[] = [];
  Object.defineProperty(extra, 'extra', { value: 1 });
  const inputs: unknown[] = [
    '[', '[]', '😀'.repeat(MAX_BANK_BYTES / 4 + 1), [hostile],
    [entry, entry], new Array(1), accessor, inherited, extra,
    Array.from({ length: 129 }, (_, index) => ({ ...entry, name: `voice_${index}` })),
    [entry, { ...entry, name: 'bad', feedback: NaN }],
  ];
  try {
    for (const input of inputs) {
      assert.throws(() => opm.replaceVoiceBank(input as string | readonly CompleteVoiceInput[]));
      assert.equal(opm.exportVoiceBank(), original);
    }
    assert.equal(reads, 0);
    const clamped = structuredClone(entry);
    clamped.name = 'clamped';
    clamped.ops[0].ratio = 100;
    assert.throws(() => opm.loadVoice('strict', clamped), /ratio/);
    assert.equal(opm.exportVoiceBank(), original);
    opm.replaceVoiceBank([clamped]);
    assert.equal(opm.voices.get('clamped')!.ops[0].ratio, 32);
    clamped.ops[0].level = 0;
    assert.notEqual(opm.voices.get('clamped')!.ops[0].level, 0);
    assert.deepEqual([...parseVoiceBank(opm.exportVoiceBank()).keys()], ['clamped']);
    opm.replaceVoiceBank([]);
    assert.equal(opm.exportVoiceBank(), '[]');
    assert.throws(() => parseVoiceBank([]));
    assert.throws(() => opm.replaceVoiceBank('[]'));
  } finally { await opm.dispose(); }
});

test('bank exports use registry names, frozen detached entries and no inherited serialization hooks', async () => {
  const opm = new OPM();
  const originalObjectHook = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  const originalArrayHook = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
  let reads = 0;
  try {
    opm.replaceVoiceBank([]);
    const targets: [number | boolean, number | boolean, number | boolean, number | boolean] = [true, false, 0.5, 1];
    opm.loadVoice('registered', { ...brass, lfo: { ...brass.lfo, amTargets: targets, pmTargets: targets } });
    targets.fill(0);
    const snapshot = opm.voices.get('registered')!;
    assert.equal(snapshot.name, 'registered');
    assert.throws(() => { snapshot.ops[0].adsr.a = 10; }, TypeError);
    assert.deepEqual(snapshot.lfo.amTargets, [1, 0, 0.5, 1]);
    assert.throws(() => { (snapshot.lfo.amTargets as unknown as number[])[0] = 0; }, TypeError);
    for (const prototype of [Object.prototype, Array.prototype]) {
      Object.defineProperty(prototype, 'toJSON', { configurable: true, get() { reads++; throw Error('prototype getter ran'); } });
    }
    const output = opm.exportVoiceBank();
    assert.equal(reads, 0);
    const exported = JSON.parse(output) as CompleteVoiceInput[];
    assert.equal(exported[0]!.name, 'registered');
    assert.ok(new TextEncoder().encode(output).length <= MAX_BANK_BYTES);
    exported[0]!.ops[0].level = 0;
    assert.notEqual(snapshot.ops[0].level, 0);
    assert.deepEqual([...parseVoiceBank(output).keys()], ['registered']);
  } finally {
    if (originalObjectHook) Object.defineProperty(Object.prototype, 'toJSON', originalObjectHook);
    else Reflect.deleteProperty(Object.prototype, 'toJSON');
    if (originalArrayHook) Object.defineProperty(Array.prototype, 'toJSON', originalArrayHook);
    else Reflect.deleteProperty(Array.prototype, 'toJSON');
    await opm.dispose();
  }
});

test('registry size is bounded, replacement frees capacity, and disposed bank operations reject', async () => {
  const opm = new OPM();
  try {
    opm.replaceVoiceBank([]);
    for (let index = 0; index < 128; index++) opm.loadVoice(`voice_${index}`, brass);
    const full = opm.exportVoiceBank();
    assert.throws(() => opm.loadVoice('overflow', brass), /128/);
    assert.equal(opm.exportVoiceBank(), full);
    opm.loadVoice('voice_0', { ...brass, feedback: 0 });
    assert.equal(opm.voices.size, 128);
    assert.equal(opm.removeVoice('missing'), false);
    assert.equal(opm.removeVoice('voice_1'), true);
    assert.equal(opm.removeVoice('voice_1'), false);
    assert.throws(() => opm.removeVoice('../bad'));
    opm.loadVoice('replacement', brass);
    assert.equal(opm.voices.size, 128);
    await opm.dispose();
    for (const operation of [
      () => opm.loadVoice('late', brass), () => opm.replaceVoiceBank([]),
      () => opm.removeVoice('voice_0'), () => opm.exportVoiceBank(),
    ]) assert.throws(operation, /disposed/);
  } finally { await opm.dispose(); }
});

test('valid array banks cannot export beyond the UTF-8 output budget', async () => {
  const opm = new OPM();
  const detailed: Voice = { version: 7, name: 'detailed', algorithm: 0, feedback: 7, modIndex: 15.123456789012345,
  lfo: { rate: 19.123456789012345, amDepth: 0.12345678901234567, pmDepth: 1199.1234567890123,
    waveform: 'triangle', delay: 9.123456789012345, sync: 'global', phase: 0.12345678901234567,
    amTargets: [0.12345678901234567, 0.12345678901234567, 0.12345678901234567, 0.12345678901234567],
    pmTargets: [0.12345678901234567, 0.12345678901234567, 0.12345678901234567, 0.12345678901234567] },
  pitchEnvelope: { a: 9.123456789012345, d: 9.123456789012345, r: 9.123456789012345,
    initial: -4321.123456789012, peak: 4321.123456789012, sustain: 321.12345678901234, final: -321.12345678901234 },
  ops: [0, 1, 2, 3].map(() => ({
    ratio: 31.123456789012345, level: 0.12345678901234567, detune: -1199.1234567890123,
    adsr: { a: 9.123456789012345, d: 9.123456789012345, s: 0.12345678901234567, r: 9.123456789012345 },
    frequency: 19999.123456789012, velocitySensitivity: 47.123456789012345, rateKeyScale: 3.1234567890123457,
    keyScale: { breakpoint: 64, leftDbPerOctave: 23.123456789012345, rightDbPerOctave: 23.123456789012345 },
  })) as Voice['ops'], };
  try {
    opm.replaceVoiceBank(Array.from({ length: 128 }, (_, index) => ({ ...detailed, name: String(index).padStart(64, 'v') })));
    assert.throws(() => opm.exportVoiceBank(), /256 KiB/);
    assert.equal(opm.voices.size, 128, 'failed export leaves the registry intact');
    opm.replaceVoiceBank([detailed]);
    assert.deepEqual([...parseVoiceBank(opm.exportVoiceBank()).keys()], ['detailed']);
  } finally { await opm.dispose(); }
});

test('bank replacement and cache eviction cannot alter active or admitted future patches', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM(), reference = new OPM();
  await opm.start();
  await reference.start();
  try {
    opm.loadVoice('held', brass);
    for (const host of [opm, reference]) {
      host.playNote({ voice: host === opm ? 'held' : brass, note: 69 });
      host.playNote({ voice: host === opm ? 'held' : brass, note: 72, at: 256 / sampleRate });
    }
    assert.deepEqual(render(opm).left, render(reference).left);
    const silent = (JSON.parse(opm.exportVoiceBank()) as CompleteVoiceInput[]).find(voice => voice.name === 'held')!;
    silent.ops.forEach(operator => { operator.level = 0; });
    opm.replaceVoiceBank([silent]);
    opm.playNote({ voice: 'held', note: 60 });
    opm.removeVoice('held');
    for (let index = 0; index < 129; index++) {
      const id = opm.playNote({ voice: { ...brass, name: `evict_${index}` }, note: 60, time: 1 });
      opm.stop(id);
    }
    assert.throws(() => opm.playNote({ voice: 'held', note: 60 }), /Unknown voice/);
    for (let block = 0; block < 4; block++) assert.deepEqual(render(opm).left, render(reference).left);
    const diagnostics = await opm.getDiagnostics();
    assert.equal(diagnostics.errors, 0);
    assert.equal(diagnostics.rejectedNotes, 0);
  } finally { await opm.dispose(); await reference.dispose(); }
});

test('explicit stop cancellation removes only its own automation and leaves a natural release tail', async () => {
  for (const cancelControls of [false, true]) {
    Object.assign(globalThis, { currentFrame: 0 });
    const opm = new OPM();
    await opm.start();
    try {
      const left = opm.playNote({ note: 69, pan: -1 });
      const right = opm.playNote({ note: 72, pan: 1 });
      render(opm);
      opm.updateNote(left, { expression: 0 }, { at: 256 / sampleRate });
      opm.updateNote(right, { expression: 0 }, { at: 256 / sampleRate });
      if (cancelControls) opm.stop(left, { cancelControls: true });
      else opm.stop(left);
      const tail = render(opm);
      assert.ok(audible(tail.left), 'cancellation releases instead of silencing immediately');
      const after = render(opm);
      assert.equal(audible(after.left), cancelControls);
      assert.ok(after.right.every(sample => Math.abs(sample) < 1e-10), 'another gate keeps its own automation');
      opm.panic();
      const future = opm.playNote({ note: 69, time: 1 });
      opm.updateNote(future, { expression: 0 }, { at: 2 });
      opm.stop(future, { cancelControls: true });
      assert.equal((await opm.getDiagnostics()).pendingEvents, 0);
    } finally { await opm.dispose(); }
  }
});

test('malformed stop cancellation cannot remove controls or release its note', async () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM();
  await opm.start();
  let reads = 0;
  try {
    const id = opm.playNote({ note: 69 });
    render(opm);
    opm.updateNote(id, { expression: 0 }, { at: 256 / sampleRate });
    const accessor = {};
    Object.defineProperty(accessor, 'cancelControls', { get() { reads++; return true; } });
    for (const options of [accessor, { cancelControls: 1 }, { cancelControls: undefined },
      { cancelControls: true, at: 0 }, { cancelControls: false, at: 0 }]) {
      assert.throws(() => opm.stop(id, options as StopOptions));
    }
    assert.equal(reads, 0);
    assert.equal((await opm.getDiagnostics()).pendingEvents, 1);
    assert.ok(audible(render(opm).left));
    assert.ok(render(opm).left.every(sample => sample === 0));
  } finally { await opm.dispose(); }
});
