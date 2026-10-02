export const AUDITION_NOTES = [48, 60, 84] as const;
export const AUDITION_VELOCITIES = [0.25, 0.6, 1] as const;
export const AUDITION_GATE = 0.8;
export const AUDITION_GAIN = 0.12;

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
