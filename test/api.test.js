import assert from 'node:assert/strict';
import test from 'node:test';
import { OPM } from '../src/api/index.js';
import { brass } from '../src/voices/brass.js';

test('start loads the worklet and playNote schedules a note in context time', async () => {
  const messages = [];
  const urls = [];
  const oldContext = globalThis.AudioContext;
  const oldNode = globalThis.AudioWorkletNode;
  globalThis.AudioContext = class {
    constructor(options) {
      assert.equal(options.sampleRate, 44100);
      this.currentTime = 12;
      this.audioWorklet = { addModule: async url => urls.push(url) };
      this.destination = {};
    }
    async resume() {}
    async close() {}
  };
  globalThis.AudioWorkletNode = class {
    constructor(context, name, options) {
      assert.equal(name, 'opm-processor');
      assert.deepEqual(options.outputChannelCount, [2]);
      this.port = { postMessage: message => messages.push(message) };
    }
    connect() {}
    disconnect() {}
  };
  try {
    const opm = new OPM({ sampleRate: 44100 });
    await opm.start();
    assert.equal(urls.length, 1);
    const id = opm.playNote({ voice: 'brass', note: 60, time: 0.2, duration: 0.5 });
    assert.equal(messages[0].at, 12.2);
    assert.equal(messages[0].duration, 0.5);
    assert.equal(messages[0].id, id);
    opm.stop(id);
    assert.deepEqual(messages[1], { type: 'noteOff', id });
    opm.loadVoice('custom', brass);
    assert.equal(opm.playNote({ voice: 'custom', note: 61, duration: 0.2 }), id + 1);
    await opm.close();
  } finally {
    globalThis.AudioContext = oldContext;
    globalThis.AudioWorkletNode = oldNode;
  }
});

test('invalid note parameters do not post messages', async () => {
  const opm = new OPM();
  assert.throws(() => opm.playNote({ note: 60, duration: 1 }), /start/);
  assert.throws(() => opm.loadVoice('__proto__', { ops: [] }));
  assert.throws(() => new OPM({ sampleRate: 0 }), /sampleRate/);
});
