# OPM.js

**A 4-operator FM synthesis engine for the browser, inspired by the Yamaha YM2151 (OPM) sound chip.**

OPM.js recreates the classic 16-bit era FM sound — 8 channels of 4-operator synthesis with multiple algorithms, feedback, and ADSR envelopes — as a lightweight, zero-dependency JavaScript engine powered by the Web Audio API.

> **Status:** v1.1.0 — the documented browser and offline-rendering APIs are available.

Usage guides: [English](./doc/usage.en.md) · [繁體中文](./doc/usage.zh-TW.md).

Choose a workflow: [try the demos](#try-the-checkout) · [install into an npm project](#install-into-an-npm-project) · [deploy in a browser](#use-in-a-browser) · [render in Node.js](#render-in-nodejs) · [API reference](#api-reference) · [troubleshooting](#troubleshooting).

## About

The Yamaha YM2151 (OPM) powered a generation of arcade boards and the Sharp X68000, defining the sound of the mid-1980s with its 8-channel, 4-operator FM architecture. OPM.js brings that architecture to the browser as a pure JavaScript synthesis engine.

OPM.js is a musically-accurate reimplementation, not a cycle-accurate hardware clone: envelope timing and modulation curves are tuned to sound correct rather than to reproduce silicon behaviour bit-for-bit.

## Features

- **4-operator FM synthesis** with 8 connection algorithms and hardware-style feedback
- **Per-operator ADSR envelopes** in the dB domain
- **LFO** with AM / PM modulation (tremolo & vibrato)
- **Eight-voice polyphony** with oldest-note stealing
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

Open **http://localhost:8000/index.html** and press **播放曲子** for *Twinkle, Twinkle, Little Star*; **停止** ends it early. **http://localhost:8000/demo/index.html** plays a brass chord. Stop the server with Ctrl+C when finished. Do not open the HTML through `file://`.

If `dist/` is missing or you have changed `src/`, regenerate it using the [development commands](#optimized-distribution) first.

### Install into an npm project

The name in `package.json` does **not** guarantee publication to the public npm registry. These instructions install this checkout's local tarball; do not substitute `npm install opm.js` or an assumed CDN URL.

From the `OPM.js` repository root, with Node.js 18+ and npm:

```sh
npm ci
npm pack
```

`npm pack` builds automatically and produces `opm.js-1.1.0.tgz`. To create a new application beside the checkout:

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.1.0.tgz
```

For an existing application, run only the install command from its root, adjusting the tarball path. Consumers do not install the engine's development dependencies or need a build step. The installed package contains minified JS/JSON, usage documentation, and legal files—not the repository demos, source, build scripts, or precompressed alternatives.

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

### Browser: OPM

| Call | Contract |
| --- | --- |
| `new OPM({ sampleRate } = {})` | Optional integer sample rate, 8000–96000 Hz; omitted uses the browser default. The browser may reject a rate it cannot support. |
| `await opm.start()` | Create and resume the audio context/worklet from a user gesture. Await it before playing. Serialize lifecycle calls; concurrent starts are not coalesced. |
| `opm.loadVoice(name, voice)` | Validate and copy a voice; register or replace a name for future notes. Allowed name: 1–64 ASCII letters, digits, `_`, or `-`. May be called before `start()`. |
| `opm.playNote({ voice = 'brass', note, time = 0, duration })` | Return a positive integer note ID. `note` is a required MIDI integer 0–127; `time` is a **delay**, not an absolute timestamp, in 0–60; `duration` is required in `(0, 60]`, before release. `voice` is a registered name or a voice object. Requires `start()`. |
| `opm.stop(id)` | Cancel a future note or begin an active note's release. Requires a started instance and positive safe integer ID; returns no value. Release tails are not an immediate mute. |
| `await opm.close()` | Disconnect output and close the context. Call `start()` again to reuse the instance; cancel application-owned timers separately. |

At most eight voices, including release tails, sound concurrently; a ninth steals the oldest. The worklet holds at most 256 pending start/release events—up to 128 entirely future notes when empty. Overflow messages are ignored; a returned ID is not an admission/completion acknowledgement. Schedule longer pieces incrementally.

Configure modulation through `voice.lfo` before loading or playing; there is no `setLFO()` method. A complete custom-voice/scheduling recipe is in the [English](./doc/usage.en.md) and [Traditional Chinese](./doc/usage.zh-TW.md) guides.

### Offline: Synth and renderNote

| Call or property | Contract |
| --- | --- |
| `new Synth(sampleRate, maxVoices = 8)` | Required finite sample rate 8000–192000 Hz; voice limit is an integer 1–8. No Web Audio is required. |
| `synth.noteOn(voice, note, id?)` | Strictly validate/copy the voice and start a MIDI integer 0–127. Return an ID; an explicit ID must be a unique active positive safe integer. |
| `synth.noteOff(id)` | Begin release at the current rendered time; return `true`, or `false` for unknown/already-released IDs. |
| `synth.render(left, right, offset = 0, length = left.length - offset)` | Write to both `Float32Array`s. Nonnegative safe-integer offset/length must fit both arrays; total buffer lengths need not match. Currently both channels have identical output. Split calls around note events to schedule offline. |
| `synth.currentFrame`, `synth.errorCount` | Cumulative rendered frames and numerical-failure count. Render beyond note-off to capture release and filter tails. |
| `renderNote({ voice, note = 60, duration = 0.5, velocity = 1, sampleRate = 44100 })` | Return `{ samples, sampleRate, diagnostics: { errors } }`. A separate mono helper requiring a **complete** versioned voice. Finite note/duration/velocity values clamp to 0–127, 0–30, and 0–1; fractional notes are accepted here. Sample rate must be an integer 8000–96000. |

`renderNote()` allocates `ceil((duration + longestRelease + 0.01) * sampleRate)` samples with a 4,000,000-sample ceiling. It validates but **does not apply LFO**, and its output/mixing differs from `Synth`. Use `Synth` for the browser's LFO/polyphonic synthesis path. See the guides for a standalone `render-note.mjs` example.

Other core exports: `normalizeVoice(voice)` makes a strict detached copy; `envelopeAt(time, gate, adsr)` evaluates the dB-domain envelope; `ALGORITHMS` contains eight immutable routing graphs; `HEADROOM` is 0.7, `OVERSAMPLE` is 4, and `MAX_RENDER_SAMPLES` is 4,000,000. `sampleRateValue(value)` validates an integer rate of 8000–96000. Schema helpers are described below.

## Optimized distribution

`dist/` contains ready-to-use, tree-shaken ES modules with shared chunks and compact voice JSON. Keep each deployment's entire directory from the same build. Readable implementation files remain in `src/`; do not edit generated files in `dist/`.

In the **repository checkout**, not the installed npm package:

```sh
npm ci
npm run build
npm test
npm run benchmark
```

These install pinned development tools and regenerate `dist/`; the build replaces that generated directory. Consumers need no build tools or runtime dependencies. `npm pack` also runs the build automatically. Terser uses up to ten safe compression passes, without unsafe floating-point transformations or property mangling.

Checkout builds include gzip level 9 (`.gz`) and Brotli quality 11 (`.br`) alternatives. The npm tarball intentionally excludes these duplicates. For npm deployments, use the server's compression or obtain precompressed assets from a checkout build.

Always import normal `.js` URLs, **never `.br` or `.gz` URLs**. A server using sidecars must negotiate `Accept-Encoding`, send the matching `Content-Encoding` and original JavaScript/JSON content type, and set `Vary: Accept-Encoding`. The basic Python server does not negotiate these sidecars; uncompressed minified `.js`/`.json` files still work.

The benchmark reports warmed median render times; results depend on the machine and JavaScript engine. [CHANGELOG](./CHANGELOG.md) records measured changes, and [SECURITY](./SECURITY.md) covers safe embedding and review requirements.

## Voice format

A voice has four operators, an algorithm (0–7), and feedback (0–7). The example is valid as a version 1 JSON voice-bank entry. `modIndex` controls phase modulation strength (0–16); `detune` and `pmDepth` are in cents, `amDepth` is 0–1, and ADSR times are in seconds. Individual voice objects may omit `version`, `name`, `modIndex` (defaults to 4), and `lfo` (defaults to off).

```json
{
  "version": 1,
  "name": "brass",
  "algorithm": 4,
  "feedback": 3,
  "modIndex": 4,
  "lfo": { "rate": 5.2, "amDepth": 0, "pmDepth": 12 },
  "ops": [
    { "ratio": 1.0, "level": 0.8, "detune": 0,
      "adsr": { "a": 0.01, "d": 0.2, "s": 0.6, "r": 0.1 } },
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
| `version`, `name` | Version 1; name of 1–64 ASCII letters, digits, `_`, or `-` when supplied |
| `algorithm`, `feedback` | Integers 0–7 |
| `ratio`, `level`, `detune` | 0.125–32, 0–1, −1200–1200 cents |
| `adsr.a`, `adsr.d`, `adsr.s`, `adsr.r` | Attack/decay/release: 0–10 seconds; sustain: 0–1 |
| `modIndex` | 0–16 |
| `lfo.rate`, `lfo.amDepth`, `lfo.pmDepth` | 0–20 Hz, 0–1, 0–1200 cents |

### Voice banks

Import `parseVoiceBank` from `opm.js/voices/schema.js` in Node, or `./opm/voices/schema.js` in the deployed browser example. It accepts a JSON string or array and returns `Map<name, voice>` with frozen copies.

A bank must be an **array** of 1–128 complete versioned voices; wrap individual JSON examples in `[...]`. Every bank entry requires `version`, `name`, `algorithm`, `feedback`, `modIndex`, `lfo`, and four complete operators; names must be unique. JSON strings are capped at 256 KiB in UTF-8. See the [schema](./dist/voices/voice.schema.json) and [example bank](./dist/voices/examples.json).

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
| Invalid note, duration, or unknown voice | Check required `duration`, MIDI integer range, and registered voice name against the API table. |
| Notes disappear | Respect eight-voice stealing and the pending-event cap; schedule in smaller batches. |
| Bank import fails | Use an array of complete versioned voices with unique names, not a single partial voice object. |
| Offline script makes no speaker sound/file | The API returns PCM buffers, not playback or WAV output. Use `Synth` rather than `renderNote()` when LFO is needed. |
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
- [ ] Future — key scaling, DX7 SysEx voice import, and WAV export

## Limitations

- Not a register-level YM2151 emulator; VGM playback is out of scope
- Voice bank is small by design — bring your own sounds

## License

[Apache License 2.0](./LICENSE)

Copyright 2026 OPM.js authors

OPM.js is an independent project inspired by the architecture of the Yamaha YM2151. It is not affiliated with, endorsed by, or connected to Yamaha Corporation.
