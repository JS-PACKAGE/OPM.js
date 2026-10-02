import assert from 'node:assert/strict';
import { HEADROOM, renderNote } from '../src/core/index.js';
import { examples } from '../src/voices/examples.js';
import { parseVoiceBank } from '../src/voices/schema.js';
import type { FrozenVoice, Voice } from '../src/voices/schema.js';
import { importDX7, describeDX7 } from '../src/voices/dx7.js';
import type { DX7ImportDescription } from '../src/voices/dx7.js';
import { syntheticDX7Fixtures } from '../demo/audition-fixtures.js';
import { AUDITION_GATE, AUDITION_NOTES, AUDITION_VELOCITIES, measureSound } from '../demo/audition-metrics.js';

const sampleRate = 48000;
const sources: { id: string; kind: string; voice: Voice | FrozenVoice; conversion?: DX7ImportDescription }[] =
  [...parseVoiceBank(examples)].map(([id, voice]) => ({ id, kind: 'bundled', voice }));
assert.equal(sources.length, 7, 'The musical report must cover all seven bundled presets');
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

const results = sources.map(({ id, kind, voice, conversion }) => {
  const rows = AUDITION_NOTES.flatMap(note => AUDITION_VELOCITIES.map(velocity => {
    const audio = renderNote({ voice, note, velocity, duration: AUDITION_GATE, sampleRate, pan: 0 });
    const sound = measureSound(audio.left, audio.right, Math.ceil(AUDITION_GATE * sampleRate));
    const accepted = sound.finite && audio.diagnostics.errors === 0 &&
      sound.peak <= HEADROOM + 1e-6 && sound.gateRms > 1e-6;
    return { note, velocity, ...sound, errors: audio.diagnostics.errors, accepted };
  }));
  return {
    id, kind, name: voice.name, algorithm: voice.algorithm, version: voice.version,
    conversion,
    rows,
    suggestedHostTrimDb: Math.min(...rows.map(row => row.suggestedTrimDb)),
    accepted: rows.every(row => row.accepted),
  };
});
console.log(JSON.stringify({
  sampleRate, gateSeconds: AUDITION_GATE, notes: AUDITION_NOTES, velocities: AUDITION_VELOCITIES,
  channels: 'Stereo, centered; peak = max channel absolute sample, RMS = sqrt(mean channel energy)',
  loudness: 'Unweighted RMS dBFS (gate and full release-tail windows), NOT LUFS or perceptual equal-loudness',
  acceptance: 'Every cell must be finite, error-free, peak <= HEADROOM + 1e-6, gate RMS > 1e-6 (audible/non-silent proxy, not artistic quality)',
  trimPolicy: 'Attenuation-only host suggestion, bounded -24..0 dB, using the loudest cell: target peak <= -12 dBFS and gate RMS <= -24 dBFS. No patch is rewritten; polyphony needs additional headroom.',
  conversion: 'Original generated recipes only; no third-party SysEx. No six-operator DX7 reference renderer: comparisons are between converted recipes/bundled voices, not claims of hardware fidelity.',
  results,
  accepted: results.every(result => result.accepted),
}, null, 2));
if (results.some(result => !result.accepted)) process.exitCode = 1;
