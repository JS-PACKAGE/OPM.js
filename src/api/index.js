import { normalizeVoice } from '../core/synth.js';
import { brass } from '../voices/brass.js';

const MAX_DURATION = 60;

/** Browser-facing facade. Import Synth from ../core/synth.js for offline rendering. */
export class OPM {
  constructor({ sampleRate } = {}) {
    if (sampleRate !== undefined && (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000)) {
      throw new RangeError('sampleRate must be an integer in 8000..96000');
    }
    this.sampleRate = sampleRate;
    this.voices = new Map([['brass', normalizeVoice(brass)]]);
    this.context = null;
    this.node = null;
    this.nextId = 1;
  }

  loadVoice(name, voice) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new TypeError('Invalid voice name');
    this.voices.set(name, normalizeVoice(voice));
  }

  async start() {
    if (this.node) return;
    if (typeof globalThis.AudioContext !== 'function' || typeof globalThis.AudioWorkletNode !== 'function') {
      throw new Error('AudioWorklet is not available in this environment; use Synth for offline rendering');
    }
    const context = new AudioContext(this.sampleRate === undefined ? undefined : { sampleRate: this.sampleRate });
    try {
      await context.audioWorklet.addModule(new URL('../worklet/processor.js', import.meta.url));
      const node = new AudioWorkletNode(context, 'opm-processor', { outputChannelCount: [2] });
      node.connect(context.destination);
      await context.resume();
      this.context = context;
      this.node = node;
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  playNote({ voice = 'brass', note, time = 0, duration } = {}) {
    if (!this.node) throw new Error('Call start() before playNote()');
    const patch = typeof voice === 'string' ? this.voices.get(voice) : normalizeVoice(voice);
    if (!patch) throw new RangeError('Unknown voice');
    if (!Number.isInteger(note) || note < 0 || note > 127) throw new RangeError('note must be a MIDI integer in 0..127');
    if (!Number.isFinite(time) || time < 0 || time > MAX_DURATION) throw new RangeError('time must be a delay in 0..60 seconds');
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) throw new RangeError('duration must be in (0, 60] seconds');
    if (this.nextId === Number.MAX_SAFE_INTEGER) this.nextId = 1;
    const id = this.nextId++;
    this.node.port.postMessage({ type: 'noteOn', id, voice: patch, note, at: this.context.currentTime + time, duration });
    return id;
  }

  stop(id) {
    if (!this.node) throw new Error('Call start() before stop()');
    if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('Invalid note id');
    this.node.port.postMessage({ type: 'noteOff', id });
  }

  async close() {
    if (!this.context) return;
    this.node.disconnect();
    await this.context.close();
    this.node = null;
    this.context = null;
  }
}
