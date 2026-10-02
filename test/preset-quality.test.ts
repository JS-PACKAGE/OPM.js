import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADROOM, renderNote } from '../src/core/index.js';
import { originalPresets } from '../src/voices/original.js';
import { presetMetadata } from '../src/voices/preset-metadata.js';
import { binAmplitude, signalMetrics } from './quality-fixtures.js';

const voices = Object.fromEntries(originalPresets.map(voice => [voice.name, voice]));

test('original presets produce finite bounded signal across intended registers and phrase velocities', () => {
  for (const voice of originalPresets) {
    const metadata = presetMetadata[voice.name];
    for (let note = metadata.intendedMidi[0]; note <= metadata.intendedMidi[1]; note++) {
      for (const velocity of [0.1625, 0.6, 1]) {
        const audio = renderNote({ voice, note, velocity, duration: 0.08, sampleRate: 22050 });
        const sound = signalMetrics(audio.left);
        assert.equal(audio.diagnostics.errors, 0, `${voice.name} MIDI ${note}`);
        assert.ok(sound.finite && sound.peak <= HEADROOM + 1e-6, `${voice.name} MIDI ${note} v${velocity}: bounded finite audio`);
        assert.ok(sound.rms > 1e-8, `${voice.name} MIDI ${note} v${velocity}: produces signal`);
      }
    }
  }
});

test('inharmonic fixed-Hz chime keeps its partials rather than transposing with MIDI register', () => {
  const voice = voices.fixed_hz_chime;
  const low = renderNote({ voice, note: 48, velocity: 0.6, duration: 1.3, sampleRate: 48000 });
  const high = renderNote({ voice, note: 84, velocity: 0.6, duration: 1.3, sampleRate: 48000 });
  assert.deepEqual(high.left, low.left, 'key changes cannot transpose fixed-Hz additive carriers');
  // The shortest partial decays quickly: measure onset energy, not a steady-tone window.
  for (const frequency of [317, 523, 829, 1237]) {
    const partial = binAmplitude(low.left, 48000, frequency, 480, 9600);
    assert.ok(partial > 0.002, `${frequency} Hz partial ${partial}`);
    assert.ok(binAmplitude(low.left, 48000, frequency + 100, 480, 9600) < partial * 0.15, 'inharmonic partial remains localized');
  }
});

test('mallet decays while pad develops during a held gate', () => {
  const sampleRate = 48000;
  const mallet = renderNote({ voice: voices.wood_mallet, note: 60, velocity: 0.6, duration: 1, sampleRate });
  const pad = renderNote({ voice: voices.slow_air_pad, note: 60, velocity: 0.6, duration: 1, sampleRate });
  const earlyMallet = signalMetrics(mallet.left, 2400, 4800).rms;
  const lateMallet = signalMetrics(mallet.left, 26400, 4800).rms;
  const earlyPad = signalMetrics(pad.left, 2400, 4800).rms;
  const latePad = signalMetrics(pad.left, 26400, 4800).rms;
  assert.ok(lateMallet < earlyMallet * 0.6, `mallet held decay ratio ${lateMallet / earlyMallet}`);
  assert.ok(latePad > earlyPad * 2, `pad held build ratio ${latePad / earlyPad}`);
});
