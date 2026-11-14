import { sequenceOwnData } from './sequence.js';

export type WavFormat = 'pcm16' | 'pcm24' | 'float32';
/** `dither: true` adds deterministic TPDF dither (±1 LSB triangular noise) before
 * rounding to `pcm16`/`pcm24`, trading truncation distortion in quiet passages and
 * fades for a constant noise floor; digital silence becomes that noise. */
export interface WavOptions { left: Float32Array; right?: Float32Array; sampleRate: number; format?: WavFormat; dither?: boolean }
export interface WavEncoderOptions { sampleRate: number; channels: 1 | 2; format?: WavFormat; totalFrames: number; dither?: boolean }
export interface WavChunk { left: Float32Array; right?: Float32Array }
export interface WavEncoder {
  readonly totalFrames: number;
  readonly framesEncoded: number;
  /** Entire file length, including the header and any RIFF alignment byte. */
  readonly byteLength: number;
  readonly finished: boolean;
  /** Emit exactly once, before encoding PCM. */
  header(): Uint8Array;
  /** Atomic accounting: invalid chunks never consume frames. Maximum65536 frames per call. */
  encode(chunk: WavChunk): Uint8Array;
  /** Require exact totalFrames; returns the RIFF alignment byte, or an empty array. */
  finalize(): Uint8Array;
}

const MAX_WAV_FRAMES = 4_000_000;
const MAX_CHUNK_FRAMES = 65536;
const typedArrayPrototype: object = Object.getPrototypeOf(Float32Array.prototype);
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get! as (this: unknown) => number;
const typedArrayKind = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get! as (this: unknown) => string | undefined;
const NativeFloat32Array = Float32Array;
const NativeInt16Array = Int16Array;
const typedArraySet = Float32Array.prototype.set;
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

interface Layout { sampleRate: number; channels: 1 | 2; format: WavFormat; dither: boolean; frames: number; sampleBytes: number; blockAlign: number; dataBytes: number; headerBytes: number; padding: number; byteLength: number }
function layout(data: Record<string, unknown>): Layout {
  const { sampleRate, channels, totalFrames } = data;
  const format = data.format === undefined ? 'pcm16' : data.format;
  const dither = data.dither === undefined ? false : data.dither;
  if (!Number.isInteger(sampleRate) || (sampleRate as number) < 8000 || (sampleRate as number) > 192000) throw new RangeError('sampleRate must be an integer in 8000..192000');
  if (channels !== 1 && channels !== 2) throw new RangeError('channels must be1 or2');
  if (format !== 'pcm16' && format !== 'pcm24' && format !== 'float32') throw new RangeError('format must be pcm16, pcm24 or float32');
  if (typeof dither !== 'boolean') throw new TypeError('dither must be a boolean');
  if (dither && format === 'float32') throw new RangeError('dither requires pcm16 or pcm24');
  if (!Number.isSafeInteger(totalFrames) || (totalFrames as number) < 0 || (totalFrames as number) > Math.ceil((24 * 60 * 60 + 10.01) * (sampleRate as number))) throw new RangeError('totalFrames must be a safe bounded nonnegative integer');
  const sampleBytes = format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4;
  const blockAlign = channels * sampleBytes;
  const dataBytes = (totalFrames as number) * blockAlign;
  // IEEE float uses WAVEFORMATEX (cbSize0) and a fact sample-count chunk.
  const headerBytes = format === 'float32' ? 58 : 44;
  const padding = dataBytes & 1;
  const byteLength = headerBytes + dataBytes + padding;
  if (byteLength - 8 > 0xffffffff) throw new RangeError('WAV exceeds RIFF32 size');
  return { sampleRate: sampleRate as number, channels, format, dither, frames: totalFrames as number, sampleBytes, blockAlign, dataBytes, headerBytes, padding, byteLength };
}
function writeHeader(bytes: Uint8Array, config: Layout): void {
  const view = new DataView(bytes.buffer);
  // Chunk IDs are big-endian ASCII words; numeric RIFF fields stay little-endian.
  view.setUint32(0, 0x52494646); // RIFF
  view.setUint32(4, config.byteLength - 8, true);
  view.setUint32(8, 0x57415645); // WAVE
  view.setUint32(12, 0x666d7420); // fmt
  view.setUint32(16, config.format === 'float32' ? 18 : 16, true);
  view.setUint16(20, config.format === 'float32' ? 3 : 1, true);
  view.setUint16(22, config.channels, true); view.setUint32(24, config.sampleRate, true);
  view.setUint32(28, config.sampleRate * config.blockAlign, true); view.setUint16(32, config.blockAlign, true);
  view.setUint16(34, config.sampleBytes * 8, true);
  const dataOffset = config.format === 'float32' ? 50 : 36;
  if (config.format === 'float32') {
    view.setUint32(38, 0x66616374); // fact
    view.setUint32(42, 4, true); view.setUint32(46, config.frames, true);
  }
  view.setUint32(dataOffset, 0x64617461); // data
  view.setUint32(dataOffset + 4, config.dataBytes, true);
}
function channels(left: unknown, right: unknown, expected?: 1 | 2): { left: Float32Array; right: Float32Array | undefined; frames: number } {
  if (typedArrayKind.call(left) !== 'Float32Array' || (right !== undefined && typedArrayKind.call(right) !== 'Float32Array')) throw new TypeError('WAV channels must be native Float32Arrays');
  const frames = typedArrayLength.call(left);
  if (right !== undefined && typedArrayLength.call(right) !== frames) throw new RangeError('WAV channels must have matching lengths');
  if (expected !== undefined && (right === undefined ? 1 : 2) !== expected) throw new RangeError('WAV chunk channel count must match encoder');
  return { left: left as Float32Array, right: right as Float32Array | undefined, frames };
}
// TPDF dither from xorshift32 (Marsaglia): fixed seed per encoder, so chunked and
// full-buffer encodings of the same audio are byte-identical and reproducible.
const DITHER_SEED = 0x9e3779b9;
// Fixed PCM16 loops avoid per-sample channel/format dispatch without enlarging the generic loop.
// These undithered Float32 products use at most 47 significant bits, leaving room
// for floor(x + 0.5) rounding; integer bytes discard signed zero. Dither stays separate.
function encodePcm16(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number): number {
  if (right === undefined) {
    for (let frame = 0; frame < frames; frame++, offset += 2) {
      const value = left[frame];
      if (!(Math.abs(value) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
      const sample = Math.floor(value * (value < 0 ? 32768 : 32767) + 0.5);
      bytes[offset] = sample & 255; bytes[offset + 1] = (sample >> 8) & 255;
    }
    return 0;
  }
  for (let frame = 0; frame < frames; frame++, offset += 4) {
    const first = left[frame];
    if (!(Math.abs(first) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const firstSample = Math.floor(first * (first < 0 ? 32768 : 32767) + 0.5);
    bytes[offset] = firstSample & 255; bytes[offset + 1] = (firstSample >> 8) & 255;
    const second = right[frame];
    if (!(Math.abs(second) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const secondSample = Math.floor(second * (second < 0 ? 32768 : 32767) + 0.5);
    bytes[offset + 2] = secondSample & 255; bytes[offset + 3] = (secondSample >> 8) & 255;
  }
  return 0;
}

// PCM16 data starts at aligned byte 0/44; native words are selected only on little-endian hosts.
function encodePcm16Words(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number): number {
  // Amortize the extra output view over at least one ordinary audio quantum.
  if (frames < 128) return encodePcm16(bytes, offset, left, right, frames);
  const samples = new NativeInt16Array(bytes.buffer, bytes.byteOffset + offset, right === undefined ? frames : frames * 2);
  if (right === undefined) {
    for (let frame = 0; frame < frames; frame++) {
      const value = left[frame];
      if (!(Math.abs(value) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
      samples[frame] = Math.floor(value * (value < 0 ? 32768 : 32767) + 0.5);
    }
    return 0;
  }
  for (let frame = 0, index = 0; frame < frames; frame++, index += 2) {
    const first = left[frame];
    if (!(Math.abs(first) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    samples[index] = Math.floor(first * (first < 0 ? 32768 : 32767) + 0.5);
    const second = right[frame];
    if (!(Math.abs(second) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    samples[index + 1] = Math.floor(second * (second < 0 ? 32768 : 32767) + 0.5);
  }
  return 0;
}

function encodePcm24(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number): number {
  if (right === undefined) {
    for (let frame = 0; frame < frames; frame++, offset += 3) {
      const value = left[frame];
      if (!(Math.abs(value) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
      const sample = Math.floor(value * (value < 0 ? 8388608 : 8388607) + 0.5);
      bytes[offset] = sample & 255; bytes[offset + 1] = (sample >> 8) & 255; bytes[offset + 2] = (sample >> 16) & 255;
    }
    return 0;
  }
  for (let frame = 0; frame < frames; frame++, offset += 6) {
    const first = left[frame];
    if (!(Math.abs(first) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const firstSample = Math.floor(first * (first < 0 ? 8388608 : 8388607) + 0.5);
    bytes[offset] = firstSample & 255; bytes[offset + 1] = (firstSample >> 8) & 255; bytes[offset + 2] = (firstSample >> 16) & 255;
    const second = right[frame];
    if (!(Math.abs(second) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const secondSample = Math.floor(second * (second < 0 ? 8388608 : 8388607) + 0.5);
    bytes[offset + 3] = secondSample & 255; bytes[offset + 4] = (secondSample >> 8) & 255; bytes[offset + 5] = (secondSample >> 16) & 255;
  }
  return 0;
}

// Six stereo PCM24 bytes form three aligned LE16 words; the middle joins Lhi8/Rlo8.
function encodeStereoPcm24Words(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number): number {
  if (frames < 128) return encodePcm24(bytes, offset, left, right, frames);
  const samples = new NativeInt16Array(bytes.buffer, bytes.byteOffset + offset, frames * 3);
  for (let frame = 0, index = 0; frame < frames; frame++, index += 3) {
    const first = left[frame];
    if (!(Math.abs(first) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const firstSample = Math.floor(first * (first < 0 ? 8388608 : 8388607) + 0.5);
    samples[index] = firstSample;
    const second = right![frame];
    if (!(Math.abs(second) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const secondSample = Math.floor(second * (second < 0 ? 8388608 : 8388607) + 0.5);
    samples[index + 1] = ((firstSample >>> 16) & 255) | (secondSample << 8);
    samples[index + 2] = secondSample >> 8;
  }
  return 0;
}

// Pair mono samples into LE16 words without including an odd tail or RIFF padding.
function encodeMonoPcm24Words(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number): number {
  if (frames < 128) return encodePcm24(bytes, offset, left, right, frames);
  const pairedFrames = frames & ~1;
  const samples = new NativeInt16Array(bytes.buffer, bytes.byteOffset + offset, (pairedFrames >>> 1) * 3);
  for (let frame = 0, index = 0; frame < pairedFrames; frame += 2, index += 3) {
    const first = left[frame];
    if (!(Math.abs(first) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const firstSample = Math.floor(first * (first < 0 ? 8388608 : 8388607) + 0.5);
    samples[index] = firstSample;
    const second = left[frame + 1];
    if (!(Math.abs(second) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const secondSample = Math.floor(second * (second < 0 ? 8388608 : 8388607) + 0.5);
    samples[index + 1] = ((firstSample >>> 16) & 255) | (secondSample << 8);
    samples[index + 2] = secondSample >> 8;
  }
  if (pairedFrames !== frames) {
    const value = left[pairedFrames];
    if (!(Math.abs(value) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const sample = Math.floor(value * (value < 0 ? 8388608 : 8388607) + 0.5);
    const tail = offset + pairedFrames * 3;
    bytes[tail] = sample & 255; bytes[tail + 1] = (sample >> 8) & 255; bytes[tail + 2] = (sample >> 16) & 255;
  }
  return 0;
}

// Capture each native sample once, including shared buffers; no metadata getters run.
function encodeInto(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number, config: Layout, ditherSeed: number): number {
  // Float PCM needs validation and endian conversion, but no integer quantization.
  if (config.format === 'float32') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (right === undefined) {
      for (let frame = 0; frame < frames; frame++, offset += 4) {
        const value = left[frame];
        if (!(Math.abs(value) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
        view.setFloat32(offset, value, true);
      }
    } else {
      for (let frame = 0; frame < frames; frame++, offset += 8) {
        const first = left[frame];
        if (!(Math.abs(first) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
        view.setFloat32(offset, first, true);
        const second = right[frame];
        if (!(Math.abs(second) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
        view.setFloat32(offset + 4, second, true);
      }
    }
    return ditherSeed;
  }
  const pcm16 = config.format === 'pcm16';
  const negativeScale = pcm16 ? 32768 : 8388608;
  const positiveScale = pcm16 ? 32767 : 8388607;
  const minSample = -negativeScale;
  // Undithered integers use fixed writers; this path always advances active TPDF.
  let s = ditherSeed | 0;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < config.channels; channel++, offset += config.sampleBytes) {
      const value = channel === 0 ? left[frame] : right![frame];
      // NaN fails the ordered magnitude bound, alongside infinities and out-of-range samples.
      if (!(Math.abs(value) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
      const scaled = value * (value < 0 ? negativeScale : positiveScale);
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      const a = s >>> 0;
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      const noise = (a - (s >>> 0)) * 2 ** -32;
      const sample = Math.min(positiveScale, Math.max(minSample, Math.round(scaled + noise)));
      bytes[offset] = sample & 255; bytes[offset + 1] = (sample >> 8) & 255;
      if (!pcm16) bytes[offset + 2] = (sample >> 16) & 255;
    }
  }
  return s >>> 0;
}

// Streaming float chunks are aligned; full float WAV data starts at byte 58.
function encodeMonoFloat32(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number, config: Layout, ditherSeed: number): number {
  if (typedArrayLength.call(left) !== frames) return encodeInto(bytes, offset, left, right, frames, config, ditherSeed);
  const samples = new NativeFloat32Array(bytes.buffer, bytes.byteOffset + offset, frames);
  try {
    typedArraySet.call(samples, left);
  } catch (error) {
    // A length-tracking shared source can grow after admission. Encode only its admitted prefix.
    if (typedArrayLength.call(left) <= frames) throw error;
    return encodeInto(bytes, offset, left, right, frames, config, ditherSeed);
  }
  // Validate the private copy, never re-read mutable shared input after validating it.
  for (let frame = 0; frame < frames; frame++) {
    if (!(Math.abs(samples[frame]) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
  }
  return ditherSeed;
}

function encodeStereoFloat32(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number): number {
  const samples = new NativeFloat32Array(bytes.buffer, bytes.byteOffset + offset, frames * 2);
  for (let frame = 0, index = 0; frame < frames; frame++, index += 2) {
    const first = left[frame];
    if (!(Math.abs(first) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    samples[index] = first;
    const second = right![frame];
    if (!(Math.abs(second) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    samples[index + 1] = second;
  }
  return 0;
}

// Channel admission fixes stereo shape; validate/draw/store left before reading right.
function encodeStereoDither(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number, config: Layout, ditherSeed: number): number {
  const pcm16 = config.format === 'pcm16';
  const negativeScale = pcm16 ? 32768 : 8388608;
  const positiveScale = pcm16 ? 32767 : 8388607;
  const minSample = -negativeScale;
  let s = ditherSeed | 0;
  const sampleBytes = config.sampleBytes;
  const frameBytes = sampleBytes * 2;
  for (let frame = 0; frame < frames; frame++, offset += frameBytes) {
    const first = left[frame];
    if (!(Math.abs(first) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const firstScaled = first * (first < 0 ? negativeScale : positiveScale);
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const a = s >>> 0;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const firstNoise = (a - (s >>> 0)) * 2 ** -32;
    const firstSample = Math.min(positiveScale, Math.max(minSample, Math.round(firstScaled + firstNoise)));
    bytes[offset] = firstSample & 255; bytes[offset + 1] = (firstSample >> 8) & 255;
    if (!pcm16) bytes[offset + 2] = (firstSample >> 16) & 255;
    const second = right![frame];
    if (!(Math.abs(second) <= 1)) throw new RangeError('WAV samples must be finite and in -1..1');
    const secondScaled = second * (second < 0 ? negativeScale : positiveScale);
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const b = s >>> 0;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const secondNoise = (b - (s >>> 0)) * 2 ** -32;
    const secondSample = Math.min(positiveScale, Math.max(minSample, Math.round(secondScaled + secondNoise)));
    const secondOffset = offset + sampleBytes;
    bytes[secondOffset] = secondSample & 255; bytes[secondOffset + 1] = (secondSample >> 8) & 255;
    if (!pcm16) bytes[secondOffset + 2] = (secondSample >> 16) & 255;
  }
  return s >>> 0;
}

/** Streaming RIFF32 output with known length; retains no PCM or emitted bytes. */
export function createWavEncoder(options: WavEncoderOptions): WavEncoder {
  const data = sequenceOwnData(options, ['sampleRate', 'channels', 'format', 'totalFrames', 'dither'], ['sampleRate', 'channels', 'totalFrames'], 'WAV encoder options');
  const config = layout(data);
  const encodeSamples: typeof encodeInto = !config.dither && config.format === 'pcm16' ? (LITTLE_ENDIAN ? encodePcm16Words : encodePcm16)
    : !config.dither && config.format === 'pcm24' ? (LITTLE_ENDIAN ? (config.channels === 1 ? encodeMonoPcm24Words : encodeStereoPcm24Words) : encodePcm24)
      : config.format === 'float32' && LITTLE_ENDIAN
        ? config.channels === 1 ? encodeMonoFloat32 : encodeStereoFloat32
        : config.dither && config.channels === 2 ? encodeStereoDither : encodeInto;
  let emittedHeader = false;
  let framesEncoded = 0;
  let finished = false;
  let committedDitherState = config.dither ? DITHER_SEED : 0;
  return Object.freeze({
    totalFrames: config.frames, byteLength: config.byteLength,
    get framesEncoded() { return framesEncoded; }, get finished() { return finished; },
    header() {
      if (emittedHeader || finished) throw new Error('WAV header already emitted');
      const bytes = new Uint8Array(config.headerBytes); writeHeader(bytes, config); emittedHeader = true; return bytes;
    },
    encode(input: WavChunk) {
      if (!emittedHeader || finished) throw new Error('WAV encoder requires an emitted header and unfinished state');
      const data = sequenceOwnData(input, ['left', 'right'], ['left'], 'WAV chunk');
      const chunk = channels(data.left, data.right, config.channels);
      if (chunk.frames < 1 || chunk.frames > MAX_CHUNK_FRAMES) throw new RangeError('WAV chunk must contain1..65536 frames');
      if (framesEncoded + chunk.frames > config.frames) throw new RangeError('WAV frame overrun');
      const bytes = new Uint8Array(chunk.frames * config.blockAlign);
      // Commit only after the complete sample transaction succeeds.
      committedDitherState = encodeSamples(bytes, 0, chunk.left, chunk.right, chunk.frames, config, committedDitherState);
      framesEncoded += chunk.frames;
      return bytes;
    },
    finalize() {
      if (!emittedHeader || finished) throw new Error('WAV encoder requires an emitted header and unfinished state');
      if (framesEncoded !== config.frames) throw new RangeError('WAV frame underrun');
      const bytes = new Uint8Array(config.padding); finished = true; return bytes;
    },
  });
}

/** Full-buffer WAV convenience export; defaultPCM16, at most4000000 frames. */
export function encodeWav(input: WavOptions): Uint8Array {
  const data = sequenceOwnData(input, ['left', 'right', 'sampleRate', 'format', 'dither'], ['left', 'sampleRate'], 'WAV input');
  const chunk = channels(data.left, data.right);
  if (chunk.frames < 1 || chunk.frames > MAX_WAV_FRAMES) throw new RangeError('WAV channels must be matching Float32Arrays of1..4000000 frames');
  const config = layout({ sampleRate: data.sampleRate, channels: chunk.right === undefined ? 1 : 2, format: data.format, dither: data.dither, totalFrames: chunk.frames });
  const encodeSamples: typeof encodeInto = !config.dither && config.format === 'pcm16' ? (LITTLE_ENDIAN ? encodePcm16Words : encodePcm16)
    : !config.dither && config.format === 'pcm24' ? (LITTLE_ENDIAN ? (config.channels === 1 ? encodeMonoPcm24Words : encodeStereoPcm24Words) : encodePcm24)
      : config.dither && config.channels === 2 ? encodeStereoDither : encodeInto;
  const bytes = new Uint8Array(config.byteLength);
  writeHeader(bytes, config);
  encodeSamples(bytes, config.headerBytes, chunk.left, chunk.right, chunk.frames, config, config.dither ? DITHER_SEED : 0);
  return bytes;
}
