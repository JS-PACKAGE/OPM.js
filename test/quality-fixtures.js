// Controlled, exactly representable fixtures, not claims of hardware fidelity.
export function toneVoice({ ratio = 1, level = 0.5, lfo = { rate: 0, amDepth: 0, pmDepth: 0 } } = {}) {
  return {
    version: 2, name: 'spectral-tone', algorithm: 7, feedback: 0, modIndex: 0, lfo,
    ops: Array.from({ length: 4 }, () => ({
      ratio, level, detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.01 },
    })),
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
export function binAmplitude(samples, sampleRate, frequency, offset = sampleRate / 4, length = sampleRate) {
  let real = 0;
  let imaginary = 0;
  const step = 2 * Math.PI * frequency / sampleRate;
  for (let i = 0; i < length; i++) {
    real += samples[offset + i] * Math.cos(step * i);
    imaginary -= samples[offset + i] * Math.sin(step * i);
  }
  return 2 * Math.hypot(real, imaginary) / length;
}
