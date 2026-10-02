import { renderSequenceChunks, sequenceOwnData } from '../core/sequence.js';
import type { ChunkedSequenceOptions, ChunkedSequenceRender, SequenceEvent } from '../core/sequence.js';
import { createWavEncoder } from '../core/wav.js';
import type { WavEncoder, WavFormat } from '../core/wav.js';
import type { RenderWorkerRequest, RenderWorkerResponse } from '../api/render-worker.js';

// A structural scope avoids mixing DOM and WebWorker ambient libraries; runtime
// remains a real module Worker, with no main-thread browser objects or code loading.
interface RenderWorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<RenderWorkerRequest>) => void): void;
  postMessage(message: RenderWorkerResponse, transfer?: Transferable[]): void;
  close(): void;
}
const scope = globalThis as unknown as RenderWorkerScope;
let renderer: ChunkedSequenceRender | undefined;
let encoder: WavEncoder | undefined;
let index = 0;
let waiting = false;
let started = false;
let finalized = false;
let failed = false;

function send(bytes: Uint8Array): void {
  waiting = true;
  const diagnostics = renderer!.diagnostics;
  scope.postMessage({ type: 'chunk', index, bytes, frames: diagnostics.renderedFrames, errors: diagnostics.errors, processedEvents: diagnostics.processedEvents }, [bytes.buffer as ArrayBuffer]);
}
scope.addEventListener('message', event => {
  if (failed) return;
  try {
    const input: unknown = event.data;
    const type = input !== null && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'type')?.value : undefined;
    if (type === 'start') {
      if (started) throw new Error('Render Worker already started');
      const data = sequenceOwnData(input, ['type', 'events', 'options', 'format'], ['type', 'events', 'options', 'format'], 'worker start');
      const options = sequenceOwnData(data.options, ['sampleRate', 'mixGain', 'tuning', 'stealing', 'quality', 'chunkFrames', 'maxFrames'], [], 'worker core options');
      renderer = renderSequenceChunks(data.events as readonly SequenceEvent[], options as ChunkedSequenceOptions);
      encoder = createWavEncoder({ sampleRate: renderer.capacity.sampleRate, channels: 2, format: data.format as WavFormat, totalFrames: renderer.capacity.frames });
      started = true;
      send(encoder.header());
      return;
    }
    if (type !== 'ack') throw new Error('Unknown render worker command');
    const data = sequenceOwnData(input, ['type', 'index'], ['type', 'index'], 'worker ack');
    if (!started || !waiting || data.index !== index) throw new Error('Unexpected render worker acknowledgement');
    waiting = false;
    index++;
    if (!finalized) {
      const chunk = renderer!.next();
      if (!chunk.done) { send(encoder!.encode({ left: chunk.value.left, right: chunk.value.right })); return; }
      const padding = encoder!.finalize();
      finalized = true;
      if (padding.byteLength > 0) { send(padding); return; }
    }
    const diagnostics = renderer!.diagnostics;
    scope.postMessage({ type: 'done', frames: diagnostics.renderedFrames, errors: diagnostics.errors, processedEvents: diagnostics.processedEvents });
    renderer!.cancel();
    scope.close();
  } catch (error) {
    failed = true;
    renderer?.cancel();
    scope.postMessage({ type: 'error', name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : 'Render Worker failed' });
    scope.close();
  }
});
