# Acoustic references and decimation

The default **standard** profile uses four-times internal sampling and an original eighth-order Butterworth low-pass, implemented as four low-Q-first bilinear biquads. Its coefficients, substep clocks and default sound are unchanged. Cutoff is **0.30 times output sample rate**. Each synth prepares 20 coefficients once; each voice has eight preallocated filter state scalars. Each internal sample performs four fixed sections with no allocations. State resets on admission and all state must drain on release; an output zero crossing is not sufficient to retire a ringing IIR.

Construction accepts `quality: 'eco' | 'standard' | 'high'` in `SynthOptions`, offline render options and `OPM` options. Quality cannot change on an active synth; OPM retains it across restart. `maxVoices` is 1–8 by default-compatible policy and may be raised to 32 as an opt-in; the profile tables and the stealing-fade ceiling (eight) are unchanged.

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

`npm run sound-quality` (about four minutes on the development laptop) reports, **for each of eco, standard and high**:

- Controlled synthesized passband/THD/folded aliases. Standard keeps the original 22.05/44.1/48/96 kHz grid; eco and high run 44.1/48/96 kHz. Measured passband loss is compared with the independent equation above. In the 1.8.0 run at 48 kHz the measured and predicted losses agreed within 0.006 dB at .20 Fs and within 0.006 dB at .35 Fs for every profile (eco −7.301 vs −7.306 dB, standard −11.504 vs −11.509 dB, high −11.168 vs −11.173 dB). THD of harmonics 2–8 was 0.0208 % for all three.
- Folded ultrasonic products. Standard (−55.6 dB at .625 Fs, −112.9 dB at 1.125 Fs) and high (−52.1 / −96.3 dB) stay below the 30 dB floor. Eco's fourth-order filter at 2× gives −37.4 dB at .625 Fs, which meets the 30 dB floor by 7 dB, but the gate is the equation's prediction rather than the floor, so a regression of that filter is caught even if it stayed above 30 dB.
- Independent high-index Bessel PM and contractive delayed-feedback references with separate in-band and folded-product budgets at 44.1/48/96 kHz; the worst Bessel coefficient error was 8.0e-10 (eco), 7.1e-10 (standard) and 9.0e-10 (high).
- Explicit four-operator nested-chain, branched-leaf and two-carrier equations at 44.1/48/96 kHz. Unequal ratios, indices 1.5/4/8, upper/lower registers and independent ADSR attack/decay/held/interrupted-attack/release boundaries detect incorrect routing, modulation depths and carrier normalization. The reference derives envelopes directly in dB and filters by frequency-domain convolution, not by copying the engine loop.
- A lifecycle/headroom/deterministic-chunk matrix: 2,505 cases over algorithms 0–7 × feedback 0/7 × MIDI 24/60/96 × velocity × polyphony 1/8/16, plus opt-in 32-voice boundary rows (32, 33 and 40 simultaneous notes with `maxVoices` 32). Every case renders whole and in 127-frame chunks and must be bit-identical, finite, within headroom, audible (velocity above zero), silent after release and report exactly one terminal event per note.
- Live-control rows (24): for each profile and algorithm, glide, `operatorRatios` ramp, `feedback` ramp, `operatorADSR`, level/expression/pan ramp and fixed-Hz edits are applied at sample boundaries to a note carrying selective AM/PM LFO targets. Whole and chunked renders are bit-identical, finite, bounded and fully terminal. This proves stability, not smoothness to a listener.
- Streaming: the standard profile keeps the two 120-second deterministic replays; eco and high render 12-second replays with held LFO, interrupted glides and settled-sine residual checks.

The standalone decimator comparison (actual filter magnitude, complex phase and impulse latency versus independent transfer mathematics and the former filter) remains standard-profile only. A standalone 48 kHz module smoke for that profile observed -0.00559/-11.50867 dB at .20/.35 Fs and -55.61650/-112.87569 dB for the .625/1.125 Fs folded products; impulse energy delay was 3.31507 output frames and its maximum difference from independent Fourier inversion was below 8e-16. No listening session, perceptual preference, arbitrary-patch alias freedom, chip fidelity, or physical-device CPU/underrun result is asserted here.

`scripts/benchmark.ts` includes report-only comparisons: eight-voice/LFO for all three profiles, opt-in 16 and 32 voices, and two and four independent engines (see [audio buses](./audio-buses.md)), with the same host, block size and excluded warmup. Their timing rows never become realtime acceptance merely because a separate baseline budget is configured. Run the benchmark on the deployment device to observe median/p95/p99/worst and misses; fewer arithmetic operations do not prove a particular host deadline, perceptual preference or physical-device stability.

Observed checkout measurement: Apple M5, darwin arm64, Node.js 26.7.0, 48 kHz, 128-frame blocks (2.667 ms deadline), 300 excluded warmup blocks and 2,000 measured blocks per row. No explicit acceptance budgets were configured.

| Profile | Median ms | p95 ms | p99 ms | Worst ms | p99 / deadline | Misses |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Eco | 0.212375 | 0.231625 | 0.279708 | 0.453166 | 0.105 | 0 / 2,000 |
| Standard | 0.380333 | 0.423750 | 0.509292 | 0.607917 | 0.191 | 0 / 2,000 |
| High | 0.680709 | 0.747333 | 0.819917 | 0.981125 | 0.307 | 0 / 2,000 |

All rows reported zero DSP errors and admission rejections. These are offline host wall-clock measurements, not AudioWorklet underrun counters, allocation measurements, listening judgments or physical-device acceptance. They do not replace the different historical v1.6 host results recorded in CHANGELOG.

Envelope-transition references compare the waveform through the actual voice-ended frame, then require exact retired silence. The implementation deliberately retires finite IIR state below its state floor rather than retaining an infinite mathematical tail. A state floor is not a bound on each future output sample: the independent causal impulse/state-to-output bound accounts for the combined remaining filter states at retirement.
