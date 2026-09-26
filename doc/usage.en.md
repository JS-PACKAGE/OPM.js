# OPM.js usage guide (English)

[繁體中文](./usage.zh-TW.md) · [Project README](../README.md)

OPM.js provides `OPM` for real-time AudioWorklet synthesis in the browser and `Synth` for offline rendering without Web Audio (for example in Node.js). The public API may still change before 1.0.

## Start and play in a browser

Use a browser supporting ES modules and AudioWorklet, and serve files over HTTPS or localhost; opening a `file://` page directly will not work. From the repository root run:

```sh
python3 -m http.server 8000
```

Visit `http://localhost:8000/demo/index.html` and click **Play chord**. To create your own page, save the following as `demo/my-demo.html` and open it from the same server. Call `start()` from a user gesture such as a click to satisfy browser autoplay policies.

```html
<button id="play" type="button">Play</button>
<script type="module">
  import { OPM } from '../src/api/index.js';

  const opm = new OPM();
  document.querySelector('#play').addEventListener('click', async () => {
    await opm.start();
    opm.playNote({ voice: 'brass', note: 60, duration: 0.5 });
  });
</script>
```

`brass` is the bundled voice. `playNote({ voice, note, time, duration })` returns a note ID: `note` is an integer MIDI note 0–127; `time` is a delay in seconds relative to the current AudioContext time (default 0, at most 60); `duration` is required and must be in `(0, 60]` seconds. `voice` may be a registered name (default `brass`) or a voice object. Up to eight notes can sound at once; a ninth steals the oldest. The worklet can hold up to 256 pending events.

To load a voice under a custom name and release a note early, replace the page's `<script type="module">` with:

```html
<script type="module">
  import { OPM } from '../src/api/index.js';
  import { brass } from '../src/voices/brass.js';

  const opm = new OPM();
  document.querySelector('#play').addEventListener('click', async () => {
    await opm.start();
    opm.loadVoice('my-brass', brass);
    const id = opm.playNote({ voice: 'my-brass', note: 64, time: 0.1, duration: 1 });
    setTimeout(() => opm.stop(id), 300);
  });
</script>
```

`stop(id)` cancels a note that has not started yet or begins release on an active note. When finished, call `await opm.close()` to close the AudioContext. After `close()`, call `start()` again before playing.

## Offline rendering with Node.js

Requires Node.js 18+. Create `render.mjs` in the repository root:

```js
import { Synth } from './src/core/index.js';
import { brass } from './src/voices/brass.js';

const sampleRate = 44100;
const synth = new Synth(sampleRate);
const id = synth.noteOn(brass, 60);
const left = new Float32Array(sampleRate);
const right = new Float32Array(sampleRate);
synth.render(left, right, 0, sampleRate / 2); // First 0.5 seconds
synth.noteOff(id);
synth.render(left, right, sampleRate / 2, sampleRate / 2); // Release
console.log(left.some(sample => sample !== 0), synth.errorCount);
```

Run `node render.mjs`. `render(left, right, offset, length)` writes into equally sized regions of `Float32Array`s (the channels currently contain identical samples). `noteOff(id)` starts release at the current rendered time. Increase the remaining buffer length to capture longer release tails. The example produces PCM samples; it does **not** export a WAV file.

## Voice format

A complete JSON voice-bank entry uses version 1; see [voice.schema.json](../src/voices/voice.schema.json) and [examples.json](../src/voices/examples.json). The four `ops` are in signal order:

```json
{
  "version": 1,
  "name": "simple",
  "algorithm": 7,
  "feedback": 0,
  "modIndex": 4,
  "lfo": { "rate": 0, "amDepth": 0, "pmDepth": 0 },
  "ops": [
    { "ratio": 1, "level": 0.8, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.6, "r": 0.2 } },
    { "ratio": 2, "level": 0.4, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } },
    { "ratio": 3, "level": 0.3, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } },
    { "ratio": 4, "level": 0.2, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } }
  ]
}
```

- `algorithm` and `feedback` are integers 0–7; `modIndex` is the phase modulation strength, 0–16.
- Per operator: `ratio` is a frequency multiplier (0.125–32), `level` is amplitude (0–1), and `detune` is in cents (±1200). ADSR `a`/`d`/`r` are seconds (0–10) and `s` is 0–1.
- `lfo.rate` is 0–20 Hz, `amDepth` is 0–1, and `pmDepth` is 0–1200 cents.
- A single voice passed to `playNote()`, `loadVoice()`, or `Synth.noteOn()` may omit `version`, `name`, `lfo`, and `modIndex`; the latter two default to LFO off and 4. Out-of-range or nonfinite numeric values are rejected.
- For complete JSON voice banks use `parseVoiceBank()` from `src/voices/schema.js`: all the fields above are required, with at most 128 voices and 256 KiB per JSON string. Unlike the single-voice path, the bank import clamps **finite** out-of-range numeric values to the Schema limits; it still rejects nonfinite values and unknown fields. It returns a `Map<name, voice>`.

```js
import { parseVoiceBank } from '../src/voices/schema.js';
const response = await fetch('../src/voices/examples.json');
const bank = parseVoiceBank(await response.text());
for (const [name, voice] of bank) opm.loadVoice(name, voice);
```

This snippet belongs in a module script under `demo/` with an `opm` instance already created; the `fetch` path is relative to that page. Voices are normalized and copied, so mutating an input object later does not change notes that are already playing.
