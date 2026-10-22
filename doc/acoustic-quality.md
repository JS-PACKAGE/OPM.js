# Acoustic references and decimation

Every profile renders operators at an internal multiple of the output rate and decimates with a cascade of original **linear-phase half-band FIR** filters. Each 2:1 stage has a centre tap of 1/2 and every other tap zero, so it costs one multiply per unique coefficient pair, and it is evaluated in polyphase form: oversampled inputs are only buffered, and the whole cascade runs once per output frame on the last internal substep. The default **standard** profile uses four-times internal sampling: a 15-tap stage at 4× followed by a 47-tap stage at 2×. Passband is flat to **0.40 times output sample rate**; products that would fold below that edge (from 0.60 Fs upward) are rejected by at least 81 dB. Voices are panned and summed to left/right at the internal rate, and one shared decimator per output channel runs after the mix, so filter work no longer scales with polyphony. Each channel has 158 preallocated state scalars (counter/ring positions, the frame's substep inputs and doubled delay rings); there are no allocations. A centered (dual-mono) mix filters once until the channel inputs first differ. Because note gain, expression, pan and steal fades apply before the decimator, a hard gain step is band-limited by it and rings for the FIR's length (at most 26 output frames, standard/high) plus its linear-phase delay instead of cutting at the output rate.

Before this change (v1.11.1 and earlier) the decimator was an eighth-order bilinear Butterworth IIR with cutoff 0.30 output Fs (fourth order for eco). Its tables are kept below for comparison.

Construction accepts `quality: 'eco' | 'standard' | 'high'` in `SynthOptions`, offline render options and `OPM` options. Quality cannot change on an active synth; OPM retains it across restart. `maxVoices` accepts 1–32, with default 8; larger budgets are opt-in; the profile tables and the stealing-fade ceiling (eight) are unchanged.

| Profile | Internal rate | Half-band stages (taps) | Design rejection | Group delay | Tradeoff |
| --- | ---: | --- | ---: | ---: | --- |
| eco | 2× | 35 | 63 dB | 8.5 frames | Fewer oscillator substeps, earlier internal Nyquist and weaker rejection |
| standard (default) | 4× | 15 → 47 | 81 dB | 13.25 frames | Acceptance baseline |
| high | 8× | 11 → 15 → 47 | 81 dB | 13.875 frames | Higher internal Nyquist, twice standard oscillator substeps; not an arbitrary-patch alias-free guarantee |

Coefficients are equiripple (Parks–McClellan) designs using the standard half-band construction: a length-\((N+1)/2\) low-pass with band \([0, 2f_p]\) is interleaved with the 1/2 centre tap. Band edges, as fractions of each stage's input rate, are 0.20/0.30 for the final 2:1 stage (and eco), 0.10/0.40 for the 4×→2× stage and 0.05/0.45 for the 8×→4× stage. Passband ripple is below 0.001 dB for standard and high and 0.006 dB for eco.

## Response and choice

For stage input rate \(R\) and unique taps \(g_k\), each stage's transfer is

\[
H_s(f)=e^{-i\omega(2M-1)}\Bigl(\tfrac12+2\sum_{k=1}^{M} g_k\cos\bigl((2k-1)\omega\bigr)\Bigr),\qquad \omega=2\pi f/R,
\]

and the profile's response is the product over its stages, evaluated at the internal rate so source products fold at the internal Nyquist before filtering. The test reference reads the published taps (the design contract) and evaluates this DTFT directly; it does not use the production polyphase rings. Fourier inversion supplies the impulse reference and envelope-transition convolution.

Analytical response in dB for the standard profile at 48 kHz (rounded; **not observed listening results**):

| Frequency / output Fs | Former four-pole .20 Fs | Former Butterworth order-8 .30 Fs | Half-band FIR cascade |
| --- | ---: | ---: | ---: |
| .10 | -3.84 | approximately 0 | approximately 0 |
| .20 | -11.90 | -0.006 | +0.001 |
| .25 | -16.12 | -0.209 | -0.001 |
| .35 | -23.92 | -11.51 | +0.001 |
| .40 | — | -21.06 | -0.001 |
| .45 | — | -29.86 | -0.70 |
| .50 | -33.52 | -37.90 | -6.05 |
| .60 | — | -52.29 | -81.39 |
| .625 | -39.88 | -55.62 | -81.56 |
| 1.125 | -55.93 | -112.88 | -92.75 |
| 1.6 | — | -177.26 | -89.35 |

The FIR keeps the upper octave (e.g. 16.8 kHz at 48 kHz, formerly -11.5 dB) and rejects products that fold into the audible band by about 26–29 dB more than the Butterworth near output Nyquist. Two tradeoffs are deliberate: between 0.50 and 0.60 Fs the transition band lets products fold into 0.40–0.50 Fs (above the flat passband; above 19.2 kHz at 48 kHz but from 17.6 kHz at 44.1 kHz), and far above Nyquist the bilinear Butterworth's zero at the internal Nyquist gave deeper rejection than the FIR's flat 81–93 dB stopband. Neither is a guarantee against arbitrary FM-generated frequencies above the internal Nyquist limit.

## Phase, tails and CPU tradeoffs

The cascade is **linear phase**: every frequency is delayed by the same constant, 13.25 output frames for standard (about 276 microseconds at 48 kHz; 8.5 frames for eco, 13.875 for high). The former IIR had a frequency-dependent delay of about 2.7–3.3 frames. Actual output is taken on the last internal substep, which adds a .75-frame phase advance relative to the first substep's clock. Neither value is total AudioContext/device latency. A note released with zero release time therefore still sounds for the filter's delay before its finite history drains.

The impulse response is finite and symmetric; it has pre- and post-ringing at the transition band rather than the IIR's one-sided ringing. Independent impulse integration gives approximately 1.758 for the absolute impulse sum and 93.16 internal samples for the absolute first moment. Full-feedback gates use these impulse-sum and absolute-moment bounds rather than assuming unit-bounded filter output. Stereo output saturation/headroom remains separate.

Work per output frame is 20 multiplies for standard (twice 4 for the 4×→2× stage, 12 for the final stage) instead of 16 biquads (80 multiplies), 9 for eco and 32 for high. The per-substep call only stores its input, so the synth's voice loop inlines it. Realtime deadline acceptance must still be measured on each host, not inferred from operation counts.

## Coverage and evidence

The checkout-only maintenance command `npm run sound-quality` (about four minutes on the development laptop) reports, **for each of eco, standard and high**:

- Controlled synthesized passband/THD/folded aliases. Standard keeps the original 22.05/44.1/48/96 kHz grid; eco and high run 44.1/48/96 kHz. Measured passband loss is compared with the direct transfer above. In the half-band run at 48 kHz the measured and predicted losses agreed within 0.0001 dB at every checked frequency; at .35 Fs they were −0.0056 dB (eco) and +0.0009 dB (standard and high), where the former Butterworth lost 7.3–11.5 dB. THD of harmonics 2–8 was 0.0208 % for all three.
- Folded ultrasonic products. Standard (−81.6 dB at .625 Fs, −92.8 dB at 1.125 Fs), high (−81.6 / −93.1 dB) and eco (−93.3 dB at .625 Fs; its 1.125 Fs source exceeds the oscillator's 0.45 internal-rate clamp) all stay below the 30 dB floor, and each is also gated by the direct transfer's prediction so a filter regression is caught even above the floor. The former Butterworth gave −55.6 dB (standard) and −37.4 dB (eco) at .625 Fs.
- Independent high-index Bessel PM and contractive delayed-feedback references with separate in-band and folded-product budgets at 44.1/48/96 kHz; the worst Bessel coefficient error was 9.0e-10 (eco), 1.0e-9 (standard) and 1.0e-9 (high).
- Explicit four-operator nested-chain, branched-leaf and two-carrier equations at 44.1/48/96 kHz. Unequal ratios, indices 1.5/4/8, upper/lower registers and independent ADSR attack/decay/held/interrupted-attack/release boundaries detect incorrect routing, modulation depths and carrier normalization. The reference derives envelopes directly in dB and filters by frequency-domain convolution, not by copying the engine loop.
- A lifecycle/headroom/deterministic-chunk matrix: 2,505 cases over algorithms 0–7 × feedback 0/7 × MIDI 24/60/96 × velocity × polyphony 1/8/16, plus opt-in 32-voice boundary rows (32, 33 and 40 simultaneous notes with `maxVoices` 32). Every case renders whole and in 127-frame chunks and must be bit-identical, finite, within headroom, audible (velocity above zero), silent after release and report exactly one terminal event per note.
- Live-control rows (24): for each profile and algorithm, glide, `operatorRatios` ramp, `feedback` ramp, `operatorADSR`, level/expression/pan ramp and fixed-Hz edits are applied at sample boundaries to a note carrying selective AM/PM LFO targets. Whole and chunked renders are bit-identical, finite, bounded and fully terminal. This proves stability, not smoothness to a listener.
- Streaming: the standard profile keeps the two 120-second deterministic replays; eco and high render 12-second replays with held LFO, interrupted glides and settled-sine residual checks.

The standalone decimator comparison (actual filter magnitude, complex phase and impulse latency versus independent transfer mathematics and the former filter) remains standard-profile only. A standalone 48 kHz module smoke for that profile observed +0.00085/+0.00092 dB at .20/.35 Fs and -81.55868/-92.75183 dB for the .625/1.125 Fs folded products; decimated impulse energy delay was 12.5 output frames (13.25-frame group delay less the .75-frame substep advance) and its maximum difference from independent Fourier inversion was below 4e-16. No listening session, perceptual preference, arbitrary-patch alias freedom, chip fidelity, or physical-device CPU/underrun result is asserted here.

The checkout-only `scripts/benchmark.ts` retains the historical baseline gates and report-only quality/polyphony/multibus comparisons, and adds a full held-note matrix: **1, 4, 8, 16 and 32 voices for each of eco, standard and high**. The matrix sets `maxVoices` equal to the number of held notes. See [conservative host capacity candidates](#conservative-host-capacity-candidates) below and [audio buses](./audio-buses.md#what-it-costs). Timing is not realtime acceptance merely because a separate baseline budget is configured; fewer arithmetic operations do not prove perceptual preference or physical-device stability.

Historical **1.8.0** checkout measurement (not the new capacity matrix): Apple M5, darwin arm64, Node.js 26.7.0, 48 kHz, 128-frame blocks (2.667 ms deadline), 300 excluded warmup blocks and 2,000 measured blocks per row. No explicit acceptance budgets were configured.

| Profile | Median ms | p95 ms | p99 ms | Worst ms | p99 / deadline | Misses |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Eco | 0.212375 | 0.231625 | 0.279708 | 0.453166 | 0.105 | 0 / 2,000 |
| Standard | 0.380333 | 0.423750 | 0.509292 | 0.607917 | 0.191 | 0 / 2,000 |
| High | 0.680709 | 0.747333 | 0.819917 | 0.981125 | 0.307 | 0 / 2,000 |

All rows reported zero DSP errors and admission rejections. These are offline host wall-clock measurements, not AudioWorklet underrun counters, allocation measurements, listening judgments or physical-device acceptance. They do not replace the different historical v1.6 host results recorded in CHANGELOG.

Voices retire on their envelope: once every audible carrier's release has ended (modulators cannot sound through a silent carrier, and zero-level or already-silent carriers do not count), the voice is freed and its `ended` notification fires without waiting for filter history. The shared decimator keeps draining that history; envelope-transition references compare the waveform until the carriers' release end and then bound the remaining tail by the documented floor allowance. Once nothing is sounding, the implementation clears sub-floor history (only on a channel whose input is silent) rather than waiting for exact zeros. A state floor is not a bound on each future output sample: the independent bound multiplies the floor by each stage's absolute tap sum.

## Conservative host capacity candidates

**Scope note (v1.11):** the benchmark patches use sine operators only. Non-sine operator waveforms (`half`, `abs`, `quarter`, `alternating`, `camel`, `square`, `saw`) add a per-sample waveform evaluation and `noise` adds a bounded LFSR step, so patches that use them cost more per voice than the measured candidates indicate; the work stays bounded by the voice limit, but the capacity candidates below were not re-measured for those voices.

The v1.10 checkout adds this matrix/candidate output through the **checkout-only** maintenance command; it is not a packaged API or command. From the matching 1.10.0 source checkout, run:

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

On Apple M5 / darwin arm64, Node v26.7.0, the pre-release package-1.9.0 checkout was measured at 48000 Hz, 128 frames (**2.667 ms** deadline), 300 warmup blocks excluded and 2000 measured blocks per row. No build, test suite or browser scenario ran concurrently; surrounding OS load was not controlled. This is one observation, not a measurement of package 1.10.0 or thermal/host-contention acceptance. All 29 rows retained clean diagnostics and zero observed misses. Matrix results:

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
