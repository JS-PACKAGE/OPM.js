import { OPM } from '../src/api/index.js';
import { renderNote, encodeWav } from '../src/core/index.js';
import { brass } from '../src/voices/brass.js';
import { importDX7, describeDX7 } from '../src/voices/dx7.js';
import { parseVoiceBank } from '../src/voices/schema.js';
import { examples } from '../src/voices/examples.js';
import type { FourOperators, FrozenVoice, Operator, Voice } from '../src/voices/schema.js';

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing demo element: ${selector}`);
  return result;
}

const status = element<HTMLOutputElement>('#status');
const release = element<HTMLButtonElement>('#release');
const selector = element<HTMLSelectElement>('#voice');
const voices = new Map<string, Voice | FrozenVoice>([['brass', brass]]);
let heldId: number | null = null;
const opm = new OPM({ onEvent(event) {
  if (event.type === 'error') status.textContent = event.error.message;
  if (event.type === 'note' && event.state === 'rejected') {
    status.textContent = `Note rejected: ${event.reason}`;
  }
  if (event.type === 'note' && event.id === heldId &&
      ['ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) {
    heldId = null;
    release.disabled = true;
  }
} });
function options() {
  return {
    voice: selector.value,
    velocity: Number(element<HTMLInputElement>('#velocity').value),
    pan: Number(element<HTMLInputElement>('#pan').value),
  };
}
function action(id: string, run: () => void | Promise<void>) {
  const button = element<HTMLButtonElement>(`#${id}`);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await run(); }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
    finally { button.disabled = id === 'release' && heldId === null; }
  });
}
function addVoice(voice: Voice | FrozenVoice) {
  opm.loadVoice(voice.name, voice);
  voices.set(voice.name, voice);
  if (![...selector.options].some(option => option.value === voice.name)) {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = voice.name;
    selector.append(option);
  }
}
try {
  for (const voice of parseVoiceBank(examples).values()) {
    if (!voices.has(voice.name)) addVoice(voice);
  }
} catch (error) {
  status.textContent = error instanceof Error ? error.message : String(error);
}
action('play', async () => {
  await opm.start();
  for (const note of [60, 64, 67]) opm.playNote({ ...options(), note, duration: 0.7 });
  status.textContent = `Playing ${selector.value} chord`;
});
action('hold', async () => {
  await opm.start();
  if (heldId !== null) opm.stop(heldId);
  heldId = opm.playNote({ ...options(), note: 60 });
  release.disabled = false;
  status.textContent = 'Holding note — press Release note to end the gate';
});
action('release', async () => {
  if (heldId !== null) opm.stop(heldId);
  heldId = null;
  status.textContent = 'Released note';
});
action('scaling', async () => {
  await opm.start();
  const voice: Voice = { ...brass, version: 3, ops: brass.ops.map(op => ({
    ...op, keyScale: { breakpoint: 60, leftDbPerOctave: 0, rightDbPerOctave: 12 },
  })) as unknown as FourOperators<Operator> };
  [48, 60, 72, 84].forEach((note, index) => {
    opm.playNote({ voice, note, time: index * 0.35, duration: 0.3, velocity: 0.8 });
  });
  status.textContent = 'Playing key-scaled arpeggio: 12 dB attenuation per octave above C4';
});
action('suspend', async () => {
  await opm.start();
  await opm.context!.suspend();
  status.textContent = 'Audio suspended';
});
action('resume', async () => {
  await opm.resume();
  status.textContent = `Audio ${opm.context!.state}`;
});
const dx7 = element<HTMLInputElement>('#dx7');
dx7.addEventListener('change', async () => {
  try {
    const file = dx7.files?.[0];
    if (!file) return;
    // A standard DX7 bank is 4104 bytes; bound before buffering user input.
    if (file.size > 4104) throw new RangeError('DX7 SysEx exceeds one standard bank');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const imported = importDX7(bytes);
    const descriptions = describeDX7(bytes);
    for (const voice of imported) addVoice(voice);
    selector.value = imported[0].name;
    status.textContent = `Imported ${imported.length} approximate DX7 voice(s). ${descriptions[0].warnings.join(' ')}`;
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
});
action('wav', async () => {
  const { left, right, sampleRate } = renderNote({
    voice: voices.get(selector.value)!, note: 60, duration: 0.7,
    velocity: options().velocity, pan: options().pan, sampleRate: 48000,
  });
  const bytes = encodeWav({ left, right, sampleRate });
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${selector.value}.wav`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Downloaded stereo PCM16 WAV';
});
action('diagnostics', async () => {
  await opm.start();
  const info = await opm.getDiagnostics();
  status.textContent = `${info.activeVoices} active voices; ${info.pendingEvents} pending events; ${info.errors} errors; ${info.rejectedNotes} rejected notes`;
});
