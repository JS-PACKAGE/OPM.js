export interface WavOptions { left: Float32Array; right?: Float32Array; sampleRate: number }

const MAX_WAV_FRAMES = 4_000_000;
const typedArrayPrototype: object = Object.getPrototypeOf(Float32Array.prototype);
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get! as (this: unknown) => number;
const typedArrayKind = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get! as (this: unknown) => string | undefined;

// PCM16 little-endian RIFF/WAVE. Inputs are already normalized audio; reject
// invalid samples instead of hiding DSP errors behind clipping or silence.
/** PCM16 little-endian RIFF/WAVE, mono if right is omitted, stereo otherwise. */
export function encodeWav(input: WavOptions): Uint8Array;
export function encodeWav(input: unknown): Uint8Array {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError('WAV input must be a plain object');
  }
  for (const key of Reflect.ownKeys(input)) {
    if (!['left', 'right', 'sampleRate'].includes(key as string) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, 'value')) {
      throw new TypeError('WAV input must contain only audio data fields');
    }
  }
  if (!Object.hasOwn(input, 'left') || !Object.hasOwn(input, 'sampleRate')) {
    throw new TypeError('WAV input requires own left and sampleRate fields');
  }
  const left: unknown = Object.getOwnPropertyDescriptor(input, 'left')!.value;
  const right: unknown = Object.getOwnPropertyDescriptor(input, 'right')?.value;
  const sampleRate: unknown = Object.getOwnPropertyDescriptor(input, 'sampleRate')!.value;
  if (!Number.isInteger(sampleRate) || (sampleRate as number) < 8000 || (sampleRate as number) > 192000) {
    throw new RangeError('sampleRate must be an integer in 8000..192000');
  }
  if (typedArrayKind.call(left) !== 'Float32Array' ||
      (right !== undefined && typedArrayKind.call(right) !== 'Float32Array')) {
    throw new TypeError('WAV channels must be native Float32Arrays');
  }
  const frames = typedArrayLength.call(left);
  if (frames < 1 || frames > MAX_WAV_FRAMES ||
      (right !== undefined && typedArrayLength.call(right) !== frames)) {
    throw new RangeError('WAV channels must be matching Float32Arrays of 1..4000000 frames');
  }
  const channels = right === undefined ? 1 : 2;
  const blockAlign = channels * 2;
  const dataBytes = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate as number, true);
  view.setUint32(28, (sampleRate as number) * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  // Capture each native sample once and validate before encoding, including
  // shared buffers that may change concurrently. Metadata getters never run.
  for (let i = 0, offset = 44; i < frames; i++, offset += blockAlign) {
    const l = (left as Float32Array)[i];
    const r = right === undefined ? undefined : (right as Float32Array)[i];
    if (!Number.isFinite(l) || l < -1 || l > 1 ||
        (right !== undefined && (!Number.isFinite(r) || r! < -1 || r! > 1))) {
      throw new RangeError('WAV samples must be finite and in -1..1');
    }
    view.setInt16(offset, Math.round(l * (l < 0 ? 32768 : 32767)), true);
    if (right !== undefined) view.setInt16(offset + 2, Math.round(r! * (r! < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
