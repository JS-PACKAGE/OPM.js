import { normalizeVoice } from '../voices/normalize.js';
import { brass } from '../voices/brass.js';
import { MAX_BANK_BYTES, MAX_BANK_VOICES, parseVoiceBank, validateVoice } from '../voices/schema.js';
import type { CompleteVoiceInput, NormalizedVoice, VoiceInput } from '../voices/schema.js';
import { validateNoteControls } from '../core/synth.js';
import type { NoteControls, QualityProfile, SynthOptions } from '../core/synth.js';
import { normalizeTuning } from '../core/tuning.js';
import type { TuningOptions } from '../core/tuning.js';
export type { ADSR, LFO, LFOInput, LegacyLFO, LegacyLFOV5, LFOTargets, LFOTargetsInput, KeyScale, Operator, Voice, VoiceInput, FrozenVoice, FrozenOperator, NormalizedVoice, PreparedVoice, PitchEnvelope, LegacyVoiceV3, LegacyVoiceV4, LegacyVoiceV5 } from '../voices/schema.js';
export type { NoteControls, SynthOptions, QualityProfile } from '../core/synth.js';
export type { TuningOptions, NormalizedTuning } from '../core/tuning.js';
export { playSequence, streamSequence } from './sequence.js';
export type { PlaySequenceOptions, SequencePlayback, SequenceStreamOptions, SequenceStream } from './sequence.js';
export type { SequenceEvent, SequenceNoteEvent, SequenceStopEvent, SequenceControlEvent } from '../core/sequence.js';
export { renderSequenceInWorker } from './render-worker.js';
export type { WavSink, WorkerRenderOptions, WorkerRenderProgress, WorkerRenderResult } from './render-worker.js';

export type NoteState = 'accepted' | 'started' | 'released' | 'ended' | 'stolen' | 'cancelled' | 'rejected';
export interface NoteEvent {
  type: 'note'; id: number; state: NoteState; reason?: string;
  /** Actual AudioContext sample frame and seconds at admission, dispatch or completion. */
  frame: number; time: number;
}
export interface DiagnosticsEvent {
  type: 'diagnostics'; requestId: number; activeVoices: number;
  pendingEvents: number; errors: number; rejectedNotes: number;
}
export interface ErrorEvent { type: 'error'; error: Error }
export type CommandName = 'stop' | 'updateNote' | 'allNotesOff' | 'panic' | 'setMixGain' | 'setTuning';
export interface CommandEvent {
  type: 'command'; command: CommandName; commandId?: number; id?: number;
  /** Accepted means admitted or immediately applied, not a future execution guarantee. */
  state: 'accepted' | 'rejected'; reason?: string; frame: number; time: number;
}
export type ContextState = AudioContextState | 'interrupted';
export interface ContextEvent { type: 'context'; state: ContextState; frame: number; time: number }
export interface ResetEvent {
  type: 'reset'; reason: 'close' | 'failure' | 'panic' | 'interruption'; frame: number; time: number;
  /** Initiating panic command, when available; independent of receipt-cache eviction. */
  commandId?: number;
}
export type OPMEvent = NoteEvent | DiagnosticsEvent | CommandEvent | ContextEvent | ResetEvent | ErrorEvent;
export interface CommandWaitOptions {
  /** Milliseconds, default 5000; an integer in 1..60000. */
  timeout?: number;
  signal?: AbortSignal;
}
/** Admission rejection, not an audio execution/completion result. */
export class CommandRejectedError extends Error {
  readonly event: Readonly<CommandEvent>;
  constructor(event: CommandEvent) {
    super(`${event.command} rejected: ${event.reason ?? 'unspecified'}`);
    this.name = 'CommandRejectedError';
    this.event = Object.freeze(event);
  }
}
export interface OPMOptions {
  sampleRate?: number;
  /** Borrowed context: OPM never closes or suspends it. */
  context?: AudioContext;
  /** Omit to connect to context.destination; null disables automatic connection. */
  destination?: AudioNode | null;
  /** Same-origin HTTPS (or secure loopback HTTP) module; default stays relative to this API module. */
  workletUrl?: string | URL;
  mixGain?: number;
  tuning?: TuningOptions;
  stealing?: SynthOptions['stealing'];
  /** Immutable synthesis profile; standard preserves the default sound. */
  quality?: QualityProfile;
  /** Logical polyphony, an integer in 1..8; default 8. */
  maxVoices?: number;
  /** Cancel all voices/events on interruption, or preserve direct-note state until resume. */
  interruption?: 'cancel' | 'preserve';
  onEvent?: (event: OPMEvent) => void;
}
interface PlayNoteBase {
  voice?: string | VoiceInput;
  note: number;
  /** A late start keeps its full duration; drop rejects even if processing is delayed. */
  late?: 'start' | 'drop';
  /** null (the default) holds until stop; a number sets a duration before release. */
  duration?: number | null;
  velocity?: number;
  pan?: number;
}
export type PlayNoteOptions = PlayNoteBase & (
  /** Relative delay in seconds; cannot be combined with at. */
  { time?: number; at?: never } |
  /** Absolute AudioContext seconds, at most 60 seconds ahead. Past times are allowed. */
  { at: number; time?: never }
);
export interface ScheduledNoteOptions {
  /** Absolute AudioContext seconds. Stop without at is immediate, including cancellation. */
  at?: number;
}
interface MutableAudioState {
  context: AudioContext | null;
  node: AudioWorkletNode | null;
}
interface DiagnosticsRequest {
  resolve: (event: DiagnosticsEvent) => void;
  reject: (error: unknown) => void;
}
interface CommandReceipt {
  command: CommandName;
  outcome?: CommandEvent | Error;
  waiters: Set<(outcome: CommandEvent | Error) => void>;
}

const MAX_DURATION = 60;
const MAX_DIAGNOSTICS_REQUESTS = 64;
const MAX_COMMAND_RECEIPTS = 128;
const MAX_COMMAND_WAITERS = 64;
const NOTE_STATES = ['accepted', 'started', 'released', 'ended', 'stolen', 'cancelled', 'rejected'];
const MAX_REGISTERED_VOICES = 128;
const EVENT_OBSERVERS = new WeakMap<OPM, Set<(event: OPMEvent) => void>>();
const COMMAND_NAMES: readonly CommandName[] = ['stop', 'updateNote', 'allNotesOff', 'panic', 'setMixGain', 'setTuning'];
const CONTEXT_STATES: readonly ContextState[] = ['running', 'suspended', 'interrupted', 'closed'];

function workletModuleUrl(input: string | URL | undefined): URL {
  const page = typeof globalThis.location === 'object' ? new URL(globalThis.location.href) : null;
  if (globalThis.isSecureContext === false) {
    throw new Error('AudioWorklet requires a secure context (HTTPS or localhost)');
  }
  if (input !== undefined && !page) throw new Error('workletUrl requires a browser origin');
  const url = input === undefined ? new URL('../worklet/processor.js', import.meta.url)
    : new URL(input, page!.href);
  if (page) {
    const loopback = page.hostname === 'localhost' || page.hostname.endsWith('.localhost') ||
      page.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(page.hostname);
    if (page.protocol !== 'https:' && !(page.protocol === 'http:' && loopback)) {
      throw new Error('AudioWorklet requires HTTPS or loopback HTTP');
    }
    if (input !== undefined && (url.origin !== page.origin || !['https:', 'http:'].includes(url.protocol) ||
        url.username || url.password || url.hash)) {
      throw new Error('workletUrl must be a same-origin HTTP(S) module without credentials or a fragment');
    }
  }
  return url;
}

function mixGainValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('mixGain must be finite and in 0..1');
  }
  return value;
}

function ownData(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label} must be a plain data object`);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError(`${label} has an unknown field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label}.${key} must be data`);
    result[key] = descriptor.value;
  }
  return result;
}

function frozenPatch(input: VoiceInput, name?: string): NormalizedVoice {
  const patch = normalizeVoice(input);
  if (name !== undefined) patch.name = name;
  for (const op of patch.ops) {
    Object.freeze(op.adsr);
    if (op.keyScale) Object.freeze(op.keyScale);
    Object.freeze(op);
  }
  Object.freeze(patch.ops);
  Object.freeze(patch.lfo);
  if (patch.pitchEnvelope) Object.freeze(patch.pitchEnvelope);
  return Object.freeze(patch);
}

function voiceName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new TypeError('Invalid voice name');
}

/** Only validated snapshots reach this copier; null prototypes exclude inherited JSON hooks. */
function bankJsonData(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    Object.setPrototypeOf(result, null);
    for (let index = 0; index < value.length; index++) result[index] = bankJsonData(value[index]);
    return result;
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) result[key] = bankJsonData(Object.getOwnPropertyDescriptor(value, key)!.value);
  return result;
}

function bankArrayData(value: unknown): CompleteVoiceInput[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('voice bank must be a plain dense array');
  }
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > MAX_BANK_VOICES) {
    throw new RangeError('Voice bank exceeds 128 voices');
  }
  if (Reflect.ownKeys(value).length !== length + 1) throw new TypeError('voice bank has unknown fields');
  const result: CompleteVoiceInput[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('voice bank must contain data');
    result.push(descriptor.value);
  }
  return result;
}

function absoluteTime(value: unknown, context: AudioContext): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      value > context.currentTime + MAX_DURATION ||
      !Number.isSafeInteger(Math.round(value * context.sampleRate))) {
    throw new RangeError('at must be finite, nonnegative, safely framed and at most 60 seconds ahead');
  }
  return value;
}

function noteId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('Invalid note id');
}

function replyData(data: unknown): Exclude<OPMEvent, ErrorEvent | ContextEvent> | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const type = Object.getOwnPropertyDescriptor(data, 'type');
  if (!type || !Object.hasOwn(type, 'value')) return null;
  const required = type.value === 'note' ? ['type', 'id', 'state', 'frame', 'time']
    : type.value === 'diagnostics' ? ['type', 'requestId', 'activeVoices', 'pendingEvents', 'errors', 'rejectedNotes']
    : type.value === 'command' ? ['type', 'command', 'state', 'frame', 'time']
    : type.value === 'reset' ? ['type', 'reason', 'frame', 'time'] : null;
  if (!required) return null;
  const optional = type.value === 'note' ? ['reason'] : type.value === 'command' ? ['id', 'commandId', 'reason']
    : type.value === 'reset' ? ['commandId'] : [];
  const result: Record<PropertyKey, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(data)) {
    if (!required.includes(key as string) && !optional.includes(key as string)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(data, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(result, key)) return null;
  if (result.type === 'diagnostics') {
    if (!Number.isSafeInteger(result.requestId) || (result.requestId as number) <= 0) return null;
    for (const key of ['activeVoices', 'pendingEvents', 'errors', 'rejectedNotes']) {
      if (!Number.isSafeInteger(result[key]) || (result[key] as number) < 0) return null;
    }
  } else {
    if (!Number.isSafeInteger(result.frame) || (result.frame as number) < 0 ||
        typeof result.time !== 'number' || !Number.isFinite(result.time) || result.time < 0 ||
        Object.hasOwn(result, 'reason') && typeof result.reason !== 'string') return null;
    if (result.type === 'note') {
      if (!Number.isSafeInteger(result.id) || (result.id as number) <= 0 || !NOTE_STATES.includes(result.state as string)) return null;
    } else if (result.type === 'command') {
      if (!COMMAND_NAMES.includes(result.command as CommandName) || !['accepted', 'rejected'].includes(result.state as string)) return null;
      for (const key of ['id', 'commandId']) {
        if (Object.hasOwn(result, key) && (!Number.isSafeInteger(result[key]) || (result[key] as number) <= 0)) return null;
      }
    } else {
      if (!['panic', 'interruption'].includes(result.reason as string)) return null;
      if (Object.hasOwn(result, 'commandId') && (!Number.isSafeInteger(result.commandId) || (result.commandId as number) <= 0)) return null;
    }
  }
  return result as unknown as Exclude<OPMEvent, ErrorEvent | ContextEvent>;
}

/** Browser-facing facade. Import Synth from ../core/synth.js for offline rendering. */
export class OPM {
  declare readonly sampleRate: number | undefined;
  get quality(): QualityProfile { return this._synthOptions.quality!; }
  get maxVoices(): number { return this._maxVoices; }
  /** @internal */
  declare private _maxVoices: number;
  /** Defensive map snapshot; loaded patches are deeply frozen. Use loadVoice to replace one. */
  get voices(): ReadonlyMap<string, NormalizedVoice> { return new Map(this._voices); }
  /** @internal */
  declare private _voices: Map<string, NormalizedVoice>;
  /** @internal */
  declare private _voiceIds: Map<string, number>;
  /** @internal Content keys avoid repeated serialization for immutable named patches. */
  declare private _patchKeys: WeakMap<NormalizedVoice, string>;
  /** @internal */
  declare private _nextVoiceId: number;
  /** @internal */
  declare private _nextCommandId: number;
  /** @internal */
  declare private _synthOptions: SynthOptions;
  /** @internal */
  declare private _interruption: 'cancel' | 'preserve';
  declare readonly context: AudioContext | null;
  declare readonly node: AudioWorkletNode | null;
  /** @internal */
  declare private nextId: number;
  declare onEvent?: (event: OPMEvent) => void;
  /** @internal */
  declare private _providedContext: AudioContext | null;
  /** @internal */
  declare private _destination: AudioNode | null | undefined;
  /** @internal */
  declare private _startPromise: Promise<void> | null;
  /** @internal */
  declare private _closePromise: Promise<void> | null;
  /** @internal */
  declare private _processorFailure: Error | null;
  /** @internal */
  declare private _diagnostics: Map<number, DiagnosticsRequest>;
  /** @internal */
  declare private _nextRequestId: number;
  /** @internal */
  declare private _contextListener: {
    context: AudioContext; node: AudioWorkletNode; listener: () => void;
  } | null | undefined;
  /** @internal */
  declare private _workletUrl: string | URL | undefined;
  /** @internal */
  declare private _commands: Map<number, CommandReceipt>;
  /** @internal */
  declare private _commandWaiterCount: number;
  /** @internal */
  declare private _disposed: boolean;
  /** @internal */
  declare private _disposePromise: Promise<void> | null;

  constructor(options: OPMOptions = {}) {
    const { sampleRate, context, destination, onEvent, mixGain, tuning, stealing, quality, maxVoices, interruption, workletUrl } = ownData(options,
      ['sampleRate', 'context', 'destination', 'onEvent', 'mixGain', 'tuning', 'stealing', 'quality', 'maxVoices', 'interruption', 'workletUrl'], 'OPM options') as OPMOptions;
    if (sampleRate !== undefined && (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000)) {
      throw new RangeError('sampleRate must be an integer in 8000..96000');
    }
    if (context !== undefined && (context === null || typeof context !== 'object' ||
        typeof context.resume !== 'function' || typeof context.audioWorklet?.addModule !== 'function')) {
      throw new TypeError('context must be an AudioContext with AudioWorklet support');
    }
    if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
    if (stealing !== undefined && !['oldest', 'release-first', 'quietest'].includes(stealing)) throw new RangeError('Invalid stealing policy');
    if (quality !== undefined && quality !== 'eco' && quality !== 'standard' && quality !== 'high') throw new RangeError('Invalid quality profile');
    if (maxVoices !== undefined && (typeof maxVoices !== 'number' || !Number.isInteger(maxVoices) || maxVoices < 1 || maxVoices > 8)) {
      throw new RangeError('maxVoices must be an integer in 1..8');
    }
    if (interruption !== undefined && interruption !== 'cancel' && interruption !== 'preserve') throw new RangeError('Invalid interruption policy');
    if (workletUrl !== undefined && typeof workletUrl !== 'string' && !(workletUrl instanceof URL)) {
      throw new TypeError('workletUrl must be a string or URL');
    }
    // Detach a caller-owned URL before asynchronous initialization.
    this._workletUrl = workletUrl instanceof URL ? new URL(workletUrl.href) : workletUrl;
    if (workletUrl !== undefined) workletModuleUrl(this._workletUrl);
    this._synthOptions = { mixGain: mixGainValue(mixGain === undefined ? 1 : mixGain),
      tuning: normalizeTuning(tuning === undefined ? {} : tuning), stealing: stealing ?? 'oldest', quality: quality ?? 'standard' };
    this._maxVoices = maxVoices ?? 8;
    this._interruption = interruption ?? 'cancel';
    this.sampleRate = sampleRate;
    this._voices = new Map([['brass', frozenPatch(brass, 'brass')]]);
    this._voiceIds = new Map();
    this._patchKeys = new WeakMap();
    this._nextVoiceId = 1;
    this._nextCommandId = 1;
    (this as MutableAudioState).context = context ?? null;
    (this as MutableAudioState).node = null;
    this.nextId = 1;
    this.onEvent = onEvent;
    this._providedContext = context ?? null;
    this._destination = destination;
    this._startPromise = null;
    this._closePromise = null;
    this._processorFailure = null;
    this._diagnostics = new Map();
    this._nextRequestId = 1;
    this._commands = new Map();
    this._commandWaiterCount = 0;
    this._disposed = false;
    this._disposePromise = null;
  }

  loadVoice(name: string, voice: VoiceInput): void {
    if (this._disposed) throw new Error('OPM is disposed');
    voiceName(name);
    if (!this._voices.has(name) && this._voices.size >= MAX_BANK_VOICES) throw new RangeError('Voice bank exceeds 128 voices');
    const patch = frozenPatch(voice, name);
    this._voices.set(name, patch);
  }

  /** Atomically replaces the registry. Only an empty plain array (not JSON "[]") clears it. */
  replaceVoiceBank(source: string | readonly CompleteVoiceInput[]): void {
    if (this._disposed) throw new Error('OPM is disposed');
    if (typeof source !== 'string') {
      source = bankArrayData(source);
      if (source.length === 0) {
        this._voices = new Map();
        return;
      }
    }
    const parsed = parseVoiceBank(source);
    const next = new Map<string, NormalizedVoice>();
    for (const [name, patch] of parsed) next.set(name, patch as unknown as NormalizedVoice);
    this._voices = next;
  }

  removeVoice(name: string): boolean {
    if (this._disposed) throw new Error('OPM is disposed');
    voiceName(name);
    return this._voices.delete(name);
  }

  /** Canonical versioned entries, detached from the immutable registry and UTF-8 bounded. */
  exportVoiceBank(): string {
    if (this._disposed) throw new Error('OPM is disposed');
    if (this._voices.size > MAX_BANK_VOICES) throw new RangeError('Voice bank exceeds 128 voices');
    const entries = [];
    for (const patch of this._voices.values()) entries.push(validateVoice(patch));
    const output = JSON.stringify(bankJsonData(entries));
    if (output.length > MAX_BANK_BYTES || new TextEncoder().encode(output).length > MAX_BANK_BYTES) {
      throw new RangeError('Voice bank exceeds 256 KiB');
    }
    return output;
  }

  /** Independent subscription; close preserves it for restart, dispose removes it permanently. */
  subscribe(listener: (event: OPMEvent) => void): () => void {
    if (this._disposed) throw new Error('OPM is disposed');
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const observers = EVENT_OBSERVERS.get(this) ?? new Set<(event: OPMEvent) => void>();
    EVENT_OBSERVERS.set(this, observers);
    let active = true;
    const observe = (event: OPMEvent) => { if (active) listener(event); };
    observers.add(observe);
    return () => {
      if (!active) return;
      active = false;
      observers.delete(observe);
    };
  }

  /** @internal */
  private _emit(event: OPMEvent): void {
    Object.freeze(event);
    const observers = EVENT_OBSERVERS.get(this);
    if (observers) for (const observe of [...observers]) {
      if (!observers.has(observe)) continue;
      try { observe(event); } catch { /* Host error callbacks cannot break lifecycle cleanup. */ }
    }
    try { this.onEvent?.(event); } catch { /* Host callbacks cannot break audio lifecycle handling. */ }
  }

  /** @internal */
  private _reset(reason: ResetEvent['reason'], context = this.context): void {
    const time = context?.currentTime ?? 0;
    const frame = Math.round(time * (context?.sampleRate ?? this.sampleRate ?? 44100));
    this._rejectCommands(new Error(`OPM reset: ${reason}`));
    this._emit({ type: 'reset', reason, frame, time });
  }

  /** @internal */
  private _commandId(command: CommandName): number {
    if (!Number.isSafeInteger(this._nextCommandId) || this._nextCommandId <= 0) throw new RangeError('Command ID space exhausted');
    if (this._commands.size >= MAX_COMMAND_RECEIPTS) {
      for (const [id, receipt] of this._commands) {
        if (receipt.waiters.size === 0) { this._commands.delete(id); break; }
      }
    }
    const id = this._nextCommandId++;
    this._commands.set(id, { command, waiters: new Set() });
    return id;
  }

  /** @internal */
  private _settleCommand(receipt: CommandReceipt, outcome: CommandEvent | Error): void {
    if (receipt.outcome !== undefined) return;
    receipt.outcome = outcome;
    for (const settle of [...receipt.waiters]) settle(outcome);
  }

  /** @internal */
  private _rejectCommands(error: Error, boundary = Infinity): void {
    for (const [id, receipt] of this._commands) {
      // Port order puts an explicitly correlated reset before its ack and later replies.
      if (id < boundary) this._settleCommand(receipt, error);
    }
  }

  /** @internal */
  private _postCommand(node: AudioWorkletNode, command: CommandName, message: Record<string, unknown>): number {
    const commandId = this._commandId(command);
    const receipt = this._commands.get(commandId)!;
    try { node.port.postMessage({ ...message, commandId }); }
    catch (error) {
      this._settleCommand(receipt, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    return commandId;
  }

  /** @internal */
  private _rejectDiagnostics(error: unknown): void {
    for (const request of this._diagnostics.values()) request.reject(error);
    this._diagnostics.clear();
  }

  /** @internal */
  private _disposeNode(node: AudioWorkletNode | null): void {
    this._voiceIds.clear();
    this._patchKeys = new WeakMap();
    this._nextVoiceId = 1;
    if (!node) return;
    if (this._contextListener?.node === node) {
      const { context, listener } = this._contextListener;
      context.removeEventListener('statechange', listener);
      this._contextListener = null;
    }
    node.onprocessorerror = null;
    node.port.onmessage = null;
    node.port.onmessageerror = null;
    // Port closure alone does not stop a processor in a borrowed, running context.
    try { node.port.postMessage({ type: 'close' }); } catch { /* Failed ports still need local cleanup. */ }
    try { node.disconnect(); } catch { /* It may already be disconnected. */ }
    try { node.port.close(); } catch { /* It may already be closed. */ }
  }

  /** @internal */
  private _handleFailure(node: AudioWorkletNode, error: Error): void {
    if (this.node !== node) return;
    this._processorFailure = error;
    (this as MutableAudioState).node = null;
    this._rejectDiagnostics(error);
    this._rejectCommands(error);
    this._disposeNode(node);
    this._reset('failure');
    this._emit({ type: 'error', error });
  }

  /** @internal */
  private _receive(raw: unknown): void {
    let event: Exclude<OPMEvent, ErrorEvent | ContextEvent> | null;
    try { event = replyData(raw); } catch { return; }
    if (!event) return;
    if (event.type === 'diagnostics') {
      const request = this._diagnostics.get(event.requestId);
      if (request) {
        this._diagnostics.delete(event.requestId);
        request.resolve(event);
      }
    }
    if (event.type === 'command' && event.commandId !== undefined) {
      const receipt = this._commands.get(event.commandId);
      if (receipt?.command === event.command) {
        Object.freeze(event);
        this._settleCommand(receipt, event.state === 'accepted' ? event : new CommandRejectedError(event));
      }
    }
    if (event.type === 'reset') this._rejectCommands(new Error(`OPM reset: ${event.reason}`), event.commandId);
    this._emit(event);
  }

  start(): Promise<void> {
    if (this._disposed) return Promise.reject(new Error('OPM is disposed'));
    if (this._closePromise) return this._closePromise.then(() => this.start());
    if (this._startPromise) return this._startPromise;
    const promise = Promise.resolve().then(() => this._start());
    this._startPromise = promise;
    const clear = () => { if (this._startPromise === promise) this._startPromise = null; };
    promise.then(clear, error => {
      clear();
      if (error !== this._processorFailure) this._emit({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) });
    });
    return promise;
  }

  /** @internal */
  private async _start(): Promise<void> {
    const moduleUrl = workletModuleUrl(this._workletUrl);
    if (this.context?.state === 'closed') {
      this._disposeNode(this.node);
      (this as MutableAudioState).node = null;
      if (this._providedContext) throw new Error('The provided AudioContext is closed');
      (this as MutableAudioState).context = null;
    }
    this._processorFailure = null;
    if (this.node) {
      const node = this.node;
      try {
        // Native state promises may settle before statechange; observe both sides of resume.
        this._contextListener?.listener();
        await this.context!.resume();
        this._contextListener?.listener();
        if (this._processorFailure || this.node !== node) throw this._processorFailure ?? new Error('AudioWorklet stopped');
      } catch (error) {
        this._rejectDiagnostics(error);
        this._rejectCommands(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
      return;
    }
    if (typeof globalThis.AudioWorkletNode !== 'function' ||
        (!this._providedContext && typeof globalThis.AudioContext !== 'function')) {
      throw new Error('AudioWorklet is not available in this environment; use Synth for offline rendering');
    }
    const context = this.context ?? new globalThis.AudioContext(this.sampleRate === undefined ? undefined : { sampleRate: this.sampleRate });
    (this as MutableAudioState).context = context;
    let node: AudioWorkletNode | null = null;
    try {
      await context.audioWorklet.addModule(moduleUrl);
      node = new globalThis.AudioWorkletNode(context, 'opm-processor', {
        outputChannelCount: [2], processorOptions: { maxVoices: this.maxVoices, ...this._synthOptions },
      });
      (this as MutableAudioState).node = node;
      node.port.onmessage = (event) => { if (this.node === node) this._receive(event.data); };
      node.port.onmessageerror = () => this._handleFailure(node!, new Error('AudioWorklet message could not be decoded'));
      node.onprocessorerror = () => this._handleFailure(node!, new Error('AudioWorklet processor failed'));
      if (typeof context.addEventListener === 'function') {
        let observedState: ContextState = context.state;
        const listener = () => {
          if (this.node !== node) return;
          const state = context.state as ContextState;
          if (state === observedState) return;
          observedState = state;
          if (CONTEXT_STATES.includes(state)) {
            const time = context.currentTime;
            this._emit({ type: 'context', state, frame: Math.round(time * context.sampleRate), time });
          }
          if (state === 'closed') this._handleFailure(node!, new Error('AudioContext is closed'));
          else if (state !== 'running') {
            this._rejectDiagnostics(new Error('AudioContext is not running; call resume() before getDiagnostics()'));
            this._rejectCommands(new Error(`AudioContext is ${state}; command acknowledgement interrupted`));
            if (this._interruption === 'cancel') {
              try { node!.port.postMessage({ type: 'panic', reason: 'interruption' }); }
              catch { this._handleFailure(node!, new Error('AudioWorklet interruption cleanup failed')); }
            }
          }
        };
        context.addEventListener('statechange', listener);
        this._contextListener = { context, node, listener };
      }
      const destination = this._destination === undefined ? context.destination : this._destination;
      if (destination !== null) node.connect(destination);
      await context.resume();
      this._contextListener?.listener();
      if (this._processorFailure || this.node !== node) throw this._processorFailure ?? new Error('AudioWorklet stopped');
    } catch (error) {
      if (this.node === node) {
        (this as MutableAudioState).node = null;
        this._disposeNode(node);
      }
      this._rejectDiagnostics(error);
      this._rejectCommands(error instanceof Error ? error : new Error(String(error)));
      if (!this._providedContext) {
        (this as MutableAudioState).context = null;
        try { await context.close(); } catch { /* Preserve the initialization failure. */ }
      }
      throw error;
    }
  }

  resume(): Promise<void> {
    return this.start();
  }

  /** @internal */
  private _requireNode(): AudioWorkletNode {
    if (this._processorFailure) throw this._processorFailure;
    if (this._disposed) throw new Error('OPM is disposed');
    if (!this.node || this._closePromise || this.context?.state === 'closed') throw new Error('Call start() before using the audio node');
    return this.node;
  }

  connect(destination: AudioNode): this {
    this._requireNode().connect(destination);
    return this;
  }

  disconnect(destination?: AudioNode): this {
    const node = this._requireNode();
    if (destination === undefined) node.disconnect();
    else node.disconnect(destination);
    return this;
  }

  playNote(options: PlayNoteOptions): number {
    const node = this._requireNode();
    const data = ownData(options, ['voice', 'note', 'time', 'at', 'late', 'duration', 'velocity', 'pan'], 'note options');
    const voice = data.voice === undefined ? 'brass' : data.voice;
    const note = data.note;
    const duration = data.duration === undefined ? null : data.duration;
    const velocity = data.velocity === undefined ? 1 : data.velocity;
    const pan = data.pan === undefined ? 0 : data.pan;
    const late = data.late === undefined ? 'start' : data.late;
    if (typeof note !== 'number' || !Number.isFinite(note) || note < 0 || note > 127) throw new RangeError('note must be finite and in 0..127');
    if (Object.hasOwn(data, 'at') && Object.hasOwn(data, 'time')) throw new TypeError('at and time are mutually exclusive');
    const time = data.time === undefined ? 0 : data.time;
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > MAX_DURATION) throw new RangeError('time must be a delay in 0..60 seconds');
    const at = absoluteTime(Object.hasOwn(data, 'at') ? data.at : this.context!.currentTime + time, this.context!);
    if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION)) {
      throw new RangeError('duration must be null or in (0, 60] seconds');
    }
    if (typeof velocity !== 'number' || !Number.isFinite(velocity) || velocity < 0 || velocity > 1) throw new RangeError('velocity must be in 0..1');
    if (typeof pan !== 'number' || !Number.isFinite(pan) || pan < -1 || pan > 1) throw new RangeError('pan must be in -1..1');
    if (late !== 'start' && late !== 'drop') throw new TypeError('late must be start or drop');
    const endFrame = Math.max(Math.round(at * this.context!.sampleRate), Math.round(this.context!.currentTime * this.context!.sampleRate)) +
      (duration === null ? 0 : Math.max(1, Math.ceil(duration * this.context!.sampleRate)));
    if (!Number.isSafeInteger(endFrame)) throw new RangeError('duration exceeds safe sample frames');
    if (!Number.isSafeInteger(this.nextId) || this.nextId <= 0) throw new RangeError('Note ID space exhausted');
    let patch: NormalizedVoice | undefined;
    let rawKey: string | undefined;
    if (typeof voice === 'string') patch = this._voices.get(voice);
    else {
      // Every raw call validates a fresh snapshot; mutations must not bypass validation.
      patch = frozenPatch(voice as VoiceInput);
      rawKey = JSON.stringify(patch);
    }
    if (!patch) throw new RangeError('Unknown voice');
    const key = this._patchKeys.get(patch) ?? rawKey ?? JSON.stringify(patch);
    this._patchKeys.set(patch, key);
    let voiceId = this._voiceIds.get(key);
    if (voiceId === undefined) {
      if (this._voiceIds.size < MAX_REGISTERED_VOICES) voiceId = this._nextVoiceId++;
      else {
        const oldest = this._voiceIds.keys().next().value!;
        voiceId = this._voiceIds.get(oldest)!;
        // Validate in the processor before replacing: queued/active notes retain their snapshots.
        node.port.postMessage({ type: 'prepareVoice', voiceId, voice: patch });
        this._voiceIds.delete(oldest);
        this._voiceIds.set(key, voiceId);
      }
      if (!this._voiceIds.has(key)) {
        node.port.postMessage({ type: 'prepareVoice', voiceId, voice: patch });
        this._voiceIds.set(key, voiceId);
      }
    } else {
      this._voiceIds.delete(key);
      this._voiceIds.set(key, voiceId);
    }
    const id = this.nextId++;
    node.port.postMessage({ type: 'noteOn', id, voiceId, note, at, duration, velocity, pan, late });
    return id;
  }

  stop(id: number, options: ScheduledNoteOptions = {}): number {
    const node = this._requireNode();
    noteId(id);
    const data = ownData(options, ['at'], 'stop options');
    const at = Object.hasOwn(data, 'at') ? absoluteTime(data.at, this.context!) : undefined;
    return this._postCommand(node, 'stop', { type: 'noteOff', id, ...(at === undefined ? {} : { at }) });
  }

  /** Pending updates apply at onset. At equal frames stop precedes onset, then controls. */
  updateNote(id: number, controls: NoteControls, options: ScheduledNoteOptions = {}): number {
    const node = this._requireNode();
    noteId(id);
    const snapshot = validateNoteControls(controls);
    const data = ownData(options, ['at'], 'update options');
    const at = Object.hasOwn(data, 'at') ? absoluteTime(data.at, this.context!) : undefined;
    return this._postCommand(node, 'updateNote', { type: 'updateNote', id, controls: snapshot, ...(at === undefined ? {} : { at }) });
  }

  /** Cancel all pending events and release all active gates, preserving release tails. */
  allNotesOff(): number {
    const node = this._requireNode();
    return this._postCommand(node, 'allNotesOff', { type: 'allNotesOff' });
  }

  /** Immediate silence, including release/stealing tails; routing and patch cache survive. */
  panic(): number {
    const node = this._requireNode();
    return this._postCommand(node, 'panic', { type: 'panic' });
  }

  setMixGain(gain: number): number {
    const node = this._requireNode();
    gain = mixGainValue(gain);
    const commandId = this._postCommand(node, 'setMixGain', { type: 'setMixGain', gain });
    this._synthOptions.mixGain = gain;
    return commandId;
  }

  setTuning(tuning: TuningOptions): number {
    const node = this._requireNode();
    const snapshot = normalizeTuning(tuning);
    const commandId = this._postCommand(node, 'setTuning', { type: 'setTuning', tuning: snapshot });
    this._synthOptions.tuning = snapshot;
    return commandId;
  }

  /** Wait for admission only. At most 128 receipts and 64 live waits; live waits prevent eviction. */
  waitForCommand(commandId: number, options: CommandWaitOptions = {}): Promise<CommandEvent> {
    let timeout: number;
    let signal: AbortSignal | undefined;
    let getAborted: (() => boolean) | undefined;
    let getReason: (() => unknown) | undefined;
    let receipt: CommandReceipt;
    try {
      noteId(commandId);
      const data = ownData(options, ['timeout', 'signal'], 'command wait options');
      timeout = data.timeout === undefined ? 5000 : data.timeout as number;
      signal = data.signal as AbortSignal | undefined;
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) {
        throw new RangeError('timeout must be an integer in 1..60000 milliseconds');
      }
      if (signal !== undefined) {
        getAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
        getReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')?.get;
        if (getAborted.call(signal)) throw getReason?.call(signal) ?? new DOMException('Command wait aborted', 'AbortError');
      }
      const found = this._commands.get(commandId);
      if (!found) throw new RangeError('Unknown or expired command id');
      receipt = found;
      if (receipt.outcome instanceof Error) return Promise.reject(receipt.outcome);
      if (receipt.outcome !== undefined) return Promise.resolve(receipt.outcome);
      if (this._commandWaiterCount >= MAX_COMMAND_WAITERS) throw new Error('Too many pending command waits');
    } catch (error) { return Promise.reject(error); }
    return new Promise<CommandEvent>((resolve, reject) => {
      let active = true;
      let timer: Parameters<typeof clearTimeout>[0];
      const finish = (outcome: CommandEvent | Error, aborted = false) => {
        if (!active) return;
        let reason: unknown = outcome;
        if (aborted) {
          try { reason = getReason?.call(signal) ?? outcome; } catch (error) { reason = error; }
        }
        active = false;
        clearTimeout(timer);
        try { if (signal) EventTarget.prototype.removeEventListener.call(signal, 'abort', abort); } catch { /* Cleanup must still settle every waiter. */ }
        receipt.waiters.delete(settle);
        this._commandWaiterCount--;
        if (aborted) reject(reason);
        else if (outcome instanceof Error) reject(outcome);
        else resolve(outcome);
      };
      const settle = (outcome: CommandEvent | Error) => finish(outcome);
      const abort = () => finish(new DOMException('Command wait aborted', 'AbortError'), true);
      this._commandWaiterCount++;
      receipt.waiters.add(settle);
      timer = setTimeout(() => finish(new DOMException('Command acknowledgement timed out', 'TimeoutError')), timeout);
      try {
        if (signal) EventTarget.prototype.addEventListener.call(signal, 'abort', abort, { once: true });
        if (getAborted?.call(signal)) abort();
        else if (receipt.outcome !== undefined) settle(receipt.outcome);
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  getDiagnostics(): Promise<DiagnosticsEvent> {
    let node: AudioWorkletNode;
    try {
      node = this._requireNode();
      if (this.context!.state !== undefined && this.context!.state !== 'running') {
        throw new Error('AudioContext is not running; call resume() before getDiagnostics()');
      }
      if (this._diagnostics.size >= MAX_DIAGNOSTICS_REQUESTS) throw new Error('Too many pending diagnostics requests');
      if (!Number.isSafeInteger(this._nextRequestId) || this._nextRequestId <= 0) throw new RangeError('Diagnostics request ID space exhausted');
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = this._nextRequestId++;
    return new Promise<DiagnosticsEvent>((resolve, reject) => {
      this._diagnostics.set(requestId, { resolve, reject });
      try {
        node.port.postMessage({ type: 'diagnostics', requestId });
      } catch (error) {
        this._diagnostics.delete(requestId);
        reject(error);
      }
    });
  }

  close(): Promise<void> {
    if (this._closePromise) return this._closePromise;
    this._rejectDiagnostics(new Error('OPM is closed'));
    this._rejectCommands(new Error('OPM is closed'));
    const promise = Promise.resolve().then(() => this._close());
    this._closePromise = promise;
    const clear = () => { if (this._closePromise === promise) this._closePromise = null; };
    promise.then(clear, clear);
    return promise;
  }

  /** Permanently closes OPM and releases host callbacks; never closes a borrowed context. */
  dispose(): Promise<void> {
    if (this._disposePromise) return this._disposePromise;
    this._disposed = true;
    const finish = () => { EVENT_OBSERVERS.delete(this); this.onEvent = undefined; };
    const promise = this.close().then(finish, error => { finish(); throw error; });
    this._disposePromise = promise;
    return promise;
  }

  /** @internal */
  private async _close(): Promise<void> {
    if (this._startPromise) {
      try { await this._startPromise; } catch { /* Initialization already releases failed resources. */ }
    }
    const node = this.node;
    const context = this.context;
    (this as MutableAudioState).node = null;
    (this as MutableAudioState).context = this._providedContext;
    this._processorFailure = null;
    this._rejectDiagnostics(new Error('OPM is closed'));
    this._disposeNode(node);
    if (node) this._reset('close', context);
    if (context && !this._providedContext && context.state !== 'closed') await context.close();
  }
}

export interface LookaheadWindow {
  /** Half-open absolute AudioContext time window. Missed windows are skipped after a stall. */
  from: number; to: number;
  /** Maximum notes the callback may return in this batch. */
  maxNotes: number;
}
export type LookaheadNote = PlayNoteOptions & { at: number; duration: number };
export interface LookaheadOptions {
  /** Seconds, default 0.2; bounded to 0.02..10 and greater than interval. */
  horizon?: number;
  /** Seconds between pumps, default 0.025; bounded to 0.005..1. */
  interval?: number;
  /** Maximum batch size, default 32; bounded to 1..128. */
  maxNotes?: number;
  /** Timer/callback failures stop scheduling and are delivered here. */
  onError: (error: Error) => void;
}
export interface LookaheadScheduler {
  readonly running: boolean;
  /** Call from a user gesture; initializes/resumes OPM, then fills the first window. */
  start(): Promise<void>;
  /** Cancels pending notes and releases this scheduler's active gates, not other notes. */
  stop(): void;
  /** Stops and permanently prevents restart; does not close OPM. */
  dispose(): void;
}

/** Bounded timer-driven admission, not timer-driven note release. Audio frames own all gates. */
export function createLookaheadScheduler(
  opm: OPM,
  schedule: (window: LookaheadWindow) => readonly LookaheadNote[],
  options: LookaheadOptions,
): LookaheadScheduler {
  const data = ownData(options, ['horizon', 'interval', 'maxNotes', 'onError'], 'lookahead options');
  const rawHorizon = data.horizon === undefined ? 0.2 : data.horizon;
  const rawInterval = data.interval === undefined ? 0.025 : data.interval;
  const rawMaxNotes = data.maxNotes === undefined ? 32 : data.maxNotes;
  const rawOnError = data.onError;
  if (typeof schedule !== 'function' || typeof rawOnError !== 'function') throw new TypeError('schedule and onError must be functions');
  if (typeof rawHorizon !== 'number' || !Number.isFinite(rawHorizon) || rawHorizon < 0.02 || rawHorizon > 10 ||
      typeof rawInterval !== 'number' || !Number.isFinite(rawInterval) || rawInterval < 0.005 || rawInterval > 1 || rawInterval >= rawHorizon) {
    throw new RangeError('lookahead requires horizon in 0.02..10, interval in 0.005..1, and interval < horizon');
  }
  if (typeof rawMaxNotes !== 'number' || !Number.isInteger(rawMaxNotes) || rawMaxNotes < 1 || rawMaxNotes > 128) throw new RangeError('maxNotes must be an integer in 1..128');
  const horizon: number = rawHorizon;
  const interval: number = rawInterval;
  const maxNotes: number = rawMaxNotes;
  const onError = rawOnError as (error: Error) => void;
  let running = false;
  let disposed = false;
  let generation = 0;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let starting: Promise<void> | null = null;
  const gates = new Set<number>();
  const observers = EVENT_OBSERVERS.get(opm) ?? new Set<(event: OPMEvent) => void>();
  EVENT_OBSERVERS.set(opm, observers);
  let admitting = false;
  let admissionTerminal: number | null = null;
  const observe = (event: OPMEvent) => {
    if (event.type === 'reset') { gates.clear(); stop(false); return; }
    if (event.type === 'context' && event.state !== 'running') {
      stop(false);
      onError(new Error(`Lookahead AudioContext is ${event.state}; restart from a user gesture`));
      return;
    }
    if (event.type !== 'note') return;
    if (event.state === 'ended' || event.state === 'stolen' || event.state === 'cancelled' || event.state === 'rejected') {
      gates.delete(event.id);
      if (admitting) admissionTerminal = event.id;
    }
  };

  function stop(reportFailure = true): void {
    running = false;
    generation++;
    clearTimeout(timer);
    timer = undefined;
    observers.delete(observe);
    let failure: unknown;
    for (const id of gates) {
      try { opm.stop(id); } catch (error) { failure ??= error; }
    }
    gates.clear();
    if (reportFailure && failure !== undefined) onError(failure instanceof Error ? failure : new Error(String(failure)));
  }

  function pump(): void {
    if (!running) return;
    try {
      const context = opm.context;
      if (!context || !opm.node || context.state !== 'running') throw new Error('Lookahead AudioContext is not running');
      const now = context.currentTime;
      const from = Math.max(cursor, now);
      const to = now + horizon;
      if (from < to) {
        const notes = schedule({ from, to, maxNotes });
        if (!Array.isArray(notes) || notes.length > maxNotes || gates.size + notes.length > 128) {
          throw new RangeError('Lookahead batch or outstanding gates exceed their bounded capacity');
        }
        // Snapshot batch data and timing before admission; never invoke array/option accessors.
        const batch: LookaheadNote[] = [];
        for (let index = 0; index < notes.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(notes, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Lookahead notes must be data array entries');
          const note = ownData(descriptor.value, ['voice', 'note', 'at', 'late', 'duration', 'velocity', 'pan'], 'lookahead note');
          if (typeof note.at !== 'number' || !Number.isFinite(note.at) || note.at < from || note.at >= to ||
              typeof note.duration !== 'number' || !Number.isFinite(note.duration) || note.duration <= 0 || note.duration > 60) {
            throw new RangeError('Lookahead notes require an at inside the window and duration in (0, 60]');
          }
          batch.push(note as unknown as LookaheadNote);
        }
        // A callback may stop/dispose its scheduler reentrantly.
        if (!running) return;
        cursor = to;
        for (const note of batch) {
          admissionTerminal = null;
          admitting = true;
          let id: number;
          try { id = opm.playNote(note); } finally { admitting = false; }
          if (admissionTerminal !== id) gates.add(id);
          if (!running) { opm.stop(id); gates.delete(id); return; }
        }
      }
      timer = setTimeout(pump, interval * 1000);
    } catch (error) {
      stop(false);
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return {
    get running() { return running; },
    start() {
      if (disposed) return Promise.reject(new Error('Lookahead scheduler is disposed'));
      if (starting) return starting;
      if (running) return Promise.resolve();
      const token = generation;
      const pending = opm.start().then(() => {
        if (disposed || token !== generation) return;
        running = true;
        observers.add(observe);
        cursor = opm.context!.currentTime;
        pump();
      });
      starting = pending;
      const clear = () => { if (starting === pending) starting = null; };
      pending.then(clear, clear);
      return pending;
    },
    stop,
    dispose() { disposed = true; stop(); },
  };
}
