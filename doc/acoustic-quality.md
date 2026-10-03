# Acoustic references and decimation

The default **standard** profile uses four-times internal sampling and an original eighth-order Butterworth low-pass, implemented as four low-Q-first bilinear biquads. Its coefficients, substep clocks and default sound are unchanged. Cutoff is **0.30 times output sample rate**. Each synth prepares 20 coefficients once; each voice has eight preallocated filter state scalars. Each internal sample performs four fixed sections with no allocations. State resets on admission and all state must drain on release; an output zero crossing is not sufficient to retire a ringing IIR.

Construction accepts `quality: 'eco' | 'standard' | 'high'` in `SynthOptions`, offline render options and `OPM` options. Quality cannot change on an active synth; OPM retains it across restart. `maxVoices` accepts 1–32, with default 8; larger budgets are opt-in; the profile tables and the stealing-fade ceiling (eight) are unchanged.

| Profile | Internal rate | Filter order / sections | Filter state per voice | Tradeoff |
| --- | ---: | ---: | ---: | --- |
| eco | 2× | 4 / 2 | 4 scalars | Fewer oscillator/filter substeps, earlier internal Nyquist and weaker upper-band rejection |
| standard (default) | 4× | 8 / 4 | 8 scalars | Existing sound and acceptance baseline |
| high | 8× | 8 / 4 | 8 scalars | Higher internal Nyquist, twice standard oscillator/filter substeps; not an arbitrary-patch alias-free guarantee |

All profiles preallocate coefficient/state/gain buffers. For internal factor \(M\) and order \(N\), the independently checkable magnitude is
\[
|H(f)| = \left(1+\left[\frac{\tan(\pi f/(M F_s))}{\tan(\pi\,0.30/M)}\right]^{2N}\right)^{-1/2}.
\]
Eco is a deliberate reduced-work option, not a universally equivalent substitute for standard. Since 1.8 the same independent mathematics gates **all three profiles**: full PM, delayed feedback, four-operator, long-stream and controlled-tone checks run per profile against this transfer function with the profile's own factor and order. The tolerance constants are shared by every profile (only factor and order change), and no standard threshold was relaxed. The one profile-specific bound is eco's folded-alias limit, which follows the equation instead of the 30 dB floor (below).

## Response and choice

For output sample rate \(F_s\), let

\[
u(f)=\frac{\tan(\pi f/(4F_s))}{\tan(\pi\,0.30/4)},\qquad
|H(f)|=(1+u(f)^{16})^{-1/2}.
\]

The independent reference evaluates the analog Butterworth poles \(p_k=e^{i\pi(2k+9)/16}\), \(k=0\ldots7\), through \(H=\prod_k(-p_k)/(iu-p_k)\). It does not import the production coefficient generator or recurrence. Fourier inversion also supplies a causal impulse reference and envelope-transition convolution.

Analytical attenuation in dB (rounded; **not observed listening results**):

| Frequency / output Fs | Former four-pole .20 Fs | Selected order-8 .30 Fs | Evaluated order-8 .32 Fs |
| --- | ---: | ---: | ---: |
| .10 | -3.84 | approximately 0 | approximately 0 |
| .20 | -11.90 | -0.006 | -0.002 |
| .25 | -16.12 | -0.209 | -0.073 |
| .35 | -23.92 | -11.51 | -7.40 |
| .50 | -33.52 | -37.90 | -33.23 |
| .625 | -39.88 | -55.62 | -50.95 |
| 1.125 | -55.93 | -112.88 | -108.21 |

The initial .32 candidate slightly weakened rejection at output Nyquist. The conservative .30 choice avoids that regression while retaining much more upper-register passband energy. An independent dense normalized-frequency evaluation from .5 to 1.99 output Fs found at least 4.38 dB stronger attenuation than the former filter; the existing measured controlled-alias gates remain at least 30 dB at .625/1.125 Fs. This is not a guarantee against arbitrary FM-generated frequencies above the internal Nyquist limit.

## Phase, tails and CPU tradeoffs

This is causal, nonlinear-phase IIR filtering, **not** a fixed-delay linear-phase filter. Group delay is \(-d\arg H/d\omega\). Analytical DC delay is 2.669 output frames; independent numerical impulse energy-centroid delay is 3.315 frames (about 69 microseconds at 48 kHz). Actual output retains the fourth internal substep, which adds a .75-frame phase advance relative to the first substep's clock. Neither value is total AudioContext/device latency.

A sharper filter can ring and overshoot; it is not the former convex cascade. Independent impulse integration gives approximately 1.667 for the absolute impulse sum and 28.301 internal samples for the absolute first moment. Full-feedback gates therefore use impulse-sum and absolute-moment bounds rather than falsely assuming unit-bounded filter output. Stereo output saturation/headroom remains separate. Four biquads require more arithmetic/state than four one-pole sections; realtime deadline acceptance must be measured on each host, not inferred from offline wall time.

## Coverage and evidence

The checkout-only maintenance command `npm run sound-quality` (about four minutes on the development laptop) reports, **for each of eco, standard and high**:

- Controlled synthesized passband/THD/folded aliases. Standard keeps the original 22.05/44.1/48/96 kHz grid; eco and high run 44.1/48/96 kHz. Measured passband loss is compared with the independent equation above. In the 1.8.0 run at 48 kHz the measured and predicted losses agreed within 0.006 dB at .20 Fs and within 0.006 dB at .35 Fs for every profile (eco −7.301 vs −7.306 dB, standard −11.504 vs −11.509 dB, high −11.168 vs −11.173 dB). THD of harmonics 2–8 was 0.0208 % for all three.
- Folded ultrasonic products. Standard (−55.6 dB at .625 Fs, −112.9 dB at 1.125 Fs) and high (−52.1 / −96.3 dB) stay below the 30 dB floor. Eco's fourth-order filter at 2× gives −37.4 dB at .625 Fs, which meets the 30 dB floor by 7 dB, but the gate is the equation's prediction rather than the floor, so a regression of that filter is caught even if it stayed above 30 dB.
- Independent high-index Bessel PM and contractive delayed-feedback references with separate in-band and folded-product budgets at 44.1/48/96 kHz; the worst Bessel coefficient error was 8.0e-10 (eco), 7.1e-10 (standard) and 9.0e-10 (high).
- Explicit four-operator nested-chain, branched-leaf and two-carrier equations at 44.1/48/96 kHz. Unequal ratios, indices 1.5/4/8, upper/lower registers and independent ADSR attack/decay/held/interrupted-attack/release boundaries detect incorrect routing, modulation depths and carrier normalization. The reference derives envelopes directly in dB and filters by frequency-domain convolution, not by copying the engine loop.
- A lifecycle/headroom/deterministic-chunk matrix: 2,505 cases over algorithms 0–7 × feedback 0/7 × MIDI 24/60/96 × velocity × polyphony 1/8/16, plus opt-in 32-voice boundary rows (32, 33 and 40 simultaneous notes with `maxVoices` 32). Every case renders whole and in 127-frame chunks and must be bit-identical, finite, within headroom, audible (velocity above zero), silent after release and report exactly one terminal event per note.
- Live-control rows (24): for each profile and algorithm, glide, `operatorRatios` ramp, `feedback` ramp, `operatorADSR`, level/expression/pan ramp and fixed-Hz edits are applied at sample boundaries to a note carrying selective AM/PM LFO targets. Whole and chunked renders are bit-identical, finite, bounded and fully terminal. This proves stability, not smoothness to a listener.
- Streaming: the standard profile keeps the two 120-second deterministic replays; eco and high render 12-second replays with held LFO, interrupted glides and settled-sine residual checks.

The standalone decimator comparison (actual filter magnitude, complex phase and impulse latency versus independent transfer mathematics and the former filter) remains standard-profile only. A standalone 48 kHz module smoke for that profile observed -0.00559/-11.50867 dB at .20/.35 Fs and -55.61650/-112.87569 dB for the .625/1.125 Fs folded products; impulse energy delay was 3.31507 output frames and its maximum difference from independent Fourier inversion was below 8e-16. No listening session, perceptual preference, arbitrary-patch alias freedom, chip fidelity, or physical-device CPU/underrun result is asserted here.

The checkout-only `scripts/benchmark.ts` retains the historical baseline gates and report-only quality/polyphony/multibus comparisons, and adds a full held-note matrix: **1, 4, 8, 16 and 32 voices for each of eco, standard and high**. The matrix sets `maxVoices` equal to the number of held notes. See [conservative host capacity candidates](#conservative-host-capacity-candidates) below and [audio buses](./audio-buses.md#what-it-costs). Timing is not realtime acceptance merely because a separate baseline budget is configured; fewer arithmetic operations do not prove perceptual preference or physical-device stability.

Historical **1.8.0** checkout measurement (not the new capacity matrix): Apple M5, darwin arm64, Node.js 26.7.0, 48 kHz, 128-frame blocks (2.667 ms deadline), 300 excluded warmup blocks and 2,000 measured blocks per row. No explicit acceptance budgets were configured.

| Profile | Median ms | p95 ms | p99 ms | Worst ms | p99 / deadline | Misses |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Eco | 0.212375 | 0.231625 | 0.279708 | 0.453166 | 0.105 | 0 / 2,000 |
| Standard | 0.380333 | 0.423750 | 0.509292 | 0.607917 | 0.191 | 0 / 2,000 |
| High | 0.680709 | 0.747333 | 0.819917 | 0.981125 | 0.307 | 0 / 2,000 |

All rows reported zero DSP errors and admission rejections. These are offline host wall-clock measurements, not AudioWorklet underrun counters, allocation measurements, listening judgments or physical-device acceptance. They do not replace the different historical v1.6 host results recorded in CHANGELOG.

Envelope-transition references compare the waveform through the actual voice-ended frame, then require exact retired silence. The implementation deliberately retires finite IIR state below its state floor rather than retaining an infinite mathematical tail. A state floor is not a bound on each future output sample: the independent causal impulse/state-to-output bound accounts for the combined remaining filter states at retirement.

## Conservative host capacity candidates

This matrix/candidate output is **Unreleased checkout** functionality; the package version remains 1.9.0. The immutable published v1.9 archive does not contain it. From the current local development checkout, run:

```sh
OPM_BENCH_CAPACITY_P99_RATIO=0.5 npm run benchmark
```

The capacity ratio defaults to **0.5** and may only be made stricter, in `(0, 0.5]`. This means retaining at least half of the nominal block deadline as **observed p99 reserve**, not reserving a guaranteed amount of real audio-thread time. A row is eligible only when:

- Its observed p99/deadline ratio is at or below that threshold.
- It has **zero measured deadline misses**.
- Accumulated DSP/processor errors and admission rejections are zero, voice/event limits hold, held-note occupancy matches the authored workload, and the final PCM block of every engine is finite.
- It is not the idle baseline.

JSON `results` preserve every measured row, including ineligible rows, raw worst time, miss count, `diagnosticIssues` and `capacity.reasons`. `capacityGuidance.candidates` refer to eligible `caseId`s and repeat each row's exact `workload`, p99 reserve, worst time and misses. No candidate is chosen across unrelated workloads, no quality setting changes automatically, and an empty candidate list is a valid result.

Each row records `quality`, per-engine `maxVoices`, `engineCount`, `voicesPerEngine`, patch ID, workload kind and whether it exercised core rendering or the real processor in a **Node host shell**. The report records `VERSION`, Node version, CPU/platform/architecture, rate, 128-frame block/deadline, excluded warmup, measured iterations, exact authored patches and note/dispatch recipes. A historical one-held-note row with `maxVoices: 8` is evidence for **one active note**, not eight-note capacity. Matrix rows are fully occupied; burst rows include note creation, queue splitting and bounded stealing fades. Several-engine rows include sequential independent DSP renders, **not** browser routing/effects overhead.

The original six baseline scenarios remain the only timing-gated rows when `OPM_BENCH_P99_BUDGET_RATIO` or `OPM_BENCH_WORST_BUDGET_RATIO` is set. Existing report-only comparisons and the new matrix remain report-only for these gates; diagnostic failures still cause a failing exit status. Capacity eligibility is independent: passing a configured CI budget does not make a row eligible, and an ineligible timing row alone does not fail an unbudgeted benchmark. Existing `OPM_BENCH_SAMPLE_RATE`, `OPM_BENCH_BLOCKS` and `OPM_BENCH_WARMUP` settings control the experiment (defaults 48000, 2000 and 300).

Keep the full report with the matching checkout/commit and record surrounding host load. Repeat under representative contention and sustained thermal load; row order, JIT, scheduler/GC pauses and a finite sample count affect the measurements. Worst time and misses must remain visible even when p99 looks good. The finite check samples the final block, not every output sample in the experiment; functional DSP tests provide separate coverage.

Treat eligible rows as **candidate host configurations requiring browser and physical-device verification**, not portable voice limits, AudioWorklet underrun counters, mobile safety, or realtime certification. Re-run the application's exact voices, releases, automation, raw/prepared dispatch rate, number of engines and effects graph in its target browser. Then complete physical-device/manual acceptance for interruptions, sustained playback, audible glitches and actual MIDI hardware where relevant. Node timing cannot substitute for a real device or a human listener, and neither candidate eligibility nor CPU measurements establish a perceptual preference between quality profiles.

### Observed checkout measurement

On Apple M5 / darwin arm64, Node v26.7.0, the Unreleased package-1.9.0 checkout was measured at 48000 Hz, 128 frames (**2.667 ms** deadline), 300 warmup blocks excluded and 2000 measured blocks per row. No build, test suite or browser scenario ran concurrently; surrounding OS load was not controlled. This is one observation, not thermal/host-contention acceptance. All 29 rows retained clean diagnostics and zero observed misses. Matrix results:

| Quality | Held voices / configured limit | p99 ms | Worst ms | Observed p99 reserve | Candidate |
| --- | ---: | ---: | ---: | ---: | --- |
| eco | 1 / 1 | 0.026 | 0.120 | 99.0% | yes |
| eco | 4 / 4 | 0.090 | 0.173 | 96.6% | yes |
| eco | 8 / 8 | 0.176 | 0.269 | 93.4% | yes |
| eco | 16 / 16 | 0.418 | 0.850 | 84.3% | yes |
| eco | 32 / 32 | 0.717 | 0.810 | 73.1% | yes |
| standard | 1 / 1 | 0.042 | 0.063 | 98.4% | yes |
| standard | 4 / 4 | 0.155 | 0.230 | 94.2% | yes |
| standard | 8 / 8 | 0.329 | 0.377 | 87.7% | yes |
| standard | 16 / 16 | 0.593 | 0.649 | 77.8% | yes |
| standard | 32 / 32 | 1.196 | 1.753 | 55.1% | yes |
| high | 1 / 1 | 0.073 | 0.104 | 97.3% | yes |
| high | 4 / 4 | 0.258 | 0.324 | 90.3% | yes |
| high | 8 / 8 | 0.503 | 0.609 | 81.1% | yes |
| high | 16 / 16 | 1.044 | 1.253 | 60.9% | yes |
| high | 32 / 32 | 2.126 | 2.477 | 20.3% | no |

For this exact held-brass workload, the highest sampled eligible configurations were **eco/32**, **standard/32** and **high/16**; high/32 failed the 50% p99-reserve criterion despite zero observed misses. Start with the unchanged standard/eight default unless the application needs more voices; test the selected configuration under its actual graph/load rather than deploying the maximum sampled candidate blindly. Raw and prepared burst p99/worst were **0.683/2.162 ms** and **0.625/0.676 ms** respectively, both with zero misses; these are separate processor workloads, not proof that any 32-voice dispatch workload has the held-note result.
