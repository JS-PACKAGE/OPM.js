# Changelog

For installation and executable examples, see the [README](./README.md#getting-started) and the [English](./doc/usage.en.md) / [繁體中文](./doc/usage.zh-TW.md) usage guides.

## Unreleased

### CI failure repairs

- Inspect [the first quality run](https://github.com/YueyuHoshizora/OPM.js/actions/runs/36922999106): Node 18/22 passed functional gates but exceeded the unchanged 2.667 ms burst p99 budget (3.205/3.019 ms); Firefox timed out without stage diagnostics.
- Reduce attack/decay/release envelope exponentiation within each 4x output frame. Re-anchor analytic gain every frame and retain direct evaluation at stage boundaries; validation, eight-voice/eight-fade bounds, workload, and deadline budget remain unchanged. Double-precision rounding can differ from the previous implementation; no universal byte-identity promise.
- Provide Linux Firefox CI with a running native PulseAudio server and null output sink. Keep real AudioContext/AudioWorklet processing and trusted clicks; add stage, audio-clock/context, and request/error diagnostics rather than autoplay overrides or fake audio.
- Verification: Node 18.20.8 and 22.23.3 each passed 74 tests, including analytic envelope boundaries and very short stages. Build, public types, AST/security and installed-package ESM/type smoke passed. On Apple M5, the unchanged 300-warmup/2,000-block benchmark passed every p99 gate; burst p99 was 1.499/1.478 ms with zero missed deadlines in those runs. These measurements do not prove the GitHub x64 hosts' performance.
- Audio comparison covered 387 cases and 2,045,248 channel samples, including burst steals at 8–192 kHz: observed Float32 output matched the previous implementation exactly; source/distribution parity also passed the same cases.
- Locked Playwright 1.56.1 / Firefox 142.0.1 passed real stereo, held/released notes, routing, suspend/resume, diagnostics and context ownership smoke against built assets on Linux arm64 with PulseAudio. The local host was Ubuntu 26.04 using Playwright's Ubuntu 24.04 arm64 binary override, not the GitHub Ubuntu 24.04 x64 runner. Chromium 153 and WebKit 26.6 smoke also passed on macOS using the existing matching Playwright 1.63.0 launcher. The repaired external CI run has not yet been observed.
- **Security:** independent source reviewer **CiRepairSecurity** approved scoped A/B/C/D checks with no blockers: finite/bounded frame-local envelope computation, unchanged trust boundaries, and native CI audio setup. 語喵 executed the integration checks above; the reviewer did not execute runtime gates.

## v1.2.0

### Readiness and additive features

- Add borrowed AudioContext ownership, resumable/coalesced initialization, serialized disposal, explicit output routing, held notes, velocity, and stereo pan.
- Surface worklet note admission/lifecycle/rejection events, diagnostics, and processor errors. Bound tracked IDs/events, reject duplicates before enqueueing, and remove stale off events when notes terminate.
- Preserve eight logical voices with bounded short steal fades and exactly-once terminal notifications. Unify offline rendering with the live Synth DSP path, including LFO, filtering, saturation, velocity, and pan.
- Introduce version 2 voices with optional per-operator key scaling; retain legacy version 1 input without new fields. Expand the bundled example bank.
- Add finite/bounded PCM16 mono/stereo WAV encoding and clean-room approximate six-to-four-operator DX7 SysEx import, with separate conversion descriptions/warnings.
- Ship TypeScript declarations through conditional package exports and copy their dependent declarations intact during builds. Keep zero runtime dependencies.
- Add development-only AST security/package gates, an installed-package type consumer, configurable 128-frame deadline statistics, spectral regression coverage, and configured Node/browser CI. Browser tooling is development-only; no fallback hides missing AudioWorklet support.
- Update English and Traditional Chinese runnable installation, lifecycle, routing, rendering, import/export, and quality instructions; extend the browser demo with key scaling, DX7 preview, and WAV download.

### Verification and release gate

- Integration verification passed 73 tests, the distribution build, strict public-API TypeScript checks, source/built AST security gates, isolated tarball installation exercising ESM and TypeScript consumers, and full/runtime-only npm audits with zero vulnerabilities.
- Source and minified distribution produced byte-identical stereo PCM and WAV bytes across 189 offline cases (7,944,138 stereo samples), plus 40 live stealing/render blocks.
- Real Chromium, Firefox, and WebKit AudioWorklet smoke scenarios passed signal/stereo, routing, held-note lifecycle, suspend/resume, diagnostics, and context ownership checks. Local browser downloads for pinned Playwright 1.56.1 did not complete; the unchanged scenarios used an already cached matching Playwright 1.63.0 browser launcher. The pinned CI browser installation and external Node 18/22/24 CI jobs remain configured, not observed runs.
- The actual demos produced finite audio for key scaling and the expanded presets, previewed an independently generated DX7 fixture, downloaded and decoded a stereo WAV (48 kHz, 39,384 frames), and reported no page errors or rejected notes. Root-demo stop behavior was reproduced and fixed.
- On Apple M5 / Node 26.7.0, the isolated 48 kHz / 128-frame benchmark passed its p99 deadline budget after 300 warm-up and 2,000 measured blocks per scenario. Burst p99 was 1.347 ms; worst was 3.703 ms with 5 missed 2.667 ms deadlines. A concurrent large offline-render workload exceeded the p99 budget (2.789 ms, 23 misses). These host/load-specific measurements are not a hard real-time guarantee.

### Security review

語喵 coordinated integration verification. Independent source reviewer **FinalSecurity** approved A/B/C/D after remediation, with no remaining blockers; **FinalConsumerReview** approved the consumer/lifecycle/DSP review after the reentrant voice-admission fix. Reviewers did not independently execute the runtime gates above; no release tag, publication, or external CI run is claimed.

- **A — Untrusted data:** approved own-data voice/key-scaling validation, bounded bank/DX7 parsing, framing/checksum/seven-bit checks, and WAV limits. Remediated forged typed-array metadata and inherited WAV-field reads using native kind/length intrinsics and own descriptors; samples are captured, validated, and encoded once. Boundary regressions passed.
- **B — Worklet boundary:** approved malformed-message handling, pre-enqueue duplicate/capacity checks, held-note cancellation, lifecycle ID cleanup, diagnostics, and processor-error propagation. Late or repeated note-off is an idempotent no-op, avoiding false rejection after completion/stealing.
- **C — DSP safety:** approved eight logical voices/eight bounded fading remnants, terminal callbacks, finite output, LFO/offline parity, stereo gain, key scaling, and deterministic rendering. Admit replacements before notifying stolen callbacks so reentrant admission cannot exceed the voice limit; regression and spectral tests passed. Deadline limitations are recorded above.
- **D — Supply chain:** approved zero runtime dependencies, exact esbuild/Terser/Acorn/Playwright/TypeScript development pins and lockfile, pinned CI actions, package whitelist, and installed ESM/type exports. Generated-code/package gates and both npm audits passed.

## v1.1.0

Release gate: 語喵 coordinated independent security reviewers ReleaseBoundary (A/B) and ReleaseDsp (C/D), both approving their assigned source/security slices with no blockers. Fresh verification passed all 37 tests, full and runtime-only npm audits (zero vulnerabilities), an empty runtime dependency tree, the distribution build, and an isolated v1.1.0 tarball installation exercising public exports, finite stereo PCM, note release, mono rendering, and bank parsing. The browser and differential-audio evidence below was obtained during the preceding optimization/documentation work; runtime code is unchanged since those checks.

### Usage documentation

- Expand README and both usage guides with checkout demos, local-tarball installation without assuming registry publication, complete static browser deployment, and standalone Node.js PCM examples.
- Clarify lifecycle, scheduling and release, custom voices, bank loading, validation bounds, compressed delivery, and troubleshooting. Distinguish strict single-voice normalization from bank clamping, and document that `renderNote()` does not apply LFO.
- Add safe-embedding guidance and usage links in the security/contributor documents. Correct the contributor API diagram and explain rebuilding `dist/` before checking source changes in the demos.

Documentation verification: built and packed an isolated checkout, installed its tarball in a clean application, and executed five Node.js snippets and all three JSON voice examples. Chromium exercised seven extracted HTML examples with real AudioWorklet signal, including custom-voice early release and bundled-bank loading, with no observed browser/worklet errors. Runtime implementation is unchanged.

### Optimization and compact distribution

- Cache real-time sustain gains, routing, subsample offsets, and per-frame pitch steps; replace bounded phase modulo with subtraction and fill idle blocks directly.
- Prepare offline envelopes once per operator, retaining dB-domain curves and floating-point operation order. Move voice normalization out of the DSP module so the browser facade no longer imports the synthesis implementation.
- Batch worklet event consumption and compact cancelled events in place, preserving same-frame ordering and the 256-event ceiling. Add an audio regression covering partial consumption, cancellation, and queue refill.
- Add ready-to-use minified ESM and JSON in `dist/`, with shared chunks, gzip level 9, and Brotli quality 11 alternatives. Preserve public exports and property names; retain readable sources. npm exports and both demos now use `dist/`.
- Add pinned development-only build tools and a repeatable benchmark. The npm whitelist excludes precompressed alternatives, development tooling, tests, and source files to avoid redundant package payloads.

### Measurements and verification

Local Node.js v26.7.0 measurements using the `scripts/benchmark.js` workload, three warmups and nine timed runs. Real-time cases render 0.5 seconds at 48 kHz in 128-frame blocks; the offline case includes release and filter tail. Times are machine-dependent.

| Scenario | Original median | Optimized minified median |
| --- | ---: | ---: |
| Eight voices with LFO | 84.869 ms | 70.874 ms |
| Offline note with release | 27.857 ms | 16.774 ms |

Original runtime JS/JSON totaled 33,741 bytes. Minified assets total 20,319 bytes; the sums of separately compressed gzip/Brotli variants are 9,014/7,987 bytes. These are asset totals, not npm tarball sizes.

Verification: 37 tests passed against source and the same 37 against minified modules; differential smoke covered 288 scenarios and 1,505,688 samples for each implementation against the original, with byte-identical audio and chunk-independent output. All compressed assets decoded byte-for-byte. Chromium exercised both demo controls and actual AudioWorklet output, including audible signal, finite samples, release to silence, and clean shutdown. An isolated npm-tarball consumer exercised public browser/offline/voice-bank imports without development dependencies.

### Security review

Reviewed by 語喵 (AI assistant), with independent security and numerical reviewers, using [SECURITY.md](./SECURITY.md) A–D. No changed-code blockers were found.

- **A — Untrusted data:** normalization extraction retains prototype and own-data checks, explicit copying, numeric bounds, and rejection of accessors; voice-bank limits remain unchanged.
- **B — Worklet boundary:** shape checks precede payload reads; queue ordering, cancellation, and capacity remain bounded. Source and generated JS scans found no dynamic execution sinks.
- **C — DSP safety:** eight-voice ceiling, finite-output safeguards, four-operator/4× processing, headroom, and filter tails remain intact; source/minified differential and malformed-input checks passed.
- **D — Supply chain:** runtime dependency tree is empty. esbuild 0.28.2 and Terser 5.51.2 are exact development pins with a lockfile; full and runtime-only npm audits reported zero vulnerabilities. The packed whitelist contains 19 intended assets/docs/legal/metadata entries. Minification disables unsafe math, pure-getter assumptions, and property mangling.

## v1.0.0

First stable release of the documented browser and offline-rendering APIs.

- Four-operator FM synthesis with eight algorithms, feedback, ADSR, LFO, detune, and eight-voice polyphony.
- Browser AudioWorklet API, offline rendering, versioned JSON voice format, and English/Traditional Chinese usage guides.
- Browser test page with a complete *Twinkle, Twinkle, Little Star* melody.

### Security review

Reviewed by 語喵 (AI assistant) for this release, using the A–D checklist in [SECURITY.md](./SECURITY.md):

- **A — Untrusted data:** voice objects use explicit data-field allowlists and bounded numeric values; JSON voice banks are capped at 256 KiB and 128 voices. File/URL voice-bank loaders are not provided, so path traversal and content-type checks do not apply.
- **B — Worklet boundary:** messages are shape-checked, invalid data is ignored, and pending events are capped. Source scan found no dynamic `eval`, `new Function`, or `import()` calls.
- **C — DSP safety:** eight active voices maximum; non-finite output is silenced and counted. The deterministic rendering and malformed-input tests passed.
- **D — Supply chain:** zero runtime dependencies; no dev dependencies or CI actions; `npm audit --omit=dev` reported zero vulnerabilities. The package dry run contains only the intended `src/`, usage docs, changelog, README, license, security policy, and package metadata.

Verification: `node --test` (36 passing), `npm ls --omit=dev --depth=0` (empty), `npm audit --omit=dev` (zero vulnerabilities), and `npm pack --dry-run --json` (18 intended entries).
