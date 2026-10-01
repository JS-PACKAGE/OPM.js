import { normalizeVoice } from '../voices/normalize.js';
import { brass } from '../voices/brass.js';

const MAX_DURATION = 60;
const MAX_DIAGNOSTICS_REQUESTS = 64;
const NOTE_STATES = ['accepted', 'started', 'released', 'ended', 'stolen', 'cancelled', 'rejected'];

function replyData(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const type = Object.getOwnPropertyDescriptor(data, 'type');
  if (!type || !Object.hasOwn(type, 'value')) return null;
  const required = type.value === 'note' ? ['type', 'id', 'state']
    : type.value === 'diagnostics' ? ['type', 'requestId', 'activeVoices', 'pendingEvents', 'errors', 'rejectedNotes'] : null;
  if (!required) return null;
  const result = {};
  for (const key of Reflect.ownKeys(data)) {
    if (!required.includes(key) && !(type.value === 'note' && key === 'reason')) return null;
    const descriptor = Object.getOwnPropertyDescriptor(data, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(result, key)) return null;
  if (result.type === 'note') {
    if (!Number.isSafeInteger(result.id) || result.id <= 0 || !NOTE_STATES.includes(result.state) ||
        (Object.hasOwn(result, 'reason') && typeof result.reason !== 'string')) return null;
  } else {
    if (!Number.isSafeInteger(result.requestId) || result.requestId <= 0) return null;
    for (const key of ['activeVoices', 'pendingEvents', 'errors', 'rejectedNotes']) {
      if (!Number.isSafeInteger(result[key]) || result[key] < 0) return null;
    }
  }
  return result;
}

/** Browser-facing facade. Import Synth from ../core/synth.js for offline rendering. */
export class OPM {
  constructor({ sampleRate, context, destination, onEvent } = {}) {
    if (sampleRate !== undefined && (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000)) {
      throw new RangeError('sampleRate must be an integer in 8000..96000');
    }
    if (context !== undefined && (context === null || typeof context !== 'object' ||
        typeof context.resume !== 'function' || typeof context.audioWorklet?.addModule !== 'function')) {
      throw new TypeError('context must be an AudioContext with AudioWorklet support');
    }
    if (onEvent !== undefined && typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
    this.sampleRate = sampleRate;
    this.voices = new Map([['brass', normalizeVoice(brass)]]);
    this.context = context ?? null;
    this.node = null;
    this.nextId = 1;
    this.onEvent = onEvent;
    this._providedContext = context ?? null;
    this._destination = destination;
    this._startPromise = null;
    this._closePromise = null;
    this._processorFailure = null;
    this._diagnostics = new Map();
    this._nextRequestId = 1;
  }

  loadVoice(name, voice) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new TypeError('Invalid voice name');
    this.voices.set(name, normalizeVoice(voice));
  }

  _emit(event) {
    try { this.onEvent?.(event); } catch { /* Host callbacks cannot break audio lifecycle handling. */ }
  }

  _rejectDiagnostics(error) {
    for (const request of this._diagnostics.values()) request.reject(error);
    this._diagnostics.clear();
  }

  _disposeNode(node) {
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

  _handleFailure(node, error) {
    if (this.node !== node) return;
    this._processorFailure = error;
    this.node = null;
    this._rejectDiagnostics(error);
    this._disposeNode(node);
    this._emit({ type: 'error', error });
  }

  _receive(raw) {
    let event;
    try { event = replyData(raw); } catch { return; }
    if (!event) return;
    if (event.type === 'diagnostics') {
      const request = this._diagnostics.get(event.requestId);
      if (request) {
        this._diagnostics.delete(event.requestId);
        request.resolve(event);
      }
    }
    this._emit(event);
  }

  start() {
    if (this._closePromise) return this._closePromise.then(() => this.start());
    if (this._startPromise) return this._startPromise;
    const promise = Promise.resolve().then(() => this._start());
    this._startPromise = promise;
    const clear = () => { if (this._startPromise === promise) this._startPromise = null; };
    promise.then(clear, clear);
    return promise;
  }

  async _start() {
    if (this.context?.state === 'closed') {
      this._disposeNode(this.node);
      this.node = null;
      if (this._providedContext) throw new Error('The provided AudioContext is closed');
      this.context = null;
    }
    this._processorFailure = null;
    if (this.node) {
      const node = this.node;
      try {
        await this.context.resume();
        if (this._processorFailure || this.node !== node) throw this._processorFailure ?? new Error('AudioWorklet stopped');
      } catch (error) {
        this._rejectDiagnostics(error);
        throw error;
      }
      return;
    }
    if (typeof globalThis.AudioWorkletNode !== 'function' ||
        (!this._providedContext && typeof globalThis.AudioContext !== 'function')) {
      throw new Error('AudioWorklet is not available in this environment; use Synth for offline rendering');
    }
    const context = this.context ?? new globalThis.AudioContext(this.sampleRate === undefined ? undefined : { sampleRate: this.sampleRate });
    this.context = context;
    let node = null;
    try {
      await context.audioWorklet.addModule(new URL('../worklet/processor.js', import.meta.url));
      node = new globalThis.AudioWorkletNode(context, 'opm-processor', { outputChannelCount: [2] });
      this.node = node;
      node.port.onmessage = (event) => { if (this.node === node) this._receive(event.data); };
      node.port.onmessageerror = () => this._handleFailure(node, new Error('AudioWorklet message could not be decoded'));
      node.onprocessorerror = () => this._handleFailure(node, new Error('AudioWorklet processor failed'));
      if (typeof context.addEventListener === 'function') {
        const listener = () => {
          if (context.state === 'closed') this._handleFailure(node, new Error('AudioContext is closed'));
          else if (context.state !== 'running') this._rejectDiagnostics(new Error('AudioContext is not running; call resume() before getDiagnostics()'));
        };
        context.addEventListener('statechange', listener);
        this._contextListener = { context, node, listener };
      }
      const destination = this._destination === undefined ? context.destination : this._destination;
      if (destination !== null) node.connect(destination);
      await context.resume();
      if (this._processorFailure || this.node !== node) throw this._processorFailure ?? new Error('AudioWorklet stopped');
    } catch (error) {
      if (this.node === node) {
        this.node = null;
        this._disposeNode(node);
      }
      this._rejectDiagnostics(error);
      if (!this._providedContext) {
        this.context = null;
        try { await context.close(); } catch { /* Preserve the initialization failure. */ }
      }
      throw error;
    }
  }

  resume() {
    return this.start();
  }

  _requireNode() {
    if (this._processorFailure) throw this._processorFailure;
    if (!this.node || this._closePromise || this.context?.state === 'closed') throw new Error('Call start() before using the audio node');
    return this.node;
  }

  connect(destination) {
    this._requireNode().connect(destination);
    return this;
  }

  disconnect(destination) {
    const node = this._requireNode();
    if (destination === undefined) node.disconnect();
    else node.disconnect(destination);
    return this;
  }

  playNote({ voice = 'brass', note, time = 0, duration = null, velocity = 1, pan = 0 } = {}) {
    const node = this._requireNode();
    const patch = typeof voice === 'string' ? this.voices.get(voice) : normalizeVoice(voice);
    if (!patch) throw new RangeError('Unknown voice');
    if (!Number.isInteger(note) || note < 0 || note > 127) throw new RangeError('note must be a MIDI integer in 0..127');
    if (!Number.isFinite(time) || time < 0 || time > MAX_DURATION) throw new RangeError('time must be a delay in 0..60 seconds');
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION)) {
      throw new RangeError('duration must be null or in (0, 60] seconds');
    }
    if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1) throw new RangeError('velocity must be in 0..1');
    if (!Number.isFinite(pan) || pan < -1 || pan > 1) throw new RangeError('pan must be in -1..1');
    if (!Number.isSafeInteger(this.nextId) || this.nextId <= 0) throw new RangeError('Note ID space exhausted');
    const id = this.nextId++;
    node.port.postMessage({ type: 'noteOn', id, voice: patch, note, at: this.context.currentTime + time, duration, velocity, pan });
    return id;
  }

  stop(id) {
    const node = this._requireNode();
    if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('Invalid note id');
    node.port.postMessage({ type: 'noteOff', id });
  }

  getDiagnostics() {
    let node;
    try {
      node = this._requireNode();
      if (this.context.state !== undefined && this.context.state !== 'running') {
        throw new Error('AudioContext is not running; call resume() before getDiagnostics()');
      }
      if (this._diagnostics.size >= MAX_DIAGNOSTICS_REQUESTS) throw new Error('Too many pending diagnostics requests');
      if (!Number.isSafeInteger(this._nextRequestId) || this._nextRequestId <= 0) throw new RangeError('Diagnostics request ID space exhausted');
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = this._nextRequestId++;
    return new Promise((resolve, reject) => {
      this._diagnostics.set(requestId, { resolve, reject });
      try {
        node.port.postMessage({ type: 'diagnostics', requestId });
      } catch (error) {
        this._diagnostics.delete(requestId);
        reject(error);
      }
    });
  }

  close() {
    if (this._closePromise) return this._closePromise;
    this._rejectDiagnostics(new Error('OPM is closed'));
    const promise = Promise.resolve().then(() => this._close());
    this._closePromise = promise;
    const clear = () => { if (this._closePromise === promise) this._closePromise = null; };
    promise.then(clear, clear);
    return promise;
  }

  async _close() {
    if (this._startPromise) {
      try { await this._startPromise; } catch { /* Initialization already releases failed resources. */ }
    }
    const node = this.node;
    const context = this.context;
    this.node = null;
    this.context = this._providedContext;
    this._processorFailure = null;
    this._rejectDiagnostics(new Error('OPM is closed'));
    this._disposeNode(node);
    if (context && !this._providedContext && context.state !== 'closed') await context.close();
  }
}
