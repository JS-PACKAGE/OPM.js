import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from '../src/voices/examples.js';
import { validateVoice, parseVoiceBank, LIMITS, MAX_BANK_BYTES } from '../src/voices/schema.js';
import type { Voice } from '../src/voices/schema.js';
const text = JSON.stringify(examples);
const fixture = (): Voice => JSON.parse(text)[0] as Voice;

function atPath(value: unknown, path: readonly (string | number)[]): unknown {
  for (const step of path) value = (value as Record<string | number, unknown>)[step];
  return value;
}

function mutableAtPath(value: unknown, path: readonly (string | number)[]): Record<string | number, unknown> {
  return atPath(value, path) as Record<string | number, unknown>;
}

test('examples validate and normalization is detached and frozen', () => {
  const bank = parseVoiceBank(text);
  for (const name of ['bell', 'brass', 'bass']) assert.ok(bank.has(name));
  const input = fixture(), voice = validateVoice(input);
  input.ops[0].level = 0;
  assert.notEqual(voice.ops[0].level, 0);
  assert.ok(Object.isFrozen(voice.ops[0].adsr));
});

test('malformed-voice fuzz: every numeric field rejects non-finite and wrong types; finite extremes clamp', () => {
  const paths = [['modIndex'], ...['rate','amDepth','pmDepth'].map(k => ['lfo',k]),
    ...Array.from({ length: 4 }, (_, i) => [
      ...['ratio','level','detune','velocitySensitivity'].map(k => ['ops',i,k]),
      ...['a','d','s','r'].map(k => ['ops',i,'adsr',k]),
    ]).flat()];
  for (const path of paths) {
    const key = path.at(-1)!;
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '1', {}, [], true]) {
      const voice = fixture();
      const target = mutableAtPath(voice, path.slice(0, -1));
      target[key] = value;
      assert.throws(() => validateVoice(voice), `${path}: ${value}`);
    }
    for (const value of [-1e300, 1e300]) {
      const voice = fixture();
      const target = mutableAtPath(voice, path.slice(0, -1));
      target[key] = value;
      const result = atPath(validateVoice(voice), path);
      assert.equal(result, LIMITS[key as keyof typeof LIMITS][value < 0 ? 0 : 1]);
    }
  }
});

test('missing fields, unknown fields, invalid versions, arrays and enums are rejected', () => {
  for (const path of [[], ['lfo'], ['ops',0], ['ops',0,'adsr']]) {
    const object = mutableAtPath(fixture(), path);
    for (const key of Object.keys(object)) {
      const voice = fixture();
      const target = mutableAtPath(voice, path);
      delete target[key]; assert.throws(() => validateVoice(voice));
    }
  }
  for (const field of ['version','algorithm','feedback']) for (const value of [NaN, Infinity, 1e300, -1, .5, '1', null]) {
    const voice = fixture(); mutableAtPath(voice, [])[field] = value; assert.throws(() => validateVoice(voice));
  }
  for (const ops of [[], Array(4), Array(5).fill({}), null]) {
    const voice = fixture(); mutableAtPath(voice, []).ops = ops; assert.throws(() => validateVoice(voice));
  }
  for (const name of ['', '../bell', 'a'.repeat(65)]) {
    const voice = fixture(); voice.name = name; assert.throws(() => validateVoice(voice));
  }
});

test('prototype pollution and accessors are rejected without execution', () => {
  for (const key of ['__proto__','constructor','prototype']) {
    const voice = fixture(); Object.defineProperty(voice, key, { value: { polluted: true }, enumerable: true });
    assert.throws(() => validateVoice(voice));
  }
  const voice = fixture();
  Object.defineProperty(voice.ops[0], 'level', { get() { throw new Error('getter executed'); } });
  assert.throws(() => validateVoice(voice), /must be data/);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const inherited = Object.create(fixture()); assert.throws(() => validateVoice(inherited));
});

test('bank sizes, duplicates, invalid JSON, and sparse elements are bounded', () => {
  for (const bank of ['[', ' '.repeat(MAX_BANK_BYTES + 1), [], Array(129), Array(1), [fixture(), fixture()], { url: '../voices.json' }]) {
    assert.throws(() => parseVoiceBank(bank as unknown as Parameters<typeof parseVoiceBank>[0]));
  }
  const bank = [fixture()]; Object.defineProperty(bank, '0', { get() { throw new Error('getter executed'); } });
  assert.throws(() => parseVoiceBank(bank), /must contain data/);
});
