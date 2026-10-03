import { OPM, createTransport, renderSequenceInWorker } from '../src/api/index.js';
import type { MusicalTransport } from '../src/api/index.js';
import { compileBeatSequence, parseScoreProject, serializeScoreProject, MAX_SCORE_PROJECT_BYTES } from '../src/core/index.js';
import type { BeatSequenceEvent, ScoreProject, VoiceInput } from '../src/core/index.js';

// Original compositions written for this demo: no borrowed melodies or song arrangements.
const voices: Record<string, VoiceInput> = {
  glass: { algorithm: 4, feedback: 1, modIndex: 2.2,
    lfo: { rate: 4.1, amDepth: 0, pmDepth: 4, delay: 0.2 },
    ops: [
      { ratio: 2.01, level: 0.28, detune: 0, adsr: { a: 0.004, d: 0.32, s: 0.08, r: 0.18 } },
      { ratio: 1, level: 0.46, detune: -2, adsr: { a: 0.006, d: 0.48, s: 0.25, r: 0.24 } },
      { ratio: 3, level: 0.16, detune: 0, adsr: { a: 0.003, d: 0.2, s: 0.02, r: 0.15 } },
      { ratio: 1, level: 0.3, detune: 2, adsr: { a: 0.008, d: 0.42, s: 0.2, r: 0.25 } },
    ] },
  velvet: { algorithm: 4, feedback: 0, modIndex: 1.4,
    lfo: { rate: 0.6, amDepth: 0.04, pmDepth: 3 },
    ops: [
      { ratio: 1, level: 0.2, detune: 0, adsr: { a: 0.15, d: 0.4, s: 0.55, r: 0.35 } },
      { ratio: 1, level: 0.22, detune: -4, adsr: { a: 0.12, d: 0.4, s: 0.6, r: 0.45 } },
      { ratio: 2, level: 0.12, detune: 0, adsr: { a: 0.17, d: 0.3, s: 0.3, r: 0.3 } },
      { ratio: 1, level: 0.2, detune: 4, adsr: { a: 0.14, d: 0.4, s: 0.6, r: 0.45 } },
    ] },
  bass: { algorithm: 0, feedback: 2, modIndex: 1.4,
    ops: [
      { ratio: 1, level: 0.25, detune: 0, adsr: { a: 0.003, d: 0.12, s: 0.1, r: 0.08 } },
      { ratio: 1, level: 0.24, detune: 0, adsr: { a: 0.003, d: 0.18, s: 0.15, r: 0.08 } },
      { ratio: 1, level: 0.26, detune: 0, adsr: { a: 0.005, d: 0.2, s: 0.3, r: 0.08 } },
      { ratio: 1, level: 0.65, detune: 0, adsr: { a: 0.006, d: 0.28, s: 0.48, r: 0.12 } },
    ] },
};

function harbor(): ScoreProject {
  const events: BeatSequenceEvent[] = [];
  let id = 0;
  const add = (voice: string, note: number, beat: number, duration: number, velocity: number, pan: number) => {
    events.push({ type: 'note', id: ++id, voice, note, beat, duration, velocity, pan });
    return id;
  };
  // Four-bar question, brighter answer, then a sparse homecoming in D major/B minor.
  const melody = [
    [74, 78, 81, 78, 76, 74], [73, 76, 81, 83, 81, 76],
    [71, 74, 78, 81, 78, 76], [69, 73, 76, 78, 76, 73],
    [74, 78, 81, 86, 83, 81], [76, 79, 83, 86, 84, 83],
    [78, 81, 85, 88, 85, 81], [76, 73, 69, 73, 76, 81],
    [83, 81, 78, 76, 74, 73], [79, 78, 76, 74, 73, 71],
    [76, 78, 81, 78, 76, 73], [74, 78, 81, 78, 76, 74],
  ];
  const harmony = [[50, 57, 66], [49, 57, 64], [47, 54, 62], [45, 52, 61],
    [50, 57, 66], [43, 55, 62], [45, 57, 61], [45, 52, 61],
    [47, 54, 62], [43, 55, 62], [45, 52, 61], [50, 57, 66]];
  const positions = [0, 0.75, 1.5, 2, 2.75, 3.5];
  for (let bar = 0; bar < 12; bar++) {
    const at = bar * 4;
    const intensity = bar < 4 ? 0.63 : bar < 8 ? 0.82 : 0.58;
    if (bar >= 2) for (const pitch of harmony[bar].slice(1)) {
      const held = add('velvet', pitch, at, 3.8, 0.36, -0.35);
      events.push({ type: 'control', id: held, beat: at + 1, controls: { expression: bar >= 8 ? 0.65 : 0.9, ramp: 0.6 } });
    }
    add('bass', harmony[bar][0] - 12, at, bar === 11 ? 3.9 : 1.65, 0.72, -0.12);
    if (bar < 11) add('bass', harmony[bar][0] - 5, at + 2.5, 1.1, 0.5, -0.12);
    for (let index = 0; index < 6; index++) {
      if (bar >= 8 && index === 1) continue;
      add('glass', melody[bar][index], at + positions[index], index === 5 ? 0.43 : 0.6,
        intensity * (index === 0 || index === 3 ? 1 : 0.78), 0.2);
    }
    if (bar >= 4 && bar < 8) for (let index = 0; index < 4; index++) {
      add('glass', harmony[bar][1 + index % 2] + 12, at + index + 0.5, 0.32, 0.24, -0.5);
    }
  }
  add('velvet', 62, 48, 2, 0.38, 0);
  add('glass', 86, 48, 1.7, 0.48, 0.15);
  return parseScoreProject({ version: 1, events, voices, tempoMap: [
    { beat: 0, bpm: 108 }, { beat: 16, bpm: 108, curve: 'linear' }, { beat: 32, bpm: 124, curve: 'linear' }, { beat: 48, bpm: 84 },
  ], timeSignature: { numerator: 4, denominator: 4 }, settings: { sampleRate: 44100, mixGain: 0.4, maxVoices: 12, stealing: 'release-first' } });
}

function lanterns(): ScoreProject {
  const events: BeatSequenceEvent[] = [];
  let id = 0;
  // E minor waltz: three distinct phrases, a chromatic dominant and an open final ninth.
  const melody = [[76, 79, 83], [81, 78, 74], [79, 83, 86], [84, 81, 78],
    [83, 86, 88], [86, 83, 79], [81, 78, 75], [78, 75, 71],
    [76, 83, 79], [74, 81, 78], [75, 78, 83], [76, 78, 83]];
  const chords = [[40, 55, 59], [38, 54, 57], [43, 59, 62], [45, 60, 64],
    [48, 55, 64], [43, 55, 62], [42, 57, 60], [47, 57, 63],
    [40, 55, 59], [38, 54, 57], [47, 57, 63], [40, 55, 59]];
  for (let bar = 0; bar < 12; bar++) {
    const at = bar * 3;
    const dynamic = bar < 4 ? 0.6 : bar < 8 ? 0.78 : 0.52;
    events.push({ type: 'note', id: ++id, voice: 'bass', note: chords[bar][0], beat: at, duration: 1.25, velocity: 0.64, pan: -0.1 });
    for (const position of [1, 2]) for (const note of chords[bar].slice(1)) {
      events.push({ type: 'note', id: ++id, voice: 'velvet', note, beat: at + position, duration: 0.75, velocity: 0.36, pan: -0.3 });
    }
    for (let index = 0; index < 3; index++) {
      const gate = ++id;
      const duration = bar === 11 && index === 2 ? 3 : 0.86;
      events.push({ type: 'note', id: gate, voice: 'glass', note: melody[bar][index], beat: at + index,
        duration, velocity: dynamic * (index === 0 ? 1 : 0.8), pan: 0.25 });
      if (bar >= 4 && bar < 8 && index === 1) {
        events.push({ type: 'note', id: ++id, voice: 'glass', note: melody[bar][index] + 7,
          beat: at + index + 0.5, duration: 0.3, velocity: 0.24, pan: -0.4 });
      }
      if (bar === 11 && index === 2) events.push({ type: 'control', id: gate, beat: 36, controls: { expression: 0.2, ramp: 1.1 } });
    }
  }
  for (const note of [52, 59, 66]) events.push({ type: 'note', id: ++id, voice: 'velvet', note, beat: 36, duration: 2, velocity: 0.32, pan: -0.2 });
  return parseScoreProject({ version: 1, events, voices, tempoMap: [
    { beat: 0, bpm: 132 }, { beat: 12, bpm: 132, curve: 'linear' }, { beat: 24, bpm: 148, curve: 'linear' }, { beat: 36, bpm: 96 },
  ], timeSignature: { numerator: 3, denominator: 4 }, settings: { sampleRate: 44100, mixGain: 0.4, maxVoices: 12, stealing: 'release-first' } });
}

const songs = [
  { name: 'Harbor at First Light', description: 'A glassy D-major/B-minor question and answer, building a countermelody before a slowing homecoming. Original, 4/4.', project: harbor() },
  { name: 'Lanterns on the Stair', description: 'An E-minor waltz with a rising middle phrase, chromatic dominant and a fading open ninth. Original, 3/4.', project: lanterns() },
];
const select = document.querySelector<HTMLSelectElement>('#song')!;
const description = document.querySelector<HTMLParagraphElement>('#description')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const load = document.querySelector<HTMLInputElement>('#load')!;
const download = document.querySelector<HTMLAnchorElement>('#download')!;
let project = songs[0].project;
let name = songs[0].name;
let context: AudioContext | null = null;
let host: GainNode | null = null;
let opm: OPM | null = null;
let transport: MusicalTransport | null = null;
let renderAbort: AbortController | null = null;
let wavURL: string | null = null;
let generation = 0;
let leaving = false;
let completion: number | undefined;
description.textContent = songs[0].description;

function stopPlayback(message = 'Stopped'): void {
  generation++;
  transport?.dispose();
  transport = null;
  clearInterval(completion);
  completion = undefined;
  stop.disabled = renderAbort === null;
  play.disabled = leaving;
  status.textContent = message;
}
select.addEventListener('change', () => {
  stopPlayback();
  const song = songs[Number(select.value)];
  project = song.project;
  name = song.name;
  description.textContent = song.description;
});
stop.addEventListener('click', () => {
  renderAbort?.abort();
  stopPlayback();
});
play.addEventListener('click', async () => {
  stopPlayback();
  const token = generation;
  const selected = project;
  play.disabled = true;
  stop.disabled = false;
  status.textContent = 'Starting audio…';
  try {
    context ??= new AudioContext({ sampleRate: selected.settings.sampleRate });
    host ??= context.createGain();
    host.gain.value = 0.16; // Separate host monitoring gain; saved/offline synthesis settings stay unchanged.
    host.disconnect();
    host.connect(context.destination);
    const resume = context.resume(); // Unlock in the click gesture before awaiting cleanup.
    await opm?.close();
    await resume;
    if (token !== generation || leaving) return;
    opm = new OPM({ ...selected.settings, context, destination: host,
      onEvent(event) {
        if (token !== generation) return;
        if (event.type === 'reset') stopPlayback(`Audio reset: ${event.reason}`);
        if (event.type === 'error') stopPlayback(`Audio error: ${event.error.message}`);
      } });
    for (const [key, voice] of Object.entries(selected.voices)) opm.loadVoice(key, voice);
    transport = createTransport(opm, selected.events, { tempoMap: selected.tempoMap, timeSignature: selected.timeSignature,
      onError: error => stopPlayback(`Scheduling error: ${error.message}`) });
    const current = transport;
    await current.start();
    if (token !== generation || leaving) { current.dispose(); return; }
    status.textContent = `Playing ${name} · host gain 16%`;
    const end = selected.events.reduce((last, event) => Math.max(last, event.beat + (event.type === 'note' ? event.duration : 0)), 0) + 4;
    completion = window.setInterval(() => { if (current.position >= end) stopPlayback('Playback complete'); }, 100);
  } catch (error) {
    if (token === generation) stopPlayback(`Playback failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

save.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([serializeScoreProject(project)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.opm.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
load.addEventListener('change', async () => {
  const file = load.files?.[0];
  if (!file) return;
  stopPlayback();
  const token = generation;
  try {
    if (file.size > MAX_SCORE_PROJECT_BYTES) throw new RangeError('Project exceeds 8 MiB');
    const loaded = parseScoreProject(await file.text());
    if (token !== generation || leaving) return;
    project = loaded;
    name = file.name.replace(/\.opm\.json$|\.json$/i, '');
    description.textContent = 'Loaded self-contained project. Play uses its tempo, voices and synthesis settings; WAV export uses the same score.';
    status.textContent = `Loaded ${file.name}`;
  } catch (error) {
    if (token === generation) status.textContent = `Load failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally { load.value = ''; }
});
exportButton.addEventListener('click', async () => {
  if (renderAbort) return;
  const selected = project;
  const selectedName = name;
  const controller = new AbortController();
  renderAbort = controller;
  exportButton.disabled = true;
  stop.disabled = false;
  status.textContent = 'Rendering WAV in a Worker…';
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    const registry = new Map(Object.entries(selected.voices));
    const events = compileBeatSequence(selected.events, { tempoMap: selected.tempoMap, voices: registry });
    const result = await renderSequenceInWorker(events, { ...selected.settings, voices: registry, chunkFrames: 4096,
      maxFrames: selected.settings.sampleRate * 90, signal: controller.signal, format: 'pcm16',
      sink: { write(part) {
        bytes += part.byteLength;
        if (bytes > 32 * 1024 * 1024) throw new RangeError('Preview download exceeds 32 MiB');
        parts.push(part as Uint8Array<ArrayBuffer>);
      }, abort() { parts.length = 0; } },
      onProgress: progress => { status.textContent = `WAV ${Math.round(100 * progress.frames / progress.totalFrames)}%`; } });
    if (result.diagnostics.errors !== 0) throw new Error(`Render reported ${result.diagnostics.errors} DSP errors`);
    if (wavURL) URL.revokeObjectURL(wavURL);
    wavURL = URL.createObjectURL(new Blob(parts, { type: 'audio/wav' }));
    download.href = wavURL;
    download.download = `${selectedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`;
    download.hidden = false;
    status.textContent = 'WAV ready. Offline export preserves score mixGain, not the host monitoring attenuation.';
  } catch (error) {
    status.textContent = controller.signal.aborted ? 'WAV export cancelled' : `Export failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    renderAbort = null;
    exportButton.disabled = leaving;
    stop.disabled = transport === null;
  }
});
window.addEventListener('pagehide', () => {
  leaving = true;
  renderAbort?.abort();
  stopPlayback();
  if (wavURL) URL.revokeObjectURL(wavURL);
  wavURL = null;
  download.hidden = true;
  host?.disconnect();
  host = null;
  const old = opm;
  opm = null;
  void old?.close().catch(error => { status.textContent = `Synth cleanup failed: ${error instanceof Error ? error.message : String(error)}`; });
  const oldContext = context;
  context = null;
  void oldContext?.close().catch(error => { status.textContent = `Context cleanup failed: ${error instanceof Error ? error.message : String(error)}`; });
});
window.addEventListener('pageshow', () => {
  leaving = false;
  play.disabled = false;
  exportButton.disabled = renderAbort !== null;
});
