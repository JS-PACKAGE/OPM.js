# SECURITY.md — OPM.js Security Policy & Review Mechanism

OPM.js is a client-side audio synthesis engine. It has no network stack, no authentication, and zero runtime dependencies, but parses untrusted voice banks, DX7 SysEx, and PCM/WAV input and runs DSP in an AudioWorklet. This policy defines the security surfaces and required review.

For installation, browser deployment, and API examples, start with the [README](./README.md#getting-started) or the [English](./doc/usage.en.md) / [繁體中文](./doc/usage.zh-TW.md) usage guide.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |
| < 1.0 | ❌ |

## Reporting a vulnerability

Report privately to the repository owner (GitHub Security Advisories preferred). Do not open public issues for exploitable bugs. Acknowledgement target: 72 hours.

## Safe embedding

- Serve the complete, matching `dist/` module tree over HTTPS or localhost. Keep worklet and imported-module paths intact; retain `LICENSE` when redistributing.
- Use `loadVoice()` or `parseVoiceBank()` rather than bypassing validation. Single-voice APIs reject out-of-range fields; bank parsing clamps finite numeric fields but still rejects malformed data and invalid version/algorithm/feedback values.
- The engine has no download API. Usage examples import trusted bundled modules or read explicit local files. Bound untrusted sources, MIME types, and response/file size **before** buffering; JSON parsing's 256 KiB cap applies after download, and DX7 accepts only one 163-byte single or 4104-byte bank. Malformed framing, checksum, or non-seven-bit data rejects.
- Keep host-page security controls intact. For a CSP that disallows inline scripts, move the examples' module code to an allowed external `.js` file; no `unsafe-eval` is needed.

- Monitor `onEvent` for admission rejection, note terminal states, and processor errors; a returned note ID is not acceptance. Handle rejected diagnostics promises. Do not bypass validation or install a fallback engine to hide processor failure.
- Shared AudioContexts are borrowed: OPM disconnects its own node but never closes/suspends the context. Embedders own downstream routing, permissions, and context disposal. Use `destination:null` for explicit routing.
- WAV encoding accepts only own-data `left`, optional `right`, and `sampleRate` fields, with finite Float32 samples in −1–1, equal stereo lengths, and at most 4,000,000 frames. Project render results onto these fields rather than passing additional metadata.
## Threat model

| Surface | Risk | Notes |
| --- | --- | --- |
| Voice bank JSON (external/user-supplied) | **High** | Prototype pollution, path traversal on load, resource exhaustion |
| AudioWorklet message protocol | **High** | Malformed messages from compromised main thread or XSS'd page |
| DX7 SysEx and WAV buffers | Medium | Bounded binary input/output, framing/checksum validation, finite sample checks; no native decoder |
| DSP core (hot loop) | Medium | NaN/Infinity propagation, unbounded CPU (DoS) |
| Public API (playNote etc.) | Medium | Argument validation, scheduling abuse (millions of notes) |
| Supply chain | Low (by design) | Zero runtime dependencies — keep it that way |
| Output audio | Low | Clipping/headroom is a quality issue; sample dumps could leak nothing |

## Security review mechanism

### 1. Review triggers (mandatory)

A security review is required before:

- [ ] Any release tag (`vX.Y.Z`)
- [ ] Merging a PR that touches: `src/worklet/`, `src/core/`, or voice parsing (`src/voices/`, `src/api/` loaders)
- [ ] Adding any dependency, build plugin, or CI action
- [ ] Supporting a new voice-bank source (file import, URL, user paste)

### 2. Review checklist

**A. Untrusted data (voice banks, config)**
- [ ] Voice JSON/key scaling, DX7 binary input, and WAV arguments validate type, shape, length, numeric bounds, and own-data properties before use
- [ ] Explicit allowlisted copying; no spreading/merging untrusted objects into prototypes; no accessor invocation
- [ ] Numeric bounds cover modulation, level, ratio, detune, ADSR, LFO, velocity/pan, and key scaling; legacy v1 does not accept new v2 fields
- [ ] Application file/URL loaders bound sources, content type, and payload before buffering; engine does not fetch URLs
- [ ] DX7 rejects invalid length/framing/checksum/seven-bit payload; conversion descriptions remain outside strict voice schema

**B. Worklet boundary**
- [ ] Every raw message is checked for strict own-data shape before reads, enqueueing, or rendering
- [ ] No eval/Function execution or nonliteral dynamic imports in source/generated JS; literal worklet module URLs remain local
- [ ] Duplicate IDs reject before enqueueing; tracked IDs/events remain bounded; ended/stolen/error notes remove obsolete off events
- [ ] Held-note cancellation/release, exactly-once logical terminal events, diagnostics, and processor failure propagate safely

**C. DSP loop safety**
- [ ] Output is finite: any NaN/Infinity in the render loop snaps to silence and increments an error counter (`Synth.errorCount` or `renderNote()`'s `diagnostics.errors`)
- [ ] Fixed work ceiling: at most eight logical voices and eight bounded short stealing fades; oldest logical note stealing
- [ ] Determinism and chunk-independent output preserved; live/offline LFO, timing, filtering, stereo, velocity, and saturation parity
- [ ] Deadline statistics exclude warmup and expose p95/p99/worst/misses without universal performance promises; spectral acceptance is controlled, not arbitrary FM alias-free proof

**D. Supply chain**
- [ ] Zero runtime dependencies still holds (`npm ls --omit=dev` is empty)
- [ ] Dev dependencies and CI actions pinned to exact versions/commit SHAs
- [ ] `package.json` `files` whitelist ships only intended `dist/` assets, usage docs, and legal/project files

### 3. Verification gates

Run development commands from a source checkout after `npm ci`; installed npm packages do not contain the development tooling.

- `npm run build` then `npm test` — source/distribution behavior, malformed-input, deterministic rendering, and spectral regression coverage
- `npm run typecheck` — strict source, development tools/tests/demos, and NodeNext consumer against generated public declarations
- `npm run security -- --package-smoke` — TypeScript compiler AST gate over source and Acorn gate over generated JS, exact development pins, zero runtime dependencies, isolated installed exports/type smoke
- `npm audit` and `npm audit --omit=dev` — record actual tooling/runtime audit results; runtime dependency tree must be empty
- `npx --no-install playwright install --with-deps chromium` then `npm run browser-smoke -- chromium` — real AudioWorklet smoke; Firefox/WebKit alternatives are configured separately
- Headless Linux Firefox requires a running native audio server. CI starts PulseAudio and a null sink before real worklet smoke; it does not mock audio or relax browser permission/autoplay controls. Consult the usage guides for setup and stage diagnostics.
- `npm run benchmark` — host-dependent 128-frame render deadlines, with optional explicit budget environment variables

### 4. Review record

Each release notes in the CHANGELOG which checklist sections were exercised (A/B/C/D) and by whom. Checklist failures block release; waivers require a written reason in the CHANGELOG.

For v1.2, final A/B/C/D independent review and observed integration verification are recorded in CHANGELOG before release. Configured Node 22/24/26 and Chromium/Firefox/WebKit CI jobs are capabilities, not evidence of an external run. Missing browser binaries/host support or unrun CI must be reported, not represented as passing coverage.

## Non-goals

- Sandboxing the host page (OPM.js runs in the page's trust domain; XSS protection is the embedder's job)
- DRM / copy protection of voice banks
- Remote code loading of any kind — never supported
