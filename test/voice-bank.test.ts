import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from '../src/voices/examples.js';
import { MAX_BANK_BYTES, parseVoiceBank, validateVoice } from '../src/voices/schema.js';
import { normalizeVoice, prepareVoice } from '../src/voices/normalize.js';
import type { Voice } from '../src/voices/schema.js';

const example: Voice = examples[0];
const copy = () => structuredClone(example);
const validators = [validateVoice, (input: unknown) => parseVoiceBank([input]).values().next().value!];

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

test('bank byte admission handles the three-byte UTF-16 bound and lone-surrogate replacement', () => {
  const boundary = Math.floor(MAX_BANK_BYTES / 3);
  const surrogate = String.fromCharCode(0xd800);
  assert.throws(() => parseVoiceBank(surrogate.repeat(boundary)), SyntaxError);
  assert.throws(() => parseVoiceBank(surrogate.repeat(boundary + 1)), RangeError);
});

test('duplicate bank names are rejected and returned voices are independent snapshots', () => {
  const first = copy();
  const second = copy();
  second.name = 'alternate';
  second.ops[0].level = 0.13;
  const targets: [number, number, number, number] = [0, 0.25, 0.5, 1];
  first.lfo.amTargets = second.lfo.amTargets = targets;
  assert.throws(() => parseVoiceBank([first, copy()]), TypeError);

  const bank = parseVoiceBank([first, second]);
  const originalLevel = first.ops[0].level;
  first.ops[0].level = 0;
  second.ops[0].level = 0;
  targets[1] = 1;
  assert.equal(bank.get(first.name)!.ops[0].level, originalLevel);
  assert.equal(bank.get('alternate')!.ops[0].level, 0.13);
  assert.notStrictEqual(bank.get(first.name)!.ops[0], bank.get('alternate')!.ops[0]);
  assert.ok(Object.isFrozen(bank.get('alternate')!.ops[0]));
  for (const snapshot of bank.values()) {
    assert.deepEqual(snapshot.lfo.amTargets, [0, 0.25, 0.5, 1]);
    assert.throws(() => Object.assign(snapshot.lfo.amTargets!, { 1: 0 }), TypeError);
  }
  assert.notStrictEqual(bank.get(first.name)!.lfo.amTargets, bank.get('alternate')!.lfo.amTargets);
});

test('bank fields stay captured when nested validation installs late root accessors', () => {
  for (const validate of validators) {
    const input = copy(), expected = validateVoice(input);
    let reads = 0;
    input.lfo = new Proxy(input.lfo, {
      getPrototypeOf(target) {
        Object.defineProperty(input, 'name', { __proto__: null, configurable: true, enumerable: true,
          get() { reads++; return 'invalid/name'; } } as PropertyDescriptor);
        Object.defineProperty(input, 'algorithm', { __proto__: null, configurable: true, enumerable: true,
          get() { reads++; return 7; } } as PropertyDescriptor);
        return Reflect.getPrototypeOf(target);
      },
    });
    const actual = validate(input);
    assert.equal(reads, 0);
    assert.deepEqual(actual, expected);
  }
});

test('operator slots stay captured when LFO validation replaces a checked slot', () => {
  for (const validate of validators) {
    const input = copy(), expected = validateVoice(input), first = input.ops[0];
    let reads = 0;
    input.lfo = new Proxy(input.lfo, {
      getPrototypeOf(target) {
        Object.defineProperty(input.ops, '0', { __proto__: null, configurable: true, enumerable: true,
          get() { reads++; return first; } } as PropertyDescriptor);
        return Reflect.getPrototypeOf(target);
      },
    });
    const actual = validate(input);
    assert.equal(reads, 0);
    assert.deepEqual(actual, expected);
  }
});

test('bank slots stay captured across earlier voice validation callbacks', () => {
  const first = copy(), second = copy();
  second.name = 'second_snapshot';
  const input = [first, second], expected = parseVoiceBank(input);
  let reads = 0;
  first.lfo = new Proxy(first.lfo, {
    getPrototypeOf(target) {
      Object.defineProperty(input, '1', { __proto__: null, configurable: true, enumerable: true,
        get() { reads++; return second; } } as PropertyDescriptor);
      return Reflect.getPrototypeOf(target);
    },
  });
  const actual = parseVoiceBank(input);
  assert.equal(reads, 0);
  assert.deepEqual(actual, expected);
});

test('bank traversal uses its captured own-data length rather than a changing getter', () => {
  const first = copy();
  first.name = 'voice_0';
  let reads = 0;
  const input = new Proxy([first], {
    get(target, key, receiver) {
      if (key === 'length') return ++reads <= 5 ? 1 : 129;
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        const voice = copy();
        voice.name = `voice_${key}`;
        return voice;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const bank = parseVoiceBank(input);
  assert.equal(bank.size, 1);
  assert.deepEqual([...bank.keys()], ['voice_0']);
});

test('bank version checks do not consume a substituted get result or coerce it', () => {
  for (const validate of validators) {
    let reads = 0, coercions = 0;
    const version = { valueOf() { coercions++; return 8; } };
    const input = new Proxy(copy(), {
      get(target, key, receiver) {
        if (key === 'version') return ++reads <= 8 ? 8 : version;
        return Reflect.get(target, key, receiver);
      },
    });
    assert.equal(validate(input).version, 8);
    assert.equal(reads, 0);
    assert.equal(coercions, 0);
  }
});

test('LFO target consumers retain checked values when a later slot changes an earlier descriptor', () => {
  for (const validate of [normalizeVoice, prepareVoice, validateVoice,
    (input: Voice) => parseVoiceBank([input]).values().next().value!]) {
    const input = copy(), values: [number, number, number, number] = [0, 0.25, 0.5, 1];
    let reads = 0;
    input.lfo.amTargets = new Proxy(values, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key === '3') Object.defineProperty(target, '0', {
          __proto__: null, configurable: true, enumerable: true,
          get() { reads++; return 0.75; },
        } as PropertyDescriptor);
        return descriptor;
      },
    });
    assert.deepEqual(validate(input).lfo.amTargets, [0, 0.25, 0.5, 1]);
    assert.equal(reads, 0);
  }
});
