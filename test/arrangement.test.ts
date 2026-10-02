// The worklet module registers itself against globals installed below, so a static import would run too early.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OPM } from '../src/api/index.js';
import type { PlayNoteOptions } from '../src/api/index.js';
import { createArrangement } from '../src/api/arrangement.js';
import type { Arrangement, ArrangementLayer } from '../src/api/arrangement.js';
import type { VoiceInput } from '../src/voices/schema.js';

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
  version: 5, name: 'arrangement-tone', algorithm: 7, feedback: 0, modIndex: 0,
  lfo: { waveform: 'triangle', rate: 0, amDepth: 0, pmDepth: 0 },
  ops: [1, 0, 0, 0].map(level => ({ ratio: 1, level, detune: 0, adsr: { a: 0, d: 0, s: 1, r: 0.008 } })) as unknown as VoiceInput['ops'],
};
interface Call { id: number; note: number; at: number; voicePriority?: number }
interface Stop { id: number; at: number | undefined }
async function host(options: { maxVoices?: number } = {}): Promise<{ opm: OPM; context: Context; calls: Call[]; stops: Stop[] }> {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM({ sampleRate, ...options });
  await opm.start();
  const calls: Call[] = [];
  const stops: Stop[] = [];
  const play = opm.playNote.bind(opm);
  const stop = opm.stop.bind(opm);
  opm.playNote = (input: PlayNoteOptions) => {
    const id = play(input);
    calls.push({ id, note: input.note, at: input.at!, voicePriority: input.voicePriority });
    return id;
  };
  opm.stop = (id, input) => { stops.push({ id, at: input?.at }); return stop(id, input); };
  return { opm, context: opm.context as unknown as Context, calls, stops };
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
    ]) assert.throws(() => createArrangement(opm, bad as never));
    assert.equal(calls.length, 0);
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
