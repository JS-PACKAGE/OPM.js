import type { Performance } from './performance.js';
import { sequenceOwnData } from '../core/sequence.js';
import { transportArray } from '../core/transport.js';
import { validateNoteControls } from '../core/synth.js';
import type { NoteControls } from '../core/synth.js';
import { midiVoiceMap, midiRpnState, midiRpnControl } from '../core/midi-state.js';
import type { MidiVoiceMap } from '../core/midi-state.js';

export type MidiScalarControl = 'pitch' | 'expression' | 'gain' | 'pan' | 'modulation' | 'feedback' | 'lfoRate' | 'amDepth' | 'pmDepth';
export type MidiOperatorControl = 'operatorLevels' | 'operatorRatios' | 'operatorFrequencies';
interface MidiControllerRange {
  /** CC number 0..127, excluding RPN selection/pedal/reset/panic CC64/100/101/120/121/123. */
  controller: number;
  /** CC0 maps to min and CC127 to max; both endpoints must be valid engine controls. */
  min: number;
  max: number;
  /** Seconds 0..10; pitch uses glide, other fields use the engine control ramp. */
  ramp: number;
}
/** One CC targets one scalar or one operator element; no executable callbacks are accepted. */
export type MidiControllerMapping = MidiControllerRange & (
  { field: MidiScalarControl; reset?: number } |
  { field: MidiOperatorControl; operator: 0 | 1 | 2 | 3; reset?: number | null }
);

/** Structural subset of Web MIDI, so hosts and tests can inject a real or simulated access object. */
export interface MidiMessageEventLike { readonly data: Uint8Array | null }
export interface MidiInputLike {
  readonly id: string;
  readonly name?: string | null;
  readonly state?: string;
  readonly connection?: string;
  open?(): Promise<unknown>;
  addEventListener(type: 'midimessage', listener: (event: MidiMessageEventLike) => void): void;
  removeEventListener(type: 'midimessage', listener: (event: MidiMessageEventLike) => void): void;
}
export interface MidiAccessLike {
  readonly inputs: ReadonlyMap<string, MidiInputLike>;
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}
export interface MidiNavigatorLike { requestMIDIAccess?(options?: { sysex?: boolean; software?: boolean }): Promise<MidiAccessLike> }

export interface MidiAdapterOptions {
  /** Channels 1..16 map to zero-based Performance parts below this count; default 16. */
  parts?: number;
  /** Semitones for full pitch-bend deflection, 0..48; default 2. */
  pitchBendRange?: number;
  /** Opt-in program 0..127 to named voice selection for later note onsets. */
  programVoices?: MidiVoiceMap;
  /** Restrict to these stable port IDs; default every currently and subsequently connected input. */
  inputIds?: readonly string[];
  /** At most 128 own-data mappings. Ordinary CC defaults are overridden only for listed CCs. */
  controllerMap?: readonly MidiControllerMapping[];
  onError?: (error: Error) => void;
}
export interface MidiAdapterSnapshot {
  readonly inputs: readonly string[];
  readonly heldKeys: number;
  /** Messages outside the supported channel-voice subset or malformed packets. */
  readonly ignoredMessages: number;
  readonly disposed: boolean;
}
export interface MidiAdapter {
  readonly snapshot: MidiAdapterSnapshot;
  /** Releases only keys owned by this adapter; unrelated Performance parts and host notes stay untouched. */
  releaseAll(): void;
  dispose(): void;
}

interface Owned { part: number; key: number; slot: string }
interface PartState { volume: number; expression: number }

const MAX_INPUTS = 32;
const MAX_HELD = 128;
const MAX_OWNED = 256;
const FORCE_RELEASE = Object.freeze({ force: true });
const SCALAR_FIELDS: readonly string[] = ['pitch', 'expression', 'gain', 'pan', 'modulation', 'feedback', 'lfoRate', 'amDepth', 'pmDepth'];
const OPERATOR_FIELDS: readonly string[] = ['operatorLevels', 'operatorRatios', 'operatorFrequencies'];
type ControllerMapping = {
  controller: number; field: MidiScalarControl | MidiOperatorControl; operator?: number;
  min: number; max: number; ramp: number; reset?: number | null;
};

function mappingControls(mapping: ControllerMapping, value: number | null, baseline?: Readonly<NoteControls>): NoteControls {
  if (mapping.operator !== undefined) {
    const field = mapping.field as MidiOperatorControl;
    const neutral = field === 'operatorRatios' ? 1 : field === 'operatorFrequencies' ? null : 1;
    const tuple = [...(baseline?.[field] ?? [neutral, neutral, neutral, neutral])];
    tuple[mapping.operator] = value;
    return validateNoteControls({ [field]: tuple, ramp: mapping.ramp });
  }
  return validateNoteControls(mapping.field === 'pitch'
    ? { pitch: value as number, glide: mapping.ramp }
    : { [mapping.field]: value, ramp: mapping.ramp });
}

function controllerMappings(input: unknown): ReadonlyMap<number, ControllerMapping> {
  const result = new Map<number, ControllerMapping>();
  const targets = new Set<string>();
  for (const entry of transportArray(input, 128, 'controllerMap')) {
    const data = sequenceOwnData(entry, ['controller', 'field', 'operator', 'min', 'max', 'ramp', 'reset'],
      ['controller', 'field', 'min', 'max', 'ramp'], 'controller mapping');
    if (typeof data.controller !== 'number' || !Number.isInteger(data.controller) || data.controller < 0 || data.controller > 127 ||
        [64, 100, 101, 120, 121, 123].includes(data.controller)) throw new RangeError('controller must be 0..127 excluding CC64/100/101/120/121/123');
    if (typeof data.field !== 'string' || !SCALAR_FIELDS.includes(data.field) && !OPERATOR_FIELDS.includes(data.field)) {
      throw new TypeError('unsupported controller field');
    }
    if (OPERATOR_FIELDS.includes(data.field)) {
      if (typeof data.operator !== 'number' || !Number.isInteger(data.operator) || data.operator < 0 || data.operator > 3) {
        throw new RangeError('operator must be an integer in 0..3');
      }
    } else if (Object.hasOwn(data, 'operator')) throw new TypeError('scalar mappings must not specify operator');
    if (typeof data.min !== 'number' || typeof data.max !== 'number' || !Number.isFinite(data.min) || !Number.isFinite(data.max) || data.min > data.max) {
      throw new RangeError('mapping min/max must be finite and ordered');
    }
    const mapping: ControllerMapping = {
      controller: data.controller, field: data.field as ControllerMapping['field'],
      min: data.min, max: data.max, ramp: data.ramp as number,
      ...(data.operator === undefined ? {} : { operator: data.operator as number }),
      ...(Object.hasOwn(data, 'reset') ? { reset: data.reset as number | null } : {}),
    };
    mappingControls(mapping, mapping.min);
    mappingControls(mapping, mapping.max);
    if (Object.hasOwn(mapping, 'reset')) mappingControls(mapping, mapping.reset!);
    const target = `${mapping.field}:${mapping.operator ?? ''}`;
    if (result.has(mapping.controller) || targets.has(target)) throw new RangeError('duplicate controller or mapping target');
    targets.add(target);
    result.set(mapping.controller, Object.freeze(mapping));
  }
  return result;
}

// Web MIDI is optional and the public type deliberately avoids depending on the DOM lib's MIDI declarations.
const ambient: { navigator?: MidiNavigatorLike } = globalThis;

/**
 * Request MIDI access without SysEx. Call from an explicit user action; browsers may show a permission prompt.
 * Importing this module never requests access.
 */
export async function requestMidiAccess(host: MidiNavigatorLike | undefined = ambient.navigator): Promise<MidiAccessLike> {
  if (globalThis.isSecureContext === false) throw new Error('Web MIDI requires a secure context');
  if (!host || typeof host.requestMIDIAccess !== 'function') throw new Error('Web MIDI is not available in this browser');
  return host.requestMIDIAccess({ sysex: false, software: false });
}

/**
 * Map channel-voice MIDI from user-granted inputs onto Performance parts. It is an adapter, not a MIDI driver:
 * no SysEx, clock or hardware-specific behavior is implemented.
 *
 * Note-off releases the oldest still-held key of the same input/channel/pitch. CC1, channel pressure and polyphonic
 * pressure all scale LFO depth 1x..2x (never below the patch default). CC7/CC11 multiply into part expression, CC10 pans,
 * CC64 is sustain, CC120/123 release only this adapter's keys for the channel, and CC121 resets its controllers.
 */
export function createMidiAdapter(performance: Performance, access: MidiAccessLike, options: MidiAdapterOptions = {}): MidiAdapter {
  const config = sequenceOwnData(options, ['parts', 'pitchBendRange', 'programVoices', 'inputIds', 'controllerMap', 'onError'], [], 'MIDI adapter options');
  const rawParts: unknown = config.parts === undefined ? 16 : config.parts;
  if (typeof rawParts !== 'number' || !Number.isInteger(rawParts) || rawParts < 1 || rawParts > 16) throw new RangeError('parts must be an integer in 1..16');
  const parts: number = rawParts;
  const rawRange: unknown = config.pitchBendRange === undefined ? 2 : config.pitchBendRange;
  if (typeof rawRange !== 'number' || !Number.isFinite(rawRange) || rawRange < 0 || rawRange > 48) throw new RangeError('pitchBendRange must be finite in 0..48');
  const range: number = rawRange;
  if (config.onError !== undefined && typeof config.onError !== 'function') throw new TypeError('onError must be a function');
  const onError = config.onError as ((error: Error) => void) | undefined;
  let allowed: Set<string> | undefined;
  if (config.inputIds !== undefined) {
    const ids = transportArray(config.inputIds, MAX_INPUTS, 'inputIds');
    if (ids.some(id => typeof id !== 'string' || id.length === 0 || id.length > 256)) {
      throw new TypeError('inputIds must be at most 32 nonempty strings');
    }
    allowed = new Set(ids as string[]);
  }
  const mappings = config.controllerMap === undefined ? new Map<number, ControllerMapping>() : controllerMappings(config.controllerMap);
  const programs = midiVoiceMap(config.programVoices);
  const rpn = Array.from({ length: parts }, () => midiRpnState(range));
  // Capture the defined reset baseline before ports can deliver any messages.
  const baselines = mappings.size === 0 ? [] : Array.from({ length: parts }, (_, channel) => performance.getPartControls(channel));
  if (!access || typeof access.addEventListener !== 'function' || !(access.inputs instanceof Map || typeof access.inputs?.values === 'function')) {
    throw new TypeError('access must provide inputs and statechange events');
  }

  const listeners = new Map<string, { input: MidiInputLike; listener: (event: MidiMessageEventLike) => void }>();
  // key: input\u0000channel\u0000note; each pitch keeps its held key IDs in press order.
  const held = new Map<string, Owned[]>();
  const ownedKeys = new Map<number, Owned>();
  const sustained = new Map<string, Set<number>>();
  const states: PartState[] = Array.from({ length: parts }, () => ({ volume: 1, expression: 1 }));
  let heldKeys = 0;
  let ignored = 0;
  let disposed = false;

  function report(error: unknown): void {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }
  function release(owned: Owned, force = false): void {
    try {
      performance.noteOff(owned.part, owned.key, force ? FORCE_RELEASE : undefined);
      if (force) ownedKeys.delete(owned.key);
    } catch (error) { report(error); }
  }
  function pruneOwnership(): void {
    if (ownedKeys.size === 0) return;
    const live = new Set<number>();
    try {
      for (let channel = 0; channel < parts; channel++) {
        for (const key of performance.getPart(channel).keys) live.add(key.key);
      }
    } catch (error) { report(error); return; }
    for (const key of ownedKeys.keys()) if (!live.has(key)) ownedKeys.delete(key);
  }
  function releaseWhere(predicate: (key: string) => boolean, force = true): void {
    if (force) pruneOwnership();
    for (const [key, owners] of held) {
      if (!predicate(key)) continue;
      held.delete(key);
      for (const owned of owners) { heldKeys--; if (!force) release(owned); }
    }
    if (force) for (const owned of ownedKeys.values()) {
      if (predicate(owned.slot)) release(owned, true);
    }
  }
  function control(channel: number, input: string, controller: number, value: number): void {
    const state = states[channel]!;
    if (midiRpnControl(rpn[channel]!, controller, value)) return;
    const mapping = mappings.get(controller);
    if (mapping) {
      const target = value === 0 ? mapping.min : value === 127 ? mapping.max : mapping.min + (mapping.max - mapping.min) * value / 127;
      performance.updatePartNotes(channel, mappingControls(mapping, target,
        mapping.operator === undefined ? undefined : performance.getPartControls(channel)));
      return;
    }
    if (controller === 64) {
      const owners = sustained.get(input) ?? new Set<number>();
      if (value >= 64) owners.add(channel); else owners.delete(channel);
      sustained.set(input, owners);
      // One physical pedal state is the union over adapter inputs for the part.
      const on = [...sustained.values()].some(set => set.has(channel));
      performance.sustain(channel, on);
    } else if (controller === 1) performance.updatePartNotes(channel, { modulation: 1 + value / 127 });
    else if (controller === 7 || controller === 11) {
      if (controller === 7) state.volume = value / 127; else state.expression = value / 127;
      performance.updatePart(channel, { expression: state.volume * state.expression });
    } else if (controller === 10) performance.updatePart(channel, { pan: Math.max(-1, (value - 64) / 63) });
    else if (controller === 120 || controller === 123) releaseWhere(key => key.startsWith(`${input}\u0000${channel}\u0000`), controller === 120);
    else if (controller === 121) {
      state.volume = 1; state.expression = 1;
      Object.assign(rpn[channel]!, midiRpnState(range));
      performance.updatePart(channel, { expression: 1, pan: 0 });
      performance.updatePartNotes(channel, { pitch: 0, modulation: 1 });
      for (const mapped of mappings.values()) {
        const baseline = baselines[channel]!;
        const initial = mapped.operator === undefined ? baseline[mapped.field as MidiScalarControl]!
          : baseline[mapped.field as MidiOperatorControl]![mapped.operator]!;
        performance.updatePartNotes(channel, mappingControls(mapped, Object.hasOwn(mapped, 'reset') ? mapped.reset! : initial,
          mapped.operator === undefined ? undefined : performance.getPartControls(channel)));
      }
      sustained.get(input)?.delete(channel);
      performance.sustain(channel, [...sustained.values()].some(set => set.has(channel)));
    } else ignored++;
  }
  function receive(input: string, data: Uint8Array | null): void {
    if (disposed) return;
    try {
      if (!(data instanceof Uint8Array) || data.length < 1 || data.length > 3 || data[0]! < 0x80 || data[0]! >= 0xf0) { ignored++; return; }
      const status = data[0]! & 0xf0;
      const channel = data[0]! & 0x0f;
      const one = status === 0xc0 || status === 0xd0 ? 2 : 3;
      if (data.length !== one || data.subarray(1).some(byte => byte > 0x7f)) { ignored++; return; }
      if (channel >= parts) { ignored++; return; }
      if (status === 0x80 || status === 0x90 && data[2] === 0) {
        const key = `${input}\u0000${channel}\u0000${data[1]}`;
        const owners = held.get(key);
        const owned = owners?.shift();
        if (!owners || !owned) return;
        if (owners.length === 0) held.delete(key);
        heldKeys--;
        release(owned);
      } else if (status === 0x90) {
        if (heldKeys >= MAX_HELD) throw new RangeError('MIDI adapter held-key capacity exceeded');
        if (ownedKeys.size >= MAX_OWNED) pruneOwnership();
        if (ownedKeys.size >= MAX_OWNED) throw new RangeError('MIDI adapter owned-key capacity exceeded');
        const id = performance.noteOn(channel, data[1]!, { velocity: data[2]! / 127 });
        const key = `${input}\u0000${channel}\u0000${data[1]}`;
        const owners = held.get(key) ?? [];
        const owned = { part: channel, key: id, slot: key };
        owners.push(owned);
        ownedKeys.set(id, owned);
        held.set(key, owners);
        heldKeys++;
      } else if (status === 0xa0) {
        const owners = held.get(`${input}\u0000${channel}\u0000${data[1]}`);
        const owned = owners?.[owners.length - 1];
        if (owned) performance.updateKey(channel, owned.key, { modulation: 1 + data[2]! / 127 });
      } else if (status === 0xb0) control(channel, input, data[1]!, data[2]!);
      else if (status === 0xc0) {
        const voice = programs.get(data[1]!);
        if (voice === undefined) ignored++;
        else performance.configurePart(channel, { voice }, { preserveNotes: true });
      }
      else if (status === 0xd0) performance.updatePartNotes(channel, { modulation: 1 + data[1]! / 127 });
      else if (status === 0xe0) {
        const bend = ((data[2]! << 7) | data[1]!) - 8192;
        const channelRange = rpn[channel]!.range;
        performance.updatePartNotes(channel, { pitch: bend / (bend < 0 ? 8192 : 8191) * channelRange });
      } else ignored++;
    } catch (error) { report(error); }
  }
  function attach(input: MidiInputLike): void {
    if (listeners.has(input.id) || allowed && !allowed.has(input.id) || input.state === 'disconnected') return;
    if (listeners.size >= MAX_INPUTS) { report(new RangeError('MIDI adapter input capacity exceeded')); return; }
    const listener = (event: MidiMessageEventLike) => receive(input.id, event.data);
    listeners.set(input.id, { input, listener });
    input.addEventListener('midimessage', listener);
    // Some implementations require an explicit open for listener-based delivery.
    try { void input.open?.().catch(report); } catch (error) { report(error); }
  }
  function detach(id: string): void {
    const entry = listeners.get(id);
    if (!entry) return;
    listeners.delete(id);
    entry.input.removeEventListener('midimessage', entry.listener);
    releaseWhere(key => key.startsWith(`${id}\u0000`));
    const channels = sustained.get(id);
    sustained.delete(id);
    if (channels) for (const channel of channels) {
      try { performance.sustain(channel, [...sustained.values()].some(set => set.has(channel))); } catch (error) { report(error); }
    }
  }
  function refresh(): void {
    if (disposed) return;
    const live = new Set<string>();
    for (const input of access.inputs.values()) {
      if (input.state === 'disconnected') continue;
      live.add(input.id);
      attach(input);
    }
    // A removed or disconnected port must not leave notes hanging.
    for (const id of [...listeners.keys()]) if (!live.has(id)) detach(id);
  }
  access.addEventListener('statechange', refresh);
  refresh();

  return Object.freeze({
    get snapshot(): MidiAdapterSnapshot {
      return Object.freeze({ inputs: Object.freeze([...listeners.keys()]), heldKeys, ignoredMessages: ignored, disposed });
    },
    releaseAll() { releaseWhere(() => true); },
    dispose() {
      if (disposed) return;
      disposed = true;
      access.removeEventListener('statechange', refresh);
      for (const id of [...listeners.keys()]) detach(id);
      held.clear();
      heldKeys = 0;
      for (const state of rpn) Object.assign(state, midiRpnState(range));
    },
  });
}
