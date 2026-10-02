# Bounded sequences

`prepareSequence`, `renderSequence`, and `playSequence` keep their convenience limits: 60 seconds, 128 notes, and 256 reserved scheduling slots (a note reserves onset and automatic release). Full-buffer rendering additionally caps output at 4,000,000 stereo frames. A 60-second score at96kHz therefore requires the chunk API, not a larger full-buffer budget.

## Offline chunks

Import `prepareLongSequence`, `estimateSequenceCapacity`, and `renderSequenceChunks` from `opm.js/core`. Long input is limited to 24 hours including note gates, and 65,536 input events. Generated automatic releases are additional bounded events. Note IDs are unique positive safe integers; controls/stops must reference a score note. Own-data dense arrays/plain objects only; accessors, unknown fields, malformed voices, controls, and oversized scores reject eagerly. Prepared patches and operator-level control tuples are detached immutable snapshots.

```ts
const capacity = estimateSequenceCapacity(score, { sampleRate: 96000, chunkFrames: 4096 });
const render = renderSequenceChunks(score, {
  sampleRate: 96000, chunkFrames: 4096, maxFrames: capacity.frames, signal,
});
for (const chunk of render) {
  // Consume synchronously before advancing, or await a sink in this ordinary for loop.
  await sink.write(chunk.left, chunk.right, chunk.offset);
}
console.log(render.diagnostics);
```

No aggregate PCM is allocated: two reusable Float32 buffers, `chunkFrames` each (integer1..65,536, default4,096), plus bounded score/event/synth state. `left`/`right` are **borrowed until the next `next()`**; copy if retention is necessary. The final chunk exposes only its valid frames. `offset` and `frames` describe contiguous stereo output. Iterator `return()`/breaking a loop and `cancel()` terminate without further advancement. An aborted native AbortSignal throws `AbortError` on the next advancement before rendering; later calls return done. Cancellation granularity is one chunk, not an individual sample.

Capacity reports total frames/PCM bytes, reusable-buffer bytes, input-event/note counts, reserved slots, convenience eligibility, and explicit limits. It validates without rendering or allocating output PCM. Output includes ceil-rounded note gates, note-scaled operator release times, and a10ms tail margin. `maxFrames` is an optional hard cumulative-work budget checked eagerly; the absolute bound is the24-hour horizon plus maximum10-second release and10ms tail. Cumulative diagnostics expose rendered frames, consumed scheduling events (including cancelled events), and DSP errors. Concatenating chunks matches the same full-buffer render exactly. Ordering is stop→note→control at equal frames; controls preceding onset clamp to that onset, while an early/tied stop cancels its target.

`fullBufferAllowed` includes the 4,000,000-frame and convenience score budgets. `singleBatchAllowed` includes the 60-second/128-note/256-slot limits independent of PCM size. `streamAllowed` reports default 0.2-second-window density preflight eligibility: `peakWindowSlots` ≤256 and `peakWindowNotes` ≤128, with origin zero at the estimated sample rate. It is not an admission guarantee: outstanding live IDs are also capped at runtime and unrelated worklet clients consume capacity. Nondefault horizons are preflighted by `streamSequence` itself. `limits` names these budgets as `fullBufferFrames`, `batchNotes`, `batchSlots`, `longEvents`, `longSeconds`, `chunkFrames`, `streamHorizonSeconds`, `streamSlots`, and `streamNotes`. Estimation allocates bounded score/queue snapshots but no Synth voice pool or PCM.

This is pull-based synchronous DSP. Yield between chunks or use a Worker for responsive applications. A24-hour maximum is a safety ceiling, not a promise of inexpensive rendering. Streaming an encoded file requires a sink/encoder that supports incremental output; `encodeWav` remains a full-buffer convenience helper.

## Mixed real-time lookahead

Import `streamSequence` from `opm.js`. It eagerly validates the complete long score before `start()` can initialize audio. Events use the same relative-time note/control/stop shapes as `playSequence`.

```ts
const stream = streamSequence(opm, score, {
  horizon: 0.2, interval: 0.025, maxSlots: 256,
  onError: error => console.error(error),
});
await stream.start(); // Invoke from an appropriate user gesture.
// Later: stream.stop() or stream.dispose().
```

The optional absolute `at` is current time through60 seconds ahead when starting. Lookahead horizon is0.01..10 seconds; timer interval is0.001..horizon/2. `maxSlots` is1..256 and bounds **owned queued submissions**, not the whole shared worklet. Whole-score window density is preflighted (also against actual sample-rate frames on start). Each window and outstanding live/pending IDs are bounded; at most128 owned IDs remain outstanding. Other users of the shared worklet still consume its capacity, so observe rejection events/onError rather than assuming admission. Notes use held gates and separate automatically scheduled releases, allowing durations beyond60 seconds without enlarging the direct-note contract.

Score→runtime IDs survive across windows; pre-onset controls wait for their target's admission and apply at onset. `ids` is a detached snapshot of live/pending IDs, not a historical admission report. Terminal note events prune IDs and queued bookkeeping. `stop()` cancels only this stream's pending/active IDs, never unrelated notes. Reset and context interruption/suspension terminate the stream, even when the host preserves unrelated direct-note state. Stop/dispose is idempotent and cannot command a replacement node. Start is one-shot; a cancelled score requires a fresh handle. AbortSignal cancels playback, including asynchronous startup. `pump()` can be called explicitly by a host clock; automatic timers remain enabled.

A missed score event after a timer stall terminates via `onError` instead of silently replaying stale notes. Admission failures terminate and cancel owned IDs. No browser timer can guarantee uninterrupted physical-device playback; use the sequence example and physical acceptance scenarios for device evidence.
