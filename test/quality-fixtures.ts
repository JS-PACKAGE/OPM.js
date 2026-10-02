// Controlled, exactly representable fixtures, not claims of hardware fidelity.
import type { LFOInput, Voice } from '../src/voices/schema.js';
export function toneVoice({ ratio = 1, level = 0.5, lfo = { rate: 0, amDepth: 0, pmDepth: 0 } }: { ratio?: number; level?: number; lfo?: LFOInput } = {}): Voice {
  return {
    version: 4, name: 'spectral-tone', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { ...lfo, waveform: lfo.waveform ?? 'sine' },
    ops: Array.from({ length: 4 }, () => ({
      ratio, level, detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.01 },
    })) as Voice['ops'],
  };
}

export function fmVoice() {
  const voice = toneVoice({ level: 0 });
  voice.name = 'spectral-fm';
  voice.algorithm = 0;
  voice.modIndex = 0.8;
  voice.ops[2].ratio = 0.25;
  voice.ops[2].level = 1;
  voice.ops[3].level = 0.3;
  return voice;
}

// Coherent integer-Hz bins over an integer-second window avoid leakage-based
// acceptance. Skip initial envelope/filter transients before taking the window.
export function binAmplitude(samples: Float32Array, sampleRate: number, frequency: number, offset = Math.ceil(sampleRate / 4), length = sampleRate) {
  let real = 0;
  let imaginary = 0;
  const step = 2 * Math.PI * frequency / sampleRate;
  for (let i = 0; i < length; i++) {
    real += samples[offset + i] * Math.cos(step * i);
    imaginary -= samples[offset + i] * Math.sin(step * i);
  }
  return 2 * Math.hypot(real, imaginary) / length;
}

export const QUALITY_SAMPLE_RATES = [22050, 44100, 48000, 96000] as const;

export function matrixVoice(algorithm: Voice['algorithm'], feedback: Voice['feedback']): Voice {
  const voice = toneVoice({ level: 0.75 });
  voice.name = 'quality-matrix';
  voice.algorithm = algorithm;
  voice.feedback = feedback;
  voice.modIndex = 16;
  voice.ops.forEach((op, index) => {
    op.ratio = [1, 2, 3, 0.5][index];
    op.adsr = { a: 0.001, d: 0.008, s: 0.65, r: 0.025 };
  });
  return voice;
}

export function signalMetrics(samples: Float32Array, offset = 0, length = samples.length - offset) {
  let peak = 0;
  let energy = 0;
  let finite = true;
  for (let i = offset; i < offset + length; i++) {
    const value = samples[i];
    finite &&= Number.isFinite(value);
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
  }
  return { finite, peak, rms: Math.sqrt(energy / length) };
}

export function decibels(ratio: number) {
  return ratio === 0 ? null : 20 * Math.log10(ratio);
}

// All controlled tones use integer Hz and a settled, integer-second window.
// Keep their level low: otherwise the intentional output tanh contributes THD.
export function controlledTone(sampleRate: number, frequency: number) {
  return { voice: toneVoice({ ratio: frequency / 3520, level: 0.05 }),
    note: 105, sampleRate, duration: 1.3 };
}
