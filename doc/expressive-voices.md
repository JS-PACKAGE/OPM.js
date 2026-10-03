# Voice v7 and expressive controls

Voice format version **7** is independent of the npm package version. `normalizeVoice` accepts an omitted version as v7; explicit v1–v6 retain their original field restrictions. Normalized, prepared, imported and bank voices emit v7. Canonical bank entries require `version`, `name`, `algorithm`, `feedback`, `modIndex`, `lfo`, and exactly four `ops`; the exported JSON schema describes that canonical shape, including numeric LFO target tuples.

Inputs must use plain objects and dense own-data operator/target arrays. Unknown fields, accessors, malformed enums, nonfinite numbers and unsupported versions are rejected without evaluating getters. `normalizeVoice` rejects out-of-range numbers; the bank-oriented `validateVoice`/`parseVoiceBank` clamp finite numeric values to the documented bounds. Integer selectors and MIDI breakpoints must still be integers. LFO target tuples are detached and frozen even in normalized voices. `prepareVoice` and bank validation return detached, deeply frozen snapshots, including the optional pitch envelope. A cloned prepared patch must be validated again; a copied shape does not confer trusted identity.

## Patch fields

| Field | Bounds / meaning |
| --- | --- |
| `algorithm`, `feedback` | Integers 0–7; algorithm selects the four-op graph. Feedback acts on operator zero. |
| `name` | 1–64 ASCII letters, digits, `_`, `-`; optional for single-voice input. |
| `modIndex` | 0–16 radians per unit modulator signal; single-input default 4. |
| Operator `ratio` | 0.125–32; required even with fixed Hz. |
| Operator `level` | 0–1 before envelope, key/velocity attenuation and live operator multiplier. |
| Operator `detune` | −1200–1200 cents. |
| Operator `adsr` | Required `{a,d,s,r}`: attack/decay/release 0–10 seconds, sustain gain 0–1. Ramps are linear in dB; the −96 dB floor becomes silence. |
| Operator `keyScale` | Optional `{breakpoint,leftDbPerOctave,rightDbPerOctave}`: breakpoint integer MIDI 0–127, each attenuation 0–24 dB/octave. |
| Operator `velocitySensitivity` | Optional 0–48 dB attenuation at velocity zero; default zero. Final note velocity gain remains independent. |
| Operator `frequency` | Optional **1–20000 Hz**, replacing tuned note frequency × ratio. Detune, live pitch/glide, pitch envelope and LFO pitch modulation still apply. Changing MIDI note or tuning does not transpose fixed Hz, but optional key/rate scaling still responds to the played note. |
| Operator `rateKeyScale` | Optional 0–4; default zero. Each ADSR duration becomes `min(10, seconds * 2 ** (-rateKeyScale * (note - 60) / 12))`. Fractional notes interpolate continuously; zero durations stay zero. Durations are prepared at admission and do not follow live pitch bends or tuning changes. |
| Operator `waveform` | Optional v7 `sine` (default), `half`, `abs`, `quarter`, `alternating`, `camel`, `square`, `saw`, `noise`. |
| Operator `noiseRate` | Optional v7 20–20000 Hz, default 8000. Ignored unless waveform is `noise`. |

Explicit v1 rejects key scaling and velocity sensitivity; v2 adds key scaling; v3 adds velocity sensitivity; v4 adds LFO waveform. All explicit v1–v4 reject `frequency`, `rateKeyScale`, `pitchEnvelope`, and LFO `delay`/`sync`/`phase`, rather than silently dropping them. V5 adds those expressive fields, represented by `LegacyVoiceV5` and `LegacyLFOV5`. All explicit v1–v5 reject LFO `amTargets`/`pmTargets`. V6 adds those per-operator targets; leaving them absent preserves the legacy all-operator modulation behavior without adding default fields to snapshots.

### Oscillator shapes and noise

For θ = phase + modulation and fractional turns `t = frac(θ / (2π))`, the periodic shapes are:

| Shape | Formula |
| --- | --- |
| sine | `sin(θ)`; the unchanged legacy fast path |
| half | `max(0, sin(θ))` |
| abs | `abs(sin(θ))` |
| quarter | `abs(sin(θ))` when `frac(θ/π) < 0.5`, otherwise zero |
| alternating | `sin(2θ)` when `t < 0.5`, otherwise zero |
| camel | `abs(sin(2θ))` when `t < 0.5`, otherwise zero |
| square | −1 for negative sine, +1 otherwise (including zero) |
| saw | `2 * frac(t + 0.5) - 1`; rising, zero at θ = 0 |

Phase reduction uses fractional turns, including negative and very large finite arguments, never wrapping loops. Square, saw and held noise can alias: the existing per-voice oversampling/decimator reduces some products but does **not** make these oscillators alias-free.

Noise is an original deterministic 17-bit maximal-length LFSR (`x^17+x^3+1`), seeded with `0x1ffff` at every note admission, including pooled slot reuse. The low bit produces bipolar ±1 and advances on the `noiseRate` time-domain hold clock, independent of output sample rate. Identical admissions reproduce the sequence. Ratio, fixed frequency, detune, tuning, pitch envelopes, live pitch and modulator PM do not pitch noise; existing `operatorRatios`/`operatorFrequencies` controls remain valid but have no audible pitch effect on it. Envelope, key/rate scaling, velocity, level, AM and graph routing still apply; noise can be either a modulator or carrier.

This OPM-NE-inspired musical extension allows noise on **any operator of any voice**, unlike hardware restricted to the last operator of channel 8. It is not a Yamaha/YM2151 fidelity claim. Explicit v1–v6 reject operator `waveform` or `noiseRate` with a version-7 requirement; `LegacyVoiceV6` preserves the prior shape. Prepared snapshots, bank JSON, content-keyed registration and worklet validation retain both new fields.


### Pitch envelope

Optional `pitchEnvelope` requires all seven own-data fields:

```ts
pitchEnvelope: {
  a: 0.02, d: 0.15, r: 0.1,
  initial: -300, peak: 100, sustain: 0, final: -100
}
```

`a`, `d`, `r` are 0–10 seconds. `initial`, `peak`, `sustain`, `final` are −4800–4800 cents. Held notes move linearly in cents **initial → peak → sustain**. A zero attack skips directly to peak; a zero decay skips directly to sustain. Release moves from the **current** cents value to final, even during attack/decay; zero release immediately selects final. Final pitch persists while operator releases remain audible. The pitch envelope does not prolong otherwise silent operators or filter tails.

Pitch cents combine multiplicatively with original operator Hz, detune, live semitone pitch/glide and LFO PM. Pitch-envelope and glide evaluation use deterministic synthesis substeps for the selected quality profile: standard 4× (default), eco 2×, high 8×. Splitting `render` into different buffer sizes does not change the timeline. Operator phase increments are limited to 45% of the internal sample rate before/after LFO PM, preserving the engine's existing high-frequency safety cap.

### LFO

`lfo` requires `rate` (0–20 Hz), `amDepth` (0–1) and `pmDepth` (0–1200 cents); single-input omission disables modulation. `waveform` defaults to `sine`, with `triangle`, rising `saw`, and `square` also supported.

- `delay`: optional 0–10 seconds, default zero. Gates both AM and PM depth until that note's elapsed time reaches delay; the phase clock **continues** during delay. This is a depth gate, not a gradual fade-in.
- `sync`: `note` (default) resets the clock at note admission. `global` uses `Synth.currentFrame`, including rendered silence, so separately admitted notes share a deterministic frame clock. Neither uses wall time. Panic does not rewind the global clock.
- `phase`: optional 0–1 turns, default zero; 1 wraps to 0. At rate zero this can produce static AM/PM offset.
- `amTargets`, `pmTargets`: optional readonly four-element tuples in operator order, each entry a finite **0–1** depth multiplier or a boolean (`false` → 0, `true` → 1). Normalization stores immutable numeric `LFOTargets`; `LFOInput` accepts `LFOTargetsInput`. Each omitted tuple acts as `[1, 1, 1, 1]`, preserving the old sound. Zero disables that modulation for the selected operator; fractional weights reduce it independently of operator level. Dense own-data elements are required; getters, holes, extra fields and malformed values reject.

LFO values are evaluated once per output frame. Sine and triangle start at zero rising, saw at −1, square at +1. For operator `i`, AM multiplies gain by `1 - amDepth * amTargets[i] * (0.5 + 0.5 * waveformValue)`; PM multiplies pitch by `2 ** (pmDepth * pmTargets[i] * waveformValue / 1200)`. Missing targets use 1 in these formulas. Delay, sync and phase remain shared by all four operators.

## Live operator levels

`Synth.updateNote`, host `updateNote`, scheduled controls, and sequence automation accept:

```ts
{ operatorLevels: [1, 0.4, 1.5, 0], ramp: 0.1 }
```

The readonly tuple must contain exactly four finite own-data numbers in **0–2**. Each number multiplies its patch operator level after key/velocity scaling and before FM routing/feedback. All default to 1. A multiplier cannot revive a patch operator whose level is zero. Modulator levels change timbre; carrier levels change that carrier's contribution. Final expression/velocity and equal-power pan remain separate controls.

`ramp` is 0–10 seconds, default zero. The four multipliers ramp linearly and independently from their current values using the same supplied duration. An interrupted ramp starts from its current value, not the old target. Unrelated expression, pan, modulation or pitch updates do not cancel operator ramps. Validation detaches and freezes the tuple and its outer control record before scheduling. Recycled/stealing voice slots preserve current tails and fully reset controls for new admissions; render processing allocates no arrays or objects.

## Live timbre and envelope controls

The same note-control APIs accept these optional fields independently:

| Control | Bounds / meaning |
| --- | --- |
| `feedback` | Finite 0–7 continuous feedback selector. Between 0 and 1, gain interpolates from zero to the classic selector-1 gain; 1–7 follows the original exponential gain mapping. Patch feedback remains an integer. |
| `lfoRate`, `amDepth`, `pmDepth` | 0–20 Hz, 0–1, 0–1200 cents respectively; update the admitted note's LFO independently. |
| `operatorRatios` | Readonly four-element tuple of finite 0.125–32 ratios. Fixed-Hz operators retain these ratios but ignore them until restored to ratio mode. |
| `operatorFrequencies` | Readonly four-element tuple, each entry finite 1–20000 Hz or `null` to restore tuned note × ratio. Fixed Hz ignores MIDI/tuning transposition; detune, live pitch, pitch envelope and LFO PM still apply. |
| `operatorADSR` | Readonly four-element tuple of complete `{a,d,s,r}` objects using the patch ADSR bounds. Parameters are replaced, not interpolated by `ramp`. |

`ramp` gives feedback, LFO and frequency/ratio updates independent linear timelines. It must accompany a rampable scalar or tuple control; `operatorADSR` alone with `ramp` rejects. Interrupted updates start at the current value; omitted controls keep their existing timelines. Live `lfoRate` integrates phase without resetting the current phase, including interrupted rate ramps. Tuples and nested ADSRs are strict own-data snapshots detached and frozen before scheduling.

Updating a held operator's ADSR restarts attack from its current dB level, then decays to the new sustain. With both attack and decay zero, a one-frame bridge preserves continuity. An update during release starts from the current dB level and completes the new key-scaled release, bounded to ten seconds; zero release silences immediately. Envelope durations provide continuity rather than interpolating ADSR parameters with the control ramp.

## DX7 import: retained data versus approximations

`importDX7` remains a lossy six-to-four-operator conversion, **not hardware emulation**. Source format and behavior were checked against the [Yamaha DX7 manual, printed pp. 13–17 and 30–31](https://data.yamaha.com/files/download/other_assets/9/333979/DX7E1.pdf) and the [DX7II packed VMEM layout, Add-11](https://data.yamaha.com/files/download/other_assets/7/320817/DX7IIE.PDF).

- Fixed frequency is retained in Hz as `10 ** ((coarse & 3) + fine / 100)`, rather than a MIDI-60 ratio. Detune remains approximate.
- Keyboard rate scaling maps source 0–7 to OPM 0–4. This is a continuous musical approximation, not Yamaha's grouped-key/rate transfer function.
- Pitch envelope retains L4 → L1 → L3 → L4. L2 is omitted; R2/R3 durations are merged and capped at ten seconds. Levels interpolate piecewise linearly through source 0/50/99 = −4800/0/+4800 cents. Rates use the existing `min(10, 10 * 2 ** (-rate / 10))` seconds heuristic, not measured hardware timing. A fully neutral pitch envelope is omitted.
- LFO delay maps source 0–99 to 0–10 seconds; sync on maps to note and sync off to deterministic global phase. Delay shaping and free-running/random hardware phase are not reproduced.
- Triangle, rising saw, square and sine retain their waveform family. Descending saw becomes rising saw; sample-and-hold becomes sine. Both substitutions are explicitly reported by `describeDX7`.

Operator selection, envelope/output response, topology, feedback placement, velocity and level scaling remain approximations. Oscillator phase carry, source transpose, positive keyboard scaling, per-operator AM and nonzero final amplitude-envelope levels are not preserved. `describeDX7` reports these losses separately from the strict usable voice shape.

## OPM text import

`importOPM(source: string | Uint8Array): Voice[]` and `describeOPM(source: string | Uint8Array): OPMImportDescription[]` live in `opm.js/voices/opm.js`. They convert decimal VOPM/MXDRV-family text patches into complete v7 voices through normal normalization. This is approximate conversion, **not register-level YM2151 emulation**, with no hardware-fidelity claim.

Format references: the [published MiOPM text-layout header](https://raw.githubusercontent.com/vampirefrog/libfmvoice/master/tests/test.opm), [VOPM unofficial manual](https://tanalin.com/en/articles/third-party/vopm-manual/) and [OPM application manual](https://archive.org/details/yamaha-ym2151-technical-reference), especially figures 2.5–2.16. Only format/parameter documentation was used; no emulator or converter implementation was copied. The VOPM GUI multiplier description is doubled relative to hardware MUL: this importer conservatively uses raw hardware values. The published text example contains an out-of-range KS value; hardware KS 0–3 is enforced rather than guessing its meaning. No physical or listening comparison has been performed.

Each patch starts with `@:<program 0..127> <name>` and must contain exactly one each of `LFO:`, `CH:`, `M1:`, `C1:`, `M2:`, `C2:`. Blank lines and lines starting with `//` after whitespace are ignored; CRLF is accepted. Section order is flexible; fields are decimal integers only:

```text
LFO: LFRQ AMD PMD WF NFRQ
CH: PAN FL CON AMS PMS SLOT NE
M1: AR D1R D2R RR D1L TL KS MUL DT1 DT2 AMS-EN
C1: (same eleven fields)
M2: (same eleven fields)
C2: (same eleven fields)
```

Ranges: LFRQ 0–255; AMD/PMD 0–127; WF 0–3; NFRQ 0–31; PAN byte 0–255 (ignored); FL/CON/PMS 0–7; AMS 0–3; NE/AMS-EN 0–1. SLOT is the **raw key-on mask**: only bits 3/4/5/6 (8/16/32/64) enable M1/C1/M2/C2, so all enabled is 120, not 15. Disabled operators get zero level with warnings. AR/D1R/D2R 0–31; RR/D1L/MUL 0–15; TL 0–127; KS/DT2 0–3; DT1 0–7. Duplicate/missing/unknown sections, malformed/out-of-range fields and NUL reject with `RangeError` and a line number. Empty files reject. Limits are 262144 input bytes, 128 patches and 512 bytes per line. Byte input is decoded explicitly as Latin-1, not UTF-8 or Windows-1252; strings use UTF-8 byte counts for bounds. Names become `[a-zA-Z0-9_-]{1,64}`, falling back to `OPM`, with deterministic `_2`, `_3`, … suffixes and truncation.

### Conversion formulas

- **Routing:** CON 0–7 corresponds directly to OPM.js algorithms 0–7. File order M1/C1/M2/C2 is signal order, **not** register-slot order M1/M2/C1/C2. The manual's diagrams give: 0 M1→C1→M2→C2; 1 (M1+C1)→M2→C2; 2 C1→M2 then (M1+M2)→C2; 3 M1→C1 then (C1+M2)→C2; 4 two chains M1→C1 and M2→C2; 5 M1 modulates the other three; 6 M1→C1 plus independent M2/C2; 7 all carriers. Feedback stays on M1, with FL retained but the engine's musical strength curve.
- **Envelope:** the original bounded heuristic `T(rate) = min(10, 10 * 2 ** (-rate / 3))` seconds gives `a=T(AR)`, `d=T(D1R)`, `r=T(2*RR+1)`. Zero AR/D1R represents infinity and is clamped to ten seconds with a warning. RR's doubled-plus-one input-rate convention follows the manual; the times are not chip timings. Sustain is linear gain `10 ** (-3*D1L/20)`; D1L=15 uses −93 dB instead of −45 dB. The engine interpolates envelope levels in dB. D2R cannot be represented by ADSR: held-note second decay is omitted, D1L holds until release, and every nonzero D2R gets an operator-specific warning.
- **Level:** `level = 10 ** (-0.75*TL/20)` for both carriers and modulators. Operator output amplitude also drives phase modulation, so this preserves TL attenuation without carrier-only renormalization. `modIndex=4` retains the default four-radian modulation scale, not a hardware transfer curve.
- **Pitch/scaling:** MUL 0→ratio 0.5; 1–15→their integer ratios. DT1 becomes fixed cents `[0,1,2,3,0,-1,-2,-3]`, a small symmetric approximation to the chip's key-dependent table. DT2 adds `[0,600,781,950]` cents (manual figure 2.7). Their sum stays within ±1200. KS maps linearly to `rateKeyScale=KS*4/3`: octave-based duration scaling around MIDI 60, not hardware grouped-key rates.
- **LFO:** fixed reference clock `f=3579545 Hz`; `rate = f/2**32 * 2**(LFRQ>>4) * (1+(LFRQ&15)/16)`, fitting manual figure 2.16, capped at 20 Hz with a warning. PM sensitivity maxima are `[0,5,10,20,50,100,400,700]` cents; `pmDepth=PMSmax*PMD/128`. AM sensitivity maxima are `[0,23.90625,47.8125,95.625]` dB; `amDepth=1-10**(-AMSmax*AMD/128/20)`. These endpoint-depth mappings approximate the engine's linear-gain/cents LFO, not the chip's attenuation/frequency transfer function. Per-operator AMS-EN becomes `amTargets`. WF 0/1/2 becomes saw/square/triangle; 3 (noise) substitutes deterministic sine with a warning. AM/PM waveform phase relationships and global phase differ from hardware; clock selection and free-running chip state are not retained.
- **Noise:** NE replaces C2 (op4) with `waveform:'noise'`; its approximate rate is `f/(32*(32-NFRQ))`, capped to 20–20000 Hz with a clamp warning. The manual prints a noise-divider equation but does not spell out raw zero encoding: this conversion conservatively assumes an inverted 32-step countdown and always warns about that approximation when NE is on. It does not reproduce a chip noise spectrum. OPM.js noise on any channel is an extension: the hardware channel-8 restriction, LFSR and special noise envelope are not reproduced.

`describeOPM` returns `{name,program,algorithm,operators,warnings}`. `operators` lists source labels in destination order. Warnings are deterministic, de-duplicated and bounded by the fixed four-operator conversion, including every approximation/substitution/clamp above. Program numbers are metadata only; wire imported names into a MIDI program map explicitly. Patches, not file programs, are de-duplicated by name.
