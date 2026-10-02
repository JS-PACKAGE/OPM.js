import { OPM } from '../src/api/index.js';
import { brass } from '../src/voices/brass.js';

const pan = document.querySelector<HTMLInputElement>('#pan')!;
const pitch = document.querySelector<HTMLInputElement>('#pitch')!;
const glide = document.querySelector<HTMLInputElement>('#glide')!;
const expression = document.querySelector<HTMLInputElement>('#expression')!;
const modulation = document.querySelector<HTMLInputElement>('#modulation')!;
const rate = document.querySelector<HTMLInputElement>('#rate')!;
const amDepth = document.querySelector<HTMLInputElement>('#am-depth')!;
const pmDepth = document.querySelector<HTMLInputElement>('#pm-depth')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const sweep = document.querySelector<HTMLButtonElement>('#sweep')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
let starting = false;
let leaving = false;
let activeId: number | null = null;
let released = false;

function updateButtons() {
  play.disabled = starting || leaving;
  stop.disabled = starting || leaving || activeId === null || released;
  sweep.disabled = stop.disabled;
}

const opm = new OPM({ onEvent(event) {
  if (event.type === 'reset') {
    activeId = null;
    released = false;
    updateButtons();
    status.textContent = `Audio reset: ${event.reason}`;
    return;
  }
  if (event.type === 'error') {
    activeId = null;
    updateButtons();
    status.textContent = `Audio failed: ${event.error.message}`;
    return;
  }
  if (event.type !== 'note' || event.id !== activeId) return;
  const stamp = `${event.time.toFixed(3)} s / frame ${event.frame}`;
  if (event.state === 'released') released = true;
  if (['ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) activeId = null;
  status.textContent = `Note ${event.state} at ${stamp}${event.reason ? ` (${event.reason})` : ''}`;
  updateButtons();
} });

for (const input of [pan, pitch, glide, expression, modulation, rate, amDepth, pmDepth]) {
  const output = document.querySelector<HTMLOutputElement>(`#${input.id}-value`)!;
  input.addEventListener('input', () => {
    output.value = input.value;
    if (activeId === null || starting || leaving || ![pan, pitch, glide, expression, modulation].includes(input)) return;
    try {
      opm.updateNote(activeId, input === pan ? { pan: pan.valueAsNumber }
        : input === expression ? { expression: expression.valueAsNumber }
        : input === modulation ? { modulation: modulation.valueAsNumber }
        : { pitch: pitch.valueAsNumber, glide: glide.valueAsNumber });
    } catch (error) {
      status.textContent = `Control failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
}
updateButtons();
status.textContent = 'Click Play, then move the live controls. MIDI 60, velocity 0.8.';

play.addEventListener('click', async () => {
  if (starting || leaving) return;
  starting = true;
  updateButtons();
  status.textContent = 'Starting audio…';
  try {
    opm.loadVoice('modulation_brass', { ...brass, name: 'modulation_brass',
      lfo: { rate: rate.valueAsNumber, amDepth: amDepth.valueAsNumber, pmDepth: pmDepth.valueAsNumber } });
    await opm.start();
    if (leaving) return;
    if (activeId !== null) opm.stop(activeId);
    const at = opm.context!.currentTime + 0.15;
    activeId = opm.playNote({ voice: 'modulation_brass', note: 60, at, late: 'start', velocity: 0.8, pan: pan.valueAsNumber });
    opm.updateNote(activeId, { pitch: pitch.valueAsNumber, glide: glide.valueAsNumber,
      expression: expression.valueAsNumber, modulation: modulation.valueAsNumber });
    released = false;
    status.textContent = `Absolute onset queued for ${at.toFixed(3)} s; held until release.`;
  } catch (error) {
    status.textContent = `Playback failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    starting = false;
    updateButtons();
  }
});

sweep.addEventListener('click', () => {
  if (starting || leaving || activeId === null || released) return;
  try {
    const at = opm.context!.currentTime + 0.25;
    opm.updateNote(activeId, { pitch: 12, glide: 0.8, pan: 1, expression: 0.5, modulation: 1.5 }, { at });
    opm.stop(activeId, { at: at + 1.25 });
    status.textContent = `Octave glide / right pan at ${at.toFixed(3)} s; release at ${(at + 1.25).toFixed(3)} s. No note-release timer.`;
  } catch (error) {
    status.textContent = `Schedule failed: ${error instanceof Error ? error.message : String(error)}`;
  }
});

stop.addEventListener('click', () => {
  if (starting || leaving || activeId === null || released) return;
  try {
    opm.stop(activeId);
    released = true;
    status.textContent = 'Immediate release requested; natural tail remains.';
  } catch (error) {
    status.textContent = `Stop failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  updateButtons();
});

window.addEventListener('pagehide', () => {
  leaving = true;
  activeId = null;
  updateButtons();
  void opm.close().catch(error => {
    status.textContent = `Audio cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
  });
});
window.addEventListener('pageshow', () => { leaving = false; updateButtons(); });
