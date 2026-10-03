import { OPM, VERSION, playSequence, streamSequence, createTransport, createPerformance, renderSequenceInWorker } from '../src/api/index.js';
import type { OPMEvent, SequenceEvent, SequenceStream, TuningOptions, MusicalTransport, Performance } from '../src/api/index.js';
import { renderSequence, renderSequenceChunks, estimateSequenceCapacity, encodeWav } from '../src/core/index.js';
import type { QualityProfile, WavFormat } from '../src/core/index.js';
import { brass } from '../src/voices/brass.js';
import type { LFO, Voice } from '../src/voices/schema.js';
import { installAcceptanceHarness } from './mobile-acceptance.js';

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
let stream: SequenceStream | null = null;
let cancelRender = false;
let transport: MusicalTransport | null = null;
let performance: Performance | null = null;
const physicalKeys: number[] = [];
let workerAbort: AbortController | null = null;
let sessionSettings: { mixGain: number; tuning: TuningOptions; stealing: 'oldest' | 'release-first' | 'quietest' } | null = null;

const beatScore = [
  { type: 'note' as const, id: 1, voice: 'lead', note: 60, beat: 0, duration: 3 },
  { type: 'note' as const, id: 2, voice: 'lead', note: 64, beat: 2, duration: 3 },
  { type: 'control' as const, id: 1, beat: 1, controls: { expression: 0.5, ramp: 0.04 } },
  { type: 'note' as const, id: 3, voice: 'lead', note: 67, beat: 4, duration: 3 },
];

const score: readonly SequenceEvent[] = [
  { type: 'note', id: 1, voice: 'lead', note: 60.5, time: 0, duration: 0.5, pan: -0.5 },
  { type: 'note', id: 2, voice: 'lead', note: 64, time: 0.125, duration: 0.5, pan: 0.5 },
  { type: 'note', id: 3, voice: 'lead', note: 67, time: 0.25, duration: 0.5 },
  { type: 'control', id: 1, time: 0.1, controls: { expression: 0.4, ramp: 0.02 } },
  { type: 'control', id: 2, time: 0.2, controls: { pitch: 0.5, glide: 0.04 } },
  { type: 'control', id: 3, time: 0.4, controls: { modulation: 0.25, ramp: 0.02 } },
  { type: 'stop', id: 1, time: 0.35 },
];

const longScore: readonly SequenceEvent[] = [
  ...Array.from({ length: 60 }, (_, index): SequenceEvent[] => [
    { type: 'note', id: index + 1, voice: 'lead', note: 60 + index % 7, time: index, duration: index === 59 ? 1 : 0.9 },
    { type: 'control', id: index + 1, time: index + 0.2, controls: { pan: index % 2 ? -0.5 : 0.5, ramp: 0.05 } },
    { type: 'stop', id: index + 1, time: index + (index === 59 ? 1 : 0.8) },
  ]).flat(),
  { type: 'control', id: 100, time: 0, controls: { expression: 0.2 } },
  { type: 'stop', id: 100, time: 0.1 },
  { type: 'note', id: 100, voice: 'lead', note: 72, time: 0.2, duration: 0.2 },
];

const acceptance = installAcceptanceHarness({
  sampleRate: () => context?.sampleRate ?? null,
  policy: () => select('interruption').value as 'cancel' | 'preserve',
  ready: () => Boolean(opm?.node && context?.state === 'running' && !busy),
  packageVersion: VERSION,
  begin: () => {
    stream?.dispose();
    stream = null;
    stopOwnedPlayback();
    opm!.panic();
    opm!.loadVoice('lead', patch());
    const held = opm!.playNote({ voice: 'lead', note: 60.5 });
    const future = opm!.playNote({ voice: 'lead', note: 67, time: 5 });
    record({ type: 'acceptance-stimulus', held, future, futureDelaySeconds: 5 });
    return { revision: 'held-plus-five-second-v1', patch: opm!.voices.get('lead'),
      synth: { quality: opm!.quality, maxVoices: opm!.maxVoices, ...sessionSettings },
      hostGain: gain!.gain.value, stimulus: { heldNote: 60.5, futureNote: 67, futureDelaySeconds: 5, velocity: 1 } };
  },
  end: () => { opm?.panic(); },
});

function patch(): Voice {
  return { ...brass, lfo: { rate: 5, amDepth: 0.15, pmDepth: 20,
    waveform: select('waveform').value as LFO['waveform'] } };
}
function tuning(): TuningOptions {
  const offsets = Array<number>(128).fill(0);
  offsets[60] = input('cents').valueAsNumber;
  return { referenceHz: input('reference').valueAsNumber, offsets };
}
function applySessionSettings(): void {
  const mixGain = input('mix-gain').valueAsNumber, currentTuning = tuning();
  opm!.setMixGain(mixGain);
  sessionSettings = { ...sessionSettings!, mixGain };
  opm!.setTuning(currentTuning);
  sessionSettings = { ...sessionSettings!, tuning: currentTuning };
}
function record(event: Record<string, unknown>): void {
  events.push(acceptance.record(event));
  if (events.length > 512) events.shift();
  log.textContent = events.slice(-12).map(value => JSON.stringify(value)).join('\n');
}
function receive(event: OPMEvent): void {
  if (event.type === 'note') {
    if (event.state === 'accepted') gates.add(event.id);
    if (['released', 'ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) gates.delete(event.id);
  } else if (event.type === 'reset') { gates.clear(); physicalKeys.length = 0; }
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
  select('quality').disabled = Boolean(opm?.node);
}
async function action(fn: () => void | Promise<void>): Promise<void> {
  if (busy || leaving) return;
  busy = true;
  update();
  try { await fn(); }
  catch (error) {
    record({ type: 'action-error', message: error instanceof Error ? error.message : String(error) });
    status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  finally { busy = false; update(); }
}
function revokeWav(): void {
  if (wavURL) URL.revokeObjectURL(wavURL);
  wavURL = null;
  download.hidden = true;
  download.removeAttribute('href');
}
function bind(id: string, fn: () => void | Promise<void>): void {
  document.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener('click', () => {
    record({ type: 'user-action', action: id });
    void action(fn);
  });
}

bind('start', async () => {
  if (!context) {
    context = new AudioContext();
    context.addEventListener('statechange', () => record({ type: 'context-state', state: context?.state ?? 'closed' }));
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    pcm = new Float32Array(analyser.fftSize);
    gain = context.createGain();
    gain.gain.value = 0.15;
    analyser.connect(gain).connect(context.destination);
  }
  // Begin resume in the trusted handler; a timer must never bypass autoplay policy.
  const resume = context.resume();
  if (!opm) {
    sessionSettings = { mixGain: input('mix-gain').valueAsNumber, tuning: tuning(),
      stealing: select('stealing').value as 'oldest' | 'release-first' | 'quietest' };
    opm = new OPM({ context, destination: analyser, ...sessionSettings,
      interruption: select('interruption').value as 'cancel' | 'preserve',
      quality: select('quality').value as QualityProfile, onEvent: receive });
  }
  await resume;
  await opm.start();
  record({ type: 'audio-ready', sampleRate: context.sampleRate, policy: select('interruption').value });
  status.textContent = 'Running. Policy/stealing are fixed until Dispose; Resume never restarts old score playback.';
  if (!timer) timer = setInterval(() => {
    if (!analyser || !pcm) return;
    analyser.getFloatTimeDomainData(pcm);
    let peak = 0;
    for (const value of pcm) peak = Math.max(peak, Math.abs(value));
    diagnostics.textContent = `Context ${context?.state}; held gates ${gates.size}; stream ${stream?.running ? 'running' : 'stopped'}; transport ${transport?.state ?? 'none'} at ${transport?.position.toFixed(2) ?? '0'} beats; recent analyser peak ${peak.toFixed(6)}. Not an underrun counter.`;
  }, 250);
});
bind('play', () => {
  stream?.dispose();
  stream = null;
  opm!.loadVoice('lead', patch());
  applySessionSettings();
  const playback = playSequence(opm!, score, { at: context!.currentTime + 0.05 });
  status.textContent = `Shared score admitted: ${[...playback.ids.values()].join(', ')}. Watch command/note events for rejection.`;
});
bind('stream', async () => {
  stream?.dispose();
  opm!.loadVoice('lead', patch());
  stream = streamSequence(opm!, longScore, { at: context!.currentTime + 0.1,
    horizon: 0.2, interval: 0.025, maxSlots: 256,
    onError: error => {
      record({ type: 'stream-error', message: error.message });
      status.textContent = `Stream stopped: ${error.message}. Explicit restart required.`;
    } });
  await stream.start();
  status.textContent = '60-second mixed note/control/stop stream started; bounded lookahead. Interruption stops it under both policies; Start / resume does not restart it.';
});
bind('stop-stream', () => {
  stream?.stop();
  stream = null;
  status.textContent = 'Stream stopped and owned gates released. Restart only with the stream button.';
});
bind('hold', () => {
  opm!.loadVoice('lead', patch());
  const held = opm!.playNote({ voice: 'lead', note: 60.5 });
  const future = opm!.playNote({ voice: 'lead', note: 67, time: 5 });
  status.textContent = `Held #${held}; future #${future} at +5 seconds. Try interruption, release all, or panic.`;
});
bind('controls', () => {
  applySessionSettings();
  for (const id of gates) opm!.updateNote(id, { expression: input('expression').valueAsNumber,
    pan: input('pan').valueAsNumber, modulation: input('modulation').valueAsNumber, ramp: input('ramp').valueAsNumber,
    feedback: input('feedback').valueAsNumber, lfoRate: input('lfo-rate').valueAsNumber,
    amDepth: input('am-depth').valueAsNumber, pmDepth: input('pm-depth').valueAsNumber });
  status.textContent = 'Independent feedback / LFO controls submitted with a smooth ramp; note pitch glide remains separate.';
});
bind('chord', () => {
  opm!.loadVoice('lead', patch());
  for (let index = 0; index < 12; index++) opm!.playNote({ voice: 'lead', note: 48 + index * 2,
    velocity: (index + 1) / 12, duration: index < 4 ? 0.03 : 1 });
  status.textContent = '12-note burst; eight logical voices, selected stealing policy, bounded fading tails.';
});
function stopOwnedPlayback(): void {
  stream?.stop(); stream = null;
  transport?.stop();
  performance?.allNotesOff();
  physicalKeys.length = 0;
}
bind('release', async () => { stopOwnedPlayback(); await opm!.waitForCommand(opm!.allNotesOff()); status.textContent = 'All pending events cancelled; active gates released, tails retained.'; });
bind('panic', async () => { stopOwnedPlayback(); await opm!.waitForCommand(opm!.panic()); status.textContent = 'Panic accepted: immediate silence and reset, patch cache/routing retained.'; });
bind('suspend', async () => { await context!.suspend(); status.textContent = 'Host suspended. Click Start / resume in a user gesture.'; });
bind('dispose', async () => {
  stream?.dispose();
  stream = null;
  transport?.dispose();
  transport = null;
  performance?.dispose();
  performance = null;
  physicalKeys.length = 0;
  await opm!.close();
  opm = null;
  status.textContent = `Synth disposed; borrowed context is still ${context!.state}. Start creates a fresh node.`;
});
bind('render', () => {
  revokeWav();
  const audio = renderSequence(score, { voices: new Map([['lead', patch()]]), sampleRate: context?.sampleRate ?? 48000,
    mixGain: input('mix-gain').valueAsNumber, tuning: tuning(),
    stealing: select('stealing').value as 'oldest' | 'release-first' | 'quietest',
    quality: select('quality').value as QualityProfile });
  const bytes = encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate,
    format: select('wav-format').value as WavFormat });
  wavURL = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
  download.href = wavURL;
  download.download = 'opm-sequence.wav';
  download.hidden = false;
  status.textContent = `Same score rendered: ${audio.left.length} stereo frames, ${audio.sampleRate} Hz, ${bytes.length} WAV bytes; DSP errors ${audio.diagnostics.errors}.`;
});
bind('render-long', async () => {
  cancelRender = false;
  const cancel = document.querySelector<HTMLButtonElement>('#cancel-render')!;
  cancel.disabled = false;
  const options = { voices: new Map([['lead', patch()]]), sampleRate: 96000, chunkFrames: 4096,
    quality: select('quality').value as QualityProfile };
  const capacity = estimateSequenceCapacity(longScore, options);
  record({ type: 'chunk-render-capacity', ...capacity });
  const chunks = renderSequenceChunks(longScore, options);
  let peak = 0, count = 0;
  try {
    for (const chunk of chunks) {
      if (cancelRender || leaving) { chunks.cancel(); break; }
      for (let frame = 0; frame < chunk.frames; frame++) {
        peak = Math.max(peak, Math.abs(chunk.left[frame]), Math.abs(chunk.right[frame]));
      }
      if (++count % 8 === 0) {
        status.textContent = `Bounded 96-kHz render: ${chunk.diagnostics.renderedFrames} / ${capacity.frames} frames; two reused buffers.`;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    record({ type: 'chunk-render-finish', cancelled: cancelRender || leaving, peak, ...chunks.diagnostics });
    status.textContent = `${cancelRender || leaving ? 'Cancelled' : 'Completed'} 60-second mixed score at 96000 Hz: ${chunks.diagnostics.renderedFrames} frames, ${chunks.diagnostics.errors} DSP errors, peak ${peak.toFixed(6)}. ${capacity.chunkBytes} PCM buffer bytes reused; no aggregate PCM/WAV retained.`;
  } finally { chunks.cancel(); cancel.disabled = true; }
});

bind('transport-start', async () => {
  transport?.dispose();
  opm!.loadVoice('lead', patch());
  transport = createTransport(opm!, beatScore, { bpm: input('bpm').valueAsNumber,
    loop: { enabled: input('loop').checked, from: 0, to: 8 },
    onError: error => { record({ type: 'transport-error', message: error.message }); } });
  await transport.start();
  status.textContent = 'Beat transport running; pause/seek/loop restart owned envelopes, not unrelated notes.';
});
bind('transport-pause', () => { transport?.pause(); status.textContent = `Transport paused at ${transport?.position.toFixed(3)} beats.`; });
bind('transport-resume', async () => { if (transport) await transport.resume(); status.textContent = 'Transport resumed from its musical cursor.'; });
bind('transport-seek', () => {
  if (!transport) throw new Error('Start the beat transport first');
  transport.setTempo(input('bpm').valueAsNumber);
  transport.setLoop({ enabled: input('loop').checked, from: 0, to: 8 });
  transport.seek(input('seek-beat').valueAsNumber);
  status.textContent = `Transport moved to ${transport.position.toFixed(3)} beats at ${input('bpm').valueAsNumber} BPM.`;
});
bind('transport-stop', () => { transport?.stop(); status.textContent = 'Transport stopped; only its owned notes were released.'; });
bind('performance-on', () => {
  if (physicalKeys.length) throw new Error('Release physical keys before pressing another demonstration chord');
  opm!.loadVoice('lead', patch());
  performance ??= createPerformance(opm!, { onError: error => record({ type: 'performance-error', message: error.message }) });
  performance.configurePart(0, { voice: 'lead', mode: select('performance-mode').value as 'poly' | 'mono',
    legato: true, priority: select('note-priority').value as 'last' | 'high' | 'low', glide: 0.05 });
  for (const note of [60, 64, 67]) physicalKeys.push(performance.noteOn(0, note, { velocity: 0.7 }));
  status.textContent = `Three physical keys held; part 0 uses ${select('performance-mode').value} / ${select('note-priority').value}.`;
});
bind('performance-off', () => {
  for (const key of physicalKeys) performance?.noteOff(0, key);
  physicalKeys.length = 0;
  status.textContent = 'Physical keys released; pedal-held sound remains until pedal up.';
});
bind('pedal-on', () => { performance?.sustain(0, true); status.textContent = 'Part 0 sustain pedal down.'; });
bind('pedal-off', () => { performance?.sustain(0, false); status.textContent = 'Part 0 sustain pedal up.'; });
bind('performance-reset', () => { performance?.allNotesOff(0); physicalKeys.length = 0; status.textContent = 'Part 0 released; transport and unrelated notes untouched.'; });
bind('bank-replace', () => { opm!.replaceVoiceBank([{ ...patch(), name: 'lead' }]); status.textContent = 'Bank atomically replaced; previously queued and sounding patches retain their snapshots.'; });
bind('bank-remove', () => { status.textContent = `Lead lookup removed: ${opm!.removeVoice('lead')}. Existing notes retain their patch.`; });
bind('bank-export', () => {
  revokeWav();
  const json = opm!.exportVoiceBank();
  wavURL = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  download.href = wavURL; download.download = 'opm-voices.json'; download.hidden = false;
  status.textContent = `Exported ${opm!.voices.size} detached voice-bank entries.`;
});

interface FileSink {
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
async function workerExport(toFile: boolean): Promise<void> {
  let file: FileSink | undefined;
  let fileSettled = false;
  const abortFile = async (reason?: unknown): Promise<void> => {
    if (!file || fileSettled) return;
    fileSettled = true;
    await file.abort(reason);
  };
  const controller = new AbortController();
  workerAbort = controller;
  const cancel = document.querySelector<HTMLButtonElement>('#cancel-worker')!;
  cancel.disabled = false;
  try {
    if (toFile) {
      const picker = (window as Window & { showSaveFilePicker?: (options: {
        suggestedName: string; types: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<{ createWritable(): Promise<FileSink> }> }).showSaveFilePicker;
      if (!picker) throw new Error('This browser has no direct file sink. Use the short preview, or a browser with File System Access.');
      const handle = await picker.call(window, { suggestedName: 'opm-long.wav',
        types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }] });
      controller.signal.throwIfAborted();
      file = await handle.createWritable();
      controller.signal.throwIfAborted();
    }
    revokeWav();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let retained = 0;
    const result = await renderSequenceInWorker(toFile ? longScore : score, {
      voices: new Map([['lead', patch()]]), sampleRate: toFile ? 96000 : 48000, chunkFrames: 4096,
      quality: select('quality').value as QualityProfile, format: select('wav-format').value as WavFormat,
      signal: controller.signal, maxFrames: toFile ? 8_000_000 : 48000 * 12,
      sink: file ? { write: bytes => file!.write(bytes as Uint8Array<ArrayBuffer>),
        close: async () => { await file!.close(); fileSettled = true; }, abort: abortFile } : {
        write: bytes => {
          retained += bytes.byteLength;
          if (retained > 8 * 1024 * 1024) throw new RangeError('Short preview exceeds its 8 MiB memory budget');
          parts.push(bytes as Uint8Array<ArrayBuffer>);
        },
      },
      onProgress: progress => { status.textContent = `Worker export: ${progress.frames} / ${progress.totalFrames} frames; ${progress.bytesWritten} bytes acknowledged by sink.`; },
    });
    controller.signal.throwIfAborted();
    if (!toFile) {
      wavURL = URL.createObjectURL(new Blob(parts, { type: 'audio/wav' }));
      download.href = wavURL; download.download = 'opm-worker.wav'; download.hidden = false;
    }
    record({ type: 'worker-export-complete', ...result });
    status.textContent = `Worker ${result.format} export complete: ${result.bytesWritten} bytes; ${result.diagnostics.errors} DSP errors. ${toFile ? 'Written directly to file with backpressure.' : 'Bounded short preview download ready.'}`;
  } catch (error) {
    await abortFile(error).catch(cleanupError => record({ type: 'file-abort-error', message: String(cleanupError) }));
    throw error;
  } finally { cancel.disabled = true; if (workerAbort === controller) workerAbort = null; }
}
bind('worker-preview', () => workerExport(false));
bind('worker-file', () => workerExport(true));
document.querySelector<HTMLButtonElement>('#cancel-worker')!.addEventListener('click', () => workerAbort?.abort());
document.querySelector<HTMLButtonElement>('#cancel-render')!.addEventListener('click', () => { cancelRender = true; });
document.addEventListener('visibilitychange', () => record({ type: 'visibility', state: document.visibilityState }));
window.addEventListener('pagehide', () => {
  leaving = true;
  cancelRender = true;
  stream?.dispose();
  stream = null;
  transport?.dispose();
  transport = null;
  performance?.dispose();
  performance = null;
  physicalKeys.length = 0;
  workerAbort?.abort();
  workerAbort = null;
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
