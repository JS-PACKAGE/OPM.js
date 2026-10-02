import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OPM } from '../src/api/index.js';
import type { OPMEvent } from '../src/api/index.js';
import { createPerformance } from '../src/api/performance.js';
import type { Performance } from '../src/api/performance.js';
import { Synth } from '../src/core/synth.js';
import type { Operator, VoiceInput } from '../src/voices/schema.js';

interface Port { postMessage(message: unknown): void; close(): void; onmessage?: ((event: { data: unknown }) => void) | null }
interface ProcessorInstance {
  port: Port;
  receive(message: unknown): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
const sampleRate = 16000;
let Processor: new (options?: AudioWorkletNodeOptions) => ProcessorInstance;
class Context {
  currentTime = 0;
  sampleRate = sampleRate;
  frame = 0;
  state = 'suspended';
  destination = {};
  audioWorklet = { addModule: async () => {} };
  listeners = new Set<() => void>();
  addEventListener(_type: string, listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: string, listener: () => void) { this.listeners.delete(listener); }
  setState(state: string) { this.state = state; for (const listener of this.listeners) listener(); }
  async resume() { this.setState('running'); }
  async close() { this.setState('closed'); }
}
class Node {
  processor: ProcessorInstance;
  port: Port;
  constructor(_context: Context, _name: string, options: AudioWorkletNodeOptions) {
    this.processor = new Processor(options);
    this.port = { postMessage: message => this.processor.receive(structuredClone(message)),
      close: () => { this.port.onmessage = null; }, onmessage: null };
    this.processor.port.postMessage = message => this.port.onmessage?.({ data: structuredClone(message) });
    this.processor.port.close = () => {};
  }
  connect() {}
  disconnect() {}
}
const globals = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor', 'AudioContext', 'AudioWorkletNode'];
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, { sampleRate, currentFrame: 0,
  AudioWorkletProcessor: class { port: Partial<Port> = {}; },
  registerProcessor: (_name: string, constructor: unknown) => { Processor = constructor as typeof Processor; } });
try {
  // Static import cannot work: processor evaluation needs the worklet globals installed first.
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
function tone(attack = 0, release = 0): VoiceInput {
  return { version: 5, name: 'performance-tone', algorithm: 7, feedback: 0, modIndex: 0,
    lfo: { waveform: 'sine', rate: 0, amDepth: 0, pmDepth: 0 },
    ops: [0, 1, 2, 3].map(index => ({ ratio: 1, level: index === 0 ? 0.8 : 0,
      detune: 0, adsr: { a: attack, d: 0, s: 1, r: release } })) as [Operator, Operator, Operator, Operator],
  };
}
async function setup(voice = tone(), events: OPMEvent[] = [], options: Parameters<typeof createPerformance>[1] = {}) {
  Object.assign(globalThis, { currentFrame: 0 });
  const opm = new OPM({ sampleRate, onEvent: event => events.push(event), interruption: 'preserve' });
  await opm.start();
  const performance = createPerformance(opm, options);
  performance.configurePart(0, { voice });
  return { opm, performance, async close() { performance.dispose(); await opm.dispose(); } };
}
function audio(opm: OPM, frames: number): Float32Array {
  const context = opm.context as unknown as Context;
  Object.assign(globalThis, { currentFrame: context.frame });
  const left = new Float32Array(frames), right = new Float32Array(frames);
  assert.equal((opm.node as unknown as Node).processor.process([], [[left, right]]), true);
  context.frame += frames;
  context.currentTime = context.frame / sampleRate;
  return left;
}
function gate(p: Performance, key: number): number | null { return p.getPart(0).keys.find(item => item.key === key)?.gateId ?? null; }
function frequency(samples: Float32Array): number {
  const crossings: number[] = [];
  for (let index = 100; index < samples.length; index++) if (samples[index - 1]! <= 0 && samples[index]! > 0) {
    crossings.push(index - 1 - samples[index - 1]! / (samples[index]! - samples[index - 1]!));
  }
  assert.ok(crossings.length >= 3);
  return sampleRate * (crossings.length - 1) / (crossings.at(-1)! - crossings[0]!);
}
function energy(samples: Float32Array): number { return samples.reduce((sum, value) => sum + value * value, 0); }

test('same-pitch key identity and sustain defer only released physical keys', async () => {
  const events: OPMEvent[] = [];
  const s = await setup(tone(0, 0.005), events);
  try {
    const a = s.performance.noteOn(0, 69), b = s.performance.noteOn(0, 69);
    assert.notEqual(a, b);
    const ga = gate(s.performance, a)!, gb = gate(s.performance, b)!;
    assert.notEqual(ga, gb);
    audio(s.opm, 128);
    s.performance.sustain(0, true);
    assert.equal(s.performance.noteOff(0, a), true);
    assert.equal(s.performance.noteOff(0, a), false);
    audio(s.opm, 128);
    assert.equal(gate(s.performance, a), ga);
    assert.equal(events.some(event => event.type === 'note' && event.id === ga && event.state === 'released'), false);
    s.performance.sustain(0, false);
    audio(s.opm, 256);
    assert.equal(s.performance.getPart(0).keys.find(key => key.key === a), undefined);
    assert.equal(gate(s.performance, b), gb);
    assert.ok(energy(audio(s.opm, 512)) > 0.1);
    s.performance.noteOff(0, b);
    audio(s.opm, 256);
    assert.ok(audio(s.opm, 128).every(value => value === 0));
  } finally { await s.close(); }
});

for (const priority of ['last', 'high', 'low'] as const) {
  test(`mono ${priority} priority chooses and falls back among physical keys`, async () => {
    const s = await setup();
    try {
      s.performance.configurePart(0, { mode: 'mono', legato: true, priority });
      const a = s.performance.noteOn(0, 60), b = s.performance.noteOn(0, 72), c = s.performance.noteOn(0, 55);
      const chosen = priority === 'high' ? b : c;
      assert.equal(s.performance.getPart(0).selectedKey, chosen);
      assert.ok(Math.abs(frequency(audio(s.opm, 2048)) - (priority === 'high' ? 523.251 : 195.998)) < 0.5);
      s.performance.sustain(0, true);
      s.performance.noteOff(0, chosen);
      assert.equal(s.performance.getPart(0).selectedKey, priority === 'last' ? b : a);
      assert.ok(Math.abs(frequency(audio(s.opm, 2048)) - (priority === 'last' ? 523.251 : 261.626)) < 0.5);
      s.performance.sustain(0, false);
      assert.equal(s.performance.getPart(0).keys.some(key => key.key === chosen), false);
    } finally { await s.close(); }
  });
}

test('mono legato preserves onset velocity and envelopes while retrigger restarts attack', async () => {
  async function scenario(legato: boolean) {
    const s = await setup(tone(0.05));
    try {
      s.performance.configurePart(0, { mode: 'mono', legato });
      const a = s.performance.noteOn(0, 69, { velocity: 0.8 });
      const first = gate(s.performance, a);
      audio(s.opm, 2000);
      const b = s.performance.noteOn(0, 81, { velocity: 1 });
      const second = gate(s.performance, b);
      const transition = audio(s.opm, 256);
      return { first, second, transition };
    } finally { await s.close(); }
  }
  const legato = await scenario(true), retrigger = await scenario(false);
  assert.equal(legato.first, legato.second);
  assert.notEqual(retrigger.first, retrigger.second);
  assert.ok(energy(legato.transition) > energy(retrigger.transition) * 20);
  assert.ok(Math.abs(frequency(legato.transition) - 880) < 1);
});

test('legato keeps original velocity/key/rate scaling and expression is a live post-envelope control', async () => {
  const voice = tone(0.01);
  voice.ops[0].keyScale = { breakpoint: 48, leftDbPerOctave: 6, rightDbPerOctave: 18 };
  voice.ops[0].rateKeyScale = 2;
  voice.ops[0].velocitySensitivity = 12;
  const s = await setup(voice);
  try {
    s.performance.configurePart(0, { mode: 'mono', legato: true });
    s.performance.noteOn(0, 48, { velocity: 0.25 });
    const reference = new Synth(sampleRate);
    const id = reference.noteOn(voice, 48, undefined, { velocity: 0.25 });
    const compare = (frames: number) => {
      const expected = new Float32Array(frames), right = new Float32Array(frames);
      reference.render(expected, right);
      assert.deepEqual(audio(s.opm, frames), expected);
    };
    compare(1000);
    s.performance.noteOn(0, 60, { velocity: 1 });
    reference.updateNote(id, { pitch: 12, glide: 0 });
    compare(500);
    s.performance.updatePart(0, { expression: 0.2, pan: 0.3 });
    reference.updateNote(id, { expression: 0.2, pan: 0.3 });
    compare(500);
  } finally { await s.close(); }
});

test('±48 anchored legato boundary reuses, farther moves restart at the actual pitch', async () => {
  const s = await setup();
  try {
    s.performance.configurePart(0, { mode: 'mono', legato: true });
    const a = s.performance.noteOn(0, 24), original = gate(s.performance, a);
    audio(s.opm, 128);
    const b = s.performance.noteOn(0, 72);
    assert.equal(gate(s.performance, b), original);
    assert.ok(Math.abs(frequency(audio(s.opm, 2048)) - 523.251) < 0.5);
    const c = s.performance.noteOn(0, 73);
    assert.notEqual(gate(s.performance, c), original);
    assert.ok(Math.abs(frequency(audio(s.opm, 2048)) - 554.365) < 0.5);
    s.performance.noteOff(0, c);
    assert.ok(Math.abs(frequency(audio(s.opm, 2048)) - 523.251) < 0.5);
    s.performance.noteOff(0, b);
    assert.ok(Math.abs(frequency(audio(s.opm, 8192)) - 32.7032) < 0.1);
  } finally { await s.close(); }
});

test('scoped stops and dispose release helper gates without touching unrelated notes', async () => {
  const s = await setup();
  try {
    s.performance.configurePart(1, { voice: tone() });
    const external = s.opm.playNote({ voice: tone(), note: 69 });
    s.performance.noteOn(0, 60);
    const other = s.performance.noteOn(1, 72);
    audio(s.opm, 128);
    s.performance.allNotesOff(0);
    audio(s.opm, 128);
    assert.equal(s.performance.getPart(0).keys.length, 0);
    assert.equal(s.performance.getPart(1).keys[0]?.key, other);
    s.performance.dispose();
    audio(s.opm, 256);
    assert.ok(Math.abs(frequency(audio(s.opm, 2048)) - 440) < 0.5);
    assert.throws(() => s.performance.noteOn(0, 60), /disposed/);
    s.performance.dispose();
    s.opm.stop(external);
    audio(s.opm, 256);
    assert.ok(audio(s.opm, 128).every(value => value === 0));
  } finally { await s.close(); }
});

test('stealing and reset prune keys; preservation-mode interruption still releases helper gates', async () => {
  const s = await setup();
  try {
    const first = s.performance.noteOn(0, 60);
    audio(s.opm, 128);
    for (let index = 0; index < 8; index++) s.opm.playNote({ voice: tone(), note: 69 });
    audio(s.opm, 128);
    assert.equal(s.performance.getPart(0).keys.some(key => key.key === first), false);
    s.performance.noteOn(0, 60);
    audio(s.opm, 128);
    (s.opm.context as unknown as Context).setState('suspended');
    assert.equal(s.performance.getPart(0).keys.length, 0);
    (s.opm.context as unknown as Context).setState('running');
    audio(s.opm, 256);
    s.opm.panic();
    audio(s.opm, 128);
    s.performance.noteOn(0, 60);
    s.performance.sustain(0, true);
    audio(s.opm, 128);
    s.opm.panic();
    audio(s.opm, 128);
    assert.equal(s.performance.getPart(0).keys.length, 0);
    assert.equal(s.performance.getPart(0).sustain, false);
    const fresh = s.performance.noteOn(0, 72);
    audio(s.opm, 128);
    assert.equal(s.performance.getPart(0).keys[0]?.key, fresh);
    await s.opm.close();
    assert.equal(s.performance.getPart(0).keys.length, 0);
  } finally { await s.close(); }
});

test('parts, total keys, per-part keys and safe own-data validation reject before changing state', async () => {
  const s = await setup(tone(), [], { parts: 2, maxKeys: 3, maxKeysPerPart: 2 });
  try {
    s.performance.configurePart(0, { mode: 'mono', legato: true });
    s.performance.configurePart(1, { voice: tone(), mode: 'mono', legato: true });
    s.performance.noteOn(0, 60);
    s.performance.noteOn(0, 61);
    const snapshot = s.performance.getPart(0);
    assert.throws(() => s.performance.noteOn(0, 62), /capacity/);
    assert.deepEqual(s.performance.getPart(0), snapshot);
    s.performance.noteOn(1, 62);
    assert.throws(() => s.performance.noteOn(1, 63), /capacity/);
    assert.throws(() => s.performance.noteOn(2, 60), /part/);
    let getterCalls = 0;
    const getter = { get velocity() { getterCalls++; return 0.5; } };
    assert.throws(() => s.performance.noteOn(0, 60, getter), /data/);
    assert.equal(getterCalls, 0);
    assert.throws(() => s.performance.configurePart(0, { expression: 2 }), /expression/);
    assert.throws(() => s.performance.configurePart(0, { voice: 'missing' }), /voice/);
    assert.throws(() => s.performance.noteOn(0, NaN), /note/);
    assert.throws(() => s.performance.sustain(0, 1 as unknown as boolean), /boolean/);
    assert.throws(() => s.performance.updatePart(0, { velocity: 0.5 } as never), /unknown/);
    assert.throws(() => s.performance.updatePart(0, Object.create({ expression: 0.5 }) as never), /plain/);
    assert.deepEqual(s.performance.getPart(0), snapshot);
    assert.equal(Reflect.set(snapshot.keys[0]!, 'held', false), false);
  } finally { await s.close(); }
});

test('voice inputs and returned snapshots are detached from later caller mutations', async () => {
  const input = tone();
  const s = await setup(input);
  try {
    const snapshot = s.performance.getPart(0);
    input.ops[0].level = 0;
    s.performance.noteOn(0, 69);
    assert.ok(energy(audio(s.opm, 1024)) > 0.1);
    assert.equal(snapshot.keys.length, 0);
    assert.equal(typeof snapshot.voice === 'string' ? null : snapshot.voice.ops[0].level, 0.8);
    assert.equal(Reflect.set(snapshot, 'expression', 0), false);
    s.performance.updatePart(0, { expression: 0 });
    audio(s.opm, 128);
    assert.ok(audio(s.opm, 128).every(value => value === 0));
    assert.equal(snapshot.expression, 1);
  } finally { await s.close(); }
});

test('default system capacity is 128 even across 16 parts, including pedal-only keys', async () => {
  const s = await setup();
  try {
    for (let part = 0; part < 16; part++) s.performance.configurePart(part, { voice: tone(), mode: 'mono', priority: 'high', legato: true });
    s.performance.noteOn(0, 127);
    for (let index = 1; index < 128; index++) s.performance.noteOn(0, index % 127);
    s.performance.sustain(0, true);
    const keys = s.performance.getPart(0).keys;
    for (const key of keys) s.performance.noteOff(0, key.key);
    assert.throws(() => s.performance.noteOn(15, 60), /capacity/);
    assert.equal(s.performance.getPart(0).keys.length, 128);
    s.performance.sustain(0, false);
    const fresh = s.performance.noteOn(15, 60);
    assert.equal(s.performance.getPart(15).keys[0]?.key, fresh);
  } finally { await s.close(); }
});

test('rejected pending admission is pruned and dispose cancels not-yet-rendered helper notes', async () => {
  const events: OPMEvent[] = [];
  const s = await setup(tone(), events);
  try {
    for (let index = 0; index < 256; index++) s.opm.playNote({ voice: tone(), note: 69 });
    const key = s.performance.noteOn(0, 60);
    assert.equal(s.performance.getPart(0).keys.some(item => item.key === key), false);
    assert.ok(events.some(event => event.type === 'note' && event.state === 'rejected'));
    s.opm.panic();
    audio(s.opm, 128);
    s.performance.noteOn(0, 60);
    s.performance.dispose();
    audio(s.opm, 256);
    assert.ok(audio(s.opm, 128).every(value => value === 0));
  } finally { await s.close(); }
});

test('equal-pitch mono keys use newest identity and mode/voice changes clear only that part', async () => {
  const s = await setup();
  try {
    s.performance.configurePart(0, { mode: 'mono', priority: 'high', legato: true });
    s.performance.configurePart(1, { voice: tone() });
    const a = s.performance.noteOn(0, 60), b = s.performance.noteOn(0, 60);
    const other = s.performance.noteOn(1, 69);
    assert.equal(s.performance.getPart(0).selectedKey, b);
    s.performance.noteOff(0, b);
    assert.equal(s.performance.getPart(0).selectedKey, a);
    audio(s.opm, 128);
    s.performance.configurePart(0, { mode: 'poly' });
    audio(s.opm, 128);
    assert.equal(s.performance.getPart(0).keys.length, 0);
    assert.equal(s.performance.getPart(1).keys[0]?.key, other);
    s.performance.noteOn(0, 60);
    s.performance.configurePart(0, { voice: tone(0.05) });
    audio(s.opm, 128);
    assert.equal(s.performance.getPart(0).keys.length, 0);
    assert.ok(Math.abs(frequency(audio(s.opm, 2048)) - 440) < 0.5);
  } finally { await s.close(); }
});

test('a host callback may scope-stop during admission without orphaning the new gate', async () => {
  const s = await setup();
  let unsubscribe = () => {};
  try {
    unsubscribe = s.opm.subscribe(event => {
      if (event.type === 'note' && event.state === 'accepted') s.performance.allNotesOff(0);
    });
    const key = s.performance.noteOn(0, 69);
    assert.equal(s.performance.noteOff(0, key), false);
    audio(s.opm, 256);
    assert.ok(audio(s.opm, 128).every(value => value === 0));
  } finally { unsubscribe(); await s.close(); }
});
