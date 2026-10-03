# OPM.js

**A 4-operator FM synthesis engine for the browser, inspired by the Yamaha YM2151 (OPM) sound chip.**

OPM.js recreates the classic 16-bit era FM sound — four-operator synthesis with a default eight-voice budget (configurable up to 32), multiple algorithms, feedback, and ADSR envelopes — as a lightweight, zero-runtime-dependency TypeScript engine powered by the Web Audio API, distributed as JavaScript ES modules.

> **Status:** the current checkout is package 1.11.0 (unreleased): voice format v7 with per-operator waveforms and held noise, optional stereo chorus/reverb, MIDI program-to-voice maps with RPN bend sensitivity, and approximate `.opm` patch import. The latest published [v1.10 GitHub release](https://github.com/JS-PACKAGE/OPM.js/releases/tag/v1.10) (package 1.10.0) uses voice format v6; runtime dependencies remain empty. Voice v1–v6 inputs remain accepted.
>
> GitHub release distribution and npm registry publication are separate. Use the release tarball or a source checkout; no npm publication is implied. See the [compatibility policy](./doc/compatibility.md).

Usage guides: [English](./doc/usage.en.md) · [繁體中文](./doc/usage.zh-TW.md).

**Online demos (HTTPS): [opm.js-package.xyz](https://opm.js-package.xyz/).** Click a playback button to grant audio startup; physical-device and listening acceptance remain separate from a working web page.

## New in v1.11

These APIs are in the current checkout and are not part of the published v1.10 archive. Physical-device, MIDI-hardware and human-listening acceptance remain unverified.

- Voice format v7: per-operator `waveform` (`sine`, `half`, `abs`, `quarter`, `alternating`, `camel`, `square`, `saw`, `noise`) and `noiseRate`; see [Voice format](#voice-format) and the [expressive voice reference](./doc/expressive-voices.md).
- Three original noise-based percussion recipes (`noise-snare`, `noise-hihat`, `explosion`) in the bundled bank.
- Optional stereo chorus and reverb, usable offline (`createStereoEffects`, `applyEffects`) and live (`createEffects`): [audio buses](./doc/audio-buses.md).
- MIDI `programVoices`/`drumVoices` maps, GM-family starter maps and RPN 0 bend sensitivity for files and the live adapter: [MIDI files](./doc/midi-files.md), [MIDI performance](./doc/midi-performance.md).
- `importOPM`/`describeOPM` for approximate conversion of VOPM/MXDRV-family `.opm` text patches: [expressive voices](./doc/expressive-voices.md).

## New in v1.10

These APIs and examples are included in v1.10. Historical release archives remain unchanged. GitHub distribution does not imply npm publication or deployment. Source contributors run `npm ci` and `npm run build`; consumers can install the release tarball without a build toolchain.

- Inert, bounded version-1 Arrangement parse/save/load through root/core APIs; authored definitions replay from beat 0, not DSP checkpoints: [portable Arrangement projects](./doc/score-projects.md#portable-arrangement-projects).
- Opt-in expressive Standard MIDI files with `lossSummary`; default `controls: 'omit'` keeps note-only behavior: [MIDI files](./doc/midi-files.md).
- Workload-scoped measured capacity candidates, not universal device limits: [acoustic quality](./doc/acoustic-quality.md).
- Bounded local MIDI capture and physical-device/listening campaign readiness: [MIDI performance](./doc/midi-performance.md). Physical/mobile/MIDI and human-listening acceptance remain unverified until genuine observations are supplied.
- A [cross-feature contract table](./doc/host-integration.md#cross-feature-contracts) connects replay, rendering, performance and host boundaries. Existing thirteen demos include two original songs, Play/Stop, score-project save/load and WAV export.
- Static [HTML documentation](./doc/index.html) and a complete [generated API reference](./doc/api.html) are rebuilt after distribution emit and included under `doc/` in locally built packages. Markdown remains the source of truth. Open `doc/index.html` locally or serve the whole `doc/` directory; navigation and local search require no server or runtime dependencies.

Choose a workflow: [try the demos](#try-the-checkout) · [install into an npm project](#install-into-an-npm-project) · [deploy in a browser](#use-in-a-browser) · [render in Node.js](#render-in-nodejs) · [API reference](#api-reference) · [troubleshooting](#troubleshooting).

## About

The Yamaha YM2151 (OPM) powered a generation of arcade boards and the Sharp X68000, defining the sound of the mid-1980s with its 8-channel, 4-operator FM architecture. OPM.js brings that architecture to the browser with a TypeScript implementation and directly deployable JavaScript.

OPM.js is a musically-accurate reimplementation, not a cycle-accurate hardware clone: envelope timing and modulation curves are tuned to sound correct rather than to reproduce silicon behaviour bit-for-bit.

## Features

- **4-operator FM synthesis** with 8 connection algorithms and hardware-style feedback
- **Per-operator dB-domain ADSR**, level/rate key scaling, velocity sensitivity and optional fixed-Hz oscillators
- **Per-voice pitch envelope and LFO** with four AM / PM waveforms, delay, phase, note/global synchronization and per-operator depth targets
- **Configurable 1–32-voice polyphony** (default 8; larger budgets are opt-in) with oldest, release-first or quietest stealing, per-note **voice priority** that protects melodies, and at most eight bounded ~5 ms stealing fades
- **Smooth live timbre controls** — independent pitch, expression/pan/modulation/level, feedback, ratio/fixed-Hz and LFO ramps; editable ADSR anchored at current dB
- **Audio-clock scores and musical Transport** — pause/resume, seek, loop, BPM/tempo maps with **linear tempo ramps**, beat/bar conversion, quantization and swing helpers
- **Adaptive music** — looping layers and sections that switch on beat/bar boundaries while shared layers keep sounding
- **Part-scoped performance policies** — sustain, poly/mono legato, last/high/low priority, per-key and per-part live controls, voice limits, and an optional user-granted **Web MIDI** adapter
- **Prepared immutable patches and pooled DSP state** — reuse bounded voice slots instead of allocating typed state on every admission
- **Incremental PCM16/PCM24/Float32 WAV export** with static Worker rendering, progress, cancellation and sink backpressure; approximate six-to-four-operator DX7 import
- **Pre-saturation mix gain and global tuning** — reference A4 and interpolated 128-note cents offsets
- **DSP quality profiles** — eco 2×/fourth-order, default standard 4×/eighth-order and high 8×/eighth-order; bounded state and explicit CPU/aliasing tradeoffs
- **Atomic voice-bank replacement, removal and JSON export** preserving queued/sounding patch snapshots
- **TypeScript declarations** for browser, core, and voice-module exports
- **AudioWorklet-based DSP** — synthesis runs off the main thread
- **Optional stereo chorus and reverb** — the same pure DSP offline and in a separate opt-in AudioWorklet; no built-in mixer
- **Zero runtime dependencies**, built on the Web Audio API
- Works in the browser and Node.js (offline rendering)

## Requirements

- Modern browser with ES modules and AudioWorklet (served over HTTPS or localhost)
- Node.js 22+ for offline rendering and tests

## Getting started

### Try the checkout

Obtain the [v1.10 source archive or checkout](https://github.com/JS-PACKAGE/OPM.js/tree/v1.10) to run the thirteen examples. HTML pages, Vite tooling and development programs are checkout-only, not included in the installable `.tgz`. Links to these resources below open their repository files; serve the corresponding local HTML to run them. Repository commands run in the directory containing `package.json`, `src/`, and `scripts/` (called `OPM.js` in the examples).

The committed `dist/` is ready to use; trying the demos needs no npm installation or build. With Python 3 available, run from that repository root:

```sh
python3 -m http.server 8000
```

Open **http://localhost:8000/index.html** for the English example catalog:

| Example | Demonstrates |
| --- | --- |
| [Basic notes and voices](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/basic.html) | Presets, pitch, velocity, timed and held notes |
| [Melody and chord scheduling](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/song.html) | *Twinkle, Twinkle, Little Star*, absolute timing, bounded lookahead and cancellation |
| [Live expression and per-voice LFO](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/modulation.html) | Bend/glide a held note; change expression, pan and modulation; scheduled release |
| [Shared AudioContext and routing](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/context.html) | Host GainNode, manual routing, diagnostics and borrowed-context ownership |
| [Offline synthesis and WAV](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/wav.html) | Stereo PCM, frame counts and PCM16 WAV without an AudioContext |
| [Advanced playground](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/playground.html) | Key scaling, suspend/resume, diagnostics and approximate DX7 import |
| [Preset and DX7 audition](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/audition.html) | Register/velocity grid, A/B comparison, raw peak/RMS reports and rendered WAV |
| [Scores, Transport and performance](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/sequence.html) | Pause/seek/loop/tempo, sustain/mono priority, live controls, quality/bank tools, multi-format Worker export and physical-device observations |
| [Adaptive game music](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/adaptive.html) | Boundary-quantized section/layer switching, tempo ramp, swing, voice priority |
| [Playable instrument and Web MIDI](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/instrument.html) | Mono lead + limited poly pad, per-part/per-key controls, optional user-granted MIDI |
| [Independent buses and stems](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/buses.html) | Three OPM instances on one AudioContext, separate gain/filter/echo, offline stems |
| [FM sound designer](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/sound-design.html) | Operators, algorithm graph, dB envelopes, selective LFO, live edits, patch JSON |

Click a playback button to start audio. Stop the server with Ctrl+C when finished. Do not open the HTML through `file://`. Pages and runtime messages are English; TypeScript helpers live in `demo/`.

If `dist/` is missing or you have changed `src/` or `demo/` TypeScript, regenerate it using the [development commands](#optimized-distribution) first.

### Install into an npm project

Download [opm.js-1.10.0.tgz from the v1.10 release](https://github.com/JS-PACKAGE/OPM.js/releases/download/v1.10/opm.js-1.10.0.tgz), then install it from your application's root:

```sh
npm install /actual/path/to/opm.js-1.10.0.tgz
```

No checkout or consumer build is required. The registry package name does **not** guarantee npm publication; do not substitute `npm install opm.js` or an assumed CDN URL. The v1.10 asset includes these synchronized guides; the original v1.8 tag and archive remain unchanged.

To build a local tarball instead, run from the `OPM.js` source checkout with Node.js 22+ and npm:

```sh
npm ci
npm pack
```

`npm pack` builds automatically and produces `opm.js-1.10.0.tgz`. To create a new application beside the checkout:

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.10.0.tgz
```

For an existing application, run only the install command from its root, adjusting the tarball path. Consumers do not install the engine's development dependencies or need a build step. The installed package contains minified JS, `.js.map` source maps with embedded TypeScript, generated `.d.ts` declarations, demo scripts, usage documentation, and legal files—not HTML demo pages, separate source files, or build scripts.

For a bundled host, use the checkout-only [installed-package Vite example](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/vite/README.md): it preserves the complete engine/worklet/Worker tree and license, supports a non-root deployment base, and checks production CSP, MIME types and missing assets. Maintainers can follow the [package verification and publication prerequisites](./doc/publishing.md); this checkout has no npm publishing workflow, and authentication/provenance must be established separately.

### Use in a browser

From the installed application's root, use the package's deployment CLI with a fresh destination:

```sh
npx --no-install opm-assets copy public/opm
```

The CLI copies the complete `dist/` tree plus `LICENSE`, hashes the assets, and never overwrites a differing destination. Repeating an identical deployment reuses it. POSIX `mkdir -p public/opm`, `cp -R node_modules/opm.js/dist/. public/opm/` and `cp node_modules/opm.js/LICENSE public/opm/LICENSE` remain an equivalent manual layout, but without the CLI's verification and overwrite protection.

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
    worker/
    tools/
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

The following reference describes v1.10. Historical release archives remain unchanged. The [compiler-generated reference](./doc/api.html) includes every public root/core/voice/tool export and its full declarations; it is refreshed by `npm run build`. See the [cross-feature contract table](./doc/host-integration.md#cross-feature-contracts) for IDs, lifecycle observations, ownership and persistence.

All times are in seconds unless stated otherwise. Browser and Node examples intentionally use different import styles:

| Exports | Installed npm import | Browser URL in the layout above |
| --- | --- | --- |
| `OPM`, `createLookaheadScheduler`, `playSequence`, `streamSequence`, `createTransport`, `createArrangement`, `createPerformance`, `renderSequenceInWorker` | `opm.js` | `./opm/api/index.js` |
| `Synth`, `renderNote`, core helpers | `opm.js/core` | `./opm/core/index.js` |
| Score/Arrangement project parsers, serializers and `compileBeatSequence` | `opm.js` or `opm.js/core` | `./opm/core/index.js` |
| `importMidiFile`, `exportMidiFile` | `opm.js/midi-file`, root or core | `./opm/core/midi-file.js` |
| `brass` | `opm.js/voices/brass.js` | `./opm/voices/brass.js` |
| `parseVoiceBank`, `validateVoice`, schema helpers | `opm.js/voices/schema.js` | `./opm/voices/schema.js` |
| `importDX7`, `describeDX7` | `opm.js/voices/dx7.js` | `./opm/voices/dx7.js` |
| `importOPM`, `describeOPM` | `opm.js/voices/opm.js` | `./opm/voices/opm.js` |

### Browser: OPM

| Call | Contract |
| --- | --- |
| `new OPM({ sampleRate, context, destination, workletUrl, onEvent, mixGain = 1, tuning = {}, stealing = 'oldest', interruption = 'cancel', quality = 'standard', maxVoices = 8 } = {})` | Optional integer sample rate 8000–96000 Hz; voice limit 1–32 (default 8; each voice costs CPU). Quality and polyphony are immutable and survive node recreation. Borrow an existing `AudioContext`; OPM never closes or suspends it. Omit `destination` to use its destination, or use `null` for explicit routing. Optional `workletUrl` relocates the complete secure same-origin worklet module tree without relaxing CSP/MIME checks. |
| `await opm.start()` / `await opm.resume()` | Initialize/resume the context and worklet from a user gesture; concurrent starts coalesce. Existing contexts are resumed after browser suspension. Await before playing. |
| `opm.connect(destination)` / `opm.disconnect(destination?)` | Connect/disconnect the started worklet output; return `opm`. Omitted disconnect destination removes all output connections. Destination must belong to the same context. |
| `opm.loadVoice(name, voice)` | Strictly validate/copy a voice; register/replace a name for future notes, at most 128 entries. Name: 1–64 ASCII letters, digits, `_`, or `-`. Works before `start()`. |
| `opm.replaceVoiceBank(source)` | Atomically validate and replace the entire registry from bank JSON or a complete voice array. Maximum 128 entries/256 KiB JSON; a plain empty array clears it. Failure leaves the old bank unchanged. |
| `opm.removeVoice(name)` / `opm.exportVoiceBank()` | Remove a lookup and return a boolean / export detached canonical named JSON, capped at 256 KiB. Existing queued/sounding notes keep their immutable patches. An empty bank exports `[]`. |
| `opm.playNote({ voice = 'brass', note, time = 0, at, duration = null, velocity = 1, pan = 0, voicePriority = 0, late = 'start' })` | Return a positive safe-integer ID without wrapping. Finite fractional MIDI 0–127; use either relative `time` (0–60 seconds) or absolute nonnegative AudioContext `at` (at most 60 seconds ahead), never both. Duration `(0,60]` or `null` holds until stop; velocity 0–1; pan −1–1; `voicePriority` an integer 0–127 (higher cannot be stolen by lower; see [audio buses](./doc/audio-buses.md)). Requires `start()`. |
| `opm.stop(id, options = {})` | Return a command ID. Optional `at` schedules cancellation/release; ordinary stop retains release-tail automation. Immediate `{ cancelControls: true }` also removes that ID's queued controls/off/onset. `cancelControls` cannot coexist with `at`, even when false. Unknown/already-released ordinary targets reject; release is not immediate mute. |
| `opm.updateNote(id, controls, { at } = {})` | Return a command ID. Apply immediately or at an absolute audio time. Controls before onset persist for that pending note; released notes remain controllable until they end. Invalid/inactive/queue-full commands report rejection. |
| `opm.allNotesOff()` / `opm.panic()` | Return a command ID; both bypass a full scheduled-event queue. All-notes-off cancels pending onsets/automation and releases active gates naturally. Panic removes every active/release/steal tail immediately and emits a reset; routing and prepared patches survive. |
| `opm.setMixGain(gain)` / `opm.setTuning(tuning)` | Require a started node and return a command ID. Replace the setting immediately; retain it across node recreation. They affect active and future voices without restarting envelopes/phases. |
| `opm.voices` | Defensive `ReadonlyMap` of deeply frozen patches; mutate the registry only through its bank/load methods. |
| `await opm.getDiagnostics()` | Return `{ type: 'diagnostics', requestId, activeVoices, pendingEvents, errors, rejectedNotes }`. Requires running context; at most 64 outstanding requests. Suspend/close/processor failure rejects pending requests; resume before retrying. |
| `await opm.close()` | Serialize disposal against initialization, disconnect the node, and close only an owned context. Emit a global `reset: close`; teardown/failure does not guarantee individual terminal note replies. A later `start()` recreates owned contexts; borrowed contexts remain usable. Cancel application timers separately. |
| `opm.subscribe(listener)` | Multicast event subscription; returns an idempotent unsubscribe function. Listener exceptions are isolated. |
| `await opm.waitForCommand(commandId, { timeout, signal } = {})` | Cancellable admission acknowledgement; timeout default 5000 ms, integer 1–60000 ms; 64 pending waits/128 retained receipts. Rejection throws `CommandRejectedError`; timeout, abort and teardown reject. Acceptance is not scheduled execution/completion. |
| `await opm.dispose()` | Terminal disposal, including listener/helper cleanup. Unlike restartable `close()`, a disposed instance cannot start again. |

`onEvent(event)` receives `{ type: 'note', id, state, reason?, frame, time }` with states `accepted`, `started`, `released`, `ended`, `stolen`, `cancelled`, or `rejected`; `frame`/`time` report actual admission, dispatch or completion boundaries. It also receives diagnostics, processor errors, `{ type: 'command', command, commandId?, id?, state: 'accepted' | 'rejected', reason?, frame, time }`, `{ type: 'context', state, frame, time }`, and `{ type: 'reset', reason, commandId?, frame, time }`. Command-triggered resets carry their initiating ID independently of receipt-cache retention. Command acceptance means admission/immediate application, **not guaranteed future execution**; correlate by `commandId`. Reset reasons are `close`, `failure`, `panic`, and `interruption`: clear application gate bookkeeping on reset. Callback exceptions are isolated.

At most `maxVoices` logical voices (default 8, opt-in up to 32, including release tails) are active, with up to eight short fading remnants. `stealing: 'oldest'` is the default; `'release-first'` chooses the oldest released voice before held voices; `'quietest'` uses current carrier envelope × velocity × expression, not waveform zero crossings, with oldest ties. A full engine steals only among voices of equal or lower `voicePriority` (lowest first); if every voice outranks the new note it is refused with `rejected` reason `priority`, without changing anything else. The worklet bounds pending events and tracked note IDs to 256 each. Future timed notes use start/off events; held notes use a start event. Duplicate IDs and overflow reject before enqueueing; terminal events remove obsolete events. Schedule long pieces incrementally. More than eight voices and more buses cost CPU roughly linearly: measure on target devices.

`late: 'start'` preserves the full duration after the actual delayed start; `late: 'drop'` rejects a missed start with reason `late`, including worklet-delivery delays. Same-frame stops precede onsets, then controls. Scheduled stops/controls obey the same 60-second future horizon and 256-event bound.

`NoteControls` accepts nonempty subsets of `pitch` (−48..48 semitones), `glide` (0..10 seconds, requires pitch), `expression` (0..1), `pan` (−1..1), `modulation` (0..2), `operatorLevels` (four 0..2 multipliers), `feedback` (continuous 0..7), `lfoRate` (0..20 Hz), `amDepth` (0..1), `pmDepth` (0..1200 cents), `operatorRatios` (four 0.125..32 values), `operatorFrequencies` (four 1..20000 Hz values or `null` to restore ratio mode), and `operatorADSR` (four complete ADSR objects). `ramp` (0..10 seconds) independently interpolates supplied rampable controls; glide remains linear in semitones. Omitted controls retain state and oscillators keep phase/feedback history. ADSR edits **reanchor** from current dB: held notes restart attack, released notes begin their new key-scaled release; zero release silences the source and drains the filter. ADSR is not a rampable control. Fixed-Hz controls still follow live pitch but not tuning-table transposition. There is no global `setLFO()`. See [expressive controls](./doc/expressive-voices.md) and [host integration](./doc/host-integration.md).

Since v1.9: `gain` is an independent 0–1 multiplier, default 1, using the same `ramp` range. It composes with expression rather than replacing it and does not restart phase or envelopes.

`createLookaheadScheduler(opm, callback, { onError, horizon = 0.2, interval = 0.025, maxNotes = 32 })` returns `{ running, start(), stop(), dispose() }`. Its callback receives the half-open absolute window `{ from, to, maxNotes }` and returns at most `maxNotes` notes with `at` in that window and a numeric duration. Horizon is 0.02–10 seconds; interval is 0.005–1 second and less than horizon; maxNotes is an integer 1–128. At most 128 gates remain outstanding. Call `start()` from a gesture and handle its rejected promise; callback/admission errors stop the scheduler and reach required `onError`. Timer stalls skip missed windows rather than bursting old notes. Stop/dispose cancel only its notes and never close OPM. See the checkout-only [song demo](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/song.html) and both usage guides for executable recipes.

Any non-running context stops lookahead scheduling, as does a reset; `onError` reports it and restarting is explicit. Default `interruption: 'cancel'` clears existing notes and automation on suspension/interruption, preventing replay on resume. Opt-in `'preserve'` retains direct-note gates/queued events across suspension, but does not automatically restart lookahead. Resume from a fresh user gesture. A closed borrowed context must be replaced by its host.

### Offline: Synth and renderNote

| Call or property | Contract |
| --- | --- |
| `new Synth(sampleRate, maxVoices = 8, options = {})` | Required finite sample rate 8000–192000 Hz; integer voice limit 1–32. Options are `{ mixGain, tuning, stealing, quality }`, identical to OPM. No Web Audio is required. |
| `prepareVoice(voice)` | Strictly validate, detach and deeply freeze an opaque `PreparedVoice` once for repeated core admissions; forged lookalikes cannot bypass validation. |
| `synth.noteOn(voiceOrPrepared, note, id?, { velocity = 1, pan = 0, voicePriority = 0 } = {})` | Raw voices validate/copy each call; prepared patches reuse validated data. Finite fractional MIDI 0–127; explicit positive safe-integer ID unique among active notes; velocity 0–1; pan −1–1; `voicePriority` an integer 0–127. A full synth with no equal-or-lower-priority victim throws `VoiceAdmissionError` before changing state or consuming an ID. |
| `synth.noteOff(id)` | Begin release at current rendered time; return `true`, or `false` for unknown/already-released IDs. |
| `synth.updateNote(id, controls)` | Apply the same live controls; return `true` for an active/releasing note or `false` for an unknown/terminal ID. |
| `synth.allNotesOff()` / `synth.panic()` | Release active gates naturally / immediately clear all logical voices, release/steal tails and spill. Panic notifies active notes with terminal reason `cancelled`. |
| `synth.setMixGain(gain)` / `synth.setTuning(tuning)` | Replace mix drive / tuning without phase or envelope reset; return no value. |
| `synth.render(left, right, offset = 0, length = nativeLeftLength - offset)` | Write native `Float32Array`s; nonnegative safe-integer offset/length must fit both actual buffers. Shadow metadata/methods cannot enlarge work; proxies/forgeries and coercible nonnumbers reject. Split calls at offline events. Center pan is dual mono. |
| `synth.currentFrame`, `synth.errorCount`, `synth.lastStolenId` | Cumulative frames, numerical-failure count, and stolen ID (`null` when the last successful note-on stole none). |
| `synth.onVoiceEnded = (id, reason) => …` | Exactly-once terminal notification (`stolen`, `ended`, `error`, `cancelled`). Slots recycle before callbacks; replacements first render next frame. Recursive `render()` rejects. A stolen note's fade can outlive its notification. |
| `renderNote({ voice, note = 60, duration = 0.5, velocity = 1, pan = 0, voicePriority = 0, sampleRate = 44100, mixGain = 1, tuning = {}, stealing = 'oldest', quality = 'standard' })` | Return `{ samples, left, right, sampleRate, diagnostics: { errors } }`, with `samples === left`. Complete voice required; finite note/duration/velocity/pan clamp to 0–127/0–30/0–1/−1–1. Integer sample rate 8000–96000; synth options and integer `voicePriority` 0–127 validate strictly. |
| `encodeWav({ left, right?, sampleRate, format = 'pcm16' })` | Return little-endian RIFF/WAVE `Uint8Array`: PCM16, PCM24 or Float32. Omit right for mono. Native Float32 channels must contain finite samples in −1–1 and match lengths. Invalid amplitudes reject rather than clip; integer rate 8000–192000, full-buffer budget 4,000,000 frames. |
| `createWavEncoder({ sampleRate, channels, format = 'pcm16', totalFrames })` | Incremental RIFF32 output: `header()` once, `encode({ left, right? })` for 1–65536 frames per chunk, then `finalize()` at exactly the declared frame count. Channels: 1 or 2. Bounded encoded chunks and <4 GiB files, independent of the full-buffer frame limit. |

`renderNote()` uses `Synth` for identical envelope timing, LFO, filtering, velocity, pan, and saturation. It retains `ceil((duration + longestEffectiveRelease + 0.01) * sampleRate)` frames, including note-dependent rate scaling, with a 4,000,000-frame budget.

`Synth` preallocates `maxVoices + 9` state slots: logical voices, eight possible fades and one admission scratch slot. Prepared admission allocates no new per-voice typed state. Browser snapshots use a content-keyed 128-slot LRU cache; validated replacement reuses a registration ID after saturation rather than falling back to inline transport. Queued/active notes retain their original immutable prepared snapshot. Raw browser inputs still validate freshly.

Pan uses a center-normalized constant-power law: left/right gains are `sqrt(2) * cos/sin((pan + 1) * pi / 4)` before saturation. Center preserves the previous per-channel gain; hard sides mute the opposite channel and boost the selected channel by `sqrt(2)`. This does not promise constant loudness after polyphonic saturation.

Other core exports: `normalizeVoice(voice)` makes a strict detached copy; `envelopeAt(time, gate, adsr)` evaluates the dB-domain envelope; `ALGORITHMS` contains eight immutable routing graphs; `HEADROOM` is 0.7, `OVERSAMPLE` is 4, and `MAX_RENDER_SAMPLES` is 4,000,000. `sampleRateValue(value)` validates an integer rate of 8000–96000. Schema helpers are described below.

### Optional stereo effects

`createEffects(context: BaseAudioContext, options?: EffectsOptions): Promise<OpmEffects>` creates an unconnected stereo insert with `input`, `output`, `ready`, `update(params)`, `reset()` and `dispose()`. It never resumes or closes the host context. Route `opm.node` after `await opm.start()` into `fx.input`, then connect `fx.output` to your host graph.

`createStereoEffects(sampleRate, options?)` and `applyEffects(left, right, sampleRate, params)` are exported at root and `opm.js/core`. The engine processes native Float32 buffers in place with bounded preallocated delay state; the helper returns copies with a conservative tail and enforces the 4,000,000-frame budget. Options are `{ chorus?: { rate, depth, mix, feedback?, voices? }, reverb?: { size, damping, mix, preDelay?, width? }, order? }`. Updates replace the configuration with smooth ramps; omitted sections and mix 0 preserve finite dry input bit-for-bit. Wet paths reserve at least 3 dB headroom using a linear crossfade. [Ranges, gain law, memory bounds, routing and offline details](./doc/audio-buses.md#optional-stereo-chorus-and-reverb).

### Mix gain and tuning

`mixGain` is finite 0–1 (default 1), applied **before** final `tanh` saturation; lowering a downstream GainNode cannot undo saturation distortion. Zero mutes PCM without stopping note progression. Host gain remains responsible for listening volume.

`tuning: { referenceHz = 440, offsets }` replaces the complete global tuning. Reference A4 is 20–20000 Hz; omitted offsets mean zero, otherwise supply exactly 128 finite cents offsets in −4800..4800. Inputs are detached/frozen. Fractional MIDI interpolates neighboring offsets, with MIDI 127 using its own endpoint. Retuning preserves phase/envelopes and does not change the original note used for key scaling. `normalizeTuning` and `tuningFrequency` are also core exports.

### Shared live/offline scores

`SequenceEvent` is a note `{ type: 'note', id, time, duration, note, voice?, velocity?, pan?, voicePriority? }`, explicit stop `{ type: 'stop', id, time }`, or control `{ type: 'control', id, time, controls }`. Times are score-relative seconds; note IDs are unique positive safe integers and commands must reference score notes. Omitted voice is brass; priority defaults to 0 and accepts integers 0–127. Whole-score validation/detachment precedes submission. Limits: 128 notes, 256 reserved slots (two per note plus explicit commands), and 60 seconds including gates/commands. Controls before onset apply at onset; same-frame stop precedes onset, then controls.

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

`playSequence` returns `{ ids: ReadonlyMap<scoreId, noteId>, stop() }`; acceptance still arrives through OPM events. It is not an atomic reservation against other callers filling the worklet queue. `prepareSequence(events, { voices })` exposes the immutable resolved score; `renderSequence(events, { voices, sampleRate, maxVoices = 8, mixGain, tuning, stealing, quality })` returns stereo PCM with conservative release-tail capacity, including live ADSR edits, and enforces 4,000,000 frames. `maxVoices` is an integer 1–32. Live/offline sample parity assumes matching settings, rate, frame origin and no competing notes. Longer scores use the separate chunked/streaming helpers.

#### Long scores without aggregate PCM

`prepareLongSequence` validates a separate maximum of 65,536 input events and 24 hours including gates/commands. `estimateSequenceCapacity` reports frame/PCM/chunk bytes and short-helper eligibility. `renderSequenceChunks` uses two reusable buffers; consume/copy each chunk's valid `frames` before advancing. `cancel()`, iterator return or an AbortSignal prevents further advancement; optional `maxFrames` caps cumulative work. Full-buffer rendering/`encodeWav` retain their limits; incremental `createWavEncoder` uses a separate RIFF32 file-size bound.

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

`streamSequence(opm, score, { at, horizon, interval, maxSlots, signal, onError })` returns `{ running, ids, start(), pump(), stop(), dispose() }`. It validates the whole bounded long score, then schedules note/control/stop windows using held gates and incremental releases, preserving cross-window ID mappings and only cancelling its own notes. Start from a gesture; context interruption/reset stops the stream and requires explicit restart. Shared worklet admission remains bounded and is not atomically reserved against unrelated callers. See [streaming contracts, capacity and browser recipe](./doc/streaming-sequences.md) and checkout-only [example 08](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/sequence.html).

### Portable score projects and MIDI files (introduced in v1.9)

`parseScoreProject(source: string | object)` returns a canonical frozen `ScoreProject` with `version: 1`, beat `events`, normalized `tempoMap`, `timeSignature`, named complete `voices`, and synthesis `settings` (`sampleRate`, `quality`, `maxVoices`, `mixGain`, `tuning`, `stealing`). `serializeScoreProject(project)` emits bounded canonical JSON. Projects are limited to 8 MiB, 65,536 events and 128 voices (256 KiB total voice JSON); notes refer to stored voice names, with omitted voice requiring stored `brass`. Missing tempo/meter/settings normalize to 120 BPM, 4/4 and the normal synthesis defaults.

```js
import { parseScoreProject, serializeScoreProject, compileBeatSequence } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const project = parseScoreProject({
  version: 1,
  voices: { brass },
  events: [{ type: 'note', id: 1, beat: 0, duration: 2, note: 60 }],
});
const seconds = compileBeatSequence(project.events, {
  tempoMap: project.tempoMap, voices: new Map(Object.entries(project.voices)),
});
const saved = serializeScoreProject(project);
```

`compileBeatSequence(events, { tempoMap?, bpm?, voices? })` validates beat events and returns second-based `SequenceEvent[]` for existing full/chunked/Worker rendering. Live Transport uses the original beat events and tempo map; load the project's named voices into OPM first. Keep the project's synthesis settings when choosing the live/offline engine. See [score projects](./doc/score-projects.md) for complete recipes and bounds.

`importMidiFile(bytes, options?)` / `exportMidiFile(events, options?)` are exported from root, core and `opm.js/midi-file`. Import returns `{ events, tempoMap, timeSignature, warnings, lossSummary }`; format 0/1 PPQN only, with strict byte/track/event budgets and malformed/truncated rejection. `channelVoices`/`defaultVoice` map channels to named FM voices; optional `programVoices` and `drumVoices` select voices at note onset. Default import applies sustain to durations, warns about unsupported data and rejects unclosed notes; explicit policies may reject unsupported data or close notes at the end. Default `controls: 'omit'` keeps note-only import and rejects control events/nonzero pan on export. Opt-in expressive conversion is described below; export still rejects unsupported controls, fractional note pitches, nonzero priority, ambiguous channel ownership and linear tempo ramps rather than silently losing them. See [MIDI files](./doc/midi-files.md) for policy and loss details.

### Portable Arrangement and expressive MIDI files (v1.10)

These additions are included in v1.10; the historical v1.9 archive remains unchanged.

`parseArrangementProject(source: string | object)` / `serializeArrangementProject(project)` are available from root and core. The separate `ArrangementProject` format is version 1 and stores named `layers`, `sections`, `initialSection`, normalized `tempoMap`/`timeSignature`, named complete `voices` and the same synthesis `settings` as score projects. Limits are 8 MiB, 128 voices/256 KiB voice JSON, 16 layers, 32 sections, 256 beats per loop and 65,536 total events. Live and saved definitions share validation; score-project version 1 is unchanged.

```js
import { parseArrangementProject, serializeArrangementProject } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const arrangementProject = parseArrangementProject({
  version: 1, voices: { brass },
  layers: [{ name: 'lead', length: 4, gain: 0.6,
    events: [{ type: 'note', id: 1, voice: 'brass', beat: 0, duration: 1, note: 60 }] }],
  sections: [{ name: 'intro', layers: ['lead'] }], initialSection: 'intro',
});
const arrangementJSON = serializeArrangementProject(arrangementProject);
```

Load stored voices into an engine constructed with the saved settings, then pass the project's layers, sections, initial section, tempo and meter to `createArrangement`. Parsing/loading does not start playback or restore phases/envelopes, pending changes or external routing. The checkout adaptive page supports project save/load; see the complete [project replay recipes](./doc/score-projects.md).

Both MIDI file adapters accept `controls: 'preserve' | 'omit'` (default `'omit'`, preserving the original note-only behavior) and an initial `pitchBendRange` of 0–48 semitones (default 2). Preserve-mode import and live MIDI now decode channel-local RPN 0 sensitivity, including cents, clamped to 48 semitones. Export still uses the explicit range and emits no RPN or program changes. Export accepts only channel-representable controls; incompatible overlap, unsupported controls/ramps and other losses reject instead of being guessed. Import returns frozen `lossSummary` groups: `omissions`, `approximations` and `preservedControls`; preserved counts refer to MIDI wire messages, not generated note-control fanout. Bank selection remains omitted. See [expressive SMF policies and loss accounting](./doc/midi-files.md).

Preservation is of representable gate/control meaning, not archived MIDI bytes or complete live-performance fidelity. Channel expression after a closed gate reports the conservative `release-tail-controls` approximation because patch-dependent tails are unknown; `unsupported: 'reject'` rejects it. Export rejects after-gate controls.

`MidiVoiceMap = Readonly<Record<number, string>> | ReadonlyMap<number, string>` maps integer 0–127 keys to named voices (at most 128 own-data entries). File import accepts `programVoices?: MidiVoiceMap` and `drumVoices?: MidiVoiceMap`; live `createMidiAdapter(performance, access, options?)` accepts `programVoices?: MidiVoiceMap`, but no drum map. Program changes affect later onsets only; unmapped file programs fall back to channel/default voices, while unmapped live programs are ignored. `gmProgramVoices: Readonly<Record<number, string>>` and `gmDrumVoices: Readonly<Record<number, string>>`, exported from root/core, are frozen artistic starter maps, not a GM sound-set claim. Supply a voice bank containing those names; missing voices use the normal unknown-voice errors.

`performance.configurePart(part, options, policy?: { preserveNotes?: boolean })` can retain existing gates on voice changes with `{ preserveNotes: true }`, as used by the live adapter. Default configuration still clears gates on voice/mode changes; mode changes always clear. RPN selectors CC100/101 cannot be custom-mapped; CC6/38 mappings apply only when RPN 0 is not selected. See [live MIDI policies](./doc/midi-performance.md).


### Musical Transport and performance policies

`createTransport(opm, beatScore, options)` uses quarter-note beats for event positions and note durations. It provides `start()`/`resume()`, `pause()`, `stop()`, `seek(beat)`, `setTempo(bpm)`, `setTempoMap(points)`, `setLoop({ enabled, from, to })`, `pump()` and `dispose()`, with defensive state/cursor/ID snapshots. BPM is 1–1000 (default 120); tempo maps start at beat 0 and contain at most 1024 increasing points. The AudioContext clock drives bounded scheduling; pause/seek/loop affect only owned notes. Restarting reconstructs scalar/ratio ramps and remaining durations but restarts envelopes/phases; unfinished fixed-Hz transitions restore the latest Hz/null policy immediately. This is **musical seeking**, not a DSP-state snapshot. See [Transport contracts](./doc/streaming-sequences.md).

In the current checkout, `TransportOptions.startupLead` is a finite 0–10 seconds, default `min(0.05, horizon / 2)`. Startup, resume, seek and clock reconstruction anchor in the future and keep musical position fixed during that lead, avoiding the historical cold-start beat-0 scheduling defect. Set 0 to opt out. `late:'drop'` still rejects genuinely late admissions; this is not a deadline guarantee. The historical v1.8.1 tarball lacks this fix.

The root and core export `beatsToSeconds`, `secondsToBeats`, `normalizeTempoMap`, `beatToBarBeat` and `barBeatToBeat`. Meter denominators are powers of two through 32; numerator is 1–32. Positions are bounded to 86400 quarter-note beats.

`createPerformance(opm, options)` manages 1–16 parts (default 16), at most 128 physical keys and tracked gates system-wide. Configure a part's voice, poly/mono mode, legato and last/high/low priority; call `noteOn(part, note, { velocity })` to obtain a **physical key ID**, `noteOff(part, keyId)`, `sustain(part, boolean)`, `updatePart(part, { glide, pan, expression })`, `allNotesOff(part?)`, `getPart(part)` and `dispose()`. Equal-pitch keys remain distinct. Held keys take precedence over pedal-only keys. Mono legato preserves onset velocity/envelopes within ±48 semitones of the original onset; farther moves retrigger at the actual pitch. Reset/interruption clears helper ownership even under preserve policy; scoped cleanup never panics unrelated notes. This is a performance helper, **not a MIDI driver**. See [performance recipe](./doc/host-integration.md#part-scoped-performance).

### Worker WAV export and quality profiles

`renderSequenceInWorker(score, { ...chunkedOptions, format, sink, onProgress, signal, workerUrl, startupTimeoutMs, phaseDiagnostics, onPhase })` returns a promise for `{ capacity, format, bytesWritten, diagnostics }`. `sink.write(bytes)` may transfer ownership and return a promise: the static module Worker waits for acknowledgement before rendering the next encoded chunk. Optional `close()` runs on completion; `abort(reason)` handles rollback. Cancellation terminates/rejects without waiting for a hung sink; the host must invalidate its partial output. Progress reports `{ frames, totalFrames, bytesWritten, errors }`. This helper is browser-only; pure chunk rendering/encoding also works in Node. Deploy the entire `dist/` tree, including `worker/render.js` and its companions, with same-origin secure URLs and normal CSP/JavaScript MIME checks. See [incremental/Worker sink recipes](./doc/host-integration.md) and checkout-only [example 08](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/sequence.html); long-file export uses a direct file sink, not an aggregate Blob fallback.

`quality` is accepted by OPM, Synth, `renderNote`, full/chunked sequence rendering and Worker options. `standard` preserves the existing 4×/eighth-order sound; `eco` uses 2×/fourth-order filtering with weaker alias rejection, while `high` uses 8×/eighth-order filtering at higher CPU cost. Profiles do not promise alias-free FM or universal realtime deadlines. See [measured quality tradeoffs](./doc/acoustic-quality.md).

### Adaptive music, tempo curves and grids

`createArrangement(opm, { layers, sections, initialSection, bpm?, tempoMap?, timeSignature? })` loops named layers on one global beat grid and switches sections or toggles layers at the first beat/bar boundary that is not earlier than the notes already admitted. Shared layers are one continuous schedule, so their sounding notes are not retriggered. `TempoPoint` accepts `curve: 'linear'` (BPM changes linearly per beat; closed-form logarithmic integral) and `endBpm`; `quantizeBeat`, `swingBeat` and `swingBeatEvents` shape grids. `createTransport` and `createArrangement` are musical restarts, **not** DSP checkpoints. Details, formulas and the exact pause/seek contract: [adaptive music](./doc/adaptive-music.md); try checkout-only [example 09](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/adaptive.html).

Since v1.9: `ArrangementLayer.gain` is 0–1 (default 1). `switchSection` and `setLayer` accept `fade` in seconds (0–10, default 0), and `setLayerGain(name, gain, { quantize?, fade? })` returns the committed beat. Shared layers continue without retriggering; layer gain multiplies independent note expression and includes owned release tails. Arrangement reserves authored `gain` controls for layer envelopes; use `expression` inside layer scores.

### Expressive performance and Web MIDI

`performance.updateKey(part, key, controls)` and `performance.updatePartNotes(part, controls)` apply any `NoteControls` to one key or to a whole part; `configurePart` accepts `voiceLimit` (1–32, release tails count) and `voicePriority`. `createMidiAdapter(performance, await requestMidiAccess(), options)` maps channel-voice MIDI (notes, sustain, bend, wheel, volume/expression, pan, pressure, all-notes-off) from user-granted inputs to parts. Importing never requests access, SysEx is never requested, and disconnect or `dispose()` releases only the keys the adapter owns. See [expressive performance and MIDI](./doc/midi-performance.md) and checkout-only [example 10](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/instrument.html).

Since v1.9: `MidiAdapterOptions.controllerMap` accepts at most 128 `MidiControllerMapping` entries. Each names `controller`, scalar `field` (including `gain`) or tuple `field` plus zero-based `operator`, explicit `min`, `max`, `ramp`, and optional `reset`. Reserved CC64/120/121/123 cannot be remapped; duplicates reject. A mapping overrides that CC's ordinary default only. CC121 restores captured effective part defaults or the supplied reset; fixed-Hz `reset:null` restores ratio mode. `performance.getPartControls(part)` returns a detached frozen snapshot of effective part controls, not per-key overrides. See the MIDI guide for field bounds and reset behavior.

### Worker diagnostics and deployment

`renderSequenceInWorker` accepts optional `startupTimeoutMs` (integer 1–2147483647 ms, module-ready watchdog only), `phaseDiagnostics` and `onPhase`; the Worker posts a versioned `ready` before any score is sent. There is no built-in overall deadline or automatic retry: bound the complete job with your own `AbortSignal`. See [Worker diagnostics](./doc/worker-diagnostics.md). From an installed application's root, run `npx --no-install opm-assets copy <new-directory>` (atomic, never overwrites a differing destination, hashes every file) and `npx --no-install opm-assets check <base-url>` (byte, status, MIME and `nosniff` check of served assets); see [host integration](./doc/host-integration.md#other-bundlers-and-ssr-hosts). `VERSION` is exported from the package root.


### Physical-device recovery workflow

Use checkout-only [example 08](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/sequence.html) over HTTPS on physical iOS/Android devices, following the [acceptance workflow and support matrix](./doc/mobile-acceptance.md). Record device/OS/browser/rate/policy, scenario observations and manual pass/fail/unverified results. Exercise both policies through lock/unlock, app switching, calls, headset/Bluetooth routes, battery saving, prolonged playback and main-thread stalls. Reports stay local and never certify untested devices. Desktop/headless checks and analyser peaks do not prove audible continuity or physical-phone recovery.

### WAV files and DX7 import

Save this as `export.mjs` in the installed application's root; `node export.mjs` writes a stereo file:

```js
import { writeFile } from 'node:fs/promises';
import { renderNote, encodeWav } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';
const audio = renderNote({ voice: brass, note: 60, duration: 0.7, velocity: 0.8, pan: -0.3 });
await writeFile('brass.wav', encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate }));
```

`importDX7(bytes)` from `opm.js/voices/dx7.js` returns complete normalized version 7 voices. It accepts exactly one standard framed/checksummed 163-byte single-voice or 4104-byte 32-voice bank SysEx message (`Uint8Array`), rejecting invalid framing, length, checksum, or non-7-bit data. `describeDX7(bytes)` returns per-voice `{name,sourceAlgorithm,algorithm,selectedOperators,droppedOperators,warnings}`; selected/dropped numbers refer to DX7 operators 1–6, source algorithms to 1–32, and converted algorithms to 0–7.

This remains an **approximate six-to-four-operator conversion**, not DX7 synthesis/emulation. Fixed-Hz operators are retained; operator velocity/rate scaling, pitch envelopes and LFO delay/sync are musical heuristics. Pitch-envelope stages are reduced; unsupported descending saw/sample-and-hold waveforms are substituted with warnings. Dropped operators/routing, oscillator sync, transpose, per-operator AM and envelope details still differ; the converter reduces selected operators' AM sensitivity to one shared depth, not selective v6 targets. Inspect descriptions and [expressive conversion limits](./doc/expressive-voices.md) before loading. The checkout-only [audition](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/examples/audition.html) uses original synthetic fixtures, not copied patches or a six-operator reference engine.

`importOPM(source)` from `opm.js/voices/opm.js` accepts decimal VOPM/MXDRV-family `.opm` text (`string` or Latin-1 `Uint8Array`) and returns complete normalized v7 voices. `describeOPM(source)` returns `{name,program,algorithm,operators,warnings}` for each patch. Names are sanitized and deterministically de-duplicated; source program numbers are metadata, not an automatic MIDI map. Input is bounded to 262144 bytes, 128 patches and 512 bytes per line, with strict integer ranges and complete unique sections. This is an **approximate conversion, not register-level YM2151 emulation**: held decay, rate scaling, detune, feedback and LFO differ, PAN is ignored, and C2 noise is an OPM.js extension. See [OPM conversion formulas and limits](./doc/expressive-voices.md#opm-text-import).

## Optimized distribution

Every `.js` in `dist/` has a matching `.js.map` and compiler-generated `.d.ts`, including thirteen bundled example entry points in the current checkout (twelve in historical v1.8.1). Engine modules preserve source paths; demo-only helpers are bundled into those entry points rather than shipped as separate modules or orphan declarations. Safe minification retains composed maps with embedded TypeScript; the empty type-only worklet-globals module has no source mappings. Deploy the entire matching tree; publishing maps exposes its sources. Do not edit generated files. Build/package smoke rejects missing map/declaration companions.

Engine, worklet, demos, tests and development scripts use strict TypeScript. Following [XYZ.js](https://github.com/YueyuHoshizora/XYZ.js)'s approach, declarations derive from implementation. Node.js 22+ is required. `tsconfig.json` checks source/emits declarations; `tsconfig.dev.json` emits ignored `.dev/`. ESM imports retain `.js` specifiers. Use `npm test`, not bare `node --test`; `npm run typecheck` includes tools/tests/demos/public consumers. The current build produces thirteen `dist/demo/` entry points plus static HTML/search under `doc/`; checkout `index.html` is the demo catalog. Copy the complete `doc/` directory together with top-level Markdown/legal files when hosting generated guides.

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

The v1.10 checkout-only benchmark also reports scoped capacity candidates across quality/voice configurations with an explicit reserve criterion and zero measured misses. Candidates retain their host/runtime/version/patch/workload identity and all raw timing rows; they do not certify AudioWorklet continuity or physical devices and never auto-switch synthesis quality. See [capacity guidance](./doc/acoustic-quality.md). Actual mobile/MIDI and human-listening acceptance still require [original physical observations](./doc/mobile-acceptance.md) and [listener findings](./doc/voice-quality.md), not automated PASS substitutions.

`sound-quality` covers all three profiles and passed 2,505 lifecycle/headroom/determinism matrix cases plus 24 live-control cases in the recorded v1.8 verification. It also checks independent passband, THD, folded aliases and streaming references; these are controlled numerical gates, not arbitrary-FM or listening certification. `voice-quality` evaluates the curated preset bank and original synthetic DX7 recipes over register/velocity cells. Peak/RMS are raw dBFS, not LUFS or perceived loudness; host trims do not rewrite synthesis levels. See [acoustic-quality evidence](./doc/acoustic-quality.md#coverage-and-evidence) and [voice-quality notes](./doc/voice-quality.md).

Independent references cover Bessel-series high-index PM, contractive delayed feedback, conservative full-level feedback energy, and nested four-operator chain/branched/multicarrier synthesis. The per-voice 4× decimator uses an eighth-order Butterworth cascade for a flatter audible passband with controlled stopband checks. Two 120-second streaming cases exercise held AM/PM and glide retargets. See [acoustic reference mathematics and limits](./doc/acoustic-quality.md); none certify arbitrary alias-free FM, perceptual quality or hardware fidelity.

`browser-stress` exercises real AudioWorklet output, dense admissions/steals, controls, late rejection and queue cleanup under bounded main-thread contention. Timer gaps and diagnostic round trips are observations, **not** worklet CPU/GC/underrun/glitch measurements. Periodic analyser samples cannot prove uninterrupted audio. The Vite smoke additionally verifies an installed current tarball, non-root production deployment, retained license, CSP and negative asset/MIME cases. Run these separately from deadline benchmarks.

## Voice format

A voice has four operators, an algorithm (0–7), and integer patch feedback (0–7). This is a canonical version 7 entry. Single objects may omit `version`, `name`, `modIndex` (4), and `lfo` (off/sine). Explicit versions 1–6 retain their original shapes and normalize to 7: v1 excludes key scaling, v1/2 exclude velocity sensitivity, v1–3 exclude LFO waveform, v1–4 exclude expressive v5 fields, v1–5 exclude v6 LFO targets, and v1–6 exclude operator waveform/noise rate.

```json
{
  "version": 7,
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
| `version`, `name` | Version 7; legacy 1–6 accepted only with original fields; name: 1–64 ASCII letters, digits, `_`, or `-` |
| `algorithm`, `feedback` | Integers 0–7 |
| `ratio`, `level`, `detune` | 0.125–32, 0–1, −1200–1200 cents |
| `adsr.a`, `adsr.d`, `adsr.s`, `adsr.r` | Attack/decay/release: 0–10 seconds; sustain: 0–1 |
| `modIndex` | 0–16 |
| `lfo.rate`, `lfo.amDepth`, `lfo.pmDepth` | 0–20 Hz, 0–1, 0–1200 cents |
| `lfo.waveform` | `sine` (default), `triangle`, `saw`, `square`; v4+ shape only |
| `ops[i].keyScale` | Optional; `breakpoint`: MIDI integer 0–127; `leftDbPerOctave`, `rightDbPerOctave`: 0–24 dB/octave |
| `ops[i].velocitySensitivity` | Optional since v3: 0–48 dB attenuation at velocity zero; omitted is 0 |
| `ops[i].frequency` | Optional v5 fixed frequency 1–20000 Hz; overrides note-derived ratio frequency, with detune/live pitch/PM still applied |
| `ops[i].rateKeyScale` | Optional v5 0–4: ADSR times multiply by `2 ** (-rateKeyScale * (note - 60) / 12)`, clamped to 10 seconds; default 0 |
| `ops[i].waveform` | Optional v7 `sine` (default), `half`, `abs`, `quarter`, `alternating`, `camel`, `square`, `saw`, `noise` |
| `ops[i].noiseRate` | Optional v7 20–20000 Hz, default 8000; ignored unless waveform is `noise` |
| `pitchEnvelope` | Optional v5 `{a,d,r,initial,peak,sustain,final}`; times 0–10 seconds, levels −4800..4800 cents, continuous linear-cents release |
| `lfo.delay`, `lfo.sync`, `lfo.phase` | Optional v5 0–10 seconds, `'note'`/`'global'` (default note), 0–1 turns (default 0); delay gates depth, not the phase clock |
| `lfo.amTargets`, `lfo.pmTargets` | Optional v6 four-element depth factors 0–1; input booleans normalize to 0/1; absent targets mean all 1 |

See the [expressive voice reference](./doc/expressive-voices.md) for pitch composition, fixed-frequency behavior and synchronization. Ratio remains required even when frequency is supplied. Preserve the source patch version when importing older banks; changing a version number alone does not add unsupported fields to its legacy shape.

Periodic shapes use phase plus modulation; sine retains the unchanged legacy fast path. Noise uses a deterministic 17-bit bipolar sample-and-hold sequence reset at every admission/slot reuse. Ratio, fixed Hz, detune, pitch and PM do not pitch noise; live ratio/frequency controls remain valid but have no audible pitch effect. Envelope, velocity, level, key scaling, AM and graph roles still apply. Noise on any operator is an OPM.js extension, not hardware-fidelity emulation. Square/saw/noise can alias despite oversampling; see [shape formulas and noise details](./doc/expressive-voices.md#oscillator-shapes-and-noise). Original presets include `noise-snare`, `noise-hihat` and `explosion`.


Key scaling attenuates operator level by `10 ** (-slope * abs(note - breakpoint) / 12 / 20)` on the corresponding side; omitted scaling is flat. Velocity sensitivity additionally multiplies it by `10 ** (-sensitivity * (1 - velocity) / 20)`, changing carrier loudness and modulator brightness. Final note velocity still multiplies the output; default sensitivity 0 preserves legacy sound. Pan belongs to the note, not the voice.

### Voice banks

Import `parseVoiceBank` from `opm.js/voices/schema.js` in Node, or `./opm/voices/schema.js` in the deployed browser example. It accepts a JSON string or array and returns `Map<name, voice>` with frozen copies.

A bank must be an **array** of 1–128 complete versioned voices; wrap individual JSON examples in `[...]`. Every bank entry requires `version`, `name`, `algorithm`, `feedback`, `modIndex`, `lfo`, and four complete operators; names must be unique. JSON strings are capped at 256 KiB in UTF-8. The [schema module](./dist/voices/voice.schema.js) exports `voiceSchema`; the [example bank module](./dist/voices/examples.js) exports `examples`. Import `examples` from `opm.js/voices/examples.js` (Node) or `./opm/voices/examples.js` (browser) and pass it to `parseVoiceBank(examples)`. External JSON banks remain supported.

`opm.replaceVoiceBank()` applies the bank's whole-input validation before swapping lookups. Only its plain empty-array input is a clearing operation; `parseVoiceBank('[]')` still rejects an empty bank. Removing/replacing a name does not alter immutable patches already queued or sounding.

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
- [ ] v1.11 — voice v7 waveforms and noise, stereo chorus/reverb, MIDI program maps and RPN, `.opm` import (implemented with regression tests, a real-browser audio smoke and demo coverage; not yet released, and physical-device and human-listening acceptance are unverified)

## Limitations

- Not a register-level YM2151 emulator; VGM playback is out of scope
- Bundled sounds are original curated recipes, not a comprehensive commercial bank; bring your own sounds.
- Selectable 2×/4×/8× oversampling and Butterworth decimation reduce controlled folded aliases; arbitrary FM can still alias and filters have phase/delay/CPU tradeoffs.
- Numerical host trims are not perceptual loudness matching. DX7 conversion remains six-to-four-operator and intentionally lossy; no hardware-fidelity or all-device glitch-free guarantee is made.

## License

[Apache License 2.0](./LICENSE)

Copyright 2026 OPM.js authors

OPM.js is an independent project inspired by the architecture of the Yamaha YM2151. It is not affiliated with, endorsed by, or connected to Yamaha Corporation.
