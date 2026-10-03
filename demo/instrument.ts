import { OPM, VERSION, createPerformance, createMidiAdapter, requestMidiAccess } from '../src/api/index.js';
import type { MidiAdapter, Performance } from '../src/api/index.js';
import type { MidiAccessLike, MidiInputLike, MidiMessageEventLike, MidiControllerMapping } from '../src/api/midi.js';
import { examples } from '../src/voices/examples.js';

const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const status = $<HTMLOutputElement>('status');
const readout = $<HTMLElement>('readout');
const keyboard = $<HTMLElement>('keyboard');
const KEYS = 'awsedftgyhujk';
const BASE = 60;
// Browser sliders and MIDI knobs use the same bounded FM ranges.
const FM_CONTROLLERS: readonly MidiControllerMapping[] = [
  { controller: 16, field: 'feedback', min: 0, max: 7, ramp: 0.05 },
  { controller: 17, field: 'operatorRatios', operator: 0, min: 0.5, max: 6, ramp: 0.05 },
  { controller: 18, field: 'operatorLevels', operator: 1, min: 0, max: 2, ramp: 0.05 },
  { controller: 19, field: 'lfoRate', min: 0, max: 20, ramp: 0.05 },
];
// One immutable construction policy also supplies the evidence's submitted settings.
const ENGINE_SETTINGS = Object.freeze({
  quality: 'standard', maxVoices: 16, mixGain: 0.35, stealing: 'oldest', interruption: 'cancel',
  tuning: Object.freeze({ referenceHz: 440, offsets: Object.freeze(new Array<number>(128).fill(0)) }),
} as const);
let opm: OPM | null = null;
let performance: Performance | null = null;
let midi: MidiAdapter | null = null;
let starting = false;
let leaving = false;
let midiRequestPending = false;
let octave = 0;
const down = new Map<string, number>();
const pointers = new Map<number, { code: string; key: number }>();

// Local manual evidence is a declaration, never hardware authentication.
type Judgment = 'pass' | 'fail' | 'unverified';
const MIDI_SCENARIOS = {
  permission: 'Begin before Connect Web MIDI. Exercise the real permission prompt (grant or deny); record the browser decision and whether a prompt appeared. A previously granted origin is not a fresh-prompt test.',
  connect: 'Connect a physical controller. Play channels 1 and 2, repeated equal pitches and note-on velocity zero. Check routing, release and comfortable output; record any unsupported controller features.',
  unplug: 'Hold notes and sustain on the physical controller, then unplug it. Check its notes stop after release tails and no stale notes return after reconnect. If using two inputs, verify the other input remains playable.',
  sustain: 'On channel 2, press CC64 pedal, play/release a chord, then lift pedal. Test CC123 while pedal is down, followed by CC120; verify forced cleanup. Check host keys separately because pedal state is shared per part.',
  cc: 'Hold a note and move actual CC16–19 knobs through endpoints and middle values. Listen for feedback/ratio/level/LFO changes, then send CC121 to restore adapter-creation baselines. Also exercise CC1/7/10/11 and pressure if available; state what was not exercised.',
  bend: 'Hold a note on each routed channel, bend fully down/up (±2 semitones), then center. Check new notes, released tails and unchanged other-channel pitch; note the controller’s center behavior.',
} as const;
type MidiScenario = keyof typeof MIDI_SCENARIOS;
interface MidiRun {
  id: number; scenario: MidiScenario; startedAt: string; endedAt: string | null; durationSeconds: number;
  packageVersion: string; environment: string; device: string; browser: string; controller: string; route: string;
  userAgent: string; beginSettings: object; endSettings: object | null; scopeChanged: boolean;
  physical: boolean; listened: boolean; manualJudgment: Judgment; acceptanceStatus: Judgment; notes: string;
  observations: object[]; droppedObservations: number;
}
const midiRuns: MidiRun[] = [];
const MAX_RUNS = 24, MAX_OBSERVATIONS = 256;
let activeRun: MidiRun | null = null, runStarted = 0, nextRun = 1;
let stopObserving: (() => void) | null = null;
const exportURLs = new Set<string>();
const captureField = <T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement>(id: string) => $<T>(`capture-${id}`);
function adapterSnapshot(): object | null {
  if (!midi) return null;
  const snapshot = midi.snapshot;
  return { ...snapshot, inputs: snapshot.inputs.map(id => id.slice(0, 160)) };
}
function appliedSettings(): object {
  const bank = opm?.voices;
  return {
    ...ENGINE_SETTINGS,
    revision: 'instrument-midi-1', ready: performance !== null, sampleRate: opm?.context?.sampleRate ?? null,
    quality: opm?.quality ?? null, maxVoices: opm?.maxVoices ?? null,
    selectedPart: part(), octave,
    parts: performance ? [0, 1].map(index => ({
      state: performance!.getPart(index), controls: performance!.getPartControls(index),
      patch: bank?.get(index === 0 ? 'lead' : 'strings') ?? null,
    })) : [],
    adapter: adapterSnapshot(), pitchBendRange: 2, controllerMap: FM_CONTROLLERS,
  };
}
function captureDisplay(): void {
  $<HTMLElement>('capture-instructions').textContent = MIDI_SCENARIOS[$<HTMLSelectElement>('capture-scenario').value as MidiScenario];
  $<HTMLElement>('capture-preview').textContent = midiRuns.map(run =>
    `#${run.id} ${run.scenario}: ${run.endedAt ? run.acceptanceStatus : 'active / unverified'}; manual ${run.manualJudgment}; events ${run.observations.length}, dropped ${run.droppedObservations}; scope changed ${run.scopeChanged}`
  ).join('\n') || `OPM.js ${VERSION}: no local captures. Controller identifiers appear below after connection.`;
  $<HTMLButtonElement>('capture-begin').disabled = activeRun !== null || !performance || midiRuns.length >= MAX_RUNS;
  $<HTMLButtonElement>('capture-finish').disabled = activeRun === null;
}
function observe(type: string, detail: object = {}): void {
  if (!activeRun) return;
  if (activeRun.observations.length === MAX_OBSERVATIONS) {
    activeRun.observations.shift();
    activeRun.droppedObservations++;
  }
  activeRun.observations.push({
    at: new Date().toISOString(), elapsedSeconds: (globalThis.performance.now() - runStarted) / 1000,
    source: 'page-observation-not-manual-judgment', type, ...detail,
  });
  captureDisplay();
}
function invalidateCapture(reason: string): void {
  captureField('physical').checked = false;
  captureField('listened').checked = false;
  if (activeRun) activeRun.scopeChanged = true;
  observe('scope-changed', { reason });
}
function observeAccess(access: MidiAccessLike): () => void {
  const attached = new Map<MidiInputLike, (event: MidiMessageEventLike) => void>();
  const refreshInputs = () => {
    const inputs = [...access.inputs.values()].filter(input => input.state !== 'disconnected').slice(0, 32);
    for (const [input, listener] of attached) if (!inputs.includes(input)) {
      input.removeEventListener('midimessage', listener);
      attached.delete(input);
    }
    for (const input of inputs) if (!attached.has(input)) {
      const listener = (event: MidiMessageEventLike) => {
        const data = event.data;
        // Never retain SysEx or arbitrary controller payloads.
        if (!data || data.length < 2 || data.length > 3 || data[0]! < 0x80 || data[0]! >= 0xf0) return;
        observe('midi-message', { inputId: input.id.slice(0, 160), bytes: Array.from(data),
          adapter: adapterSnapshot(),
          controls: performance ? [0, 1].map(index => performance!.getPartControls(index)) : [] });
        refresh();
      };
      input.addEventListener('midimessage', listener);
      attached.set(input, listener);
    }
    observe('inputs-observed', { inputs: inputs.map(input => ({
      id: input.id.slice(0, 160), name: input.name?.slice(0, 160) ?? null,
      state: input.state?.slice(0, 40) ?? null, connection: input.connection?.slice(0, 40) ?? null,
    })), adapter: adapterSnapshot() });
    $<HTMLElement>('capture-inputs').textContent = inputs.map(input =>
      `ID: ${input.id.slice(0, 160)}; name: ${input.name?.slice(0, 160) ?? '(not provided)'}`
    ).join('\n') || 'No connected inputs observed.';
    refresh();
  };
  access.addEventListener('statechange', refreshInputs);
  refreshInputs();
  return () => {
    access.removeEventListener('statechange', refreshInputs);
    for (const [input, listener] of attached) input.removeEventListener('midimessage', listener);
    attached.clear();
  };
}
function finishCapture(abandoned = false): void {
  const run = activeRun;
  if (!run) return;
  observe(abandoned ? 'capture-abandoned' : 'capture-finished');
  run.endedAt = new Date().toISOString();
  run.durationSeconds = (globalThis.performance.now() - runStarted) / 1000;
  run.endSettings = appliedSettings();
  run.physical = captureField('physical').checked;
  run.listened = captureField('listened').checked;
  run.manualJudgment = $<HTMLSelectElement>('capture-judgment').value as Judgment;
  run.notes = captureField('notes').value.slice(0, 1200);
  run.acceptanceStatus = !abandoned && run.environment === 'physical' && run.physical && run.listened
    && !run.scopeChanged && run.droppedObservations === 0 ? run.manualJudgment : 'unverified';
  activeRun = null;
  captureField('physical').checked = false;
  captureField('listened').checked = false;
  captureDisplay();
}
$<HTMLButtonElement>('capture-begin').addEventListener('click', () => {
  if (activeRun || !performance || midiRuns.length >= MAX_RUNS) return;
  const scenario = $<HTMLSelectElement>('capture-scenario').value as MidiScenario;
  const required = ['device', 'browser', 'controller', 'route'] as const;
  if (required.some(id => !captureField(id).value.trim() || captureField(id).value.length > 160)) {
    status.textContent = 'Enter exact device/OS, browser, controller and route (1–160 characters each).'; return;
  }
  captureField('physical').checked = false;
  captureField('listened').checked = false;
  $<HTMLSelectElement>('capture-judgment').value = 'unverified';
  captureField('notes').value = '';
  runStarted = globalThis.performance.now();
  activeRun = {
    id: nextRun++, scenario, startedAt: new Date().toISOString(), endedAt: null, durationSeconds: 0,
    packageVersion: VERSION, environment: $<HTMLSelectElement>('capture-environment').value,
    device: captureField('device').value.trim(), browser: captureField('browser').value.trim(),
    controller: captureField('controller').value.trim(), route: captureField('route').value.trim(),
    userAgent: navigator.userAgent.slice(0, 240), beginSettings: appliedSettings(), endSettings: null,
    scopeChanged: false, physical: false, listened: false, manualJudgment: 'unverified', acceptanceStatus: 'unverified',
    notes: '', observations: [], droppedObservations: 0,
  };
  midiRuns.push(activeRun);
  observe('capture-began');
});
$<HTMLButtonElement>('capture-finish').addEventListener('click', () => {
  finishCapture();
  performance?.allNotesOff();
  midi?.releaseAll();
  refresh();
});
$<HTMLButtonElement>('capture-export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({
    format: 'opm-local-midi-observations', version: 1,
    notice: 'Unauthenticated manual declarations; automation cannot certify physical MIDI or listening.',
    limits: { runs: MAX_RUNS, observationsPerRun: MAX_OBSERVATIONS, notes: 1200 }, runs: midiRuns,
  }, null, 2)], { type: 'application/json' }));
  exportURLs.add(url);
  const link = document.createElement('a');
  link.href = url; link.download = `opm-midi-observations-${VERSION}.json`; link.click();
  setTimeout(() => { URL.revokeObjectURL(url); exportURLs.delete(url); }, 1000);
  status.textContent = 'Local observations exported. Review controller IDs and notes before sharing.';
});
$<HTMLButtonElement>('capture-clear').addEventListener('click', () => {
  if (activeRun) { status.textContent = 'Finish the active capture before clearing.'; return; }
  midiRuns.length = 0; captureDisplay();
});
for (const id of ['scenario', 'environment', 'device', 'browser', 'controller', 'route']) {
  $<HTMLElement>(`capture-${id}`).addEventListener('change', () => {
    invalidateCapture('Capture conditions edited; begin a new run for changed conditions.'); captureDisplay();
  });
}

function part(): number { return Number($<HTMLSelectElement>('part').value); }
function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function controls(): void {
  const ready = performance !== null;
  $<HTMLButtonElement>('start').disabled = starting || leaving;
  $<HTMLButtonElement>('release').disabled = !ready;
  $<HTMLButtonElement>('midi').disabled = !ready || midi !== null || midiRequestPending || starting || leaving || !('requestMIDIAccess' in navigator);
  $<HTMLButtonElement>('dispose').disabled = !opm || starting;
  captureDisplay();
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
  try {
    const key = performance.noteOn(part(), note, { velocity });
    observe('host-note-on-action', { part: part(), note, velocity, key });
    refresh(); return key;
  } catch (error) {
    status.textContent = `Note rejected: ${describe(error)}`;
    observe('host-note-error', { message: describe(error).slice(0, 240) }); return null;
  }
}
function lift(key: number): void {
  try {
    const released = performance?.noteOff(part(), key) ?? false;
    observe('host-note-off-action', { part: part(), key, released }); refresh();
  } catch (error) { status.textContent = describe(error); observe('host-note-error', { message: describe(error).slice(0, 240) }); }
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
  finishCapture(true);
  stopObserving?.();
  stopObserving = null;
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
    if (held && event.pressure > 0) try {
      performance?.updateKey(part(), held.key, { modulation: 1 + event.pressure });
      observe('host-pressure-action', { part: part(), key: held.key, modulation: 1 + event.pressure });
    } catch (error) { status.textContent = describe(error); }
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
octaveInput.addEventListener('input', () => { octave = Number(octaveInput.value); invalidateCapture('Host octave changed.'); });
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
  try {
    if (!performance) return;
    const ratios = [...performance.getPartControls(part()).operatorRatios!] as [number, number, number, number];
    ratios[0] = Number(ratioInput.value);
    performance.updatePartNotes(part(), { operatorRatios: ratios, ramp: 0.05 });
  } catch (error) { status.textContent = describe(error); }
});
for (const [id, field] of [['feedback', 'feedback'], ['lfo-rate', 'lfoRate']] as const) {
  $<HTMLInputElement>(id).addEventListener('input', event => {
    try { performance?.updatePartNotes(part(), { [field]: Number((event.target as HTMLInputElement).value), ramp: 0.05 }); }
    catch (error) { status.textContent = describe(error); }
  });
}
$<HTMLInputElement>('level').addEventListener('input', event => {
  try {
    if (!performance) return;
    const levels = [...performance.getPartControls(part()).operatorLevels!] as [number, number, number, number];
    levels[1] = Number((event.target as HTMLInputElement).value);
    performance.updatePartNotes(part(), { operatorLevels: levels, ramp: 0.05 });
  } catch (error) { status.textContent = describe(error); }
});
$<HTMLInputElement>('glide').addEventListener('change', () => { invalidateCapture('Part glide reconfigured.'); configure(); });
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
    if (leaving) return;
    const instance = new OPM({ ...ENGINE_SETTINGS, onEvent: event => {
      observe('engine-event', { eventType: event.type,
        state: 'state' in event ? event.state : null,
        reason: 'reason' in event && typeof event.reason === 'string' ? event.reason.slice(0, 240) : null });
    } });
    opm = instance;
    instance.replaceVoiceBank(examples);
    await instance.start();
    if (leaving || opm !== instance) { await instance.dispose(); return; }
    performance = createPerformance(instance, { parts: 2, onError: error => {
      status.textContent = `Performance error: ${error.message}`;
      observe('performance-error', { message: error.message.slice(0, 240) });
    } });
    configure();
    status.textContent = 'Ready. Play A–K (white and black rows mapped chromatically) or the buttons. Part 0 is a protected mono lead; part 1 is a limited poly pad.';
  } catch (error) {
    status.textContent = `Start failed: ${describe(error)}`;
    await teardown().catch(() => {});
  } finally { starting = false; controls(); refresh(); }
});
$<HTMLButtonElement>('midi').addEventListener('click', async () => {
  if (!performance || midi || midiRequestPending) return;
  const owner = performance;
  midiRequestPending = true;
  controls();
  status.textContent = 'Requesting MIDI access (SysEx is not requested)…';
  observe('permission-requested', { sysex: false });
  try {
    const access = await requestMidiAccess();
    if (performance !== owner || leaving) return;
    observe('permission-granted');
    midi = createMidiAdapter(owner, access, {
      parts: 2, pitchBendRange: 2, controllerMap: FM_CONTROLLERS,
      onError: error => {
        status.textContent = `MIDI: ${error.message}`;
        observe('midi-error', { message: error.message.slice(0, 240) });
      },
    });
    stopObserving = observeAccess(access);
    status.textContent = midi.snapshot.inputs.length ? 'MIDI connected. Channels 1/2 play parts 0/1; CC16 feedback, CC17 operator 1 ratio, CC18 operator 2 level, CC19 LFO rate.' : 'MIDI access granted, but no input is connected.';
  } catch (error) {
    if (performance === owner) {
      status.textContent = `MIDI unavailable or denied: ${describe(error)}`;
      observe('permission-or-adapter-error', { message: describe(error).slice(0, 240) });
    }
  } finally { midiRequestPending = false; controls(); }
  refresh();
});
$<HTMLButtonElement>('dispose').addEventListener('click', async () => { await teardown(); status.textContent = 'Audio disposed.'; controls(); refresh(); });
window.addEventListener('pagehide', () => {
  leaving = true;
  for (const url of exportURLs) URL.revokeObjectURL(url);
  exportURLs.clear();
  void teardown().catch(() => {});
  controls();
});
window.addEventListener('pageshow', () => { leaving = false; controls(); });
$<HTMLSelectElement>('part').addEventListener('change', () => { invalidateCapture('Selected host part changed.'); });
for (const id of ['bend', 'wheel', 'ratio', 'feedback', 'level', 'lfo-rate', 'sustain']) {
  $<HTMLInputElement>(id).addEventListener(id === 'sustain' ? 'change' : 'input', () => {
    observe('host-control-action', { control: id, applied: performance?.getPartControls(part()) ?? null });
  });
}
$<HTMLButtonElement>('release').addEventListener('click', () => { observe('host-release-action', { adapter: adapterSnapshot() }); });
captureDisplay();
controls();
refresh();
status.textContent = 'Click Start. Begin with a low device volume.';
