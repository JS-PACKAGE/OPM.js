import { OPM, createArrangement, swingBeatEvents, parseArrangementProject, serializeArrangementProject,
  MAX_ARRANGEMENT_PROJECT_BYTES } from '../src/api/index.js';
import type { Arrangement, ArrangementChangeOptions, ArrangementLayer, ArrangementProject, BeatSequenceEvent } from '../src/api/index.js';
import { examples } from '../src/voices/examples.js';

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const status = $<HTMLOutputElement>('status');
const readout = $<HTMLElement>('readout');
const quantize = $<HTMLSelectElement>('quantize');
const swing = $<HTMLSelectElement>('swing');
const preserve = $<HTMLInputElement>('preserve');
const fade = $<HTMLSelectElement>('fade');
const sectionSelect = $<HTMLSelectElement>('section');
const gainLayer = $<HTMLSelectElement>('gain-layer');
const layerGain = $<HTMLInputElement>('layer-gain');
const load = $<HTMLInputElement>('load-project');
const layerInputs = new Map<string, HTMLInputElement>();
let opm: OPM | null = null;
let arrangement: Arrangement | null = null;
let context: AudioContext | null = null;
let monitor: GainNode | null = null;
let starting = false;
let loading = false;
let leaving = false;
let generation = 0;
let refresh: ReturnType<typeof setInterval> | undefined;
let projectURL: string | null = null;

type Row = readonly [beat: number, duration: number, note: number, velocity?: number];
function layer(name: string, voice: string, length: number, rows: readonly Row[], voicePriority = 0, swung = 0): ArrangementLayer {
  const events: BeatSequenceEvent[] = rows.map(([beat, duration, note, velocity], index) => (
    { type: 'note', id: index + 1, beat, duration, note, voice, velocity: velocity ?? 0.7 }));
  return { name, length, voicePriority, events: swung > 0 ? swingBeatEvents(events, 0.5, swung) : events };
}
function defaultProject(swung: number): ArrangementProject {
  const arp: Row[] = [60, 64, 67, 71, 67, 64, 62, 65, 69, 72, 69, 65, 60, 64, 67, 64].map((note, index) => [index * 0.5, 0.45, note, 0.55] as const);
  const lead: Row[] = [[0, 1.5, 72, 0.85], [2, 1, 74, 0.8], [3, 1, 76, 0.85], [4, 1.5, 79, 0.9], [6, 0.75, 76, 0.8], [7, 0.75, 74, 0.8]];
  const drums: Row[] = [0, 1, 2, 3].map(beat => [beat, 0.4, 40, 0.9] as const);
  const mallet: Row[] = [0.5, 1.5, 2.5, 3.5].map(beat => [beat, 0.2, 76, 0.5] as const);
  return parseArrangementProject({
    version: 1,
    voices: Object.fromEntries(examples.map(voice => [voice.name, voice])),
    settings: { maxVoices: 16, mixGain: 0.35 },
    tempoMap: [{ beat: 0, bpm: 96 }],
    initialSection: 'explore',
    layers: [
      layer('pad', 'slow_air_pad', 16, [[0, 16, 48, 0.55], [0, 16, 55, 0.45]], 20),
      layer('bass-explore', 'bass', 4, [[0, 2, 36, 0.7], [2, 2, 43, 0.65]], 40),
      layer('bass-combat', 'bass', 2, [0, 0.5, 1, 1.5].map(beat => [beat, 0.4, beat === 1 ? 43 : 36, 0.85] as const), 40),
      layer('arp', 'electric_piano', 8, arp, 0, swung),
      layer('lead', 'lead', 8, lead, 100, swung),
      { name: 'drums', length: 4, voicePriority: 30, events: [
        ...drums.map(([beat, duration, note, velocity], index): BeatSequenceEvent => ({ type: 'note', id: index + 1, beat, duration, note, voice: 'membrane_tom', velocity })),
        ...mallet.map(([beat, duration, note, velocity], index): BeatSequenceEvent => ({ type: 'note', id: 100 + index, beat, duration, note, voice: 'wood_mallet', velocity })) ] },
    ],
    sections: [{ name: 'explore', layers: ['pad', 'bass-explore', 'arp'] }, { name: 'combat', layers: ['pad', 'bass-combat', 'lead', 'drums'] }],
  });
}
let project = defaultProject(0);

function renderDefinition(): void {
  sectionSelect.replaceChildren();
  gainLayer.replaceChildren();
  const list = $<HTMLElement>('layer-list');
  list.replaceChildren();
  layerInputs.clear();
  for (const section of project.sections) {
    const option = document.createElement('option');
    option.value = section.name;
    option.textContent = section.name;
    sectionSelect.append(option);
  }
  sectionSelect.value = project.initialSection;
  for (const layer of project.layers) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    const label = document.createElement('label');
    label.append(input, document.createTextNode(` ${layer.name} (priority ${layer.voicePriority})`));
    list.append(label);
    layerInputs.set(layer.name, input);
    input.addEventListener('change', () => {
      const enabled = input.checked;
      change(() => {
        const beat = arrangement!.setLayer(layer.name, enabled, options());
        project = parseArrangementProject({ ...project, sections: project.sections.map(section => {
          if (section.name !== project.initialSection) return section;
          const members = new Set(section.layers);
          if (enabled) members.add(layer.name); else members.delete(layer.name);
          return { name: section.name, layers: [...members] };
        }) });
        return beat;
      }, `${layer.name} ${enabled ? 'on' : 'off'}`);
    });
    const option = document.createElement('option');
    option.value = layer.name;
    option.textContent = layer.name;
    gainLayer.append(option);
  }
  layerGain.value = String(project.layers[0]!.gain);
  controls();
  update();
}
function controls(): void {
  const busy = starting || loading || leaving;
  const ready = !busy && arrangement?.state === 'running';
  for (const id of ['start', 'reset-demo', 'save-project']) $<HTMLButtonElement>(id).disabled = busy;
  load.disabled = busy;
  swing.disabled = busy;
  $<HTMLButtonElement>('resume').disabled = busy || arrangement?.state !== 'paused';
  for (const id of ['switch-section', 'accelerate', 'pause']) $<HTMLButtonElement>(id).disabled = !ready;
  $<HTMLButtonElement>('stop').disabled = busy || (!ready && arrangement?.state !== 'paused');
  sectionSelect.disabled = !ready;
  for (const input of layerInputs.values()) input.disabled = !ready;
  gainLayer.disabled = !ready;
  layerGain.disabled = !ready;
}
function update(): void {
  const snapshot = arrangement?.snapshot;
  const active = snapshot?.layers ?? project.sections.find(section => section.name === project.initialSection)!.layers;
  for (const [name, input] of layerInputs) input.checked = active.includes(name);
  if (!snapshot) {
    readout.textContent = `Definition ready; initial section: ${project.initialSection}\nlayers: ${project.layers.map(layer => layer.name).join(', ')}\nNo playback. Click Start to load its voices and settings.`;
    return;
  }
  const pending = snapshot.pending.map(change => `${change.section}@${change.beat}`).join(', ') || 'none';
  readout.textContent = `${snapshot.state}; bar ${snapshot.musicalPosition.bar} beat ${snapshot.musicalPosition.beat.toFixed(2)}\nsection: ${snapshot.section}\nactive: ${snapshot.layers.join(', ')}\npending: ${pending}\nBPM map points: ${snapshot.tempoMap.length}\nvoice-priority drops: ${snapshot.priorityDrops}`;
}
function change(action: () => number, label: string): void {
  try {
    const beat = action();
    status.textContent = `${label} commits at beat ${beat}; already admitted notes are never rewritten. Save retains the requested definition, not the live cursor or fade.`;
  } catch (error) { status.textContent = `Rejected: ${error instanceof Error ? error.message : String(error)}`; }
  update();
}
const options = (): ArrangementChangeOptions => ({
  quantize: quantize.value === 'bar' || quantize.value === 'beat' ? quantize.value : 1,
  preserveNotes: preserve.checked, fade: Number(fade.value),
});
async function teardown(): Promise<void> {
  clearInterval(refresh);
  refresh = undefined;
  const instance = opm;
  const owned = arrangement;
  const ownedContext = context;
  const ownedMonitor = monitor;
  arrangement = null;
  opm = null;
  context = null;
  monitor = null;
  try { owned?.dispose(); } finally {
    try { await instance?.dispose(); } finally {
      ownedMonitor?.disconnect();
      if (ownedContext && ownedContext.state !== 'closed') await ownedContext.close();
    }
  }
}

$<HTMLButtonElement>('start').addEventListener('click', async () => {
  if (starting || loading || leaving) return;
  const token = ++generation;
  const selected = project;
  let instance: OPM | undefined;
  let current: Arrangement | undefined;
  let audio: AudioContext | undefined;
  let volume: GainNode | undefined;
  starting = true;
  controls();
  status.textContent = 'Starting audio…';
  try {
    audio = new AudioContext({ sampleRate: selected.settings.sampleRate });
    volume = audio.createGain();
    volume.gain.value = 0.16; // Host monitoring attenuation is separate from saved synthesis mixGain.
    volume.connect(audio.destination);
    instance = new OPM({ ...selected.settings, context: audio, destination: volume });
    // Clear the implicit brass so a complete 128-voice project fits without an extra registry entry.
    instance.replaceVoiceBank([]);
    for (const [name, voice] of Object.entries(selected.voices)) instance.loadVoice(name, voice);
    current = createArrangement(instance, { layers: selected.layers, sections: selected.sections,
      initialSection: selected.initialSection, tempoMap: selected.tempoMap, timeSignature: selected.timeSignature,
      onError(error) { status.textContent = `Arrangement stopped: ${error.message}`; controls(); } });
    const unlock = audio.resume(); // Unlock in the click gesture, before awaiting old playback cleanup.
    await Promise.all([teardown(), unlock]);
    if (token !== generation || leaving) {
      try { current.dispose(); } finally {
        try { await instance.dispose(); } finally {
          volume.disconnect();
          if (audio.state !== 'closed') await audio.close();
        }
      }
      return;
    }
    opm = instance;
    arrangement = current;
    context = audio;
    monitor = volume;
    await current.start();
    if (token !== generation || leaving) return;
    refresh = setInterval(update, 120);
    status.textContent = `Playing ${selected.initialSection}. Loaded ${Object.keys(selected.voices).length} named voices and saved synthesis settings; host monitor gain 16%.`;
  } catch (error) {
    status.textContent = `Start failed: ${error instanceof Error ? error.message : String(error)}`;
    try {
      if (opm === instance) await teardown();
      else {
        try { current?.dispose(); } finally {
          try { await instance?.dispose(); } finally {
            volume?.disconnect();
            if (audio && audio.state !== 'closed') await audio.close();
          }
        }
      }
    } catch (cleanup) { status.textContent += ` Cleanup failed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`; }
  } finally { starting = false; controls(); update(); }
});
$<HTMLButtonElement>('switch-section').addEventListener('click', () => {
  const name = sectionSelect.value;
  change(() => {
    const beat = arrangement!.switchSection(name, options());
    project = parseArrangementProject({ ...project, initialSection: name });
    return beat;
  }, name);
});
gainLayer.addEventListener('change', () => { layerGain.value = String(project.layers.find(layer => layer.name === gainLayer.value)!.gain); });
layerGain.addEventListener('change', () => {
  const name = gainLayer.value;
  const gain = Number(layerGain.value);
  const { quantize, fade } = options();
  change(() => {
    const beat = arrangement!.setLayerGain(name, gain, { quantize, fade });
    project = parseArrangementProject({ ...project, layers: project.layers.map(layer => layer.name === name ? { ...layer, gain } : layer) });
    return beat;
  }, `${name} gain ${gain.toFixed(2)}`);
});
$<HTMLButtonElement>('accelerate').addEventListener('click', () => {
  try {
    const beat = Math.ceil(arrangement!.snapshot.position);
    const bpm = project.tempoMap.at(-1)!.bpm;
    const target = Math.min(180, bpm + 36);
    arrangement!.setTempoMap([...(beat === 0 ? [] : [{ beat: 0, bpm }]),
      { beat, bpm, curve: 'linear' }, { beat: beat + 16, bpm: target }]);
    project = parseArrangementProject({ ...project, tempoMap: arrangement!.snapshot.tempoMap });
    status.textContent = `Linear tempo ramp to ${target} BPM across 16 beats; saved with the definition.`;
  } catch (error) { status.textContent = `Rejected: ${error instanceof Error ? error.message : String(error)}`; }
  update();
});
$<HTMLButtonElement>('pause').addEventListener('click', () => {
  arrangement!.pause();
  status.textContent = 'Paused: owned notes were released; Resume restarts musically at this beat (not a DSP checkpoint).';
  controls();
  update();
});
$<HTMLButtonElement>('resume').addEventListener('click', async () => {
  try { await arrangement!.resume(); status.textContent = 'Resumed from the paused beat.'; }
  catch (error) { status.textContent = `Resume failed: ${error instanceof Error ? error.message : String(error)}`; }
  controls();
  update();
});
$<HTMLButtonElement>('stop').addEventListener('click', () => {
  arrangement!.stop();
  status.textContent = 'Stopped and rewound. Start reconstructs the edited definition; Stop does not save runtime state.';
  controls();
  update();
});
$<HTMLButtonElement>('save-project').addEventListener('click', () => {
  try {
    if (projectURL) URL.revokeObjectURL(projectURL);
    projectURL = URL.createObjectURL(new Blob([serializeArrangementProject(project)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = projectURL;
    link.download = 'arrangement.opm.json';
    link.click();
    status.textContent = 'Saved sections, layer targets, tempo, meter, voices and settings. Live position, pending fades and DSP state are not saved.';
  } catch (error) { status.textContent = `Save failed: ${error instanceof Error ? error.message : String(error)}`; }
});
load.addEventListener('change', async () => {
  const file = load.files?.[0];
  if (!file || starting || loading || leaving) return;
  const token = ++generation;
  loading = true;
  controls();
  try {
    if (file.size > MAX_ARRANGEMENT_PROJECT_BYTES) throw new RangeError('Project exceeds 8 MiB');
    const loaded = parseArrangementProject(await file.text());
    if (token !== generation || leaving) return;
    await teardown();
    if (token !== generation || leaving) return;
    project = loaded;
    renderDefinition();
    status.textContent = `Loaded ${file.name}. Playback is stopped; click Start to use its voices/settings, then switch sections or fade any layer.`;
  } catch (error) {
    if (token === generation) status.textContent = `Load failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally { loading = false; load.value = ''; controls(); update(); }
});
$<HTMLButtonElement>('reset-demo').addEventListener('click', async () => {
  if (starting || loading || leaving) return;
  const token = ++generation;
  loading = true;
  controls();
  try {
    const selected = defaultProject(Number(swing.value));
    await teardown();
    if (token !== generation || leaving) return;
    project = selected;
    renderDefinition();
    status.textContent = 'Demo definition reset with the selected swing. Click Start; nothing plays automatically.';
  } catch (error) { status.textContent = `Reset failed: ${error instanceof Error ? error.message : String(error)}`; }
  finally { loading = false; controls(); update(); }
});
window.addEventListener('pagehide', () => {
  leaving = true;
  generation++;
  if (projectURL) URL.revokeObjectURL(projectURL);
  projectURL = null;
  void teardown().catch(error => { status.textContent = `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`; });
  controls();
});
window.addEventListener('pageshow', () => { leaving = false; controls(); });
renderDefinition();
status.textContent = 'Click Start. Begin with a low device volume. Save/load retains the musical definition, not an audio checkpoint.';
