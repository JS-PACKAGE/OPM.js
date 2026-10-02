import assert from 'node:assert/strict';
import { HEADROOM, renderNote } from '../src/core/index.js';
import { examples } from '../src/voices/examples.js';
import { presetMetadata } from '../src/voices/preset-metadata.js';
import { parseVoiceBank } from '../src/voices/schema.js';
import type { FrozenVoice, Voice } from '../src/voices/schema.js';
import { importDX7, describeDX7 } from '../src/voices/dx7.js';
import type { DX7ImportDescription } from '../src/voices/dx7.js';
import { syntheticDX7Fixtures } from '../demo/audition-fixtures.js';
import { AUDITION_GAIN, AUDITION_GATE, AUDITION_NOTES, AUDITION_SEED, AUDITION_VELOCITIES, AUDITION_PROFILES,
  auditionSlotSeconds, matchLevels, measureSound, renderAudition, seededPhrase } from '../demo/audition-metrics.js';

const sampleRate = 48000;
const sources: { id: string; kind: string; voice: Voice | FrozenVoice; conversion?: DX7ImportDescription }[] =
  [...parseVoiceBank(examples)].map(([id, voice]) => ({ id, kind: presetMetadata[id].provenance.kind, voice }));
const fixtures = syntheticDX7Fixtures();
const singles = fixtures.find(fixture => fixture.id === 'dx7_pairs')!;
const packed = fixtures.find(fixture => fixture.id === 'dx7_bank')!;
const bank = importDX7(packed.bytes);
assert.equal(bank.length, 32);
assert.deepEqual(bank[0], importDX7(singles.bytes)[0], 'Packed and single recipes must convert identically');
for (const fixture of fixtures) {
  let sum = 0;
  for (let at = 6; at < fixture.bytes.length - 1; at++) sum += fixture.bytes[at];
  assert.equal(sum & 127, 0, `${fixture.id}: valid Yamaha checksum`);
  const voices = importDX7(fixture.bytes);
  const description = describeDX7(fixture.bytes)[0];
  sources.push({ id: fixture.id, kind: 'original synthetic DX7', voice: voices[0], conversion: description });
}
const baseline = sources.find(source => source.id === 'wood_mallet')!;
const phrase = seededPhrase(AUDITION_SEED, 60, 0.6);
const results = sources.flatMap(({ id, kind, voice, conversion }) => AUDITION_PROFILES.map(quality => {
  const metadata = presetMetadata[id];
  const notes = [...new Set<number>([...AUDITION_NOTES, ...(metadata ? [metadata.intendedMidi[0],
    Math.round((metadata.intendedMidi[0] + metadata.intendedMidi[1]) / 2), metadata.intendedMidi[1]] : [])])];
  const velocities = [...new Set<number>([0.1625, ...AUDITION_VELOCITIES, ...(metadata ? metadata.intendedVelocity : [])])];
  const rows = notes.flatMap(note => velocities.map(velocity => {
    const audio = renderNote({ voice, note, velocity, duration: AUDITION_GATE, sampleRate, pan: 0, quality });
    const sound = measureSound(audio.left, audio.right, Math.ceil(AUDITION_GATE * sampleRate));
    const accepted = sound.finite && audio.diagnostics.errors === 0 &&
      sound.peak <= HEADROOM + 1e-6 && sound.gateRms > 1e-6;
    return { note, velocity, ...sound, errors: audio.diagnostics.errors, accepted };
  }));
  const slotSeconds = auditionSlotSeconds(baseline.voice, voice);
  const audioA = renderAudition(baseline.voice, phrase, slotSeconds, sampleRate, quality);
  const audioB = renderAudition(voice, phrase, slotSeconds, sampleRate, quality);
  const controlled = renderAudition(voice, phrase, slotSeconds, sampleRate, quality, true);
  const controlledSound = measureSound(controlled.left, controlled.right, controlled.left.length);
  const controlsAccepted = controlledSound.finite && controlled.diagnostics.errors === 0 &&
    controlledSound.peak <= HEADROOM + 1e-6 && controlledSound.rms > 1e-6;
  const soundA = measureSound(audioA.left, audioA.right, audioA.left.length);
  const soundB = measureSound(audioB.left, audioB.right, audioB.left.length);
  const match = matchLevels(soundA, soundB, presetMetadata[baseline.id].hostTrimDb, metadata?.hostTrimDb ?? -6);
  const phraseAccepted = soundA.finite && soundB.finite && audioA.diagnostics.errors === 0 && audioB.diagnostics.errors === 0 &&
    soundA.peak <= HEADROOM + 1e-6 && soundB.peak <= HEADROOM + 1e-6 && soundB.rms > 1e-6;
  return {
    id, quality, kind, name: voice.name, algorithm: voice.algorithm, version: voice.version,
    provenance: metadata?.provenance ?? { kind: 'original-recipe', source: 'demo/audition-fixtures.ts', license: 'Apache-2.0', copiedEmulatorPatch: false },
    curation: metadata, conversion, rows,
    liveControlPhrase: { controls: 'operatorRatios at 0.12s; feedback at 0.25s; operatorADSR at 0.4s; ratios/feedback restore at 0.55s, each 0.8s held note', ...controlledSound, accepted: controlsAccepted },
    suggestedHostTrimDb: Math.min(...rows.map(row => row.suggestedTrimDb)),
    seededAB: { sourceA: baseline.id, sourceB: id, slotSeconds, rawA: soundA, rawB: soundB,
      dryPlaybackGains: [AUDITION_GAIN, AUDITION_GAIN], matchedHostTrimDb: match.trimDb,
      matchedPlaybackGains: match.gains.map(gain => gain * AUDITION_GAIN), targetDbFSBeforeMaster: match.targetDbFS,
      accepted: phraseAccepted },
    accepted: rows.every(row => row.accepted) && phraseAccepted && controlsAccepted,
  };
}));
console.log(JSON.stringify({
  sampleRate, profiles: AUDITION_PROFILES, gateSeconds: AUDITION_GATE, notes: AUDITION_NOTES, velocities: [0.1625, ...AUDITION_VELOCITIES],
  phrase: { seed: AUDITION_SEED, baseNote: 60, baseVelocity: 0.6, steps: phrase, noteBounds: [48, 84] },
  channels: 'Stereo, centered; peak = max channel absolute sample, RMS = sqrt(mean channel energy)',
  loudness: 'Unweighted RMS dBFS, NOT LUFS or perceptual equal-loudness. Phrase A/B uses the same padded whole-phrase window; grid uses gate-only windows.',
  acceptance: 'Per eco/standard/high: finite, error-free, peak <= HEADROOM + 1e-6 and non-silent. Register boundary/middle cells plus C3/C4/C6, intended velocity boundaries and held-note live-control phrases are sampled; not spectral certification or a listener verdict.',
  trimPolicy: 'Metadata -6 dB is a conservative HOST starting trim, not measured listening evidence. Report safety suggestions are attenuation-only -24..0 dB (peak -12, gate RMS -24 targets). Pair matching further attenuates both to a shared energy target with peak cap; master gain is 0.12. Patches are never rewritten. Polyphony needs extra headroom.',
  listeningProtocol: 'Select the same seed, sources, register, velocity and phrase on examples/audition.html. Play A then B matched; repeat dry; repeat across nine register/velocity cells. Record attack/body/decay/brightness and manual gain preference separately. No perceptual verdict is produced by this command.',
  conversion: 'Original generated recipes only; no third-party SysEx or emulator patches. No six-operator reference renderer or hardware fidelity claim.',
  results, accepted: results.every(result => result.accepted),
}, null, 2));
if (results.some(result => !result.accepted)) process.exitCode = 1;
