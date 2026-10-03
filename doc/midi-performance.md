# Expressive performance and optional Web MIDI

`createPerformance(opm, options)` gives a host part-scoped key policies (poly/mono, legato, sustain, last/high/low priority), per-key and per-part live controls, per-part voice budgets and priorities, and a separate optional Web MIDI adapter. Try [example 10 (checkout-only)](../examples/instrument.html).

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
- `configurePart(part, options, policy?: { preserveNotes?: boolean })` normally clears gates on voice/mode changes. `{ preserveNotes: true }` retains sounding gates on voice-only changes, selecting the new patch for later admissions; mono legato restarts rather than reusing a gate with a different patch. Mode changes always clear keys.

## Web MIDI adapter

```ts
import { createPerformance, createMidiAdapter, requestMidiAccess } from 'opm.js';

button.onclick = async () => {                       // an explicit user action
  const access = await requestMidiAccess();          // sysex: false; may show a permission prompt
  const midi = createMidiAdapter(performance, access, { parts: 2, pitchBendRange: 2 });
  // midi.snapshot, midi.releaseAll(), midi.dispose()
};
```

Importing the module never requests access. The adapter accepts any object that provides `inputs` and `statechange` events (`MidiAccessLike`), so tests and hosts can inject their own. It is **not** a MIDI driver: no SysEx, clock or device-specific behavior. Optional `programVoices?: MidiVoiceMap` maps programs 0–127 to named FM voices via `configurePart` with preserved notes; only later onsets use the new voice, unmapped programs are ignored. The map accepts a plain own-data object or native Map, at most 128 entries; keys are integers 0–127 and names match `[a-zA-Z0-9_-]{1,64}`. It is copied/validated before ports open. Unknown bank names report the normal performance unknown-voice error to `onError`. `gmProgramVoices` (root/core export) is an artistic family starter, not a GM sound set. No live `drumVoices` option is provided; configure percussion parts explicitly. Bank select remains ignored.

| Message (channel 1–16 → part 0–15) | Effect |
| --- | --- |
| Note on / off (velocity 0 = off) | `noteOn(part, note, { velocity: v / 127 })`; note-off releases the **oldest** still-held key of that input, channel and pitch. Repeated equal pitches keep separate identities. |
| CC64 | Sustain pedal for the part. The part is sustained while any adapter input holds its pedal. |
| CC1, channel pressure, polyphonic pressure | LFO depth multiplier `1 + v/127` (1×–2×): never below the patch default. Polyphonic pressure uses `updateKey`; the others `updatePartNotes`. |
| CC7, CC11 | Multiply into the part's expression. |
| CC10 | Pan. |
| Pitch bend | ± channel sensitivity, initially `pitchBendRange` (default 2, at most 48). |
| CC101/100, then CC6/38 | RPN 0 selection and sensitivity in semitones/cents for this channel; affects later bends only. |
| CC120 | Force-release all owned keys (including pedal-latched keys) for this input/channel; no global panic or changes to other inputs/host keys. |
| CC123 | Pedal-aware note-off for physically held keys of this input/channel; latched keys remain owned for later forced cleanup. |
| CC121 | Reset the adapter's controllers for the channel and release its pedal. |

Everything else is counted in `snapshot.ignoredMessages`. Malformed packets (wrong length, data bytes above 127, unknown status) are ignored, never thrown into the page.

RPN 0 requires CC101=0/CC100=0. CC6 semitones clamp to 48, optional CC38 cents clamp to 99, and the total clamps to 48 semitones. Each channel starts with the explicit range (default 2); state is shared across adapter inputs for that channel, like other part controllers. RPN null (CC101=127/CC100=127), other RPN numbers, or NRPN selectors CC98/99 deselect sensitivity data entry. CC121 restores the explicit range and null selection; dispose clears internal RPN state and removes listeners, without resetting host part controls. No SysEx is accepted.

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

A listed CC replaces that controller's ordinary action: mapping CC1 to feedback disables CC1's default modulation action, but channel/poly pressure still control modulation. CC64/100/101/120/121/123 cannot be remapped. RPN 0 data-entry CC6/38 takes precedence over custom mappings **only while selected**; otherwise mappings work normally, or unmapped data entry is ignored. NRPN selectors deselect RPN before any ordinary/custom action. Controllers must be integers 0–127; at most 128 entries are accepted, with no duplicate controller or target (same field/operator). Omitting `controllerMap` preserves ordinary CC behavior, except the newly supported RPN sensitivity.

CC121 restores every mapped target for the channel. Optional `reset` defines that target's baseline and must be inside the field's engine bounds (not necessarily inside `min`/`max`). Only `operatorFrequencies` accepts `reset: null`, which restores ratio mode. Without `reset`, the baseline is captured from `getPartControls` **when the adapter is created**, so later patch/configuration changes do not change that reset value. Reset retains unrelated tuple elements and uses each mapping's ramp. Ordinary reset behavior and input-pedal ownership remain intact.

The adapter copies and validates the complete map before adding input/state listeners or opening ports. Plain own-data records and dense own-data arrays only: accessors, unknown fields, executable array overrides, sparse arrays, invalid ranges and duplicates throw synchronously. Later mutation of the caller's map has no effect. Errors while processing messages go to `onError`.

Example 10 connects hardware knobs CC16–19 to feedback, operator 1 ratio, operator 2 level and LFO rate; the browser sliders use the same ranges and 50 ms ramps. Knobs follow the incoming channel, sliders the selected part. Physical MIDI devices and permission dialogs require manual verification on supported browsers.


## Support and verification

Web MIDI exists in some browsers only and needs a secure context and user permission; feature-detect and handle rejection (`requestMidiAccess` rejects when unavailable). [`test/midi.test.ts` (checkout-only)](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/test/midi.test.ts) drives the adapter with an injected access object against the real worklet processor: channel routing, repeated pitches, pedal deferral, malformed packets, bend/wheel/volume ranges, hot-unplug releasing only one input's keys, and dispose. No physical keyboard or browser permission flow was exercised by the automated tests.

## Original physical MIDI campaign (current 1.10.0 checkout)

No physical controller, permission-dialog result or human listening original is supplied here. Permission, connection, hot-unplug, sustain, CC and bend acceptance all remain **unverified**. Injected adapter tests and automated browser clicks do not change that status.

The bounded local observation export below is available in the **v1.10 checkout-only example**, not the installed engine archive. Build and serve the matching 1.10.0 source checkout to use the capture panel. No public export/protocol API was added.

1. Build and serve the matching 1.10.0 checkout over HTTPS or localhost. Use a browser that actually exposes Web MIDI; unsupported browsers remain unverified for controller operation, not a fabricated pass. Start at comfortable low output volume and click **Start / restart audio**.
2. In **Local physical MIDI campaign**, select the actual environment and enter device model/OS, exact browser version, controller model/firmware/USB or Bluetooth connection, and output route/device volume. Avoid serial numbers or personal identifiers. For desktop UI smoke choose **Desktop / automation**, even when exercising synthetic messages.
3. Select a scenario and **Begin local scenario capture**. For permission, begin before **Connect Web MIDI**. Test a fresh real prompt's grant and denial as separate runs, using the browser's permission settings between runs when necessary. If permission was already granted or no prompt appeared, say so: that is not original grant/denial-dialog coverage.
4. Follow the on-page instructions and the criteria below. Record observed behavior and unexercised steps, not only “works.” Check the physical-action and listening declarations only after actually doing both. Choose manual pass/fail/unverified, then **Finish capture / release keys**. Confirm silence after release tails. Repeat every scenario under the same exact declared conditions, exporting before changing browser/device/route.
5. **Export local MIDI observations** before leaving or clearing. Review displayed and exported port IDs/names before sharing; browsers may expose identifying strings. Keep the untouched original privately; share a separately identified redacted copy if needed, never overwrite the original to fill missing results.

| Scenario | Required original observations / manual criteria |
| --- | --- |
| Permission | Actual grant and denial outcomes, whether a prompt appeared, no SysEx request, visible denial error and usable host keyboard after denial; previously granted access must be identified. |
| Connect | Physical channel 1 mono lead / channel 2 poly pad routing, repeated equal pitches, velocity-zero note-off, note release and no stuck keys. State unsupported features instead of inferring coverage. |
| Hot-unplug | Unplug while holding notes and pedal, silence of the disconnected input after tails, reconnect without resurrected gates. Exercise a second controller if claiming input-isolation coverage; with one input leave that subclaim unverified. |
| Sustain | Channel 2 chord held after physical note-off under CC64; pedal-up releases it; CC123 remains pedal-aware and CC120 forces adapter-owned cleanup. Check the shared part-pedal effect on host keys; do not claim pedal is key-owned. |
| CC | Physical CC16–19 minimum/middle/maximum and audible held-note changes, CC121 restoration to adapter-creation baselines; CC1/7/10/11 and pressure when actually available. Note unavailable messages. Knobs do not move sliders; effective snapshots, not slider positions, describe applied state. |
| Bend | Each routed channel's full down/up ±2-semitone range, return to center, fresh notes and released tails, other channel unaffected. Record actual controller centering; audible pitch judgment is manual, not a frequency measurement. |

The export is demo-local `opm-local-midi-observations`, version `1`, not a public API protocol. It holds at most 24 runs and 256 timestamped page observations per run, with overflow counted; additional runs are refused until export/clear. Notes are capped at 1200 characters; four condition fields and input IDs/names at 160, user agent/errors at 240, and input enumeration at 32. Only 2–3-byte channel-voice packets are observed, never SysEx or arbitrary payloads. No network request, microphone/audio recording, persistent storage or JSON import/auto-trust path is added.

Every run carries exact `VERSION`, declared environment/device/browser/controller/route, bounded user agent, start/end/duration, beginning/ending actual sample rate, quality/maxVoices, fixed submitted mix/tuning/stealing/interruption settings, normalized loaded lead/strings patches, effective part states/controls, adapter snapshot and CC mappings. The profile is the applied **instrument-midi-1** workload, not arbitrary presets or voices. Incoming MIDI packets, port changes, permission decisions/errors and host-control actions are page observations, never automatic pass/fail or proof of audible continuity.

Engine construction and capture share one explicit immutable settings policy: standard quality, 16 voices, mix gain 0.35, oldest stealing, cancel interruption, and tuning `{ referenceHz: 440, offsets: [128 numeric zero cents entries] }`. Exported quality/voice limits and context sample rate also come from the actual instance; normalized patches and effective part controls come from loaded snapshots. Begin/end settings are main-thread snapshots at capture boundaries, **not sample-accurate audio-frame measurements**. The ending snapshot is taken before Finish's part/adapter release or teardown cleanup; it can still contain held keys. Cleanup is a subsequent safety action, not evidence that the captured state was already silent. Exercise and record manual release/silence criteria during the active scenario if claiming that coverage.

`manualJudgment` remains separate from `acceptanceStatus`: active, abandoned, desktop/automation, non-physical, non-listened, changed-scope or overflowed runs are acceptance-unverified. Changing declared conditions, host-selected part, octave or glide invalidates the active scope and clears declarations; start/restart/dispose/page exit finishes it unverified. Intentional MIDI CC/bend changes are scenario actions, captured with effective controls, not a new static baseline. Begin/end settings must be reviewed alongside the event sequence. Finish releases the parts; teardown removes capture listeners and revokes download URLs. Reconfigure and recapture rather than relabeling an old run.

Review the original JSON directly: check format/version, counts/truncation, finished timestamps, exact workload and route, manual declarations and notes; correlate packets/port transitions with claimed steps. A declared physical pass/fail is **unauthenticated local evidence**, not certified hardware acceptance. There is intentionally no additional public evidence validator. Unsupported or missing steps stay unverified even if a selector says pass; a maintainer must attach reviewed original references and exact scope before upgrading any compatibility claim.
