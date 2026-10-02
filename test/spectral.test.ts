import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADROOM, renderNote } from '../src/core/index.js';
import { toneVoice, fmVoice, binAmplitude } from './quality-fixtures.js';
import type { Voice } from '../src/voices/schema.js';

const sampleRate = 48000;
function render(voice: Voice, note = 69) {
  const result = renderNote({ voice, note, sampleRate, duration: 1.3 });
  assert.equal(result.diagnostics.errors, 0);
  assert.ok(result.samples.every(Number.isFinite));
  return result.samples;
}
function amplitude(samples: Float32Array, frequency: number) {
  return binAmplitude(samples, sampleRate, frequency);
}

test('steady A4 has correct pitch, usable signal and single-voice headroom', () => {
  const samples = render(toneVoice({ level: 1 }));
  const fundamental = amplitude(samples, 440);
  assert.ok(fundamental > 0.4, `A4 amplitude ${fundamental}`);
  for (const frequency of [435, 439, 441, 445]) {
    assert.ok(amplitude(samples, frequency) < fundamental / 100, `unexpected ${frequency} Hz component`);
  }
  let peak = 0;
  let crossings = 0;
  const start = sampleRate / 4;
  for (let i = start; i < start + sampleRate; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
    if (samples[i] <= 0 && samples[i + 1] > 0) crossings++;
  }
  assert.equal(crossings, 440, 'one second contains 440 positive-going cycles');
  assert.ok(peak > 0.45 && peak <= HEADROOM, `peak ${peak} must leave at least 3 dB headroom`);
});

test('moderate phase modulation produces both expected first sidebands', () => {
  const samples = render(fmVoice(), 81); // 880 Hz carrier, 220 Hz modulator.
  const carrier = amplitude(samples, 880);
  assert.ok(carrier > 0.1);
  for (const frequency of [660, 1100]) {
    const relative = amplitude(samples, frequency) / carrier;
    assert.ok(relative > 0.15 && relative < 0.7, `${frequency} Hz sideband/carrier ${relative}`);
  }
});

test('AM and PM LFOs produce sidebands absent from the unmodulated control', () => {
  const control = render(toneVoice());
  for (const lfo of [
    { rate: 8, amDepth: 0.6, pmDepth: 0 },
    { rate: 5, amDepth: 0, pmDepth: 20 },
  ]) {
    const samples = render(toneVoice({ lfo }));
    const carrier = amplitude(samples, 440);
    for (const frequency of [440 - lfo.rate, 440 + lfo.rate]) {
      assert.ok(amplitude(control, frequency) < amplitude(control, 440) / 1000);
      assert.ok(amplitude(samples, frequency) > carrier * 0.1, `${frequency} Hz LFO sideband missing`);
    }
  }
});

test('pre-decimation filter attenuates a controlled ultrasonic oscillator by at least 30 dB', () => {
  // 30 kHz is representable at the internal 192 kHz rate, but aliases to 18 kHz
  // after 48 kHz decimation. Compare equal-level oscillators, not an idealized
  // FM spectrum: this bounds one known alias, not arbitrary extreme-index FM.
  const control = render(toneVoice({ level: 0.1 }), 93); // 1760 Hz.
  const ultrasonic = render(toneVoice({ ratio: 30000 / 1760, level: 0.1 }), 93);
  const relative = amplitude(ultrasonic, 18000) / amplitude(control, 1760);
  assert.ok(relative < 10 ** (-30 / 20), `controlled folded alias ${20 * Math.log10(relative)} dB`);
});
