import test from 'node:test';
import assert from 'node:assert/strict';
import { importOPM, describeOPM } from '../src/voices/opm.js';
import { prepareVoice, validateVoice } from '../src/voices/schema.js';
import { ALGORITHMS } from '../src/core/algorithms.js';
import { renderNote } from '../src/core/index.js';

// Original handwritten recipes; no third-party voice banks or converter code.
const labels = ['M1', 'C1', 'M2', 'C2'];
function patch(options: { program?: number; name?: string; con?: number; slot?: number; ne?: number; lfo?: number[]; ch?: number[]; ops?: number[][] } = {}): string {
  const ops = options.ops ?? labels.map((_, i) => [31, 20, 0, 12, 3, i * 8, i % 4, i + 1, 0, 0, i % 2]);
  return [`@:${options.program ?? 0} ${options.name ?? 'Original'}`,
    `LFO: ${(options.lfo ?? [128, 30, 40, 2, 0]).join(' ')}`,
    `CH: ${(options.ch ?? [192, 0, options.con ?? 4, 2, 3, options.slot ?? 120, options.ne ?? 0]).join(' ')}`,
    ...labels.map((label, i) => `${label}: ${ops[i].join(' ')}`)].join('\n');
}
function operators(field: number, values: number[]): number[][] {
  return labels.map((_, i) => {
    const op = [31, 20, 0, 12, 3, 0, 0, 1, 0, 0, 0];
    op[field] = values[i]; return op;
  });
}

test('original text recipes normalize, serialize, prepare and render deterministically', () => {
  const source = '// original bank\r\n\r\n' + [patch(), patch({ program: 1, con: 7, ne: 1 }), patch({ program: 2, con: 0 })].join('\r\n\r\n');
  const voices = importOPM(source), bytes = new TextEncoder().encode(source);
  assert.equal(voices.length, 3); assert.deepEqual(importOPM(bytes), voices);
  for (const voice of voices) {
    assert.equal(voice.version, 7);
    assert.deepEqual(validateVoice(JSON.parse(JSON.stringify(voice))), validateVoice(voice));
    assert.equal(prepareVoice(voice).version, 7);
    const options = { voice, duration: 0.08, sampleRate: 8000 };
    const rendered = renderNote(options);
    assert.ok(rendered.left.every(Number.isFinite));
    assert.ok(rendered.left.some(value => Math.abs(value) > 1e-6));
    assert.deepEqual(renderNote(options).left, rendered.left);
  }
});

test('all eight manual connection diagrams retain named operator roles', () => {
  // Named edges and output labels transcribed from application manual fig. 2.9.
  const expected = [
    { edges: ['M1>C1', 'C1>M2', 'M2>C2'], carriers: ['C2'] },
    { edges: ['M1>M2', 'C1>M2', 'M2>C2'], carriers: ['C2'] },
    { edges: ['C1>M2', 'M1>C2', 'M2>C2'], carriers: ['C2'] },
    { edges: ['M1>C1', 'C1>C2', 'M2>C2'], carriers: ['C2'] },
    { edges: ['M1>C1', 'M2>C2'], carriers: ['C1', 'C2'] },
    { edges: ['M1>C1', 'M1>M2', 'M1>C2'], carriers: ['C1', 'M2', 'C2'] },
    { edges: ['M1>C1'], carriers: ['C1', 'M2', 'C2'] },
    { edges: [], carriers: ['M1', 'C1', 'M2', 'C2'] },
  ];
  for (let con = 0; con < 8; con++) {
    const voice = importOPM(patch({ con }))[0], names = describeOPM(patch({ con }))[0].operators;
    assert.equal(voice.algorithm, con); assert.deepEqual(voice.ops.map(op => op.ratio), [1, 2, 3, 4]);
    const graph = ALGORITHMS[voice.algorithm];
    assert.deepEqual(graph.inputs.flatMap((inputs, target) => inputs.map(source => `${names[source]}>${names[target]}`)).sort(), expected[con].edges.sort());
    assert.deepEqual(graph.carriers.map(op => names[op]), expected[con].carriers);
  }
});

test('envelope, TL, multiplier, DT1/DT2 and key-scaling conversions are bounded and monotone', () => {
  for (const field of [0, 1, 3, 5]) {
    const maxima = field === 3 ? 15 : field === 5 ? 127 : 31;
    let previous = Infinity;
    for (let value = 0; value <= maxima; value++) {
      const op = importOPM(patch({ ops: operators(field, [value, 0, 0, 0]) }))[0].ops[0];
      const current = field === 0 ? op.adsr.a : field === 1 ? op.adsr.d : field === 3 ? op.adsr.r : op.level;
      assert.ok(current <= previous); previous = current;
    }
  }
  const sustain = importOPM(patch({ ops: operators(4, [0, 1, 14, 15]) }))[0].ops;
  assert.equal(sustain[0].adsr.s, 1); assert.ok(sustain[3].adsr.s < 0.00003);
  assert.equal(importOPM(patch({ ops: operators(7, [0, 1, 2, 15]) }))[0].ops[0].ratio, 0.5);
  for (let value = 0; value < 4; value++) {
    const ops = importOPM(patch({ ops: operators(8, [value, value + 4, 0, 0]) }))[0].ops;
    assert.equal(ops[0].detune, -ops[1].detune || 0);
  }
  assert.deepEqual(importOPM(patch({ ops: operators(9, [0, 1, 2, 3]) }))[0].ops.map(op => op.detune), [0, 600, 781, 950]);
  assert.deepEqual(importOPM(patch({ ops: operators(6, [0, 1, 2, 3]) }))[0].ops.map(op => op.rateKeyScale), [0, 4 / 3, 8 / 3, 4]);
});

test('raw key-on SLOT, C2 noise and AMS enable remain in signal order', () => {
  for (let i = 0; i < 4; i++) {
    const voice = importOPM(patch({ slot: 8 << i, ne: 1 }))[0];
    assert.deepEqual(voice.ops.map(op => op.level > 0), labels.map((_, n) => n === i));
    assert.deepEqual(voice.ops.map(op => op.waveform ?? 'sine'), ['sine', 'sine', 'sine', 'noise']);
    assert.deepEqual(voice.lfo.amTargets, [0, 1, 0, 1]);
    assert.equal(voice.ops[3].noiseRate, 3579545 / 1024);
  }
  assert.equal(importOPM(patch({ ne: 1, lfo: [0, 0, 0, 0, 31] }))[0].ops[3].noiseRate, 20000);
  assert.ok(importOPM(patch({ slot: 0 }))[0].ops.every(op => op.level === 0));
});

test('manual modulation tables, waveforms and clamping produce stable descriptions', () => {
  for (let pms = 0; pms < 8; pms++) {
    const voice = importOPM(patch({ lfo: [0, 127, 127, 0, 0], ch: [192, 7, 0, 0, pms, 120, 0] }))[0];
    assert.equal(voice.feedback, 7); assert.equal(voice.lfo.pmDepth, [0, 5, 10, 20, 50, 100, 400, 700][pms] * 127 / 128);
    assert.equal(voice.lfo.amDepth, 0); assert.equal(voice.lfo.rate, 3579545 / 2 ** 32);
  }
  for (let ams = 0; ams < 4; ams++) {
    const voice = importOPM(patch({ lfo: [0, 127, 0, ams, 0], ch: [192, 0, 0, ams, 0, 120, 0] }))[0];
    assert.equal(voice.lfo.amDepth, 1 - 10 ** (-[0, 23.90625, 47.8125, 95.625][ams] * 127 / 128 / 20));
    assert.equal(voice.lfo.waveform, ['saw', 'square', 'triangle', 'sine'][ams]);
  }
  const source = patch({ name: 'Lossy patch!', ne: 1, slot: 0, lfo: [255, 127, 127, 3, 31], ops: operators(2, [1, 1, 1, 1]) });
  const description = describeOPM(source)[0];
  assert.equal(description.program, 0); assert.equal(importOPM(source)[0].lfo.rate, 20);
  for (const term of ['D2R', 'SLOT', 'noise extension', 'Noise rate clamped', 'LFO rate clamped', 'Noise LFO', 'Name sanitized']) assert.ok(description.warnings.some(warning => warning.includes(term)), term);
  assert.equal(new Set(description.warnings).size, description.warnings.length);
  assert.ok(description.warnings.length <= 20 && description.warnings.every(warning => warning.length < 256));
  assert.deepEqual(describeOPM(source), describeOPM(source));
});

test('names sanitize, deduplicate, truncate and decode Latin-1 deterministically', () => {
  assert.deepEqual(importOPM([patch({ name: 'A name!' }), patch({ name: 'A name!' }), patch({ name: '!!!' }), patch({ name: 'OPM' })].join('\n')).map(v => v.name), ['A_name', 'A_name_2', 'OPM', 'OPM_2']);
  const long = 'a'.repeat(80);
  const names = importOPM([patch({ name: long }), patch({ name: long })].join('\n')).map(v => v.name);
  assert.equal(names[0].length, 64); assert.equal(names[1].length, 64); assert.ok(names[1].endsWith('_2'));
  const latin = Uint8Array.from(patch({ name: 'caf\u00e9' }), character => character.charCodeAt(0));
  assert.equal(importOPM(latin)[0].name, 'caf');
});

test('untrusted input bounds and every parser rejection retain line diagnostics', () => {
  for (const value of [null, {}, [], new Uint16Array(1), new Proxy(new Uint8Array(1), {})]) assert.throws(() => importOPM(value as string), TypeError);
  const spoofed = new Uint8Array(262145); Object.defineProperty(spoofed, 'length', { value: 1 });
  for (const input of [spoofed, ' '.repeat(262145), '\u00e9'.repeat(131073)]) assert.throws(() => importOPM(input), /262144/);
  for (const input of ['', '// comment\n']) assert.throws(() => importOPM(input), /no patches/);
  const invalid = [
    'LFO: 0 0 0 0 0', '@:128 Bad', '@:1.5 Bad', patch() + '\nM1: 0',
    patch().replace('M1:', 'Unknown:'), patch().replace('LFO:', 'LFO'),
    patch().replace(/\nC2:[^\n]*/, ''), patch().replace('LFO: 128 30 40 2 0', 'LFO: 0 0 0 0'),
    patch().replace('LFO: 128', 'LFO: -1'), patch().replace('LFO: 128', 'LFO: 256'),
    patch().replace('LFO: 128', 'LFO: 1e2'), patch().replace('LFO: 128', 'LFO: 1.1'),
    patch().replace('LFO: 128', 'LFO: Infinity'), patch().replace('LFO: 128', 'LFO: 9'.repeat(70)),
    patch({ slot: 1 }), patch({ slot: 128 }), patch() + '\n//\0', '//'+ 'x'.repeat(511),
    Array.from({ length: 129 }, () => patch()).join('\n'),
  ];
  for (const input of invalid) {
    assert.throws(() => importOPM(input), /OPM line \d+:/);
    assert.throws(() => describeOPM(input), /OPM line \d+:/);
  }
  const maxima = [31, 31, 31, 15, 15, 127, 3, 15, 7, 3, 1];
  for (let field = 0; field < maxima.length; field++) assert.throws(() => importOPM(patch({ ops: operators(field, [maxima[field] + 1, 0, 0, 0]) })), /OPM line 4:/);
  assert.equal(importOPM(Array.from({ length: 128 }, () => patch()).join('\n')).length, 128);
});
