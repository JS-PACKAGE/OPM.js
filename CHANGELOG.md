# Changelog

For installation and executable examples, see the [README](./README.md#getting-started) and the [English](./doc/usage.en.md) / [繁體中文](./doc/usage.zh-TW.md) usage guides.

## Unreleased

### Repository browser scripts observed on this host

- With the pinned Playwright 1.56.1 browsers (chromium-1194, firefox-1495, webkit-2215) installed, `npm run browser-smoke` and `npm run browser-stress` passed for Chromium, Firefox and WebKit with zero errors (macOS arm64, HEAD `9657585`). `npx playwright install` stalled at the archive extraction step after a complete download here, so the cached zips were extracted with the system `unzip` and marked `INSTALLATION_COMPLETE`; the cause of the stall was not investigated. This supersedes earlier notes that the bundled Chromium could not launch on this host. Physical-device, MIDI-hardware and human-listening acceptance remain unverified; no source, API or dependency changed.

### Sample-frame arrangement fade completion

- Fixed layer gain reconstruction measuring a positive fade in rounded seconds while the engine ramps in sample frames. A note whose onset fell exactly where a fade completes (for example a 0.3 s fade at 16 or 48 kHz) was seen as about 1e-16 s short, so every chord note received a phantom one-sample ramp; an 86-note chord then exceeded the 256-command lookahead budget and stopped the arrangement. Elapsed time is now counted in rounded sample frames and compared with `fade × sampleRate`; sub-sample and subnormal fades keep their ramp, and no budget or tolerance was relaxed.
- Added a consumer regression (86-note chord starting as a 0.3 s fade completes) that fails on the previous implementation. All 566 behavioral tests and strict/public/Node-only type checks pass; declarations are unchanged. A native Chrome 150 public OPM/AudioWorklet smoke at 48 kHz stayed running with zero scheduler/browser errors; this is functional coverage, not PCM identity or listening acceptance.

### Exact completed arrangement fade targets

- Fixed positive layer fades reconstructing a completed endpoint through `from + (target - from) * 1`. Cancellation could lose a small target and corrupt the starting value of the next fade. Completed progress now copies the admitted target directly, including its signed zero; in-flight interpolation, remaining-duration arithmetic, zero fades, timing tolerances and resource limits are unchanged.
- Extended the existing canonical-PCM gain regression to a completed positive fade as well as an instantaneous change. The former implementation failed the positive case; all 565 behavioral tests and strict/public/Node-only type checks passed after the fix.
- Six independent offline-oracle cases at 16/48 kHz and 0.1/0.2/0.3-second fades matched all 653,568 corrected Float32 channel samples in each of Node 26 and Chrome 150. Each baseline case disagreed with that oracle. Corrected endpoints intentionally replace the erroneous baseline rather than promising old trace/PCM parity.
- Rebuilt compiler/minified consumers matched 48 scheduling scenarios and 80 positive-duration scenarios per runtime, including subnormal/sub-sample fades, section retargeting, tempo changes, pause/resume, capacity rejection and invalid admission. Separate before/after comparisons preserved a 16-case one-/ten-second overlap corpus (9,971,712 raw Float32 channel comparisons) and 24 inherited-tempo-getter reentrancy cases (1,179,648 comparisons) per runtime.
- Two native public OPM/AudioWorklet graphs at the observed 48 kHz exercised gain changes, same-boundary section replacement, pause/resume and tempo replacement. Both retained four active voices, zero diagnostic errors/rejections, closed contexts and disposed nodes. Native clocks differed; this is functional coverage, not native PCM identity, physical-device or listening acceptance.
- Public APIs, declarations, voice format and dependencies are unchanged. Rebuilt minified runtime grows by 15 bytes; scoped integration-owner review is recorded in SECURITY.md, not independent release approval.

### Exact zero-duration arrangement fades

- Fixed layer gain reconstruction treating a zero-duration change as a tiny positive ramp when the musical onset rounds down to an audio sample. The resulting redundant controls could make an otherwise valid 86-note chord exceed the unchanged 256-command lookahead budget and fail to start. Exact zero fades now resolve directly to their admitted target with zero remaining duration; no resource limit, admission check or timing tolerance was relaxed.
- The same direct resolution avoids cancellation in `from + (target - from) * 1`, which could lose a small instantaneous target before a later fade. Both signed zeros receive this handling; every positive duration, including `Number.MIN_VALUE`, retains the original interpolation arithmetic. Corrected zero-fade output intentionally follows the exact target rather than preserving the erroneous baseline.
- Added two consumer regressions, each observed failing before the fix and passing afterward: rounded-startup chord admission with canonical offline PCM, and an instantaneous small target followed by a same-scale positive fade. Existing tests remain unchanged; all 564 behavioral tests and strict/public/Node-only type checks passed.
- Actual rebuilt compiler/minified consumers preserved 80 positive-fade scenarios across four graphs per runtime in Node and Chrome: 49,858,560 raw Float32 channel comparisons and 66,478,080 rendered channel samples each. Coverage includes 8/16/48/96 kHz, one/four layers, subnormal/sub-sample/ordinary/ten-second fades, same-boundary section retargeting, gain edits and tempo replacement. Four separate signed-zero oracle cases at 16/48 kHz matched canonical offline PCM across 435,712 channel samples per runtime; the unmodified small-target cases did not match that oracle.
- Live native Chrome 150 reproduced the density failure without processor or validator instrumentation. These actual-48-kHz startup trials used different live epochs, so counts are observed smoke outcomes, not failure-rate estimates or identical-clock PCM comparisons:

| Native dense-score version | Failed startups / 8 | Phantom startup ramps |
| --- | ---: | ---: |
| Baseline | 1 | 85 |
| Corrected | 0 | 0 |

- Every corrected native dense trial retained 32 active voices with zero diagnostic errors/rejections. Two additional native public graphs exercised section retargeting, gain changes, pause/resume and tempo replacement. All four contexts closed and nodes were disposed; the single expected baseline scheduler failure was distinguished from processor/browser errors, which remained absent. Physical-device/listening acceptance is still unverified.
- Direct native constructor controls also showed this browser environment returning 48 kHz for online rate requests while OPM forwarded the requested rate unchanged; offline contexts honored their requested rates. No engine workaround was added. Public APIs, declarations, voice format and dependencies are unchanged; rebuilt minified runtime grows by 30 bytes. Scoped integration-owner review is recorded in SECURITY.md, not independent release approval.

### Ordered arrangement gain-history pruning

- Removed per-entry `slice()` copies and nested callback creation from arrangement gain-history pruning. The existing private records stay in beat order through initialization, numeric sorting, stable filtering and pause reconstruction; an indexed scan can stop at the first future entry. The original same-layer and `played + EPSILON` predicate, stable result order, future changes, resource checks and callback/cancellation behavior remain intact. The outer `filter()` result still allocates; no scratch collection, cache, field, public option or dependency was added. Minified runtime grows by 63 bytes; declarations are unchanged.
- Actual minified public scheduler measurements used a fixed-clock Web Audio host, admitted note patterns and staggered future gain edits; they do not time DSP rendering or simulate real-time deadlines. Node 26 / Apple M5 used 48 fresh processes (12 workloads, both sequential import orders, two cohorts); Chrome 150 used 24 fresh-document comparisons in both orders. Each used nine alternating sample pairs, 8,192 or 32,768 warmups and 2,048–65,536 calls/sample according to history size. Ranges are paired time changes, not confidence intervals; negative is faster:

| Layers / pending gain edits | Node | Chrome |
| --- | ---: | ---: |
| 1 / 0 | −15.84% to −11.22% | −15.61% to −11.33% |
| 4 / 0 | −29.44% to −18.04% | −29.17% to −28.47% |
| 16 / 0 | −31.96% to −30.51% | −23.21% to −21.04% |
| 4 / 64 | −84.11% to −78.12% | −80.84% to −79.92% |
| 16 / 240 | −93.88% to −87.62% | −92.75% to −92.30% |

- The other one/two/eight-layer, mixed-history, maximum-history and empty-pattern controls also improved in both runtimes. Ordinary arrangements have tiny absolute bookkeeping costs; no whole-synth, startup, heap/GC, physical-device or deadline improvement is claimed. Earlier counterfactuals were rejected: an unrestricted indexed suffix scan regressed some forward-import large-history cases, while a per-pump Map regressed the one/two-layer controls. The retained version uses the existing sorted-history invariant rather than extra state.
- Actual rebuilt compiler/minified consumers matched 48 scenarios across four API/processor graphs per runtime in Node and Chrome: 30,827,520 raw Float32 channel comparisons and 41,103,360 rendered channel samples each. Cases cover 16/48 kHz, one/four/sixteen layers, future targets, signed-zero/subnormal gains, simultaneous expression ramps, section retargeting, tempo edits, pause/resume, reentrant gain edits, capacity rejection and getter-free invalid admission. Existing consumer tests remain applicable; no private-layout or copied-implementation test was added.
- Two final public native OPM/AudioWorklet graphs at the observed 48 kHz exercised gain changes, same-boundary section retargeting, pause/resume through the next authored onset and tempo replacement. Both retained the expected gain targets, four active voices, zero diagnostic errors/rejections, closed contexts and disposed nodes. This is functional native coverage, not identical-clock native PCM comparison or listening acceptance.
- Build, all 562 behavioral tests and strict/public/Node-only type checks passed. Rebuilt minified output exactly matched the measured candidate; integration-owner scoped A/C/D review is recorded in SECURITY.md. Public APIs, voice format and README behavior are unchanged; this is not release approval.

### Bounded effects tap indices

- Replaced `Math.floor()` only for the private wrapped delay-tap index with the existing DSP convention `index | 0`. Admitted sample rates and delay lengths bound every ring to 19,202 cells; the finite, nonnegative index fits Int32 and cannot be negative zero. The existing exclusive-endpoint correction remains before conversion, and interpolation keeps the same base/fraction and floating-point order. No branch, cache, field, view, buffer, dependency or public contract was added. The rebuilt minified runtime is 10 bytes smaller.
- Initial controls used 96 fresh Node processes and 96 Chrome fresh-document comparisons, including static audio/silence/idle/feedback, sparse/full/repeated-target updates, zero/positive/maximum pre-delay, one/four voices, 4,096-frame and empty/single-frame calls. Some short-block results were substantially negative: one Node feedback cohort regressed 30.6%, a Chrome maximum-pre-delay case 27.7%, and Chrome reverb-ramp cases about 10%. These magnitudes did not recur in the longer experiment below; they are not discarded or assigned a speculative JIT/GC explanation.
- The longer experiment used 32,768 warmups and nine alternating pairs of 2,048 calls per sample, at 48 kHz and 128 frames/call. Node 26 / Apple M5 used 32 fresh processes: two cohorts of eight cases in both sequential import orders. Native Chrome 150 used 16 fresh-document cases in both orders. Complete public replacements every eight calls include normalization/target generation; ranges below are paired time changes, not confidence intervals (negative is faster):

| Long workload, time change | Node | Chrome |
| --- | ---: | ---: |
| Static four-voice chorus | −3.89% to −1.20% | −2.81% to −2.74% |
| Full chorus → reverb replacement | −3.31% to +1.66% | −3.65% to −3.21% |
| Static reverb, 18 ms pre-delay | −3.24% to +0.75% | −0.50% to −0.46% |
| Static reverb, zero pre-delay | −0.21% to +0.59% | +1.02% to +2.74% |

- Longer sparse/repeated-target reverb controls remained mixed; no universal reverb, whole-synth, startup, GC, allocation or real-time deadline improvement is claimed. The retained change is a bounded tap-conversion improvement with no new state, supported most consistently by active multi-voice chorus and full-chain updates. The default-zero-pre-delay control's reverse results remain part of the evidence.
- A throwaway arithmetic check covered all 184,001 admitted integer sample rates and 115,212 index boundaries, including adjacent floating-point values: base/fraction bits matched throughout the derived domain. Negative zero was explicitly excluded by the position/positive-delay/wrap invariants, not silently treated as equivalent.
- Actual rebuilt compiler/minified consumers matched 636 cases and 96,587,472 processed frames across four graphs per runtime in both Node and Chrome. This includes all one-to-four-voice transitions, omitted sections, partial blocks, repeated updates, reset, invalid voice admission, signed-zero/subnormal/sub-sample/maximum pre-delays, finite output and metadata ownership. The rebuilt minified FX exactly matched the measured candidate. Build, all 562 behavioral tests and strict/public/Node-only type checks passed; existing consumer regressions remain applicable without private-layout or copied-implementation tests.
- All 64 final static public native Worklet graphs retained baseline PCM and matched the captured-input core oracle across 715,776 channel samples. Another 12 public update/reset graphs matched the ordinary-control core oracle across 786,456 channel samples. The separate 12 near-underflow graphs retained baseline native PCM and the existing explicit-zero-pre-delay counterfactual across another 786,456 channel samples, not same-parameter cross-runtime parity. Raw capture, rather than final AudioBuffer readback, remains the oracle; the existing readback differences and documented native near-underflow behavior were not changed or hidden with tolerances.
- All 88 native contexts closed and FX instances were disposed; all 216 deliberate invalid-message fence errors were accounted for, with no unexpected processor/console errors or processor/validator instrumentation. Integration-owner scoped A/C/D review is recorded in SECURITY.md. APIs, voice format, README behavior and logical buffer-payload bounds are unchanged; this is not release approval or physical-device/listening acceptance.

### Frame-local effects ramp endpoint

- Moved the last-ramp-frame decision outside the 21-coefficient loop. Intermediate frames retain the original subtraction/division/addition order; the endpoint copies the existing private target buffer with the same native `set()` operation already used by construction/reset. Exact target bits, including signed zero, are retained before DSP runs and the ramp clock still advances once per sample. No equality shortcut, array, view, cache, state, dependency or API was added. The minified runtime grows by 23 bytes.
- Actual minified consumers used 8,192 warmups and nine alternating pairs of 256 calls/sample. Node 26 / Apple M5 used two fresh processes per case; native Chrome 150 used fresh pages with sequential initialization in both orders. These 48 kHz, 128-frame medians include complete public configuration replacement every eight calls and its target-generation cost:

| Full-ramp case, µs/operation | Node before | Node after | Chrome before | Chrome after |
| --- | ---: | ---: | ---: | ---: |
| Reverb only | 10.94–10.96 | 9.54–10.14 | 10.39–11.00 | 9.47–10.08 |
| Chorus only | 13.91–14.19 | 13.26–13.98 | 14.57–15.59 | 13.65–14.51 |
| Chorus → reverb | 15.33–15.35 | 14.60–14.93 | 15.02–20.23 | 13.69–19.06 |
| Redundant dry replacement | 8.94–9.60 | 8.20–8.80 | 9.65–9.86 | 8.57–8.79 |

- Single-control and repeated-target browser automation also improved in both initialization orders. Static audio/silent/idle/feedback controls and 4,096-frame consumers were mixed, including regressions; one Node full-chorus cohort regressed slightly, and later Node sparse/repeated-target timings varied substantially with some regressions. The final two browser controls resumed after a native transport reset with Chrome 150 verified; completed controls were not rerun. These are paired workload observations, not universal throughput, GC or real-time deadline guarantees.
- Actual rebuilt compiled/minified graphs matched 156 stateful cases and 61,982,544 processed frames per runtime in Node and Chrome. Another 24 repeated-update/alias/input-boundary cases matched 3,145,824 processed frames, 1,920 updates and 192 resets per runtime. The rebuilt minified runtime exactly matched the measured candidate. All 562 behavioral tests and strict/public/Node-only checks passed; existing behavioral coverage remains applicable without private-layout or copied-implementation tests.
- A throwaway Node raw-word check matched 1,024 finite endpoint copies and 21,504 cells, including signed zero/subnormals. A library-free native Worklet matched 63 raw-word copies and 1,323 cells across constructor, process and suspended-message callbacks, retaining the source's subnormal/negative-zero bits.
- All 64 final static public native Worklet graphs retained baseline PCM and matched the core oracle across 715,776 channel samples. Another 12 actual public update/reset graphs matched the ordinary-control core oracle across 786,456 channel samples; the separate 12 near-underflow graphs retained baseline native PCM and the existing explicit-zero counterfactual across another 786,456 channel samples, not same-parameter cross-runtime parity. All 216 deliberate invalid-message fence errors were accounted for; no validator, numeric threshold or processor instrumentation was introduced.
- All 88 native FX contexts and the separate copy-control context closed; FX instances were disposed with no unexpected processor/console errors. Scoped integration-owner A/C/D review is recorded in SECURITY.md. Public APIs, voice format, buffer payload bounds and README behavior are unchanged; physical-device/listening acceptance remains unverified.

### Contiguous effects coefficient targets

- Removed the unused, always-zero padding slot between reverb controls and comb gains. Each private coefficient array now holds 21 rather than 22 Float64 values, removing one interpolation per ramped sample and 16 bytes of logical per-instance array payload across both arrays. Existing scalar positions, arithmetic, admission, update/reset semantics and public contracts are unchanged; no branch, cache, view, state or dependency was added. The minified runtime size is unchanged.
- Actual minified consumers used 8,192 warmups and nine alternating pairs of 256 calls/sample. Node 26 / Apple M5 used two fresh processes per case; native Chrome 150 used fresh pages with sequential initialization in both orders. These 48 kHz, 128-frame medians include public configuration replacement every eight calls and its normalization/target-generation cost, not just interpolation:

| Ramped case, µs/operation | Node before | Node after | Chrome before | Chrome after |
| --- | ---: | ---: | ---: | ---: |
| Reverb only | 9.15–9.65 | 9.08–9.54 | 9.94–13.03 | 9.79–12.85 |
| Chorus only | 12.04–12.59 | 11.90–12.32 | 12.99–17.05 | 12.93–17.05 |
| Chorus → reverb | 13.14–13.15 | 13.08–13.10 | 13.71–15.57 | 13.63–15.49 |

- Static, idle, feedback-only, reverse-order and 4,096-frame controls were also measured. Gains were small; idle Node controls and some feedback/reverse-order/browser large-block controls regressed. Removing an unused slot is not a universal throughput, allocation/GC or real-time deadline claim. A broader scalar-reindexing prototype was not retained.
- Actual rebuilt compiled/minified graphs matched 156 stateful cases and 61,982,544 processed frames per runtime in Node and Chrome. Another 24 repeated-update/alias/input-boundary cases matched 3,145,824 processed frames, 1,920 updates and 192 resets per runtime. Existing behavioral tests remain applicable; no private-layout or implementation-copy test was added.
- All 64 final static public native Worklet graphs retained baseline PCM and matched their core oracle across 715,776 channel samples. Another 12 graphs exercised actual public update/reset commands at suspended native quantum boundaries and matched the ordinary-control core oracle across 786,456 channel samples. Same-port intentionally invalid commands fenced those updates using the unchanged validator's existing error replies; all 108 expected errors were accounted for.
- A separate 12-graph near-underflow automation diagnostic retained identical before/after native PCM, but did **not** match the same-parameter main-thread oracle. A library-free native Worklet preserved raw subnormal buffer bits while treating the value as zero in comparison/arithmetic; changing only the diagnostic core's subnormal pre-delay to explicit zero explained all 786,456 channel samples exactly. This is an existing runtime boundary, not a tolerance relaxation or input special case; README documents it. Its 108 intentional fence errors were also accounted for.
- All 88 native contexts closed and instances were disposed, with no unexpected processor/console errors. Captured native input/output, not final AudioBuffer readback, supplied the PCM oracle. The rebuilt minified distribution exactly matched the measured candidate. All 562 behavioral tests and strict/public/Node-only checks passed. Scoped integration-owner A/C/D review is recorded in SECURITY.md; physical-device/listening acceptance remains unverified.

### Frame-local chorus coefficients

- Chorus now reads its private current mix/feedback coefficients once per sample frame and reuses those scalar values for tap selection, delay feedback and wet output. The helper still runs after each per-sample parameter interpolation; no arithmetic regrouping, branch, persistent cache, state, array, view or API was added. The minified runtime is 17 bytes smaller.
- Actual minified consumers used 8,192 warmups and nine alternating pairs of 256 calls/sample. Node 26 / Apple M5 used two fresh processes per case; native Chrome 150 used fresh pages with sequential module initialization in both orders. These 128-frame medians are microseconds/operation:

| Case | Node before | Node after | Chrome before | Chrome after |
| --- | ---: | ---: | ---: | ---: |
| Active chorus | 9.13–9.23 | 8.83–9.23 | 9.65–9.96 | 9.20–9.77 |
| Zero-mix, nonzero-feedback control | 8.43–8.59 | 8.63–8.64 | 9.28–9.39 | 9.39–9.43 |
| Audio bypass control | 5.83–5.92 | 5.70–5.88 | 6.39–6.78 | 6.35–6.72 |

- Silent/reverb-only, both effect orders and 4,096-frame chain controls were also exercised. Node's active-chorus cohorts and large-block browser controls were mixed; feedback-only controls regressed slightly. The observed active-chorus browser gain is not a universal throughput, GC or real-time deadline claim.
- Four actual compiled/minified graphs matched 156 stateful cases and 61,982,544 processed frames per runtime in Node and Chrome, including dry-to-wet history, feedback/order ramps, resets, aliases/offsets, metadata shadows and extreme input. Actual rebuilt output matched another 240 mix/feedback-boundary/order/ramp cases and 3,932,640 channel samples across 8–192 kHz, including signed zero and tiny positive coefficients.
- The rebuilt minified distribution matched the measured candidate exactly. All 64 final public native Worklet graphs retained identical baseline PCM and matched their core oracle across 715,776 channel-sample comparisons; contexts closed, instances were disposed and processor/console errors stayed zero.
- All 562 behavioral tests and strict/public/Node-only checks passed, with existing phase/feedback-history regressions retained. Scoped integration-owner A/C/D review is recorded in SECURITY.md. Public APIs, voice format and the README contract are unchanged; physical-device/listening acceptance remains unverified.

### Frame-local reverb damping

- Bound the reverb damping coefficient once inside each sample's reverb frame instead of reading/scaling it inside each of the eight comb iterations. It is still refreshed after every per-sample parameter interpolation; channel order, low-pass/feedback arithmetic, delay writes and public validation are unchanged. No branch, persistent cache, allocation, state or API was added, and the minified module size is unchanged.
- Actual minified consumers used 8,192 warmups and nine alternating pairs of 256 calls/sample. Node 26 / Apple M5 used two fresh processes per case; native Chrome 150 used fresh pages with sequential module initialization in both orders. These 128-frame audio medians are microseconds/operation:

| Case | Node before | Node after | Chrome before | Chrome after |
| --- | ---: | ---: | ---: | ---: |
| Reverb only | 8.54–9.65 | 8.43–9.44 | 9.84–12.52 | 9.65–12.05 |
| Chorus → reverb | 13.02–15.52 | 12.82–14.78 | 12.34–14.77 | 11.91–14.45 |
| Reverse-order control | 12.15–14.74 | 12.11–14.51 | 12.29–13.14 | 12.05–13.75 |

- Bypass, silent, zero-mix/feedback, feedback-only, chorus and 4,096-frame controls were also exercised. Control rows varied, including bypass/reverse-order/large-block regressions in some browser runs. This is a small local coefficient reuse, not universal throughput, GC or real-time deadline improvement.
- Four actual compiled/minified graphs matched 156 stateful cases and 61,982,544 processed frames per runtime in Node and Chrome, with resets, parameter/order ramps, tail transitions, aliased/offset/shadowed views and extreme samples. The rebuilt distribution matched the measured candidate exactly; an additional actual-distribution smoke matched 56 damping-boundary/order/ramp cases and 917,616 channel samples, including signed zero, subnormal/tiny damping and both sample-rate limits.
- All 64 final public native Worklet graphs matched their core oracle across 715,776 channel-sample comparisons, with identical baseline Worklet PCM, closed contexts, disposed instances and no processor/console error. All 562 behavioral tests and strict/public/Node-only checks passed. Existing behavioral coverage remains applicable; no implementation-copy test was added.
- Scoped integration-owner A/C/D review is recorded in SECURITY.md. Public APIs, voice format and the README contract are unchanged; physical-device/listening acceptance remains unverified.

### Inactive chorus tap work

- Chorus tap reads, weighting and trigonometry now run only when the current wet mix or feedback is nonzero. Both ring writes and phase advancement remain unconditional, so later activation retains warm history; feedback-only and arbitrarily small positive controls keep their original path. No arrays, views, caches, state, APIs or dependencies were added.
- These paired minified-consumer timings use the corrected delay-endpoint baseline. Node 26 / Apple M5 used two fresh consumers per case; native Chrome 150 used fresh pages with reversed module-request/instance order. Each 128-frame result is microseconds/operation after 8,192 warmups and nine alternating pairs of 256 calls/sample:

| 128-frame case | Node before | Node after | Chrome before | Chrome after |
| --- | ---: | ---: | ---: | ---: |
| Audio bypass | 8.29–11.36 | 6.81–9.16 | 10.35–12.56 | 8.69–10.49 |
| Silent bypass | 8.71–12.23 | 6.99–9.82 | 11.68–11.72 | 9.45–9.47 |
| Nonzero-depth, zero-mix/feedback chorus | 9.46–13.07 | 6.41–8.97 | 13.20–15.06 | 9.79–11.07 |
| Reverb-only audio | 10.13–12.39 | 8.54–10.57 | 11.50–12.89 | 9.84–11.15 |

- Nonzero-feedback/zero-mix, active chorus, both effect orders and 4,096-frame chain controls were also exercised. Active controls were mostly neutral, with small regressions and varying rows; this is a targeted work reduction, not a universal throughput, allocation/GC or real-time deadline claim.
- Compiled/minified graphs matched 156 stateful cases and 61,982,544 processed frames per runtime in Node and Chrome, including long dry history, later activation/order ramps, resets, aliases/offsets, non-finite/extreme input, signed-zero controls, tiny positive mix/feedback and the repaired fractional endpoints. Six one-shot cases and 12 malformed native-view cases also matched without invoking metadata shadows. Another 2,000,156 seeded IEEE64/signed-zero scalar cases matched canonical zero-feedback storage.
- The actual rebuilt distribution matched the measured minified candidate exactly. All 64 final native public Worklet graphs matched their core oracle across 715,776 channel-sample comparisons and retained identical baseline Worklet PCM. Every context closed and every instance was disposed, with no processor/console error observed.
- A consumer regression compares dry-to-wet activation against an always-wet reference at 16/48 kHz with zero/nonzero feedback, checking the full mix ramp and exact settled output. All 562 behavioral tests and strict/public/Node-only type checks passed. Scoped integration-owner A/C/D review is recorded in SECURITY.md; public APIs, voice format and the README contract are unchanged.

### Fractional effects delay endpoints

- Fixed a single-sample dropout for valid chorus depths and reverb pre-delays: adding a tiny negative ring coordinate to the ring length can round to the exclusive endpoint. The private delay reader now wraps that endpoint to zero before interpolation instead of reading beyond the typed array and later silencing NaN. All other interpolation arithmetic, phase advancement, ring writes, feedback, ramps and validation are unchanged; no allocation, state, dependency or API was added.
- Two consumer regressions failed before the fix and now pass at 8,000, 48,000 and 192,000 Hz. They cover active wet chorus, dry chorus history followed by wet activation, and adjacent reverb pre-delays. All 19 effects tests, 561 behavioral tests and strict/public/Node-only type checks passed.
- In Node 26 and native Chrome 150, four actual compiled/minified graphs matched on the unchanged-path matrix: 132 stateful cases, 52,446,768 processed frames per runtime, 132 resets, six one-shot cases and 12 rejected non-native inputs, without reaching shadowed metadata getters. The matrix includes long prehistory before updates, both orders, aliased/offset views, silence, non-finite/extreme input samples, signed-zero controls and tiny positive mix/feedback.
- Native Chrome 150 exercised 56 public `createEffects()` Worklet graphs. Captured Worklet PCM matched the corresponding core oracle bit-for-bit across 631,024 channel-sample comparisons. The 12 targeted graphs reproduced the old dropout and confirmed the corrected boundary at all three sample rates; the other 44 retained identical baseline output. All contexts closed, every effects instance was disposed and no processor error event was observed.
- Worklet input/output taps isolate the actual DSP from sparse differences also observed in a library-free final `OfflineAudioContext` buffer. No browser controls were disabled and no exact same-input DSP comparison was relaxed. This is not a claim of bit-exact final-buffer readback, physical-device acceptance, human listening or real-time deadline improvement.
- Integration-owner scoped A/C/D review is recorded in SECURITY.md, not independent release approval. Public APIs, voice format and the README contract are unchanged.

### Ordered WAV sample bounds

- Native Float32 samples now use one inverted magnitude bound instead of a separate finite check and two signed bounds. NaN, infinities and values outside −1..1 still reject before serialization or dither advancement. Each sample is captured once; no arrays, views, copies, helpers, APIs or dependencies were added. Input admission, transaction commits and file/chunk limits are unchanged.
- Two fresh Node 26 / Apple M5 consumers per case compared matching old/new minified distributions, with 128 warmups and nine alternating pairs of 64 calls/sample. These 65,536-frame stereo full-buffer ranges are microseconds/operation:

| Format | Before | After |
| --- | ---: | ---: |
| PCM16 | 392.43–400.15 | 367.32–374.93 |
| PCM24 | 404.99–405.68 | 387.87–388.48 |
| Float32 | 272.10–272.44 | 261.23–267.30 |
| Dithered PCM16 control | 468.06–478.84 | 470.40–476.23 |
| Dithered PCM24 | 494.82–535.50 | 477.37–519.61 |

- Mixed-format full/stream and small/4,096-frame controls were also exercised. Dithered PCM16 was effectively neutral in isolation and mixed results varied; this is not a universal throughput, GC or real-time improvement.
- Actual compiled and minified graphs each matched their baselines in 1,402,572 raw-sample API cases (695,402 accepted, 707,170 rejected), including IEEE exponent/mantissa/sign boundaries and seeded words across all formats/dither modes. Offset, aliased, cross-realm, shadowed, detached, shared and resizable views, million-frame stream partitions and four-million-frame export bounds also matched. Native concurrent shared-memory mutation exercised 8,000 stream attempts across baseline/current graphs; accepted samples stayed finite/bounded and rejection preserved frame accounting.
- The added consumer regression checks both channels, NaN/infinities, adjacent out-of-range Float32 values, retry output and frame accounting across all formats/dither modes. All 559 behavioral tests and strict/public/Node-only checks passed.
- Native Chrome 150 passed 12 full/stream cases and 24 real static-module Worker jobs with identical bytes, progress and 32,580 finite decoded channel-sample comparisons. All 816 sink buffers detached, progress had 816 steps, at most one sink write was active, DSP errors stayed zero and both contexts closed. Human listening remains unverified.
- Integration-owner scoped A/C/D review is recorded in SECURITY.md, not independent release approval. The public API, voice format and README contract are unchanged.

### Scalar transactional WAV dither

- TPDF encoding now carries xorshift32 state in a local signed 32-bit scalar and returns its unsigned seed only after the complete chunk succeeds. The encoder keeps one committed scalar instead of a mutable working Uint32Array plus backup/reset. Both draws, subtraction/scaling, channel order, rounding/clamping and emitted bytes are unchanged; disabled dither uses zero state. Public schemas, sample/frame/RIFF32 limits, sample single-read behavior, APIs and dependencies are unchanged.
- Separate post-timing instrumentation observed these logical working-state allocations, not heap/GC measurements:

| Dithered operation / working Uint32Arrays | Before | After |
| --- | ---: | ---: |
| Full-buffer export | 1 | 0 |
| Streaming encoder, across all chunks | 1 | 0 |

- Two fresh Node 26 / Apple M5 processes compared matching old/new minified distributions. Mixed-format runs used 64 warmups, seven alternating pairs and 12 calls/sample for the following 65,536-frame stereo workloads. Separate isolated runs used 128 warmups, nine alternating pairs and 64 calls/sample. Ranges of per-process medians are microseconds/operation:

| Measurement / workload | Before | After |
| --- | ---: | ---: |
| Mixed, dithered PCM16 full | 635.82–640.52 | 451.78–455.05 |
| Mixed, dithered PCM16 stream | 633.27–639.60 | 447.28–452.43 |
| Mixed, dithered PCM24 full | 638.04–664.58 | 508.51–543.29 |
| Mixed, dithered PCM24 stream | 644.77–664.76 | 513.39–522.77 |
| Mixed, plain PCM16 full control | 363.25–366.26 | 361.42–369.13 |
| Mixed, plain PCM24 full control | 448.74–498.19 | 450.45–563.80 |
| Mixed, plain PCM24 stream control | 442.79–519.28 | 447.39–712.89 |
| Mixed, float32 full control | 272.89–275.20 | 276.82–278.64 |
| Isolated, dithered PCM16 full | 1,057.99–1,088.50 | 1,017.88–1,030.91 |
| Isolated, plain PCM24 full control | 364.03–364.07 | 374.04–381.35 |
| Isolated, plain PCM24 stream control | 376.86–388.28 | 376.56–382.58 |
| Isolated, float32 full control | 272.18–276.71 | 265.21–271.51 |

- Opt-in dither improved in these runs, with a much smaller isolated gain. Ordinary formats were not uniformly faster: the mixed PCM24 control had a large outlier and isolated full PCM24 remained slightly slower. Small/4,096-frame controls and compiled-source variants were also exercised. No universal encoding, GC, real-time or physical-device improvement is claimed.
- Actual compiled/minified modules each matched full-buffer/partitioned output, errors and nested-prefix commit behavior in 608 public cases (510 accepted, 98 rejected), including million-frame mono/stereo sequences. One new consumer regression covers metadata-triggered nested commits before both successful and rejected outer transactions, for both PCM formats and channel counts; all 558 behavioral tests and strict/public/Node-only checks passed.
- Native Chrome 150 passed 20 full/stream WAV cases with rejected chunks and 20 real static-module Worker cases. Bytes, complete Worker results, 405 progress steps and 272,220 finite decoded channel samples matched the baseline. All 810 sink buffers detached successfully, at most one write was active, DSP errors stayed zero and contexts closed. Decoder comparisons use native baseline parity, not an assumed PCM scaling convention; listening remains unverified.
- Integration-owner scoped A/C/D review is recorded in SECURITY.md, not independent release approval. No voice-format or README public-contract change was required.

### Worker chunk diagnostics reuse

- The static offline Worker now passes each completed chunk's existing immutable diagnostics to its private sender instead of constructing the same snapshot again after synchronous WAV encoding. Header/final-padding and terminal reporting still read fresh diagnostics. Protocol fields, validation, ACK/backpressure, transfer ownership, DSP and public APIs are unchanged.
- Separate native-thread instrumentation observed one fewer frozen diagnostic snapshot per data chunk. For an empty score at 8 kHz (the existing 80-frame tail), counts include header and terminal snapshots:

| Data chunks | Snapshots before | Snapshots after |
| --- | ---: | ---: |
| 80 | 162 | 82 |
| 3 | 8 | 5 |
| 1 | 4 | 3 |

- Actual compiled and minified senders each matched all wire messages, complete WAV bytes and error names/messages in 69 real thread cases: 60 valid and nine rejected. Empty/musical scores, 8/48 kHz, 1/31/4,096-frame chunks and all valid format/dither combinations produced 840,120 identical bytes per target. Instrumentation observed 51,485 fewer snapshot constructions across the valid corpus; this is a logical allocation count, not measured heap/GC, wall-clock or real-time improvement. Invalid ACK indices/fields, repeated starts, encoder policy, rate/frame budgets and malformed scores retained their rejections.
- Native Chrome 150 passed 40 actual static-module Worker cases with asynchronous ownership-taking sinks. Full results, 460 progress steps and 199,360 finite native-decoded channel samples matched the baseline; all 920 received buffers detached successfully, at most one write was active, DSP errors stayed zero and contexts closed. Serialized bytes also matched full-buffer rendering/encoding. Physical-device and listening acceptance remain unverified.
- All 557 behavioral tests and strict/public/Node-only type checks passed. Existing transfer/backpressure/cancellation tests remain unchanged; snapshot-count instrumentation is investigation-only. Integration-owner scoped A/B/C/D review is recorded in SECURITY.md, not independent release approval.

### Owned WAV metadata reuse

- Full-buffer `encodeWav` now reuses its validated own-data snapshot for native channel checks and passes an own-field scalar projection to the private layout validator. Streaming entry points retain the same strict public schemas, required fields and error labels. All native channel/sample checks, numeric/resource limits, headers, padding, output ownership and transactional dither behavior remain unchanged. Existing inherited-field coverage now also checks `format` and `dither`; no public API, voice format or dependency changed.
- Separate post-timing instrumentation observed these counts per public operation; these are logical allocations, not retained-heap, GC or RSS measurements:

| Operation / allocation | Before | After |
| --- | ---: | ---: |
| Full-buffer own-data records | 3 | 1 |
| Full-buffer Uint8Array allocations | 2 | 2 |
| One-chunk stream own-data records | 2 | 2 |

- Two fresh Node 26 / Apple M5 processes measured the actual compiled implementation in seven alternating pairs after 64 warmups per variant/workload. Small full-buffer batches used 4,000 calls/sample; small streams used 2,000. Ranges of per-process medians are microseconds/operation:

| Stereo 16-frame workload | Before | After |
| --- | ---: | ---: |
| Full PCM16 | 1.22–1.50 | 0.68–0.73 |
| Full PCM24 | 1.04–1.07 | 0.63 |
| Full float32 | 1.11–1.12 | 0.68–0.70 |
| PCM24 stream, mixed-workload run | 1.27–1.30 | 1.37–1.40 |
| PCM24 stream, isolated long-batch control | 1.31–1.42 | 1.19–1.31 |

- The isolated control used two additional fresh processes, 1,024 warmups, nine alternating pairs and 8,192 calls/sample. Streaming direction depended on the measurement context; 4,096/65,536-frame controls also varied. Only the small full-buffer improvement and removed metadata copies are claimed, not a general streaming, rendering or real-time speedup.
- Actual compiled and minified modules each matched complete prior results and error classes/messages in 1,657 cases (1,205 accepted, 452 rejected). Coverage includes formats/dither/chunk partitions, mono/stereo, rates, offset/shared/native views, hostile metadata, detached/forged channels, schema/type/range failures and rejection accounting. Six maximum-size exports at 4,000,000 frames matched 108,000,292 bytes per target across every format/channel count; 4,000,001 frames retained the exact rejection.
- Native Chrome 150 passed 30 full-WAV cases and 20 real static-module Worker renders. Serialized bytes, complete Worker results and 238,470 finite native-decoded channel samples matched the baseline. Asynchronous sinks transferred/detached all 880 received buffers; at most one write was active, close occurred once, DSP errors stayed zero and all contexts closed. This is native decoder parity, not a platform-independent decoder scaling or listening claim.
- All 557 behavioral tests and strict/public/Node-only type checks passed. Integration-owner scoped checklist A/C/D review is recorded in SECURITY.md; this is not independent release approval.

### Retained single-track SMF order

- SMF import now skips the final wire-array sort when the validated header declares exactly one track, including format-1 single-track files. Nonnegative bounded VLQ deltas already produce nondecreasing ticks, the track index is constant and wire order increases; omitting unsupported messages preserves that ordering. Multi-track files retain the original tick/track/wire-order comparator. Validation, warnings, FIFO/sustain/EOF handling and budgets are unchanged.
- Two fresh Node 26 / Apple M5 processes, seven alternating pairs after 32 warmup imports per variant/workload; 2,000 calls/sample for small scores and 12 for each 30,000-note score. Ranges of per-process medians are microseconds/import:

| Workload | Before | After |
| --- | ---: | ---: |
| Omit, 16 notes, format 0 | 5.51–5.86 | 5.54–5.88 |
| Preserve, 16 notes, format 0 | 7.17–7.25 | 7.26–7.50 |
| Omit, 30,000 notes, format 0 | 5,177.99–5,398.79 | 4,630.33–4,655.76 |
| Preserve, 30,000 notes, format 0 | 4,329.66–4,346.48 | 3,736.21–3,815.28 |
| Omit, 30,000 notes, single-track format 1 | 5,017.42–5,225.68 | 4,201.62–4,362.13 |
| Preserve, 30,000 notes, single-track format 1 | 4,183.57–4,228.96 | 3,720.01–3,725.18 |
| Omit control, 30,000 notes, two-track format 1 | 4,724.14–5,050.44 | 4,717.22–5,005.55 |
| Preserve control, 30,000 notes, two-track format 1 | 4,236.80–4,412.48 | 4,248.25–4,394.97 |

- Large sequential single-track scores improved in both processes. Small single-track scores were slightly slower, and multi-track controls overlapped or varied in direction; no universal or multi-track speedup is claimed. Sustain/explicit EOF-close workloads were also exercised under both policies. Timings are local offline-import evidence, not heap/GC, real-time or physical-device guarantees.
- A separate post-timing native-sort probe observed the following for 30,000-note default-range fixtures, identically under omit/preserve:

| Workload | Sort calls before | Sort calls after | Comparisons before | Comparisons after |
| --- | ---: | ---: | ---: | ---: |
| Format 0 | 1 | 0 | 60,001 | 0 |
| Single-track format 1 | 1 | 0 | 60,001 | 0 |
| Two-track format 1 control | 1 | 1 | 60,001 | 60,001 |

- Final compiled and minified modules each matched complete prior results and error classes/messages in 8,050 cases (4,672 accepted, 3,378 rejected; 21,571,918 input bytes per corpus). Coverage adds single-track format-1 equivalents, all 24 same-tick off/on/poly-pressure/bend permutations on every channel, repeated same-pitch FIFO ownership, mid-score tempo/repeated-meter events and changing-meter rejection to the existing channel/pitch/velocity and bend/poly-pressure sweeps, controller/RPN/program maps, native offset views, short prefixes and seeded binary/policy mutations.
- Native Chrome 156 passed 20 actual user-gesture import → named-voice beat compilation → stereo PCM → PCM24 WAV → native-decoding cases, including single-track format-1 tempo changes and overlapping expressive gates. All 1,563,200 finite channel samples remained identical, native decoding matched encoded PCM24 values exactly, DSP errors remained zero and the context closed normally. Physical MIDI, human listening and real-time worklet acceptance remain unverified.
- All 557 existing behavioral tests and strict/public/Node-only type checks passed. Integration-owner scoped checklist A/D review is recorded in SECURITY.md. Public APIs, voice format, dependencies and permission boundaries are unchanged.

### Optional SMF controller initialization

- Default/`controls: 'omit'` import now skips the sixteen expression snapshots and sixteen RPN state records that only preserve-mode wire events can consume. Initial bend-range validation remains unconditional in both policies; existing rejection coverage now explicitly exercises both. Program mapping, release flags, global live/FIFO/sustain tracking, EOF order and all input/event/time budgets remain unchanged.
- Compared with the preceding expression-ownership implementation in two fresh Node 26 / Apple M5 processes: seven alternating pairs after 32 warmup imports per variant/workload, 2,000 calls/sample for the small score and 12 for each 30,000-note score. Ranges of per-process medians are microseconds/import:

| Workload | Before | After |
| --- | ---: | ---: |
| Omit, 16 notes, format 1 | 7.21 | 6.01–6.11 |
| Omit, 30,000 notes, format 1 | 5,312.88–5,578.28 | 5,372.32–5,570.20 |
| Omit, 30,000 notes, format 0 | 5,335.66–5,378.66 | 5,081.28–5,348.32 |
| Omit, 30,000 notes across 16 channels, format 1 | 6,963.40–7,152.87 | 6,931.23–7,179.72 |
| Omit, 30,000 sustain-held notes, format 0 | 8,108.41–8,941.34 | 8,385.45–8,866.52 |
| Omit, 30,000 unclosed notes across 16 channels | 4,988.50–5,429.40 | 5,034.66–5,403.18 |
| Preserve control, 16 notes, format 1 | 6.96–7.37 | 7.54–7.61 |
| Preserve control, 30,000 notes, format 1 | 4,359.56–4,410.91 | 4,316.31–4,706.23 |
| Preserve control, 30,000 notes, format 0 | 4,344.30–4,414.24 | 4,342.00–4,431.94 |
| Preserve control, 30,000 notes across 16 channels, format 1 | 5,948.10–6,096.94 | 5,964.24–6,097.69 |
| Preserve control, 30,000 sustain-held notes, format 0 | 9,418.35–9,485.09 | 9,226.39–9,340.94 |
| Preserve control, 30,000 unclosed notes across 16 channels | 7,101.77–7,372.96 | 7,191.97–7,318.40 |

- The small omit workload improved in both processes; the small preserve control was slower. Larger-score results overlapped or varied by workload/process, so no general large-score or preserve-mode speedup is claimed. These are local offline-import timings, not heap/GC, real-time deadline or device guarantees.
- A separate post-timing probe of the default-range, 30,000-note format-1 fixture observed:

| Native `Math.floor` calls/import | Before | After |
| --- | ---: | ---: |
| Omit | 16 | 0 |
| Preserve | 16 | 16 |

- Set construction/mutation work stays unchanged from the preceding ownership optimization. The larger lazy-state prototype also changed release-flag allocation/closure and repeatedly regressed a preserve-mode control; that variant was not retained.
- Compiled and minified targets each matched complete prior public results and error classes/messages in 3,726 differential cases: 1,662 accepted, 2,064 rejected and 12,813,826 input bytes per corpus. Coverage includes both policies, fractional initial bend ranges, malformed range options, all channels/note/velocity pairs, every 14-bit bend and pitch/poly-pressure pair, controller/RPN/program maps, sustain/FIFO/EOF closure, native offset views, short prefixes and seeded binary/policy mutations.
- Native Chrome 156 passed 16 actual user-gesture import → named-voice compilation → stereo PCM → PCM24 WAV → native-decoding cases. All 1,341,760 finite channel samples remained identical, encoded PCM24 values decoded exactly, DSP errors remained zero and the context closed normally. This is offline consumer evidence, not physical MIDI, listening or real-time worklet acceptance.
- All 557 behavioral tests and strict/public/Node-only type checks passed. Integration-owner scoped checklist A/D review is recorded in SECURITY.md; no API, voice-format, parser-admission, dependency or permission change was introduced.

### Optional SMF expression ownership

- Default/`controls: 'omit'` import no longer allocates or updates the sixteen per-channel sets used only for preserved-expression fanout. Preserve-mode parsing still creates those sets. Global live-gate tracking, pressed-key FIFO queues, sustain handling, EOF closure and all binary/event/time budgets remain unchanged; public results, warning/loss order, errors and APIs are unchanged.
- Two fresh Node 26 / Apple M5 processes, seven alternating pairs each after 32 warmup imports per variant/workload; 2,000 calls/sample for the small score and 12 for each 30,000-note score. Ranges of per-process medians are microseconds/import:

| Workload | Before | After |
| --- | ---: | ---: |
| Omit, 16 notes, format 1 | 11.71–12.99 | 9.49–10.59 |
| Omit, 30,000 notes, format 1 | 7,634.93–9,257.69 | 6,721.02–8,586.12 |
| Omit, 30,000 notes, format 0 | 7,815.15–9,393.03 | 7,184.59–8,336.11 |
| Omit, 30,000 notes across 16 channels, format 1 | 10,729.71–11,183.79 | 9,452.13–9,579.85 |
| Omit, 30,000 sustain-held notes, format 0 | 12,523.13–14,328.78 | 12,202.15–12,405.16 |
| Omit, 30,000 unclosed notes across 16 channels | 8,371.70–8,395.17 | 6,327.09–6,733.91 |
| Preserve control, 16 notes, format 1 | 9.78–10.14 | 10.27–10.38 |
| Preserve control, 30,000 notes, format 1 | 5,836.18–6,038.11 | 5,760.56–6,201.22 |

- The small preserve-mode control was slightly slower. The other preserve-mode control ranges overlapped and varied in direction, so no preserve-mode speedup is claimed. Absolute timings varied between processes; these are local offline-import measurements, not heap/GC-rate, real-time deadline or device guarantees.
- A separate native-constructor/mutation probe of the 30,000-note format-1 omit workload observed:

| Native Set work | Before | After |
| --- | ---: | ---: |
| Constructors/import | 33 | 17 |
| `add` calls/import | 60,000 | 30,000 |
| `delete` calls/import | 60,000 | 30,000 |

- Preserve-mode constructor/mutation counts remained unchanged. Old/new differential coverage retained complete public results and error classes/messages in 3,702 cases per compiled/minified target (1,650 accepted, 2,052 rejected; 12,812,458 input bytes per corpus). It covered all channels/note/velocity pairs, every 14-bit bend and pitch/poly-pressure pair, CC/channel-pressure boundaries, sustain/FIFO/unclosed gates, RPN/program maps, offset views, short-file prefixes and seeded binary/policy mutations.
- Native Chrome 156 exercised both policies through MIDI import → named-voice beat compilation → stereo PCM → PCM24 WAV → native decoding in 16 cases, including mixed pressed/sustained EOF closure. Old/new PCM retained 1,341,760 identical finite channel samples with zero DSP errors, and native decoding exactly matched every encoded PCM24 value. The context activated and closed normally; physical MIDI, listening and real-time worklet acceptance are not implied.
- All 557 existing behavioral tests, strict/public/Node-only type checks and installed-package/security gates passed. No public API, voice-format, parser-admission or runtime-dependency change was introduced.

### Packed short SMF messages

- SMF export now keeps three-byte note, expressive-control and end-of-track payloads in a private 24-bit integer instead of allocating an array per message. Variable-length tempo/meter payloads remain arrays. Track sorting, full-precision ticks/indices, PPQN rounding, ownership rules, input validation and all wire-event/byte/VLQ budgets are unchanged; public APIs and file bytes are unchanged.
- Two fresh Node 26 / Apple M5 processes, five alternating pairs each after 64 warmup exports per variant/workload. All timed scores use sequential, non-overlapping notes on one mapped channel; the preserve-mode control has no automation. Ranges of per-process medians are microseconds/export; samples contain 2,000 small, 20 large or 50 preserve-mode exports:

| Workload | Before | After |
| --- | ---: | ---: |
| 16 notes, format 1 | 11.05–11.33 | 10.98–10.99 |
| 30,000 notes, format 1 | 22,231.77–22,660.89 | 20,011.19–20,714.06 |
| 30,000 notes, format 0 | 21,330.90–22,114.37 | 20,618.19–20,972.53 |
| 5,000 notes, preserve mode, format 1 | 4,033.45–4,108.22 | 3,830.20–3,924.75 |

- A separate native `.set` probe confirmed that only the two conductor payloads still use array copies in the 30,000-note workload. These are local offline-conversion measurements, not real-time audio, total-allocation/GC, browser/device or universal speed guarantees.
- Old/new comparison covered 2,534 public input cases (2,244 accepted, 290 rejected), each against compiled TypeScript and the minified distribution: 10,130,155 complete baseline SMF bytes per candidate plus matching error classes/messages. Domains included all 16 channels with every note/velocity pair, every 14-bit bend and every pitch/poly-pressure pair, both SMF formats, all expression-product targets, seeded tempo/stop/control cases and VLQ/wire-event boundaries. All 557 existing behavioral tests, strict/public/Node-only types and installed-package/security gates passed.
- Native Chrome 156 user-gesture smoke exercised export → import → named-voice beat compilation → stereo PCM → PCM24 WAV → native decoding in 12 cases across both formats, channels 0/15, boundary notes/velocities, tempo changes, expressive automation and overlapping poly pressure. The old/new renders retained 1,016,320 identical finite channel samples with zero DSP errors; all 1,016,320 decoded channel samples exactly matched their encoded PCM24 values. The native context reached running and closed normally. This is not physical-device, listening or real-time deadline certification.

### DX7 topology scoring masks

- DX7 selection still ranks carriers/modulators, iterates the same 24 retained-operator orders and eight OPM graphs, requires identical carrier positions and keeps the first lowest score. It now derives eight compact topology masks once from the existing immutable OPM graphs. Each eligible order constructs its 16-bit source/target edge mask once; population count of the XOR gives the exact previous inserted/deleted-edge score. Orders with no eligible output layout build no edge mask. No routing tables or external implementation code were added.
- Two fresh Node 26 / Apple M5 processes, seven alternating pairs each after warmup, 300 complete 32-patch-bank calls/sample. Ranges of per-process medians are microseconds/call:

| Original generated bank | Before | After |
| --- | ---: | ---: |
| Import mixed algorithms 1–32 | 344.41–346.58 | 240.25–240.28 |
| Describe mixed algorithms | 172.14–176.29 | 72.99–74.24 |
| Import 32 algorithm-1 patches | 363.80–379.53 | 246.48–247.39 |
| Describe algorithm-1 bank | 194.62–195.24 | 79.42–79.68 |
| Import all-carrier algorithm-32 bank | 206.07–208.38 | 206.51–209.57 |
| Describe all-carrier bank | 45.58–45.75 | 45.60–46.11 |

- The all-carrier fast return is unchanged and showed no benefit. These are local converter timings, not real-time audio, heap/GC, browser/device or hardware-fidelity measurements; module initialization adds one private eight-number array.
- Public old/new comparison covered all 32 source algorithms with all 720 strict loudness permutations and three tie patterns: 46,272 complete voice/description comparisons, including selected/dropped operators and warning order. A musical routing regression keeps equal-loudness carrier and minimum-score topology tie decisions stable; an unrelated disclaimer-wording assertion was removed, not re-pinned. Native Chrome checked mixed banks and offset single-patch views, then rendered 128 old/new cases with 971,264 identical finite channel samples. Twelve DX7 tests, all 557 behavioral tests, strict/public/Node-only types and installed-package/security gates passed. Framing/checksum/reserved-bit/parameter validation, source-copy bounds, public APIs and voice format are unchanged.

### Separate OPM voice and description conversion

- `importOPM()` and `describeOPM()` still share the complete strict text/binary parser, but no longer construct each other's discarded output. Import retains voice construction and `normalizeVoice`; description emits metadata and the same ordered/de-duplicated warnings without creating operators, ADSRs, a voice or a normalized voice copy. The two source-rate formulas are shared private helpers, not independent approximations.
- A pre-change CPU profile of 128-patch descriptions attributed about 46% of samples to voice-normalization object/number/field work. Two fresh Node 26 / Apple M5 processes, each with seven alternating pairs after warmup, measured these ranges of per-process medians (microseconds/call):

| Binary description workload | Before | After |
| --- | ---: | ---: |
| One patch, 173 bytes | 7.92–8.02 | 3.23–3.29 |
| 128 patches, 22,563 bytes | 953.58–962.34 | 385.49–386.50 |
| Same patches with comment padding, 252,514 bytes | 1,292.20–1,301.55 | 729.37–737.24 |

- Import controls remained in overlapping timing ranges, so no import-speed improvement, heap/GC reduction, worklet or device guarantee is claimed. The parser still checks every operator field even though description no longer needs voice-only numeric conversion; the existing out-of-range-field regression now covers both public functions.
- Final old/new comparison preserved full voices, descriptions, warning order and errors in 12,568 seeded/boundary cases, plus a 710-case binary/offset/tail corpus. Chrome binary-import-to-PCM smoke retained 64 cases and 292,256 identical finite channel samples. Ten OPM tests, all 556 behavioral tests, strict/public/Node-only types and installed-package/security gates passed. Public APIs, diagnostic wording, source limits and voice format remain unchanged.

### Grouped OPM Latin-1 decoding

- Native `Uint8Array` inputs retain the same bounded private copy, then convert eight bytes per fixed-argument `String.fromCharCode` call instead of concatenating one character per byte. A scalar remainder preserves every final byte. No spread/apply argument-count limit, intermediate subarray/species access or Windows-1252 decoder substitution is introduced; all 0–255 byte values retain exact Latin-1 code points.
- Node 26 / Apple M5: two fresh processes, each with seven alternating before/after pairs after warmup. The following are ranges of the two per-process medians in microseconds/call, not confidence intervals:

| Binary input workload | Before | After |
| --- | ---: | ---: |
| Import one patch (173 bytes) | 8.54–8.58 | 8.00–8.05 |
| Describe one patch | 8.51–8.60 | 7.89–8.00 |
| Import 128 patches (22,563 bytes) | 1,018.86–1,021.21 | 951.58–955.81 |
| Describe 128 patches | 1,022.60–1,146.30 | 952.23–1,043.37 |
| Import 128 patches with comment padding (252,514 bytes) | 3,148.59–3,482.40 | 1,319.50–1,403.62 |
| Describe the same padded bank | 3,158.65–3,175.19 | 1,308.26–1,314.85 |

- Small/ordinary-bank timing samples overlapped, so no universal import speedup is claimed. The large comment-padded case is an accepted worst-size conversion workload, not a typical bank. A simpler indexed scalar loop was measured first but retained most per-character concatenation cost; the fixed eight-byte group kept the larger observed improvement without a general chunking abstraction. No heap, GC, real-time deadline or non-V8 speedup claim follows.
- Old/candidate consumer comparisons preserved output/errors in 710 cases, including all 256 byte values in patch names, short tails and offset views. New permanent coverage verifies final fields and names for each remainder length, excludes bytes outside a native view, and rejects a trailing NUL. Chrome imported original binary patches and compared converted descriptions and finite PCM across eight algorithms, noise on/off and four rates (64 render cases, 292,256 channel samples). Ten OPM tests, all 556 behavioral tests, strict/public/Node-only types and installed-package/security gates passed. String admission, source limits, parser diagnostics and public APIs are unchanged.

### OPM text byte-budget checks

- `.opm` string admission and per-line validation now reuse the existing voice-bank/project pattern: at most three UTF-8 bytes per UTF-16 code unit. Inputs whose upper bound fits need no temporary encoded buffer; longer candidates retain exact encoding. The 256 KiB input and 512-byte line limits, error order/text, binary Latin-1 handling and converted voices/descriptions remain unchanged.
- Instrumented `TextEncoder.encode` calls during one complete `importOPM` invocation:

| Original fixture | Before calls / returned bytes | After calls / returned bytes |
| --- | ---: | ---: |
| One patch | 9 / 341 | 0 / 0 |
| 128 patches, 22,691 code units | 1,025 / 44,359 | 0 / 0 |

- Node 26 / Apple M5, seven alternating before/after pairs after warmup, medians in microseconds/call:

| Workload | Before | After |
| --- | ---: | ---: |
| Import one patch | 9.10 | 8.03 |
| Import 128 patches | 1,068.04 | 969.18 |
| Describe one patch | 8.64 | 7.46 |
| Describe 128 patches | 1,066.39 | 940.68 |

- The 128-patch import timing ranges overlapped (before 1,059.61–1,162.23 µs, after 939.76–1,383.82 µs); these are local parser observations, not real-time, GC or device-startup guarantees. Allocation counts refer only to returned encoded buffers.
- Added consumer-boundary regression coverage for exact/over-limit UTF-8 lines and banks, including BMP text, surrogate pairs and lone surrogates. Throwaway old/new comparisons preserved values and errors in 562 cases; actual Chrome imported patches and rendered all eight algorithms with/without noise at four rates, yielding 64 cases and 292,256 identical finite channel samples. Nine OPM tests, all 555 behavioral tests, strict/public/Node-only types and installed-package/security gates passed. No new dependency, API or voice-format change.

### Effects worklet module graph

- The offline effects module imported its 4,000,000-frame budget from the sequence module, so the optional effects AudioWorklet also loaded the complete synth, voice-normalization and sequence graph. That budget now lives in a dependency-free `core/limits` leaf; `core/sequence` re-exports the same public `MAX_RENDER_SAMPLES` value and `core/fx` imports the leaf directly. No DSP, validation, API signature or voice/message format changed. The deployed tree gains `core/limits.js`, `.js.map` and `.d.ts`; copy complete matching trees as before.
- Static closure of `worklet/fx-processor.js` in the built tree:

| Effects worklet closure | Before | After |
| --- | ---: | ---: |
| Modules | 14 | 4 |
| Minified JavaScript bytes | 92,500 | 9,536 |
| Import depth | 4 | 2 |

- Real Chrome 156 `OfflineAudioContext.audioWorklet.addModule()` against a local server that delayed every JavaScript response by 30 ms recorded 14 → 4 JavaScript requests. Five fresh pages per variant took a median 182 ms [181–185] before and 114 ms [113–115] after. The unchanged synth worklet remained 11 requests / 83,456 bytes at 148 ms [145–150]. This is a synthetic per-response delay model, not a CDN, HTTP/2, cache or device-startup measurement.
- The actual effects AudioWorklet in Chrome matched the pre-change core sample-for-sample at 8,000 / 11,025 / 48,000 / 192,000 Hz (77,776 stereo frames). A throwaway fresh-process V8 script-list probe confirmed the reduced dependency closure; an exact-module-list assertion was subsequently removed because it pinned wiring rather than consumer behavior. Build, strict/public/Node-only types, installed-package/security gates and the installed asset CLI (167 files, fresh copy then reuse) passed; the retained behavioral suite contains 554 tests.
- Parse/compile profiling found no safe candidate in this round. Raw patch caching in sequence preparation would break the pinned per-occurrence detachment regression. Prepared registries already cost about 0.6 µs/event, and 32-voice real-time rendering is dominated by already-optimized operator kernels, so no broader speedup is claimed.


### Concurrent deployment destination

- Documented the actual `copyAssets` publication boundary and added two native-filesystem regressions. A destination populated before the final existence check, or at the exact rename step, keeps its non-empty contents, the copy rejects, and staging is removed. Node's `rename` has no exclusive-directory mode: on macOS/Node 26 a different process's newly created **empty** directory at the rename boundary was replaced, retaining the former behavior.
- A portable `mkdir` reservation was rejected because the same-path directory rename that follows is not verified portable on Windows and would add a visible empty destination before publication. No source, public API or packaged behavior changed.
- The probe used a real child process at the actual `rename` boundary: an empty directory was replaced by the complete release; a directory containing `host.txt` kept its inode and bytes and caused `ENOTEMPTY`; two cooperating same-process publishers produced one fresh copy and one rejection. Isolated fault injections show the final-check regression catches unconditional replacement and both regressions catch a leaked staging directory; the rename-boundary case documents OS protection, not an application-level guard. Observations are macOS/Node 26 only; Linux/Windows rename semantics were not exercised.


### Existing deployment manifest reads

- `copyAssets` reuses the manifest size already collected by its directory walk. An inspected byte length that cannot match the canonical UTF-8 metadata now rejects before loading the host file, without another stat call. Equal-sized metadata still requires exact text comparison and every asset's existing size/SHA checks; this is not trust based on length alone.
- Native filesystem observation on a fixed built-package snapshot used Node 26/macOS and three alternating-order fresh-process pairs. The observer delegated unchanged to `readFile`; the ASCII fixtures below report manifest payload bytes loaded, not physical-disk, latency, RSS or GC measurements. Timing ranges overlapped, so no speedup is claimed.

| Existing manifest fixture | Before payload bytes loaded | After payload bytes loaded |
| --- | ---: | ---: |
| Canonical metadata | 25,000 | 25,000 |
| Wrong-size 8 MiB metadata | 8,388,608 | 0 |

- Thirteen before/built filesystem cases retained their results and host/package bytes, including empty/short/long/same-sized corrupt metadata, extra files/directories, symlinks and source overlap; two fresh copies also matched. The actual CLI passed fresh copy/reuse and refused stale/malformed targets. Native HTTP and gzip checks passed; wrong MIME, missing nosniff, corrupted bytes and redirects failed as expected. Build, all eight asset regressions, all 552 tests, strict/public/Node-only types and installed-package/security gates passed. Existing public contracts/tests remain unchanged.
- This early rejection uses inspected metadata, not an atomic filesystem snapshot or a race-proof read cap against concurrent hostile writers. Scoped owner A/D review is recorded in SECURITY; no release approval or broader deployment/audio acceptance is implied.


### PCM24 payload views

- PCM24 sample encoding no longer constructs a DataView that its direct three-byte stores never use. Headers and PCM16/float32 keep their DataView writes. Sample validation still captures each native input once; quantization, deterministic dither, atomic frame/noise accounting, padding and size limits are unchanged. Output/validation objects still allocate.
- Local Node 26 / Apple M5 measurements used one-frame stereo PCM24 chunks, deterministic input changes before every call, a retained 128-chunk ring, 32,768 warmups and 262,144 measured calls per fresh process, five alternating-order pairs. Header/finalization are outside the timed loop; input updates and ring writes are included. Values are median [min–max] microseconds per chunk. The applied compiled module exactly matched the candidate.

| Retained PCM24 chunks | Before µs/chunk | After µs/chunk |
| --- | ---: | ---: |
| No dither | 0.2727 [0.2490–0.2981] | 0.1881 [0.1707–0.1992] |
| TPDF dither | 0.2894 [0.2851–0.2985] | 0.2002 [0.1955–0.2099] |

- Timing ranges overlapped when the sink explicitly requested every ArrayBuffer, and in larger-chunk/control-format measurements. No general file/IO throughput, GC, resident-memory, Worker or worklet-deadline improvement is claimed.
- Eighty complete files matched the old bytes. An independent RIFF parser and exact-dyadic BigInt quantizer checked 1,982,040 samples: undithered values matched exactly, while dither stayed within one integer step of the undithered reference. Partitioning, rejected chunks, padding and 60 native/cross-realm/metadata/range cases passed. Chrome 156 decoded ten files within format-appropriate numerical tolerances and ran 20 actual module-Worker jobs with sink buffer transfer, each byte-identical to the old offline reference. A scoped constructor probe observed zero PCM24 payload DataViews instead of one per chunk. Existing binary-format/padding/dither-rollback regressions, build, all 552 tests, strict/public/Node-only types and installed-package/security gates passed. Public contracts and their existing tests remain unchanged; owner A/C review is not independent release or device/listening acceptance.


### Dry helper state allocation

- Share sample-rate admission and strict, deeply frozen option normalization before constructing the private effects engine. Wholly dry `applyEffects` calls now skip its discarded delay/control state as well as processing; stateful engines retain preallocation and warm history. Any positive mix, including `1e-300`, keeps the wet path. Native channel/copy checks, admission order, finite-bit preservation and the 4,000,000-frame output cap remain intact.
- At 48 kHz this avoids 19 Float64Array allocations containing 216,680 logical bytes per dry call; output buffers and normalized configuration still allocate. This is not a measured resident-memory or GC reduction.
- Local Node 26 / Apple M5 measurements used 48 kHz, four warmup calls and three alternating-order fresh-process pairs. Values are median [min–max] milliseconds per complete call; measured calls per process were 10,000 and 1,000 respectively. The applied compiled module exactly matched the measured candidate. Some larger-buffer measurements and the unchanged stateful/wet comparisons had overlapping ranges; no general throughput, worklet-deadline or whole-synth improvement is claimed.

| Dry helper workload | Before ms/call | After ms/call |
| --- | ---: | ---: |
| Empty buffers, omitted effects | 0.008809 [0.008171–0.009030] | 0.0002982 [0.0002823–0.0003007] |
| 1,024 frames, omitted effects | 0.01357 [0.01315–0.01562] | 0.004466 [0.004374–0.004520] |

- Ninety-six built-helper cases, 44 admission/reflection traces and 100 stateful update/reset/partition cases (900,000 stereo frames) matched the previous implementation. Native copies retained RangeError on a length-tracking input grown past a dry output and TypeError on detached input. Chrome 156 passed 48 helper cases and four native-copy boundary probes, confirmed the eliminated state arrays, and matched 77,776 stereo frames through the actual effects AudioWorklet at four sample rates. Tiny-wet-tail and admission-time detachment regressions, build, all 552 behavioral tests, strict/public/Node-only types and installed-package/security gates passed. Scoped integration-owner A/C review is recorded in SECURITY; it is not independent release or device/listening acceptance.


### One-shot dry effects

- The initial `applyEffects` fast path stopped advancing delay/feedback/filter history that a wholly dry, one-shot result immediately discards. It retained engine construction for validation (removed by the follow-up above), native input copies, the original frame budget and non-finite sample cleanup. Every finite dry bit, including signed zero and large/tiny magnitudes, is preserved. Any positive wet mix keeps the original processing path; stateful `StereoEffects.process()` still warms history at zero mix.
- Local Node 26 / Apple M5 measurements used 48 kHz input, four warmup calls and three alternating-order fresh-process pairs per workload. Measured calls per process were 1,000 / 100 / 100 / 5 for the rows below. Values are median [min–max] milliseconds per complete helper call, including validation, delay-state construction and output copies; they are not live-effects or whole-synth speedups.

| Dry helper workload | Before ms/call | After ms/call |
| --- | ---: | ---: |
| 1,024 frames, omitted effects | 0.07248 [0.07068–0.07646] | 0.01423 [0.01422–0.01685] |
| 48,000 frames, omitted effects | 2.599 [2.429–2.675] | 0.10199 [0.10053–0.10865] |
| 48,000 frames, configured zero mixes | 3.809 [3.752–3.985] | 0.10648 [0.10394–0.10963] |
| 1,000,000 frames, configured zero mixes | 78.921 [78.497–79.156] | 2.101 [2.016–2.236] |

- Ninety-six applied-source cases matched the previous helper across four sample rates, empty/short/long buffers, signed-zero mixes, a tiny positive wet mix, non-finite input and large/subnormal finite samples. Cross-realm input, overlapping views, invalid rates/accessors and the 4,000,000-frame cap retained their behavior. Native Chrome 156 ran another 36 built-module cases with zero sample differences. The numeric-boundary regression, build, all 550 behavioral tests, strict/public/Node-only types and installed-package/security gates passed; integration-owner A/C review found no admission/allocation-budget change. This is not independent release or listening/device acceptance.


### Effects delay tap indexing

- Replace the delay interpolator's remainder with a single ring-end check. Normalized chorus/pre-delay distances keep the first tap inside the preallocated ring; only its successor can wrap. Arithmetic order, smoothing, history, finite-sample cleanup and public contracts are unchanged.
- Local Node 26 / Apple M5 measurements used 48 kHz, 128-frame stereo blocks, 2,000 warmup blocks and 96,000 measured blocks per fresh process, five alternating-order pairs per workload. Both versions include input-buffer copies and always warm both effect histories. Values below are median [min–max] microseconds per block, not AudioWorklet deadlines or whole-synth speedups; shorter measurements were noisier and had overlapping ranges.

| Effects workload | Before µs/block | After µs/block |
| --- | ---: | ---: |
| Four-voice chorus | 11.422 [11.274–11.458] | 10.760 [10.566–10.909] |
| Reverb with 100 ms pre-delay | 8.887 [8.808–8.973] | 8.546 [8.405–8.655] |
| Chorus and reverb | 12.432 [12.197–13.267] | 11.718 [11.464–11.811] |

- Applied-source differential smoke matched 900,000 stereo frames across 100 cases, including parameter/order changes, resets, random partitions, cross-realm/disjoint buffer views and detached `applyEffects` copies. An independent 110.25-frame impulse-delay regression covers interpolation across the ring end. Native Chrome 156 OfflineAudioContext with the actual effects AudioWorklet matched the previous core sample-for-sample at 8,000 / 11,025 / 48,000 / 192,000 Hz (77,776 stereo frames), with no reported processor errors.
- Build, all 549 behavioral tests, strict/public/Node-only type checks and installed-package/security gates passed. Integration-owner scoped A/C safety review confirmed bounded ring indices and unchanged admission/allocation; this is not independent release review, physical-device or listening acceptance.


### Executable usage recipes

- Remove the stale “unreleased” label from the v1.11 feature headings in both usage guides. Their current v1.13.1 installation instructions and historical feature descriptions are unchanged.
- Keep the README and both guides' browser Play buttons disabled until their module imports and click handlers are ready, including replacement-script recipes. This prevents gestures during module loading from being silently lost; audio startup still requires a later user gesture and no automatic playback or retry is added.
- Native Chrome 156 held the initial API module behind a promise gate: all 15 README/guide browser recipes stayed disabled before module evaluation and accepted a ready gesture afterward. The three original quick starts accepted and ignored a gesture before handler registration. All 15 extracted Node recipes ran successfully; six documentation regressions and installed-package/security gates passed. These are functional desktop checks, not listening or physical-device acceptance.

### Idle rendering

- Once the last note, steal fade/spill, FIR history and optional DC-blocker tail have finished within a render block, clear only the remaining requested output range instead of processing silent frames individually. Terminal callbacks run first, so a callback-admitted note still starts on the next frame; the sample clock advances through the complete range.
- Silent channels do not rescan FIR history that was already known to be drained. Held silent voices still advance their oscillators, noise clocks, envelopes, LFO and controls, and the independent DC blocker still drains. Live edits can make them audible again without changing their phase. Filtering itself remains unconditional so audible frames gain no extra branch.
- No API, voice-format or worklet-protocol changes. Targeted PCM comparisons against the previous implementation preserve stereo output, aliased channels, render offsets, callback replacements and global noise-LFO resumption across all three quality profiles, with and without the DC blocker.

### Live LFO phase

- Reapplying an unchanged `lfoRate` no longer switches an untouched note from its analytic clock to accumulated phase. This avoids one-sample shifts at saw/square/noise discontinuities. Other controls in the same update still apply; actual rate edits and cancellation of active ramps retain their existing behavior.
- The failing-before/passing-after regression covers all quality profiles, note/global synchronization, immediate and ramped no-op edits, simultaneous expression changes and subsequent real rate ramps across different render chunks. All 471 behavioral tests, strict/public/DOM-free type checks, 2505 numerical sound-quality cases and 24 live-control cases passed.
- Applied-source smoke found identical PCM in 120 no-op scenarios. A separate 60-case old/new stereo comparison preserved actual/interrupted/cancelled rate ramps, zero-rate freeze/resume, mixed timbre controls and release.

### Default note admission

- Core `Synth.noteOn()` reuses its private frozen complete options when the argument is omitted or explicitly `undefined`, instead of revalidating and copying those known defaults. Caller objects, including frozen lookalikes, still cross the existing own-data boundary. Velocity, pan, priority, admission order and public signatures are unchanged.
- Local Node 26 / Apple M5 native heap sampling used 4000 full lifecycle cycles after 1000 warmups, a 256-byte sampling interval and inclusion of collected young/old objects. Only the default-options validator attribution is compared below; other transition samples varied. Both implementations had no sampled `render()` allocations in these workloads. This is not a completely allocation-free admission, worklet-throughput or realtime guarantee.

| Omitted-options admissions | Validator sampled MB before | Validator sampled MB after |
| --- | ---: | ---: |
| 32,000, eight voices | 14.07 | 0 |
| 128,000, 32 voices | 56.45 | 0 |

- Old/new native smoke matched PCM, admissions, terminal order, clocks and error accounting in 216 scenarios across eight algorithms, three quality profiles, three stealing policies and 1/8/32 voices. Unique slot ownership remained bounded through steals, tails/spill, reentrant panic and error recycling; 34 malformed-option cases per implementation still rejected without invoking accessors.
- All 473 behavioral tests, strict/public/DOM-free type checks and installed-package/security gates passed. Native Chrome 156 exercised the built distribution in nine quality/polyphony cases: 3456 stereo frames and terminal order matched the previous code; omitted defaults avoided all three former descriptor snapshots, while frozen external options still took three and frozen accessors remained rejected without reads.

### Subscription ownership

- Unsubscribe handles retain a clearable private registration rather than a wrapper that permanently closes over the host callback. Unsubscribe clears its callback; terminal disposal clears every remaining record and the shared Set on both close success and failure. Ordinary `close()` still preserves subscriptions for restart, and lookahead registration follows the same record lifecycle.
- Native Node 26 WeakRef/explicit-GC smoke reproduced callback retention before the change and collection afterward while owners and unsubscribe handles remained held. Seven modes cover active/closed controls, unsubscribe, disposal, unsubscribe then disposal, a controlled host-close rejection and a dropped-handle control. Native message turns, not timed sleeps, crossed WeakRef keep-alive jobs. This removes subscription-owned references, not a guarantee of immediate GC or release of executing/independently held callbacks.
- An empty observer registry now skips its otherwise unused ordered snapshot. Local native sampling used a reused frozen payload, 20,000 dispatch warmups, a 256-byte sampling interval and inclusion of collected young/old objects; it instruments private dispatch rather than public audio/event throughput. Nonempty transition samples varied, and no cache or completely allocation-free event claim is made.

| 20,000 dispatches after unsubscribe | Before sampled MB | After sampled MB |
| --- | ---: | ---: |
| Empty observer snapshot path | 0.75 | 0 |

- The nested-dispatch regression protects deferred additions, removal/self-unsubscribe during reentrancy and legacy callback ordering. All 474 behavioral tests and strict/public/DOM-free type checks passed; independent applied-source lifecycle review found no scoped blocker and is not release approval.
- Native Chrome 156 repeated the seven-mode callback-ownership matrix against the built distribution, including the controlled close-rejection path; active/closed controls remained live, released callbacks became collectible, and final explicit cleanup collected all targets in both trees. The real 48 kHz AudioWorklet smoke also passed held/panned signal, note terminal events, suspension/resume and owned/borrowed context cleanup with zero DSP errors/rejections. Final 16 lifecycle regressions and installed-package/security gates passed.

### Sound-designer file ownership

- The patch file chooser uses an independent generation guard: only the latest selection may parse/commit after reading, report an error or clear the input. Pagehide invalidates pending file results and clears the chooser before existing audio cleanup. Audio generations, schema/UTF-8 checks, voice format and DSP are unchanged; already-started reads are ignored, not cancelled, and no aggregate in-flight quota is introduced.
- Native Chrome 156 exercised actual built UI scripts and native File/Blob reads with explicit promise gates after read completion, not timed sleeps. Seven cases failed before and passed after: stale success, stale parse/read errors, newer invalid/oversize selections, pagehide/pageshow invalidation and an older completion while the newer chooser remained pending. Assertions covered patch identity/carrier ratio, visible status and chooser ownership. Page lifecycle events were controlled handler smoke, not physical navigation/BFCache certification.
- Both trees accepted an exact 16 KiB patch with one native read and rejected +1-byte/multibyte byte overflow before reading, preserving the current JSON. Build and strict/public/DOM-free type checks passed; scoped UI static review found no blocker. No engine API or parsing behavior change is claimed.
- A separate trusted-input Chrome run used real Worklet/port events at 48 kHz with normal and zero host monitoring. Importing the newer ratio-2 patch while held admitted exactly two gates; releasing the stale read admitted no third gate. Both runs retained one active voice with zero pending events, DSP errors and rejections, then observed release completion and closed their owned contexts. Audio output was muted; this is not human listening or device certification. Installed-package/security gates passed.

### Playground DX7 bank transactions

- Stage each imported bank together with existing voices, then use the existing atomic registry replacement before updating local lookups or options. Rejected imports no longer partially add voices or overwrite a colliding patch. Completed imports still accumulate, repeated names do not duplicate options, and initialization preserves the distinct core brass preset.
- Only the latest pending file selection can commit, report errors or clear the chooser. Pagehide invalidates pending results across pageshow. The 4104-byte pre-buffer bound remains; started reads are ignored, not cancelled. Parsing, voice format and DSP are unchanged.
- Native Chrome 156 used the actual built page, native File reads and explicit completion gates. Seven stale success/error, newer invalid/oversize, lifecycle and pending-chooser cases failed before and passed after. Lifecycle events were controlled handler smoke, not navigation/BFCache certification.

| Rejected over-capacity merge, starting with 120 voices | Before | After |
| --- | ---: | ---: |
| Registry and selector entries after rejection | 128 | 120 |

- The rejected collision's existing voice now exports the exact previous stereo PCM16 WAV: 39,384 frames at 48 kHz; the old output differed. Normal completed imports and a deduplicated merge reaching exactly 128 voices retained byte-identical canonical bank output across both implementations. At capacity, a full existing-name bank replacement succeeded, a new name rejected intact, and a later existing-name import recovered.
- `replaceVoiceBank()` now explicitly accepts `FrozenVoice` in its input declaration, matching its existing validation/copying behavior and offline API convention. The mutable `CompleteVoiceInput` alias is unchanged. A public TypeScript consumer directly passes a frozen outer array of parser snapshots; no casts, clone workaround or runtime trust bypass was added. Build, strict/public/DOM-free type checks and 28 API behavioral tests passed; independent scoped static review found no blocker and is not release approval.
- Installed-package/security gates passed. The final uninstrumented Chrome page loaded all 23 presets without a startup error; visual inspection confirmed the import policy and controls on the actual built surface.

### Command cancellation reasons

- `waitForCommand()` preserves `signal.reason`, including explicit `null`, for already-aborted and pending signals. A missing platform reason getter still uses `AbortError`. Pending cancellation no longer constructs a fallback exception that would be discarded when the getter exists; the private omitted-outcome marker does not alter acknowledgements, timeout or lifecycle failures.
- The failing-before/passing-after regression covers both null-reason paths and a sibling wait that still receives acceptance. All 475 behavioral tests and strict/public/DOM-free type checks passed. Native Chrome 156 repeated nine reason values at both cancellation timings, using actual public commands and native signals:

| Modern-signal cancellation matrix | Before | After |
| --- | ---: | ---: |
| Reasons preserved across 18 cases | 16 | 18 |
| JS-visible fallback DOMException constructions | 10 | 0 |

- These are constructor-call observations, not heap sampling, throughput or completely allocation-free cancellation claims. A separate controlled absence of the reason getter still produced the required fallback in both timing paths; this is not old-browser certification.
- Native CDP inspection of retained signals confirmed their pending listener was removed after cancellation, unchanged real-worklet acknowledgement and close in both implementations; cleanup was not redesigned. Cancellation left its command receipt available for later acceptance. The after run used a real 48 kHz AudioWorklet, observed zero active voices/pending events/DSP errors/rejections, then closed the owned context. Replies were held and delivered unchanged with promise gates, not timed sleeps. Scoped independent static review found no blocker and is not release approval.
- Installed-package/security gates passed, including deployed CLI and public/DOM-free consumer type checks.

### Worker handoff ownership

- Release captured score/settings bindings after the native start-message clone and during terminal cleanup. A chunk's private own-data record clears its byte reference in `finally` before awaiting the sink, including synchronous throws. Caller objects, incoming messages and sink-owned buffers are not modified; metadata accounting, backpressure, first-failure identity and rollback semantics are unchanged.
- Native Chrome 156 used real module Workers, 64-note snapshots, WeakRefs and explicit main-thread major GC after MessageChannel turns. The caller retained its job, signal and sink promises, observing snapshots/chunks only weakly. The table reports score/voice-graph and chunk reachability, not heap sizes or natural GC timing:

| Native observation boundary | Before: score / chunk | After: score / chunk |
| --- | --- | --- |
| Active stalled write | live / live | collected / collected |
| Cancelled header write, sink still stalled | live / live | collected / collected |
| Cancelled PCM write, sink still stalled | live / live | collected / collected |
| Cancelled close, sink still stalled | live / collected | collected / collected |
| Synchronous write failure, failed job held after sink release | live / live | collected / collected |
| Completed control | collected / collected | collected / collected |

- All observed first-note, voice/operator, settings, chunk and backing-buffer targets were also collected in the after run. Late sink completion did not add writes/acknowledgements after cancellation; abort/termination stayed once-only. Successful controls matched the independent core's complete 277-frame stereo WAV byte for byte. These probes do not claim release of independently retained caller/sink/error references or cancellation of storage work.
- Fifteen additional native compatibility cases compared every WAV byte across PCM16/24 with and without dither and float32. They cover eco/standard/high with 1/127/4096-frame chunks, asynchronous MessageChannel-backed writes, native buffer transfer/detachment, custom tuning, fractional pitch and shadow byte-length getters. All matched with zero shadow reads/DSP errors and correct final byte/frame/close accounting.
- Build, all 475 behavioral tests and strict/public/DOM-free type checks passed. GC ownership remains explicit native smoke rather than a nondeterministic permanent test; existing behavioral regressions retain transfer, stalled-sink cancellation, late rejection, observer failure and protocol coverage. Independent scoped handoff/lifecycle/input review found no blocker and is not release approval.
- Installed-package/security gates passed, including the installed asset CLI and public/DOM-free consumer contracts.

### Worker caller inputs and observers

- Capture validated primitive settings, sink receiver and observer bindings instead of retaining the complete private caller-options copy. Drop cached sink owner/method and observer bindings after terminal rollback invocation/notification, without mutating original objects or awaiting stalled storage promises.
- Native Chrome 156 used real module Workers, named voices from a genuine Map, custom tuning and WeakRefs with explicit major GC after MessageChannel turns. The caller retained its job, signal and sink gates, not the observed inputs, callbacks or sink. Reachability observations were:

| Native boundary | Before: registry/tuning / observers/sink | After: registry/tuning / observers/sink |
| --- | --- | --- |
| Active stalled write | live / live | collected / live |
| Cancelled stalled write | live / live | collected / collected |
| Cancelled stalled close | live / live | collected / collected |
| Completed control | collected / collected | collected / collected |

- Raw voice/operator and tuning-offset targets followed their respective input graphs; callback markers followed observers. Releasing sink gates after cancellation added no writes/progress. Successful controls matched the independent core's complete 296-frame stereo WAV byte for byte with zero DSP/page errors. These observations are not heap-size, natural-GC-timing or independent user-reference guarantees.
- Eight additional native cases covered PCM16/float32, write-only/optional close/optional abort/all-method sinks, ordinary/null prototypes, present/absent observers and actual transfer/detachment with shadow byte-length getters. Every WAV byte and final accounting matched the independent core, original receivers were preserved and shadow reads stayed zero.
- Added a behavioral regression for cancellation from initializing/writing phase callbacks: rollback and the final cancellation notification remain available, with no sink handoff or later progress. Build, all 476 behavioral tests and strict/public/DOM-free type checks passed. Independent scoped lifecycle/input/reentrancy review found no blocker; it is not release approval. GC checks remain throwaway native smoke, not nondeterministic permanent tests.
- Installed-package/security gates passed, including the installed asset CLI and public/DOM-free consumer contracts.

### Terminal stream ownership

- Release the redundant prepared-score snapshot binding after live frame-queue construction and on first stop. Terminal cleanup clears the normal error-observer binding; failure handling snapshots it before cleanup. A separate in-flight startup observer preserves the existing last load-error notification after stop and clears on settlement. Public signatures, eager validation, density/ID limits, scoped cancellation, one-shot semantics and callback-error propagation are unchanged.
- Native Chrome 156 exercised the actual public helper and AudioWorklet. Private score targets were observed only weakly at the native freeze boundary, restored before startup; collection used explicit major GC after MessageChannel turns, without timed sleeps. Held handles/OPM/controllers remained reachable. Started terminal cases verified stopped state before closing OPM to remove independent registration/context roots:

| Native boundary | Before: snapshot / error observer | After: snapshot / error observer |
| --- | --- | --- |
| Ready, not started | live / live | live / live |
| Running | live / live | collected / live |
| Stop/dispose, active cancellation, natural completion or startup error | live / live | collected / collected |
| Stopped while audio startup is pending | live / live | collected / live |
| That startup's rejection delivered | live / live | collected / collected |

- Across the eight ordinary lifecycle cases, the prepared event array followed its snapshot wrapper; queued first-event/voice/operator targets remained live while running and collected after terminal cleanup. The completed control observed both real gates accepted, started, released and ended; explicit pumping confirmed natural termination before closing the engine, with zero pending/active voices, DSP/rejection/page errors.
- A separate borrowed native AudioContext delayed a genuine missing-module request behind a promise gate. Stop preceded the actual 404 load failure: one callback and rejection received the same original native error, then both observer and marker collected. Pending startup intentionally retained that observer until notification. These are reachability observations, not heap-size, natural-GC or cancellation-of-startup guarantees.
- Added a deterministic behavioral regression for stop during module loading followed by failure: preserve exact rejection/callback identity once, admit no notes and reject restart. Build, all 477 behavioral tests and strict/public/DOM-free type checks passed. Independent scoped lifecycle/input/reentrancy review found no blocker and is not release approval; GC probes remain throwaway native smoke.
- Eight additional native observations kept each started OPM/context running during collection. Terminal handles still released all tracked private score, event, voice/operator and error-observer targets; active queued graphs/observers and ready controls stayed live. Cleanup did not require closing the engine in these scenarios.
- Installed-package/security gates passed, including the installed asset CLI and public/DOM-free consumer contracts.

### Disposed lookahead callbacks

- Keep restartable stop separate from permanent disposal. Lookahead holds callbacks in clearable private bindings; idempotent disposal runs scoped stop and clears schedule/error callbacks plus its observer record in `finally`. Executing context/stop/pump operations snapshot their last error listener before reentrant work. Validation, admission/ID limits, timing windows, callback receivers and scoped gate ownership are unchanged.
- Native Chrome 156 used the actual public helper, AudioWorklet and held helper/OPM/start-promise controls. Callback functions and isolated owner markers were observed only with WeakRefs and explicit major GC after MessageChannel turns, without timed sleeps:

| Native boundary | Before: callbacks/markers | After: callbacks/markers |
| --- | --- | --- |
| Ready, running or restartable stop | live | live |
| Dispose before start or after running | live | collected |
| Dispose during pending native module load | live | collected |
| Executing schedule disposes itself, then throws | live | collected |

- All eight native lifecycle cases passed. Both stopped controls restarted and invoked the original schedule exactly once before stopping again. Releasing a real native module-load gate after disposal did not invoke the schedule or admit voices/events; the OPM remained usable. The executing self-disposal case still notified its original error exactly once with preserved identity. Strict callback receiver checks and page/DSP/rejection diagnostics passed, with started engines left running during collection.
- Added a deterministic regression for the self-dispose/throw transition, preserving its executing failure notification with no active/queued voices and rejected restart. Build, all 478 behavioral tests and strict/public/DOM-free type checks passed. Independent scoped lifecycle/input/reentrancy review found no blocker and is not release approval. GC observations remain throwaway native smoke, not natural-GC or whole-heap guarantees.
- Installed-package/security gates passed, including the installed asset CLI and public/DOM-free consumer contracts.

### Inactive targeted LFO factors

- Reuse frame-level AM/PM activation guards for global and per-operator factors. Disabled channels still refresh targeted scratch factors to exact unity because pitch glides read them. Delay, analytic/global/live-rate phase, oscillator/noise clocks, validation, quality profiles and public signatures are unchanged; no allocation or dependency was added.
- Native V8 accurate function-entry counters on shipped modules isolated a single voice over 512 output frames. One known priming entry was subtracted per function. Precise coverage disables optimization, so these are work counts, not timings. Existing disabled-LFO waveform and muted-periodic bypasses were already working and remain unchanged.

| Targeted case | Before: `fastExp2` calls | After |
| --- | ---: | ---: |
| AM and PM depths zero | 1536 | 0 |
| AM active, PM depth zero | 1536 | 0 |

- Separate optimized measurements used Node 26.7 / V8 14.6 on local arm64, two fresh processes per implementation with reversed initial variant order, two warmups and five samples. Each timed only 32768 frames of 16 voices at 48 kHz through reusable 128-frame stereo buffers; construction, admission, verification and explicit GC stayed outside. The table reports the range of the two process medians for inactive nondefault targets. Omitted-target controls showed no local regression; these are not browser deadline or universal speed guarantees.

| Quality / waveform | Before render ms | After render ms |
| --- | ---: | ---: |
| eco / sine | 33.63–34.58 | 27.30 |
| eco / saw | 53.71–58.35 | 46.36–47.66 |
| standard / sine | 44.65–46.14 | 37.67 |
| standard / saw | 89.80–93.64 | 77.67–78.43 |

- All 4320 before/after cases retained complete stereo PCM hashes and frame/voice/error state across all algorithms, qualities, operator/LFO shapes and initial depth combinations, spanning 8/44.1/96 kHz. Controls exercised delay/global phase, rate/depth ramps, zero modulation, mute/unmute, instantaneous pitch changes and release. Another 27 public muted-clock comparisons included held operator noise. Every case remained finite with zero DSP errors.
- Native Chrome 156 passed 36 real module-Worker cases across qualities, PCM16/float32, sine/noise LFO and inactive/AM-only/PM-only initial states. Every WAV byte matched independent full browser-core rendering and preserved its native before/after hash; asynchronous transferred-buffer sinks retained exact frame/byte/close/error accounting.
- Added an independent weighted-target regression through live rate/depth changes, zero modulation and pitch glides, with unequal render chunk sizes. Build, all 479 behavioral tests, strict/public/DOM-free types, the 2505-case numerical matrix with 24 live-control cases, and voice-quality acceptance passed. Actual Chrome AudioWorklet smoke observed finite stereo/pan output, complete gate lifecycles and zero pending/active voices, DSP errors or rejected notes.
- Independent scoped supported-input A/C review found no blocker; static review is not release approval. Physical-device/MIDI and human-listening acceptance remain unverified.
- Installed-package/security gates passed, including the installed asset CLI and public/DOM-free consumer contracts.

### Unity and zero-weight LFO masks

- Classify already-validated target tuples once at admission: explicit all-unity masks use the same shared factors as omitted targets. Every admission still resets both private flags and copies all four weights. Zero-weight targets refresh exact unity without redundant AM products or PM exponentiation. No cache, persistent state, allocation, dependency, public signature or voice-format change was added.
- Native V8 accurate entry counters isolated one active voice for 512 output frames with AM depth 0.4 and PM depth 300. Construction/admission preceded profiling; one positive priming entry per function was subtracted. Coverage ran with optimization disabled and measures work, not elapsed-time improvements.

| AM/PM mask | Before: `fastExp2` entries | After |
| --- | ---: | ---: |
| omitted | 512 | 512 |
| `[1,1,1,1]` | 512 | 512 |
| `[0,0,0,0]` | 2560 | 512 |
| `[0,1,0,1]` | 1536 | 512 |
| `[0.5,0.5,0.5,0.5]` | 2560 | 2560 |
| `[0,0.25,0.5,1]` | 2048 | 1536 |

- Active cases retained 512 LFO evaluations; inactive controls retained zero LFO/exponential entries. Zero masks do not introduce a clock freeze or claim to remove every unused global calculation.
- All 6480 before/after cases preserved complete stereo hashes and frame/error/terminal state across qualities, algorithms, operator/LFO shapes and masks, spanning 8/44.1/96 kHz. Bounded traces exercised delay/global phase, depth/modulation transitions, rate/depth ramps, actual glide, mute/unmute and release. Independent uniform-mask/global-depth references used unclipped trajectories and differing chunks.
- Native Chrome 156 passed all 36 actual module-Worker cases with global noise LFO, mixed periodic operators, stereo, soft-knee/DC blocking and PCM16 TPDF/float32 output. Every WAV byte matched full browser-core rendering and its preserved before bytes. Each case completed 7224 frames, 30 transferred writes/progress callbacks and 31 MessageChannel turns, with original strict sink receivers, one close, no abort or numerical/page errors.
- Timing was deliberately not converted into an overall renderer speedup claim. Fresh-process and same-process measurements were order-sensitive. Corrected paired runs used exact reconstructed prior/current methods, monomorphic timing callsites and counterbalanced implementation order; same-code A/A controls still showed substantial variation. Default, fractional and weighted-path results do not establish a dependable improvement or regression. Counted redundant work and the shared all-unity path, not a selected timing percentage, justify this bounded change.
- Expanded the existing regression through half, independently mixed AM/PM, unity and zero masks on reused engines, covering all four targeted-flag combinations. Independent unclipped-depth scaling remains exact through live controls, genuine glide, release and unequal chunks. Build, all 479 behavioral tests and strict/public/DOM-free checks passed.
- Another 4320 mixed-channel cases compared reconstructed prior and shipped current engines: all-unity or omitted AM with weighted PM, and vice versa. Complete stereo hashes and terminal/frame/error state remained identical across qualities, algorithms, operator/LFO shapes, live controls and unequal chunks.
- Rebuilt changed methods matched the exercised runtime text exactly. The 2505-case numerical matrix with 24 live-control cases, voice-quality acceptance, actual Chrome AudioWorklet stereo/pan/lifecycle smoke and installed-package/security gates passed, including the asset CLI and public/DOM-free consumer contracts.
- Scoped supported-input A/C review found no blocker; direct internal numerical corruption is not comprehensively detected, and static review is not release approval. Physical-device/MIDI and human-listening acceptance remain unverified.

### Disposed musical error callbacks

- Transport and Arrangement hold `onError` in clearable private bindings. Their permanent, idempotent disposal clears that binding in `finally` before existing unsubscription; restartable stop/pause and natural completion retain it. Executing failure paths snapshot the listener before normalization/cancellation, preserving their final notification if host observers dispose the helper during synchronous stop acknowledgement.
- No score, map, musical metadata, public snapshot, OPM or caller input is cleared. Existing generation/disposed checks still prevent invalidated startup from reviving scheduling: the underlying promise fulfills or rejects, but does not notify a disposed helper's stale error listener. Shared engines remain independently usable.
- Native Chrome 156 exercised nine modes per helper with the actual public API and AudioWorklet. Held handles/engines, plus pending promises where applicable, survived explicit major GC after MessageChannel turns. Functions and isolated owner markers were observed only through WeakRefs; this is not a natural/immediate-GC or whole-heap guarantee.

| Native boundary, both helpers | Before: callback/marker | After |
| --- | --- | --- |
| Ready, running or restartable stop | live | live |
| Disposed before start or after running | live | collected |
| Disposed during genuinely pending native module load | live | collected |
| Error callback disposes its own handle, after execution | live | collected |

- All 18 before/after lifecycle cases passed. Twelve tracked raw-input objects per helper already collected in every baseline/control mode and still did afterward. Every restartable control restarted and a real context suspension invoked the original strict callback exactly once. Public disposed snapshots, IDs and guarded mutations remained stable; Arrangement retained its pending section metadata.
- Real module-load gates covered success and HTTP404 failure after disposal. Success fulfilled, failure rejected with the native load error, and neither admitted notes nor invoked stale callbacks; callbacks/markers collected even while initialization was held pending. Transport drained to zero active/pending/errors/rejections before independent engine use and again afterward. Arrangement's pending/disposed diagnostic snapshots were zero active/pending/errors/rejections; other cases used actual native lifecycle observations without claiming all release tails had already drained.
- Added deterministic regressions in the existing worklet harnesses: missed-window cancellation emits a synchronous stop acknowledgement, a host subscriber disposes the helper, and the executing error still reports once. Disposed snapshots stay readable/stable, restart/mutation rejects, and owned tails drain without active/pending work. Build, 48 targeted musical tests, all 481 behavioral tests and strict/public/DOM-free checks passed.
- Independent scoped lifecycle/input/reentrancy review found no blocker; static review is not release approval.
- Installed-package/security gates passed, including the asset CLI and public/DOM-free consumer contracts.

### Performance and MIDI callback ownership

- Permanent Performance disposal clears only its private error callback before teardown. Its entered event observation snapshots the original listener, preserving cleanup/rejection notifications across reentrant disposal. Sustain/all-notes-off remain reusable; earlier host-subscriber disposal still prevents entry into the unsubscribed observer, and synchronous operation failures still throw.
- MIDI disposal clears its cached error observer only after owned-key cleanup succeeds. Failed forced releases retain ownership and reporting for `releaseAll()` retry; successful retry on a disposed adapter clears the binding. Each entered port-open operation and pedal-detach loop keeps its original listener. Pending port-open rejection after disposal remains observable rather than being silently suppressed.
- Native Chrome156 Performance before/after runs held ten public handles and an independently controllable engine/note across explicit CDP GC. All ten raw option objects collected before and after; five disposed callback/captured-owner pairs changed from retained to collected, while all five reusable controls retained theirs. Four real capacity rejections from bounded 257-command batches of future public controls exercised strict undefined receivers, one original notification, self-disposal and callback-throw isolation.
- Native AudioWorklet plus **simulated structural EventTarget MIDI ports**, not physical Web MIDI, exercised nine modes. Five raw option/map/allowlist objects collected per mode; host-held access/input/Performance objects intentionally remained live. Ready/held/releaseAll controls retained callbacks. Successful disposal and completed self-disposal/synchronous-open failure released them. Genuinely pending opens retained their observer until success/failure settled, then callback/owner collected; rejection still notified once. Listener removal, readable snapshots, no post-dispose admission and independently held Performance keys/shared-engine use remained correct.
- A misordered Performance disposal plus reentrant adapter cleanup preserved all six observed failure notifications and intentionally retained its retry observer. A separate port's synchronous `open()` disposed the adapter and threw: the original error still notified exactly once with strict undefined receiver.
- Scoped review exposed compatibility defects in intermediate optimizations: disposing from the first pedal cleanup error dropped the second channel's error; calling `releaseAll()` from the first disposal error dropped the next input's error. Each regression failed with one notification instead of two before listener snapshots covered both the entered detach loop and the entire disposal operation. Both native scenarios then reported both failures, removed all listeners, left stable empty disposed snapshots and zero active/pending/errors/rejections while the shared engine remained running.
- Review also found a pre-existing lifecycle defect: refresh continued attaching later inputs after an opening-error callback disposed the adapter. The regression reproduced a second `open()` attempt and retained listener; refresh now stops as soon as attach returns to a disposed helper. Already-entered open/cleanup operations retain final error reporting; unopened inputs are no longer touched.
- Five deterministic regressions cover entered Performance rejection cleanup, late port-open rejection, multi-channel pedal cleanup, multi-input disposal and refresh cutoff. Build, 43 targeted tests, all 486 behavioral tests and strict/public/DOM-free checks passed. Native refresh verification left the second port unopened, all listeners removed and the disposed snapshot empty. Native reference observations use explicit major GC, not a natural/immediate-GC or whole-heap guarantee. Shared-workload MIDI diagnostic snapshots include intentionally held external notes and are not an all-zero voice claim.
- Final scoped lifecycle/input/reentrancy re-review found no remaining blocker. Installed-package/security gates passed, including the asset CLI and public/DOM-free consumer contracts. Static review is not release approval; physical MIDI/device and human-listening acceptance remain unverified.

### Exact-unity dynamic pitch preparation

- Dynamic pitch preparation uses positive unity for an exactly zero combined semitone/envelope exponent instead of evaluating `fastExp2(0)`. Both signed zeros were verified equivalent. Start/end expressions still execute in their original order; nonzero/nonfinite inputs and the per-substep ratio are unchanged. No cache, state, allocation, clock, ramp, parser, protocol or API change was introduced; default static voices never enter this path.
- Native Node26/V814.6 interpreter-only precise coverage measured 512 frames after two excluded priming frames, for every quality. Earlier `--no-opt` helper counts were inconsistent and were discarded; `--jitless` counts matched exact frame/substep invariants. This is a work-count result, not a normal-JIT timing, overall speedup or device-latency claim.

| 512-frame workload, every quality | Before exponential entries | After |
| --- | ---: | ---: |
| Static voice | 0 | 0 |
| Zero-pitch ratio / fixed-Hz / simultaneous frequency ramps | 512 | 0 |
| Nonzero constant pitch with ratio ramp | 512 | 512 |
| Genuine pitch glide with ratio ramp | 1024 | 1024 |

- Dynamic preparation remained 512 calls, pitch/envelope reads 1024 each, frequency samples 6144, and substeps 1024/2048/4096 for eco/standard/high. All counters, clocks, errors and complete stereo PCM remained equal except the skipped exponential entries.
- Frozen before/after native Node matrices covered 11,664 cases per implementation: all three qualities, eight algorithms, nine operator waves, three rates and 18 scenarios. Both compiler output and canonical minified distribution retained identical full stereo PCM, clock/state snapshots and exact release/steal callback frames under different chunk widths, including zero crossings, nonzero end factors, cancelling pitch/envelope terms, interrupted frequency ramps, mute/noise clocks and slot reuse. Every case reached exact terminal silence with restored pools and no errors.
- Native Chrome156 compared 288 complete Worker WAV cases against frozen bytes and independent browser core/WAV encoding; each phase rendered 576 Workers including repeated transferable sink ownership. Each clip was 968 frames with nine writes: PCM16 TPDF 3916 bytes or float32 7802 bytes. All WAV/interleaving/progress checks passed, with 576 closes, zero aborts/errors and 2592 transferred writes per phase.
- Build, 32 targeted pitch/expression tests, all 486 behavioral tests and strict/public/DOM-free checks passed. Scoped supported-input A/C review found no blocker; it was static review, not release approval.
- Acoustic quality passed 2505 matrix and 24 live-control cases; all 84 curated voice-quality groups were accepted. Installed-package/security gates and the actual Chrome156 48kHz AudioWorklet stereo/pan/lifecycle smoke passed with zero final active/pending/errors/rejections. Physical-device/MIDI and human-listening acceptance remain unverified.

### Lazy fixed-Hz ratio evaluation

- Dynamic frequency sampling and live retuning now evaluate the existing ratio fallback only when ratio mode needs it. Fixed-Hz targets no longer compute a discarded ratio interpolation. Both sites retain the same used-branch arithmetic, frequency interpolation, detune/pitch/caps and logical tuning updates; ratio timelines continue advancing for later `null` restoration. Validation remains eager, including ratios hidden behind fixed Hz. No cache, state, allocation, parser, protocol or public contract was added.
- Native Node26/V814.6 interpreter-only precise coverage checked every quality, with two excluded priming frames for 512 measured frames, or one excluded priming action for 16 public retunes. Counts below are `rampAt` entries, not normal-JIT time or an overall/default speedup claim.

| Workload | Before | After |
| --- | ---: | ---: |
| 512 static fixed-Hz frames | 0 | 0 |
| 512 ratio-mode ramp frames | 14336 | 14336 |
| 512 ratio-ramp frames, two fixed-Hz operators | 14336 | 11264 |
| 512 ratio/simultaneous-ramp frames, four fixed-Hz operators | 14336 | 8192 |
| 512 Hz-only ramp frames, two fixed-Hz operators | 12288 | 9216 |
| 512 Hz-only ramp frames, four fixed-Hz operators | 12288 | 6144 |
| 16 retunes, no fixed-Hz operators | 128 | 128 |
| 16 retunes, two fixed-Hz operators | 128 | 96 |
| 16 retunes, four fixed-Hz operators | 128 | 64 |

- Dynamic frequency sampling remained 6144 calls and control advancement 512 calls per measured clip; all five fixed-Hz masks retained their 16 retune/pitch calls. Stereo PCM and clocks remained exact.
- Frozen dev/dist Node matrices covered 1944 balanced cases across all qualities, algorithms, waves and three sample rates, plus 36 independent restoration oracles. Full-channel hashes, streaming boundary-state digests and terminal callback frames matched before/after under changed chunk widths. The oracles prove ratio edits are inaudible while fixed Hz holds, then restoration follows the current rather than stale ratio.
- Native Chrome156 exercised 144 scores, 576 actual Worker renders and 288 independent canonical WAV encodes per phase. Compiler output and minified distribution retained identical PCM16 TPDF/float32 bytes, 980352 total frames and 5911488 bytes, with strict sink receivers, detached transfer ownership, acknowledged progress/backpressure, 576 closes and zero aborts/errors. Chunk width intentionally changed from 97 to 113; transfer/progress counts consequently differ and are not an optimization metric.
- Build, 32 targeted pitch/expression tests, all 486 behavioral tests and strict/public/DOM-free checks passed. Scoped supported-input A/C review found no blocker; it does not claim comprehensive internal-state validation or release approval.
- Installed-package/security gates, asset CLI/public/DOM-free contracts and actual Chrome156 48kHz AudioWorklet stereo/pan/lifecycle smoke passed, with zero final active/pending/errors/rejections. Physical-device/MIDI and human-listening acceptance remain unverified.

### Zero-swing chorus work

- Chorus computes sine/cosine only when its actual delay swing is nonzero. The exact-zero path keeps centred taps, delay reads/writes, feedback, LFO phase, parameter ramps, order fades, reverb and tail state advancing. Positive depth with zero wet mix is not shortcut. No cache/state/allocation/API/protocol change or approximate threshold was introduced.
- Actual dry-bypass impulse experiments confirmed that later wet activation reveals accumulated history; skipping the whole network would change sound. A separate forwarding-counter probe, with original Math intrinsics restored in `finally`, measured the calls below over 512 frames. It is instrumentation, not a normal-JIT timing, overall speedup or latency claim; unmodified native audio proof is separate.

| 512-frame chorus workload | Before sin/cos calls, each | After |
| --- | ---: | ---: |
| Absent chorus or exact zero depth, 8/48/96 kHz | 512 | 0 |
| Positive depth, including zero wet mix | 512 | 512 |
| Depth fading to zero at 8 kHz, 160-frame ramp | 512 | 159 |
| Depth fading to zero at 48/96 kHz, ramp still active | 512 | 512 |
| Depth fading up from zero | 512 | 512 |

- Full PCM, all delay-buffer/filter hashes, phase and remaining-ramp state stayed exact in those probes. A separate unmodified Node matrix covered 62 cases, 729069 frames per dev/dist/frozen runtime, six rates, live depth/rate/voice/order changes, reset, representative full tails, history reactivation, offsets/zero-length/aliasing and signed-zero behavior; two further raw cases verified nonfinite sanitation.
- Actual Chrome156 OfflineAudioContext AudioWorklet processing matched complete independent frozen-core PCM bit-for-bit in 48 static cases and 376512 stereo frames at 8/44.1/48/96 kHz. Real live AudioContext update/reset/disposal and disposed/closed guards passed; disposal left the caller context running and the caller closed it. The public port has no processing acknowledgement, so this does not assert deterministic live-update PCM alignment.
- Added an independent analytic fractional-delay regression at 16/48 kHz: zero-depth history followed by a 20 ms depth ramp retains continuously advanced LFO phase and quarter-cycle stereo taps. Build, 14 targeted effects tests, all 487 behavioral tests and strict/public/DOM-free checks passed. Scoped supported-input A/C review found no blocker; private corrupt-state behavior is not a broader validation guarantee or release approval.

- Installed-package/security gates passed: zero runtime dependencies/dynamic code, the 1.13.1 package render/WAV smoke, asset CLI and public/DOM-free type contracts. Guides and generated HTML are synchronized. Native static output/lifecycle evidence does not establish physical-device, listening, realtime-latency or live-message alignment acceptance.

### Effects observer terminal ownership

- Reproduced retained `onEvent` callbacks and captured owners while callers kept disposed effects handles alive. Terminal disposal now clears the private observer before the no-node return or node cleanup. Public `input`/`output` nodes and the borrowed context remain caller-owned; this is not a promise to collect the handle, nodes or context.
- Terminal failure paths snapshot the observer before cleanup or potentially reentrant error conversion, preserving the already-entered notification and original thrown value. Synchronous throwing/reentrant observers remain isolated. Reset, parameter updates and recoverable protocol/rate replies retain the active observer; stale handlers cannot revive a cleared binding.
- Actual Chrome156 used native AudioWorklet nodes, real deliberately crashing same-origin processors and a true module 404, plus an explicitly synthetic `messageerror` dispatch on a native port. Recoverable errors came from one deliberately invalid native-port message. Handles/contexts stayed strongly held through twelve explicit CDP GC rounds with MessageChannel turns:

| Weak-reference group | Before: still reachable | After: still reachable |
| --- | ---: | ---: |
| Six terminal callbacks and six captured owners | 12 | 0 |
| Two active/reset-update callbacks and two owners | 4 | 4 |
| Two failed-factory callbacks and two owners | 0 | 0 |
| Ten raw options and ten raw params objects | 0 | 0 |

- All ten cases preserved notification category/count, frozen events, strict callback receiver, disposed guards and host-context ownership. Every context remained running until explicitly closed by the fixture; all ten ended closed. Native module error text includes ephemeral loopback ports and was recorded, not text-pinned. This is explicit-GC reachability evidence, not immediate/natural collection, a full heap census, physical audio, listening, latency or live PCM-alignment acceptance.
- Added a deterministic consumer regression covering processor/message-decode/post/module failures: one original notification after terminal cleanup, callback self-disposal/throw isolation, original post/module Error identity and borrowed-context state. Build, 15 targeted effects tests, all 488 behavioral tests and strict/public/DOM-free checks passed. Independent scoped ownership/lifecycle/input review found no blocker; not release approval.

- Installed-package/security gates passed: zero runtime dependencies/dynamic code, the package render/WAV smoke, asset CLI and public/DOM-free type contracts. README, effects guide and generated HTML are synchronized.

### Invariant WAV format flags

- Select `float32`/`pcm16` flags once per `encodeInto` call instead of rereading the fixed format for every sample. Native sample capture/finite-range rejection, asymmetric integer quantization, endian order, Float32's 58-byte header and unaligned data offset, PCM24 sign bytes/padding and transactional TPDF/frame accounting remain unchanged. No persistent state, cache, allocation, dependency or public API/format change was added.
- The isolated prototype reproduced the original production esbuild/Terser module exactly; rebuilt production code then matched the timed prototype exactly. Normal Node26.7/V8 14.6 measurements on Apple M5 used two fresh processes, deterministic 262145-frame PCM at 48 kHz, eight excluded warmups and 24 samples per module, balanced/reversed order, explicit GC outside timing and complete output hashing afterward. `A` is original, `AA` is a separate same-code instance and `B` is the hoisted prototype. Lower elapsed-median ratios are better:

| Format | Channels | Dither | B/A run1 | B/A run2 | AA/A run1 / run2 |
| --- | ---: | --- | ---: | ---: | ---: |
| PCM16 | 1 | off | 93.8% | 95.4% | 100.3% / 99.2% |
| PCM16 | 2 | off | 100.7% | 96.4% | 103.6% / 100.4% |
| PCM16 | 1 | on | 96.8% | 95.0% | 99.1% / 97.5% |
| PCM16 | 2 | on | 98.1% | 94.8% | 102.3% / 95.7% |
| PCM24 | 1 | off | 89.1% | 86.3% | 99.9% / 100.3% |
| PCM24 | 2 | off | 93.1% | 90.8% | 97.9% / 97.7% |
| PCM24 | 1 | on | 89.0% | 89.0% | 99.7% / 100.1% |
| PCM24 | 2 | on | 94.5% | 93.9% | 100.1% / 99.8% |
| Float32 | 1 | off | 83.8% | 83.5% | 99.3% / 100.4% |
| Float32 | 2 | off | 90.5% | 90.6% | 99.2% / 100.7% |

- Two further fresh processes covered all ten format/channel combinations at chunks of 1/32/128/512/4096/65536 frames, six excluded warmups and 18 samples per module. Timed work included encoder/header/finalize and output-part collection; all bytes were hashed outside timing. Float32/plain PCM24 retained useful directions, but tiny chunks/default PCM16 and substantial first-process dither A/A module/JIT asymmetry do not justify generalized speedup claims. These are host-sensitive synchronous codec observations, not overall synthesis/export throughput, Worker transfer/backpressure, device latency or realtime capacity evidence.
- Independent actual dev/dist/frozen Node proof covered 86 fixtures, 4997185 frames and 11798480 complete output bytes: 344 full-buffer runs, 688 streaming runs, 7484 chunks and 3016 rejection checks. A scalar reference checked every header/data/padding byte, float bits, integer quantization and deterministic TPDF. Five rates, mono/stereo, native offsets/aliasing/static shared PCM, chunk edges and a 4M-frame full-buffer case passed; complete buffers, frame/finished transitions, late rejection/dither retries and 22 unchanged helper hashes remained exact.
- Actual Chrome156 ran 45 real stereo Worker renders across all five format/dither combinations, three rates and all three qualities: 371640 frames and 2083290 bytes. Thirty additional native mono/stereo decode cases covered 510 frames and 3552 bytes, including odd PCM24 padding and Float32 fact/header bytes, at matching context rates; no decoder capability failure occurred. Float32 decoded samples were exact, and integer samples passed quantization-appropriate checks.
- All 75 native complete WAV baselines stayed byte-identical, corpus SHA256 `70d726fbbe8c4051df41dfffa0472efd09398d7b3e3ba9ddbc2b294dd31e6166`. Worker partition changed 127→251 and direct encoding 3→7: different transfer/progress counts are chunking differences, not optimization metrics. Transparent forwarding wrappers counted real Worker post/terminate activity and were restored in `finally`; this was not timing evidence. Sink ownership/receivers, gated acknowledgement, progress/completion, write/close failure, cancellation/late rejection, native load-error and preabort guards passed. All 49 tracked Workers terminated; fixture ports/contexts/page/browser/server closed.
- Build, 35 targeted WAV/Worker/DSP tests, all 488 behavioral tests and strict/public/DOM-free checks passed; scoped supported-input A/C review found no blocker. Existing behavior regressions and public format documentation remain intentionally unchanged; no permanent wiring/source/wording test was added. Static shared PCM proof does not establish concurrent mutation safety or a whole-buffer atomic snapshot; no physical-device/listening/realtime or release approval is implied.

- Installed-package/security gates passed: zero runtime dependencies/dynamic code, the 1.13.1 package render/WAV smoke, asset CLI and public/DOM-free contracts. Changelog/security evidence and generated HTML are synchronized; public usage/format documentation needed no semantic change.

### Terminal chunk-render ownership

- Actual synchronous Worker start handlers already released raw packet/event/options/voice references after returning, including while the header ACK was withheld. No raw-input cleanup or Worker protocol change was warranted. The unnecessary retention was the held terminal chunk iterator's private Synth/prepared voice, scratch buffers and borrowed AbortSignal after no future PCM could be rendered.
- Core terminal cleanup now snapshots the DSP error count and clears private Synth/buffer/signal references plus state/queue on cancel, iterator return, observed abort and the final yielded chunk. Capacity/frame/event/error diagnostics and already-yielded arrays remain valid. Active chunks retain live state; caller buffers/signals/listeners are not cleared, detached or mutated. The existing cancellation function allocation is reused, with private natural-completion dispatch rather than calling an overridable public method; existing `return()`/observed-abort public dispatch remains intact.
- Native Node26.7 dev/dist probes used transparent real `Synth.render`/`noteOn` forwarding hooks, WeakRefs, MessageChannel turns and explicit GC. At 65536-frame chunks the two observed scratch backings totalled 524288 bytes; this is bounded backing ownership, not a heap census or memory returned to the OS. Signal probes dropped caller/controller scopes and used native `abort(null)` to isolate ownership from incidental default abort-reason Error stacks:

| Weak-reference group | Before | After |
| --- | --- | --- |
| Active Synth/prepared voice/scratch | Retained | Retained |
| Held terminal iterator's Synth/prepared voice | Retained | Collectible |
| Terminal scratch with no external holder | Retained | Collectible |
| Externally held yielded view/backing | Retained, unchanged | Retained, unchanged |
| Terminal unheld signal/listener-owned object | Retained | Collectible |
| Externally held signal/controller/listener | Retained | Retained; original listener still fires |
| Raw caller/start packet inputs | Collectible already | Collectible |

- Separate uninstrumented actual dev/dist proof kept every complete PCM buffer, capacity/counter and terminal/error result exact across 76 cases and 1506632 PCM bytes per build, changing ordinary chunk partitions 17→113. Coverage includes all qualities, eight algorithms, sine/saw/noise plus a large square case, 8/44.1/96 kHz, controls, stealing, ties, empty scores, validation, initial cancel/return, pre/observed abort, full-buffer convenience output and borrowed-buffer behavior. A 66537-frame case retained the final partial 1001-frame view. Combined PCM/capacity/counter SHA256 stayed `90889b07929070f53e885781d1a8630253a16a4142bfbc35f8e1b2496dd8f30a`.
- Actual Chrome156 native Worker isolates genuinely exposed `gc` under `--js-flags=--expose-gc`. Fixture-only WeakRef hooks/control messages left canonical protocol code unchanged. With final PCM ACK still withheld, the Synth became collectible; an explicitly held left view kept only its own backing alive, and dropping it allowed both scratch backings to collect. Header/intermediate state remained live. Transferred encoded wrappers/backings and raw start data were already collectible; no fix is claimed for them.
- Separate uninstrumented public Worker smoke covered all five encoding configurations, all three qualities across representative rates, 38178 frames and five complete WAV files; adding the manual protocol file made 224430 unchanged bytes. Differing partitions preserved full bytes/terminal diagnostics, transfer detachment, gated backpressure, strict sink/observer receivers, original sink-error identity and protocol errors. Every fixture Worker/port/page/context/browser/server closed. Worker, Synth and public Worker-host sources stayed unchanged.
- Added a consumer regression preserving yielded PCM and diagnostics through complete/cancel/return/abort with no later advancement. Build, 39 targeted sequence/project/Worker tests, all 489 behavioral tests and strict/public/DOM-free checks passed. Scoped supported-input A/C review found no blocker. No new public API, persistent cache, extra cleanup closure, output copy or runtime dependency was added; explicit-GC evidence does not guarantee natural/immediate collection, full-heap/physical-device/listening/realtime acceptance or release approval.

- Installed-package/security gates passed: zero runtime dependencies/dynamic code, the package render/WAV smoke, asset CLI and public/DOM-free contracts. README/streaming ownership guidance, security evidence and generated HTML are synchronized.

### Live-edited positive sustain cache

- Live ADSR edits formerly stayed on per-substep dB evaluation after reaching a constant held sustain. Above-floor held gains with no sustain rate now use the existing frame-gain cache until release or another ADSR edit. The edited `fastExp2` expression is preserved rather than substituting the bit-distinct precomputed unedited sustain gain. No state fields, allocations, public API or voice-format changes were added.
- Actual Node26.7/V8 14.6 `--jitless` precise-coverage probes measured 512 frames at 48 kHz after four excluded priming frames, across 81 quality/operator-count/envelope cases. Counts below are `fastExp2` calls with four active operators; mixed means two held operators and two still moving. These are work counts, not JIT throughput or latency measurements:

| Quality | Before, held or mixed | After, all held | After, mixed |
| --- | ---: | ---: | ---: |
| eco | 4096 | 0 | 3072 |
| standard | 8192 | 0 | 5120 |
| high | 16384 | 0 | 9216 |

- Both unity and non-unity edited holds also eliminated measured `prepareGains`, `storeGain`, `gainAt` and `envelopeDbAt` calls once cached. Unedited holds were already cached; moving attack/decay, sustain-rate decay, release and zero/floor paths retained their exact control counts. All 81 complete stereo PCM hashes matched before/after; oscillator/noise/LFO/pitch clocks are not paused.
- Separate uninstrumented dev/dist proof passed 10368 cases, 20736 partitioned executions and 18662400 rendered frames across all qualities, eight algorithms, nine waveforms, three rates and eight envelope scenarios. Complete PCM hashes over 74649600 bytes and logical-state/callback hashes matched frozen baselines; partitions and dev/dist also matched directly. Cases cover adjacent edited-time boundaries, unity/non-unity/near-floor/floor gains, mixed envelopes, later edits/releases, reactivation, stolen/reused slots and simultaneous ratio/fixed-Hz/pitch/LFO/level controls. Derived gain-cache fields were intentionally excluded from logical-state equivalence.
- Actual Chrome156 ran 216 public Worker scores over all qualities/algorithms/waveforms with four representative rates, PCM16/24 with TPDF and float32. Every complete WAV byte matched the frozen baseline across chunk sizes 127/509: 9159948 bytes, unchanged diagnostics and zero errors. Actual AudioWorklet live ADSR edits/release also reached clean held→idle diagnostics. Command admission is not an execution-frame ACK, so the live smoke makes no exact-frame PCM claim. All native resources/server closed.
- Added a consumer regression checking dB level changes, sustain-rate slope, floor reactivation and terminal release notification across qualities. Build, eight targeted v8 tests, all 490 behavioral tests and strict/public/DOM-free checks passed. Scoped supported-input A/C review found no blocker; direct mutation of private envelope fields without invalidation remains unsupported. No physical-device, listening, realtime-capacity or release approval is implied.

- Installed-package/security gates passed: zero runtime dependencies/dynamic code, package render/WAV smoke, asset CLI and public/DOM-free contracts. README/security evidence and generated documentation are synchronized.

### Priority-ineligible victim pruning

- Victim selection now skips a candidate whose priority is higher than the current lowest eligible victim, before unused policy scoring. Such a candidate could not win under any policy. Incoming-priority exclusion, equal/lower-priority comparisons, quietest bookkeeping, release/age ties, refusal and victim/fade lifecycle remain unchanged. The cutover adds one guard, with no fields, allocation, cache, extra traversal, public API or voice-format change.
- Actual Node26.7 `--jitless` precise coverage measured public full-engine admissions with 32 voices at 48 kHz across 42 policy/envelope/priority-order cases. The table counts `voiceAudibility` calls for `quietest`; each edited four-carrier measurement also performs four gain/envelope/exponential evaluations. This is work-count evidence, not throughput, render capacity or latency:

| Priority order | Before | After |
| --- | ---: | ---: |
| Ascending | 32 | 1 |
| Descending | 32 | 32 |
| Equal | 32 | 32 |
| Alternating low/high | 32 | 16 |
| Rotated ascending | 32 | 2 |
| All protected above incoming | 0 | 0 |
| One eligible candidate | 1 | 1 |

- `oldest`/`release-first` already made no audibility calls and retained their exact control counts. All 42 outcomes, selected victims, terminal notifications, counters and complete post-admission PCM hashes matched before/after.
- Separate actual dev/dist proof passed 252 cases per runtime graph, with full-buffer hashes over 5171616 PCM bytes per graph, victim/callback diagnostics, clock checks and compact complete-state hashes matching frozen originals. Coverage includes all policies/qualities/algorithms, nine waveforms across representative rates, exact ties, zero-crossing velocity discrimination, release/envelope contours, refusals, fades and slot reuse. The after run performed 17352 independent sort-based ranking checks, 4752 mutation-free validation checks, 3168 refusals, 432 fade/pool-reuse cases and 144 callback reentries. The oracle reconstructs dB energy and deterministic numeric primitives for exact ties; no production method/module was patched.
- Added a consumer regression for quieter low-priority victims separated by a protected silent voice, oldest equal-gain ties and refusal. Build, 15 targeted priority/polyphony tests, all 491 behavioral tests and strict/public/DOM-free checks passed. Scoped supported-input A/C review found no blocker; skipped helpers only read/compute and were never a validation boundary. No physical-device, listening, realtime or release approval is implied.

- Actual Chrome156 passed 303 public Worker cases: all policies/qualities/algorithms with mixed priority orders, representative waveforms/rates and integer-with-TPDF/float32 encoding. Complete frozen-before WAV files retained all 11013510 bytes across chunk sizes 257/31, with exact diagnostics. Another 27 native default-quality Worklet cases preserved expected victims/refusals, callback-reentrant release and stable terminal metadata; page errors were empty. Release progression used a labelled native oscillator-ended audio-clock observation hook, not sleeps or a postMessage execution-frame claim. All native resources/server closed.

- Installed-package/security gates passed: zero runtime dependencies/dynamic code, package render/WAV smoke, asset CLI and public/DOM-free contracts. README/security evidence and generated documentation are synchronized.

### Steady carrier gains in quietest scoring

- `quietest` now reuses the existing Float64 frame gains only when `gainsSteady` guarantees constant render gains, including immutable static-zero operators. Nonsteady/unrendered gains still evaluate the current admission instant; release, ADSR edits and pooled admissions retain their invalidation. Normal versus edited sustain arithmetic stays distinct, and current operator/expression/layer weighting, carrier order and tie-breaking remain unchanged. No cache fields, allocation, traversal, public API or voice-format change was added.
- Actual Node26.7 `--jitless` coverage passed 198 public full-32-voice admissions across qualities, algorithms 0/7, static-level masks and eleven envelope/control modes. All outcomes, callbacks/counters and complete PCM hashes matched. Representative four-carrier counts at 48 kHz:

| Envelope/control state | `gainAt` before | `gainAt` after | `fastExp2` before | `fastExp2` after |
| --- | ---: | ---: | ---: | ---: |
| Unedited hold / fresh expression or level ramp | 128 | 0 | 0 | 0 |
| Edited hold | 128 | 0 | 128 | 0 |
| Attack / SR / release / just edited | 128 | 128 | 128 | 128 |
| Unrendered / instant release / edited floor | 128 | 128 | 0 | 0 |

- Separate normal-JIT production diagnostics isolated 100000 actual victim scans after 10000 warmups, with a bounded private expression-fixture write preventing loop-invariant elimination. Native V8 heap sampling used a 1024-byte interval and included objects collected by major/minor GC. Source maps associated the old allocation sites with gain/envelope/audibility helpers. Four fresh processes covered homogeneous and mixed-first feedback; estimated cumulative sampled allocation churn, including fixture/inspector noise, was:

| Scan fixture | Before, decimal MB | After, decimal MB |
| --- | ---: | ---: |
| Held | 409.865 | 0.000 |
| Edited held | 460.605 | 0.001 |
| Moving SR control | 462.563 | 461.126 |
| Half held / half moving | 461.782 | 409.771 |
| Edited hold after mixed feedback | 460.488 | 0.000 |

- Cached rows had no sampled Synth-module allocations, including after moving branches became hot. Zero samples are not a universal zero-allocation guarantee; these are cumulative statistical allocation estimates, not retained/peak heap, public-admission allocation totals, overall render throughput, GC pauses or device latency. Moving-path allocation remains and no general speedup is claimed.
- Uninstrumented Node dev/dist proof matched frozen originals across 9900 main cases plus 432 bit-distinct normal/edited near-tie boundaries. The main matrix hashed 25903440 PCM bytes, numeric/logical state, pooled slots, callbacks and diagnostics; callable names were excluded. All qualities/algorithms/nine waveforms, representative rates, 2/4-voice boundaries and 32-voice subsets passed 26100 ranking assertions, 29700 validation checks and 450 refusals. Near-tie coverage included 144 valid edited caches and just-edit/re-edit invalidation, preserving both victim choices. Source/dist PCM and state hashes matched.
- Actual Chrome156 public Workers retained all 6048096 complete encoded bytes across 24 quality/algorithm scenarios and chunk sizes 127/509, with 3240 processed events and zero errors. Every byte matched an actual frozen runtime, and persisted BEFORE hashes/diagnostics matched. Real user activation was used without relaxing autoplay. Native high-quality Worklet events proved zero-release, victim stealing and incoming onset shared a dispatch frame; the quieter held voice survived, a lower-priority onset was refused, and terminal diagnostics were idle/error-free with one expected rejection. Admission ACKs were not treated as execution ACKs; all resources/server closed.
- Added an all-quality consumer regression for unrendered ranking, immediate zero-release before another render, later ADSR lowering and fresh expression with held gains. Build, 24 targeted priority/polyphony/v8 tests, all 492 behavioral tests and strict/public/DOM-free checks passed. Scoped supported-input A/C review found no blocker; private gain/validity corruption remains unsupported. No physical-device, listening, realtime-capacity or release approval is implied.

- Installed-package/security gates passed: zero runtime dependencies/dynamic code, package render/WAV smoke, asset CLI and public/DOM-free contracts. README/security evidence and generated documentation are synchronized.

### Expressive MIDI expression quantization

- The CC7×CC11 product search now stops when its error is at most half an integer product unit, rather than requiring exact floating-point zero. Every candidate product is an integer; no later candidate can improve that bound, and descending CC7 order with strict improvement preserves the existing higher-volume tie preference. Own-data/finite validation remains first. No cache, allocation, API, voice-format, serialization or budget change was added.
- Actual Node26.7 public exports counted native `Math.round` invocations with a temporary wrapper, subtracting unchanged note/tempo and control-tick rounding. These are deterministic search-work counts, not instrumented timing or overall throughput claims. Compiled and minified modules independently reported:

| Input | Search iterations before | Search iterations after |
| --- | ---: | ---: |
| Complete corpus, both SMF formats | 16958976 | 12968836 |
| Expression 0.5 | 127 | 2 |
| Half a product quantum | 127 | 1 |
| Immediately above that half quantum | 127 | 127 |
| Expression 0.317, nearest integer unavailable | 127 | 127 |
| Expression 0 or 1, each | 1 | 1 |

- The corpus covers 70393 distinct doubles: every CC7/CC11 pair with both normalized-product constructions, all integer and half-unit targets with adjacent IEEE doubles, and 4096 seeded inputs. An independent sorted lattice of all 4647 representable products verified nearest-error and higher-CC7 ties. Both formats and source/dist matched all 276 persisted BEFORE files, totaling 279552 complete bytes per implementation; invalid-expression rejections stayed intact.
- Native Chrome156, without the rounding wrapper or relaxed permissions/CSP, matched every original file byte across the same corpus. Actual file→score→DSP rendering produced finite, nonzero 9280-frame stereo audio with zero errors and identical complete PCM to Node BEFORE. Browser page errors were empty and browser/server resources were closed. The browser helper could not create a page target; the existing Playwright native-Chrome runner completed the actual module checks instead. This is not physical-MIDI, listening, realtime-capacity or general speedup evidence.
- Added a consumer regression for adjacent half-quantum values, exact upper/lower-product ties, and unavailable nearest products. Build, 27 targeted MIDI tests, all 493 behavioral tests and strict/public/DOM-free checks passed. Scoped read-only A/C review found no blocker; it did not run gates or approve a release. Public API/README contracts are unchanged; the MIDI guide and generated documentation retain the explicit quantization policy.
- Installed-package/security gates passed: zero runtime dependencies/dynamic code, package render/WAV smoke, asset CLI and public/DOM-free contracts.

### Canonical sustain reuse in pooled admissions

- `Synth.noteOn` reuses a slot's existing canonical sustain dB/gain only when its previous immutable patch identity matches and the operator's existing live-ADSR edit flag is clear. Dirty flags are checked before admission resets them; patch changes, fresh raw normalization and edited operators recompute the original arithmetic. Per-note envelope timelines, velocity, key/rate scaling, release, controls and oscillator initialization remain fresh. No fields, cache containers, allocation, retention, API or voice-format changes were added.
- Actual public-admission probes covered 96 cases across all qualities, zero/below-floor/nonunity/unity sustain, cold/warmed/retired/panic/edited slots and patch/fresh/raw identity boundaries. A temporary native `Math.log10` wrapper observed these call counts for four nonzero sustain inputs; this is work evidence, not instrumented timing:

| Admission state | Calls before | Calls after |
| --- | ---: | ---: |
| Same pristine patch: warmed / retired / panic-recycled | 4 | 0 |
| Live-ADSR-edited slot | 4 | 4 |
| Different / fresh / raw patch identity | 4 | 4 |
| All sustain inputs zero | 0 | 0 |

- Production counts matched the isolated prototype and every complete PCM hash matched BEFORE. The guarded canonical gain exponentiation is skipped with the same block; no general throughput, heap, GC or device-latency claim follows from these counters. Exploratory timing controls were not treated as universal speedup evidence.
- Uninstrumented Node26.7 AFTER exactly matched both an actual frozen original and persisted BEFORE: 739 cases, 705814 frames, 5646512 PCM bytes and 4642 complete numeric/typed snapshots including pooled slots, with 1425605 assertions. All qualities/eight algorithms/nine waveforms/three rates, dirty recycling, retirement/panic/steals/fade overflow, identity boundaries, controls/retuning, quietest/policy/refusal, callbacks/reentry and sequence capacity/chunk parity were covered. PCM/state/callback hashes matched; finite sound and terminal release checks passed. Error retirement was not induced through unsupported private corruption.
- Actual Chrome156 public Workers passed 24 representative scenarios and 120 renders across qualities/algorithms/nine waveforms, 8/22.05/48 kHz and PCM16/24/float32 with deterministic TPDF. All 96 literal complete-WAV comparisons matched frozen runtime, saved BEFORE, fresh AFTER and chunk sizes 127/509; each pass contained 6844000 bytes. All 72 complete callback/capacity comparisons matched at equal partitions, excluding nondeterministic elapsed timing. Each render processed 111 events with zero errors and completed diagnostics; page errors were empty and browser/server resources closed. No live Worklet, physical-device, MIDI or listening claim is implied.
- Added an all-quality consumer regression comparing recycled audio with a cold Synth after pristine reuse, live ADSR edits and patch switches. Build, 17 targeted v8/priority tests, all 494 behavioral tests and strict/public/DOM-free checks passed. Scoped read-only A/C review found no supported-input blocker; it did not execute gates or approve a release. Direct mutation of internal slot arrays/flags remains unsupported.
- Installed-package/security gates passed: zero runtime dependencies/dynamic code, package render/WAV smoke, asset CLI and public/DOM-free contracts. README/security evidence and generated documentation are synchronized.

### Key-scaling-free pooled envelope coefficients

- Pristine timing and geometric-step coefficients now reuse existing pooled storage only for the same immutable patch with omitted/exactly-zero rate key scaling. Live ADSR edits, new/raw patch identities and every nonzero scale (including `Number.MIN_VALUE`, even at repeated pitches) retain the original full setup. Attack/decay/release/SR arithmetic and caps are unchanged. Sample rate/oversampling remain constructor invariants; per-note timelines, gains, release steps, phase and histories reset normally. No fields, cache container, allocation, retention, API or format changes were added.
- Native Inspector precise coverage, enabled before module compilation under Node26.7 `--jitless`, passed 168 actual public-admission cases across qualities, omitted/zero/negative-zero/mixed/nonzero/tiny-positive scaling, SR, pitch changes, cold/warmed/retired/panic/edited slots and identity boundaries. Complete PCM hashes matched BEFORE and the prototype. These are JavaScript helper-entry counts, not optimized native exponent counts or timing; normal V8 already shares the A/D/R scaling factor:

| Four-operator admission | Duration helper before | Duration helper after | SR setup helper before | SR setup helper after |
| --- | ---: | ---: | ---: | ---: |
| Pristine zero/omitted scale, no SR | 12 | 0 | 4 | 0 |
| Pristine zero scale, with SR | 16 | 0 | 4 | 0 |
| Two zero / two nonzero scales, with SR | 16 | 8 | 4 | 2 |
| All nonzero/tiny-positive scales, no SR | 12 | 12 | 4 | 4 |
| Live-edited slot, with SR | 16 | 16 | 4 | 4 |
| Cold / new / raw identity, no SR | 12 | 12 | 4 | 4 |

- Actual uninstrumented Node BEFORE/AFTER records matched recursively: 849 cases, 17967 complete pooled snapshots, 2818077 frames, 3864 callbacks, 51 refusals and three callback reentries, including signed-zero/extreme timing and sequence capacity/chunk parity. Scalar `Object.is` checks and literal typed-buffer comparisons found no differing path. The canonical Float64/raw-typed aggregate matched BEFORE/AFTER/fresh frozen replay (`fd4ece93dae2bedb80153aa05cd725acdf965e7572cded559a906058010e42b2`). The raw Node-V8 diagnostic aggregate differed by seven encoded bytes despite equivalent records; V8 container serialization was not treated as canonical or re-pinned. A fresh frozen replay reproduced the original aggregate. Extreme fixtures observed no containment errors, not a guarantee that all internal coefficients are finite.
- Native Chrome156 ran 36 scenarios on two actual surfaces across BEFORE, fresh frozen replay and AFTER: 216 public Workers as serialization/identity-miss controls and 216 browser-core renders sharing exact prepared identities as the reuse path. All 50943576 complete WAV bytes matched saved/frozen/current output and chunk sizes 127/509, with full normalized progress/phase/capacity/diagnostics equality at matching partitions; only host elapsed timing was excluded. Qualities, eight algorithms, nine waveforms, 8–96 kHz, PCM16/24/float32 and TPDF were covered. All renders completed with 66 processed events and zero errors; page errors were empty and resources closed. This does not claim live Worklet, physical output, listening or performance acceptance.
- Added an all-quality consumer regression comparing held/SR/release PCM against a cold Synth after crossing MIDI 48.25→72.25 with omitted/zero/positive scaling. Build, 18 targeted v8/priority tests, all 495 behavioral tests and strict/public/DOM-free contracts passed. Scoped read-only A/C review found no supported-input blocker and did not execute gates or approve a release. Exploratory timing controls were not generalized into throughput, heap, GC or device-latency guarantees.
- Installed-package/security gates passed: zero runtime dependencies/dynamic code, installed render/WAV and asset CLI smoke, public types and Node DOM-free core types. README/security evidence and generated documentation are synchronized.

### Worker-local cloned patch reuse

- Native structured clone preserved shared patch references but removed private prepared membership, so Worker preflight previously normalized the same patch for every note. The Worker now uses an internal owned-clone entry to the existing validator/render plan: first encounter fully normalizes, deeply freezes and privately brands a new copy; subsequent references reuse it through one invocation-local WeakMap. The table is bounded by distinct note voices and does not escape into rendering. No structural/serialized trust, content deduplication, global cache, wire/option/version change or duplicate validator was introduced.
- Public preparation/render factories keep their original uncached raw path. Host raw inputs still detach per occurrence before posting; different identities remain different, and cache state never crosses jobs. The internal entry is not re-exported by the public core facade/package subpaths. Per-note DSP/live controls, budgets, validation order and backpressure/termination remain unchanged.
- Actual native Chrome156 Worker precise coverage began before imports using Debugger/Profiler autoattach, then collected at the first real sink-write gate before acknowledgement. Node's real worker-scope adapter and direct cloned factory independently confirmed the same identity-sensitive reduction; main Node used `--jitless`, workers explicit `execArgv:[]`. These are JavaScript normalization entries, not native exponent or latency measurements:

| Twelve-note job | Normalizations before | Normalizations after |
| --- | ---: | ---: |
| One shared identity | 12 | 1 |
| Two distinct identities / named aliases | 12 | 2 |
| Three interleaved identities (Chrome) | 12 | 3 |
| Twelve distinct same-content prepared identities | 12 | 12 |
| Raw host path, detached per occurrence | 12 | 12 |

- Node fresh AFTER and frozen replay each matched all 77 saved BEFORE records (36544937 canonical bytes): full PCM/WAV, pooled numeric state, callbacks, capacity, diagnostics and errors. Scalar Float64 encoding preserved signed zero/Infinity and typed buffers compared literally; intended private reference sharing was excluded. Coverage included qualities/algorithms/waves/rates, legacy 1–8, scaling/SR/live ADSR, fades/steals/panic, all WAV formats/dither, clone isolation/fresh jobs and eleven malformed/budget Worker rejections before chunks. The adapter imported the real Worker module with native parentPort cloning/acks; it was not a browser host or echo mock.
- Native Chrome156 completed 90 public Worker renders: 15 cases × chunks127/509 × BEFORE/AFTER/frozen replay. Entire WAV output matched saved/frozen/current and across chunks; matching-partition callback/capacity/diagnostic records passed recursive `Object.is` and Float64-byte equality. Nine sample rates in 8–96 kHz, three qualities, eight algorithms, nine waveforms, formats/dither, identity/raw/alias/legacy/refusal cases and live ADSR/key scaling/SR were represented. Four public preflight failures and five direct Worker protocol/input probes were unchanged. Page/CDP errors were empty; browser/server resources closed. Bounded representative coverage, not exhaustive or physical/listening acceptance.
- Uninstrumented Node26.7/V814.6 controls used 32 fresh interleaved processes, four per implementation/case. Each process warmed 32 real 4096-note prepare/cancel jobs and took seven three-job samples, then rendered every complete stereo sample outside timing; all PCM, capacity and terminal diagnostics matched the frozen implementation. Corrected `standard`-quality preparation medians/ranges in ms/job:

| Host-cloned input | Frozen median | Worker-local median | Frozen process-median range | Worker-local process-median range |
| --- | ---: | ---: | --- | --- |
| One shared prepared identity | 34.300 | 6.180 | 32.190–38.201 | 5.509–6.732 |
| Four interleaved prepared identities | 33.123 | 6.018 | 28.332–37.332 | 5.185–6.303 |
| 4096 distinct prepared identities | 26.009 | 35.012 | 23.148–42.416 | 25.460–43.135 |
| Raw input detached into 4096 identities | 34.010 | 41.322 | 31.776–46.046 | 29.927–42.752 |

- Identity-miss controls retain full normalization and pay local table/lookup overhead; their process ranges overlapped and their medians were not better. These preparation/cancel measurements include engine/queue allocation and GC, not Worker startup, hot DSP throughput or device latency. No universal speedup is claimed.
- Added a consumer regression proving that later event-descriptor mutation of a reused raw source cannot retroactively change an earlier snapshot or be hidden by clone-only caching. Build, 28 targeted sequence/Worker tests, all 496 behavioral tests and strict/public/DOM-free contracts passed. Applied-source read-only A/C review found no supported-input blocker, without executing gates or approving a release. Public APIs, voice v8 and Worker protocol1 remain unchanged.
- Installed-package/security gates passed: zero runtime dependencies/dynamic code, installed render/WAV, asset CLI, public contracts and Node DOM-free core types. README/host/security documentation and generated HTML/declaration catalog are synchronized.

### Immutable score-array preflight reuse

- Re-preparing an exact immutable output event array from the same library instance can now reuse its frozen score/validation metadata. A private WeakMap records only successfully validated, newly frozen **output** arrays, never incoming raw arrays. Options/native Map branding run before lookup; cached event/horizon/short note/slot bounds must fit or the original validator runs unchanged. Raw/frozen-lookalike/Proxy/cloned/foreign arrays retain normal validation. No serialized marker, content trust, signature, format, protocol or option was added.
- Render plans, engine/tuning/frame/chunk/signal checks, mutable queues and DSP state remain fresh. The weak value contains only immutable snapshot data. Holding its output array may intentionally retain the metadata wrapper; otherwise-unheld root/array selfcycles are collectible. No PCM, signal or callback is retained through the metadata entry.
- Inspector precise coverage began before imports. Node and native PAGE probes distinguished three-event private preparation from actual public Worker host preflight; native WORKER coverage used its own pre-import target and first real sink gate. Runtime source ranges disambiguated minified helper-name collisions. These are JavaScript helper entries, not native instruction or timing estimates:

| Three-event scenario | Own-data helper before | Own-data helper after | Control validation before | Control validation after |
| --- | ---: | ---: | ---: | ---: |
| Own long/short preparation (Node/PAGE) | 4 | 1 | 1 | 0 |
| Capacity estimate (Node) | 5 | 2 | 1 | 0 |
| Full render including dispatch (Node) | 6 | 3 | 2 | 1 |
| Public Worker host preflight (PAGE) | 26 | 20 | 2 | 0 |
| Actual cloned Worker preflight | 7 | 7 | 1 | 1 |
| Raw/lookalike/Proxy/clone/foreign preparation | 4 | 4 | 1 | 1 |

- Node compared 96 canonical records /1122149 bytes across fresh AFTER, frozen replay and saved frozen-original results, including all 86 pre-cutover persisted records plus boundary supplements. Full PCM/chunks/WAV, callback/numeric state, capacities, diagnostics and rejection data matched (`f0412d7b19507074b5425d577c0f6def5c98e66fece71b970b5dc99dad296993`). Qualities/algorithms/waves/rates, repeated renders/settings/tuning, raw mutation/deep ownership, options and note/slot/event/time/frame/PCM boundaries were covered. Scalar encoding preserves signed zero/Infinity; typed bytes compare literally, not V8 container layouts.
- Native Chrome156 matched BEFORE/fresh AFTER/frozen replay across 148 records /1327701 canonical bytes (`6abd500846a8922dd8e144f3a38cf163cc73f99d8b6b0888b487b8d3d8b7bdf3`), including 24 complete public Worker WAVs and corresponding chunk127/509/full-PCM cases per pass, scalar/error cases and trust boundaries. Foreign outer arrays can remain accepted through normal validation; they do not inherit membership. Invalid preflight requests wrote no bytes. Page/protocol errors were empty and all resources closed. Intended snapshot identity reuse, held-key metadata lifetime, helper names/source offsets and host elapsed times were excluded.
- Explicit Node GC and native CDP GC observed unheld root/array cycles collected while active or terminal renderers remained held. Active prepared voices remained until cancellation. A deliberately held array retained its metadata root only AFTER, and releasing that key enabled collection; externally held data retained its own lifetime. These are observed forced-GC controls, not immediate-collection guarantees or a static review claim.
- Normal-JIT controls used 32 fresh interleaved Node26.7/V814.6 processes, four per implementation/case. Each warmed 32 capacity estimates on 1024 events (512 notes plus nested operator controls), measured seven three-call samples and rendered all complete stereo PCM outside timing. Every 33984-byte PCM hash, capacity and diagnostic matched (`9f4a6ba672f2dd52e52392ac9ffdba1df9c994acc4279eb84979875a214f9c1d`). Capacity-preflight medians/ranges, ms/call:

| Input array | Frozen median | Reuse median | Frozen process-median range | Reuse process-median range |
| --- | ---: | ---: | --- | --- |
| Own immutable output | 2.569 | 0.144 | 2.212–2.924 | 0.139–0.165 |
| Raw input | 2.685 | 2.753 | 2.588–2.798 | 2.655–2.927 |
| Frozen lookalike | 2.729 | 2.757 | 2.649–2.845 | 2.652–2.797 |
| Structured clone | 5.666 | 5.796 | 5.568–5.691 | 5.612–5.932 |

- Only the own-output case showed separated process ranges. Miss controls kept full validation with fixed weak lookup/registration overhead; no universal throughput, Worker-startup, hot-DSP, GC or device-latency improvement is claimed.
- Added consumer regressions for frozen raw containers with changing note/voice/control children, private long-to-short bounds, fresh PCM limits and invalid/accessor options. Build, 30 targeted sequence/Worker tests, all 498 behavioral tests and strict/public/DOM-free contracts passed. Scoped applied-source A/C review found no supported-input blocker, without running gates or verifying GC timing or approving a release.
- Installed-package/security gates passed: zero runtime dependencies/dynamic code, installed render/WAV, asset CLI, public declarations and Node DOM-free core contracts. README/streaming/host/security evidence and generated HTML/declaration catalog are synchronized.

### Immutable control snapshot dispatch

- `validateNoteControls` now reuses only its own successfully validated, deeply frozen output identities through a private WeakSet. Raw inputs, frozen lookalikes, Proxies, clones and independent-module outputs still take the original full validator; empty/glide/ramp dependencies and context-specific MIDI restrictions remain intact. No public signature, serialized marker, protocol or format changed.
- Worklet message clones still validate at receipt; immediate/queued local Synth dispatch can avoid copying the same immutable controls again. Per-note clocks, ramp reanchoring, retuning, envelope coefficients and all mutable DSP application remain fresh. The WeakSet contains no strong payload values.
- Pre-import Inspector precise coverage mapped actual field/tuple/ADSR descriptor-loop ranges, not just function entries. Function entries stayed unchanged. Node executed the production processor with structural Worklet globals across all qualities; these are JavaScript loop iterations, not native instructions or measured heap allocations:

| Scenario | Fields before | Fields after | Tuple elements before | Tuple elements after | ADSR fields before | ADSR fields after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Own snapshot, 11 validations | 165 | 0 | 176 | 0 | 198 | 0 |
| Raw/lookalike/Proxy/clone/foreign, 11 validations each | 165 | 165 | 176 | 176 | 198 | 198 |
| Immediate processor receive + dispatch | 30 | 15 | 32 | 16 | 36 | 18 |
| Queued processor receive | 16 | 16 | 16 | 16 | 18 | 18 |
| Queued processor dispatch | 16 | 0 | 16 | 0 | 18 | 0 |

- Node AFTER/saved actual BEFORE/frozen replay matched all 1467 records /10951369 canonical bytes (`d5cda9bda40617d9f6c33237c27e4d8e236fa2eadb757d4bc2dd5d30dcec83e4`): full PCM, numeric state, callbacks, return values and 300 exact rejection errors. Coverage included 90 Synth cases, all qualities/algorithms, nine waveforms, three rates, full/chunk sequences, ownership boundaries and repeated controls after intervening targets/time. Numeric encoding preserves signed zero/nonfinite values; typed bytes compare literally. Intended own-output identity reuse is recorded separately.
- Native Chrome156 BEFORE/AFTER/both frozen replays matched 38438733 canonical bytes (`9706616abd82879e2d22425767b567376b1023d642cba1a8c2aaffa1df93453d`). Each pass included 144 deterministic native OfflineAudioContext/AudioWorklet cases with 589824 PCM samples plus a separate 144-case page-core supplement. The fixture subclasses the captured unmodified processor, supplies structured-cloned constructor data to its real receiver and runs its superclass queue/process/Synth; it does not claim deterministic offline port delivery. Separate trusted-click original-processor postMessage probes exercised immediate/queued controls, rejection ordering, lifecycle, finite/nonzero captured PCM and drained queues. Live timing/PCM were not byte-equated. Page coverage/GC are not Worklet measurements; page errors were empty and resources closed.
- Node forced-GC controls kept Synth/child tuples alive while unheld control roots collected. Real pending queue roots stayed alive, then collected after dispatch/cancellation. Native page CDP GC collected 64/64 roots with children and an active note held. These are observed forced-GC outcomes, not immediate-collection guarantees or static-review claims.
- Separate normal-JIT controls used 48 fresh interleaved Node26.7/V814.6 processes, four per implementation/case. Each warmed 32 batches of 256 real updates, then measured seven four-batch samples; rendering/PCM hashing stayed outside timing. Every process applied 15360 updates, rendered 3840 stereo frames and matched saved BEFORE PCM/state/diagnostics. Small controls contain expression/ramp; rich controls contain all 15 fields, four operator tuples and ADSR with/without sustain rate. Two-stage timing models raw validation followed by actual Synth dispatch, not native Worklet wall time. Process-median microseconds per update chain:

| Controls / path | Frozen median | Reuse median | Frozen process-median range | Reuse process-median range |
| --- | ---: | ---: | --- | --- |
| Small / owned snapshot | 0.374 | 0.063 | 0.339–0.531 | 0.060–0.071 |
| Small / raw Synth update | 0.364 | 0.449 | 0.348–0.388 | 0.431–0.495 |
| Small / two-stage receive + dispatch | 0.597 | 0.463 | 0.587–0.709 | 0.459–0.474 |
| Rich / owned snapshot | 4.632 | 0.631 | 4.499–4.964 | 0.621–0.647 |
| Rich / raw Synth update | 4.846 | 4.904 | 4.669–5.058 | 4.728–5.209 |
| Rich / two-stage receive + dispatch | 9.554 | 4.926 | 9.008–13.123 | 4.635–5.327 |

- The small single-raw case measurably regressed from weak lookup/registration overhead; rich raw ranges overlapped. Own-snapshot and two-stage cases had separated process ranges. This trades a first-validation cost for avoiding repeated immutable copies; no universal raw-input, hot-render, GC-jitter, browser/device-latency or physical-listening improvement is claimed.
- Added a consumer regression that reapplies one immutable expression/pitch/operator-ADSR snapshot after intervening ramps across notes, rates and all qualities, comparing complete audio against fresh raw controls and checking an audible reanchored fade. Build, 33 targeted engine/control tests, all 499 behavioral tests and strict/public/DOM-free contracts passed. Applied-source scoped A/C review found no supported-input blocker; it ran no runtime gates and is not release approval.
- Installed-package/security gates passed: zero runtime dependencies/dynamic code, installed 1440-frame render/5804-byte WAV, asset CLI, public declarations and Node DOM-free core types. Generated README/control contract and changelog surfaces passed actual Chrome156 rendering with no body overflow or page errors; the control row was checked visually. Documentation HTML and declaration catalog are synchronized.

### Scalar ADSR control bounds

- Replace the per-field ADSR min/max array/destructuring expression with two scalar bounds. Inclusive a/d/r 0–10, s 0–1 and optional sr 0.01–100, signed zero/subnormal handling, descriptor order, finite checks and rejection messages are unchanged. No cache, interface, voice/protocol format or DSP arithmetic changed.
- Independent one-change allocation probes used 16 fresh processes each. The whitelist-predicate rewrite showed overlapping validator ranges and was not promoted. Only scalar ADSR bounds survived the allocation/consumer controls.
- Actual compiled AFTER versus the SHA-verified frozen original used another 16 fresh interleaved Node26.7/V814.6 processes, four per implementation/payload. Native heap sampling began after 10000 warmups and explicit GC, then observed 50000 raw validations/checksum25000 at interval2048, including objects collected by major/minor GC. CPU profiling was not sampled; Debugger enabled only afterward for source attribution. A separate unforced JIT trace observed the original validator reach Maglev and TurboFan. Ranges are estimated cumulative allocation churn, decimal MB:

| Payload / allocation subtree | Before minimum | Before maximum | After minimum | After maximum |
| --- | ---: | ---: | ---: | ---: |
| Small / validator | 56.027 | 56.893 | 56.373 | 56.983 |
| Rich / validator | 703.286 | 706.741 | 553.048 | 554.304 |
| Rich / native-next descendant | 74.853 | 75.627 | 0.000 | 0.000 |

- Rich allocation ranges separated by about 21%; the unchanged small cold-branch control overlapped. Zero sampled native-next bytes is not a zero-allocation guarantee: JIT inlining/frame redistribution and function-start attribution cannot assign every saved byte to an individual literal. No exact object/byte census, retained-heap, GC-cost, throughput or browser/device-latency improvement is claimed.
- Applied-source consumer replay matched the frozen original across 457 boundary/error cases, five Proxy-order scenarios, zero accessor invocations, immutable/raw/clone/foreign ownership and existing/inactive notes. All qualities, three rates and three notes matched 891 full PCM blocks /304944 bytes /76236 `Object.is` checks (`2e4ca01122c472b569f6038f68588b6303fb77040dbc5a19440ed6f90a13c533`), including repeated controls, interrupted ramps and sr endpoints. IEEE754 encoding retained signed zero and nonfinite distinctions.
- Actual Chrome156 original AudioWorklet/SDK runs before and after at 48 kHz covered all qualities with a trusted gesture and strict self-origin CSP. Exact-min sr reached silent output, exact-max sr restored real signal, 18 invalid boundary packets rejected before inactive lookup, and six valid endpoint packets reached that inactive branch. PCM stayed finite/in headroom, only intentional receiver errors accumulated, panic drained voices/queues, and page errors were empty. Real audio-block observations drove synchronization; live RMS/timing were not byte-equated. All browser/server/context/port resources closed; physical/listening acceptance remains unverified.
- Build, 43 targeted controls/envelope/v8 tests, all 499 behavioral tests and strict/public/DOM-free contracts passed. Existing permanent behavior tests remain unchanged; no private/allocation-counter test was added. Scoped applied-source A/C review found no supported-input blocker and ran no runtime gates. README/API/voice contracts intentionally stay unchanged; this is internal validation allocation work, not a release approval.
- Installed-package/security gates passed: zero runtime dependencies/dynamic code, installed 1440-frame render/5804-byte WAV, asset CLI, public declarations and Node DOM-free core types. Generated documentation and declaration catalog are synchronized.

### Final Performance control composition

- Performance admission and mono-legato retargeting now assemble the complete control payload before validating it, rather than validating an intermediate snapshot that is immediately extended and validated again. The module-level private values builder adds no per-Performance closure. Pitch arithmetic, expression/glide precedence, original-gate baseline resets and named-bank replacement behavior stay unchanged.
- Public inputs still validate before entering owned part/key state. `updateKey`/`updatePartNotes` retain their complete preflight and rollback; retarget validation still precedes gate mutation, and admission validation still precedes dispatch within the existing cleanup boundary. The baseline builder was already raw and remains unchanged. No cache, exported signature, message/voice format or DSP arithmetic changed.
- Pre-import Node Inspector Debugger breakpoints counted exact executed validator statements, separating the host from synchronous production-processor receive. These are JavaScript visits, not instruction/allocation/timing measurements:

| Host path / metric | Before | After |
| --- | ---: | ---: |
| Rich admission / validator entries | 2 | 2 |
| Rich retarget / validator entries | 3 | 2 |
| Rich admission / owned-output hits | 0 | 1 |
| Rich retarget / owned-output hits | 1 | 1 |
| Rich admission or retarget, each / root descriptors | 30 | 15 |
| Rich admission or retarget, each / tuple descriptors | 32 | 16 |
| Rich admission or retarget, each / ADSR descriptors | 36 | 18 |
| Minimal admission or retarget, each / root descriptors | 3 | 2 |

- Isolated `updateKey`, `updatePartNotes`, `getPartControls` and processor attribution stayed unchanged. Actual compiled AFTER, saved actual BEFORE and frozen replay matched all 140 records /5822078 canonical bytes /351104 stereo frames (`4755616d06bd0c5ca87c875fc6d040cbfe9528064ce4bb073582bf405eed1452`), including complete PCM, numeric state, public snapshots, exact errors, ownership, rollback, anchored pitch/reset boundaries, original-bank defaults and reentrant cleanup; accessor invocations stayed zero. Scalar encoding preserves signed zero/nonfinite distinctions, and typed bytes compare literally.
- Actual production `dist` Chrome156 original SDK/Worklet BEFORE, AFTER and frozen-dist replay matched 14 canonical snapshots, 25 sender updates and six rejection cases. All 12 native audio/state checkpoints passed sound, mute, retarget/reset, ±48/restart49, sustain/selection and terminal silence, with settled queues/errors zero and final voices zero. Supplemental PAGE normalization entries changed 97→85, owned hits 20→25, bodies 77→60 and descriptor iterations 435→395; this is not Worklet coverage. Native PCM/frame timing were not byte-equated. A private fixture missing-source-map double-response error was corrected separately; it was not an SDK failure. All browser/server/context/port resources closed; physical/listening acceptance remains unverified.
- Separate normal-JIT controls used 32 fresh interleaved Node26.7/V814.6 processes, four per implementation/case, 32 warm batches of 256 calls and seven four-batch timed samples. Timing encloses real `Performance.noteOn`, facade cloning and synchronous production-processor receipt, not audio rendering, prior-key release or panic. Each process applied 15360 onsets/retargets and rendered 983040 admission or 983104 retarget stereo frames outside timing; full PCM hashes, public state and diagnostics matched for every implementation/process. Small controls contain expression/ramp; rich controls contain all 15 fields and four operator tuples with/without sustain rate. Process-median microseconds per chain:

| Controls / path | Frozen median | Composed median | Frozen process-median range | Composed process-median range |
| --- | ---: | ---: | --- | --- |
| Small / admission | 15.264 | 14.458 | 15.064–15.487 | 14.082–15.152 |
| Small / retarget | 8.398 | 8.997 | 8.233–11.158 | 7.569–10.593 |
| Rich / admission | 35.124 | 31.981 | 33.507–36.389 | 29.396–47.105 |
| Rich / retarget | 32.960 | 25.255 | 29.823–36.202 | 25.103–26.768 |

- Only rich retarget had separated process ranges. Other ranges overlapped, including the higher small-retarget median; no universal throughput, native-port/device latency, physical allocation or GC improvement is claimed.
- Build, 33 targeted Performance/control tests, all 499 behavioral tests and strict/public/DOM-free contracts passed. Existing permanent behavior tests and README/API/voice contracts intentionally remain unchanged; no private-counter test was added. Scoped applied-source A/C review found no supported-input blocker, performed no runtime checks and is not release approval.
- Installed-package/security gates passed: zero runtime dependencies/dynamic code, installed 1440-frame render/5804-byte WAV, asset CLI, public declarations and Node DOM-free core types.

### Fixed-shape Performance temporaries

- Mono retargeting now adds glide to its fresh owned values object instead of spread-copying that temporary again. Final validation still precedes gate mutation. Baseline ratios, fixed-frequency/null values and ADSR references now use fixed four-element literals instead of three `map` callbacks; roots/tuples remain fresh and ADSR children remain immutable. No shared tuple, cache, export, format, protocol or DSP arithmetic changed.
- Preserve the original first patch dereference (`feedback`) before aliasing operators. Static review caught that an earlier alias otherwise changed engine-generated TypeError wording after removing a configured named voice. Separate authentic frozen-original/final probes in Node and Chrome confirmed exact error kind/message preservation; no permanent wording test or special-case fallback was added.
- Independent one-change AST/load-hook prototypes each used 16 fresh processes, then actual final compiled source versus the frozen original used 32 fresh interleaved Node26.7/V814.6 processes, four per implementation/case. Each warmed 10000 calls, forced GC outside sampling and sampled 50000 calls at interval2048, including objects collected by major/minor GC. Profiler metadata enabled before imports; CPU profiling was not sampled and JIT was not disabled or forced.
- Actual `OPM`/Performance/production-processor execution used structural Worklet globals and native structured-clone ports. Retarget processes rendered 3840128 full stereo frames; baseline getter processes kept a sounding voice and compared 128 frames before/after the getter workload. All complete PCM hashes, Float64-encoded public snapshots and diagnostics matched across implementations/processes. Small/rich retarget controls contain expression/ramp versus all 15 fields with four operator tuples; baseline cases separately use integer versus fractional patch ratios, fixed Hz/null, optional sr and signed-zero defaults.
- Final all-profile cumulative sampled churn ranges, decimal MB:

| Workload | Before minimum | Before maximum | After minimum | After maximum |
| --- | ---: | ---: | ---: | ---: |
| Retarget / small controls | 854.511 | 858.685 | 849.314 | 851.639 |
| Retarget / rich controls | 2257.336 | 2259.453 | 2240.985 | 2244.692 |
| Baseline getter / integer ratios | 615.981 | 618.854 | 607.051 | 609.020 |
| Baseline getter / fractional ratios | 620.289 | 621.972 | 605.960 | 607.443 |

- All four ranges separated. These are weighted whole-probe allocation-churn estimates, not retained heap or exact physical object/byte counts. Observed optimized profiles omitted getter caller frames: named API/helper stack-subtree sums were partial, so conclusions use independent whole-profile totals and do not assign every saved byte to a literal. A first frozen run's hook target used `/tmp` rather than Node's canonical `/private/tmp`; its valid total/PCM were retained with manifest hash/runtime-URL provenance, and later inputs were canonicalized. No throughput, GC-cost, browser/device-latency or physical-listening improvement is claimed.
- Actual BEFORE/frozen replay/final AFTER matched 28 scenarios /187 records /7826726 canonical bytes /473600 stereo frames (`89f03a926a908a429bcc428e730393115f7176e8252eb2e9f758173b8ee4a69a`). Full PCM, numeric state, exact errors, direct/named tuple defaults, reset/retrigger/anchored-pitch/capacity rollback, snapshot ownership and reentrant cleanup stayed identical; accessor calls stayed zero. Every validator statement counter, including host/processor attribution, stayed unchanged: no validation was removed.
- Actual production-dist Chrome156 original SDK/Worklet BEFORE/final AFTER/frozen replay matched 16 snapshots, 29 sender updates, six rejection cases and all 15 native audio/state checkpoints. Tuple defaults/original-gate resets, sound/mute/pitch/retarget/restart/sustain/selection and terminal silence passed; output stayed finite/bounded, settled queues/errors and final voices were zero. PAGE coverage remained 98 validator entries /69 bodies /478 descriptor visits, not Worklet/allocation/timing coverage. Native PCM/frame timing were not byte-equated; page/server exceptions were empty and all resources closed.
- Final build, 33 targeted Performance/control tests, all 499 behavioral tests and strict/public/DOM-free contracts passed. Scoped final-source A/C review found no supported-input blocker and ran no runtime checks; arbitrary built-in corruption is excluded and this is not release approval. Existing permanent tests and README/API/voice contracts intentionally remain unchanged.
- Installed-package/security gates passed: zero runtime dependencies/dynamic code, installed 1440-frame render/5804-byte WAV, asset CLI, public declarations and Node DOM-free core types.

### Worker-owned cloned control reuse

- Worker score preparation now lazily keeps an invocation-local identity table for successfully validated controls, alongside the existing cloned-patch table. Only original Worker-owned native clones take this path. Immutable detached outputs are reused as data; raw clone roots receive no global/private brand, equal-valued distinct objects are not deduplicated, and neither table escapes preparation. Note/stop-only jobs allocate no controls table.
- Public raw/frozen-lookalike/foreign controls still validate and detach per occurrence. Reuse this library instance's `validateNoteControls` output to preserve aliases through host preflight and native clone. Event descriptors, IDs/times, note existence, budgets, frames/settings/capacity/signals and every effective current-clock DSP/ramp/ADSR application retain their original checks/order. No export, dependency, protocol, API signature or voice-format change was added.
- Actual isolated Node Worker inspection started before SDK imports and separated pre-ACK preparation from rendering. Twelve-control cases produced these exact statement counts; loop visits are execution counters, not allocation estimates:

| Phase / metric | Before | After |
| --- | ---: | ---: |
| Shared owned clone: validator entries | 12 | 1 |
| Shared owned clone: root-field visits | 180 | 15 |
| Shared owned clone: tuple visits | 192 | 16 |
| Shared owned clone: ADSR-loop visits | 240 | 20 |
| Three interleaved roots: validator entries | 12 | 3 |
| Distinct / public raw / foreign roots: validator entries | 12 | 12 |
| Distinct / public raw / foreign roots: root-field visits | 180 | 180 |
| Public own-validated shared root: validator entries | 12 | 1 |
| Direct-protocol frozen-lookalike shared clone: validator entries | 12 | 1 |
| Note-only preparation: control validator entries | 0 | 0 |
| Normal cases: effective Synth control applications | 12 | 12 |
| Held/release context case: effective applications | 5 | 5 |
| Stolen-voice context case: effective applications | 3 | 3 |

- Direct-protocol lookalike reuse means first validating owned cloned data, not trusting a public frozen object. Public-host frozen lookalikes remained twelve distinct receiver roots. DSP dispatch normalization bodies remained zero through the existing output-only identity gate; no DSP application was cached.
- Local Node26.7 / V8 14.6 / Apple M5 normal-JIT measurements used 1024 controls (or none), one note, standard quality, 8 kHz, one voice and 64-frame chunks. An isolated one-change prototype used 56 fresh processes; final applied source versus SHA-frozen original used another 56, interleaving four processes per case/implementation. Each process ran 16 warmups and five samples of four preparations. Native clone, rendering, cancellation, forced GC and inspection were outside timing. These measure actual owned-clone renderer preparation, including context/capacity/settings/Synth setup, not Worker startup, encoding, whole-job latency or audio DSP:

| Controls / cloned roots | Before median ms | After median ms | Before process-median range | After process-median range |
| --- | ---: | ---: | --- | --- |
| Small / shared one | 1.0745 | 0.6474 | 0.9769–1.2725 | 0.5738–0.8739 |
| Small / interleaved three | 1.1121 | 0.6680 | 0.9362–1.3269 | 0.5691–0.7782 |
| Small / distinct | 1.1748 | 1.2071 | 1.0112–1.3817 | 0.9796–1.3889 |
| Rich / shared one | 5.3323 | 0.7696 | 4.6855–6.2481 | 0.6746–0.8428 |
| Rich / interleaved three | 5.3821 | 0.7444 | 4.6685–6.1895 | 0.6104–0.8449 |
| Rich / distinct | 5.4994 | 5.6825 | 4.6792–6.1084 | 4.9516–6.5383 |
| No controls | 0.0525 | 0.0503 | 0.0447–0.0575 | 0.0430–0.0554 |

- Shared/interleaved ranges separated; distinct-input and no-control ranges overlapped, with slightly higher distinct-input medians. No miss-path, universal, device-latency or listening improvement is claimed. Separate forced-GC observations retained the live renderer before draining; decimal MB below are JS-heap deltas, excluding the preexisting input graph and external ArrayBuffer backing stores, not Worker RSS, allocation churn or GC cost:

| Controls / cloned roots | Before retained JS MB range | After retained JS MB range |
| --- | --- | --- |
| Small / shared one | 0.375648 | 0.285624 |
| Small / interleaved three | 0.375392–0.375648 | 0.285544–0.285800 |
| Small / distinct | 0.375648–0.375952 | 0.375648–0.375696 |
| Rich / shared one | 1.907448–1.931872 | 0.228312–0.262720 |
| Rich / interleaved three | 1.907416–1.931872 | 0.234792–0.235352 |
| Rich / distinct | 1.931872 | 1.872880–1.931872 |
| No controls | 0.152224–0.152464 | 0.152224–0.152464 |

- Every timed process separately completed and compared all 640 stereo frames, capacity and diagnostics outside timing. Actual Node original Worker BEFORE/frozen replay/final AFTER matched 38 full-data files, including 312878 WAV bytes; successful encoded outputs also matched direct production encoding. All three qualities, 8/44.1 kHz, dithered PCM24/float32, shared/interleaved/distinct/raw/foreign inputs, held/released/stolen contexts, exact rejection ordering, accessor exclusion, buffer transfer, cancellation and wrong-ACK handling passed.
- Actual production-dist Chrome156 original-entrypoint BEFORE/frozen replay/final AFTER matched 105 complete WAV cases /945714 bytes per graph, plus Float64-canonical controls and deterministic progress/diagnostics/lifecycle. All qualities and valid PCM16/PCM24/float32 dither combinations passed. Separate non-mutating bootstrap Workers observed public receiver root counts of 1/3/12/12/12/12 for shared/interleaved/distinct/raw/foreign/frozen-lookalike cases; this was actual dedicated-Worker inspection, not PAGE coverage. Eight cancellation/error cases stayed unchanged and all 115 allocated Workers per graph closed. No browser throughput or forced-GC clone-lifetime claim is made.
- A permanent consumer-visible regression covers per-occurrence raw scalar/nested detachment when a later event descriptor changes controls, then checks complete stereo output and the intended audible-level transition across all qualities. Public raw BEFORE/AFTER PCM hashes matched. Nine additional populated-cache malformed-root cases kept exact original errors. Final build, 42 targeted tests, all 500 behavioral tests, strict/public/DOM-free contracts and installed-package/security gates passed (1440 frames /5804 WAV bytes). Scoped final-source A/C review found no blocker, ran no runtime gates and is not release approval. README, host integration and generated distribution/docs are synchronized.

### Static sequence-event schema lists

- Replaced six per-event field-list expressions with four module-private readonly lists. Allowed/required strings, order and both conditional selections are unchanged; only identical stop/control lists share references. `sequenceOwnData` still performs the full ordered descriptor/required-field scan for every raw event. No input/result cache, trust marker, exported contract, protocol, dependency or DSP change was added. Lists initialize once per module; startup cost was not measured.
- An AST-isolated one-change prototype and the final applied source each used 40 fresh allocation-sampling processes on Node26.7 / V8 14.6 / Apple M5: four interleaved processes per implementation/workload, 1024 warm preparations, then 2048 preparations of 256 raw events. Own prepared voice/control inputs were established outside sampling; input graphs were not recreated in the loop. The own-score metadata-hit control instead ran 100000 preparations without entering event validation. Sampling interval was 2048 bytes with both minor/major-collected samples retained; forced GC preceded sampling.
- Actual final-source versus SHA-frozen original whole-profile tree `selfSize` totals, decimal MB:

| Workload | Before allocation-churn MB range | After allocation-churn MB range |
| --- | --- | --- |
| 256 notes | 1487.544–1490.066 | 1450.907–1454.658 |
| One note +255 controls | 904.600–907.276 | 872.699–875.830 |
| One note +255 stops | 716.281–720.829 | 685.086–686.631 |
| 64 notes +128 controls +64 stops | 1001.774–1004.234 | 968.563–970.737 |
| Own immutable score metadata hit | 37.520–38.224 | 37.644–38.223 |

- All four raw-event ranges separated; the metadata-hit control overlapped. These are weighted whole-probe allocation estimates, not retained heap, exact physical object counts, individual literal sizes or GC cost. Both recorded profiler representations showed the same separation. An initial throwaway assertion incorrectly required tree totals to equal the sum of individual sample sizes. Actual versioned [V8 scaling](https://raw.githubusercontent.com/nodejs/node/v26.7.0/deps/v8/src/profiler/sampling-heap-profiler.cc) rounds size-bucket counts and individual samples separately; the [Inspector adapter](https://raw.githubusercontent.com/nodejs/node/v26.7.0/deps/v8/src/inspector/v8-heap-profiler-agent-impl.cc) serializes those distinct estimates. The collector now saves raw profiles before analysis and reports both without imposing that false invariant. No SDK failure was involved.
- Separate prototype/final timing stages each used 40 fresh processes without Inspector, 1024 warmups and seven samples of 32 preparations (8192 for metadata hits). Actual final-source measurements were:

| Workload | Before median µs | After median µs | Before process-median range µs | After process-median range µs |
| --- | ---: | ---: | --- | --- |
| Notes | 158.1159 | 152.7871 | 152.0065–170.3867 | 151.1836–155.8203 |
| Controls | 87.1966 | 87.0313 | 86.0938–90.1979 | 85.8021–89.0729 |
| Stops | 70.8750 | 69.4811 | 68.4323–77.5000 | 67.8021–71.2383 |
| Mixed | 102.6947 | 103.2546 | 102.1771–103.2097 | 101.5573–103.7513 |
| Own score metadata hit | 0.0702 | 0.0712 | 0.0670–0.0740 | 0.0680–0.0754 |

- Every timing range overlapped; mixed/cached medians were slightly higher. No throughput, browser-memory, Worker-startup, audio-DSP or device-latency improvement is claimed. Full canonical snapshot hashes stayed identical in every measured process. Separate original/prototype/applied smoke runs compared complete stereo output and diagnostics across all qualities.
- Actual Node live BEFORE/frozen replay/final AFTER matched 249 canonical cases, 33 full/chunked stereo PCM pairs /8400 frames per run and complete dithered PCM16/PCM24/float32 WAV bytes (`7d0675b3bdd8f91297c64f03296e7ebff3a33f09f8da1a14ceee924dfff32282`). Coverage includes all required/optional/unknown/non-data fields, root/array/tuple boundaries, native Map behavior, budgets/horizons/IDs, exact errors and full Proxy trap order, reentry, raw mutation/freshness and ownership. Later-changing type descriptors still follow initial type selection, and explicit undefined priority still rejects: observed behavior was preserved, not silently corrected. Getter calls stayed zero; only `core/sequence.js` changed among the twelve frozen graph modules.
- Actual production-dist Chrome156 original static Worker BEFORE/frozen replay/final AFTER matched all 24 render combinations, complete WAV/canonical data, 51 pre-allocation rejection cases, Proxy order, mutation/reentry, cancellation and sink/header/close failures. No bootstrap or security bypass was used. All 33 allocated Workers per run terminated, no sinks remained outstanding, and browser/server resources closed. Two BEFORE fixture-label/bounds errors were corrected before successful Node capture; native capture also corrected a nondeterministic Date label. No AFTER fixture correction was needed.
- Final build, 42 targeted tests, all 500 behavioral tests, strict/public/DOM-free type contracts and installed-package/security gates passed (1440 frames /5804 WAV bytes). Final-source scoped A/C review found no blocker: `as const` is compile-time only, but no supported mutation/reference-escape path exposes the private schema lists. The review ran no runtime gates, excludes arbitrary built-in corruption and is not release approval. Existing permanent tests, README, host integration and API/voice contracts intentionally remain unchanged; no incidental wiring/allocation-count test was added.

### Private preparation defaults and option schemas

- Preparation option field names now use private readonly lists. `prepareSequence` and `prepareLongSequence` reuse a private frozen complete default, following the existing Synth note-options convention. Only that exact unexported identity skips its own redundant option normalization; its own `voices: undefined` keeps inherited registries out. All caller objects, including empty/frozen/lookalike/cloned/foreign/Proxy options, retain full schema/descriptor/native-Map inspection before score metadata reuse. Context/frame/resource/DSP checks remain fresh.
- No caller input/result/registry cache, structural trust, exported API signature, protocol, dependency or voice-format change was added. Existing renderer/arrangement/host callers intentionally remain unchanged. Shared defaults contain no caller payload, and their fixed module initialization cost was not measured.
- An AST-isolated 80-process experiment independently selected original/list-only/default-only/combined implementations, interleaving four processes per workload/implementation. List-only reduced explicit-caller allocation; default-only retained overlapping explicit-caller ranges while removing redundant omitted-default work. The combination preserved both effects. All complete canonical snapshots and separate stereo/diagnostic smoke outputs matched.
- Final applied source versus SHA-frozen original used another 40 fresh Node26.7 / V8 14.6 / Apple M5 processes. Each warmed 1024 preparations, forced GC before sampling, then ran 100000 preparations (2048 for the 256-event mixed raw score). Prepared score/control/voice inputs and explicit option objects/Map were established outside sampling. Both minor/major-collected samples were retained at a 2048-byte interval. Whole-profile tree `selfSize` estimates, decimal MB:

| Workload | Before allocation-churn MB range | After allocation-churn MB range |
| --- | --- | --- |
| Own score metadata hit, omitted options | 37.758120–37.936504 | 0.096240–0.133080 |
| Own score metadata hit, explicit empty options | 32.281448–32.522488 | 25.960392–26.430616 |
| Own score metadata hit, explicit registry | 77.333672–77.770712 | 70.818808–71.453384 |
| Empty raw score, omitted options | 116.382448–118.140152 | 81.059016–81.463968 |
| 64 notes +128 controls +64 stops, raw | 968.203304–972.100720 | 968.246424–970.286952 |

- The first four ranges separated in both recorded profiler representations; the mixed raw-score ranges overlapped and its final median was slightly higher. These are weighted whole-probe churn estimates, not retained heap, exact physical object/byte counts, GC cost or a zero-allocation claim. The corrected bucket-versus-individual-sample scaling caveat from the preceding section still applies.
- Separate prototype/final timing stages each used 40 fresh processes without Inspector, 1024 warmups and seven samples of 8192 preparations (32 for the mixed score). Actual final-source observations:

| Workload | Before median µs | After median µs | Before process-median range µs | After process-median range µs |
| --- | ---: | ---: | --- | --- |
| Own score, omitted options | 0.0856 | 0.0181 | 0.0793–0.1135 | 0.0161–0.0225 |
| Own score, explicit empty options | 0.0880 | 0.0771 | 0.0812–0.1042 | 0.0717–0.1007 |
| Own score, explicit registry | 0.1343 | 0.1275 | 0.1219–0.1749 | 0.1187–0.2459 |
| Empty raw score | 0.4286 | 0.3902 | 0.3871–0.5040 | 0.3527–0.5827 |
| Mixed raw score | 128.4831 | 130.0221 | 120.5677–180.9193 | 120.8841–242.0039 |

- Only the own-score omitted-options timing ranges separated. All other timing ranges overlapped; no general preparation, Worker startup, browser-memory, audio-DSP, device-latency or listening improvement is claimed. Complete canonical snapshot hashes matched every measured process, and actual original/final stereo smoke matched across all qualities.
- Actual Node live BEFORE/frozen replay/final AFTER matched 432 complete canonical cases, 30 full/chunked stereo PCM pairs and 150 complete WAV comparisons per graph across all qualities/formats/dither settings. Omitted/undefined/explicit/frozen/cloned/null-prototype/foreign options, raw/owned/foreign score arrays, exact errors/precedence and Proxy traces, malformed/proxied Maps, poisoned instance methods, mutation/reentry, detachment and short/long/frame/settings bounds remained identical. Inherited registry getters/values selected the exact original brass patch and complete nonzero sound; unexpected getter calls stayed zero.
- Actual production-dist Chrome156 direct preparation exports and original static Worker BEFORE/frozen replay/final AFTER matched 64 preparations, 76 exact rejections, 32 freshness/trap/inheritance cases, 180 complete PCM/WAV renders and ten cancellation/sink-failure contracts. All 189 allocated Workers per graph terminated, active Workers/pending sinks were zero, and browser/server closed. Worker entrypoint bytes stayed unchanged. Unsupported control/quality names in initial native fixtures were corrected before successful capture; no AFTER fixture correction was needed.
- A permanent consumer-visible regression temporarily installs an inherited registry getter, restores its descriptor in `finally` before rendering/assertions, and checks selected snapshot plus complete nonzero stereo equality. It passed on actual original code before promotion and again afterward. Final build, 43 targeted tests, all 501 behavioral tests, strict/public/DOM-free contracts and installed-package/security gates passed (1440 frames /5804 WAV bytes). Scoped final-source A/C review found no blocker, ran no runtime gates and is not release approval. README/host/API/voice contracts intentionally remain unchanged.

### Owned absent-registry options and renderer schemas

- Render planning, beat-event preparation and the Worker host now select the existing private complete preparation default only when their already-inspected registry value is strictly `undefined`. Nonundefined registries retain fresh option inspection and native Map validation. No caller options, raw data or contextual results gain trust.
- Full/chunked render option field names are private readonly module constants; required-field lists reuse the existing empty constant. Exact contents/order and both full-render caller scans remain unchanged, including changing Proxy descriptors and rejection precedence. No public signature, voice format, protocol, DSP operation or dependency changed.
- Local Node26.7.0/V814.6 on Apple M5 used separate fresh-process original/list-only/default-only/combined prototypes, then actual frozen-original/final code. Each stage had 72 prototype or 36 actual allocation processes and the same separate uninstrumented timing process counts: six workloads, three repetitions per implementation. Allocation used 1024 warmups (256 for full rendering), explicit GC before sampling, 2048-byte intervals and both collected-object flags. Per-process workloads were 100,000 capacity/empty-beat calls, 1024 mixed-beat calls or 256 full renders. Whole-profile tree weights below are normalized estimates, not exact allocation counts, retained heap or RSS; independently rounded sample-array estimates agreed on separated/overlapping ranges.

| Actual workload | Before weighted JS bytes/call range | After weighted JS bytes/call range |
| --- | ---: | ---: |
| Empty-score capacity, absent registry | 3425.54–3431.09 | 2660.95–2667.14 |
| Own three-event score capacity, absent registry | 4377.50–4378.69 | 3591.74–3617.06 |
| Own score capacity, explicit registry | 4469.07–4480.13 | 4408.55–4428.39 |
| Empty beat preparation | 1863.23–1879.84 | 1572.11–1578.64 |
| Raw 24-event beat preparation | 125716.62–126638.30 | 126033.82–126942.25 |
| Complete three-event stereo rendering | 276278.91–283645.06 | 277343.81–278726.81 |

- Only the first four allocation ranges separated. Independent prototypes isolated absent-registry normalization from field-list savings; default-only explicit-registry allocation and list-only beat allocation remained overlapping negative controls. Mixed beat and complete-render totals overlapped. Raw profiles were saved before analysis; tree/sample representations are not assumed equal.
- Normal-JIT timing had no Inspector/forced GC and ran after native/other probes closed. Seven samples per process used 4096 capacity/empty-beat calls or 16 mixed-beat/full-render calls after the same warmup.

| Actual workload | Before median µs | After median µs | Before process-median range µs | After process-median range µs |
| --- | ---: | ---: | --- | --- |
| Empty-score capacity, absent registry | 0.8359 | 0.7608 | 0.8180–0.8880 | 0.7572–0.7676 |
| Own score capacity, absent registry | 0.7452 | 0.6605 | 0.7375–0.7536 | 0.6586–0.6738 |
| Own score capacity, explicit registry | 0.7810 | 0.7841 | 0.7803–0.7971 | 0.7812–0.8041 |
| Empty beat preparation | 0.5078 | 0.4686 | 0.4779–0.5237 | 0.4329–0.4723 |
| Raw 24-event beat preparation | 36.0313 | 39.1172 | 35.8541–38.7656 | 36.1744–39.2031 |
| Complete stereo rendering | 134.7396 | 134.4036 | 133.1432–136.7318 | 134.3464–142.9089 |

- Absent-registry capacity and empty-beat timing ranges separated; the remaining ranges overlapped, including a higher mixed-beat median. These are local synchronous API observations, not Worker latency, browser heap, audio-DSP throughput, GC cost, device or listening improvements.
- Actual Node live BEFORE/frozen replay/final AFTER matched 247 complete canonical cases (3,653,729 bytes): musical tempo compilation, score/arrangement roundtrips, full/chunk PCM and WAV, all qualities/formats/dither, explicit/invalid/foreign/poisoned Maps, raw/owned/frozen/foreign scores, exact errors/precedence, changing double-scan descriptors, reentry, mutation/detachment, settings/budgets/signals and inherited registry behavior. Getters/open renderers stayed zero. Existing polluted-prototype Synth assignment rejection was preserved; prototypes were restored synchronously before subsequent audio.
- Actual production-dist Chrome156 live BEFORE/frozen replay/final AFTER matched 859,312 canonical bytes, including all three qualities and five valid format/dither combinations of complete full/chunk PCM and original static Worker WAV, 36 error/acceptance records, Proxy/registry/settings/inheritance/reentry and transfer/abort/sink lifecycle scenarios. Getters/page errors stayed zero; every browser/page/Worker/CDP/socket/server closed. Original Worker entrypoint bytes stayed unchanged.
- Separate AST-range-identified precise coverage started before SDK import and reset after preparing one own immutable score. Each interval covered one whole successful real Worker export on PAGE main, including ready/chunk/done response validation; these are helper entries, not preflight-only, Worker-thread or allocation counts:

| Registry supplied to real export | Before PAGE helper entries | After PAGE helper entries |
| --- | ---: | ---: |
| Absent | 10 | 8 |
| Native Map | 10 | 9 |

- Final build, 76 targeted musical/sequence/Worker/expression tests, all 501 behavioral tests, strict source/development/public/DOM-free contracts and installed-package/security gates passed (1440 frames /5804 WAV bytes). Final-source scoped A/B/C review reported no findings, ran no runtime gates and is not release approval. Existing consumer regressions cover the unchanged boundaries; no new implementation/copy-count test was added. README, host guidance and API/voice contracts intentionally remain unchanged.

### Beat-event schemas and rejected Worker-host prototypes

- Beat preparation now shares five private readonly allowed/required field-name lists rather than creating them per event. Initial-versus-later type descriptors, invalid-type empty allowlist, required-field order, own-data inspection, numeric/context/registry checks and detached frozen outputs remain unchanged.
- Worker-host response-schema reuse was evaluated and then rejected: final whole-export allocation comparisons did not establish a reliable reduction. Its runtime changes were removed, restoring the original per-message schema literals, type/state checks, progress bounds, native byte accounting, ACK/backpressure and sink cleanup. The only retained host edit corrects its import documentation to promise no Worker creation, not zero allocation.
- The progress-field iteration-list hypothesis was rejected: its separate native prototype did not establish an independent allocation improvement. Worker entry/ACK handling, separate live Transport/swing parsers, caller options, public signatures, voice format, DSP and dependencies intentionally remain unchanged.
- Node prototypes used guarded AST replacement of only the seven original beat schema literals, preserving every branch and callback. Five nonempty preparation/compilation allocation ranges separated; the empty-input negative control overlapped. Full canonical snapshots and actual beat-derived stereo smoke matched across all qualities. Timing was measured separately without Inspector/forced GC; no general speedup is inferred from lower allocation.
- Native prototypes separately evaluated original, response-schemas-only, progress-only and combined hosts in 24 fresh Chrome156 processes. Those initial ordered batches overlapped concurrent Node sampling and had incomplete/overlapping named-stack attribution; they are not isolated causal or timing evidence. A separate 16-process frozen-original/schema-only confirmation alternated chunk sizes and rotated implementation order with all other probes closed. High-chunk whole-page tree and host-stack ranges separated in that prototype confirmation, but subsequent actual-candidate comparisons did not confirm the aggregate improvement. Default-chunk ranges overlapped. Every run consumed and checked four complete real Worker WAVs after one warmup, and all variants preserved full canonical outputs.

- Actual Node26.7/V814.6 original/final allocation confirmation used 36 fresh processes (six workloads × two implementations × three repetitions), 1024 warmups, explicit GC before sampling, 2048-byte intervals and both collected-object flags. Nonempty workloads ran 2048 calls/process; empty preparation ran 100,000. Whole-profile tree weights below are normalized churn estimates, not exact object/byte counts, retained heap or RSS. Independent sample-array weights agreed on separated/overlapping ranges; raw profiles were saved before reduction without assuming tree/sample equality.

| Actual musical workload | Before weighted JS bytes/call range | After weighted JS bytes/call range |
| --- | ---: | ---: |
| 64 notes | 432603.13–433448.52 | 427752.29–428203.02 |
| One note and 64 controls | 342770.95–344148.88 | 338299.16–339349.43 |
| 64 note/stop pairs | 643637.61–645187.75 | 635135.78–637107.47 |
| 64 note/control/stop triples | 970951.49–972783.06 | 959380.74–961666.79 |
| Empty preparation | 1564.78–1580.06 | 1571.54–1579.25 |
| Public tempo compilation of the mixed score | 1022633.86–1025252.55 | 1012072.26–1012670.69 |

- Five nonempty actual allocation ranges separated; empty preparation overlapped. A separate 36-process balanced normal-JIT comparison ran after all allocation/native probes closed, without Inspector or forced GC: seven samples of 16 nonempty calls or 4096 empty calls after the same warmup.

| Actual musical workload | Before median µs | After median µs | Before process-median range µs | After process-median range µs |
| --- | ---: | ---: | --- | --- |
| 64 notes | 134.7318 | 132.4766 | 125.1381–138.2422 | 118.0521–145.9141 |
| One note and 64 controls | 85.3933 | 83.4766 | 74.2239–90.9609 | 74.3021–93.0443 |
| 64 note/stop pairs | 199.8906 | 203.0286 | 192.8464–205.3828 | 183.8151–210.7578 |
| Mixed triples | 290.4974 | 299.6719 | 265.2526–311.5469 | 265.9063–308.6381 |
| Empty preparation | 0.5001 | 0.5094 | 0.4933–0.5410 | 0.4572–0.5474 |
| Public tempo compilation | 314.7578 | 307.2526 | 310.7994–343.1536 | 285.2057–338.9636 |

- All actual timing ranges overlapped, including higher stop/mixed/empty medians. Prototype timing separation did not establish a final speedup. No general compilation, Worker startup, audio-DSP, GC-cost, device-latency or listening improvement is claimed.
- Actual Node live BEFORE/frozen replay/final AFTER matched 393 complete canonical cases (5,751,920 bytes), including 211 direct and 100 nested error details, descriptor-change matrices across the intentionally different core/Transport/swing parsers, exact trap/precedence traces, registry poisoning, mutation/reentry/detachment, cancellation and complete 65,536-event output. Nine successful musical compositions covered beat/score/arrangement paths and every quality with full/chunk stereo equality and complete mono/stereo WAV across formats/dither. Getters/open renderers stayed zero and processes exited.
- Actual production-dist Chrome156 live BEFORE/frozen replay/candidate AFTER matched 858,640 canonical bytes: 19 successful full PCM/chunk/WAV records, 25 boundary records, 18 explicitly labeled genuine-Worker PAGE message mutations and four lifecycle scenarios. Mutation diagnostics alter received messages before SDK listeners; they are not claims that original production Workers emitted malformed packets. Normal success uses the unchanged original static Worker. Getters/page errors stayed zero; browser/pages/Workers/CDP/server/sockets closed.

- The rejected actual host candidate received two isolated balanced comparisons against fresh frozen-original controls: 16 Chrome processes with four sampled successful jobs each, followed by one prelimited 16-process comparison with sixteen jobs each. Both used four repetitions/implementation/chunk size, one warmup, 512-byte sampling and both collected-object flags. The larger batch tested sampling power, not a new fixture or retry-until-pass; no further adjustment followed. Whole-PAGE tree estimates include WAV consumption/canonical return construction:

| Sampled jobs/process; chunkFrames | Original host weighted bytes range | Rejected actual candidate weighted bytes range |
| --- | ---: | ---: |
| 4; 1 | 3136052–3188316 | 3056564–3203436 |
| 4; 4096 | 718156–766296 | 714776–743552 |
| 16; 1 | 12494048–12604696 | 12354924–12602120 |
| 16; 4096 | 2874084–2931892 | 2887276–2917160 |

- Whole-PAGE tree, independently rounded sample-array and partial host-subtree ranges overlapped in both actual comparisons. Direct host-frame weights separated only for small chunks, but optimized frames can be omitted/re-attributed; this is not total-allocation proof. The schema candidate was removed rather than claiming a whole-export improvement. Every sampled job checked complete WAV/canonical equality; page errors were zero, raw profiles preceded reduction and all resources closed. No Worker-heap, exact-allocation, RSS, startup or speed claim is made.
- After restoring the original host runtime, the final beat-only distribution was independently exercised again using the unchanged canonical suite under a new artifact label. It matched the same 858,640 historical live/frozen bytes and complete PCM/WAV/errors/traces/lifecycle. Host JavaScript bytes matched the original host exactly; the static Worker remained unchanged. Earlier candidate/prototype/negative evidence was retained separately, not overwritten or rebaselined.

- Final conservative build, 76 targeted musical/sequence/Worker/expression tests, all 501 behavioral tests, strict source/development/public/DOM-free contracts and installed-package/security gates passed (1440 frames /5804 WAV bytes). Final-source scoped A/B/C recheck found no blocker and supersedes the experimental host disposition; it ran no runtime gates and is not release approval. Existing consumer regressions cover the preserved behavior; no copy-count/source-text/implementation test was added. README/host/API/voice contracts intentionally remain unchanged apart from the corrected compiler-generated import documentation.

### Owned default tempo construction

- `normalizeTempoMap()` now constructs its omitted single-point map directly after the same unconditional BPM type/range validation. The point contains only fixed beat zero and that validated BPM, so creating an intermediate point and inspecting/copying it again is unnecessary.
- Every omitted call still returns a fresh deeply frozen array and point, with identical own `beat`/`bpm` fields and absent optional `curve`/`endBpm`. No shared default, global cache, new identity gate or single-point offset registration was introduced. Provided maps retain the original full validation/private multi-point metadata path; invalid BPM still rejects before a metadata hit.
- Tempo-query arithmetic, summation order, error precedence, caller options, time signatures, public signatures, voice format, protocols and DSP remain unchanged. Default musical/MIDI compilation uses the same existing helper; there is no separate parser or fallback.

- Local Node26.7/V814.6 on Apple M5 used guarded load-time prototypes and then actual frozen-original/final modules. Each allocation stage had 48 balanced fresh processes: eight workloads × two implementations × three repetitions, 1024 warmups, 100,000 calls/process, explicit GC before sampling, 2048-byte intervals and both collected-object flags. Raw profiles preceded reduction; whole-profile tree weights below are normalized churn estimates, not exact byte/object counts, retained heap or RSS. Independently rounded sample-array weights agreed on separated/overlapping ranges.

| Actual workload | Before weighted JS bytes/call range | After weighted JS bytes/call range |
| --- | ---: | ---: |
| Omitted map, default BPM | 1334.26–1347.59 | 122.92–127.82 |
| Omitted map, BPM137.5 | 1337.98–1345.96 | 122.80–124.05 |
| `beatsToSeconds(17.25)` without map | 1360.51–1370.18 | 171.06–174.48 |
| `secondsToBeats(8.625)` without map | 1347.34–1359.60 | 164.35–166.04 |
| Empty musical compilation, default map | 3737.51–3751.65 | 2581.46–2593.65 |
| Supplied raw single-point map | 2056.29–2084.04 | 2069.98–2081.98 |
| Supplied normalized single-point map | 2069.55–2077.88 | 2062.58–2085.70 |
| Supplied private normalized multi-point map | 22.34–22.88 | 17.53–22.52 |

- All five omitted-map allocation ranges separated; all three provided-map controls overlapped. Fresh outputs still allocate. Separate uninstrumented normal-JIT stages used the same 48-process balanced design after all other probes closed, seven samples of 8192 calls after 1024 warmups, without Inspector or forced GC:

| Actual workload | Before median µs | After median µs | Before process-median range µs | After process-median range µs |
| --- | ---: | ---: | --- | --- |
| Omitted map, default BPM | 0.3520 | 0.0650 | 0.3368–0.3549 | 0.0646–0.0739 |
| Omitted map, BPM137.5 | 0.3575 | 0.0712 | 0.3539–0.3837 | 0.0668–0.1124 |
| Default-map beat conversion | 0.3840 | 0.0986 | 0.3793–0.4338 | 0.0924–0.1611 |
| Default-map seconds conversion | 0.4649 | 0.1221 | 0.4043–0.5199 | 0.1164–0.1452 |
| Empty musical compilation | 1.3451 | 1.0177 | 1.2254–1.3475 | 0.9612–1.2437 |
| Supplied raw single-point map | 0.5812 | 0.5932 | 0.5506–0.6040 | 0.5421–0.5956 |
| Supplied normalized single-point map | 0.5878 | 0.5910 | 0.5432–0.6524 | 0.5241–0.6125 |
| Supplied private normalized multi-point map | 0.0287 | 0.0402 | 0.0283–0.0318 | 0.0273–0.0563 |

- Only the first four actual timing ranges separated. Empty compilation and all supplied-map timings overlapped, with higher supplied-map medians. A tiny prototype-only raw-map timing separation did not reproduce in actual code. No general musical compilation, browser/Worker startup, audio-DSP, GC-cost, device or listening improvement is claimed.
- Complete canonical results matched every measured process; prototype/actual stereo smoke exercised real default-tempo compilation in all qualities. Independent Node live BEFORE/frozen replay/final AFTER matched 1,934 main cases (4,273,542 bytes) plus 295 supplemental boundaries (102,610 bytes), complete Float64/typed bytes, descriptors/freshness/deep freeze, provided/raw/owned/foreign/Proxy maps, exact errors/traces/mutation/reentry, project/arrangement/MIDI/reimports, 12 full/chunk PCM comparisons and 60 WAV comparisons. Processes ended with no active resources.
- Native production-dist Chrome156 live BEFORE/frozen replay/final AFTER matched 3,665,229 canonical bytes across 105 tempo/music/quality/format/dither combinations, complete PCM/chunk/WAV/MIDI/project output and boundary/lifecycle/backpressure/ownership cases. Omitted normalization read no inherited fields; legacy raw-query inherited `curve`/`endBpm` getter traces and values were separately preserved rather than “fixed.” Unexpected getters/page errors were zero; original Worker bytes stayed unchanged, browsers/servers/Workers/MessageChannel ports closed and sockets were zero. Existing MIDI BPM1 three-byte overflow and linear-map export rejections remained intact.

- Final build, 136 targeted Transport/MIDI/musical/sequence/Worker/expression tests, all 501 behavioral tests, strict source/development/public/DOM-free contracts and installed-package/security gates passed (1440 frames /5804 WAV bytes). Final-source scoped A/C review reported no findings, ran no runtime gates and is not release approval. Existing consumer regressions cover preserved boundaries; no new identity/copy-count/default implementation test was added. README/API/voice contracts intentionally remain unchanged.

### Owned default meter construction

- The existing private-complete-default convention now covers fixed 4/4 meter values. The module-only frozen default never escapes. Omitted normalization still returns a fresh frozen two-own-field object; omitted bar/beat conversions use the fixed values internally without manufacturing an unused meter snapshot. Every provided signature, including previous normalized outputs, frozen lookalikes, proxies and foreign outputs, retains full validation/copying. Arithmetic, bounds, error precedence, output ownership, arity and declarations remain unchanged. No cache, caller-output brand, shared returned object, API/voice/protocol or dependency change was introduced.
- Node26.7/V814.6 profiling compared original, normalizer-only, queries-only and combined AST prototypes against a frozen 14-module graph: 96 fresh-process allocation runs, 96 separate timing runs and 32 full/chunk PCM smokes. Actual compiled BEFORE/AFTER then used 48 allocation runs, 48 separate timing runs and 16 smokes, balanced/rotated across eight workloads and three repetitions. Inputs/setup were outside measurement; allocation used 1024 warmups, GC before sampling, 100,000 calls, interval 2048 and both collected-object flags. Raw profiles were saved before reduction. Whole-tree weighted JavaScript allocation is primary; independently summed sample arrays corroborated the clear default-path reductions, not an assumed equality of the two rounded representations. These are not exact object counts, retained heap/RSS, startup or GC-cost measurements.

| Actual workload | BEFORE weighted JS B/call range | AFTER weighted JS B/call range |
| --- | ---: | ---: |
| Omitted meter normalization | 956.43–960.85 | 40.58–41.32 |
| Default beat-to-bar conversion | 1004.78–1014.35 | 57.23–57.91 |
| Default bar-to-beat conversion | 1816.49–1821.34 | 903.18–917.75 |
| Provided raw 4/4 normalization | 917.77–921.92 | 915.98–925.72 |
| Provided frozen 4/4 normalization | 913.82–923.99 | 914.23–919.14 |
| Provided normalized 4/4 beat query | 974.37–976.48 | 964.70–972.64 |
| Provided normalized 4/4 bar query | 1775.30–1788.48 | 1771.43–1778.23 |
| Empty score-project parsing | 6595.09–6604.78 | 5708.47–5748.27 |

- Individual prototypes separated the two causes: normalizer-only removed redundant inspection while retaining a temporary meter copy in queries; query selection removed that unused copy too. The combined implementation retains both. Provided inputs gained no validation/copy shortcut. Their small beat-query sampling separation is reported rather than treated as evidence that checks/copies disappeared; other provided allocation ranges overlapped.
- Timing ran only after independent Node/browser/Worker proof processes closed, without an inspector or GC calls: seven blocks of 8192 calls per fresh process after warmup. Values are median of three process medians with their range in microseconds; prototype and actual campaigns are not merged.

| Actual workload | BEFORE µs median [range] | AFTER µs median [range] |
| --- | ---: | ---: |
| Omitted meter normalization | 0.2710 [0.2654, 0.2970] | 0.0461 [0.0449, 0.0462] |
| Default beat-to-bar conversion | 0.3310 [0.3060, 0.3613] | 0.0563 [0.0544, 0.0715] |
| Default bar-to-beat conversion | 0.5292 [0.5160, 0.5925] | 0.2504 [0.2464, 0.3200] |
| Provided raw 4/4 normalization | 0.2667 [0.2650, 0.3346] | 0.2705 [0.2641, 0.3066] |
| Provided frozen 4/4 normalization | 0.2673 [0.2666, 0.3451] | 0.2699 [0.2698, 0.3112] |
| Provided normalized 4/4 beat query | 0.3416 [0.3096, 0.3490] | 0.3184 [0.3076, 0.3477] |
| Provided normalized 4/4 bar query | 0.5781 [0.5119, 0.7731] | 0.5813 [0.5491, 0.5835] |
| Empty score-project parsing | 6.4269 [6.3161, 6.7095] | 6.0228 [5.9325, 6.1563] |

- Default helper and empty-project timing ranges separated; all provided-input ranges overlapped, with higher raw/frozen normalizer and bar-query medians. Ordinary Transport/Arrangement snapshots pass a provided normalized signature and are not presumed faster. No general project/MIDI/browser/Worker/DSP, device or listening improvement is claimed.
- Independent Node actual live BEFORE/frozen replay/actual AFTER matched all 517 canonical records and 4,156,825 complete bytes: exhaustive supported meters, Float64/signed-zero/numeric boundaries, exact errors/precedence, hostile own-data/Proxy traces, fresh frozen outputs, input mutation/reentry, projects/definitions/MIDI and complete PCM/full-vs-chunk/WAV across actual qualities/formats/dither. Stopped Transport/Arrangement snapshots used an explicitly subscription-only adapter, not fabricated audio hardware. All resource records were empty.
- Independent Chrome156 production-dist BEFORE/frozen/AFTER matched 3,205,256 complete canonical bytes: 1203 helper cases, three successful project/arrangement roundtrips, nine full/chunk PCM comparisons, 45 genuine Worker WAV comparisons and three failure/cancel boundaries. Unexpected getters/page errors were zero. All 48 original module Workers and 765 MessageChannels closed, browser/server closed and sockets were zero; Worker bytes stayed unchanged. An initial composition fixture omitted its named-voice registry; it was corrected using existing conventions before valid baseline capture, not misreported as an arrangement rejection.

- Final build, all 136 targeted tests and all 501 behavioral tests passed with no failures/skips. Strict source/development/public/DOM-free contracts and installed-package/security gates passed (41 sources, 54 built modules; 1440 frames /5804 WAV bytes). Independent final-source A/C review reported no findings and ran no runtime gates; it is not release approval. Existing consumer regressions remain unchanged; no implementation/default/copy-count test was added. README, guides, public declarations and voice contracts intentionally retain their existing behavior.

### Meter and position field metadata

- Only meter and bar/beat-position schemas now reuse two private readonly string-name lists, following the beat-event convention. Identical allowed/required slots share a list; `sequenceOwnData` only reads it and still creates fresh detached caller data. Names/order/required fields/labels, descriptor and rejection order, numeric bounds, arithmetic, private-default privacy and frozen output ownership remain unchanged. No caller-output cache/brand/reuse, API/format/dependency change or tempo-point schema change was introduced.
- Four AST prototypes compared original, tempo-only, meter/position-only and combined schemas against a frozen 14-module graph: 120 allocation runs, 120 independent timing runs and 40 full/chunk PCM smokes. Tempo-point hoists reduced sampled allocation, but the combined large-map timing range separated unfavorably; nanosecond-scale cached-control shifts also occurred. The conservative retained candidate is meter/position-only, not a promise that all fewer-allocation variants are faster.

| Prototype control, µs median [process range] | Original | Tempo only | Meter/position only | Combined |
| --- | ---: | ---: | ---: | ---: |
| Raw 1024-point map | 265.5834 [265.3698, 266.3776] | 264.7943 [264.6302, 270.5495] | 262.6484 [258.6927, 275.9219] | 272.9844 [269.1771, 284.9141] |
| Private registered multi-point map | 0.0164 [0.0157, 0.0169] | 0.0183 [0.0169, 0.0203] | 0.0180 [0.0178, 0.0247] | 0.0178 [0.0172, 0.0183] |

- Actual compiled BEFORE/selected AFTER used 60 allocation runs and 20 PCM smokes across ten workloads, two versions and three repetitions. Node26.7/V814.6, 1024 warmups, GC before allocation sampling, interval 2048 and both collected-object flags; raw profiles were saved before reduction. Allocation calls were 100,000 normally, 32,768 for four-point maps and 128 for 1024-point maps. Inputs/setup were outside measurement. Whole-tree weighted JavaScript bytes are primary; independent sample-array totals corroborated all four retained-path reductions. These rounded representations are not required to equal and do not count exact objects, retained heap/RSS, startup or GC costs.

| Actual workload | BEFORE weighted JS B/call range | AFTER weighted JS B/call range |
| --- | ---: | ---: |
| Raw single tempo point | 2095.41–2107.73 | 2084.02–2114.22 |
| Private single-point output, uncached | 2069.41–2076.15 | 2065.92–2075.78 |
| Raw four-point step/linear map | 6939.53–6969.60 | 6945.44–6965.83 |
| Raw 1024-point map | 1365051.44–1369777.12 | 1364929.75–1370675.94 |
| Private registered multi-point map | 19.17–24.45 | 20.36–23.27 |
| Provided 6/8 normalization | 913.36–921.49 | 849.37–855.65 |
| Provided normalized 6/8 beat query | 972.48–976.87 | 905.01–911.27 |
| Default-meter bar query | 899.36–907.21 | 841.94–849.60 |
| Provided normalized 6/8 bar query | 1778.50–1783.88 | 1646.41–1655.45 |
| Omitted meter normalization | 38.62–40.50 | 38.91–40.50 |

- All four meter/position allocation ranges separated; all six untouched tempo/default controls overlapped. Original tempo-point literals, unconditional fallback BPM validation before private-cache lookup, multi-only offsets, uncached single-point copying and query arithmetic remain intact.
- Independent Node live BEFORE/frozen replay/actual AFTER matched both compiled and dist targets, each with 783 main records /12,071,401 bytes plus 245 supplemental records /54,101 bytes. Complete Float64/typed bytes, descriptors, errors/precedence, Proxy/reentry/mutation/ownership, maximum maps, musical/project/MIDI and full PCM/chunk/WAV results matched. Main canonical pre-I/O resource records were empty; post-I/O stdout truthfully showed transient FSReqPromise/PipeWrap, supplements did not sample resources, and child close barriers completed. A subscription-only snapshot adapter is not audio-hardware proof.
- Independent Chrome156 production-dist BEFORE/frozen/actual AFTER matched all 16,321,119 canonical bytes: 4712 helper cases, full 1024-point output with 3072 boundary queries, 15 score/arrangement compositions, 45 full/chunk PCM comparisons, 225 genuine Worker WAV renders and three failure/cancel runs. Zero unexpected normalization getters/page errors; eight legacy inherited query reads were separately preserved. All 228 original Workers, 3825 MessageChannels, browser/server closed and sockets were zero. Existing linear-MIDI rejection remained; discretized step-map MIDI import/export/reexport succeeded.

- Actual timing used 60 fresh processes only after all independent proof resources closed, with no inspector or GC calls: 1024 warmups, seven blocks per process, normally 8192 calls/block, 2048 for four-point maps and 16 for maximum maps. Values are medians of three process medians with their range in microseconds, not merged with the prototype campaign.

| Actual workload | BEFORE µs median [range] | AFTER µs median [range] |
| --- | ---: | ---: |
| Raw single tempo point | 0.6263 [0.5189, 0.6386] | 0.6339 [0.5388, 0.6786] |
| Private single-point output, uncached | 0.6191 [0.5960, 0.6205] | 0.5901 [0.5892, 0.6083] |
| Raw four-point step/linear map | 2.9976 [2.8339, 3.0312] | 2.8788 [2.8047, 3.0508] |
| Raw 1024-point map | 418.4506 [413.7526, 482.3646] | 420.2370 [417.9479, 460.3333] |
| Private registered multi-point map | 0.0249 [0.0245, 0.0257] | 0.0262 [0.0254, 0.0269] |
| Provided 6/8 normalization | 0.2681 [0.2664, 0.3141] | 0.2576 [0.2570, 0.3317] |
| Provided normalized 6/8 beat query | 0.3052 [0.3042, 0.3171] | 0.3105 [0.3091, 0.3654] |
| Default-meter bar query | 0.3027 [0.2575, 0.4379] | 0.2473 [0.2348, 0.2478] |
| Provided normalized 6/8 bar query | 0.5381 [0.5212, 0.6274] | 0.5072 [0.4923, 0.5313] |
| Omitted meter normalization | 0.0501 [0.0500, 0.0563] | 0.0523 [0.0508, 0.0575] |

- Only the default-meter bar-query timing ranges separated. All other actual timing ranges overlapped, with higher raw-single, maximum-map, cached-map, provided beat-query and omitted-meter medians. Thus the retained change is a demonstrated four-path allocation reduction, not a general speedup or proof that prototype CPU signals transfer to actual code. No general project/MIDI/Transport/browser/Worker/DSP, startup, GC, device or listening improvement is claimed.
- Final build, all 136 targeted tests and all 501 behavioral tests passed without failures/skips. Strict source/development/public/DOM-free contracts and installed-package/security gates passed (41 sources, 54 built modules; 1440 frames /5804 WAV bytes). Final-source scoped A/C review found no issues in the retained two-list slice, ran no runtime gates and is not release approval. No implementation/schema-copy-count/default test was added; existing consumer regressions and README/guides/API/voice contracts intentionally remain unchanged.

### Immutable tuning table validation

- Investigation confirmed that the frozen zero-offset table and Synth default tuning were already shared; neither is rebuilt per Synth. The retained change instead avoids repeating 128 descriptor/value checks on offset tables produced and frozen by this module. A private WeakSet recognizes only those output identities, including the existing zero table; raw input arrays are never registered. Every tuning root still undergoes its original own-data/reference validation. Explicit offsets still receive a fresh frozen array and every call a fresh frozen root; frequency interpolation, bounds, error order, arities, DSP state and public contracts remain unchanged.
- Four AST prototypes (original, zero-table-only, full-root membership and output-table membership) used a frozen 14-module graph: 132 allocation processes, 132 isolated timing processes and 44 complete PCM smokes. Full-root membership reduced repeated-input work but introduced clear CPU regressions on cheap empty/reference-only normalization. Output-table membership was selected: it retains the cheap omitted-offset path and also handles a new root wrapping an owned table. No claim is made that any externally frozen array, Proxy, foreign module output or structured clone inherits trust.
- Actual compiled BEFORE/selected AFTER used 66 fresh allocation processes and 22 PCM smokes across eleven workloads, two versions and three repetitions. Node26.7/V814.6, 2048 sampling interval and both collected-object flags; inputs/setup were outside measurement, with warmups and GC before sampling. Raw profiles were saved before reduction. Calls/process were 100,000 for empty/reference/frequency controls, 8192 for ordinary tables, 4096 for normalization chains, 512 for Synth construction and 64 for short renders. Whole-tree weighted JavaScript bytes are primary; independent sample-array totals corroborated all six reused-table reductions. The representations round differently and need not equal; they are not exact object counts, retained heap/RSS or startup/GC measurements.

| Actual workload | BEFORE weighted JS B/call range | AFTER weighted JS B/call range |
| --- | ---: | ---: |
| Omitted offsets, empty tuning | 89.82–93.81 | 92.60–94.03 |
| Reference-only raw tuning | 645.84–649.05 | 647.10–651.02 |
| Raw custom offsets | 25820.97–25920.40 | 25756.71–25839.79 |
| Externally frozen raw custom offsets | 24259.66–24339.03 | 24242.99–24331.26 |
| Normalized zero offsets | 24333.33–24441.14 | 2041.69–2063.02 |
| Normalized custom offsets | 24297.56–24409.04 | 5554.78–5623.61 |
| New root wrapping normalized custom offsets | 24369.69–24471.02 | 5634.57–5667.61 |
| Two successive custom normalizations | 48503.51–48984.98 | 11197.70–11287.09 |
| Synth construction with normalized custom tuning | 171314.36–172276.86 | 153114.20–154535.16 |
| Sequence render with normalized custom tuning | 224292.88–230033.12 | 194646.12–201156.75 |
| Direct fractional frequency query | 16.54–17.06 | 16.03–18.06 |

- All six reused-table allocation ranges separated; all five controls overlapped. Metadata holds weak table identities, not caller roots, live voices or mutable input. Frozen copies and structured clones initially take the full validation path.
- Independent Node live BEFORE/frozen replay/actual AFTER matched both compiled and production-dist targets, each with 206 records /10,367,788 identical canonical bytes. Full Float64/typed bytes, descriptors, errors/precedence, Proxy traces, mutation/ownership, normalization chains, held/released/stolen/fixed-frequency/key-scaled Synth voices, project roundtrips and eco/standard/high PCM/chunks/WAV formats/dither matched. Canonical pre-output resources were empty; post-I/O FSReqPromise/PipeWrap and controller CloseReq/PipeWrap were reported truthfully, and all child close barriers completed.
- Independent Chrome156 production-dist BEFORE/frozen/actual AFTER matched all 3,682,517 canonical bytes: 9737 helper records, three projects, nine full/chunk PCM comparisons and 48 original Worker renders per capture. All 270 ACK MessageChannels and 48 Workers per capture closed, with zero unexpected getters/page errors; browser/server closed and sockets were zero. A genuine trusted-click OPM/AudioWorklet run separately accepted raw/normalized tuning, retuned held audio, rejected malformed API and processor-clone inputs and completed the note with finite nonzero callbacks. Its final voices/pending events were zero, with one intentional processor error. Audio context/node/callback resources closed; callback/scheduling observations are invariants, not deterministic-byte or physical-device/listening proof.
- Actual timing ran only after all independent proof and gate resources closed: 66 fresh processes, no inspector or explicit GC calls, seven blocks/process and three repetitions. Warmups were 1024 ordinarily, 128 for Synth and 32 for rendering. Calls/block were 8192 for empty/reference/frequency, 2048 for ordinary tables, 1024 for chains, 128 for Synth and 16 for renders. Values below are medians of process medians and their range, separate from prototypes.

| Actual workload | BEFORE µs median [process range] | AFTER µs median [process range] |
| --- | ---: | ---: |
| Omitted offsets, empty tuning | 0.0898 [0.0890, 0.1003] | 0.0861 [0.0847, 0.0965] |
| Reference-only raw tuning | 0.1561 [0.1545, 0.1634] | 0.1821 [0.1520, 0.1917] |
| Raw custom offsets | 11.9936 [11.0690, 12.0469] | 11.5519 [10.3820, 12.1792] |
| Externally frozen raw custom offsets | 10.9396 [10.6048, 10.9958] | 10.3728 [10.2298, 11.1212] |
| Normalized zero offsets | 10.1688 [9.8876, 10.6049] | 3.3491 [3.2378, 4.2410] |
| Normalized custom offsets | 10.9619 [10.9457, 13.3130] | 4.7301 [4.3990, 8.3869] |
| New root wrapping normalized custom offsets | 11.3444 [10.7686, 13.1692] | 4.6970 [4.6613, 5.3312] |
| Two successive custom normalizations | 21.7146 [21.3088, 22.4884] | 9.4791 [9.3863, 9.5715] |
| Synth construction with normalized custom tuning | 31.2204 [29.9401, 33.6735] | 25.2236 [23.2321, 26.4700] |
| Sequence render with normalized custom tuning | 205.0599 [199.5495, 207.0963] | 189.7838 [184.5964, 218.6302] |
| Direct fractional frequency query | 0.0419 [0.0388, 0.0419] | 0.0427 [0.0378, 0.0444] |

- Reused zero/custom/wrapped/chained normalization and Synth-construction timing ranges separated. Render and all five control ranges overlapped; reference-only and direct-frequency medians were higher. Thus no general rendering, Worker/worklet, default construction, frequency math, GC, startup, device or listening speedup is claimed. Cross-thread clones still require their first complete validation.
- Final build, all 104 targeted tests and all 502 behavioral tests passed without failures/skips. Strict source/development/public/DOM-free contracts and installed-package/asset-CLI/security gates passed (41 sources, 54 built modules; 1440 frames /5804 WAV bytes). A consumer regression covers valid then invalid caller mutation, old-snapshot stability, alternate reference tuning with reused offsets and invalid root fields/accessors. Final-source scoped A/C review found no supported-input issues and ran no runtime gates; arbitrary built-in corruption is excluded and this is not release approval. README/guides, generated public declarations and voice format intentionally retain their existing behavior.

### Bounded MIDI variable-length encoding

- The private SMF writer now extracts seven-bit VLQ digits with `&127` and `>>>7`, only after its unchanged safe-integer `0..0x0fffffff` guard. Bitwise conversion never touches cumulative ticks. Payload copying retains the original `Uint8Array#set`; event/byte budgets, preallocation checks, sorting, normalization, quantization, file ownership, public declarations and formats are unchanged.
- Four AST prototypes used a frozen 17-module graph: 84 independent timing processes across seven workloads. All four matched 58 byte/Float64/error records /1,068,731 bytes, plus six cumulative-tick/exact-wire-budget records /14,753,729 bytes. The diagnostic harness additionally exported the private VLQ primitive; that export is not shipped. A CPU profile included inspector startup and inlining/caller attribution and was not treated as precise writer cost or allocation evidence.
- The initial combined prototype also replaced payload copying with an indexed loop. Genuine compiled/dist/browser proofs and 503 tests passed, but 42 actual-source timing processes exposed an expressive-export regression. The copy experiment was rejected and its original code restored, rather than trusting the favorable prototype signal:

| Rejected combined candidate, µs median [process range] | BEFORE | Combined AFTER |
| --- | ---: | ---: |
| 8192-note export | 8804.6040 [8698.3335, 10011.9585] | 8773.0625 [8622.6875, 8904.6665] |
| 512-note expressive export | 2062.3960 [2054.5210, 2123.7085] | 2450.0000 [2326.7080, 2525.5625] |

- One bounded follow-up measured actual bitwise-only source against the same immutable original after all proof/gate resources closed: 42 fresh Node26.7/V814.6 processes, seven blocks/process and three rotated repetitions, without inspector or explicit GC. Inputs/setup were outside timing. Warmups were two for large/expressive exports, 16 for the kernel, 32 for 128 notes and 256 otherwise. Calls/block were two for large/expressive exports, 16 for the kernel/128 notes, 64 for a four-byte-delta file and 1024 otherwise. Each kernel call encodes 4096 deterministic legal VLQs; other rows are whole API calls. Values below are process-median medians and ranges, not merged with prototypes or the rejected combined run.

| Final actual workload | BEFORE µs median [process range] | Bitwise-only AFTER µs median [process range] |
| --- | ---: | ---: |
| Private 4096-VLQ diagnostic | 28.8802 [26.0573, 30.5261] | 20.2266 [17.1406, 21.3958] |
| Empty export | 2.0886 [1.9513, 2.3110] | 2.0686 [1.9097, 2.2745] |
| One-note export | 3.1222 [2.7870, 3.3936] | 3.0919 [2.8407, 3.2834] |
| 128-note export | 108.6667 [103.3724, 125.4245] | 108.1406 [103.1771, 119.7344] |
| 8192-note export | 7074.7500 [6945.7710, 7177.6040] | 7312.2710 [7121.2705, 7748.6875] |
| 512-note expressive export | 1816.3750 [1710.1460, 1846.8540] | 1805.5000 [1704.1665, 1813.1040] |
| Four-byte-delta file | 6.3066 [6.3053, 7.2754] | 6.5605 [6.1270, 7.3477] |

- Only the private primitive's timing ranges separated. All six whole-export ranges overlapped, with higher large-export and four-byte-file medians. The retained change is a bounded primitive improvement, not a demonstrated whole-export/browser/Worker/DSP, startup, GC, allocation, device or listening speedup.
- Independent Node actual compiled/dist BEFORE, frozen replay and final bitwise-only AFTER matched each complete main stream (437 records /54,090,210 bytes) and supplement (12 records /66,343 bytes). Both SMF formats, PPQN/width/max/overflow, cumulative ticks above signed 32-bit, exact 32766-note wire budgets, 16-channel state, metadata limits, malformed/Proxy/getter/mutation/ownership cases, project and three-quality full/chunk PCM/WAV/dither matched. Existing expressive initial/reexport byte non-idempotence was recorded, not “fixed” or hidden. Inner pre-output PipeWrap, post-I/O FSReqPromise/PipeWrap and outer CloseReq/PipeWrap were reported; all child close barriers completed.
- Independent Chrome156 production-dist BEFORE/frozen/final AFTER matched all 30,613,682 canonical bytes: 140 helper cases, one project, three-quality full/chunk PCM and 18 original Worker lifecycles per capture, including WAV formats/dither/cancel/failure. All 165 ACK channels and 18 Workers per capture closed; browser/server closed, sockets/getters/page errors were zero. Existing release-tail warning/rejection semantics were preserved. Initial invalid synthetic fixtures were retained and corrected before valid captures; no successful baseline was rewritten.
- Final build, all 111 targeted and 503 behavioral tests passed without failures/skips. Strict/public/DOM-free types and installed-package/asset-CLI/security gates passed (41 sources, 54 built modules; 1440 frames /5804 WAV bytes). A consumer regression covers VLQ width/max/overflow and cumulative ticks above signed 32-bit in both formats. Final-source scoped A/C review found no supported-input issue in bitwise-only code and supersedes the rejected combined disposition; no reviewer runtime gates or release approval. README/guides, voice format and generated public contracts intentionally remain unchanged.

### Noncenter stereo pan factors

- Each pooled voice now retains raw cosine/sine factors keyed by its last noncenter, clamped note-plus-voice pan. Expression changes still recompute gain; center bypasses the cache, endpoints keep literal zero, and the original left-associative `gain * SQRT2 * trig` order is preserved. Pan changes, voice recycling, detached fades, clocks, validation, public contracts and voice format are unchanged. Three private scalar fields add bounded per-slot storage, not caller-reference retention.
- The original/refresh-flag/memo AST experiments covered 81 count/PCM and 243 isolated timing processes. Those timings used initially zero-valued factors. A separate 81-process NaN-initialized count/PCM run matched them; it was not treated as NaN timing evidence. V8 generalization traces showed NaN primed double representation before live use, while const-to-mutable generalization remained; this is not allocation/GC proof.
- The first actual memo passed full runtime proofs and 504 tests, but its center key access produced a separated eco expression-only regression. Its source/module closure, raw measurements and successful runtime captures were retained before one bounded follow-up; no successful baseline was rewritten:

| First actual candidate, µs median [process range] | Original BEFORE | Center-key memo AFTER |
| --- | ---: | ---: |
| Eco centered expression ramp | 2002.46 [1994.79, 2033.75] | 2068.33 [2057.87, 2288.25] |

- The final noncenter-only guard skips center key reads/writes. After all runtime and gate resources closed, an independent original-versus-final run used 162 fresh Node26.7/V814.6 processes: three rotated repetitions, seven blocks/process, no inspector or explicit GC. Render rows use 16 notes, 2048 stereo frames at 48 kHz, a single audible sine operator and zero LFO; ramps last three seconds, with two render warmups and one call/block. Constructor rows use maxVoices16, 64 warmups and 64 calls/block. The source-load diagnostic reprints the module without semantic body changes; timing does not wrap trig. Values are medians/ranges of process medians, not pooled with prototypes or the first candidate.

| Final actual workload | Original BEFORE µs median [process range] | Noncenter memo AFTER µs median [process range] |
| --- | ---: | ---: |
| Eco static offcenter | 1550.17 [1458.29, 1821.88] | 1791.17 [1555.17, 2043.17] |
| Eco offcenter expression | 2340.54 [2330.75, 2860.50] | 2086.71 [1853.08, 2333.79] |
| Eco centered expression | 1879.08 [1865.67, 2264.71] | 1988.08 [1894.46, 2257.67] |
| Eco endpoint expression | 2198.08 [2197.50, 2727.71] | 2072.62 [2041.21, 2769.25] |
| Eco voice-pan expression | 2406.17 [2166.17, 2578.75] | 1949.75 [1787.42, 2274.00] |
| Eco pan ramp | 2058.79 [1919.58, 2230.29] | 2107.83 [1964.62, 2302.25] |
| Eco simultaneous pan/expression ramps | 2112.87 [2108.79, 2114.58] | 2178.54 [2172.00, 2189.58] |
| Eco clamped pan ramp | 2213.83 [2093.29, 2411.29] | 2020.29 [1891.67, 2080.71] |
| Eco construction | 55.61 [50.04, 58.54] | 45.09 [43.81, 45.97] |
| Standard static offcenter | 2471.25 [2357.17, 2554.71] | 2583.33 [2242.00, 2605.29] |
| Standard offcenter expression | 3066.21 [3050.58, 3097.17] | 2625.83 [2607.83, 2635.63] |
| Standard centered expression | 2546.38 [2528.63, 2644.04] | 2575.25 [2568.37, 2619.38] |
| Standard endpoint expression | 2913.00 [2864.83, 2928.25] | 2835.58 [2756.33, 2996.50] |
| Standard voice-pan expression | 3055.13 [3026.08, 3381.92] | 2672.00 [2622.50, 2687.46] |
| Standard pan ramp | 2852.75 [2842.00, 3168.92] | 2883.13 [2877.79, 3052.67] |
| Standard simultaneous ramps | 2905.29 [2811.21, 2924.63] | 2890.25 [2687.96, 2971.00] |
| Standard clamped pan ramp | 2931.08 [2865.17, 3213.29] | 2789.58 [2598.04, 3046.58] |
| Standard construction | 41.82 [40.52, 43.98] | 41.83 [40.59, 44.06] |
| High static offcenter | 4321.37 [3968.13, 4468.67] | 4079.75 [3797.33, 4197.08] |
| High offcenter expression | 4865.21 [4494.46, 5200.96] | 4480.17 [4294.25, 4635.79] |
| High centered expression | 4215.25 [4057.92, 4416.12] | 4382.25 [4175.54, 4595.71] |
| High endpoint expression | 4651.58 [4317.17, 5210.12] | 4438.71 [4272.54, 4584.04] |
| High voice-pan expression | 4840.46 [4752.46, 4937.38] | 4364.92 [4336.58, 5002.46] |
| High pan ramp | 4657.75 [4564.37, 4704.92] | 4820.67 [4564.96, 4917.58] |
| High simultaneous ramps | 4719.88 [4415.37, 4847.42] | 4847.08 [4758.87, 4924.33] |
| High clamped pan ramp | 4756.92 [4628.62, 4866.08] | 4536.00 [4437.62, 4815.08] |
| High construction | 41.28 [40.91, 57.11] | 45.13 [42.19, 57.34] |

- Final standard offcenter/voice-pan expression and eco clamped-pan ranges separated favorably. Eco simultaneous ramps regressed with separated ranges: moving pan still pays cache-miss/storage cost. Center ranges now overlapped, with higher medians; many other controls also had higher medians. Eco constructor ranges separated favorably without establishing a cause. The retained change targets stationary noncenter pan, not general/default DSP, moving-pan, construction, browser/Worker/worklet, allocation/GC, startup, device or listening speedups.
- A separate final 54-process instrumented run preserved complete PCM and clocks across all workloads/qualities. Per 16-voice render, offcenter/voice-pan expression removed 32768 cosine and 32768 sine calls; endpoint expression and clamped pan removed 32768 sine calls. Static/center/construction already had no counted pan trig. Moving pan retained 32752 calls of each kind versus 32768 before, skipping the first unchanged-pan frame. Counts cover only private pan trig, not oscillators or whole-engine work.
- Independent unmodified Node compiled/dist original BEFORE, frozen and final AFTER matched every complete stream: 521 records /10,087,623 bytes, including signed-zero/tiny/clamped pans, expression/independent-gain and pan retargets, three qualities, recycling/stealing/fades, errors/snapshots and PCM/WAV/dither. All child exit/stdio close barriers completed; transient PipeWrap, FSReqPromise and CloseReq observations were reported rather than described as empty.
- Independent Chrome156 production-dist BEFORE/frozen/final AFTER matched all 11,577,840 canonical bytes: 72 core cases, three full/chunk sequences and 18 original Worker lifecycles per capture. All 150 ACK channels and Workers closed. Trusted-click original OPM/worklet stereo automation, mute/unmute, snapshots, finite audio, malformed rejection and note-ended passed with 80 callbacks. Exactly one intentional processor error was separate from zero unexpected getters/page errors/error events and final active/pending counts of zero; context/node/callback/browser/server closed with no sockets.
- Final build, all 93 targeted and 504 behavioral tests passed without failures/skips; strict/public/DOM-free types and installed-package/asset-CLI/security gates passed (41 sources, 54 built modules; 1440 frames /5804 WAV bytes). A consumer regression compares recycled voice-pan changes and interrupted independent stereo expression automation against a fresh Synth across qualities. Final-source scoped A/C review found no supported-input issue and supersedes the center-key candidate; no reviewer runtime gates or release approval. README/guides, voice format and generated public contracts intentionally retain their behavior.

### Tempo prefix context validity

- Fixed stale forward tempo prefixes when inherited optional fields change. Frozen point objects still inherit missing `curve`/`endBpm` values; freezing their own data does not freeze `Object.prototype`. The cached path also used to disagree with the original traversal when an inherited terminal array index supplied a next point.
- Cache eligibility is captured after input descriptor/proxy and slope-validation callbacks, immediately before the original prefix additions. Dirty admission retains private snapshot identity but marks the existing vector permanently ineligible only after those additions finish. Queries require both eligible admission and a currently clean inherited context; otherwise they execute the unchanged left-to-right traversal.
- Context checks inspect property presence without invoking getters, cover both prototype terminal indices, and reject a changed `Array.prototype` parent. Output prototypes, omitted own optional fields, BPM validation order, getter/error behavior, bounds, default/single-point paths and inverse formulas are preserved. No additional metadata allocation or runtime dependency was introduced.
- A public conversion regression compares reused snapshots with freshly normalized input after inherited `curve`/`endBpm` properties are installed and removed, restoring original descriptors in `finally`.
- Actual Node26.7 compiled/dist context supplements each passed all 152 comparisons, including dynamic/throwing getters, dirty admission/restoration, terminal indices and descriptor callbacks; the original frozen implementation had 66 divergences each. One initial fixture incorrectly compared contexts after only the raw side re-executed a mutating Proxy callback. Its six invalid public comparisons were removed while direct admission/restoration coverage and the original baseline remained intact; failure evidence was retained.
- Every original clean-context Node stream remained identical: 2,208 records /59,440,786 bytes across compiled/dist, with 12 complete comparisons against original BEFORE and frozen captures. The integration owner independently compared every byte. All child/runner/supervisor exit and stdio-close barriers completed; transient resource observations were reported truthfully.
- Chrome156 repaired all 29 context records, versus 17 original mismatches, and preserved all 16,425,434 original canonical bytes: 5,476 helpers, 15 projects, 45 renders and 228 original Workers. All 3,825 ACK channels and Workers closed. Trusted-click original Transport late-seek/restart produced finite stereo across 51 callbacks, with no onError/unexpected errors and final active/pending/error/rejected counts of zero. Transport, context, node, callback, browser, server and sockets closed.
- Build, 34 transport regressions, all 505 behavioral tests, strict/public/DOM-free typechecks and the zero-dependency/dynamic-code gate passed (41 sources, 54 built modules). Final-source scoped A/C review found no supported-input blocker; this is not release approval. Public API/voice-format behavior and README/guides otherwise remain unchanged.
- The proposed inverse-span cache was rejected before product edits: clean-context numeric/CPU checks did not establish compatibility with mutable inherited fields. This correctness repair does not ship that feature or claim a general tempo, audio, allocation/GC or browser speedup.

- A separate 42-process direct-module CPU comparison used three rotated fresh processes per implementation/workload, seven timed blocks and 64 precomputed queries; setup/imports and warmups were outside timing. Every complete 512-byte Float64 output matched. The guard deliberately adds work to owned-map queries; default, unregistered and public inverse ranges overlapped. These local Node26.7 observations are not allocation/GC, native-browser, Worker/worklet, device or listening guarantees.

| Clean-context query | Original BEFORE µs median [process range] | Guarded AFTER µs median [process range] |
| --- | ---: | ---: |
| Owned step, 3 points | 0.02040 [0.02026, 0.02055] | 0.03893 [0.03853, 0.03958] |
| Owned step, 16 points | 0.02331 [0.02181, 0.02337] | 0.04698 [0.04496, 0.04776] |
| Owned linear, 1024 points | 0.05145 [0.05106, 0.05272] | 0.07207 [0.07144, 0.07231] |
| Owned linear, beat zero | 0.00525 [0.00514, 0.00536] | 0.02502 [0.02501, 0.02560] |
| Public inverse, 1024 linear points | 14.49861 [14.41751, 14.51183] | 14.51148 [14.46402, 14.58499] |
| Default forward API | 0.04928 [0.04908, 0.05778] | 0.04938 [0.04876, 0.05387] |
| Unregistered frozen step, 16 points | 0.12937 [0.12927, 0.14155] | 0.13365 [0.12955, 0.15085] |

- All four owned-forward ranges regressed with separated ranges, adding approximately 19–24 ns to the median per query. Correct cache validity takes precedence over these small absolute query costs; no speedup is claimed for this repair.

- Installed-package rendering/WAV, asset-CLI copy/reuse and public/DOM-free package type smokes also passed (1440 frames /5804 WAV bytes).

### Voice ownership and pooled timing context

- `prepareVoice()` freezes only its own optional pitch-envelope/key-scaling objects. Inherited foreign objects are neither read by the freeze checks nor frozen; approved own fields still detach, validate and deep-freeze before private identity registration. Returned prototypes, omitted own optional fields and voice formats remain unchanged.
- Pooled envelope timing now requires both a clean construction context and clean current inherited `sr`/`rateKeyScale` context. A sticky per-operator check runs after earlier optional reads, so getters that change the context during admission cannot leave apparently reusable coefficients. One private boolean per bounded slot records eligibility; live `envelopeEdited` flags, sustain constants, formulas, clocks and per-frame paths retain their semantics.
- Failed unpublished initialization returns its borrowed spare and clears both cached voice identity and timing eligibility before rethrowing the original value. Stealing, publication and terminal callbacks stay outside cleanup. Monotonic IDs/sequences are not rolled back after possible user code. This also prevents own-only freezing from moving raw getter failures into an unprotected slot lease.
- Actual original dist reproduction exhausted the spare pool during repeated inherited getter failures, then rejected a valid note with an unrelated TypeError. Final compiled/dist smoke preserved the exact error through all 80 attempts, kept existing PCM unchanged, admitted the subsequent note and matched fresh PCM after panic. Separate partial-operator failures followed by the old patch verify that both sustain gains and timing rebuild, not merely pool capacity.
- Public regressions cover foreign-object mutability/getter non-execution, inherited sustain/rate transitions and failed-admission active audio/capacity/partial-coefficient recovery across all three qualities. Controls with inherited glide affected raw and trusted snapshots equally in an actual PCM probe; that was not a cache discrepancy and their semantics were not changed.

| Independent changing-context supplement | Original frozen issues | Final issues |
| --- | ---: | ---: |
| Node context, 60 records per compiled/dist build | 29 | 0 |
| Node lifecycle, 27 records per compiled/dist build | 12 | 0 |
| Chrome context, 48 records | 32 | 0 |
| Chrome lifecycle, 21 records | 12 | 0 |

- Node context/lifecycle streams include complete stereo held/release PCM, clocks/errors, own overrides, live edits, tiny durations, earlier optional getters changing context, repeated exact-error failures and partial initialization. Compiled/dist streams match completely. Original clean Node BEFORE/frozen/AFTER matched all 2,208 records /59,440,786 bytes, with 12 whole-payload comparisons independently repeated by the integration owner.
- Chrome156 preserved every original clean canonical byte (16,425,434): 5,476 helpers, 15 projects, 45 renders and 228 original Workers. All 3,825 ACK channels closed. Genuine trusted-click Transport restart/late-seek produced finite stereo over 51 callbacks with zero onError/unexpected errors and final active/pending/errors/rejected counts of zero. Prototype descriptors and all process/stdio/Worker/Transport/context/node/callback/browser/server/socket lifecycles were restored or closed; transient resource observations were retained truthfully.
- Build, all 61 targeted and 508 behavioral tests, strict/public/DOM-free typechecks and the zero-dependency/dynamic-code gate passed (41 sources, 54 built modules). Applied-source scoped A/C review found no supported-input blocker; the reviewer ran no runtime gates and did not approve a release. Generated public contracts, README/guides and voice format remain unchanged.

- A separate direct-module CPU run used 84 isolated actual Node26.7 processes: three rotated fresh processes per implementation/workload and seven timed blocks. Imports, setup, warmups and complete 2048-byte PCM proofs were outside timing; all proof bytes matched. Admission rows include `panic`; edited rows also include the ADSR update. Steady rows render 16 voices /1024 frames. No forced-GC or allocation inference was used.

| Actual workload | Original BEFORE µs median [process range] | Final AFTER µs median [process range] |
| --- | ---: | ---: |
| Plain voice preparation | 3.65951 [3.51066, 4.14014] | 3.55550 [3.46745, 3.72396] |
| Expressive voice preparation | 5.77864 [5.61678, 5.85718] | 5.86898 [5.86320, 5.87199] |
| Eco prepared admission/panic | 0.47412 [0.46684, 0.47489] | 0.52964 [0.51261, 0.53341] |
| Eco raw admission/panic | 4.14852 [4.13810, 4.17480] | 4.22713 [4.13818, 4.25326] |
| Eco edited admission/update/panic | 0.85207 [0.84664, 0.86385] | 0.89276 [0.88713, 0.89679] |
| Eco steady render | 680.72394 [675.54163, 687.08594] | 682.32812 [681.35938, 687.24481] |
| Standard prepared admission/panic | 0.46330 [0.45734, 0.46938] | 0.52148 [0.51162, 0.55092] |
| Standard raw admission/panic | 4.15999 [4.12931, 4.26131] | 4.35856 [4.30005, 4.39193] |
| Standard edited admission/update/panic | 0.88733 [0.87620, 0.91838] | 0.91260 [0.90411, 0.94902] |
| Standard steady render | 1000.53644 [992.01044, 1005.15881] | 991.14844 [990.48175, 1005.30731] |
| High prepared admission/panic | 0.46497 [0.45890, 0.46842] | 0.51408 [0.50358, 0.51544] |
| High raw admission/panic | 4.18441 [4.09359, 4.24797] | 4.28442 [4.26156, 4.29850] |
| High edited admission/update/panic | 0.85126 [0.84650, 0.85348] | 0.89056 [0.89020, 0.89915] |
| High steady render | 1616.10419 [1590.93225, 1745.28650] | 1599.12238 [1586.36194, 1620.13025] |

- All prepared-admission ranges regressed with separated ranges (approximately 49–58 ns added to median admission/panic cycles). Expressive preparation, standard/high raw admission and eco/high edited cycles also separated unfavorably; expressive preparation separation was small. Other ranges, including all steady renders, overlapped. Correct ownership, fresh-equivalent timing and failure recovery take precedence; this repair claims no general speedup or browser/Worker/worklet, allocation/GC, startup, device or listening benefit.

- Installed-package rendering/WAV, asset-CLI copy/reuse and public/DOM-free package type smokes passed (1440 frames /5804 WAV bytes).

### Prototype presence guard cost

- Tempo-prefix and pooled-envelope guards use native `in` presence checks on `Object.prototype`, whose null parent is immutable. These checks do not run getters. The tempo guard still verifies the exact array parent before checking the terminal index; that one lookup covers the original array/object own-presence checks. Dirty-construction markers, per-operator sticky eligibility and failure recovery remain unchanged.
- Privately registered multi-point tempo maps return `+0` immediately for non-positive numeric beats: their own zero-start point and positive second point make the original first segment end without optional reads. The explicit numeric check preserves unsupported-type coercion/error traces; NaN, unregistered maps and positive queries retain their original paths.
- Before product edits, four isolated syntax-aware candidates and the unchanged graph passed warmed tempo/voice/lifecycle and numeric-boundary probes (439 complete records per graph). All 252 fresh candidate CPU children retained complete PCM/Float64 output; candidate timings were used for selection, not presented as actual product measurements.
- Actual Node 26.7.0 / V8 14.6.202.34-node.28 live BEFORE, frozen replay and rebuilt AFTER matched all seven complete suites in compiled and distribution form: 3,086 records / 77,165,268 bytes. Context suites warmed 16,384 iterations before prototype changes and cover getter/error traces, changed array parents, non-finite/signed-zero/untyped beat inputs, live edits and slot recovery. All children and supervisors exited successfully with stdout/stderr close evidence.
- Chrome 156.0.8078.74 preserved the original complete 16,425,434-byte canonical output and all 98 warmed tempo/voice/lifecycle records. All 228 Workers, 3,825 acknowledgement channels and genuine trusted-click Transport/OPM/worklet resources closed; Transport retained 51 callbacks, finite stereo, zero errors and zero final active/pending notes. This is browser correctness evidence, not browser speed or listening acceptance.
- Applied-source scoped A/C review by IdleSecurity found no supported-input findings. Build, all 508 behavioral tests, strict/public/DOM-free typechecking and static security gates passed. No public API, voice format, protocol, validation budget or dependency changed; existing correctness regressions remain in place rather than adding implementation-pinning tests.

- Actual-product cost comparison below imports the immutable original compiled graph and rebuilt compiled graph directly, without AST reprinting: 126 fresh Node 26.7.0 / Apple M5 processes, three rotated processes per workload/implementation and seven timed blocks per child. Entries are the median of per-process block medians with their complete process range, in microseconds per cycle/query. Fixture construction, imports, proof rendering and warmup are outside timing; operation allocations remain timed. Steady rendering uses 16 voices and 1024-frame stereo buffers. Every complete 512-byte Float64 or 2048-byte PCM proof matched; no explicit GC or allocation/GC inference was used.

| Actual workload | Original BEFORE µs median [process range] | Final AFTER µs median [process range] |
| --- | ---: | ---: |
| Owned 3-point step query | 0.06184 [0.06086, 0.06848] | 0.04604 [0.04380, 0.04790] |
| Owned 16-point step query | 0.07730 [0.06793, 0.07890] | 0.04767 [0.04527, 0.05414] |
| Owned 1024-point linear query | 0.12353 [0.11036, 0.14027] | 0.08856 [0.08710, 0.10999] |
| Owned zero-beat linear query | 0.04104 [0.03936, 0.04395] | 0.00843 [0.00820, 0.00941] |
| Public 1024-point inverse query | 22.83311 [22.79611, 35.76380] | 27.33160 [23.71045, 29.82895] |
| Default forward query | 0.08540 [0.07494, 0.08613] | 0.08476 [0.08351, 0.09546] |
| Raw 16-point step query | 0.20035 [0.20008, 0.22656] | 0.19955 [0.19892, 0.24948] |
| Plain voice preparation | 5.53638 [5.38306, 6.78369] | 5.60498 [5.50993, 7.22713] |
| Expressive voice preparation | 9.12492 [8.90812, 10.01221] | 9.04256 [8.92928, 10.08219] |
| Eco prepared admission/panic | 0.93402 [0.83073, 0.95062] | 0.91494 [0.73649, 0.95508] |
| Eco raw admission/panic | 6.49756 [6.44320, 7.68994] | 6.54403 [6.46501, 7.52824] |
| Eco edited admission/update/panic | 1.36983 [1.36300, 1.71118] | 1.34930 [1.33931, 1.52478] |
| Eco steady render | 1042.80731 [1006.40887, 1193.66669] | 1054.17450 [1016.90106, 1075.35938] |
| Standard prepared admission/panic | 0.80487 [0.79427, 0.87799] | 0.81360 [0.74664, 0.82261] |
| Standard raw admission/panic | 6.45679 [6.38387, 7.34237] | 6.49878 [6.45825, 6.63029] |
| Standard edited admission/update/panic | 1.38706 [1.37260, 1.53223] | 1.45616 [1.33167, 1.55949] |
| Standard steady render | 1523.38800 [1467.73700, 1743.99737] | 1541.71094 [1471.76819, 1586.45575] |
| High prepared admission/panic | 0.78257 [0.77620, 0.81974] | 0.86039 [0.77077, 1.13096] |
| High raw admission/panic | 6.70492 [6.53768, 6.91634] | 6.50260 [6.42594, 6.56299] |
| High edited admission/update/panic | 1.35386 [1.33649, 1.75002] | 1.36165 [1.33146, 1.57078] |
| High steady render | 2469.59631 [2343.61981, 2757.33075] | 2369.16406 [2368.95831, 2497.94275] |

- The four owned forward-query ranges separated favorably (the linear-query separation was small). All other actual-product ranges overlapped, including every Synth workload: the isolated-candidate admission gain is not promoted to an actual-product Synth speed claim. No general, browser/Worker/worklet, startup, memory/GC, device or listening benefit is claimed.

- Installed-package rendering/WAV, asset-CLI copy/reuse and public/DOM-free package type smokes passed (1440 frames / 5804 WAV bytes).

### Guarded inverse tempo span reuse

- Privately registered multi-point maps retain exact full interval integrals beside the existing cumulative prefixes. Eligible inverse queries subtract those spans one by one in the original order; subtracting one cumulative prefix would change rounding. A shared inverse helper retains the original slope-before-`point.beat` read order in both fast and raw paths.
- Reuse requires numeric input, private identity, a clean admission marker and the existing clean current prototype context. Dirty construction, inherited optional fields, substituted array parents, unregistered/foreign/proxy maps and coercive inputs retain the original traversal. Only an eligible path can omit the pure terminal integral/comparison. No query buffer, cache registry, caller reference, API, voice format, protocol, dependency or validation-limit change was added.
- The existing single private vector grows from `N` to `2*N-1` cells. Actual compiled/distribution constructor-interception observations below measured logical backing lengths, not native heap retention, total allocations, GC or timing. There is still one vector construction per multi-point map and none for single-point/default maps.

| Tempo points | Original vector bytes | Final vector bytes |
| --- | ---: | ---: |
| 1 | 0 | 0 |
| 2 | 16 | 24 |
| 3 | 24 | 40 |
| 16 | 128 | 248 |
| 1024 | 8192 | 16376 |

- Consumer regressions extend public inherited-field conversion coverage to inverse queries in both context directions. A separate exact numerical-equivalence case compares clean and semantically equivalent ineligible snapshots; it catches replacing successive subtraction with prefix subtraction without pinning an implementation or rounded decimal expectation. Actual compiled/distribution BEFORE/AFTER counterexample outputs also matched completely.
- Actual Node 26.7.0 / V8 14.6.202.34-node.28 LIVE BEFORE, immutable frozen replay and rebuilt AFTER matched all seven complete suites in compiled/distribution form: 3,486 records / 77,230,008 bytes, including every Float64/PCM value and getter/proxy/error trace. Context probes warm both conversion directions for 16,384 iterations before mutations; all children/supervisors exited successfully with stream-close evidence.
- Chrome 156.0.8078.74 retained the original complete 16,425,434-byte canonical output and all 98 dual-warmed context/lifecycle records. All 228 Workers, 3,825 acknowledgement channels and browser/context/node/callback/server/socket resources closed. Genuine trusted-click Transport/OPM/worklet use retained 51 callbacks, finite stereo, zero errors and zero final active/pending notes.
- Syntax-aware isolated candidate proofs matched every original record. Separate 318- and 477-child CPU campaigns compared conditional and separated paths across 53 workloads, retaining every complete output proof. The separated path avoids per-interval cache selection and unused point reads; candidate timings are not presented as actual-product or browser gains.
- Applied-source scoped A/C review by IdleSecurity found no supported-input findings. Build, all 509 behavioral tests, strict/public/DOM-free typechecking and static security gates passed. This is not release, device or human-listening acceptance.

- Actual-product comparison below imports the immutable original and rebuilt compiled graphs directly, without AST reprinting: 318 fresh Node 26.7.0 / Apple M5 children, three rotated processes per workload/implementation and seven timed blocks per child. Values are microseconds per query/normalization, median of per-process block medians [complete process range]. Imports, fixture/proof construction and warmup are outside timing; operation allocations remain timed. All complete Float64 and normalized-snapshot proofs matched. No explicit GC or heap/GC inference was used. “Owned” means a normalized snapshot; single-point snapshots intentionally have no private cache. Raw public calls include fresh normalization.

| Actual workload | Original BEFORE µs median [process range] | Final AFTER µs median [process range] |
| --- | ---: | ---: |
| Default public inverse | 0.09405 [0.08751, 0.10908] | 0.09398 [0.08646, 0.10595] |
| Owned inverse / 1-point step | 0.02657 [0.02526, 0.02759] | 0.03326 [0.03325, 0.03708] |
| Public owned inverse / 1-point step | 0.43105 [0.40993, 0.43803] | 0.44116 [0.41739, 0.44169] |
| Raw inverse / 1-point step | 0.02644 [0.02629, 0.02664] | 0.03006 [0.02942, 0.03123] |
| Public raw inverse / 1-point step | 0.45984 [0.43585, 0.46157] | 0.46381 [0.44609, 0.48297] |
| Normalization / 1-point step | 0.47121 [0.42126, 0.47270] | 0.42000 [0.41705, 0.42133] |
| Owned inverse / 2-point step | 0.03947 [0.03599, 0.04384] | 0.06113 [0.05207, 0.06351] |
| Public owned inverse / 2-point step | 0.09408 [0.08947, 0.09985] | 0.11347 [0.11298, 0.11924] |
| Raw inverse / 2-point step | 0.03876 [0.03764, 0.03907] | 0.04417 [0.03624, 0.04587] |
| Public raw inverse / 2-point step | 0.98153 [0.97738, 1.04419] | 0.98027 [0.97900, 1.00151] |
| Normalization / 2-point step | 0.94566 [0.92067, 0.95685] | 0.97371 [0.95003, 1.00484] |
| Owned inverse / 2-point linear | 0.06279 [0.06070, 0.06364] | 0.07122 [0.06590, 0.07772] |
| Public owned inverse / 2-point linear | 0.14013 [0.13093, 0.14014] | 0.12599 [0.12385, 0.12733] |
| Raw inverse / 2-point linear | 0.06165 [0.05875, 0.06557] | 0.06116 [0.05665, 0.06571] |
| Public raw inverse / 2-point linear | 1.13922 [1.12968, 1.20880] | 1.12854 [1.11180, 1.21204] |
| Normalization / 2-point linear | 1.03526 [0.99200, 1.08246] | 1.07861 [1.00527, 1.35490] |
| Owned inverse / 3-point step | 0.04941 [0.04938, 0.05678] | 0.05615 [0.05217, 0.05764] |
| Public owned inverse / 3-point step | 0.10426 [0.09514, 0.10482] | 0.11697 [0.11110, 0.11820] |
| Raw inverse / 3-point step | 0.04966 [0.04545, 0.05018] | 0.05090 [0.04994, 0.05603] |
| Public raw inverse / 3-point step | 1.41663 [1.39569, 1.53003] | 1.38348 [1.34845, 1.40871] |
| Normalization / 3-point step | 1.27989 [1.22463, 1.35919] | 1.27865 [1.26467, 1.31582] |
| Owned inverse / 3-point linear | 0.08312 [0.08129, 0.09015] | 0.06962 [0.06511, 0.07407] |
| Public owned inverse / 3-point linear | 0.14578 [0.13059, 0.15172] | 0.12494 [0.12193, 0.13868] |
| Raw inverse / 3-point linear | 0.07679 [0.07156, 0.08065] | 0.10161 [0.08601, 0.10694] |
| Public raw inverse / 3-point linear | 1.68473 [1.60850, 1.91563] | 1.62024 [1.59873, 1.64484] |
| Normalization / 3-point linear | 1.54340 [1.44456, 1.54891] | 1.56329 [1.51060, 1.59521] |
| Owned inverse / 16-point step | 0.15377 [0.15309, 0.17206] | 0.06421 [0.06074, 0.06499] |
| Public owned inverse / 16-point step | 0.20183 [0.19491, 0.21390] | 0.10810 [0.10118, 0.10883] |
| Raw inverse / 16-point step | 0.15372 [0.14317, 0.16545] | 0.15497 [0.15097, 0.15809] |
| Public raw inverse / 16-point step | 5.84473 [5.58057, 6.02702] | 5.75130 [5.69857, 5.87581] |
| Normalization / 16-point step | 5.70117 [5.64648, 5.84066] | 5.90462 [5.78011, 6.41309] |
| Owned inverse / 16-point linear | 0.30770 [0.30602, 0.33085] | 0.07043 [0.06190, 0.08322] |
| Public owned inverse / 16-point linear | 0.37135 [0.34798, 0.38473] | 0.12317 [0.11235, 0.13966] |
| Raw inverse / 16-point linear | 0.31297 [0.30379, 0.33263] | 0.31221 [0.30203, 0.33450] |
| Public raw inverse / 16-point linear | 7.30534 [7.20947, 7.53044] | 7.28304 [7.17546, 7.63249] |
| Normalization / 16-point linear | 7.41276 [7.33838, 7.45394] | 7.58252 [7.20557, 8.25635] |
| Owned inverse / 1024-point step | 8.84684 [8.57812, 9.37646] | 0.68229 [0.66325, 1.13672] |
| Public owned inverse / 1024-point step | 9.01709 [8.87825, 9.49723] | 0.77653 [0.76465, 0.80404] |
| Raw inverse / 1024-point step | 8.98014 [8.60303, 9.44987] | 9.21240 [8.85823, 9.36588] |
| Public raw inverse / 1024-point step | 353.08337 [325.43750, 354.77344] | 326.09112 [322.64325, 339.63281] |
| Normalization / 1024-point step | 326.53650 [317.36719, 336.27869] | 345.92969 [337.94788, 370.27862] |
| Owned inverse / 1024-point linear | 20.72217 [20.37516, 21.76400] | 0.70215 [0.68359, 0.70215] |
| Public owned inverse / 1024-point linear | 21.70459 [21.21680, 22.58740] | 0.79427 [0.78450, 0.88753] |
| Raw inverse / 1024-point linear | 22.84456 [21.29248, 23.18913] | 22.34407 [21.91097, 23.41276] |
| Public raw inverse / 1024-point linear | 469.28906 [453.34894, 574.14062] | 434.29431 [427.56250, 504.01300] |
| Normalization / 1024-point linear | 463.82556 [451.64581, 586.66144] | 459.77081 [434.02869, 500.56250] |
| Owned 3-point step forward | 0.02963 [0.02940, 0.03287] | 0.02951 [0.02899, 0.03351] |
| Owned 16-point step forward | 0.03390 [0.03033, 0.03730] | 0.03694 [0.03383, 0.03856] |
| Owned 1024-point linear forward | 0.06425 [0.06037, 0.06571] | 0.06518 [0.06060, 0.07463] |
| Owned zero-beat linear forward | 0.00615 [0.00591, 0.00616] | 0.00567 [0.00567, 0.00649] |
| Legacy public 1024-point linear inverse | 15.56773 [15.42553, 16.20565] | 0.81060 [0.77457, 0.81785] |
| Default forward | 0.05178 [0.05141, 0.05389] | 0.05251 [0.05069, 0.06180] |
| Raw 16-point step forward | 0.14445 [0.13618, 0.14492] | 0.14208 [0.14002, 0.15066] |

- Separated gains include all 16/1024-point owned/public-owned inverse cases, the three-point linear owned and two-point linear public-owned cases, and the legacy inverse workload. Separated regressions include one-point direct normalized/raw queries, two-point step direct/public-owned and linear direct queries, three-point step public-owned and linear raw queries, and 1024-point step normalization. Remaining ranges overlap. The optimization trades additional bounded map storage and small-map/cold-normalization costs for repeated larger-map queries; it makes no universal, browser/Worker/worklet, startup, heap/GC, device or listening speed claim.

- Installed-package rendering/WAV, asset-CLI copy/reuse and public/DOM-free package type smokes passed (1440 frames / 5804 WAV bytes).

### Own-element construction for validated arrays

- Ordinary accessors installed on `Array.prototype` indices could intercept the `push`/hole writes that built validated copies. The copy was then frozen and, where applicable, privately registered while some of its own slots were missing, so later reads fell through to the inherited getter. Observed on the previous product in Node 26.7.0 and in Chrome (page and a real module Worker): `prepareVoice` returned a registered prepared voice whose four operators were absent and read through the accessor; control tuples, bank-voice operators and prepared-score events behaved the same; the validated-table reuse path of `normalizeTuning` sliced a sparse table into a new frozen, branded table holding foreign objects; and an input Proxy could make `normalizeTempoMap` skip validating its first point, accept a duplicate beat and retain a mutable foreign object (cached and uncached conversions then disagreed).
- Fixed-size tuples and operator lists now start from own placeholder slots. Variable-size validated copies (dense input arrays, prepared-score events, bank arrays, lookahead batches, tuning tables) write through a null prototype and restore `Array.prototype` before returning, so no accessor is read or invoked. Tempo replacement, bank export and arrangement score/layer projection use native own-element creation. The tuning default table is built from a null-prototype array-like.
- A lookahead schedule callback's returned array now has its length read once; the capacity checks and the copy loop use that single value, so a Proxy can no longer pass a small checked length and then drive a larger copy.
- Public APIs, voice format, protocol, byte/event/slot budgets and dependencies are unchanged. With clean prototypes every output is byte-identical to the previous product.
- Eight consumer regressions were added (inherited accessors for tempo/tuning/voice/bank/controls/sequence/arrangement copies, plus two lookahead cases); 517 behavioral tests pass. Restoring each of the twelve fixes individually in a temporary compiled copy made its regression fail, while the unmutated baseline passed.
- The pre-fix BEFORE graphs were reconstructed by reverse-applying only these source edits to the previous product and rebuilding: transport/synth/normalize and `dist/api/index` hashes equal the previous round's published AFTER hashes, but this is a rebuilt tree, not literal pre-edit files. Actual Node 26.7.0 / V8 14.6.202.34-node.28 BEFORE, frozen replay and live AFTER matched all seven unchanged clean suites in compiled and distribution form (3,486 records / 77,230,008 bytes). The new inherited-accessor probes (29 + 6 records) matched across Node compiled/dist, Chrome page and a real module Worker: BEFORE showed sparse own slots, getter reads and a validation bypass; AFTER shows all slots own, no accessor invoked, the duplicate-beat input rejected, and the four `Object.prototype` optional-key records unchanged. Chrome 156.0.8078.74 retained the original 16,425,434-byte canonical output and all 98 context/lifecycle records; all 228 Workers, two probe Workers, 3,825 acknowledgement channels and browser/server/socket resources closed, with Transport retaining 51 callbacks, zero errors and zero final active/pending notes.
- Actual-product timings import the reconstructed previous and rebuilt compiled graphs directly: 108 fresh Node processes, three rotated per workload/implementation, seven timed blocks each, complete proof bytes equal. Entries are microseconds per call, median of per-process block medians [range]; operation allocations remain timed and no GC or heap claim is made.

| Actual workload | Previous product BEFORE µs | Final AFTER µs |
| --- | ---: | ---: |
| Raw tempo-map normalization / 3 points | 1.342 [1.206, 2.099] | 1.353 [1.339, 3.246] |
| Raw tempo-map normalization / 16 points | 6.235 [6.128, 8.704] | 6.040 [6.022, 10.130] |
| Raw tempo-map normalization / 1024 points | 362.104 [334.083, 489.375] | 364.083 [356.854, 494.188] |
| Plain voice preparation | 4.270 [4.243, 7.657] | 4.221 [3.903, 5.074] |
| Expressive voice preparation | 6.039 [5.789, 8.913] | 5.708 [5.705, 8.080] |
| Level tuple validation | 0.576 [0.557, 0.716] | 0.555 [0.551, 0.808] |
| All four control tuples | 2.475 [2.463, 2.969] | 2.431 [2.380, 2.881] |
| Short sequence preparation / 8 notes | 6.253 [6.124, 6.738] | 6.244 [6.119, 6.426] |
| Short sequence preparation / 64 notes | 45.726 [39.661, 52.535] | 39.174 [39.160, 54.027] |
| Long sequence preparation / 4096 notes | 2005.708 [1999.396, 2241.448] | 2078.073 [2009.041, 2487.010] |
| Voice-bank parsing / 1 voices | 6.613 [6.613, 7.688] | 6.553 [6.383, 6.664] |
| Voice-bank parsing / 128 voices | 521.177 [513.990, 552.479] | 541.292 [503.531, 594.094] |
| Bank replace + export / 1 voices | 15.479 [15.122, 18.298] | 16.799 [15.469, 22.356] |
| Bank replace + export / 128 voices | 1447.719 [1409.104, 1526.062] | 1419.146 [1418.479, 1587.333] |
| Raw tuning offsets (128) | 7.346 [7.099, 7.863] | 7.592 [7.520, 8.199] |
| Validated tuning-table reuse | 2.584 [2.435, 2.659] | 2.504 [2.359, 2.671] |
| Arrangement definition / 1 layers | 29.023 [27.171, 29.122] | 29.952 [28.445, 30.034] |
| Arrangement definition / 16 layers | 383.357 [371.805, 678.187] | 354.669 [342.768, 512.376] |

- Every range in the final run overlapped. An earlier 84-process run, before the tuning and arrangement repairs, observed a 3-point raw tempo normalization increase of about 0.11 µs (1.226 → 1.339), alongside two small improvements; the final run did not reproduce those separations. These samples establish neither a bound nor a general speedup. Isolated array-construction measurements favored the prototype-switch builder over the measured alternatives on this host; they are not whole-application or browser/Worker/worklet measurements. No startup, heap/GC, device or listening benefit or cost is claimed.
- Still-open classes from this round were optional-key writes on ordinary objects and terminal-index reads on uncached tempo maps. The former is repaired in the next section; the latter remains open.
- Applied-source scoped A/C review (IdleSecurity, two passes) found three additional trust-anchor groups in its first pass — tuning tables, arrangement score collection and lookahead length — all repaired. Its second pass also raised Performance/MIDI ownership redirection, arrangement reserved-gain bypass and asset-inventory path-authority candidates. Those candidates were not runtime-verified in this round and remain unresolved; the earlier characterization of all remaining writes as harmless internal accumulators was incorrect. Build, 517 behavioral tests, strict/public/DOM-free typechecking and static security gates passed. Not release, device or human-listening acceptance.

### Own data for optional fields, descriptor literals, class state and event literals

- An accessor installed on `Object.prototype` under the name of an optional field intercepts a conditional assignment onto an object that lacks it, so the approved value is silently dropped. Observed on the previous product in Node 26.7.0 and in Chrome 156.0.8078.74 (page and a real module Worker; 61 probe records, 44 changed, 85 setter hits): prepared and bank voices lost `name`, `pan`, `pitchEnvelope`, `adsr.sr`, `velocitySensitivity`, `frequency`, `rateKeyScale`, `waveform`, `noiseRate`, `keyScale` and the LFO `delay`/`sync`/`phase`/targets while still being frozen and, for prepared voices, privately registered; `validateNoteControls` lost scalar controls or rejected a valid `glide`; the same loss reached `replaceTempoFrom` (`endBpm`, so a ramp changed), effects options, `Synth` options, MIDI expressive export (controls silently absent from the file), DX7 import (fixed Hz and pitch envelope), OPM text import (sustain rate and noise), named patches (`name`), prepared envelopes (`sr`), Performance retargeting (`pitch`, `glide`), Transport seek reconstruction, arrangement gain changes (`at`, `forcedFrom`), worklet event messages and render-worker diagnostics (`phases`).
- The same hook on a class-state name (`mixGain`, `maxVoices`, `events`, …) swallowed the constructor write of `Synth`, `OPM` and the worklet processor, because their state was `declare`d and assigned; a minimal class of the same shape read the hook's value (1e6) instead of the assigned 0.5, and the `Synth`, `OPM` and processor regressions fail on the previous product. They are now real class fields, so every slot is defined on the instance at construction. Own `undefined` slots now exist (for example `OPM._contextListener`) and key creation order follows declaration order; no observable value changed.
- `Object.defineProperty` is not a safe alternative on its own: it converts a descriptor object and so reads `get`, `set`, `configurable`, `writable`, `enumerable` and `value` from `Object.prototype`. An intermediate candidate was reproduced to store `Infinity` in a frozen, privately registered control snapshot through an inherited `configurable` getter. Every remaining descriptor literal (dynamic control keys, `Synth` option copying, render-worker options, Performance baselines) is null-prototype; all other sites use object-literal spreads, which define rather than assign.
- Voice normalizers keep the original evaluation order and error precedence. An exact probe caught one regression in an intermediate version (simultaneous invalid LFO `rate` and `waveform` changed from `TypeError: rate must be finite` to `RangeError: Unsupported LFO waveform`); it is fixed and both orders are now checked.
- Public APIs, voice format, protocol, byte/event/slot budgets and dependencies are unchanged. 18 consumer regressions were added (535 behavioral tests pass, up from 517). Each fails against the actual pre-edit graphs and passes against the final source; for modules the pre-edit graph did not contain (`voices/dx7.js`, `voices/opm.js`, `worklet/processor.js`, `core/index.js`) the BEFORE file was transpiled from git HEAD after confirming that its diff against HEAD is exactly this round's hunk, and the render-worker BEFORE run uses the frozen main-thread host with the live Worker entry. This is a labelled reconstruction, not literal pre-edit files.
- Observed evidence, Node 26.7.0 (V8 14.6.202.34-node.28): seven unchanged clean suites, 1,743 records per graph, 35 complete-payload byte comparisons across BEFORE/AFTER and compiled/dist; a 144-record descriptor, key-order and error-order probe, byte-identical across four graphs; an extended slice of 1,023 records, 201,801 own-property descriptors and 6,855,104 PCM bytes plus 2,084 MIDI bytes; and 1,208 records for OPM/DX7 imports, prepared envelopes, bank export and engine options with 1,376,256 PCM bytes. All differences were the intended own-slot and key-order changes of `Synth`/`OPM` instances. A real Chromium 156 AudioWorklet smoke (errors 0, rejected notes 0, both note lifecycles complete) and the cross-realm hook probe also passed after the last source change.
- Costs, Node 26.7.0, three rotated processes per workload with seven timed blocks each (µs per call, middle process): plain voice preparation 4.98 → 5.04, expressive voice preparation 7.36 → 7.50, level-tuple validation 0.716 → 0.800, all four control tuples 3.161 → 3.442, 128-voice-bank parsing unchanged (8.154 → 8.007). Validation of controls therefore costs about 0.08–0.28 µs more per call (one `defineProperty` per dynamic key); voice work is within noise. An isolated construction microbenchmark of seven optional fields measured 118 ns for conditional spreads, 989 ns for a shared mutable descriptor, 1,280 ns for descriptor literals and 51 ns for the vulnerable assignments. `Synth` construction (19.6–20.0 µs) and an eight-voice one-second render (30.8–34.4 ms before, 31.1–33.5 ms after; an identical-code control run spans 30.8–32.2 ms) show no separable change. No browser, startup, heap/GC, device or listening benefit or cost is claimed.
- Not fixed in this section: reads of an omitted optional field on frozen snapshots (voice, operator, LFO, controls, MIDI `values`, effects and engine-option objects) fell through to `Object.prototype`, so an inherited value could reach `noteOn`, `updateNote`, MIDI export or the effects tail estimate without passing validation. The next section repairs those sites. The Performance part-update ownership, MIDI-adapter ownership, arrangement reserved-`gain` and asset-inventory candidates remain unresolved, and none of these was reproduced at runtime in this round. Not release, device or human-listening acceptance.

### Own-property reads of omitted optional fields

- A getter installed on `Object.prototype` under the name of an optional field answers reads of that field on any object that omits it. On the previous product (Node 26.7.0, 10 probe hooks against a held note) inherited `keyScale`, `velocitySensitivity` and `pan` silenced the note (peak 0) and inherited `gain`/`expression` raised the peak to 0.7 against 0.36 for the clean pan-only control; `frequency`, `rateKeyScale`, `waveform`, `pitch` and `modulation` also changed the sound. Performance part controls then threw `controls.pitch must be finite and in -48..48` for an inherited pitch of 36, MIDI export wrote 75 bytes instead of 71 for an inherited `pitch`, and `OPM.loadVoice` froze the foreign object returned for an inherited `keyScale` or `pitchEnvelope`.
- Optional fields are now read only when they are own properties (`Object.hasOwn`, a static method no `Object.prototype` hook can intercept) at note admission (operator `frequency`/`keyScale`/`velocitySensitivity`/`waveform`/`noiseRate`/`rateKeyScale`/`adsr.sr`, voice `pan`/`pitchEnvelope`, LFO `delay`/`phase`/`sync`/targets), in `updateNote` (every control scalar and tuple, `operatorADSR` `sr`/`rateKeyScale`), in effects sections, in Performance part baselines and key policy, and in MIDI export controls; the `Synth` options result and the MIDI control result are null-prototype objects, and `OPM.loadVoice` freezes `keyScale`/`pitchEnvelope` only when own. With clean prototypes every sound, byte and timing is unchanged; public APIs, voice format, protocol, budgets and dependencies are unchanged.
- Seven consumer regressions were added (542 behavioral tests pass, up from 535): omitted voice fields, omitted controls (all four control families), omitted `Synth` options, omitted effect sections, Performance part/key controls, MIDI export controls and loaded-voice freezing. Each hook returns an out-of-range or plausible-wrong value while the operation runs, and the assertion runs after the prototype is restored. All seven fail on the pre-change compiled graph and pass on the final source.
- Observed evidence, Node 26.7.0 / Chromium 156.0.8078.74: a real AudioWorklet smoke (errors 0, rejected notes 0, both note lifecycles complete); the previous round's cross-realm setter probe (61 records in Node compiled/dist, a Chrome page and a real module Worker) still shows 0 changed records and 0 setter hits; every one of the 10 read-probe hooks renders the same peak and RMS as its matching clean control (a peak/RMS comparison, not a byte comparison; the regressions compare the full stereo output).
- Costs, Node 26.7.0 / Apple M5, three rotated fresh processes per implementation and workload, benchmark microseconds per operation, median of the three [range], pre-change then final, proof hash equal for every row: plain note admission 24.52 [24.31, 24.91] → 25.91 [25.56, 26.57]; expressive note admission 25.37 [25.28, 25.91] → 26.75 [26.33, 26.80]; small control update 0.304 [0.304, 0.320] → 0.591 [0.586, 0.604]; full control update 2.962 [2.931, 2.968] → 3.875 [3.842, 3.929]. Note admission therefore costs about 1.0–1.4 µs (5–6%) more and a control update about 0.3–0.9 µs more per call; none of this runs inside the per-sample loop. `Synth` construction (19.4 → 19.8 µs) and an eight-voice one-second render (31.05 → 31.21 ms) overlapped. These are Node wall-clock samples, not browser, Worker/worklet, startup, heap/GC, device or listening measurements.
- Applied-source scoped A/C review (OmittedReadReview70, read-only) found no supported-input defect in the changed sites and reported four further sites of the same class — MIDI import controls/held literals, the arrangement-definition default voice, omitted-field reads on `event.controls` snapshots in sequence, arrangement-definition and Transport, and omitted arrangement `Command`/`Gate` fields. They are repaired in the next section. Build, 542 behavioral tests, strict/public/DOM-free typechecking, the installed-package smoke (1440 frames / 5804 WAV bytes) and static security gates passed. Not release, device or human-listening acceptance.

### Own slots and own reads for events, commands, gates and mappings

- Reproduced on the previous source (Node 26.7.0, a reverse-edit copy of the compiled graph, hooks installed only while the operation ran): an inherited `operatorADSR` getter with ten-second releases changed the planned length of a two-event score from 10,560 to 168,160 frames at 16 kHz; an inherited `gain` getter made `prepareArrangementDefinition` reject a valid layer; an inherited `modulation` accessor swallowed the poly-pressure write of MIDI import; an inherited `operator` accessor made `createMidiAdapter` reject a valid scalar controller mapping (`RangeError: controls.pan must be finite and in -1..1`); the names `id`, `at`, `offAt`, `cutAt` and `cutBeat` changed Arrangement crossfade and retarget calls, stops, updates and PCM or counted swallowed gate writes; and 14 of 18 control or bookkeeping names changed the audio restored by a Transport seek (an inherited `id` swallowed `gate.id = id`, so later controls and stops of that gate were skipped).
- An internal own-property read helper (`ownControl`, exported from `core/synth.ts`, not from the package entry points) now serves the sequence release-tail bound, the reserved layer `gain` check and Transport reconstruction; the arrangement-definition note voice default is read only when own; Transport and Arrangement gates, Arrangement commands and MIDI-import held notes start with own `undefined` slots for fields assigned or read later; the MIDI-import modulation branch uses a local flag instead of reading a literal; and controller mappings keep an own `operator` slot. With clean prototypes every sound, byte, event and trace is unchanged; public APIs, voice format, protocol, budgets and dependencies are unchanged.
- Six consumer regressions were added (548 behavioral tests pass, up from 542): sequence release bound, arrangement definitions, MIDI import, Transport seek and gate bookkeeping, Arrangement gate and command bookkeeping, and MIDI adapter mappings. Each fails against the reverse-edit pre-change graph and passes on the final source; the Transport and Arrangement regressions collect every failing hook at once. The `id` hook's setter count is not judged there because Node's own timer lists assign `id` on internal objects; the resulting audio and traces are still compared.
- Observed evidence: a real Chrome 156.0.8078.74 AudioWorklet smoke through the installed Chrome channel passed (errors 0, rejected notes 0). The repository `browser-smoke` script uses Playwright's bundled Chromium 141, which aborts at `dlopen` on this host before launching, so that script was not run.
- Costs, Node 26.7.0 / Apple M5, five rotated fresh processes per implementation, microseconds per call, median [range], pre-change then final: planning a 4096-event score with 256 `operatorADSR` controls 417.67 [413.84, 427.38] → 433.66 [425.51, 454.30], and 490.22 [482.84, 532.22] → 499.56 [481.79, 512.70] in a repeat under a slower host state; the ranges overlap in both, so at most a few percent is claimed and no speedup. A first MIDI-import variant that called `Object.hasOwn` per held note measured 138.58 [135.71, 146.85] → 151.47 [147.19, 156.00] (+9%, separated) and was replaced by the local flag; the final variant measured 161.44 [149.80, 165.55] → 158.83 [151.31, 172.81] (overlap). Arrangement, Transport and MIDI-adapter objects were not separately timed: each gains a few own slots and none is in the audio render path. These are Node wall-clock samples, not browser, Worker/worklet, startup, heap/GC, device or listening measurements.
- Applied-source scoped A/C review (OwnSlotReview71, read-only) found no supported-input defect in the changed sites. It reported one further reachable site of the same class — the controller mapping's inherited `operator` — which was reproduced and repaired above, a latent `GainChange.activation` read in Arrangement for which it found no reachable path (unchanged), tempo-point `curve`/`endBpm` reads already guarded by `stableTempoContext`, and a policy note that internal bookkeeping arrays use `push`. Build, 548 behavioral tests, strict/public/DOM-free typechecking, the installed-package smoke (1440 frames / 5804 WAV bytes) and static security gates passed. Not release, device or human-listening acceptance.

### Prepared sequence voices

- Short/long sequence preparation and offline render planning reuse the existing private identity gate for deeply immutable prepared patches instead of validating and cloning them for every note. Named registries use the same path. Raw patches still detach freshly, and frozen copies/proxies do not inherit trust.
- Public `prepareVoice()` keeps its existing fresh-snapshot behavior. Event/note/slot/time budgets and per-note DSP/control state are unchanged; no cache, dependency, API signature or voice-format change was added.
- Local Node 26 / Apple M5 observations used two fresh processes per implementation, five timed samples after two warmups, and explicit GC outside timed intervals. Retained-heap deltas include score metadata. These are synchronous preparation measurements, not browser memory, worklet speed or device-latency guarantees; raw-input timings varied and no raw-input speedup is claimed.

| 8192 notes using one prepared named patch | Before | After |
| --- | ---: | ---: |
| Median preparation time across the two runs | 59.74–61.87 ms | 9.08–9.85 ms |
| Distinct patch objects in the score | 8192 | 1 |
| Observed retained-heap delta, decimal MB | 9.56–9.61 | 1.10 |

Applied-source old/new smoke matched all score values, capacity, diagnostics and full/chunk stereo PCM in 270 cases covering all nine operator shapes, five LFO shapes, three quality profiles and inline/named prepared patches. Raw mutation ownership, proxy/frozen-copy trust boundaries and 40 malformed-entrypoint rejections also passed, without invoking accessors. All 25 targeted and 471 behavioral tests plus strict/public/DOM-free type checks passed.

### Terminal sequence ownership

- Cancellation and final-chunk completion discard the private event queue even when a caller retains the iterator or final chunk. Iterator return, a `for…of` break and an observed AbortSignal retain their existing cancellation path. PCM, capacity, frame/event diagnostics and slot-local state are unchanged; normal completion invokes no new public cancellation hook.
- Native Node 26 WeakRef/explicit-GC smoke reproduced queue-only future-patch retention before the change and collection afterward in seven terminal modes, including cancellation before/after first advancement and retaining the final chunk without a further `next()`. The target patch was never admitted to a synth slot; dropping the renderer provided a separate collection control. Native message events crossed WeakRef keep-alive jobs without timed sleeps.
- This removes bounded avoidable retention, not an unbounded leak or a guarantee of immediate GC. Caller-held patches and pooled synth state remain independent. No nondeterministic GC test was added; existing 14 sequence and 471 behavioral tests plus strict/public/DOM-free type checks passed.

### JSON byte-check allocation

- Bank, score-project and arrangement-project text avoids a temporary UTF-8 buffer when three times its UTF-16 length already fits the byte budget. Larger candidates retain exact native UTF-8 checking, including surrogate replacement and pairs; code-unit overflow still rejects before parsing. The [UTF-8 sizing bound](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder/encodeInto#buffer_sizing) does not change either byte ceiling.
- Canonical bank export uses the existing ASCII invariant already used by project serialization: validated names/enums, fixed keys and finite numeric data have matching character/byte counts. Revalidation and null-prototype serialization still exclude caller JSON hooks. No global encoder, cache, dependency, signature or format change was added.
- Real public-operation instrumentation observed no budget-only UTF-8 buffer for small bank/score/arrangement inputs or canonical bank export, with unchanged result hashes. Exact old/new smoke covered 81 Unicode admission/error-precedence scenarios, 12 accepted padded files and version 1–8 bank exports. All UTF-16 single units and 1024 astral samples respected the sizing bound.
- The new lone-surrogate threshold and exact-project-limit regressions, all 473 behavioral tests and strict/public/DOM-free type checks passed. This is allocation avoidance during serialization/admission, not a worklet or end-to-end throughput claim.

### Tempo-map conversion

- Immutable normalized multi-point tempo maps retain cumulative segment integrals in a private identity-keyed weak cache. Repeated beat-to-second conversions use binary search plus one partial-segment integral instead of rescanning the map. Prefixes preserve the original left-to-right floating-point addition order; inverse conversion is unchanged.
- Single-point maps allocate no prefix. Caller-owned maps retain uncached behavior, so mutations cannot leave stale cached timing. No public signature or score-format changes.
- Public conversions also reuse recognized immutable multi-point snapshots instead of copying and revalidating them on every call. BPM arguments still validate before reuse; raw arrays, copies and proxies retain their normal validation. Re-normalization may return the same frozen identity.
- In one Node 26 / Apple M5 run, exact A/B comparison covered normalized/raw maps, every tempo boundary and nearby floating-point positions, extreme beat positions, and all compiled gates in a 4096-note score. These local measurements are not browser scheduling or device guarantees.

| Workload | Before | After |
| --- | ---: | ---: |
| 7171 conversions, 1024 tempo points (median of five measured runs) | 126.86 ms | 1.30 ms |
| Compile 4096 notes through 1024 tempo points (one run) | 204.53 ms | 53.57 ms |
| Public `beatsToSeconds`, 256 queries using a normalized 1024-point snapshot (median of five; follow-up run) | 158.72 ms | 0.065 ms |

### Streaming WAV allocation

- Dithered incremental encoding reuses one private RNG working buffer instead of allocating a state copy for every chunk. A scalar seed commits only after successful encoding; rejected chunks still preserve frame accounting and the subsequent noise sequence. Emitted bytes remain independently owned, and full-buffer encoding, formats and public signatures are unchanged.
- Applied-source A/B smoke covered PCM16/24/float32, mono/stereo and supported dither settings over 200003 frames per case, with byte-identical files across chunk boundaries, 1200 rejected chunks and eight nested-validation cases across both implementations. The strengthened committed-prefix rejection regressions, all 467 behavioral tests and strict/public/DOM-free type checks passed.
- Native Chrome 156 exercised all three deployed formats with real module Workers at 17/4096-frame chunk sizes. Every sink transferred/detached its incoming buffer; all six 1504-frame files matched full-buffer output byte for byte, with correct byte accounting, one close, no abort and zero DSP errors. Build, AST and isolated installed-package/asset/type gates also passed.
- Local Node 26 tiny-chunk probes observed fewer collections in both measurement orders. CPU timings varied substantially, so no throughput improvement is claimed.

### Asset deployment checks

- A failed `checkDeployment()` aborts other downloads from the same run rather than leaving them active until their deadline. The original validation/network error is preserved; successful verification, resource limits and public options are unchanged.
- Filesystem-root destinations reject as overlapping the package before inventory or destination-tree inspection. Roots retain their existing path separator instead of constructing a doubled-separator prefix. The failing-before/passing-after subprocess regression fences filesystem access to its private fixture.
- Real loopback smoke confirmed peer-side cancellation without waiting for the request deadline. The socket-close regression awaits native events rather than guessed delays; all eight asset tests, 470 behavioral tests and strict/public/DOM-free type checks passed.

### Input boundaries

- Reject a malformed `process()` offset before computing the default length, without invoking `valueOf` or `Symbol.toPrimitive`. Invalid calls leave output buffers, delay history and parameter ramps unchanged. Valid processing and public signatures are unchanged.
- The shared tempo/beat-array reader rejects non-integer descriptor lengths before comparison or traversal. This closes a pre-existing JavaScript-object resource-budget bypass without executing length coercion; ordinary arrays and JSON behavior are unchanged.
- Sequence preparation rejects negative array-descriptor lengths before inspecting keys, rather than accepting a forged empty score. Shared short/long/estimate/render paths retain valid empty arrays and ordinary event budgets. Direct entrypoint smoke, audible offline rendering, 468 behavioral tests and strict/public/DOM-free type checks passed.

### Scoped security review

- IdleSecurity found no remaining supported-input A/C blocker in the idle-render fast paths, immutable tempo prefix cache/snapshot reuse, shared array-length guard and effects range-validation repair. Its initial length-coercion finding was reproduced, fixed and rechecked. Review covered callback admission, stereo/DC tails, native buffer bounds, exact clocks, prefix summation order, weak cache lifetime/bounds, BPM validation before identity reuse and rejected-call state preservation. Read-only static inspection only; not release approval or physical-device/listening acceptance.
- Observed local verification: the immutable-reuse follow-up passed build, 467 behavioral tests, strict/public/DOM-free types, AST and isolated installed-package/asset/type gates, plus native Chrome 156 AudioWorklet smoke at 48 kHz with zero DSP/processor errors, pending events or rejected notes after release. Deployed browser imports also proved snapshot reuse, raw-input detachment, forward/inverse conversion and compiled gate timing; the generated README contract was checked visually. The preceding unchanged-DSP source passed zero-vulnerability development/runtime audits, 2505 numerical sound-quality cases and 24 live-control cases. The bundled Playwright Chromium binary was unavailable; the same smoke program used only a `chrome` launch-channel override, without audio mocks or relaxed CSP/autoplay rules. Firefox/WebKit, physical-device/MIDI and human-listening acceptance were not exercised.

## v1.13.1

Package version 1.13.1, a GitHub release (not on npm), CI-verified on Node 22/24/26, Chromium, Firefox and WebKit. Voice format v8. Explicit v1–v7 voices keep their original shapes and normalize to v8; voices that use none of the new fields render bit-identically (all 21 previous presets × eco/standard/high × MIDI 36/60/84 match v1.13.0 sample for sample). No worklet protocol changes beyond accepting the new fields through the existing validators.

### Voice format v8

- **Sustain rate `adsr.sr`** (optional, 0.01–100 s): after attack and decay, a held note keeps falling 96 dB per `sr` seconds (dB-linear), clamps at the −96 dB floor and then outputs exact zero until release; the release starts from the decayed level. Omitted holds the sustain level as before. Rate key scaling applies, capped at 100 s. Live `operatorADSR` edits and `envelopeAt` accept it. This is the held-note decay of OPM-style D2R, for pianos, plucks and bells that fade while held.
  - The renderer treats it as one more geometric envelope segment, with the same 64-frame exact re-anchoring and segment-end fast path as attack, decay and release, so output stays chunk independent.
- **LFO `waveform: 'noise'`**: sample-and-hold. Each LFO cycle holds one pseudo-random level in [−1, 1) from a stateless integer hash of the cycle index, so offline, chunked and `sync: 'global'` renders are reproducible; `sync: 'note'` restarts the same sequence per note. `lfoValue(phase, 'noise')` matches it.
- **Voice `pan`** (optional, −1..1): a patch-level stereo offset added to each note's pan, clamped to −1..1 before the equal-power law. Canonical JSON places it between `modIndex` and `lfo` and omits it when absent.
- v1–v7 inputs reject all three fields. Strict parsing rejects out-of-range values; bank parsing clamps them, as for every other field. The JSON Schema is now "canonical voice v8".

### Importers

- `.opm`: nonzero D2R now maps to `adsr.sr` on the same heuristic curve as the other rates (previously dropped), and LFO waveform 3 maps to the noise LFO (previously sine). PAN is still ignored: converters commonly write a fixed default (64) instead of the register L/R bits, so the field does not reliably encode placement.
- DX7: the sample-and-hold LFO maps to the noise LFO (previously sine).

### Presets and examples

- Two original presets: `struck_keys` (held notes fade through sustain rates, modulators faster than carriers) and `stepped_lead` (7 Hz global noise-LFO AM on the modulators steps brightness). Existing presets carry `version: 8` labels with unchanged parameters.
- The sound-design page adds per-operator sustain rate, voice pan and the noise LFO; patch import/export is v8. The sequence page offers the noise LFO.
- The sequence page exposes the v1.12 output-stage settings: an `Output stage` choice (`saturation: 'tanh' | 'soft-knee'`) and a `DC blocker` checkbox (`dcBlock`), applied to live playback, offline WAV, chunked and Worker renders and recorded in its acceptance settings.

### Documentation

- README, the English and 繁體中文 usage guides now point installation and checkout at this release instead of the v1.10 archive. The Roadmap gains v1.12 and v1.13 entries.

## v1.13.0

Package version 1.13.0, a GitHub release (not on npm). No voice-format (still v7) or worklet protocol changes. The internal render-Worker start message gains a `dither` field. API addition: opt-in WAV dither (below). Rendering only changes by rounding: on a mixed 35-preset render with edits and releases, under 0.1% of Float32 output samples differ from v1.12.0, by at most 3e-8.

### WAV export dither

- `encodeWav`, `createWavEncoder` and `renderSequenceInWorker` accept `dither: true` (default false).
  - It adds deterministic TPDF dither before rounding to PCM16/PCM24: the difference of two xorshift32 uniforms, ±1 LSB triangular, with a fixed seed per encoder.
  - Quiet passages, fades and reverb tails keep sub-LSB detail as a steady noise floor instead of truncation distortion, and digital silence becomes that noise.
  - In tests, a 0.4 LSB sine encodes to silence without dither and to an unbiased 0.4 LSB average with it.
  - Full scale is clamped, never wrapped.
  - Streamed chunks continue one sequence, so they are byte-identical to full-buffer and Worker output, and a rejected chunk does not advance it.
  - It is rejected for Float32. Undithered output is unchanged.

### Faster rendering

- Operator phases, increments and phase modulation are kept in half-turns, so the new deterministic `sinPi` (sin(π·u), same degree-11 polynomial with π folded into its coefficients, |error| ≤ 1.4e-11) reduces phases with two additions and no multiply by π. `fastSin(x)` is `sinPi(x/π)`. Both `sinPi` and `fastExp2` evaluate their polynomials in Estrin form, roughly halving the dependent multiply-add chain on feedback, LFO and pitch paths.
- The sine operator kernels use module-local constants and a local copy of the polynomial: optimized code otherwise re-checks imported bindings on every operator evaluation.
- Envelope segments carry their geometric gain from frame to frame (re-anchored to the exact dB rule every 64 frames) and skip per-operator reclassification while a frame is known to stay inside the same attack, decay or release segment.
- A voice whose operator gains are all zero for a frame (for example a sustain-zero one-shot that was never released) only advances its phases, noise clocks and feedback history instead of evaluating oscillators; its output is still exactly zero and a later ADSR edit resumes bit-identically.
- Voice LFO settings and per-operator targets are snapshotted at note-on into fixed numeric fields, so mixed banks with differently shaped `lfo` objects no longer make per-frame reads polymorphic.
- The decimator takes one output frame of oversampled inputs per call; the generic waveform path skips operators with zero static level (their phase still advances and is still checked). Each note caches its all-sine frame function and pitch envelope, and the per-frame PM step and AM folding are unrolled.
- Voices that combine sine with other periodic waveforms, but no noise, now take per-algorithm frames when their operator levels are static, like all-sine voices. Each operator has its own waveform call site, so the JIT inlines only the shapes a voice uses. All-sine voices keep their own frames. Measured against the previous step: 1.2–1.5× for 8 voices with two non-sine operators, across all seven shapes. Output is bit-identical to the generic path; a test now checks this for all eight algorithms, using a silent noise operator to force the generic loop. The old identity test compared the fast path against itself.
- Held and centered voices now render without per-frame heap allocation. V8 boxes a double that crosses a call it did not inline, and a merge with such a result boxes every sample that flows through it, even while that branch never runs. Before this change, eight held voices at 48 kHz produced about 7.5 MB/s of short-lived numbers, a 16-voice bank cycling through every preset about 17 MB/s, and eight voices with a square operator about 92 MB/s. All of these meant frequent young-generation GCs on the audio thread.
  - The decimator stores each output in its state, and `render` reads it from there.
  - `renderVoice` returns a status flag.
  - The DC blocker, steal fades and pitch-envelope frames no longer pass or merge per-frame doubles across calls.
  - The generic waveform path scales sine and non-sine oscillators in separate branches, and the waveform dispatcher types every case as a number. Non-sine waveform voices measured up to about 10% faster.
  - Exact envelope evaluation (64-frame re-anchoring, segment entry and boundary substeps) goes through `storeGain`, which takes no doubles and returns none. 32 voices retriggering every block previously allocated about 3.4 MB/s there.
  - Waveform voices can still allocate when the JIT's inlining budget leaves a shape or the LFO's `fastExp2` out of line: eight voices with one square operator and vibrato measured about 48 MB/s in their frames.
  - Output is bit-identical.
- Measured on Apple M5 / Node 26 against v1.12.0 (best of seven interleaved CPU-time runs, 48 kHz, 1 s per case):
  - `standard` 1 voice 1.63×; 8 held voices 1.62×; 8 steady voices 1.69×; attack/decay 1.85×; 32 voices 1.54×.
  - `high` 8 voices 1.56×; `eco` 8 voices 1.52×.
  - Pitch envelope 1.52×; per-operator LFO targets 1.78×.
  - Square operator 2.08×, and other non-sine shapes 1.6–2.0×.
  - A 16-voice mixed all-sine bank 2.04×.
  - A 16-voice run cycling through all 35 bundled presets with releases measured about 1.6×, and retriggered noise hi-hats about 1.65×.
  - These are single-machine Node results, not browser AudioWorklet or device measurements.

## v1.12.0

Package version 1.12.0, a GitHub release (not on npm). No voice-format (still v7) or worklet message-protocol changes. API additions: optional `saturation` (`'tanh'` default, `'soft-knee'`) and `dcBlock` settings for `Synth`, `OPM` (`opm.saturation`, `opm.dcBlock`), `renderNote`, sequence/Worker rendering and score-project settings. Behavior changes: half-band FIR decimation with post-mix filtering, polyBLEP/polyBLAMP operator shapes, released notes end once their audible carriers are silent, and `lfo.delay` fades depth in over 20 ms. Measured on Apple M5 / Node 26 against v1.11.1 (best of five interleaved CPU-time runs, 48 kHz, 2 s per case): `standard` 8 held voices 1.51×, 32 voices 1.89×, `high` 8 voices 1.73×, `eco` 8 voices 1.39×, attack/decay 1.41×, pitch envelopes 2.10×, per-operator LFO targets 1.93×, square operator 1.36×, noise hi-hat 2.11×, 16-voice mixed bundled presets 1.64×; a single held voice is unchanged within noise. Security: read-only scoped static reviews of the `src/core` and option-intake changes found no evidence-backed issue (see [SECURITY.md](./SECURITY.md#4-review-record)). Physical-device, MIDI-hardware and human-listening acceptance remain unverified.

### Faster rendering and settled state

- All-sine voices with static operator levels render each output frame in a per-algorithm function with oscillator state in locals (independent operators are no longer serialized), with level, operator level and shared or per-operator LFO AM folded once per frame; per-operator `amTargets` voices now take this path too. Silent operators (zero envelope, level or AM gain) skip their oscillator while their phase advances.
- Envelope gains are not recomputed once every operator has reached a constant sustain or silent release, and operators with zero static level are silent from admission. A pitch envelope that has reached its sustain (or final) value is folded into the static increments until release, a glide or a retune.
- `fastSin` is now a degree-11 near-minimax polynomial (|error| ≤ 1.4e-11, |result| ≤ 1), also used by the sine LFO; deterministic `fastExp2` (relative error ≤ 2e-14) replaces `Math.exp`/`**` for envelope dB, LFO PM and per-frame pitch factors. Output differs from the previous checkout by about 1e-10.
- Against the post-mix FIR checkout (88e55a2) the same harness measured 1.3–1.85× (for example `standard` 8 voices 1.48×, `high` 8 voices 1.65×, 32 voices 1.66×).

### Output stage options and voice lifecycle

- Optional `saturation: 'soft-knee'` is exactly linear up to 0.5 (−6 dBFS) and compresses only toward `HEADROOM` above it, matching value, slope and curvature at the knee; the default `tanh` is unchanged and still colors every level (third harmonic near −40 dB at 0.25 peak).
- Optional `dcBlock: true` applies a 3 Hz one-pole high-pass per channel before the output stage (under 0.1 dB loss at 20 Hz), removing DC from heavy feedback; its state settles to exact zero and `panic()` clears it. Score projects store either setting only when non-default, so default project JSON is unchanged.
- Behavior change: a released voice ends once every audible carrier (nonzero level, above the envelope floor at release) finishes its release; slower modulator releases and already-silent carriers no longer hold the voice. The four-operator reference fixtures now compare waveforms until the carriers' release end, with the tail still bounded by the floor allowance.
- Behavior change: after a nonzero `lfo.delay`, AM and PM depth ramp in linearly over 20 ms instead of switching on in one sample; a zero delay is unchanged. A centered mix reuses the left output-stage result for the right channel.

### Half-band FIR decimation

- Replace the per-voice Butterworth IIR decimator (cutoff 0.30 output Fs) with cascaded polyphase linear-phase half-band FIR stages: eco 35 taps at 2×; standard 15 → 47 taps; high 11 → 15 → 47 taps. Substep calls only buffer their input; the cascade runs once per output frame.
- Passband is flat to 0.40 output Fs (ripple below 0.001 dB for standard/high; formerly −11.5 dB at 0.35 Fs). Products folding below 0.40 Fs are rejected by at least 81 dB for standard/high and 63 dB for eco (standard formerly −52.3/−55.6 dB at 0.60/0.625 Fs). Between 0.50 and 0.60 Fs the transition band folds into 0.40–0.50 Fs, and far above Nyquist the former filter's bilinear zero was deeper; see [acoustic quality](./doc/acoustic-quality.md).
- Behavior change: output is delayed by a constant linear-phase 13.25 output frames for standard (8.5 eco, 13.875 high; about 0.28 ms at 48 kHz) instead of the IIR's frequency-dependent 2.7–3.3 frames. The decimator keeps 158 state scalars instead of 8 (per output channel since post-mix decimation, below).
- Measured on this checkout's cloud container with `npm run benchmark` (median of four interleaved runs per side): standard 8 held voices 0.702 → 0.669 ms per 128-frame block, high 8 held voices 1.204 → 1.116 ms, eco unchanged within noise (0.434 → 0.435 ms).

### Band-limited square, saw and half-wave operators

Square and saw operators now add two-sample polyBLEP residuals at their jumps, and half-wave operators add polyBLAMP residuals at their corners, sized from each operator's unmodulated phase step at the oversampled rate. In unit tests the folded-alias power of periodic frames drops by about 8–17 dB at the internal rate, before the decimator. Phase modulation makes the nominal step an approximation, so these shapes remain not alias-free. All non-sine periodic shapes now use the deterministic polynomial `fastSin` instead of `Math.sin`, and the shape helpers are split so the dispatcher stays inlinable. Measured on Node 22 with 16 held voices at 48 kHz (`standard`): square 1.74 → 0.98 ms/block, half 1.89 → 1.40 ms, saw 1.04 → 1.13 ms. Sine output and `periodicWaveform(theta, code)` without a step are unchanged apart from `fastSin` replacing `Math.sin` (~1e-10). Square/saw/half voices render differently near their edges. These timings are one Node process on one machine, not a browser AudioWorklet or device measurement.

### Post-mix decimation

- Voices are now panned and summed to left/right at the oversampled rate, and one shared decimator per output channel runs after the mix, instead of one decimator per voice. A centered (dual-mono) mix filters once until the channel inputs differ. Measured against per-voice half-band FIR decimation with a 128-frame `Synth.render` loop at 48 kHz (median of three interleaved runs, one Node 22 process on one cloud x64 host): `standard` 8 voices 0.677 → 0.611 ms/block (−10%), 32 voices 2.772 → 2.477 ms (−11%); `high` 8 voices 1.115 → 0.996 ms (−11%), 32 voices 4.626 → 4.154 ms (−10%); `eco` 32 voices unchanged; a single voice costs about 0.01 ms/block more (mix-buffer overhead). Against the earlier per-voice Butterworth decimator the gains were 9–19%.
- Behavior change: note gain, expression, pan and steal fades now apply before the decimator, so a hard gain step is band-limited by it and rings through the half-band FIR (at most 26 output frames) instead of cutting instantly at the output rate. Ramps are within s·p·Σk|h[k]|/4 of the former output-rate product.
- Voices retire on their envelope end (audible carrier releases finished, above) and report `ended` without waiting for filter history; the shared decimator drains the tail; once nothing is sounding, history below the −96 dB floor snaps to exact zero.

## v1.11.1

Package version 1.11.1, a GitHub release (not on npm). Performance patch over v1.11; no API, voice-format (still v7) or protocol changes. Output differs from v1.11 by about 1e-10 for sine operators. Security: scoped static review of the `src/core` change found no evidence-backed issue.

### Faster sine operators

Sine operators now use a deterministic polynomial `fastSin` (odd degree-13 after reduction to ±π/2) instead of `Math.sin`, and all-sine voices with static operator levels and shared AM take a branch-light render path. Measured on Node 26 with `npm run benchmark`: `standard` 8 held voices 0.265 → 0.215 ms/block (−19%), 32 voices 1.132 → 0.900 ms (−20%), `high` 32 voices 1.977 → 1.515 ms (−23%). `fastSin` is bounded by 1 with |error| ≤ 2.0e-10 against the exact sine (about −194 dB, below Float32 resolution) plus about 1e-16·|phase| from range reduction, and is pure arithmetic, so results no longer depend on each JavaScript engine's `Math.sin` rounding. Rendered samples differ from v1.11 at the ~1e-10 level; non-sine operator shapes, LFOs and effects still use `Math.sin`. These timings are one Node process on one machine, not a browser AudioWorklet or device measurement.

## v1.11

Package version 1.11.0, published as a GitHub release (not on npm). Voice format v7 (per-operator waveforms and held noise; v1–v6 inputs still accepted), optional stereo effects, MIDI program maps with RPN bend sensitivity and approximate `.opm` import. Remote CI for the release content (commit `64ed642`) passed on Node 22/24/26 and Chromium/Firefox/WebKit: https://github.com/JS-PACKAGE/OPM.js/actions/runs/37117509642. An isolated `git archive` build passed `npm run security -- --package-smoke`. Physical-device, MIDI-hardware and human-listening acceptance remain unverified, and GitHub distribution is separate from npm publication. The repository now lives at `JS-PACKAGE/OPM.js`; links to historical CI runs and review issues keep their originally recorded addresses.

### Approximate OPM text import

- Add bounded dependency-free `importOPM`/`describeOPM` for decimal VOPM/MXDRV-family text patches, returning normalized v7 voices and separate deterministic metadata/loss warnings.
- Preserve all eight named operator graphs, raw key-on SLOT masking, TL attenuation, coarse detune and per-operator AM enable. Document musical envelope/DT1/key-scaling/LFO approximations, omitted second decay, ignored pan and extension-only C2 noise; no register-level emulation or fidelity claim.
- Add original recipe, finite deterministic render, topology, parameter-table, naming and hostile-input regression tests.

### MIDI voice selection and bend sensitivity

- Add opt-in bounded program-to-named-FM voice maps to file and live adapters, plus file-only drum-note maps and frozen artistic GM-family/percussion starter maps. Note-on voice selection leaves sounding gates untouched; unmapped programs retain fallback/ignore policies. File loss summaries distinguish honored program changes from omissions.
- Behavior change: preserve-mode file import and live MIDI now decode channel-local RPN 0 pitch-bend sensitivity, including cents, clamped to 48 semitones. Null/NRPN selection disables data entry; live reset restores the initial range. CC100/101 are reserved; CC6/38 custom mappings still apply when RPN 0 is inactive. Export emits neither program changes nor RPN.
- Add optional `configurePart` preservation policy for future-onset patch changes without changing default clear-on-configuration behavior.

### Voice v7 waveforms and held noise

- Canonicalize legacy v1–v6 voices to v7 while preserving their original field restrictions and unchanged sine rendering.
- Add per-operator sine/half/abs/quarter/alternating/camel/square/saw and deterministic 17-bit held-noise oscillators, with 20–20000 Hz noise clocks and pooled admission resets. Noise on any operator is an OPM.js extension, not a chip-fidelity claim; discontinuous shapes are not alias-free.
- Preserve waveform/noise fields through immutable preparation, bank JSON and worklet registration; add original `noise-snare`, `noise-hihat` and `explosion` recipes with percussion metadata and designer controls.

### Optional stereo effects

- Add original pure-DSP fractional-delay chorus and damped-comb/all-pass stereo reverb, shared by offline `createStereoEffects`/tail-extending `applyEffects` and an opt-in dedicated `createEffects` AudioWorklet insert.
- Preserve existing synthesis and dry PCM; validate bounded own-data parameters, smooth complete configuration replacements, normalize wet gain for headroom and sanitize malformed PCM without poisoning delay state.
- Extend the independent-buses demo with live chorus/reverb toggles and matching offline stem effects; document routing, gain law, bounded memory/tails and the separate worklet security surface.

### Release hygiene and verification

- The deployment inventory now requires `worklet/fx-processor.js`; the independent review record is in [SECURITY.md](./SECURITY.md#4-review-record) (A/B approved; C/D low and informational findings addressed: deployment inventory, steady-state effects headroom wording, v7/`.opm` input table, sine-only capacity scope).
- Repository links now point at `JS-PACKAGE/OPM.js`; historical CI-run and review-issue links keep their recorded addresses.
- Integration owner observed: strict typecheck (source, tests, demos, generated public and DOM-free core types), **438 passing behavioral tests**, the zero-dependency/dynamic-code security gate, and a real Chromium AudioWorklet smoke in which `noise-snare`, `explosion` and a `camel`-waveform voice produced non-silent output through the effects insert while the context stayed running; the sound designer, buses and audition pages loaded without console errors. Not run: Firefox/WebKit, physical devices, MIDI hardware, human listening, benchmark capacity for non-sine voices, installed-package/Vite smoke and npm publication.

## v1.10

Package version 1.10.0. Portable arrangements, expressive MIDI exchange and scoped acceptance tooling; voice format remains v6. Historical tags and archives remain immutable. GitHub distribution is separate from npm publication and site deployment.

### Portable music and expressive file exchange

- Add a separate bounded version-1 Arrangement project format for named looping layers, sections, initial section, tempo/meter, validated voices and synthesis settings. Share definition validation with live Arrangement playback; save/load reconstructs music, never DSP state or pending live commands.
- Add opt-in MIDI-file expressive controls while preserving the default note-only conversion policy. Preserve supported channel/key expression under explicit bend-range policy and expose grouped omissions, approximations and preserved wire-message counts; reject unrepresentable export semantics.
- Add host/workload-scoped benchmark capacity candidates across quality and fully occupied voice limits. Require explicit p99 reserve, zero observed misses and clean diagnostics; retain raw worst/misses and unchanged baseline CI budgets. Candidates do not certify browser/physical-device performance.
- Consolidate public project/MIDI surfaces, ID/lifecycle/ownership contracts and the distinction between saved musical definitions, running sessions, numerical safety and human acceptance. Synchronize current-release resources while keeping maintenance tools and HTML examples checkout-only.
- Reuse the mobile and audition harnesses for explicit current-version acceptance campaigns. Add bounded local physical-MIDI observation downloads to the instrument page, recording exact submitted/observed settings, text-only identifiers and separate manual judgments; desktop, active, stale-scope, abandoned and truncated runs remain unverified.

### Acceptance boundaries

- Physical iOS/Android interruption/route/long-play acceptance, real MIDI hardware/permission/hot-unplug behavior and the eighteen presets' genuine human listening findings remain blocked pending original physical/listener observations. Local UI, numerical rendering and injected MIDI checks must not promote those results or trim metadata.
- This release does not certify physical devices, human listening, npm publication or deployment. Genuine original observations are required before support or trim metadata can be promoted.

### Pre-release checkout verification

- Integration owner: build, **403 behavioral tests**, strict generated public and DOM-free core types, security AST/dependency gates, isolated installed package/asset CLI/type smoke, and development/runtime audits (zero reported vulnerabilities) passed.
- **108 stereo renders** (all eighteen bundled presets × eco/standard/high × 44100/48000 Hz, fixed note/velocity/pan/gate) remained bit-identical to the published checkout's committed distribution. This establishes those exercised defaults, not every possible score.
- Expressive SMF export/import preserved gate-internal bend/expression/pan/modulation under explicit policy, reported no losses for that representable fixture, rendered **31680 finite stereo frames** and encoded a **126764-byte WAV**; after-gate export rejected.
- Native isolated Microsoft Edge **154.0.4258.48** UI verified save → load without autoplay → explicit replay, edited gain/section persistence, arbitrary imported layer/section names, quantized switches with fades, literal HTML-looking capture metadata, desktop manual-pass remaining unverified and scope invalidation. No page errors were observed; screenshots were inspected. Automation is not hardware/listening evidence.
- A separate native Edge boundary smoke confirmed active exports stay unverified, 270 synthetic host actions retain 256 observations with 16 counted drops, 24 finished runs disable further capture, and a deliberately deferred injected permission result after Dispose cannot resurrect the adapter/audio. These synthetic checks do not exercise a physical permission prompt/controller.
- The existing browser smoke and stress bodies also passed using a throwaway launch override selecting isolated Edge (not mocked audio, no weakened gates): real stereo/pan analyser signal, suspend/resume/close ownership, 768 dense notes, bounded contention, expected late rejection and final zero active voices/pending events/DSP errors. The smoke fixture logged a forbidden resource request while its audio/lifecycle assertions passed; the separate example UI had no page errors.
- The 29-row Apple M5 / darwin arm64 / Node v26.7.0 benchmark used 48000 Hz, 128 frames, 300 excluded warmup blocks and 2000 measured blocks per row. All rows retained clean diagnostics and zero observed misses. The fully occupied held-brass matrix selected eco/32, standard/32 and high/16 as highest sampled candidates under 50% p99 reserve; high/32 was ineligible. The complete matrix and its scope are in [acoustic-quality](./doc/acoustic-quality.md#observed-checkout-measurement).
- ExpressionSecurity approved scoped static **A/B**, and ArrangementCaptureSecurity scoped **A/C/D**, with no evidence-backed findings. Reviewers ran no runtime gates. These reviews do not approve publication or certify hardware/listeners.
- The pinned Playwright Chromium launcher initially failed because its cached macOS Framework was missing; forced reinstallation downloaded but timed out during installation. Managed browser sessions also detached. Native Edge supplied the observed UI checks; these are not successful runs of the pinned Chromium binary.

### Release-candidate verification

- Package 1.10.0 passes 403 behavioral tests, the 144-asset build and strict public/DOM-free core type checks. Development, runtime and standalone Vite tooling audits report zero vulnerabilities; the runtime dependency tree is empty.
- An isolated canonical candidate passes parsed source/generated-code, installed-package, asset CLI and installed public/DOM-free Node type gates. The local archive verifier validates matching version, bounded safe paths and complete JS/map/declaration triplets; registry publication/provenance is not claimed.
- An installed consumer exports an 83-byte expressive SMF, imports it with no reported omissions/approximations, saves/reloads an inert Arrangement project, renders 10,560 finite deterministic stereo frames and writes a 42,284-byte WAV. Default note-only conversion and after-gate control rejection are also exercised.
- Numerical sound/preset quality commands pass. A separate isolated 29-row benchmark passes the unchanged p99 deadline ratio 1; host measurements do not certify physical-device continuity. The earlier concurrent report-only run is not a new capacity recommendation.
- The live-tree package gate correctly rejects unexpected numbered generated copies that reappeared during verification. They are preserved and excluded: release artifacts must be rebuilt from the exact committed canonical tree in isolation.
- Release110Inputs approved scoped static **A/B**, and Release110DspSupply scoped static **C/D**, for the immutable canonical 1.10.0 candidate without evidence-backed blockers. Both also approved the final documentation delta, including generated HTML and the Map-based score compilation recipe. Reviewers executed no runtime gates; passing remote Node/browser CI remains mandatory before tagging.


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

- Local behavioral suite: 382 passing tests. Dependency audit: zero vulnerabilities; runtime dependency tree: empty. Numerical sound-quality checks cover 2,505 matrix rows and 24 live-control cases; preset-quality output is accepted.
- Native Chromium AudioWorklet observations cover beat-0 startup, gain mute/resume without retrigger, pedal-owned MIDI cleanup, both original pieces and project round trips. The actual Arrangement UI produces signal → exact silence → signal for a solo pad layer and switches/fades sections across pause/resume. Project JSON and a valid Worker PCM16 WAV were downloaded to disk; the documented Node chunk-WAV recipe also produced a finite, correctly framed file.
- Default-gain PCM remains bit-identical in 333 baseline comparison renders. Node CPU measurements are report-only host observations, not real-time or mobile support guarantees.
- FinalImprovementInputs approved scoped static A/B; FinalImprovementDspSupply approved scoped static C/D for an isolated immutable canonical candidate after the pedal ownership, workload-recording, generated-link and DOM-free type-boundary fixes. Reviewers ran no runtime gates. Earlier numbered generated-file copies were preserved outside the checkout; release artifacts must be built from the exact clean release commit.
- The isolated candidate passes the 141-asset build, all behavioral/type checks and installed-package/runtime/asset/DOM-free-Node declaration gates. Native Chromium 150 smoke and the bounded 768-note stress gate pass with zero DSP errors; the intentional late/drop remains counted. HTML search and declaration-anchor navigation also work from `file://` at a 390-pixel viewport without page overflow.
- Native matched/dry A/B previews produce finite signal, but numerical measurement leaves every human criterion unassessed and refuses unconfirmed/empty finding exports. The actual desktop device capture validates as 0/36 PASS and remains unverified; neither observation is physical iOS/Android, physical MIDI or human-listening evidence.
- Physical-device captures and genuine human listening findings are still required before those acceptance statuses or trim recommendations can be promoted. This GitHub release does not imply deployment, npm publication or physical-device/listening certification.
- Release19Inputs approved scoped static A/B; Release19Supply approved scoped static C/D for an isolated canonical 1.9.0 candidate, with no evidence-backed security findings. Neither reviewer executed runtime gates. The GitHub release record retains the exact release commit, observed remote CI outcome and archive SHA-256; npm publication is excluded.
- Initial release candidate `43f32549a000acdae6dd5a83aa690f97e4c42575` was not tagged: its [remote CI](https://github.com/YueyuHoshizora/OPM.js/actions/runs/37089141994) failed Node 22 prepared-burst p99 (3.131281 ms versus a 2.666667 ms deadline), while Node 24/26 and all three browser jobs passed. No waiver or budget relaxation was used.
- Cache operator edges and carriers in preallocated voice-slot storage at admission, preserving topology order and avoiding repeated frozen-array indexing in oversampled rendering. Keep phase/sample finite checks; add cross-topology/profile recycling coverage. A 288-case before/after smoke is PCM bit-identical across qualities, rates, stealing, gain ramps and chunk boundaries. Local Node 22 prepared-burst p99 is 1.238708 ms with zero missed deadlines; the final remote release gate remains authoritative.

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
- Attach the previously missing [opm.js-1.8.0.tgz](https://github.com/JS-PACKAGE/OPM.js/releases/download/v1.8/opm.js-1.8.0.tgz), built in an isolated checkout of that exact tag. The 491,851-byte archive has SHA-256 `bee862d5b3ccaa7c4e8ff959583873c78a8ca8a9f56f4d8b039e490e498e2587`; build/type/security/local-artifact gates and exact installed-package rendering/asset CLI passed, and a downloaded copy matched byte-for-byte. The [review issue](https://github.com/YueyuHoshizora/OPM.js/issues/1) is closed as a review record, not npm-publication certification.
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
