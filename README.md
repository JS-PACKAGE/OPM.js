# OPM.js

**A 4-operator FM synthesis engine for the browser, inspired by the Yamaha YM2151 (OPM) sound chip.**

OPM.js recreates the classic 16-bit era FM sound — 8 channels of 4-operator synthesis with multiple algorithms, feedback, and ADSR envelopes — as a lightweight, zero-dependency JavaScript engine powered by the Web Audio API.

> **Status:** early draft. The API described below is a design sketch and may change.

## About

The Yamaha YM2151 (OPM) powered a generation of arcade boards and the Sharp X68000, defining the sound of the mid-1980s with its 8-channel, 4-operator FM architecture. OPM.js brings that architecture to the browser as a pure JavaScript synthesis engine.

OPM.js is a musically-accurate reimplementation, not a cycle-accurate hardware clone: envelope timing and modulation curves are tuned to sound correct rather than to reproduce silicon behaviour bit-for-bit.

## Features

- **4-operator FM synthesis** with 8 connection algorithms and hardware-style feedback
- **Per-operator ADSR envelopes** with key-scaled timing
- **LFO** with AM / PM modulation (tremolo & vibrato)
- **Polyphonic voice allocation** across multiple channels
- **AudioWorklet-based DSP** — synthesis runs off the main thread
- **Zero dependencies**, built on the Web Audio API
- Works in the browser and Node.js (offline rendering)

## Requirements

- Chrome/Chromium 90+, Firefox 88+, Safari 14.1+, Edge 90+
- ES6 and the Web Audio API (AudioWorklet)

## Installation

```bash
npm install opm.js
```

Or drop the build into your page:

```html
<script type="module" src="path/to/opm.js"></script>
```

## Quick start

```js
import { OPM } from 'opm.js';

const opm = new OPM({ sampleRate: 44100 });
await opm.start();            // attaches to an AudioContext

opm.playNote({ voice: 'brass', note: 60, time: 0, duration: 0.5 });
```

## Voice format

A voice is a small JSON object: 4 operators, an algorithm, and feedback.

```json
{
  "name": "brass",
  "algorithm": 4,
  "feedback": 3,
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

- [ ] v0.1 — core engine: 4 operators, common algorithms, ADSR
- [ ] v0.2 — LFO, detune, key scaling
- [ ] v0.3 — full algorithm set + feedback modes
- [ ] v0.4 — DX7 SysEx voice import
- [ ] v0.5 — Node.js offline rendering + WAV export

## Limitations

- Not a register-level YM2151 emulator; VGM playback is out of scope
- Voice bank is small by design — bring your own sounds

## License

[Apache License 2.0](./LICENSE)

Copyright 2026 OPM.js authors

OPM.js is an independent project inspired by the architecture of the Yamaha YM2151. It is not affiliated with, endorsed by, or connected to Yamaha Corporation.
