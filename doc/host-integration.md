# Host integration

## Worklet deployment

`new OPM({ workletUrl?: string | URL })` accepts an optional module path. Relative paths resolve against the page URL; a `URL` is copied when constructed. The default remains `new URL('../worklet/processor.js', import.meta.url)`. A custom module must be same-origin HTTP(S), with no credentials or fragment. HTTPS and secure loopback HTTP are supported; insecure contexts are rejected before audio resources are allocated. `start()` rejects and emits an `error` event when initialization fails, including normal CSP, network and MIME failures. Validation does not bypass browser policy.

Deploy the processor **and its relative imports**, not only one JavaScript file. Keep their installed layout; serve JavaScript as JavaScript and asset misses as 404, not SPA HTML. See the [installed-package Vite example](../examples/vite/README.md) for a non-root deployment with `script-src 'self'`, `worker-src 'self'` and no blob/eval allowances.

```ts
import { OPM } from 'opm.js';

const engine = new OPM({ workletUrl: '/assets/opm/worklet/processor.js' });
// Invoke initialization/resume from a trusted user gesture.
await engine.start();
```

## Worker WAV output and bounded sinks

`renderSequenceInWorker(events, { sink, format?, onProgress?, signal?, workerUrl?, ...chunkOptions })`
renders long scores in a static module Worker. Chunk options are the core
`renderSequenceChunks` options, including `sampleRate`, `chunkFrames` (1–65536,
default4096), `maxFrames`, voice registry, mix/tuning/stealing and `quality`.
`format` is `pcm16` (default), `pcm24`, or IEEE `float32`. Output is stereo RIFF32
WAV; oversized RIFF files reject before Worker allocation. Score, options and
patches are validated and detached first; there is no audio device/context.

The default module is `new URL('../worker/render.js', import.meta.url)`.
Deploy `dist/worker/render.js` **and all its relative imports**, maps and
declarations from the matching distribution. An explicit `workerUrl` resolves
against the page and must be same-origin HTTPS or secure loopback HTTP, with
no credentials/fragment. The default must also remain same-origin.
Use `worker-src 'self'`; no blob module, eval, dynamic executable source or
cross-origin loading is used. CSP, MIME and network failures reject normally.
Importing the browser API on Node/SSR is safe, but calling this helper requires
a browser with module Workers.

A sink is an own-data object with `write(Uint8Array): void | Promise<void>`,
optional `close()` and optional `abort(reason)`. The Worker transfers one byte
chunk and waits until the sink write fulfills before advancing DSP. The sink owns
the byte buffer and may transfer/detach it (for example, to a storage Worker);
byte accounting captures its native size before invoking `write`. Neither thread
accumulates a complete PCM buffer or WAV. The sink must actually drain to bounded
storage: retaining every chunk defeats the memory bound.
`onProgress({ frames, totalFrames, bytesWritten, errors })` runs after each
successful write, including the initial header (`frames:0`); frame counts are
cumulative. The result contains `capacity`, `format`, `bytesWritten` and
`diagnostics: { errors, processedEvents, renderedFrames }`. Success means
all bytes were written and `close()` fulfilled, not that a host file is audible.

Abort, sink/progress exceptions and Worker failures terminate the Worker,
remove listeners and reject. `abort(reason)` is invoked once, but its promise
and an outstanding `write`/`close` are **not awaited**: a hung sink cannot hold
cancellation hostage. Their later rejections are consumed. A sink must
invalidate in-flight writes and discard/roll back incomplete output; cancellation
cannot retract bytes already persisted. `abort` must not finalize an incomplete
file. Use host-side cleanup when abort itself fails.

For an actual file export, request File System Access from a trusted gesture
where it is supported. Feature-detect it; if unavailable, report that long-file
export is unsupported rather than aggregating a long WAV into a Blob:

```js
import { renderSequenceInWorker } from 'opm.js';

// Run this handler directly from a user gesture.
async function exportScore(events, signal) {
  signal?.throwIfAborted();
  if (typeof window.showSaveFilePicker !== 'function') {
    throw new Error('Streaming file export requires File System Access');
  }
  let file, settled = false;
  const rollback = async reason => {
    if (!file || settled) return;
    settled = true;
    await file.abort(reason);
  };
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'sequence.wav',
      types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }],
    });
    signal?.throwIfAborted();
    file = await handle.createWritable();
    signal?.throwIfAborted();
    return await renderSequenceInWorker(events, {
      sampleRate:48000, chunkFrames:4096, format:'pcm24', signal,
      workerUrl:'/audio/opm/worker/render.js',
      sink: {
        write(bytes) { return file.write(bytes); },
        async close() { await file.close(); settled = true; },
        abort: rollback,
      },
    });
  } catch (error) {
    await rollback(error).catch(cleanup => console.error('File rollback failed', cleanup));
    throw error;
  }
}
```

The checkout demo's memory-only download is intentionally a **small export**:
preflight a hard frame/byte budget, retain chunks only within that budget, and
revoke its old Blob URL on replacement/disposal. It is not a fallback for a long
file sink. Hosts also own cumulative work, concurrency and export-frequency limits.

Node and browser hosts may use `createWavEncoder({ sampleRate, channels:1|2,
format?, totalFrames })` from `opm.js/core` directly. Write `header()` exactly
once, then each `encode({ left, right? })` result to a backpressured sink before
consuming the next borrowed PCM chunk; finally write `finalize()` (a RIFF
alignment byte or empty array). Each call accepts1–65536 frames. The declared
frame count is exact: overrun/underrun reject, and invalid chunks never advance
`framesEncoded`. No audio/file bytes are retained by the encoder. Its getters
are `totalFrames`, `framesEncoded`, `byteLength` and `finished`. Zero-frame WAVs
are supported by this streaming API. The full-buffer `encodeWav({ left,
right?, sampleRate, format? })` keeps its original1–4,000,000-frame budget.
All channels must be native Float32Arrays of finite samples in−1–1; encoding
rejects rather than clipping. PCM24 uses signed little-endian endpoints; float
WAV uses format3 with a `fact` sample-count chunk.

## Events, acknowledgements and ownership

`engine.subscribe(listener)` returns an idempotent unsubscribe function. Each subscription is independent, even for the same listener; it coexists with `onEvent` and scheduler subscriptions. Exceptions and attempts to mutate frozen event records cannot disrupt other listeners or cleanup. Removing a listener during dispatch skips its remaining delivery; newly added listeners begin with the next event. Ordinary `close()` preserves subscriptions for a later `start()`.

Commands still synchronously return numeric IDs. `waitForCommand(commandId, { timeout?, signal? })` waits only for the correlated **admission acknowledgement**, including a reply received before the method is called. The timeout is milliseconds: default **5000**, integer range **1..60000**. At most **64 pending waits** and **128 command receipts** are retained. Receipts without live waiters are evicted oldest-first; an unknown/expired ID rejects rather than waiting forever. Multiple waits for one ID are independent. Abort/timeout removes only that wait, not the admitted command or another waiter. A late acknowledgement can still be retrieved while its receipt is retained. Signals must be genuine AbortSignals: intrinsic state/reason and listener operations bypass shadow accessors and reject duck-typed objects.

A rejected acknowledgement throws `CommandRejectedError` with its frozen `event` (`reason`, note ID and command ID). Pending waits reject on reset, close, interruption/suspension or processor failure. A command-triggered reset carries its initiating `commandId`; an ordered panic reset rejects earlier outstanding commands, but preserves that panic's own acknowledgement and commands posted after it, even after receipt eviction. Uncommanded interruption resets invalidate every outstanding receipt. A settled acknowledgement is historical admission evidence and is not revoked by a later reset. **Accepted does not prove scheduled execution, gate release, release-tail completion or audible output.** Use note lifecycle events and diagnostics for those distinct observations.

```ts
const id = engine.playNote({ note: 60 });
const stop = engine.stop(id, { at: engine.context!.currentTime + 0.1 });
const acknowledgement = await engine.waitForCommand(stop, { timeout: 2000 });
// acknowledgement.state === 'accepted': future stop was admitted, not completed.
```

`close()` disconnects OPM's node, closes its port and removes its context listener; it is restartable. `dispose()` is terminal and idempotent: it also removes subscriptions/`onEvent`, rejects outstanding waits and prevents restart/new subscriptions. Both close an owned AudioContext, but **never close or suspend a borrowed context**. The host owns its additional routing nodes and any context it supplied.

## Audio/output clock mapping and component cleanup

`getOutputTimestamp()` pairs an AudioContext `contextTime` (seconds at device output) with the corresponding `performanceTime` (milliseconds on the performance clock). It is not a pair of independent current-time samples. Map an audio event at `audioTime` to an estimated output time with:

```ts
const stamp = context.getOutputTimestamp();
const estimatedOutputMs = stamp.performanceTime + (audioTime - stamp.contextTime) * 1000;
```

Do not add `baseLatency` or `outputLatency` again: the timestamp already describes output. Timestamp support/precision varies, the initial pair may be zero, and the result is an estimate—not microphone-observed acoustic onset. Re-sample while running after resume/device changes. If unavailable, display audio-clock timing only rather than inventing output-clock precision.

The following host can be mounted beside a button/status element. `unmount()` removes DOM/OPM listeners, aborts outstanding waits, disposes OPM, disconnects host routing and closes the host-owned context. The asynchronous gesture handler checks teardown after every asynchronous startup boundary.

```ts
import { OPM } from 'opm.js';

const button = document.querySelector<HTMLButtonElement>('#play')!;
const status = document.querySelector<HTMLElement>('#status')!;
const context = new AudioContext();
const output = context.createGain();
output.gain.value = 0.08;
output.connect(context.destination);
const engine = new OPM({ context, destination: output,
  workletUrl: '/assets/opm/worklet/processor.js' });
const lifetime = new AbortController();
let mounted = true;
let note: number | undefined;
const unsubscribe = engine.subscribe(event => {
  if (event.type === 'error') status.textContent = event.error.message;
  if (event.type === 'reset') note = undefined;
  if (event.type === 'note' && event.id === note) {
    status.textContent = event.state;
    if (['ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) note = undefined;
    if (event.state === 'started' && typeof context.getOutputTimestamp === 'function') {
      const stamp = context.getOutputTimestamp();
      if (stamp.performanceTime > 0 && Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime)) {
        const outputMs = stamp.performanceTime + (event.time - stamp.contextTime) * 1000;
        status.title = `Estimated output onset: ${outputMs.toFixed(1)} ms`;
      }
    }
  }
});
let busy = false;
const onClick = async () => {
  if (!mounted || busy) return;
  busy = true;
  try {
    await context.resume(); // Called synchronously in the trusted gesture.
    if (!mounted) return;
    await engine.start();
    if (!mounted) return;
    if (note !== undefined) {
      await engine.waitForCommand(engine.stop(note), { signal: lifetime.signal });
      if (!mounted) return;
    }
    // A desired performance-clock target converted back to audio seconds.
    const desiredOutputMs = performance.now() + 150;
    let at = context.currentTime + 0.05;
    if (typeof context.getOutputTimestamp === 'function') {
      const stamp = context.getOutputTimestamp();
      if (stamp.performanceTime > 0 && Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime)) {
        at = Math.max(at, stamp.contextTime + (desiredOutputMs - stamp.performanceTime) / 1000);
      }
    }
    note = engine.playNote({ note: 60, at, duration: 1 });
  } catch (error) {
    if (mounted) status.textContent = error instanceof Error ? error.message : String(error);
  } finally { busy = false; }
};
button.addEventListener('click', onClick);

let teardown: Promise<void> | undefined;
function unmount(): Promise<void> {
  if (teardown) return teardown;
  mounted = false;
  button.removeEventListener('click', onClick);
  lifetime.abort();
  unsubscribe();
  teardown = (async () => {
    try { await engine.dispose(); }
    finally {
      output.disconnect();
      if (context.state !== 'closed') await context.close();
    }
  })();
  return teardown;
}
```

For a shared context owned elsewhere, omit its final `context.close()`; disconnect only the routing nodes this component owns. `streamSequence` and `createLookaheadScheduler` have their own `dispose()` methods: dispose each scheduler before its OPM instance so admission timers and live-note ownership are released.

## Other bundlers and SSR hosts

Webpack, Rollup and Parcel hosts can use the same explicit static-asset contract without relying on unverified worklet-plugin APIs: copy the installed package's **entire `dist/` tree plus package-root `LICENSE`** into the host's public/static directory, preserving relative paths. This is a packaging recipe, not a claim that these other bundlers were exercised. Only the existing Vite production smoke provides bundler-specific runtime verification.

For example, run this dependency-free Node script in a host project where `opm.js` is installed. Replace `public/audio/opm` with that host's static directory; this script only copies and does not delete existing host files.

```js
import { cp, copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(import.meta.resolve('opm.js'));
const dist = resolve(dirname(entry), '..'); // installed dist/api/index.js
const target = resolve('public/audio/opm');
await mkdir(target, { recursive: true });
await cp(dist, target, { recursive: true });
await copyFile(resolve(dist, '../LICENSE'), resolve(target, 'LICENSE'));
```

Publish that directory at a same-origin URL such as `/audio/opm/`; retain the license and configure `new OPM({ workletUrl: '/audio/opm/worklet/processor.js' })`. The worklet's own imports must remain deployed beside it and use valid JavaScript MIME types; no blob URL or relaxed CSP is needed. The host can bundle the browser-facing API normally or import `/audio/opm/api/index.js` externally. Use a fresh release-specific asset directory or atomic deployment so removed old assets cannot mix with a new package tree.

An SSR module may import types safely, but instantiate/resume OPM only on the client, from a trusted user gesture. Keep module initialization free of `window`, `document` and `AudioContext` access on the server; dynamically import the runtime inside client-only code when required by the host. Dispose it during component teardown using the ownership recipe above.

## Part-scoped performance

`createPerformance()` supplies playing policies, not a MIDI driver. It requires
a started OPM and never owns its AudioContext. Keep returned **physical key IDs**
until their matching key-up; repeated equal-pitch keys have separate identities.

```js
import { createPerformance } from 'opm.js';

// opm is already started from the host's trusted input gesture.
const performance = createPerformance(opm, {
  parts: 16, maxKeys: 128, maxKeysPerPart: 16,
  onError: error => console.error(error),
});
performance.configurePart(0, {
  voice: 'brass', mode: 'mono', legato: true, priority: 'high', glide: 0.02,
  pan: 0, expression: 0.8,
});
const key = performance.noteOn(0, 60, { velocity: 0.7 }); // host key-down
performance.sustain(0, true);                           // pedal-down
performance.noteOff(0, key);                            // physical key-up
// Later, in the pedal-up input handler:
// performance.sustain(0, false);
// performance.updatePart(0, { pan: -0.5, expression: 0.6, glide: 0.03 });
// performance.allNotesOff(0); // only this part; no global panic
// performance.dispose();     // release all helper-owned gates on unmount
```

Parts are 0-based, with 1–16 configured parts (default 16), at most 128 keys and
128 tracked gates system-wide, including pending releases. Per-part limits share
that system budget; overflow rejects without evicting unrelated parts. A part
may use `mode: 'poly'` or `'mono'`, `legato`, and `priority: 'last' | 'high' | 'low'`.
Physically held keys take precedence over pedal-only keys; equal pitches choose
the newest identity. Mono legato preserves the original onset's envelope,
velocity and key/rate scaling. Its pitch offset is anchored to that onset:
within ±48 semitones it reuses the gate, farther moves retrigger at the actual
pitch instead of clamping. Non-legato switching retriggers the patch.

`getPart(part)` returns a detached frozen snapshot. Stealing prunes the affected
gate without later automatic readmission; reset clears state. Interruption
releases helper-owned notes even when direct OPM notes use preserve policy.
Dispose performance/Transport helpers before disposing their shared engine.
Their cleanup does not release unrelated host or Transport notes.
