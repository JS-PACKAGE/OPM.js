import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createPerformance } from '../src/api/performance.js';
import { createMidiAdapter, requestMidiAccess } from '../src/api/midi.js';
import type { MidiAccessLike, MidiAdapterOptions, MidiControllerMapping, MidiInputLike, MidiMessageEventLike } from '../src/api/midi.js';
import type { NoteControls } from '../src/core/synth.js';
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
async function setup(options: MidiAdapterOptions = {}) {
  const opm = await startedEngine();
  const performance = createPerformance(opm);
  const access = new FakeAccess();
  const input = new FakeInput('keys');
  access.inputs.set(input.id, input);
  const errors: Error[] = [];
  const adapter = createMidiAdapter(performance, access, { ...options, onError: error => errors.push(error) });
  return { opm, performance, access, input, adapter, errors };
}
const held = (performance: ReturnType<typeof createPerformance>, part: number) => performance.getPart(part).keys.filter(key => key.held).map(key => key.note);

test('forced cleanup releases held and earlier pedal keys without releasing a foreign pedal key', async () => {
  const { opm, performance, input, adapter, errors } = await setup();
  try {
    const events: number[] = [];
    const stop = opm.stop.bind(opm);
    opm.stop = id => { events.push(id); return stop(id); };
    input.send(0xb0, 64, 127);
    input.send(0x90, 60, 100);
    input.send(0x80, 60, 0);
    input.send(0x90, 62, 100);
    const host = performance.noteOn(0, 72);
    performance.noteOff(0, host);
    renderFrames(opm, 128);
    const ownGates = performance.getPart(0).keys.filter(key => key.key !== host).map(key => key.gateId);
    adapter.releaseAll();
    assert.equal(adapter.snapshot.heldKeys, 0);
    assert.deepEqual(performance.getPart(0).keys.map(key => key.key), [host]);
    assert.equal(performance.getPart(0).sustain, true);
    assert.ok(ownGates.every(id => id !== null && events.includes(id)));
    renderFrames(opm, 1024);
    assert.deepEqual(errors, []);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('CC123 retains pedal ownership; CC120 forces it and disconnect preserves another pedal owner', async () => {
  const { opm, performance, access, input, adapter, errors } = await setup();
  const second = new FakeInput('pad');
  access.inputs.set(second.id, second); access.change();
  try {
    input.send(0xb0, 64, 127); second.send(0xb0, 64, 127);
    const host = performance.noteOn(0, 72); performance.noteOff(0, host);
    input.send(0x90, 60, 100); input.send(0xb0, 123, 0);
    assert.equal(adapter.snapshot.heldKeys, 0);
    assert.deepEqual(performance.getPart(0).keys.map(key => key.note), [72, 60]);
    adapter.releaseAll();
    assert.deepEqual(performance.getPart(0).keys.map(key => key.key), [host]);
    input.send(0x90, 60, 100); input.send(0x80, 60, 0);
    input.send(0x90, 60, 100); input.send(0xb0, 120, 0);
    assert.deepEqual(performance.getPart(0).keys.map(key => key.key), [host]);
    input.send(0x90, 61, 100); input.send(0x80, 61, 0);
    second.send(0x90, 62, 100); second.send(0x80, 62, 0);
    input.state = 'disconnected'; access.change();
    assert.deepEqual(performance.getPart(0).keys.map(key => key.note), [72, 62]);
    assert.equal(performance.getPart(0).sustain, true);
    adapter.dispose();
    assert.equal(performance.getPart(0).keys.length, 0, 'last adapter pedal removal retains shared-controller semantics');
    assert.deepEqual(errors, []);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('stale ownership is pruned at its bound without snapshots on every packet or reused-slot loss', async () => {
  const { opm, performance, input, adapter, errors } = await setup();
  try {
    let snapshots = 0;
    const getPart = performance.getPart.bind(performance);
    performance.getPart = part => { snapshots++; return getPart(part); };
    for (let index = 0; index < 600; index++) {
      input.send(0x90, 60, 100); input.send(0x80, 60, 0);
      renderFrames(opm, 1024);
    }
    assert.equal(snapshots, 32, 'two threshold prunes over 16 parts');
    input.send(0xb0, 64, 127);
    input.send(0x90, 60, 100); input.send(0x80, 60, 0);
    input.send(0x90, 60, 100);
    adapter.releaseAll();
    assert.equal(getPart(0).keys.length, 0);
    assert.equal(adapter.snapshot.heldKeys, 0);
    assert.deepEqual(errors, []);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

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

test('effective part control snapshots resolve patches, preserve defaults and detach own data', async () => {
  const { opm, performance, adapter } = await setup();
  try {
    const snapshot = performance.getPartControls(0);
    assert.deepEqual(snapshot.operatorRatios, opm.voices.get('brass')!.ops.map(op => op.ratio));
    assert.equal(snapshot.gain, 1);
    assert.deepEqual(snapshot.operatorLevels, [1, 1, 1, 1], 'operator levels default to neutral multipliers, not raw patch levels');
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.operatorRatios) && Object.isFrozen(snapshot.operatorADSR?.[0]));
    assert.throws(() => Object.defineProperty(snapshot.operatorRatios!, '0', { value: 9 }), TypeError);
    performance.updatePartNotes(0, { feedback: 4, operatorRatios: [4, 3, 2, 1] });
    const key = performance.noteOn(0, 60);
    performance.updateKey(0, key, { feedback: 7 });
    const updated = performance.getPartControls(0);
    assert.equal(updated.feedback, 4, 'per-key controls are not part defaults');
    assert.deepEqual(updated.operatorRatios, [4, 3, 2, 1]);
    assert.notEqual(snapshot.feedback, updated.feedback);
    assert.deepEqual(snapshot.operatorRatios, opm.voices.get('brass')!.ops.map(op => op.ratio));
    assert.throws(() => performance.getPartControls(16), RangeError);
    performance.dispose();
    assert.throws(() => performance.getPartControls(0), Error);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('custom CC endpoints, operator elements and ramps reach real Performance without default CC cross-talk', async () => {
  const controllerMap: MidiControllerMapping[] = [
    { controller: 1, field: 'feedback', min: 0, max: 7, ramp: 0.05 },
    { controller: 7, field: 'operatorRatios', operator: 2, min: 0.125, max: 32, ramp: 0.1 },
    { controller: 10, field: 'operatorLevels', operator: 1, min: 0, max: 2, ramp: 10 },
    { controller: 16, field: 'lfoRate', min: 0, max: 20, ramp: 0 },
    { controller: 17, field: 'amDepth', min: 0, max: 1, ramp: 0.02 },
    { controller: 18, field: 'pmDepth', min: 0, max: 1200, ramp: 0.02 },
    { controller: 19, field: 'operatorFrequencies', operator: 0, min: 1, max: 20000, ramp: 0.02, reset: null },
    { controller: 20, field: 'pitch', min: -48, max: 48, ramp: 0.1 },
  ];
  const { opm, performance, input, adapter, errors } = await setup({ controllerMap });
  const updates: NoteControls[] = [];
  const original = opm.updateNote.bind(opm);
  opm.updateNote = (id, controls, options) => { updates.push(controls); return original(id, controls, options); };
  try {
    performance.updatePartNotes(0, { operatorRatios: [2, 3, 4, 5], operatorLevels: [0.2, 0.4, 0.6, 0.8] });
    input.send(0x90, 60, 100);
    input.send(0xb0, 1, 127);
    assert.equal(performance.getPartControls(0).feedback, 7);
    assert.equal(performance.getPartControls(0).modulation, 1, 'mapped CC1 replaces its ordinary wheel behavior');
    assert.equal(updates.at(-1)!.ramp, 0.05);
    input.send(0xb0, 7, 0);
    assert.deepEqual(performance.getPartControls(0).operatorRatios, [2, 3, 0.125, 5]);
    assert.equal(performance.getPart(0).expression, 1, 'mapped CC7 does not set volume');
    input.send(0xb0, 7, 127);
    assert.deepEqual(performance.getPartControls(0).operatorRatios, [2, 3, 32, 5]);
    input.send(0xb0, 10, 127);
    assert.deepEqual(performance.getPartControls(0).operatorLevels, [0.2, 2, 0.6, 0.8]);
    assert.equal(performance.getPart(0).pan, 0, 'mapped CC10 does not pan');
    input.send(0xb0, 16, 64);
    assert.equal(performance.getPartControls(0).lfoRate, 20 * 64 / 127);
    input.send(0xb0, 17, 127); input.send(0xb0, 18, 127); input.send(0xb0, 19, 127);
    assert.equal(performance.getPartControls(0).amDepth, 1);
    assert.equal(performance.getPartControls(0).pmDepth, 1200);
    assert.deepEqual(performance.getPartControls(0).operatorFrequencies, [20000, null, null, null]);
    input.send(0xb0, 20, 0);
    assert.equal(updates.at(-1)!.pitch, -48);
    assert.equal(updates.at(-1)!.glide, 0.1);
    input.send(0xb0, 20, 127);
    assert.equal(updates.at(-1)!.pitch, 48);
    input.send(0xb0, 11, 64);
    assert.equal(performance.getPart(0).expression, 64 / 127, 'an unmapped default remains available');
    input.send(0xb1, 1, 0);
    assert.equal(performance.getPartControls(1).feedback, 0);
    assert.equal(performance.getPartControls(0).feedback, 7, 'channel controls stay part-local');
    renderFrames(opm, 2048);
    assert.deepEqual(errors, []);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('CC121 restores mapped baselines for active and future notes, preserving unrelated operators', async () => {
  const opm = await startedEngine();
  const performance = createPerformance(opm);
  const access = new FakeAccess();
  const input = new FakeInput('keys');
  access.inputs.set(input.id, input);
  performance.updatePartNotes(0, { feedback: 2, operatorRatios: [2, 3, 4, 5] });
  const baseline = performance.getPartControls(0);
  const adapter = createMidiAdapter(performance, access, { controllerMap: [
    { controller: 16, field: 'feedback', min: 0, max: 7, ramp: 0.05 },
    { controller: 17, field: 'operatorRatios', operator: 0, min: 1, max: 8, ramp: 0.05 },
    { controller: 18, field: 'operatorFrequencies', operator: 2, min: 1, max: 1000, ramp: 0, reset: null },
    { controller: 19, field: 'lfoRate', min: 0, max: 20, ramp: 0, reset: 3 },
  ] });
  try {
    input.send(0x90, 60, 100);
    input.send(0xb0, 16, 127); input.send(0xb0, 17, 127); input.send(0xb0, 18, 127); input.send(0xb0, 19, 127);
    performance.updatePartNotes(0, { operatorRatios: [8, 6, 7, 8] });
    input.send(0xb0, 64, 127);
    input.send(0xb0, 121, 0);
    const reset = performance.getPartControls(0);
    assert.equal(reset.feedback, baseline.feedback);
    assert.deepEqual(reset.operatorRatios, [2, 6, 7, 8]);
    assert.equal(reset.operatorFrequencies![2], null);
    assert.equal(reset.lfoRate, 3);
    assert.equal(performance.getPart(0).sustain, false);
    const updates: NoteControls[] = [];
    const original = opm.updateNote.bind(opm);
    opm.updateNote = (id, controls, options) => { updates.push(controls); return original(id, controls, options); };
    input.send(0x90, 64, 100);
    assert.equal(updates.at(-1)!.feedback, 2);
    assert.deepEqual(updates.at(-1)!.operatorRatios, [2, 6, 7, 8]);
    renderFrames(opm, 1024);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('controller maps are bounded copied own data and reject invalid configuration before opening ports', async () => {
  const { opm, performance, adapter } = await setup();
  const access = new FakeAccess();
  const input = new FakeInput('keys');
  access.inputs.set(input.id, input);
  const valid = { controller: 16, field: 'feedback', min: 0, max: 7, ramp: 0.05 };
  let calls = 0;
  try {
    const accessor = { ...valid };
    Object.defineProperty(accessor, 'min', { get() { calls++; return 0; } });
    const arrayAccessor = [valid];
    Object.defineProperty(arrayAccessor, '0', { get() { calls++; return valid; } });
    const malformed = [
      [accessor], arrayAccessor, new Array(1), Object.assign([valid], { extra: true }),
      Object.assign([valid], { [Symbol.iterator]() { calls++; return [valid][Symbol.iterator](); } }),
      [{ ...valid, field: 'operatorRatios' }], [{ ...valid, field: 'operatorRatios', operator: 4 }],
      [{ ...valid, operator: 0 }], [{ ...valid, field: 'operatorADSR' }], [{ ...valid, field: 'glide' }],
      [{ ...valid, min: -1 }], [{ ...valid, max: 8 }], [{ ...valid, min: 5, max: 4 }],
      [{ ...valid, ramp: -1 }], [{ ...valid, ramp: 11 }], [{ ...valid, ramp: NaN }],
      [{ ...valid, min: Infinity }], [{ ...valid, reset: null }], [{ ...valid, reset: 8 }],
      [{ ...valid, reset: undefined }], [{ ...valid, extra: true }], [{ ...valid, controller: 128 }],
      [{ ...valid, controller: -1 }], [{ ...valid, controller: 1.5 }],
      [valid, valid], [valid, { ...valid, controller: 17 }], Array.from({ length: 129 }, () => valid),
      ...[64, 120, 121, 123].map(controller => [{ ...valid, controller }]),
    ];
    for (const controllerMap of malformed) {
      assert.throws(() => createMidiAdapter(performance, access, { controllerMap } as never));
      assert.equal(input.opened, 0);
      assert.equal(input.listeners.size, 0);
      assert.equal(access.listening, 0);
    }
    assert.equal(calls, 0);
    const controllerMap = [{ ...valid }];
    const custom = createMidiAdapter(performance, access, { controllerMap } as MidiAdapterOptions);
    controllerMap[0]!.max = 1;
    controllerMap[0]!.controller = 17;
    controllerMap.length = 0;
    input.send(0xb0, 16, 127);
    assert.equal(performance.getPartControls(0).feedback, 7);
    custom.dispose();
    const empty = createMidiAdapter(performance, access, { controllerMap: [] });
    input.send(0xb0, 1, 127);
    assert.equal(performance.getPartControls(0).modulation, 2, 'empty map preserves default mappings');
    empty.dispose();
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('a mapped expression ramp produces the same worklet PCM as direct controls, then reaches silence', async () => {
  async function audio(mapped: boolean): Promise<number[]> {
    const { opm, performance, input, adapter, errors } = await setup({
      controllerMap: [{ controller: 16, field: 'expression', min: 0, max: 1, ramp: 0.05 }],
    });
    try {
      input.send(0x90, 60, 100);
      renderFrames(opm, 2048);
      if (mapped) input.send(0xb0, 16, 0);
      else performance.updatePartNotes(0, { expression: 0, ramp: 0.05 });
      const node = opm.node as unknown as { processor: { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean } };
      const processor = node.processor;
      const original = processor.process.bind(processor);
      const samples: number[] = [];
      processor.process = (inputs, outputs) => {
        const result = original(inputs, outputs);
        samples.push(...outputs[0]![0]!);
        return result;
      };
      renderFrames(opm, 1536);
      assert.deepEqual(errors, []);
      return samples;
    } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
  }
  const mapped = await audio(true);
  assert.deepEqual(mapped, await audio(false));
  assert.ok(mapped.slice(0, 128).some(value => value !== 0), 'ramp does not mute immediately');
  assert.ok(mapped.slice(1024).every(value => value === 0), 'ramp completes at the requested zero target');
});

test('scalar expression, gain, pan and modulation mappings accept both engine endpoints', async () => {
  const { opm, performance, input, adapter, errors } = await setup({ controllerMap: [
    { controller: 16, field: 'expression', min: 0, max: 1, ramp: 0 },
    { controller: 17, field: 'gain', min: 0, max: 1, ramp: 0 },
    { controller: 18, field: 'pan', min: -1, max: 1, ramp: 0 },
    { controller: 19, field: 'modulation', min: 0, max: 2, ramp: 0 },
  ] });
  try {
    input.send(0x90, 60, 100);
    for (const [controller, field, min, max] of [
      [16, 'expression', 0, 1], [17, 'gain', 0, 1], [18, 'pan', -1, 1], [19, 'modulation', 0, 2],
    ] as const) {
      input.send(0xb0, controller, 0);
      assert.equal(performance.getPartControls(0)[field], min);
      input.send(0xb0, controller, 127);
      assert.equal(performance.getPartControls(0)[field], max);
    }
    renderFrames(opm, 256);
    assert.deepEqual(errors, []);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});

test('omitting controllerMap preserves default pan, pressure, wheel and reset actions', async () => {
  const { opm, performance, input, adapter, errors } = await setup();
  try {
    input.send(0x90, 60, 100);
    input.send(0xb0, 10, 0);
    assert.equal(performance.getPart(0).pan, -1);
    input.send(0xb0, 10, 127);
    assert.equal(performance.getPart(0).pan, 1);
    input.send(0xd0, 127);
    assert.equal(performance.getPartControls(0).modulation, 2);
    input.send(0xb0, 1, 0);
    assert.equal(performance.getPartControls(0).modulation, 1);
    const updates: NoteControls[] = [];
    const original = opm.updateNote.bind(opm);
    opm.updateNote = (id, controls, options) => { updates.push(controls); return original(id, controls, options); };
    input.send(0xa0, 60, 127);
    assert.equal(updates.at(-1)!.modulation, 2);
    assert.equal(performance.getPartControls(0).modulation, 1, 'poly pressure remains per-key');
    input.send(0xb0, 7, 0);
    input.send(0xe0, 127, 127);
    input.send(0xb0, 121, 0);
    assert.equal(performance.getPart(0).expression, 1);
    assert.equal(performance.getPart(0).pan, 0);
    assert.equal(performance.getPartControls(0).pitch, 0);
    assert.equal(performance.getPartControls(0).modulation, 1);
    renderFrames(opm, 256);
    assert.deepEqual(errors, []);
  } finally { adapter.dispose(); performance.dispose(); await opm.dispose(); }
});
