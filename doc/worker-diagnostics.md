# Worker render diagnostics, deadlines and rollback

`renderSequenceInWorker` keeps the main thread free while a static module Worker renders a score and streams encoded WAV chunks to a host sink. This guide covers the startup handshake, optional phase diagnostics and how a host should bound time and clean up partial files. Core behavior (one unacknowledged chunk, exact byte accounting, cancellation without waiting for a hung sink) is unchanged; see [host integration](./host-integration.md#worker-wav-output-and-bounded-sinks).

## Startup handshake

The Worker posts `{ type: 'ready', protocol: 1 }` after its module has been fetched, parsed and evaluated. The host sends the score **only after** a valid `ready`. The message is validated as strict own data; a second `ready`, a different protocol number or any chunk before `ready` fails the render, aborts the sink once and terminates the Worker.

`startupTimeoutMs` (optional, integer 1–2,147,483,647) starts when the Worker is constructed and stops at `ready`. If it expires the promise rejects with a `TimeoutError` `DOMException`, the Worker is terminated and `sink.abort()` is called. It never measures rendering, sink writes or `close()`, so a slow disk or a long score cannot trip it. It exists to tell "the Worker module never started" (bad `workerUrl`, blocked MIME, suspended environment) from "rendering is slow".

```ts
const result = await renderSequenceInWorker(score, {
  sink, format: 'pcm24',
  startupTimeoutMs: 10_000,                       // module start only
  signal: AbortSignal.timeout(5 * 60_000),        // your own whole-job deadline
  phaseDiagnostics: true,
  onPhase: status => console.debug(status.phase, status.phaseElapsedMs),
});
console.log(result.diagnostics.phases);           // { status: 'completed', initializingMs, renderingMs, writingMs, closingMs, totalMs }
```

There is **no built-in overall deadline and no automatic retry**. A legitimately long render or a slow sink is indistinguishable from a stalled one without host knowledge, and a blind retry would re-send chunks to a sink that may already hold partial data. Use an `AbortSignal` for the policy that fits the app.

## Phases

`onPhase(status)` is called synchronously, for every transition, with a frozen `{ phase, elapsedMs, phaseElapsedMs, frames, totalFrames, bytesWritten, errors }`:

| Phase | Interval |
| --- | --- |
| `initializing` | from Worker construction until `ready` |
| `rendering` | Worker compute: from `ready`/each acknowledgement until the next chunk arrives |
| `writing` | from chunk arrival until the awaited `sink.write()` and `onProgress` finish |
| `closing` | from the Worker's `done` until `sink.close()` resolves |
| `completed`, `cancelled`, `failed` | terminal; reported once to `onPhase` |

`rendering` and `writing` alternate once per chunk. With `phaseDiagnostics: true` the successful result carries four accumulated durations and the total in `diagnostics.phases`. Failed or cancelled renders reject; use `onPhase` to capture their terminal status. Timings are host monotonic wall-clock readings (`performance.now()`), not DSP benchmarks, and include scheduler and GC pauses. Neither option changes the bytes written.

If `onPhase` or `onProgress` throws, the render fails with that error exactly once; the first failure is preserved and the observer is not called again after the terminal phase.

## Partial output and rollback

The sink owns its output. `abort(reason)` is called at most once, without being awaited, and the Worker is already terminated when it runs. It must make any in-flight `write` harmless and discard the partial file; cancellation cannot retract bytes already persisted. A robust File System Access sink:

```ts
async function createFileSink(handle: FileSystemFileHandle): Promise<WavSink> {
  const writable = await handle.createWritable();   // writes to a swap file until close()
  return {
    write: bytes => writable.write(bytes),
    close: () => writable.close(),
    abort: reason => writable.abort(reason),         // discards the swap file: the target is untouched
  };
}
```

Acquire the handle from a trusted gesture, keep the cancellation signal alive across picker and `createWritable()` awaits, and clean up acquisition failures before starting a Worker. Never fall back to accumulating the whole file in a Blob.

## Diagnosing a stalled start

1. `TimeoutError` from `startupTimeoutMs`: fetch `workerUrl` directly. It must be same-origin, served as JavaScript with `nosniff` and a 200 status, next to the rest of the matching `dist/` tree (`npx --no-install opm-assets check <base-url>` run from a project with OPM.js installed, verifies bytes, status and MIME without fetching a registry CLI).
2. A Worker that reaches `ready` but never delivers a chunk: look at `status.phase` in `onPhase`. A long `rendering` phase with `frames` not advancing points at the score; a long `writing` phase points at the sink.
3. Repeated, order-dependent startup failures in an automation harness are not evidence about the package. During the 1.7 verification a managed browser closed targets or missed Worker start deadlines when many Workers started back to back, while the same path passed in isolation. The cause was not established, which is why this release adds measurement (`ready`, phases) rather than an automatic retry.

## Verified behavior

[`test/render-worker.test.ts` (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/test/render-worker.test.ts) runs the real Worker module in a thread. It checks the phase sequence, that diagnostics do not change the bytes, that `startupTimeoutMs` rejects a Worker that never answers (no score is sent and the sink is aborted once) while a 30 ms-per-write sink succeeds under a 1 s watchdog, rejection of invalid or premature `ready` messages, and that a throwing observer fails the render once.
