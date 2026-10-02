import { OPM } from '../src/api/index.js';
import { encodeWav, renderNote } from '../src/core/index.js';
import { examples } from '../src/voices/examples.js';
import { presetMetadata } from '../src/voices/preset-metadata.js';
import { parseVoiceBank } from '../src/voices/schema.js';
import type { FrozenVoice, Voice } from '../src/voices/schema.js';
import { describeDX7, importDX7 } from '../src/voices/dx7.js';
import { syntheticDX7Fixtures } from './audition-fixtures.js';
import { AUDITION_GAIN, AUDITION_GATE, AUDITION_NOTES, AUDITION_VELOCITIES, auditionSlotSeconds,
  matchLevels, measureSound, renderAudition, seededPhrase } from './audition-metrics.js';
import type { AuditionAudio, AuditionStep, LevelMatch, SoundMetrics } from './audition-metrics.js';

interface AuditionSource { voice: Voice | FrozenVoice; label: string; description: string; hostTrimDb: number }
interface AuditionSettings {
  a: AuditionSource; b: AuditionSource; note: number; velocity: number; seed: number;
  phrase: readonly AuditionStep[]; matched: boolean; phraseMode: boolean;
}
interface AuditionPair {
  audio: AuditionAudio[]; metrics: SoundMetrics[]; gains: number[]; matched: LevelMatch; steps: readonly AuditionStep[];
}

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
const modeSelector = element<HTMLSelectElement>('mode');
const gainSelector = element<HTMLSelectElement>('gain-mode');
const seedInput = element<HTMLInputElement>('seed');
const download = element<HTMLAnchorElement>('download');
const limits = element<HTMLParagraphElement>('limits');
const voices = new Map<string, AuditionSource>();
const active = new Set<AudioBufferSourceNode>();
let downloadURL: string | null = null;
let gain: GainNode | null = null;
let generation = 0;
let busy = false;
const opm = new OPM({ destination: null, onEvent(event) {
  if (event.type === 'error') status.textContent = `Audio failed: ${event.error.message}`;
} });

function describeSelection(): void {
  limits.textContent = `A: ${voices.get(sourceA.value)?.description ?? 'Unavailable'} B: ${voices.get(sourceB.value)?.description ?? 'Unavailable'}`;
}
function clearDownload(): void {
  download.hidden = true;
  download.removeAttribute('href');
  download.removeAttribute('download');
  if (downloadURL !== null) URL.revokeObjectURL(downloadURL);
  downloadURL = null;
}
function settings(): AuditionSettings {
  const a = voices.get(sourceA.value);
  const b = voices.get(sourceB.value);
  if (!a || !b) throw new Error('Choose available voices.');
  const note = Number(noteSelector.value);
  const velocity = Number(velocitySelector.value);
  const seed = Number(seedInput.value);
  if (!AUDITION_NOTES.some(value => value === note) || !AUDITION_VELOCITIES.some(value => value === velocity)) {
    throw new RangeError('Choose a listed register and velocity.');
  }
  const phrase = seededPhrase(seed, note, velocity);
  return { a, b, note, velocity, seed, phrase, matched: gainSelector.value === 'matched', phraseMode: modeSelector.value === 'phrase' };
}
function stopNotes(): void {
  generation++;
  for (const source of active) source.stop();
  active.clear();
}
async function startAudio(token: number): Promise<boolean> {
  await opm.start();
  if (token !== generation) return false;
  if (!gain) {
    gain = opm.context!.createGain();
    gain.gain.value = AUDITION_GAIN;
    gain.connect(opm.context!.destination);
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
function renderPair(options: AuditionSettings, note = options.note, velocity = options.velocity, phraseMode = options.phraseMode): AuditionPair {
  const slot = auditionSlotSeconds(options.a.voice, options.b.voice);
  const steps = phraseMode ? seededPhrase(options.seed, note, velocity) : [{ note, velocity, duration: AUDITION_GATE }];
  const audio = [options.a, options.b].map(source => renderAudition(source.voice, steps, slot));
  const metrics = audio.map(item => measureSound(item.left, item.right,
    phraseMode ? item.left.length : Math.ceil(AUDITION_GATE * item.sampleRate)));
  if (audio.some(item => item.diagnostics.errors) || metrics.some(item => !item.finite)) throw new Error('Invalid offline DSP output');
  const matched = matchLevels(metrics[0], metrics[1], options.a.hostTrimDb, options.b.hostTrimDb);
  const gains = options.matched ? matched.gains : [1, 1];
  return { audio, metrics, gains, matched, steps };
}
function playBuffer(audio: AuditionAudio, sourceGain: number, when: number): void {
  const context = opm.context!;
  const buffer = context.createBuffer(2, audio.left.length, audio.sampleRate);
  buffer.copyToChannel(audio.left as Float32Array<ArrayBuffer>, 0);
  buffer.copyToChannel(audio.right as Float32Array<ArrayBuffer>, 1);
  const source = context.createBufferSource();
  const trim = context.createGain();
  trim.gain.value = sourceGain;
  source.buffer = buffer;
  source.connect(trim);
  trim.connect(gain!);
  active.add(source);
  source.onended = () => { active.delete(source); source.disconnect(); trim.disconnect(); };
  source.start(when);
}
function describePair(pair: AuditionPair, options: AuditionSettings): string[] {
  return [
    `Seed ${options.seed}; ${options.phraseMode ? 'six-note phrase' : 'single note'}; ${options.matched ? 'energy-matched' : 'dry'}; master gain ${AUDITION_GAIN}.`,
    `Phrase/steps: ${JSON.stringify(pair.steps)}`,
    ...pair.metrics.map((sound, index) => `${index === 0 ? 'A' : 'B'} raw peak ${sound.peakDbFS.toFixed(2)} / measurement RMS ${sound.gateRmsDbFS.toFixed(2)} / full RMS ${sound.rmsDbFS.toFixed(2)} dBFS; applied HOST trim ${(20 * Math.log10(pair.gains[index])).toFixed(2)} dB.`),
    `Matched target ${pair.matched.targetDbFS.toFixed(2)} dBFS before master gain; ${options.phraseMode ? 'whole common phrase window including isolated tails' : '0.8s gate window'}. Unweighted RMS, not perceptual equal loudness.`,
  ];
}

try {
  for (const [id, voice] of parseVoiceBank(examples)) {
    const metadata = presetMetadata[id];
    voices.set(id, { voice, label: `${voice.name} (${metadata.family})`, hostTrimDb: metadata.hostTrimDb,
      description: `${metadata.purpose} Intended MIDI ${metadata.intendedMidi.join('–')}, velocity ${metadata.intendedVelocity.join('–')}; host starting trim ${metadata.hostTrimDb} dB. ${metadata.provenance.kind}, ${metadata.provenance.license}; no copied emulator patch.` });
  }
  for (const fixture of syntheticDX7Fixtures()) {
    const voice = importDX7(fixture.bytes)[0];
    const conversion = describeDX7(fixture.bytes)[0];
    voices.set(fixture.id, { voice, label: fixture.label, hostTrimDb: -6,
      description: `${fixture.purpose} Original recipe, Apache-2.0. Retained operators: ${conversion.selectedOperators.join(', ')}; dropped: ${conversion.droppedOperators.join(', ')}. ${conversion.warnings.join(' ')}` });
  }
  for (const [id, source] of voices) opm.loadVoice(id, source.voice);
  for (const selector of [sourceA, sourceB]) for (const [id, source] of voices) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = source.label;
    selector.append(option);
  }
  sourceA.value = 'wood_mallet';
  sourceB.value = 'glass_pluck';
  describeSelection();
  document.querySelectorAll<HTMLButtonElement>('[data-audition]').forEach(button => { button.disabled = false; });
  status.textContent = 'Ready. Begin at low device volume. Energy matching is numerical; compare dry too.';
} catch (error) {
  status.textContent = `Voice loading failed: ${error instanceof Error ? error.message : String(error)}`;
}
for (const input of [sourceA, sourceB, noteSelector, velocitySelector, modeSelector, gainSelector, seedInput]) input.addEventListener('change', () => {
  stopNotes();
  clearDownload();
  report.textContent = 'Settings changed. Measure A/B again.';
  describeSelection();
});
for (const [side, index] of [['a', 0], ['b', 1]] as const) {
  action(`play-${side}`, async () => {
    stopNotes();
    const token = generation;
    const options = settings();
    const pair = renderPair(options);
    if (!await startAudio(token)) return;
    playBuffer(pair.audio[index], pair.gains[index], opm.context!.currentTime + 0.05);
    report.textContent = describePair(pair, options).join('\n');
    status.textContent = `Playing ${side.toUpperCase()}, ${options.phraseMode ? 'seeded phrase' : 'single note'}, ${options.matched ? 'energy-matched' : 'dry'} host gain; patch unchanged.`;
  });
  action(`wav-${side}`, () => {
    clearDownload();
    const options = settings();
    const pair = renderPair(options);
    const audio = pair.audio[index];
    for (let frame = 0; frame < audio.left.length; frame++) {
      audio.left[frame] *= AUDITION_GAIN * pair.gains[index];
      audio.right[frame] *= AUDITION_GAIN * pair.gains[index];
    }
    const bytes = encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate });
    downloadURL = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
    download.href = downloadURL;
    download.download = `${side}-${(index === 0 ? options.a : options.b).voice.name}-seed${options.seed}-${options.phraseMode ? 'phrase' : 'single'}-${options.matched ? 'matched' : 'dry'}-n${options.note}-v${options.velocity}.wav`;
    download.hidden = false;
    report.textContent = describePair(pair, options).join('\n');
    status.textContent = 'WAV ready with the exact playback host gains; no patch compensation.';
  });
}
async function compare(grid: boolean): Promise<void> {
  stopNotes();
  const token = generation;
  const options = settings();
  if (!await startAudio(token)) return;
  let when = opm.context!.currentTime + 0.05;
  const lines: string[] = [];
  const cells = grid ? AUDITION_NOTES.flatMap(note => AUDITION_VELOCITIES.map(velocity => ({ note, velocity }))) : [options];
  for (const cell of cells) {
    if (token !== generation) return;
    const pair = renderPair(options, cell.note, cell.velocity, grid ? false : options.phraseMode);
    // Offline work can exceed the scheduling lead; use a fresh safe start after rendering.
    when = Math.max(when, opm.context!.currentTime + 0.05);
    for (let index = 0; index < 2; index++) {
      playBuffer(pair.audio[index], pair.gains[index], when);
      when += pair.audio[index].left.length / pair.audio[index].sampleRate;
    }
    lines.push(`MIDI ${cell.note}, velocity ${cell.velocity}: A/B host trims ${pair.gains.map(value => (20 * Math.log10(value)).toFixed(2)).join(' / ')} dB.`);
    report.textContent = lines.join('\n');
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (token !== generation) return;
  status.textContent = `A then B ${grid ? 'nine-cell register/velocity grid' : 'selected single/phrase'}; ${options.matched ? 'energy-matched' : 'dry'}; master ${AUDITION_GAIN}. Stop cancels audio immediately.`;
}
action('compare', () => compare(false));
action('compare-grid', () => compare(true));
action('measure', async () => {
  const token = generation;
  const options = settings();
  const pair = renderPair(options);
  const lines = describePair(pair, options);
  lines.push('Dry nine-cell grid: peak / 0.8s gate RMS / tail-inclusive RMS (dBFS).');
  for (const [label, source] of [['A', options.a], ['B', options.b]] as const) {
    let trim = 0;
    for (const note of AUDITION_NOTES) for (const velocity of AUDITION_VELOCITIES) {
      if (token !== generation) return;
      const audio = renderNote({ voice: source.voice, note, velocity, duration: AUDITION_GATE, sampleRate: 48000 });
      const sound = measureSound(audio.left, audio.right, AUDITION_GATE * audio.sampleRate);
      if (!sound.finite || audio.diagnostics.errors) throw new Error('Invalid DSP output');
      trim = Math.min(trim, sound.suggestedTrimDb);
      lines.push(`${label} MIDI ${note} v${velocity}: ${sound.peakDbFS.toFixed(1)} / ${sound.gateRmsDbFS.toFixed(1)} / ${sound.rmsDbFS.toFixed(1)}.`);
      report.textContent = lines.join('\n');
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    lines.push(`${label} grid safety trim ${trim.toFixed(1)} dB, metadata starting trim ${source.hostTrimDb} dB; both HOST only.`);
  }
  if (token !== generation) return;
  status.textContent = 'Numerical report finished. Listen matched and dry; no listening verdict is inferred.';
});
element<HTMLButtonElement>('stop').addEventListener('click', () => { stopNotes(); status.textContent = 'Playback and queued buffers stopped.'; });
async function dispose(): Promise<void> {
  stopNotes();
  clearDownload();
  if (gain) gain.disconnect();
  gain = null;
  await opm.close();
}
element<HTMLButtonElement>('dispose').addEventListener('click', () => {
  void dispose().then(() => { status.textContent = 'Audio disposed. Play creates a fresh session.'; }, error => {
    status.textContent = `Disposal failed: ${error instanceof Error ? error.message : String(error)}`;
  });
});
window.addEventListener('pagehide', () => { void dispose().catch(() => { /* Leaving page: nodes are already disconnected. */ }); });
