import { OPM } from '../src/api/index.js';
import type { NoteControls, QualityProfile } from '../src/api/index.js';
import type { NormalizedVoice, FourOperators, ADSR, OperatorWaveform } from '../src/voices/schema.js';
import { examples } from '../src/voices/examples.js';
import { presetMetadata } from '../src/voices/preset-metadata.js';
import { ALGORITHMS, designerPatch, parseDesignerPatch, envelopePoints, MAX_PATCH_BYTES } from './sound-design-model.js';

const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const choice = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const json = document.querySelector<HTMLTextAreaElement>('#patch-json')!;
let patch = designerPatch(examples.find(voice => voice.name === 'brass') ?? examples[0]!);
let opm: OPM | null = null, context: AudioContext | null = null, gain: GainNode | null = null;
let held: number | null = null, starting = false, leaving = false, generation = 0, spaceHeld = false;
const colors = ['#a21c35', '#156e37', '#245da8', '#734aa8'];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function controls(): void {
  const ready = Boolean(opm?.node && context?.state === 'running');
  button('start').disabled = starting || leaving;
  button('hold').disabled = starting || leaving || !ready || held !== null;
  button('release').disabled = held === null;
  button('panic').disabled = !opm?.node;
  button('dispose').disabled = starting || !opm;
  button('diagnostics').disabled = starting || !ready;
  choice('quality').disabled = starting;
}
function release(): void {
  const id = held; held = null; spaceHeld = false;
  if (id !== null) opm?.stop(id);
  controls();
}
function hold(): void {
  if (held !== null) return;
  if (!opm?.node || context?.state !== 'running') throw new Error('Start / resume audio first.');
  const note = field('note').valueAsNumber, velocity = field('velocity').valueAsNumber;
  if (!Number.isInteger(note) || note < 0 || note > 127 || !Number.isFinite(velocity) || velocity < 0 || velocity > 1) throw new RangeError('Use MIDI integer 0..127 and velocity 0..1.');
  held = opm.playNote({ voice: patch, note, velocity, duration: null });
  status.textContent = `Held note #${held}; ${opm.quality} profile. Native AudioWorklet controls enabled.`;
  controls();
}
function retrigger(): void {
  if (held === null) return;
  release(); hold();
}
function svg(parent: SVGElement, tag: string, attributes: Record<string, string>, text?: string): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  parent.append(node); return node;
}
function visualize(): void {
  const graph = document.querySelector<SVGElement>('#graph')!;
  graph.replaceChildren();
  const defs = svg(graph, 'defs', {}), marker = svg(defs, 'marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
  svg(marker, 'path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#333' });
  const xs = [65, 205, 345, 485], graphData = ALGORITHMS[patch.algorithm];
  for (let i = 0; i < 4; i++) {
    for (const source of graphData.inputs[i]!) svg(graph, 'path', { d: `M ${xs[source]! + 29} 75 Q ${(xs[source]! + xs[i]!) / 2} ${25 - (i - source) * 4} ${xs[i]! - 29} 75`, fill: 'none', stroke: '#333', 'marker-end': 'url(#arrow)' });
    svg(graph, 'circle', { cx: String(xs[i]), cy: '85', r: '28', fill: '#fff', stroke: colors[i]!, 'stroke-width': '3' });
    svg(graph, 'text', { x: String(xs[i]), y: '90', 'text-anchor': 'middle', fill: '#222' }, `Op ${i + 1}`);
    if (graphData.carriers.includes(i)) svg(graph, 'path', { d: `M ${xs[i]} 113 L ${xs[i]} 155 L 580 155`, fill: 'none', stroke: colors[i]!, 'marker-end': 'url(#arrow)' });
  }
  svg(graph, 'path', { d: 'M 45 65 C 0 0 125 0 85 65', fill: 'none', stroke: '#333', 'marker-end': 'url(#arrow)' });
  svg(graph, 'text', { x: '65', y: '17', 'text-anchor': 'middle', fill: '#222' }, `Feedback ${patch.feedback}`);
  svg(graph, 'text', { x: '583', y: '160', fill: '#222' }, 'Output');
  const env = document.querySelector<SVGElement>('#envelopes')!;
  env.replaceChildren();
  const gate = field('preview-gate').valueAsNumber;
  if (!Number.isFinite(gate) || gate < 0.01 || gate > 20) throw new RangeError('Preview gate must be 0.01..20 seconds.');
  const end = Math.max(0.01, ...patch.ops.map(op => gate + op.adsr.r));
  for (const db of [0, -24, -48, -72, -96]) {
    const y = 20 - db * 2;
    svg(env, 'line', { x1: '50', x2: '620', y1: String(y), y2: String(y), stroke: '#ddd' });
    svg(env, 'text', { x: '3', y: String(y + 4), fill: '#222' }, `${db} dB`);
  }
  for (let i = 0; i < 4; i++) {
    const points = envelopePoints(patch, i, gate);
    svg(env, 'polyline', { points: points.map(p => `${50 + p.time / end * 570},${20 - p.db * 2}`).join(' '), stroke: colors[i]!, 'stroke-width': '2', fill: 'none' });
    svg(env, 'text', { x: String(60 + i * 135), y: '252', fill: colors[i]! }, `Op ${i + 1}, s=${patch.ops[i]!.adsr.s}`);
  }
  svg(env, 'line', { x1: String(50 + gate / end * 570), x2: String(50 + gate / end * 570), y1: '20', y2: '212', stroke: '#555', 'stroke-dasharray': '4 4' });
  svg(env, 'text', { x: '50', y: '231', fill: '#222' }, `0 s; gate ${gate} s; plot end ${end.toFixed(2)} s`);
}
function render(): void {
  field('patch-name').value = patch.name!;
  choice('algorithm').value = String(patch.algorithm);
  field('feedback').value = String(patch.feedback); field('mod-index').value = String(patch.modIndex);
  for (let i = 0; i < 4; i++) {
    const op = patch.ops[i]!;
    for (const name of ['ratio', 'level', 'detune'] as const) field(`op${i}-${name}`).value = String(op[name]);
    for (const name of ['a', 'd', 's', 'r'] as const) field(`op${i}-${name}`).value = String(op.adsr[name]);
    field(`op${i}-am`).value = String(patch.lfo.amTargets?.[i] ?? 1);
    field(`op${i}-pm`).value = String(patch.lfo.pmTargets?.[i] ?? 1);
    choice(`op${i}-waveform`).value = op.waveform ?? 'sine';
    field(`op${i}-noiseRate`).value = String(op.noiseRate ?? 8000);
  }
  for (const [id, value] of [['lfo-rate', patch.lfo.rate], ['am-depth', patch.lfo.amDepth], ['pm-depth', patch.lfo.pmDepth], ['lfo-delay', patch.lfo.delay ?? 0], ['lfo-phase', patch.lfo.phase ?? 0]] as const) field(id).value = String(value);
  choice('waveform').value = patch.lfo.waveform ?? 'sine'; choice('lfo-sync').value = patch.lfo.sync ?? 'note';
  json.value = JSON.stringify(patch, null, 2); visualize();
}
function edit(id: string): void {
  const candidate = designerPatch(patch);
  candidate.name = field('patch-name').value;
  candidate.algorithm = Number(choice('algorithm').value) as NormalizedVoice['algorithm'];
  candidate.feedback = field('feedback').valueAsNumber as NormalizedVoice['feedback']; candidate.modIndex = field('mod-index').valueAsNumber;
  for (let i = 0; i < 4; i++) {
    const op = candidate.ops[i]!;
    for (const key of ['ratio', 'level', 'detune'] as const) op[key] = field(`op${i}-${key}`).valueAsNumber;
    for (const key of ['a', 'd', 's', 'r'] as const) op.adsr[key] = field(`op${i}-${key}`).valueAsNumber;
    op.waveform = choice(`op${i}-waveform`).value as OperatorWaveform;
    op.noiseRate = field(`op${i}-noiseRate`).valueAsNumber;
  }
  candidate.lfo = { rate: field('lfo-rate').valueAsNumber, amDepth: field('am-depth').valueAsNumber, pmDepth: field('pm-depth').valueAsNumber,
    waveform: choice('waveform').value as NormalizedVoice['lfo']['waveform'], delay: field('lfo-delay').valueAsNumber, phase: field('lfo-phase').valueAsNumber,
    sync: choice('lfo-sync').value as 'note' | 'global',
    amTargets: [0, 1, 2, 3].map(i => field(`op${i}-am`).valueAsNumber) as FourOperators<number>,
    pmTargets: [0, 1, 2, 3].map(i => field(`op${i}-pm`).valueAsNumber) as FourOperators<number> };
  patch = designerPatch(candidate);
  if (held !== null) {
    let live: NoteControls | null = null;
    if (/^op\d-ratio$/.test(id)) live = { operatorRatios: patch.ops.map(op => op.ratio) as FourOperators<number>, ramp: 0.02 };
    if (/^op\d-[adsr]$/.test(id)) live = { operatorADSR: patch.ops.map(op => op.adsr) as FourOperators<ADSR> };
    if (id === 'feedback') live = { feedback: patch.feedback, ramp: 0.02 };
    if (['lfo-rate', 'am-depth', 'pm-depth'].includes(id)) live = { lfoRate: patch.lfo.rate, amDepth: patch.lfo.amDepth, pmDepth: patch.lfo.pmDepth, ramp: 0.02 };
    if (id === 'patch-name') { /* Naming does not change the sounding snapshot. */ }
    else if (live) opm!.updateNote(held, live);
    else retrigger();
  }
  json.value = JSON.stringify(patch, null, 2); visualize();
}
for (let i = 0; i < 8; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = String(i); choice('algorithm').append(option); }
for (const voice of examples) { const option = document.createElement('option'); option.value = voice.name; option.textContent = voice.name; choice('recipe').append(option); }
const operators = document.querySelector('#operators')!;
for (let i = 0; i < 4; i++) {
  const group = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = `Operator ${i + 1}`; group.append(legend);
  const waveLabel = document.createElement('label'), waveSelect = document.createElement('select');
  waveLabel.textContent = 'Oscillator waveform'; waveSelect.id = `op${i}-waveform`;
  for (const name of ['sine', 'half', 'abs', 'quarter', 'alternating', 'camel', 'square', 'saw', 'noise']) {
    const option = document.createElement('option'); option.value = name; option.textContent = name; waveSelect.append(option);
  }
  waveLabel.append(waveSelect); group.append(waveLabel);
  const noiseLabel = document.createElement('label'), noiseInput = document.createElement('input');
  noiseLabel.textContent = 'Noise hold rate Hz (noise only)'; noiseInput.id = `op${i}-noiseRate`;
  noiseInput.type = 'number'; noiseInput.min = '20'; noiseInput.max = '20000'; noiseInput.step = '1';
  noiseLabel.append(noiseInput); group.append(noiseLabel);
  for (const [key, label, min, max, step] of [['ratio', 'Frequency ratio', 0.125, 32, 0.125], ['level', 'Level amplitude', 0, 1, 0.01], ['detune', 'Detune cents', -1200, 1200, 1], ['a', 'Attack seconds', 0, 10, 0.01], ['d', 'Decay seconds', 0, 10, 0.01], ['s', 'Sustain amplitude', 0, 1, 0.01], ['r', 'Release seconds', 0, 10, 0.01], ['am', 'LFO AM target weight', 0, 1, 0.1], ['pm', 'LFO PM target weight', 0, 1, 0.1]] as const) {
    const wrapper = document.createElement('label'), input = document.createElement('input'); wrapper.textContent = label; input.id = `op${i}-${key}`; input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); wrapper.append(input); group.append(wrapper);
  }
  operators.append(group);
}
function guard(action: () => void): void { try { action(); } catch (error) { status.textContent = `Rejected: ${errorText(error)}`; } }
for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#operators input, #operators select, #algorithm, #feedback, #mod-index, #patch-name, #lfo-rate, #am-depth, #pm-depth, #waveform, #lfo-delay, #lfo-phase, #lfo-sync')) input.addEventListener('change', () => guard(() => edit(input.id)));
field('preview-gate').addEventListener('input', () => guard(visualize));
function recipe(): void {
  patch = designerPatch(examples.find(voice => voice.name === choice('recipe').value)!);
  const meta = presetMetadata[patch.name ?? ''];
  document.querySelector('#recipe-info')!.textContent = meta ? `${meta.purpose}\nMIDI ${meta.intendedMidi.join('–')}; velocity ${meta.intendedVelocity.join('–')}; host trim ${meta.hostTrimDb} dB.\nProvenance: ${meta.provenance.kind}; ${meta.provenance.source}; ${meta.provenance.license}. Human listening remains unverified.` : 'Recipe metadata unavailable; no listening endorsement.';
  render(); retrigger();
}
choice('recipe').value = patch.name!; choice('recipe').addEventListener('change', () => guard(recipe));
async function close(): Promise<void> {
  generation++; const instance = opm, host = context; opm = null; context = null; held = null; spaceHeld = false;
  gain?.disconnect(); gain = null; controls();
  try { await instance?.close(); } finally { if (host && host.state !== 'closed') await host.close(); }
}
button('start').addEventListener('click', async () => {
  if (starting || leaving) return; starting = true; controls(); const token = generation;
  try {
    if (!context || context.state === 'closed') {
      if (opm) await close();
      context = new AudioContext(); gain = context.createGain(); gain.gain.value = field('host-gain').valueAsNumber; gain.connect(context.destination);
      context.addEventListener('statechange', () => { if (context?.state !== 'running') { held = null; spaceHeld = false; } controls(); });
      const instance = new OPM({ context, destination: gain, quality: choice('quality').value as QualityProfile, onEvent(event) {
        if (opm !== instance) return;
        if (event.type === 'error' || event.type === 'reset') { held = null; spaceHeld = false; if (event.type === 'error') status.textContent = `Audio failed: ${event.error.message}`; }
        if (event.type === 'note' && event.id === held && ['released', 'ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) { held = null; spaceHeld = false; }
        if (event.type === 'command' && event.state === 'rejected') status.textContent = `Worklet rejected ${event.command}: ${event.reason ?? 'no reason supplied'}`;
        controls();
      } }); opm = instance;
    }
    await context.resume(); await opm!.start();
    if (!leaving && token === generation) status.textContent = `Audio ${context.state}; ${opm!.quality}; ${context.sampleRate} Hz. Hold a note or Space.`;
  } catch (error) { status.textContent = `Start failed: ${errorText(error)}`; }
  finally { starting = false; controls(); }
});
button('hold').addEventListener('click', () => guard(hold)); button('release').addEventListener('click', () => guard(release));
button('panic').addEventListener('click', () => guard(() => { held = null; spaceHeld = false; opm?.panic(); status.textContent = 'Panic submitted; all voices and queued events cleared.'; controls(); }));
button('dispose').addEventListener('click', () => { void close().then(() => { status.textContent = 'Audio disposed. Start creates a fresh context.'; }).catch(error => { status.textContent = `Cleanup failed: ${errorText(error)}`; }); });
choice('quality').addEventListener('change', () => { void close().then(() => { status.textContent = 'Quality selected. Old audio disposed; click Start to create the new immutable profile.'; }).catch(error => { status.textContent = errorText(error); }); });
button('diagnostics').addEventListener('click', async () => { try { const info = await opm!.getDiagnostics(); status.textContent = `Native Worklet: voices ${info.activeVoices}; pending ${info.pendingEvents}; errors ${info.errors}; rejected ${info.rejectedNotes}.`; } catch (error) { status.textContent = errorText(error); } });
field('host-gain').addEventListener('input', () => guard(() => { const value = field('host-gain').valueAsNumber; if (!Number.isFinite(value) || value < 0 || value > 0.3) throw new RangeError('Host gain must be 0..0.3'); document.querySelector('#host-gain-value')!.textContent = String(value); if (context && gain) gain.gain.setTargetAtTime(value, context.currentTime, 0.01); }));
function importPatch(text: string): void { const next = parseDesignerPatch(text); patch = next; render(); retrigger(); status.textContent = 'Strict patch imported; canonical version 7. Optional waveform/noise/fixed-frequency/key/pitch settings are preserved in JSON.'; }
button('import-patch').addEventListener('click', () => guard(() => importPatch(json.value)));
button('export-patch').addEventListener('click', () => guard(() => { json.value = JSON.stringify(designerPatch(patch), null, 2); const url = URL.createObjectURL(new Blob([json.value], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${patch.name}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status.textContent = 'Canonical runnable patch exported locally; no upload.'; }));
field('patch-file').addEventListener('change', async () => { const file = field('patch-file').files?.[0]; if (!file) return; try { if (file.size > MAX_PATCH_BYTES) throw new RangeError('Patch exceeds 16 KiB'); importPatch(await file.text()); } catch (error) { status.textContent = `Rejected: ${errorText(error)}`; } finally { field('patch-file').value = ''; } });
window.addEventListener('keydown', event => { if (event.code !== 'Space' || event.repeat || event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName)) return; event.preventDefault(); guard(() => { hold(); spaceHeld = true; }); });
window.addEventListener('keyup', event => { if (event.code === 'Space' && spaceHeld) { event.preventDefault(); guard(release); } });
window.addEventListener('blur', () => { if (spaceHeld) guard(release); });
document.addEventListener('visibilitychange', () => { if (document.hidden && held !== null) guard(release); });
window.addEventListener('pagehide', () => { leaving = true; void close().catch(error => { status.textContent = `Cleanup failed: ${errorText(error)}`; }); });
window.addEventListener('pageshow', () => { leaving = false; controls(); });
recipe(); controls();
