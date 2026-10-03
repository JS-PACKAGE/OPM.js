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

## Restartable musical transport

`createTransport` from `opm.js` adds a musical cursor without changing the one-shot sequence APIs. `BeatSequenceEvent` uses `beat` instead of `time`; note `duration` is also in **quarter-note beats**. Controls retain their existing second-based `ramp`/`glide` durations. The score is detached and validated eagerly, with at most65,536 events and86,400 beats including gates. IDs are unique positive safe integers, and stops/controls must reference a score note.

```ts
const transport = createTransport(opm, [
  { type: 'note', id: 1, beat: 1, duration: 3, note: 60 },
  { type: 'control', id: 1, beat: 2, controls: { expression: 0.5, ramp: 0.1 } },
], {
  tempoMap: [{ beat: 0, bpm: 120 }, { beat: 2, bpm: 90 }],
  timeSignature: { numerator: 4, denominator: 4 },
  loop: { enabled: true, from: 0, to: 4 },
  onError: error => console.error(error),
});
await transport.start(); // Start/resume from a user gesture.
transport.pause();       // Preserve position; cancel owned gates/queued controls.
transport.seek(2);       // Remain paused; reconstruct when explicitly resumed.
await transport.resume();
transport.setTempo(100); // Preserve current beat; replace future tempo points.
transport.setLoop({ enabled: false, from: 0, to: 4 });
console.log(transport.position, transport.snapshot.musicalPosition);
transport.stop();       // Reset cursor to beat zero; handle remains restartable.
transport.dispose();    // Permanent helper teardown; does not close OPM.
```

Tempo defaults to120 BPM. BPM is finite in1..1,000; a supplied map contains1..1,024 own-data points, begins at beat zero, and increases strictly. Points default to step tempo; `curve: 'linear'` ramps BPM per beat to the next point’s BPM or an explicit `endBpm` (1..1,000). `endBpm` requires a linear curve, and the final point cannot be linear. Nonfinite derived slopes reject. `beatsToSeconds` integrates60/BPM across every boundary, using the logarithmic integral for ramps; `secondsToBeats` is its inverse. `setTempoMap` replaces the complete map at the current cursor, not at score zero. `setTempo` retains earlier points, truncates any active ramp at its interpolated current BPM, inserts a constant point at the current beat and removes later points. See [tempo curves and grids](./adaptive-music.md#tempo-curves). Edits while running cancel/rebuild owned scheduling immediately; edits while paused/stopped stay inactive. Edits during pending startup invalidate that attempt and require explicit `start`/`resume` again.

`beatToBarBeat` and `barBeatToBeat` use one-based bars and fractional one-based beats in a fixed signature. The numerator is1..32 and denominator is1,2,4,8,16 or32; for6/8, one displayed beat equals half a quarter-note beat. `snapshot` contains frozen position/meter/tempo/loop data and state (`stopped`, `starting`, `running`, `paused`, `disposed`). `position` is in quarter-note beats; `running` becomes true only after asynchronous audio startup. `ids` is a detached live/pending score→runtime map; overlapping loop tails may map a score ID to its newest occurrence, not every owned tail.

Seek is bounded by the score end (or the enabled loop end, whichever is later). Loop intervals are finite with0≤`from`<`to`≤86,400 and may contain silence beyond the score. Playback before the interval proceeds until `to`, then wraps to `from`. Starting/seeking at or beyond an enabled loop's `to` normalizes to `from`. Loop seams are scheduled on AudioContext frames, not timer callbacks. Every iteration has distinct runtime IDs; old gates terminate at `to`, and controls outside that iteration are not submitted. Natural release tails can overlap the next iteration.

For notes admitted in the current segment, controls tied to release or later in the release tail are still scheduled, matching sequence/direct-note semantics. This includes expression/timbre/ADSR edits and controls at the final **non-looping** score endpoint; score duration includes control timestamps independently of note gates. Loop control intervals remain half-open at `to`, so an endpoint control does not leak into the next iteration. Natural completion stops admission but retains already scheduled controls and owned release-tail IDs until their terminal events; it does not perform scoped teardown. A seek/resume destination after a note's gate has ended never resurrects that release tail.

**Restart semantics:** seek, resume, tempo/loop edits and loop wraps reconstruct crossing held notes using their remaining musical gate and relevant controls. Linear pitch/expression/pan/modulation/operator-level/feedback/LFO-rate/AM-depth/PM-depth/operator-ratio ramps are evaluated at the destination and continue for their independent remaining seconds. Defaults come from the note's prepared patch. The latest fixed-Hz/null frequency policy is applied immediately at the destination, even if its original frequency ramp was unfinished; null uses the reconstructed live ratio and current engine tuning. This deliberately restarts that timbre transition rather than inventing intermediate Hz for a ratio-dependent endpoint. The latest operator ADSR edit is reanchored at the restarted onset. Phase, envelopes, LFO and pitch-envelope state restart; this is not a sample-exact DSP checkpoint or seamless sustain promise. An early/tied stop cancels its note; pre-onset controls clamp to onset. Pause/seek/edits use ID-scoped `stop(id, { cancelControls: true })`, removing owned future automation without global panic/allNotesOff or touching unrelated clients.
Independent note `gain` (0..1, default 1) is also reconstructed at seek/resume and continues any outstanding gain ramp; it multiplies expression without replacing it.

Lookahead bounds match streaming: horizon0.01..10 seconds (default0.2), interval0.001..horizon/2 (default min(0.025,horizon/2)), maxSlots integer1..256 (default256), and at most128 outstanding owned note IDs. Score/loop density is preflighted; runtime commands are additionally capped against the actual queue. Loops shorter than horizon/32 reject; at most32 wraps are generated per pump. Missed events or a pump gap longer than a horizon stop with `onError`, rather than silently retiming. `pump()` is available for host-driven observation; bounded automatic timers remain enabled. Position observes AudioContext time and never integrates timer drift.

Transport start, resume and active seek/tempo/loop reconstruction anchor playback in the future by `startupLead` seconds: default `min(0.05, horizon / 2)`, finite 0..10. The cursor remains at the requested beat during this count-in, then follows AudioContext time; durations are not stretched. Loop seams preserve the already-established audio clock and do not insert a lead on every wrap. `startupLead: 0` opts out for hosts that already control delivery timing. Notes still use `late: 'drop'`: headroom reduces cold-start beat-0 loss but does not suppress late/drop rejections or missed-window errors. Resolving `start()` is not confirmation of physical audible playback.

Reset, replacement/closed context, suspension and interruption stop this transport even under OPM's preserve policy. Returning the context to running does **not** resume it; explicitly call `start`/`resume` from a user gesture. Pause, stop, reset and dispose invalidate pending startup, so late promises cannot resurrect notes. Stop/dispose are idempotent. Disposed handles reject start/resume and mutation; no operation closes or globally resets the shared engine.
