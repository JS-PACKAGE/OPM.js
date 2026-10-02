import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createPerformance } from '../src/api/performance.js';
import { createMidiAdapter, requestMidiAccess } from '../src/api/midi.js';
import type { MidiAccessLike, MidiInputLike, MidiMessageEventLike } from '../src/api/midi.js';
import { installWorkletHarness, startedEngine, renderFrames } from './worklet-harness.js';

const restore = await installWorkletHarness();
after(restore);

class FakeInput implements MidiInputLike {
  state = 'connected';
  readonly listeners = new Set<(event: MidiMessageEventLike) => void>();
  opened = 0;
  constructor(readonly id: string) {}
  open() { this.opened++; return Promise.resolve(); }
  addEventListener(_type: 'midimessage', listener: (event: MidiMessageEventLike) => void) { this.listeners.add(listener); }
  removeEventListener(_type: 'midimessage', listener: (event: MidiMessageEventLike) => void) { this.listeners.delete(listener); }
  send(...bytes: number[]) { for (const listener of [...this.listeners]) listener({ data: Uint8Array.from(bytes) }); }
}
class FakeAccess implements MidiAccessLike {
  readonly inputs = new Map<string, FakeInput>();
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: 'statechange', listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: 'statechange', listener: () => void) { this.listeners.delete(listener); }
  change() { for (const listener of [...this.listeners]) listener(); }
  get listening() { return this.listeners.size; }
}
async function setup() {
  const opm = await startedEngine();
  const performance = createPerformance(opm);
  const access = new FakeAccess();
  const input = new FakeInput('keys');
  access.inputs.set(input.id, input);
  const errors: Error[] = [];
  const adapter = createMidiAdapter(performance, access, { onError: error => errors.push(error) });
  return { opm, performance, access, input, adapter, errors };
}
const held = (performance: ReturnType<typeof createPerformance>, part: number) => performance.getPart(part).keys.filter(key => key.held).map(key => key.note);

test('channel notes map to parts; repeated pitches have separate identities and pedal defers release', async () => {
  const { opm, performance, input, adapter, errors } = await setup();
  try {
    assert.equal(input.opened, 1);
    input.send(0x90, 60, 100);
    input.send(0x91, 64, 1);
    input.send(0x90, 60, 90);
    assert.deepEqual(held(performance, 0), [60, 60]);
    assert.deepEqual(held(performance, 1), [64]);
    assert.equal(adapter.snapshot.heldKeys, 3);
    input.send(0xb0, 64, 127);
    input.send(0x80, 60, 0);
    // Oldest key is released, but the pedal keeps it in the part as a pedal-only key.
    assert.deepEqual(held(performance, 0), [60]);
    assert.equal(performance.getPart(0).keys.length, 2);
    input.send(0x90, 60, 0);
    input.send(0xb0, 64, 0);
    assert.equal(performance.getPart(0).keys.length, 0);
    input.send(0x91, 64, 0);
    assert.deepEqual(performance.getPart(1).keys, []);
    assert.equal(adapter.snapshot.heldKeys, 0);
    assert.deepEqual(errors, []);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('malformed, out-of-range and unsupported packets are counted without touching sound', async () => {
  const { opm, performance, input, adapter, errors } = await setup();
  try {
    const bad: number[][] = [[], [0x90, 60], [0x90, 60, 100, 1], [0x90, 200, 100], [0x40, 1, 1], [0xf8], [0xf0, 1, 0xf7], [0xc0, 5]];
    for (const packet of bad) input.send(...packet);
    for (const listener of [...input.listeners]) listener({ data: null });
    assert.equal(adapter.snapshot.ignoredMessages, bad.length + 1);
    assert.equal(performance.getPart(0).keys.length, 0);
    assert.deepEqual(errors, []);
    const small = createMidiAdapter(performance, new FakeAccess(), { parts: 1 });
    small.dispose();
    assert.throws(() => createMidiAdapter(performance, new FakeAccess(), { parts: 0 }), RangeError);
    assert.throws(() => createMidiAdapter(performance, new FakeAccess(), { pitchBendRange: 49 }), RangeError);
    assert.throws(() => createMidiAdapter(performance, new FakeAccess(), { unknown: 1 } as never), TypeError);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('MIDI input allowlists reject sparse or executable arrays without invoking user code', async () => {
  const { opm, performance, adapter } = await setup();
  let calls = 0;
  try {
    const accessor = ['keys'];
    Object.defineProperty(accessor, '0', { get() { calls++; return 'keys'; } });
    const iterator = Object.assign(['keys'], { [Symbol.iterator]() { calls++; return ['other'][Symbol.iterator](); } });
    const method = Object.assign(['keys'], { some() { calls++; return false; } });
    for (const ids of [accessor, iterator, method, new Array<string>(1), Object.assign(['keys'], { extra: true })]) {
      assert.throws(() => createMidiAdapter(performance, new FakeAccess(), { inputIds: ids }), TypeError);
    }
    assert.equal(calls, 0);
    const access = new FakeAccess();
    access.inputs.set('keys', new FakeInput('keys'));
    access.inputs.set('other', new FakeInput('other'));
    const ids = ['keys'];
    const filtered = createMidiAdapter(performance, access, { inputIds: ids });
    ids[0] = 'other';
    assert.deepEqual(filtered.snapshot.inputs, ['keys']);
    filtered.dispose();
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('pitch bend, wheel and volume reach sounding notes with bounded musical ranges', async () => {
  const { opm, performance, input, adapter, errors } = await setup();
  const updates: unknown[] = [];
  const original = opm.updateNote.bind(opm);
  opm.updateNote = (id, controls, options) => { updates.push(controls); return original(id, controls, options); };
  try {
    input.send(0x90, 60, 100);
    updates.length = 0;
    input.send(0xe0, 0x7f, 0x7f);
    input.send(0xe0, 0, 0);
    input.send(0xe0, 0, 0x40);
    input.send(0xb0, 1, 127);
    input.send(0xb0, 7, 64);
    input.send(0xb0, 11, 64);
    const pitches = updates.map(update => (update as { pitch?: number }).pitch).filter(value => value !== undefined) as number[];
    assert.ok(Math.abs(pitches[0]! - 2) < 1e-9 && Math.abs(pitches[1]! + 2) < 1e-9 && pitches[2] === 0);
    assert.ok(updates.some(update => (update as { modulation?: number }).modulation === 2));
    assert.ok(Math.abs(performance.getPart(0).expression - (64 / 127) ** 2) < 1e-9);
    renderFrames(opm, 256);
    assert.deepEqual(errors, []);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('disconnect, controller reset and all-notes-off release only the owning input channel', async () => {
  const { opm, performance, access, input, adapter } = await setup();
  const second = new FakeInput('pad');
  access.inputs.set(second.id, second);
  access.change();
  try {
    assert.deepEqual(adapter.snapshot.inputs, ['keys', 'pad']);
    input.send(0x90, 60, 100);
    second.send(0x90, 62, 100);
    second.send(0x91, 64, 100);
    const host = performance.noteOn(5, 70);
    second.send(0xb0, 123, 0);
    assert.deepEqual(held(performance, 0), [60]);
    assert.deepEqual(held(performance, 1), [64]);
    second.state = 'disconnected';
    access.change();
    assert.deepEqual(adapter.snapshot.inputs, ['keys']);
    assert.deepEqual(held(performance, 1), []);
    assert.equal(second.listeners.size, 0);
    assert.deepEqual(held(performance, 0), [60], 'another input keeps its notes');
    assert.deepEqual(held(performance, 5), [70]);
    assert.ok(performance.getPart(5).keys.some(key => key.key === host));
    input.send(0xb0, 64, 127);
    input.send(0xb0, 121, 0);
    assert.equal(performance.getPart(0).sustain, false);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('dispose removes listeners and releases only adapter-owned keys', async () => {
  const { opm, performance, access, input, adapter } = await setup();
  try {
    input.send(0x90, 60, 100);
    const hostKey = performance.noteOn(0, 72);
    adapter.dispose();
    assert.equal(access.listening, 0);
    assert.equal(input.listeners.size, 0);
    assert.deepEqual(held(performance, 0), [72]);
    assert.ok(performance.getPart(0).keys.some(key => key.key === hostKey));
    input.send(0x90, 61, 100);
    assert.deepEqual(held(performance, 0), [72]);
    assert.equal(adapter.snapshot.disposed, true);
  } finally { performance.dispose(); await opm.dispose(); }
});

test('MIDI access is requested only on demand and never asks for SysEx', async () => {
  const calls: unknown[] = [];
  const access = new FakeAccess();
  assert.equal(await requestMidiAccess({ requestMIDIAccess: async options => { calls.push(options); return access; } }), access);
  assert.deepEqual(calls, [{ sysex: false, software: false }]);
  await assert.rejects(requestMidiAccess({}), /not available/);
});
