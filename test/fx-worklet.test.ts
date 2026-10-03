import test from 'node:test';
import assert from 'node:assert/strict';
import { createStereoEffects } from '../src/core/fx.js';
import { createEffects } from '../src/api/fx.js';

interface Processor { receive(message: unknown): void; process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean; port: { postMessage(message: unknown): void; close(): void; onmessage: unknown } }
test('effects worklet validates its protocol, bounds floods and runs the same stereo DSP', async () => {
  const keys = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor', 'AudioWorkletNode'];
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  let Constructor: new (options?: AudioWorkletNodeOptions) => Processor;
  const replies: unknown[] = [];
  Object.assign(globalThis, { sampleRate: 16000, currentFrame: 0, AudioWorkletProcessor: class { port = { postMessage: (message: unknown) => replies.push(message), close() {}, onmessage: null }; }, registerProcessor: (name: string, value: typeof Constructor) => { assert.equal(name, 'opm-effects-processor'); Constructor = value; } });
  try {
    // Static import cannot register a processor before the test installs worklet globals.
    const { validateEffectsMessage } = await import('../src/worklet/fx-processor.js');
    for (const message of [{ type: 'reset', params: {} }, { type: 'update' }, { type: 'other' }, { type: 'update', params: { chorus: { rate: 99, depth: 0, mix: 0 } } }, { get type() { throw Error('must not run'); } }]) assert.throws(() => validateEffectsMessage(message));
    const params = { chorus: { rate: 1, depth: .5, mix: .5 }, reverb: { size: .5, damping: .5, mix: .4 } };
    const processor = new Constructor!({ processorOptions: { params } });
    const core = createStereoEffects(16000, params), input = new Float32Array(4096); input[0] = 1;
    const expected = input.slice(), expectedR = input.slice(); core.process(expected, expectedR);
    const actual = new Float32Array(4096), actualR = new Float32Array(4096);
    assert.equal(processor.process([[input, input]], [[actual, actualR]]), true); assert.deepEqual(actual, expected); assert.deepEqual(actualR, expectedR);
    processor.receive({ type: 'reset' }); const again = new Float32Array(4096), againR = new Float32Array(4096); processor.process([[input, input]], [[again, againR]]); assert.deepEqual(again, expected);
    for (let i = 0; i < 1000; i++) processor.receive({ type: 'invalid' }); assert.ok(replies.length <= 33);
    processor.receive({ type: 'close' }); assert.equal(processor.process([], [[actual, actualR]]), false);
    let disposed = false, closeMessages = 0;
    Object.assign(globalThis, { AudioWorkletNode: class {
      port = { onmessage: null, onmessageerror: null, postMessage: (message: { type: string }) => { if (message.type === 'close') closeMessages++; }, close() {} };
      onprocessorerror = null;
      constructor(_context: unknown, name: string, options: AudioWorkletNodeOptions) { assert.equal(name, 'opm-effects-processor'); assert.equal(options.channelCount, 2); assert.deepEqual(options.outputChannelCount, [2]); }
      disconnect() { disposed = true; }
    } });
    let loaded: URL | undefined;
    const context = { sampleRate: 16000, state: 'suspended', audioWorklet: { addModule: async (url: URL) => { loaded = url; } }, close() { assert.fail('borrowed context must not close'); }, resume() { assert.fail('host owns playback'); } } as unknown as BaseAudioContext;
    const fx = await createEffects(context, { params }); await fx.ready; assert.ok(loaded!.pathname.endsWith('/worklet/fx-processor.js')); assert.equal(fx.input, fx.output);
    assert.throws(() => fx.update({ chorus: { rate: 0, depth: 0, mix: 0 } })); fx.reset(); fx.dispose(); fx.dispose(); assert.ok(disposed); assert.equal(closeMessages, 1); assert.throws(() => fx.reset(), /disposed/);
  } finally { keys.forEach((key, index) => { const descriptor = originals[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }); }
});
