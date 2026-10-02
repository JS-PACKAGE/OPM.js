# Adaptive music, tempo curves and the seek contract

This guide covers `createArrangement` (looping layers and sections that switch on musical boundaries), tempo curves and grid helpers shared by `createTransport`, and the exact meaning of pause, seek and resume. Try [example 09](../examples/adaptive.html).

## Arrangement

```ts
import { OPM, createArrangement } from 'opm.js';

const opm = new OPM({ maxVoices: 16 });
const arrangement = createArrangement(opm, {
  bpm: 96,
  initialSection: 'explore',
  layers: [
    { name: 'pad', length: 16, voicePriority: 20,
      events: [{ type: 'note', id: 1, beat: 0, duration: 16, note: 48, voice: 'strings' }] },
    { name: 'arp', length: 8, events: [ /* BeatSequenceEvent[] inside [0, 8) */ ] },
    { name: 'lead', length: 8, voicePriority: 100, events: [ /* … */ ] },
  ],
  sections: [
    { name: 'explore', layers: ['pad', 'arp'] },
    { name: 'combat', layers: ['pad', 'lead'] },
  ],
});
await arrangement.start();               // call from a user gesture
arrangement.switchSection('combat');     // returns the committed beat
arrangement.setLayer('arp', true, { quantize: 'beat' });
```

Rules that make switches musical:

- **One global beat grid.** Every layer loops with its own `length` (quarter-note beats, at most 256), aligned to beat 0 of the arrangement. A layer that two sections share is one continuous schedule, so its sounding notes are not retriggered or stopped when other layers change.
- **Commit boundary.** `switchSection` and `setLayer` commit at the first `quantize` boundary (`'bar'` default, `'beat'`, or a number of quarter notes) that is **not earlier than the notes already admitted** to the AudioContext clock. The returned value is that beat. With the default 0.2 s lookahead, a switch requested inside the final instants before a bar line lands on the following bar instead of rewriting notes that are already scheduled.
- **Removed layers.** Notes that started before the boundary are released at the boundary (their release tail still sounds). Pass `preserveNotes: true` to let them finish naturally. Notes that would start at or after the boundary are never admitted.
- **Voice priority.** A layer's `voicePriority` (0–127) is combined with each note's own value by taking the maximum. When the engine is full, lower-priority notes are refused instead of stealing a protected melody. Refusals are counted in `snapshot.priorityDrops` and do not stop the arrangement; any other rejection does stop it and calls `onError`.
- **Bounds.** At most 16 layers, 32 sections and 65,536 events in total; at most 128 outstanding notes and 256 queued commands. Each lookahead window allows at most 32 loop repetitions per active layer, 65,536 candidate-note inspections and 256 command admissions. Excess density stops scheduling and calls `onError`. Future automation streams one command per sounding gate; terminal notes discard their remaining commands. Names match `[A-Za-z0-9_-]{1,64}`. Options and events are copied as own data; accessors are rejected.
- **Ownership.** Only notes the arrangement admitted are stopped by `pause()`, `stop()` or `dispose()`. The shared `OPM` and its context are never closed.

`snapshot` reports state, position, bar/beat, the current and pending sections and layers, the tempo map and `priorityDrops`. `setTempo(bpm)` and `setTempoMap(map)` replace the tempo from the current beat on; notes that were already admitted keep the audio times they were admitted with (at most one lookahead window).

## Tempo curves

`TempoPoint` is `{ beat, bpm, curve?, endBpm? }`. Without `curve` (or with `'step'`) the tempo is constant until the next point, exactly as in 1.7. With `curve: 'linear'` the BPM changes linearly **per beat** to the next point's `bpm`, or to `endBpm` if given (`endBpm` is only valid with `'linear'`; the last point cannot be linear).

For a segment starting at beat `b0` with `bpm0` and slope `r = (bpm1 − bpm0) / (b1 − b0)`, the time to beat `b` is

$$t(b) = \int_{b_0}^{b}\frac{60}{\mathrm{bpm}_0 + r\,(x-b_0)}\,dx = \frac{60}{r}\ln\left(1 + \frac{r\,(b-b_0)}{\mathrm{bpm}_0}\right)$$

(`60·Δb/bpm0` when `r = 0`), and the inverse is `Δb = bpm0 · expm1(r·t / 60) / r`. `beatsToSeconds` and `secondsToBeats` use these closed forms with `log1p` and `expm1`, so ramps convert exactly across segment boundaries. `setTempo` on a running transport or arrangement truncates any ramp that is under way at the current beat (its `endBpm` becomes the interpolated BPM) and inserts a new constant tempo there.

Linear maps whose derived slope is not finite are rejected before admission, including subnormal beat intervals that would overflow the BPM-per-beat calculation.

## Grid helpers

- `quantizeBeat(beat, quantum = 1, mode = 'ceil')` with modes `floor | ceil | nearest | next` (`next` is strictly later even on an exact boundary).
- `swingBeat(beat, subdivision = 0.5, ratio = 2/3)` warps each pair of subdivisions; a ratio of 0.5 is straight and 2/3 a triplet feel. It is monotonic and maps pair boundaries to themselves.
- `swingBeatEvents(events, subdivision, ratio)` swings note starts **and** ends, so adjacent gates keep their order.

## What pause, seek and resume mean

`createTransport` and `createArrangement` are **musical restarts**, not DSP checkpoints.

| State | Preserved | Not preserved |
| --- | --- | --- |
| Musical position (beats), tempo map, loop | yes | |
| Transport `seek()`/loop wrap into a sustained note | the note restarts at the target beat, with pitch, expression, pan, modulation, ratios, feedback, LFO, level and ADSR values **reconstructed** from the score's controls and remaining ramps | oscillator phase, envelope stage and level, LFO phase, filter and feedback history, any release tail that was sounding |
| Arrangement `pause()` / `resume()` | the beat and the effective layer set | every owned note is released on pause; on resume only notes whose onset lies at or after the resume beat start, so a long pad that was mid-note re-enters at its next onset |
| Notes admitted by the host outside the transport/arrangement | untouched | |

An exact snapshot of oscillator phases, envelope state and filters is deliberately not offered: it would couple the public API to private DSP state and make 1.x DSP changes breaking. If a game needs a continuous pad across a scene change, keep that layer in both sections (it is then never interrupted), or keep the pad in a separate engine whose lifetime you control.

## Verified behavior

`test/arrangement.test.ts` renders through the real AudioWorklet processor. It checks that a pad shared by two sections is admitted once across a bar switch, that a removed layer is released at the exact boundary beat and that `preserveNotes` lets it finish, that a high-priority melody survives a one-voice engine without failing the arrangement, that a tempo change alters only unadmitted onsets, and that pause schedules nothing. `test/transport.test.ts` checks the logarithmic integral and its inverse to 1e-9 beats.
