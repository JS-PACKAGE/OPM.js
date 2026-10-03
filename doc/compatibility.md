# Compatibility policy

This document states what OPM.js 1.x promises, what it does not, and how platform support is described. It is a maintenance policy, not a warranty. Evidence of what has actually been exercised lives in the [CHANGELOG](../CHANGELOG.md).

## Versioning

OPM.js follows semantic versioning for the surfaces below. Within 1.x:

- **Patch** releases fix defects. They may change rendered PCM only to correct documented-incorrect behavior, and the CHANGELOG says so.
- **Minor** releases add backward-compatible API, optional voice fields, new example pages and tooling. Default behavior is preserved: with default options, the same voice, notes, sample rate and quality profile render **bit-identical PCM** to the previous minor. Release 1.8.0 was checked against the 1.7.0 build over 279 renders (all bundled voices × three quality profiles × three registers × two sample rates, plus dense scores with all three stealing policies); see the CHANGELOG.
- **Major** releases may remove deprecated API or change defaults. Deprecations are announced in the CHANGELOG at least one minor release before removal. No public API is currently deprecated.

## Public surface

| Surface | Promise |
| --- | --- |
| `opm.js` (browser API), `opm.js/core` (offline DSP), `opm.js/midi-file` (SMF adapter), `opm.js/voices/schema.js`, `opm.js/voices/normalize.js`, `opm.js/voices/dx7.js`, `opm.js/voices/*.js` (banks and metadata), `opm.js/tools/assets.js` | Documented exports, option names, event shapes and error classes are stable in 1.x. Added options are optional. Browser-only calls require their documented environment even when importing on Node is safe. |
| `opm-assets` command | `copy <destination>` and `check <base-url>` keep their arguments and one-line JSON result; new subcommands may be added. |
| Voice JSON | Canonical **version 7**. Versions 1–6 normalize to version 7 for all of 1.x with their original restrictions. See [below](#voice-format). |
| Score / Arrangement projects | Each project has its own explicit format version. Parsing is inert, bounded and detached; serialization saves musical definitions and synthesis settings, not DSP state, permissions, timers or external effects. Newer project formats may reject in older runtimes. |
| `dist/` file layout | Deploy the **complete** matching tree. Relative paths between modules, the AudioWorklet processor and the Worker are an implementation detail, but the tree is released as one unit. |
| Generated declarations | Types describe the public API. Types marked `@internal` are stripped from declarations and may change at any time. |

**Not public:** the AudioWorklet message protocol and Worker protocol (versioned internally, validated strictly, subject to change in any release), module-private helpers that are not exported from the entry points above, source-map contents, and the exact wording of error messages (match on error class/`name`, `CommandRejectedError.event` and event fields instead).

## Voice format

- Version 7 is canonical. Exported banks are always version 7.
- Legacy versions 1–6 are accepted for the whole 1.x line with their original shapes: v1 excludes key scaling, v1/2 velocity sensitivity, v1–3 LFO waveform, v1–4 expressive fields, v1–5 per-operator LFO targets, and v1–6 operator waveform/noise rate.
- A new voice field requires a new version. Validation rejects unknown fields, so a voice written for a newer minor version may **fail to load** in an older runtime. Forward compatibility is not promised; backward compatibility is.
- Curated usage metadata (suggested register, velocity, polyphony, trim) is kept in [`src/voices/preset-metadata.ts` (checkout-only)](https://github.com/JS-PACKAGE/OPM.js/blob/v1.10/src/voices/preset-metadata.ts), outside the voice schema, and is never part of the exported voice JSON.

## Sound compatibility

PCM is deterministic for identical inputs, sample rate and quality profile, independent of render chunking. It is not promised to be identical across minor versions when a new feature is **used** (for example `voicePriority`, or a 32-voice engine that no longer steals). Features that need new option values never change the output of calls that do not pass them.

Two facts matter when planning mixes:

- The `eco`, `standard` (default) and `high` profiles intentionally sound slightly different. Switching profile is a sound change.
- Every engine instance applies one output `tanh` stage. Splitting a mix across several `OPM` instances therefore does not reproduce a single-engine mix bit for bit. See [audio buses](./audio-buses.md).

## Platform support

| Platform | Statement |
| --- | --- |
| Node.js | 22 or newer for offline rendering, tests, tooling and the `opm-assets` command. |
| Browsers | Need ES modules and AudioWorklet on a secure context (HTTPS or localhost). Module Workers are required only for Worker WAV export. Web MIDI is optional and feature-detected. |
| Desktop CI | The repository's workflow runs real AudioWorklet smoke and stress against Chromium, Firefox and WebKit. A configured workflow is a capability; consult the release notes for runs that actually passed. |
| iOS Safari, Android Chrome | **Unverified on physical hardware.** The [mobile acceptance workflow](./mobile-acceptance.md) and checkout-only `npm run device-evidence` exist so a maintainer can review real captures; none is supplied. |
| Web MIDI | Availability depends on the browser and a user permission prompt. The package never requests access on import and never requests SysEx. |
| Physical MIDI controllers | **Unverified on physical hardware.** Injected MIDI objects and desktop automation verify software paths, not a browser permission prompt, a real pedal or hot-unplug recovery. |
| Preset listening quality | **Unverified by human listeners.** Numerical safety, RMS matching and automated playback do not establish musical preference, perceived loudness or a listening-approved trim. |

Support for a platform means "no known defect and the documented checks were run", never a certification for every device, OS version or audio route.

## Resource bounds

Limits (note and slot counts, bank size, tempo points, layer and section counts, held keys) are part of the validation contract. Raising a limit is a minor change; lowering one is a major change. CPU cost is **not** bounded by contract: `maxVoices` above 8, additional buses and the `high` profile all trade CPU for polyphony or fidelity. Measure on target devices.

Benchmark capacity candidates describe only their recorded host, runtime, patch and workload. They are not portable device limits or an AudioWorklet underrun measurement. Quality and voice budgets never change automatically; choosing another quality is an explicit sound change. See [measured capacity guidance](./acoustic-quality.md) and the [cross-feature contracts](./host-integration.md#cross-feature-contracts).

## Reporting breaks

A change that makes a documented call stop working, or changes default PCM within a minor release, is a bug. Report it with the two versions, the call and a minimal score or voice. Security-relevant reports follow [SECURITY.md](../SECURITY.md).
