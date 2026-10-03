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
- The root `index.html`, `examples/` pages, `favicon.ico` and this policy are public website assets. Publish the build-generated `doc/` HTML, stylesheet and search assets together with the matching documentation sources.
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
| Legacy versions 1–5 | Original shapes only: v1 excludes key scaling, v1/2 exclude velocity sensitivity, v1–3 exclude waveform, v1–4 exclude expressive fields, v1–5 exclude per-operator LFO targets; normalize to v6 |
| PreparedVoice | Immutable detached core snapshot, including nested pitch envelopes; only private identity membership grants trust, never a structural brand/copy |
| Tuning / score / controls | A4 20–20000 Hz, 128 bounded cents offsets; strict dense four-element level/ratio/Hz/ADSR and LFO-target tuples; short scores retain 128-note/256-slot/60-second bounds; long scores have separate event/time/chunk limits and immutable own-data snapshots |
| Atomic OPM bank replacement | Validate all entries before swapping ≤128 lookups; plain empty array clears, while JSON/standalone empty bank parsing rejects; exports use detached canonical names and ≤256 KiB UTF-8 |
| Transport / performance | ≤1024 tempo points, quarter-note positions ≤86400; bounded scheduling density and scoped ID ownership; 1–16 parts, ≤128 physical keys/tracked gates with detached snapshots |

Single-voice APIs reject out-of-range fields. Bank validation clamps finite numeric fields to documented bounds, but still rejects malformed types, non-finite numbers and invalid version/algorithm/feedback values. Clamping is not a substitute for validation.

Keep allowlisted, own-data copying at trust boundaries. Do not merge untrusted objects into prototypes, invoke getters to inspect them, or treat a valid voice name as authorization to construct a URL or filesystem path. Engine bank parsing does not load paths or fetch voice URLs.

Independent note `gain` and `expression` are both bounded to 0..1 and multiply before stereo mix saturation. Layer fades do not bypass control validation, note ownership, worklet queue limits or rejection reporting.

### Score projects and Standard MIDI files

Versioned score-project parsing accepts only the documented own-data schema, detached validated voices, bounded beat events and synthesis settings. Loading a project does not fetch assets, execute code or start playback. Compilation converts note gate endpoints through the complete tempo map; offline resource budgets still apply after conversion.

The separate version-1 Arrangement project uses the same own-data beat/voice/settings boundaries and one pure definition validator shared with live arrangements. Bounds include 8 MiB serialized input/output, 128 voices/256 KiB voice JSON, 16 layers, 32 sections and 65,536 total events. Parsing is inert; persisted musical definitions do not include live IDs, permissions, pending commands or DSP state. Host replay must explicitly load validated voices and start from a gesture.

The independent Standard MIDI file adapter validates native bytes, bounded chunks, PPQN timing and event framing. It does not provide a native MIDI driver, transmit SysEx or interpret uploaded bytes as executable content. Hosts must check file size before buffering, choose explicit channel-to-voice mappings, expose import warnings and reject unsupported export semantics instead of silently changing a score.

Opt-in expressive SMF conversion separately bounds generated per-note fanout to 65,536 events. Frozen loss summaries separate omitted content, approximations and recognized source-message counts. Channel expression after a closed gate reports possible patch-dependent release-tail loss; strict unsupported policy rejects it. Export rejects incompatible channel ownership, unsupported controls and after-gate semantics rather than guessing. Explicit pitch-range policy is not RPN support.

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

`encodeWav()` encodes PCM; it does not decode/play uploaded audio. Own-data arguments are `left`, optional `right`, `sampleRate` and optional `format` (`pcm16`, `pcm24`, `float32`). Native Float32 samples must be finite in −1–1; stereo lengths match, with at most **4,000,000 frames per channel** for this full-buffer convenience API.

Project render results onto those fields rather than forwarding diagnostics or other metadata. Reject encoding/rendering errors visibly instead of substituting a fake result.

Core rendering authenticates native Float32Array kind/length instead of overridable properties. Validate offset before deriving the default length; numeric coercion, proxies, forged channels and out-of-bounds ranges reject without advancing sound. Idle clearing uses the native fill method. Hosts still own the actual PCM storage and must not mutate it concurrently.

Offline rendering allocates output buffers and executes synchronously. The host should limit duration, sample rate, envelope tails, concurrent requests and export frequency to suit its device and UI. Valid input may still consume significant time and memory; no universal deadline or whole-page memory guarantee is made.

Long-score rendering and incremental `createWavEncoder()` use bounded reusable PCM/encoded chunks, not unlimited aggregate buffers. Consume borrowed PCM before advancing; declare an exact encoder frame count and finalize only after all frames. Encoder chunks are 1–65536 frames and RIFF32 files remain <4 GiB; convenience rendering/`encodeWav` retain their 4,000,000-frame bound. Hosts must bound cumulative duration/work, retained bytes, concurrent renders and export frequency.

`renderSequenceInWorker()` validates before Worker allocation, transfers at most one unacknowledged encoded chunk and awaits sink writes before advancing. Capture intrinsic byte counts before handing ownership to a sink; storage workers may transfer/detach the buffers. Progress/abort callbacks are untrusted host behavior. Native AbortSignal cancellation terminates/rejects immediately without waiting for hung writes/abort/close. The sink owns invalidation and rollback; cancellation cannot retract persisted bytes. Acquire file sinks from trusted gestures, retain lifetime cancellation across picker/writable awaits, and clean up acquisition failures before starting a Worker. Never replace a long-file sink with unbounded Blob accumulation.

Create download URLs only for successfully encoded bytes. Replace/revoke obsolete Blob URLs and release them when the owning page or component is disposed. Treat filenames and rendered audio as potentially private application data.

### AudioWorklet, scheduling and context ownership

- Await `start()` in a user interaction and monitor `onEvent` or independent `subscribe()` listeners. A note ID is not admission; handle rejections, terminal states and processor errors. `waitForCommand()` is bounded, timed/cancellable and resolves admission only, not future execution; reset/close/failure invalidate pending waits.
- The worklet bounds pending events and tracked note IDs to 256 each. Schedule bounded batches rather than flooding the port with distant-future events.
- Each synth limits logical voices to configured 1–32 (default eight), with up to eight bounded stealing fades. Immutable eco/standard/high profiles change fixed internal sampling/filter work, not these bounds. These limits do not constrain an attacker creating many instances.
- DSP state and terminal notification buffers are preallocated. Ended/error callbacks run after stable frame traversal; callback-admitted replacements start next frame, and recursive rendering rejects rather than extending a frame's work.
- Named/prepared worklet registrations use 128 content-keyed LRU slots. Replacement revalidates before committing; queued/active notes own immutable old snapshots. Raw objects still validate freshly.
- Absolute start/stop/control times are safely framed with a 60-second future horizon; stop precedes onset and controls. Command rejection is correlated by commandId; accepted means admission, not guaranteed future execution. Global allNotesOff/panic bypass full scheduled queues. Bound sequences and lookahead rather than flooding messages.
- Immediate `stop(id, { cancelControls: true })` removes only that ID's queued automation/onset/off before natural release; it cannot be combined with `at`. Musical Transport retains release-tail controls during ordinary playback but cancels its own future automation on pause/seek/loop rebuilding. Seeking is a musical restart, not an exact DSP snapshot.
- Performance cleanup is part/helper scoped, not global panic. Repeated equal-pitch keys retain separate identities; stealing/reset cannot resurrect stale held/pedal state.
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
| Score-project JSON and Standard MIDI files | High | Byte/event/schema/framing limits, own-data options, detached validated voices and explicit unsupported-semantics handling |
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
- [ ] Voice JSON/key scaling, score projects, SMF/DX7 binary input, and WAV arguments validate type, shape, length, numeric bounds, and own-data properties before use
- [ ] Explicit allowlisted copying; no spreading/merging untrusted objects into prototypes; no accessor invocation
- [ ] Numeric bounds cover ADSR/live reanchoring, ratio/fixed-Hz controls, rate scaling, pitch envelope, LFO waveform/delay/sync/phase/targets and independent depth/rate, feedback, velocity/pan, levels and ramps; tuning/score/Transport/performance/encoder limits remain bounded and legacy shapes exclude later fields
- [ ] Prepared identity cannot be forged, trusted patches stay deeply immutable, and public map snapshots cannot change stored patches
- [ ] Application file/URL loaders bound sources, content type, and payload before buffering; engine does not fetch URLs
- [ ] DX7 rejects invalid length/framing/checksum/seven-bit payload; conversion descriptions remain outside strict voice schema

**B. Worklet boundary**
- [ ] Every raw message is checked for strict own-data shape before reads, enqueueing, or rendering
- [ ] No eval/Function execution or nonliteral dynamic imports in source/generated JS; configurable worklet/Worker URLs require secure same-origin assets and cannot weaken CSP/MIME validation
- [ ] Duplicate IDs reject before enqueueing; tracked IDs/events remain bounded; ended/stolen/error notes remove obsolete off events
- [ ] Held-note cancellation/release, bounded allNotesOff/panic, command admission/rejection, context/reset and processor failure propagate safely; teardown does not promise impossible per-note acknowledgements
- [ ] Registration replacement, controls, tuning, score IDs/times and absolute scheduling validate own-data shape; queued snapshots, ordering and cleanup preserve bounds
- [ ] Encoded Worker chunks require ordered acknowledgements, intrinsic byte accounting before sink ownership transfer, exact frame/file completion and termination on cancellation/failure; host sinks own rollback

**C. DSP loop safety**
- [ ] Output is finite: any NaN/Infinity in the render loop snaps to silence and increments an error counter (`Synth.errorCount` or `renderNote()`'s `diagnostics.errors`)
- [ ] Fixed work ceiling: configured 1–32 logical voices (default eight) and at most eight fades, deterministic priority-aware admission/stealing, authenticated native output lengths and numeric ranges before work
- [ ] Slot reset/recycling preserves identity and numerical state under callback admissions; terminal callbacks cannot replenish a frame's traversal or recursively render it
- [ ] Determinism and chunk-independent output preserved; live/offline LFO, timing, filtering, stereo, velocity, and saturation parity
- [ ] Deadline statistics exclude warmup and expose p95/p99/worst/misses without universal performance promises; spectral acceptance is controlled, not arbitrary FM alias-free proof

**D. Supply chain**
- [ ] Zero runtime dependencies still holds (`npm ls --omit=dev` is empty)
- [ ] Dev dependencies and CI actions pinned to exact versions/commit SHAs
- [ ] `package.json` `files` whitelist ships only intended `dist/` assets, usage docs, and legal/project files
- [ ] Standalone deployment retains the installed LICENSE alongside complete matching worklet/module assets; CSP/MIME/404 failures stay visible
- [ ] Any npm publication requires separate maintainer authorization, protected approval, matching tag/version/commit/release and independent A/B/C/D/package evidence, plus a reviewed provenance-bearing publishing path; post-publication checks compare exact tarball bytes, validate source provenance and cryptographically verify signatures before registry-installed consumer acceptance. This checkout has no npm publishing workflow; local verification is not publication.

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

Unreleased seven-capability checkout review: SecurityDataReview approved scoped **A**, SecurityProtocolReview **B**, SecurityDSPReview **C**, and SecuritySupplyReview **D** static inspection. Initial findings about release-tail controls, sink-transferred buffer accounting and deferred file-picker/writable teardown were fixed and the affected source rechecked without remaining scoped findings. These reviewers executed no tests, builds, audits or browser commands; their PASS does not certify runtime behavior, deployment permissions, physical devices or registry protections. The integration owner's observed tests, package gates, native browser smoke and report-only CPU measurements are recorded separately in CHANGELOG. This is not a release approval or a new waiver.

v1.7 release review: Release17Data approved scoped static **A**, Release17Protocol **B**, Release17DSP **C**, and Release17Supply **D**, with no evidence-backed blockers in the final seven-capability source and 1.7.0 release metadata. All four reviews were read-only and executed no runtime gates. Fresh isolated package/build/test/type/audit/quality checks and managed native Chromium AudioWorklet observations are recorded in CHANGELOG. Remote CI must pass before the release tag is published; its run URL and outcome belong in the GitHub release record. No waiver or npm authentication/provenance/external-protection certification is asserted.

v1.8 review record: InputProtocolReview approved scoped static **A/B** and DspAssetsReview scoped static **C/D** after the bounded arrangement, MIDI own-data, finite tempo-slope and canonical asset-overlap fixes. Their static approval does not certify runtime or external npm settings. The release commit `d793d69056c68a971ede1af988338412687227fd` has an observed successful [Node 22/24/26 and Chromium/Firefox/WebKit CI run](https://github.com/YueyuHoshizora/OPM.js/actions/runs/37061483772); the separate [review record](https://github.com/YueyuHoshizora/OPM.js/issues/1) and [release package record](https://github.com/YueyuHoshizora/OPM.js/releases/tag/v1.8) retain the evidence and tarball digest. This is not registry provenance, physical-device/MIDI or listening acceptance.

v1.8.1 documentation/package patch review: Patch181Inputs approved scoped static **A/B** and Patch181DspSupply scoped static **C/D**, with no evidence-backed blockers. Reviewers were read-only and ran no build, tests or external actions. The integration owner confirmed the source diff against v1.8 changes only `src/version.ts`; runtime validation, protocols and DSP are unchanged. Final regenerated assets, package gates and remote CI are separate release prerequisites, recorded in CHANGELOG and the GitHub release notes. No npm provenance, physical-device/MIDI or listening certification is asserted.

Unreleased integration-quality review: FinalImprovementInputs approved scoped static **A/B** after the pedal-ownership and applied-workload evidence fixes. FinalImprovementDspSupply approved scoped static **C/D** specifically for an isolated immutable canonical candidate (47 runtime modules with 141 matching distribution assets), after generated-link validation and the DOM-free core/project/MIDI type boundary were hardened. No surviving scoped findings remain. Both reviewers were read-only and executed no runtime gates or publication. The integration owner separately observed 381 passing behavioral tests, type checks including installed DOM-free Node consumers, numerical/dependency/package checks and native Chromium UI/smoke/stress checks. Unexpected numbered generated-file copies were preserved outside the checkout; live-tree packaging remains blocked by their reappearance and is not covered by the isolated-candidate approval. Desktop automation and numerical analysis do not certify physical devices, physical MIDI or human listening. No release approval, npm authentication/provenance/registry protection, physical-device or listening certification is asserted.

v1.9 release review: Release19Inputs approved scoped static **A/B** and Release19Supply scoped static **C/D** for an isolated canonical package 1.9.0 candidate, with no evidence-backed security findings. Reviewers ran no runtime gates. Numbered live-tree generated copies are not approved for packaging and must remain outside the candidate. GitHub publication requires exact clean-commit artifacts, passing remote Node/browser CI and an archive digest retained in the release record. Physical-device/MIDI, human listening and npm provenance remain unverified and are not claimed by this GitHub-only release.

v1.9 deadline repair: Release19Supply rechecked and approved scoped static **C/D** topology-cache/pooling/render changes after the initial release candidate failed the Node 22 prepared-burst p99 gate. Fixed slot-local caches derive only from the existing validated graphs, overwrite all edges, preserve summation order and retain finite checks, bounded fades and reentrant callback behavior. The reviewer executed no checks; this is not a performance waiver. The repaired exact commit must pass the unchanged remote gates before tagging.

Unreleased readiness review: ExpressionSecurity approved scoped static **A/B** for final expressive SMF boundaries, ownership and loss accounting; ArrangementCaptureSecurity approved scoped **A/C/D** for portable/shared arrangement validation, lifecycle, inert imports, pure core contracts and bounded text-only local MIDI capture. No evidence-backed findings remained. Reviewers executed no gates. The integration owner separately observed 403 passing tests, installed package/types/security/audit checks, 108 bit-identical baseline renders, scoped capacity measurements and native isolated Edge UI/worklet checks, recorded in CHANGELOG. Physical phones/controllers and genuine eighteen-preset listening originals remain blocked/unverified. This is not release/publication approval.

## Non-goals

- Sandboxing the host page (OPM.js runs in the page's trust domain; XSS protection is the embedder's job)
- DRM / copy protection of voice banks
- Remote code loading of any kind — never supported
