# Voice v5 and expressive controls

Voice format version **5** is independent of the npm package version. `normalizeVoice` accepts an omitted version as v5; explicit v1–v4 retain their original field restrictions. Normalized, prepared, imported and bank voices emit v5. Canonical bank entries require `version`, `name`, `algorithm`, `feedback`, `modIndex`, `lfo`, and exactly four `ops`; the exported JSON schema describes that canonical shape.

Inputs must use plain objects and dense own-data operator arrays. Unknown fields, accessors, malformed enums, nonfinite numbers and unsupported versions are rejected without evaluating getters. `normalizeVoice` rejects out-of-range numbers; the bank-oriented `validateVoice`/`parseVoiceBank` clamp finite numeric values to the documented bounds. Integer selectors and MIDI breakpoints must still be integers. `prepareVoice` and bank validation return detached, deeply frozen snapshots, including the optional pitch envelope. A cloned prepared patch must be validated again; a copied shape does not confer trusted identity.

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

Explicit v1 rejects key scaling and velocity sensitivity; v2 adds key scaling; v3 adds velocity sensitivity; v4 adds LFO waveform. All explicit v1–v4 reject `frequency`, `rateKeyScale`, `pitchEnvelope`, and LFO `delay`/`sync`/`phase`, rather than silently dropping them.

### Pitch envelope

Optional `pitchEnvelope` requires all seven own-data fields:

```ts
pitchEnvelope: {
  a: 0.02, d: 0.15, r: 0.1,
  initial: -300, peak: 100, sustain: 0, final: -100
}
```

`a`, `d`, `r` are 0–10 seconds. `initial`, `peak`, `sustain`, `final` are −4800–4800 cents. Held notes move linearly in cents **initial → peak → sustain**. A zero attack skips directly to peak; a zero decay skips directly to sustain. Release moves from the **current** cents value to final, even during attack/decay; zero release immediately selects final. Final pitch persists while operator releases remain audible. The pitch envelope does not prolong otherwise silent operators or filter tails.

Pitch cents combine multiplicatively with original operator Hz, detune, live semitone pitch/glide and LFO PM. Pitch-envelope and glide evaluation use deterministic 4× synthesis substeps; splitting `render` into different buffer sizes does not change the timeline. Operator phase increments are limited to 45% of the internal sample rate before/after LFO PM, preserving the engine's existing high-frequency safety cap.

### LFO

`lfo` requires `rate` (0–20 Hz), `amDepth` (0–1) and `pmDepth` (0–1200 cents); single-input omission disables modulation. `waveform` defaults to `sine`, with `triangle`, rising `saw`, and `square` also supported.

- `delay`: optional 0–10 seconds, default zero. Gates both AM and PM depth until that note's elapsed time reaches delay; the phase clock **continues** during delay. This is a depth gate, not a gradual fade-in.
- `sync`: `note` (default) resets the clock at note admission. `global` uses `Synth.currentFrame`, including rendered silence, so separately admitted notes share a deterministic frame clock. Neither uses wall time. Panic does not rewind the global clock.
- `phase`: optional 0–1 turns, default zero; 1 wraps to 0. At rate zero this can produce static AM/PM offset.

LFO values are evaluated once per output frame. Sine and triangle start at zero rising, saw at −1, square at +1. AM multiplies gain by `1 - amDepth * (0.5 + 0.5 * waveformValue)`; PM multiplies pitch by `2 ** (pmDepth * waveformValue / 1200)`.

## Live operator levels

`Synth.updateNote`, host `updateNote`, scheduled controls, and sequence automation accept:

```ts
{ operatorLevels: [1, 0.4, 1.5, 0], ramp: 0.1 }
```

The readonly tuple must contain exactly four finite own-data numbers in **0–2**. Each number multiplies its patch operator level after key/velocity scaling and before FM routing/feedback. All default to 1. A multiplier cannot revive a patch operator whose level is zero. Modulator levels change timbre; carrier levels change that carrier's contribution. Final expression/velocity and equal-power pan remain separate controls.

`ramp` is 0–10 seconds, default zero, and now also permits operator-level targets. The four multipliers ramp linearly and independently from their current values using the same supplied duration. An interrupted ramp starts from its current value, not the old target. Unrelated expression, pan, modulation or pitch updates do not cancel operator ramps. Validation detaches and freezes the tuple and its outer control record before scheduling. Recycled/stealing voice slots preserve current tails and fully reset controls for new admissions; render processing allocates no arrays or objects.

## DX7 import: retained data versus approximations

`importDX7` remains a lossy six-to-four-operator conversion, **not hardware emulation**. Source format and behavior were checked against the [Yamaha DX7 manual, printed pp. 13–17 and 30–31](https://data.yamaha.com/files/download/other_assets/9/333979/DX7E1.pdf) and the [DX7II packed VMEM layout, Add-11](https://data.yamaha.com/files/download/other_assets/7/320817/DX7IIE.PDF).

- Fixed frequency is retained in Hz as `10 ** ((coarse & 3) + fine / 100)`, rather than a MIDI-60 ratio. Detune remains approximate.
- Keyboard rate scaling maps source 0–7 to OPM 0–4. This is a continuous musical approximation, not Yamaha's grouped-key/rate transfer function.
- Pitch envelope retains L4 → L1 → L3 → L4. L2 is omitted; R2/R3 durations are merged and capped at ten seconds. Levels interpolate piecewise linearly through source 0/50/99 = −4800/0/+4800 cents. Rates use the existing `min(10, 10 * 2 ** (-rate / 10))` seconds heuristic, not measured hardware timing. A fully neutral pitch envelope is omitted.
- LFO delay maps source 0–99 to 0–10 seconds; sync on maps to note and sync off to deterministic global phase. Delay shaping and free-running/random hardware phase are not reproduced.
- Triangle, rising saw, square and sine retain their waveform family. Descending saw becomes rising saw; sample-and-hold becomes sine. Both substitutions are explicitly reported by `describeDX7`.

Operator selection, envelope/output response, topology, feedback placement, velocity and level scaling remain approximations. Oscillator phase carry, source transpose, positive keyboard scaling, per-operator AM and nonzero final amplitude-envelope levels are not preserved. `describeDX7` reports these losses separately from the strict usable voice shape.
