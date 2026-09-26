import { validateVoice, bounded } from '../voices/schema.js';
import { envelopeAt } from './envelope.js';
import { sineOperator, finiteOrSilence, TAU } from './operator.js';
import { ALGORITHMS, feedbackPhase } from './algorithms.js';
export { envelopeAt } from './envelope.js';
export { ALGORITHMS } from './algorithms.js';
export const HEADROOM = 0.7; // -3.098 dB, with margin for Float32 rounding.
export const OVERSAMPLE = 4;
export const MAX_RENDER_SAMPLES = 4_000_000;

export function sampleRateValue(value) {
  if (!Number.isInteger(value) || value < 8000 || value > 96000) {
    throw new RangeError('sampleRate must be an integer in 8000..96000');
  }
  return value;
}

// Pure offline renderer: no globals, IO, randomness or Web Audio dependencies.
// The returned buffer includes the longest release and a short filter tail.
export function renderNote({ voice, note = 60, duration = 0.5, velocity = 1, sampleRate = 44100 } = {}) {
  voice = validateVoice(voice);
  sampleRate = sampleRateValue(sampleRate);
  note = bounded(note, 0, 127, 'note');
  duration = bounded(duration, 0, 30, 'duration');
  velocity = bounded(velocity, 0, 1, 'velocity');
  const release = Math.max(...voice.ops.map(op => op.adsr.r));
  const end = duration + release;
  const length = Math.ceil((end + 0.01) * sampleRate);
  if (length > MAX_RENDER_SAMPLES) throw new RangeError('Render exceeds sample budget');
  const samples = new Float32Array(length);
  const diagnostics = { errors: 0 };
  const graph = ALGORITHMS[voice.algorithm];
  const rate = sampleRate * OVERSAMPLE;
  const frequency = 440 * 2 ** ((note - 69) / 12);
  const phases = new Float64Array(4);
  const increments = voice.ops.map(op => TAU * Math.min(rate * 0.45,
    frequency * op.ratio * 2 ** (op.detune / 1200)) / rate);
  const values = new Float64Array(4);
  const filters = new Float64Array(4);
  // Four cascaded one-pole low-passes before decimation. Convex updates preserve
  // headroom; alpha = 1-exp(-2*pi*cutoff/internalRate). This reduces aliasing,
  // but is intentionally not a claim of band-limited FM at extreme indices.
  const alpha = 1 - Math.exp(-TAU * sampleRate * 0.2 / rate);
  let previous = 0, older = 0;
  for (let frame = 0; frame < length; frame++) {
    for (let sub = 0; sub < OVERSAMPLE; sub++) {
      const time = (frame * OVERSAMPLE + sub) / rate;
      let mix = 0;
      if (time < end && duration > 0) {
        for (let op = 0; op < 4; op++) {
          let modulation = op === 0 ? feedbackPhase(previous, older, voice.feedback) : 0;
          for (const source of graph.inputs[op]) modulation += values[source] * voice.modIndex;
          const gain = voice.ops[op].level * envelopeAt(time, duration, voice.ops[op].adsr);
          values[op] = finiteOrSilence(sineOperator(phases[op], modulation, gain), diagnostics);
          phases[op] = finiteOrSilence((phases[op] + increments[op]) % TAU, diagnostics);
        }
        older = previous;
        previous = values[0];
        for (const carrier of graph.carriers) mix += values[carrier];
        mix *= HEADROOM * velocity / graph.carriers.length;
      }
      for (let pole = 0; pole < filters.length; pole++) {
        filters[pole] = finiteOrSilence(filters[pole] + alpha * (mix - filters[pole]), diagnostics);
        mix = filters[pole];
      }
    }
    samples[frame] = finiteOrSilence(filters[3], diagnostics);
  }
  return { samples, sampleRate, diagnostics };
}
