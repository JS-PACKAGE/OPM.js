import { parentPort } from 'node:worker_threads';
import type { RenderWorkerRequest, RenderWorkerResponse } from '../src/api/render-worker.js';

// Run the production module Worker inside a genuine isolated Node thread for
// protocol/backpressure tests. Browser loading and CSP are separately smoke-tested.
let listener: ((event: MessageEvent<RenderWorkerRequest>) => void) | undefined;
Object.defineProperties(globalThis, {
  addEventListener: { value: (_type: string, callback: typeof listener) => { listener = callback; } },
  postMessage: { value: (message: RenderWorkerResponse, transfer: ArrayBuffer[] = []) => { parentPort!.postMessage(message, transfer); } },
  close: { value: () => { parentPort!.close(); } },
});
// Module-loading boundary test: static imports would execute the worker before
// the isolated thread's browser scope adapter has been installed.
await import('../src/worker/render.js');
parentPort!.on('message', (data: RenderWorkerRequest) => { listener!(new MessageEvent('message', { data })); });
