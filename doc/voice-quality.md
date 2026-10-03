# Preset and conversion acceptance

The checkout-only maintenance command `npm run voice-quality` produces a fresh JSON report for the eighteen bank voices and five original synthetic DX7 fixtures, each rendered under the `eco`, `standard` and `high` DSP profiles (69 accepted rows in the 1.8.0 run). Serve [the audition page (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/audition.html) through the project's HTTP demo server for seeded A/B playback, profile selection, a held ratio/feedback/ADSR control phrase, local PCM16 WAV downloads and local human finding capture. Playback requires a user gesture and AudioWorklet support to start the owned OPM audio session; audition audio itself is an offline dry DSP buffer, not a real-time worklet stress test.

## Bank, provenance and host trim

The existing seven recipes remain in `examples`; their synthesis parameters are unchanged, with current v6 format labels. All presets leave the optional `amTargets`/`pmTargets` tuples absent, retaining implicit all-operator LFO modulation. Explicit legacy v1–v5 inputs retain their old field restrictions and normalize to v6; they reject these new targets. See the [voice v6 guide](./expressive-voices.md#lfo) for selective modulation and immutable target snapshots. Eight additions are authored specifically as four-operator parameter recipes, not converted emulator patches, downloaded SysEx, sampled recordings or claims of acoustic/hardware fidelity:

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

Machine-readable `presetMetadata` in [`src/voices/preset-metadata.ts` (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/src/voices/preset-metadata.ts) records every bank recipe's provenance kind, source, Apache-2.0 license, non-emulator status, family, intended register/velocity, purpose and host trim. `defaultBrassMetadata` covers the separate default `brass.js` recipe, which differs from bank brass. Existing repository recipes are marked `repository-recipe`; additions are `original-recipe`. Metadata is deliberately **outside** strict voice objects: do not merge it into a patch submitted to validation.

Package wildcard exports expose the banks and metadata without additional runtime dependencies:

```js
import { examples } from 'opm.js/voices/examples.js';
import { originalPresets } from 'opm.js/voices/original.js';
import { presetMetadata } from 'opm.js/voices/preset-metadata.js';
```

Existing demo selectors import `examples`, so the expanded bank appears through their existing list/load path. Operator levels remain timbral parameters; no output-level compensation was embedded into operators. Metadata recommends **−6 dB additional host attenuation as a conservative starting point**, not a measured perceptual preference. The fresh report computes separate safety trims and pair-specific energy matching. More voices/chords require extra host headroom.

## Selective-LFO recipes and usage table

Three recipes added in 1.8 use the per-operator `amTargets`/`pmTargets` tuples that the 1.7 bank did not exercise. They are original four-operator parameter recipes, not converted patches or recordings:

| Recipe | Selective modulation | Playing notes |
| --- | --- | --- |
| `tide_keys` | AM only on the second carrier; PM on the first modulator and, lightly, the second pair's modulator, with no vibrato on either carrier | Short chords at medium velocity. Velocity-sensitive, key-scaled modulators soften hard high notes. Leave release headroom. |
| `ember_bass` | AM on the two modulators (sideband strength, not the bass floor); PM only on the upper modulator | Monophonic lines at moderate velocity. The unmodulated fundamental/sub pair stays stable. |
| `orbit_pad` | Shallow AM on the lower carrier, stronger AM on the upper pair; PM on modulators only; globally synchronized LFO | Let the 0.24–0.42 s attacks develop and tails clear before re-chording; use the lowest suggested polyphony the arrangement allows. |

Usage metadata for every bank voice (`presetMetadata`, outside the strict voice schema). Intended register and velocity describe where a recipe is meant to be played, not a validity limit. **Suggested polyphony and trim for the fifteen older recipes are conservative defaults (4 voices, −6 dB), not per-voice tuning**; only the three 1.8 recipes carry specific values. Trims are a *host* starting point, never an operator-level change.

| Voice | Family | MIDI | Velocity | Voices | Trim dB | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `bell` | bell | 48–84 | 0.25–1 | 4 | −6 | examples.ts |
| `brass` | brass | 48–76 | 0.25–1 | 4 | −6 | examples.ts |
| `bass` | bass | 36–60 | 0.25–1 | 4 | −6 | examples.ts |
| `electric_piano` | keys | 48–84 | 0.25–1 | 4 | −6 | examples.ts |
| `organ` | organ | 48–84 | 0.25–1 | 4 | −6 | examples.ts |
| `lead` | lead | 48–84 | 0.25–1 | 4 | −6 | examples.ts |
| `strings` | strings | 48–84 | 0.25–1 | 4 | −6 | examples.ts |
| `wood_mallet` | mallet | 48–84 | 0.25–1 | 4 | −6 | original.ts |
| `glass_pluck` | pluck | 48–84 | 0.25–1 | 4 | −6 | original.ts |
| `hollow_reed` | reed | 48–76 | 0.25–1 | 4 | −6 | original.ts |
| `slow_air_pad` | pad | 48–76 | 0.25–1 | 4 | −6 | original.ts |
| `bronze_plate` | metallic | 48–72 | 0.25–1 | 4 | −6 | original.ts |
| `membrane_tom` | percussion | 36–60 | 0.25–1 | 4 | −6 | original.ts |
| `fixed_hz_chime` | inharmonic | 48–84 | 0.25–1 | 4 | −6 | original.ts |
| `wire_kalimba` | pluck | 48–84 | 0.25–1 | 4 | −6 | original.ts |
| `tide_keys` | keys | 48–84 | 0.25–0.9 | 4 | −9 | original.ts |
| `ember_bass` | bass | 36–60 | 0.35–0.9 | 1 | −9 | original.ts |
| `orbit_pad` | pad | 48–76 | 0.25–0.8 | 3 | −12 | original.ts |

These numbers come from authoring intent plus the numerical sweeps below. Every metadata record has `listeningStatus: 'unverified'`: no listener has endorsed a recipe.

## Profiles and live-control phrases

The report runs every source through all three profiles at 48 kHz, adds the intended-register boundaries and velocity 0.1625 (the softest phrase articulation), and renders a **live-control phrase**: each note is held for 0.8 s while `operatorRatios` ramp at 0.12 s, `feedback` at 0.25 s, `operatorADSR` at 0.4 s and ratios/feedback return at 0.55 s. A row is accepted only if the render is finite, error-free, within `HEADROOM` and non-silent. This proves the control paths stay stable in the offline renderer; it is not a statement about how they sound.

## Numerical measurement contract

Reports render centered stereo at 48 kHz with a 0.8-second gate plus note-scaled release/filter tail. The nine reference cells are MIDI 48/60/84 at velocities 0.25/0.6/1, plus each recipe's intended lower/middle/upper register. Output includes sample peak, whole-render RMS, gate RMS, crest factor, finite status, DSP errors and per-cell acceptance. RMS uses mean stereo-channel energy; it is **unweighted, not LUFS and not perceptual equal loudness**.

Every measured cell must be finite, error-free, peak ≤ `HEADROOM` + 0.000001 and gate RMS > 0.000001. Report safety trims are attenuation-only, bounded −24..0 dB, with single-note targets peak ≤ −12 dBFS and gate RMS ≤ −24 dBFS. A bounded safety suggestion cannot guarantee those targets for arbitrary future patches. The command exits unsuccessfully on rejection and validates synthetic Yamaha checksums and equivalent packed/single conversion.

[`test/preset-quality.test.ts` (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/test/preset-quality.test.ts) covers finite/headroom/non-silence across every semitone of the eight additions' intended registers at 22.05 kHz and soft/medium/hard velocities. It also checks fixed-Hz partial localization/key invariance and held-gate mallet decay versus pad buildup. These are behavioral numerical regressions, not object snapshots or artistic verdicts. The 48 kHz report samples register cells; neither report nor sweep certifies every velocity, sample rate, polyphonic combination or live control transition.

## Repeatable listening workflow

1. Choose A/B sources, register, base velocity, single/phrase material, host gain mode and seed. Default seed is `20261002`. Record all choices; filenames include seed, material, gain mode, note and velocity. Phrase offsets are `[0, 2, 4, 7, −5, −12]`, clamped to MIDI 48–84. The unsigned 32-bit LCG chooses each velocity multiplier (0.65/0.8/1) and gate (0.35/0.5/0.8 seconds). Changing seed changes articulation, not patch parameters.
2. Start at low device volume. Measure, then compare A followed by B. Six-note phrases use identical padded slots for both sources, including full isolated tails. This gives equal whole-phrase measurement windows. Single-note matching uses the same 0.8-second gate window. Stop immediately cancels playing and queued buffers; Dispose closes the owned context and cleans URLs/nodes.
3. In **energy-matched** mode, both sources are attenuated to the quieter of their measured energy levels, the −24 dBFS target, metadata-trim ceilings and the −12 dBFS peak constraints. No source is amplified. Report the applied host trims separately from raw DSP values. The shared **0.12 master gain (−18.4 dB)** follows those trims. WAVs apply these exact same gains.
4. Repeat with **dry** mode: only the common 0.12 master gain, no source trim. Repeat the nine-cell single-note grid (C3/C4/C6 × soft/medium/hard), and selected phrases at those settings. Comparisons never overlap source tails. For a recipe outside its intended register, treat that cell as a stress comparison, not its intended playing range.
5. Record attack, held body, brightness, decay, release and any manual gain preference. Repeat after swapping A/B selection if assessing ordering effects. Differences in attack/crest/spectrum can make energy-matched sources sound unequally loud; manual preference is listening evidence only when an actual listener records it. Save matched and dry WAVs with settings for another listener.

The JSON report compares every source's middle-register seeded phrase against `wood_mallet`, recording dry master gains, matched host trims, raw measurements, common slot length and target. This is reproducible numerical preparation for listening, **not a listening result**. No subjective listening acceptance, hardware comparison or fidelity result is claimed here. No audio/patches are uploaded.

### Recording a human finding

The audition page has a **Record a human listening finding** panel. After actually listening to both selected sources, enter an anonymous listener label, exact device/browser/OS and output route, then check the explicit listening confirmation. Choose A, B, no-preference or not-assessed for each criterion; at least one must be assessed. Changing settings clears confirmation, and recording requires a fresh declaration. Add subjective gain notes separately for the selected matched or dry comparison: describe what felt loud/comfortable and actual device settings, without inventing dB, LUFS or a calibration for a volume slider.

A record stores the exact package version, A/B source names and SHA-256 normalized-patch identities, profile, material, seed, register, velocity, gain mode and phrase/control revisions. New records also store rendered/context sample rates, common master gain and actual A/B source-gain factors, separately from subjective notes. These are host gain factors, not perceptual loudness measurements. Records remain in page memory (at most 50) until **Export findings JSON**; no audio/finding is uploaded, and numerical reports never become human criteria.

This repository ships no recorded findings. Until someone records and reviews them, every recipe's `listeningStatus` stays `unverified`.

### Reviewing findings and host-trim decisions

```sh
npm run listening-evidence -- listener-one.json listener-two.json
npm run --silent listening-evidence -- listener-one.json listener-two.json > listening-review.json
```

The Node 22+ checkout-only CLI validates the existing `opm-listening-findings-1` / `opm-listening-finding-1` exports. Limits are 16 regular files, 2 MiB/file, 1–50 findings/file, bounded listener/device/output/notes, exact semantic package versions, UTC timestamps, typed selection fields, SHA-256 patch identities and all seven known criteria. Empty exports, all-unassessed entries, malformed bounds/hashes and conflicting content for the same timestamp/listener/conditions are rejected. Existing exports without explicit confirmation or applied gains remain readable with provenance warnings; unknown gains stay unknown, never filled from today's metadata.

The separate stdout review preserves filenames/finding indices, declared listener/device/output, notes and exact conditions. Groups require the same **ordered patch hashes**, package version, DSP profile, material, register, velocity, seed, phrase/control revisions, gain mode and recorded playback gains/sample rates. Source aliases do not substitute for hashes; swapping A/B is a different group. Matched and dry findings never merge. Duplicate copies contribute source references only. Per-criterion assessed/A/B/no-preference/not-assessed counts reflect actual entries; declared listener labels are not authenticated unique people. A successful parse is not a musical-quality pass and the command never rewrites `listeningStatus`, `hostTrimDb` or patches.

Hash strings are declared identities: the current export does not embed patch snapshots, so the reviewer cannot recompute them or authenticate the listener. Correlate them with retained normalized patches or the exact versioned source when reviewing a trim proposal; a valid 64-digit hash alone is not proof of provenance.

For a host-trim decision, inspect exact matched **and** dry groups and original gain-comfort notes for the same hashes/profiles/registers/velocities. Keep energy matching and safety trims separate from perceptual judgments, document the intended register and polyphony/headroom, and retain current starting trims until a maintainer can justify a change under stated conditions. Preference for A alone does not establish a numeric trim. If testing a proposed trim, record the actual applied host gain and new findings, not an inferred device-volume unit; rerun numerical safety verification after an approved metadata change. Review artifacts support a human decision, never auto-green artistic acceptance or hardware fidelity.

Use the audition's reproducible isolated notes, seeded phrases and live-control phrases for controlled comparisons, then listen in the original short songs [Harbor at First Light and Lanterns on the Stair (checkout-only showcase)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/showcase.html) for arrangement context. Save the exact score project and route/profile/gain notes; short-song observations are supplemental and must not be mislabeled as the audition's single/phrase/control material. A maintainer may graduate a recipe's listening metadata only after real listeners supply reviewed originals tied to exact patch hashes and conditions, with the scope and artifact reference documented. No human findings or physical captures were supplied here; the existing unverified metadata is intentionally unchanged.


## Original synthetic DX7 recipes

[`demo/audition-fixtures.ts` (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/demo/audition-fixtures.ts) generates valid-checksum VCED singles and a VMEM bank from original recipes, using Yamaha DX7 manual pp. 30–31 and DX7II Add-11 layout tables. The fixtures exercise three paired carriers, six additive carriers, a fixed-frequency carrier, velocity-sensitive modulation and equivalent packed-bank conversion. The fixed carrier retains its approximately 263 Hz frequency in canonical v6 instead of a MIDI-60 ratio approximation; imports leave LFO operator targets absent to preserve the established conversion sound.

The page and report include `describeDX7()` routing/loss warnings. Four slots cannot preserve all six-operator topologies; retained/dropped operators and approximate envelopes, levels, feedback, LFO, keyboard scaling and velocity transfer functions still matter. See the converter's current warnings for supported mappings rather than inferring that every source parameter is exact. There is **no original six-operator DX7 reference renderer** here: A/B compares OPM recipes and converted synthetic sources, not lossless conversion or DX7 hardware fidelity.
