import type { OPM, OPMEvent } from './index.js';
import { prepareVoice } from '../voices/normalize.js';
import type { PreparedVoice, VoiceInput } from '../voices/schema.js';
import { sequenceOwnData } from '../core/sequence.js';

export interface PerformanceOptions {
  /** Zero-based part count, 1..16; default 16. */
  parts?: number;
  /** Total physical/pedal key records, 1..128; default 128. */
  maxKeys?: number;
  /** Per-part key records, 1..128; default 128, also subject to maxKeys. */
  maxKeysPerPart?: number;
  /** Event-driven cleanup failures; synchronous operation failures still throw. */
  onError?: (error: Error) => void;
}
export interface PerformancePartControls { glide?: number; pan?: number; expression?: number }
export interface PerformancePartOptions extends PerformancePartControls {
  voice: string | VoiceInput;
  mode: 'poly' | 'mono';
  legato: boolean;
  priority: 'last' | 'high' | 'low';
}
export interface PerformanceNoteOptions { velocity?: number }
export interface PerformanceKeySnapshot {
  readonly key: number;
  readonly note: number;
  readonly velocity: number;
  readonly held: boolean;
  /** Only the currently sounding mono key owns its shared gate. */
  readonly gateId: number | null;
}
export interface PerformancePartSnapshot {
  readonly voice: string | PreparedVoice;
  readonly mode: 'poly' | 'mono';
  readonly legato: boolean;
  readonly priority: 'last' | 'high' | 'low';
  readonly glide: number;
  readonly pan: number;
  readonly expression: number;
  readonly sustain: boolean;
  readonly selectedKey: number | null;
  readonly keys: readonly PerformanceKeySnapshot[];
}
export interface Performance {
  configurePart(part: number, options: Partial<PerformancePartOptions>): void;
  updatePart(part: number, controls: PerformancePartControls): void;
  /** Independent key identity, not an OPM admission receipt. OPM must already be started. */
  noteOn(part: number, note: number, options?: PerformanceNoteOptions): number;
  noteOff(part: number, key: number): boolean;
  sustain(part: number, on: boolean): void;
  allNotesOff(part?: number): void;
  getPart(part: number): PerformancePartSnapshot;
  dispose(): void;
}
interface Key { key: number; note: number; velocity: number; held: boolean; gateId: number | null }
interface Config {
  voice: string | PreparedVoice; mode: 'poly' | 'mono'; legato: boolean;
  priority: 'last' | 'high' | 'low'; glide: number; pan: number; expression: number;
}
interface Part { config: Config; keys: Map<number, Key>; sustain: boolean; selected: number | null }
interface Gate { part: Part; anchor: number; key: number | null; releasing: boolean }

function number(input: unknown, min: number, max: number, label: string, integer = false): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max || integer && !Number.isInteger(input)) {
    throw new RangeError(`${label} must be ${integer ? 'an integer' : 'finite'} in ${min}..${max}`);
  }
  return input;
}

/** Device-agnostic key policy. No context, timers, MIDI driver or global panic is created. */
export function createPerformance(opm: OPM, options: PerformanceOptions = {}): Performance {
  const raw = sequenceOwnData(options, ['parts', 'maxKeys', 'maxKeysPerPart', 'onError'], [], 'performance options');
  const count = number(raw.parts === undefined ? 16 : raw.parts, 1, 16, 'parts', true);
  const maxKeys = number(raw.maxKeys === undefined ? 128 : raw.maxKeys, 1, 128, 'maxKeys', true);
  const perPart = number(raw.maxKeysPerPart === undefined ? 128 : raw.maxKeysPerPart, 1, 128, 'maxKeysPerPart', true);
  if (raw.onError !== undefined && typeof raw.onError !== 'function') throw new TypeError('onError must be a function');
  const onError = raw.onError as ((error: Error) => void) | undefined;
  const parts: Part[] = Array.from({ length: count }, () => ({
    config: { voice: 'brass', mode: 'poly', legato: false, priority: 'last', glide: 0, pan: 0, expression: 1 },
    keys: new Map(), sustain: false, selected: null,
  }));
  const gates = new Map<number, Gate>();
  let totalKeys = 0;
  let nextKey = 1;
  let disposed = false;
  let epoch = 0;
  let admitting = false;
  const admissionTerminals = new Set<number>();
  let admissionOverflow = false;

  function part(index: number): Part {
    if (disposed) throw new Error('Performance is disposed');
    return parts[number(index, 0, count - 1, 'part', true)]!;
  }
  function removeKey(p: Part, key: number): void {
    if (p.keys.delete(key)) totalKeys--;
    if (p.selected === key) p.selected = null;
  }
  function selected(p: Part, extra?: Key): Key | undefined {
    let result: Key | undefined;
    function consider(key: Key): void {
      // Pedal-only keys never override a physically held key.
      if (!result || key.held && !result.held || key.held === result.held &&
          (p.config.priority === 'last' ? key.key > result.key : p.config.priority === 'high' ?
            key.note > result.note || key.note === result.note && key.key > result.key :
            key.note < result.note || key.note === result.note && key.key > result.key)) result = key;
    }
    for (const key of p.keys.values()) consider(key);
    if (extra) consider(extra);
    return result;
  }
  function current(p: Part): [number, Gate] | undefined {
    for (const entry of gates) if (entry[1].part === p && !entry[1].releasing) return entry;
    return undefined;
  }
  function needsGate(p: Part, target: Key | undefined): boolean {
    if (!target) return false;
    const old = current(p);
    if (old?.[1].key === target.key) return false;
    return !old || !p.config.legato || Math.abs(target.note - old[1].anchor) > 48;
  }
  function capacity(p: Part, target: Key | undefined): void {
    if (needsGate(p, target) && gates.size >= 128) throw new RangeError('Performance gate capacity exceeded; wait for release tails');
  }
  function release(id: number, gate: Gate): void {
    // Mark first: a synchronous processor may emit cancellation during stop().
    gate.releasing = true;
    const key = gate.key === null ? undefined : gate.part.keys.get(gate.key);
    if (key?.gateId === id) key.gateId = null;
    gate.key = null;
    opm.stop(id);
  }
  function admit(p: Part, key: Key): number | null {
    if (admitting) throw new Error('Performance admission cannot be reentered');
    if (gates.size >= 128) throw new RangeError('Performance gate capacity exceeded; wait for release tails');
    const generation = epoch;
    admitting = true;
    admissionTerminals.clear();
    admissionOverflow = false;
    let id: number;
    try { id = opm.playNote({ voice: p.config.voice, note: key.note, velocity: key.velocity, pan: p.config.pan }); }
    finally { admitting = false; }
    const terminal = admissionTerminals.has(id);
    admissionTerminals.clear();
    if (generation !== epoch || disposed || !p.keys.has(key.key) || admissionOverflow) {
      removeKey(p, key.key);
      opm.stop(id);
      return null;
    }
    if (terminal) { removeKey(p, key.key); return null; }
    gates.set(id, { part: p, anchor: key.note, key: key.key, releasing: false });
    key.gateId = id;
    try { opm.updateNote(id, { expression: p.config.expression }); }
    catch (error) {
      const gate = gates.get(id);
      if (gate) release(id, gate);
      removeKey(p, key.key);
      throw error;
    }
    return gates.get(id)?.releasing === false ? id : null;
  }
  function retarget(p: Part): void {
    const target = selected(p);
    const old = current(p);
    if (old?.[1].key === target?.key) { p.selected = target?.key ?? null; return; }
    if (!target) {
      p.selected = null;
      if (old) release(...old);
      return;
    }
    try { capacity(p, target); }
    catch (error) {
      p.selected = null;
      if (old) release(...old);
      throw error;
    }
    if (old && p.config.legato && Math.abs(target.note - old[1].anchor) <= 48) {
      const generation = epoch;
      const previous = old[1].key === null ? undefined : p.keys.get(old[1].key);
      if (previous) previous.gateId = null;
      old[1].key = target.key;
      target.gateId = old[0];
      try { opm.updateNote(old[0], { pitch: target.note - old[1].anchor, glide: p.config.glide }); }
      catch (error) { release(...old); removeKey(p, target.key); throw error; }
      if (generation !== epoch || old[1].releasing || !gates.has(old[0])) return;
      p.selected = target.key;
      return;
    }
    // Beyond the original gate's ±48 control range, restart at the exact target pitch.
    // A restart re-evaluates velocity/key/rate scaling; a held glide deliberately does not.
    const id = admit(p, target);
    if (old && gates.has(old[0])) release(...old);
    p.selected = id === null ? null : target.key;
  }
  function clear(p: Part, stop: boolean): unknown {
    totalKeys -= p.keys.size;
    p.keys.clear();
    p.sustain = false;
    p.selected = null;
    let failure: unknown;
    if (stop) for (const [id, gate] of gates) if (gate.part === p) {
      try { release(id, gate); } catch (error) { failure ??= error; }
    }
    return failure;
  }
  function observe(event: OPMEvent): void {
    if (event.type === 'reset') {
      epoch++;
      for (const p of parts) clear(p, false);
      gates.clear();
    } else if (event.type === 'context' && event.state !== 'running') {
      epoch++;
      for (const p of parts) {
        const failure = clear(p, true);
        if (failure !== undefined) onError?.(failure instanceof Error ? failure : new Error(String(failure)));
      }
    } else if (event.type === 'note' && ['ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) {
      if (admitting) {
        if (admissionTerminals.size < 256) admissionTerminals.add(event.id);
        else admissionOverflow = true;
      }
      const gate = gates.get(event.id);
      if (!gate) return;
      gates.delete(event.id);
      if (gate.key !== null) removeKey(gate.part, gate.key);
      // Do not auto-re-admit a stolen gate: that could fight another helper's allocation.
    } else if (event.type === 'command' && event.command === 'updateNote' && event.state === 'rejected' && event.id !== undefined) {
      const gate = gates.get(event.id);
      if (!gate) return;
      if (gate.key !== null) removeKey(gate.part, gate.key);
      try { release(event.id, gate); } catch (error) { onError?.(error instanceof Error ? error : new Error(String(error))); }
      onError?.(new Error(`Performance control rejected: ${event.reason ?? 'unspecified'}`));
    }
  }
  const unsubscribe = opm.subscribe(observe);

  function configure(p: Part, input: Record<string, unknown>): void {
    const config: Config = { ...p.config };
    if (Object.hasOwn(input, 'voice')) {
      if (typeof input.voice === 'string') {
        if (!opm.voices.has(input.voice)) throw new RangeError('Unknown performance voice');
        config.voice = input.voice;
      } else config.voice = prepareVoice(input.voice as VoiceInput);
    }
    if (Object.hasOwn(input, 'mode')) {
      if (input.mode !== 'poly' && input.mode !== 'mono') throw new TypeError('mode must be poly or mono');
      config.mode = input.mode;
    }
    if (Object.hasOwn(input, 'legato')) {
      if (typeof input.legato !== 'boolean') throw new TypeError('legato must be boolean');
      config.legato = input.legato;
    }
    if (Object.hasOwn(input, 'priority')) {
      if (input.priority !== 'last' && input.priority !== 'high' && input.priority !== 'low') throw new TypeError('priority must be last, high or low');
      config.priority = input.priority;
    }
    for (const name of ['glide', 'pan', 'expression'] as const) if (Object.hasOwn(input, name)) {
      config[name] = number(input[name], name === 'pan' ? -1 : 0, name === 'glide' ? 10 : 1, name);
    }
    if (config.voice !== p.config.voice || config.mode !== p.config.mode) {
      const failure = clear(p, true);
      if (failure !== undefined) throw failure;
    }
    const previous = p.config;
    p.config = config;
    try {
      if (config.mode === 'mono') retarget(p);
      if (config.pan !== previous.pan || config.expression !== previous.expression) {
        for (const [id, gate] of gates) if (gate.part === p) opm.updateNote(id, { pan: config.pan, expression: config.expression });
      }
    } catch (error) { p.config = previous; throw error; }
  }
  return {
    configurePart(index, input) { configure(part(index), sequenceOwnData(input, ['voice', 'mode', 'legato', 'priority', 'glide', 'pan', 'expression'], [], 'part options')); },
    updatePart(index, input) { configure(part(index), sequenceOwnData(input, ['glide', 'pan', 'expression'], [], 'part controls')); },
    noteOn(index, note, input = {}) {
      const p = part(index);
      if (admitting) throw new Error('Performance admission cannot be reentered');
      const rawNote = sequenceOwnData(input, ['velocity'], [], 'performance note');
      const pitch = number(note, 0, 127, 'note');
      const velocity = number(rawNote.velocity === undefined ? 1 : rawNote.velocity, 0, 1, 'velocity');
      if (totalKeys >= maxKeys || p.keys.size >= perPart) throw new RangeError('Performance key capacity exceeded');
      if (!Number.isSafeInteger(nextKey)) throw new RangeError('Performance key ID space exhausted');
      const key: Key = { key: nextKey, note: pitch, velocity, held: true, gateId: null };
      if (p.config.mode === 'poly') {
        if (gates.size >= 128) throw new RangeError('Performance gate capacity exceeded; wait for release tails');
      } else capacity(p, selected(p, key));
      p.keys.set(key.key, key);
      totalKeys++;
      nextKey++;
      try {
        if (p.config.mode === 'poly') admit(p, key);
        else retarget(p);
      } catch (error) { removeKey(p, key.key); throw error; }
      return key.key;
    },
    noteOff(index, id) {
      const p = part(index);
      number(id, 1, Number.MAX_SAFE_INTEGER, 'key', true);
      const key = p.keys.get(id);
      if (!key || !key.held) return false;
      key.held = false;
      if (p.sustain) {
        if (p.config.mode === 'mono') retarget(p);
        return true;
      }
      const gateId = key.gateId;
      removeKey(p, id);
      if (p.config.mode === 'mono') retarget(p);
      else if (gateId !== null) {
        const gate = gates.get(gateId);
        if (gate) release(gateId, gate);
      }
      return true;
    },
    sustain(index, on) {
      const p = part(index);
      if (typeof on !== 'boolean') throw new TypeError('sustain must be boolean');
      if (on === p.sustain) return;
      p.sustain = on;
      if (on) return;
      let failure: unknown;
      for (const key of p.keys.values()) if (!key.held) {
        const id = key.gateId;
        removeKey(p, key.key);
        if (p.config.mode === 'poly' && id !== null) {
          const gate = gates.get(id);
          if (gate) try { release(id, gate); } catch (error) { failure ??= error; }
        }
      }
      if (p.config.mode === 'mono') try { retarget(p); } catch (error) { failure ??= error; }
      if (failure !== undefined) throw failure;
    },
    allNotesOff(index) {
      const targets = index === undefined ? (part(0), parts) : [part(index)];
      let failure: unknown;
      for (const p of targets) {
        const error = clear(p, true);
        failure ??= error;
      }
      if (failure !== undefined) throw failure;
    },
    getPart(index) {
      const p = part(index);
      return Object.freeze({ ...p.config, sustain: p.sustain, selectedKey: p.selected,
        keys: Object.freeze(Array.from(p.keys.values(), key => Object.freeze({ ...key }))) });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      epoch++;
      unsubscribe();
      let failure: unknown;
      for (const p of parts) {
        const error = clear(p, true);
        failure ??= error;
      }
      gates.clear();
      admissionTerminals.clear();
      if (failure !== undefined) throw failure;
    },
  };
}
