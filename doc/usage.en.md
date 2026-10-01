# OPM.js usage guide (English)

[繁體中文](./usage.zh-TW.md) · [Project README](../README.md)

OPM.js 1.2 provides browser AudioWorklet synthesis through `OPM`, offline stereo PCM through `Synth` and `renderNote`, PCM16 WAV encoding, and approximate DX7 voice import. Public ESM exports include TypeScript declarations. Node.js 18+ is required for Node examples.

**Contents:** [Acquire and install](#acquire-and-install) · [Browser quick start](#browser-quick-start) · [Browser API](#browser-api-and-lifecycle) · [Node PCM](#offline-pcm-with-nodejs) · [Voice format and banks](#voice-format-and-banks) · [Compression](#compressed-deployment) · [Troubleshooting](#troubleshooting)

## Acquire and install

Start with a checkout or archive of the [OPM.js repository](https://github.com/YueyuHoshizora/OPM.js). The public npm registry is **not assumed** to have `opm.js`; use a tarball built from this checkout instead. From the **OPM.js repository root**, with Node.js 18+ and npm installed:

```sh
npm ci
npm pack
```

`npm pack` runs the package's `prepack` build and creates `opm.js-1.2.0.tgz`; do not separately build first. From that repository root, make a **new sibling application** (the repository directory must be named `OPM.js` for this relative path):

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.2.0.tgz
```

For an existing app, run `npm install /actual/path/to/opm.js-1.2.0.tgz` in its root instead; `npm init` is unnecessary. Consumer apps need no development dependencies. The package contains built JavaScript/JSON, declarations, documentation/legal files, but not source, scripts, demos, or compressed sidecars. Node uses `opm.js/core` and `opm.js/voices/brass.js`; browsers without an import map/bundler use served URLs.

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
| `new OPM({ sampleRate, context, destination, onEvent } = {})` | Optional integer sample rate 8000–96000 Hz. Borrow a supplied AudioContext; OPM never suspends/closes it. Omitted destination uses `context.destination`; `null` disables automatic connection. |
| `await opm.start()` / `await opm.resume()` | Initialize/resume from a user gesture and await before playback. Concurrent starts coalesce; existing suspended contexts resume. |
| `opm.connect(destination)` / `opm.disconnect(destination?)` | Connect/disconnect the started worklet; return the instance. Destination must belong to its context; omitted disconnect destination removes all connections. |
| `opm.loadVoice(name, voice)` | Strictly validate/copy a voice under `[a-zA-Z0-9_-]{1,64}`. Works before startup; replacement affects future notes. |
| `opm.playNote({ voice = 'brass', note, time = 0, duration = null, velocity = 1, pan = 0 })` | MIDI integer 0–127; delay 0–60 seconds; duration `(0,60]` or `null` to hold until stop. Velocity 0–1; pan −1–1. Return a positive safe-integer ID without wrap, not an admission promise. |
| `opm.stop(id)` | Cancel a future start or begin active release; positive safe-integer ID, started instance required. Unknown/ended/stolen/already-released IDs are harmless no-ops. Returns no value. |
| `await opm.getDiagnostics()` | Resolve `{type:'diagnostics',requestId,activeVoices,pendingEvents,errors,rejectedNotes}`. Requires running context, at most 64 outstanding; suspend/close/processor failure rejects pending requests. Resume before retrying. |
| `await opm.close()` | Serialize disposal against initialization, disconnect the node, close only an owned context. Startup after close recreates owned contexts; borrowed contexts survive. |

`onEvent` receives note states (`accepted`, `started`, `released`, `ended`, `stolen`, `cancelled`, `rejected`) as `{type:'note',id,state,reason?}`, diagnostics replies, and `{type:'error',error}` processor failures. Callback exceptions are isolated. Watch rejections rather than assuming an ID means admission.

There are at most eight logical voices plus eight bounded ~5 ms steal fades. The oldest logical voice is stolen when full. Pending events and tracked IDs are each capped at 256. Future timed notes use two events, held notes one; duplicates/overflow reject before enqueueing. Terminal notifications remove obsolete off events. There is no `setLFO()`; use `voice.lfo`.

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
      const id = opm.playNote({ voice: 'my-brass', note: 64, time: 0.1, velocity: 0.7, pan: -0.5 });
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

### Shared context, output routing, and events

For a host-owned context, replace the quick-start page's module script with this block. It holds each note until the Stop button and leaves the host context alive on disposal:

```html
<script type="module">
  import { OPM } from './opm/api/index.js';
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = 0.3;
  gain.connect(context.destination);
  const status = document.querySelector('#status');
  const opm = new OPM({
    context, destination: null,
    onEvent(event) {
      status.textContent = event.type === 'error'
        ? event.error.message
        : event.type === 'note' ? `${event.id}: ${event.state}` : `Voices: ${event.activeVoices}`;
    }
  });
  const stop = document.createElement('button');
  stop.textContent = 'Stop held note';
  document.body.append(stop);
  let id;
  let connected = false;
  document.querySelector('#play').addEventListener('click', async () => {
    try {
      await opm.resume();
      if (!connected) { opm.connect(gain); connected = true; }
      if (id !== undefined) opm.stop(id);
      id = opm.playNote({ note: 60, velocity: 0.7, pan: 0.5 });
      console.log(await opm.getDiagnostics());
    } catch (error) { status.textContent = error.message; }
  });
  stop.addEventListener('click', () => { if (id !== undefined) opm.stop(id); });
  window.disposeOPM = async () => {
    await opm.close();
    connected = false;
    id = undefined;
    gain.disconnect();
    // The host decides when to close context.
  };
</script>
```

Call `await window.disposeOPM()` when removing this app's audio UI. The host remains responsible for the shared context and downstream nodes. Avoid suspending a shared context merely to stop one synthesizer.

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

Run `node render.mjs` in **opm-app**; expected output is `true 0`. These are in-memory PCM buffers; center pan is dual mono, other positions are stereo. Checkout imports are `./dist/core/index.js` and `./dist/voices/brass.js`. Use `.mjs` or `"type": "module"`; there is no CommonJS entry.

`new Synth(sampleRate, maxVoices = 8)` requires finite 8000–192000 Hz and integer 1–8 voices. `noteOn(voice, note, id?, {velocity=1,pan=0}={})` strictly normalizes voices; core notes can be finite fractional MIDI 0–127. Velocity 0–1 and pan −1–1 are strict. IDs are positive safe integers unique among active notes. `noteOff(id)` returns `true` only on first release. `lastStolenId` is null unless the last successful note-on stole a note; optional `onVoiceEnded(id,reason)` reports exactly one logical terminal event (`stolen`, `ended`, `error`).

`render(left, right, offset = 0, length = left.length - offset)` needs `Float32Array` buffers and nonnegative safe-integer ranges fitting **both** buffers (their total sizes may differ). Rendering advances `currentFrame`; inspect `errorCount` for numerical failures. Split rendering at desired note-on/off frames as above: there are no real-time timers in this API. Render sufficient frames after note-off for the release tail.

For a simpler single-note render, save this standalone script as **`opm-app/render-note.mjs`**:

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

Run `node render-note.mjs` in **opm-app**. For a checkout use `./dist/core/index.js` and `./dist/voices/brass.js`. `renderNote({ voice, note=60, duration=0.5, velocity=1, pan=0, sampleRate=44100 })` returns `{samples,left,right,sampleRate,diagnostics:{errors}}`, where `samples === left`. It requires a complete schema voice. Finite voice numeric fields clamp (invalid versions/algorithm/feedback still reject); finite note/duration/velocity/pan clamp to 0–127/0–30/0–1/−1–1. Sample rate is an integer 8000–96000 Hz.

It uses `Synth`'s exact envelope timing, LFO, filter, velocity, pan, and saturation path. Length stays `ceil((duration + longestRelease + 0.01) * sampleRate)` with a 4,000,000-frame cap. Pan gains before saturation are `sqrt(2)*cos/sin((pan+1)*pi/4)`: center preserves old dual-mono gain; hard sides mute one channel and boost the other by `sqrt(2)`. Saturation may change the perceived constant-power balance.

Other core exports: `normalizeVoice` returns a strict, detached voice copy; `envelopeAt(time, gate, adsr)` returns dB-derived amplitude with time/gate in seconds; `ALGORITHMS` is eight immutable routing graphs; `HEADROOM = 0.7`, `OVERSAMPLE = 4`, `MAX_RENDER_SAMPLES = 4000000`; and `sampleRateValue` validates integer 8000–96000 Hz. `dist/voices/schema.js` exports `validateVoice(voice)` (complete, frozen validation), `parseVoiceBank(input)`, finite-number clamping helper `bounded(value, min, max, label = 'number')`, `LIMITS`, `MAX_BANK_BYTES`, and `MAX_BANK_VOICES`.

## Voice format and banks

A standalone **`voice.json`** (save in **opm-app** if using it as a local asset) can contain this complete schema voice. See [voice.schema.json](../dist/voices/voice.schema.json) and bundled [examples.json](../dist/voices/examples.json). Four operators appear in signal order:

```json
{
  "version": 2,
  "name": "simple",
  "algorithm": 7,
  "feedback": 0,
  "modIndex": 4,
  "lfo": { "rate": 0, "amDepth": 0, "pmDepth": 0 },
  "ops": [
    { "ratio": 1, "level": 0.8, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.6, "r": 0.2 }, "keyScale": { "breakpoint": 60, "leftDbPerOctave": 0, "rightDbPerOctave": 6 } },
    { "ratio": 2, "level": 0.4, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } },
    { "ratio": 3, "level": 0.3, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } },
    { "ratio": 4, "level": 0.2, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } }
  ]
}
```

| Field | Bounds and meaning |
| --- | --- |
| `version`, `name` | Complete schema voices use version `2`; legacy `1` is accepted without key scaling. Names: 1–64 ASCII letters/digits/underscores/hyphens. |
| `algorithm`, `feedback` | Integers 0–7. |
| `modIndex` | Phase-modulation strength 0–16. |
| `ops` | Exactly four operators, each with `ratio` 0.125–32, `level` 0–1, `detune` −1200–1200 cents, and complete `adsr`: `a`, `d`, `r` each 0–10 seconds; sustain `s` 0–1. |
| `lfo` | `rate` 0–20 Hz, amplitude depth `amDepth` 0–1, pitch depth `pmDepth` 0–1200 cents. |
| `ops[i].keyScale` | Optional: breakpoint is a MIDI integer 0–127; left/right slopes are 0–24 dB/octave. Omission is flat. |

Single voices passed to `OPM`, `Synth.noteOn`, or `normalizeVoice` may omit `version`, `name`, `modIndex`, and `lfo`; modulation defaults to 4 and LFO off. Supplied version is 2 or legacy 1 (no key scaling). Versioned output canonicalizes to 2. All four complete operators remain required. Strict normalization rejects out-of-range/nonfinite numbers; both paths reject unknown fields, wrong types, accessors, and sparse arrays. Copies isolate playing notes from later input mutation. Key scaling attenuates each operator by `10 ** (-slope * abs(note-breakpoint) / 12 / 20)` on the relevant side; pan is a note option, never a voice field.

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

## WAV export and DX7 import

In **opm-app**, save `export.mjs` and run `node export.mjs`:

```js
import { writeFile, readFile } from 'node:fs/promises';
import { renderNote, encodeWav } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';
import { importDX7, describeDX7 } from 'opm.js/voices/dx7.js';

const audio = renderNote({ voice: brass, duration: 0.7, velocity: 0.8, pan: -0.5 });
await writeFile('brass.wav', encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate }));
// Optional: node export.mjs /path/to/your/voice.syx
if (process.argv[2]) {
  const bytes = new Uint8Array(await readFile(process.argv[2]));
  const voices = importDX7(bytes);
  console.log(describeDX7(bytes));
  const imported = renderNote({ voice: voices[0], duration: 1 });
  await writeFile('imported.wav', encodeWav({ left: imported.left, right: imported.right, sampleRate: imported.sampleRate }));
}
```

Checkout imports use `./dist/core/index.js`, `./dist/voices/brass.js`, and `./dist/voices/dx7.js`. `encodeWav({left,right?,sampleRate})` returns PCM16 little-endian RIFF bytes. Omit right for mono. Float32 arrays must contain finite samples in −1–1; out-of-range amplitudes reject rather than clip. Stereo lengths must match. Rate is integer 8000–192000 Hz; budget is 4,000,000 frames. Pass only these own-data fields: a whole renderNote result has extra fields and is rejected. It only encodes; your application saves/downloads bytes.

`importDX7(Uint8Array)` accepts exactly one standard **163-byte single voice** or **4104-byte 32-voice bank** SysEx message, validating framing, seven-bit payload, length, and checksum. Raw payloads, concatenated messages, and other formats are rejected. It returns complete normalized version 2 voices. `describeDX7` validates the same bytes and returns `{name,sourceAlgorithm,algorithm,selectedOperators,droppedOperators,warnings}` for each voice. Original algorithms are 1–32, converted algorithms 0–7; operator numbers are DX7 1–6, with selected operators in OPM signal order.

This is **approximate six-to-four-operator conversion**, not DX7 synthesis/emulation or lossless patch interchange. Routing/operators are reduced; envelopes, levels, key scaling, detune, and LFO are approximated. Fixed-frequency operators become ratios referenced to MIDI 60, with ratio clipping. Pitch envelopes, per-operator velocity/rate scaling, and LFO delay/waveform/sync are unsupported. Review warnings and audition the result; descriptions are separate from the strict voice schema. In browsers import `./opm/voices/dx7.js`, obtain bytes with `new Uint8Array(await file.arrayBuffer())`, and register converted voices with `opm.loadVoice(voice.name,voice)`. Restrict untrusted file/download size before buffering.

## Quality and release acceptance

Maintainer commands run in the checkout, after `npm ci`:

```sh
npm run build
npm test
npm run typecheck
npm run security -- --package-smoke
npx --no-install playwright install --with-deps chromium
npm run browser-smoke -- chromium
npm run benchmark
```

Use firefox/webkit instead to install/exercise those browsers. CI configures Node 18/22/24 and all three browser engines; configuration alone does not prove successful runs. Observed versions/results belong in CHANGELOG. Browser acceptance observes real AudioWorklet signal, finite output, lifecycle/release, and deployment paths, not just fake contexts. Roadmap completion requires a tested feature, working demo sound/export, and README coverage.

Headless Linux Firefox also needs a running native audio server; browser library installation alone is insufficient. CI installs `pulseaudio`, runs `pulseaudio --start --exit-idle-time=-1`, loads `pactl load-module module-null-sink sink_name=opm_ci`, selects `pactl set-default-sink opm_ci`, and checks `pactl info` before smoke. A null sink discards speaker output but still runs the native audio clock and real worklet graph. Smoke logs identify the pending stage and context state if initialization/resume stalls.

Benchmark output reports warmed 128-frame block p95/p99/worst and misses of `128/sampleRate` seconds. `OPM_BENCH_BLOCKS`, `OPM_BENCH_WARMUP`, and `OPM_BENCH_SAMPLE_RATE` control workloads; optional p99/worst budget ratios enforce host-specific thresholds. Local defaults are report-only; CI configures `OPM_BENCH_P99_BUDGET_RATIO=1` at 48 kHz (2.667 ms), worst/GC stalls report-only. This is not a universal real-time guarantee. Spectral acceptance compares a 30 kHz oscillator folded to 18 kHz with an equal-level 1760 Hz control at 48 kHz (at least 30 dB attenuation), not arbitrary band-limited FM proof.

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
| Scheduled notes disappear | Watch lifecycle rejections/steals and diagnostics; respect eight logical voices and bounded IDs/events. |
| Node makes no speaker sound/file | PCM must be played/saved explicitly; use the WAV export recipe above. |
| Processor failure | Handle `onEvent` errors and failed diagnostics; close/restart rather than bypassing validation or substituting a fallback engine. |
| npm registry `E404` | Pack this checkout and install the [local tarball](#acquire-and-install), not a presumed registry release. |
| Bank parse fails | Supply an array of complete, uniquely named schema voices within the bank size/count limits. |
| Compressed bytes look like gibberish | Set the correct encoding and MIME response headers, or simply serve the ordinary `.js`/`.json` files. |
