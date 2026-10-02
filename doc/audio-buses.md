# Polyphony budgets, voice priority and independent buses

OPM.js has two ways to get more than eight simultaneous sounds, and they cost and sound different. [Example 11 (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/buses.html) demonstrates independent buses.

## One engine, more voices

`new OPM({ maxVoices })` (and `Synth`, `renderSequence`, the Worker renderer) accepts **1–32** logical voices. The default stays 8. Everything else is unchanged:

- Released notes still occupy a voice until their tail ends, so 32 voices means 32 sounding *or releasing* notes.
- The stealing fade is still at most eight ~5 ms fades. DSP voice state is preallocated for `maxVoices + 9` slots. Trusted prepared-patch admission reuses that state; raw patches require validation and snapshot allocation. This is not a global zero-allocation promise for host APIs or command dispatch.
- One output `tanh` stage and one `mixGain` apply to the sum of all voices.

### Voice priority

Each note may carry `voicePriority`, an integer 0–127 (default 0), in `playNote`, score notes (`SequenceEvent`, beat events), `Synth.noteOn` options, `renderNote` and Performance parts.

When the engine is full, an incoming note chooses its victim only among sounding voices with **priority less than or equal to its own**: the lowest priority first, then the engine's stealing policy (`oldest`, `release-first`, `quietest`) among equals. If every voice outranks it, the note is **refused**:

- `Synth.noteOn` throws `VoiceAdmissionError` before changing any state or consuming an ID;
- the AudioWorklet reports `rejected` with reason `priority` (not counted as a processor error);
- offline score rendering skips the note and keeps going.

Use it for protected melodies, bass lines and stingers; do not use it to hide an undersized `maxVoices`, since a protected sound can still fall silent if protected sounds alone fill the engine.

### What it costs

The checkout-only maintenance command `npm run benchmark` renders 128-frame blocks of the real DSP. The 1.8.0 run below was taken on an Apple M5 (Node 26.7.0, 48 kHz, 2.667 ms block deadline) on a laptop whose load average was about 24 from unrelated processes, so **absolute p99 values are not meaningful and the CI budget gate was not applied**. The median cost relative to the eight-voice standard case is the useful number: cost grows roughly linearly with the number of sounding voices.

| Scenario (median block time ÷ deadline) | Median | Relative to 8 voices |
| --- | --- | --- |
| 8 voices, standard | 0.65 | 1.0× |
| 16 voices, standard (opt-in) | 1.19 | 1.8× |
| 32 voices, standard (opt-in) | 2.84 | 4.4× |
| 32 voices, `eco` (opt-in) | 1.63 | 2.5× |
| 8 voices, `eco` / `high` | 0.31 / 1.00 | 0.5× / 1.5× |
| 2 engines × 8 voices | 1.29 | 2.0× |
| 4 engines × 8 voices | 2.26 | 3.5× |

Under that load even the eight-voice case missed its block deadline at p99 (5.7× in this run; the median stayed at 0.65×). For contrast, the release record for an unloaded run of the same host class measured the eight-voice standard p99 at 0.19× the deadline ([acoustic quality](./acoustic-quality.md#coverage-and-evidence)). Treat the table as a scaling guide only and measure on your target hardware with `npm run benchmark` (optional `OPM_BENCH_P99_BUDGET_RATIO` makes it a gate). Mobile devices have not been measured. Prefer `eco`, a lower `maxVoices`, or fewer simultaneous notes where the deadline is tight.

## Several engines on one AudioContext

Create one `OPM` per bus and give each the same borrowed `context` and its own `destination` node:

```ts
const context = new AudioContext();
const lead = new OPM({ context, destination: leadGain, maxVoices: 6 });
const pad  = new OPM({ context, destination: padFilter, maxVoices: 12 });
await Promise.all([lead.start(), pad.start()]);   // from a user gesture
```

- Each engine has its own voice budget, `mixGain`, quality profile and saturation. Web Audio then adds the buses **linearly**.
- OPM disconnects only its own node and never closes or suspends a borrowed context. Close the context yourself after disposing every engine.
- Each engine is a separate AudioWorklet processor; more buses mean more per-block overhead and more CPU (see the table). Share a `Transport` or `Arrangement` per engine; they own only their own notes.
- Effects, sidechains and per-bus metering are plain Web Audio nodes in the host graph. The package ships no reverb, chorus or mixer.

### Stems are not a monolithic mix

A single engine saturates the sum of all its voices once. Several engines saturate each stem and then add them, so their sum is a different, equally valid mix. It is not bit-identical to rendering all notes in one engine, and it can exceed full scale if each stem is near its limit. The example's offline "linear bus mix" clips to ±1 and reports its peak; lower the stem gains for dense material.

For offline stems render each bus separately with `renderSequence` (or the Worker renderer), keeping the same `sampleRate`, `maxVoices` and `mixGain` you use live. A shared start frame keeps stems aligned.

## Choosing

| Need | Use |
| --- | --- |
| A melody that accompaniment must not steal | `voicePriority` on the melody, one engine |
| More than eight sounding notes, one tonal group | `maxVoices` up to 32; measure CPU |
| Separate effects, ducking or stems per instrument group | One engine per bus |
| Fewest CPU surprises on weak devices | Fewer voices, shorter releases, `eco` |
