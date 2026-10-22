import test from 'node:test';
import assert from 'node:assert/strict';
import { createWavEncoder, encodeWav } from '../src/core/wav.js';
import type { WavFormat } from '../src/core/wav.js';

function join(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}

for (const format of ['pcm16', 'pcm24', 'float32'] as const) test(`${format} chunks form the same valid WAV as full encoding`, () => {
  const left = Float32Array.of(-1, -0.5, 0, 0.5, 1);
  const right = Float32Array.of(1, 0.25, -0.25, -1, 0);
  const encoder = createWavEncoder({ sampleRate: 48000, channels: 2, format, totalFrames: 5 });
  const parts = [encoder.header(), encoder.encode({ left: left.subarray(0, 2), right: right.subarray(0, 2) }), encoder.encode({ left: left.subarray(2), right: right.subarray(2) }), encoder.finalize()];
  const bytes = join(parts);
  assert.deepEqual(bytes, encodeWav({ left, right, sampleRate: 48000, format }));
  assert.equal(encoder.framesEncoded, 5);
  assert.equal(encoder.finished, true);
  assert.equal(encoder.byteLength, bytes.byteLength);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(view.getUint16(20, true), format === 'float32' ? 3 : 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(28, true), 48000 * 2 * (format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4));
  if (format === 'float32') {
    assert.equal(view.getUint32(16, true), 18);
    assert.equal(view.getUint16(36, true), 0);
    assert.equal(new TextDecoder().decode(bytes.subarray(38, 42)), 'fact');
    assert.equal(view.getUint32(42, true), 4);
    assert.equal(view.getUint32(46, true), 5);
    assert.equal(view.getUint32(54, true), 40);
    assert.equal(view.getFloat32(58, true), -1);
    assert.equal(view.getFloat32(62, true), 1);
  } else if (format === 'pcm16') {
    assert.equal(view.getUint32(40, true), 20);
    assert.equal(view.getInt16(44, true), -32768);
    assert.equal(view.getInt16(46, true), 32767);
  } else {
    assert.equal(view.getUint32(40, true), 30);
    assert.deepEqual(Array.from(bytes.subarray(44, 50)), [0, 0, 128, 255, 255, 127]);
  }
});

const decode24 = (bytes: Uint8Array, offset: number): number => ((bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16) << 8) >> 8;

for (const format of ['pcm16', 'pcm24'] as const) test(`${format} TPDF dither is chunk-independent, unbiased and clamped`, () => {
  const lsb = format === 'pcm16' ? 1 / 32767 : 1 / 8388607;
  const read = (bytes: Uint8Array, i: number): number => format === 'pcm16' ? new DataView(bytes.buffer).getInt16(44 + 2 * i, true) : decode24(bytes, 44 + 3 * i);
  // A 0.4 LSB sine rounds to digital silence; dither keeps it in the average.
  const frames = 48000, left = new Float32Array(frames);
  for (let i = 0; i < frames; i++) left[i] = 0.4 * lsb * Math.sin(2 * Math.PI * 441 * i / 48000);
  const plain = encodeWav({ left, sampleRate: 48000, format });
  const dithered = encodeWav({ left, sampleRate: 48000, format, dither: true });
  let plainMax = 0, correlation = 0, power = 0;
  for (let i = 0; i < frames; i++) {
    const reference = Math.sin(2 * Math.PI * 441 * i / 48000);
    plainMax = Math.max(plainMax, Math.abs(read(plain, i)));
    correlation += read(dithered, i) * reference;
    power += reference * reference;
    assert.ok(Math.abs(read(dithered, i)) <= 1, 'TPDF noise stays within ±1 LSB of a sub-LSB signal');
  }
  assert.equal(plainMax, 0, 'undithered sub-LSB audio truncates to silence');
  // E[Q(x + d)] = x for TPDF d, so the recovered amplitude estimates 0.4 LSB.
  assert.ok(Math.abs(correlation / power - 0.4) < 0.03, `recovered amplitude ${correlation / power}`);
  // Streaming continues one dither sequence: byte-identical to full encoding.
  // A chunk rejected midway (valid sample, then NaN) must not shift later noise.
  const encoder = createWavEncoder({ sampleRate: 48000, channels: 1, format, totalFrames: frames, dither: true });
  const parts = [encoder.header()];
  assert.throws(() => encoder.encode({ left: Float32Array.of(0.5, Number.NaN) }), /finite/);
  for (let start = 0; start < frames; start += 7000) parts.push(encoder.encode({ left: left.subarray(start, Math.min(frames, start + 7000)) }));
  parts.push(encoder.finalize());
  assert.deepEqual(join(parts), dithered);
  assert.deepEqual(encodeWav({ left, sampleRate: 48000, format, dither: true }), dithered, 'deterministic');
  // Full scale never wraps around.
  const extremes = new Float32Array(4000).map((_, i) => i % 2 ? 1 : -1);
  const clipped = encodeWav({ left: extremes, sampleRate: 48000, format, dither: true });
  const top = format === 'pcm16' ? 32767 : 8388607;
  for (let i = 0; i < extremes.length; i++) {
    const value = read(clipped, i);
    assert.ok(i % 2 ? value >= top - 1 && value <= top : value >= -top - 1 && value <= -top, `sample ${i} = ${value}`);
  }
});

test('dither options validate', () => {
  const left = Float32Array.of(0);
  assert.throws(() => encodeWav({ left, sampleRate: 48000, format: 'float32', dither: true }), /dither requires pcm16 or pcm24/);
  assert.throws(() => createWavEncoder({ sampleRate: 48000, channels: 1, totalFrames: 1, dither: 1 as unknown as boolean }), /dither must be a boolean/);
  assert.deepEqual(encodeWav({ left, sampleRate: 48000, format: 'float32', dither: false }), encodeWav({ left, sampleRate: 48000, format: 'float32' }));
});

test('monoPCM24 pads RIFF but not the data chunk', () => {
  const encoder = createWavEncoder({ sampleRate: 8000, channels: 1, format: 'pcm24', totalFrames: 1 });
  const header = encoder.header();
  assert.equal(new DataView(header.buffer).getUint32(40, true), 3);
  assert.equal(new DataView(header.buffer).getUint32(4, true), 40);
  assert.deepEqual(encoder.encode({ left: Float32Array.of(-1) }), Uint8Array.of(0, 0, 128));
  assert.deepEqual(encoder.finalize(), Uint8Array.of(0));
  assert.equal(encoder.byteLength, 48);
});

test('stream accounting survives invalid partial input, underrun, overrun and wrong channel shapes', () => {
  const encoder = createWavEncoder({ sampleRate: 8000, channels: 1, totalFrames: 3 });
  assert.throws(() => encoder.encode({ left: Float32Array.of(0) }), /header/);
  encoder.header();
  assert.throws(() => encoder.header(), /already/);
  for (const invalid of [NaN, Infinity, -1.01, 1.01]) {
    assert.throws(() => encoder.encode({ left: Float32Array.of(0.5, invalid) }), /finite/);
    assert.equal(encoder.framesEncoded, 0);
  }
  assert.throws(() => encoder.encode({ left: Float32Array.of(0), right: Float32Array.of(0) }), /channel count/);
  assert.throws(() => encoder.encode({ left: new Float32Array(65537) }), /65536/);
  assert.throws(() => encoder.encode({ left: new Float32Array(4) }), /overrun/);
  assert.throws(() => encoder.finalize(), /underrun/);
  encoder.encode({ left: Float32Array.of(-1, 0) });
  assert.throws(() => encoder.encode({ left: Float32Array.of(0, 1) }), /overrun/);
  assert.equal(encoder.framesEncoded, 2);
  assert.throws(() => encoder.finalize(), /underrun/);
  encoder.encode({ left: Float32Array.of(1) });
  encoder.finalize();
  assert.throws(() => encoder.finalize(), /unfinished/);
  assert.throws(() => encoder.encode({ left: Float32Array.of(0) }), /unfinished/);
});

test('streaming authenticates channels and own-data without evaluating accessors', () => {
  let reads = 0;
  const encoder = createWavEncoder({ sampleRate: 8000, channels: 1, totalFrames: 2 });
  encoder.header();
  const left = Float32Array.of(-1, 1);
  Object.defineProperty(left, 'length', { get() { reads++; return 1000000; } });
  const getter = { get left() { reads++; return left; } };
  assert.throws(() => encoder.encode(getter), /data/);
  for (const forged of [new Uint8Array(2), new Proxy(left, {}), Object.create(Float32Array.prototype)]) {
    assert.throws(() => encoder.encode({ left: forged as Float32Array }));
  }
  assert.equal(encoder.framesEncoded, 0);
  const bytes = encoder.encode({ left });
  assert.equal(new DataView(bytes.buffer).getInt16(0, true), -32768);
  assert.equal(reads, 0);
  encoder.finalize();
  const options = { sampleRate: 8000, channels: 1 as const, totalFrames: 1, get format(): WavFormat { reads++; return 'pcm24'; } };
  assert.throws(() => createWavEncoder(options), /data/);
  assert.equal(reads, 0);
});

test('streaming permits long files without full-buffer allocation but rejects RIFF32 overflow', () => {
  const encoder = createWavEncoder({ sampleRate: 48000, channels: 2, totalFrames: 4_000_001 });
  assert.equal(encoder.byteLength, 44 + 4_000_001 * 4);
  assert.equal(encoder.framesEncoded, 0);
  assert.throws(() => createWavEncoder({ sampleRate: 192000, channels: 2, format: 'float32', totalFrames: 0x20000000 }), /RIFF32/);
  assert.throws(() => createWavEncoder({ sampleRate: 8000, channels: 1, totalFrames: 8000 * 90000 }), /bounded/);
  const empty = createWavEncoder({ sampleRate: 8000, channels: 1, totalFrames: 0 });
  assert.equal(empty.header().byteLength, 44);
  assert.equal(empty.finalize().byteLength, 0);
  assert.throws(() => encodeWav({ sampleRate: 8000, left: new Float32Array(0) }), /4000000/);
});
