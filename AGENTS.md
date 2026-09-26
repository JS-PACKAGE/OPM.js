# AGENTS.md — OPM.js

Instructions for AI coding agents working in this repository. Read this before touching code.

## Project

OPM.js is a **4-operator FM synthesis engine for the browser**, inspired by the Yamaha YM2151 (OPM) sound chip. It is a pure JavaScript synthesis engine powered by the Web Audio API, designed to be embedded in games and creative web apps.

- **Status:** initial usable implementation. Public API (`playNote()`, voice format) may change before 1.0. Update the README when it does.
- **License:** Apache-2.0. All contributions must be Apache-2.0 compatible. Never add GPL/AGPL code.

## Non-negotiables

1. **Zero runtime dependencies.** Everything ships as plain ES modules built on the Web Audio API. No build-toolchain requirement for consumers.
2. **Musically accurate, not cycle-accurate.** OPM.js is a from-scratch reimplementation tuned to sound correct. Do not claim hardware-clone fidelity in docs or code comments.
3. **Not a chip emulator.** Register-level YM2151 emulation and VGM playback are explicitly out of scope. Do not add them.
4. **No Yamaha affiliation.** Keep the disclaimer in README. Never use "Yamaha" or "YM2151" in package/branding claims beyond "inspired by".
5. **Clean-room discipline.** Do not copy code from other chip emulators (ym2612-js, js2151, Nuked-OPM, ymfm, Genesis Plus GX). Architecture concepts may be referenced; source may not.
6. **Browser + Node.js.** The DSP core must be environment-agnostic (pure functions over Float32Array); Web Audio glue is a separate layer.
7. **Security review is mandatory** for releases and any change to `src/core/`, `src/worklet/`, or voice parsing. Follow the mechanism in [SECURITY.md](./SECURITY.md).

## Architecture

```
main thread                          AudioWorklet thread
─────────────                        ───────────────────
OPM (public API)                     processor
  playNote() / stop() / setLFO() ──►   voice allocation
  voice bank (JSON)                    operator graph (4-op, 8 algorithms, feedback)
                                       ADSR envelopes (dB domain)
                                       LFO (AM / PM) → stereo out
```

- `src/core/` — DSP core: operator, envelope, LFO, algorithm graph. **Pure, no Web Audio imports.**
- `src/worklet/` — AudioWorkletProcessor and message protocol.
- `src/api/` — public facade (`OPM` class), voice loading, scheduling.
- `src/voices/` — voice bank JSON (format below).

## Voice format

A voice is JSON: 4 operators × (ratio, level, detune, ADSR) + algorithm + feedback + LFO. See README "Voice format" for the canonical example. When changing the format, bump `version` and update README.

## DSP correctness rules

- **Envelopes are exponential in the dB domain**, not linear. Linear envelopes sound wrong.
- **Headroom:** FM modulation index can explode; scale output to avoid digital clipping (leave ≥3 dB headroom per voice).
- **Anti-aliasing:** FM generates ultrasonic partials. Apply a per-voice low-pass or oversampling where the algorithm creates high-ratio modulation.
- **Determinism:** given the same voice, notes, and sample rate, the core must produce identical output (needed for offline rendering and tests).
- Sample-rate independent: all timing in seconds, converted to samples at the boundary.

## Development workflow

- No build step required. `node --test` for unit tests; browser smoke test via a minimal `demo/index.html`.
- Test the core offline in Node.js (render Float32Array, assert envelope shape / silence / no NaN).
- Before claiming a milestone in `README.md` Roadmap is done, it must have: a test, a demo sound, and a README mention.
- Keep commits focused; document non-obvious DSP math in comments with the formula.

## Documentation rules

- README is the source of truth for public API. Keep code samples runnable.
- Tone: technical, concise, English. The Yamaha disclaimer must remain in README.
- Roadmap checkboxes are updated only when the milestone criteria above are met.

## Out of scope (do not implement)

- VGM / register-level chip emulation
- Audio file playback (OPM.js synthesizes; it is not a music player)
- MIDI drivers (a WebMIDI adapter may come later, but not in the engine)
- Any UI beyond `demo/` helpers
