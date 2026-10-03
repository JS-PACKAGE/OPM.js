# Standard MIDI files

`importMidiFile` and `exportMidiFile` are dependency-free binary adapters, available from `opm.js/midi-file`, `opm.js/core`, and the main API. They do not open MIDI devices, transmit SysEx, emulate a chip, or implement General MIDI instrument/percussion selection.

## Import

```ts
const score = importMidiFile(bytes, {
  channelVoices: { 0: 'brass', 1: 'lead', 9: 'drum' }, // channels are zero-based
  defaultVoice: 'brass',
  unsupported: 'warn',
  unclosedNotes: 'reject',
  sustain: 'apply',
});
// score.events: BeatSequenceEvent[] (note gates with positive, unique IDs)
// score.tempoMap: normalized quarter-note BPM steps, beginning at beat zero
// score.timeSignature: one numerator/denominator
// score.warnings: { code, message, count }[]; counts are aggregated by code
```

Supported input is SMF format 0 (one track) or format 1 (simultaneous tracks), with positive integer PPQN timing. All tracks are merged by absolute tick, then file track number, then event order. Channel state is shared across tracks. Repeated note-ons at the same channel/pitch are owned FIFO, independently of sustain; note-on velocity zero is a note-off. CC64 values 64..127 hold released keys until pedal-up. Sustain becomes longer note durations and produces `sustain-applied` warnings. `sustain: 'reject'` rejects any CC64 rather than approximating it.

Voice names are explicit synthesis mappings, not MIDI programs. Unmapped channels use `defaultVoice` (`brass` by default) and produce `default-voice` warnings, including channel 9 percussion. The caller supplies the corresponding voice registry to compilation/rendering. Input MIDI channel numbers are not additional fields on beat notes; preserve routing on export by using distinct mapped voice names and a matching `voiceChannels` mapping.

Tempo defaults to 120 BPM until the first tempo event. Conflicting tempo events at the same tick use the last event in the documented merge order and warn. MIDI microseconds-per-quarter must produce BPM in 1..1000. Only one meter is representable: conflicting meters at beat zero or any actual meter change later reject. Repeating the same meter is accepted. Numerators are 1..32; denominators are 1, 2, 4, 8, 16 or 32.

Programs, bank selection, pitch bend, pressure, controllers other than CC64 (including channel-mode messages), release velocity, text, key signatures, port/channel metadata, sequencer-specific metadata, SMPTE offsets, framed SysEx/escaped data, and header extensions are omitted **with warnings**. Non-default MIDI metronome/thirty-second-note meter fields also warn. No SysEx is executed. `unsupported: 'reject'` rejects these omissions, conflicting tempos, and unmapped channels; it does not reject successfully applied sustain. This is deliberately not a full MIDI performance conversion: use the live MIDI performance API for controller-driven synthesis.

Unmatched note-offs always reject. Held keys or sustained gates at the final end-of-track reject by default. `unclosedNotes: 'close-at-end'` explicitly closes them at the greatest track end tick and reports `unclosed-notes`; it cannot create a positive duration if the note starts at that tick. Zero-length gates reject. No invented extra tail is added.

Track lengths, channel data bytes, four-byte VLQs, running status, recognized fixed-length meta records, and SysEx/meta length framing are checked. Meta/SysEx cancel running status. Every declared track must contain a terminal end-of-track event with no bytes after it; undeclared chunks/trailing bytes reject. Format 2, SMPTE division and unframed system statuses reject. Input must be a native, non-shared `Uint8Array`; subarrays and Node Buffers are accepted without invoking caller metadata getters.

## Export

```ts
const bytes = exportMidiFile(score.events, {
  format: 1,                 // default 1; 0 is also supported
  ppqn: 480,                // integer 1..32767
  tempoMap: score.tempoMap,
  timeSignature: score.timeSignature,
  voiceChannels: { brass: 0, lead: 1, drum: 9 },
});
const reloaded = importMidiFile(bytes, {
  channelVoices: { 0: 'brass', 1: 'lead', 9: 'drum' },
});
```

Format 0 combines conductor and note events into one track. Format 1 writes one conductor track and one note track per used channel, sorted by channel. Output is deterministic, uses explicit status bytes, writes a single initial meter, and puts note-offs before note-ons at equal ticks. All tracks end at the same last note/tempo tick. Notes and explicit stop events are supported; a stop shortens its owned gate. Stops before onset, unknown IDs and duplicate note IDs reject. IDs are local score identities and are reassigned on import, not serialized into MIDI.

Only `brass -> channel 0` is implicit. Other named voices require `voiceChannels`; embedded synthesis patches cannot be exported. Pitches must be integer 0..127. Positive normalized velocities are rounded to 1..127 (never velocity-zero note-offs). Beats and gate endpoints independently round to the nearest PPQN tick, which is monotone; gates that collapse to zero ticks reject. Same-channel/pitch gates must finish in onset order to preserve FIFO ownership; a later onset ending earlier than its predecessor rejects. MIDI has no note-instance IDs with which to recover that nesting.

OPM control events, nonzero per-note pan or priority, zero velocity, unmapped voices, and linear tempo curves reject rather than silently dropping musical data. Supply an explicitly discretized step tempo map if approximation is desired; this adapter does not choose an approximation or hide its accuracy. Tempo points colliding after tick rounding reject. BPM is rounded to the MIDI three-byte microseconds field; tempos too slow for that field reject. There is no SysEx output or controller/program synthesis.

## Hard bounds

- `MAX_MIDI_FILE_BYTES`: 16 MiB input/output.
- `MAX_MIDI_FILE_TRACKS`: 128 imported tracks; export uses at most 17.
- `MAX_MIDI_FILE_EVENTS`: 65,536 wire events, **including omitted metadata/controllers and end-of-track**.
- At most 1,024 normalized tempo points and 86,400 quarter-note beats.
- Delta times must fit four-byte VLQ (0..268,435,455). Export rejects excessive silent gaps instead of inserting hidden events.
- Beat event/options/mappings must be dense own-data arrays/plain objects; accessors and unknown fields reject. Import mappings allow 16 channels; export mappings allow 256 names.

The beat horizon is not a guarantee of renderability: `compileBeatSequence` and offline/live renderers apply their separate elapsed-time, polyphony, memory and scheduling limits. A dense file may need chunked offline rendering or live transport streaming rather than one worklet batch.

## Runnable Node file → chunk WAV and MIDI reload

After `npm run build`, save this as `midi-to-wav.mjs` in the repository root and run `node midi-to-wav.mjs input.mid output.wav output.mid`. It uses the built local package through its self-reference; no npm publication is required.

```js
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { importMidiFile, exportMidiFile, MAX_MIDI_FILE_BYTES } from 'opm.js/midi-file';
import { compileBeatSequence, renderSequenceChunks, createWavEncoder } from 'opm.js/core';

const [input, wavPath, midiPath] = process.argv.slice(2);
if (!input || !wavPath || !midiPath) throw new Error('Pass input.mid output.wav output.mid');
if ((await stat(input)).size > MAX_MIDI_FILE_BYTES) throw new Error('Input exceeds MIDI byte budget');
const score = importMidiFile(await readFile(input), { channelVoices: { 0: 'brass' } });
for (const warning of score.warnings) console.warn(warning.code, warning.count, warning.message);
const seconds = compileBeatSequence(score.events, { tempoMap: score.tempoMap });
const render = renderSequenceChunks(seconds, { sampleRate: 48000, chunkFrames: 4096 });
const encoder = createWavEncoder({
  sampleRate: render.capacity.sampleRate,
  channels: 2,
  format: 'pcm16',
  totalFrames: render.capacity.frames,
});
function* wavBytes() {
  try {
    yield encoder.header();
    // PCM buffers are reused; encode each chunk before advancing the iterator.
    for (const chunk of render) yield encoder.encode({ left: chunk.left, right: chunk.right });
    yield encoder.finalize();
  } finally {
    render.cancel();
  }
}
await pipeline(Readable.from(wavBytes()), createWriteStream(wavPath));
const midi = exportMidiFile(score.events, {
  tempoMap: score.tempoMap,
  timeSignature: score.timeSignature,
  voiceChannels: { brass: 0 },
});
await writeFile(midiPath, midi);
const reloaded = importMidiFile(await readFile(midiPath), { channelVoices: { 0: 'brass' } });
console.log('Reloaded notes:', reloaded.events.length, 'Rendered frames:', render.diagnostics.renderedFrames);
```

The example intentionally maps otherwise-unmapped channels to brass with visible warnings. Replace both mappings and pass your `voices` Map to compilation/rendering for different instruments. It demonstrates file conversion, not a claim of General MIDI fidelity, listening quality, or physical-device testing.
