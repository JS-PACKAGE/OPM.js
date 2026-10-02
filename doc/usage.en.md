# OPM.js usage guide (English)

[繁體中文](./usage.zh-TW.md) · [Project README](../README.md)

GitHub release **v1.7 (package 1.7.0)** includes canonical voice v6, live operator controls, immutable quality/polyphony selection, atomic voice-bank management, beat transport, multipart performance policies and incremental/Worker WAV export. GitHub distribution does not imply npm registry publication. Node.js 22+ is required; README is the canonical API reference.

Voice-format versions are independent of package versions: v1.7 uses canonical voice v6; the immutable v1.6 release used v5. Explicit legacy voice versions 1–5 retain their original input shapes.

**Contents:** [Acquire and install](#acquire-and-install) · [Browser quick start](#browser-quick-start) · [Browser API](#browser-api-and-lifecycle) · [Node PCM](#offline-pcm-with-nodejs) · [Voice format and banks](#voice-format-and-banks) · [Compression](#compressed-deployment) · [Troubleshooting](#troubleshooting)

## Acquire and install

Start with a checkout or archive of the [OPM.js repository](https://github.com/YueyuHoshizora/OPM.js). The public npm registry is **not assumed** to have `opm.js`; use a tarball built from this checkout instead. From the **OPM.js repository root**, with Node.js 22+ and npm installed:

```sh
npm ci
npm pack
```

`npm pack` runs the package's `prepack` build and creates `opm.js-1.7.0.tgz`; do not separately build first. From that repository root, make a **new sibling application** (the repository directory must be named `OPM.js` for this relative path):

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.7.0.tgz
```

For an existing app, run `npm install /actual/path/to/opm.js-1.7.0.tgz` in its root instead; `npm init` is unnecessary. Consumer apps need no development dependencies. The package contains minified `.js` modules, matching `.js.map` source maps with embedded TypeScript sources, generated `.d.ts` declarations, demo scripts, and documentation/legal files, but not separate TypeScript source files, development scripts/tests, or HTML pages. Node uses `opm.js/core` and `opm.js/voices/brass.js`; browsers without an import map/bundler use served URLs.

## Browser quick start

For the existing checkout demos, from the **OPM.js repository root** run:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/index.html` for eight examples: notes, lookahead melody, live modulation, shared context, WAV, playground, audition and [shared scores/interruption recovery](../examples/sequence.html). Python 3 only serves local assets. Committed `dist/` needs no installation/build; after source/helper changes run `npm ci` then `npm run build`. Use HTTPS or localhost with ES modules/AudioWorklet, never `file://`.

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

Without npm, instead copy the checkout's **complete** `dist/` contents to `site/opm/`, copy its `LICENSE` to `site/opm/LICENSE`, save the same page as `site/index.html`, then from the directory containing `site/` serve it with `python3 -m http.server 8000 --directory site`. Keep `api/`, `core/`, `worklet/`, `worker/`, and `voices/` together, including companion modules, maps and declarations. Do not relocate just one worklet/Worker file. Modules preserve source paths instead of using hashed chunks. The browser imports the served `./opm/api/index.js` URL, not the bare npm name. Static-copy deployment avoids relying on a bundler to discover either module graph.

For an installed-package Vite app, follow [the standalone Vite guide](../examples/vite/README.md): install the local tarball and copy the complete distribution plus license. Vite is an optional host development tool, not an OPM.js runtime dependency or consumer build requirement. Keep worklet assets out of SPA fallback rewrites, use JavaScript MIME types, and configure CSP for your module/worklet deployment; do not loosen production policy just to run an inline example. Publication prerequisites are documented in [publishing](./publishing.md); this guide does not imply a registry release or configured npm authentication.

## Browser API and lifecycle

| Call | Contract |
| --- | --- |
| `new OPM({ sampleRate, context, destination, workletUrl, onEvent, mixGain = 1, tuning = {}, stealing = 'oldest', interruption = 'cancel', quality = 'standard', maxVoices = 8 } = {})` | Integer rate 8000–96000 Hz; immutable quality `'eco'`/`'standard'`/`'high'` and integer polyphony 1–8 survive close/restart. Borrowed contexts are never suspended/closed by OPM. Omitted destination uses `context.destination`; `null` disables connection. `workletUrl` optionally relocates the complete same-origin worklet tree without weakening secure-context/CSP/MIME requirements. |
| `await opm.start()` / `await opm.resume()` | Initialize/resume from a user gesture and await before playback. Concurrent starts coalesce; existing suspended contexts resume. |
| `opm.connect(destination)` / `opm.disconnect(destination?)` | Connect/disconnect the started worklet; return the instance. Destination must belong to its context; omitted disconnect destination removes all connections. |
| `opm.loadVoice(name, voice)` | Strictly validate/copy a voice under `[a-zA-Z0-9_-]{1,64}` in a registry bounded to 128 names. Works before startup; replacement affects future notes. |
| `opm.replaceVoiceBank(source)` / `opm.exportVoiceBank()` / `opm.removeVoice(name)` | Validate the entire JSON string or readonly complete-voice array before replacing the registry; at most 128 entries and 256 KiB JSON. Plain `[]` clears, but JSON `"[]"` remains invalid under the parser's 1–128 contract. Export canonical named JSON (empty bank: `[]`), bounded to 256 KiB. Removal returns boolean and does not kill sounding/queued frozen patches. |
| `opm.playNote({ voice = 'brass', note, time = 0, at, duration = null, velocity = 1, pan = 0, late = 'start' })` | Finite fractional MIDI 0–127; relative delay 0–60 seconds or mutually exclusive absolute `at`. Duration `(0,60]` or `null` to hold; velocity 0–1; pan −1–1. Returns a positive safe-integer note ID, not admission acknowledgement. |
| `opm.stop(id, { at } = {})` | Return a command ID; cancel a pending onset/release a live note immediately or at `at`, preserving natural release-tail automation. `{cancelControls:true}` instead immediately cancels that ID's queued onset/control/off commands and releases it. `cancelControls`, even false, cannot combine with `at`. Inactive/already-released targets report command rejection without changing note state. |
| `opm.updateNote(id, controls, { at } = {})` | Return a command ID; pending controls apply at onset, and releasing notes remain controllable. Inactive/invalid/queue-full commands report rejection. |
| `opm.allNotesOff()` / `opm.panic()` | Return a command ID; bypass full scheduled queues. Cancel pending events and release active gates / immediately silence all tails and emit reset. Cache and routing survive. |
| `opm.setMixGain(gain)` / `opm.setTuning(tuning)` | Require startup, return a command ID, and retain settings across node recreation; no phase/envelope restart. |
| `await opm.getDiagnostics()` | Resolve `{type:'diagnostics',requestId,activeVoices,pendingEvents,errors,rejectedNotes}`. Requires running context, at most 64 outstanding; suspend/close/processor failure rejects pending requests. Resume before retrying. |
| `await opm.close()` | Serialize disposal against initialization, disconnect the node, close only an owned context. Startup after close recreates owned contexts; borrowed contexts survive. |
| `opm.subscribe(listener)` | Subscribe independently; returns an idempotent unsubscribe function. Exceptions are isolated. |
| `await opm.waitForCommand(commandId, { timeout, signal } = {})` | Admission-only wait: default 5000 ms, integer 1–60000 ms, optional AbortSignal; 64 pending waits/128 retained receipts. Rejection throws `CommandRejectedError`; acceptance is not execution. |
| `await opm.dispose()` | Terminal cleanup; cannot restart this instance. `close()` remains restartable. |

`onEvent` receives note lifecycle states, diagnostics, processor errors, command acknowledgements `{type:'command',command,commandId?,id?,state,reason?,frame,time}`, context state changes and global resets. Command state is `accepted` or `rejected`; acceptance means admission/immediate application, not guaranteed future execution. Correlate command IDs and handle rejection. Clear held-note bookkeeping on reset (`close`, `failure`, `panic`, `interruption`); close/failure need not produce every per-note terminal reply. Frame/time are audio boundaries, not callback delivery timestamps. `opm.voices` is a defensive `ReadonlyMap` snapshot of frozen patches.

Absolute `at` must be finite, nonnegative, safely representable in sample frames, and at most 60 seconds ahead of `opm.context.currentTime`. Past times are allowed: default `late:'start'` starts at the first available frame with its full gate duration; `late:'drop'` rejects with reason `late`, including worklet delivery delays. At equal frames, stop precedes onset, then controls; a scheduled stop at/before onset cancels rather than briefly sounding the note.

Controls are a nonempty own-data object: pitch −48..48 semitones; glide 0..10 seconds requiring pitch; expression 0..1; pan −1..1; modulation 0..2 (AM capped at 1/PM 1200 cents); operatorLevels is four multipliers 0..2 over patch levels. Current checkout also accepts feedback 0..7, lfoRate 0..20 Hz, amDepth 0..1, pmDepth 0..1200 cents, four operatorRatios 0.125..32, four operatorFrequencies 1..20000 Hz or `null` to restore ratio mode, and four complete operatorADSR `{a,d,s,r}` objects. Ramp 0..10 seconds independently retargets supplied scalar/ratio/frequency controls from current values; glide remains independent and linear in semitones. Oscillator phase and feedback history survive controls. ADSR changes instead reanchor at current dB: held attack restarts, released notes begin a newly scaled release capped at 10 seconds, and zero release drains the filter immediately. Fixed Hz follows pitch controls but ignores tuning-table transposition. Unknown fields/accessors/nonfinite/out-of-range values reject. See [expressive voices](./expressive-voices.md) and [host integration](./host-integration.md).

The selected 1–8 logical voices and eight short fades are bounded. Stealing defaults to oldest; release-first chooses oldest released before held, while quietest uses current carrier envelope × velocity × expression with oldest ties, not instantaneous sample amplitude. Events/IDs each cap at 256. Future timed notes reserve two events; controls/stops also consume slots. Terminal states reclaim obsolete events. Prepared patches use 128 content-keyed LRU registrations; validated replacement reuses IDs safely while queued/active notes keep their original snapshot.

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
      const at = opm.context.currentTime + 0.1;
      const id = opm.playNote({ voice: 'my-brass', note: 64, at, velocity: 0.7, pan: -0.5 });
      opm.updateNote(id, { pitch: 7, glide: 0.1, expression: 0.8, pan: 0.5, modulation: 1.2 }, { at: at + 0.1 });
      opm.stop(id, { at: at + 0.3 });
      status.textContent = 'Playing custom brass note';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      play.disabled = false;
    }
  });
</script>
```

This example schedules one held note 0.1 seconds ahead, changes it 0.1 seconds after onset, and begins release 0.3 seconds after onset, all on the audio clock (three queued events, well inside the horizon). When disposing the page's synthesizer, `await opm.close()`; another click can start it again.

### Bounded lookahead melody

Replace the quick-start page's module script with this block, keeping `#play` and `#status`. Each click schedules a finite eight-note phrase; the Stop button cancels/releases only this scheduler's notes:

```html
<script type="module">
  import { OPM, createLookaheadScheduler } from './opm/api/index.js';
  const opm = new OPM();
  const status = document.querySelector('#status');
  const melody = [60, 64, 67, 72, 67, 64, 62, 60];
  let origin;
  let index = 0;
  const scheduler = createLookaheadScheduler(opm, ({ from, to, maxNotes }) => {
    origin ??= from + 0.05;
    const batch = [];
    while (index < melody.length) {
      const at = origin + index * 0.25;
      if (at < from) { index++; continue; } // Skip beats missed during a stall.
      if (at >= to || batch.length === maxNotes) break;
      batch.push({ note: melody[index++], at, duration: 0.18, velocity: 0.6, late: 'drop' });
    }
    return batch;
  }, { onError(error) { status.textContent = error.message; } });
  document.querySelector('#play').addEventListener('click', async () => {
    scheduler.stop();
    origin = undefined;
    index = 0;
    try {
      await scheduler.start();
      status.textContent = 'Scheduling eight notes';
    } catch (error) { status.textContent = error.message; }
  });
  const stop = document.createElement('button');
  stop.textContent = 'Stop phrase';
  document.body.append(stop);
  stop.addEventListener('click', () => scheduler.stop());
  window.disposeOPM = async () => { scheduler.dispose(); await opm.close(); };
</script>
```

The callback receives half-open absolute windows `[from,to)` and must synchronously return at most `maxNotes` notes, each with `at` inside that window and numeric duration `(0,60]`; held notes and relative `time` are not allowed. Defaults are horizon 0.2 seconds, interval 0.025 seconds, and 32 notes per batch. Configurable bounds are horizon 0.02–10 seconds (greater than interval), interval 0.005–1 second, and maxNotes 1–128. There are at most 128 outstanding scheduler gates; normal worklet queue limits still apply. Missed windows are skipped, not replayed in a burst. Required `onError` receives callback/timer failures, which stop scheduling. `start()` initializes/resumes from a user gesture; `stop()` permits restart, while `dispose()` is permanent. Neither closes OPM or stops unrelated notes. After the finite phrase the callback returns empty batches; stop/dispose the helper when it is no longer needed.

Any non-running context or reset stops the helper and reaches `onError`; restart explicitly from a gesture. Default `interruption:'cancel'` clears old gates/automation on suspension/interruption; `'preserve'` retains direct notes/queued events but never automatically restarts lookahead.

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
      if (event.type === 'reset') {
        id = undefined;
        if (event.reason === 'close' || event.reason === 'failure') connected = false;
      }
      status.textContent = event.type === 'error' ? event.error.message
        : event.type === 'note' ? `${event.id}: ${event.state}`
        : event.type === 'diagnostics' ? `Voices: ${event.activeVoices}`
        : event.type === 'command' ? `${event.command}: ${event.state} ${event.reason ?? ''}`
        : event.type === 'context' ? `Context: ${event.state}` : `Reset: ${event.reason}`;
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

### Shared scores, tuning and safe recovery

`mixGain` (finite 0–1, default 1) scales the mix **before tanh**; host gain controls listening volume, not saturation drive. Tuning replaces the complete configuration: `{referenceHz: 442, offsets}` with reference A4 20–20000 Hz and optional exactly 128 finite cents offsets in −4800..4800 (omission means zero). Fractional notes interpolate offsets, including a safe MIDI-127 endpoint. Active retuning preserves phases/envelopes and original-note key scaling.

Replace the quick-start module script with this shared live/offline score:

```html
<script type="module">
  import { OPM, playSequence } from './opm/api/index.js';
  import { renderSequence } from './opm/core/index.js';
  import { brass } from './opm/voices/brass.js';
  const settings = { mixGain: 0.5, tuning: { referenceHz: 442 }, stealing: 'release-first' };
  const opm = new OPM({ ...settings, interruption: 'cancel' });
  const score = [
    { type: 'note', id: 1, time: 0, duration: 0.4, voice: 'lead', note: 60.5 },
    { type: 'control', id: 1, time: 0.1, controls: { pan: -0.5, expression: 0.7, ramp: 0.03 } },
  ];
  let playback;
  document.querySelector('#play').addEventListener('click', async () => {
    try {
      await opm.start();
      playback?.stop();
      opm.loadVoice('lead', brass);
      playback = playSequence(opm, score, { at: opm.context.currentTime + 0.05 });
      const audio = renderSequence(score, { ...settings, sampleRate: opm.context.sampleRate, voices: opm.voices });
      document.querySelector('#status').textContent = `Rendered ${audio.left.length} frames; errors ${audio.diagnostics.errors}`;
    } catch (error) { document.querySelector('#status').textContent = error.message; }
  });
  window.disposeOPM = async () => { playback?.stop(); await opm.close(); };
</script>
```

Score times are relative seconds. Notes require unique positive IDs and finite durations; stop/control events reference those IDs. Full validation precedes posting. Limits are 128 notes, 256 reserved slots (two/note plus commands), 60 seconds including gates, and 4,000,000 offline frames. `playSequence` returns a defensive score-to-note ID map and idempotent `stop`; it cannot reserve capacity atomically against unrelated callers. `renderSequence` includes tails. Matching PCM requires equal settings/rate/frame origin and no competing notes; encode only its left/right/sampleRate fields for WAV.

On physical iOS/Android, follow [mobile acceptance and the support matrix](./mobile-acceptance.md) using [example 08](../examples/sequence.html) over HTTPS. Capture device/OS/browser/rate/policy, observations and manual pass/fail/unverified results for lock/app/call/route/battery/long-play/stall scenarios. Reports remain local. Resume from a gesture; borrowed contexts remain host-owned. Desktop/headless signal checks are not physical recovery or audible-continuity evidence.

### Bounded long scores

For up to 24 hours and 65,536 input events, use `prepareLongSequence`, `estimateSequenceCapacity` and `renderSequenceChunks` from `opm.js/core`. The estimate distinguishes full-buffer/single-batch eligibility from default streaming-window density; it does not promise admission alongside other callers. Chunk buffers are borrowed until the next `next()`: consume them immediately, retaining a copy only when needed. Break, `cancel()` or AbortSignal stops advancement; `maxFrames` can cap cumulative work. The 4,000,000-frame full-buffer budget remains; incremental WAV bypasses that allocation limit, not RIFF32 size limits.

```js
import { estimateSequenceCapacity, renderSequenceChunks } from 'opm.js/core';
const score = [{ type: 'note', id: 1, time: 0, duration: 61, note: 60 }];
const options = { sampleRate: 96000, chunkFrames: 4096 };
console.log(estimateSequenceCapacity(score, options));
let frames = 0, energy = 0;
const render = renderSequenceChunks(score, options);
for (const chunk of render) {
  for (let i = 0; i < chunk.frames; i++) energy += chunk.left[i] ** 2;
  frames += chunk.frames;
}
console.log(frames, energy, render.diagnostics.errors);
```

For browser playback, import `streamSequence` alongside `OPM`, construct `const stream = streamSequence(opm, score, { onError: console.error })`, and call `await stream.start()` in the play button's gesture. `stop()` cancels only that stream's notes; `dispose()` removes its listener and makes it terminal. Controls, explicit stops and automatic releases retain their score IDs across windows. Interruption/reset stops the stream under both policies: resume the context, then explicitly restart if desired. See [defaults, density limits and the complete browser recipe](./streaming-sequences.md).

### Beat transport and performance policy

Replace the quick-start module script, retaining `#play` and `#status`:

```html
<script type="module">
  import { OPM, createTransport, createPerformance } from './opm/api/index.js';
  const opm = new OPM({ quality: 'standard', maxVoices: 8 });
  const transport = createTransport(opm, [
    { type: 'note', id: 1, beat: 0, duration: 1, note: 60 },
    { type: 'note', id: 2, beat: 1, duration: 1, note: 64 }
  ], { bpm: 120, onError: console.error });
  const performance = createPerformance(opm, { parts: 1 });
  performance.configurePart(0, {
    voice: 'brass', mode: 'mono', legato: true, priority: 'last',
    glide: 0.1, pan: 0, expression: 0.8
  });
  document.querySelector('#play').addEventListener('click', async () => {
    try {
      await opm.start();
      await transport.start();
      const key = performance.noteOn(0, 67, { velocity: 0.7 });
      performance.noteOff(0, key);
      document.querySelector('#status').textContent = 'Transport started';
    } catch (error) { document.querySelector('#status').textContent = error.message; }
  });
  window.disposeOPM = async () => {
    transport.dispose(); performance.dispose(); await opm.close();
  };
</script>
```

Transport uses quarter-note beats (including note durations), the AudioContext clock, and only its own note IDs. It provides `pause`, `resume`, `stop`, `seek`, `setTempo` (current position onward), `setTempoMap`, `setLoop`, `pump`, `dispose`, and read-only state/position/snapshot/IDs. Default BPM is 120; valid BPM 1–1000, tempo maps start at beat 0 and ascend strictly (at most 1024 points), and positions cap at 86400 beats. Signature numerator is 1–32, denominator a power of two up to 32. Horizon is 0.01–10 seconds, interval 0.001–horizon/2, and maxSlots 1–256. Pause/seek/loop restart envelopes/phases rather than restoring DSP snapshots: scalar/ratio ramps resume with remaining durations; latest fixed-Hz/null policy applies immediately, even mid-ramp, and latest ADSR reanchors the new onset. Core exports `beatsToSeconds`, `secondsToBeats`, `beatToBarBeat`, `barBeatToBeat`, and `normalizeTempoMap`.

Performance has 1–16 zero-based parts (default 16), system/per-part key bounds up to 128, independent physical-key IDs even at equal pitch, poly/mono modes, last/high/low priority, sustain and part controls. Use `noteOff(part,key)`, `sustain(part,on)`, `updatePart(part,{glide,pan,expression})`, `allNotesOff(part?)`, `getPart(part)`, and `dispose()`. Held keys outrank pedal-only keys. Mono legato preserves the original gate/envelope/onset velocity/key scaling only within ±48 semitones of the original onset; beyond that it retriggers at the actual pitch. Steals prune keys without automatic readmission; interruption/reset clears helper state even with preserve mode. This is not a MIDI driver. See [host integration](./host-integration.md) for detailed recipes and [example 08](../examples/sequence.html) for interactive transport/performance controls.

## Offline PCM with Node.js

In the **npm-installed opm-app root**, save the following as **`render.mjs`**:

```js
import { Synth, prepareVoice } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const sampleRate = 44100;
const synth = new Synth(sampleRate);
const patch = prepareVoice(brass);
const id = synth.noteOn(patch, 60);
const left = new Float32Array(sampleRate);
const right = new Float32Array(sampleRate);
synth.render(left, right, 0, 22050);
synth.updateNote(id, { pitch: 7, glide: 0.05, expression: 0.8 });
synth.noteOff(id);
synth.render(left, right, 22050, 22050);
console.log(left.some(sample => sample !== 0), synth.errorCount);
```

Run `node render.mjs` in **opm-app**; expected output is `true 0`. These are in-memory PCM buffers; center pan is dual mono, other positions are stereo. Checkout imports are `./dist/core/index.js` and `./dist/voices/brass.js`. Use `.mjs` or `"type": "module"`; there is no CommonJS entry.

`new Synth(sampleRate, maxVoices = 8, {mixGain, tuning, stealing, quality = 'standard'} = {})` requires finite 8000–192000 Hz and integer 1–8 voices. `noteOn(voiceOrPrepared,note,id?,{velocity=1,pan=0}={})` accepts fractional MIDI 0–127 with strict velocity/pan bounds and unique positive safe IDs. Prepare immutable snapshots once or validate raw voices each call; pooled state is bounded. `updateNote`/`noteOff` return booleans. `allNotesOff` releases naturally; `panic` clears all tails; setters preserve phase/envelopes. `onVoiceEnded(id,reason)` reports exactly one terminal `stolen`, `ended`, `error` or `cancelled`; callback replacements start next frame and recursive render rejects.

`render(left,right,offset=0,length=nativeLeftLength-offset)` requires native Float32Arrays and nonnegative safe-integer ranges fitting both actual buffers. Shadowed length/fill properties do not enlarge work; proxies/forgeries and numeric coercion reject. Inspect cumulative `currentFrame`/`errorCount`; split rendering at events and retain enough release frames.

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

`renderNote` also accepts strict `mixGain`, `tuning`, `stealing` and `quality` options; whole-score, chunked and Worker rendering forward quality too. `'eco'` uses 2× oversampling/order-4 filtering, default `'standard'` preserves the old 4×/order-8 path exactly, and `'high'` uses 8×/order-8. Profiles promise neither alias-free output nor CPU deadlines; measure on the target host. See [acoustic quality](./acoustic-quality.md).

It uses `Synth`'s exact envelope, LFO, filter, velocity, pan, and saturation path. Length is `ceil((duration + longestEffectiveRelease + 0.01) * sampleRate)` including rate-key-scaled release, with a 4,000,000-frame cap. Pan gains before saturation are `sqrt(2)*cos/sin((pan+1)*pi/4)`; saturation may change perceived balance.

Other core exports: `normalizeVoice` returns a strict, detached voice copy; `envelopeAt(time, gate, adsr)` returns dB-derived amplitude with time/gate in seconds; `ALGORITHMS` is eight immutable routing graphs; `HEADROOM = 0.7`, `OVERSAMPLE = 4`, `MAX_RENDER_SAMPLES = 4000000`; and `sampleRateValue` validates integer 8000–96000 Hz. `dist/voices/schema.js` exports `validateVoice(voice)` (complete, frozen validation), `parseVoiceBank(input)`, finite-number clamping helper `bounded(value, min, max, label = 'number')`, `LIMITS`, `MAX_BANK_BYTES`, and `MAX_BANK_VOICES`.

## Voice format and banks

A standalone **`voice.json`** (save in **opm-app** if using it as a local asset) can contain this complete schema voice. See the `voiceSchema` export in [voice.schema.js](../dist/voices/voice.schema.js) and the `examples` export in [examples.js](../dist/voices/examples.js). Four operators appear in signal order:

```json
{
  "version": 6,
  "name": "simple",
  "algorithm": 7,
  "feedback": 0,
  "modIndex": 4,
  "lfo": { "rate": 0, "amDepth": 0, "pmDepth": 0, "waveform": "sine", "amTargets": [1, 1, 1, 1], "pmTargets": [1, 1, 1, 1] },
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
| `version`, `name` | Current canonical `6`; explicit `1`–`5` retain their original strict shapes. v1 excludes key scaling; v1/2 exclude velocity sensitivity; v1–3 exclude waveform; v1–4 exclude v5 fields; v1–5 exclude v6 targets. Names: 1–64 ASCII letters/digits/underscores/hyphens. |
| `algorithm`, `feedback` | Integers 0–7. |
| `modIndex` | Phase-modulation strength 0–16. |
| `ops` | Exactly four operators, each with `ratio` 0.125–32, `level` 0–1, `detune` −1200–1200 cents, and complete `adsr`: `a`, `d`, `r` each 0–10 seconds; sustain `s` 0–1. |
| `lfo` | `rate` 0–20 Hz, `amDepth` 0–1, `pmDepth` 0–1200 cents; waveform `sine` (default), `triangle`, `saw` or `square`. |
| `ops[i].keyScale` | Optional: breakpoint is a MIDI integer 0–127; left/right slopes are 0–24 dB/octave. Omission is flat. |
| `ops[i].velocitySensitivity` | Optional 0–48 dB attenuation at velocity 0; omission is 0. Operator gain is multiplied by `10 ** (-sensitivity * (1 - velocity) / 20)`. Final output still multiplies by velocity. Set sensitivity on modulators to vary brightness as well as volume. |
| `ops[i].frequency`, `ops[i].rateKeyScale` | Optional v5 fixed 1–20000 Hz frequency (ratio remains required), rate scale 0–4; ADSR times multiply by `2 ** (-scale * (note - 60) / 12)`, capped at 10 seconds. |
| `pitchEnvelope` | Optional v5 `{a,d,r,initial,peak,sustain,final}`: 0–10-second times, −4800..4800-cent levels; continuous release from current pitch. |
| `lfo.delay`, `lfo.sync`, `lfo.phase` | Optional v5 0–10 seconds, `'note'`/`'global'`, 0–1 turns; defaults 0/note/0. Delay gates depth, not phase progression. |
| `lfo.amTargets`, `lfo.pmTargets` | Optional v6 four-element weights 0–1; boolean inputs normalize to numbers. Omission targets all four operators with weight 1. |

Single voices may omit version/name/modIndex/lfo; defaults are current shape, index 4 and off/sine. Current output and bundled presets canonicalize to 6; legacy versions cannot carry newer fields (including v6 targets in explicit v5). Four complete operators remain required. Strict normalization rejects bounds violations; all paths reject wrong types/accessors/unknown fields/sparse arrays and detach inputs. Key scaling uses the original note; pan belongs to the note. See [expressive voices](./expressive-voices.md).

A complete **bank JSON file** must contain an **array** of 1–128 complete voices with unique names (wrap the standalone object above in `[...]`); it is not a single top-level voice object. `parseVoiceBank(jsonStringOrArray)` from `opm.js/voices/schema.js` for Node, or the served `./opm/voices/schema.js` for browsers, returns a `Map` of names to frozen validated voices. JSON strings are capped at 256 KiB UTF-8; arrays are capped by voice count. Bank parsing and `validateVoice` clamp **finite** out-of-range numeric fields to schema limits, unlike strict single-voice normalization; invalid version/algorithm/feedback values, nonfinite values, wrong types, and unknown fields still fail.

For a working bank loader, **replace the module `<script>` in `opm-app/public/index.html`** from the browser quick start, keeping its `#play` button and `#status` output. The earlier copy command places the bank module at `public/opm/voices/examples.js`:

```html
<script type="module">
  import { OPM } from './opm/api/index.js';
  import { parseVoiceBank } from './opm/voices/schema.js';
  import { examples } from './opm/voices/examples.js';

  const opm = new OPM();
  const play = document.querySelector('#play');
  play.textContent = 'Play bank brass note';
  const status = document.querySelector('#status');
  play.addEventListener('click', async () => {
    play.disabled = true;
    try {
      await opm.start();
      const bank = parseVoiceBank(examples);
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

Serve `public/` as above and click the button. This example imports a **trusted bundled module**. External JSON banks remain supported by `parseVoiceBank`; for untrusted downloads, your host/application must restrict source, content type, and response size before reading the body. The engine does not provide a network download API.

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

Checkout imports use `./dist/core/index.js`, `./dist/voices/brass.js`, and `./dist/voices/dx7.js`. `encodeWav({left,right?,sampleRate,format?})` returns little-endian RIFF bytes in `'pcm16'` (default), `'pcm24'` or `'float32'` format. Omit right for mono. Float32 arrays must contain finite samples in −1–1; out-of-range amplitudes reject rather than clip, including float32 output. Stereo lengths must match. Rate is integer 8000–192000 Hz; full-buffer budget is 4,000,000 frames. Pass only these own-data fields: a whole renderNote result has extra fields and is rejected. It only encodes; your application saves/downloads bytes.

### Incremental WAV and browser Worker export

`createWavEncoder({sampleRate,channels:1|2,format?,totalFrames})` emits `header()` once, accepts 1–65536 frames per `encode({left,right?})`, then requires exact frame accounting in `finalize()` (which emits any RIFF padding). It retains no PCM/output chunks. RIFF32 must remain below 4 GiB, with at most 24 hours plus release budget; there is no full-buffer 4-million-frame limit.

For a small runnable encoder example in `opm-app`, save as `incremental.mjs` and run `node incremental.mjs`:

```js
import { open } from 'node:fs/promises';
import { createWavEncoder } from 'opm.js/core';
const encoder = createWavEncoder({
  sampleRate: 44100, channels: 1, format: 'pcm24', totalFrames: 44100
});
const file = await open('silence.wav', 'w');
try {
  await file.writeFile(encoder.header());
  for (let remaining = 44100; remaining > 0;) {
    const frames = Math.min(4096, remaining);
    await file.writeFile(encoder.encode({ left: new Float32Array(frames) }));
    remaining -= frames;
  }
  await file.writeFile(encoder.finalize());
} finally { await file.close(); }
```

For long browser files, root export `renderSequenceInWorker(events,{...chunkOptions,quality,format,sink,signal,onProgress,workerUrl?})` returns `{capacity,format,bytesWritten,diagnostics}`. The sink implements `write(bytes)` and optionally `close()`/`abort(reason)`; writes are awaited, with at most one encoded chunk unacknowledged. Progress reports `{frames,totalFrames,bytesWritten,errors}`. Cancellation terminates/rejects immediately without awaiting a hung write/abort; the sink must invalidate outstanding writes and own rollback. The helper is browser-only; core/offline helpers work in Node.

The default static module is `dist/worker/render.js`; optional URLs must be same-origin HTTP(S), never blob/data/eval. Copy the entire distribution and serve JavaScript MIME types under suitable `worker-src 'self'` and `script-src 'self'` CSP. See [streaming sequences](./streaming-sequences.md) for the complete cancellable file-sink recipe. [Example 08](../examples/sequence.html) offers format preview and long Worker export: long files require File System Access, without an aggregate-Blob fallback; short previews use an explicit 8 MiB memory budget.

```text
public/opm/
  api/       browser API and helper companions
  core/      DSP, sequence, transport and WAV companions
  worklet/   realtime processor
  worker/    render.js and offline Worker companions
  voices/    schemas, presets and importers
```


### DX7 conversion

`importDX7(Uint8Array)` accepts exactly one framed/checksummed **163-byte single voice** or **4104-byte 32-voice bank**, rejecting raw/concatenated/invalid seven-bit messages. v1.7 returns normalized version 6 voices (v1.6 historically returned v5). `describeDX7` returns `{name,sourceAlgorithm,algorithm,selectedOperators,droppedOperators,warnings}`; original algorithms are 1–32, converted 0–7, with DX7 operator numbering 1–6.

This remains a **lossy musical heuristic for six-to-four-operator conversion**, not DX7 synthesis/emulation. Fixed-Hz operators are retained. Velocity/rate scaling, reduced pitch-envelope stages and LFO delay/sync are heuristic; unsupported descending saw/sample-and-hold waveforms produce substitutions and warnings. Reduced routing, oscillator sync, transpose, per-operator AM and envelope details remain lossy. Inspect descriptions and [expressive conversion limits](./expressive-voices.md) before auditioning. Browser hosts register converted patches with `loadVoice`; bound uploaded/downloaded bytes before buffering. See [voice quality](./voice-quality.md) for original recipes and numerical host trims.

## Quality and release acceptance

Maintainer commands run in the checkout, after `npm ci`:

All authored programs use strict TypeScript. `npm run compile` emits ignored `.dev/`; `npm test` compiles/selects behavioral tests, unlike bare `node --test`. `npm run build` derives declarations, preserves module paths and builds eight demo scripts. `npm run typecheck` covers authored programs/public consumers. Every distribution JS has a matching map/declaration; consumers need neither TypeScript nor build tools.

```sh
npm run build
npm test
npm run typecheck
npm run security -- --package-smoke
npx --no-install playwright install --with-deps chromium
npm run browser-smoke -- chromium
npm run benchmark
npm run sound-quality
npm run voice-quality
npm run browser-stress -- chromium
```

Use firefox/webkit instead to install/exercise those browsers. CI configures Node 22/24/26 and all three browser engines; configuration alone does not prove successful runs. Observed versions/results belong in CHANGELOG. Browser acceptance observes real AudioWorklet signal, finite output, lifecycle/release, and deployment paths, not just fake contexts. Roadmap completion requires a tested feature, working demo sound/export, and README coverage.

Headless Linux Firefox also needs a running native audio server; browser library installation alone is insufficient. CI installs `pulseaudio`, runs `pulseaudio --start --exit-idle-time=-1`, loads `pactl load-module module-null-sink sink_name=opm_ci`, selects `pactl set-default-sink opm_ci`, and checks `pactl info` before smoke. A null sink discards speaker output but still runs the native audio clock and real worklet graph. Smoke logs identify the pending stage and context state if initialization/resume stalls.

Benchmark output reports warmed 128-frame block p95/p99/worst and misses of `128/sampleRate` seconds. `OPM_BENCH_BLOCKS`, `OPM_BENCH_WARMUP`, and `OPM_BENCH_SAMPLE_RATE` control workloads; optional p99/worst budget ratios enforce host-specific thresholds. Local defaults are report-only; CI configures `OPM_BENCH_P99_BUDGET_RATIO=1` at 48 kHz (2.667 ms), worst/GC stalls report-only. This is not a universal real-time guarantee. Spectral acceptance compares a 30 kHz oscillator folded to 18 kHz with an equal-level 1760 Hz control at 48 kHz (at least 30 dB attenuation), not arbitrary band-limited FM proof.

Sound-quality tools cover multiple sample rates, algorithms, feedback, pitches, velocities, and polyphony, with finite/deterministic output and controlled spectral/level measurements. Preset reports expose raw peak/RMS dBFS and recommended bounded host trim, not automatic loudness rewriting. Browser stress observes native messaging, signal, lifecycle, queue drainage, and elapsed main-thread gaps under contention; these are not measurements of AudioWorklet CPU, GC, or guaranteed glitch-free output. Controlled alias attenuation is not a claim that arbitrary FM is alias-free. Consult [voice quality](./voice-quality.md) and [publishing acceptance](./publishing.md) for scope and release prerequisites.

Independent acceptance includes Bessel PM, contractive/full-level feedback bounds, nested four-op chain/branched/multicarrier references and two 120-second streamed LFO/glide scenarios. The 4× eighth-order Butterworth decimator trades phase/delay for a flatter audible passband and controlled stopband attenuation. See [acoustic mathematics and limitations](./acoustic-quality.md). These are not all-patch, perceptual, physical-device or hardware-fidelity proof.

## Compressed deployment

Every `.js` in `dist/` has a corresponding `.js.map` and generated `.d.ts`, including demo scripts. Engine modules preserve source paths; no hashed chunks are generated. Demo declarations contain `export {};` because those modules export no API. The build produces no JSON assets or compressed sidecars. Maps embed original TypeScript; publishing them exposes that source for debugging. Configure compression at the web host if needed, retaining ordinary `.js` import URLs. Compressed responses need the matching `Content-Encoding` (`br` or `gzip`), `Vary: Accept-Encoding`, and a JavaScript MIME type. Uncompressed responses must not be marked compressed. Python's basic HTTP server serves the ordinary modules directly. Deploy the entire matching `dist/` module tree as one version. See the README's [optimized-distribution notes](../README.md#optimized-distribution).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `file://`, insecure-origin, or AudioWorklet unavailable | Serve over HTTPS or `http://localhost`, in a browser supporting ES modules and AudioWorklet. |
| Bare `opm.js` browser import cannot resolve | Import a served `./opm/...` URL after copying assets; a bare specifier needs a separately configured import map or bundler. |
| Worklet/module 404, HTML returned instead of JS, or MIME error | Copy the **whole** `dist/` tree; preserve relative paths and exclude assets from SPA HTML rewrites. Check the JavaScript MIME type. |
| Autoplay blocked or playback before start | Invoke and await `opm.start()` inside a user click before `playNote()`. |
| Invalid pitch, voice name, duration, or unknown voice | Check the [browser API](#browser-api-and-lifecycle) argument bounds and register custom names before playback. |
| Scheduled notes disappear | Watch lifecycle rejections/steals and diagnostics; respect selected polyphony (1–8) and bounded IDs/events. |
| Node makes no speaker sound/file | PCM must be played/saved explicitly; use the WAV export recipe above. |
| Processor failure | Handle `onEvent` errors and failed diagnostics; close/restart rather than bypassing validation or substituting a fallback engine. |
| npm registry `E404` | Pack this checkout and install the [local tarball](#acquire-and-install), not a presumed registry release. |
| Bank parse fails | Supply an array of complete, uniquely named schema voices within the bank size/count limits. |
| Compressed bytes look like gibberish | Set the correct encoding and MIME response headers, or serve the ordinary `.js` modules without compression. |
