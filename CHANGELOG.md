# Changelog

For installation and executable examples, see the [README](./README.md#getting-started) and the [English](./doc/usage.en.md) / [繁體中文](./doc/usage.zh-TW.md) usage guides.

## v1.9

Package version 1.9.0. Integration and musical workflows release; voice format remains v6. Historical releases remain immutable. GitHub distribution is separate from npm publication; no npm publication is performed.

### Integration and musical workflows

- Add bounded Transport `startupLead` for cold starts and reconstructed playback. The musical position stays at the requested beat during count-in; genuine late/drop errors remain visible.
- Add independent per-note and Arrangement layer gain, quantized gain changes and section fades/crossfades, including existing notes and release tails without overwriting authored expression.
- Add declarative MIDI CC mappings with scalar/operator targets and captured-baseline reset. Adapter-owned notes can be released under a held pedal without cancelling another input's keys or pedal state.
- Add version-1 self-contained score projects, deterministic serialization and a shared tempo-integrating beat compiler for live/offline workflows.
- Add the independent `opm.js/midi-file` SMF type 0/1 PPQN import/export adapter, with bounded parsing and explicit warnings or rejection for unsupported content.
- Keep beat-event type ownership in the environment-independent core. Separate Node consumer checks compile core/project/MIDI declarations without DOM or Web Audio globals, including an installed-package check.
- Add two original short pieces with play/stop, project save/load and Worker PCM16 WAV export. These are musical examples, not a listening-quality certification.

### Documentation and acceptance

- Generate navigable, locally searchable HTML guides and a full compiler-derived API reference, with prominent online-demo links. Markdown remains the documentation source.
- Add condition-grouped device and human-listening evidence review tools. Conflicting, incomplete, automated and unassessed evidence does not become a physical-device or listening PASS.
- Capture the actually applied gain/tuning after Play and after partial settings failures, rather than stale session defaults.

### Observed verification and review boundaries

- Local behavioral suite: 381 passing tests. Dependency audit: zero vulnerabilities; runtime dependency tree: empty. Numerical sound-quality checks cover 2,505 matrix rows and 24 live-control cases; preset-quality output is accepted.
- Native Chromium AudioWorklet observations cover beat-0 startup, gain mute/resume without retrigger, pedal-owned MIDI cleanup, both original pieces and project round trips. The actual Arrangement UI produces signal → exact silence → signal for a solo pad layer and switches/fades sections across pause/resume. Project JSON and a valid Worker PCM16 WAV were downloaded to disk; the documented Node chunk-WAV recipe also produced a finite, correctly framed file.
- Default-gain PCM remains bit-identical in 333 baseline comparison renders. Node CPU measurements are report-only host observations, not real-time or mobile support guarantees.
- FinalImprovementInputs approved scoped static A/B; FinalImprovementDspSupply approved scoped static C/D for an isolated immutable canonical candidate after the pedal ownership, workload-recording, generated-link and DOM-free type-boundary fixes. Reviewers ran no runtime gates. Earlier numbered generated-file copies were preserved outside the checkout; release artifacts must be built from the exact clean release commit.
- The isolated candidate passes the 141-asset build, all behavioral/type checks and installed-package/runtime/asset/DOM-free-Node declaration gates. Native Chromium 150 smoke and the bounded 768-note stress gate pass with zero DSP errors; the intentional late/drop remains counted. HTML search and declaration-anchor navigation also work from `file://` at a 390-pixel viewport without page overflow.
- Native matched/dry A/B previews produce finite signal, but numerical measurement leaves every human criterion unassessed and refuses unconfirmed/empty finding exports. The actual desktop device capture validates as 0/36 PASS and remains unverified; neither observation is physical iOS/Android, physical MIDI or human-listening evidence.
- Physical-device captures and genuine human listening findings are still required before those acceptance statuses or trim recommendations can be promoted. This GitHub release does not imply deployment, npm publication or physical-device/listening certification.
- Release19Inputs approved scoped static A/B; Release19Supply approved scoped static C/D for an isolated canonical 1.9.0 candidate, with no evidence-backed security findings. Neither reviewer executed runtime gates. The GitHub release record retains the exact release commit, observed remote CI outcome and archive SHA-256; npm publication is excluded.

## v1.8.1

Package version 1.8.1. Documentation and packaging patch; no runtime API, voice-format, DSP or scheduling behavior changes. The original v1.8 tag and archive remain immutable. GitHub release distribution is not npm registry publication.

### Documentation and packaging

- Ship the synchronized README, bilingual usage guides and topical integration/deployment guides in a separately versioned installable archive.
- Correct public voice budgets, priority admission, grid-helper import locations, DX7 AM conversion limits, Worker startup/phase contracts and complete static-asset deployment instructions.
- Replace links to package-excluded HTML/source/tooling with explicit checkout-only repository resources and provide runnable default-voice arrangement recipes.
- Leave a one-beat count-in in Transport recipes and document cold-start beat-0 `late:'drop'` rejection. This patch does not fix or hide the runtime timing limitation.
- Align package/lock/source `VERSION`, installation filenames and release-specific deployment paths to 1.8.1; regenerate compiler-owned distribution assets.

### Security and observed release-candidate verification

- Patch181Inputs approved scoped static **A/B** and Patch181DspSupply scoped static **C/D**, with no evidence-backed blockers. Both reviews were read-only and ran no runtime or external gates; no waiver is asserted.
- An isolated 1.8.1 candidate passed build, all 310 behavioral tests, strict source/development/installed-public-contract type checks, source/generated AST security gates and installed-package rendering/WAV/types/CLI checks. Full and runtime audits reported zero vulnerabilities; runtime dependencies remain empty. Standalone Vite tooling audits also reported zero vulnerabilities.
- Fresh `sound-quality` passed 2,505 matrix cases and 24 live-control cases with independent spectral/filter/streaming gates; `voice-quality` completed successfully. The benchmark ran with no acceptance budgets and remains report-only, not a host deadline or physical-device certification.
- Fresh generated output differs from the preceding distribution only in the three `VERSION` JS/map/declaration companions; all other deployed assets are byte-identical. The source diff against v1.8 changes only `src/version.ts`.
- Sandboxed, muted native Chromium 150 passed the existing compiled browser smoke, 768-note stress and installed-package Vite subpath/CSP/lifecycle/missing-asset/wrong-MIME assertions using a throwaway executable-launch adapter; test assertions and runtime code were unchanged. A fresh pinned Chromium download timed out after receiving the archive, so this is explicit native-executable evidence, not a PASS for that download or the default cached-browser command.
- The exact installed archive resolved all eleven public import specifiers and rendered finite nonzero PCM with zero errors at 32 voices in eco/standard/high, protected high-priority notes, rejected lower priority and round-tripped a linear tempo map/grid. The actual asset CLI copied/reused 134 files and checked 133 served assets with matching bytes, MIME and `nosniff`.
- Exact README/English/Chinese browser quick starts reported `VERSION:1.8.1`, finite nonzero PCM and no browser errors or note rejections; screenshots were inspected. Checkout documentation passed relative file/anchor checks and pinned repository-resource validation.
- Release publication is gated on observed remote Node.js 22/24/26 and Chromium/Firefox/WebKit CI for the exact release commit. Its run URL/outcome and the final archive digest are retained in the GitHub release notes. npm registry/provenance, physical-device/MIDI behavior and human listening remain separate unverified prerequisites.

## v1.8

Package version 1.8.0. GitHub release distribution and npm registry publication are separate operations; neither implies physical-device acceptance.

### Engine and integration

- Add priority-aware voice admission and opt-in 1–32 logical voices, retaining the default eight-voice engine and at most eight stealing fades.
- Add beat-linear tempo ramps, quantization/swing helpers and adaptive looping layers with boundary-quantized section changes and scoped cleanup.
- Add per-key/per-part expressive controls, per-part voice budgets and an optional, explicitly requested non-SysEx Web MIDI adapter.
- Add Worker readiness, optional startup timeout and host-local phase diagnostics without weakening chunk acknowledgements or cancellation.
- Add the dependency-free `opm-assets` deployment/check CLI, canonical filesystem overlap protection, and a bounded physical-device evidence review command.
- Expand all-profile acoustic references, selective-LFO original presets, audition controls and local human-finding exports. Add adaptive, instrument, independent-bus/stem and FM-designer examples.

### Security and observed verification

- InputProtocolReview approved scoped static **A/B** and DspAssetsReview scoped static **C/D** after correcting arrangement expansion/terminal cleanup, MIDI allowlist own-data handling, nonfinite linear slopes and symlinked deployment overlap. Both reviews were read-only and ran no runtime gates; this is not release approval.
- The slope and filesystem regressions were observed failing before correction. All 41 targeted arrangement, MIDI, Transport and asset-tool tests passed after correction.
- Final hardened candidate verification passed 310 behavioral tests, build, strict source/development/public-contract types and source/generated security gates. Isolated installed-package rendering, declarations and the actual installed asset CLI passed. Full/runtime audits found zero vulnerabilities; runtime dependencies remain empty. The device-evidence CLI classified an empty synthetic capture as 36 unverified cells, without creating physical evidence.
- Fresh `sound-quality` passed 2,505 matrix cases and 24 live-control cases across eco/standard/high, including its independent spectral/filter/streaming gates; `voice-quality` completed with `accepted: true`. These numerical results are not listening or hardware-fidelity verdicts.
- Assistant-owned native Chromium exercised FM-designer hold/live feedback/release/export with one active Worklet voice and zero errors; instrument startup/cleanup; independent-bus playback and actual offline stem links; eco audition control-phrase measurement/WAV output; and adaptive boundary switching, tempo acceleration, pause/resume/stop with no browser errors. Screenshots were inspected. The audition rejected an unassessed human finding; no listening results were fabricated.
- Native static Worker smoke completed PCM24 output through two writes (17,324 bytes), reported zero DSP errors and observed initializing/rendering/writing/closing/completed phases.
- The repository Playwright Chromium smoke could not launch because its cached Chromium framework was missing. Managed Chromium observations above are separate evidence, not a pass for that command or cross-browser CI. Listening, physical MIDI/device behavior and publication remain unverified.
- Remove the manual `npm-publish.yml` GitHub Actions workflow. Registry publication remains a separate maintainer action; online `registry-verify` still expects provenance from that historical workflow path.
- Candidate preparation preserved unexpected duplicate generated files with ` 2` suffixes separately and excluded them from commits. This is not a build guarantee: the current build replaces the generated `dist/` directory, so preserve any host/user files outside it before rebuilding.

### GitHub release package and post-release documentation

- The unchanged v1.8 tag points to `d793d69056c68a971ede1af988338412687227fd`. Its [remote quality run](https://github.com/YueyuHoshizora/OPM.js/actions/runs/37061483772) passed Node.js 22/24/26 and Chromium/Firefox/WebKit; this later evidence does not turn the missing local Playwright binary above into a local command PASS.
- Attach the previously missing [opm.js-1.8.0.tgz](https://github.com/YueyuHoshizora/OPM.js/releases/download/v1.8/opm.js-1.8.0.tgz), built in an isolated checkout of that exact tag. The 491,851-byte archive has SHA-256 `bee862d5b3ccaa7c4e8ff959583873c78a8ca8a9f56f4d8b039e490e498e2587`; build/type/security/local-artifact gates and exact installed-package rendering/asset CLI passed, and a downloaded copy matched byte-for-byte. The [review issue](https://github.com/YueyuHoshizora/OPM.js/issues/1) is closed as a review record, not npm-publication certification.
- Deep audit of the attached archive verified all eleven public import specifiers, 44 JS/map/declaration triplets, embedded sources, runtime/type import closure and the actual CLI's served asset bytes/MIME/`nosniff`. Native Chromium observed finite nonzero AudioWorklet output with zero errors in eco/standard/high at `maxVoices:32`; native static Worker output matched core WAV bytes in all three formats with transferred sink buffers and zero errors. These checks are not physical polyphony-budget, device/MIDI or listening acceptance.
- Synchronize README, both usage guides, all topical guides, Vite guidance, project guidance and current publication/security instructions to v1.8 contracts. Document direct release-tarball installation, twelve checkout-only HTML examples, 1–32 logical voices/default eight, priority-aware admission, tempo/arrangement, expressive/MIDI and Worker diagnostics; make shipped-document links independent of excluded HTML/source/tooling.
- Keep historical verification records and the original tag/tarball unchanged. Registry publication/provenance, physical-device/MIDI behavior and human listening remain separate unverified prerequisites.
- Documentation execution caught incorrect grid-helper import claims and cold-start Transport beat-0 late rejection. Grid helpers are root exports, not core exports; runnable Transport recipes now leave a one-beat count-in and explicitly document the remaining `late:'drop'` timing limitation without changing runtime code.
- Post-release documentation smoke passed isolated build/type/local-artifact gates, direct GitHub URL installation, all three Node quick-start scripts (`true 0`), installed asset copy/reuse and 133 served-asset checks, plus the installed-package Vite 8.3.2 production build. Sandboxed, muted native Chromium exercised the exact README/bilingual quick starts, both updated Transport/performance scripts and the complete default-voice arrangement recipe with finite nonzero PCM, zero DSP errors/rejections and no browser errors; screenshots were inspected. Native Worker diagnostics produced 8,684 PCM24 WAV bytes identical to core output and completed all phases. An installed 32-voice priority/tempo/grid smoke preserved protected voices, rejected lower priority and round-tripped a linear tempo map. These are scoped documentation/contract observations, not a fresh full-suite, registry, physical-device/MIDI or listening certification.

## v1.7

Package version 1.7.0. GitHub release distribution and npm registry publication are separate operations; the historical v1.6 tag and artifact remain immutable.

### Musical scheduling, rendering and expressive control

- Add beat-based `createTransport()` with AudioContext-clock pause/resume, seek, loops, time signatures, BPM and bounded tempo maps. Restarts rebuild owned musical notes/automation, not an exact DSP snapshot; unrelated notes remain untouched. Preserve scheduled controls throughout release tails, including the final non-loop endpoint.
- Add exact-frame incremental WAV encoding and PCM16/PCM24/Float32 output. Full-buffer encoding retains its existing frame limit; incremental encoding enforces RIFF32/sequence limits without retaining a complete WAV.
- Add a static same-origin module Worker renderer with progress, cancellation and one acknowledged chunk at a time. Await sink writes for backpressure, preserve accounting when the sink transfers buffers, and invalidate output through the host's abort contract.
- Add bounded part-scoped performance policies: independent physical key IDs, sustain, polyphonic/mono legato, last/high/low priority and scoped cleanup. This is not a MIDI driver.
- Add independently ramped feedback, LFO rate/depths, operator ratios/fixed frequencies and live ADSR reanchoring without resetting oscillator phase. Canonical voice format v6 adds per-operator AM/PM targets; strict original v1–v5 inputs remain accepted.
- Add immutable eco/standard/high quality profiles (2×/4×/8×); standard retains the previous default output. Publish measured CPU tradeoffs without arbitrary-FM alias-free, perceptual or physical-device claims.
- Add atomic bank replacement, lookup removal and detached canonical JSON export. Validation failures leave the bank unchanged; queued/sounding patches retain their snapshots. An explicit empty input array clears the bank.
- Integrate all seven capabilities into public exports/declarations, bilingual usage guides and the shared-score example. Abort file-export lifetime before awaiting picker/writable acquisition; wait for panic/release admission before allowing the next UI action.

### Pre-release feature verification

- Node.js 26.7.0: 272 behavioral tests, strict source/development/NodeNext-consumer types, generated build, AST/security gates and isolated installed-package render/WAV/types passed. Full tooling and runtime audits found zero vulnerabilities; the runtime dependency tree is empty. The broader offline sound-quality command passed 1,728 matrix cases and its independent spectrum/filter/four-operator/two-minute streaming gates.
- Actual offline smoke rendered eco PCM16, standard PCM24 and high Float32 WAVs with zero DSP errors. The default profile retained bitwise PCM parity across all eight algorithms against the pre-change distribution. Real Worker-thread regressions cover transferred sink ownership, backpressure and cancellation; Transport regressions exercise actual worklet DSP release-tail controls.
- The assistant-managed hidden Chromium 150 browser exercised trusted audio startup, nonzero analyser output in all three live quality profiles, smooth feedback/LFO controls, Transport pause/seek/tempo/resume/stop and an actual loop seam (seek 7.8 beats at 300 BPM, observed wrap to 0.33), mono/high-priority key/pedal controls, bank replace/remove/export and native static-Worker PCM24 preview under same-origin CSP and `nosniff`. The preview contained 43,680 frames / 262,124 bytes with zero DSP errors; an actual full-page screenshot was inspected. Browser observations are not listening or physical-device acceptance.
- Native browser Worker smoke matched whole-core WAV bytes for eco PCM16, standard PCM24 and high Float32 while transferring every sink buffer; at most one write was active. Cancellation rejected with AbortError despite stalled write/abort promises. Wrong-MIME and missing Worker assets rejected without writing or closing the sink, with one abort each.
- A throwaway same-origin application-world probe substituted native OPFS storage for the OS chooser, retaining the actual registered demo teardown callback and native Worker. Leaving during picker acquisition started no Worker/writable; leaving during writable acquisition started no Worker and aborted exactly once. A normal 60-second / 96-kHz PCM16 export wrote 23,101,484 native file bytes through 1,411 writes, closed once and reported zero DSP errors. Probe files were removed; this does not verify the operating-system chooser UI.
- Report-only Apple M5 profile benchmark: eight voices/LFO, 48 kHz, 128-frame blocks, 300 excluded warmup and 2,000 measured blocks per profile. Eco/standard/high p99 was 0.280/0.509/0.820 ms, with zero deadline misses and zero DSP errors in each row. See [acoustic evidence](./doc/acoustic-quality.md#coverage-and-evidence) for exact timings and limits.
- Independent scoped static review: SecurityDataReview **A PASS**, SecurityProtocolReview **B PASS**, SecurityDSPReview **C PASS**, SecuritySupplyReview **D PASS** after correcting release-tail control omission, transferred-buffer byte accounting and deferred file-acquisition teardown. Reviewers ran no runtime gates; integration evidence above is separate. No waiver or release authorization is asserted.
- Unexpected duplicated generated assets failed an early package-map gate; original assets were preserved. v1.7 verification and packaging use a clean tracked-file checkout, excluding duplicate/untracked assets without deleting user files.
- This feature-development record did not certify cross-browser CI or npm publication. Listening quality, physical iOS/Android interruption behavior, arbitrary-patch alias freedom and the operating-system file chooser remain unverified.

### v1.7 release-candidate verification

- Package/lock version 1.7.0: a fresh isolated checkout passed all 272 behavioral tests, source/development/NodeNext-consumer type checks, generated build, source/built AST security gates and installed-package render/WAV/types. Full tooling and runtime audits reported zero vulnerabilities; runtime dependencies remain empty. Both sound-quality and voice-quality commands passed, followed separately by the report-only benchmark.
- Managed native Chromium 150 under same-origin CSP and `nosniff` exercised the built shared-score demo and 48-kHz AudioWorklet output in eco/standard/high profiles: each produced finite nonzero PCM and zero DSP errors. This is native runtime observation, not listening or physical-device acceptance.
- Fresh independent read-only static release review: Release17Data **A PASS**, Release17Protocol **B PASS**, Release17DSP **C PASS**, Release17Supply **D PASS**. Reviewers executed no runtime gates or external publication actions.
- The GitHub release is gated on observed remote Node 22/24/26 and Chromium/Firefox/WebKit quality/security jobs, including native stress and installed Vite deployment. The release notes record the actual run URL/outcome and verified tarball digest; configured jobs alone are not passing evidence. GitHub distribution does not publish to npm.

## v1.6

Package version 1.6.0. GitHub release distribution and npm registry publication are separate operations; the v1.5 artifact remains immutable.

### Acoustic quality, expression and adoption

- Add original independent nested four-op chain/branched/multicarrier references alongside Bessel/feedback/long-stream coverage; replace the former four-pole decimator with a preallocated eighth-order Butterworth cascade. Passband, folded-product rejection, phase, tail and CPU tradeoffs are explicit; no arbitrary-FM alias-free or perceptual claim.
- Canonicalize voice format v5 with fixed-Hz operators, rate key scaling, pitch envelopes and delayed/phase-selectable note/global LFO. Retain strict original v1–v4 input shapes. Add independent per-operator level multipliers/ramps and note-scaled offline release tails.
- Preserve supported fixed-Hz/expressive DX7 source fields using documented musical heuristics and actionable substitution/loss warnings; six-to-four topology and hardware timing remain intentionally lossy.
- Add bounded long-score preparation, capacity estimation, reusable chunked rendering and mixed note/control/stop streaming without removing short-score/worklet/WAV limits.
- Add same-origin custom worklet assets, multicast subscriptions, timed/abortable command admission waits and terminal disposal alongside restartable close.
- Expand original curated preset recipes and provenance/register/velocity metadata, numerical host trims and repeatable phrase/A/B audition without rewriting patches for loudness.
- Expand physical-device recovery scenarios, bounded local observation/status exports and an explicit unverified iOS/Android support matrix.
- Add post-publication registry byte/integrity/source-provenance/signature/installed-consumer verification to the manual npm workflow; local artifact validation is available without claiming registry publication.
- Synchronize project guidance and public usage contracts. Physical-device/listening evidence and authorized first npm publication remain external prerequisites.

### v1.6 verification record

- Node.js 26.7.0: 198 behavioral tests, strict source/development/consumer types, source/generated AST gates, installed-package render/WAV/declarations passed; root full/runtime and Vite tooling audits found zero vulnerabilities, with an empty runtime dependency tree. A stale generated `dist` containing duplicated ` 2`/` 3` suffix files failed the packaged-map gate; it was preserved outside the repository and rebuilt cleanly rather than deleted.
- Native Chromium 153.0.8010.12 (48 kHz backend, muted) ran the audition UI (A/B measurement, matched-versus-dry reports, PCM16 WAV download, play/stop/dispose and fresh restart), a 60-second/96 kHz bounded render (5,775,360 frames, zero DSP errors) and a 390 px layout check; the event log is now height-limited so long reports do not widen the page. It also ran command-waiter admission, receipt eviction, native abort-signal handling, correlated panic reset, subscription cleanup and terminal disposal against a borrowed context. Worklet stress and the installed Vite subpath/CSP/MIME/404 smoke passed again; the native WebKit 26.6 AudioWorklet smoke passed.
- Report-only Apple M5 benchmark (48 kHz, 128 frames, 2.667 ms deadline): the order-8 decimator costs more than the former filter. Eight voices with LFO had p99 at 1.575× the deadline and 79 misses; without LFO 1.429× and 45 misses; raw burst 3.323× and prepared burst 2.591×. Worst samples include scheduler/GC pauses (up to 120 ms), so this is a host-dependent tradeoff, not an underrun counter. Measure before enabling dense polyphony on tighter CPU budgets.
- Not verified: listening quality, physical iOS/Android interruption behavior, locked Playwright 1.56.1, Firefox, Linux WebKit CI and any npm registry operation (`npm whoami` previously returned ENEEDAUTH). Desktop automation does not earn physical-device acceptance.
- **Waiver:** v1.6 was released on GitHub at the maintainer's explicit request without a fresh independent A/B/C/D review (see SECURITY.md). It is not eligible for npm publication until that review record exists.

## v1.5

Package version 1.5.0. GitHub release distribution and npm registry publication are separate operations; the historical v1.4 artifact remains immutable.

### Complete expressive playback and lifecycle

- Return correlated command IDs/accepted-or-rejected events for stop, controls, all-notes-off, panic, mix gain and tuning. Queue-full/inactive commands no longer fail silently; acceptance is admission, not a future-execution promise.
- Add allNotesOff with natural release and queue-bypassing panic with immediate tail removal; add context/reset events and reliable host gate cleanup across close/failure/interruption.
- Add independent optional 0–10-second expression/pan/modulation ramps, preserving immediate defaults and pitch-glide semantics.
- Add 0–1 pre-tanh mix gain and phase-preserving global A4/128-note cents tuning; browser notes now accept fractional MIDI like offline notes.
- Replace saturated patch-cache inline fallback with bounded content-key LRU registration replacement; queued/active voices retain original prepared snapshots.
- Add bounded prepareSequence/renderSequence/playSequence with shared note/control/stop ordering, frame rounding, tuning and release tails.
- Canonicalize voice format 4 with sine/triangle/saw/square LFO waveforms; retain versions 1/2/3 under old field rules. Add oldest/release-first/quietest stealing without instantaneous zero-crossing decisions.
- Default context interruption to cancel; preserve is explicit. Non-running contexts/resets stop lookahead, with error reporting and gesture-driven restart rather than stale replay.
- Observe context state before and after native resume rather than relying only on queued statechange notifications; cancel interrupted gates and diagnostics reliably without duplicate interruption resets.
- Add example 08 with native playback, same-score WAV, gain/tuning/stealing controls, suspend/recovery/disposal, bounded local observation export and manually confirmed physical-device scenarios.

### Independent numerical and security acceptance

- Add index-16 Bessel PM spectral references at 44.1/48/96 kHz with separate brightness and alias bounds, a contractive delayed-feedback reference for feedback 7/level 0.25, and conservative full-level feedback energy bounds. Chaotic full-level feedback does not admit unique alias/harmonic separation; no all-patch or chip-fidelity claim.
- Add two 120-second streaming scenarios for held AM/PM and repeated interrupted glides; verify continuity, deterministic rechunking and terminal silence.
- InputBoundaryReview reviewed A/B; DspSupplyReview reviewed C/D. Reproduced/fixed null mixGain/tuning acceptance and shadowed native render metadata; also reject offset coercion before default-length calculation. Permanent regressions protect unchanged sound/frame state on rejected input.
- Node.js 26.7.0: 157 behavioral tests and strict source/development/public-consumer types passed. Full/runtime npm audits found zero vulnerabilities; runtime dependencies remain empty.
- All 1,728 sound-matrix cases and independent/long-stream gates passed. The conservative filter still reports −11.627 dB at 9.6 kHz/48 kHz; improving arbitrary upper-register brightness/aliasing is not claimed.
- Owned sandboxed, explicitly muted Chromium 153.0.8010.12/Playwright 1.63.0 exercised real AudioWorklet signal, cancellation/preservation, routing/lifecycle and the feature UI. Actual backend rate was 24 kHz; all four waveform WAVs decoded as 21,840 stereo PCM16 frames/87,404 bytes. Fresh running-state analyser output confirmed preserve across all three stealing policies; no listening or underrun certification.
- The local device report contained 184 bounded events with every physical-device scenario unconfirmed; nothing was uploaded. No devicectl/adb or real phone was available. npm whoami returned ENEEDAUTH during feature verification: authenticated first npm publication and registry-installed verification remain external prerequisites.
- FinalInputsReview (A/B) and FinalDspReview (C/D) re-reviewed the completed fixes without remaining findings. Native Node installed-tarball runtime and consumer declaration gates passed against the clean 27-module distribution.
- Executed the actual canonical JSON from README and both usage guides with finite nonzero PCM and zero errors. Both unmodified shared-score guide scripts rendered 13,440 frames at 24 kHz in native Chromium, produced analyser signal and closed their owned contexts.
- Final native browser smoke passed. Stress exercised 768 dense notes in 32 batches: 769 started including the initial held note, 760 steals and one intentional late rejection; settled active/pending/error counts were zero. Installed-package Vite 8.3.2 production checks passed for non-root base, CSP, normal assets, missing worklet and incorrect MIME handling.
- Report-only Apple M5/Node 26.7.0 benchmark (48 kHz, 128 frames, 2,000 measured blocks/scenario): eight voices with LFO had p99 2.2315 ms, worst 10.627416 ms and 16 deadline misses; without LFO had 6 misses, raw burst 5, prepared burst 0. No hard budgets were configured; scheduler/GC-sensitive timings are not an underrun counter or realtime guarantee.

### v1.5 release verification

- **Security:** Release15Inputs approved scoped static A/B review; Release15DspSupply approved C/D for this GitHub-only release. No evidence-backed release blockers remained. Reviewers ran no runtime commands; integration checks were performed separately.
- Fresh package 1.5.0 verification on Node.js 26.7.0: 27 JS/map/declaration triplets, all 157 tests, strict source/development/consumer types, source/generated AST gates, installed render/WAV/types and empty runtime dependency tree passed. Root full/runtime and installed Vite tooling audits found zero vulnerabilities.
- All 1,728 sound cases, independent PM/feedback bounds, two 120-second streaming scenarios and 108 preset/conversion cells passed again.
- Owned sandboxed, explicitly muted Chromium 153.0.8010.12/Playwright 1.63.0 passed native smoke/stress and installed-package Vite 8.3.2 production subpath/CSP/MIME/404/license checks again. The actual backend was 24 kHz; stress started 769 notes, stole 760, intentionally rejected one late note and settled with zero active/pending notes and DSP errors. These local runs do not certify locked Playwright 1.56.1, Firefox/WebKit or physical-phone coverage.
- Fresh Apple M5 report-only benchmark (300 warmup blocks excluded, 2,000 measured 128-frame blocks at 48 kHz): eight voices with LFO p99/worst 0.630/2.520 ms and zero misses; raw burst 2.295/12.621 ms and 10 misses; prepared burst 0.914/1.963 ms and zero misses. No hard budgets were configured; these observations are not a universal realtime or glitch-free guarantee.

### WebKit interruption repair

- Initial package 1.5.0 [quality CI](https://github.com/YueyuHoshizora/OPM.js/actions/runs/36999119399) passed Node 22/24/26, Chromium and Firefox but failed Linux WebKit 26.0 interruption cancellation. Publication was paused; the failing assertion was not removed or waived.
- Native suspend/resume promises can settle before queued statechange tasks. Synchronize observation around both initial and existing-node resumes, recording transitions before callbacks and deduplicating notifications.
- Real-processor regressions cover deferred running/suspended notifications over consecutive cycles, both resume/start, cancel/preserve, actual PCM, queued/held cancellation exactly once and borrowed ownership. A separate consumer regression verifies outstanding diagnostics reject at recovery boundaries.
- Release15Inputs re-reviewed A/B after fixing stale observer state; Release15DspSupply re-reviewed C/D. Both scoped static reviews passed without remaining findings; neither reviewer ran runtime gates.
- Rebuilt 27-module distribution, all 159 behavioral tests, strict types, source/generated AST checks and installed-package render/WAV/declarations passed on Node.js 26.7.0.
- Unmodified native smoke passed on owned WebKit 26.6 and sandboxed, explicitly muted Chromium 153.0.8010.12 with Playwright 1.63.0 on macOS arm64, using the repaired distribution and a muted audio graph. Both verified interruption reset, terminal cancellation and silent/empty recovery, with zero DSP errors; actual sample rate was 24 kHz. This is separate from locked Linux WebKit 26.0 acceptance.

## v1.4

Package version 1.4.0. Distributed through the GitHub release tarball; npm registry publication is a separate operation.

### Sound quality and realtime acceptance

- Add a 1,728-case offline matrix across four sample rates, all eight algorithms, feedback extremes, registers, velocities and voice-stealing workloads. Check finite output, headroom, settled release, determinism and render-chunk independence.
- Report controlled passband loss, harmonics 2–8 THD and two isolated ultrasonic folded aliases. These bounds are not hardware-fidelity, arbitrary-FM alias-free or perceptual-loudness claims.
- Add native AudioWorklet stress with 768 dense notes, live controls, scheduled releases, stealing and bounded main-thread contention. Establish actual rendered output before testing a past deadline; a running main-thread clock alone is insufficient during processor startup.

### Prepared patches and expressive notes

- Add opaque immutable `prepareVoice()` snapshots and bounded reusable core voice state. Register/cache up to 128 patches per worklet, with validated inline transport beyond the cache; expose defensive read-only voice-bank snapshots.
- Add `Synth.updateNote()` / `OPM.updateNote()` with relative pitch, linear-in-semitone glide, expression, pan and FM/LFO modulation controls, including scheduled and pending-note updates.
- Make voice version 3 canonical, adding optional per-operator velocity sensitivity. Continue accepting version 1/2 under their original field rules; omitted sensitivity preserves legacy sound. DX7 velocity conversion is an explicitly approximate heuristic.
- Bound terminal notifications after each frame's traversal and reject recursive rendering. Callback-admitted notes begin no earlier than the next frame, preventing callbacks from replenishing an unbounded render loop.

### Audio-clock scheduling and deployment

- Add absolute `at`, scheduled stop, explicit late-start/drop policies and actual lifecycle frame/time stamps. At equal frames, stop precedes onset, then controls; late-start retains the full gate.
- Add bounded `createLookaheadScheduler()` with explicit error handling, restart/disposal and skipped missed windows. Update the finite song and live-control examples.
- Add an installed-tarball Vite example with complete dist and LICENSE copying, non-root deployment, CSP and real MIME/404 acceptance. Add a manual npm trusted-publishing/provenance workflow gated by matching release metadata, security evidence and environment approval; no runtime dependencies are added.

### Preset and DX7 audition

- Add the seventh example: preset/original-synthetic-DX7 A/B audition, register/velocity grids, raw peak/RMS dBFS reports, bounded attenuation-only host trim and offline WAV download. Cover seven bundled presets plus five generated converter recipes, not copyrighted third-party banks or a six-operator reference renderer.
- Keep the mobile report horizontally scrollable inside its container. Update README, both executable usage guides, deployment/publishing guidance and the security policy.

### Feature verification before release

- **Security:** AllFeaturesInputsReview approved scoped static A/B review; AllFeaturesDspSupplyReview approved C/D after the bounded-callback and deployed-LICENSE fixes. Runtime checks were performed separately by 語喵.
- Node.js 26.7.0: all 108 behavioral tests, strict source/development/consumer types, source/generated AST security gates and installed-package render/WAV/types passed. Build output has 22 JS/map/declaration triplets. Root full/runtime audits and the installed Vite consumer audit found zero vulnerabilities; runtime dependencies remain empty.
- All 1,728 sound cases and 108 preset/conversion cells passed. Thirty-two legacy stereo PCM cases were bit-identical to shipped tag `v1.3`, covering four rates, eight algorithms, LFO, polyphony, stealing and release. A 256-prepared-note/control/steal render allocated zero additional Float64 state arrays after construction; this is not a whole-JavaScript zero-allocation guarantee.
- Owned isolated headless Chromium 153.0.8010.12 with Playwright 1.63.0, sandboxing and explicit audio muting passed native smoke and stress: 769 accepted/started notes, 760 steals, one intentional late rejection, peak 0.672, final active/pending counts zero and no DSP errors. This is not locked Playwright 1.56.1, Firefox/WebKit or current remote-CI coverage.
- The same silent browser exercised both guides' absolute-control and eight-note lookahead recipes, restart/stop/disposal, live controls, a complete 24-second song and audition A/B/restart. The 390-pixel catalog/report stayed within the viewport. A persisted audition WAV decoded as 40,513 stereo PCM16 frames at 48 kHz (162,096 bytes).
- Vite 8.3.2 production acceptance passed under `/opm-example/`: real signal/lifecycle, blocked inline CSP script, missing-worklet and wrong-MIME failures, and exact deployed LICENSE contents.
- Apple M5 / Node 26 report-only benchmark excluded 300 warmup blocks and measured 2,000 blocks per scenario. Raw burst p99/worst were 1.038/1.402 ms; prepared burst p99/worst were 1.238/2.470 ms, with no missed 2.667 ms deadlines. Scheduler/GC variance and other hosts prevent a universal realtime guarantee.
- npm registry publication is not part of this GitHub release. Local npm authentication was unavailable during feature verification; trusted-publisher/environment setup and release-specific approval/evidence remain prerequisites for the manual publishing workflow.

### v1.4 release verification

- **Security:** Release14Inputs approved static A/B review, including WAV/render and application file boundaries; Release14DspSupply approved static C/D review for this GitHub-only release. Neither reviewer executed runtime checks; no evidence-backed release blockers remained.
- Fresh package 1.4.0 verification on Node.js 26.7.0: 22 JS/map/declaration triplets, all 108 tests, strict typechecks, source/generated AST gates, installed render/WAV/types, zero runtime dependencies and both root audits passed. All 1,728 sound cases and 108 preset/conversion cells passed again.
- Owned sandboxed headless Chromium 153.0.8010.12 with Playwright 1.63.0 and explicit audio muting passed native smoke/stress and installed-package Vite production checks again: 769 accepted/started notes, 760 steals, one intentional late rejection, zero DSP errors and no final active/pending notes. Locked-browser and remote-CI results are separate evidence.
- Fresh Apple M5 report-only benchmark: raw burst p99/worst 1.131/3.303 ms with one missed 2.667 ms deadline; prepared burst p99/worst 0.913/1.133 ms with zero misses. These host-dependent wall-clock observations are not a universal realtime guarantee.

## v1.3.0

### Release verification and security review

- **Security:** independent reviewers **Release13Inputs** (A/B, including the v1.2.0 release diff) and **Release13DspSupply** (C/D, current source/build/package controls) approved scoped static reviews with no evidence-backed blockers. Runtime checks were executed by 語喵, not the reviewers.
- Fresh local verification on Node.js 26.7.0: build produced 21 JS/map/declaration triplets; all 73 tests, strict source/development/consumer typechecks, AST security gates and both npm audits passed (zero vulnerabilities). The runtime dependency tree is empty. Installed v1.3.0 package rendering produced 1,440 frames and a 5,804-byte WAV; installed consumer types passed.
- Real Chromium 153.0.8010.12 AudioWorklet smoke passed on macOS arm64 using the existing Playwright 1.63.0 launcher: stereo/pan, note lifecycle, routing, suspend/resume and context ownership passed with zero DSP errors. Locked Playwright 1.56.1 Chromium installation did not complete locally; this is not locked-browser coverage.
- Observed pre-release [quality CI](https://github.com/YueyuHoshizora/OPM.js/actions/runs/36961878570) for `b177bed` passed Node 22/24/26 and Chromium/Firefox/WebKit jobs; [Pages deployment](https://github.com/YueyuHoshizora/OPM.js/actions/runs/36961878648) also passed. These runs precede the release metadata commit.
- Apple M5 / Node 26 benchmark excluded 300 warmup blocks and measured 2,000 blocks per scenario. Burst p99 was 1.121 ms, worst 1.534 ms, with zero missed 2.667 ms deadlines. This report-only local measurement is not a universal realtime guarantee.

### Detailed English website security policy

- Expand the English security policy with deployment, upload/download limits, voice/DX7/PCM boundaries, scheduling, audio safety, privacy and private reporting guidance. Preserve mandatory security-review triggers and checklists.
- Link the policy from the example catalog. Browser verification confirmed the link and HTTP 200 for the hosted policy.

### Website favicon

- Add an original 16/32/48-pixel `favicon.ico` and link it from the catalog and all six examples.
- Browser decoding and visual inspection confirmed the 48-pixel image and all three ICO directory entries.

### English example catalog

- Turn the root `index.html` into a six-example English catalog. Add basic notes/voices, stereo/per-voice LFO, shared AudioContext routing and offline WAV examples. Move the song to `examples/song.html` and the advanced playground to `examples/playground.html`; remove the old `demo/index.html` route.
- Keep all six TypeScript helpers in `demo/` and build matching minified JS, embedded-source maps and genuine compiler-generated declarations. The build emits 21 JS/map/declaration triplets.
- Browser smoke exercised English hold/release, pan/LFO settings, song start/stop, key scaling and real AudioWorklet diagnostics. Disposing and restarting OPM retained the running host context. The 390-pixel catalog had no horizontal overflow. Fix wrapped heading links so their entire title block is clickable; actual catalog navigation then started and released a note successfully.
- Offline WAV smoke produced 11,246 stereo frames at 22,050 Hz (45,028 bytes), verified RIFF/WAVE, PCM16, sample rate and non-silent samples. The download action was exercised, but persisted browser-download files were not observed.
- Verification: build, 73 behavioral tests, strict source/development/consumer typechecks, zero-runtime-dependency/dynamic-code gates and isolated installed-package rendering/WAV/types passed on Node.js 26.7.0. Remote CI and Firefox/WebKit were not run; full timed song completion was not verified by the browser automation.

### Node.js 22 minimum

- Align root lockfile metadata and support/development documentation with the upstream package requirement of Node.js `>=22.0.0` and CI matrix of 22/24/26.
- The maintainer reports Node.js 22 tests passing; this session's local checks ran on Node.js 26.7.0.

### Complete JavaScript/map/declaration triplets

- Preserve engine source-module paths instead of bundling into hashed chunks, allowing every emitted JS to retain genuine compiler-generated export declarations. Generate declarations for both demos as well; their `export {};` accurately represents modules with no public exports.
- Enforce a matching `.js.map` and `.d.ts` for every JS before replacing `dist/`, and in the isolated package gate. Remove obsolete chunk output and update deployment documentation.
- Verification by 語喵: 17 JavaScript files, 17 matching source maps, and 17 declarations in both the rebuilt tree and package manifest. Embedded sources match original TypeScript. Build, 73 behavioral tests, strict source/development/consumer typechecks, AST/security checks, and installed-package rendering/WAV/types passed.
- Real Chromium 153.0.8010.12 AudioWorklet smoke passed with preserved module imports on macOS arm64 using the existing matching Playwright 1.63.0 launcher; stereo, pan, note lifecycle, routing, suspend/resume, and context ownership passed with zero DSP errors. Remote CI and locked-browser runs were not performed.

### Minification and TypeScript source maps

- Minify every distribution JavaScript module, including both demos, through the shared safe Terser pipeline. Emit a matching `.js.map` and relative `sourceMappingURL` for each module; compose esbuild/Terser mappings back to original TypeScript with embedded source contents.
- Include maps in the package whitelist and distribution allowlists. Keep `.d.ts` declarations and omit JSON assets/compressed sidecars. Publishing source maps exposes the embedded source, as documented in README and both usage guides.
- Verification by 語喵: build, 73 behavioral tests, strict typechecks, AST/security gates, and isolated installed-package rendering/WAV/types passed. All 16 JS files have corresponding packaged maps; every embedded TypeScript source matches its source file exactly. A real invalid-voice exception under Node `--enable-source-maps` resolves to `src/voices/normalize.ts:9:11`, rather than generated chunk coordinates. Three re-export-only entry modules correctly have empty source mappings.
- Visually exercised electric-piano hold/release/diagnostics and song start/stop after demo minification, with no page errors. Real Chromium 153.0.8010.12 AudioWorklet smoke passed on macOS arm64 using the existing matching Playwright 1.63.0 launcher, covering stereo, pan, lifecycle, routing, resume, and context ownership. Remote CI and locked-browser runs were not performed.

### JavaScript-only distribution assets

- Restrict `dist/` to `.js` and generated `.d.ts`; remove JSON assets and gzip/Brotli sidecars from build output. Move canonical bundled data to typed modules: `opm.js/voices/examples.js` exports `examples`, and `opm.js/voices/voice.schema.js` exports `voiceSchema`. Remove the obsolete generic asset export; external JSON voice-bank input remains supported.
- Update demo loading, package exports, consumer declarations, and both usage guides. The seven presets and schema were compared against their previous JSON data and match exactly.
- Verification by 語喵: build, 73 behavioral tests, strict source/development/consumer typechecks, source/dist AST gates, and isolated installed-package rendering/WAV/types passed. The package smoke checks every packaged distribution file against the `.js`/`.d.ts` allowlist. Visually exercised electric-piano hold/release and diagnostics in the rebuilt demo; no page errors or DSP errors.
- Real Chromium 153.0.8010.12 AudioWorklet smoke passed on macOS arm64 using the existing matching Playwright 1.63.0 launcher, covering stereo, pan, lifecycle, routing, resume, and context ownership. This is not remote CI or locked-browser evidence.
- **Security:** 語喵 reviewed scoped A/B/C/D requirements: bundled assets contain only preserved literal data, bank validation still runs before demo registration, worklet/DSP boundaries and limits are unchanged, and no dependency or dynamic execution was added. This is a scoped author review, not an independent review.
- Development/runtime audits reported zero vulnerabilities; the runtime dependency tree is empty.

### TypeScript source cutover

- Preserve published structural `OPM`/`Synth` class contracts by stripping implementation-only declaration members; retain the literal bank-size type and optional event callback. Installed consumer checks cover adapters and the literal limit. The test entrypoint enumerates filenames without shell globs and forwards Node runner options for Node 18/Windows compatibility (Windows execution not observed); diagnostics filtering and reporter selection were exercised on Node 18/26.
- Migrate engine, AudioWorklet, voice parsers, demos, behavioral tests, and development tools to strict TypeScript, following [XYZ.js](https://github.com/YueyuHoshizora/XYZ.js)'s source/generated-declaration approach. Remove obsolete JavaScript source and handwritten declarations; keep public `.js` package/deployment URLs and zero runtime dependencies.
- Generate declarations from implementation, compile development programs into ignored `.dev/`, and build external `dist/demo/` modules for both HTML demos. Preserve npm and Node 18+ compatibility rather than adopting XYZ.js's newer platform requirement. CI invokes the compiled tooling through npm scripts.
- Verification by 語喵: build, complete strict typecheck, 73 behavioral tests on Node 26.7.0 and Node 18.20.8, TypeScript-source/JavaScript-dist AST gates, installed ESM/WAV/type smoke, and development/runtime audits (zero vulnerabilities). All original behavioral test titles remain; the former 74 count included automatic discovery of the fixture-only module, now excluded by explicit `*.test.js` selection.
- Released v1.2 DSP versus compiled TypeScript and rebuilt distribution: 248 cases, 4,504,320 compared channel samples, exact Float32 equality, plus matching WAV bytes. Covers algorithms, stereo pan, sample rates, and burst stealing; this is scoped parity evidence, not hardware fidelity.
- Apple M5 / Node 26: unchanged 300-warmup/2,000-block benchmark passed all p99 budgets; burst p99 0.868 ms, zero missed deadlines against 2.667 ms. No universal deadline guarantee.
- Real rebuilt AudioWorklet smoke passed Chromium 153.0.8010.12 and WebKit 26.6 on macOS arm64 using the existing matching Playwright 1.63.0 launcher (not the locked CI browser versions). Both HTML demos were visually checked and exercised for held/released notes, WAV generation action, and song start/stop. Browser download persistence was not verified. Firefox and remote CI were not run for this migration.
- **Security:** independent **TsSecurityReview** approved static A/B/C/D review with no findings: runtime validation remains beneath erased types, bounded voices/messages/binary input and own-data checks remain, declaration fields do not add runtime initializers, tooling is exactly pinned, and runtime dependencies remain empty. Runtime checks above were executed by 語喵, not the reviewer.

## v1.2.0

### CI failure repairs

- Inspect [the first quality run](https://github.com/YueyuHoshizora/OPM.js/actions/runs/36922999106): Node 18/22 passed functional gates but exceeded the unchanged 2.667 ms burst p99 budget (3.205/3.019 ms); Firefox timed out without stage diagnostics.
- Reduce attack/decay/release envelope exponentiation within each 4x output frame. Re-anchor analytic gain every frame and retain direct evaluation at stage boundaries; validation, eight-voice/eight-fade bounds, workload, and deadline budget remain unchanged. Double-precision rounding can differ from the previous implementation; no universal byte-identity promise.
- Provide Linux Firefox CI with a running native PulseAudio server and null output sink. Keep real AudioContext/AudioWorklet processing and trusted clicks; add stage, audio-clock/context, and request/error diagnostics rather than autoplay overrides or fake audio.
- Verification: Node 18.20.8 and 22.23.3 each passed 74 tests, including analytic envelope boundaries and very short stages. Build, public types, AST/security and installed-package ESM/type smoke passed. On Apple M5, the unchanged 300-warmup/2,000-block benchmark passed every p99 gate; burst p99 was 1.499/1.478 ms with zero missed deadlines in those runs. These measurements do not prove the GitHub x64 hosts' performance.
- Audio comparison covered 387 cases and 2,045,248 channel samples, including burst steals at 8–192 kHz: observed Float32 output matched the previous implementation exactly; source/distribution parity also passed the same cases.
- Locked Playwright 1.56.1 / Firefox 142.0.1 passed real stereo, held/released notes, routing, suspend/resume, diagnostics and context ownership smoke against built assets on Linux arm64 with PulseAudio. The local host was Ubuntu 26.04 using Playwright's Ubuntu 24.04 arm64 binary override, not the GitHub Ubuntu 24.04 x64 runner. Chromium 153 and WebKit 26.6 smoke also passed on macOS using the existing matching Playwright 1.63.0 launcher. The repaired external CI run has not yet been observed.
- **Security:** independent source reviewer **CiRepairSecurity** approved scoped A/B/C/D checks with no blockers: finite/bounded frame-local envelope computation, unchanged trust boundaries, and native CI audio setup. 語喵 executed the integration checks above; the reviewer did not execute runtime gates.

### Final deadline repair

- The follow-up CI run still exceeded the unchanged burst deadline on Node 22 (p99 3.043 ms, 31 misses). Replace hot-loop base-10 exponentiation with `exp(db * ln(10) / 20)` without changing envelope stages, re-anchoring, bounds, or the benchmark workload/budget.
- Fresh verification passed 74 tests on Node 26 and Node 22.23.3, build, public types, AST/installed-package gates, and both npm audits (zero vulnerabilities). Apple M5 / Node 22 burst p99 was 1.009 ms with zero misses against the original 2.667 ms budget; external CI must independently confirm runner performance.
- Independent reviewer **ReleaseExpSecurity** approved the final arithmetic change under A/B/C/D with no blockers (static review only). Real Chromium AudioWorklet smoke passed again against rebuilt assets using the cached Playwright 1.63 launcher; remote locked-browser gates remain authoritative.

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
