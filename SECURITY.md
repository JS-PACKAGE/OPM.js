# SECURITY.md — OPM.js Security Policy & Review Mechanism

OPM.js is a client-side audio synthesis engine. It has no network stack, no authentication, and zero runtime dependencies — but it does parse untrusted data (voice banks) and runs DSP code in a hot loop inside an AudioWorklet. This document defines what "security-relevant" means here and how it is reviewed.

For installation, browser deployment, and API examples, start with the [README](./README.md#getting-started) or the [English](./doc/usage.en.md) / [繁體中文](./doc/usage.zh-TW.md) usage guide.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |
| < 1.0 | ❌ |

## Reporting a vulnerability

Report privately to the repository owner (GitHub Security Advisories preferred). Do not open public issues for exploitable bugs. Acknowledgement target: 72 hours.

## Safe embedding

- Serve the complete, matching `dist/` module tree over HTTPS or localhost. Keep worklet and shared-chunk paths intact; retain `LICENSE` when redistributing.
- Use `loadVoice()` or `parseVoiceBank()` rather than bypassing validation. Single-voice APIs reject out-of-range fields; bank parsing clamps finite numeric fields but still rejects malformed data and invalid version/algorithm/feedback values.
- The engine has no download API. The usage-guide loader fetches a trusted bundled asset. If your application downloads untrusted banks, restrict sources, MIME types, and response size **before** reading the body; `parseVoiceBank()` enforces its 256 KiB JSON-string cap only after download.
- Keep host-page security controls intact. For a CSP that disallows inline scripts, move the examples' module code to an allowed external `.js` file; no `unsafe-eval` is needed.

## Threat model

| Surface | Risk | Notes |
| --- | --- | --- |
| Voice bank JSON (external/user-supplied) | **High** | Prototype pollution, path traversal on load, resource exhaustion |
| AudioWorklet message protocol | **High** | Malformed messages from compromised main thread or XSS'd page |
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
- [ ] All parsed JSON is validated against the voice schema before use (types, numeric ranges, array lengths)
- [ ] `Object.create(null)` or explicit allowlist keys when walking voice objects — never spread/merge untrusted objects into prototypes
- [ ] Numeric clamps: `modIndex`, `level`, `ratio`, `detune`, envelope times bounded (prevents CPU explosions and NaN)
- [ ] File/URL loaders reject: `..` paths, non-JSON content types, payloads over a fixed size cap

**B. Worklet boundary**
- [ ] Every `message` is shape-checked in `receive()` before payload reads, enqueueing, or rendering
- [ ] No `eval`, `new Function`, `import()` of dynamic strings anywhere in the codebase
- [ ] Worklet receives only plain data (no objects with prototypes, no functions)

**C. DSP loop safety**
- [ ] Output is finite: any NaN/Infinity in the render loop snaps to silence and increments an error counter (`Synth.errorCount` or `renderNote()`'s `diagnostics.errors`)
- [ ] Per-voice CPU ceiling: hard cap on active voices (documented), oldest-note stealing
- [ ] Determinism preserved after changes (same inputs → same Float32Array)

**D. Supply chain**
- [ ] Zero runtime dependencies still holds (`npm ls --omit=dev` is empty)
- [ ] Dev dependencies and CI actions pinned to exact versions/commit SHAs
- [ ] `package.json` `files` whitelist ships only intended `dist/` assets, usage docs, and legal/project files

### 3. Verification gates

Run development commands from a source checkout after `npm ci`; installed npm packages do not contain the development tooling.

- `node --test` — unit tests including malformed-voice fuzz cases
- `npm audit` and `npm audit --omit=dev` — audit development tooling; runtime dependencies must remain empty
- grep gate: fail CI if `eval(`, `new Function(`, or `import(` with non-literal appear in `src/`
- Determinism test: render the same fixture twice, byte-compare

### 4. Review record

Each release notes in the CHANGELOG which checklist sections were exercised (A/B/C/D) and by whom. Checklist failures block release; waivers require a written reason in the CHANGELOG.

## Non-goals

- Sandboxing the host page (OPM.js runs in the page's trust domain; XSS protection is the embedder's job)
- DRM / copy protection of voice banks
- Remote code loading of any kind — never supported
