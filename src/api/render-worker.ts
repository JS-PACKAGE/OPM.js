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
export type WorkerRenderPhase = 'initializing' | 'rendering' | 'writing' | 'closing' | 'completed' | 'cancelled' | 'failed';
export interface WorkerRenderPhaseStatus {
  readonly phase: WorkerRenderPhase;
  /** Host-local monotonic wall time, not a DSP benchmark or network trace. */
  readonly elapsedMs: number;
  readonly phaseElapsedMs: number;
  readonly frames: number;
  readonly totalFrames: number;
  readonly bytesWritten: number;
  readonly errors: number;
}
export interface WorkerRenderPhaseDiagnostics {
  readonly status: 'completed' | 'cancelled' | 'failed';
  readonly initializingMs: number;
  readonly renderingMs: number;
  readonly writingMs: number;
  readonly closingMs: number;
  readonly totalMs: number;
}
export interface WorkerRenderOptions extends ChunkedSequenceOptions {
  format?: WavFormat;
  sink: WavSink;
  onProgress?: (progress: WorkerRenderProgress) => void;
  /** Optional module-ready deadline only; integer milliseconds in 1..2147483647. */
  startupTimeoutMs?: number;
  /** Retain four bounded host-local phase totals in the successful result. */
  phaseDiagnostics?: boolean;
  /** Synchronous observer. Throwing fails the render and invalidates the sink. */
  onPhase?: (status: WorkerRenderPhaseStatus) => void;
  /** Reviewed same-origin secure HTTP(S) static module, never a blob/data URL. */
  workerUrl?: string | URL;
}
export interface WorkerRenderResult {
  readonly capacity: SequenceCapacity;
  readonly format: WavFormat;
  readonly bytesWritten: number;
  readonly diagnostics: Readonly<{ errors: number; processedEvents: number; renderedFrames: number; phases?: WorkerRenderPhaseDiagnostics }>;
}
/** @internal Static worker protocol: ready before start, one unacknowledged byte chunk. */
export type RenderWorkerRequest = { type: 'start'; events: readonly SequenceEvent[]; options: ChunkedSequenceOptions; format: WavFormat } | { type: 'ack'; index: number };
/** @internal */
export type RenderWorkerResponse = { type: 'ready'; protocol: 1 }
  | { type: 'chunk'; index: number; bytes: Uint8Array; frames: number; errors: number; processedEvents: number }
  | { type: 'done'; frames: number; errors: number; processedEvents: number }
  | { type: 'error'; name: string; message: string };

const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;

/** Browser-only, backpressured offline rendering; importing this module allocates nothing. */
export async function renderSequenceInWorker(events: readonly SequenceEvent[], options: WorkerRenderOptions): Promise<WorkerRenderResult> {
  const data = sequenceOwnData(options, ['voices', 'sampleRate', 'maxVoices', 'mixGain', 'tuning', 'stealing', 'quality', 'chunkFrames', 'maxFrames', 'signal', 'format', 'sink', 'onProgress', 'startupTimeoutMs', 'phaseDiagnostics', 'onPhase', 'workerUrl'], ['sink'], 'worker render options');
  const sink = sequenceOwnData(data.sink, ['write', 'close', 'abort'], ['write'], 'WAV sink');
  for (const key of ['write', 'close', 'abort']) if (sink[key] !== undefined && typeof sink[key] !== 'function') throw new TypeError(`sink.${key} must be a function`);
  if (typeof sink.write !== 'function') throw new TypeError('sink.write must be a function');
  if (data.onProgress !== undefined && typeof data.onProgress !== 'function') throw new TypeError('onProgress must be a function');
  const onProgress = data.onProgress as WorkerRenderOptions['onProgress'];
  if (data.onPhase !== undefined && typeof data.onPhase !== 'function') throw new TypeError('onPhase must be a function');
  if (data.phaseDiagnostics !== undefined && typeof data.phaseDiagnostics !== 'boolean') throw new TypeError('phaseDiagnostics must be a boolean');
  if (data.startupTimeoutMs !== undefined && (typeof data.startupTimeoutMs !== 'number' || !Number.isInteger(data.startupTimeoutMs) || data.startupTimeoutMs < 1 || data.startupTimeoutMs > 2147483647)) throw new RangeError('startupTimeoutMs must be an integer in 1..2147483647');
  const onPhase = data.onPhase as WorkerRenderOptions['onPhase'];
  const timed = data.phaseDiagnostics === true || onPhase !== undefined;
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
  for (const key of ['sampleRate', 'maxVoices', 'chunkFrames', 'maxFrames'] as const) if (data[key] !== undefined) Object.defineProperty(coreOptions, key, { value: data[key], enumerable: true });
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
    let worker: Worker | undefined;
    let settled = false;
    let dispatching = false;
    let externalActive = false;
    let state: 'ready' | 'rendering' | 'writing' | 'closing' = 'ready';
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let nextIndex = 0;
    let frames = 0;
    let bytesWritten = 0;
    let errors = 0;
    let processedEvents = 0;
    let phase: WorkerRenderPhase = 'initializing';
    const startedAt = timed ? performance.now() : 0;
    let phaseAt = startedAt;
    const totals = { initializing: 0, rendering: 0, writing: 0, closing: 0 };
    const external = <T>(callback: () => T): T => {
      externalActive = true;
      try { return callback(); } finally { externalActive = false; }
    };
    const setPhase = (next: WorkerRenderPhase) => {
      if (!timed) return;
      const now = performance.now();
      const duration = Math.max(0, now - phaseAt);
      if (phase === 'initializing' || phase === 'rendering' || phase === 'writing' || phase === 'closing') totals[phase] += duration;
      phase = next;
      phaseAt = now;
      if (onPhase) external(() => onPhase(Object.freeze({ phase, elapsedMs: Math.max(0, now - startedAt), phaseElapsedMs: duration, frames, totalFrames: capacity.frames, bytesWritten, errors })));
    };
    const cleanup = () => {
      clearTimeout(startupTimer);
      startupTimer = undefined;
      worker?.removeEventListener('message', onMessage);
      worker?.removeEventListener('error', onError);
      worker?.removeEventListener('messageerror', onMessageError);
      if (signal !== undefined) EventTarget.prototype.removeEventListener.call(signal, 'abort', onAbort);
      worker?.terminate();
    };
    const fail = (reason: unknown, cancelled = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      // The sink owns rollback. Never await an uncooperative write, close or abort.
      try { Promise.resolve(external(() => (sink.abort as WavSink['abort'])?.call(data.sink, reason))).catch(() => {}); } catch { /* Preserve the first failure. */ }
      try { setPhase(cancelled ? 'cancelled' : 'failed'); } catch { /* Preserve the first failure even if its observer throws. */ }
      reject(reason);
    };
    const onAbort = () => { fail(new DOMException('Sequence render aborted', 'AbortError'), true); };
    const onError = (event: ErrorEvent) => { event.preventDefault(); fail(new Error(event.message || 'Render Worker failed')); };
    const onMessageError = () => { fail(new Error('Render Worker message could not be deserialized')); };
    const acknowledge = () => {
      state = 'rendering';
      // Time until the next chunk arrives is Worker compute, not sink time.
      setPhase('rendering');
      if (settled) return;
      worker!.postMessage({ type: 'ack', index: nextIndex++ } satisfies RenderWorkerRequest);
    };
    const writeChunk = async (reply: Record<string, unknown>, chunkBytes: number) => {
      await external(() => (sink.write as WavSink['write']).call(data.sink, reply.bytes as Uint8Array));
      if (settled) return;
      bytesWritten += chunkBytes;
      frames = reply.frames as number; errors = reply.errors as number; processedEvents = reply.processedEvents as number;
      if (onProgress) external(() => onProgress(Object.freeze({ frames, totalFrames: capacity.frames, bytesWritten, errors })));
      if (!settled) acknowledge();
    };
    const closeSink = async () => {
      await external(() => (sink.close as WavSink['close'])?.call(data.sink));
      if (settled) return;
      setPhase('completed');
      if (settled) return;
      const diagnostics: { errors: number; processedEvents: number; renderedFrames: number; phases?: WorkerRenderPhaseDiagnostics } = { errors, processedEvents, renderedFrames: capacity.frames };
      if (data.phaseDiagnostics === true) diagnostics.phases = Object.freeze({ status: 'completed', initializingMs: totals.initializing, renderingMs: totals.rendering, writingMs: totals.writing, closingMs: totals.closing, totalMs: Math.max(0, phaseAt - startedAt) });
      settled = true;
      cleanup();
      resolve(Object.freeze({ capacity, format, bytesWritten, diagnostics: Object.freeze(diagnostics) }));
    };
    const onMessage = (event: MessageEvent<RenderWorkerResponse>) => {
      if (settled) return;
      if (dispatching || externalActive) { fail(new Error('Render Worker sent a reentrant message')); return; }
      dispatching = true;
      try {
        const input: unknown = event.data;
        const type = input !== null && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'type')?.value : undefined;
        if (type === 'error') {
          const reply = sequenceOwnData(input, ['type', 'name', 'message'], ['type', 'name', 'message'], 'worker error');
          if (typeof reply.name !== 'string' || typeof reply.message !== 'string') throw new Error('Invalid worker error');
          const error = new Error(reply.message); error.name = reply.name; throw error;
        }
        if (type === 'ready') {
          const reply = sequenceOwnData(input, ['type', 'protocol'], ['type', 'protocol'], 'worker ready');
          if (state !== 'ready' || reply.protocol !== 1) throw new Error('Unexpected Render Worker ready');
          clearTimeout(startupTimer);
          startupTimer = undefined;
          state = 'rendering';
          // Startup ends here, before score preparation or any synthesis in the Worker.
          setPhase('rendering');
          if (!settled) worker!.postMessage({ type: 'start', events: score, options: coreOptions, format } satisfies RenderWorkerRequest);
          return;
        }
        if (state !== 'rendering') throw new Error('Render Worker violated readiness or backpressure');
        const reply = sequenceOwnData(input, type === 'chunk' ? ['type', 'index', 'bytes', 'frames', 'errors', 'processedEvents'] : ['type', 'frames', 'errors', 'processedEvents'], type === 'chunk' ? ['type', 'index', 'bytes', 'frames', 'errors', 'processedEvents'] : ['type', 'frames', 'errors', 'processedEvents'], 'worker response');
        if (type !== 'chunk' && type !== 'done') throw new Error('Invalid worker response');
        for (const key of ['frames', 'errors', 'processedEvents']) if (!Number.isSafeInteger(reply[key]) || (reply[key] as number) < 0) throw new Error('Invalid worker progress');
        if ((reply.frames as number) < frames || (reply.frames as number) > capacity.frames || (reply.errors as number) < errors || (reply.processedEvents as number) < processedEvents || (reply.processedEvents as number) > capacity.reservedSlots) throw new Error('Invalid worker progress');
        if (type === 'chunk') {
          if (reply.index !== nextIndex || !(reply.bytes instanceof Uint8Array)) throw new Error('Invalid worker chunk');
          // Capture intrinsic metadata before ownership passes to an arbitrary sink.
          const chunkBytes = typedArrayByteLength.call(reply.bytes) as number;
          const advance = (reply.frames as number) - frames;
          const bytesPerFrame = format === 'pcm16' ? 4 : format === 'pcm24' ? 6 : 8;
          const expectedBytes = nextIndex === 0 ? fileBytes - capacity.frames * bytesPerFrame : advance * bytesPerFrame;
          if (chunkBytes !== expectedBytes || chunkBytes === 0 || bytesWritten + chunkBytes > fileBytes || advance > capacity.chunkFrames || (nextIndex === 0 && reply.frames !== 0)) throw new Error('Invalid worker chunk byte/frame accounting');
          state = 'writing';
          setPhase('writing');
          if (!settled) void writeChunk(reply, chunkBytes).catch(fail);
        } else {
          if (reply.frames !== capacity.frames || bytesWritten !== fileBytes) throw new Error('Render Worker returned incomplete WAV');
          errors = reply.errors as number; processedEvents = reply.processedEvents as number;
          state = 'closing';
          setPhase('closing');
          if (!settled) void closeSink().catch(fail);
        }
      } catch (error) { fail(error); }
      finally { dispatching = false; }
    };
    try { worker = new Worker(url, { type: 'module', name: 'OPM WAV render' }); }
    catch (error) { fail(error); return; }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    if (signal !== undefined) EventTarget.prototype.addEventListener.call(signal, 'abort', onAbort, { once: true });
    if (signal !== undefined && aborted.call(signal)) { onAbort(); return; }
    if (data.startupTimeoutMs !== undefined) startupTimer = setTimeout(() => fail(new DOMException('Render Worker startup timed out before ready', 'TimeoutError')), data.startupTimeoutMs as number);
    try {
      if (onPhase) external(() => onPhase(Object.freeze({ phase: 'initializing', elapsedMs: 0, phaseElapsedMs: 0, frames, totalFrames: capacity.frames, bytesWritten, errors })));
    } catch (error) { fail(error); }
  });
}
