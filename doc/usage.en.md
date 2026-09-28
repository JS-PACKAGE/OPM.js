# OPM.js usage guide (English)

[繁體中文](./usage.zh-TW.md) · [Project README](../README.md)

OPM.js provides browser AudioWorklet synthesis through `OPM` and offline PCM rendering through `Synth` and `renderNote`. The examples below use the 1.1 ESM package; Node.js 18+ is required for the Node examples.

**Contents:** [Acquire and install](#acquire-and-install) · [Browser quick start](#browser-quick-start) · [Browser API](#browser-api-and-lifecycle) · [Node PCM](#offline-pcm-with-nodejs) · [Voice format and banks](#voice-format-and-banks) · [Compression](#compressed-deployment) · [Troubleshooting](#troubleshooting)

## Acquire and install

Start with a checkout or archive of the [OPM.js repository](https://github.com/YueyuHoshizora/OPM.js). The public npm registry is **not assumed** to have `opm.js`; use a tarball built from this checkout instead. From the **OPM.js repository root**, with Node.js 18+ and npm installed:

```sh
npm ci
npm pack
```

`npm pack` runs the package's `prepack` build and creates `opm.js-1.1.0.tgz`; do not separately build first. From that repository root, make a **new sibling application** (the repository directory must be named `OPM.js` for this relative path):

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.1.0.tgz
```

For an existing app, run `npm install /actual/path/to/opm.js-1.1.0.tgz` in its root instead; `npm init` is unnecessary. Consumer apps do not need this project's build dependencies. The installed package contains built `dist/` JavaScript/JSON and documentation/legal files, but **not** `src/`, `scripts/`, `demo/`, or precompressed `.br`/`.gz` files. Run maintainer scripts only in the checkout. Node ESM imports from the installed package use `opm.js/core` and `opm.js/voices/brass.js`; a plain browser cannot resolve bare package specifiers without an import map or bundler.

## Browser quick start

For the existing checkout demos, from the **OPM.js repository root** run:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/index.html` for the song demo or `http://localhost:8000/demo/index.html` for the chord demo. Python 3 is only used as a local static server. Committed `dist/` works without installing/building; if it is missing or source has changed, run `npm ci` then `npm run build` in the checkout. Use a modern browser supporting ES modules and AudioWorklet, served over HTTPS or localhost, not `file://`.

To create an app page, from the **opm-app root** created above, copy the entire installed distribution and license into the static public directory (POSIX shell; on other systems copy the same files manually):

```sh
mkdir -p public/opm
cp -R node_modules/opm.js/dist/. public/opm/
cp node_modules/opm.js/LICENSE public/opm/LICENSE
```

Save this complete page as **`opm-app/public/index.html`**:

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

From the **opm-app root**, serve `public/` and visit `http://localhost:8000/`; click the button to hear the chord:

```sh
python3 -m http.server 8000 --directory public
```

Without npm, instead copy the checkout's **complete** `dist/` contents to `site/opm/`, copy its `LICENSE` to `site/opm/LICENSE`, save the same page as `site/index.html`, then from the directory containing `site/` serve it with `python3 -m http.server 8000 --directory site`. Keep `api/`, `core/`, `worklet/`, `voices/`, and `chunks/` together, including hashed chunks; do not relocate the worklet alone. The browser imports the served `./opm/api/index.js` URL, not the bare npm name. Bundlers may fail to copy the worklet module graph automatically; static-copy deployment is the supported straightforward route, without assuming any particular bundler integration.

## Browser API and lifecycle

| Call | Contract |
| --- | --- |
| `new OPM({ sampleRate } = {})` | Optional integer sample rate 8000–96000 Hz; omit for the browser default. Hardware/browser support can reject a requested rate. |
| `await opm.start()` | Initialize from a user gesture such as the button click above, and await it before playback. Sequential calls after startup are harmless; serialize `start()` and `close()` rather than launching concurrent starts. |
| `opm.loadVoice(name, voice)` | Validate and copy a voice under an ASCII name matching `[a-zA-Z0-9_-]{1,64}`. Works before `start()`; replacing a name affects future notes, not already sounding ones. |
| `opm.playNote({ voice = 'brass', note, time = 0, duration })` | `note` is a required integer MIDI pitch 0–127. `time` is a **delay** of 0–60 seconds from now, not an absolute AudioContext timestamp; `duration` is required, >0 and ≤60 seconds, excluding release. `voice` is a registered name or a voice object. Returns a positive safe-integer ID, not a completion promise or confirmation that a queued event was accepted. |
| `opm.stop(id)` | Requires a started instance and positive safe-integer ID. Cancels a future start or begins release on a sounding note; returns `undefined`, and release is not instant mute. |
| `await opm.close()` | Disconnects and closes the context, ending sound and queued context work. Call `start()` again to reuse the instance. |

Eight notes can sound concurrently, including release tails; another note steals the oldest. The worklet holds at most 256 pending events; a future note requires both start and off events, so an empty queue accommodates at most 128 fully future notes. Overflow messages are silently ignored: an ID alone does not guarantee admission. There is no global `setLFO()` method; set `voice.lfo` before loading or playing that voice.

For customization and early release, **replace only the module `<script>` in `opm-app/public/index.html` above**, keeping its `#play` button and `#status` output:

```html
<script type="module">
  import { OPM } from './opm/api/index.js';
  import { brass } from './opm/voices/brass.js';

  const opm = new OPM();
  const voice = structuredClone(brass);
  voice.lfo.rate = 5;
  voice.lfo.amDepth = 0.2;
  voice.ops[0].level = 0.6;
  opm.loadVoice('my-brass', voice);
  const play = document.querySelector('#play');
  play.textContent = 'Play custom brass note';
  const status = document.querySelector('#status');
  play.addEventListener('click', async () => {
    play.disabled = true;
    try {
      await opm.start();
      const id = opm.playNote({ voice: 'my-brass', note: 64, time: 0.1, duration: 1 });
      setTimeout(() => opm.stop(id), 300);
      status.textContent = 'Playing custom brass note';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      play.disabled = false;
    }
  });
</script>
```

This example schedules the note 0.1 seconds ahead and starts its release after roughly 0.3 seconds; the timer is not sample-accurate. When disposing the page's synthesizer, `await opm.close()`; another click can start it again.

## Offline PCM with Node.js

In the **npm-installed opm-app root**, save the following as **`render.mjs`**:

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

Run `node render.mjs` in **opm-app**; expected output is `true 0`. This fills PCM buffers, **not** a speaker or WAV file; the two output channels currently contain identical samples. To run this script instead in the **repository root**, change its imports to `./dist/core/index.js` and `./dist/voices/brass.js`. Use `.mjs` (or an ESM `type: module` project); no CommonJS entry is advertised.

`new Synth(sampleRate, maxVoices = 8)` requires a finite rate 8000–192000 Hz and integer maximum of 1–8 voices. `noteOn(voice, note, id?)` strictly normalizes the voice, requires integer pitch 0–127, optionally accepts a positive safe-integer ID not used by an active voice, and returns the allocated ID; the oldest voice is stolen when full. `noteOff(id)` returns `true` only for the first successful release, `false` for unknown or already released IDs.

`render(left, right, offset = 0, length = left.length - offset)` needs `Float32Array` buffers and nonnegative safe-integer ranges fitting **both** buffers (their total sizes may differ). Rendering advances `currentFrame`; inspect `errorCount` for numerical failures. Split rendering at desired note-on/off frames as above: there are no real-time timers in this API. Render sufficient frames after note-off for the release tail.

For a simpler **mono** render, save this standalone script as **`opm-app/render-note.mjs`**:

```js
import { renderNote } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const { samples, sampleRate, diagnostics } = renderNote({
  voice: brass,
  note: 60,
  duration: 0.1,
  sampleRate: 44100
});
console.log(samples.length, sampleRate, diagnostics.errors);
```

Run `node render-note.mjs` from **opm-app**. In a checkout-root copy of this script use `./dist/core/index.js` and `./dist/voices/brass.js` imports instead. `renderNote({ voice, note = 60, duration = 0.5, velocity = 1, sampleRate = 44100 })` returns `{ samples, sampleRate, diagnostics: { errors } }`. It requires a **complete schema voice**; finite voice numeric fields are clamped to schema bounds, except that invalid version, algorithm, and feedback values are rejected. Finite note (including fractional pitch), duration, and velocity are clamped respectively to 0–127, 0–30 seconds, and 0–1. Sample rate must be an integer 8000–96000 Hz.

Output length is `ceil((duration + maximum operator release + 0.01) * sampleRate)`, capped at 4,000,000 samples (larger allocations throw). Although LFO fields are validated, **renderNote does not apply LFO** and its mixing/output differ from `Synth`; use `Synth` for browser-equivalent LFO and polyphonic rendering.

Other core exports: `normalizeVoice` returns a strict, detached voice copy; `envelopeAt(time, gate, adsr)` returns dB-derived amplitude with time/gate in seconds; `ALGORITHMS` is eight immutable routing graphs; `HEADROOM = 0.7`, `OVERSAMPLE = 4`, `MAX_RENDER_SAMPLES = 4000000`; and `sampleRateValue` validates integer 8000–96000 Hz. `dist/voices/schema.js` exports `validateVoice(voice)` (complete, frozen validation), `parseVoiceBank(input)`, finite-number clamping helper `bounded(value, min, max, label = 'number')`, `LIMITS`, `MAX_BANK_BYTES`, and `MAX_BANK_VOICES`.

## Voice format and banks

A standalone **`voice.json`** (save in **opm-app** if using it as a local asset) can contain this complete schema voice. See [voice.schema.json](../dist/voices/voice.schema.json) and bundled [examples.json](../dist/voices/examples.json). Four operators appear in signal order:

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

| Field | Bounds and meaning |
| --- | --- |
| `version`, `name` | Full schema requires version exactly `1` and a 1–64 character ASCII letter/digit/underscore/hyphen name. |
| `algorithm`, `feedback` | Integers 0–7. |
| `modIndex` | Phase-modulation strength 0–16. |
| `ops` | Exactly four operators, each with `ratio` 0.125–32, `level` 0–1, `detune` −1200–1200 cents, and complete `adsr`: `a`, `d`, `r` each 0–10 seconds; sustain `s` 0–1. |
| `lfo` | `rate` 0–20 Hz, amplitude depth `amDepth` 0–1, pitch depth `pmDepth` 0–1200 cents. |

For **single voices** passed to `OPM.playNote`, `OPM.loadVoice`, `Synth.noteOn`, or `normalizeVoice`, `version`, `name`, `modIndex`, and `lfo` may be omitted; modulation defaults to 4 and LFO to off. If supplied, `version` must be 1 and `name` must match the pattern above. All other fields and all four complete operators are required. This strict path rejects out-of-range/nonfinite numbers; both paths reject unknown fields, wrong types, accessor properties, and sparse arrays. Validation copies voices: mutating the input afterwards does not change already playing notes.

A complete **bank JSON file** must contain an **array** of 1–128 complete voices with unique names (wrap the standalone object above in `[...]`); it is not a single top-level voice object. `parseVoiceBank(jsonStringOrArray)` from `opm.js/voices/schema.js` for Node, or the served `./opm/voices/schema.js` for browsers, returns a `Map` of names to frozen validated voices. JSON strings are capped at 256 KiB UTF-8; arrays are capped by voice count. Bank parsing and `validateVoice` clamp **finite** out-of-range numeric fields to schema limits, unlike strict single-voice normalization; invalid version/algorithm/feedback values, nonfinite values, wrong types, and unknown fields still fail.

For a working bank loader, **replace the module `<script>` in `opm-app/public/index.html`** from the browser quick start, keeping its `#play` button and `#status` output. The earlier copy command places `examples.json` at `public/opm/voices/examples.json`:

```html
<script type="module">
  import { OPM } from './opm/api/index.js';
  import { parseVoiceBank } from './opm/voices/schema.js';

  const opm = new OPM();
  const play = document.querySelector('#play');
  play.textContent = 'Play bank brass note';
  const status = document.querySelector('#status');
  play.addEventListener('click', async () => {
    play.disabled = true;
    try {
      await opm.start();
      const response = await fetch('./opm/voices/examples.json');
      if (!response.ok) throw new Error(`Voice bank HTTP ${response.status}`);
      const bank = parseVoiceBank(await response.text());
      for (const [name, voice] of bank) opm.loadVoice(name, voice);
      opm.playNote({ voice: 'brass', note: 60, duration: 0.7 });
      status.textContent = 'Playing bank brass note';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      play.disabled = false;
    }
  });
</script>
```

Serve `public/` as above and click the button. This example loads a **trusted bundled asset**, not an unrestricted remote downloader: parsing limits apply **after** `response.text()` has fetched the body. For untrusted downloads, your host/application must restrict source, content type, and response size before reading it; the engine does not provide a network download API.

## Compressed deployment

Ordinary minified `.js` and `.json` assets work directly. The checkout build also produces Brotli `.br` (quality 11) and gzip `.gz` (level 9) sidecars, but the npm tarball excludes them. For installed apps, configure compression at the web host or build sidecars in the checkout. Import `.js` URLs, **never** `.br` or `.gz` URLs. If serving compressed bytes, configure the matching `Content-Encoding` (`br` or `gzip`) and `Vary: Accept-Encoding`, plus correct JavaScript/JSON MIME types; uncompressed bytes must not be marked compressed. Python's basic HTTP server does not negotiate sidecars. Deploy the entire matching `dist/` tree, including worklet and hashed chunks, as one version. See the README's [optimized-distribution notes](../README.md#optimized-distribution).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `file://`, insecure-origin, or AudioWorklet unavailable | Serve over HTTPS or `http://localhost`, in a browser supporting ES modules and AudioWorklet. |
| Bare `opm.js` browser import cannot resolve | Import a served `./opm/...` URL after copying assets; a bare specifier needs a separately configured import map or bundler. |
| Worklet/chunk 404, HTML returned instead of JS, or MIME error | Copy the **whole** `dist/` tree; preserve relative paths and exclude assets from SPA HTML rewrites. Check JavaScript/JSON MIME types. |
| Autoplay blocked or playback before start | Invoke and await `opm.start()` inside a user click before `playNote()`. |
| Invalid pitch, voice name, duration, or unknown voice | Check the [browser API](#browser-api-and-lifecycle) argument bounds and register custom names before playback. |
| Scheduled notes disappear | At most eight sounding voices (including releases) and 256 queued worklet events; an ID does not acknowledge admission. |
| Node output is silent in speakers or no WAV appears | `Synth.render` and `renderNote` produce PCM data only; feed it to an audio output/encoder separately. |
| `renderNote` ignores LFO | This is its documented behavior; use `Synth` for LFO/polyphonic engine rendering. |
| npm registry `E404` | Pack this checkout and install the [local tarball](#acquire-and-install), not a presumed registry release. |
| Bank parse fails | Supply an array of complete, uniquely named schema voices within the bank size/count limits. |
| Compressed bytes look like gibberish | Set the correct encoding and MIME response headers, or simply serve the ordinary `.js`/`.json` files. |
