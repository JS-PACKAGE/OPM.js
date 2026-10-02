import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { brass } from '../src/voices/brass.js';


interface ProcessorMessage {
  type: string;
  id?: number;
  state?: string;
  reason?: string;
  activeVoices?: number;
  pendingEvents?: number;
  rejectedNotes?: number;
  errors?: number;
}
interface MockPort {
  postMessage: (message: ProcessorMessage) => void;
  close: () => void;
  onmessage?: ((event: { data: unknown }) => void) | null;
}
interface TestProcessor {
  port: MockPort;
  receive(data: unknown): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  messages: ProcessorMessage[];
  notes: Map<number, unknown>;
  events: unknown[];
  synth: import('../src/core/synth.js').Synth;
}

const globals = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor'];
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let Processor: new () => TestProcessor;
const sampleRate = 44100;
Object.assign(globalThis, { sampleRate });
Object.assign(globalThis, { currentFrame: 0 });
Object.assign(globalThis, { AudioWorkletProcessor: class {
  messages: ProcessorMessage[] = [];
  port: MockPort;
  constructor() {
    this.port = { postMessage: (message: ProcessorMessage) => this.messages.push(message), close: () => {} };
  }
} });
Object.assign(globalThis, { registerProcessor: (_name: string, constructor: unknown) => { Processor = constructor as new () => TestProcessor; } });
await import('../src/worklet/processor.js');
after(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function block(processor: TestProcessor, frame: number, length = 128) {
  Object.assign(globalThis, { currentFrame: frame });
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  assert.equal(processor.process([], [[left, right]]), true);
  assert.ok(left.every(Number.isFinite));
  assert.ok(right.every(Number.isFinite));
  return left;
}

function note(id: number, frame = 0, duration: number | null = 60) {
  return { type: 'noteOn', id, voice: brass, note: 69, at: frame / sampleRate, duration };
}

function diagnostics(processor: TestProcessor) {
  processor.receive({ type: 'diagnostics', requestId: 1 });
  return processor.messages.at(-1)!;
}

test('a stream longer than the pending cap reclaims stolen offs and retains only live note IDs', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  for (let id = 1; id <= 600; id++) {
    const frame = (id - 1) * 16;
    Object.assign(globalThis, { currentFrame: frame });
    processor.receive(note(id, frame));
    block(processor, frame, 16);
  }
  const report = diagnostics(processor);
  assert.equal(report.activeVoices, 8);
  assert.equal(report.pendingEvents, 8);
  assert.equal(report.rejectedNotes, 0);
  assert.equal(report.errors, 0);
  assert.equal(processor.messages.filter(message => message.state === 'accepted').length, 600);
  assert.equal(processor.messages.filter(message => message.state === 'stolen').length, 592);
  assert.equal(processor.notes.size, 8);
  for (let id = 593; id <= 600; id++) processor.receive({ type: 'noteOff', id });
  for (let frame = 9600; frame < 20000; frame += 128) block(processor, frame);
  const ended = diagnostics(processor);
  assert.equal(ended.activeVoices, 0);
  assert.equal(ended.pendingEvents, 0);
  assert.equal(processor.notes.size, 0);
});

test('duplicate IDs with different starts and offs cannot shorten or replace the first admission', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  const reference = new Processor();
  const original = note(1, 32, 0.02);
  processor.receive(original);
  reference.receive(original);
  processor.receive(note(1, 256, 1 / sampleRate));
  for (let frame = 0; frame < 14000; frame += 128) {
    assert.deepEqual(block(processor, frame), block(reference, frame), `duplicate changed sound at frame ${frame}`);
    if (frame === 128) processor.receive(note(1, 512, 1 / sampleRate));
  }
  const lifecycle = processor.messages.filter(message => message.type === 'note' && message.state !== 'rejected');
  assert.deepEqual(lifecycle.map(message => message.state), ['accepted', 'started', 'released', 'ended']);
  assert.equal(diagnostics(processor).rejectedNotes, 2);
  assert.equal(processor.notes.size, 0);
});

test('held future notes have bounded admission and cancelling them restores capacity without orphan starts', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  for (let id = 1; id <= 257; id++) processor.receive(note(id, 4410, null));
  assert.equal(diagnostics(processor).pendingEvents, 256);
  assert.equal(diagnostics(processor).rejectedNotes, 1);
  processor.receive({ type: 'noteOff', id: 17 });
  processor.receive(note(258, 4410, null));
  assert.ok(processor.messages.some(message => message.id === 258 && message.state === 'accepted'));
  for (let id = 1; id <= 256; id++) if (id !== 17) processor.receive({ type: 'noteOff', id });
  processor.receive({ type: 'noteOff', id: 258 });
  assert.equal(diagnostics(processor).pendingEvents, 0);
  assert.equal(processor.notes.size, 0);
  assert.ok(block(processor, 4410).every(sample => sample === 0));
  for (let id = 1; id <= 8; id++) processor.receive(note(id, 4538, null));
  block(processor, 4538);
  for (let id = 100; id < 348; id++) processor.receive(note(id, 88200, null));
  processor.receive(note(999, 88200, null));
  const full = diagnostics(processor);
  assert.equal(full.activeVoices, 8);
  assert.equal(full.pendingEvents, 248);
  assert.equal(full.rejectedNotes, 2, 'active IDs must count against admission even before the event cap is full');
});

test('optional fields and diagnostics use strict own data without invoking accessors or coercions', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  let reads = 0;
  const getter = () => { reads++; throw Error('accessor ran'); };
  const optional = note(1, 0, null);
  Object.defineProperty(optional, 'pan', { enumerable: true, get: getter });
  const inherited: Record<string, unknown> = Object.create({ velocity: 0.5 });
  Object.assign(inherited, note(2, 0, null));
  const typeObject = { [Symbol.toPrimitive]: getter };
  const request = { type: 'diagnostics' };
  Object.defineProperty(request, 'requestId', { enumerable: true, get: getter });
  for (const input of [null, [], {}, optional, inherited, request, { ...note(3), surprise: true },
    { ...note(4), type: typeObject }, { ...note(5), velocity: undefined }, { ...note(6), pan: Infinity },
    { ...note(7), duration: undefined }, note(8, sampleRate * 61, null)]) processor.receive(input);
  assert.equal(reads, 0);
  assert.equal(diagnostics(processor).pendingEvents, 0);
  assert.ok(block(processor, 0).every(sample => sample === 0));
  const plain: Record<string, unknown> = Object.assign(Object.create(null), note(10, 128, null), { velocity: 0.5, pan: -1 });
  processor.receive(plain);
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  Object.assign(globalThis, { currentFrame: 128 });
  processor.process([], [[left, right]]);
  assert.ok(left.some(sample => sample !== 0));
  assert.ok(right.every(sample => Math.abs(sample) < 1e-10));
});

test('core errors terminate a note once, reclaim its off, and surface accurate diagnostics', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  processor.receive(note(1));
  block(processor, 0);
  processor.synth.voices[0].phases[0] = NaN;
  block(processor, 128);
  const errorEvents = processor.messages.filter(message => message.id === 1 && message.state === 'ended');
  assert.equal(errorEvents.length, 1);
  assert.equal(errorEvents[0].reason, 'error');
  const report = diagnostics(processor);
  assert.equal(report.activeVoices, 0);
  assert.equal(report.pendingEvents, 0);
  assert.equal(report.errors, 1);
  processor.receive(note(1, 256, null));
  assert.ok(block(processor, 256).some(sample => sample !== 0));
  assert.equal(diagnostics(processor).activeVoices, 1);
});

test('broken ports cannot break rendering, and clean shutdown stops processing in a reused context', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  processor.port.postMessage = () => { throw Error('port failed'); };
  processor.receive(note(1, 0, null));
  assert.ok(block(processor, 0, 1024).some(sample => sample !== 0));
  processor.receive({ type: 'close', extra: true });
  assert.ok(block(processor, 1024).some(sample => sample !== 0));
  processor.receive({ type: 'close' });
  assert.equal(processor.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
  processor.receive(note(2));
  assert.equal(processor.events.length, 0);
  assert.equal(processor.notes.size, 0);
});
