# Physical-device audio recovery acceptance

[Example 08 (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/sequence.html) is a repeatable **manual capture runner**, not a phone certification tool. Lifecycle events and analyser peaks cannot measure audible dropouts or prove AudioWorklet CPU deadlines. Desktop Chromium automation, emulated mobile user agents and host `suspend()` are not physical iOS/Android acceptance. The demo and maintenance workflows below require a repository checkout; they are absent from installed tarballs.

## Evidence-backed support matrix

No physical-device capture is supplied with this repository. Every physical result below is **unverified**, for both interruption policies. API support and desktop smoke coverage are not hardware evidence. Only attach a result to an exact device model, OS/browser version, route, observed sample rate and tested policy; do not generalize it to an OS family.

| Scenario | Physical iOS Safari, cancel / preserve | Physical Android Chrome, cancel / preserve |
| --- | --- | --- |
| Lock / unlock | unverified / unverified | unverified / unverified |
| App switch / return | unverified / unverified | unverified / unverified |
| Call / system interruption | unverified / unverified | unverified / unverified |
| Bluetooth connect / disconnect | unverified / unverified | unverified / unverified |
| Wired / USB headset route | unverified / unverified | unverified / unverified |
| Low Power Mode / Battery Saver | unverified / unverified | unverified / unverified |
| Long play, at least 10 minutes | unverified / unverified | unverified / unverified |
| Explicit 2-second main-thread stall | unverified / unverified | unverified / unverified |
| Dispose / recreate | unverified / unverified | unverified / unverified |

## Prepare and repeat

1. Build the current example (`npm ci`, `npm run build`) and serve the repository. A physical phone needs a reachable **HTTPS** origin trusted by that device; desktop `localhost` alone does not expose the server to a phone. Do not bypass certificate errors or use `file://`. No cloud upload service is required.
2. Use the actual physical iOS Safari or Android Chrome browser, not desktop device emulation. Set comfortable speaker/headphone volume. Enter the exact model, OS version and browser version from the device settings. Do not put personal identifiers or phone numbers in notes.
3. Select **cancel**, tap **Start / resume**, then select a scenario and **Begin scenario capture**. Begin clears old sound and submits one held note plus one onset due in five audio-clock seconds. Notes remain held until interruption policy clears them or you finish/panic. Metadata, scenario and policy are captured at begin; changing a route may not change the browser's fixed context sample rate.
4. Follow the on-page scenario instructions. Record route/battery settings, interruption duration, whether the context actually stopped, and what you heard **before** tapping Start again. Add timestamped dropout/replay/stuck-gate/route markers during capture (or after returning, noting that the marker is retrospective).
5. Tap **Start / resume** on return when needed. No timer resumes the context. Check recovery and manual pass criteria below. A route change or app switch may not interrupt the context on a particular device: record that fact and leave interruption-policy acceptance **unverified**, rather than inventing a suspension.
6. Enter notes, check the manual observation declaration only if you actually performed/listened to this run, choose **pass**, **fail** or **unverified**, and **Finish capture / silence**. Finish submits panic. A short long-play run cannot earn pass: fewer than 600 seconds is forced unverified.
7. Repeat the same scenario with **preserve**: Dispose synth, change policy, Start again, then begin a new capture. Test one scenario/policy at a time. Export before reloading/navigating away or after each policy batch. At most 24 recent captures are retained; export the first device's 18 captures before starting a second device. Repeated runs are separate records, not merged claims.

## Manual pass / fail criteria

- **Cancel, when an actual context interruption was observed:** prior held notes and pending events must not return after gesture recovery. Play a fresh score after recovery to confirm new admission. Unexpected replay, duplicate/stuck gates or inability to recover a still-valid context is fail.
- **Preserve, when an actual interruption was observed:** direct held-note state can continue from the paused audio clock after gesture recovery, without duplicate gates. A still-pending direct onset can become due as that clock advances; this is not wall-clock catch-up/replay. Verify the held gate can be released and a fresh score admitted. Preserve does not promise audio while the OS suspends it, nor retention after dispose or a closed context.
- **Both policies:** classify intentional OS silence separately from a dropout while audio should be running. No unexpected audible gaps, stuck/duplicate notes, or unbounded replay; fresh sound and All notes off/Panic must work after recovery. Report fail with subjective markers and notes if these expectations fail. Absence of an audible problem is a manual judgment, not a measured underrun count.
- **Routes and battery saver:** record both route transitions and settings. Check fresh playback and silence controls after each transition. If a connector, call or power mode cannot be exercised, leave that scenario unverified. No permission prompts or OS route selectors are automated by the page.
- **Long play:** listen for at least 10 minutes; record exact duration and foreground/background conditions. Finishing early forces a claimed pass to unverified. This limited session says nothing about all-day playback, thermal throttling or other devices.
- **Main-thread stall:** explicitly press the 2-second stall button and listen. The UI should pause; audio must be judged independently. This intentional busy loop is bounded and never runs automatically.
- **Dispose / recreate:** Dispose must silence old sound; Start creates a fresh synth using the still-host-owned context without resurrecting old gates. A closed context cannot be certified as recovered by a button; record the failure and reload to start a separate run.
- **Streaming score:** interruption stops lookahead scheduling under either policy. Resuming the context must not restart the old stream; the demo's explicit stream button is the only restart. Direct-note preserve and stream restart are different contracts.

## Local evidence format and handling

**Export local observations** downloads `opm-device-observations.json`; the page does not upload, persist or record microphone/PCM audio. Exports use format `opm-local-device-acceptance`, version `1`, and contain:

- Per-run declared environment/model/OS/browser and bounded user agent, begin/end timestamps, actual begin/end context sample rates, fixed interruption policy and scenario, duration, notes and subjective markers.
- New captures also snapshot the exact package version and beginning `loadProfile`: stimulus revision, normalized lead patch, actual OPM quality/maxVoices, submitted mix gain/tuning/stealing settings and host monitoring gain. This describes the initial workload, not everything a user might play later; retain event history and explain any extra workload/actions in notes.
- Bounded engine/context/user-action observations with monotonic and wall timestamps. These are objective page observations, **not** computed pass/fail judgments.
- Separate `manualJudgment` and `acceptanceStatus`. Desktop/automation, active/incomplete, absent, and non-listened captures are always acceptance-unverified. A physical pass/fail is only a **user-declared manual result**, not independently authenticated hardware evidence.
- Coverage for all 36 combinations (two physical browser families × nine scenarios × two policies). It references the latest finished retained capture for each cell; absent cells are unverified. Use per-run metadata when interpreting the matrix, since cells do not assert every model/version is supported.
- Limits and eviction counters: 24 runs, 256 observations/run, 64 subjective markers/run, 1200 note characters. Old observations/runs are evicted with counts; marker overflow is explicitly rejected. Strings in observations are capped at 240 characters, object depth at four, and keys/array entries at 32. Recent lifecycle text is bounded and rendered through `textContent`, never HTML.

Keep exported JSON locally unless you intentionally choose to share it. Review notes and device identifiers before sharing. The runner deliberately has no JSON import or auto-trust path: opening a capture never upgrades it into a verified physical result. To review an artifact, validate its format/version, bounds and counters; check device/browser versions, sample rates, ended timestamp, declared environment/listening, judgment and notes, then correlate marker timestamps with retained events. Missing/truncated evidence should remain unverified. Preserve original files rather than editing them to fill missing results.

## Reviewing exported evidence with `npm run device-evidence`

```sh
npm run device-evidence -- opm-device-observations.json [other-device.json …]
npm run device-evidence -- --require-complete ios.json android.json
npm run --silent device-evidence -- ios.json android.json > device-review.json
```

The command (Node 22+, no network) reviews all supplied files **collectively**, independently of their exported `acceptanceStatus` and `coverage`. A declared physical capture needs a finished, consistent start/end/duration, declared listening, unchanged policy, recorded begin/end sample rates, exact model/OS/browser strings and a compatible-looking user agent. Long play needs at least 600 seconds. Wall-clock jumps or elapsed-marker contradictions remain unverified rather than earning duration credit. The result then takes the human's `manualJudgment`; user agents and form entries do not authenticate hardware.

Runs are grouped by exact environment, model, OS, browser, user agent, beginning/ending sample rates, policy, package version and canonical workload snapshot. Within each exact scope, the **latest finished timestamp**, not filename order or run ID, selects a scenario. Unfinished retries never replace finished captures. Equal-time conflicting judgments or contradictory content for the same scoped run identity stay unverified. Repeated originals add filename/run references, not coverage. The review includes original notes, markers and observations so a maintainer can investigate; every selected cell identifies its scope and source filename plus run ID and identity.

Package/workload combinations are separate campaigns. A complete campaign needs all nine scenarios in one exact scope per environment/policy: scenarios from different models, browser versions or sample rates are never stitched into one passing scope. If several scopes qualify, a complete one is selected, then the most recently finished; all scopes and failures remain in the report and selection is warned. One iOS export and one Android export, each with 18 compatible captures, can therefore satisfy all 36 cells together. Different versions/workloads cannot fill one another's gaps. The representative campaign prefers complete coverage and is explicitly identified; inspect every campaign, not only the aggregate counts.

`--require-complete` exits 1 unless at least one **recorded** package/workload campaign has all 36 declared passing cells. Legacy version-1 exports without these new optional fields still parse and retain their declared per-run results, but unknown metadata cannot establish compatibility or strict completeness. Do not edit originals to invent a version/workload: retain and review them, then recapture with the current runner. No automatic migration can reconstruct an unrecorded workload.

Inputs are bounded to 16 regular files, 2 MiB each, 24 runs/file, 256 observations and 64 markers/run, 1,200 note characters, unique IDs within a file, valid counters/timestamps, known scenarios/policies, plausible sample rates and bounded own JSON data. Malformed structure is rejected; contradictory declared timing is marked unverified with reasons. A full device needs 18 captures, so export before the 24-run eviction limit. The stdout review is a separate artifact; inputs are never rewritten or uploaded.

What this does **not** do: authenticate hardware, measure underruns, or replace reading markers, notes and truncated-event counters. Complete means “passing declared coverage under these exact recorded conditions,” never certification of iOS, Android or a phone family. The [device evidence regression tests (checkout-only)](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/test/device-evidence.test.ts) use synthetic validator inputs, not physical results. To graduate the support matrix, supply original captures from actual iOS Safari and Android Chrome devices, have a maintainer review each scenario/policy and its exact conditions, and attach the reviewed artifacts and scope to the documented result. No physical devices or captures were supplied, so the matrix above remains unverified.

## Desktop smoke workflow (not physical acceptance)

After the integration build, open example 08 on desktop localhost. Choose Desktop / automation and actual desktop metadata, then:

1. Export with no captures: all 36 coverage cells must be unverified.
2. Start, begin lock/unlock, add a dropout marker with a literal HTML-looking note (for example `<b>heard gap</b>`), export while active: acceptance remains unverified and text is not interpreted as HTML.
3. Check manual observation and select pass, finish, export: `manualJudgment` can be pass but desktop `acceptanceStatus` and physical coverage remain unverified; the held sound is silenced.
4. Start another run for main-thread stall, press the explicit stall control and finish unverified. Observe the bounded stall begin/end events. Repeat cancel/preserve only after Dispose; verify policy metadata follows the engine configuration.
5. Select long play and finish before 10 minutes: it cannot earn physical pass. Exporting never sends a fetch/XHR; only Blob-download URLs are created. Refresh clears all captures.
6. Exercise the separate mixed-event stream and 60-second/96-kHz bounded chunk renderer controls. They are desktop API smoke evidence only, not real-device long-play evidence.

No physical result should be added to the matrix without an actual manual capture and review. Automated smoke output must be labeled desktop-only.
