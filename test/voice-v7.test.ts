import test from 'node:test';
import assert from 'node:assert/strict';
import { Synth } from '../src/core/synth.js';
import { renderNote } from '../src/core/index.js';
import { advanceNoise, fastSin, NOISE_SEED, periodicWaveform, TAU, waveformCode } from '../src/core/operator.js';
import { normalizeVoice, prepareVoice } from '../src/voices/normalize.js';
import { parseVoiceBank, validateVoice } from '../src/voices/schema.js';
import type { OperatorWaveform, Voice, VoiceInput } from '../src/voices/schema.js';
import { originalPresets } from '../src/voices/original.js';

function tone(waveform: OperatorWaveform = 'sine', noiseRate = 8000): Voice {
  return { version: 8, name: 'v7-test', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
    ops: [0, 1, 2, 3].map(i => ({ ratio: 1, level: i === 0 ? 0.8 : 0, detune: 0,
      waveform, noiseRate, adsr: { a: 0, d: 0, s: 1, r: 0.04 } })) as Voice['ops'] };
}
function energy(samples: Float32Array): number {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return sum / samples.length;
}
function changes(samples: Float32Array): number {
  let count = 0;
  for (let i = 1; i < samples.length; i++) if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) count++;
  return count;
}
function differenceEnergy(samples: Float32Array): number {
  let sum = 0;
  for (let i = 1; i < samples.length; i++) sum += (samples[i] - samples[i - 1]) ** 2;
  return sum / samples.length;
}
function audio(synth: Synth, frames: number): Float32Array {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  synth.render(left, right);
  return left;
}

test('rejected topology initialization cannot leave recycled carrier indices stale', () => {
  const synth = new Synth(8000, 1), reference = new Synth(8000, 1);
  const first = tone('noise');
  first.algorithm = 0;
  const next = prepareVoice(tone('noise'));
  synth.noteOn(prepareVoice(first), 60, 1);
  synth.panic();
  const saved = Object.getOwnPropertyDescriptor(Array.prototype, '1');
  const blocked = new Error('blocked graph input');
  let failure: unknown;
  try {
    // Frozen input arrays have absent second edges; fail after patch identity changes.
    Object.defineProperty(Array.prototype, '1', { configurable: true, get() { throw blocked; } });
    try { synth.noteOn(next, 60, 2); } catch (error) { failure = error; }
  } finally {
    if (saved) Object.defineProperty(Array.prototype, '1', saved);
    else Reflect.deleteProperty(Array.prototype, '1');
  }
  assert.equal(failure, blocked);
  synth.noteOn(next, 60, 3);
  reference.noteOn(next, 60, 3);
  const expected = audio(reference, 512);
  assert.ok(energy(expected) > 0);
  assert.deepEqual(audio(synth, 512), expected);
});

test('periodic shapes stay finite and bounded for negative, huge and modulated phases', () => {
  const shapes: OperatorWaveform[] = ['sine', 'half', 'abs', 'quarter', 'alternating', 'camel', 'square', 'saw'];
  let random = 123456789;
  for (const name of shapes) {
    const code = waveformCode(name);
    const phases = [0, -TAU, -Math.PI / 2, 1e300, -1e300, Number.MAX_VALUE];
    for (let i = 0; i < 2000; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      phases.push((random / 0xffffffff - 0.5) * 1e10);
    }
    for (const phase of phases) for (const modulation of [-1000, 0, 1000]) {
      const value = periodicWaveform(phase + modulation, code);
      assert.ok(Number.isFinite(value) && Math.abs(value) <= 1, name);
      if (name === 'half' || name === 'abs' || name === 'quarter' || name === 'camel') assert.ok(value >= 0);
      if (name === 'square') assert.ok(value === -1 || value === 1);
    }
  }
  assert.equal(periodicWaveform(0, waveformCode('square')), 1);
  assert.equal(periodicWaveform(0, waveformCode('saw')), 0);
  assert.ok(periodicWaveform(0.1, waveformCode('saw')) > 0);
  for (const angle of [Math.PI * 0.6, Math.PI * 0.9, Math.PI * 1.6, Math.PI * 1.9]) assert.equal(periodicWaveform(angle, 3), 0);
  for (const code of [4, 5]) for (const angle of [Math.PI * 1.1, Math.PI * 1.5, Math.PI * 1.9]) assert.equal(periodicWaveform(angle, code), 0);
  assert.ok(Math.abs(periodicWaveform(Math.PI / 4, 4) - 1) < 1e-9);
  assert.ok(Math.abs(periodicWaveform(Math.PI * 1.25, 3) - Math.SQRT1_2) < 1e-9);
});

/** Alias-to-harmonic power (dB) of exactly periodic frames: k cycles in N samples, so true harmonics
 * occupy bins m*k and every other bin holds folded (aliased) energy. */
function aliasRatioDb(code: number, k: number, dt: number): number {
  const n = 1024;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = periodicWaveform(TAU * ((k * i) % n) / n, code, dt);
  let harmonic = 0, folded = 0;
  for (let bin = 1; bin < n / 2; bin++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const angle = TAU * ((bin * i) % n) / n;
      re += x[i] * Math.cos(angle);
      im -= x[i] * Math.sin(angle);
    }
    if (bin % k === 0) harmonic += re * re + im * im;
    else folded += re * re + im * im;
  }
  return 10 * Math.log10(folded / harmonic);
}

test('polyBLEP square/saw and polyBLAMP half stay bounded, keep naive dt=0 shapes and cut aliases', () => {
  const naive = (code: number, t: number): number => code === 1 ? Math.max(0, fastSin(t * TAU)) :
    code === 6 ? (t <= 0.5 ? 1 : -1) : 2 * ((t + 0.5) - Math.floor(t + 0.5)) - 1;
  let random = 24681357;
  for (const code of [1, 6, 7]) {
    for (let i = 0; i < 20000; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const t = random / 0x100000000;
      const dt = (i % 50) / 49 * 0.45;
      const value = periodicWaveform(t * TAU, code, dt);
      assert.ok(Number.isFinite(value) && Math.abs(value) <= 1, `${code} ${t} ${dt}`);
      if (code === 1) assert.ok(value >= 0);
      assert.ok(Math.abs(periodicWaveform(t * TAU, code, 0) - naive(code, t)) < 1e-15);
      // Residuals only touch samples within one step of a jump or corner.
      const edges = code === 1 || code === 6 ? [0, 0.5, 1] : [0.5];
      if (edges.every((edge) => Math.abs(t - edge) >= Math.min(dt, code === 1 ? 0.25 : dt))) {
        assert.ok(Math.abs(value - naive(code, t)) < 1e-15);
      }
    }
  }
  // A jump lands halfway between its neighbours; the half-wave corner rises above zero.
  for (const angle of [0, Math.PI, TAU]) assert.ok(Math.abs(periodicWaveform(angle, 6, 0.1)) < 1e-15);
  assert.ok(Math.abs(periodicWaveform(Math.PI, 7, 0.1)) < 1e-15);
  assert.ok(periodicWaveform(0, 1, 0.1) > 0);
  for (const [code, k, gain] of [[1, 37, 8], [1, 151, 8], [6, 37, 6], [6, 151, 10], [7, 37, 12], [7, 151, 12]]) {
    const before = aliasRatioDb(code, k, 0), after = aliasRatioDb(code, k, k / 1024);
    assert.ok(after < before - gain, `${code}@${k}: ${before.toFixed(1)} -> ${after.toFixed(1)} dB`);
  }
});

test('fastSin is bounded, accurate and odd across reduction boundaries', () => {
  let random = 987654321;
  let worst = 0;
  const samples = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 1e6, -1e6, 3e9];
  for (let i = 0; i < 20000; i++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    samples.push((random / 0xffffffff - 0.5) * 400);
  }
  for (const x of samples) {
    const value = fastSin(x);
    assert.ok(Math.abs(value) <= 1, `bounded at ${x}`);
    // Reduction by a double-precision pi adds ~|x|*1e-16, so accuracy is asserted for realistic phases only.
    if (Math.abs(x) <= 1000) worst = Math.max(worst, Math.abs(value - Math.sin(x)));
    assert.ok(fastSin(-x) + value === 0, `odd at ${x}`);
  }
  assert.ok(worst < 3e-10, `max error ${worst}`);
  for (const bad of [NaN, Infinity, -Infinity]) assert.ok(Number.isNaN(fastSin(bad)));
});

test('sine and waveform frames render identically to the generic path', () => {
  const lfo = { rate: 5, amDepth: 0.4, pmDepth: 20, waveform: 'sine' } as const;
  const render = (voice: VoiceInput): Float32Array => {
    const synth = new Synth(48000, 4);
    synth.noteOn(voice, 57);
    return audio(synth, 4800);
  };
  const shapes: OperatorWaveform[][] = [
    ['sine', 'sine', 'sine', 'sine'], ['sine', 'square', 'sine', 'saw'],
    ['half', 'abs', 'quarter', 'camel'], ['alternating', 'sine', 'square', 'sine'],
  ];
  for (const waveforms of shapes) {
    for (const algorithm of [0, 1, 2, 3, 4, 5, 6, 7] as const) {
      // One zero-level operator outputs exact zero on both paths; making it noise
      // selects the generic loop without changing any other operator's arithmetic.
      // Rotating it over operators 0..2 leaves every operator audible in some run
      // (operator 3 is a carrier in every algorithm).
      for (const silent of [0, 1, 2]) {
        const voice = (generic: boolean): VoiceInput => ({ ...tone(), algorithm, feedback: 3, modIndex: 4, lfo,
          ops: waveforms.map((waveform, i) => ({ ratio: i + 1, level: i === silent ? 0 : 0.5, detune: i,
            waveform: generic && i === silent ? 'noise' : waveform, noiseRate: 8000,
            adsr: { a: 0.01, d: 0.1, s: 0.6, r: 0.05 } })) as unknown as Voice['ops'] });
        const fast = render(voice(false)), slow = render(voice(true));
        assert.ok(energy(fast) > 1e-4);
        assert.deepEqual(fast, slow, `algorithm ${algorithm}, ${waveforms.join('/')}, silent ${silent}`);
      }
    }
  }
});

test('noise carriers ignore periodic modulators through live controls', () => {
  const carriers = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3]];
  for (const quality of ['eco', 'standard', 'high'] as const) for (let algorithm = 0; algorithm < carriers.length; algorithm++) {
    const fixture = (muted: boolean): Voice => ({ ...tone('noise'), algorithm: algorithm as Voice['algorithm'], feedback: 3, modIndex: 4,
      ops: Array.from({ length: 4 }, (_, i) => {
        const carrier = carriers[algorithm].includes(i);
        return { ratio: i + 1, level: carrier || !muted ? .5 : 0, detune: i,
          waveform: carrier ? 'noise' : i % 2 ? 'saw' : 'sine', noiseRate: 1137 + i * 71,
          adsr: { a: 0, d: 0, s: .7, r: .015 } };
      }) as unknown as Voice['ops'] });
    const engines = [false, true].map(muted => {
      const synth = new Synth(16000, 2, { quality }); synth.noteOn(fixture(muted), 57, 1); return synth;
    });
    const compare = (length: number): void => {
      const output = engines.map(synth => {
        const left = new Float32Array(length), right = new Float32Array(length); synth.render(left, right);
        assert.equal(synth.errorCount, 0); return { left, right };
      });
      assert.deepEqual(output[0], output[1], `${quality}, algorithm ${algorithm}`);
    };
    compare(96);
    for (const synth of engines) synth.updateNote(1, { operatorLevels: [.2, .9, .4, .7], operatorRatios: [.75, 2.25, 5, 7.5], ramp: .003 });
    compare(39);
    for (const synth of engines) synth.updateNote(1, { pitch: 4, glide: .004, pan: -.3, expression: .6, ramp: .002 });
    compare(128);
    for (const synth of engines) synth.noteOff(1);
    compare(1024);
  }
});

test('periodic carriers retain modulation beside a noise carrier', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) {
    const output = [0, .5].map(modulator => {
      const input: Voice = { ...tone(), algorithm: 4, feedback: 3, modIndex: 4,
        ops: Array.from({ length: 4 }, (_, i) => ({ ratio: i + 1, level: i === 0 ? modulator : i === 2 ? 0 : .5,
          detune: 0, waveform: i === 3 ? 'noise' : 'sine', noiseRate: 1137, adsr: { a: 0, d: 0, s: 1, r: .03 } })) as unknown as Voice['ops'] };
      const synth = new Synth(16000, 2, { quality }); synth.noteOn(input, 57);
      return audio(synth, 1024);
    });
    const difference = Float32Array.from(output[0], (value, index) => value - output[1][index]);
    assert.ok(energy(difference) > 1e-6, quality);
  }
});

test('periodic carriers after noise ignore only the upstream periodic modulation', () => {
  for (const quality of ['eco', 'standard', 'high'] as const) for (const algorithm of [0, 1] as const) {
    const fixture = (ignored: number, noiseLevel = .5): Voice => ({ ...tone(), algorithm, feedback: 3, modIndex: 4,
      lfo: { rate: 5, amDepth: .2, pmDepth: 23, waveform: 'noise', amTargets: [1, .5, .3, .7], pmTargets: [.5, 1, 0, .3] },
      ops: Array.from({ length: 4 }, (_, i) => ({ ratio: i + 1, level: i === 0 ? ignored : i === 2 ? noiseLevel : .5,
        detune: i, waveform: i === 2 ? 'noise' : 'sine', noiseRate: 1337,
        adsr: { a: 0, d: 0, s: .7, r: .015 } })) as unknown as Voice['ops'] });
    const engines = [.5, 0].map(level => {
      const synth = new Synth(16000, 2, { quality }); synth.noteOn(fixture(level), 57, 1); return synth;
    });
    const compare = (length: number): { left: Float32Array; right: Float32Array } => {
      const output = engines.map(synth => {
        const left = new Float32Array(length), right = new Float32Array(length); synth.render(left, right);
        assert.equal(synth.errorCount, 0); return { left, right };
      });
      assert.deepEqual(output[0], output[1], `${quality}, algorithm ${algorithm}`); return output[0];
    };
    const first = compare(96), unmodulated = new Synth(16000, 2, { quality });
    unmodulated.noteOn(fixture(.5, 0), 57, 1);
    const reference = audio(unmodulated, 96);
    assert.ok(energy(Float32Array.from(first.left, (value, index) => value - reference[index])) > 1e-6);
    for (const synth of engines) synth.updateNote(1, { operatorLevels: [.3, .6, .7, .2], operatorRatios: [.75, 2.25, 5, 7.5], ramp: .003 });
    compare(39);
    for (const synth of engines) synth.updateNote(1, { pitch: 4, glide: .004, expression: .6, pan: -.2, ramp: .002 });
    compare(128);
    for (const synth of engines) synth.noteOff(1);
    compare(1024);
  }
});

test('inaudible periodic modulators still expose nonfinite phase and gain state', () => {
  const layouts = [{ noise: 3, levels: [.5, 0, 0, .5] }, { noise: 2, levels: [.5, .5, .5, .5] }];
  for (const quality of ['eco', 'standard', 'high'] as const) for (const fault of ['phase', 'gain']) for (const layout of layouts) {
    const input: Voice = { ...tone(), algorithm: 0, modIndex: 4,
      ops: tone().ops.map((op, i) => ({ ...op, level: layout.levels[i], waveform: i === layout.noise ? 'noise' : 'sine' })) as unknown as Voice['ops'] };
    const synth = new Synth(16000, 2, { quality }), ended: unknown[] = [];
    synth.onVoiceEnded = (...event) => ended.push(event); synth.noteOn(input, 57, 1); audio(synth, 128);
    if (fault === 'phase') synth.voices[0].phases[0] = NaN;
    else synth.voices[0].sineFrame[0] = NaN;
    assert.ok(audio(synth, 256).every(Number.isFinite));
    assert.equal(synth.errorCount, 1); assert.deepEqual(ended, [[1, 'error']]);
  }
});

test('legacy versions retain restrictions and canonicalize to v8 with identical sine samples', () => {
  const current = tone();
  current.ops.forEach(op => { delete op.waveform; delete op.noiseRate; });
  const expected = renderNote({ voice: current, note: 65, duration: 0.08, sampleRate: 22050 }).left;
  for (const version of [1, 2, 3, 4, 5, 6] as const) {
    const legacy = { ...current, version, lfo: { rate: 0, amDepth: 0, pmDepth: 0 } } as VoiceInput;
    assert.equal(normalizeVoice(legacy).version, 8);
    assert.equal(validateVoice(legacy).version, 8);
    assert.deepEqual(renderNote({ voice: validateVoice(legacy), note: 65, duration: 0.08, sampleRate: 22050 }).left, expected);
    for (const field of [{ waveform: 'sine' }, { noiseRate: 8000 }]) {
      const invalid = structuredClone(legacy); Object.assign(invalid.ops[0], field);
      assert.throws(() => normalizeVoice(invalid), /requires? voice version 7/);
      assert.throws(() => validateVoice(invalid), /requires? voice version 7/);
    }
  }
  assert.deepEqual(renderNote({ voice: tone(), note: 65, duration: 0.08, sampleRate: 22050 }).left, expected);
});

test('explicit v7 operator waveforms normalize to v8', () => {
  for (const waveform of ['sine', 'half', 'abs', 'quarter', 'alternating', 'camel', 'square', 'saw', 'noise'] as const) {
    const current = tone(waveform);
    const { pan: _pan, ...patch } = current;
    const legacy: VoiceInput = { ...patch, version: 7,
      lfo: { rate: 0, amDepth: 0, pmDepth: 0, waveform: 'sine' },
      ops: current.ops.map(op => ({ ...op, adsr: { a: op.adsr.a, d: op.adsr.d, s: op.adsr.s, r: op.adsr.r } })) as unknown as
        Extract<VoiceInput, { version: 7 }>['ops'] };
    for (const convert of [normalizeVoice, validateVoice]) {
      assert.equal(convert(legacy).version, 8);
      assert.deepEqual(convert(legacy), current);
    }
  }
});

test('17-bit noise recurrence is maximal length and deterministic', () => {
  let state = NOISE_SEED;
  for (let tick = 1; tick <= 131071; tick++) {
    state = advanceNoise(state);
    assert.ok(state > 0 && state <= 131071);
    if (tick < 131071) assert.notEqual(state, NOISE_SEED);
  }
  assert.equal(state, NOISE_SEED);
  const patch = tone('noise');
  const options = { voice: patch, duration: 0.3, sampleRate: 48000 };
  assert.deepEqual(renderNote(options).left, renderNote(options).left);
  const synth = new Synth(48000, 1);
  synth.noteOn(patch, 20);
  const first = audio(synth, 4096);
  synth.panic();
  synth.noteOn(patch, 100);
  assert.deepEqual(audio(synth, 4096), first, 'pooled slot admission resets noise regardless of pitch');
  synth.panic();
  patch.ops[0].frequency = 20000; patch.ops[0].detune = 1200;
  synth.noteOn(patch, 60);
  synth.updateNote(3, { pitch: 48, operatorRatios: [32, 1, 1, 1], operatorFrequencies: [1, null, null, null] });
  assert.deepEqual(audio(synth, 4096), first, 'pitch controls remain valid but cannot pitch noise');
});

test('pooled operator-noise clocks restart after periodic patch reuse and preserve subsequent live controls', () => {
  const shapes = [['noise', 'noise', 'noise', 'noise'], ['sine', 'noise', 'saw', 'noise'], ['sine', 'saw', 'noise', 'sine']] as const;
  for (const quality of ['eco', 'standard', 'high'] as const) for (const rate of [8000, 48000]) {
    for (const algorithm of [0, 4, 7] as const) for (const waveforms of shapes) {
      const definition = tone();
      definition.algorithm = algorithm; definition.feedback = 3; definition.modIndex = 4; definition.pan = 0.2;
      definition.lfo = { rate: 5, amDepth: 0.2, pmDepth: 50, waveform: 'noise' };
      definition.ops.forEach((op, index) => {
        op.waveform = waveforms[index]; op.level = 0.2; op.ratio = index + 1; op.noiseRate = 1337 + index * 71;
      });
      const patch = prepareVoice(definition), periodic = prepareVoice({ ...definition,
        ops: definition.ops.map((op, index) => ({ ...op, waveform: index % 2 ? 'saw' : 'sine' })) as Voice['ops'] });
      const synth = new Synth(rate, 1, { quality }), fresh = new Synth(rate, 1, { quality });
      synth.noteOn(patch, 57); audio(synth, 257); synth.panic();
      synth.noteOn(periodic, 57); audio(synth, 129); synth.panic();
      const id = synth.noteOn(patch, 57), expectedId = fresh.noteOn(patch, 57);
      const compare = (frames: number): Float32Array => {
        const left = new Float32Array(frames), right = new Float32Array(frames);
        const expectedLeft = new Float32Array(frames), expectedRight = new Float32Array(frames);
        synth.render(left, right); fresh.render(expectedLeft, expectedRight);
        assert.deepEqual(left, expectedLeft); assert.deepEqual(right, expectedRight);
        return left;
      };
      assert.ok(energy(compare(512)) > 1e-6);
      const controls = { pitch: 5, glide: 0.005, operatorLevels: [0, 0.3, 0.6, 0.1] as const, ramp: 0.01 };
      assert.equal(synth.updateNote(id, controls), true); assert.equal(fresh.updateNote(expectedId, controls), true);
      compare(511);
      assert.equal(synth.noteOff(id), true); assert.equal(fresh.noteOff(expectedId), true);
      compare(2048);
      assert.equal(synth.errorCount, 0); assert.equal(fresh.errorCount, 0);
    }
  }
});

test('noise-only frames match an inaudible control-ramp reference', () => {
  for (const [sampleRate, quality] of [[8000, 'eco'], [48000, 'standard'], [192000, 'high']] as const) {
    for (const algorithm of [0, 1, 2, 3, 4, 5, 6, 7] as const) {
      for (const inactivePeriodic of [false, true]) {
        const voice = tone('noise', 20000), muted = algorithm % 3;
        voice.algorithm = algorithm; voice.feedback = 7; voice.modIndex = 16; voice.pan = 0.3;
        voice.lfo = { rate: 7, amDepth: 0.3, pmDepth: 100, waveform: 'noise',
          amTargets: [1, 0.5, 0, 0.25], pmTargets: [0, 1, 0.25, 0.75] };
        voice.ops.forEach((op, i) => {
          op.ratio = i + 1; op.level = inactivePeriodic && i === muted ? 0 : 0.7;
          op.adsr.s = i === muted ? 0 : 0.6; op.adsr.r = 0.01;
          if (inactivePeriodic && i === muted) op.waveform = 'saw';
        });
        const fast = new Synth(sampleRate, 1, { quality }), reference = new Synth(sampleRate, 1, { quality });
        fast.noteOn(voice, 69, 1); reference.noteOn(voice, 69, 1);
        // A ramp on an inaudible operator selects generic rendering without changing the sound.
        const levels: [number, number, number, number] = [1, 1, 1, 1]; levels[muted] = 0;
        reference.updateNote(1, { operatorLevels: levels, ramp: 10 });
        const left = new Float32Array(128), right = new Float32Array(128);
        const expectedLeft = new Float32Array(128), expectedRight = new Float32Array(128);
        for (let block = 0; block < 32; block++) {
          if (block === 16) reference.updateNote(1, { operatorLevels: [1, 1, 1, 1] });
          for (const synth of [fast, reference]) {
            if (block === 8) synth.updateNote(1, { pitch: 12, glide: 0.005 });
            if (block === 16) {
              // Waking the silent noise operator exposes any lost hold-clock advancement.
              const adsr = { a: 0, d: 0, s: 0.6, r: 0.01 };
              synth.updateNote(1, { operatorADSR: [adsr, adsr, adsr, adsr] });
            }
            if (block === 24) synth.noteOff(1);
          }
          fast.render(left, right); reference.render(expectedLeft, expectedRight);
          assert.deepEqual(left, expectedLeft); assert.deepEqual(right, expectedRight);
          if (block === 0) assert.ok(energy(left) > 0);
        }
        assert.equal(fast.errorCount, 0); assert.equal(reference.errorCount, 0);
      }
    }
  }
});

test('noise is broadband and hold rate controls its spectral content across sample clocks', () => {
  const render = (waveform: OperatorWaveform, noiseRate: number, sampleRate = 48000) =>
    renderNote({ voice: tone(waveform, noiseRate), duration: 1, sampleRate }).left.subarray(Math.ceil(sampleRate * 0.05), sampleRate);
  const sine = render('sine', 8000), slow = render('noise', 20), fast = render('noise', 20000);
  assert.ok(changes(fast) > changes(slow) * 100);
  // First-difference energy weights upper frequencies (4*sin²(pi*f/fs)).
  assert.ok(differenceEnergy(fast) / energy(fast) > differenceEnergy(sine) / energy(sine) * 20);
  const lowClock = energy(render('noise', 8000, 22050)), highClock = energy(render('noise', 8000, 48000));
  assert.ok(lowClock / highClock > 0.65 && lowClock / highClock < 1.35, `${lowClock / highClock}`);
  const minimumClock = render('noise', 20000, 8000);
  assert.ok(minimumClock.every(Number.isFinite) && energy(minimumClock) > 1e-5);
});

test('waveform snapshots, strict bounds and bank JSON preserve new fields', () => {
  const patch = tone('noise', 1234);
  const prepared = prepareVoice(patch);
  patch.ops[0].noiseRate = 20;
  assert.equal(prepared.ops[0].noiseRate, 1234);
  assert.ok(Object.isFrozen(prepared.ops[0]));
  const bank = parseVoiceBank(JSON.stringify([prepared]));
  assert.deepEqual(bank.get('v7-test'), prepared);
  for (const value of [19, 20001, NaN, Infinity]) {
    const invalid = tone('noise', value);
    assert.throws(() => normalizeVoice(invalid));
  }
  for (const value of ['triangle', '', null]) {
    const invalid = tone(); Object.assign(invalid.ops[0], { waveform: value });
    assert.throws(() => normalizeVoice(invalid)); assert.throws(() => validateVoice(invalid));
  }
  let reads = 0;
  Object.defineProperty(patch.ops[0], 'waveform', { get() { reads++; return 'noise'; } });
  assert.throws(() => prepareVoice(patch)); assert.throws(() => validateVoice(patch)); assert.equal(reads, 0);
  const a = tone('saw', 20), b = tone('saw', 20000);
  assert.deepEqual(renderNote({ voice: a, duration: 0.05 }).left, renderNote({ voice: b, duration: 0.05 }).left);
});

test('noise envelopes retire to silence, and extreme feedback/PM stay finite in every graph', () => {
  for (const algorithm of [0, 1, 2, 3, 4, 5, 6, 7] as const) {
    const patch = tone('noise', 20000); patch.algorithm = algorithm; patch.feedback = 7; patch.modIndex = 16;
    patch.ops.forEach((op, index) => { op.level = 0.7; if (index === 3) op.waveform = 'saw'; });
    const output = renderNote({ voice: patch, duration: 0.06, sampleRate: 22050 });
    assert.equal(output.diagnostics.errors, 0); assert.ok(output.left.every(Number.isFinite));
    assert.ok(output.left.subarray(-32).every(value => value === 0));
  }
  for (const name of ['noise-snare', 'noise-hihat', 'explosion']) {
    const patch = originalPresets.find(voice => voice.name === name)!;
    const audio = renderNote({ voice: patch, note: 60, duration: 0.25, sampleRate: 48000 });
    assert.equal(audio.diagnostics.errors, 0); assert.ok(audio.left.every(value => Number.isFinite(value) && Math.abs(value) < 10 ** (-3 / 20)));
    assert.ok(energy(audio.left) > 1e-6, name);
  }
});
