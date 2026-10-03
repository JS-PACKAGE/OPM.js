import './worklet-globals.js';
import { createStereoEffects, effectsData, normalizeEffectsOptions } from '../core/fx.js';
import type { StereoEffects, StereoEffectsOptions } from '../core/fx.js';

export type EffectsMessage = { type: 'update'; params: Readonly<StereoEffectsOptions> } | { type: 'reset' | 'close' };
/** Strict bounded protocol: no queued commands or unvalidated DSP parameters. */
export function validateEffectsMessage(raw: unknown): EffectsMessage {
  const data = effectsData(raw, ['type', 'params'], 'effects message');
  if (data.type === 'update' && Object.hasOwn(data, 'params')) return { type: 'update', params: normalizeEffectsOptions(data.params as StereoEffectsOptions) };
  if ((data.type === 'reset' || data.type === 'close') && !Object.hasOwn(data, 'params')) return { type: data.type };
  throw new TypeError('Invalid effects message');
}
export class EffectsProcessor extends AudioWorkletProcessor {
  private effects: StereoEffects | null;
  private messages = 0;
  private messageFrame = -1;
  constructor(options: AudioWorkletNodeOptions = {}) {
    super();
    const data = effectsData(options, ['processorOptions', 'numberOfInputs', 'numberOfOutputs', 'outputChannelCount', 'channelCount', 'channelCountMode', 'channelInterpretation', 'parameterData'], 'worklet options');
    const settings = data.processorOptions === undefined ? {} : effectsData(data.processorOptions, ['params'], 'effects processor options');
    this.effects = createStereoEffects(sampleRate, settings.params === undefined ? {} : settings.params as StereoEffectsOptions);
    this.port.onmessage = event => this.receive(event.data);
    this.port.onmessageerror = () => this.port.postMessage({ type: 'error', reason: 'message-decode' });
  }
  receive(raw: unknown): void {
    if (!this.effects) return;
    if (this.messageFrame !== currentFrame) { this.messageFrame = currentFrame; this.messages = 0; }
    const report = this.messages < 32;
    if (this.messages === 32) this.port.postMessage({ type: 'error', reason: 'message-rate' });
    if (this.messages < 33) this.messages++;
    try {
      // Close remains available under flooding, without a command queue.
      const envelope = effectsData(raw, ['type', 'params'], 'effects message');
      if (envelope.type === 'close') { validateEffectsMessage(envelope); this.effects.reset(); this.effects = null; this.port.close(); return; }
      if (!report) return;
      const message = validateEffectsMessage(envelope);
      if (message.type === 'update') this.effects.update(message.params);
      else this.effects.reset();
    } catch { if (report) this.port.postMessage({ type: 'error', reason: 'invalid-message' }); }
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.effects) return false;
    const output = outputs[0];
    if (!output || !output[0] || !output[1]) return true;
    const left = output[0], right = output[1], input = inputs[0];
    const sourceL = input?.[0], sourceR = input?.[1] ?? sourceL;
    for (let i = 0; i < left.length; i++) { left[i] = sourceL?.[i] ?? 0; right[i] = sourceR?.[i] ?? 0; }
    this.effects.process(left, right);
    return true;
  }
}
registerProcessor('opm-effects-processor', EffectsProcessor);
