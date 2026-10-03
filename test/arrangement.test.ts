// The worklet module registers itself against globals installed below, so a static import would run too early.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OPM } from '../src/api/index.js';
import type { PlayNoteOptions } from '../src/api/index.js';
import { createArrangement } from '../src/api/arrangement.js';
import type { Arrangement, ArrangementLayer } from '../src/api/arrangement.js';
import type { VoiceInput } from '../src/voices/schema.js';
import { renderSequence } from '../src/core/index.js';
import type { NoteControls } from '../src/core/synth.js';
import { parseArrangementProject, serializeArrangementProject } from '../src/core/project.js';
import type { ArrangementProject } from '../src/core/project.js';

interface Port { postMessage(message: unknown): void; close(): void; onmessage?: ((event: { data: unknown }) => void) | null }
interface ProcessorInstance {
  port: Port;
  receive(message: unknown): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
const sampleRate = 16000;
let Processor: new (options?: AudioWorkletNodeOptions) => ProcessorInstance;
class Context extends EventTarget {
  currentTime = 0;
  sampleRate = sampleRate;
  frame = 0;
  state = 'suspended';
  destination = {};
  audioWorklet = { addModule: async () => {} };
  async resume() { this.state = 'running'; this.dispatchEvent(new Event('statechange')); }
  async close() { this.state = 'closed'; this.dispatchEvent(new Event('statechange')); }
  suspend() { this.state = 'suspended'; this.dispatchEvent(new Event('statechange')); }
}
class Node {
  processor: ProcessorInstance;
  port: Port;
  constructor(_context: Context, _name: string, options: AudioWorkletNodeOptions) {
    this.processor = new Processor(options);
    this.port = {
      postMessage: message => this.processor.receive(structuredClone(message)),
      close: () => { this.port.onmessage = null; }, onmessage: null,
    };
    this.processor.port.postMessage = message => this.port.onmessage?.({ data: structuredClone(message) });
    this.processor.port.close = () => {};
  }
  connect() {}
  disconnect() {}
}
const keys = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor', 'AudioContext', 'AudioWorkletNode'];
const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, {
  sampleRate, currentFrame: 0,
  AudioWorkletProcessor: class { port: Partial<Port> = {}; },
  registerProcessor: (_name: string, constructor: unknown) => { Processor = constructor as typeof Processor; },
});
try {
  await import('../src/worklet/processor.js');
  Object.assign(globalThis, { AudioContext: Context, AudioWorkletNode: Node });
} catch (error) { restore(); throw error; }
function restore() {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
after(restore);

const voice: VoiceInput = {
  version: 7, name: 'arrangement-tone', algorithm: 7, feedback: 0, modIndex: 0,
  lfo: { waveform: 'triangle', rate: 0, amDepth: 0, pmDepth: 0 },
  ops: [1, 0, 0, 0].map(level => ({ ratio: 1, level, detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.008 } })) as unknown as VoiceInput['ops'],
};
interface Call { id: number; note: number; at: number; voicePriority?: number }
interface Stop { id: number; at: number | undefined }
interface Update { id: number; controls: NoteControls; at: number | undefined }
async function host(options: { maxVoices?: number } = {}): Promise<{ opm: OPM; context: Context; calls: Call[]; stops: Stop[]; updates: Update[] }> {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM({ sampleRate, ...options });
  await opm.start();
  const calls: Call[] = [];
  const stops: Stop[] = [];
  const updates: Update[] = [];
  const play = opm.playNote.bind(opm);
  const stop = opm.stop.bind(opm);
  const update = opm.updateNote.bind(opm);
  opm.playNote = (input: PlayNoteOptions) => {
    const id = play(input);
    calls.push({ id, note: input.note, at: input.at!, voicePriority: input.voicePriority });
    return id;
  };
  opm.stop = (id, input) => { stops.push({ id, at: input?.at }); return stop(id, input); };
  opm.updateNote = (id, controls, input) => { updates.push({ id, controls, at: input?.at }); return update(id, controls, input); };
  return { opm, context: opm.context as unknown as Context, calls, stops, updates };
}
function run(opm: OPM, arrangement: Arrangement, seconds: number): void {
  const context = opm.context as unknown as Context;
  const node = opm.node as unknown as Node;
  const end = context.frame + Math.round(seconds * sampleRate);
  while (context.frame < end) {
    arrangement.pump();
    Object.assign(globalThis, { currentFrame: context.frame });
    node.processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    context.frame += 128;
    context.currentTime = context.frame / sampleRate;
  }
  Object.assign(globalThis, { currentFrame: context.frame });
  arrangement.pump();
}
const pad: ArrangementLayer = { name: 'pad', length: 16, events: [{ type: 'note', id: 1, beat: 0, duration: 16, note: 36, voice }] };
const drums: ArrangementLayer = { name: 'drums', length: 1, events: [{ type: 'note', id: 1, beat: 0, duration: 0.25, note: 38, voice }] };
const lead: ArrangementLayer = { name: 'lead', length: 4, events: [{ type: 'note', id: 1, beat: 0, duration: 1, note: 72, voice }] };
const arp: ArrangementLayer = { name: 'arp', length: 8, events: [{ type: 'note', id: 1, beat: 2, duration: 6, note: 60, voice }] };
const sections = [{ name: 'explore', layers: ['pad', 'drums', 'arp'] }, { name: 'combat', layers: ['pad', 'lead'] }];

test('bar switch commits after admitted notes without retriggering a layer both sections share', async () => {
  const { opm, calls, stops } = await host();
  const arrangement = createArrangement(opm, { layers: [pad, drums, lead, arp], sections, initialSection: 'explore', bpm: 120 });
  try {
    await arrangement.start();
    run(opm, arrangement, 1.2);
    const committed = arrangement.switchSection('combat', { quantize: 'bar' });
    assert.equal(committed, 4);
    assert.deepEqual(arrangement.snapshot.pending.map(change => [change.beat, change.section]), [[4, 'combat']]);
    run(opm, arrangement, 5);
    const origin = calls.find(call => call.note === 36)!.at;
    const beatAt = (call: Call) => Math.round((call.at - origin) * 2 * 1e6) / 1e6;
    assert.equal(calls.filter(call => call.note === 36).length, 1, 'shared sustained pad is one continuous gate');
    assert.deepEqual(calls.filter(call => call.note === 38).map(beatAt), [0, 1, 2, 3], 'drums stop beginning at the boundary');
    const leads = calls.filter(call => call.note === 72).map(beatAt);
    assert.ok(leads.length >= 2 && leads[0] === 4 && leads[1] === 8, 'lead joins on the global bar grid');
    const arpCall = calls.find(call => call.note === 60)!;
    assert.equal(beatAt(arpCall), 2);
    const cut = stops.find(stop => stop.id === arpCall.id && stop.at !== undefined)!;
    assert.equal(Math.round((cut.at! - origin) * 2 * 1e6) / 1e6, 4, 'removed layer is released at the boundary, not at its natural end');
    assert.equal(arrangement.snapshot.section, 'combat');
    assert.deepEqual([...arrangement.snapshot.layers].sort(), ['lead', 'pad']);
  } finally { arrangement.dispose(); await opm.dispose(); }
});

test('preserveNotes lets removed gates finish and layer toggles keep unrelated gates', async () => {
  const sustained: ArrangementLayer = { name: 'sustained', length: 8, events: [{ type: 'note', id: 1, beat: 0, duration: 8, note: 60, voice }] };
  const { opm, calls, stops } = await host();
  const arrangement = createArrangement(opm, { layers: [pad, sustained], sections: [{ name: 'a', layers: ['pad', 'sustained'] }], initialSection: 'a', bpm: 120 });
  try {
    await arrangement.start();
    run(opm, arrangement, 0.5);
    assert.equal(arrangement.setLayer('sustained', false, { quantize: 'beat', preserveNotes: true }), 2);
    run(opm, arrangement, 6);
    const origin = calls.find(call => call.note === 36)!.at;
    const sustainedCall = calls.find(call => call.note === 60)!;
    const natural = stops.find(stop => stop.id === sustainedCall.id)!;
    assert.equal(Math.round((natural.at! - origin) * 2 * 1e6) / 1e6, 8);
    assert.equal(calls.filter(call => call.note === 36).length, 1);
    assert.equal(calls.filter(call => call.note === 60).length, 1, 'a disabled layer does not start another loop');
    assert.throws(() => arrangement.setLayer('missing', true), /unknown/i);
  } finally { arrangement.dispose(); await opm.dispose(); }
});

test('voice priority protects a melody layer without failing the arrangement', async () => {
  const { opm, calls } = await host({ maxVoices: 1 });
  const melody: ArrangementLayer = { name: 'melody', length: 4, voicePriority: 100, events: [{ type: 'note', id: 1, beat: 0, duration: 4, note: 72, voice }] };
  const rhythm: ArrangementLayer = { name: 'rhythm', length: 1, events: [{ type: 'note', id: 1, beat: 0, duration: 0.5, note: 48, voice }] };
  const failures: Error[] = [];
  const arrangement = createArrangement(opm, { layers: [melody, rhythm], sections: [{ name: 'all', layers: ['melody', 'rhythm'] }],
    initialSection: 'all', bpm: 120, onError: error => failures.push(error) });
  try {
    await arrangement.start();
    run(opm, arrangement, 3);
    assert.deepEqual(failures, []);
    assert.equal(arrangement.state, 'running');
    assert.ok(arrangement.snapshot.priorityDrops >= 2);
    assert.ok(calls.every(call => call.note !== 72 || call.voicePriority === 100));
  } finally { arrangement.dispose(); await opm.dispose(); }
});

test('tempo replacement changes only unadmitted onsets and pause releases owned gates', async () => {
  const { opm, calls } = await host();
  const arrangement = createArrangement(opm, { layers: [drums], sections: [{ name: 's', layers: ['drums'] }], initialSection: 's', bpm: 120 });
  try {
    await arrangement.start();
    run(opm, arrangement, 2);
    arrangement.setTempo(240);
    run(opm, arrangement, 2);
    const gaps = calls.slice(1).map((call, index) => Math.round((call.at - calls[index]!.at) * 1e3) / 1e3);
    assert.equal(gaps[0], 0.5);
    assert.equal(gaps.at(-1), 0.25);
    assert.ok(arrangement.snapshot.tempoMap.length === 2);
    const before = calls.length;
    arrangement.pause();
    assert.equal(arrangement.state, 'paused');
    run(opm, arrangement, 1);
    assert.equal(calls.length, before, 'paused arrangement schedules nothing');
    const position = arrangement.snapshot.position;
    await arrangement.resume();
    run(opm, arrangement, 1);
    assert.ok(calls.length > before);
    assert.ok(arrangement.snapshot.position > position);
  } finally { arrangement.dispose(); await opm.dispose(); }
});

test('invalid arrangements reject without scheduling anything', async () => {
  const { opm, calls } = await host();
  const base = { layers: [drums], sections: [{ name: 's', layers: ['drums'] }], initialSection: 's' };
  try {
    for (const bad of [
      { ...base, layers: [] }, { ...base, initialSection: 'missing' },
      { ...base, sections: [{ name: 's', layers: ['ghost'] }] },
      { ...base, layers: [drums, drums] }, { ...base, layers: [{ ...drums, length: 0 }] },
      { ...base, layers: [{ ...drums, voicePriority: 1.5 }] },
      { ...base, layers: [{ ...drums, events: [{ type: 'note', id: 1, beat: 1, duration: 1, note: 60, voice }] }] },
      { ...base, unknown: true },
      { ...base, layers: [{ ...drums, events: [...drums.events,
        { type: 'control', id: 1, beat: 0.1, controls: { gain: 0.5 } }] }] },
    ]) assert.throws(() => createArrangement(opm, bad as never));
    assert.equal(calls.length, 0);
    const repeated = createArrangement(opm, { ...base, sections: [{ name: 's', layers: ['drums', 'drums'] }] });
    try {
      assert.deepEqual(repeated.snapshot.layers, ['drums']);
      assert.equal(calls.length, 0);
    } finally { repeated.dispose(); }
  } finally { await opm.dispose(); }
});

test('short arrangement loops reject bounded-wrap overflow before admitting any notes', async () => {
  const { opm, calls } = await host();
  const errors: Error[] = [];
  const arrangement = createArrangement(opm, {
    layers: [{ name: 'dense', length: 1 / 1024, events: [{ type: 'note', id: 1, beat: 0, duration: 1, note: 60, voice }] }],
    sections: [{ name: 'dense', layers: ['dense'] }], initialSection: 'dense', bpm: 1000, horizon: 0.01,
    onError: error => errors.push(error),
  });
  try {
    await assert.rejects(arrangement.start(), /failed to start/);
    assert.match(errors[0]!.message, /bounded wraps/);
    assert.equal(calls.length, 0);
    assert.equal(arrangement.state, 'stopped');
  } finally { arrangement.dispose(); await opm.dispose(); }
});

test('long arrangement automation streams incrementally and stops at a removed-layer boundary', async () => {
  const { opm, stops } = await host();
  const events: ArrangementLayer['events'] = [
    { type: 'note', id: 1, beat: 0, duration: 100, note: 60, voice },
    ...Array.from({ length: 300 }, (_, index) => ({
      type: 'control' as const, id: 1, beat: (index + 1) * 0.3, controls: { expression: 0.5 },
    })),
  ];
  const errors: Error[] = [];
  const arrangement = createArrangement(opm, {
    layers: [{ name: 'long', length: 128, events }],
    sections: [{ name: 'on', layers: ['long'] }, { name: 'off', layers: [] }],
    initialSection: 'on', bpm: 120, onError: error => errors.push(error),
  });
  try {
    await arrangement.start();
    run(opm, arrangement, 0.3);
    const boundary = arrangement.switchSection('off', { quantize: 'beat' });
    run(opm, arrangement, 1);
    assert.equal(arrangement.snapshot.section, 'off');
    assert.deepEqual(errors, []);
    assert.equal(stops.filter(stop => stop.at === 0.05 + boundary / 2).length, 1);
    assert.equal(arrangement.state, 'running');
  } finally { arrangement.dispose(); await opm.dispose(); }
});

function audio(opm: OPM, arrangement: Arrangement, frames: number): Float32Array {
  const context = opm.context as unknown as Context;
  const node = opm.node as unknown as Node;
  const output = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += 128) {
    arrangement.pump();
    Object.assign(globalThis, { currentFrame: context.frame });
    const count = Math.min(128, frames - offset);
    const left = new Float32Array(count);
    node.processor.process([], [[left, new Float32Array(count)]]);
    output.set(left, offset);
    context.frame += count;
    context.currentTime = context.frame / sampleRate;
  }
  Object.assign(globalThis, { currentFrame: context.frame });
  arrangement.pump();
  return output;
}

test('crossfades leave shared gates continuous and give newly admitted notes the remaining layer envelope', async () => {
  const { opm, calls, stops, updates } = await host();
  const old: ArrangementLayer = { name: 'old', length: 16,
    events: [{ type: 'note', id: 1, beat: 0, duration: 16, note: 60, voice }] };
  const incoming: ArrangementLayer = { name: 'new', length: 1,
    events: [{ type: 'note', id: 1, beat: 0, duration: 0.75, note: 72, voice }] };
  const arrangement = createArrangement(opm, { layers: [pad, old, incoming],
    sections: [{ name: 'a', layers: ['pad', 'old'] }, { name: 'b', layers: ['pad', 'new'] }], initialSection: 'a' });
  try {
    await arrangement.start();
    audio(opm, arrangement, 4800);
    const beat = arrangement.switchSection('b', { quantize: 'beat', fade: 1 });
    assert.equal(beat, 1);
    audio(opm, arrangement, 32000);
    const boundary = 0.05 + beat / 2;
    const oldId = calls.find(call => call.note === 60)!.id;
    const sharedId = calls.find(call => call.note === 36)!.id;
    assert.equal(calls.filter(call => call.note === 36).length, 1);
    assert.equal(updates.some(update => update.id === sharedId && update.controls.gain !== undefined), false);
    assert.ok(updates.some(update => update.id === oldId && update.at === boundary && update.controls.gain === 0 && update.controls.ramp === 1));
    assert.ok(stops.some(stop => stop.id === oldId && stop.at === boundary + 1));
    const onsets = calls.filter(call => call.note === 72);
    assert.equal(onsets[0]!.at, boundary);
    assert.equal(onsets[1]!.at, boundary + 0.5);
    assert.ok(updates.some(update => update.id === onsets[0]!.id && update.controls.gain === 0));
    const midway = updates.find(update => update.id === onsets[1]!.id && update.controls.gain !== undefined)!;
    assert.ok(Math.abs(midway.controls.gain! - 0.5) < 1e-9);
    assert.ok(updates.some(update => update.id === onsets[1]!.id && update.controls.gain === 1 && Math.abs(update.controls.ramp! - 0.5) < 1e-9));
  } finally { arrangement.dispose(); await opm.dispose(); }
});

test('layer gain composes exact simultaneous expression ramps, interrupted retargets and scope ownership in PCM', async () => {
  const { opm, calls, updates } = await host();
  const outsider = opm.playNote({ voice, note: 48, velocity: 0.2, duration: null });
  const layer: ArrangementLayer = { name: 'tone', gain: 0.8, length: 16, events: [
    { type: 'note', id: 1, beat: 0, duration: 8, note: 69, voice },
    { type: 'control', id: 1, beat: 0, controls: { expression: 0.5, ramp: 2 } },
  ] };
  const arrangement = createArrangement(opm, { layers: [layer], sections: [{ name: 'a', layers: ['tone'] }], initialSection: 'a' });
  try {
    await arrangement.start();
    const chunks = [audio(opm, arrangement, 4800)];
    const first = arrangement.setLayerGain('tone', 0.2, { quantize: 'beat', fade: 2 });
    assert.equal(first, 1);
    chunks.push(audio(opm, arrangement, 11200));
    const second = arrangement.setLayerGain('tone', 1, { quantize: 'beat', fade: 0.5 });
    assert.equal(second, 3);
    chunks.push(audio(opm, arrangement, 24000));
    const toneId = calls.find(call => call.note === 69)!.id;
    assert.equal(updates.some(update => update.id === outsider), false);
    const retarget = updates.find(update => update.id === toneId && update.at === 1.55 && update.controls.gain !== undefined)!;
    assert.ok(Math.abs(retarget.controls.gain! - 0.5) < 1e-9);
    assert.deepEqual(updates.filter(update => update.id === toneId && update.controls.expression !== undefined).map(update => update.controls), [{ expression: 0.5, ramp: 2 }]);
    const actual = new Float32Array(40000);
    let offset = 0;
    for (const chunk of chunks) { actual.set(chunk, offset); offset += chunk.length; }
    const expected = renderSequence([
      { type: 'note', id: 1, time: 0, duration: 5, note: 48, velocity: 0.2, voice },
      { type: 'note', id: 2, time: 0.05, duration: 4, note: 69, voice },
      { type: 'control', id: 2, time: 0.05, controls: { gain: 0.8 } },
      { type: 'control', id: 2, time: 0.05, controls: { expression: 0.5, ramp: 2 } },
      { type: 'control', id: 2, time: 0.55, controls: { gain: 0.8 } },
      { type: 'control', id: 2, time: 0.55, controls: { gain: 0.2, ramp: 2 } },
      { type: 'control', id: 2, time: 1.55, controls: { gain: retarget.controls.gain } },
      { type: 'control', id: 2, time: 1.55, controls: { gain: 1, ramp: 0.5 } },
    ], { sampleRate });
    assert.deepEqual(actual, expected.left.subarray(0, actual.length));
  } finally { arrangement.dispose(); opm.stop(outsider); await opm.dispose(); }
});

test('owned release tails fade while authored tail expression remains independent', async () => {
  const { opm, calls, updates, stops } = await host();
  const tailVoice: VoiceInput = { ...voice, ops: voice.ops.map(op => ({ ...op, adsr: { ...op.adsr, r: 1 } })) as unknown as VoiceInput['ops'] };
  const tail: ArrangementLayer = { name: 'tail', length: 8, events: [
    { type: 'note', id: 1, beat: 0, duration: 0.5, note: 69, voice: tailVoice },
    { type: 'control', id: 1, beat: 1.25, controls: { expression: 0.3, ramp: 0.2 } },
  ] };
  const arrangement = createArrangement(opm, { layers: [tail], sections: [{ name: 'a', layers: ['tail'] }], initialSection: 'a' });
  try {
    await arrangement.start();
    audio(opm, arrangement, 4800);
    arrangement.setLayer('tail', false, { quantize: 'beat', fade: 0.5 });
    audio(opm, arrangement, 16000);
    const id = calls[0]!.id;
    assert.ok(stops.some(stop => stop.id === id && stop.at === 0.3));
    assert.ok(updates.some(update => update.id === id && update.at === 0.55 && update.controls.gain === 0 && update.controls.ramp === 0.5));
    assert.ok(updates.some(update => update.id === id && update.at === 0.675 && update.controls.expression === 0.3));
  } finally { arrangement.dispose(); await opm.dispose(); }
});

test('layer gain and fade reject invalid own-data options without affecting other engines', async () => {
  const { opm } = await host();
  const { opm: other } = await host();
  const arrangement = createArrangement(opm, { layers: [pad], sections: [{ name: 'a', layers: ['pad'] }], initialSection: 'a' });
  try {
    assert.throws(() => arrangement.setLayerGain('pad', -1), /gain/);
    assert.throws(() => arrangement.setLayerGain('pad', 1, { fade: 11 }), /fade/);
    assert.throws(() => arrangement.setLayerGain('missing', 1), /unknown/i);
    assert.throws(() => arrangement.setLayerGain('pad', 1, { preserveNotes: true } as never), /field/);
    assert.throws(() => createArrangement(opm, { layers: [{ ...pad, gain: 2 }], sections: [{ name: 'a', layers: ['pad'] }], initialSection: 'a' }), /gain/);
    await arrangement.start();
    const otherId = other.playNote({ voice, note: 72, duration: null });
    arrangement.setLayerGain('pad', 0, { quantize: 'beat', fade: 0.1 });
    audio(opm, arrangement, 16000);
    assert.equal((await other.getDiagnostics()).pendingEvents, 1);
    other.stop(otherId);
    arrangement.pause();
    const paused = arrangement.snapshot.position;
    await arrangement.resume();
    audio(opm, arrangement, 400);
    assert.equal(arrangement.snapshot.position, paused);
  } finally { arrangement.dispose(); await opm.dispose(); await other.dispose(); }
});

test('retargeting a section repeatedly at one unadmitted boundary removes obsolete cuts and fades', async () => {
  const { opm, calls, stops, updates } = await host();
  const arrangement = createArrangement(opm, { layers: [pad, lead],
    sections: [{ name: 'a', layers: ['pad'] }, { name: 'b', layers: ['lead'] }], initialSection: 'a' });
  try {
    await arrangement.start();
    audio(opm, arrangement, 4800);
    const beat = arrangement.switchSection('b', { quantize: 'beat', fade: 0.5 });
    assert.equal(arrangement.switchSection('a', { quantize: 'beat', fade: 0.2 }), beat);
    audio(opm, arrangement, 24000);
    const padId = calls.find(call => call.note === 36)!.id;
    assert.equal(calls.filter(call => call.note === 36).length, 1);
    assert.equal(calls.some(call => call.note === 72), false);
    assert.equal(stops.some(stop => stop.id === padId), false);
    assert.equal(updates.some(update => update.id === padId && update.controls.gain !== undefined), false);
  } finally { arrangement.dispose(); await opm.dispose(); }
});

test('preserved removed gates fade to silence without receiving an early stop', async () => {
  const { opm, calls, stops, updates } = await host();
  const arrangement = createArrangement(opm, { layers: [pad], sections: [{ name: 'a', layers: ['pad'] }], initialSection: 'a' });
  try {
    await arrangement.start();
    audio(opm, arrangement, 4800);
    arrangement.setLayer('pad', false, { quantize: 'beat', fade: 0.2, preserveNotes: true });
    audio(opm, arrangement, 16000);
    const id = calls[0]!.id;
    assert.equal(stops.some(stop => stop.id === id), false);
    assert.ok(updates.some(update => update.id === id && update.controls.gain === 0 && update.controls.ramp === 0.2));
    assert.ok(audio(opm, arrangement, 1024).every(value => value === 0));
  } finally { arrangement.dispose(); await opm.dispose(); }
});

test('saved arrangement reconstructs named layers, meter, gains and voices with identical live switch/fade PCM', async () => {
  const original = parseArrangementProject({
    version: 1, voices: { tone: voice },
    settings: { sampleRate, maxVoices: 4, mixGain: 0.2, stealing: 'release-first' },
    layers: [
      { name: 'bed', length: 12, gain: 0.7, voicePriority: 20,
        events: [{ type: 'note', id: 1, beat: 0, duration: 12, note: 36, voice: 'tone' }] },
      { name: 'melody', length: 3, gain: 0.6, voicePriority: 100, events: [
        { type: 'note', id: 1, beat: 0, duration: 2, note: 72, voice: 'tone' },
        { type: 'control', id: 1, beat: 0.5, controls: { expression: 0.4, ramp: 0.2 } },
      ] },
    ],
    sections: [{ name: 'calm', layers: ['bed'] }, { name: 'battle', layers: ['bed', 'melody'] }],
    initialSection: 'calm', timeSignature: { numerator: 3, denominator: 4 },
    tempoMap: [{ beat: 0, bpm: 120, curve: 'linear' }, { beat: 8, bpm: 180 }],
  });
  const loaded = parseArrangementProject(serializeArrangementProject(original));
  async function replay(project: ArrangementProject) {
    const { opm, calls, stops, updates } = await host(project.settings);
    opm.replaceVoiceBank([]);
    for (const [name, patch] of Object.entries(project.voices)) opm.loadVoice(name, patch);
    const arrangement = createArrangement(opm, { layers: project.layers, sections: project.sections,
      initialSection: project.initialSection, tempoMap: project.tempoMap, timeSignature: project.timeSignature });
    try {
      assert.equal(arrangement.state, 'stopped');
      assert.equal(calls.length, 0, 'loading a definition cannot admit playback');
      await arrangement.start();
      const before = audio(opm, arrangement, 4800);
      const boundary = arrangement.switchSection('battle', { quantize: 'bar', fade: 0.4 });
      assert.equal(boundary, 3, 'loaded meter defines the bar boundary');
      assert.equal(arrangement.setLayerGain('bed', 0.45, { quantize: 'beat', fade: 0.25 }), 3);
      const after = audio(opm, arrangement, 40000);
      assert.equal(arrangement.snapshot.section, 'battle');
      assert.deepEqual(arrangement.snapshot.layers, ['bed', 'melody']);
      assert.equal(calls.filter(call => call.note === 36).length, 1, 'shared layer stays continuous after load');
      assert.ok(calls.some(call => call.note === 72 && call.voicePriority === 100));
      assert.ok(updates.some(update => update.controls.gain === 0.45 && update.controls.ramp === 0.25));
      assert.ok(after.some(value => value !== 0));
      return { before, after, calls: [...calls], stops: [...stops], updates: [...updates] };
    } finally { arrangement.dispose(); await opm.dispose(); }
  }
  assert.deepEqual(await replay(loaded), await replay(original));
});
