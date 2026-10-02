import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/core/index.js';

test('WAV authenticates native channels and ignores shadowed length accessors', () => {
  let reads = 0;
  const left = Float32Array.of(0.25, -0.25);
  Object.defineProperty(left, 'length', { get() { reads++; return 4_000_001; } });
  const wav = encodeWav({ left, sampleRate: 8000 });
  const data = new DataView(wav.buffer);
  assert.equal(reads, 0);
  assert.equal(data.getUint32(40, true), 4);
  assert.equal(data.getInt16(44, true), 8192);
  assert.equal(data.getInt16(46, true), -8192);

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
  const keys = ['left', 'right', 'sampleRate'];
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
