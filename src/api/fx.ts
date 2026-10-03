import { effectsData, normalizeEffectsOptions } from '../core/fx.js';
import type { StereoEffectsOptions } from '../core/fx.js';

export interface EffectsEvent { type: 'error'; error: Error }
export interface EffectsOptions { workletUrl?: string | URL; params?: StereoEffectsOptions; onEvent?: (event: EffectsEvent) => void }
export interface OpmEffects {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Resolves once the module/node have been created; context playback is host-owned. */
  readonly ready: Promise<void>;
  update(params: StereoEffectsOptions): void;
  reset(): void;
  dispose(): void;
}
/** Optional stereo effect insert. Does not connect, resume, suspend or close the host context. */
export async function createEffects(context: BaseAudioContext, options: EffectsOptions = {}): Promise<OpmEffects> {
  const data = effectsData(options, ['workletUrl', 'params', 'onEvent'], 'effects options');
  if (data.onEvent !== undefined && typeof data.onEvent !== 'function') throw new TypeError('onEvent must be a function');
  const observer = data.onEvent as EffectsOptions['onEvent'];
  const emit = (error: Error) => { try { observer?.(Object.freeze({ type: 'error', error })); } catch { /* Host callbacks cannot break cleanup. */ } };
  let node: AudioWorkletNode | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!node) return;
    node.onprocessorerror = null; node.port.onmessage = null; node.port.onmessageerror = null;
    try { node.port.postMessage({ type: 'close' }); } catch { /* Release local resources even after port failure. */ }
    try { node.disconnect(); } catch { /* Already disconnected. */ }
    node.port.close();
  };
  try {
    const params = normalizeEffectsOptions(data.params === undefined ? {} : data.params as StereoEffectsOptions);
    const page = typeof globalThis.location === 'object' ? new URL(globalThis.location.href) : null;
    if (globalThis.isSecureContext === false) throw new Error('AudioWorklet requires a secure context (HTTPS or localhost)');
    const input = data.workletUrl;
    if (input !== undefined && (typeof input !== 'string' && !(input instanceof URL))) throw new TypeError('workletUrl must be a string or URL');
    if (input !== undefined && !page) throw new Error('workletUrl requires a browser origin');
    const url = input === undefined ? new URL('../worklet/fx-processor.js', import.meta.url) : new URL(input as string | URL, page!.href);
    if (page) {
      const loopback = page.hostname === 'localhost' || page.hostname.endsWith('.localhost') || page.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(page.hostname);
      if (page.protocol !== 'https:' && !(page.protocol === 'http:' && loopback)) throw new Error('AudioWorklet requires HTTPS or loopback HTTP');
      if (input !== undefined && (url.origin !== page.origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)) throw new Error('workletUrl must be a same-origin HTTP(S) module without credentials or a fragment');
    }
    if (typeof globalThis.AudioWorkletNode !== 'function' || !context?.audioWorklet) throw new Error('AudioWorklet is unavailable; use createStereoEffects offline');
    if (context.state === 'closed') throw new Error('The provided AudioContext is closed');
    // Native module loading retains browser CSP, JavaScript MIME and import-tree checks.
    await context.audioWorklet.addModule(url);
    node = new AudioWorkletNode(context, 'opm-effects-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions: { params } });
    const fail = (error: Error) => { dispose(); emit(error); };
    node.onprocessorerror = () => fail(new Error('Effects AudioWorklet processor failed'));
    node.port.onmessageerror = () => fail(new Error('Effects AudioWorklet message could not be decoded'));
    node.port.onmessage = event => {
      try {
        const reply = effectsData(event.data, ['type', 'reason'], 'effects reply');
        if (reply.type === 'error' && typeof reply.reason === 'string' && ['invalid-message', 'message-rate', 'message-decode'].includes(reply.reason)) emit(new Error(`Effects AudioWorklet: ${reply.reason}`));
      } catch { /* Ignore malformed replies. */ }
    };
    const post = (message: unknown) => {
      if (disposed) throw new Error('Effects are disposed');
      try { node!.port.postMessage(message); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); throw error; }
    };
    return Object.freeze({ input: node, output: node, ready: Promise.resolve(), update(params: StereoEffectsOptions) { post({ type: 'update', params: normalizeEffectsOptions(params) }); }, reset() { post({ type: 'reset' }); }, dispose });
  } catch (error) { dispose(); emit(error instanceof Error ? error : new Error(String(error))); throw error; }
}
