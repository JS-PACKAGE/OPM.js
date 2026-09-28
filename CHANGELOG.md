# Changelog

For installation and executable examples, see the [README](./README.md#getting-started) and the [English](./doc/usage.en.md) / [繁體中文](./doc/usage.zh-TW.md) usage guides.

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
