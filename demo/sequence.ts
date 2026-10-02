import { OPM, playSequence } from '../src/api/index.js';
import type { OPMEvent, SequenceEvent, TuningOptions } from '../src/api/index.js';
import { renderSequence, encodeWav } from '../src/core/index.js';
import { brass } from '../src/voices/brass.js';
import type { LFO, Voice } from '../src/voices/schema.js';

const status = document.querySelector<HTMLOutputElement>('#status')!;
const log = document.querySelector<HTMLPreElement>('#events')!;
const diagnostics = document.querySelector<HTMLOutputElement>('#diagnostics')!;
const download = document.querySelector<HTMLAnchorElement>('#download')!;
const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const select = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
const liveButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-live]')];
const events: Record<string, unknown>[] = [];
const gates = new Set<number>();
let opm: OPM | null = null;
let context: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let gain: GainNode | null = null;
let pcm: Float32Array<ArrayBuffer> | null = null;
let wavURL: string | null = null;
let busy = false;
let leaving = false;
let timer: ReturnType<typeof setInterval> | undefined;

const score: readonly SequenceEvent[] = [
  { type: 'note', id: 1, voice: 'lead', note: 60.5, time: 0, duration: 0.5, pan: -0.5 },
  { type: 'note', id: 2, voice: 'lead', note: 64, time: 0.125, duration: 0.5, pan: 0.5 },
  { type: 'note', id: 3, voice: 'lead', note: 67, time: 0.25, duration: 0.5 },
  { type: 'control', id: 1, time: 0.1, controls: { expression: 0.4, ramp: 0.02 } },
  { type: 'control', id: 2, time: 0.2, controls: { pitch: 0.5, glide: 0.04 } },
  { type: 'control', id: 3, time: 0.4, controls: { modulation: 0.25, ramp: 0.02 } },
  { type: 'stop', id: 1, time: 0.35 },
];

function patch(): Voice {
  return { ...brass, lfo: { rate: 5, amDepth: 0.15, pmDepth: 20,
    waveform: select('waveform').value as LFO['waveform'] } };
}
function tuning(): TuningOptions {
  const offsets = Array<number>(128).fill(0);
  offsets[60] = input('cents').valueAsNumber;
  return { referenceHz: input('reference').valueAsNumber, offsets };
}
function record(event: Record<string, unknown>): void {
  events.push({ observedAt: performance.now(), ...event });
  if (events.length > 512) events.shift();
  log.textContent = events.slice(-12).map(value => JSON.stringify(value)).join('\n');
}
function receive(event: OPMEvent): void {
  if (event.type === 'note') {
    if (event.state === 'accepted') gates.add(event.id);
    if (['released', 'ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) gates.delete(event.id);
  } else if (event.type === 'reset') gates.clear();
  record(event.type === 'error' ? { type: 'error', message: event.error.message } : { ...event });
  update();
}
function update(): void {
  const ready = Boolean(opm?.node && context?.state === 'running');
  for (const button of liveButtons) button.disabled = busy || leaving ||
    (button.id === 'dispose' ? !opm?.node : !ready);
  document.querySelector<HTMLButtonElement>('#start')!.disabled = busy || leaving;
  select('interruption').disabled = Boolean(opm?.node);
  select('stealing').disabled = Boolean(opm?.node);
}
async function action(fn: () => void | Promise<void>): Promise<void> {
  if (busy || leaving) return;
  busy = true;
  update();
  try { await fn(); }
  catch (error) { status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`; }
  finally { busy = false; update(); }
}
function revokeWav(): void {
  if (wavURL) URL.revokeObjectURL(wavURL);
  wavURL = null;
  download.hidden = true;
  download.removeAttribute('href');
}
function bind(id: string, fn: () => void | Promise<void>): void {
  document.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener('click', () => { void action(fn); });
}

bind('start', async () => {
  if (!context) {
    context = new AudioContext();
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    pcm = new Float32Array(analyser.fftSize);
    gain = context.createGain();
    gain.gain.value = 0.15;
    analyser.connect(gain).connect(context.destination);
  }
  // Begin resume in the trusted handler; a timer must never bypass autoplay policy.
  const resume = context.resume();
  if (!opm) opm = new OPM({ context, destination: analyser, mixGain: input('mix-gain').valueAsNumber,
    tuning: tuning(), stealing: select('stealing').value as 'oldest' | 'release-first' | 'quietest',
    interruption: select('interruption').value as 'cancel' | 'preserve', onEvent: receive });
  await resume;
  await opm.start();
  status.textContent = 'Running. Policy/stealing are fixed until Dispose; Resume never restarts old score playback.';
  if (!timer) timer = setInterval(() => {
    if (!analyser || !pcm) return;
    analyser.getFloatTimeDomainData(pcm);
    let peak = 0;
    for (const value of pcm) peak = Math.max(peak, Math.abs(value));
    diagnostics.textContent = `Context ${context?.state}; held gates ${gates.size}; recent analyser peak ${peak.toFixed(6)}. Not an underrun counter.`;
  }, 250);
});
bind('play', () => {
  opm!.loadVoice('lead', patch());
  opm!.setTuning(tuning());
  opm!.setMixGain(input('mix-gain').valueAsNumber);
  const playback = playSequence(opm!, score, { at: context!.currentTime + 0.05 });
  status.textContent = `Shared score admitted: ${[...playback.ids.values()].join(', ')}. Watch command/note events for rejection.`;
});
bind('hold', () => {
  opm!.loadVoice('lead', patch());
  const held = opm!.playNote({ voice: 'lead', note: 60.5 });
  const future = opm!.playNote({ voice: 'lead', note: 67, time: 5 });
  status.textContent = `Held #${held}; future #${future} at +5 seconds. Try interruption, release all, or panic.`;
});
bind('controls', () => {
  opm!.setMixGain(input('mix-gain').valueAsNumber);
  opm!.setTuning(tuning());
  for (const id of gates) opm!.updateNote(id, { expression: input('expression').valueAsNumber,
    pan: input('pan').valueAsNumber, modulation: input('modulation').valueAsNumber, ramp: input('ramp').valueAsNumber });
  status.textContent = 'Controls submitted; ramp affects expression/pan/modulation, not pitch glide.';
});
bind('chord', () => {
  opm!.loadVoice('lead', patch());
  for (let index = 0; index < 12; index++) opm!.playNote({ voice: 'lead', note: 48 + index * 2,
    velocity: (index + 1) / 12, duration: index < 4 ? 0.03 : 1 });
  status.textContent = '12-note burst; eight logical voices, selected stealing policy, bounded fading tails.';
});
bind('release', () => { opm!.allNotesOff(); status.textContent = 'All pending events cancelled; active gates released, tails retained.'; });
bind('panic', () => { opm!.panic(); status.textContent = 'Panic submitted: immediate silence and reset, patch cache/routing retained.'; });
bind('suspend', async () => { await context!.suspend(); status.textContent = 'Host suspended. Click Start / resume in a user gesture.'; });
bind('dispose', async () => {
  await opm!.close();
  opm = null;
  status.textContent = `Synth disposed; borrowed context is still ${context!.state}. Start creates a fresh node.`;
});
bind('render', () => {
  revokeWav();
  const audio = renderSequence(score, { voices: new Map([['lead', patch()]]), sampleRate: context?.sampleRate ?? 48000,
    mixGain: input('mix-gain').valueAsNumber, tuning: tuning(),
    stealing: select('stealing').value as 'oldest' | 'release-first' | 'quietest' });
  const bytes = encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate });
  wavURL = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
  download.href = wavURL;
  download.download = 'opm-sequence.wav';
  download.hidden = false;
  status.textContent = `Same score rendered: ${audio.left.length} stereo frames, ${audio.sampleRate} Hz, ${bytes.length} WAV bytes; DSP errors ${audio.diagnostics.errors}.`;
});
bind('report', () => {
  const checks = [...document.querySelectorAll<HTMLInputElement>('[data-check]')].map(check => ({
    scenario: check.dataset.check, manuallyConfirmed: check.checked,
  }));
  const report = { userAgent: navigator.userAgent, sampleRate: context?.sampleRate ?? null,
    policy: select('interruption').value, checks, events: [...events],
    limitations: 'Local user-entered observations; not automated physical-device, audio-glitch, CPU or hearing certification.' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'opm-device-observations.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Local observations exported; unchecked physical scenarios remain unverified. Nothing was uploaded.';
});
document.addEventListener('visibilitychange', () => record({ type: 'visibility', state: document.visibilityState }));
window.addEventListener('pagehide', () => {
  leaving = true;
  clearInterval(timer);
  timer = undefined;
  revokeWav();
  const instance = opm, host = context;
  opm = null;
  context = null;
  gates.clear();
  analyser?.disconnect();
  gain?.disconnect();
  analyser = null;
  gain = null;
  pcm = null;
  // The page owns its context. OPM itself never closes a borrowed context.
  void instance?.close().catch(error => record({ type: 'cleanup-error', message: String(error) }));
  void host?.close().catch(error => record({ type: 'cleanup-error', message: String(error) }));
  update();
});
window.addEventListener('pageshow', () => { leaving = false; update(); });
status.textContent = 'Ready. Start audio only from a user gesture; use a comfortable volume.';
update();
