# Sound design workflow

[Example 12 (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/sound-design.html) is a browser FM designer built only on the public API (`OPM`, `playNote`, `updateNote`). It is a demo helper, not part of the engine. Start it over HTTPS or `localhost`, click **Start**, then hold a note (button or Space) and edit while it sounds. Begin at a low device volume: host gain defaults to 0.15 and is capped at 0.3.

## What you can edit

| Area | Controls |
| --- | --- |
| Topology | Algorithm 0–7 with a live signal graph (arrows run from modulator to recipient; carriers reach the output), operator-1 feedback 0–7, modulation index |
| Operators | Ratio, level, detune and four-stage ADSR for each operator |
| LFO | Rate, AM depth, PM cents, waveform, delay, note/global sync, phase, and a 0–1 AM and PM **target weight per operator** (the selective-LFO fields) |
| Envelopes | A dB-versus-time plot of each operator for a chosen gate length. It evaluates the engine's own `envelopeAt`, so segments that are straight in dB are exponential in amplitude, and −96 dB is the engine floor. |
| Starting points | Every bundled recipe, with its provenance, intended register, velocity range and host trim shown beside it |
| Audio | DSP profile (`eco` / `standard` / `high`), note, velocity, host gain |

## Live edits versus retriggers

A held note is edited natively where the engine has a live control, and retriggered otherwise:

| Edit | Behavior while a note is held |
| --- | --- |
| Operator ratio | `operatorRatios` ramp (20 ms) |
| Any ADSR stage | `operatorADSR`, re-anchored at the current dB level |
| Feedback | `feedback` ramp (20 ms) |
| LFO rate, AM depth, PM depth | `lfoRate`, `amDepth`, `pmDepth` ramp |
| Algorithm, selective target weights, level, detune, waveform, delay/sync/phase, modulation index | The note is released and retriggered, because these are fixed when a note is admitted |
| Name | No audio change |

The envelope plot shows a fresh note. Key-rate scaling, pitch envelopes, velocity and the LFO can alter an actual note, and a live ADSR edit starts from the sounding level, so the plot is a guide rather than an oscilloscope.

## Patch JSON

The page exports and imports one canonical version 6 patch (at most 16 KiB). Import uses the strict single-voice path: unknown fields, accessors, non-finite numbers and out-of-range values are rejected visibly, and legacy versions 1–5 are normalized to version 6. The exported file can be passed straight to `opm.playNote({ voice: patch, note: 60 })` or loaded with `opm.loadVoice(name, patch)`. Nothing is uploaded; use the bank tools for many voices at once.

## Designing with selective LFO

By default the LFO touches every operator. Set `pmTargets` / `amTargets` to confine it:

- PM on a **carrier** wobbles the pitch you hear; PM on a **modulator** changes brightness without vibrato.
- AM on a carrier is tremolo of that carrier; AM on a modulator moves sideband strength.
- A weight of 0 leaves an operator untouched; fractional weights scale the depth for that operator.

`tide_keys`, `ember_bass` and `orbit_pad` in the [voice quality guide](./voice-quality.md#selective-lfo-recipes-and-usage-table) are worked examples, and [the audition page (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/audition.html) can A/B them against other recipes with a held ratio/feedback/ADSR control phrase.

## Limits

The designer previews one note at a time on the main OPM instance of the page. It does not predict polyphonic loudness; leave headroom when chords are played (see the suggested polyphony and trim in the usage table). No listening judgment is built in.
