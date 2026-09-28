# OPM.js

**A 4-operator FM synthesis engine for the browser, inspired by the Yamaha YM2151 (OPM) sound chip.**

OPM.js recreates the classic 16-bit era FM sound — 8 channels of 4-operator synthesis with multiple algorithms, feedback, and ADSR envelopes — as a lightweight, zero-dependency JavaScript engine powered by the Web Audio API.

> **Status:** v1.0.0 — the documented browser and offline-rendering APIs are available.

Usage guides: [English](./doc/usage.en.md) · [繁體中文](./doc/usage.zh-TW.md).

## About

The Yamaha YM2151 (OPM) powered a generation of arcade boards and the Sharp X68000, defining the sound of the mid-1980s with its 8-channel, 4-operator FM architecture. OPM.js brings that architecture to the browser as a pure JavaScript synthesis engine.

OPM.js is a musically-accurate reimplementation, not a cycle-accurate hardware clone: envelope timing and modulation curves are tuned to sound correct rather than to reproduce silicon behaviour bit-for-bit.

## Features

- **4-operator FM synthesis** with 8 connection algorithms and hardware-style feedback
- **Per-operator ADSR envelopes** in the dB domain
- **LFO** with AM / PM modulation (tremolo & vibrato)
- **Eight-voice polyphony** with oldest-note stealing
- **AudioWorklet-based DSP** — synthesis runs off the main thread
- **Zero dependencies**, built on the Web Audio API
- Works in the browser and Node.js (offline rendering)

## Requirements

- Modern browser with ES modules and AudioWorklet (served over HTTPS or localhost)
- Node.js 18+ for offline rendering and tests

## Getting started

Run `python3 -m http.server` at the repository root and open `index.html` on localhost. Press **播放曲子** to hear the complete *Twinkle, Twinkle, Little Star* melody with brass accompaniment (about 24 seconds); **停止** ends it early. `demo/index.html` plays a single chord instead. No build step or runtime dependencies are required.

For another website, the browser entry point is `dist/api/index.js`. Keep the entire `dist/` directory on the site and import `OPM` from the path relative to your HTML page (the example below assumes the page is beside `dist/`):

```js
import { OPM } from './dist/api/index.js';

const opm = new OPM({ sampleRate: 44100 });
await opm.start(); // call from a user gesture to allow audio playback

const id = opm.playNote({ voice: 'brass', note: 60, time: 0, duration: 0.5 });
// time is a nonnegative delay in seconds; duration is required (0, 60].
// opm.stop(id) releases the note early; await opm.close() closes the AudioContext.
```

Pass a voice object directly to `playNote()`, or register one with `opm.loadVoice('name', voice)`. Notes use MIDI numbers 0–127. At most eight voices sound concurrently; starting a ninth steals the oldest. The worklet accepts up to 256 pending note events.

For deterministic offline rendering without Web Audio:

```js
import { Synth } from './dist/core/index.js';
import { brass } from './dist/voices/brass.js';

const synth = new Synth(44100);
const id = synth.noteOn(brass, 60);
const left = new Float32Array(44100);
const right = new Float32Array(44100);
synth.render(left, right, 0, 22050);
synth.noteOff(id);
synth.render(left, right, 22050, 22050);
```

## Optimized distribution

`dist/` ships ready-to-use, tree-shaken ES modules with shared chunks and compact voice JSON. Public exports, voice fields, validation, 4× oversampling, and output headroom are preserved. Readable implementation files remain in `src/`; do not edit generated files in `dist/`.

The npm package uses the same minified modules: import `OPM` from `opm.js`, `Synth` or `renderNote` from `opm.js/core`, and voices from `opm.js/voices/brass.js`. Consumers need no build tools or runtime dependencies. The npm tarball omits precompressed alternatives to avoid storing the same assets three times.

In a repository checkout or after `npm run build`, every asset also has gzip level 9 (`.gz`) and Brotli quality 11 (`.br`) variants. Configure your server to negotiate these using `Accept-Encoding`, send the matching `Content-Encoding` and original JavaScript/JSON content type, and set `Vary: Accept-Encoding`. Import the normal `.js` paths, not `.br` or `.gz`. A simple static server can serve the uncompressed minified files.

To regenerate the distribution from a repository checkout:

```sh
npm ci
npm run build
npm test
npm run benchmark
```

Only development tooling is installed. The build uses pinned esbuild and Terser, up to ten compression passes, and no unsafe floating-point transformations or property mangling. `npm pack` rebuilds automatically. The benchmark reports warmed median render times at 48 kHz in 128-frame blocks; results depend on the machine and JavaScript engine.

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
