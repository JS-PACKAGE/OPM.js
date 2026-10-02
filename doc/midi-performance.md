# Expressive performance and optional Web MIDI

`createPerformance(opm, options)` gives a host part-scoped key policies (poly/mono, legato, sustain, last/high/low priority). Release 1.8 adds per-key and per-part live controls, per-part voice budgets and priorities, and a separate optional Web MIDI adapter. Try [example 10 (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/instrument.html).

## Per-key and per-part controls

```ts
const key = performance.noteOn(0, 64, { velocity: 0.8 });   // independent key identity, not a note ID
performance.updateKey(0, key, { feedback: 5, pitch: 0.3 });  // that key only
performance.updatePartNotes(0, { operatorRatios: [2, 1, 1, 1], ramp: 0.05 }); // every sounding note + future notes
```

Both calls take the full `NoteControls` object (pitch, glide, expression, pan, modulation, ramp, operator levels/ratios/fixed-Hz/ADSR, feedback and LFO controls). Input is copied as own data and validated before any note is touched.

- `updateKey` returns `false` for an unknown or already-removed key and otherwise applies to that key's gate. A key that is **not** sounding in a mono part (a held key behind the selected one) only stores its controls; the shared gate is never modified by it. When the mono selection later moves to that key, its stored controls are applied together with the pitch offset.
- `updatePartNotes` merges into the part's control state, updates every sounding gate of the part (release tails included) and is applied to notes started later. Pitch accumulates as `part + key + legato offset` and is validated against the engine's ±48 semitone control range.
- Part `pan` and `expression` set through `configurePart`/`updatePart` remain the base values. Controls that you apply do not change those configured values.
- Mono legato retains its anchor rule: beyond ±48 semitones of the original gate the part restarts the note at the exact target pitch, which re-evaluates velocity, key scaling and rate scaling.

## Voice budgets and priority

```ts
performance.configurePart(0, { voice: 'lead', mode: 'mono', legato: true, voicePriority: 100 });
performance.configurePart(1, { voice: 'strings', voiceLimit: 8, voicePriority: 10 });
```

- `voiceLimit` (1–32) caps the part's own gates. **Release tails count**: a released note still owns its voice until the engine reports it ended, so `noteOn` throws a `RangeError` while the part is at its limit. A limit larger than the engine's `maxVoices` does not create voices.
- `voicePriority` (0–127, default 0) is sent with every note the part admits. With a full engine a note can only displace voices of **equal or lower** priority, lowest first (then the engine's stealing policy). If every sounding voice has higher priority the note is refused, nothing else changes, and the part removes the key so no phantom held key remains.
- This is unrelated to the key-selection `priority: 'last' | 'high' | 'low'`.
- `getPart()` snapshots include `voiceLimit` and `voicePriority`.

## Web MIDI adapter

```ts
import { createPerformance, createMidiAdapter, requestMidiAccess } from 'opm.js';

button.onclick = async () => {                       // an explicit user action
  const access = await requestMidiAccess();          // sysex: false; may show a permission prompt
  const midi = createMidiAdapter(performance, access, { parts: 2, pitchBendRange: 2 });
  // midi.snapshot, midi.releaseAll(), midi.dispose()
};
```

Importing the module never requests access. The adapter accepts any object that provides `inputs` and `statechange` events (`MidiAccessLike`), so tests and hosts can inject their own. It is **not** a MIDI driver: no SysEx, clock, program change or device-specific behavior.

| Message (channel 1–16 → part 0–15) | Effect |
| --- | --- |
| Note on / off (velocity 0 = off) | `noteOn(part, note, { velocity: v / 127 })`; note-off releases the **oldest** still-held key of that input, channel and pitch. Repeated equal pitches keep separate identities. |
| CC64 | Sustain pedal for the part. The part is sustained while any adapter input holds its pedal. |
| CC1, channel pressure, polyphonic pressure | LFO depth multiplier `1 + v/127` (1×–2×): never below the patch default. Polyphonic pressure uses `updateKey`; the others `updatePartNotes`. |
| CC7, CC11 | Multiply into the part's expression. |
| CC10 | Pan. |
| Pitch bend | ± `pitchBendRange` semitones (default 2, at most 48). |
| CC120, CC123 | Release this adapter's keys for that input and channel. They are **not** a global panic and never touch other inputs or host-played keys. |
| CC121 | Reset the adapter's controllers for the channel and release its pedal. |

Everything else is counted in `snapshot.ignoredMessages`. Malformed packets (wrong length, data bytes above 127, unknown status) are ignored, never thrown into the page.

Lifecycle: the adapter attaches to current and later inputs (optionally restricted with `inputIds`), calls `open()` where the port needs it, and on disconnect or `dispose()` releases **only the keys it owns**, clears that input's pedal state and removes listeners. At most 32 inputs and 128 held keys; an excess note is reported to `onError` and dropped.

## Support and verification

Web MIDI exists in some browsers only and needs a secure context and user permission; feature-detect and handle rejection (`requestMidiAccess` rejects when unavailable). [`test/midi.test.ts` (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/test/midi.test.ts) drives the adapter with an injected access object against the real worklet processor: channel routing, repeated pitches, pedal deferral, malformed packets, bend/wheel/volume ranges, hot-unplug releasing only one input's keys, and dispose. No physical keyboard or browser permission flow was exercised by the automated tests.
