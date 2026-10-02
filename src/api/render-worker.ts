import { estimateSequenceCapacity, prepareLongSequence, sequenceOwnData } from '../core/sequence.js';
import type { ChunkedSequenceOptions, SequenceCapacity, SequenceEvent } from '../core/sequence.js';
import { readSynthOptions } from '../core/synth.js';
import type { SynthOptions } from '../core/synth.js';
import { normalizeTuning } from '../core/tuning.js';
import { createWavEncoder } from '../core/wav.js';
import type { WavFormat } from '../core/wav.js';

export interface WavSink {
  /** Takes ownership of bytes; transferring/detaching their buffer is supported. */
  write(bytes: Uint8Array): Promise<void> | void;
  close?(): Promise<void> | void;
  /** Must invalidate outstanding writes. Called once on failure, without waiting for them. */
  abort?(reason: unknown): Promise<void> | void;
}
export interface WorkerRenderProgress { readonly frames: number; readonly totalFrames: number; readonly bytesWritten: number; readonly errors: number }
export interface WorkerRenderOptions extends ChunkedSequenceOptions {
  format?: WavFormat;
  sink: WavSink;
  onProgress?: (progress: WorkerRenderProgress) => void;
  /** Reviewed same-origin secure HTTP(S) static module, never a blob/data URL. */
  workerUrl?: string | URL;
}
export interface WorkerRenderResult {
  readonly capacity: SequenceCapacity;
  readonly format: WavFormat;
  readonly bytesWritten: number;
  readonly diagnostics: Readonly<{ errors: number; processedEvents: number; renderedFrames: number }>;
}
/** @internal Static worker protocol: at most one unacknowledged byte chunk. */
export type RenderWorkerRequest = { type: 'start'; events: readonly SequenceEvent[]; options: ChunkedSequenceOptions; format: WavFormat } | { type: 'ack'; index: number };
/** @internal */
export type RenderWorkerResponse = { type: 'chunk'; index: number; bytes: Uint8Array; frames: number; errors: number; processedEvents: number }
  | { type: 'done'; frames: number; errors: number; processedEvents: number }
  | { type: 'error'; name: string; message: string };

const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;

/** Browser-only, backpressured offline rendering; importing this module allocates nothing. */
export async function renderSequenceInWorker(events: readonly SequenceEvent[], options: WorkerRenderOptions): Promise<WorkerRenderResult> {
  const data = sequenceOwnData(options, ['voices', 'sampleRate', 'mixGain', 'tuning', 'stealing', 'quality', 'chunkFrames', 'maxFrames', 'signal', 'format', 'sink', 'onProgress', 'workerUrl'], ['sink'], 'worker render options');
  const sink = sequenceOwnData(data.sink, ['write', 'close', 'abort'], ['write'], 'WAV sink');
  for (const key of ['write', 'close', 'abort']) if (sink[key] !== undefined && typeof sink[key] !== 'function') throw new TypeError(`sink.${key} must be a function`);
  if (typeof sink.write !== 'function') throw new TypeError('sink.write must be a function');
  if (data.onProgress !== undefined && typeof data.onProgress !== 'function') throw new TypeError('onProgress must be a function');
  const onProgress = data.onProgress as WorkerRenderOptions['onProgress'];
  const signal = data.signal as AbortSignal | undefined;
  const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
  if (signal !== undefined) {
    try { aborted.call(signal); } catch { throw new TypeError('signal must be an AbortSignal'); }
  }
  const engine: SynthOptions = {};
  for (const key of ['mixGain', 'tuning', 'stealing', 'quality'] as const) if (data[key] !== undefined) Object.defineProperty(engine, key, { value: data[key], enumerable: true });
  const settings = readSynthOptions(engine);
  if (settings.tuning !== undefined) settings.tuning = normalizeTuning(settings.tuning);
  const coreOptions: ChunkedSequenceOptions = { ...settings };
  for (const key of ['sampleRate', 'chunkFrames', 'maxFrames'] as const) if (data[key] !== undefined) Object.defineProperty(coreOptions, key, { value: data[key], enumerable: true });
  const snapshot = prepareLongSequence(events, { voices: data.voices as ChunkedSequenceOptions['voices'] });
  const score = snapshot.events as unknown as readonly SequenceEvent[];
  const capacity = estimateSequenceCapacity(score, coreOptions);
  const format = (data.format === undefined ? 'pcm16' : data.format) as WavFormat;
  const fileBytes = createWavEncoder({ sampleRate: capacity.sampleRate, channels: 2, format, totalFrames: capacity.frames }).byteLength;
  const page = typeof globalThis.location === 'object' ? new URL(globalThis.location.href) : null;
  if (!page || typeof Worker !== 'function') throw new Error('renderSequenceInWorker requires a browser with module Worker support');
  const loopback = page.hostname === 'localhost' || page.hostname.endsWith('.localhost') || page.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(page.hostname);
  if (globalThis.isSecureContext === false || (page.protocol !== 'https:' && !(page.protocol === 'http:' && loopback))) throw new Error('Render Worker requires HTTPS or secure loopback HTTP');
  const input = data.workerUrl;
  if (input !== undefined && typeof input !== 'string' && !(input instanceof URL)) throw new TypeError('workerUrl must be a string or URL');
  const href = input instanceof URL ? Object.getOwnPropertyDescriptor(URL.prototype, 'href')!.get!.call(input) as string : input as string | undefined;
  const url = href === undefined ? new URL('../worker/render.js', import.meta.url) : new URL(href, page.href);
  if (url.origin !== page.origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('workerUrl must be a same-origin HTTP(S) module without credentials or a fragment');
  if (signal !== undefined && aborted.call(signal)) throw new DOMException('Sequence render aborted', 'AbortError');

  return new Promise<WorkerRenderResult>((resolve, reject) => {
    let worker: Worker;
    let settled = false;
    let busy = false;
    let nextIndex = 0;
    let frames = 0;
    let bytesWritten = 0;
    let errors = 0;
    let processedEvents = 0;
    const cleanup = () => {
      worker?.removeEventListener('message', onMessage);
      worker?.removeEventListener('error', onError);
      worker?.removeEventListener('messageerror', onMessageError);
      if (signal !== undefined) EventTarget.prototype.removeEventListener.call(signal, 'abort', onAbort);
      worker?.terminate();
    };
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Do not let an uncooperative write/abort keep cancellation pending forever.
      // The host sink owns rollback and must invalidate any in-flight write.
      try { Promise.resolve((sink.abort as WavSink['abort'])?.call(data.sink, reason)).catch(() => {}); } catch { /* Preserve the original failure. */ }
      reject(reason);
    };
    const onAbort = () => { fail(new DOMException('Sequence render aborted', 'AbortError')); };
    const onError = (event: ErrorEvent) => { event.preventDefault(); fail(new Error(event.message || 'Render Worker failed')); };
    const onMessageError = () => { fail(new Error('Render Worker message could not be deserialized')); };
    const onMessage = (event: MessageEvent<RenderWorkerResponse>) => {
      if (settled) return;
      if (busy) { fail(new Error('Render Worker violated backpressure')); return; }
      busy = true;
      void (async () => {
        const input: unknown = event.data;
        const type = input !== null && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'type')?.value : undefined;
        if (type === 'error') {
          const reply = sequenceOwnData(input, ['type', 'name', 'message'], ['type', 'name', 'message'], 'worker error');
          if (typeof reply.name !== 'string' || typeof reply.message !== 'string') throw new Error('Invalid worker error');
          const error = new Error(reply.message); error.name = reply.name; throw error;
        }
        const reply = sequenceOwnData(input, type === 'chunk' ? ['type', 'index', 'bytes', 'frames', 'errors', 'processedEvents'] : ['type', 'frames', 'errors', 'processedEvents'], ['type', 'frames', 'errors', 'processedEvents'], 'worker response');
        if (type !== 'chunk' && type !== 'done') throw new Error('Invalid worker response');
        for (const key of ['frames', 'errors', 'processedEvents']) if (!Number.isSafeInteger(reply[key]) || (reply[key] as number) < 0) throw new Error('Invalid worker progress');
        if ((reply.frames as number) < frames || (reply.frames as number) > capacity.frames || (reply.errors as number) < errors || (reply.processedEvents as number) < processedEvents) throw new Error('Invalid worker progress');
        if (type === 'chunk') {
          if (reply.index !== nextIndex || !(reply.bytes instanceof Uint8Array)) throw new Error('Invalid worker chunk');
          // Ownership passes to the sink; it may transfer/detach the buffer while
          // writing. Capture intrinsic size before calling any external code.
          const chunkBytes = typedArrayByteLength.call(reply.bytes) as number;
          if (chunkBytes > Math.max(58, capacity.chunkFrames * 8) || bytesWritten + chunkBytes > fileBytes) throw new Error('Invalid worker chunk');
          if ((reply.frames as number) - frames > capacity.chunkFrames) throw new Error('Invalid worker frame advancement');
          await (sink.write as WavSink['write']).call(data.sink, reply.bytes);
          if (settled) return;
          bytesWritten += chunkBytes;
          frames = reply.frames as number; errors = reply.errors as number; processedEvents = reply.processedEvents as number;
          onProgress?.(Object.freeze({ frames, totalFrames: capacity.frames, bytesWritten, errors }));
          if (settled) return;
          busy = false;
          worker.postMessage({ type: 'ack', index: nextIndex++ } satisfies RenderWorkerRequest);
        } else {
          if (reply.frames !== capacity.frames || bytesWritten !== fileBytes) throw new Error('Render Worker returned incomplete WAV');
          errors = reply.errors as number; processedEvents = reply.processedEvents as number;
          await (sink.close as WavSink['close'])?.call(data.sink);
          if (settled) return;
          settled = true;
          cleanup();
          resolve(Object.freeze({ capacity, format, bytesWritten, diagnostics: Object.freeze({ errors, processedEvents, renderedFrames: capacity.frames }) }));
        }
      })().catch(fail);
    };
    try { worker = new Worker(url, { type: 'module', name: 'OPM WAV render' }); }
    catch (error) { fail(error); return; }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    if (signal !== undefined) EventTarget.prototype.addEventListener.call(signal, 'abort', onAbort, { once: true });
    if (signal !== undefined && aborted.call(signal)) { onAbort(); return; }
    try { worker.postMessage({ type: 'start', events: score, options: coreOptions, format } satisfies RenderWorkerRequest); }
    catch (error) { fail(error); }
  });
}
