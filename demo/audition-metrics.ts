import { renderNote, renderSequence, sampleRateValue } from '../src/core/index.js';
import type { QualityProfile, SequenceEvent } from '../src/core/index.js';
import type { FrozenVoice, Voice } from '../src/voices/schema.js';

export const AUDITION_NOTES = [48, 60, 84] as const;
export const AUDITION_VELOCITIES = [0.25, 0.6, 1] as const;
export const AUDITION_GATE = 0.8;
export const AUDITION_GAIN = 0.12;
export const AUDITION_SEED = 20261002;
export const AUDITION_PROFILES = ['eco', 'standard', 'high'] as const;
export const AUDITION_PHRASE_REVISION = 'isolated-six-v2';
export const AUDITION_CONTROL_REVISION = 'ratio-feedback-adsr-v1';

export interface AuditionStep { note: number; velocity: number; duration: number }
export interface AuditionAudio {
  left: Float32Array; right: Float32Array; sampleRate: number; diagnostics: { errors: number };
}
export interface LevelMatch {
  targetDbFS: number; trimDb: readonly [number, number]; gains: [number, number];
}

/** Six isolated notes; shared unsigned seed makes A/B articulation reproducible. */
export function seededPhrase(seed: number, note: number, velocity: number): readonly AuditionStep[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed must be uint32');
  if (!Number.isFinite(note) || note < 0 || note > 127 || !Number.isFinite(velocity) || velocity <= 0 || velocity > 1) {
    throw new RangeError('Invalid phrase register or velocity');
  }
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const offsets = [0, 2, 4, 7, -5, -12];
  return offsets.map(offset => ({
    note: Math.max(48, Math.min(84, note + offset)),
    velocity: velocity * [0.65, 0.8, 1][Math.floor(random() * 3)],
    duration: [0.35, 0.5, AUDITION_GATE][Math.floor(random() * 3)],
  }));
}

export function auditionSlotSeconds(a: Voice | FrozenVoice, b: Voice | FrozenVoice): number {
  // Lower notes can lengthen v5 rate-key-scaled releases.
  const release = (voice: Voice | FrozenVoice) => Math.max(...voice.ops.map(op =>
    Math.min(10, op.adsr.r * 2 ** (-(op.rateKeyScale ?? 0) * (48 - 60) / 12))));
  return AUDITION_GATE + Math.max(release(a), release(b)) + 0.05;
}
/** Scheduled controls act on held notes, not on copied replacement patches. */
export function auditionControlEvents(voice: Voice | FrozenVoice, step: AuditionStep, id = 1): SequenceEvent[] {
  const ratios = voice.ops.map(op => op.ratio) as [number, number, number, number];
  const changed = [...ratios] as typeof ratios;
  changed[0] = Math.min(32, ratios[0] * 1.5);
  const adsr = voice.ops.map(op => ({ ...op.adsr, s: op.adsr.s * 0.6, r: Math.min(op.adsr.r, 0.4) })) as
    [typeof voice.ops[0]['adsr'], typeof voice.ops[0]['adsr'], typeof voice.ops[0]['adsr'], typeof voice.ops[0]['adsr']];
  return [
    { type: 'note', id, time: 0, duration: AUDITION_GATE, note: step.note, velocity: step.velocity, voice },
    { type: 'control', id, time: 0.12, controls: { operatorRatios: changed, ramp: 0.06 } },
    { type: 'control', id, time: 0.25, controls: { feedback: Math.min(7, voice.feedback + 2), ramp: 0.08 } },
    { type: 'control', id, time: 0.4, controls: { operatorADSR: adsr } },
    { type: 'control', id, time: 0.55, controls: { operatorRatios: ratios, feedback: voice.feedback, ramp: 0.08 } },
  ];
}

/** Bounded six-note dry phrase; equal slot windows prevent release length bias between sources. */
export function renderAudition(voice: Voice | FrozenVoice, steps: readonly AuditionStep[], slotSeconds: number,
  sampleRate = 48000, quality: QualityProfile = 'standard', controls = false): AuditionAudio {
  if (steps.length < 1 || steps.length > 6 || !Number.isFinite(slotSeconds) || slotSeconds <= 0 || slotSeconds > 12) {
    throw new RangeError('Invalid audition phrase bounds');
  }
  sampleRateValue(sampleRate);
  if (sampleRate > 48000 || !AUDITION_PROFILES.includes(quality)) throw new RangeError('Invalid audition rendering profile');
  const slotFrames = Math.ceil(slotSeconds * sampleRate);
  const left = new Float32Array(slotFrames * steps.length);
  const right = new Float32Array(left.length);
  let errors = 0;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (!Number.isFinite(step.note) || step.note < 0 || step.note > 127 || !Number.isFinite(step.velocity) ||
        step.velocity <= 0 || step.velocity > 1 || !Number.isFinite(step.duration) || step.duration <= 0 ||
        step.duration > AUDITION_GATE) throw new RangeError('Invalid audition step');
    const audio = controls
      ? renderSequence(auditionControlEvents(voice, step), { sampleRate, quality })
      : renderNote({ voice, note: step.note, velocity: step.velocity, duration: step.duration, sampleRate, pan: 0, quality });
    if (audio.left.length > slotFrames) throw new RangeError('Audition slot would truncate release');
    errors += audio.diagnostics.errors;
    left.set(audio.left, index * slotFrames);
    right.set(audio.right, index * slotFrames);
  }
  return { left, right, sampleRate, diagnostics: { errors } };
}

/** Attenuation-only shared energy target, peak-capped; NOT a perceptual loudness model. */
export function matchLevels(a: SoundMetrics, b: SoundMetrics, trimA = 0, trimB = 0): LevelMatch {
  if (!a.finite || !b.finite || a.gateRms <= 0 || b.gateRms <= 0) throw new RangeError('Cannot match invalid/silent audio');
  const targetDbFS = Math.min(-24, a.gateRmsDbFS + trimA, b.gateRmsDbFS + trimB,
    -12 - (a.peakDbFS - a.gateRmsDbFS), -12 - (b.peakDbFS - b.gateRmsDbFS));
  const trimDb = [targetDbFS - a.gateRmsDbFS, targetDbFS - b.gateRmsDbFS] as const;
  return { targetDbFS, trimDb, gains: trimDb.map(db => 10 ** (db / 20)) as [number, number] };
}

export interface SoundMetrics {
  peak: number;
  peakDbFS: number;
  rms: number;
  rmsDbFS: number;
  gateRms: number;
  gateRmsDbFS: number;
  crestDb: number;
  finite: boolean;
  suggestedTrimDb: number;
}

/** Stereo channel-mean energy; no perceptual weighting or LUFS claim. */
export function measureSound(left: Float32Array, right: Float32Array, gateFrames: number): SoundMetrics {
  if (left.length !== right.length || left.length === 0 || !Number.isInteger(gateFrames) ||
      gateFrames <= 0 || gateFrames > left.length) throw new RangeError('Invalid measurement window');
  let peak = 0;
  let power = 0;
  let gatePower = 0;
  let finite = true;
  for (let frame = 0; frame < left.length; frame++) {
    const l = left[frame];
    const r = right[frame];
    finite &&= Number.isFinite(l) && Number.isFinite(r);
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    const energy = (l * l + r * r) / 2;
    power += energy;
    if (frame < gateFrames) gatePower += energy;
  }
  const rms = Math.sqrt(power / left.length);
  const gateRms = Math.sqrt(gatePower / gateFrames);
  const peakDbFS = amplitudeDb(peak);
  const gateRmsDbFS = amplitudeDb(gateRms);
  return {
    peak, peakDbFS, rms, rmsDbFS: amplitudeDb(rms), gateRms, gateRmsDbFS,
    crestDb: peakDbFS - amplitudeDb(rms), finite,
    // Attenuate only. A single-note target, not a polyphony safety guarantee.
    suggestedTrimDb: Math.max(-24, Math.min(0, -12 - peakDbFS, -24 - gateRmsDbFS)),
  };
}

export function amplitudeDb(value: number): number {
  return value === 0 ? -Infinity : 20 * Math.log10(value);
}
