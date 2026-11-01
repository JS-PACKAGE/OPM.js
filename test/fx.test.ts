import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEffects, createStereoEffects, renderNote } from '../src/core/index.js';
import type { StereoEffectsOptions } from '../src/core/fx.js';
import { brass } from '../src/voices/brass.js';

const rate = 16000;
interface ImpulseResponse { left: Float32Array; right: Float32Array; tail: number }
function impulse(sampleRate: number, size: number, damping = 0): ImpulseResponse {
  const fx = createStereoEffects(sampleRate, { reverb: { size, damping, mix: 1 } });
  const left = new Float32Array(Math.ceil((fx.tailSeconds + 1) * sampleRate)), right = new Float32Array(left.length);
  left[0] = right[0] = 1; fx.process(left, right); return { left, right, tail: fx.tailSeconds };
}
function energy(samples: Float32Array, start = 0, end = samples.length): number {
  let sum = 0; for (let i = start; i < end; i++) sum += samples[i]! ** 2; return sum;
}
function highEnergy(samples: Float32Array, start: number): number {
  let sum = 0; for (let i = start; i < samples.length; i++) sum += (samples[i]! - samples[i - 1]!) ** 2; return sum;
}
test('effects bypass and zero mix preserve every finite input bit', () => {
  const left = Float32Array.of(-0, .3, -1, 1e30), right = left.slice();
  for (const options of [{}, { chorus: { rate: 1, depth: 1, mix: 0 }, reverb: { size: 1, damping: 1, mix: 0 } }]) {
    const l = left.slice(), r = right.slice(); createStereoEffects(rate, options).process(l, r);
    assert.deepEqual(l, left); assert.deepEqual(r, right);
  }
});
test('fixed chorus is a stereo 10 ms delay with documented wet headroom', () => {
  const fx = createStereoEffects(rate, { chorus: { rate: 1, depth: 0, feedback: 0, voices: 1, mix: 1 } });
  const left = new Float32Array(512), right = new Float32Array(512); left[0] = right[0] = 1;
  fx.process(left, right); assert.equal(left[160], Math.fround(.7)); assert.deepEqual(left, right); assert.equal(energy(left), Math.fround(.7) ** 2);
});
test('fractional chorus taps preserve stereo interpolation across a ring boundary', () => {
  // At 11025 Hz the fixed 10 ms delay is 110.25 frames; the impulse crosses a tap wrap.
  const fx = createStereoEffects(11025, { chorus: { rate: 1, depth: 0, feedback: 0, voices: 1, mix: 1 } });
  const left = new Float32Array(1024), right = new Float32Array(1024);
  left[222] = 1; right[222] = -.5;
  fx.process(left, right);
  const expectedLeft = new Float32Array(1024), expectedRight = new Float32Array(1024);
  expectedLeft[332] = .7 * .75; expectedLeft[333] = .7 * .25;
  expectedRight[332] = -.5 * .7 * .75; expectedRight[333] = -.5 * .7 * .25;
  assert.deepEqual(left, expectedLeft); assert.deepEqual(right, expectedRight);
});
test('sub-ulp chorus wrap preserves wet samples and bypass history', () => {
  for (const sampleRate of [8000, 48000, 192000]) for (const activate of [false, true]) {
    const length = Math.ceil(sampleRate * .08), activation = Math.round(sampleRate * .015);
    const outputs = [0, 5e-15].map(depth => {
      const chorus = { rate: .7, depth, mix: activate ? 0 : 1, feedback: 0, voices: 2 };
      const fx = createStereoEffects(sampleRate, { chorus });
      const left = new Float32Array(length).fill(.25), right = new Float32Array(length).fill(.2);
      if (activate) {
        fx.process(left, right, 0, activation); fx.update({ chorus: { ...chorus, mix: 1 } });
        fx.process(left, right, activation);
      } else fx.process(left, right);
      return [left, right];
    });
    let error = 0;
    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < length; i++) {
      error = Math.max(error, Math.abs(outputs[0]![channel]![i]! - outputs[1]![channel]![i]!));
    }
    assert.ok(error < 1e-7, `${sampleRate} Hz, activation ${activate}: ${error}`);
  }
});
test('an adjacent reverb pre-delay cannot drop the first impulse', () => {
  for (const sampleRate of [8000, 48000, 192000]) {
    const length = Math.ceil(sampleRate * .08);
    const outputs = [.01, .01 + .01 * Number.EPSILON].map(preDelay => {
      const fx = createStereoEffects(sampleRate, { reverb: { size: 0, damping: 0, mix: 1, preDelay, width: 1 } });
      const left = new Float32Array(length), right = new Float32Array(length); left[0] = .25; right[0] = -.2;
      fx.process(left, right); return [left, right];
    });
    let error = 0;
    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < length; i++) {
      error = Math.max(error, Math.abs(outputs[0]![channel]![i]! - outputs[1]![channel]![i]!));
    }
    assert.ok(error < 1e-7, `${sampleRate} Hz: ${error}`);
  }
});
test('zero-depth chorus keeps its LFO clock for subsequent depth ramps', () => {
  for (const sampleRate of [16000, 48000]) {
    const activation = Math.floor(sampleRate * .37), ramp = Math.ceil(sampleRate * .02);
    const length = activation + ramp + 1024, rate = 2.3;
    const sourceL = Float32Array.from({ length }, (_, n) => .25 * Math.sin(n * .17) + .125 * Math.sin(n * .043));
    const sourceR = Float32Array.from({ length }, (_, n) => .18 * Math.sin(n * .11 + .3) + .06 * Math.sin(n * .007));
    const left = sourceL.slice(), right = sourceR.slice();
    const chorus = { rate, depth: 0, mix: 1, feedback: 0, voices: 1 };
    const fx = createStereoEffects(sampleRate, { chorus });
    fx.process(left, right, 0, activation);
    fx.update({ chorus: { ...chorus, depth: 1 } });
    fx.process(left, right, activation);
    const interpolate = (source: Float32Array, position: number): number => {
      const base = Math.floor(position), fraction = position - base;
      return (source[base] ?? 0) * (1 - fraction) + (source[base + 1] ?? 0) * fraction;
    };
    let errorL = 0, errorR = 0;
    for (let n = 0; n < length; n++) {
      const depth = n < activation ? 0 : Math.min(1, (n - activation + 1) / ramp);
      const phase = 2 * Math.PI * rate * n / sampleRate, swing = sampleRate * .008 * depth;
      const expectedL = .7 * interpolate(sourceL, n - sampleRate * .01 - swing * Math.sin(phase));
      const expectedR = .7 * interpolate(sourceR, n - sampleRate * .01 - swing * Math.cos(phase));
      errorL = Math.max(errorL, Math.abs(left[n]! - expectedL));
      errorR = Math.max(errorR, Math.abs(right[n]! - expectedR));
    }
    assert.ok(errorL < 2e-6, `${sampleRate} Hz left delay reference: ${errorL}`);
    assert.ok(errorR < 2e-6, `${sampleRate} Hz right delay reference: ${errorR}`);
  }
});
test('zero-mix chorus keeps its phase and feedback history ready for activation', () => {
  for (const sampleRate of [16000, 48000]) for (const feedback of [0, .7]) {
    const activation = Math.floor(sampleRate * .37), ramp = Math.ceil(sampleRate * .02);
    const length = activation + ramp + 2048, chorus = { rate: 2.3, depth: 1, feedback, voices: 1 };
    const sourceL = Float32Array.from({ length }, (_, n) => .25 * Math.sin(n * .17) + .125 * Math.sin(n * .043));
    const sourceR = Float32Array.from({ length }, (_, n) => .18 * Math.sin(n * .11 + .3) + .06 * Math.sin(n * .007));
    const left = sourceL.slice(), right = sourceR.slice(), wetL = sourceL.slice(), wetR = sourceR.slice();
    createStereoEffects(sampleRate, { chorus: { ...chorus, mix: 1 } }).process(wetL, wetR);
    const fx = createStereoEffects(sampleRate, { chorus: { ...chorus, mix: 0 } });
    fx.process(left, right, 0, activation); fx.update({ chorus: { ...chorus, mix: 1 } });
    fx.process(left, right, activation);
    let error = 0;
    for (let n = activation; n < length; n++) {
      const mix = Math.min(1, (n - activation + 1) / ramp);
      error = Math.max(error, Math.abs(left[n]! - (sourceL[n]! * (1 - mix) + wetL[n]! * mix)));
      error = Math.max(error, Math.abs(right[n]! - (sourceR[n]! * (1 - mix) + wetR[n]! * mix)));
    }
    assert.ok(error < 1e-7, `${sampleRate} Hz, feedback ${feedback}: ${error}`);
    assert.deepEqual(left.subarray(activation + ramp), wetL.subarray(activation + ramp));
    assert.deepEqual(right.subarray(activation + ramp), wetR.subarray(activation + ramp));
  }
});
test('reverb decays by RMS blocks, size extends decay, tail is conservative', () => {
  for (const size of [0, .5, 1]) {
    const result = impulse(rate, size);
    let previous = Infinity;
    // Sparse early reflections are not monotonic per quantum; half-second windows encompass all delay paths.
    for (let start = rate / 2; start < result.tail * rate; start += rate / 2) {
      const next = energy(result.left, start, Math.min(start + rate / 2, result.left.length));
      assert.ok(next <= previous * 1.001); previous = next;
    }
    assert.ok(energy(result.left, Math.ceil(result.tail * rate)) < energy(result.left) * 1e-8);
  }
  const small = impulse(rate, .1), large = impulse(rate, .9);
  assert.ok(large.tail > small.tail); assert.ok(energy(large.left, rate) > energy(small.left, rate));
});
test('damping absorbs high-frequency tail energy', () => {
  const dry = impulse(rate, .8, 0), damp = impulse(rate, .8, 1);
  assert.ok(highEnergy(damp.left, rate / 2) < highEnergy(dry.left, rate / 2) * .2);
});
test('decay time remains independent of sample rate', () => {
  const a = impulse(22050, .6), b = impulse(48000, .6);
  function decay(result: ImpulseResponse, sampleRate: number): number {
    const total = energy(result.left); let remaining = total;
    for (let i = 0; i < result.left.length; i++) { remaining -= result.left[i]! ** 2; if (remaining < total * 1e-4) return i / sampleRate; }
    return result.tail;
  }
  assert.ok(Math.abs(decay(a, 22050) - decay(b, 48000)) < .1);
});
test('chorus modulation spreads a sinusoid into sidebands', () => {
  function spectrum(depth: number): number {
    const length = rate * 2, left = new Float32Array(length), right = new Float32Array(length);
    for (let i = 0; i < length; i++) left[i] = right[i] = .5 * Math.sin(2 * Math.PI * 400 * i / rate);
    createStereoEffects(rate, { chorus: { rate: 2, depth, voices: 1, mix: 1 } }).process(left, right);
    let side = 0;
    for (const frequency of [394, 396, 398, 402, 404, 406]) {
      let re = 0, im = 0;
      for (let i = rate; i < length; i++) { re += left[i]! * Math.cos(2 * Math.PI * frequency * i / rate); im += left[i]! * Math.sin(2 * Math.PI * frequency * i / rate); }
      side += re * re + im * im;
    }
    return side;
  }
  assert.ok(spectrum(1) > spectrum(0) + 100);
});
test('chunking, reset and instances are bit deterministic, including updates', () => {
  const params: StereoEffectsOptions = { chorus: { rate: 3, depth: .8, mix: .3, voices: 4, feedback: .7 }, reverb: { size: .8, damping: .7, preDelay: .1, mix: .4 }, order: 'reverb-chorus' };
  const source = new Float32Array(8192); for (let i = 0; i < source.length; i++) source[i] = Math.sin(i * .31);
  const a = source.slice(), ar = source.slice(), b = source.slice(), br = source.slice();
  const fx = createStereoEffects(rate, params), other = createStereoEffects(rate, params);
  fx.process(a, ar); for (let i = 0; i < b.length; i += 64) other.process(b, br, i, 64);
  assert.deepEqual(a, b); assert.deepEqual(ar, br);
  fx.reset(); const again = source.slice(), againR = source.slice(); fx.process(again, againR); assert.deepEqual(a, again);
  fx.update({}); other.update({}); a.set(source); b.set(source); ar.set(source); br.set(source);
  fx.process(a, ar); for (let i = 0; i < b.length; i += 64) other.process(b, br, i, 64); assert.deepEqual(a, b);
});
test('extreme parameters and invalid samples cannot poison subsequent output', () => {
  const fx = createStereoEffects(192000, { chorus: { rate: 10, depth: 1, mix: 1, feedback: .7, voices: 4 }, reverb: { size: 1, damping: 1, mix: 1, preDelay: .1, width: 1 } });
  const left = new Float32Array(60000), right = new Float32Array(60000); left.set([NaN, Infinity, -Infinity, 3e38]); right.set(left); fx.process(left, right);
  assert.ok(left.every(Number.isFinite)); assert.ok(right.every(Number.isFinite));
});
test('parameter replacement ramps through bypass and order changes without clicks', () => {
  const fx = createStereoEffects(rate), left = new Float32Array(rate).fill(.5), right = left.slice(); fx.process(left, right);
  fx.update({ chorus: { rate: .05, depth: 1, mix: 1 }, reverb: { size: 1, damping: 1, mix: 1 } }); left.fill(.5); right.fill(.5); fx.process(left, right);
  let previous = .5; for (const sample of left) { assert.ok(Math.abs(sample - previous) < .02); previous = sample; }
  fx.update({ order: 'reverb-chorus', chorus: { rate: 1, depth: 0, mix: .5 } }); left.fill(.5); right.fill(.5); fx.process(left, right);
  for (const sample of left) { assert.ok(Math.abs(sample - previous) < .02); previous = sample; }
});
test('strict parameters and native buffer ranges reject malformed input', () => {
  const bad = [{ extra: 1 }, { chorus: { rate: NaN, depth: 0, mix: 0 } }, { chorus: { rate: 1, depth: 2, mix: 0 } }, { chorus: { rate: 1, depth: 0, mix: 0, voices: 1.5 } }, { reverb: { size: 0, damping: Infinity, mix: 0 } }, { reverb: { size: 0, damping: 0, mix: '0' } }, { order: 'other' }, { get chorus() { throw Error('getter must not run'); } }];
  const input = new Float32Array(1);
  for (const params of bad) {
    assert.throws(() => createStereoEffects(rate, params as StereoEffectsOptions), /plain|unknown|finite|integer|order|data/);
    assert.throws(() => applyEffects(input, input, rate, params as StereoEffectsOptions), /plain|unknown|finite|integer|order|data/);
  }
  for (const sampleRate of [7999, 192001, 8000.5, NaN]) {
    assert.throws(() => createStereoEffects(sampleRate), RangeError);
    assert.throws(() => applyEffects(input, input, sampleRate, {}), RangeError);
  }
  const fx = createStereoEffects(rate), left = new Float32Array(2);
  for (const [offset, length] of [[-1, 1], [0, 3], [1, 2], [.5, 1], [0, Infinity]]) assert.throws(() => fx.process(left, left, offset, length), RangeError);
  assert.throws(() => fx.process(new Proxy(left, {}), left));
  assert.throws(() => fx.process(new Float64Array(2) as unknown as Float32Array, left));
  assert.ok(Object.isFrozen(createStereoEffects(rate, { chorus: { rate: 1, depth: 0, mix: 1 } }).params.chorus));
});
test('invalid effects offsets reject without coercion, buffer writes or advancing effect state', () => {
  const params = { chorus: { rate: 2, depth: 0.7, mix: 0.5 }, reverb: { size: 0.3, damping: 0.4, mix: 0.5 } };
  const fx = createStereoEffects(rate, params), reference = createStereoEffects(rate, params);
  for (const engine of [fx, reference]) {
    const left = new Float32Array(512), right = new Float32Array(512);
    left[0] = 1; right[0] = -0.5;
    engine.process(left, right);
    engine.update({ chorus: { rate: 3, depth: 0.5, mix: 0.8 } });
  }
  const left = new Float32Array(512).fill(0.2), right = new Float32Array(512).fill(-0.1);
  const expectedLeft = left.slice(), expectedRight = right.slice();
  let reads = 0;
  const hostile: unknown[] = [
    { valueOf() { reads++; return 0; } },
    { [Symbol.toPrimitive]() { reads++; return 0; } },
  ];
  for (const offset of [...hostile, null, '0', 0n, Symbol('offset'), NaN, Infinity, -1, 0.5]) {
    for (const length of [undefined, 1]) assert.throws(() => fx.process(left, right, offset as unknown as number, length), RangeError);
  }
  assert.equal(reads, 0);
  assert.deepEqual(left, expectedLeft);
  assert.deepEqual(right, expectedRight);
  fx.process(left, right);
  reference.process(expectedLeft, expectedRight);
  assert.deepEqual(left, expectedLeft, 'rejected calls preserve delay and parameter-ramp state');
  assert.deepEqual(right, expectedRight);
});
test('applyEffects extends a rendered brass note with finite decaying audio and bounds allocation', () => {
  const note = renderNote({ voice: brass, sampleRate: rate, duration: .2 });
  const result = applyEffects(note.left, note.right, rate, { reverb: { size: .5, damping: .5, mix: .3 } });
  assert.ok(result.left.length > note.left.length); assert.ok(result.left.every(Number.isFinite)); assert.ok(energy(result.left, note.left.length) > 0);
  assert.ok(energy(result.left, result.left.length - rate / 2) < 1e-12);
  assert.throws(() => applyEffects(new Float32Array(4_000_000), new Float32Array(4_000_000), rate, { reverb: { size: 1, damping: 0, mix: 1 } }), /budget/);
});
test('one-shot dry effects scrub nonfinite samples without clipping finite extremes or losing signed zero', () => {
  const input = Float32Array.of(NaN, Infinity, -Infinity, -0, 0, 1e30, -1e30, 1e-30, -1e-30, 1e-45, -1e-45);
  const expected = Float32Array.of(0, 0, 0, -0, 0, 1e30, -1e30, 1e-30, -1e-30, 1e-45, -1e-45);
  const params: StereoEffectsOptions[] = [{}, { chorus: { rate: 10, depth: 1, mix: 0, feedback: .7, voices: 4 },
    reverb: { size: 1, damping: 1, mix: -0, preDelay: .1, width: 1 }, order: 'reverb-chorus' }];
  for (const options of params) {
    const result = applyEffects(input, input, rate, options);
    assert.deepEqual(result.left, expected); assert.deepEqual(result.right, expected);
  }
  const oversized = new Float32Array(4_000_001);
  assert.throws(() => applyEffects(oversized, oversized, rate, {}), /budget/);
});
test('tiny positive chorus mix retains its delayed audio and conservative tail', () => {
  const input = Float32Array.of(1), mix = 1e-12;
  const result = applyEffects(input, input, rate, { chorus: { rate: 1, depth: 0, mix, feedback: 0, voices: 1 } });
  const expected = new Float32Array(961);
  expected[0] = 1 - mix; expected[160] = .7 * mix;
  assert.deepEqual(result.left, expected); assert.deepEqual(result.right, expected);
});
test('one-shot effects reject buffers detached during parameter admission', () => {
  for (const options of [{}, { chorus: { rate: 1, depth: 0, mix: .5 } }]) {
    const buffer = new ArrayBuffer(8), input = new Float32Array(buffer); input.set([.25, .5]);
    const params = new Proxy(options, { ownKeys(target) {
      structuredClone(buffer, { transfer: [buffer] });
      return Reflect.ownKeys(target);
    } });
    assert.throws(() => applyEffects(input, input, rate, params), TypeError);
  }
});
