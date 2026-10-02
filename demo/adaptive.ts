import { OPM, createArrangement, swingBeatEvents } from '../src/api/index.js';
import type { Arrangement, ArrangementChangeOptions, ArrangementLayer, BeatSequenceEvent } from '../src/api/index.js';
import { examples } from '../src/voices/examples.js';

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const status = $<HTMLOutputElement>('status');
const readout = $<HTMLElement>('readout');
const quantize = $<HTMLSelectElement>('quantize');
const swing = $<HTMLSelectElement>('swing');
const preserve = $<HTMLInputElement>('preserve');
const layerNames = ['pad', 'bass-explore', 'bass-combat', 'arp', 'lead', 'drums'] as const;
const sectionLayers = {
  explore: ['pad', 'bass-explore', 'arp'],
  combat: ['pad', 'bass-combat', 'lead', 'drums'],
} as const;
let opm: OPM | null = null;
let arrangement: Arrangement | null = null;
let starting = false;
let leaving = false;
let bpm = 96;
let refresh: ReturnType<typeof setInterval> | undefined;

type Row = readonly [beat: number, duration: number, note: number, velocity?: number];
function layer(name: typeof layerNames[number], voice: string, length: number, rows: readonly Row[], voicePriority = 0, swung = 0): ArrangementLayer {
  const events: BeatSequenceEvent[] = rows.map(([beat, duration, note, velocity], index) => (
    { type: 'note', id: index + 1, beat, duration, note, voice, velocity: velocity ?? 0.7 }));
  return { name, length, voicePriority, events: swung > 0 ? swingBeatEvents(events, 0.5, swung) : events };
}
function build(host: OPM, swung: number): Arrangement {
  const arp: Row[] = [60, 64, 67, 71, 67, 64, 62, 65, 69, 72, 69, 65, 60, 64, 67, 64].map((note, index) => [index * 0.5, 0.45, note, 0.55] as const);
  const lead: Row[] = [[0, 1.5, 72, 0.85], [2, 1, 74, 0.8], [3, 1, 76, 0.85], [4, 1.5, 79, 0.9], [6, 0.75, 76, 0.8], [7, 0.75, 74, 0.8]];
  const drums: Row[] = [0, 1, 2, 3].map(beat => [beat, 0.4, 40, 0.9] as const);
  const mallet: Row[] = [0.5, 1.5, 2.5, 3.5].map(beat => [beat, 0.2, 76, 0.5] as const);
  return createArrangement(host, {
    bpm,
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
    sections: [{ name: 'explore', layers: [...sectionLayers.explore] }, { name: 'combat', layers: [...sectionLayers.combat] }],
    onError(error) { status.textContent = `Arrangement stopped: ${error.message}`; controls(); },
  });
}
function controls(): void {
  const ready = arrangement?.state === 'running';
  $<HTMLButtonElement>('start').disabled = starting || leaving;
  $<HTMLButtonElement>('resume').disabled = arrangement?.state !== 'paused';
  for (const id of ['explore', 'combat', 'accelerate', 'pause']) $<HTMLButtonElement>(id).disabled = !ready;
  $<HTMLButtonElement>('stop').disabled = !ready && arrangement?.state !== 'paused';
  for (const name of layerNames) $<HTMLInputElement>(`layer-${name}`).disabled = !ready;
}
function update(): void {
  if (!arrangement) { readout.textContent = 'No audio created.'; return; }
  const snapshot = arrangement.snapshot;
  const pending = snapshot.pending.map(change => `${change.section}@${change.beat}`).join(', ') || 'none';
  readout.textContent = `${snapshot.state}; bar ${snapshot.musicalPosition.bar} beat ${snapshot.musicalPosition.beat.toFixed(2)}\nsection: ${snapshot.section}\nactive: ${snapshot.layers.join(', ')}\npending: ${pending}\nBPM map points: ${snapshot.tempoMap.length}\nvoice-priority drops: ${snapshot.priorityDrops}`;
  for (const name of layerNames) $<HTMLInputElement>(`layer-${name}`).checked = snapshot.layers.includes(name);
}
function change(action: () => number, label: string): void {
  try {
    const beat = action();
    status.textContent = `${label} commits at beat ${beat} (bar ${Math.floor(beat / 4) + 1}); already admitted notes are never rewritten.`;
  } catch (error) { status.textContent = `Rejected: ${error instanceof Error ? error.message : String(error)}`; }
  update();
}
const options = (): ArrangementChangeOptions => ({ quantize: quantize.value === 'bar' || quantize.value === 'beat' ? quantize.value : 1, preserveNotes: preserve.checked });
async function teardown(): Promise<void> {
  clearInterval(refresh);
  refresh = undefined;
  const instance = opm;
  arrangement?.dispose();
  arrangement = null;
  opm = null;
  await instance?.dispose();
}

$<HTMLButtonElement>('start').addEventListener('click', async () => {
  if (starting || leaving) return;
  starting = true;
  controls();
  status.textContent = 'Starting audio…';
  try {
    await teardown();
    bpm = 96;
    opm = new OPM({ maxVoices: 16, mixGain: 0.35 });
    opm.replaceVoiceBank(examples);
    arrangement = build(opm, Number(swing.value));
    await arrangement.start();
    refresh = setInterval(update, 120);
    status.textContent = 'Playing exploration. Switch sections or toggle layers; changes snap to the selected boundary.';
  } catch (error) {
    status.textContent = `Start failed: ${error instanceof Error ? error.message : String(error)}`;
    await teardown().catch(() => {});
  } finally { starting = false; controls(); update(); }
});
$<HTMLButtonElement>('explore').addEventListener('click', () => change(() => arrangement!.switchSection('explore', options()), 'Exploration'));
$<HTMLButtonElement>('combat').addEventListener('click', () => change(() => arrangement!.switchSection('combat', options()), 'Combat'));
for (const name of layerNames) {
  const input = $<HTMLInputElement>(`layer-${name}`);
  input.addEventListener('change', () => {
    const enabled = input.checked;
    change(() => arrangement!.setLayer(name, enabled, options()), `${name} ${enabled ? 'on' : 'off'}`);
  });
}
$<HTMLButtonElement>('accelerate').addEventListener('click', () => {
  try {
    const beat = Math.ceil(arrangement!.snapshot.position);
    const target = Math.min(180, bpm + 36);
    arrangement!.setTempoMap([{ beat: 0, bpm }, { beat, bpm, curve: 'linear' }, { beat: beat + 16, bpm: target }]);
    bpm = target;
    status.textContent = `Linear tempo ramp to ${target} BPM across 16 beats (analytic beat-domain integral).`;
  } catch (error) { status.textContent = `Rejected: ${error instanceof Error ? error.message : String(error)}`; }
  update();
});
$<HTMLButtonElement>('pause').addEventListener('click', () => {
  arrangement!.pause();
  status.textContent = 'Paused: owned notes were released; Resume restarts musically at this beat (not an exact DSP checkpoint).';
  controls();
  update();
});
$<HTMLButtonElement>('resume').addEventListener('click', async () => {
  try { await arrangement!.resume(); status.textContent = 'Resumed from the paused beat.'; }
  catch (error) { status.textContent = `Resume failed: ${error instanceof Error ? error.message : String(error)}`; }
  controls();
  update();
});
$<HTMLButtonElement>('stop').addEventListener('click', () => { arrangement!.stop(); status.textContent = 'Stopped and rewound to beat 0.'; controls(); update(); });
window.addEventListener('pagehide', () => { leaving = true; void teardown(); controls(); });
window.addEventListener('pageshow', () => { leaving = false; controls(); });
controls();
update();
status.textContent = 'Click Start. Begin with a low device volume.';
