# Preset and conversion acceptance

`npm run voice-quality` produces a fresh JSON report for the fifteen bank voices and five original synthetic DX7 fixtures. Serve `examples/audition.html` through the project's HTTP demo server for seeded A/B playback and local PCM16 WAV downloads. Playback requires a user gesture and AudioWorklet support to start the owned OPM audio session; audition audio itself is an offline dry DSP buffer, not a real-time worklet stress test.

## Bank, provenance and host trim

The existing seven recipes remain in `examples`; their synthesis parameters are unchanged, with current v5 format labels. Eight additions are authored specifically as four-operator parameter recipes, not converted emulator patches, downloaded SysEx, sampled recordings or claims of acoustic/hardware fidelity:

| Addition | Intended MIDI register | Timbral design |
| --- | --- | --- |
| `wood_mallet` | 48–84 | Fast high-partial decay; higher keys shorten envelopes. |
| `glass_pluck` | 48–84 | Velocity-sensitive glassy transient over a decaying body. |
| `hollow_reed` | 48–76 | Even-ratio modulation of odd-partial carriers; delayed vibrato. |
| `slow_air_pad` | 48–76 | Slow detuned onset, shallow pitch envelope, global LFO phase. |
| `bronze_plate` | 48–72 | Noninteger PM ratios and unequal metallic decays. |
| `membrane_tom` | 36–60 | Short body with a downward pitch-envelope transient. |
| `fixed_hz_chime` | 48–84 | Additive 317/523/829/1237 Hz partials independent of key pitch. |
| `wire_kalimba` | 48–84 | Key-tracking plucked body and fixed-Hz transient modulator. |

All intended base velocities are 0.25–1. Phrase articulation reaches 0.1625; the numerical safety sweep also includes that soft boundary. Register labels express intended musical use, not a promise that notes outside them are invalid. Fixed-Hz operators ignore MIDI/tuning frequency but still respond to detune, pitch controls/envelope and LFO pitch modulation. Ratios remain present in the strict schema. Rate key scaling changes envelope times; none of these fields implement chip register behavior.

Machine-readable `presetMetadata` in `src/voices/preset-metadata.ts` records every bank recipe's provenance kind, source, Apache-2.0 license, non-emulator status, family, intended register/velocity, purpose and host trim. `defaultBrassMetadata` covers the separate default `brass.js` recipe, which differs from bank brass. Existing repository recipes are marked `repository-recipe`; additions are `original-recipe`. Metadata is deliberately **outside** strict voice objects: do not merge it into a patch submitted to validation.

Package wildcard exports expose the banks and metadata without additional runtime dependencies:

```js
import { examples } from 'opm.js/voices/examples.js';
import { originalPresets } from 'opm.js/voices/original.js';
import { presetMetadata } from 'opm.js/voices/preset-metadata.js';
```

Existing demo selectors import `examples`, so the expanded bank appears through their existing list/load path. Operator levels remain timbral parameters; no output-level compensation was embedded into operators. Metadata recommends **−6 dB additional host attenuation as a conservative starting point**, not a measured perceptual preference. The fresh report computes separate safety trims and pair-specific energy matching. More voices/chords require extra host headroom.

## Numerical measurement contract

Reports render centered stereo at 48 kHz with a 0.8-second gate plus note-scaled release/filter tail. The nine reference cells are MIDI 48/60/84 at velocities 0.25/0.6/1, plus each recipe's intended lower/middle/upper register. Output includes sample peak, whole-render RMS, gate RMS, crest factor, finite status, DSP errors and per-cell acceptance. RMS uses mean stereo-channel energy; it is **unweighted, not LUFS and not perceptual equal loudness**.

Every measured cell must be finite, error-free, peak ≤ `HEADROOM` + 0.000001 and gate RMS > 0.000001. Report safety trims are attenuation-only, bounded −24..0 dB, with single-note targets peak ≤ −12 dBFS and gate RMS ≤ −24 dBFS. A bounded safety suggestion cannot guarantee those targets for arbitrary future patches. The command exits unsuccessfully on rejection and validates synthetic Yamaha checksums and equivalent packed/single conversion.

`test/preset-quality.test.ts` covers finite/headroom/non-silence across every semitone of the eight additions' intended registers at 22.05 kHz and soft/medium/hard velocities. It also checks fixed-Hz partial localization/key invariance and held-gate mallet decay versus pad buildup. These are behavioral numerical regressions, not object snapshots or artistic verdicts. The 48 kHz report samples register cells; neither report nor sweep certifies every velocity, sample rate, polyphonic combination or live control transition.

## Repeatable listening workflow

1. Choose A/B sources, register, base velocity, single/phrase material, host gain mode and seed. Default seed is `20261002`. Record all choices; filenames include seed, material, gain mode, note and velocity. Phrase offsets are `[0, 2, 4, 7, −5, −12]`, clamped to MIDI 48–84. The unsigned 32-bit LCG chooses each velocity multiplier (0.65/0.8/1) and gate (0.35/0.5/0.8 seconds). Changing seed changes articulation, not patch parameters.
2. Start at low device volume. Measure, then compare A followed by B. Six-note phrases use identical padded slots for both sources, including full isolated tails. This gives equal whole-phrase measurement windows. Single-note matching uses the same 0.8-second gate window. Stop immediately cancels playing and queued buffers; Dispose closes the owned context and cleans URLs/nodes.
3. In **energy-matched** mode, both sources are attenuated to the quieter of their measured energy levels, the −24 dBFS target, metadata-trim ceilings and the −12 dBFS peak constraints. No source is amplified. Report the applied host trims separately from raw DSP values. The shared **0.12 master gain (−18.4 dB)** follows those trims. WAVs apply these exact same gains.
4. Repeat with **dry** mode: only the common 0.12 master gain, no source trim. Repeat the nine-cell single-note grid (C3/C4/C6 × soft/medium/hard), and selected phrases at those settings. Comparisons never overlap source tails. For a recipe outside its intended register, treat that cell as a stress comparison, not its intended playing range.
5. Record attack, held body, brightness, decay, release and any manual gain preference. Repeat after swapping A/B selection if assessing ordering effects. Differences in attack/crest/spectrum can make energy-matched sources sound unequally loud; manual preference is listening evidence only when an actual listener records it. Save matched and dry WAVs with settings for another listener.

The JSON report compares every source's middle-register seeded phrase against `wood_mallet`, recording dry master gains, matched host trims, raw measurements, common slot length and target. This is reproducible numerical preparation for listening, **not a listening result**. No subjective listening acceptance, hardware comparison or fidelity result is claimed here. No audio/patches are uploaded.

## Original synthetic DX7 recipes

`demo/audition-fixtures.ts` generates valid-checksum VCED singles and a VMEM bank from original recipes, using Yamaha DX7 manual pp. 30–31 and DX7II Add-11 layout tables. The fixtures exercise three paired carriers, six additive carriers, a fixed-frequency carrier, velocity-sensitive modulation and equivalent packed-bank conversion. The fixed carrier now retains its approximately 263 Hz frequency in v5 instead of a MIDI-60 ratio approximation.

The page and report include `describeDX7()` routing/loss warnings. Four slots cannot preserve all six-operator topologies; retained/dropped operators and approximate envelopes, levels, feedback, LFO, keyboard scaling and velocity transfer functions still matter. See the converter's current warnings for supported mappings rather than inferring that every source parameter is exact. There is **no original six-operator DX7 reference renderer** here: A/B compares OPM recipes and converted synthetic sources, not lossless conversion or DX7 hardware fidelity.
