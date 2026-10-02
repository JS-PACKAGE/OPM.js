import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { brass } from '../src/voices/brass.js';
import { Synth } from '../src/core/synth.js';
import type { NoteControls } from '../src/core/synth.js';
import type { Voice } from '../src/voices/schema.js';


interface ProcessorMessage {
  type: string;
  id?: number;
  state?: string;
  reason?: string;
  frame?: number;
  time?: number;
  command?: string;
  commandId?: number;
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
  synth: Synth;
}

const globals = ['sampleRate', 'currentFrame', 'AudioWorkletProcessor', 'registerProcessor'];
const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let Processor: new (options?: AudioWorkletNodeOptions) => TestProcessor;
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
Object.assign(globalThis, { registerProcessor: (_name: string, constructor: unknown) => { Processor = constructor as new (options?: AudioWorkletNodeOptions) => TestProcessor; } });
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

test('registered and inline patches snapshot immediately and cannot be replaced by malformed registrations', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  const reference = new Processor();
  const source = structuredClone(brass);
  processor.receive({ type: 'prepareVoice', voiceId: 1, voice: source });
  processor.receive({ type: 'noteOn', id: 1, voiceId: 1, note: 69, at: 32 / sampleRate, duration: null });
  reference.receive(note(1, 32, null));
  source.ops.forEach(op => { op.level = 0; });
  processor.receive({ type: 'prepareVoice', voiceId: 1, voice: source });
  let reads = 0;
  const malformed = { ...brass };
  Object.defineProperty(malformed, 'feedback', { get() { reads++; throw Error('getter ran'); } });
  processor.receive({ type: 'prepareVoice', voiceId: 2, voice: malformed });
  assert.equal(reads, 0);
  assert.equal(processor.messages.filter(message => message.state === 'rejected').length, 0, 'registration failure is not a note admission');
  assert.deepEqual(block(processor, 0), block(reference, 0));
  processor.receive({ type: 'noteOn', id: 2, voiceId: 2, note: 69, at: 128 / sampleRate, duration: null });
  assert.ok(processor.messages.some(message => message.id === 2 && message.state === 'rejected' && message.reason === 'invalid-voice'));
  const inline = structuredClone(brass);
  processor.receive({ ...note(3, 160, null), voice: inline });
  reference.receive(note(3, 160, null));
  inline.ops.forEach(op => { op.level = 0; });
  assert.deepEqual(block(processor, 128), block(reference, 128));
  processor.receive({ type: 'noteOn', id: 4, voiceId: 1, note: 69, at: 256 / sampleRate, duration: null });
  reference.receive({ ...note(4, 256, null), voice: source });
  assert.deepEqual(block(processor, 256), block(reference, 256), 'slot replacement affects new notes, not admitted snapshots');
});

test('voice registrations are bounded while valid inline notes remain usable past the cache limit', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  for (let voiceId = 1; voiceId <= 129; voiceId++) processor.receive({ type: 'prepareVoice', voiceId, voice: brass });
  processor.receive({ type: 'noteOn', id: 1, voiceId: 128, note: 69, at: 0, duration: null });
  processor.receive({ type: 'noteOn', id: 2, voiceId: 129, note: 69, at: 0, duration: null });
  processor.receive(note(3, 0, null));
  assert.ok(block(processor, 0).some(sample => sample !== 0));
  assert.ok(processor.messages.some(message => message.id === 2 && message.reason === 'invalid-voice'));
  const report = diagnostics(processor);
  assert.equal(report.activeVoices, 2);
  assert.equal(report.errors, 1);
  assert.equal(report.rejectedNotes, 1);
});

test('controls and scheduled stops share the event bound and cancellation frees every event', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  processor.receive(note(1, 1024, null));
  for (let index = 0; index < 255; index++) processor.receive({ type: 'updateNote', id: 1, controls: { expression: 0.5 }, at: 2048 / sampleRate });
  processor.receive({ type: 'noteOff', id: 1, commandId: 77, at: 512 / sampleRate });
  const full = diagnostics(processor);
  assert.equal(full.pendingEvents, 256);
  assert.equal(full.errors, 1);
  assert.equal(full.rejectedNotes, 0, 'control/off capacity failures cannot reject an admitted note');
  assert.ok(processor.messages.some(message => message.type === 'command' &&
    message.commandId === 77 && message.command === 'stop' && message.state === 'rejected' && message.reason === 'capacity'));
  assert.equal(processor.messages.filter(message => message.type === 'note' && message.state === 'rejected').length, 0);
  processor.receive({ type: 'noteOff', id: 1 });
  assert.equal(diagnostics(processor).pendingEvents, 0);
  assert.equal(processor.notes.size, 0);
  assert.ok(block(processor, 1024).every(sample => sample === 0));
});

test('same-frame stops win onset and ordered onset steals reclaim scheduled tail controls', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  processor.receive(note(100, 32, null));
  processor.receive({ type: 'updateNote', id: 100, controls: { expression: 1 }, at: 0 });
  processor.receive({ type: 'noteOff', id: 100, at: 32 / sampleRate });
  for (let id = 1; id <= 9; id++) {
    processor.receive(note(id, 32, null));
    processor.receive({ type: 'updateNote', id, controls: { expression: 0.5 }, at: 4096 / sampleRate });
  }
  block(processor, 0);
  assert.deepEqual(processor.messages.filter(message => message.type === 'note' && message.id === 100).map(message => [message.state, message.frame]),
    [['accepted', 0], ['cancelled', 32]]);
  assert.deepEqual(processor.messages.filter(message => message.state === 'started').map(message => message.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(processor.messages.filter(message => message.state === 'stolen').map(message => [message.id, message.frame]), [[1, 32]]);
  assert.equal(diagnostics(processor).pendingEvents, 8, 'stolen voice must not retain tail controls');
  for (let id = 2; id <= 9; id++) processor.receive({ type: 'noteOff', id });
  for (let frame = 128; frame < 8192; frame += 128) block(processor, frame);
  assert.equal(diagnostics(processor).pendingEvents, 0);
  assert.equal(processor.notes.size, 0);
});

test('raw controls and scheduling fields use own data and reject malformed records without touching a gate', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  processor.receive(note(1, 0, null));
  block(processor, 0);
  let reads = 0;
  const controls = {};
  Object.defineProperty(controls, 'expression', { get() { reads++; throw Error('getter ran'); } });
  const stop = { type: 'noteOff', id: 1 };
  Object.defineProperty(stop, 'at', { get() { reads++; return 0; } });
  for (const message of [
    { type: 'updateNote', id: 1, controls },
    { type: 'updateNote', id: 1, controls: { expression: 0, extra: true } },
    { type: 'updateNote', id: 1, controls: { glide: 1 } },
    { type: 'updateNote', id: 1, controls: { pan: NaN } },
    { type: 'updateNote', id: 1, controls: { expression: 0 }, at: undefined },
    { type: 'noteOff', id: 1, at: 61 },
    stop,
  ]) processor.receive(message);
  assert.equal(reads, 0);
  assert.ok(block(processor, 128).some(sample => sample !== 0));
  assert.equal(processor.messages.filter(message => message.state === 'released').length, 0);
  processor.receive({ type: 'updateNote', id: 1, controls: { expression: 0 }, at: 256 / sampleRate });
  assert.ok(block(processor, 256).every(sample => sample === 0));
});

test('full control queues report a rejected held-note stop and immediate recovery still ends the voice', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  processor.receive(note(1, 0, null));
  block(processor, 0);
  for (let index = 0; index < 256; index++) {
    processor.receive({ type: 'updateNote', id: 1, controls: { expression: 0.5 }, at: 10 });
  }
  processor.receive({ type: 'noteOff', id: 1, commandId: 91, at: 256 / sampleRate });
  assert.ok(block(processor, 128, 512).some(sample => sample !== 0));
  assert.equal(diagnostics(processor).activeVoices, 1);
  assert.ok(processor.messages.some(message => message.type === 'command' &&
    message.commandId === 91 && message.state === 'rejected' && message.reason === 'capacity'));
  processor.receive({ type: 'noteOff', id: 1, commandId: 92 });
  for (let frame = 640; frame < 10000; frame += 128) block(processor, frame);
  assert.ok(block(processor, 10112).every(sample => sample === 0));
  assert.equal(diagnostics(processor).pendingEvents, 0);
  assert.deepEqual(processor.messages.filter(message => message.type === 'note' && message.id === 1).map(message => message.state),
    ['accepted', 'started', 'released', 'ended']);
});

test('allNotesOff cancels future automation and onsets while preserving natural release tails', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  processor.receive(note(1, 0, null));
  processor.receive(note(2, 1024, null));
  processor.receive(note(3, 0, null));
  block(processor, 0);
  processor.receive({ type: 'noteOff', id: 3 });
  for (let index = 0; index < 255; index++) processor.receive({
    type: 'updateNote', id: 1, controls: { expression: 0.5 }, at: 10,
  });
  processor.receive({ type: 'allNotesOff', commandId: 100 });
  assert.equal(diagnostics(processor).pendingEvents, 0);
  assert.ok(block(processor, 128).some(sample => sample !== 0), 'release tails must remain audible');
  for (let frame = 256; frame < 10000; frame += 128) block(processor, frame);
  assert.ok(block(processor, 10112).every(sample => sample === 0));
  for (const id of [1, 3]) {
    assert.deepEqual(processor.messages.filter(message => message.type === 'note' && message.id === id).map(message => message.state),
      ['accepted', 'started', 'released', 'ended']);
  }
  assert.deepEqual(processor.messages.filter(message => message.type === 'note' && message.id === 2).map(message => message.state),
    ['accepted', 'cancelled']);
});

test('panic bypasses full queues, silences release and stealing tails, then reuses the registered patch', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  processor.receive({ type: 'prepareVoice', voiceId: 1, voice: brass });
  for (let id = 1; id <= 10; id++) processor.receive(note(id, 0, null));
  processor.receive(note(20, 2048, null));
  block(processor, 0);
  processor.receive({ type: 'noteOff', id: 10 });
  for (let index = 0; index < 255; index++) processor.receive({
    type: 'updateNote', id: 9, controls: { pan: 1 }, at: 10,
  });
  processor.receive({ type: 'panic', commandId: 101 });
  assert.ok(block(processor, 128).every(sample => sample === 0));
  assert.ok(block(processor, 2048).every(sample => sample === 0));
  assert.equal(diagnostics(processor).pendingEvents, 0);
  assert.equal(diagnostics(processor).activeVoices, 0);
  for (const id of [3, 4, 5, 6, 7, 8, 9, 10, 20]) {
    assert.equal(processor.messages.filter(message => message.type === 'note' &&
      message.id === id && message.state === 'cancelled').length, 1);
  }
  processor.receive({ type: 'noteOn', id: 21, voiceId: 1, note: 60.5, at: 2048 / sampleRate, duration: null });
  assert.ok(block(processor, 2048).some(sample => sample !== 0));
  assert.equal(diagnostics(processor).errors, 0);
});

test('prepared patches and detached operator automation render identically through the scheduled worklet boundary', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  const patch: Voice = {
    version: 6, name: 'worklet-expressive', algorithm: 4, feedback: 2, modIndex: 2,
    lfo: { rate: 3, amDepth: 0.2, pmDepth: 100, waveform: 'triangle', delay: 0.015, sync: 'global', phase: 0.2 },
    pitchEnvelope: { a: 0.01, d: 0.02, r: 0.03, initial: -100, peak: 100, sustain: 0, final: -200 },
    ops: [0, 1, 2, 3].map(index => ({ ratio: 1, frequency: 330 * (index + 1), rateKeyScale: 1,
      level: 0.3, detune: 0, adsr: { a: 0.001, d: 0.01, s: 0.8, r: 0.05 } })) as Voice['ops'],
  };
  const original = structuredClone(patch);
  processor.receive({ type: 'prepareVoice', voiceId: 9, voice: patch });
  patch.pitchEnvelope!.peak = 4800; patch.ops[0].frequency = 19999; patch.lfo.phase = 1;
  processor.receive({ type: 'noteOn', id: 1, voiceId: 9, note: 72, at: 64 / sampleRate, duration: null });
  const levels: [number, number, number, number] = [0.1, 0.5, 1.5, 0];
  const automation = { operatorLevels: levels, ramp: 0.02 };
  const detached = structuredClone(automation);
  processor.receive({ type: 'updateNote', id: 1, controls: automation, at: 256 / sampleRate });
  levels.fill(0);
  const live = { pitch: 12, glide: 0.01, expression: 0.4, pan: 0.3 };
  processor.receive({ type: 'updateNote', id: 1, controls: live, at: 512 / sampleRate });
  processor.receive({ type: 'noteOff', id: 1, at: 2048 / sampleRate });
  let reads = 0;
  const accessor = [1, 1, 1, 1];
  Object.defineProperty(accessor, '0', { get() { reads++; return 0; } });
  processor.receive({ type: 'updateNote', id: 1, controls: { operatorLevels: accessor }, at: 300 / sampleRate });
  assert.equal(reads, 0);
  const reference = new Synth(sampleRate);
  const expectedLeft = new Float32Array(4096), expectedRight = new Float32Array(4096);
  reference.render(expectedLeft, expectedRight, 0, 64);
  reference.noteOn(original, 72, 1);
  reference.render(expectedLeft, expectedRight, 64, 192);
  reference.updateNote(1, detached);
  reference.render(expectedLeft, expectedRight, 256, 256);
  reference.updateNote(1, live);
  reference.render(expectedLeft, expectedRight, 512, 1536);
  reference.noteOff(1);
  reference.render(expectedLeft, expectedRight, 2048);
  const left = new Float32Array(4096), right = new Float32Array(4096);
  for (let frame = 0; frame < left.length; frame += 128) {
    Object.assign(globalThis, { currentFrame: frame });
    processor.process([], [[left.subarray(frame, frame + 128), right.subarray(frame, frame + 128)]]);
  }
  assert.deepEqual(left, expectedLeft);
  assert.deepEqual(right, expectedRight);
  const report = diagnostics(processor);
  assert.equal(report.errors, 1, 'malformed tuple rejection is counted without changing sound');
  assert.equal(report.activeVoices, 0);
  assert.equal(report.rejectedNotes, 0);
});

test('processor initialization rejects hostile polyphony and synth options without invoking accessors', () => {
  let reads = 0;
  const getter = () => { reads++; throw Error('getter ran'); };
  const accessor = {};
  Object.defineProperty(accessor, 'maxVoices', { get: getter });
  const qualityAccessor = {};
  Object.defineProperty(qualityAccessor, 'quality', { get: getter });
  const rootAccessor = {};
  Object.defineProperty(rootAccessor, 'processorOptions', { get: getter });
  for (const options of [
    rootAccessor, { processorOptions: accessor }, { processorOptions: qualityAccessor },
    { processorOptions: Object.assign(Object.create({ quality: 'eco' }), { maxVoices: 1 }) },
    { processorOptions: null }, { processorOptions: [] }, { processorOptions: { [Symbol('quality')]: 'eco' } },
    ...[0, 9, 1.5, NaN, Infinity, '2', true, null, undefined, { valueOf: getter }].map(maxVoices => ({
      processorOptions: { maxVoices },
    })),
    { processorOptions: { quality: 'other' } }, { processorOptions: { quality: undefined } },
    { processorOptions: { unknown: true } }, Object.create({ processorOptions: { maxVoices: 1 } }),
  ]) assert.throws(() => new Processor(options as AudioWorkletNodeOptions));
  assert.equal(reads, 0);
});

test('new operator and LFO controls snapshot at admission and malformed updates cannot change scheduled sound', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor({ processorOptions: { maxVoices: 1, quality: 'eco' } });
  const patch: Voice = {
    version: 6, name: 'controls', algorithm: 0, feedback: 2, modIndex: 3,
    lfo: { rate: 3, amDepth: 0.3, pmDepth: 200, waveform: 'sine',
      amTargets: [1, 0, 0.5, 1], pmTargets: [0, 1, 1, 0.5] },
    ops: [0, 1, 2, 3].map(index => ({ ratio: index + 1, level: 0.7, detune: 0,
      adsr: { a: 0, d: 0.01, s: 0.8, r: 0.03 } })) as Voice['ops'],
  };
  const controls: NoteControls = {
    feedback: 5, operatorRatios: [1, 1.5, 2, 3], operatorFrequencies: [660, null, null, 880],
    operatorADSR: [0, 1, 2, 3].map(() => ({ a: 0.001, d: 0.02, s: 0.6, r: 0.04 })) as unknown as NoteControls['operatorADSR'],
    lfoRate: 11, amDepth: 0.8, pmDepth: 330, ramp: 0.002,
  };
  const expectedControls = structuredClone(controls);
  processor.receive({ ...note(1, 64, null), voice: patch });
  processor.receive({ type: 'updateNote', id: 1, controls, at: 256 / sampleRate });
  (controls.operatorRatios as unknown as number[]).fill(32);
  (controls.operatorFrequencies as unknown as (number | null)[]).fill(1);
  controls.operatorADSR![0].s = 0;
  controls.feedback = 0; controls.lfoRate = 0;
  let reads = 0;
  const accessor = [1, 1, 1, 1];
  Object.defineProperty(accessor, '1', { get() { reads++; throw Error('tuple getter ran'); } });
  const envelope = { a: 0, d: 0, s: 1, r: 0 };
  Object.defineProperty(envelope, 's', { get() { reads++; throw Error('ADSR getter ran'); } });
  const invalid = [
    { feedback: -0.01 }, { feedback: 8 }, { operatorRatios: accessor }, { operatorRatios: [1, 1, 1] },
    { operatorRatios: [1, 1, 1, 0] }, { operatorFrequencies: [1, null, null, undefined] },
    { operatorFrequencies: [1, null, null, 20001] }, { operatorADSR: [envelope, envelope, envelope, envelope] },
    { operatorADSR: [{ a: 0 }, { a: 0 }, { a: 0 }, { a: 0 }] },
    { lfoRate: Infinity }, { amDepth: 1.1 }, { pmDepth: 1201 },
  ];
  for (const [index, bad] of invalid.entries()) {
    processor.receive({ type: 'updateNote', id: 1, controls: bad, commandId: index + 1, at: 128 / sampleRate });
  }
  assert.equal(reads, 0);
  assert.equal(processor.messages.filter(message => message.type === 'command' && message.state === 'rejected').length, invalid.length);
  const reference = new Synth(sampleRate, 1, { quality: 'eco' });
  const untouched = new Synth(sampleRate, 1, { quality: 'eco' });
  const expected = new Float32Array(1024), expectedRight = new Float32Array(1024);
  const baseline = new Float32Array(1024), baselineRight = new Float32Array(1024);
  reference.render(expected, expectedRight, 0, 64);
  untouched.render(baseline, baselineRight, 0, 64);
  reference.noteOn(patch, 69, 1);
  untouched.noteOn(patch, 69, 1);
  reference.render(expected, expectedRight, 64, 192);
  reference.updateNote(1, expectedControls);
  reference.render(expected, expectedRight, 256);
  untouched.render(baseline, baselineRight, 64);
  const actual = new Float32Array(1024), actualRight = new Float32Array(1024);
  for (let frame = 0; frame < actual.length; frame += 128) {
    Object.assign(globalThis, { currentFrame: frame });
    processor.process([], [[actual.subarray(frame, frame + 128), actualRight.subarray(frame, frame + 128)]]);
  }
  assert.deepEqual(actual, expected);
  assert.deepEqual(actualRight, expectedRight);
  assert.notDeepEqual(actual.subarray(256), baseline.subarray(256), 'valid controls must change audible synthesis');
  assert.equal(diagnostics(processor).errors, invalid.length);
});

test('raw stop cancellation rejects malformed booleans and removes only the selected gate automation', () => {
  Object.assign(globalThis, { currentFrame: 0 });
  const processor = new Processor();
  processor.receive(note(1, 0, null));
  processor.receive(note(2, 0, null));
  block(processor, 0);
  processor.receive({ type: 'updateNote', id: 1, controls: { expression: 0 }, at: 256 / sampleRate });
  processor.receive({ type: 'updateNote', id: 2, controls: { expression: 0 }, at: 256 / sampleRate });
  let reads = 0;
  const accessor = { type: 'noteOff', id: 1, commandId: 1 };
  Object.defineProperty(accessor, 'cancelControls', { get() { reads++; return true; } });
  const malformed = [accessor,
    { type: 'noteOff', id: 1, commandId: 2, cancelControls: 1 },
    { type: 'noteOff', id: 1, commandId: 3, cancelControls: undefined },
    { type: 'noteOff', id: 1, commandId: 4, cancelControls: true, at: 0 },
    { type: 'noteOff', id: 1, commandId: 5, cancelControls: false, at: 0 },
  ];
  for (const message of malformed) processor.receive(message);
  assert.equal(reads, 0);
  assert.equal(diagnostics(processor).pendingEvents, 2);
  assert.equal(processor.messages.filter(message => message.type === 'note' && message.state === 'released').length, 0);
  processor.receive({ type: 'noteOff', id: 1, commandId: 6, cancelControls: true });
  assert.equal(diagnostics(processor).pendingEvents, 1);
  const reference = new Synth(sampleRate);
  reference.noteOn(brass, 69, 1);
  reference.noteOn(brass, 69, 2);
  reference.render(new Float32Array(128), new Float32Array(128));
  reference.noteOff(1);
  const expectedTail = new Float32Array(128), expectedTailRight = new Float32Array(128);
  reference.render(expectedTail, expectedTailRight);
  assert.deepEqual(block(processor, 128), expectedTail);
  reference.updateNote(2, { expression: 0 });
  const expectedAfter = new Float32Array(128), expectedAfterRight = new Float32Array(128);
  reference.render(expectedAfter, expectedAfterRight);
  assert.deepEqual(block(processor, 256), expectedAfter);
  assert.ok(expectedAfter.some(sample => sample !== 0), 'cancelled automation does not silence the release tail');
  processor.receive(note(3, 1024, null));
  processor.receive({ type: 'updateNote', id: 3, controls: { expression: 0 }, at: 2048 / sampleRate });
  processor.receive({ type: 'noteOff', id: 3, cancelControls: true });
  assert.equal(diagnostics(processor).pendingEvents, 0);
  assert.ok(!processor.messages.some(message => message.id === 3 && message.state === 'started'));
});
