import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/core/index.js';

test('WAV authenticates native channels and ignores shadowed metadata accessors', () => {
  let reads = 0;
  const left = Float32Array.of(0.25, -0.25);
  Object.defineProperty(left, 'length', { get() { reads++; return 4_000_001; } });
  const wav = encodeWav({ left, sampleRate: 8000 });
  const data = new DataView(wav.buffer);
  assert.equal(reads, 0);
  assert.equal(data.getUint32(40, true), 4);
  assert.equal(data.getInt16(44, true), 8192);
  assert.equal(data.getInt16(46, true), -8192);

  const pattern = [0xbf800000, 0x80000000, 0x80000001, 0x00000001, 0, 0x3f800000];
  for (const frames of [127, 128, 129, 1023, 1024, 1025]) for (const suffix of [0, 3]) {
    const buffer = new ArrayBuffer(12 + frames * 4 + suffix), otherBuffer = new ArrayBuffer(frames * 4 + suffix);
    const channel = new Float32Array(buffer, 12, frames), words = new Uint32Array(buffer, 12, frames);
    const right = new Float32Array(otherBuffer, 0, frames), rightWords = new Uint32Array(otherBuffer, 0, frames);
    for (let frame = 0; frame < frames; frame++) {
      words[frame] = pattern[frame % pattern.length]; rightWords[frame] = pattern[(frames - 1 - frame) % pattern.length];
    }
    for (const source of [channel, right]) for (const key of ['length', 'buffer', 'byteOffset', 'byteLength', 'constructor']) {
      Object.defineProperty(source, key, { get() { reads++; throw new Error('WAV must not read caller metadata'); } });
    }
    for (const second of [undefined, right, channel]) {
      const channels = second === undefined ? 1 : 2;
      const encoded = encodeWav({ left: channel, right: second, sampleRate: 8000, format: 'float32' }), view = new DataView(encoded.buffer);
      assert.equal(encoded.byteOffset, 0);
      assert.equal(encoded.byteLength, 58 + frames * channels * 4);
      assert.equal(view.getUint16(20, true), 3);
      assert.equal(view.getUint32(54, true), frames * channels * 4);
      for (let frame = 0; frame < frames; frame++) {
        const offset = 58 + frame * channels * 4;
        assert.equal(view.getUint32(offset, true), pattern[frame % pattern.length]);
        if (second !== undefined) assert.equal(view.getUint32(offset + 4, true), pattern[(second === channel ? frame : frames - 1 - frame) % pattern.length]);
      }
    }
  }

  const oversized = new Float32Array(4_000_001);
  Object.defineProperty(oversized, 'length', { get() { reads++; return 1; } });
  assert.throws(() => encodeWav({ left: oversized, sampleRate: 8000 }), /4000000/);
  const forged: unknown = Object.create(Float32Array.prototype);
  Object.defineProperties(forged as object, {
    length: { value: 1 },
    0: { get() { reads++; return 0; } },
  });
  for (const channel of [forged, new Proxy(left, {}), new Uint8Array(2)]) {
    assert.throws(() => encodeWav({ left: channel, sampleRate: 8000 } as unknown as Parameters<typeof encodeWav>[0]));
    assert.throws(() => encodeWav({ left: Float32Array.of(0), right: channel, sampleRate: 8000 } as unknown as Parameters<typeof encodeWav>[0]));
  }
  assert.equal(reads, 0);
});

test('WAV optional and required fields never use inherited values or getters', () => {
  const keys = ['left', 'right', 'sampleRate', 'format', 'dither'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  let reads = 0;
  let wav: Uint8Array | undefined;
  let missingError: unknown;
  try {
    for (const key of keys) Object.defineProperty(Object.prototype, key, {
      configurable: true,
      get() { reads++; return key === 'sampleRate' ? 8000 : Float32Array.of(0); },
    });
    wav = encodeWav({ left: Float32Array.of(0), sampleRate: 8000 });
    try { encodeWav({} as unknown as Parameters<typeof encodeWav>[0]); } catch (error) { missingError = error; }
  } finally {
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(Object.prototype, key, original);
      else Reflect.deleteProperty(Object.prototype, key);
    }
  }
  assert.equal(reads, 0);
  assert.ok(wav);
  assert.equal(new DataView(wav.buffer).getUint16(22, true), 1);
  assert.ok(missingError instanceof TypeError);
});
