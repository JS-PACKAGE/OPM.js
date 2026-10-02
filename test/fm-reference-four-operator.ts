// Explicit original equations, not a traversal of the engine's algorithm table.
// Envelope curves are derived in dB and the filter is applied by independent
// analog-pole Fourier convolution, never production DSP/envelope helpers.
import assert from 'node:assert/strict';
import { HEADROOM, Synth } from '../src/core/index.js';
import type { ADSR, Voice } from '../src/voices/schema.js';
import type { QualityProfile } from '../src/core/decimator.js';
import { filterByFourier } from './decimator-reference.js';
import { fourierBin, referenceProfile, unsaturatedWindow } from './fm-reference-fixtures.js';

function heldDb(time: number, envelope: ADSR): number {
  if (time < envelope.a) return -96 + 96 * time / envelope.a;
  const sustain = envelope.s === 0 ? -96 : Math.max(-96, 20 * Math.log10(envelope.s));
  return time < envelope.a + envelope.d ? sustain * (time - envelope.a) / envelope.d : sustain;
}
function gain(time: number, gate: number, envelope: ADSR): number {
  if (time === 0 && envelope.a > 0 || time >= gate + envelope.r) return 0;
  const db = time < gate ? heldDb(time, envelope) : heldDb(gate, envelope) +
    (-96 - heldDb(gate, envelope)) * (time - gate) / envelope.r;
  return db <= -96 ? 0 : 10 ** (db / 20);
}

function sourceAt(time: number, voice: Voice, frequency: number, gate: number): number {
  const p = voice.ops.map(op => 2 * Math.PI * frequency * op.ratio * time);
  const a = voice.ops.map(op => op.level * gain(time, gate, op.adsr));
  const index = voice.modIndex;
  const first = a[0] * Math.sin(p[0]);
  if (voice.algorithm === 0) {
    // x4 = A4 sin(w4 t + I A3 sin(w3 t + I A2 sin(w2 t + I A1 sin(w1 t))))
    return HEADROOM * a[3] * Math.sin(p[3] + index * a[2] * Math.sin(p[2] + index * a[1] * Math.sin(p[1] + index * first)));
  }
  if (voice.algorithm === 1) {
    // Two independent leaves sum in phase at operator 3, then feed carrier 4.
    const second = a[1] * Math.sin(p[1]);
    return HEADROOM * a[3] * Math.sin(p[3] + index * a[2] * Math.sin(p[2] + index * (first + second)));
  }
  // Two independent two-operator pairs, with arithmetic carrier normalization.
  return HEADROOM / 2 * (a[1] * Math.sin(p[1] + index * first) + a[3] * Math.sin(p[3] + index * a[2] * Math.sin(p[2])));
}

export function verifyFourOperator(sampleRate: number, quality: QualityProfile = 'standard') {
  const { factor } = referenceProfile(quality);
  const scenarios = [
    { name: 'unequal-ratios-low-index', note: 69, index: 1.5, ratios: [0.75, 1.25, 2.5, 3.75], transition: false },
    { name: 'upper-register-wideband', note: 93, index: 8, ratios: [3.5, 5, 1.5, 1], transition: false },
    { name: 'independent-envelope-boundaries', note: 81, index: 4, ratios: [1, 1.5, 2.25, 3.25], transition: true },
  ];
  return scenarios.flatMap(scenario => ([0, 1, 4] as const).map(algorithm => {
    const frames = Math.ceil(sampleRate * (scenario.transition ? 0.09 : 0.16));
    const gateFrames = Math.ceil(sampleRate * (scenario.transition ? 0.018 : 0.12));
    const gate = gateFrames / sampleRate;
    const levels = algorithm === 4 ? [0.55, 0.035, 0.43, 0.025] : [0.55, 0.43, 0.31, 0.025];
    const voice: Voice = {
      version: 6, name: scenario.name, algorithm, feedback: 0, modIndex: scenario.index,
      lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
      ops: Array.from({ length: 4 }, (_, op) => ({ ratio: scenario.ratios[op], level: levels[op], detune: 0,
        adsr: scenario.transition ? { a: [0.006, 0.012, 0.023, 0.003][op], d: [0.025, 0.018, 0.007, 0.009][op],
          s: [0.7, 0.4, 0.6, 0.5][op], r: [0.018, 0.026, 0.031, 0.022][op] } : { a: 0, d: 0, s: 1, r: 0.01 },
      })) as Voice['ops'],
    };
    const frequency = 440 * 2 ** ((scenario.note - 69) / 12);
    const source = Float64Array.from({ length: frames * factor }, (_, sub) => sourceAt(sub / (factor * sampleRate), voice, frequency, gate));
    const independent = filterByFourier(source, sampleRate, quality);
    const synth = new Synth(sampleRate, 8, { quality }), id = synth.noteOn(voice, scenario.note);
    const left = new Float32Array(frames), right = new Float32Array(frames);
    synth.render(left, right, 0, gateFrames); synth.noteOff(id); synth.render(left, right, gateFrames, frames - gateFrames);
    assert.equal(synth.errorCount, 0);
    const actual = unsaturatedWindow(left, HEADROOM);
    const expected = Float64Array.from({ length: frames }, (_, frame) => independent[factor * frame + factor - 1]);
    let maximumError = 0, errorEnergy = 0, signalEnergy = 0;
    const transitionErrors = { attackDecay: 0, held: 0, release: 0, tail: 0 };
    const releaseEnd = gate + Math.max(...voice.ops.map(op => op.adsr.r));
    for (let frame = 0; frame < frames; frame++) {
      const error = Math.abs(actual[frame] - expected[frame]);
      const time = frame / sampleRate;
      if (time < releaseEnd) {
        maximumError = Math.max(maximumError, error); errorEnergy += error ** 2; signalEnergy += expected[frame] ** 2;
      }
      const section = time >= releaseEnd ? 'tail' : time >= gate ? 'release' : time < 0.012 ? 'attackDecay' : 'held';
      transitionErrors[section] = Math.max(transitionErrors[section], error);
    }
    assert.ok(maximumError < 3e-7, `${sampleRate} ${scenario.name} algorithm ${algorithm}: independent nested/envelope/filter error ${maximumError}`);
    assert.ok(Math.sqrt(errorEnergy / signalEnergy) < 2e-5, 'routing, modulation depths and carrier normalization match the independent equations');
    assert.ok(transitionErrors.tail < 2 * 10 ** (-96 / 20), 'retired filter tail stays below the documented amplitude floor allowance');
    const spectrum = [frequency * 0.5, frequency, frequency * 1.5, frequency * 2.5, sampleRate * 0.3].map(hz => {
      const measured = fourierBin(actual, sampleRate, hz), reference = fourierBin(expected, sampleRate, hz);
      const complexError = Math.hypot(measured.real - reference.real, measured.imaginary - reference.imaginary);
      assert.ok(complexError < 3e-7, 'complex spectral projection preserves amplitude and causal phase');
      return { hz, expectedAmplitude: reference.amplitude, measuredAmplitude: measured.amplitude, complexError };
    });
    return { sampleRate, quality, algorithm, fixture: scenario.name, note: scenario.note, index: scenario.index, ratios: scenario.ratios,
      envelopeTransitions: scenario.transition, gateSeconds: gate, maximumError, relativeRmsError: Math.sqrt(errorEnergy / signalEnergy),
      transitionErrors, spectrum, reference: 'Explicit nested/branched/two-carrier equations at physical substep times, independent dB envelopes and analog-pole Fourier convolution',
      limitation: 'These bounded original fixtures do not prove arbitrary four-op alias freedom or perceived quality.' };
  }));
}
