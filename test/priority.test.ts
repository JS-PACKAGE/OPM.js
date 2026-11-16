import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth, VoiceAdmissionError, renderNote, renderSequence } from '../src/core/index.js';
import { ALGORITHMS } from '../src/core/algorithms.js';
import type { SequenceEvent } from '../src/core/index.js';
import type { Voice } from '../src/voices/schema.js';

const voice: Voice = { version: 8, name: 'priority-tone', algorithm: 7, feedback: 0, modIndex: 0,
lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
ops: [1, 0, 0, 0].map(level => ({ ratio: 1, level, detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.05 } })) as unknown as Voice['ops'], };
const audio = (synth: Synth, frames: number) => {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  synth.render(left, right);
  return { left, right };
};

function duringGraphRead(action: () => void, admit: () => number): unknown {
  const saved = Object.getOwnPropertyDescriptor(Array.prototype, '1'), prototypeLength = Array.prototype.length;
  let armed = true, reads = 0, failure: unknown;
  try {
    Object.defineProperty(Array.prototype, '1', {
      configurable: true,
      get(this: unknown) {
        if (armed && this === ALGORITHMS[7].inputs[0]) {
          armed = false;
          reads++;
          action();
        }
        return undefined;
      },
      // Nested admissions and host arrays must still be able to create their own cells.
      set(this: object, value: unknown) {
        Object.defineProperty(this, '1', { value, configurable: true, enumerable: true, writable: true });
      },
    });
    try { admit(); } catch (error) { failure = error; }
  } finally {
    if (saved) Object.defineProperty(Array.prototype, '1', saved);
    else Reflect.deleteProperty(Array.prototype, '1');
    Array.prototype.length = prototypeLength;
  }
  assert.equal(reads, 1);
  return failure;
}

test('lower priority never displaces a protected voice and refusal leaves the engine untouched', () => {
  const synth = new Synth(16000, 2);
  const ended: [number, string][] = [];
  synth.onVoiceEnded = (id, reason) => { ended.push([id, reason]); };
  synth.noteOn(voice, 60, 1, { voicePriority: 10 });
  synth.noteOn(voice, 64, 2, { voicePriority: 10 });
  audio(synth, 64);
  const reference = new Synth(16000, 2);
  reference.noteOn(voice, 60, 1, { voicePriority: 10 });
  reference.noteOn(voice, 64, 2, { voicePriority: 10 });
  audio(reference, 64);
  assert.throws(() => synth.noteOn(voice, 67, 3, { voicePriority: 9 }), VoiceAdmissionError);
  assert.equal(synth.voices.length, 2);
  assert.equal(synth.lastStolenId, null);
  assert.deepEqual(ended, []);
  // The refused explicit ID was never consumed, so the next automatic ID is still 3.
  assert.equal(synth.noteOn(voice, 67, undefined, { voicePriority: 10 }), 3, 'equal priority may steal the oldest voice');
  assert.deepEqual(ended, [[1, 'stolen']]);
  const a = audio(synth, 256);
  const b = audio(reference, 256);
  assert.notDeepEqual(a.left, b.left, 'the equal-priority replacement changes the mix');
  assert.equal(synth.errorCount, 0);
});

test('the lowest priority is stolen before older higher priority voices', () => {
  const synth = new Synth(16000, 3, { stealing: 'oldest' });
  synth.noteOn(voice, 60, 1, { voicePriority: 50 });
  synth.noteOn(voice, 62, 2, { voicePriority: 1 });
  synth.noteOn(voice, 64, 3, { voicePriority: 20 });
  synth.noteOn(voice, 66, 4, { voicePriority: 30 });
  assert.deepEqual(synth.voices.map(active => active.id).sort(), [1, 3, 4]);
  synth.noteOn(voice, 68, 5, { voicePriority: 20 });
  assert.deepEqual(synth.voices.map(active => active.id).sort(), [1, 4, 5], 'priority 20 is the lowest eligible victim');
  assert.throws(() => synth.noteOn(voice, 70, 6, { voicePriority: 0 }), VoiceAdmissionError);
});

test('stealing policies break ties only inside the lowest eligible priority', () => {
  for (const stealing of ['oldest', 'release-first', 'quietest'] as const) {
    const synth = new Synth(16000, 2, { stealing });
    synth.noteOn(voice, 60, 1, { voicePriority: 7 });
    synth.noteOn(voice, 61, 2, { voicePriority: 3 });
    audio(synth, 32);
    synth.noteOff(1);
    synth.noteOn(voice, 62, 3, { voicePriority: 5 });
    assert.deepEqual(synth.voices.map(active => active.id).sort(), [1, 3], `${stealing}: released high priority outlives lower priority`);
  }
});

test('quietest preserves low-priority comparisons across protected voices and breaks equal gains by age', () => {
  const synth = new Synth(16000, 4, { stealing: 'quietest' });
  const terminal: [number, string][] = [];
  synth.onVoiceEnded = (id, reason) => { terminal.push([id, reason]); };
  synth.noteOn(voice, 69, 1, { voicePriority: 1, velocity: 0.8 });
  synth.noteOn(voice, 69, 2, { voicePriority: 9, velocity: 0 });
  synth.noteOn(voice, 69, 3, { voicePriority: 1, velocity: 0.2 });
  synth.noteOn(voice, 69, 4, { voicePriority: 1, velocity: 0.2 });
  audio(synth, 64);
  synth.noteOn(voice, 69, 5, { voicePriority: 10 });
  assert.deepEqual(terminal, [[3, 'stolen']]);
  synth.noteOn(voice, 69, 6, { voicePriority: 10 });
  assert.deepEqual(terminal, [[3, 'stolen'], [4, 'stolen']]);
  synth.noteOn(voice, 69, 7, { voicePriority: 10 });
  assert.deepEqual(terminal, [[3, 'stolen'], [4, 'stolen'], [1, 'stolen']]);
  assert.throws(() => synth.noteOn(voice, 69, 8, { voicePriority: 8 }), VoiceAdmissionError);
  assert.deepEqual(terminal, [[3, 'stolen'], [4, 'stolen'], [1, 'stolen']]);
  assert.equal(synth.errorCount, 0);
});

test('quietest scores current gates and expression across unrendered notes, release and ADSR edits', () => {
  const instant: Voice = { ...voice, ops: voice.ops.map(op => ({ ...op, adsr: { ...op.adsr, r: 0 } })) as Voice['ops'] };
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const synth = new Synth(16000, 2, { quality, stealing: 'quietest' });
    const terminal: [number, string][] = [];
    synth.onVoiceEnded = (id, reason) => { terminal.push([id, reason]); };
    synth.noteOn(instant, 69, 1, { velocity: 0.8 });
    synth.noteOn(instant, 69, 2, { velocity: 0.1 });
    synth.noteOn(instant, 69, 3, { velocity: 0.2 });
    assert.deepEqual(terminal, [[2, 'stolen']]);
    audio(synth, 64);
    synth.noteOff(1);
    synth.noteOn(instant, 69, 4);
    assert.deepEqual(terminal, [[2, 'stolen'], [1, 'stolen']]);
    audio(synth, 64);
    const adsr = { a: 0, d: 0.001, s: 0.1, r: 0 };
    synth.updateNote(3, { operatorADSR: [adsr, adsr, adsr, adsr] });
    audio(synth, 64);
    synth.noteOn(instant, 69, 5, { velocity: 0.5 });
    assert.deepEqual(terminal, [[2, 'stolen'], [1, 'stolen'], [3, 'stolen']]);
    audio(synth, 64);
    synth.updateNote(4, { expression: 0.01 });
    synth.noteOn(instant, 69, 6);
    assert.deepEqual(terminal, [[2, 'stolen'], [1, 'stolen'], [3, 'stolen'], [4, 'stolen']]);
    assert.equal(synth.errorCount, 0);
  }
});

test('holding a moving operator level preserves its loudness for quietest stealing', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const synth = new Synth(16000, 2, { quality, stealing: 'quietest' });
    const terminal: [number, string][] = [];
    synth.onVoiceEnded = (id, reason) => { terminal.push([id, reason]); };
    synth.noteOn(voice, 60, 1);
    synth.noteOn(voice, 64, 2);
    synth.updateNote(1, { operatorLevels: [0, 1, 1, 1], ramp: 0.1 });
    synth.updateNote(2, { operatorLevels: [0.6, 1, 1, 1] });
    audio(synth, 800);
    // Holding at the midpoint must remain quieter than the 0.6-level note.
    synth.updateNote(1, { operatorLevels: [0.5, 1, 1, 1], ramp: 0.1 });
    synth.noteOn(voice, 67, 3);
    assert.deepEqual(terminal, [[1, 'stolen']]);
  }
});

test('priority bounds are strict own data and validation happens before sounding state changes', () => {
  const synth = new Synth(16000);
  for (const bad of [-1, 128, 1.5, NaN, Infinity, '1', null, undefined, {}]) {
    assert.throws(() => synth.noteOn(voice, 60, undefined, { voicePriority: bad as number }), /voicePriority|integer/);
  }
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'voicePriority', { enumerable: true, get() { reads++; return 1; } });
  assert.throws(() => synth.noteOn(voice, 60, undefined, accessor), TypeError);
  assert.equal(reads, 0);
  assert.equal(synth.voices.length, 0);
  assert.equal(synth.noteOn(voice, 60, undefined, { voicePriority: 127 }), 1, 'rejected input consumes no IDs');
  assert.throws(() => renderNote({ voice, voicePriority: 128 }), RangeError);
});

test('opt-in 32-voice polyphony keeps eight bounded fades and the default 8-voice sound is unchanged', () => {
  assert.throws(() => new Synth(16000, 33), RangeError);
  const wide = new Synth(16000, 32);
  for (let id = 1; id <= 40; id++) wide.noteOn(voice, 36 + id, id);
  assert.equal(wide.voices.length, 32);
  assert.ok(wide.fades.length <= 8, 'eight stealing fades are the preallocated ceiling');
  const samples = audio(wide, 512);
  assert.ok(samples.left.every(Number.isFinite) && samples.left.every(value => Math.abs(value) <= 0.7 + 1e-6));
  assert.equal(wide.errorCount, 0);

  const defaultRender = new Synth(16000), explicit = new Synth(16000, 8);
  for (const synth of [defaultRender, explicit]) for (let id = 1; id <= 10; id++) synth.noteOn(voice, 48 + id, id);
  const a = audio(defaultRender, 1024), b = audio(explicit, 1024);
  assert.deepEqual(a.left, b.left);
  assert.deepEqual(a.right, b.right);
});

test('offline scores honor maxVoices and priority admission deterministically', () => {
  const score: SequenceEvent[] = [
    { type: 'note', id: 1, time: 0, duration: 0.2, note: 72, voice, voicePriority: 100 },
    { type: 'note', id: 2, time: 0.01, duration: 0.2, note: 48, voice },
    { type: 'note', id: 3, time: 0.02, duration: 0.2, note: 50, voice },
  ];
  const protectedMelody = renderSequence(score, { sampleRate: 16000, maxVoices: 1 });
  const melodyOnly = renderSequence(score.slice(0, 1), { sampleRate: 16000, maxVoices: 1 });
  assert.deepEqual(protectedMelody.left.subarray(0, melodyOnly.left.length), melodyOnly.left, 'rejected accompaniment leaves the protected melody bitwise intact');
  assert.ok(protectedMelody.left.subarray(melodyOnly.left.length).every(value => value === 0));
  assert.equal(protectedMelody.diagnostics.errors, 0);
  const repeat = renderSequence(score, { sampleRate: 16000, maxVoices: 1 });
  assert.deepEqual(repeat.left, protectedMelody.left);
  assert.throws(() => renderSequence(score, { sampleRate: 16000, maxVoices: 33 }), RangeError);
  assert.throws(() => renderSequence([{ ...score[0]!, voicePriority: 1.5 } as SequenceEvent], { sampleRate: 16000 }), RangeError);
  const unprotected = renderSequence(score.map(event => event.type === 'note' ? { ...event, voicePriority: 0 } : event), { sampleRate: 16000, maxVoices: 1 });
  assert.notDeepEqual(unprotected.left, melodyOnly.left);
});

test('nested graph admissions select the current victim and conserve audible voices and slots', () => {
  for (const stealing of ['oldest', 'release-first', 'quietest'] as const) {
    for (const capacity of [1, 2]) {
      const synth = new Synth(16000, capacity, { stealing }), reference = new Synth(16000, capacity, { stealing });
      const bound = synth.freeVoices.length, ended: [number, string][] = [], expectedEnded: [number, string][] = [];
      synth.onVoiceEnded = (id, reason) => { ended.push([id, reason]); };
      reference.onVoiceEnded = (id, reason) => { expectedEnded.push([id, reason]); };
      if (capacity === 2) {
        synth.noteOn(voice, 64, 10);
        reference.noteOn(voice, 64, 10);
        assert.deepEqual(audio(synth, 64), audio(reference, 64));
      }
      reference.noteOn(voice, 72, 2);
      reference.noteOn(voice, 60, 1);
      const failure = duringGraphRead(() => { synth.noteOn(voice, 72, 2); }, () => synth.noteOn(voice, 60, 1));
      assert.equal(failure, undefined);
      assert.equal(synth.lastStolenId, capacity === 1 ? 2 : 10);
      assert.deepEqual(ended, expectedEnded);
      assert.deepEqual(synth.voices.map(active => active.id), reference.voices.map(active => active.id));
      assert.equal(synth.freeVoices.length + synth.voices.length + synth.fades.length, bound);
      const expected = audio(reference, 256);
      assert.ok(expected.left.some(sample => Math.abs(sample) > 0.01));
      assert.deepEqual(audio(synth, 256), expected);
      synth.allNotesOff();
      reference.allNotesOff();
      assert.deepEqual(audio(synth, 1600), audio(reference, 1600));
      assert.deepEqual(ended, expectedEnded);
      assert.equal(synth.freeVoices.length, bound);
      assert.equal(synth.errorCount, 0);
    }
  }
});

test('a protected nested graph admission rejects the pending note without losing audio or its spare', () => {
  const synth = new Synth(16000, 1), reference = new Synth(16000, 1), bound = synth.freeVoices.length;
  reference.noteOn(voice, 72, 2, { voicePriority: 1 });
  const failure = duringGraphRead(() => { synth.noteOn(voice, 72, 2, { voicePriority: 1 }); },
    () => synth.noteOn(voice, 60, 1));
  assert.ok(failure instanceof VoiceAdmissionError);
  assert.deepEqual(synth.voices.map(active => active.id), [2]);
  assert.equal(synth.noteOff(1), false);
  assert.equal(synth.freeVoices.length + synth.voices.length + synth.fades.length, bound);
  assert.deepEqual(audio(synth, 256), audio(reference, 256));
  assert.equal(synth.noteOff(2), true);
  assert.equal(reference.noteOff(2), true);
  assert.deepEqual(audio(synth, 1600), audio(reference, 1600));
  assert.equal(synth.freeVoices.length, bound);
  synth.noteOn(voice, 67, 1);
  reference.noteOn(voice, 67, 1);
  assert.deepEqual(audio(synth, 256), audio(reference, 256));
  synth.allNotesOff();
  reference.allNotesOff();
  assert.deepEqual(audio(synth, 1600), audio(reference, 1600));
  assert.equal(synth.freeVoices.length, bound);
  assert.equal(synth.errorCount, 0);
});

test('nested graph admissions cannot duplicate a pending explicit or automatic ID', () => {
  for (const automatic of [false, true]) {
    const synth = new Synth(16000, 2), reference = new Synth(16000, 2), bound = synth.freeVoices.length;
    reference.noteOn(voice, 72, 1);
    const failure = duringGraphRead(() => { synth.noteOn(voice, 72, 1); },
      () => synth.noteOn(voice, 60, automatic ? undefined : 1));
    assert.ok(failure instanceof RangeError);
    assert.match(failure.message, /id already active/);
    assert.deepEqual(synth.voices.map(active => active.id), [1]);
    assert.equal(synth.freeVoices.length + synth.voices.length + synth.fades.length, bound);
    assert.deepEqual(audio(synth, 256), audio(reference, 256));
    assert.equal(synth.noteOff(1), true);
    assert.equal(reference.noteOff(1), true);
    assert.deepEqual(audio(synth, 1600), audio(reference, 1600));
    assert.equal(synth.noteOn(voice, 67), 2);
    assert.equal(reference.noteOn(voice, 67), 2);
    assert.deepEqual(audio(synth, 256), audio(reference, 256));
    synth.allNotesOff();
    reference.allNotesOff();
    assert.deepEqual(audio(synth, 1600), audio(reference, 1600));
    assert.equal(synth.freeVoices.length, bound);
    assert.equal(synth.errorCount, 0);
  }
});

test('equal-sized nested cancellation and replacement retain higher-priority ownership', () => {
  const synth = new Synth(16000, 2), reference = new Synth(16000, 2), bound = synth.freeVoices.length;
  const ended: [number, string][] = [], expectedEnded: [number, string][] = [];
  synth.onVoiceEnded = (id, reason) => { ended.push([id, reason]); };
  reference.onVoiceEnded = (id, reason) => { expectedEnded.push([id, reason]); };
  for (const engine of [synth, reference]) {
    engine.noteOn(voice, 60, 10);
    engine.noteOn(voice, 64, 11);
  }
  assert.deepEqual(audio(synth, 64), audio(reference, 64));
  const replace = (engine: Synth) => {
    engine.panic();
    engine.noteOn(voice, 72, 20, { voicePriority: 1 });
    engine.noteOn(voice, 74, 21, { voicePriority: 1 });
  };
  replace(reference);
  const failure = duringGraphRead(() => { replace(synth); }, () => synth.noteOn(voice, 67, 1));
  assert.ok(failure instanceof VoiceAdmissionError);
  assert.deepEqual(ended, expectedEnded);
  assert.deepEqual(synth.voices.map(active => active.id), [20, 21]);
  assert.equal(synth.freeVoices.length + synth.voices.length + synth.fades.length, bound);
  assert.deepEqual(audio(synth, 256), audio(reference, 256));
  synth.allNotesOff();
  reference.allNotesOff();
  assert.deepEqual(audio(synth, 1600), audio(reference, 1600));
  assert.deepEqual(ended, expectedEnded);
  assert.equal(synth.freeVoices.length, bound);
  assert.equal(synth.errorCount, 0);
});

test('rendering inside a graph getter cannot retire and refill a stale victim index', () => {
  const synth = new Synth(16000, 2), reference = new Synth(16000, 2), bound = synth.freeVoices.length;
  for (const engine of [synth, reference]) {
    engine.noteOn(voice, 64, 10, { voicePriority: 1 });
    engine.noteOn(voice, 67, 11);
  }
  assert.deepEqual(audio(synth, 64), audio(reference, 64));
  assert.equal(reference.noteOff(11), true);
  const expectedDuring = audio(reference, 1600);
  reference.noteOn(voice, 72, 20, { voicePriority: 1 });
  let released = false, during: ReturnType<typeof audio> | undefined;
  const failure = duringGraphRead(() => {
    released = synth.noteOff(11);
    during = audio(synth, 1600);
    synth.noteOn(voice, 72, 20, { voicePriority: 1 });
  }, () => synth.noteOn(voice, 60, 1));
  assert.ok(failure instanceof VoiceAdmissionError);
  assert.equal(released, true);
  assert.deepEqual(during, expectedDuring);
  assert.deepEqual(synth.voices.map(active => active.id), [10, 20]);
  assert.equal(synth.freeVoices.length + synth.voices.length + synth.fades.length, bound);
  assert.deepEqual(audio(synth, 256), audio(reference, 256));
  synth.allNotesOff();
  reference.allNotesOff();
  assert.deepEqual(audio(synth, 1600), audio(reference, 1600));
  assert.equal(synth.freeVoices.length, bound);
  assert.equal(synth.errorCount, 0);
});
