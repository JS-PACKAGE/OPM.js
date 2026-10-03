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
- `getPartControls(part)` returns a detached, frozen effective part-control snapshot: configured defaults resolved against the current named/custom voice, then merged with part controls. It excludes per-key overrides. Operator levels are **multipliers**, with neutral defaults `[1, 1, 1, 1]`, not the patch's raw operator levels.
- Mono legato retains its anchor rule: beyond ±48 semitones of the original gate the part restarts the note at the exact target pitch, which re-evaluates velocity, key scaling and rate scaling.
- `noteOff(part, key, options?: PerformanceNoteOffOptions)` accepts only own-data `force?: boolean`. Ordinary note-off remains pedal-aware and returns `false` for an already-unheld key. `{ force: true }` also releases an unheld pedal-latched key, bypassing sustain for that key alone; mono selection retargets normally. It leaves the pedal and unrelated keys unchanged.

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
| CC120 | Force-release all owned keys (including pedal-latched keys) for this input/channel; no global panic or changes to other inputs/host keys. |
| CC123 | Pedal-aware note-off for physically held keys of this input/channel; latched keys remain owned for later forced cleanup. |
| CC121 | Reset the adapter's controllers for the channel and release its pedal. |

Everything else is counted in `snapshot.ignoredMessages`. Malformed packets (wrong length, data bytes above 127, unknown status) are ignored, never thrown into the page.

Lifecycle: the adapter attaches to current and later inputs (optionally restricted with `inputIds`) and calls `open()` where needed. `releaseAll()` force-releases only adapter-owned keys, including earlier pedal-latched note-offs, without changing the pedal. Disconnect and `dispose()` force-release the affected input's owned keys and remove listeners, then remove its contribution to the shared pedal union. If the last adapter pedal contribution disappears, the part pedal turns off and may release host-played pedal-latched keys too: pedal/controller state is shared per part, not key-owned. Another input's pedal contribution remains effective.

Limits are 32 inputs, 128 physically held keys and 256 ownership records. Physically released records stay available for pedal cleanup; stale records are pruned from Performance snapshots only at the ownership threshold or explicit forced cleanup. Excess admission is reported to `onError` and dropped, never silently overwriting ownership.

## Custom CC mappings

```ts
import type { MidiControllerMapping } from 'opm.js';

const controllerMap: readonly MidiControllerMapping[] = [
  { controller: 16, field: 'feedback', min: 0, max: 7, ramp: 0.05 },
  { controller: 17, field: 'operatorRatios', operator: 0, min: 0.5, max: 6, ramp: 0.05 },
  { controller: 18, field: 'operatorLevels', operator: 1, min: 0, max: 2, ramp: 0.05 },
  { controller: 19, field: 'lfoRate', min: 0, max: 20, ramp: 0.05, reset: 3 },
  { controller: 20, field: 'operatorFrequencies', operator: 2, min: 100, max: 2000, ramp: 0.05, reset: null },
];
const midi = createMidiAdapter(performance, access, { parts: 2, controllerMap });
```

Each entry requires `controller`, `field`, `min`, `max` and `ramp`. Operator fields additionally require a zero-based `operator` index 0–3; scalar fields prohibit it. CC value 0 maps exactly to `min`, 127 to `max`, and intermediate values interpolate linearly. Endpoints must be finite, ordered and inside the engine's bounds:

| Field | Range |
| --- | --- |
| `pitch` | −48..48 semitones |
| `expression`, `gain` | 0..1 |
| `pan` | −1..1 |
| `modulation` | 0..2 |
| `feedback` | 0..7 |
| `lfoRate` | 0..20 Hz |
| `amDepth` | 0..1 |
| `pmDepth` | 0..1200 cents |
| `operatorLevels` | 0..2 multiplier |
| `operatorRatios` | 0.125..32 |
| `operatorFrequencies` | 1..20000 Hz |

`ramp` is an explicit duration 0–10 seconds (0 is immediate); pitch uses glide, other fields use the engine's control ramp. `glide`, `ramp` and `operatorADSR` are not mapping targets. Mappings update part defaults, sounding gates (including release tails) and future notes. A tuple mapping preserves the other three effective **part** operator elements; per-key tuple overrides retain the Performance merge policy and may override the whole tuple.

A listed CC replaces that controller's ordinary action: mapping CC1 to feedback disables CC1's default modulation action, but channel/poly pressure still control modulation. Unlisted controllers keep their existing behavior; omitting `controllerMap` or passing `[]` is unchanged. CC64/120/121/123 cannot be remapped. Controllers must be integers 0–127; at most 128 entries are accepted, with no duplicate controller or target (same field/operator).

CC121 restores every mapped target for the channel. Optional `reset` defines that target's baseline and must be inside the field's engine bounds (not necessarily inside `min`/`max`). Only `operatorFrequencies` accepts `reset: null`, which restores ratio mode. Without `reset`, the baseline is captured from `getPartControls` **when the adapter is created**, so later patch/configuration changes do not change that reset value. Reset retains unrelated tuple elements and uses each mapping's ramp. Ordinary reset behavior and input-pedal ownership remain intact.

The adapter copies and validates the complete map before adding input/state listeners or opening ports. Plain own-data records and dense own-data arrays only: accessors, unknown fields, executable array overrides, sparse arrays, invalid ranges and duplicates throw synchronously. Later mutation of the caller's map has no effect. Errors while processing messages go to `onError`.

Example 10 connects hardware knobs CC16–19 to feedback, operator 1 ratio, operator 2 level and LFO rate; the browser sliders use the same ranges and 50 ms ramps. Knobs follow the incoming channel, sliders the selected part. Physical MIDI devices and permission dialogs require manual verification on supported browsers.


## Support and verification

Web MIDI exists in some browsers only and needs a secure context and user permission; feature-detect and handle rejection (`requestMidiAccess` rejects when unavailable). [`test/midi.test.ts` (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/test/midi.test.ts) drives the adapter with an injected access object against the real worklet processor: channel routing, repeated pitches, pedal deferral, malformed packets, bend/wheel/volume ranges, hot-unplug releasing only one input's keys, and dispose. No physical keyboard or browser permission flow was exercised by the automated tests.
