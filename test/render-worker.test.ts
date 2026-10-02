import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { renderSequenceInWorker } from '../src/api/render-worker.js';
import type { RenderWorkerRequest, RenderWorkerResponse, WorkerRenderOptions, WorkerRenderProgress } from '../src/api/render-worker.js';
import { renderSequence } from '../src/core/sequence.js';
import type { SequenceEvent } from '../src/core/sequence.js';
import { encodeWav } from '../src/core/wav.js';

class ThreadWorker extends EventTarget {
  static instances: ThreadWorker[] = [];
  readonly thread: NodeWorker;
  readonly received: RenderWorkerResponse[] = [];
  readonly sent: RenderWorkerRequest[] = [];
  terminated = false;
  constructor(readonly url: URL, options: WorkerOptions) {
    super();
    assert.equal(options.type, 'module');
    this.thread = new NodeWorker(new URL('./render-worker-host.js', import.meta.url));
    ThreadWorker.instances.push(this);
    this.thread.on('message', (data: RenderWorkerResponse) => {
      this.received.push(data);
      this.dispatchEvent(new MessageEvent('message', { data }));
    });
    this.thread.on('error', error => {
      const event = new Event('error', { cancelable: true });
      Object.defineProperty(event, 'message', { value: error.message });
      this.dispatchEvent(event);
    });
  }
  postMessage(message: RenderWorkerRequest): void { this.sent.push(message); this.thread.postMessage(message); }
  terminate(): void { this.terminated = true; void this.thread.terminate(); }
}

const score: SequenceEvent[] = [{ type: 'note', id: 1, time: 0, duration: 0.003, note: 60 }];
const config = { sampleRate: 8000, chunkFrames: 31, workerUrl: '/worker/render.js' };

test('static render pipeline, real worker backpressure and cancellation boundaries', async t => {
  const originals = new Map(['Worker', 'location', 'isSecureContext'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperties(globalThis, {
    Worker: { configurable: true, value: ThreadWorker },
    location: { configurable: true, value: { href: 'https://example.test/app/' } },
    isSecureContext: { configurable: true, value: true },
  });
  try {
    await t.test('all formats write complete chunk-independent audio and close once', async () => {
      for (const format of ['pcm16', 'pcm24', 'float32'] as const) {
        const parts: Uint8Array[] = [];
        const progress: WorkerRenderProgress[] = [];
        let closed = 0;
        const result = await renderSequenceInWorker(score, { ...config, format, sink: { write(bytes) { parts.push(bytes); }, close() { closed++; }, abort() { assert.fail('successful render aborted'); } }, onProgress(value) { progress.push(value); } });
        const bytes = new Uint8Array(result.bytesWritten);
        let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
        const rendered = renderSequence(score, { sampleRate: 8000 });
        assert.deepEqual(bytes, encodeWav({ left: rendered.left, right: rendered.right, sampleRate: 8000, format }));
        assert.equal(closed, 1);
        assert.equal(result.diagnostics.renderedFrames, result.capacity.frames);
        assert.equal(progress.at(-1)!.frames, result.capacity.frames);
        assert.equal(progress.at(-1)!.bytesWritten, result.bytesWritten);
        assert.equal(result.diagnostics.errors, 0);
        assert.ok(ThreadWorker.instances.at(-1)!.terminated);
        for (let i = 1; i < progress.length; i++) {
          assert.ok(progress[i].frames >= progress[i - 1].frames);
          assert.ok(progress[i].frames - progress[i - 1].frames <= 31);
        }
      }
    });
    await t.test('sink owns transferred buffers without losing progress or final WAV bytes', async () => {
      const parts: Uint8Array[] = [];
      const progress: WorkerRenderProgress[] = [];
      let closed = 0;
      let aborts = 0;
      let metadataReads = 0;
      const result = await renderSequenceInWorker(score, { ...config, format: 'pcm24', sink: {
        async write(bytes) {
          Object.defineProperty(bytes, 'byteLength', { get() { metadataReads++; return 0; } });
          const owned = structuredClone(bytes, { transfer: [bytes.buffer] });
          assert.equal(bytes.buffer.byteLength, 0);
          parts.push(owned);
          await delay(0);
        },
        close() { closed++; },
        abort() { aborts++; },
      }, onProgress(value) { progress.push(value); } });
      const rendered = renderSequence(score, { sampleRate: 8000 });
      const expected = encodeWav({ left: rendered.left, right: rendered.right, sampleRate: 8000, format: 'pcm24' });
      const received = new Uint8Array(expected.byteLength);
      let offset = 0;
      for (const part of parts) { received.set(part, offset); offset += part.byteLength; }
      assert.deepEqual(received, expected);
      assert.equal(result.bytesWritten, expected.byteLength);
      let cumulative = 0;
      for (let index = 0; index < parts.length; index++) {
        cumulative += parts[index].byteLength;
        assert.equal(progress[index].bytesWritten, cumulative);
      }
      assert.equal(progress.at(-1)!.frames, result.capacity.frames);
      assert.equal(closed, 1);
      assert.equal(aborts, 0);
      assert.equal(metadataReads, 0);
      assert.ok(ThreadWorker.instances.at(-1)!.terminated);
    });
    await t.test('sink backpressure prevents the next render until write resolves', async () => {
      let release!: () => void;
      let entered!: () => void;
      const ready = new Promise<void>(resolve => { entered = resolve; });
      const blocked = new Promise<void>(resolve => { release = resolve; });
      let writes = 0;
      const completion = renderSequenceInWorker(score, { ...config, sink: { write() { writes++; if (writes === 1) { entered(); return blocked; } } } });
      await ready;
      const worker = ThreadWorker.instances.at(-1)!;
      await delay(40);
      const chunks = worker.received.filter(message => message.type !== 'ready');
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].type, 'chunk');
      assert.equal(chunks[0].type === 'chunk' && chunks[0].frames, 0);
      assert.equal(worker.sent.length, 1);
      release();
      await completion;
      assert.ok(writes > 1);
    });
    await t.test('abort terminates while write is pending and does not wait for write/abort', async () => {
      const controller = new AbortController();
      let entered!: () => void;
      const ready = new Promise<void>(resolve => { entered = resolve; });
      let rejectWrite!: (error: Error) => void;
      const pending = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
      let aborts = 0;
      let closed = 0;
      const completion = renderSequenceInWorker(score, { ...config, signal: controller.signal, sink: {
        write() { entered(); return pending; },
        close() { closed++; },
        abort(reason) { aborts++; assert.equal((reason as Error).name, 'AbortError'); return new Promise<void>(() => {}); },
      } });
      const rejected = assert.rejects(completion, { name: 'AbortError' });
      await ready;
      controller.abort();
      await rejected;
      const worker = ThreadWorker.instances.at(-1)!;
      assert.ok(worker.terminated);
      assert.equal(worker.sent.length, 1);
      assert.equal(aborts, 1);
      assert.equal(closed, 0);
      rejectWrite(new Error('late write rejection'));
      await delay(0);
      assert.equal(aborts, 1);
    });
    await t.test('sink and worker failures abort once and never close', async () => {
      let aborts = 0;
      const failure = new Error('disk full');
      await assert.rejects(renderSequenceInWorker(score, { ...config, sink: { write() { throw failure; }, close() { assert.fail('closed failed sink'); }, abort(reason) { assert.equal(reason, failure); aborts++; } } }), error => error === failure);
      assert.equal(aborts, 1);
      assert.ok(ThreadWorker.instances.at(-1)!.terminated);
      let entered!: () => void;
      const ready = new Promise<void>(resolve => { entered = resolve; });
      const completion = renderSequenceInWorker(score, { ...config, sink: { write() { entered(); return new Promise<void>(() => {}); }, abort() { aborts++; } } });
      const rejected = assert.rejects(completion, /deserialized/);
      await ready;
      ThreadWorker.instances.at(-1)!.dispatchEvent(new Event('messageerror'));
      await rejected;
      assert.equal(aborts, 2);
      assert.ok(ThreadWorker.instances.at(-1)!.terminated);
    });
    await t.test('validation and pre-abort precede worker allocation without reading getters', async () => {
      const before = ThreadWorker.instances.length;
      const sink = { write() {} };
      for (const workerUrl of ['blob:https://example.test/id', 'data:text/javascript,1', 'https://other.test/a.js', '/worker.js#fragment', 'https://u:p@example.test/a.js']) {
        await assert.rejects(renderSequenceInWorker(score, { ...config, sink, workerUrl }), /same-origin/);
      }
      await assert.rejects(renderSequenceInWorker([{ ...score[0], note: NaN } as SequenceEvent], { ...config, sink }));
      await assert.rejects(renderSequenceInWorker(score, { ...config, sink, format: 'invalid' as WorkerRenderOptions['format'] }), /format/);
      let reads = 0;
      await assert.rejects(renderSequenceInWorker(score, { ...config, sink, get chunkFrames() { reads++; return 31; } }), /data/);
      const controller = new AbortController(); controller.abort();
      await assert.rejects(renderSequenceInWorker(score, { ...config, sink, signal: controller.signal }), { name: 'AbortError' });
      assert.equal(reads, 0);
      assert.equal(ThreadWorker.instances.length, before);
    });
    await t.test('progress cancellation prevents acknowledgement after an accepted write', async () => {
      const controller = new AbortController();
      let aborts = 0;
      await assert.rejects(renderSequenceInWorker(score, { ...config, signal: controller.signal, sink: { write() {}, abort() { aborts++; } }, onProgress() { controller.abort(); } }), { name: 'AbortError' });
      assert.equal(ThreadWorker.instances.at(-1)!.sent.length, 1);
      assert.equal(aborts, 1);
    });
    await t.test('phase diagnostics follow real startup, rendering, writing and closing without changing PCM', async () => {
      const phases: string[] = [];
      const parts: Uint8Array[] = [];
      const result = await renderSequenceInWorker(score, { ...config, phaseDiagnostics: true, onPhase: status => phases.push(status.phase),
        sink: { write(bytes) { parts.push(bytes); } } });
      assert.equal(phases[0], 'initializing');
      assert.deepEqual([...new Set(phases)], ['initializing', 'rendering', 'writing', 'closing', 'completed']);
      const diagnostics = result.diagnostics.phases!;
      assert.equal(diagnostics.status, 'completed');
      for (const value of [diagnostics.initializingMs, diagnostics.renderingMs, diagnostics.writingMs, diagnostics.closingMs, diagnostics.totalMs]) assert.ok(Number.isFinite(value) && value >= 0);
      assert.ok(diagnostics.totalMs + 1 >= diagnostics.initializingMs + diagnostics.renderingMs + diagnostics.writingMs + diagnostics.closingMs);
      const plain = await renderSequenceInWorker(score, { ...config, sink: { write() {} } });
      assert.equal(plain.diagnostics.phases, undefined);
      assert.equal(result.bytesWritten, plain.bytesWritten);
    });
    await t.test('startup deadline rejects a worker that never becomes ready, but not slow legitimate writes', async () => {
      const slow = await renderSequenceInWorker(score, { ...config, startupTimeoutMs: 1000, sink: { async write() { await delay(30); } } });
      assert.ok(slow.bytesWritten > 0, 'the startup watchdog ends at ready and never times the sink');
      class Stalled extends EventTarget {
        static last: Stalled | undefined;
        terminated = false;
        posted = 0;
        constructor() { super(); Stalled.last = this; }
        postMessage() { this.posted++; }
        terminate() { this.terminated = true; }
      }
      const real = Object.getOwnPropertyDescriptor(globalThis, 'Worker')!;
      Object.defineProperty(globalThis, 'Worker', { configurable: true, value: Stalled });
      try {
        let aborts = 0;
        await assert.rejects(renderSequenceInWorker(score, { ...config, startupTimeoutMs: 20, sink: { write() { assert.fail('no chunk exists'); }, abort() { aborts++; } } }), { name: 'TimeoutError' });
        assert.equal(aborts, 1);
        assert.equal(Stalled.last!.terminated, true);
        assert.equal(Stalled.last!.posted, 0, 'no score is sent before a valid ready');
        for (const bad of [2, undefined]) {
          let sinkAborts = 0;
          const pending = renderSequenceInWorker(score, { ...config, sink: { write() {}, abort() { sinkAborts++; } } });
          Stalled.last!.dispatchEvent(new MessageEvent('message', { data: { type: 'ready', protocol: bad } }));
          await assert.rejects(pending, /ready|Invalid|unknown|missing/i);
          assert.equal(sinkAborts, 1);
          assert.equal(Stalled.last!.posted, 0);
        }
        let early = 0;
        const eager = renderSequenceInWorker(score, { ...config, sink: { write() { early++; } } });
        Stalled.last!.dispatchEvent(new MessageEvent('message', { data: { type: 'chunk', index: 0, bytes: new Uint8Array(44), frames: 0, errors: 0, processedEvents: 0 } }));
        await assert.rejects(eager, /readiness|backpressure/);
        assert.equal(early, 0);
        for (const value of [0, 1.5, 2147483648, '5']) await assert.rejects(renderSequenceInWorker(score, { ...config, startupTimeoutMs: value as number, sink: { write() {} } }), RangeError);
      } finally { Object.defineProperty(globalThis, 'Worker', real); }
    });
    await t.test('a throwing phase observer fails once, aborts the sink and terminates the worker', async () => {
      let aborts = 0;
      await assert.rejects(renderSequenceInWorker(score, { ...config, onPhase(status) { if (status.phase === 'writing') throw new Error('observer failed'); }, sink: { write() {}, abort() { aborts++; } } }), /observer failed/);
      assert.equal(aborts, 1);
      assert.ok(ThreadWorker.instances.at(-1)!.terminated);
    });
  } finally {
    for (const worker of ThreadWorker.instances) if (!worker.terminated) worker.terminate();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
