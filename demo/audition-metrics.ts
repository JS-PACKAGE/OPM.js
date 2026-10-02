import { renderNote } from '../src/core/index.js';
import type { FrozenVoice, Voice } from '../src/voices/schema.js';

export const AUDITION_NOTES = [48, 60, 84] as const;
export const AUDITION_VELOCITIES = [0.25, 0.6, 1] as const;
export const AUDITION_GATE = 0.8;
export const AUDITION_GAIN = 0.12;
export const AUDITION_SEED = 20261002;

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

/** Bounded six-note dry phrase; equal slot windows prevent release length bias between sources. */
export function renderAudition(voice: Voice | FrozenVoice, steps: readonly AuditionStep[], slotSeconds: number, sampleRate = 48000): AuditionAudio {
  if (steps.length < 1 || steps.length > 6 || !Number.isFinite(slotSeconds) || slotSeconds <= 0 || slotSeconds > 12) {
    throw new RangeError('Invalid audition phrase bounds');
  }
  const slotFrames = Math.ceil(slotSeconds * sampleRate);
  const left = new Float32Array(slotFrames * steps.length);
  const right = new Float32Array(left.length);
  let errors = 0;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const audio = renderNote({ voice, note: step.note, velocity: step.velocity, duration: step.duration, sampleRate, pan: 0 });
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
