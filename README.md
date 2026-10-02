# OPM.js

**A 4-operator FM synthesis engine for the browser, inspired by the Yamaha YM2151 (OPM) sound chip.**

OPM.js recreates the classic 16-bit era FM sound — 8 channels of 4-operator synthesis with multiple algorithms, feedback, and ADSR envelopes — as a lightweight, zero-runtime-dependency TypeScript engine powered by the Web Audio API, distributed as JavaScript ES modules.

> **Status:** latest published GitHub release: v1.5 (package 1.5.0). This checkout also contains **unreleased** voice-format v5, streaming-score, host-integration and acoustic-quality improvements described below. These are not included in the historical v1.5 artifact. GitHub distribution and npm registry publication are separate.

Usage guides: [English](./doc/usage.en.md) · [繁體中文](./doc/usage.zh-TW.md).

Choose a workflow: [try the demos](#try-the-checkout) · [install into an npm project](#install-into-an-npm-project) · [deploy in a browser](#use-in-a-browser) · [render in Node.js](#render-in-nodejs) · [API reference](#api-reference) · [troubleshooting](#troubleshooting).

## About

The Yamaha YM2151 (OPM) powered a generation of arcade boards and the Sharp X68000, defining the sound of the mid-1980s with its 8-channel, 4-operator FM architecture. OPM.js brings that architecture to the browser with a TypeScript implementation and directly deployable JavaScript.

OPM.js is a musically-accurate reimplementation, not a cycle-accurate hardware clone: envelope timing and modulation curves are tuned to sound correct rather than to reproduce silicon behaviour bit-for-bit.

## Features

- **4-operator FM synthesis** with 8 connection algorithms and hardware-style feedback
- **Per-operator dB-domain ADSR**, level/rate key scaling, velocity sensitivity and optional fixed-Hz oscillators
- **Per-voice pitch envelope and LFO** with four AM / PM waveforms, delay, phase and note/global synchronization
- **Eight-voice polyphony** with oldest, release-first or quietest stealing and bounded ~5 ms fades
- **Held notes and smooth live expression** — independent pitch glide and expression/pan/modulation/operator-level ramps, command acknowledgements and multicast lifecycle/reset events
- **Audio-clock scheduling and shared scores** — fractional notes, bounded live/offline sequences, chunked long-score rendering and explicit interruption recovery
- **Prepared immutable patches and pooled DSP state** — reuse bounded voice slots instead of allocating typed state on every admission
- **PCM16 WAV export** and approximate six-to-four-operator DX7 SysEx voice import
- **Pre-saturation mix gain and global tuning** — reference A4 and interpolated 128-note cents offsets
- **TypeScript declarations** for browser, core, and voice-module exports
- **AudioWorklet-based DSP** — synthesis runs off the main thread
- **Zero runtime dependencies**, built on the Web Audio API
- Works in the browser and Node.js (offline rendering)

## Requirements

- Modern browser with ES modules and AudioWorklet (served over HTTPS or localhost)
- Node.js 22+ for offline rendering and tests

## Getting started

### Try the checkout

Obtain a checkout or source archive of [this repository](https://github.com/YueyuHoshizora/OPM.js) containing this documentation. Repository commands below run in the directory containing `package.json`, `src/`, and `scripts/` (called `OPM.js` in the examples).

The committed `dist/` is ready to use; trying the demos needs no npm installation or build. With Python 3 available, run from that repository root:

```sh
python3 -m http.server 8000
```

Open **http://localhost:8000/index.html** for the English example catalog:

| Example | Demonstrates |
| --- | --- |
| [Basic notes and voices](./examples/basic.html) | Presets, pitch, velocity, timed and held notes |
| [Melody and chord scheduling](./examples/song.html) | *Twinkle, Twinkle, Little Star*, absolute timing, bounded lookahead and cancellation |
| [Live expression and per-voice LFO](./examples/modulation.html) | Bend/glide a held note; change expression, pan and modulation; scheduled release |
| [Shared AudioContext and routing](./examples/context.html) | Host GainNode, manual routing, diagnostics and borrowed-context ownership |
| [Offline synthesis and WAV](./examples/wav.html) | Stereo PCM, frame counts and PCM16 WAV without an AudioContext |
| [Advanced playground](./examples/playground.html) | Key scaling, suspend/resume, diagnostics and approximate DX7 import |
| [Preset and DX7 audition](./examples/audition.html) | Register/velocity grid, A/B comparison, raw peak/RMS reports and rendered WAV |
| [Shared scores and interruption recovery](./examples/sequence.html) | Same live/WAV score, smooth controls, tuning, stealing, panic and local physical-device observations |

Click a playback button to start audio. Stop the server with Ctrl+C when finished. Do not open the HTML through `file://`. Pages and runtime messages are English; TypeScript helpers live in `demo/`.

If `dist/` is missing or you have changed `src/` or `demo/` TypeScript, regenerate it using the [development commands](#optimized-distribution) first.

### Install into an npm project

The name in `package.json` does **not** guarantee publication to the public npm registry. These instructions install this checkout's local tarball; do not substitute `npm install opm.js` or an assumed CDN URL.

From the `OPM.js` repository root, with Node.js 22+ and npm:

```sh
npm ci
npm pack
```

`npm pack` builds automatically and produces `opm.js-1.5.0.tgz`. To create a new application beside the checkout:

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.5.0.tgz
```

For an existing application, run only the install command from its root, adjusting the tarball path. Consumers do not install the engine's development dependencies or need a build step. The installed package contains minified JS, `.js.map` source maps with embedded TypeScript, generated `.d.ts` declarations, demo scripts, usage documentation, and legal files—not HTML demo pages, separate source files, or build scripts.

For a bundled host, use the [installed-package Vite example](./examples/vite/README.md): it preserves the complete engine/worklet tree and license, supports a non-root deployment base, and checks production CSP, MIME types and missing assets. Maintainers can follow the [npm publication procedure](./doc/publishing.md); authentication, protected environments and a trusted publisher must be configured separately. No registry publication is implied.

### Use in a browser

From the npm application's root, copy the complete distribution into a public directory:

```sh
mkdir -p public/opm
cp -R node_modules/opm.js/dist/. public/opm/
cp node_modules/opm.js/LICENSE public/opm/LICENSE
```

Without npm, copy the checkout's complete `dist/` contents and its `LICENSE` into your site's `opm/` directory instead. The commands use a POSIX shell; copying those same files manually is equivalent.

Keep this layout; individual worklets and their imported modules must not be moved independently:

```text
public/
  index.html
  opm/
    api/
    core/
    voices/
    worklet/
    LICENSE
```

Save this complete example as `public/index.html`:

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>OPM.js example</title>
<button id="play" type="button">Play brass chord</button>
<output id="status" aria-live="polite">Ready</output>
<script type="module">
  import { OPM } from './opm/api/index.js';

  const opm = new OPM();
  const play = document.querySelector('#play');
  const status = document.querySelector('#status');
  play.addEventListener('click', async () => {
    play.disabled = true;
    try {
      await opm.start();
      for (const note of [60, 64, 67]) opm.playNote({ note, duration: 0.7 });
      status.textContent = 'Playing brass chord';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      play.disabled = false;
    }
  });
</script>
</html>
```

From the application root, serve that public directory:

```sh
python3 -m http.server 8000 --directory public
```

Open **http://localhost:8000/** and click **Play brass chord**. Production hosting must use HTTPS. The user gesture and awaited `start()` are required for browser audio playback.

Bare names such as `import { OPM } from 'opm.js'` do not resolve in plain browser HTML without an import map or a bundler. Even with a bundler, do not assume it copies the AudioWorklet and its dependencies: the static-copy layout above is the supported baseline. Import the served URL and deploy the complete directory together.

### Render in Node.js

In the npm application's root, save this as `render.mjs`:

```js
import { Synth } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const sampleRate = 44100;
const synth = new Synth(sampleRate);
const id = synth.noteOn(brass, 60);
const left = new Float32Array(sampleRate);
const right = new Float32Array(sampleRate);
synth.render(left, right, 0, 22050);
synth.noteOff(id);
synth.render(left, right, 22050, 22050);
console.log(left.some(sample => sample !== 0), synth.errorCount);
```

Run `node render.mjs`; it prints `true 0`. The two buffers contain one second of PCM, including release after the first half-second. This does **not** play through Node's speakers or write a WAV file. Use `.mjs` or a project with `"type": "module"`; no CommonJS entry is provided.

To run the same script from a checkout instead, change the imports to `./dist/core/index.js` and `./dist/voices/brass.js`.

## API reference

All times are in seconds unless stated otherwise. Browser and Node examples intentionally use different import styles:

| Exports | Installed npm import | Browser URL in the layout above |
| --- | --- | --- |
| `OPM`, `createLookaheadScheduler`, `playSequence`, `streamSequence` | `opm.js` | `./opm/api/index.js` |
| `Synth`, `renderNote`, core helpers | `opm.js/core` | `./opm/core/index.js` |
| `brass` | `opm.js/voices/brass.js` | `./opm/voices/brass.js` |
| `parseVoiceBank`, `validateVoice`, schema helpers | `opm.js/voices/schema.js` | `./opm/voices/schema.js` |
| `importDX7`, `describeDX7` | `opm.js/voices/dx7.js` | `./opm/voices/dx7.js` |

### Browser: OPM

| Call | Contract |
| --- | --- |
| `new OPM({ sampleRate, context, destination, workletUrl, onEvent, mixGain = 1, tuning = {}, stealing = 'oldest', interruption = 'cancel' } = {})` | Optional integer sample rate 8000–96000 Hz. Borrow an existing `AudioContext`; OPM never closes or suspends it. Omit `destination` to use its destination, or use `null` for explicit routing. Optional `workletUrl` relocates the complete same-origin worklet module tree; HTTPS or loopback secure contexts only, without relaxing CSP/MIME checks. |
| `await opm.start()` / `await opm.resume()` | Initialize/resume the context and worklet from a user gesture; concurrent starts coalesce. Existing contexts are resumed after browser suspension. Await before playing. |
| `opm.connect(destination)` / `opm.disconnect(destination?)` | Connect/disconnect the started worklet output; return `opm`. Omitted disconnect destination removes all output connections. Destination must belong to the same context. |
| `opm.loadVoice(name, voice)` | Strictly validate/copy a voice; register/replace a name for future notes. Name: 1–64 ASCII letters, digits, `_`, or `-`. Works before `start()`. |
| `opm.playNote({ voice = 'brass', note, time = 0, at, duration = null, velocity = 1, pan = 0, late = 'start' })` | Return a positive safe-integer ID without wrapping. Finite fractional MIDI 0–127; use either relative `time` (0–60 seconds) or absolute nonnegative AudioContext `at` (at most 60 seconds ahead), never both. Duration `(0,60]` or `null` holds until stop; velocity 0–1; pan −1–1. Requires `start()`. |
| `opm.stop(id, { at } = {})` | Return a command ID. Without `at`, cancel a pending note or release an active note immediately; with `at`, schedule that action. Inactive/already-released targets reject the command without changing the note; release is not immediate mute. |
| `opm.updateNote(id, controls, { at } = {})` | Return a command ID. Apply immediately or at an absolute audio time. Controls before onset persist for that pending note; released notes remain controllable until they end. Invalid/inactive/queue-full commands report rejection. |
| `opm.allNotesOff()` / `opm.panic()` | Return a command ID; both bypass a full scheduled-event queue. All-notes-off cancels pending onsets/automation and releases active gates naturally. Panic removes every active/release/steal tail immediately and emits a reset; routing and prepared patches survive. |
| `opm.setMixGain(gain)` / `opm.setTuning(tuning)` | Require a started node and return a command ID. Replace the setting immediately; retain it across node recreation. They affect active and future voices without restarting envelopes/phases. |
| `opm.voices` | Defensive `ReadonlyMap` snapshot of deeply frozen patches; replace patches through `loadVoice()`, not map mutation. |
| `await opm.getDiagnostics()` | Return `{ type: 'diagnostics', requestId, activeVoices, pendingEvents, errors, rejectedNotes }`. Requires running context; at most 64 outstanding requests. Suspend/close/processor failure rejects pending requests; resume before retrying. |
| `await opm.close()` | Serialize disposal against initialization, disconnect the node, and close only an owned context. Emit a global `reset: close`; teardown/failure does not guarantee individual terminal note replies. A later `start()` recreates owned contexts; borrowed contexts remain usable. Cancel application timers separately. |
| `opm.subscribe(listener)` | Multicast event subscription; returns an idempotent unsubscribe function. Listener exceptions are isolated. |
| `await opm.waitForCommand(commandId, { timeout, signal } = {})` | Cancellable admission acknowledgement; timeout default 5000 ms, integer 1–60000 ms; 64 pending waits/128 retained receipts. Rejection throws `CommandRejectedError`; timeout, abort and teardown reject. Acceptance is not scheduled execution/completion. |
| `await opm.dispose()` | Terminal disposal, including listener/helper cleanup. Unlike restartable `close()`, a disposed instance cannot start again. |

`onEvent(event)` receives `{ type: 'note', id, state, reason?, frame, time }` with states `accepted`, `started`, `released`, `ended`, `stolen`, `cancelled`, or `rejected`; `frame`/`time` report actual admission, dispatch or completion boundaries. It also receives diagnostics, processor errors, `{ type: 'command', command, commandId?, id?, state: 'accepted' | 'rejected', reason?, frame, time }`, `{ type: 'context', state, frame, time }`, and `{ type: 'reset', reason, commandId?, frame, time }`. Command-triggered resets carry their initiating ID independently of receipt-cache retention. Command acceptance means admission/immediate application, **not guaranteed future execution**; correlate by `commandId`. Reset reasons are `close`, `failure`, `panic`, and `interruption`: clear application gate bookkeeping on reset. Callback exceptions are isolated.

At most eight logical voices (including release tails) are active, with up to eight short fading remnants. `stealing: 'oldest'` is the default; `'release-first'` chooses the oldest released voice before held voices; `'quietest'` uses current carrier envelope × velocity × expression, not waveform zero crossings, with oldest ties. The worklet bounds pending events and tracked note IDs to 256 each. Future timed notes use start/off events; held notes use a start event. Duplicate IDs and overflow reject before enqueueing; terminal events remove obsolete events. Schedule long pieces incrementally.

`late: 'start'` preserves the full duration after the actual delayed start; `late: 'drop'` rejects a missed start with reason `late`, including worklet-delivery delays. Same-frame stops precede onsets, then controls. Scheduled stops/controls obey the same 60-second future horizon and 256-event bound.

`NoteControls` accepts any nonempty subset of `pitch` (−48..48 semitones), `glide` (0..10 seconds, requires `pitch`), `expression` (0..1, multiplying velocity), `pan` (−1..1), `modulation` (0..2, scaling FM/LFO depths, capped at AM 1/PM 1200 cents), `operatorLevels` (four multipliers, each 0..2 over patch levels), and `ramp` (0..10 seconds, requires expression, pan, modulation or operatorLevels). Glide is linear in semitones; ramp independently interpolates supplied controls from their current values. Omitted/zero ramp is immediate; omitted controls retain state. Oscillators/envelopes do not reset. LFO settings belong to `voice.lfo`; there is no `setLFO()`. See [host integration](./doc/host-integration.md) for subscriptions, acknowledgement bounds, custom worklet assets, component disposal and device-output clock mapping.

`createLookaheadScheduler(opm, callback, { onError, horizon = 0.2, interval = 0.025, maxNotes = 32 })` returns `{ running, start(), stop(), dispose() }`. Its callback receives the half-open absolute window `{ from, to, maxNotes }` and returns at most `maxNotes` notes with `at` in that window and a numeric duration. Horizon is 0.02–10 seconds; interval is 0.005–1 second and less than horizon; maxNotes is an integer 1–128. At most 128 gates remain outstanding. Call `start()` from a gesture and handle its rejected promise; callback/admission errors stop the scheduler and reach required `onError`. Timer stalls skip missed windows rather than bursting old notes. Stop/dispose cancel only its notes and never close OPM. See the [song demo](./examples/song.html) and both usage guides for executable recipes.

Any non-running context stops lookahead scheduling, as does a reset; `onError` reports it and restarting is explicit. Default `interruption: 'cancel'` clears existing notes and automation on suspension/interruption, preventing replay on resume. Opt-in `'preserve'` retains direct-note gates/queued events across suspension, but does not automatically restart lookahead. Resume from a fresh user gesture. A closed borrowed context must be replaced by its host.

### Offline: Synth and renderNote

| Call or property | Contract |
| --- | --- |
| `new Synth(sampleRate, maxVoices = 8, options = {})` | Required finite sample rate 8000–192000 Hz; integer voice limit 1–8. Options are `{ mixGain, tuning, stealing }`, identical to OPM. No Web Audio is required. |
| `prepareVoice(voice)` | Strictly validate, detach and deeply freeze an opaque `PreparedVoice` once for repeated core admissions; forged lookalikes cannot bypass validation. |
| `synth.noteOn(voiceOrPrepared, note, id?, { velocity = 1, pan = 0 } = {})` | Raw voices validate/copy each call; prepared patches reuse validated data. Finite fractional MIDI 0–127; explicit positive safe-integer ID unique among active notes; velocity 0–1; pan −1–1. |
| `synth.noteOff(id)` | Begin release at current rendered time; return `true`, or `false` for unknown/already-released IDs. |
| `synth.updateNote(id, controls)` | Apply the same live controls; return `true` for an active/releasing note or `false` for an unknown/terminal ID. |
| `synth.allNotesOff()` / `synth.panic()` | Release active gates naturally / immediately clear all logical voices, release/steal tails and spill. Panic notifies active notes with terminal reason `cancelled`. |
| `synth.setMixGain(gain)` / `synth.setTuning(tuning)` | Replace mix drive / tuning without phase or envelope reset; return no value. |
| `synth.render(left, right, offset = 0, length = nativeLeftLength - offset)` | Write native `Float32Array`s; nonnegative safe-integer offset/length must fit both actual buffers. Shadow metadata/methods cannot enlarge work; proxies/forgeries and coercible nonnumbers reject. Split calls at offline events. Center pan is dual mono. |
| `synth.currentFrame`, `synth.errorCount`, `synth.lastStolenId` | Cumulative frames, numerical-failure count, and stolen ID (`null` when the last successful note-on stole none). |
| `synth.onVoiceEnded = (id, reason) => …` | Exactly-once terminal notification (`stolen`, `ended`, `error`, `cancelled`). Slots recycle before callbacks; replacements first render next frame. Recursive `render()` rejects. A stolen note's fade can outlive its notification. |
| `renderNote({ voice, note = 60, duration = 0.5, velocity = 1, pan = 0, sampleRate = 44100, mixGain = 1, tuning = {}, stealing = 'oldest' })` | Return `{ samples, left, right, sampleRate, diagnostics: { errors } }`, with `samples === left`. Complete voice required; finite note/duration/velocity/pan clamp to 0–127/0–30/0–1/−1–1. Integer sample rate 8000–96000; synth options validate strictly. |
| `encodeWav({ left, right?, sampleRate })` | Return PCM16 little-endian RIFF/WAVE `Uint8Array`; omit right for mono. Float32 arrays must contain finite samples in −1–1; stereo lengths must match. Invalid amplitudes reject rather than clip. Sample rate: integer 8000–192000; frame budget: 4,000,000. |

`renderNote()` uses `Synth` for identical envelope timing, LFO, filtering, velocity, pan, and saturation. It retains `ceil((duration + longestEffectiveRelease + 0.01) * sampleRate)` frames, including note-dependent rate scaling, with a 4,000,000-frame budget.

`Synth` preallocates `maxVoices + 9` state slots: logical voices, eight possible fades and one admission scratch slot. Prepared admission allocates no new per-voice typed state. Browser snapshots use a content-keyed 128-slot LRU cache; validated replacement reuses a registration ID after saturation rather than falling back to inline transport. Queued/active notes retain their original immutable prepared snapshot. Raw browser inputs still validate freshly.

Pan uses a center-normalized constant-power law: left/right gains are `sqrt(2) * cos/sin((pan + 1) * pi / 4)` before saturation. Center preserves the previous per-channel gain; hard sides mute the opposite channel and boost the selected channel by `sqrt(2)`. This does not promise constant loudness after polyphonic saturation.

Other core exports: `normalizeVoice(voice)` makes a strict detached copy; `envelopeAt(time, gate, adsr)` evaluates the dB-domain envelope; `ALGORITHMS` contains eight immutable routing graphs; `HEADROOM` is 0.7, `OVERSAMPLE` is 4, and `MAX_RENDER_SAMPLES` is 4,000,000. `sampleRateValue(value)` validates an integer rate of 8000–96000. Schema helpers are described below.

### Mix gain and tuning

`mixGain` is finite 0–1 (default 1), applied **before** final `tanh` saturation; lowering a downstream GainNode cannot undo saturation distortion. Zero mutes PCM without stopping note progression. Host gain remains responsible for listening volume.

`tuning: { referenceHz = 440, offsets }` replaces the complete global tuning. Reference A4 is 20–20000 Hz; omitted offsets mean zero, otherwise supply exactly 128 finite cents offsets in −4800..4800. Inputs are detached/frozen. Fractional MIDI interpolates neighboring offsets, with MIDI 127 using its own endpoint. Retuning preserves phase/envelopes and does not change the original note used for key scaling. `normalizeTuning` and `tuningFrequency` are also core exports.

### Shared live/offline scores

`SequenceEvent` is a note `{ type: 'note', id, time, duration, note, voice?, velocity?, pan? }`, explicit stop `{ type: 'stop', id, time }`, or control `{ type: 'control', id, time, controls }`. Times are score-relative seconds; note IDs are unique positive safe integers and commands must reference score notes. Omitted voice is brass. Whole-score validation/detachment precedes submission. Limits: 128 notes, 256 reserved slots (two per note plus explicit commands), and 60 seconds including gates/commands. Controls before onset apply at onset; same-frame stop precedes onset, then controls.

```js
import { playSequence } from 'opm.js';
import { renderSequence, encodeWav } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const events = [
  { type: 'note', id: 1, time: 0, duration: 0.4, voice: 'lead', note: 60.5 },
  { type: 'control', id: 1, time: 0.1, controls: { pan: -0.5, expression: 0.7, ramp: 0.03 } },
];
const voices = new Map([['lead', brass]]);
const offline = renderSequence(events, { voices, sampleRate: 48000, mixGain: 0.5, tuning: { referenceHz: 442 } });
const wav = encodeWav({ left: offline.left, right: offline.right, sampleRate: offline.sampleRate });
// In a browser gesture, with an initialized OPM using the same gain/tuning:
// opm.loadVoice('lead', brass);
// const playback = playSequence(opm, events, { at: opm.context.currentTime + 0.05 });
// playback.stop(); // idempotent; affects only that playback's original node
```

`playSequence` returns `{ ids: ReadonlyMap<scoreId, noteId>, stop() }`; acceptance still arrives through OPM events. It is not an atomic reservation against other callers filling the worklet queue. `prepareSequence(events, { voices })` exposes the immutable resolved score; `renderSequence(events, { voices, sampleRate, mixGain, tuning, stealing })` returns the usual stereo result, includes release tails, and enforces 4,000,000 frames. Live/offline sample parity assumes the same settings, sample rate, relative frame origin and no competing notes. Longer scores belong in bounded lookahead, not this helper.

#### Long scores without aggregate PCM

`prepareLongSequence` validates a separate maximum of 65,536 input events and 24 hours including gates/commands. `estimateSequenceCapacity` reports frame/PCM/chunk bytes and short-helper eligibility. `renderSequenceChunks` renders through the same Synth using two reusable buffers; chunks expose `offset` and valid `frames`. Consume/copy a chunk before requesting the next one. `cancel()`, iterator return or an AbortSignal prevents further advancement; optional `maxFrames` caps cumulative work. It does **not** enlarge WAV or full-buffer limits.

```js
import { estimateSequenceCapacity, renderSequenceChunks } from 'opm.js/core';
const score = [{ type: 'note', id: 1, time: 0, duration: 61, note: 60 }];
const options = { sampleRate: 96000, chunkFrames: 4096 };
console.log(estimateSequenceCapacity(score, options));
const render = renderSequenceChunks(score, options);
let frames = 0, energy = 0;
for (const chunk of render) {
  for (let i = 0; i < chunk.frames; i++) energy += chunk.left[i] ** 2;
  frames += chunk.frames; // No aggregate PCM retained.
}
console.log(frames, energy, render.diagnostics.errors);
```

`streamSequence(opm, score, { at, horizon, interval, maxSlots, signal, onError })` returns `{ running, ids, start(), pump(), stop(), dispose() }`. It validates the whole bounded long score, then schedules note/control/stop windows using held gates and incremental releases, preserving cross-window ID mappings and only cancelling its own notes. Start from a gesture; context interruption/reset stops the stream and requires explicit restart. Shared worklet admission remains bounded and is not atomically reserved against unrelated callers. See [streaming contracts, capacity and browser recipe](./doc/streaming-sequences.md) and [example 08](./examples/sequence.html).

### Physical-device recovery workflow

Use [example 08](./examples/sequence.html) over HTTPS on physical iOS/Android devices, following the [acceptance workflow and support matrix](./doc/mobile-acceptance.md). Record device/OS/browser/rate/policy, scenario observations and manual pass/fail/unverified results. Exercise both policies through lock/unlock, app switching, calls, headset/Bluetooth routes, battery saving, prolonged playback and main-thread stalls. Reports stay local and never certify untested devices. Desktop/headless checks and analyser peaks do not prove audible continuity or physical-phone recovery.

### WAV files and DX7 import

Save this as `export.mjs` in the installed application's root; `node export.mjs` writes a stereo file:

```js
import { writeFile } from 'node:fs/promises';
import { renderNote, encodeWav } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';
const audio = renderNote({ voice: brass, note: 60, duration: 0.7, velocity: 0.8, pan: -0.3 });
await writeFile('brass.wav', encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate }));
```

`importDX7(bytes)` from `opm.js/voices/dx7.js` returns complete normalized version 5 voices. It accepts exactly one standard framed/checksummed 163-byte single-voice or 4104-byte 32-voice bank SysEx message (`Uint8Array`), rejecting invalid framing, length, checksum, or non-7-bit data. `describeDX7(bytes)` returns per-voice `{name,sourceAlgorithm,algorithm,selectedOperators,droppedOperators,warnings}`; selected/dropped numbers refer to DX7 operators 1–6, source algorithms to 1–32, and converted algorithms to 0–7.

This remains an **approximate six-to-four-operator conversion**, not DX7 synthesis/emulation. Fixed-Hz operators are retained; operator velocity/rate scaling, pitch envelopes and LFO delay/sync are musical heuristics. Pitch-envelope stages are reduced; unsupported descending saw/sample-and-hold waveforms are substituted with warnings. Dropped operators/routing, oscillator sync, transpose, per-operator AM and envelope details still differ. Inspect descriptions and [expressive conversion limits](./doc/expressive-voices.md) before loading. The [audition](./examples/audition.html) uses original synthetic fixtures, not copied patches or a six-operator reference engine.

## Optimized distribution

Every `.js` in `dist/` has a matching `.js.map` and compiler-generated `.d.ts`, including eight example entry points and shared helpers. Engine modules preserve source paths; declarations derive from their modules. Safe minification retains composed maps with embedded TypeScript. Deploy the entire matching tree; publishing maps exposes its sources. Do not edit generated files. Build/package smoke rejects missing map/declaration companions.

Engine, worklet, demos, tests and development scripts use strict TypeScript. Following [XYZ.js](https://github.com/YueyuHoshizora/XYZ.js)'s approach, declarations derive from implementation. Node.js 22+ is required. `tsconfig.json` checks source/emits declarations; `tsconfig.dev.json` emits ignored `.dev/`. ESM imports retain `.js` specifiers. Use `npm test`, not bare `node --test`; `npm run typecheck` includes tools/tests/demos/public consumers. The build produces matching `dist/demo/` entry points/helpers for eight examples; root `index.html` is their catalog.

In the **repository checkout**, not the installed npm package:

```sh
npm ci
npm run build
npm test
npm run benchmark
npm run typecheck
npm run security
npx --no-install playwright install --with-deps chromium
npm run browser-smoke -- chromium
npm run browser-stress -- chromium
npm run sound-quality
npm run voice-quality
npm run vite-smoke
```

These install pinned development tools and regenerate `dist/`; the build replaces that generated directory. Consumers need no build tools or runtime dependencies. `npm pack` also runs the build automatically. Terser uses up to ten safe compression passes, without unsafe floating-point transformations or property mangling.

The build does not produce JSON assets or gzip/Brotli sidecars. If desired, configure compression at the web host while retaining normal `.js` import URLs. Send the matching `Content-Encoding` and `Vary: Accept-Encoding` only for compressed responses, with a JavaScript MIME type. The basic Python server serves the ordinary `.js` modules directly.

Benchmark results depend on the machine and JavaScript engine. [CHANGELOG](./CHANGELOG.md) records observed verification, and [SECURITY](./SECURITY.md) covers safe embedding and review requirements.

Quality automation configures Node 22/24/26 and Chromium/Firefox/WebKit smoke scenarios with real AudioWorklet output; browser installation is a development-only prerequisite. Headless Linux Firefox additionally needs a running native audio server; CI starts PulseAudio with a null output sink (see the [quality instructions](./doc/usage.en.md#quality-and-release-acceptance)). Configuration alone does not prove successful runs or all-platform coverage: observed checks belong in CHANGELOG. `npm run security -- --package-smoke` exercises installed exports/types. No fallback masks browser failure.

The real-time benchmark reports warmed 128-frame block p95/p99/worst and misses against `128/sampleRate` seconds. Local defaults are report-only; optional `OPM_BENCH_P99_BUDGET_RATIO` / `OPM_BENCH_WORST_BUDGET_RATIO` enforce host-specific budgets. Run deadline acceptance separately from CPU-heavy offline rendering; competing workloads can change its outcome. CI configures p99 ratio 1 at 48 kHz (2.667 ms), with worst/GC stalls report-only. Four-times oversampling/filtering and controlled spectral tests do not promise arbitrary alias-free FM or deadlines on every host.

`sound-quality` renders 1,728 cases across four sample rates, all algorithms, feedback extremes, registers, velocities and polyphony. It checks finite/headroom/release/deterministic/chunk-independent output and controlled passband, THD and folded aliases. `voice-quality` evaluates the curated preset bank and original synthetic DX7 recipes over register/velocity cells. Peak/RMS are raw dBFS, not LUFS or perceived loudness; host trims do not rewrite synthesis levels. See [voice-quality notes](./doc/voice-quality.md).

Independent references cover Bessel-series high-index PM, contractive delayed feedback, conservative full-level feedback energy, and nested four-operator chain/branched/multicarrier synthesis. The per-voice 4× decimator uses an eighth-order Butterworth cascade for a flatter audible passband with controlled stopband checks. Two 120-second streaming cases exercise held AM/PM and glide retargets. See [acoustic reference mathematics and limits](./doc/acoustic-quality.md); none certify arbitrary alias-free FM, perceptual quality or hardware fidelity.

`browser-stress` exercises real AudioWorklet output, dense admissions/steals, controls, late rejection and queue cleanup under bounded main-thread contention. Timer gaps and diagnostic round trips are observations, **not** worklet CPU/GC/underrun/glitch measurements. Periodic analyser samples cannot prove uninterrupted audio. The Vite smoke additionally verifies an installed current tarball, non-root production deployment, retained license, CSP and negative asset/MIME cases. Run these separately from deadline benchmarks.

## Voice format

A voice has four operators, an algorithm (0–7), and feedback (0–7). This is a canonical version 5 entry. Single objects may omit `version`, `name`, `modIndex` (4), and `lfo` (off/sine). Explicit versions 1–4 retain their original shapes and normalize to 5: v1 excludes key scaling, v1/2 exclude velocity sensitivity, v1/2/3 exclude waveform, and v1–4 exclude all newly added v5 fields.

```json
{
  "version": 5,
  "name": "brass",
  "algorithm": 4,
  "feedback": 3,
  "modIndex": 4,
  "lfo": { "rate": 5.2, "amDepth": 0, "pmDepth": 12, "waveform": "sine" },
  "ops": [
    { "ratio": 1.0, "level": 0.8, "detune": 0, "velocitySensitivity": 12,
      "adsr": { "a": 0.01, "d": 0.2, "s": 0.6, "r": 0.1 },
      "keyScale": { "breakpoint": 60, "leftDbPerOctave": 0, "rightDbPerOctave": 6 } },
    { "ratio": 1.0, "level": 0.6, "detune": 3,
      "adsr": { "a": 0.01, "d": 0.15, "s": 0.5, "r": 0.1 } },
    { "ratio": 2.0, "level": 0.4, "detune": -3,
      "adsr": { "a": 0.02, "d": 0.3, "s": 0.4, "r": 0.15 } },
    { "ratio": 1.0, "level": 0.7, "detune": 0,
      "adsr": { "a": 0.01, "d": 0.2, "s": 0.55, "r": 0.1 } }
  ]
}
```

For `OPM`, `Synth.noteOn()`, and `normalizeVoice()`, `algorithm`, `feedback`, and exactly four complete operators are required; the optional metadata/defaults are described above. Unknown fields, accessors, sparse operator arrays, incorrect types, non-finite numbers, and out-of-range values are rejected.

| Voice field | Allowed values |
| --- | --- |
| `version`, `name` | Version 5; legacy 1/2/3/4 accepted only with their old fields; name: 1–64 ASCII letters, digits, `_`, or `-` |
| `algorithm`, `feedback` | Integers 0–7 |
| `ratio`, `level`, `detune` | 0.125–32, 0–1, −1200–1200 cents |
| `adsr.a`, `adsr.d`, `adsr.s`, `adsr.r` | Attack/decay/release: 0–10 seconds; sustain: 0–1 |
| `modIndex` | 0–16 |
| `lfo.rate`, `lfo.amDepth`, `lfo.pmDepth` | 0–20 Hz, 0–1, 0–1200 cents |
| `lfo.waveform` | `sine` (default), `triangle`, `saw`, `square`; v4/v5/current shape only |
| `ops[i].keyScale` | Optional; `breakpoint`: MIDI integer 0–127; `leftDbPerOctave`, `rightDbPerOctave`: 0–24 dB/octave |
| `ops[i].velocitySensitivity` | Optional since v3: 0–48 dB attenuation at velocity zero; omitted is 0 |
| `ops[i].frequency` | Optional v5 fixed frequency 1–20000 Hz; overrides note-derived ratio frequency, with detune/live pitch/PM still applied |
| `ops[i].rateKeyScale` | Optional v5 0–4: ADSR times multiply by `2 ** (-rateKeyScale * (note - 60) / 12)`, clamped to 10 seconds; default 0 |
| `pitchEnvelope` | Optional v5 `{a,d,r,initial,peak,sustain,final}`; times 0–10 seconds, levels −4800..4800 cents, continuous linear-cents release |
| `lfo.delay`, `lfo.sync`, `lfo.phase` | Optional v5 0–10 seconds, `'note'`/`'global'` (default note), 0–1 turns (default 0); delay gates depth, not the phase clock |

See the [expressive voice reference](./doc/expressive-voices.md) for pitch composition, fixed-frequency behavior and synchronization. Ratio remains required even when frequency is supplied. Preserve the source patch version when importing older banks; changing a version number alone does not add unsupported fields to its legacy shape.

Key scaling attenuates operator level by `10 ** (-slope * abs(note - breakpoint) / 12 / 20)` on the corresponding side; omitted scaling is flat. Velocity sensitivity additionally multiplies it by `10 ** (-sensitivity * (1 - velocity) / 20)`, changing carrier loudness and modulator brightness. Final note velocity still multiplies the output; default sensitivity 0 preserves legacy sound. Pan belongs to the note, not the voice.

### Voice banks

Import `parseVoiceBank` from `opm.js/voices/schema.js` in Node, or `./opm/voices/schema.js` in the deployed browser example. It accepts a JSON string or array and returns `Map<name, voice>` with frozen copies.

A bank must be an **array** of 1–128 complete versioned voices; wrap individual JSON examples in `[...]`. Every bank entry requires `version`, `name`, `algorithm`, `feedback`, `modIndex`, `lfo`, and four complete operators; names must be unique. JSON strings are capped at 256 KiB in UTF-8. The [schema module](./dist/voices/voice.schema.js) exports `voiceSchema`; the [example bank module](./dist/voices/examples.js) exports `examples`. Import `examples` from `opm.js/voices/examples.js` (Node) or `./opm/voices/examples.js` (browser) and pass it to `parseVoiceBank(examples)`. External JSON banks remain supported.

Unlike strict single-voice normalization, `validateVoice()`, `parseVoiceBank()`, and `renderNote()` **clamp finite out-of-range numeric fields** to the schema limits. Invalid types, non-finite values, unknown fields, unsupported versions, and invalid algorithm/feedback enums still fail. `validateVoice()` handles one complete voice; `bounded()` clamps a finite number; `LIMITS`, `MAX_BANK_BYTES`, and `MAX_BANK_VOICES` expose the bounds.

The guides include complete browser loader examples with HTTP-status checks and error handling. The engine does not fetch URLs: its string-size check runs only after your application has obtained the text. Bound untrusted downloads before buffering them; do not treat the bundled-example loader as a hardened external downloader.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| npm returns E404 for `opm.js` | Use the local tarball installation recipe above; do not assume a registry release exists. |
| `AudioWorklet is not available`, or `file://` fails | Use a supporting browser over HTTPS/localhost. In Node, use `Synth`, not `OPM.start()`. |
| Bare module specifier cannot be resolved | Use the browser's `./opm/...` URLs and copied assets, not npm names in raw HTML. |
| Processor/module 404 or JavaScript MIME error | Preserve the complete distribution layout; ensure asset URLs serve JS, not a single-page app's HTML fallback. |
| No sound, or “Call start() before playNote()” | Await `start()` inside a click handler; inspect the displayed error and browser/device audio settings. |
| Invalid note, duration, or unknown voice | Check finite fractional MIDI 0–127, duration (`null` or `(0,60]`), velocity/pan, and registered voice name. |
| Notes disappear | Observe `onEvent` rejections/steals and `getDiagnostics()`; respect voice and queue bounds and schedule smaller batches. |
| Bank import fails | Use an array of complete versioned voices with unique names, not a single partial voice object. |
| Offline script makes no speaker sound/file | PCM buffers do not play themselves; use `encodeWav` and a file/download API to save them. |
| Compressed assets fail to load | Import `.js`; configure content-encoding negotiation or serve the normal minified files. |


## Architecture

```
┌─────────────────────────────────────────────┐
│ main thread                                 │
│   playNote() / control messages             │
└──────────────┬──────────────────────────────┘
               │ MessagePort
┌──────────────▼──────────────────────────────┐
│ AudioWorklet processor                      │
│   voice allocation → operator graph         │
│   4-op FM (8 algorithms, feedback)          │
│   ADSR + LFO → stereo out                   │
└─────────────────────────────────────────────┘
```

## Roadmap

- [x] v1.0 — 4-operator FM engine, eight algorithms, feedback, ADSR, LFO, detune, browser API, and offline rendering
- [x] v1.2 — key scaling, approximate DX7 SysEx voice import, and WAV export (regression tests and actual browser demo/import/download verified; see CHANGELOG for evidence and limits)

## Limitations

- Not a register-level YM2151 emulator; VGM playback is out of scope
- Bundled sounds are original curated recipes, not a comprehensive commercial bank; bring your own sounds.
- Four-times oversampling and the Butterworth decimator reduce controlled folded aliases; arbitrary FM can still alias and filters have phase/delay tradeoffs.
- Numerical host trims are not perceptual loudness matching. DX7 conversion remains six-to-four-operator and intentionally lossy; no hardware-fidelity or all-device glitch-free guarantee is made.

## License

[Apache License 2.0](./LICENSE)

Copyright 2026 OPM.js authors

OPM.js is an independent project inspired by the architecture of the Yamaha YM2151. It is not affiliated with, endorsed by, or connected to Yamaha Corporation.
