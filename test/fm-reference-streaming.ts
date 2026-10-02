import assert from 'node:assert/strict';
import { HEADROOM, Synth } from '../src/core/index.js';
import type { NoteControls, VoiceEndReason } from '../src/core/synth.js';
import type { QualityProfile } from '../src/core/decimator.js';
import {
  COEFFICIENT_TOLERANCE, acceptedFilterMagnitude, fourierBin, streamVoice, unsaturatedWindow,
} from './fm-reference-fixtures.js';
import { filterImpulseBounds } from './decimator-reference.js';

const SAMPLE_RATE = 48000;
const LEVEL = 0.08;
const AM_DEPTH = 0.4;

interface StreamEvent { frame: number; controls?: NoteControls }
function streamRun(chunks: readonly number[], quality: QualityProfile, seconds: number) {
  const filterL1 = filterImpulseBounds(quality).l1;
  const synth = new Synth(SAMPLE_RATE, 8, { quality });
  const id = synth.noteOn(streamVoice(), 69);
  const terminal: { id: number; reason: VoiceEndReason; frame: number }[] = [];
  synth.onVoiceEnded = (endedId, reason) => terminal.push({ id: endedId, reason, frame: synth.currentFrame });
  const events: StreamEvent[] = [];
  const targets = [-12, 12, -5, 7, 0];
  const retargets = quality === 'standard' ? 96 : 12;
  for (let i = 0; i < retargets; i++) events.push({ frame: Math.round((seconds / 3 + i * seconds / (2 * retargets)) * SAMPLE_RATE),
    controls: { pitch: targets[i % targets.length], glide: 0.9 } });
  events.push({ frame: seconds * 5 / 6 * SAMPLE_RATE, controls: { pitch: 12, glide: 0.5, modulation: 0, ramp: 0.1 } });
  const releaseFrame = (seconds - 0.25) * SAMPLE_RATE;
  events.push({ frame: releaseFrame });
  const left = new Float32Array(Math.max(...chunks)), right = new Float32Array(left.length);
  const words = new Uint32Array(left.buffer);
  const windows = [quality === 'standard' ? 2 : 0.5, seconds / 3 - 2, quality === 'standard' ? seconds - 2 : seconds - 1.25].map(second =>
    ({ start: second * SAMPLE_RATE, samples: new Float32Array(SAMPLE_RATE) }));
  let frame = 0, event = 0, block = 0, hash = 2166136261, previous = 0, peak = 0, maximumStep = 0, silentTailPeak = 0;
  // A sine at the greatest requested pitch/PM excursion bounds its derivative.
  // Add the steepest envelope, AM LFO and modulation-ramp slopes. The filter
  // can ring, so its independent impulse L1 bounds derivative amplification;
  // the memoryless tanh cannot increase the bound.
  const maximumHz = 880 * 2 ** (14 / 1200);
  const stepBound = filterL1 * HEADROOM * LEVEL * (2 * Math.sin(Math.PI * maximumHz / SAMPLE_RATE) +
    Math.LN10 * 96 / (20 * 0.01 * SAMPLE_RATE) + AM_DEPTH * Math.PI * 5 / SAMPLE_RATE +
    AM_DEPTH / (0.1 * SAMPLE_RATE)) + 1e-6;
  while (frame < seconds * SAMPLE_RATE) {
    if (event < events.length && events[event].frame === frame) {
      const next = events[event++];
      if (next.controls) assert.equal(synth.updateNote(id, next.controls), true);
      else assert.equal(synth.noteOff(id), true);
    }
    const boundary = event < events.length ? events[event].frame : seconds * SAMPLE_RATE;
    const length = Math.min(chunks[block++ % chunks.length], boundary - frame);
    synth.render(left, right, 0, length);
    for (let i = 0; i < length; i++) {
      const value = left[i], absoluteFrame = frame + i;
      if (!Number.isFinite(value) || Math.abs(value) > HEADROOM || value !== right[i]) {
        assert.fail(`invalid dual-mono streaming sample at ${absoluteFrame}: ${value}, ${right[i]}`);
      }
      peak = Math.max(peak, Math.abs(value));
      const step = Math.abs(value - previous);
      maximumStep = Math.max(maximumStep, step);
      if (step > stepBound) assert.fail(`stream discontinuity at ${absoluteFrame}: ${step} > ${stepBound}`);
      previous = value;
      hash = Math.imul(hash ^ words[i], 16777619) >>> 0;
      for (const window of windows) {
        const offset = absoluteFrame - window.start;
        if (offset >= 0 && offset < SAMPLE_RATE) window.samples[offset] = value;
      }
      if (absoluteFrame >= (seconds - 0.1) * SAMPLE_RATE) silentTailPeak = Math.max(silentTailPeak, Math.abs(value));
    }
    frame += length;
  }
  assert.equal(synth.currentFrame, seconds * SAMPLE_RATE);
  assert.equal(synth.errorCount, 0);
  assert.equal(terminal.length, 1, 'one terminal event after a long held voice, not during glides');
  assert.equal(terminal[0].id, id);
  assert.equal(terminal[0].reason, 'ended');
  assert.ok(terminal[0].frame >= releaseFrame + 0.05 * SAMPLE_RATE - 1 &&
    terminal[0].frame < releaseFrame + 0.1 * SAMPLE_RATE, 'release and filter tail retire promptly');
  assert.equal(silentTailPeak, 0, 'retired streaming voice leaves exact silence');
  assert.equal(synth.noteOff(id), false);
  assert.equal(synth.updateNote(id, { pitch: 0 }), false);

  // AM mean-square is (1-depth/2)^2 + depth^2/8. Slow, small-depth PM,
  // coherent-window boundary error and the low-frequency filter variation
  // have a conservative 1% RMS allowance, independently of engine output.
  const expectedHeldRms = HEADROOM * LEVEL * acceptedFilterMagnitude(440, SAMPLE_RATE, quality) *
    Math.sqrt(((1 - AM_DEPTH / 2) ** 2 + AM_DEPTH ** 2 / 8) / 2);
  const heldRms = windows.slice(0, 2).map(window => {
    const values = unsaturatedWindow(window.samples, HEADROOM);
    let energy = 0;
    for (const value of values) energy += value * value;
    const rms = Math.sqrt(energy / values.length);
    assert.ok(Math.abs(rms / expectedHeldRms - 1) < 0.01, 'early and late held/LFO energy obey the AM reference');
    return rms;
  });
  const settled = unsaturatedWindow(windows[2].samples, HEADROOM);
  const bin = fourierBin(settled, SAMPLE_RATE, 880);
  const expectedAmplitude = HEADROOM * LEVEL * acceptedFilterMagnitude(880, SAMPLE_RATE, quality);
  assert.ok(Math.abs(bin.amplitude - expectedAmplitude) / (HEADROOM * LEVEL) < COEFFICIENT_TOLERANCE,
    'repeated interrupted glides settle at the requested octave with LFO disabled');
  let residualEnergy = 0, signalEnergy = 0;
  for (let i = 0; i < settled.length; i++) {
    const angle = 2 * Math.PI * 880 * i / SAMPLE_RATE;
    const residual = settled[i] - (bin.real * Math.cos(angle) - bin.imaginary * Math.sin(angle));
    residualEnergy += residual * residual;
    signalEnergy += settled[i] * settled[i];
  }
  const settledResidualRatio = Math.sqrt(residualEnergy / signalEnergy);
  assert.ok(settledResidualRatio < 1e-4, 'late settled waveform is a sine, not residual glide/LFO, noise or a dropout');
  return { hash, peak, maximumStep, stepBound, heldRms, expectedHeldRms, settledAmplitude: bin.amplitude,
    expectedSettledAmplitude: expectedAmplitude, settledResidualRatio, terminal: terminal[0], windows };
}

export function verifyLongStream(quality: QualityProfile = 'standard') {
  // Retain the two-minute standard baseline; shorter additional profiles keep
  // full-suite work bounded while still exercising held/glide/settled phases.
  const seconds = quality === 'standard' ? 120 : 12;
  const first = streamRun([128], quality, seconds);
  const replay = streamRun([31, 509, 97, 1024], quality, seconds);
  // Same implementation, different buffer reuse/chunk boundaries. Independent
  // waveform, derivative, pitch, energy and lifecycle checks above are the
  // acceptance; replay identity is additional deterministic-streaming coverage.
  assert.equal(first.hash, replay.hash, 'the entire ordered sample digest is unchanged after rechunking');
  assert.deepEqual(first.windows, replay.windows, 'early, late-held and settled waveforms reproduce after rechunking');
  assert.deepEqual(first.terminal, replay.terminal, 'terminal timing is chunk independent');
  const { windows: _windows, ...report } = first;
  return { sampleRate: SAMPLE_RATE, quality, secondsPerReplay: seconds, replays: 2,
    glideRetargets: quality === 'standard' ? 96 : 12, buffersReused: true, chunkFrames: [[128], [31, 509, 97, 1024]], ...report };
}
