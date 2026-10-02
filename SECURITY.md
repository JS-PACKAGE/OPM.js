# SECURITY.md — OPM.js Security Policy & Review Mechanism

OPM.js is a client-side, four-operator FM synthesis library. It processes voice definitions, DX7 SysEx and PCM buffers, and runs real-time DSP in an AudioWorklet. It has no application server or authentication system and has zero runtime dependencies. The host application remains responsible for website security, untrusted downloads, resource budgets and safe audio presentation.

For installation, browser deployment, and API examples, start with the [README](./README.md#getting-started) or the [English](./doc/usage.en.md) / [Traditional Chinese](./doc/usage.zh-TW.md) usage guide.

**Contents:** [Supported versions](#supported-versions) · [Reporting a vulnerability](#reporting-a-vulnerability) · [Safe embedding](#safe-embedding) · [Threat model](#threat-model) · [Security review mechanism](#security-review-mechanism) · [Non-goals](#non-goals)

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Supported security line; use the latest available patch |
| < 1.0 | Not supported |

The current checkout requires **Node.js 22 or newer** for Node usage and development. Browser applications require ES modules, AudioWorklet and a secure context (HTTPS or localhost). The Node requirement does not provide a browser sandbox or replace browser updates.

Use a complete distribution from a known checkout or package, not individual modules from unrelated builds. Check [CHANGELOG](./CHANGELOG.md) for observed verification; an advertised feature or configured CI job is not proof that every runtime or platform has passed.

## Reporting a vulnerability

Report exploitable problems privately to the repository maintainer. Use the [GitHub private vulnerability reporting form](https://github.com/YueyuHoshizora/OPM.js/security/advisories/new) when it is enabled. If a private reporting route is unavailable, request a private contact method without publishing exploit details, sensitive files or a proof of concept.

Include enough information to reproduce the issue safely:

- The affected OPM.js version or commit, and whether the behavior uses `src/`, committed `dist/`, or an installed package.
- Node/browser version, operating system, sample rate and relevant deployment or routing configuration.
- A minimal input and sequence of API calls or worklet messages, including expected and observed behavior.
- The apparent impact: code execution, validation bypass, excessive CPU/memory use, processor failure, unexpected audio, or data exposure.
- Relevant errors, diagnostics and whether the issue reproduces with a freshly built, matching distribution.
- Any proposed fix or mitigation, and whether the report may be credited publicly.

Do not include credentials, private voice banks, personal recordings or unrelated user data. Use a synthetic input when possible. Minimize denial-of-service examples; do not test against other people's websites or production audio sessions.

The acknowledgement target is **72 hours**, on a best-effort basis, not a guaranteed response or remediation deadline. Coordinate public disclosure with the maintainer so affected users can receive an actionable fix or mitigation. Ordinary usage questions may use public issues; exploitable details should remain private.

## Safe embedding

### Website deployment and browser permissions

- Serve the complete, matching `dist/` tree over HTTPS or localhost, preserving worklet and imported-module paths. Do not load examples through `file://`, and retain `LICENSE` when redistributing.
- The root `index.html`, `examples/` pages, `favicon.ico` and this policy are public website assets. If publishing the linked guides, include `README.md` and `doc/` as well.
- The Python development server is for local checks, not a hardened public host. A production server should not expose `.git/`, `.dev/`, `node_modules/`, development tooling, credentials or directory listings.
- Serve JavaScript with a JavaScript MIME type. Use `X-Content-Type-Options: nosniff`; do not return an application's HTML fallback for a missing worklet/module URL.
- Apply a host-specific Content Security Policy that allows only reviewed module origins, restricts framing and base URLs, and disables unnecessary object embedding. Check the script and worklet/worker directives applicable to each supported browser.
- The checkout examples use external module scripts and a local stylesheet. They need no `unsafe-eval`. Do not weaken CSP, TLS or browser permission/autoplay controls to suppress a deployment error.
- WAV Blob URLs are data downloads, not executable modules. Do not broaden script origins simply because downloads use `blob:` URLs.
- Only enable browser features that the host needs. Synthesis does not require microphone, camera or location access. Test playback, worklet loading and download behavior after changing hosting headers.

### Voice banks and JavaScript objects

Use `loadVoice()`, `normalizeVoice()`, `validateVoice()` or `parseVoiceBank()` at the appropriate documented boundary; do not send unchecked definitions straight into the DSP or raw worklet protocol.

| Input | Boundary |
| --- | --- |
| Single-voice API | Required fields and exactly four complete operators; finite numeric values and documented ranges; unknown fields and accessors reject |
| Voice-bank JSON string | At most 262,144 UTF-8 bytes (256 KiB), then JSON parsing and bank validation |
| Voice-bank array | 1–128 complete versioned voices, unique validated names, and frozen normalized copies |
| Legacy version 1 | Accepted only within its documented schema; version 2 key-scaling fields are not accepted as legacy extensions |

Single-voice APIs reject out-of-range fields. Bank validation clamps finite numeric fields to documented bounds, but still rejects malformed types, non-finite numbers and invalid version/algorithm/feedback values. Clamping is not a substitute for validation.

Keep allowlisted, own-data copying at trust boundaries. Do not merge untrusted objects into prototypes, invoke getters to inspect them, or treat a valid voice name as authorization to construct a URL or filesystem path. Engine bank parsing does not load paths or fetch voice URLs.

### External downloads and file uploads

The engine does not provide a voice-download API. Host loaders must validate the source and enforce an input budget **before** buffering or parsing. Engine checks cannot recover memory already consumed by an oversized download.

- Check HTTP status and permitted origins before accepting a response; do not derive destinations from an untrusted voice name.
- Treat declared MIME type, file extension and `Content-Length` as hints, not evidence that the payload is valid or bounded. Chunked and decoded/compressed responses still need a real byte budget.
- Bound streamed response bytes and cancel an oversized transfer before assembling the complete buffer. Set host-appropriate cancellation and time limits.
- Check a local file's size before `arrayBuffer()` or text decoding, then validate its actual contents. A picker selection is not a trust guarantee.
- Do not insert filenames, imported descriptions or error messages into HTML. The examples display them as text; retain that separation in host UIs.
- Apply application-level limits to repeated uploads, repeated parsing and simultaneous synth instances. A per-call limit is not a whole-page resource quota.

### DX7 SysEx conversion

`importDX7()` and `describeDX7()` accept one `Uint8Array` containing a standard **163-byte single-voice** or **4104-byte 32-voice bank** message. Length, framing, checksum and seven-bit payload checks reject malformed input. The playground checks the maximum file size before buffering.

This is approximate six-to-four-operator voice conversion, not a DX7 emulator or an arbitrary SysEx interpreter. Conversion does not execute the payload. Review the returned descriptions and warnings before auditioning a patch; keep descriptions outside the strict voice schema.

### PCM, offline rendering and WAV export

`encodeWav()` encodes provided PCM; it does not decode or play an uploaded audio file. It accepts only own-data `left`, optional `right` and `sampleRate` fields. Samples must be finite `Float32Array` values in −1–1; stereo lengths must match, with at most **4,000,000 frames per channel**.

Project render results onto those fields rather than forwarding diagnostics or other metadata. Reject encoding/rendering errors visibly instead of substituting a fake result.

Offline rendering allocates output buffers and executes synchronously. The host should limit duration, sample rate, envelope tails, concurrent requests and export frequency to suit its device and UI. Valid input may still consume significant time and memory; no universal deadline or whole-page memory guarantee is made.

Create download URLs only for successfully encoded bytes. Replace/revoke obsolete Blob URLs and release them when the owning page or component is disposed. Treat filenames and rendered audio as potentially private application data.

### AudioWorklet, scheduling and context ownership

- Await `start()` in a user interaction and monitor `onEvent`. A returned note ID is not admission; handle rejections, terminal note states and processor errors.
- The worklet bounds pending events and tracked note IDs to 256 each. Schedule bounded batches rather than flooding the port with distant-future events.
- Each synth limits logical voices to eight, with up to eight bounded stealing fades. These limits do not constrain an attacker creating many synth instances or abusing unrelated host code.
- Handle rejected diagnostics promises and failed node initialization. Do not hide failure behind mock audio nodes or a fallback engine.
- A shared AudioContext is borrowed: OPM disconnects its own node but never closes or suspends the host context. The host owns downstream routing, permissions and disposal. Use `destination: null` for explicit routing.
- Provide obvious play/stop controls and begin at a comfortable, low host gain, especially with headphones. Finite samples and synthesis headroom do not guarantee safe listening volume.

### Source maps, privacy and redistribution

Every distribution JS has a matching source map with embedded TypeScript and a compiler-generated declaration. Publishing maps intentionally makes the implementation source readable; minification is not secrecy. Never place credentials or private configuration in source that will be built or deployed.

OPM.js does not provide an account, storage or telemetry service. Hosting providers and applications can still record request metadata or persist voices/audio. Document those host-specific behaviors separately and do not claim this library prevents data collection by the surrounding page.

Keep each deployment's JS, maps and declarations from the same build. Review exact development dependency versions, build plugins, CI actions, package contents and license compatibility before changing the supply chain.

## Threat model

| Surface | Risk | Required controls |
| --- | --- | --- |
| External voice JSON or JavaScript objects | High | Type/shape/byte/count limits; finite bounds; own-data validation; no untrusted prototype merging |
| Host download/upload and DOM code | High | Pre-buffer limits, permitted sources, text-only presentation and host-page XSS defenses |
| Raw AudioWorklet messages | High | Strict message validation, bounded IDs/events and observable failure handling |
| DX7 binary input and WAV PCM arguments | Medium | Bounded lengths, framing/checksum or sample validation; no native decoder |
| DSP and offline rendering | Medium | Finite output, bounded per-instance work, duration/sample-rate budgets and error diagnostics |
| Public scheduling API | Medium | Argument validation, admission handling, cancellation and bounded scheduling batches |
| Build and deployment supply chain | Medium | Exact development pins, reviewed CI actions, complete matching assets and zero runtime dependencies |
| Output audio and downloadable artifacts | Medium | User-controlled playback, conservative gain and host-managed privacy |

An AudioWorklet separates real-time processing from the main thread, but is **not a security boundary against a compromised host page**. Malicious host JavaScript can create nodes, spam messages, fetch data or manipulate the UI independently of OPM.js. Input validation and per-instance limits reduce accidental or adversarial input damage; they do not sandbox XSS or guarantee availability under arbitrary page load.

This policy addresses the library and checkout examples. Authentication, authorization, cookies, cross-origin access, backend storage, upload endpoints and rate limiting belong to the application deploying them.

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
