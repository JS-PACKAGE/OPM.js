import { OPM } from '../src/api/index.js';
import { encodeWav, renderNote } from '../src/core/index.js';
import { examples } from '../src/voices/examples.js';
import { parseVoiceBank } from '../src/voices/schema.js';
import type { FrozenVoice, Voice } from '../src/voices/schema.js';
import { describeDX7, importDX7 } from '../src/voices/dx7.js';
import { syntheticDX7Fixtures } from './audition-fixtures.js';
import { AUDITION_GAIN, AUDITION_GATE, AUDITION_NOTES, AUDITION_VELOCITIES, measureSound } from './audition-metrics.js';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing audition element: ${id}`);
  return node as T;
}
const status = element<HTMLOutputElement>('status');
const report = element<HTMLPreElement>('report');
const sourceA = element<HTMLSelectElement>('source-a');
const sourceB = element<HTMLSelectElement>('source-b');
const noteSelector = element<HTMLSelectElement>('note');
const velocitySelector = element<HTMLSelectElement>('velocity');
const download = element<HTMLAnchorElement>('download');
const limits = element<HTMLParagraphElement>('limits');
const voices = new Map<string, { voice: Voice | FrozenVoice; label: string; description: string }>();
const ids = new Set<number>();
let downloadURL: string | null = null;
let gain: GainNode | null = null;
let generation = 0;
let busy = false;
const opm = new OPM({ destination: null, onEvent(event) {
  if (event.type === 'error') status.textContent = `Audio failed: ${event.error.message}`;
  if (event.type === 'note' && ['ended', 'cancelled', 'stolen', 'rejected'].includes(event.state)) ids.delete(event.id);
  if (event.type === 'note' && event.state === 'rejected') status.textContent = `Note rejected: ${event.reason ?? 'unknown reason'}`;
} });

function describeSelection(): void {
  const a = voices.get(sourceA.value);
  const b = voices.get(sourceB.value);
  limits.textContent = `A: ${a?.description ?? 'Unavailable'} B: ${b?.description ?? 'Unavailable'}`;
}
function clearDownload(): void {
  download.hidden = true;
  download.removeAttribute('href');
  download.removeAttribute('download');
  if (downloadURL !== null) URL.revokeObjectURL(downloadURL);
  downloadURL = null;
}
function settings(side: 'a' | 'b') {
  const voiceName = side === 'a' ? sourceA.value : sourceB.value;
  const source = voices.get(voiceName);
  if (!source) throw new Error('Choose an available voice.');
  const note = Number(noteSelector.value);
  const velocity = Number(velocitySelector.value);
  if (!AUDITION_NOTES.some(value => value === note) || !AUDITION_VELOCITIES.some(value => value === velocity)) {
    throw new RangeError('Choose a listed register and velocity.');
  }
  return { voiceName, voice: source.voice, note, velocity };
}
function stopNotes(): void {
  generation++;
  if (opm.node) for (const id of ids) opm.stop(id);
  ids.clear();
}
async function startAudio(token: number): Promise<boolean> {
  await opm.start();
  if (token !== generation) return false;
  if (!gain) {
    gain = opm.context!.createGain();
    gain.gain.value = AUDITION_GAIN;
    gain.connect(opm.context!.destination);
    opm.connect(gain);
  }
  return true;
}
function action(id: string, run: () => void | Promise<void>): void {
  element<HTMLButtonElement>(id).addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try { await run(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
    finally { busy = false; }
  });
}

try {
  for (const [id, voice] of parseVoiceBank(examples)) {
    voices.set(id, { voice, label: voice.name, description: 'Bundled four-operator preset; unchanged patch levels.' });
  }
  for (const fixture of syntheticDX7Fixtures()) {
    const voice = importDX7(fixture.bytes)[0];
    const conversion = describeDX7(fixture.bytes)[0];
    voices.set(fixture.id, { voice, label: fixture.label,
      description: `${fixture.purpose} Retained DX7 operators: ${conversion.selectedOperators.join(', ')}; dropped: ${conversion.droppedOperators.join(', ')}. ${conversion.warnings.join(' ')}` });
  }
  for (const [id, source] of voices) opm.loadVoice(id, source.voice);
  for (const selector of [sourceA, sourceB]) for (const [id, source] of voices) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = source.label;
    selector.append(option);
  }
  sourceA.value = 'electric_piano';
  sourceB.value = 'dx7_velocity';
  describeSelection();
  document.querySelectorAll<HTMLButtonElement>('[data-audition]').forEach(button => { button.disabled = false; });
  status.textContent = 'Ready. Start with low device volume; A/B share fixed 0.12 host gain, not loudness matching.';
} catch (error) {
  status.textContent = `Voice loading failed: ${error instanceof Error ? error.message : String(error)}`;
}
for (const input of [sourceA, sourceB, noteSelector, velocitySelector]) input.addEventListener('change', () => {
  try { stopNotes(); }
  catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  clearDownload();
  report.textContent = 'Settings changed. Measure A/B again for current sources.';
  describeSelection();
});
for (const side of ['a', 'b'] as const) {
  action(`play-${side}`, async () => {
    stopNotes();
    const token = generation;
    const options = settings(side);
    if (!await startAudio(token)) return;
    ids.add(opm.playNote({ voice: options.voiceName, note: options.note, velocity: options.velocity, duration: AUDITION_GATE }));
    status.textContent = `Playing ${side.toUpperCase()}: ${options.voice.name}, MIDI ${options.note}, velocity ${options.velocity}; automatic note-off after ${AUDITION_GATE}s.`;
  });
  action(`wav-${side}`, () => {
    clearDownload();
    const options = settings(side);
    const audio = renderNote({ voice: options.voice, note: options.note, velocity: options.velocity, duration: AUDITION_GATE, sampleRate: 48000 });
    if (audio.diagnostics.errors) throw new Error(`Offline DSP errors: ${audio.diagnostics.errors}`);
    const sound = measureSound(audio.left, audio.right, AUDITION_GATE * audio.sampleRate);
    if (!sound.finite) throw new Error('Non-finite offline audio');
    for (let frame = 0; frame < audio.left.length; frame++) {
      audio.left[frame] *= AUDITION_GAIN;
      audio.right[frame] *= AUDITION_GAIN;
    }
    const bytes = encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate });
    downloadURL = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
    download.href = downloadURL;
    download.download = `${options.voice.name}-midi${options.note}-vel${options.velocity}.wav`;
    download.hidden = false;
    status.textContent = `WAV ${side.toUpperCase()} ready, including release tail, with the same fixed 0.12 host gain as playback. Raw peak ${sound.peakDbFS.toFixed(1)} dBFS; gate RMS ${sound.gateRmsDbFS.toFixed(1)} dBFS.`;
  });
}
action('compare', async () => {
  stopNotes();
  const token = generation;
  const a = settings('a');
  const b = settings('b');
  if (!await startAudio(token)) return;
  let offset = 0;
  for (const note of AUDITION_NOTES) for (const velocity of AUDITION_VELOCITIES) {
    for (const source of [a, b]) {
      ids.add(opm.playNote({ voice: source.voiceName, note, velocity, duration: AUDITION_GATE, time: offset }));
      // Separate full release tails so A/B loudness is not contaminated by overlap.
      const release = Math.max(...source.voice.ops.map(operator => operator.adsr.r));
      offset += AUDITION_GATE + release + 0.15;
    }
  }
  status.textContent = 'Comparing A then B: C3, C4, C6, each soft (0.25), medium (0.6), hard (1). Stop cancels queued notes and releases current gates.';
});
action('measure', async () => {
  const token = generation;
  const a = settings('a');
  const b = settings('b');
  const lines = ['Raw DSP, before 0.12 playback gain. Peak / gate RMS / tail-inclusive RMS (dBFS). RMS is unweighted, NOT LUFS.'];
  for (const [label, source] of [['A', a], ['B', b]] as const) {
    let trim = 0;
    for (const note of AUDITION_NOTES) for (const velocity of AUDITION_VELOCITIES) {
      if (token !== generation) return;
      const audio = renderNote({ voice: source.voice, note, velocity, duration: AUDITION_GATE, sampleRate: 48000 });
      const sound = measureSound(audio.left, audio.right, AUDITION_GATE * audio.sampleRate);
      if (!sound.finite || audio.diagnostics.errors) throw new Error('Sound measurement failed: invalid DSP output');
      trim = Math.min(trim, sound.suggestedTrimDb);
      lines.push(`${label} ${source.voice.name}  MIDI ${note}  v${velocity}: ${sound.peakDbFS.toFixed(1)} / ${sound.gateRmsDbFS.toFixed(1)} / ${sound.rmsDbFS.toFixed(1)}; DSP errors ${audio.diagnostics.errors}`);
      report.textContent = lines.join('\n');
      // Let the page paint and Stop/disposal interrupt the bounded measurement grid.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    lines.push(`${label} suggested host trim: ${trim.toFixed(1)} dB (attenuation only, -24..0 dB; single-note peak -12 / gate RMS -24 targets). Not applied to patches or playback.`);
  }
  if (token !== generation) return;
  report.textContent = lines.join('\n');
  status.textContent = 'A/B measurement finished; use your ears too. Extra polyphony needs extra host headroom.';
});
// Stop must remain responsive while start/measurement is awaiting work.
element<HTMLButtonElement>('stop').addEventListener('click', () => {
  try { stopNotes(); status.textContent = 'Queued notes cancelled; active gates released.'; }
  catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
});
async function dispose(): Promise<void> {
  generation++;
  ids.clear();
  clearDownload();
  if (gain) gain.disconnect();
  gain = null;
  await opm.close();
}
element<HTMLButtonElement>('dispose').addEventListener('click', () => {
  void dispose().then(() => { status.textContent = 'Audio disposed. Play creates a fresh audio session.'; }, error => {
    status.textContent = `Disposal failed: ${error instanceof Error ? error.message : String(error)}`;
  });
});
window.addEventListener('pagehide', () => { void dispose().catch(() => { /* Page is leaving; resources were disconnected first. */ }); });
