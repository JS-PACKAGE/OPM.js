import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from '../src/voices/examples.js';
import { MAX_BANK_BYTES, parseVoiceBank } from '../src/voices/schema.js';
import type { Voice } from '../src/voices/schema.js';

const example: Voice = examples[0];
const copy = () => structuredClone(example);

test('bank length is measured in UTF-8 bytes, not JavaScript characters', () => {
  const json = JSON.stringify([copy()]);
  const withinLimit = json + ' '.repeat(MAX_BANK_BYTES - Buffer.byteLength(json));
  assert.equal(parseVoiceBank(withinLimit).get(example.name)!.name, example.name);

  // JSON.parse would report trailing input, but the byte limit must reject it first.
  const multibyte = json + ' '.repeat(MAX_BANK_BYTES - Buffer.byteLength(json) - 1) + 'é';
  assert.ok(multibyte.length <= MAX_BANK_BYTES);
  assert.equal(Buffer.byteLength(multibyte), MAX_BANK_BYTES + 1);
  assert.throws(() => parseVoiceBank(multibyte), RangeError);
});

test('duplicate bank names are rejected and returned voices are independent snapshots', () => {
  const first = copy();
  const second = copy();
  second.name = 'alternate';
  second.ops[0].level = 0.13;
  assert.throws(() => parseVoiceBank([first, copy()]), TypeError);

  const bank = parseVoiceBank([first, second]);
  const originalLevel = first.ops[0].level;
  first.ops[0].level = 0;
  second.ops[0].level = 0;
  assert.equal(bank.get(first.name)!.ops[0].level, originalLevel);
  assert.equal(bank.get('alternate')!.ops[0].level, 0.13);
  assert.notStrictEqual(bank.get(first.name)!.ops[0], bank.get('alternate')!.ops[0]);
  assert.ok(Object.isFrozen(bank.get('alternate')!.ops[0]));
});
