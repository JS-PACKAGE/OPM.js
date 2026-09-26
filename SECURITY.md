# SECURITY.md — OPM.js Security Policy & Review Mechanism

OPM.js is a client-side audio synthesis engine. It has no network stack, no authentication, and zero runtime dependencies — but it does parse untrusted data (voice banks) and runs DSP code in a hot loop inside an AudioWorklet. This document defines what "security-relevant" means here and how it is reviewed.

## Supported versions

| Version | Supported |
| --- | --- |
| main (pre-1.0) | ✅ |
| < 1.0 forks | ❌ |

## Reporting a vulnerability

Report privately to the repository owner (GitHub Security Advisories preferred). Do not open public issues for exploitable bugs. Acknowledgement target: 72 hours.

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
- [ ] Merging a PR that touches: `src/worklet/`, `src/core/`, voice parsing (`src/api/` loaders)
- [ ] Adding any dependency, build plugin, or CI action
- [ ] Supporting a new voice-bank source (file import, URL, user paste)

### 2. Review checklist

**A. Untrusted data (voice banks, config)**
- [ ] All parsed JSON is validated against the voice schema before use (types, numeric ranges, array lengths)
- [ ] `Object.create(null)` or explicit allowlist keys when walking voice objects — never spread/merge untrusted objects into prototypes
- [ ] Numeric clamps: `modIndex`, `level`, `ratio`, `detune`, envelope times bounded (prevents CPU explosions and NaN)
- [ ] File/URL loaders reject: `..` paths, non-JSON content types, payloads over a fixed size cap

**B. Worklet boundary**
- [ ] Every `message` is shape-checked in `process()` (no direct property access on `event.data`)
- [ ] No `eval`, `new Function`, `import()` of dynamic strings anywhere in the codebase
- [ ] Worklet receives only plain data (no objects with prototypes, no functions)

**C. DSP loop safety**
- [ ] Output is finite: any NaN/Infinity in the render loop snaps to silence and increments an error counter (visible in debug builds)
- [ ] Per-voice CPU ceiling: hard cap on active voices (documented), oldest-note stealing
- [ ] Determinism preserved after changes (same inputs → same Float32Array)

**D. Supply chain**
- [ ] Zero runtime dependencies still holds (`npm ls --omit=dev` is empty)
- [ ] Dev dependencies and CI actions pinned to exact versions/commit SHAs
- [ ] `package.json` `files` whitelist ships only `src/`, `LICENSE`, `README.md`, `SECURITY.md`

### 3. Automated gates (CI)

- `node --test` — unit tests including malformed-voice fuzz cases
- `npm audit --omit=dev` (dev deps only; runtime must be empty)
- grep gate: fail CI if `eval(`, `new Function(`, or `import(` with non-literal appear in `src/`
- Determinism test: render the same fixture twice, byte-compare

### 4. Review record

Each release notes in the CHANGELOG which checklist sections were exercised (A/B/C/D) and by whom. Checklist failures block release; waivers require a written reason in the CHANGELOG.

## Non-goals

- Sandboxing the host page (OPM.js runs in the page's trust domain; XSS protection is the embedder's job)
- DRM / copy protection of voice banks
- Remote code loading of any kind — never supported
