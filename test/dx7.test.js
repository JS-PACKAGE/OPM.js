import test from 'node:test';
import assert from 'node:assert/strict';
import { importDX7, describeDX7 } from '../src/voices/dx7.js';
import { normalizeVoice } from '../src/voices/normalize.js';
import { parseVoiceBank } from '../src/voices/schema.js';
import { ALGORITHMS, renderNote } from '../src/core/index.js';

// Original generated fixtures, based on Yamaha DX7 pp30–31 and DX7II Add-11.
// No downloaded patch banks or emulator implementation/fixtures are used.
function singlePayload(name = 'DX TEST') {
  const data = new Uint8Array(155);
  for (let slot = 0; slot < 6; slot++) {
    data.set([99, 75, 60, 65, 99, 90, 75, 0, 39, 10, 20, 1, 0, 3, 2, 5,
      84 + slot, 0, slot + 1, 50, 8], slot * 21);
  }
  data.set([99, 99, 99, 99, 50, 50, 50, 50, 0, 3, 1, 40, 0, 20, 30, 1, 4, 3, 24], 126);
  setName(data, 145, name);
  return data;
}
function packedPayload(name = 'DX TEST') {
  const data = new Uint8Array(128);
  for (let slot = 0; slot < 6; slot++) {
    // LC1/RC0; DT8/RS3 = 67; TS5/AMS2 = 22; mode0/coarse(slot+1).
    data.set([99, 75, 60, 65, 99, 90, 75, 0, 39, 10, 20, 1, 67, 22,
      84 + slot, (slot + 1) * 2, 50], slot * 17);
  }
  // Feedback3/sync1 = 11; PMS3/wave4/sync1 = 57.
  data.set([99, 99, 99, 99, 50, 50, 50, 50, 0, 11, 40, 0, 20, 30, 57, 24], 102);
  setName(data, 118, name);
  return data;
}
function setName(data, offset, name) {
  for (let n = 0; n < 10; n++) data[offset + n] = n < name.length ? name.charCodeAt(n) : 32;
}
function message(data, channel = 0) {
  const bytes = new Uint8Array(data.length + 8);
  bytes.set([0xf0, 0x43, channel, data.length === 155 ? 0 : 9, data.length >> 7, data.length & 127]);
  bytes.set(data, 6);
  let sum = 0;
  for (const value of data) sum += value;
  bytes[bytes.length - 2] = (-sum) & 127;
  bytes[bytes.length - 1] = 0xf7;
  return bytes;
}
function bankPayload() {
  const data = new Uint8Array(4096);
  for (let n = 0; n < 32; n++) data.set(packedPayload(), n * 128);
  return data;
}
function rms(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

// Source carrier roles independently read from Yamaha PLG150-DX pp34–35.
const carriers = [
  [1, 3], [1, 3], [1, 4], [1, 4], [1, 3, 5], [1, 3, 5], [1, 3], [1, 3], [1, 3],
  [1, 4], [1, 4], [1, 3], [1, 3], [1, 3], [1, 3], [1], [1], [1], [1, 4, 5],
  [1, 2, 4], [1, 2, 4, 5], [1, 3, 4, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5],
  [1, 2, 3, 4, 5], [1, 2, 4], [1, 2, 4], [1, 3, 6], [1, 2, 3, 5], [1, 2, 3, 6],
  [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6],
];

test('standard single and packed bank layouts produce equivalent normalized usable voices', () => {
  const single = message(singlePayload(), 15);
  const snapshot = single.slice();
  const voice = importDX7(single)[0];
  const bank = importDX7(message(bankPayload(), 7));
  assert.deepEqual(bank[0], voice);
  assert.deepEqual(single, snapshot);
  assert.deepEqual(importDX7(single), [voice]);
  assert.deepEqual(normalizeVoice(voice), voice);
  assert.equal(voice.version, 2);
  assert.equal(voice.ops[0].keyScale.breakpoint, 60);
  assert.equal(parseVoiceBank(bank).size, 32);
  const rendered = renderNote({ voice, note: 60, duration: 0.15, sampleRate: 8000 });
  assert.deepEqual(rendered.diagnostics, { errors: 0 });
  assert.ok(rms(rendered.samples.subarray(200, 1000)) > 0.001);
  assert.ok(rendered.samples.every(Number.isFinite));
});

test('all 32 algorithms retain loudest source carriers as output carriers', () => {
  for (let algorithm = 0; algorithm < 32; algorithm++) {
    const data = singlePayload();
    data[134] = algorithm;
    const bytes = message(data);
    const voice = importDX7(bytes)[0];
    const description = describeDX7(bytes)[0];
    const outputCarriers = ALGORITHMS[voice.algorithm].carriers.map(index => description.selectedOperators[index]);
    assert.deepEqual(outputCarriers.sort((a, b) => a - b), carriers[algorithm].slice(0, 4), `algorithm ${algorithm + 1}`);
    assert.deepEqual(normalizeVoice(voice), voice);
    assert.ok(description.warnings.some(warning => /not DX7 synthesis/.test(warning)));
  }
});

test('an isolated high-numbered carrier is not lost behind quiet lower-numbered operators', () => {
  const data = singlePayload();
  data[134] = 27; // Algorithm28: carriers1,3,6; OP6 is an unmodulated sine.
  for (let slot = 0; slot < 6; slot++) data[slot * 21 + 16] = slot === 0 ? 99 : 0;
  const bytes = message(data);
  const voice = importDX7(bytes)[0];
  const description = describeDX7(bytes)[0];
  assert.ok(description.selectedOperators.includes(6));
  const output = renderNote({ voice, note: 60, duration: 0.15, sampleRate: 8000 }).samples;
  assert.ok(rms(output.subarray(200, 1000)) > 0.01);
});

test('names sanitize controls/path characters and bank suffixes do not collide', () => {
  const data = bankPayload();
  setName(data, 118, '../\u0000<>');
  setName(data, 128 + 118, 'DX TEST');
  setName(data, 256 + 118, 'DX TEST');
  setName(data, 384 + 118, 'DX_TEST_2');
  const bytes = message(data);
  const voices = importDX7(bytes);
  assert.equal(voices[0].name, 'DX7');
  assert.equal(voices[1].name, 'DX_TEST');
  assert.equal(voices[2].name, 'DX_TEST_2');
  assert.equal(voices[3].name, 'DX_TEST_2_2');
  assert.equal(parseVoiceBank(voices).size, 32);
  assert.deepEqual(describeDX7(bytes).map(value => value.name), voices.map(value => value.name));
});

test('strict framing, format, counts, 7-bit data and Yamaha checksum reject malformed input', () => {
  const valid = message(singlePayload());
  for (const input of [null, [], new Uint16Array(163), new DataView(valid.buffer), new Proxy(valid, {})]) {
    assert.throws(() => importDX7(input), TypeError);
  }
  for (const length of [0, 162, 164, 4103, 4105, 10000]) {
    assert.throws(() => importDX7(new Uint8Array(length)), RangeError);
  }
  const mutations = [[0, 0], [1, 0x41], [2, 0x10], [3, 9], [3, 1], [4, 0], [5, 0],
    [6, 128], [161, 128], [162, 0], [50, valid[50] ^ 1], [161, valid[161] ^ 1]];
  for (const [offset, value] of mutations) {
    const corrupted = valid.slice();
    corrupted[offset] = value;
    assert.throws(() => importDX7(corrupted), `offset ${offset}`);
    assert.throws(() => describeDX7(corrupted), `description offset ${offset}`);
  }
  const payload = bankPayload();
  payload[4095] ^= 1;
  const brokenBank = message(bankPayload());
  brokenBank.set(payload, 6);
  assert.throws(() => importDX7(brokenBank), /checksum/);
  assert.throws(() => importDX7(new Uint8Array([...valid, ...valid])), /single or/);
});

test('valid-checksum data rejects parameter overflow and reserved packed bits', () => {
  for (const [at, value] of [[0, 100], [11, 4], [13, 8], [17, 2], [18, 32], [20, 15],
    [134, 32], [135, 8], [136, 2], [142, 6], [143, 8], [144, 49]]) {
    const data = singlePayload();
    data[at] = value;
    assert.throws(() => importDX7(message(data)), /parameter out of range/);
  }
  for (const [at, value] of [[11, 16], [12, 120], [13, 32], [15, 64], [110, 32], [111, 16], [116, 12]]) {
    const data = bankPayload();
    data[at] = value;
    assert.throws(() => importDX7(message(data)), RangeError);
  }
});

test('fixed frequency and unsupported semantics are visible outside the ordinary voice shape', () => {
  const data = singlePayload();
  data[134] = 31;
  // OP1 is retained: low fixed Hz clips to minimum ratio; highest scaling stays bounded.
  const at = 105;
  data[at + 17] = 1;
  data[at + 18] = 0;
  data[at + 19] = 0;
  data[at + 9] = 99;
  data[at + 10] = 99;
  data[at + 11] = 0;
  data[at + 12] = 3;
  data[130] = 99;
  data[138] = 99;
  data[144] = 48;
  const bytes = message(data);
  const voice = importDX7(bytes)[0];
  const description = describeDX7(bytes)[0];
  const converted = voice.ops[description.selectedOperators.indexOf(1)];
  assert.equal(converted.ratio, 0.125);
  assert.equal(converted.keyScale.leftDbPerOctave, 24);
  assert.equal(converted.keyScale.rightDbPerOctave, 0);
  assert.ok(description.warnings.some(value => /fixed frequency.*MIDI-60/.test(value)));
  assert.ok(description.warnings.some(value => /positive keyboard scaling/.test(value)));
  assert.ok(description.warnings.some(value => /Pitch envelope ignored/.test(value)));
  assert.ok(description.warnings.some(value => /LFO delay ignored/.test(value)));
  assert.ok(description.warnings.some(value => /Transpose ignored/.test(value)));
  assert.deepEqual(normalizeVoice(voice), voice);
  assert.equal(parseVoiceBank([voice]).get(voice.name).version, 2);
});

test('frequency bounds and sliced byte views preserve finite independent voices', () => {
  const data = singlePayload();
  data[134] = 31;
  data[105 + 18] = 31;
  data[105 + 19] = 99;
  const original = message(data);
  const padded = new Uint8Array(original.length + 10);
  padded.set(original, 5);
  const view = padded.subarray(5, 5 + original.length);
  Object.defineProperty(view, 'length', { get() { throw new Error('untrusted getter'); } });
  const imported = importDX7(view);
  const description = describeDX7(original)[0];
  const op1 = description.selectedOperators.indexOf(1);
  assert.equal(imported[0].ops[op1].ratio, 32);
  assert.ok(description.warnings.some(value => /ratio clipped/.test(value)));
  padded.fill(0);
  assert.deepEqual(importDX7(original), imported);
  assert.deepEqual(normalizeVoice(imported[0]), imported[0]);
});
