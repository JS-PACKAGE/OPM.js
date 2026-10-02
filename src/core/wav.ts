import { sequenceOwnData } from './sequence.js';

export type WavFormat = 'pcm16' | 'pcm24' | 'float32';
export interface WavOptions { left: Float32Array; right?: Float32Array; sampleRate: number; format?: WavFormat }
export interface WavEncoderOptions { sampleRate: number; channels: 1 | 2; format?: WavFormat; totalFrames: number }
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

interface Layout { sampleRate: number; channels: 1 | 2; format: WavFormat; frames: number; sampleBytes: number; blockAlign: number; dataBytes: number; headerBytes: number; padding: number; byteLength: number }
function layout(input: unknown): Layout {
  const data = sequenceOwnData(input, ['sampleRate', 'channels', 'format', 'totalFrames'], ['sampleRate', 'channels', 'totalFrames'], 'WAV encoder options');
  const { sampleRate, channels, totalFrames } = data;
  const format = data.format === undefined ? 'pcm16' : data.format;
  if (!Number.isInteger(sampleRate) || (sampleRate as number) < 8000 || (sampleRate as number) > 192000) throw new RangeError('sampleRate must be an integer in 8000..192000');
  if (channels !== 1 && channels !== 2) throw new RangeError('channels must be1 or2');
  if (format !== 'pcm16' && format !== 'pcm24' && format !== 'float32') throw new RangeError('format must be pcm16, pcm24 or float32');
  if (!Number.isSafeInteger(totalFrames) || (totalFrames as number) < 0 || (totalFrames as number) > Math.ceil((24 * 60 * 60 + 10.01) * (sampleRate as number))) throw new RangeError('totalFrames must be a safe bounded nonnegative integer');
  const sampleBytes = format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4;
  const blockAlign = channels * sampleBytes;
  const dataBytes = (totalFrames as number) * blockAlign;
  // IEEE float uses WAVEFORMATEX (cbSize0) and a fact sample-count chunk.
  const headerBytes = format === 'float32' ? 58 : 44;
  const padding = dataBytes & 1;
  const byteLength = headerBytes + dataBytes + padding;
  if (byteLength - 8 > 0xffffffff) throw new RangeError('WAV exceeds RIFF32 size');
  return { sampleRate: sampleRate as number, channels, format, frames: totalFrames as number, sampleBytes, blockAlign, dataBytes, headerBytes, padding, byteLength };
}
function headerBytes(config: Layout): Uint8Array {
  const bytes = new Uint8Array(config.headerBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, config.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, config.format === 'float32' ? 18 : 16, true);
  view.setUint16(20, config.format === 'float32' ? 3 : 1, true);
  view.setUint16(22, config.channels, true); view.setUint32(24, config.sampleRate, true);
  view.setUint32(28, config.sampleRate * config.blockAlign, true); view.setUint16(32, config.blockAlign, true);
  view.setUint16(34, config.sampleBytes * 8, true);
  const dataOffset = config.format === 'float32' ? 50 : 36;
  if (config.format === 'float32') { text(38, 'fact'); view.setUint32(42, 4, true); view.setUint32(46, config.frames, true); }
  text(dataOffset, 'data'); view.setUint32(dataOffset + 4, config.dataBytes, true);
  return bytes;
}
function channels(input: unknown, expected?: 1 | 2): { left: Float32Array; right: Float32Array | undefined; frames: number } {
  const data = sequenceOwnData(input, ['left', 'right'], ['left'], 'WAV chunk');
  const { left, right } = data;
  if (typedArrayKind.call(left) !== 'Float32Array' || (right !== undefined && typedArrayKind.call(right) !== 'Float32Array')) throw new TypeError('WAV channels must be native Float32Arrays');
  const frames = typedArrayLength.call(left);
  if (right !== undefined && typedArrayLength.call(right) !== frames) throw new RangeError('WAV channels must have matching lengths');
  if (expected !== undefined && (right === undefined ? 1 : 2) !== expected) throw new RangeError('WAV chunk channel count must match encoder');
  return { left: left as Float32Array, right: right as Float32Array | undefined, frames };
}
// Capture each native sample once, including shared buffers; no metadata getters run.
function encodeInto(bytes: Uint8Array, offset: number, left: Float32Array, right: Float32Array | undefined, frames: number, config: Layout): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < config.channels; channel++, offset += config.sampleBytes) {
      const value = channel === 0 ? left[frame] : right![frame];
      if (!Number.isFinite(value) || value < -1 || value > 1) throw new RangeError('WAV samples must be finite and in -1..1');
      if (config.format === 'float32') view.setFloat32(offset, value, true);
      else if (config.format === 'pcm16') view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      else {
        const sample = Math.round(value * (value < 0 ? 8388608 : 8388607));
        bytes[offset] = sample & 255; bytes[offset + 1] = (sample >> 8) & 255; bytes[offset + 2] = (sample >> 16) & 255;
      }
    }
  }
}

/** Streaming RIFF32 output with known length; retains no PCM or emitted bytes. */
export function createWavEncoder(options: WavEncoderOptions): WavEncoder {
  const config = layout(options);
  let emittedHeader = false;
  let framesEncoded = 0;
  let finished = false;
  return Object.freeze({
    totalFrames: config.frames, byteLength: config.byteLength,
    get framesEncoded() { return framesEncoded; }, get finished() { return finished; },
    header() {
      if (emittedHeader || finished) throw new Error('WAV header already emitted');
      const bytes = headerBytes(config); emittedHeader = true; return bytes;
    },
    encode(input: WavChunk) {
      if (!emittedHeader || finished) throw new Error('WAV encoder requires an emitted header and unfinished state');
      const chunk = channels(input, config.channels);
      if (chunk.frames < 1 || chunk.frames > MAX_CHUNK_FRAMES) throw new RangeError('WAV chunk must contain1..65536 frames');
      if (framesEncoded + chunk.frames > config.frames) throw new RangeError('WAV frame overrun');
      const bytes = new Uint8Array(chunk.frames * config.blockAlign);
      encodeInto(bytes, 0, chunk.left, chunk.right, chunk.frames, config);
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
  const data = sequenceOwnData(input, ['left', 'right', 'sampleRate', 'format'], ['left', 'sampleRate'], 'WAV input');
  const chunk = channels({ left: data.left, right: data.right });
  if (chunk.frames < 1 || chunk.frames > MAX_WAV_FRAMES) throw new RangeError('WAV channels must be matching Float32Arrays of1..4000000 frames');
  const config = layout({ sampleRate: data.sampleRate, channels: chunk.right === undefined ? 1 : 2, format: data.format, totalFrames: chunk.frames });
  const bytes = new Uint8Array(config.byteLength);
  bytes.set(headerBytes(config));
  encodeInto(bytes, config.headerBytes, chunk.left, chunk.right, chunk.frames, config);
  return bytes;
}
