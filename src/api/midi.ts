import type { Performance } from './performance.js';
import { sequenceOwnData } from '../core/sequence.js';
import { transportArray } from '../core/transport.js';

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
  /** Restrict to these stable port IDs; default every currently and subsequently connected input. */
  inputIds?: readonly string[];
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

interface Owned { part: number; key: number }
interface PartState { volume: number; expression: number }

const MAX_INPUTS = 32;
const MAX_HELD = 128;

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
 * no SysEx, clock, program-change or hardware-specific behavior is implemented.
 *
 * Note-off releases the oldest still-held key of the same input/channel/pitch. CC1, channel pressure and polyphonic
 * pressure all scale LFO depth 1x..2x (never below the patch default). CC7/CC11 multiply into part expression, CC10 pans,
 * CC64 is sustain, CC120/123 release only this adapter's keys for the channel, and CC121 resets its controllers.
 */
export function createMidiAdapter(performance: Performance, access: MidiAccessLike, options: MidiAdapterOptions = {}): MidiAdapter {
  const config = sequenceOwnData(options, ['parts', 'pitchBendRange', 'inputIds', 'onError'], [], 'MIDI adapter options');
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
  if (!access || typeof access.addEventListener !== 'function' || !(access.inputs instanceof Map || typeof access.inputs?.values === 'function')) {
    throw new TypeError('access must provide inputs and statechange events');
  }

  const listeners = new Map<string, { input: MidiInputLike; listener: (event: MidiMessageEventLike) => void }>();
  // key: input\u0000channel\u0000note; each pitch keeps its held key IDs in press order.
  const held = new Map<string, Owned[]>();
  const sustained = new Map<string, Set<number>>();
  const states: PartState[] = Array.from({ length: parts }, () => ({ volume: 1, expression: 1 }));
  let heldKeys = 0;
  let ignored = 0;
  let disposed = false;

  function report(error: unknown): void {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }
  function release(owned: Owned): void {
    try { performance.noteOff(owned.part, owned.key); } catch (error) { report(error); }
  }
  function releaseWhere(predicate: (key: string) => boolean): void {
    for (const [key, owners] of held) {
      if (!predicate(key)) continue;
      held.delete(key);
      for (const owned of owners) { heldKeys--; release(owned); }
    }
  }
  function control(channel: number, input: string, controller: number, value: number): void {
    const state = states[channel]!;
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
    else if (controller === 120 || controller === 123) releaseWhere(key => key.startsWith(`${input}\u0000${channel}\u0000`));
    else if (controller === 121) {
      state.volume = 1; state.expression = 1;
      performance.updatePart(channel, { expression: 1, pan: 0 });
      performance.updatePartNotes(channel, { pitch: 0, modulation: 1 });
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
        const id = performance.noteOn(channel, data[1]!, { velocity: data[2]! / 127 });
        const key = `${input}\u0000${channel}\u0000${data[1]}`;
        const owners = held.get(key) ?? [];
        owners.push({ part: channel, key: id });
        held.set(key, owners);
        heldKeys++;
      } else if (status === 0xa0) {
        const owners = held.get(`${input}\u0000${channel}\u0000${data[1]}`);
        const owned = owners?.[owners.length - 1];
        if (owned) performance.updateKey(channel, owned.key, { modulation: 1 + data[2]! / 127 });
      } else if (status === 0xb0) control(channel, input, data[1]!, data[2]!);
      else if (status === 0xd0) performance.updatePartNotes(channel, { modulation: 1 + data[1]! / 127 });
      else if (status === 0xe0) {
        const bend = ((data[2]! << 7) | data[1]!) - 8192;
        performance.updatePartNotes(channel, { pitch: Math.max(-range, Math.min(range, bend / (bend < 0 ? 8192 : 8191) * range)) });
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
    },
  });
}
