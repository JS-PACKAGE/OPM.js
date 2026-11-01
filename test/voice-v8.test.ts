import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth } from '../src/core/synth.js';
import { envelopeAt } from '../src/core/envelope.js';
import { normalizeVoice, prepareVoice } from '../src/voices/normalize.js';
import { parseVoiceBank, validateVoice } from '../src/voices/schema.js';
import type { ADSR, LFO, PreparedVoice, Voice, VoiceInput } from '../src/voices/schema.js';

const RATE = 16000;
function tone(adsr: ADSR, lfo: LFO = { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' }): Voice {
  return { version: 8, name: 'v8-test', algorithm: 7, feedback: 0, modIndex: 0, lfo,
    ops: [0, 1, 2, 3].map(i => ({ ratio: 1, level: i === 0 ? 0.5 : 0, detune: 0, adsr })) as Voice['ops'] };
}
function stereo(synth: Synth, frames: number, chunk = frames): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let at = 0; at < frames; at += chunk) synth.render(left, right, at, Math.min(chunk, frames - at));
  return { left, right };
}
function rmsDb(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return 10 * Math.log10(sum / (to - from));
}

test('sustain rate keeps a held note falling 96 dB per sr seconds, then holds exact silence', () => {
  // soft-knee is exactly linear below -6 dBFS, so output dB tracks the envelope.
  const synth = new Synth(RATE, 8, { saturation: 'soft-knee' });
  synth.noteOn(tone({ a: 0, d: 0.05, s: 0.5, r: 0.1, sr: 2 }), 69);
  const { left } = stereo(synth, RATE * 3);
  const window = RATE / 20;
  const at = (seconds: number) => rmsDb(left, Math.round(seconds * RATE), Math.round(seconds * RATE) + window);
  // Expected slope: -96 dB / 2 s = -48 dB/s while the key is still held.
  for (const [t0, t1] of [[0.2, 0.6], [0.6, 1.2]]) {
    assert.ok(Math.abs(at(t1) - at(t0) - (-48 * (t1 - t0))) < 0.3, `${t0}->${t1}: ${at(t1) - at(t0)}`);
  }
  // sustain -6.02 dB reaches the -96 dB floor after 0.05 + 2 * 89.98 / 96 s.
  const floor = 0.05 + 2 * (96 + 20 * Math.log10(0.5)) / 96;
  assert.ok(left.subarray(Math.ceil((floor + 0.01) * RATE)).every(value => value === 0));
  assert.ok(left.subarray(Math.floor((floor - 0.1) * RATE), Math.floor((floor - 0.05) * RATE)).some(value => value !== 0));
});

test('omitted sustain rate holds the level, and sustain-rate output is chunk independent', () => {
  const held = new Synth(RATE);
  held.noteOn(tone({ a: 0, d: 0.05, s: 0.5, r: 0.1 }), 69);
  const { left } = stereo(held, RATE * 2);
  assert.ok(Math.abs(rmsDb(left, RATE / 2, RATE / 2 + 800) - rmsDb(left, RATE + RATE / 2, RATE + RATE / 2 + 800)) < 0.01);
  const render = (chunk: number) => {
    const synth = new Synth(RATE);
    const id = synth.noteOn(tone({ a: 0.01, d: 0.07, s: 0.3, r: 0.2, sr: 0.9 }), 64);
    const first = stereo(synth, 7001, chunk);
    synth.noteOff(id);
    return [first.left, stereo(synth, 5003, chunk).left];
  };
  assert.deepEqual(render(128), render(7001));
  assert.deepEqual(render(37), render(7001));
});

test('release starts from the decayed level and live ADSR edits can add or remove a sustain rate', () => {
  const synth = new Synth(RATE, 8, { saturation: 'soft-knee' });
  const id = synth.noteOn(tone({ a: 0, d: 0.02, s: 0.5, r: 0.5, sr: 1 }), 69);
  const before = stereo(synth, RATE / 2).left;
  synth.noteOff(id);
  const after = stereo(synth, RATE / 10).left;
  // No upward jump: the release begins at the decayed level, not the sustain level.
  assert.ok(rmsDb(after, 0, 400) <= rmsDb(before, before.length - 400, before.length) + 0.1);
  const live = new Synth(RATE, 8, { saturation: 'soft-knee' });
  const note = live.noteOn(tone({ a: 0, d: 0.02, s: 0.5, r: 0.5 }), 69);
  const steady = stereo(live, RATE / 4).left;
  const decaying = { a: 0, d: 0.02, s: 0.5, r: 0.5, sr: 1 };
  assert.equal(live.updateNote(note, { operatorADSR: [decaying, decaying, decaying, decaying] }), true);
  const edited = stereo(live, RATE / 2).left;
  const drop = rmsDb(edited, edited.length - 800, edited.length) - rmsDb(steady, steady.length - 800, steady.length);
  assert.ok(drop < -30 && drop > -60, String(drop));
  assert.throws(() => live.updateNote(note, { operatorADSR: [{ ...decaying, sr: 0 }, decaying, decaying, decaying] }), RangeError);
  assert.throws(() => live.updateNote(note, { operatorADSR: [{ ...decaying, extra: 1 } as ADSR, decaying, decaying, decaying] }), TypeError);
});

test('edited held gains follow later ADSR edits, sustain-rate decay, reactivation and release', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const synth = new Synth(RATE, 8, { quality, saturation: 'soft-knee' });
    const ended: [number, string][] = [];
    synth.onVoiceEnded = (id, reason) => { ended.push([id, reason]); };
    const note = synth.noteOn(tone({ a: 0, d: 0.005, s: 0.9, r: 0.05 }), 69);
    const edit = (adsr: ADSR) => assert.equal(synth.updateNote(note, { operatorADSR: [adsr, adsr, adsr, adsr] }), true);
    const level = (samples: Float32Array) => rmsDb(samples, 200, 600);
    const initial = stereo(synth, 800, 37).left;
    edit({ a: 0, d: 0, s: 0.5, r: 0.05 });
    const half = stereo(synth, 800, 37).left;
    assert.ok(Math.abs(level(half) - level(initial) - 20 * Math.log10(0.5 / 0.9)) < 0.03);
    edit({ a: 0, d: 0, s: 0.25, r: 0.05 });
    const quarter = stereo(synth, 800, 37).left;
    assert.ok(Math.abs(level(quarter) - level(half) - 20 * Math.log10(0.25 / 0.5)) < 0.03);
    edit({ a: 0, d: 0, s: 0.25, r: 0.05, sr: 0.1 });
    const falling = stereo(synth, 1600, 37).left;
    // Windows are 22 carrier cycles apart and remain above the floor: -96 * .05/.1 dB.
    const drop = rmsDb(falling, 864, 1264) - rmsDb(falling, 64, 464);
    assert.ok(Math.abs(drop + 48) < 0.05, `${quality}: ${drop}`);
    assert.ok(falling.subarray(-128).every(sample => sample === 0));
    edit({ a: 0, d: 0, s: 0.75, r: 0.05 });
    const restored = stereo(synth, 800, 37).left;
    assert.ok(Math.abs(level(restored) - level(quarter) - 20 * Math.log10(0.75 / 0.25)) < 0.03);
    assert.deepEqual(ended, []);
    synth.noteOff(note);
    const released = stereo(synth, 1600, 37).left;
    assert.ok(released.subarray(-128).every(sample => sample === 0));
    assert.deepEqual(ended, [[note, 'ended']]);
    assert.equal(synth.errorCount, 0);
  }
});

test('recycled prepared patches restore canonical sustain after live ADSR edits and patch switches', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const options = { quality, saturation: 'soft-knee' as const };
    const synth = new Synth(RATE, 1, options);
    const original = prepareVoice(tone({ a: 0, d: 0, s: 0.8, r: 0 }));
    const changed = prepareVoice(tone({ a: 0, d: 0, s: 0.4, r: 0 }));
    const release = (id: number) => {
      assert.equal(synth.noteOff(id), true);
      assert.ok(stereo(synth, 64).left.subarray(-16).every(sample => sample === 0));
    };
    const compare = (patch: PreparedVoice) => {
      const reference = new Synth(RATE, 1, options);
      reference.noteOn(patch, 69);
      const id = synth.noteOn(patch, 69);
      const actual = stereo(synth, 256, 37);
      assert.deepEqual(actual, stereo(reference, 256));
      assert.ok(rmsDb(actual.left, 64, 256) > -45);
      assert.equal(synth.errorCount, 0);
      reference.panic();
      return id;
    };
    const first = synth.noteOn(original, 69);
    stereo(synth, 256);
    release(first);
    const reused = compare(original);
    const edit = { a: 0, d: 0, s: 0.2, r: 0 };
    assert.equal(synth.updateNote(reused, { operatorADSR: [edit, edit, edit, edit] }), true);
    stereo(synth, 128);
    release(reused);
    release(compare(original));
    release(compare(changed));
    release(compare(original));
  }
});

test('recycled envelope timing and sustain-rate steps follow rate scaling across note changes', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    for (const rateKeyScale of [undefined, 0, 0.5]) {
      const definition = tone({ a: 0.005, d: 0.01, s: 0.5, r: 0.02, sr: 0.1 });
      for (const op of definition.ops) if (rateKeyScale !== undefined) op.rateKeyScale = rateKeyScale;
      const patch = prepareVoice(definition);
      const synth = new Synth(RATE, 1, { quality });
      const first = synth.noteOn(patch, 48.25);
      stereo(synth, 1024, 37);
      assert.equal(synth.noteOff(first), true);
      stereo(synth, RATE);
      const reference = new Synth(RATE, 1, { quality });
      const id = synth.noteOn(patch, 72.25);
      const expectedId = reference.noteOn(patch, 72.25);
      const held = stereo(synth, 1024, 37);
      assert.deepEqual(held, stereo(reference, 1024));
      assert.ok(rmsDb(held.left, 64, 256) > -70);
      assert.equal(synth.noteOff(id), true);
      assert.equal(reference.noteOff(expectedId), true);
      const released = stereo(synth, 4096, 37);
      assert.deepEqual(released, stereo(reference, 4096));
      assert.ok(released.left.subarray(-128).every(sample => sample === 0));
      assert.equal(synth.errorCount, 0);
      assert.equal(reference.errorCount, 0);
    }
  }
});

test('inherited sustain and rate values change neither fresh nor recycled timing', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const synth = new Synth(RATE, 1, { quality });
    const patch = prepareVoice(tone({ a: 0.005, d: 0.01, s: 0.5, r: 0.02 }));
    synth.noteOn(patch, 48, 1);
    stereo(synth, 1024, 37);
    synth.panic();
    // Omitted optional fields are not read through Object.prototype, so the clean sound is the contract.
    const baseline = new Synth(RATE, 1, { quality });
    baseline.noteOn(patch, 72.25, 2);
    const expected = stereo(baseline, 2048, 37);
    for (const [key, value] of [['sr', 0.05], ['rateKeyScale', 2]] as const) {
      const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
      const restore = () => {
        if (original) Object.defineProperty(Object.prototype, key, original);
        else Reflect.deleteProperty(Object.prototype, key);
      };
      let recycled, fresh;
      try {
        Object.defineProperty(Object.prototype, key, { value, configurable: true, writable: true });
        const reference = new Synth(RATE, 1, { quality });
        synth.noteOn(patch, 72.25, 2);
        reference.noteOn(patch, 72.25, 2);
        recycled = stereo(synth, 2048, 37);
        fresh = stereo(reference, 2048, 37);
      } finally {
        restore();
      }
      assert.deepEqual(recycled, expected, `recycled ${key}`);
      assert.deepEqual(fresh, expected, `fresh ${key}`);
      assert.equal(synth.errorCount, 0);
      synth.panic();
    }
  }
});

test('failed note initialization preserves active audio, pool capacity and pristine coefficients', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const synth = new Synth(RATE, 1, { quality }), reference = new Synth(RATE, 1, { quality });
    const patch = prepareVoice(tone({ a: 0, d: 0, s: 0.8, r: 0.02 }));
    const other = prepareVoice(tone({ a: 0, d: 0, s: 0.2, r: 0.02 }));
    synth.noteOn(patch, 69, 1);
    reference.noteOn(patch, 69, 1);
    const failure = new Error('injected initialization failure');
    // Admission reads only own data, so nothing in a snapshot can throw. Inject the failure
    // through the spare slot's typed storage instead: its `writes`-th index write throws.
    const inject = (field: 'frequencyTargets' | 'noiseSteps', failingWrite: number, attempts: number): void => {
      const spare = synth.freeVoices[synth.freeVoices.length - 1];
      const original = spare[field];
      let writes = 0;
      spare[field] = new Proxy(original, {
        set(target, key, value) { if (++writes === failingWrite) throw failure; return Reflect.set(target, key, value); },
      });
      try {
        for (let attempt = 0; attempt < attempts; attempt++) {
          writes = 0;
          assert.throws(() => synth.noteOn(other, 72, attempt + 2), error => error === failure);
        }
      } finally { spare[field] = original; }
    };
    inject('frequencyTargets', 1, 72);
    assert.deepEqual(stereo(synth, 512, 37), stereo(reference, 512));
    synth.panic();
    reference.panic();
    inject('noiseSteps', 2, 1);
    synth.noteOn(patch, 69, 101);
    reference.noteOn(patch, 69, 101);
    assert.deepEqual(stereo(synth, 1024, 37), stereo(reference, 1024));
    assert.equal(synth.errorCount, 0);
  }
});

test('envelopeAt applies the sustain rate before and after the gate', () => {
  const adsr = { a: 0, d: 0.1, s: 0.5, r: 1, sr: 4 };
  const db = (time: number, gate: number) => 20 * Math.log10(envelopeAt(time, gate, adsr));
  assert.ok(Math.abs(db(1.1, 5) - (20 * Math.log10(0.5) - 24)) < 1e-9);
  // Released at 1.1 s: release starts from the decayed level.
  assert.ok(Math.abs(db(1.1, 1.1) - db(1.1, 5)) < 1e-9);
  assert.equal(envelopeAt(10, 20, adsr), 0);
  assert.equal(envelopeAt(1.1, 5, { a: 0, d: 0.1, s: 0.5, r: 1 }), 0.5);
});

test('noise LFO holds one deterministic level per cycle and follows global time across chunks', () => {
  const lfo: LFO = { rate: 20, amDepth: 0.9, pmDepth: 0, waveform: 'noise', sync: 'global' };
  const render = (chunk: number) => {
    const synth = new Synth(RATE, 8, { saturation: 'soft-knee' });
    synth.noteOn(tone({ a: 0, d: 0, s: 1, r: 0.1 }, lfo), 81);
    return stereo(synth, RATE, chunk).left;
  };
  const left = render(RATE);
  assert.deepEqual(render(113), left);
  // 20 Hz cycles of 800 frames: AM gain is constant inside one cycle, so the
  // per-cycle RMS of a 880 Hz carrier varies only across cycles.
  const levels = [];
  for (let cycle = 0; cycle < 20; cycle++) levels.push(rmsDb(left, cycle * 800 + 40, cycle * 800 + 760));
  assert.ok(new Set(levels.map(level => level.toFixed(1))).size >= 12, levels.join());
  const halves = [rmsDb(left, 3 * 800 + 20, 3 * 800 + 380), rmsDb(left, 3 * 800 + 420, 3 * 800 + 780)];
  assert.ok(Math.abs(halves[0] - halves[1]) < 0.2, halves.join());
});

test('voice pan offsets note pan and is clamped', () => {
  const render = (voicePan: number, notePan: number) => {
    const synth = new Synth(RATE);
    synth.noteOn({ ...tone({ a: 0, d: 0, s: 1, r: 0.1 }), pan: voicePan }, 69, undefined, { pan: notePan });
    return stereo(synth, 800);
  };
  const hardLeft = render(-1, 0);
  assert.ok(hardLeft.right.every(value => value === 0) && hardLeft.left.some(value => value !== 0));
  const centered = render(-1, 1);
  assert.deepEqual(centered.left, centered.right);
  assert.deepEqual(render(-0.5, -1), render(-1, 0));
  const plain = new Synth(RATE);
  plain.noteOn(tone({ a: 0, d: 0, s: 1, r: 0.1 }), 69);
  assert.deepEqual(stereo(plain, 800), render(0, 0));
});

test('v8 fields are version gated, canonical and bank-clamped', () => {
  const base = tone({ a: 0, d: 0, s: 1, r: 0.1, sr: 3 }, { rate: 2, amDepth: 0.2, pmDepth: 0, waveform: 'noise' });
  const voice = validateVoice({ ...base, pan: 0.25 });
  assert.deepEqual(Object.keys(voice), ['version', 'name', 'algorithm', 'feedback', 'modIndex', 'pan', 'lfo', 'ops']);
  assert.equal(voice.version, 8);
  assert.equal(voice.ops[0].adsr.sr, 3);
  assert.equal(normalizeVoice({ ...base, pan: -0.5 }).pan, -0.5);
  for (const legacy of [
    { ...base, version: 7, ops: base.ops.map(op => ({ ...op, adsr: { a: 0, d: 0, s: 1, r: 0.1 } })), pan: 0.5 },
    { ...base, version: 7, lfo: { ...base.lfo, waveform: 'sine' }, ops: base.ops },
    { ...base, version: 7, ops: base.ops.map(op => ({ ...op, adsr: { a: 0, d: 0, s: 1, r: 0.1 } })) },
  ]) {
    assert.throws(() => normalizeVoice(legacy as unknown as VoiceInput));
    assert.throws(() => validateVoice(legacy));
  }
  assert.throws(() => normalizeVoice({ ...base, pan: 2 }), RangeError);
  assert.throws(() => normalizeVoice(tone({ a: 0, d: 0, s: 1, r: 0.1, sr: 0 })), RangeError);
  // Bank parsing clamps finite numbers, as for every other field.
  const bank = parseVoiceBank(JSON.stringify([{ ...base, pan: -3, ops: base.ops.map(op => ({ ...op, adsr: { ...op.adsr, sr: 1000 } })) }]));
  assert.equal(bank.get('v8-test')!.pan, -1);
  assert.equal(bank.get('v8-test')!.ops[0].adsr.sr, 100);
});
