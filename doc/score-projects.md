# Replayable score projects

Current checkout / Unreleased. A version 1 `ScoreProject` stores musical events, a tempo map, meter, named complete voice snapshots and synthesis settings in one self-contained JSON file. The pure APIs import from `opm.js/core` in Node without an `AudioContext`, DOM or Worker.

## Create, save and load

```ts
import { parseScoreProject, serializeScoreProject } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const project = parseScoreProject({
  version: 1,
  voices: { lead: brass },
  events: [
    { type: 'note', id: 1, voice: 'lead', note: 60, beat: 0, duration: 4 },
    { type: 'control', id: 1, beat: 2, controls: { expression: 0.6, ramp: 0.2 } },
  ],
  tempoMap: [{ beat: 0, bpm: 90, curve: 'linear' }, { beat: 4, bpm: 120 }],
  timeSignature: { numerator: 4, denominator: 4 },
  settings: { sampleRate: 44100, quality: 'standard', maxVoices: 8,
    mixGain: 0.35, stealing: 'release-first', tuning: { referenceHz: 440 } },
});
const json = serializeScoreProject(project);
const replay = parseScoreProject(json);
```

The parser accepts a JSON string or a plain own-data object. `version`, `events` and `voices` are required. Omitted tempo, meter and settings normalize to 120 BPM, 4/4, 44100 Hz, `standard`, eight voices, mixGain 1, `oldest` stealing and 440 Hz with zero tuning offsets. Canonical output contains all settings and the 128-entry tuning table. Voice names are sorted, controls use stable key order, and saved defaults are explicit. Event array order is retained for deterministic simultaneous-event ordering.

Every note uses a stored voice name. Omitted note voice means `brass`, which must also be stored. Inline patches are rejected inside projects; standalone `compileBeatSequence` accepts them. Voice definitions normalize through the existing voice-version validator, including supported legacy patch inputs; project files themselves must specify version 1. No external bank or URL is referenced.

Returned objects, arrays, voices, controls and settings are detached and frozen. Unknown fields, inherited fields, accessors, invalid versions, malformed meters/tempo maps, invalid controls/settings, duplicate note IDs and missing note/voice references throw. There is no prototype merge or invocation of JSON serialization hooks from caller data. Do not pass Proxies or executable objects as project data.

Budgets: 8 MiB total serialized project, 128 stored voices with a 256 KiB normalized bank budget, 65,536 events and 86,400 quarter-note beats. Compiled seconds must fit the existing 24-hour long-sequence horizon. Array holes/extra properties are rejected. These budgets do not enlarge worklet queues or full-buffer rendering limits.

## Replay with Transport

```ts
import { OPM, createTransport } from 'opm.js';

// Create/resume this context inside a user gesture in a browser.
const context = new AudioContext({ sampleRate: replay.settings.sampleRate });
const monitor = context.createGain();
monitor.gain.value = 0.16;
monitor.connect(context.destination);
await context.resume();
const opm = new OPM({ ...replay.settings, context, destination: monitor });
for (const [name, voice] of Object.entries(replay.voices)) opm.loadVoice(name, voice);
const transport = createTransport(opm, replay.events, {
  tempoMap: replay.tempoMap,
  timeSignature: replay.timeSignature,
  onError: error => console.error(error),
});
await transport.start();
// Stop the owned score, then release the synth and the owned context when done.
transport.dispose();
await opm.close();
monitor.disconnect();
await context.close();
```

Transport retains musical timing for restart/tempo edits. The actual browser sample rate may differ from the requested rate. Host monitoring attenuation is deliberately separate from saved synthesis `mixGain`.

## Node: load → compile → chunk WAV

```ts
import { readFile, open } from 'node:fs/promises';
import { parseScoreProject, compileBeatSequence, renderSequenceChunks,
  createWavEncoder } from 'opm.js/core';

const score = parseScoreProject(await readFile('piece.opm.json', 'utf8'));
const voices = new Map(Object.entries(score.voices));
const events = compileBeatSequence(score.events, { tempoMap: score.tempoMap, voices });
const chunks = renderSequenceChunks(events, {
  ...score.settings, voices, chunkFrames: 4096,
  maxFrames: score.settings.sampleRate * 120,
});
const wav = createWavEncoder({ sampleRate: score.settings.sampleRate,
  channels: 2, format: 'pcm16', totalFrames: chunks.capacity.frames });
const file = await open('piece.wav', 'w');
try {
  // FileHandle.writeFile completes each byte chunk before the next render step.
  await file.writeFile(wav.header());
  for (const chunk of chunks) await file.writeFile(wav.encode({ left: chunk.left, right: chunk.right }));
  await file.writeFile(wav.finalize());
} finally {
  chunks.cancel();
  await file.close();
}
```

`compileBeatSequence(events, { tempoMap?, bpm?, voices? })` returns validated second-based `SequenceEvent[]`, preserving named voice references. Supply the same registry to the render consumer. Its default tempo is 120 BPM; `tempoMap` takes precedence over `bpm`. A gate's duration is the integrated end time minus integrated onset time, including all tempo ramps and steps it crosses. Control `ramp`/`glide` durations remain **seconds**, not beats. IDs and stable input ordering are preserved. The existing full-buffer `renderSequence` and browser `renderSequenceInWorker` consume the same compiled events/settings; existing queue/render capacity limits still apply.

The `opm.js/core` and `opm.js/midi-file` declarations can be consumed by Node TypeScript projects without DOM or Web Audio globals. This boundary is checked separately from the browser API declarations.

Chunk arrays are borrowed; encode/write each chunk before advancing. A failed write can leave a partial file: use a temporary output and rename only after successful finalization if atomic replacement is required. Rendering errors and device output are different evidence: deterministic WAV tests do not certify physical playback or subjective listening quality.

## Original composition showcase

Open `examples/showcase.html` over localhost or HTTPS after building. **Harbor at First Light** is a D-major/B-minor 4/4 miniature with a glass lead, a middle countermelody and a slowing return. **Lanterns on the Stair** is an E-minor 3/4 miniature with a chromatic dominant and an open-ninth ending. Both melodies and arrangements are original to this demo, not copied songs.

Play/Stop uses the public Transport API and a low 16% host monitor gain. Render WAV streams PCM16 in a Worker, with a 90-second/32-MiB demo download budget. Save project writes canonical JSON; Load project validates before replacing the current score. Reload either saved composition, play it and render it again to exercise replay. Offline export preserves synthesis mixGain, not the extra host monitoring gain. Stop also cancels an active export. No physical iOS/Android or human listening outcome is asserted here.
