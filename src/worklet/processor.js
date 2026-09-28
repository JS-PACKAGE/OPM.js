import { Synth } from '../core/synth.js';
import { normalizeVoice } from '../voices/normalize.js';

const MAX_PENDING_EVENTS = 256;
const MAX_DURATION = 60;
const NOTE_ON_KEYS = ['type', 'id', 'voice', 'note', 'at', 'duration'];
const NOTE_OFF_KEYS = ['type', 'id'];
function isMessage(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const type = Object.getOwnPropertyDescriptor(data, 'type');
  if (!type || !Object.hasOwn(type, 'value')) return false;
  const keys = type.value === 'noteOn' ? NOTE_ON_KEYS : NOTE_OFF_KEYS;
  if (Reflect.ownKeys(data).length !== keys.length) return false;
  for (let index = 0; index < keys.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(data, keys[index]);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}


class OPMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = new Synth(sampleRate);
    this.events = [];
    this.port.onmessage = (event) => this.receive(event.data);
  }

  insert(event) {
    let index = this.events.length;
    while (index > 0 && this.events[index - 1].frame > event.frame) index--;
    this.events.splice(index, 0, event);
  }

  receive(data) {
    if (!isMessage(data)) return;
    if (data.type === 'noteOff') {
      if (!Number.isSafeInteger(data.id) || data.id <= 0) return;
      // A note cancelled before its start must not sound later.
      let kept = 0;
      for (let index = 0; index < this.events.length; index++) {
        const event = this.events[index];
        if (event.id !== data.id) this.events[kept++] = event;
      }
      this.events.length = kept;
      this.synth.noteOff(data.id);
      return;
    }
    if (data.type !== 'noteOn' || this.events.length > MAX_PENDING_EVENTS - 2) return;
    if (!Number.isSafeInteger(data.id) || data.id <= 0 || !Number.isInteger(data.note) || data.note < 0 || data.note > 127 ||
        !Number.isFinite(data.at) || data.at < 0 || !Number.isFinite(data.duration) || data.duration <= 0 || data.duration > MAX_DURATION) return;

    try {
      const voice = normalizeVoice(data.voice);
      const frame = Math.round(data.at * sampleRate);
      const end = Math.round((data.at + data.duration) * sampleRate);
      if (!Number.isSafeInteger(frame) || !Number.isSafeInteger(end)) return;
      this.insert({ type: 'noteOn', id: data.id, note: data.note, voice, frame });
      this.insert({ type: 'noteOff', id: data.id, frame: Math.max(end, frame + 1) });
    } catch {
      // Ignore malformed messages rather than throwing on the audio thread.
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    const start = currentFrame;
    let consumed = 0;
    let position = 0;
    while (position < left.length) {
      const next = this.events[consumed];
      if (next && next.frame <= start + position) {
        consumed++;
        if (next.type === 'noteOn') {
          try {
            this.synth.noteOn(next.voice, next.note, next.id);
          } catch {
            // A duplicate or invalid ID cannot terminate the audio processor.
          }
        } else this.synth.noteOff(next.id);
        continue;
      }
      const length = next ? Math.min(left.length - position, next.frame - start - position) : left.length - position;
      this.synth.render(left, right, position, length);
      position += length;
    }
    if (consumed !== 0) this.events.splice(0, consumed);
    return true;
  }
}

registerProcessor('opm-processor', OPMProcessor);
