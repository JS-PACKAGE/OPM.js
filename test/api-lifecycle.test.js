import test from 'node:test';
import assert from 'node:assert/strict';
import { OPM } from '../src/api/index.js';

function mockAudio({ failModuleAt = -1, failResumeAt = -1, moduleGate, closeGate, onResume, onClose } = {}) {
  const originals = new Map(['AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const contexts = [];
  const nodes = [];
  globalThis.AudioContext = class {
    constructor() {
      this.index = contexts.length;
      this.destination = {};
      this.currentTime = 7;
      this.state = 'suspended';
      this.closed = 0;
      this.resumed = 0;
      this.suspended = 0;
      this.listeners = new Set();
      this.audioWorklet = { addModule: async () => {
        if (this.index === failModuleAt) throw Error('module load failed');
        if (this.index === 0 && moduleGate) await moduleGate.promise;
      } };
      contexts.push(this);
    }
    addEventListener(type, listener) { if (type === 'statechange') this.listeners.add(listener); }
    removeEventListener(type, listener) { if (type === 'statechange') this.listeners.delete(listener); }
    setState(state) {
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
  };
  globalThis.AudioWorkletNode = class {
    constructor(context) {
      this.context = context;
      this.messages = [];
      this.portClosed = 0;
      this.port = {
        postMessage: message => this.messages.push(message),
        close: () => { this.portClosed++; },
      };
      this.connections = new Set();
      this.disconnected = 0;
      nodes.push(this);
    }
    connect(destination) { this.connections.add(destination); }
    disconnect(destination) {
      this.disconnected++;
      if (destination === undefined) this.connections.clear();
      else this.connections.delete(destination);
    }
  };
  return { contexts, nodes, restore() {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  } };
}

function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
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
    const context = opm.context;
    const node = opm.node;
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
    assert.equal(opm.context.state, 'running');
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
  let opm;
  let reentrantStart;
  let reentrantRestart;
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
    const context = new AudioContext();
    const output = {};
    const opm = new OPM({ context, destination: null });
    await opm.start();
    const first = opm.node;
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
    opm.node.onprocessorerror();
    assert.equal(context.closed, 0);
    assert.equal(context.listeners.size, 0);
    await opm.close();
    assert.equal(context.closed, 0);
    const automatic = new OPM({ context, destination: output });
    await automatic.start();
    assert.ok(automatic.node.connections.has(output));
    await automatic.close();
    const defaultOutput = new OPM({ context });
    await defaultOutput.start();
    assert.ok(defaultOutput.node.connections.has(context.destination));
    await defaultOutput.close();
  } finally {
    audio.restore();
  }
});

test('initialization failure never closes a borrowed context and releases its partial node', async () => {
  const audio = mockAudio({ failResumeAt: 0 });
  try {
    const context = new AudioContext();
    const opm = new OPM({ context });
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
    const events = [];
    const opm = new OPM({ onEvent: event => { events.push(event); throw Error('host callback failure'); } });
    await opm.start();
    const reply = { type: 'diagnostics', requestId: 1, activeVoices: 2, pendingEvents: 3, errors: 0, rejectedNotes: 1 };
    const request = opm.getDiagnostics();
    opm.node.port.onmessage({ data: { ...reply, requestId: 99 } });
    let reads = 0;
    const accessor = { ...reply };
    Object.defineProperty(accessor, 'activeVoices', { get() { reads++; return 0; } });
    opm.node.port.onmessage({ data: accessor });
    assert.equal(reads, 0);
    opm.node.port.onmessage({ data: reply });
    assert.deepEqual(await request, reply);
    const failed = assert.rejects(opm.getDiagnostics(), /processor failed/);
    const brokenNode = opm.node;
    brokenNode.onprocessorerror();
    await failed;
    assert.equal(brokenNode.portClosed, 1);
    assert.ok(events.some(event => event.type === 'error' && /processor failed/.test(event.error.message)));
    assert.throws(() => opm.playNote({ note: 60 }), /processor failed/);
    await assert.rejects(opm.getDiagnostics(), /processor failed/);
    await opm.start();
    const suspended = assert.rejects(opm.getDiagnostics(), /not running/);
    await opm.context.suspend();
    await suspended;
    await assert.rejects(opm.getDiagnostics(), /resume/);
    await opm.resume();
    const hostClosed = assert.rejects(opm.getDiagnostics(), /AudioContext is closed/);
    const oldContext = opm.context;
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
    opm._nextRequestId = Number.MAX_SAFE_INTEGER;
    const last = opm.getDiagnostics();
    const rejection = assert.rejects(last, /closed/);
    await assert.rejects(opm.getDiagnostics(), /ID space exhausted/);
    await opm.close();
    await rejection;
  } finally {
    audio.restore();
  }
});
