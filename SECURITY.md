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

- Serve the complete, matching `dist/` tree over HTTPS or localhost, preserving worklet and imported-module paths. A configurable worklet URL must stay same-origin, use HTTPS/loopback HTTP, contain no credentials/fragment, and retain CSP/MIME enforcement. Do not load through `file://`, and retain `LICENSE`.
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
| Legacy versions 1/2/3/4 | Original shapes only: v1 excludes key scaling, v1/2 exclude velocity sensitivity, v1–3 exclude waveform, v1–4 exclude new expressive fields; normalize to v5 |
| PreparedVoice | Immutable detached core snapshot, including nested pitch envelopes; only private identity membership grants trust, never a structural brand/copy |
| Tuning / score / controls | A4 20–20000 Hz, 128 bounded cents offsets; strict dense four-element operator-level tuples; short scores retain 128-note/256-slot/60-second bounds; long scores have separate event/time/chunk limits and own-data snapshots |

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

Core rendering authenticates native Float32Array kind/length instead of overridable properties. Validate offset before deriving the default length; numeric coercion, proxies, forged channels and out-of-bounds ranges reject without advancing sound. Idle clearing uses the native fill method. Hosts still own the actual PCM storage and must not mutate it concurrently.

Offline rendering allocates output buffers and executes synchronously. The host should limit duration, sample rate, envelope tails, concurrent requests and export frequency to suit its device and UI. Valid input may still consume significant time and memory; no universal deadline or whole-page memory guarantee is made.

Long-score rendering is an explicit bounded chunk API, not an unlimited WAV/full-buffer export. Its reusable PCM storage must be consumed/copied before the next chunk; cancellation prevents further advancement. Hosts must bound cumulative duration/work, concurrent renders and retained chunks. The 4,000,000-frame WAV and convenience-render limits still apply.

Create download URLs only for successfully encoded bytes. Replace/revoke obsolete Blob URLs and release them when the owning page or component is disposed. Treat filenames and rendered audio as potentially private application data.

### AudioWorklet, scheduling and context ownership

- Await `start()` in a user interaction and monitor `onEvent` or independent `subscribe()` listeners. A note ID is not admission; handle rejections, terminal states and processor errors. `waitForCommand()` is bounded, timed/cancellable and resolves admission only, not future execution; reset/close/failure invalidate pending waits.
- The worklet bounds pending events and tracked note IDs to 256 each. Schedule bounded batches rather than flooding the port with distant-future events.
- Each synth limits logical voices to eight, with up to eight bounded stealing fades. These limits do not constrain an attacker creating many synth instances or abusing unrelated host code.
- DSP state and terminal notification buffers are preallocated. Ended/error callbacks run after stable frame traversal; callback-admitted replacements start next frame, and recursive rendering rejects rather than extending a frame's work.
- Named/prepared worklet registrations use 128 content-keyed LRU slots. Replacement revalidates before committing; queued/active notes own immutable old snapshots. Raw objects still validate freshly.
- Absolute start/stop/control times are safely framed with a 60-second future horizon; stop precedes onset and controls. Command rejection is correlated by commandId; accepted means admission, not guaranteed future execution. Global allNotesOff/panic bypass full scheduled queues. Bound sequences and lookahead rather than flooding messages.
- Handle rejected diagnostics promises and failed node initialization. Do not hide failure behind mock audio nodes or a fallback engine.
- A shared AudioContext is borrowed: OPM disconnects its node but never closes/suspends the host context. `close()` is restartable; terminal `dispose()` clears owned helpers/subscriptions without taking ownership of a borrowed context. Hosts own downstream routing and permissions.
- Clear host gate bookkeeping on global reset; close/failure need not reply with every terminal note. Default cancel removes old gates/automation on suspension/interruption; preserve is opt-in. Both policies stop lookahead and require gesture-driven explicit restart.
- The recovery harness bounds local events/attempts and captures explicit device metadata, observations and manual scenario status. It uploads nothing. Automated desktop checks cannot certify physical phones or listening continuity; support-matrix cells without physical evidence remain unverified.
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

- [ ] Any release tag (`vX.Y` for zero patch versions, `vX.Y.Z` otherwise)
- [ ] Merging a PR that touches: `src/worklet/`, `src/core/`, or voice parsing (`src/voices/`, `src/api/` loaders)
- [ ] Adding any dependency, build plugin, or CI action
- [ ] Supporting a new voice-bank source (file import, URL, user paste)

### 2. Review checklist

**A. Untrusted data (voice banks, config)**
- [ ] Voice JSON/key scaling, DX7 binary input, and WAV arguments validate type, shape, length, numeric bounds, and own-data properties before use
- [ ] Explicit allowlisted copying; no spreading/merging untrusted objects into prototypes; no accessor invocation
- [ ] Numeric bounds cover ADSR, fixed Hz/rate scaling, pitch envelope, LFO waveform/delay/sync/phase, velocity/pan, level scaling, ramps and four-element operator-level tuples; tuning/short-and-long-score limits remain bounded and legacy shapes exclude later fields
- [ ] Prepared identity cannot be forged, trusted patches stay deeply immutable, and public map snapshots cannot change stored patches
- [ ] Application file/URL loaders bound sources, content type, and payload before buffering; engine does not fetch URLs
- [ ] DX7 rejects invalid length/framing/checksum/seven-bit payload; conversion descriptions remain outside strict voice schema

**B. Worklet boundary**
- [ ] Every raw message is checked for strict own-data shape before reads, enqueueing, or rendering
- [ ] No eval/Function execution or nonliteral dynamic imports in source/generated JS; configurable worklet URLs are restricted to secure same-origin assets and cannot weaken CSP/MIME validation
- [ ] Duplicate IDs reject before enqueueing; tracked IDs/events remain bounded; ended/stolen/error notes remove obsolete off events
- [ ] Held-note cancellation/release, bounded allNotesOff/panic, command admission/rejection, context/reset and processor failure propagate safely; teardown does not promise impossible per-note acknowledgements
- [ ] Registration replacement, controls, tuning, score IDs/times and absolute scheduling validate own-data shape; queued snapshots, ordering and cleanup preserve bounds

**C. DSP loop safety**
- [ ] Output is finite: any NaN/Infinity in the render loop snaps to silence and increments an error counter (`Synth.errorCount` or `renderNote()`'s `diagnostics.errors`)
- [ ] Fixed work ceiling: at most eight logical voices/eight fades, deterministic selected stealing policy, authenticated native output lengths and numeric ranges before work
- [ ] Slot reset/recycling preserves identity and numerical state under callback admissions; terminal callbacks cannot replenish a frame's traversal or recursively render it
- [ ] Determinism and chunk-independent output preserved; live/offline LFO, timing, filtering, stereo, velocity, and saturation parity
- [ ] Deadline statistics exclude warmup and expose p95/p99/worst/misses without universal performance promises; spectral acceptance is controlled, not arbitrary FM alias-free proof

**D. Supply chain**
- [ ] Zero runtime dependencies still holds (`npm ls --omit=dev` is empty)
- [ ] Dev dependencies and CI actions pinned to exact versions/commit SHAs
- [ ] `package.json` `files` whitelist ships only intended `dist/` assets, usage docs, and legal/project files
- [ ] Standalone deployment retains the installed LICENSE alongside complete matching worklet/module assets; CSP/MIME/404 failures stay visible
- [ ] npm publication defaults to dry run and requires protected approval, matching tag/version/commit/release, A/B/C/D evidence and trusted publishing; post-publication checks compare exact tarball bytes, validate source provenance and cryptographically verify signatures before installed-consumer acceptance

### 3. Verification gates

Run development commands from a source checkout after `npm ci`; installed npm packages do not contain the development tooling.

- `npm run build` then `npm test` — source/distribution behavior, malformed-input, deterministic rendering, and spectral regression coverage
- `npm run typecheck` — strict source, development tools/tests/demos, and NodeNext consumer against generated public declarations
- `npm run security -- --package-smoke` — TypeScript compiler AST gate over source and Acorn gate over generated JS, exact development pins, zero runtime dependencies, isolated installed exports/type smoke
- `npm audit` and `npm audit --omit=dev` — record actual tooling/runtime audit results; runtime dependency tree must be empty
- `npx --no-install playwright install --with-deps chromium` then `npm run browser-smoke -- chromium` — real AudioWorklet smoke; Firefox/WebKit alternatives are configured separately
- Headless Linux Firefox requires a running native audio server. CI starts PulseAudio and a null sink before real worklet smoke; it does not mock audio or relax browser permission/autoplay controls. Consult the usage guides for setup and stage diagnostics.
- `npm run benchmark` — host-dependent 128-frame render deadlines, with optional explicit budget environment variables
- `npm run sound-quality` / `npm run voice-quality` — numerical/register/velocity matrices and controlled spectral reports, not perceptual/hardware-fidelity proof
- `npm run browser-stress -- chromium` — real bounded worklet contention/lifecycle/queue checks; timer/round-trip data are not CPU, GC or glitch counters
- `npm run vite-smoke` — installed artifact, non-root production base, license, actual audio, CSP and negative MIME/404 scenarios; audit standalone tooling from `examples/vite` too
- Follow [publishing prerequisites](./doc/publishing.md) before any authorized npm upload; source review cannot establish external environment protections, registry authentication or provenance

### 4. Review record

Each release notes in the CHANGELOG which checklist sections were exercised (A/B/C/D) and by whom. Checklist failures block release; waivers require a written reason in the CHANGELOG.

For v1.2, final A/B/C/D independent review and observed integration verification are recorded in CHANGELOG before release. Configured Node 22/24/26 and Chromium/Firefox/WebKit CI jobs are capabilities, not evidence of an external run. Missing browser binaries/host support or unrun CI must be reported, not represented as passing coverage.

v1.5 feature-completion review: InputBoundaryReview covered A/B; DspSupplyReview covered C/D. The integration owner reproduced and fixed null mixGain/tuning acceptance and overridable render-buffer metadata, then also prevented offset coercion before default-length calculation. Runtime evidence and remaining registry/physical-device prerequisites are recorded separately in CHANGELOG; static review is not a claim of runtime coverage.

FinalInputsReview (A/B) and FinalDspReview (C/D) rechecked the final hardened source and release controls, with no new evidence-backed findings. Their PASS applies to scoped static inspection only; they ran no build, payload, tests, audit or browser commands.

v1.5 release review: Release15Inputs approved scoped static A/B inspection; Release15DspSupply approved C/D for GitHub distribution of package 1.5.0, with no evidence-backed blockers. Neither reviewer executed runtime gates or certified external npm settings. The integration owner's fresh package, native browser, numerical, audit and report-only benchmark evidence is recorded in CHANGELOG.

v1.5 interruption-repair recheck: Release15Inputs initially found that deferred running notifications could leave deduplication state stale. Both initial and existing-node resume now synchronize successful state observation; repeated fully deferred transitions and pending diagnostics are covered by consumer regressions. Release15Inputs then approved A/B and Release15DspSupply approved C/D without remaining scoped static findings. The original Linux WebKit CI failure blocks publication until repaired-candidate verification; static approval is not a waiver or runtime certification.

v1.6 release review: a security review found two command-waiter boundary issues (abort-signal state/listener shadowing and receipt-eviction handling around correlated panic resets). Both were fixed with regressions and rechecked natively against a borrowed context. No fresh independent A/B/C/D approval was obtained for v1.6; the maintainer explicitly authorized the GitHub release on the integration owner's runtime evidence, recorded as a waiver in CHANGELOG. npm publication still requires the independent review record described in doc/publishing.md.

## Non-goals

- Sandboxing the host page (OPM.js runs in the page's trust domain; XSS protection is the embedder's job)
- DRM / copy protection of voice banks
- Remote code loading of any kind — never supported
