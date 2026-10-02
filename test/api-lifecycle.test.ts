import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandRejectedError, OPM, type OPMEvent } from '../src/api/index.js';

interface Deferred { promise: Promise<void>; resolve: () => void }
interface MockAudioOptions {
  failModuleAt?: number;
  failResumeAt?: number;
  moduleGate?: Deferred;
  closeGate?: Deferred;
  onResume?: (context: MockContext) => void;
  onClose?: (context: MockContext) => void;
}
interface MockContext {
  index: number;
  destination: object;
  currentTime: number;
  sampleRate: number;
  state: string;
  closed: number;
  resumed: number;
  suspended: number;
  listeners: Set<() => void>;
  modules: string[];
  audioWorklet: { addModule: (url: URL) => Promise<void> };
  suspend(): Promise<void>;
  setState(state: string): void;
}
interface MockNode {
  context: MockContext;
  messages: unknown[];
  portClosed: number;
  port: {
    postMessage: (message: unknown) => void;
    close: () => void;
    onmessage: ((event: { data: unknown }) => void) | null;
    onmessageerror: (() => void) | null;
  };
  connections: Set<object>;
  disconnected: number;
  onprocessorerror: (() => void) | null;
}
function contextOf(opm: OPM): MockContext { return opm.context as unknown as MockContext; }
function nodeOf(opm: OPM): MockNode { return opm.node as unknown as MockNode; }

function mockAudio({ failModuleAt = -1, failResumeAt = -1, moduleGate, closeGate, onResume, onClose }: MockAudioOptions = {}) {
  const originals = new Map(['AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const contexts: MockContext[] = [];
  const nodes: MockNode[] = [];
  class Context implements MockContext {
    index: number;
    destination: object;
    currentTime: number;
    sampleRate = 44100;
    state: string;
    closed: number;
    resumed: number;
    suspended: number;
    listeners: Set<() => void>;
    modules: string[];
    audioWorklet: { addModule: (url: URL) => Promise<void> };
    constructor() {
      this.index = contexts.length;
      this.destination = {};
      this.currentTime = 7;
      this.state = 'suspended';
      this.closed = 0;
      this.resumed = 0;
      this.suspended = 0;
      this.listeners = new Set<() => void>();
      this.modules = [];
      this.audioWorklet = { addModule: async url => {
        this.modules.push(url.href);
        if (this.index === failModuleAt) throw Error('module load failed');
        if (this.index === 0 && moduleGate) await moduleGate.promise;
      } };
      contexts.push(this);
    }
    addEventListener(type: string, listener: () => void) { if (type === 'statechange') this.listeners.add(listener); }
    removeEventListener(type: string, listener: () => void) { if (type === 'statechange') this.listeners.delete(listener); }
    setState(state: string) {
      this.state = state;
      for (const listener of this.listeners) listener();
    }
    async resume() {
      this.resumed++;
      if (this.index === failResumeAt) throw Error('resume failed');
      this.setState('running');
      onResume?.(this);
    }
    async suspend() { this.suspended++; this.setState('suspended'); }
    async close() {
      this.closed++;
      if (this.index === 0 && closeGate) await closeGate.promise;
      this.setState('closed');
      onClose?.(this);
    }
  }
  class Node implements MockNode {
    context: MockContext;
    messages: unknown[];
    portClosed: number;
    port: MockNode['port'];
    connections: Set<object>;
    disconnected: number;
    onprocessorerror: (() => void) | null = null;
    constructor(context: MockContext) {
      this.context = context;
      this.messages = [];
      this.portClosed = 0;
      this.port = {
        postMessage: (message: unknown) => this.messages.push(message),
        close: () => { this.portClosed++; },
        onmessage: null,
        onmessageerror: null,
      };
      this.connections = new Set();
      this.disconnected = 0;
      nodes.push(this);
    }
    connect(destination: object) { this.connections.add(destination); }
    disconnect(destination?: object) {
      this.disconnected++;
      if (destination === undefined) this.connections.clear();
      else this.connections.delete(destination);
    }
  }
  Object.assign(globalThis, { AudioContext: Context, AudioWorkletNode: Node });
  return { Context, contexts, nodes, restore() {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

test('failed starts release owned resources, and suspended restarts resume the existing node', async () => {
  const audio = mockAudio({ failModuleAt: 0, failResumeAt: 1 });
  try {
    const opm = new OPM();
    await assert.rejects(opm.start(), /module load failed/);
    assert.equal(audio.contexts[0].state, 'closed');
    assert.equal(opm.context, null);
    await assert.rejects(opm.start(), /resume failed/);
    assert.equal(audio.contexts[1].state, 'closed');
    assert.equal(audio.nodes[0].portClosed, 1);
    assert.equal(audio.nodes[0].connections.size, 0);
    assert.equal(audio.contexts[1].listeners.size, 0);
    await opm.start();
    const context = contextOf(opm);
    const node = nodeOf(opm);
    await context.suspend();
    await opm.start();
    assert.equal(context.state, 'running');
    assert.strictEqual(opm.node, node);
    await context.suspend();
    await opm.resume();
    assert.equal(context.state, 'running');
    await opm.close();
    await opm.close();
    assert.equal(context.closed, 1);
    assert.equal(node.portClosed, 1);
    assert.equal(opm.context, null);
    assert.equal(opm.node, null);
    await opm.start();
    assert.notStrictEqual(opm.context, context);
    await opm.close();
  } finally {
    audio.restore();
  }
});

test('start coalesces initialization, close waits for it, and queued restart cannot leak the first context', async () => {
  const moduleGate = deferred();
  const audio = mockAudio({ moduleGate });
  try {
    const opm = new OPM();
    const first = opm.start();
    assert.strictEqual(opm.start(), first);
    const closing = opm.close();
    assert.strictEqual(opm.close(), closing);
    const restarting = opm.start();
    moduleGate.resolve();
    await first;
    await closing;
    await restarting;
    assert.equal(audio.contexts.length, 2);
    assert.equal(audio.contexts[0].state, 'closed');
    assert.equal(audio.nodes[0].portClosed, 1);
    assert.equal(audio.nodes[0].connections.size, 0);
    assert.equal(contextOf(opm).state, 'running');
    assert.strictEqual(opm.node, audio.nodes[1]);
    await opm.close();
  } finally {
    audio.restore();
  }
});

test('close in progress serializes new starts and disallows use of a disposed node', async () => {
  const closeGate = deferred();
  const audio = mockAudio({ closeGate });
  try {
    const opm = new OPM();
    await opm.start();
    const closing = opm.close();
    const restarting = opm.start();
    assert.equal(audio.contexts.length, 1);
    assert.throws(() => opm.playNote({ note: 60 }), /start/);
    closeGate.resolve();
    await closing;
    await restarting;
    assert.equal(audio.contexts.length, 2);
    assert.equal(audio.contexts[0].closed, 1);
    await opm.close();
  } finally {
    audio.restore();
  }
});

test('host state-change hooks cannot reenter initialization or bypass close serialization', async () => {
  let opm: OPM;
  let reentrantStart: Promise<void> | undefined;
  let reentrantRestart: Promise<void> | undefined;
  const audio = mockAudio({
    onResume: () => { reentrantStart = opm.start(); },
    onClose: context => { if (context.index === 0) reentrantRestart = opm.start(); },
  });
  try {
    opm = new OPM();
    const starting = opm.start();
    await starting;
    assert.strictEqual(reentrantStart, starting);
    assert.equal(audio.contexts.length, 1);
    assert.equal(audio.contexts[0].resumed, 1);
    await opm.close();
    await reentrantRestart;
    assert.equal(audio.contexts.length, 2);
    assert.equal(audio.contexts[0].state, 'closed');
    assert.strictEqual(opm.context, audio.contexts[1]);
    await opm.close();
  } finally {
    audio.restore();
  }
});

test('borrowed contexts survive close and failure, while only OPM connections, listeners and ports are released', async () => {
  const audio = mockAudio();
  try {
    const context = new audio.Context();
    const output = {} as unknown as AudioNode;
    const opm = new OPM({ context: context as unknown as AudioContext, destination: null });
    await opm.start();
    const first = nodeOf(opm);
    assert.equal(first.connections.size, 0);
    assert.strictEqual(opm.connect(output), opm);
    assert.ok(first.connections.has(output));
    opm.disconnect(output);
    assert.equal(first.connections.size, 0);
    opm.connect(output);
    await opm.close();
    assert.equal(context.closed, 0);
    assert.equal(context.suspended, 0);
    assert.equal(context.state, 'running');
    assert.equal(context.listeners.size, 0);
    assert.equal(first.connections.size, 0);
    assert.equal(first.portClosed, 1);
    assert.equal(first.port.onmessage, null);
    assert.equal(first.onprocessorerror, null);
    await opm.start();
    assert.strictEqual(opm.context, context);
    assert.notStrictEqual(opm.node, first);
    assert.equal(context.listeners.size, 1);
    nodeOf(opm).onprocessorerror!();
    assert.equal(context.closed, 0);
    assert.equal(context.listeners.size, 0);
    await opm.close();
    assert.equal(context.closed, 0);
    const automatic = new OPM({ context: context as unknown as AudioContext, destination: output });
    await automatic.start();
    assert.ok(nodeOf(automatic).connections.has(output));
    await automatic.close();
    const defaultOutput = new OPM({ context: context as unknown as AudioContext });
    await defaultOutput.start();
    assert.ok(nodeOf(defaultOutput).connections.has(context.destination));
    await defaultOutput.close();
  } finally {
    audio.restore();
  }
});

test('initialization failure never closes a borrowed context and releases its partial node', async () => {
  const audio = mockAudio({ failResumeAt: 0 });
  try {
    const context = new audio.Context();
    const opm = new OPM({ context: context as unknown as AudioContext });
    await assert.rejects(opm.start(), /resume failed/);
    assert.equal(context.closed, 0);
    assert.equal(context.suspended, 0);
    assert.equal(context.listeners.size, 0);
    assert.equal(audio.nodes[0].portClosed, 1);
    assert.equal(audio.nodes[0].connections.size, 0);
    assert.equal(opm.node, null);
    await opm.close();
    assert.equal(context.closed, 0);
  } finally {
    audio.restore();
  }
});

test('diagnostics correlate replies and reject pending requests on processor failure, close or suspension', async () => {
  const audio = mockAudio();
  try {
    const events: OPMEvent[] = [];
    const opm = new OPM({ onEvent: event => { events.push(event); throw Error('host callback failure'); } });
    await opm.start();
    const reply = { type: 'diagnostics', requestId: 1, activeVoices: 2, pendingEvents: 3, errors: 0, rejectedNotes: 1 };
    const request = opm.getDiagnostics();
    let resolved = false;
    void request.then(() => { resolved = true; });
    nodeOf(opm).port.onmessage!({ data: { ...reply, requestId: 99 } });
    await Promise.resolve();
    assert.equal(resolved, false, 'an unrelated request ID cannot resolve this request');
    let reads = 0;
    const accessor = { ...reply };
    Object.defineProperty(accessor, 'activeVoices', { get() { reads++; return 0; } });
    nodeOf(opm).port.onmessage!({ data: accessor });
    assert.equal(reads, 0);
    await Promise.resolve();
    assert.equal(resolved, false, 'an accessor reply cannot resolve this request');
    nodeOf(opm).port.onmessage!({ data: reply });
    await request;
    const failed = assert.rejects(opm.getDiagnostics(), /processor failed/);
    const brokenNode = nodeOf(opm);
    brokenNode.onprocessorerror!();
    await failed;
    assert.equal(brokenNode.portClosed, 1);
    assert.ok(events.some(event => event.type === 'error' && /processor failed/.test(event.error.message)));
    assert.throws(() => opm.playNote({ note: 60 }), /processor failed/);
    await assert.rejects(opm.getDiagnostics(), /processor failed/);
    await opm.start();
    const suspended = assert.rejects(opm.getDiagnostics(), /not running/);
    await contextOf(opm).suspend();
    await suspended;
    await assert.rejects(opm.getDiagnostics(), /resume/);
    await opm.resume();
    const hostClosed = assert.rejects(opm.getDiagnostics(), /AudioContext is closed/);
    const oldContext = contextOf(opm);
    oldContext.setState('closed');
    await hostClosed;
    await opm.start();
    assert.notStrictEqual(opm.context, oldContext);
    const closed = assert.rejects(opm.getDiagnostics(), /closed/);
    await opm.close();
    await closed;
  } finally {
    audio.restore();
  }
});

test('diagnostics requests are bounded and never recycle exhausted safe IDs', async () => {
  const audio = mockAudio();
  try {
    const opm = new OPM();
    await opm.start();
    const pending = Array.from({ length: 64 }, () => opm.getDiagnostics());
    const settled = Promise.allSettled(pending);
    await assert.rejects(opm.getDiagnostics(), /Too many pending/);
    await opm.close();
    assert.ok((await settled).every(result => result.status === 'rejected'));
    await opm.start();
    const internals = opm as unknown as { _nextRequestId: number };
    internals._nextRequestId = Number.MAX_SAFE_INTEGER;
    const last = opm.getDiagnostics();
    const rejection = assert.rejects(last, /closed/);
    await assert.rejects(opm.getDiagnostics(), /ID space exhausted/);
    await opm.close();
    await rejection;
  } finally {
    audio.restore();
  }
});

test('resume boundaries reject pre-interruption diagnostics despite deferred state notifications', async () => {
  for (const method of ['resume', 'start'] as const) {
    const audio = mockAudio();
    const context = new audio.Context();
    context.resume = async () => { context.resumed++; context.state = 'running'; };
    const opm = new OPM({ context: context as unknown as AudioContext, interruption: 'preserve' });
    try {
      await opm.start();
      for (let cycle = 0; cycle < 2; cycle++) {
        const rejected = assert.rejects(opm.getDiagnostics());
        context.state = 'suspended';
        await opm[method]();
        await rejected;
        assert.equal(context.state, 'running');
      }
    } finally {
      await opm.close();
      audio.restore();
    }
  }
});

test('custom modules stay same-origin and secure, snapshot URLs, and preserve module-load errors', async () => {
  const originals = new Map(['location', 'isSecureContext'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const audio = mockAudio({ failModuleAt: 1 });
  try {
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://host.test/app/index.html' } });
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
    for (const workletUrl of ['https://remote.test/opm.js', 'data:text/javascript,1', 'blob:https://host.test/id',
      'https://user:password@host.test/processor.js', '/processor.js#fragment']) {
      assert.throws(() => new OPM({ workletUrl }), /same-origin/);
    }
    const url = new URL('https://host.test/assets/processor.js');
    const opm = new OPM({ workletUrl: url });
    url.pathname = '/changed.js';
    await opm.start();
    assert.deepEqual(contextOf(opm).modules, ['https://host.test/assets/processor.js']);
    await opm.dispose();
    const errors: string[] = [];
    const failed = new OPM({ workletUrl: '../audio/processor.js', onEvent: event => {
      if (event.type === 'error') errors.push(event.error.message);
    } });
    await assert.rejects(failed.start(), /module load failed/);
    assert.deepEqual(errors, ['module load failed']);
    assert.deepEqual(audio.contexts[1].modules, ['https://host.test/audio/processor.js']);
    assert.equal(audio.contexts[1].closed, 1);
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
    const insecure = new OPM();
    await assert.rejects(insecure.start(), /secure context/);
    assert.equal(audio.contexts.length, 2, 'security rejection must precede resource allocation');
    assert.throws(() => new OPM({ workletUrl: '/processor.js' }), /secure context/);
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'http://host.test/' } });
    assert.throws(() => new OPM({ workletUrl: '/processor.js' }), /HTTPS or loopback/);
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'http://localhost:5173/base/' } });
    const loopback = new OPM({ workletUrl: 'processor.js' });
    await loopback.start();
    assert.deepEqual(contextOf(loopback).modules, ['http://localhost:5173/base/processor.js']);
    await loopback.dispose();
  } finally {
    audio.restore();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('subscriptions isolate callbacks, defer additions, and distinguish close from terminal disposal', async () => {
  const audio = mockAudio();
  const calls: string[] = [];
  const context = new audio.Context();
  const opm = new OPM({ context: context as unknown as AudioContext, onEvent: event => {
    if (event.type === 'command') calls.push('legacy');
  } });
  try {
    await opm.start();
    let removeSecond = () => {};
    const removeFirst = opm.subscribe(event => {
      if (event.type !== 'command') return;
      calls.push('first');
      removeSecond();
      opm.subscribe(next => { if (next.type === 'command') calls.push('added'); });
      event.state = 'rejected';
    });
    removeSecond = opm.subscribe(event => { if (event.type === 'command') calls.push('removed'); });
    const listener = (event: OPMEvent) => {
      if (event.type === 'command') { assert.equal(event.state, 'accepted'); calls.push('duplicate'); }
    };
    const removeDuplicate = opm.subscribe(listener);
    const removeOtherDuplicate = opm.subscribe(listener);
    const reply = { type: 'command', command: 'setMixGain', state: 'accepted', frame: 0, time: 0 };
    nodeOf(opm).port.onmessage!({ data: reply });
    assert.deepEqual(calls, ['first', 'duplicate', 'duplicate', 'legacy']);
    removeFirst();
    removeFirst();
    removeDuplicate();
    removeDuplicate();
    await opm.close();
    await opm.start();
    calls.length = 0;
    nodeOf(opm).port.onmessage!({ data: reply });
    assert.deepEqual(calls, ['duplicate', 'added', 'legacy']);
    const oldReceive = nodeOf(opm).port.onmessage!;
    const disposal = opm.dispose();
    assert.strictEqual(opm.dispose(), disposal);
    await disposal;
    oldReceive({ data: reply });
    assert.deepEqual(calls, ['duplicate', 'added', 'legacy'], 'disposed ports cannot deliver stale events');
    assert.equal(context.closed, 0);
    assert.equal(context.suspended, 0);
    assert.equal(context.listeners.size, 0);
    assert.equal(opm.onEvent, undefined);
    removeOtherDuplicate();
    assert.throws(() => opm.subscribe(listener), /disposed/);
    await assert.rejects(opm.start(), /disposed/);
    assert.throws(() => opm.setMixGain(0.5), /disposed/);
  } finally { await opm.dispose(); audio.restore(); }
});

test('command waits correlate multicast replies, retain immediate outcomes, and reject admission failures', async () => {
  const audio = mockAudio();
  const opm = new OPM();
  try {
    await opm.start();
    const commandId = opm.setMixGain(0.5);
    const first = opm.waitForCommand(commandId);
    const second = opm.waitForCommand(commandId);
    let settled = false;
    void first.then(() => { settled = true; });
    const reply = { type: 'command', command: 'setMixGain', commandId, state: 'accepted', frame: 100, time: 100 / 44100 };
    nodeOf(opm).port.onmessage!({ data: { ...reply, command: 'panic' } });
    nodeOf(opm).port.onmessage!({ data: { ...reply, commandId: commandId + 1 } });
    await Promise.resolve();
    assert.equal(settled, false);
    nodeOf(opm).port.onmessage!({ data: reply });
    assert.deepEqual(await first, await second);
    nodeOf(opm).port.onmessage!({ data: { ...reply, state: 'rejected', reason: 'capacity' } });
    assert.equal((await opm.waitForCommand(commandId)).state, 'accepted', 'first acknowledgement wins');
    const rejectedId = opm.stop(42);
    nodeOf(opm).port.onmessage!({ data: { ...reply, command: 'stop', commandId: rejectedId, id: 42, state: 'rejected', reason: 'inactive' } });
    await assert.rejects(opm.waitForCommand(rejectedId), error =>
      error instanceof CommandRejectedError && error.event.reason === 'inactive' && error.event.id === 42);
    await assert.rejects(opm.waitForCommand(999), /Unknown or expired/);
    await assert.rejects(opm.waitForCommand(commandId, { timeout: 0 }), /timeout/);
  } finally { await opm.dispose(); audio.restore(); }
});

test('timeout and abort release only their own waits, with bounded receipts and no loss of live waiters', async () => {
  const audio = mockAudio();
  const opm = new OPM();
  const timers = new Map<number, () => void>();
  const savedTimeout = globalThis.setTimeout;
  const savedClear = globalThis.clearTimeout;
  let nextTimer = 1;
  Object.assign(globalThis, {
    setTimeout: (callback: () => void) => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
  });
  try {
    await opm.start();
    const commandId = opm.setMixGain(0.5);
    const abort = new AbortController();
    const reason = Error('component unmounted');
    const aborted = assert.rejects(opm.waitForCommand(commandId, { signal: abort.signal }), error => error === reason);
    const timedOut = assert.rejects(opm.waitForCommand(commandId, { timeout: 1 }), { name: 'TimeoutError' });
    abort.abort(reason);
    for (const callback of [...timers.values()]) callback();
    await aborted;
    await timedOut;
    assert.equal(timers.size, 0);
    await assert.rejects(opm.waitForCommand(commandId, { signal: abort.signal }), error => error === reason);
    const waits = Array.from({ length: 64 }, () => opm.waitForCommand(commandId));
    const settled = Promise.allSettled(waits);
    await assert.rejects(opm.waitForCommand(commandId), /Too many pending/);
    const expired = opm.setMixGain(0.6);
    for (let index = 0; index < 130; index++) opm.setMixGain(0.7);
    await assert.rejects(opm.waitForCommand(expired), /Unknown or expired/);
    nodeOf(opm).port.onmessage!({ data: { type: 'command', command: 'setMixGain', commandId,
      state: 'accepted', frame: 0, time: 0 } });
    assert.ok((await settled).every(result => result.status === 'fulfilled' && result.value.commandId === commandId));
    assert.equal(timers.size, 0);
  } finally {
    await opm.dispose();
    Object.assign(globalThis, { setTimeout: savedTimeout, clearTimeout: savedClear });
    audio.restore();
  }
});

test('pending command waits settle on reset, suspension, close and failure; panic survives its own reset', async () => {
  const audio = mockAudio();
  const opm = new OPM({ interruption: 'preserve' });
  try {
    await opm.start();
    const reset = assert.rejects(opm.waitForCommand(opm.setMixGain(0.5)), /reset: panic/);
    const panicId = opm.panic();
    const panic = opm.waitForCommand(panicId);
    const laterId = opm.setMixGain(0.7);
    const later = opm.waitForCommand(laterId);
    nodeOf(opm).port.onmessage!({ data: { type: 'reset', reason: 'panic', commandId: panicId, frame: 0, time: 0 } });
    nodeOf(opm).port.onmessage!({ data: { type: 'command', command: 'panic', commandId: panicId, state: 'accepted', frame: 0, time: 0 } });
    nodeOf(opm).port.onmessage!({ data: { type: 'command', command: 'setMixGain', commandId: laterId, state: 'accepted', frame: 0, time: 0 } });
    await reset;
    assert.equal((await panic).state, 'accepted');
    assert.equal((await later).state, 'accepted', 'a reset cannot cancel commands posted after its panic');
    const suspended = assert.rejects(opm.waitForCommand(opm.setMixGain(0.5)), /acknowledgement interrupted/);
    await contextOf(opm).suspend();
    await suspended;
    await opm.resume();
    const closed = assert.rejects(opm.waitForCommand(opm.setMixGain(0.5)), /closed/);
    await opm.close();
    await closed;
    await opm.start();
    const failed = assert.rejects(opm.waitForCommand(opm.setMixGain(0.5)), /processor failed/);
    nodeOf(opm).onprocessorerror!();
    await failed;
    await opm.start();
    const interrupted = assert.rejects(opm.waitForCommand(opm.setMixGain(0.5)), /reset: interruption/);
    nodeOf(opm).port.onmessage!({ data: { type: 'reset', reason: 'interruption', frame: 0, time: 0 } });
    await interrupted;
  } finally { await opm.dispose(); audio.restore(); }
});

test('terminal disposal during initialization cannot leak resources or admit a queued restart', async () => {
  for (const borrowed of [false, true]) {
    const moduleGate = deferred();
    const audio = mockAudio({ moduleGate });
    const host = borrowed ? new audio.Context() : undefined;
    const opm = new OPM({ context: host as unknown as AudioContext | undefined });
    try {
      const starting = opm.start();
      const disposal = opm.dispose();
      assert.strictEqual(opm.dispose(), disposal);
      await assert.rejects(opm.start(), /disposed/);
      moduleGate.resolve();
      await starting;
      await disposal;
      assert.equal(audio.contexts.length, 1);
      assert.equal(audio.contexts[0].closed, borrowed ? 0 : 1);
      assert.equal(audio.contexts[0].suspended, 0);
      assert.equal(audio.contexts[0].listeners.size, 0);
      assert.equal(audio.nodes[0].portClosed, 1);
      assert.equal(audio.nodes[0].connections.size, 0);
      assert.equal(opm.node, null);
      await assert.rejects(opm.resume(), /disposed/);
    } finally { await opm.dispose(); audio.restore(); }
  }
});
