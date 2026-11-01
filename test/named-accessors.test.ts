import assert from 'node:assert/strict';
import test from 'node:test';
import { OPM } from '../src/api/index.js';
import { beatsToSeconds } from '../src/api/transport.js';
import { preparedEnvelopeAt, prepareEnvelope } from '../src/core/envelope.js';
import { createStereoEffects, normalizeEffectsOptions } from '../src/core/fx.js';
import { Synth, validateNoteControls } from '../src/core/synth.js';
import type { NoteControls, SynthOptions } from '../src/core/synth.js';
import { prepareBeatSequence, prepareArrangementDefinition } from '../src/core/arrangement-definition.js';
import { prepareSequence, sequenceFrameEvents } from '../src/core/sequence.js';
import { replaceTempoFrom } from '../src/core/transport.js';
import { brass } from '../src/voices/brass.js';
import { prepareVoice } from '../src/voices/normalize.js';
import { validateVoice } from '../src/voices/schema.js';
import type { Voice, VoiceInput } from '../src/voices/schema.js';
import { withNamedAccessor } from './named-accessors-harness.js';

const expressive: Voice = {
  ...brass, pan: 0.25,
  pitchEnvelope: { a: 0.02, d: 0.03, r: 0.04, initial: -2, peak: 3, sustain: 1, final: 0 },
  lfo: { ...brass.lfo, delay: 0.01, sync: 'note', phase: 0.25, amTargets: [1, 0, 1, 0], pmTargets: [0, 1, 0, 1] },
  ops: brass.ops.map(op => ({
    ...op, frequency: 440, rateKeyScale: 0.25, velocitySensitivity: 0.5,
    waveform: 'saw', noiseRate: 100, adsr: { ...op.adsr, sr: 1 },
    keyScale: { breakpoint: 60, leftDbPerOctave: 1, rightDbPerOctave: 2 },
  })) as Voice['ops'],
};

function audio(voice: VoiceInput, controls?: NoteControls): [Float32Array, Float32Array] {
  const synth = new Synth(48000);
  const id = synth.noteOn(voice, 64);
  if (controls) assert.equal(synth.updateNote(id, controls), true);
  const left = new Float32Array(2048), right = new Float32Array(2048);
  synth.render(left, right);
  assert.equal(synth.errorCount, 0);
  return [left, right];
}

const optionalVoiceKeys = [
  'name', 'pan', 'pitchEnvelope', 'sr', 'velocitySensitivity', 'frequency', 'rateKeyScale',
  'waveform', 'noiseRate', 'keyScale', 'delay', 'sync', 'phase', 'amTargets', 'pmTargets',
];

test('prepared voices retain optional own data and audio despite inherited setters', () => {
  const clean = prepareVoice(expressive), expectedAudio = audio(clean);
  for (const key of optionalVoiceKeys) {
    const result = withNamedAccessor(key, () => prepareVoice(expressive));
    assert.equal(result.setterHits, 0, key);
    assert.deepStrictEqual(result.value, clean, key);
    assert.deepStrictEqual(audio(result.value), expectedAudio, key);
  }
});

test('bank voice validation retains optional own data and audio despite inherited setters', () => {
  const clean = validateVoice(expressive), expectedAudio = audio(clean);
  for (const key of optionalVoiceKeys) {
    const result = withNamedAccessor(key, () => validateVoice(expressive));
    assert.equal(result.setterHits, 0, key);
    assert.deepStrictEqual(result.value, clean, key);
    assert.deepStrictEqual(audio(result.value), expectedAudio, key);
  }
});

test('validated controls retain scalar and sustain edits despite inherited setters', () => {
  const input: NoteControls = {
    pitch: 2, glide: 0.01, expression: 0.75, pan: -0.5, modulation: 0.5, ramp: 0.01,
    feedback: 2, lfoRate: 4, amDepth: 0.25, pmDepth: 20, gain: 0.5,
    operatorADSR: [expressive.ops[0].adsr, expressive.ops[1].adsr, expressive.ops[2].adsr, expressive.ops[3].adsr],
  };
  const clean = validateNoteControls(input), voice = prepareVoice(expressive), expectedAudio = audio(voice, clean);
  for (const key of [...Object.keys(input), 'sr']) {
    const result = withNamedAccessor(key, () => validateNoteControls(input));
    assert.equal(result.setterHits, 0, key);
    assert.deepStrictEqual(result.value, clean, key);
    assert.deepStrictEqual(audio(voice, result.value), expectedAudio, key);
  }
});

test('descriptor prototype hooks cannot replace validated snapshot data', () => {
  const edits: NoteControls = { gain: 0.5, operatorADSR: [
    expressive.ops[0].adsr, expressive.ops[1].adsr, expressive.ops[2].adsr, expressive.ops[3].adsr,
  ] };
  const expected = [prepareVoice(expressive), validateVoice(expressive), validateNoteControls(edits)];
  for (const key of ['configurable', 'enumerable', 'value', 'writable', 'get', 'set']) {
    const saved = Object.getOwnPropertyDescriptor(Object.prototype, key);
    let callbacks = 0;
    let actual: typeof expected;
    try {
      Object.defineProperty(Object.prototype, key, {
        __proto__: null, configurable: true,
        get(this: { value?: unknown }) {
          callbacks++;
          this.value = Infinity;
          return undefined;
        },
      } as PropertyDescriptor);
      actual = [prepareVoice(expressive), validateVoice(expressive), validateNoteControls(edits)];
    } finally {
      if (saved) Object.defineProperty(Object.prototype, key, saved);
      else Reflect.deleteProperty(Object.prototype, key);
    }
    assert.equal(callbacks, 0, key);
    assert.deepStrictEqual(actual, expected, key);
    assert.deepStrictEqual(audio(actual[0] as VoiceInput, actual[2] as NoteControls),
      audio(expected[0] as VoiceInput, expected[2] as NoteControls), key);
  }
});

test('tempo replacement keeps a ramp end despite an inherited endBpm setter', () => {
  const map = [{ beat: 0, bpm: 60, curve: 'linear' as const }, { beat: 4, bpm: 120 }];
  const clean = replaceTempoFrom(2, 150, map);
  assert.equal(clean[0].endBpm, 90);
  const polluted = withNamedAccessor('endBpm', () => replaceTempoFrom(2, 150, map));
  assert.equal(polluted.setterHits, 0);
  assert.deepStrictEqual(polluted.value, clean);
  assert.equal(beatsToSeconds(3, polluted.value), beatsToSeconds(3, clean));
});

test('effects options keep every approved field despite inherited setters', () => {
  const chorus = { rate: 0.5, depth: 0.5, mix: 0.3 };
  const reverb = { size: 0.5, damping: 0.5, mix: 0.2 };
  for (const input of [{ chorus, reverb, order: 'reverb-chorus' as const }, { chorus }, { reverb }, {}]) {
    const clean = normalizeEffectsOptions(input);
    for (const key of ['chorus', 'reverb', 'order']) {
      const polluted = withNamedAccessor(key, () => normalizeEffectsOptions(input));
      assert.equal(polluted.setterHits, 0, key);
      assert.deepStrictEqual(polluted.value, clean, key);
    }
  }
  assert.equal(normalizeEffectsOptions({ chorus }).order, 'chorus-reverb');
});

test('Synth options keep every approved setting despite inherited setters', () => {
  const options: SynthOptions = { mixGain: 0.5, quality: 'high', stealing: 'quietest', saturation: 'soft-knee', dcBlock: true };
  function render(settings: SynthOptions) {
    const synth = new Synth(48000, 2, settings);
    synth.noteOn(brass, 60, 1, { velocity: 1 });
    synth.noteOn(brass, 64, 2, { velocity: 0.1 });
    synth.noteOn(brass, 67, 3);
    const left = new Float32Array(1024), right = new Float32Array(1024);
    synth.render(left, right);
    return { stolen: synth.lastStolenId, quality: synth.quality, left, right };
  }
  const clean = render(options);
  assert.notDeepStrictEqual(clean, render({}), 'the configured settings must be observable');
  for (const key of Object.keys(options)) {
    const polluted = withNamedAccessor(key, () => new Synth(48000, 2, options));
    assert.equal(polluted.setterHits, 0, key);
    const synth = polluted.value;
    synth.noteOn(brass, 60, 1, { velocity: 1 });
    synth.noteOn(brass, 64, 2, { velocity: 0.1 });
    synth.noteOn(brass, 67, 3);
    const left = new Float32Array(1024), right = new Float32Array(1024);
    synth.render(left, right);
    assert.deepStrictEqual({ stolen: synth.lastStolenId, quality: synth.quality, left, right }, clean, key);
  }
});

test('OPM instances keep their own state slots despite inherited setters', async () => {
  const names = ['sampleRate', '_maxVoices', '_voices', '_voiceIds', '_patchKeys', '_nextVoiceId', '_nextCommandId',
    '_synthOptions', '_interruption', 'context', 'node', 'nextId', 'onEvent', '_providedContext', '_destination',
    '_startPromise', '_closePromise', '_processorFailure', '_diagnostics', '_nextRequestId', '_contextListener',
    '_workletUrl', '_commands', '_commandWaiterCount', '_disposed', '_disposePromise'];
  for (const key of names) {
    const result = withNamedAccessor(key, () => new OPM({
      maxVoices: 5, quality: 'high', mixGain: 0.5, sampleRate: 44100, interruption: 'preserve',
    }));
    const opm = result.value;
    try {
      assert.equal(result.setterHits, 0, key);
      for (const name of names) assert.ok(Object.hasOwn(opm, name), `${key} → ${name}`);
      assert.equal(opm.maxVoices, 5, key);
      assert.equal(opm.quality, 'high', key);
      assert.equal(opm.sampleRate, 44100, key);
      assert.equal(opm.voices.has('brass'), true, key);
    } finally { await opm.dispose(); }
  }
});

test('named patches keep their name despite an inherited name setter', async () => {
  const { name: _name, ...unnamed } = brass;
  const opm = new OPM();
  try {
    const polluted = withNamedAccessor('name', () => { opm.loadVoice('lead', unnamed); return opm.voices.get('lead')!; });
    assert.equal(polluted.setterHits, 0);
    assert.equal(Object.hasOwn(polluted.value, 'name'), true);
    assert.equal(polluted.value.name, 'lead');
    assert.equal(JSON.parse(opm.exportVoiceBank())[1].name, 'lead');
  } finally { await opm.dispose(); }
});

test('prepared envelopes keep a sustain rate despite an inherited sr setter', () => {
  const clean = prepareEnvelope(0.1, 0.2, 0.5, 0.3, 0.4, 2);
  assert.equal(clean.sr, 2);
  const polluted = withNamedAccessor('sr', () => prepareEnvelope(0.1, 0.2, 0.5, 0.3, 0.4, 2));
  assert.equal(polluted.setterHits, 0);
  assert.deepStrictEqual(polluted.value, clean);
  for (const time of [0.05, 0.25, 0.6, 1.5]) assert.equal(preparedEnvelopeAt(time, 0.4, polluted.value), preparedEnvelopeAt(time, 0.4, clean));
  assert.equal(Object.hasOwn(prepareEnvelope(0.1, 0.2, 0.5, 0.3, 0.4), 'sr'), false);
});

function noteSound(prepare: (synth: Synth) => void, options: SynthOptions = {}): [Float32Array, Float32Array, number | null] {
  const synth = new Synth(48000, 2, options);
  prepare(synth);
  const left = new Float32Array(4096), right = new Float32Array(4096);
  synth.render(left, right);
  assert.equal(synth.errorCount, 0);
  return [left, right, synth.lastStolenId];
}

// Getters answer with out-of-range values while an omitted field is read: a snapshot must ignore them.
test('omitted voice fields are never read through Object.prototype', () => {
  const plain = prepareVoice(brass);
  const play = (synth: Synth): void => { synth.noteOn(plain, 64, 1, { velocity: 0.3 }); };
  const clean = noteSound(play);
  const hooks: [string, unknown][] = [
    ['frequency', 40], ['keyScale', { breakpoint: 0, leftDbPerOctave: 5000, rightDbPerOctave: 5000 }],
    ['rateKeyScale', 50], ['velocitySensitivity', 1e6], ['waveform', 'noise'], ['noiseRate', 1], ['pan', 1],
    ['pitchEnvelope', { a: 0, d: 0, r: 0, initial: 4800, peak: 4800, sustain: 4800, final: 4800 }],
    ['delay', 5], ['phase', 0.5], ['sync', 'global'], ['amTargets', [0, 0, 0, 0]], ['pmTargets', [0, 0, 0, 0]], ['sr', 0.01],
  ];
  for (const [key, inherited] of hooks) {
    const hooked = withNamedAccessor(key, () => noteSound(play), inherited);
    assert.deepStrictEqual(hooked.value, clean, key);
  }
});

test('omitted controls are never read through Object.prototype', () => {
  const voice = prepareVoice(brass);
  const slow = { a: 1, d: 1, s: 0.1, r: 1 };
  const cases: [NoteControls, [string, unknown][]][] = [
    [{ pan: 0.1 }, [['gain', 50], ['expression', 40], ['pitch', 36], ['modulation', 1e3], ['feedback', 7], ['lfoRate', 20],
      ['amDepth', 1], ['pmDepth', 1200], ['operatorLevels', [0, 0, 0, 0]], ['operatorRatios', [30, 30, 30, 30]],
      ['operatorFrequencies', [20000, 20000, 20000, 20000]], ['operatorADSR', [slow, slow, slow, slow]]]],
    [{ pitch: 2 }, [['glide', 5], ['ramp', 5]]],
    [{ expression: 0.5 }, [['ramp', 5]]],
    [{ operatorADSR: [slow, slow, slow, slow] }, [['sr', 0.01], ['rateKeyScale', 50]]],
  ];
  for (const [controls, hooks] of cases) {
    const snapshot = validateNoteControls(controls);
    const apply = (synth: Synth): void => { synth.updateNote(synth.noteOn(voice, 64, 1), snapshot); };
    const clean = noteSound(apply);
    for (const [key, inherited] of hooks) {
      assert.deepStrictEqual(withNamedAccessor(key, () => noteSound(apply), inherited).value, clean, `${Object.keys(controls)} ${key}`);
    }
  }
});

test('omitted Synth options are never read through Object.prototype', () => {
  const voice = prepareVoice(brass);
  const play = (synth: Synth): void => {
    synth.noteOn(voice, 60, 1, { velocity: 1 });
    synth.noteOn(voice, 64, 2, { velocity: 0.1 });
    synth.noteOn(voice, 67, 3);
  };
  const clean = noteSound(play);
  for (const [key, inherited] of [['mixGain', 1], ['quality', 'high'], ['stealing', 'quietest'], ['saturation', 'soft-knee'],
    ['dcBlock', true], ['tuning', { referenceHz: 500 }]] as const) {
    const hooked = withNamedAccessor(key, () => noteSound(play), inherited);
    assert.deepStrictEqual(hooked.value, clean, key);
  }
});

test('omitted effect sections are never read through Object.prototype', () => {
  const run = () => {
    const effects = createStereoEffects(48000, {});
    const left = new Float32Array(2048).fill(0.1), right = new Float32Array(2048).fill(-0.1);
    effects.process(left, right);
    return { tail: effects.tailSeconds, left, right };
  };
  const clean = run();
  const hooks: [string, unknown][] = [
    ['chorus', { rate: 10, depth: 1, mix: 1, feedback: 0.99, voices: 4 }],
    ['reverb', { size: 1, damping: 0, mix: 1, preDelay: 0.1, width: 1 }],
  ];
  for (const [key, inherited] of hooks) assert.deepStrictEqual(withNamedAccessor(key, run, inherited).value, clean, key);
});

test('loaded voices never freeze objects reached through Object.prototype', () => {
  for (const key of ['keyScale', 'pitchEnvelope']) {
    // The foreign object carries every field either optional block could need.
    const foreign = { breakpoint: 60, leftDbPerOctave: 1, rightDbPerOctave: 1, a: 0, d: 0, r: 0, initial: 0, peak: 0, sustain: 0, final: 0 };
    const opm = new OPM();
    const loaded = withNamedAccessor(key, () => { opm.loadVoice('plain', brass); return opm.voices.get('plain')!; }, foreign).value;
    assert.equal(Object.isFrozen(foreign), false, key);
    assert.equal(Object.hasOwn(loaded.ops[0], 'keyScale'), false, key);
    assert.equal(Object.hasOwn(loaded, 'pitchEnvelope'), false, key);
  }
});

test('sequence release bounds ignore an operatorADSR inherited by a control event', () => {
  const score = prepareSequence([
    { type: 'note', id: 1, time: 0, duration: 0.5, note: 60, voice: brass },
    { type: 'control', id: 1, time: 0.25, controls: { expression: 0.5 } },
  ]);
  const clean = sequenceFrameEvents(score, 16000);
  const slow = { a: 0, d: 0, s: 1, r: 10 };
  for (const inherited of [[slow, slow, slow, slow], []]) {
    const polluted = withNamedAccessor('operatorADSR', () => sequenceFrameEvents(score, 16000), inherited);
    assert.equal(polluted.setterHits, 0);
    assert.equal(polluted.value.length, clean.length);
  }
});

test('arrangement definitions ignore values inherited for omitted note voices and control gains', () => {
  const definition = {
    layers: [{ name: 'lead', length: 4, events: [
      { type: 'note' as const, id: 1, beat: 0, duration: 1, note: 60 },
      { type: 'control' as const, id: 1, beat: 0.5, controls: { expression: 0.5 } },
    ] }],
    sections: [{ name: 'main', layers: ['lead'] }], initialSection: 'main',
  };
  const clean = prepareArrangementDefinition(definition);
  const beats = prepareBeatSequence(definition.layers[0]!.events);
  for (const [key, inherited] of [['voice', 'zzz'], ['gain', 0.5]] as const) {
    const polluted = withNamedAccessor(key, () => ({ prepared: prepareArrangementDefinition(definition), beats: prepareBeatSequence(definition.layers[0]!.events) }), inherited);
    assert.equal(polluted.setterHits, 0, key);
    assert.deepStrictEqual(polluted.value.prepared.definition, clean.definition, key);
    assert.deepStrictEqual(polluted.value.beats.events, beats.events, key);
  }
});
