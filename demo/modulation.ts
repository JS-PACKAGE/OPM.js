import { OPM } from '../src/api/index.js';
import { brass } from '../src/voices/brass.js';

const pan = document.querySelector<HTMLInputElement>('#pan')!;
const rate = document.querySelector<HTMLInputElement>('#rate')!;
const amDepth = document.querySelector<HTMLInputElement>('#am-depth')!;
const pmDepth = document.querySelector<HTMLInputElement>('#pm-depth')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
let starting = false;
let leaving = false;
let activeId: number | null = null;
let released = false;
let description = '';

function updateButtons() {
  play.disabled = starting || leaving;
  stop.disabled = starting || leaving || activeId === null || released;
}

const opm = new OPM({ onEvent(event) {
  if (event.type === 'error') {
    activeId = null;
    updateButtons();
    status.textContent = `Audio failed: ${event.error.message}`;
    return;
  }
  if (event.type !== 'note' || event.id !== activeId) return;
  switch (event.state) {
    case 'accepted':
      status.textContent = `Scheduled: ${description}`;
      break;
    case 'started':
      status.textContent = `Playing: ${description}`;
      break;
    case 'released':
      released = true;
      status.textContent = `Released; tail playing: ${description}`;
      break;
    case 'ended':
    case 'stolen':
    case 'cancelled':
    case 'rejected': {
      const lifecycle = event.state === 'ended' ? 'Note ended'
        : event.state === 'stolen' ? 'Note replaced'
        : event.state === 'cancelled' ? 'Note cancelled' : 'Note rejected';
      status.textContent = `${lifecycle}: ${description}${event.reason ? ` (${event.reason})` : ''}`;
      activeId = null;
      break;
    }
  }
  updateButtons();
} });

for (const [input, output] of [
  [pan, document.querySelector<HTMLOutputElement>('#pan-value')!],
  [rate, document.querySelector<HTMLOutputElement>('#rate-value')!],
  [amDepth, document.querySelector<HTMLOutputElement>('#am-depth-value')!],
  [pmDepth, document.querySelector<HTMLOutputElement>('#pm-depth-value')!],
] as const) {
  input.addEventListener('input', () => { output.value = input.value; });
}
updateButtons();
status.textContent = 'Choose settings, then click Play; MIDI 60, velocity 0.8.';

play.addEventListener('click', async () => {
  if (starting || leaving) return;
  const stereoPan = pan.valueAsNumber;
  const lfo = {
    rate: rate.valueAsNumber,
    amDepth: amDepth.valueAsNumber,
    pmDepth: pmDepth.valueAsNumber,
  };
  starting = true;
  updateButtons();
  status.textContent = 'Starting audio…';
  try {
    opm.loadVoice('modulation_brass', { ...brass, name: 'modulation_brass', lfo });
    await opm.start();
    if (leaving) return;
    if (activeId !== null) {
      opm.stop(activeId);
      activeId = null;
    }
    activeId = opm.playNote({ voice: 'modulation_brass', note: 60,
      duration: 3, velocity: 0.8, pan: stereoPan });
    released = false;
    description = `brass · pan ${stereoPan} · LFO ${lfo.rate} Hz · AM ${lfo.amDepth} · PM ${lfo.pmDepth} cents`;
    status.textContent = `Waiting for note start: ${description}`;
  } catch (error) {
    status.textContent = `Playback failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    starting = false;
    updateButtons();
  }
});

stop.addEventListener('click', () => {
  if (starting || leaving || activeId === null || released) return;
  try {
    opm.stop(activeId);
    released = true;
    status.textContent = `Release requested: ${description}`;
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
window.addEventListener('pageshow', () => {
  leaving = false;
  updateButtons();
});
