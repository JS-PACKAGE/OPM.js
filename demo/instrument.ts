import { OPM, createPerformance, createMidiAdapter, requestMidiAccess } from '../src/api/index.js';
import type { MidiAdapter, Performance } from '../src/api/index.js';
import { examples } from '../src/voices/examples.js';

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const status = $<HTMLOutputElement>('status');
const readout = $<HTMLElement>('readout');
const keyboard = $<HTMLElement>('keyboard');
const KEYS = 'awsedftgyhujk';
const BASE = 60;
let opm: OPM | null = null;
let performance: Performance | null = null;
let midi: MidiAdapter | null = null;
let starting = false;
let leaving = false;
let octave = 0;
const down = new Map<string, number>();
const pointers = new Map<number, { code: string; key: number }>();

function part(): number { return Number($<HTMLSelectElement>('part').value); }
function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function controls(): void {
  const ready = performance !== null;
  $<HTMLButtonElement>('start').disabled = starting || leaving;
  $<HTMLButtonElement>('release').disabled = !ready;
  $<HTMLButtonElement>('midi').disabled = !ready || starting || leaving || !('requestMIDIAccess' in navigator);
  $<HTMLButtonElement>('dispose').disabled = !opm || starting;
}
function refresh(): void {
  if (!performance) { readout.textContent = 'No audio created.'; return; }
  const lines = [0, 1].map(index => {
    const state = performance!.getPart(index);
    return `part ${index}: ${state.mode}${state.legato ? ' legato' : ''}, limit ${state.voiceLimit ?? 'none'}, priority ${state.voicePriority}, keys ${state.keys.length}`;
  });
  if (midi) lines.push(`MIDI inputs: ${midi.snapshot.inputs.join(', ') || 'none'}; held ${midi.snapshot.heldKeys}; ignored ${midi.snapshot.ignoredMessages}`);
  readout.textContent = lines.join('\n');
}
function press(code: string, note: number, velocity: number): number | null {
  if (!performance) return null;
  try { const key = performance.noteOn(part(), note, { velocity }); refresh(); return key; }
  catch (error) { status.textContent = `Note rejected: ${describe(error)}`; return null; }
}
function lift(key: number): void {
  try { performance?.noteOff(part(), key); refresh(); } catch (error) { status.textContent = describe(error); }
}
function configure(): void {
  if (!performance) return;
  try {
    performance.configurePart(0, { voice: 'lead', mode: 'mono', legato: true, priority: 'last', glide: Number($<HTMLInputElement>('glide').value), voicePriority: 100 });
    performance.configurePart(1, { voice: 'strings', mode: 'poly', voiceLimit: 8, voicePriority: 10 });
    refresh();
  } catch (error) { status.textContent = `Part configuration failed: ${describe(error)}`; }
}
async function teardown(): Promise<void> {
  midi?.dispose();
  midi = null;
  try { performance?.dispose(); } catch { /* The engine is disposed next. */ }
  performance = null;
  const instance = opm;
  opm = null;
  down.clear();
  pointers.clear();
  await instance?.dispose();
}

for (let index = 0; index < KEYS.length; index++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `${KEYS[index]!.toUpperCase()}`;
  button.dataset.code = KEYS[index]!;
  button.setAttribute('aria-label', `Play MIDI note ${BASE + index}`);
  button.addEventListener('pointerdown', event => {
    button.setPointerCapture(event.pointerId);
    const key = press(KEYS[index]!, BASE + octave * 12 + index, event.pressure > 0 ? Math.min(1, 0.45 + event.pressure * 0.55) : 0.8);
    if (key !== null) pointers.set(event.pointerId, { code: KEYS[index]!, key });
  });
  button.addEventListener('pointermove', event => {
    const held = pointers.get(event.pointerId);
    // Pressure-capable hardware becomes per-key LFO depth; the control is validated by the engine.
    if (held && event.pressure > 0) try { performance?.updateKey(part(), held.key, { modulation: 1 + event.pressure }); } catch (error) { status.textContent = describe(error); }
  });
  for (const type of ['pointerup', 'pointercancel'] as const) button.addEventListener(type, event => {
    const held = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (held) lift(held.key);
  });
  keyboard.append(button);
}
window.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || !performance) return;
  if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) return;
  const index = KEYS.indexOf(event.key.toLowerCase());
  if (index < 0 || down.has(event.code)) return;
  const key = press(event.code, BASE + octave * 12 + index, 0.8);
  if (key !== null) down.set(event.code, key);
});
window.addEventListener('keyup', event => {
  const key = down.get(event.code);
  down.delete(event.code);
  if (key !== undefined) lift(key);
});
const octaveInput = $<HTMLInputElement>('octave');
octaveInput.addEventListener('input', () => { octave = Number(octaveInput.value); });
const bendInput = $<HTMLInputElement>('bend');
bendInput.addEventListener('input', () => {
  try { performance?.updatePartNotes(part(), { pitch: Number(bendInput.value), glide: 0 }); } catch (error) { status.textContent = describe(error); }
});
const wheelInput = $<HTMLInputElement>('wheel');
wheelInput.addEventListener('input', () => {
  try { performance?.updatePartNotes(part(), { modulation: Number(wheelInput.value) }); } catch (error) { status.textContent = describe(error); }
});
const ratioInput = $<HTMLInputElement>('ratio');
ratioInput.addEventListener('input', () => {
  try { performance?.updatePartNotes(part(), { operatorRatios: [Number(ratioInput.value), 1, 2, 1], ramp: 0.05 }); } catch (error) { status.textContent = describe(error); }
});
$<HTMLInputElement>('glide').addEventListener('change', configure);
const sustainInput = $<HTMLInputElement>('sustain');
sustainInput.addEventListener('change', () => {
  try { performance?.sustain(part(), sustainInput.checked); } catch (error) { status.textContent = describe(error); }
});
$<HTMLButtonElement>('release').addEventListener('click', () => {
  try { performance?.allNotesOff(); midi?.releaseAll(); status.textContent = 'Released Performance parts and adapter-owned keys.'; refresh(); }
  catch (error) { status.textContent = describe(error); }
});
$<HTMLButtonElement>('start').addEventListener('click', async () => {
  if (starting || leaving) return;
  starting = true;
  controls();
  status.textContent = 'Starting audio…';
  try {
    await teardown();
    opm = new OPM({ maxVoices: 16, mixGain: 0.35 });
    opm.replaceVoiceBank(examples);
    await opm.start();
    performance = createPerformance(opm, { parts: 2, onError: error => { status.textContent = `Performance error: ${error.message}`; } });
    configure();
    status.textContent = 'Ready. Play A–K (white and black rows mapped chromatically) or the buttons. Part 0 is a protected mono lead; part 1 is a limited poly pad.';
  } catch (error) {
    status.textContent = `Start failed: ${describe(error)}`;
    await teardown().catch(() => {});
  } finally { starting = false; controls(); refresh(); }
});
$<HTMLButtonElement>('midi').addEventListener('click', async () => {
  if (!performance || midi) return;
  status.textContent = 'Requesting MIDI access (SysEx is not requested)…';
  try {
    const access = await requestMidiAccess();
    if (!performance) { return; }
    midi = createMidiAdapter(performance, access, { parts: 2, pitchBendRange: 2, onError: error => { status.textContent = `MIDI: ${error.message}`; } });
    status.textContent = midi.snapshot.inputs.length ? 'MIDI connected. Channel 1 plays part 0; channel 2 plays part 1.' : 'MIDI access granted, but no input is connected.';
  } catch (error) { status.textContent = `MIDI unavailable or denied: ${describe(error)}`; }
  refresh();
});
$<HTMLButtonElement>('dispose').addEventListener('click', async () => { await teardown(); status.textContent = 'Audio disposed.'; controls(); refresh(); });
window.addEventListener('pagehide', () => { leaving = true; void teardown(); controls(); });
window.addEventListener('pageshow', () => { leaving = false; controls(); });
controls();
refresh();
status.textContent = 'Click Start. Begin with a low device volume.';
