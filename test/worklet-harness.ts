import { OPM } from '../src/api/index.js';
import type { OPMOptions } from '../src/api/index.js';

interface Port { postMessage(message: unknown): void; close(): void; onmessage?: ((event: { data: unknown }) => void) | null }
interface ProcessorInstance {
  port: Port;
  receive(message: unknown): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
export const sampleRate = 16000;
let Processor: new (options?: AudioWorkletNodeOptions) => ProcessorInstance;
export class Context extends EventTarget {
  currentTime = 0;
  sampleRate = sampleRate;
  frame = 0;
  state = 'suspended';
  destination = {};
  audioWorklet = { addModule: async () => {} };
  async resume() { this.state = 'running'; this.dispatchEvent(new Event('statechange')); }
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

/** Install the real processor behind a synchronous in-process AudioWorklet. Await once per test file. */
export async function installWorkletHarness(): Promise<() => void> {
  Object.assign(globalThis, {
    sampleRate, currentFrame: 0,
    AudioWorkletProcessor: class { port: Partial<Port> = {}; },
    registerProcessor: (_name: string, constructor: unknown) => { Processor = constructor as typeof Processor; },
  });
  const restore = () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  try {
    // The worklet module registers itself against the globals installed above.
    await import('../src/worklet/processor.js');
    Object.assign(globalThis, { AudioContext: Context, AudioWorkletNode: Node });
  } catch (error) { restore(); throw error; }
  return restore;
}
export async function startedEngine(options: OPMOptions = {}): Promise<OPM> {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM({ sampleRate, ...options });
  await opm.start();
  return opm;
}
/** Render whole 128-frame quanta and advance the fake audio clock. */
export function renderFrames(opm: OPM, frames: number): void {
  const context = opm.context as unknown as Context;
  const node = opm.node as unknown as Node;
  const end = context.frame + frames;
  while (context.frame < end) {
    Object.assign(globalThis, { currentFrame: context.frame });
    node.processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    context.frame += 128;
    context.currentTime = context.frame / sampleRate;
  }
  Object.assign(globalThis, { currentFrame: context.frame });
}
