# OPM.js

**A 4-operator FM synthesis engine for the browser, inspired by the Yamaha YM2151 (OPM) sound chip.**

OPM.js recreates the classic 16-bit era FM sound — 8 channels of 4-operator synthesis with multiple algorithms, feedback, and ADSR envelopes — as a lightweight, zero-runtime-dependency TypeScript engine powered by the Web Audio API, distributed as JavaScript ES modules.

> **Status:** v1.2.0 — browser and offline synthesis, version 2 voices, approximate DX7 import, and PCM16 WAV export.

Usage guides: [English](./doc/usage.en.md) · [繁體中文](./doc/usage.zh-TW.md).

Choose a workflow: [try the demos](#try-the-checkout) · [install into an npm project](#install-into-an-npm-project) · [deploy in a browser](#use-in-a-browser) · [render in Node.js](#render-in-nodejs) · [API reference](#api-reference) · [troubleshooting](#troubleshooting).

## About

The Yamaha YM2151 (OPM) powered a generation of arcade boards and the Sharp X68000, defining the sound of the mid-1980s with its 8-channel, 4-operator FM architecture. OPM.js brings that architecture to the browser with a TypeScript implementation and directly deployable JavaScript.

OPM.js is a musically-accurate reimplementation, not a cycle-accurate hardware clone: envelope timing and modulation curves are tuned to sound correct rather than to reproduce silicon behaviour bit-for-bit.

## Features

- **4-operator FM synthesis** with 8 connection algorithms and hardware-style feedback
- **Per-operator ADSR envelopes** in the dB domain and note-dependent key scaling
- **LFO** with AM / PM modulation (tremolo & vibrato), shared by live/offline rendering
- **Eight-voice polyphony** with oldest-note stealing and bounded ~5 ms steal fades
- **Held notes, velocity, stereo pan**, lifecycle events, and diagnostics
- **PCM16 WAV export** and approximate six-to-four-operator DX7 SysEx voice import
- **TypeScript declarations** for browser, core, and voice-module exports
- **AudioWorklet-based DSP** — synthesis runs off the main thread
- **Zero runtime dependencies**, built on the Web Audio API
- Works in the browser and Node.js (offline rendering)

## Requirements

- Modern browser with ES modules and AudioWorklet (served over HTTPS or localhost)
- Node.js 18+ for offline rendering and tests

## Getting started

### Try the checkout

Obtain a checkout or source archive of [this repository](https://github.com/YueyuHoshizora/OPM.js) containing this documentation. Repository commands below run in the directory containing `package.json`, `src/`, and `scripts/` (called `OPM.js` in the examples).

The committed `dist/` is ready to use; trying the demos needs no npm installation or build. With Python 3 available, run from that repository root:

```sh
python3 -m http.server 8000
```

Open **http://localhost:8000/index.html** and press **播放曲子** for *Twinkle, Twinkle, Little Star*; **停止** ends it early. **http://localhost:8000/demo/index.html** includes seven selectable presets, held-note velocity/pan controls, a key-scaling arpeggio, DX7 file import, and WAV download. Stop the server with Ctrl+C when finished. Do not open the HTML through `file://`.

If `dist/` is missing or you have changed `src/`, regenerate it using the [development commands](#optimized-distribution) first.

### Install into an npm project

The name in `package.json` does **not** guarantee publication to the public npm registry. These instructions install this checkout's local tarball; do not substitute `npm install opm.js` or an assumed CDN URL.

From the `OPM.js` repository root, with Node.js 18+ and npm:

```sh
npm ci
npm pack
```

`npm pack` builds automatically and produces `opm.js-1.2.0.tgz`. To create a new application beside the checkout:

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.2.0.tgz
```

For an existing application, run only the install command from its root, adjusting the tarball path. Consumers do not install the engine's development dependencies or need a build step. The installed package contains minified JS, generated `.d.ts` declarations, demo scripts, usage documentation, and legal files—not HTML demo pages, source, or build scripts.

### Use in a browser

From the npm application's root, copy the complete distribution into a public directory:

```sh
mkdir -p public/opm
cp -R node_modules/opm.js/dist/. public/opm/
cp node_modules/opm.js/LICENSE public/opm/LICENSE
```

Without npm, copy the checkout's complete `dist/` contents and its `LICENSE` into your site's `opm/` directory instead. The commands use a POSIX shell; copying those same files manually is equivalent.

Keep this layout; individual worklets and shared chunks must not be moved independently:

```text
public/
  index.html
  opm/
    api/
    chunks/
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
| `OPM` | `opm.js` | `./opm/api/index.js` |
| `Synth`, `renderNote`, core helpers | `opm.js/core` | `./opm/core/index.js` |
| `brass` | `opm.js/voices/brass.js` | `./opm/voices/brass.js` |
| `parseVoiceBank`, `validateVoice`, schema helpers | `opm.js/voices/schema.js` | `./opm/voices/schema.js` |
| `importDX7`, `describeDX7` | `opm.js/voices/dx7.js` | `./opm/voices/dx7.js` |

### Browser: OPM

| Call | Contract |
| --- | --- |
| `new OPM({ sampleRate, context, destination, onEvent } = {})` | Optional integer sample rate 8000–96000 Hz. Supply an existing `AudioContext` to borrow it; OPM never closes or suspends borrowed contexts. Omit `destination` to use `context.destination`, or pass `null` to avoid automatic connection. |
| `await opm.start()` / `await opm.resume()` | Initialize/resume the context and worklet from a user gesture; concurrent starts coalesce. Existing contexts are resumed after browser suspension. Await before playing. |
| `opm.connect(destination)` / `opm.disconnect(destination?)` | Connect/disconnect the started worklet output; return `opm`. Omitted disconnect destination removes all output connections. Destination must belong to the same context. |
| `opm.loadVoice(name, voice)` | Strictly validate/copy a voice; register/replace a name for future notes. Name: 1–64 ASCII letters, digits, `_`, or `-`. Works before `start()`. |
| `opm.playNote({ voice = 'brass', note, time = 0, duration = null, velocity = 1, pan = 0 })` | Return a positive safe-integer ID without wrapping. MIDI note is an integer 0–127; `time` is a delay 0–60 seconds; duration is `(0, 60]` or `null` to hold until `stop(id)`. Velocity is 0–1; pan is −1–1. Requires `start()`. |
| `opm.stop(id)` | Cancel a future note or start release on an active note. Requires a positive safe-integer ID and started instance. Unknown, ended, stolen, or already-released notes are harmless no-ops; release is not an immediate mute. |
| `await opm.getDiagnostics()` | Return `{ type: 'diagnostics', requestId, activeVoices, pendingEvents, errors, rejectedNotes }`. Requires running context; at most 64 outstanding requests. Suspend/close/processor failure rejects pending requests; resume before retrying. |
| `await opm.close()` | Serialize disposal against initialization, disconnect the node, and close only an owned context. A later `start()` recreates owned contexts; borrowed contexts remain usable. Cancel application timers separately. |

`onEvent(event)` receives `{ type: 'note', id, state, reason? }` with states `accepted`, `started`, `released`, `ended`, `stolen`, `cancelled`, or `rejected`; diagnostics replies; and `{ type: 'error', error }` for processor failures. A returned ID is not admission/completion acknowledgement: observe events, especially rejection. Callback exceptions are isolated.

At most eight logical voices (including release tails) are active; a ninth steals the oldest, with up to eight short fading remnants to avoid resetting its waveform abruptly. The worklet is bounded to 256 pending events and 256 tracked note IDs. A future timed note uses start and off events; held notes use only a start event. Duplicate IDs and overflow reject before enqueueing; terminal events remove obsolete off events. Schedule long pieces incrementally.

Configure modulation through `voice.lfo` before loading or playing; there is no `setLFO()` method. A complete custom-voice/scheduling recipe is in the [English](./doc/usage.en.md) and [Traditional Chinese](./doc/usage.zh-TW.md) guides.

### Offline: Synth and renderNote

| Call or property | Contract |
| --- | --- |
| `new Synth(sampleRate, maxVoices = 8)` | Required finite sample rate 8000–192000 Hz; voice limit is an integer 1–8. No Web Audio is required. |
| `synth.noteOn(voice, note, id?, { velocity = 1, pan = 0 } = {})` | Strictly validate/copy the voice; finite fractional MIDI 0–127 is allowed in the core. Explicit ID: positive safe integer unique among active notes. Velocity 0–1; pan −1–1. |
| `synth.noteOff(id)` | Begin release at current rendered time; return `true`, or `false` for unknown/already-released IDs. |
| `synth.render(left, right, offset = 0, length = left.length - offset)` | Write both `Float32Array`s; safe-integer offset/length must fit both. Split calls at offline events. Center pan produces dual mono; other positions produce stereo. |
| `synth.currentFrame`, `synth.errorCount`, `synth.lastStolenId` | Cumulative frames, numerical-failure count, and stolen ID (`null` when the last successful note-on stole none). |
| `synth.onVoiceEnded = (id, reason) => …` | Optional exactly-once logical terminal notification; reason is `stolen`, `ended`, or `error`. A stolen note's bounded fade can outlive this notification. |
| `renderNote({ voice, note = 60, duration = 0.5, velocity = 1, pan = 0, sampleRate = 44100 })` | Return `{ samples, left, right, sampleRate, diagnostics: { errors } }`, with `samples === left`. Requires a complete voice; finite note/duration/velocity/pan clamp to 0–127/0–30/0–1/−1–1. Sample rate: integer 8000–96000. |
| `encodeWav({ left, right?, sampleRate })` | Return PCM16 little-endian RIFF/WAVE `Uint8Array`; omit right for mono. Float32 arrays must contain finite samples in −1–1; stereo lengths must match. Invalid amplitudes reject rather than clip. Sample rate: integer 8000–192000; frame budget: 4,000,000. |

`renderNote()` uses `Synth` for identical envelope timing, LFO, filtering, velocity, pan, and saturation. It retains `ceil((duration + longestRelease + 0.01) * sampleRate)` frames and a 4,000,000-frame budget.

Pan uses a center-normalized constant-power law: left/right gains are `sqrt(2) * cos/sin((pan + 1) * pi / 4)` before saturation. Center preserves the previous per-channel gain; hard sides mute the opposite channel and boost the selected channel by `sqrt(2)`. This does not promise constant loudness after polyphonic saturation.

Other core exports: `normalizeVoice(voice)` makes a strict detached copy; `envelopeAt(time, gate, adsr)` evaluates the dB-domain envelope; `ALGORITHMS` contains eight immutable routing graphs; `HEADROOM` is 0.7, `OVERSAMPLE` is 4, and `MAX_RENDER_SAMPLES` is 4,000,000. `sampleRateValue(value)` validates an integer rate of 8000–96000. Schema helpers are described below.

### WAV files and DX7 import

Save this as `export.mjs` in the installed application's root; `node export.mjs` writes a stereo file:

```js
import { writeFile } from 'node:fs/promises';
import { renderNote, encodeWav } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';
const audio = renderNote({ voice: brass, note: 60, duration: 0.7, velocity: 0.8, pan: -0.3 });
await writeFile('brass.wav', encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate }));
```

`importDX7(bytes)` from `opm.js/voices/dx7.js` returns complete normalized version 2 voices. It accepts exactly one standard framed/checksummed 163-byte single-voice or 4104-byte 32-voice bank SysEx message (`Uint8Array`), rejecting invalid framing, length, checksum, or non-7-bit data. `describeDX7(bytes)` returns per-voice `{name,sourceAlgorithm,algorithm,selectedOperators,droppedOperators,warnings}`; selected/dropped numbers refer to DX7 operators 1–6, source algorithms to 1–32, and converted algorithms to 0–7.

This is an **approximate six-to-four-operator conversion**, not DX7 synthesis or emulation. Operators and routing are reduced; envelopes, levels, detune, LFO, and key scaling are approximated. Fixed frequencies become ratios referenced to MIDI 60. Pitch envelopes, velocity/rate scaling, and LFO delay/waveform/sync are not reproduced. Inspect descriptions before loading; no conversion metadata is added to the voice schema. See the guides for a complete import script and the demo for file import and preview.

## Optimized distribution

`dist/` contains only `.js` ES modules and generated `.d.ts` declarations, including shared chunks and voice assets exported as JavaScript data. Keep each deployment's entire directory from the same build. Readable implementation files remain in `src/`; do not edit generated files in `dist/`.

Engine, AudioWorklet, demos, tests, and development scripts use strict TypeScript. Following [XYZ.js](https://github.com/YueyuHoshizora/XYZ.js)'s source/declaration approach, declarations are generated from implementation rather than maintained separately. OPM.js retains npm and Node 18+ compatibility. `tsconfig.json` checks the environment-independent/browser source and emits declarations; `tsconfig.dev.json` compiles development programs into ignored `.dev/`. ESM source imports retain `.js` specifiers. Use `npm test`, not bare `node --test`, to compile and run the behavioral tests; `npm run typecheck` checks source, tools, tests, demos, and the public consumer fixture. The build also produces `dist/demo/` scripts used by both HTML demos.

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
```

These install pinned development tools and regenerate `dist/`; the build replaces that generated directory. Consumers need no build tools or runtime dependencies. `npm pack` also runs the build automatically. Terser uses up to ten safe compression passes, without unsafe floating-point transformations or property mangling.

The build does not produce JSON assets or gzip/Brotli sidecars. If desired, configure compression at the web host while retaining normal `.js` import URLs. Send the matching `Content-Encoding` and `Vary: Accept-Encoding` only for compressed responses, with a JavaScript MIME type. The basic Python server serves the ordinary `.js` modules directly.

Benchmark results depend on the machine and JavaScript engine. [CHANGELOG](./CHANGELOG.md) records observed verification, and [SECURITY](./SECURITY.md) covers safe embedding and review requirements.

Quality automation configures Node 18/22/24 and Chromium/Firefox/WebKit smoke scenarios with real AudioWorklet output; browser installation is a development-only prerequisite. Headless Linux Firefox additionally needs a running native audio server; CI starts PulseAudio with a null output sink (see the [quality instructions](./doc/usage.en.md#quality-and-release-acceptance)). Configuration alone does not prove successful runs or all-platform coverage: observed checks belong in CHANGELOG. `npm run security -- --package-smoke` exercises installed exports/types. No fallback masks browser failure.

The real-time benchmark reports warmed 128-frame block p95/p99/worst and misses against `128/sampleRate` seconds. Local defaults are report-only; optional `OPM_BENCH_P99_BUDGET_RATIO` / `OPM_BENCH_WORST_BUDGET_RATIO` enforce host-specific budgets. Run deadline acceptance separately from CPU-heavy offline rendering; competing workloads can change its outcome. CI configures p99 ratio 1 at 48 kHz (2.667 ms), with worst/GC stalls report-only. Four-times oversampling/filtering and controlled spectral tests do not promise arbitrary alias-free FM or deadlines on every host.

## Voice format

A voice has four operators, an algorithm (0–7), and feedback (0–7). This is a version 2 JSON voice-bank entry. `modIndex` is 0–16; `detune` and `pmDepth` are cents; `amDepth` is 0–1; ADSR times are seconds. Single voice objects may omit `version`, `name`, `modIndex` (defaults to 4), and `lfo` (defaults to off). Legacy version 1 input remains accepted without new key-scaling fields and canonicalizes to version 2 when versioned.

```json
{
  "version": 2,
  "name": "brass",
  "algorithm": 4,
  "feedback": 3,
  "modIndex": 4,
  "lfo": { "rate": 5.2, "amDepth": 0, "pmDepth": 12 },
  "ops": [
    { "ratio": 1.0, "level": 0.8, "detune": 0,
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
| `version`, `name` | Version 2 (legacy 1 accepted without key scaling); name of 1–64 ASCII letters, digits, `_`, or `-` when supplied |
| `algorithm`, `feedback` | Integers 0–7 |
| `ratio`, `level`, `detune` | 0.125–32, 0–1, −1200–1200 cents |
| `adsr.a`, `adsr.d`, `adsr.s`, `adsr.r` | Attack/decay/release: 0–10 seconds; sustain: 0–1 |
| `modIndex` | 0–16 |
| `lfo.rate`, `lfo.amDepth`, `lfo.pmDepth` | 0–20 Hz, 0–1, 0–1200 cents |
| `ops[i].keyScale` | Optional; `breakpoint`: MIDI integer 0–127; `leftDbPerOctave`, `rightDbPerOctave`: 0–24 dB/octave |

Key scaling attenuates operator level by `10 ** (-slope * abs(note - breakpoint) / 12 / 20)` on the corresponding side. Omitted key scaling is flat. Pan belongs to each note, not the voice schema.

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
| Processor/chunk 404 or JavaScript MIME error | Preserve the complete distribution layout; ensure asset URLs serve JS, not a single-page app's HTML fallback. |
| No sound, or “Call start() before playNote()” | Await `start()` inside a click handler; inspect the displayed error and browser/device audio settings. |
| Invalid note, duration, or unknown voice | Check MIDI integer range, duration (`null` or `(0,60]`), velocity/pan, and registered voice name. |
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
- Voice bank is small by design — bring your own sounds

## License

[Apache License 2.0](./LICENSE)

Copyright 2026 OPM.js authors

OPM.js is an independent project inspired by the architecture of the Yamaha YM2151. It is not affiliated with, endorsed by, or connected to Yamaha Corporation.
