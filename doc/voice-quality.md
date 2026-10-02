# Preset and conversion acceptance

Run `npm run voice-quality` for a fresh JSON report of all seven bundled voices (`bell`, `brass`, `bass`, `electric_piano`, `organ`, `lead`, `strings`) and five original synthetic DX7 fixtures. Open `examples/audition.html` through the project's HTTP demo server to hear A/B comparisons and download locally rendered WAVs. Audio playback requires a user gesture and AudioWorklet support.

## Measurement contract

Each voice is rendered at 48 kHz, centered stereo, with a 0.8-second gate plus its full release/filter tail. The nine musical cells are MIDI 48/60/84 (C3/C4/C6) at velocities 0.25/0.6/1. These deliberately expose low-register body, middle-register balance, high-register attenuation/brightness and velocity-dependent behavior; they are not an exhaustive MIDI-keyboard or sample-rate certification.

The report includes:

- Sample peak, the largest absolute sample in either channel, and peak dBFS.
- Full-render RMS and RMS dBFS, using mean stereo-channel energy, including release/tail.
- Gate-only RMS and RMS dBFS. This fixed window makes attack/sustain comparisons more useful than comparing different release lengths alone.
- Crest factor, finite-output status, DSP error count and per-cell acceptance.
- A per-voice suggested host trim based on the loudest cells, bounded to −24..0 dB. The attenuation-only targets are peak ≤ −12 dBFS and gate RMS ≤ −24 dBFS. These are conservative single-note listening targets, not mastering standards or polyphony guarantees; the bounded trim may not achieve both targets for arbitrary future patches.

RMS dBFS is an **unweighted objective energy/loudness proxy, not LUFS** and not a perceptual loudness match. An attack-heavy bell and sustained organ can have comparable peaks but different energy and apparent loudness. Check both windows and listen. Silent renders do not pass: every cell must have gate RMS > 0.000001, finite samples, zero DSP errors, and peak ≤ the engine's `HEADROOM` plus Float32 tolerance (0.000001). This is a sound-production acceptance check, not a timbral quality verdict; incidental exact output values are not pinned.

The command prints every measured cell and exits unsuccessfully if any cell fails. It also validates the generated Yamaha checksums, parses the full 32-voice packed bank and checks that its first converted recipe matches the equivalent single-voice dump. Actual measured values are produced by the command, not hard-coded into this document.

## Listening and host gain

The audition page plays either selected source at the same chosen register/velocity, or A then B across all nine cells. It separates release tails rather than masking one voice with another. Automatic gates, explicit Stop, disposal, note rejection handling, rendering errors and download URL cleanup are included.

Playback and downloaded PCM16 WAVs apply the same fixed **0.12 host gain (about −18.4 dB)**, not the suggested per-voice trim. Reports describe raw DSP output before that gain. No patch level, velocity sensitivity, envelope, feedback, filter or saturation is silently changed to meet a loudness target. Apply suggested trims in your own output GainNode/mixer if desired; leave additional headroom for chords and multiple voices. Start with low device volume.

## Original synthetic DX7 recipes

`demo/audition-fixtures.ts` generates valid-checksum VCED single dumps and a VMEM packed bank from original parameter recipes, using the Yamaha DX7 manual pp. 30–31 and DX7II Add-11 layout tables. No downloaded SysEx, third-party patch source, recording or emulator implementation is included.

| Fixture | What to compare |
| --- | --- |
| Three paired carriers, source algorithm 5 | Carrier retention with too few slots for every upstream modulator; missing modulation is a conversion loss. |
| Six additive carriers, source algorithm 32 | Four loudest retained carriers; two quieter carriers/partials disappear. |
| Fixed-frequency carrier | A roughly 263 Hz fixed source becomes a ratio anchored at MIDI 60. Converted low/high notes follow key pitch, unlike the source's fixed oscillator. |
| Velocity-sensitive modulator, source algorithm 16 | Soft/hard brightness changes through approximate per-operator dB sensitivity. Yamaha velocity curves and envelope transfer functions are not reproduced. |
| Packed bank | 32 instances of the paired-carrier recipe, with unique import names. Compare its first result to the equivalent single dump. |

The page displays `describeDX7()` routing and loss warnings for both selected sources. The report includes source/target algorithms and retained/dropped operator numbers. Conversions preserve neither six-operator topology nor DX7 hardware transfer functions: fixed-frequency oscillators, envelope rates/levels, feedback placement, LFO behavior, keyboard scaling and velocity response remain approximations or omissions as described by the converter.

There is **no original six-operator DX7 reference renderer** here. Audible comparisons are between unchanged bundled OPM voices and the imported synthetic recipes (including equivalent single/bank layouts), not a claim of lossless conversion or hardware fidelity. WAV generation stays in memory on the local device; nothing is uploaded.
