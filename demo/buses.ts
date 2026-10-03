import { OPM, createTransport, createEffects } from '../src/api/index.js';
import type { BeatSequenceEvent, MusicalTransport, SequenceEvent, OpmEffects, StereoEffectsOptions } from '../src/api/index.js';
import { encodeWav, renderSequence, applyEffects } from '../src/core/index.js';
import { examples } from '../src/voices/examples.js';

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const status = $<HTMLOutputElement>('status');
interface Bus { name: string; voice: string; priority: number; events: BeatSequenceEvent[]; instance?: OPM; transport?: MusicalTransport; gain?: GainNode }
const notes = (voice: string, rows: readonly (readonly [number, number, number])[]): BeatSequenceEvent[] =>
  rows.map(([beat, duration, note], index) => ({ type: 'note', id: index + 1, beat, duration, note, voice, velocity: 0.7 }));
const buses: Bus[] = [
  { name: 'melody', voice: 'lead', priority: 100, events: notes('lead', [[0, 1, 72], [1, 1, 74], [2, 1.5, 76], [4, 1, 79], [5, 1, 76], [6, 2, 74]]) },
  { name: 'accompaniment', voice: 'strings', priority: 0, events: notes('strings', [[0, 4, 48], [0, 4, 55], [4, 4, 53], [4, 4, 60]]) },
  { name: 'percussion', voice: 'membrane_tom', priority: 0, events: notes('membrane_tom', [0, 1, 2, 3, 4, 5, 6, 7].map(beat => [beat, 0.4, beat % 2 === 0 ? 38 : 45] as const)) },
];
let context: AudioContext | null = null;
let master: GainNode | null = null;
let effects: OpmEffects | null = null;
let starting = false;
let leaving = false;
let wavUrls: string[] = [];

function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function effectsParams(): StereoEffectsOptions {
  const params: StereoEffectsOptions = {};
  if ($<HTMLInputElement>('chorus').checked) params.chorus = { rate: .8, depth: .6, mix: .3 };
  if ($<HTMLInputElement>('reverb').checked) params.reverb = { size: .6, damping: .5, mix: .25 };
  return params;
}
function controls(): void {
  $<HTMLButtonElement>('start').disabled = starting || leaving;
  $<HTMLButtonElement>('stop').disabled = !context;
}
async function teardown(): Promise<void> {
  const owned = buses.map(bus => ({ transport: bus.transport, instance: bus.instance, gain: bus.gain }));
  for (const bus of buses) { bus.transport = undefined; bus.instance = undefined; bus.gain = undefined; }
  for (const item of owned) {
    item.transport?.dispose();
    // Borrowed context: OPM disconnects its node and never closes the host context.
    await item.instance?.dispose();
    item.gain?.disconnect();
  }
  effects?.dispose(); master?.disconnect();
  effects = null; master = null;
  const host = context;
  context = null;
  if (host && host.state !== 'closed') await host.close();
}
$<HTMLButtonElement>('start').addEventListener('click', async () => {
  if (starting || leaving) return;
  starting = true;
  controls();
  status.textContent = 'Creating one shared AudioContext and three independent OPM buses…';
  try {
    await teardown();
    const host = new AudioContext();
    context = host;
    master = host.createGain();
    master.gain.value = Number($<HTMLInputElement>('master').value);
    master.connect(host.destination);
    // The same optional DSP is available live and in offline stems.
    effects = await createEffects(host, { params: effectsParams(), onEvent: event => { status.textContent = event.error.message; } });
    effects.output.connect(master);
    for (const bus of buses) {
      bus.gain = host.createGain();
      bus.gain.gain.value = Number($<HTMLInputElement>(`gain-${bus.name}`).value);
      bus.gain.connect(bus.name === 'accompaniment' ? effects.input : master);
      bus.instance = new OPM({ context: host, destination: bus.gain, maxVoices: bus.name === 'accompaniment' ? 12 : 6, mixGain: 0.5 });
      bus.instance.replaceVoiceBank(examples);
      bus.transport = createTransport(bus.instance, bus.events.map(event => event.type === 'note' ? { ...event, voicePriority: bus.priority } : event),
        { bpm: 100, loop: { enabled: true, from: 0, to: 8 } });
    }
    await host.resume();
    await Promise.all(buses.map(bus => bus.transport!.start()));
    status.textContent = 'Playing. Each bus has its own OPM instance, polyphony budget, saturation and gain; only accompaniment uses the optional chorus/reverb.';
  } catch (error) {
    status.textContent = `Start failed: ${describe(error)}`;
    await teardown().catch(() => {});
  } finally { starting = false; controls(); }
});
$<HTMLButtonElement>('stop').addEventListener('click', async () => { await teardown(); status.textContent = 'Stopped; the shared AudioContext was created by this page and has been closed.'; controls(); });
for (const bus of buses) {
  $<HTMLInputElement>(`gain-${bus.name}`).addEventListener('input', event => {
    if (bus.gain && context && event.currentTarget instanceof HTMLInputElement) bus.gain.gain.setTargetAtTime(Number(event.currentTarget.value), context.currentTime, 0.02);
  });
}
const levelInputs: [string, () => AudioParam | undefined][] = [['master', () => master?.gain]];
for (const [id, param] of levelInputs) {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('input', () => { const target = param(); if (target && context) target.setTargetAtTime(Number(input.value), context.currentTime, 0.02); });
}
for (const id of ['chorus', 'reverb']) $<HTMLInputElement>(id).addEventListener('change', () => effects?.update(effectsParams()));
$<HTMLButtonElement>('render').addEventListener('click', () => {
  try {
    for (const url of wavUrls) URL.revokeObjectURL(url);
    wavUrls = [];
    const list = $<HTMLElement>('stems');
    list.replaceChildren();
    const sampleRate = 44100;
    const stems = buses.map(bus => {
      const voice = examples.find(candidate => candidate.name === bus.voice)!;
      const score: SequenceEvent[] = bus.events.map(event => event.type === 'note'
        ? { type: 'note', id: event.id, time: event.beat * 0.6, duration: event.duration * 0.6, note: event.note, voice, velocity: event.velocity, voicePriority: bus.priority }
        : { type: 'stop', id: event.id, time: event.beat * 0.6 });
      const rendered = renderSequence(score, { sampleRate, maxVoices: bus.name === 'accompaniment' ? 12 : 6, mixGain: 0.5 });
      const result = bus.name === 'accompaniment' ? applyEffects(rendered.left, rendered.right, sampleRate, effectsParams()) : rendered;
      return { bus, result };
    });
    const frames = Math.max(...stems.map(stem => stem.result.left.length));
    const left = new Float32Array(frames), right = new Float32Array(frames);
    let peak = 0;
    for (const { bus, result } of stems) {
      const gain = Number($<HTMLInputElement>(`gain-${bus.name}`).value);
      for (let i = 0; i < result.left.length; i++) { left[i] += result.left[i]! * gain; right[i] += result.right[i]! * gain; }
      const link = document.createElement('a');
      // encodeWav allocates a native ArrayBuffer-backed Uint8Array, so no copy is needed.
      const url = URL.createObjectURL(new Blob([encodeWav({ left: result.left, right: result.right, sampleRate }) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
      wavUrls.push(url);
      link.href = url; link.download = `opm-stem-${bus.name}.wav`; link.textContent = `${bus.name} stem (saturated independently)`;
      const item = document.createElement('li'); item.append(link); list.append(item);
    }
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
    const mix = document.createElement('a');
    // The linear sum is a host mix of already-saturated stems, not a monolithic single-engine render.
    const mixBytes = encodeWav({ left: left.map(v => Math.max(-1, Math.min(1, v))), right: right.map(v => Math.max(-1, Math.min(1, v))), sampleRate });
    const mixUrl = URL.createObjectURL(new Blob([mixBytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
    wavUrls.push(mixUrl);
    mix.href = mixUrl; mix.download = 'opm-linear-bus-mix.wav'; mix.textContent = `linear bus mix (peak ${peak.toFixed(3)})`;
    const item = document.createElement('li'); item.append(mix); list.append(item);
    status.textContent = `Rendered ${stems.length} stems and a linear sum offline at ${sampleRate} Hz. The sum differs from one monolithic engine because each stem has its own saturation.`;
  } catch (error) { status.textContent = `Offline render failed: ${describe(error)}`; }
});
window.addEventListener('pagehide', () => {
  leaving = true;
  void teardown();
  for (const url of wavUrls) URL.revokeObjectURL(url);
  wavUrls = [];
  controls();
});
window.addEventListener('pageshow', () => { leaving = false; controls(); });
controls();
status.textContent = 'Click Start. Begin with a low device volume.';
