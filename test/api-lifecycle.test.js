import test from 'node:test';
import assert from 'node:assert/strict';
import { OPM } from '../src/api/index.js';

function mockAudio({ failModuleAt = 0, failResumeAt = 1 } = {}) {
  const originals = new Map(['AudioContext', 'AudioWorkletNode'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const contexts = [];
  const nodes = [];
  const messages = [];
  globalThis.AudioContext = class {
    constructor() {
      this.index = contexts.length;
      this.destination = {};
      this.currentTime = 7;
      this.closed = 0;
      this.resumed = 0;
      this.audioWorklet = { addModule: async () => {
        if (this.index === failModuleAt) throw Error('module load failed');
      } };
      contexts.push(this);
    }
    async resume() {
      this.resumed++;
      if (this.index === failResumeAt) throw Error('resume failed');
    }
    async close() { this.closed++; }
  };
  globalThis.AudioWorkletNode = class {
    constructor(context) {
      this.context = context;
      this.port = { postMessage: message => messages.push(message) };
      this.connected = 0;
      this.disconnected = 0;
      nodes.push(this);
    }
    connect(destination) {
      assert.equal(destination, this.context.destination);
      this.connected++;
    }
    disconnect() { this.disconnected++; }
  };
  return { contexts, nodes, messages, restore() {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  } };
}

test('failed starts release contexts, retries create fresh resources, and close is idempotent', async () => {
  const audio = mockAudio();
  try {
    const opm = new OPM();
    await assert.rejects(opm.start(), /module load failed/);
    assert.equal(audio.contexts[0].closed, 1);
    assert.equal(opm.context, null);
    assert.equal(opm.node, null);

    await assert.rejects(opm.start(), /resume failed/);
    assert.equal(audio.contexts[1].closed, 1);
    assert.equal(audio.nodes[0].connected, 1);
    assert.equal(opm.context, null);
    assert.equal(opm.node, null);

    await opm.start();
    assert.strictEqual(opm.context, audio.contexts[2]);
    assert.strictEqual(opm.node, audio.nodes[1]);
    assert.equal(audio.nodes[1].connected, 1);
    await opm.start();
    assert.equal(audio.contexts.length, 3);
    await opm.close();
    assert.equal(audio.nodes[1].disconnected, 1);
    assert.equal(audio.contexts[2].closed, 1);
    assert.equal(opm.node, null);
    assert.equal(opm.context, null);
    await opm.close();
    assert.equal(audio.contexts[2].closed, 1);
    assert.throws(() => opm.playNote({ note: 60, duration: 1 }), /start/);
  } finally {
    audio.restore();
  }
});
test('invalid playNote calls leave the event stream and next note ID untouched', async () => {
  const audio = mockAudio({ failModuleAt: -1, failResumeAt: -1 });
  try {
    const opm = new OPM();
    await opm.start();
    const candidates = [
      { voice: 'missing', note: 60, duration: 1 },
      { note: 128, duration: 1 },
      { note: 60.5, duration: 1 },
      { note: 60, time: -0.1, duration: 1 },
      { note: 60, time: 61, duration: 1 },
      { note: 60, duration: 0 },
      { note: 60, duration: 61 },
    ];
    for (const candidate of candidates) assert.throws(() => opm.playNote(candidate));
    assert.deepEqual(audio.messages, []);
    assert.equal(opm.nextId, 1);
    const id = opm.playNote({ note: 60, duration: 1 });
    assert.equal(id, 1);
    assert.equal(audio.messages.length, 1);
    assert.equal(audio.messages[0].at, 7);
    await opm.close();
  } finally {
    audio.restore();
  }
});
