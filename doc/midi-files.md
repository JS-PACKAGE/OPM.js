# Standard MIDI files

`importMidiFile` and `exportMidiFile` are dependency-free binary adapters, available from `opm.js/midi-file`, `opm.js/core`, and the main API. They do not open MIDI devices, transmit SysEx, emulate a chip, or implement General MIDI instrument/percussion selection.

Expression conversion below is an **Unreleased checkout capability**; package version remains 1.9.0. Build this checkout to use it. Do not assume the immutable published v1.9 examples contain these additions.

## Import

```ts
const score = importMidiFile(bytes, {
  channelVoices: { 0: 'brass', 1: 'lead', 9: 'drum' }, // channels are zero-based
  defaultVoice: 'brass',
  unsupported: 'warn',
  unclosedNotes: 'reject',
  sustain: 'apply',
  controls: 'preserve',     // explicit; default 'omit' retains legacy note-only conversion
  pitchBendRange: 2,        // caller policy in semitones, finite 0..48
});
// score.events: BeatSequenceEvent[] (positive unique note IDs plus per-note controls)
// score.tempoMap: normalized quarter-note BPM steps, beginning at beat zero
// score.timeSignature: one numerator/denominator
// score.warnings: { code, message, count }[]; counts are aggregated by code
// score.lossSummary: frozen { omissions, approximations, preservedControls }
```

Supported input is SMF format 0 (one track) or format 1 (simultaneous tracks), with positive integer PPQN timing. All tracks are merged by absolute tick, then file track number, then event order. Channel state is shared across tracks. Repeated note-ons at the same channel/pitch are owned FIFO, independently of sustain; note-on velocity zero is a note-off. CC64 values 64..127 hold released keys until pedal-up. Sustain becomes longer note durations and produces `sustain-applied` warnings. `sustain: 'reject'` rejects any CC64 rather than approximating it.

Voice names are explicit synthesis mappings, not MIDI programs. Unmapped channels use `defaultVoice` (`brass` by default) and produce `default-voice` warnings, including channel 9 percussion. The caller supplies the corresponding voice registry to compilation/rendering. Input MIDI channel numbers are not additional fields on beat notes; preserve routing on export by using distinct mapped voice names and a matching `voiceChannels` mapping.

Tempo defaults to 120 BPM until the first tempo event. Conflicting tempo events at the same tick use the last event in the documented merge order and warn. MIDI microseconds-per-quarter must produce BPM in 1..1000. Only one meter is representable: conflicting meters at beat zero or any actual meter change later reject. Repeating the same meter is accepted. Numerators are 1..32; denominators are 1, 2, 4, 8, 16 or 32.

The default `controls: 'omit'` is compatibility mode: bend, pressure and controllers other than CC64 are omitted with `ignored-channel` warnings. Opt in to `controls: 'preserve'` for:

| MIDI source | Beat control meaning |
| --- | --- |
| Pitch bend | `pitch`, signed semitones using the explicit `pitchBendRange` (default 2) |
| CC7 and CC11 | `expression = (CC7 / 127) * (CC11 / 127)`; initial values are both 127 |
| CC10 | `pan = max(-1, (value - 64) / 63)`; initial center is 64 |
| CC1 or channel pressure | Channel-default `modulation = 1 + value / 127`; last channel message wins, initial value is 1 |
| Poly pressure | Same modulation scale, applied only to the newest still-pressed key of that channel/pitch |

Channel updates visit **every held or sustain-held gate** in onset order, including distinct repeated pitches, and set the initial state of future notes. Poly pressure does not change future-note defaults or target sustain-only keys. Once assigned to a pressed key, its modulation override persists through sustain and takes precedence over later channel CC1/pressure defaults, matching the live Performance control merge. Pressure is LFO-depth scaling, not an invented force/amplitude unit. Each expressive note is followed by a same-beat initial control snapshot (`pitch: 0`, `expression: 1`, `pan: 0`, `modulation: 1` unless the channel changed). This can contain zero expression without turning the note-on velocity into a release.

The adapter does not know synthesis patches' release-tail duration. Once a gate closes it is no longer a channel-owned control target. A subsequent channel-expression message on that channel produces the conservative `release-tail-controls` approximation warning, even if the unknown tail might already have ended. It still updates held/sustained gates and future-note defaults. `unsupported: 'reject'` rejects this possible loss. This is not complete live-performance/release-tail fidelity.

Programs, bank selection, RPN/NRPN (including pitch-range data-entry), other controllers/channel-mode messages, release velocity, text, key signatures, port/channel metadata, sequencer-specific metadata, SMPTE offsets, framed SysEx/escaped data, and header extensions remain omitted **with warnings**. RPN never changes `pitchBendRange`: choose that policy yourself and use the same policy on export/reception. Non-default MIDI metronome/thirty-second-note meter fields also warn. No SysEx is executed. `unsupported: 'reject'` rejects omissions, conflicting tempos, unmapped channels and possible release-tail-control loss; explicit `sustain: 'apply'` and `unclosedNotes: 'close-at-end'` remain accepted approximations.

### Inspect losses, not just success

`warnings` remains the aggregated `{ code, message, count }` API. `lossSummary` separates:

- `omissions`: ignored metadata/channel/SysEx/header data, release velocity and meter-detail warnings.
- `approximations`: default voice substitution, flattened sustain, conflicting tempo choice, explicit end-of-file closure and possible release-tail-control loss.
- `preservedControls`: `{ kind, count }` for `pitch-bend`, `expression`, `pan`, `modulation`, `channel-pressure`, `poly-pressure`. Counts are accepted **source messages**, not generated per-note control events. CC7 and CC11 both count toward expression; initial snapshots do not count. Neutral/no-op messages and poly pressure without a pressed target count as recognized semantics, not archived bytes.

Warning counts retain their original units: CC64 messages, closed gates for `unclosed-notes`, note onsets using a fallback voice, or source warnings/messages for other codes. Arrays, entries and summary are frozen and bounded by the fixed code/kind vocabularies. Expose both loss categories before rendering or saving an imported project. Sustain is an explicit gate-duration approximation, not a pedal-performance recording.

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
  controls: 'preserve',     // default 'omit' still rejects control events/nonzero pan
  pitchBendRange: 2,
});
const reloaded = importMidiFile(bytes, {
  channelVoices: { 0: 'brass', 1: 'lead', 9: 'drum' },
  controls: 'preserve',
  pitchBendRange: 2,
});
```

Format 0 combines conductor and musical events into one track. Format 1 writes one conductor track and one musical track per used channel, sorted by channel. Output is deterministic, uses explicit status bytes, writes a single initial meter, and puts note-offs before controls/onsets at equal ticks. Initial channel state is written before its note-on. Remaining expressive operations follow score event order at each rounded tick; contiguous equal-value per-note fanout is restored as one channel update. All tracks end at the same last note/tempo tick. Notes and explicit stop events are supported; a stop shortens its owned gate. Stops before onset, unknown IDs and duplicate note IDs reject. IDs are local score identities and are reassigned on import, not serialized into MIDI.

Only `brass -> channel 0` is implicit. Other named voices require `voiceChannels`; embedded synthesis patches cannot be exported. Pitches must be integer 0..127. Positive normalized velocities are rounded to 1..127 (never velocity-zero note-offs). Beats and gate endpoints independently round to the nearest PPQN tick, which is monotone; gates that collapse to zero ticks reject. Same-channel/pitch gates must finish in onset order to preserve FIFO ownership; a later onset ending earlier than its predecessor rejects. MIDI has no note-instance IDs with which to recover that nesting.

Without `controls: 'preserve'`, OPM control events and nonzero note pan reject, maintaining the previous note-only export contract. Expressive export accepts only `pitch`, `expression`, `pan` and `modulation` controls. Ramp/glide (even zero), gain, operator/LFO/feedback controls, nonzero priority, zero velocity, unmapped voices, and linear tempo curves reject rather than silently dropping musical data. Supply an explicitly discretized step tempo map if approximation is desired; this adapter does not choose that approximation. Tempo points colliding after tick rounding reject. BPM is rounded to the MIDI three-byte microseconds field; tempos too slow for that field reject.

Pitch rounds to 14-bit bend within the explicit range; pan and modulation round to seven-bit controller values, with modulation restricted to 1..2. Expression rounds to the nearest representable CC7×CC11 product (ties prefer the higher CC7 factor), preserving already representable products up to floating-point arithmetic. Export emits both factors, CC7 before CC11; intermediate same-tick product updates are possible, with the final product established before onset or the next sample. Channel-wide modulation is encoded as CC1; representable per-key differences are encoded as poly pressure. Original controller/pressure message classes, redundant messages, unused channel state and MIDI bytes are not archival data in a BeatSequence.

Channel pitch/expression/pan changes must agree for **every overlapping gate** on that channel. Contiguous equal-valued fanout controls can establish that agreement; a private per-note change that would alter another gate rejects. Poly-pressure modulation can address only the newest sounding repeated-pitch gate. Put onset controls directly after their owned note at the same rounded tick. Incompatible overlapping initial states, older repeated-pitch pressure changes, unknown/before-onset controls, controls outside the gate, and controls rounded onto release reject. After-gate controls accepted by the synthesis core cannot be exported: patch-dependent release tails have no finite gate representation in this adapter. Use distinct voice/channel mappings for independent parts rather than letting export guess a channel allocation.

Thus file → score → file preserves representable **gate/control meaning under the same explicit policy and quantization**, not complete General MIDI playback, exact message identity or release-tail behavior. No program, RPN, sustain-controller or SysEx output is synthesized.

## Hard bounds

- `MAX_MIDI_FILE_BYTES`: 16 MiB input/output.
- `MAX_MIDI_FILE_TRACKS`: 128 imported tracks; export uses at most 17.
- `MAX_MIDI_FILE_EVENTS`: 65,536 wire events, **including omitted metadata/controllers and end-of-track**.
- Expressive fanout plus notes is separately limited to 65,536 generated beat events; a small wire file with many held notes and controllers can hit this bound. Export also checks its generated wire budget before growing musical tracks.
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
const midiPolicy = { controls: 'preserve', pitchBendRange: 2 };
const score = importMidiFile(await readFile(input), { ...midiPolicy, channelVoices: { 0: 'brass' } });
for (const warning of score.warnings) console.warn(warning.code, warning.count, warning.message);
console.log('Import loss summary:', score.lossSummary);
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
  ...midiPolicy,
  tempoMap: score.tempoMap,
  timeSignature: score.timeSignature,
  voiceChannels: { brass: 0 },
});
await writeFile(midiPath, midi);
const reloaded = importMidiFile(await readFile(midiPath), { ...midiPolicy, channelVoices: { 0: 'brass' } });
console.log('Reloaded events:', reloaded.events.length, 'Rendered frames:', render.diagnostics.renderedFrames);
```

The example intentionally maps otherwise-unmapped channels to brass with visible warnings. Replace both mappings with distinct voice/channel routes and pass your `voices` Map to compilation/rendering for different instruments. Ambiguous expressive export rejects instead of guessing those routes. It demonstrates file conversion from the current checkout, not a claim of General MIDI fidelity, listening quality, or physical-device testing.
