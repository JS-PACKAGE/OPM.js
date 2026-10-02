import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADROOM, Synth, renderNote } from '../src/core/index.js';
import { toneVoice, fmVoice, binAmplitude, QUALITY_SAMPLE_RATES, controlledTone, matrixVoice, signalMetrics } from './quality-fixtures.js';
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

for (const rate of QUALITY_SAMPLE_RATES) {
  test(`${rate} Hz controlled passband, alias rejection and low-level THD`, () => {
    const frequency = Math.round(rate * 0.025);
    const reference = renderNote(controlledTone(rate, frequency));
    const fundamental = binAmplitude(reference.samples, rate, frequency);
    assert.equal(reference.diagnostics.errors, 0);
    assert.ok(fundamental > 0.02 && fundamental < 0.04);
    let harmonicEnergy = 0;
    for (let harmonic = 2; harmonic <= 8; harmonic++) {
      harmonicEnergy += binAmplitude(reference.samples, rate, frequency * harmonic) ** 2;
    }
    assert.ok(Math.sqrt(harmonicEnergy) / fundamental < 0.01, 'low-level THD below 1%');
    const passbandDb: number[] = [];
    for (const fraction of [0.05, 0.1, 0.2, 0.35]) {
      const hz = Math.round(rate * fraction);
      const result = renderNote(controlledTone(rate, hz));
      assert.equal(result.diagnostics.errors, 0);
      const amplitude = binAmplitude(result.samples, rate, hz);
      const lossDb = 20 * Math.log10(amplitude / fundamental);
      assert.ok(Number.isFinite(lossDb) && lossDb <= 0.02, 'controlled passband does not boost settled tones');
      if (fraction <= 0.2) assert.ok(lossDb > -0.03, 'flat upper-register passband through 0.2 Fs');
      if (fraction === 0.35) assert.ok(lossDb > -12 && lossDb < -11, 'documented steep transition band');
      passbandDb.push(lossDb);
    }
    assert.ok(passbandDb[2] - passbandDb[3] > 10, 'transition-band attenuation is distinct from passband brightness');
    for (const fraction of [0.625, 1.125]) {
      const sourceHz = Math.round(rate * fraction);
      const ultrasonic = renderNote(controlledTone(rate, sourceHz));
      assert.equal(ultrasonic.diagnostics.errors, 0);
      assert.ok(signalMetrics(ultrasonic.samples).finite);
      assert.ok(binAmplitude(ultrasonic.samples, rate, Math.abs(sourceHz - rate)) / fundamental < 10 ** (-30 / 20),
        'isolated ultrasonic sine alias is attenuated by at least 30 dB, not an arbitrary FM guarantee');
    }
  });

  test(`${rate} Hz every algorithm and feedback bound remains finite, deterministic and retires dense voices`, () => {
    for (let algorithm = 0; algorithm < 8; algorithm++) for (const feedback of [0, 7] as const) {
      const voice = matrixVoice(algorithm as Voice['algorithm'], feedback);
      const run = (chunk: number) => {
        const synth = new Synth(rate);
        const left = new Float32Array(Math.ceil(rate * 0.12));
        const right = new Float32Array(left.length);
        const ended = new Map<number, string>();
        synth.onVoiceEnded = (id, reason) => {
          assert.ok(!ended.has(id), 'one terminal event per note');
          ended.set(id, reason);
        };
        const ids: number[] = [];
        const add = (count: number) => {
          for (let i = 0; i < count; i++) ids.push(synth.noteOn(voice, [24, 60, 96][i % 3], undefined,
            { velocity: [0, 0.35, 1][i % 3], pan: [-1, 0, 1][i % 3] }));
        };
        const advance = (start: number, end: number) => {
          for (let frame = start; frame < end; frame += chunk) synth.render(left, right, frame, Math.min(chunk, end - frame));
        };
        const stealFrame = Math.ceil(rate * 0.02);
        const releaseFrame = Math.ceil(rate * 0.06);
        add(8);
        advance(0, stealFrame);
        // Two admissions after audible output exercise fading and bounded spill,
        // unlike a batch that steals voices before they have made any samples.
        add(16);
        advance(stealFrame, releaseFrame);
        ids.forEach(id => synth.noteOff(id));
        advance(releaseFrame, left.length);
        assert.equal(synth.errorCount, 0);
        assert.equal(ended.size, ids.length);
        assert.equal([...ended.values()].filter(reason => reason === 'stolen').length, 16);
        assert.ok([...ended.values()].every(reason => reason === 'ended' || reason === 'stolen'));
        for (const samples of [left, right]) {
          const metrics = signalMetrics(samples);
          assert.ok(metrics.finite && metrics.peak <= HEADROOM + 1e-6);
          assert.ok(signalMetrics(samples, samples.length - 128, 128).peak < 1e-5, 'release/fade tails settle');
        }
        assert.ok(signalMetrics(right).rms > 1e-4, 'dense voices produce real signal');
        return { left, right };
      };
      assert.deepEqual(run(127), run(1024), 'note transitions do not depend on render chunk sizes');
    }
  });

  test(`${rate} Hz velocity silence and hard pan hold at MIDI pitch boundaries`, () => {
    for (const note of [0, 127]) for (const pan of [-1, 1]) for (const velocity of [0, 1]) {
      const result = renderNote({ voice: toneVoice(), sampleRate: rate, note, pan, velocity, duration: 0.04 });
      assert.equal(result.diagnostics.errors, 0);
      for (const samples of [result.left, result.right]) {
        const metrics = signalMetrics(samples);
        assert.ok(metrics.finite && metrics.peak <= HEADROOM + 1e-6);
        if (velocity === 0) assert.equal(metrics.peak, 0);
      }
      assert.equal(signalMetrics(pan === -1 ? result.right : result.left).peak, 0, 'opposite channel must be silent');
      if (velocity > 0) assert.ok(signalMetrics(pan === -1 ? result.left : result.right).rms > 1e-6);
    }
  });
}
