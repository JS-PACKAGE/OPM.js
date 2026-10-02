import { OPM } from '../src/api/index.js';
import { examples } from '../src/voices/examples.js';
import { parseVoiceBank } from '../src/voices/schema.js';

const selector = document.querySelector<HTMLSelectElement>('#voice')!;
const noteInput = document.querySelector<HTMLInputElement>('#note')!;
const velocityInput = document.querySelector<HTMLInputElement>('#velocity')!;
const velocityValue = document.querySelector<HTMLOutputElement>('#velocity-value')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const hold = document.querySelector<HTMLButtonElement>('#hold')!;
const release = document.querySelector<HTMLButtonElement>('#release')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
let ready = false;
let starting = false;
let leaving = false;
let activeId: number | null = null;
let holding = false;
let description = '';

function updateButtons() {
  play.disabled = hold.disabled = !ready || starting || leaving;
  release.disabled = starting || leaving || activeId === null || !holding;
}

const opm = new OPM({ onEvent(event) {
  if (event.type === 'reset') {
    activeId = null;
    holding = false;
    updateButtons();
    status.textContent = `Audio reset: ${event.reason}`;
    return;
  }
  if (event.type === 'error') {
    activeId = null;
    holding = false;
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
      status.textContent = `${holding ? 'Holding note' : 'Playing short note'}: ${description}`;
      break;
    case 'released':
      holding = false;
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
      holding = false;
      break;
    }
  }
  updateButtons();
} });

try {
  for (const [name, voice] of parseVoiceBank(examples)) {
    opm.loadVoice(name, voice);
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selector.append(option);
  }
  selector.value = 'brass';
  ready = true;
  status.textContent = 'Voices loaded; click Play or Hold note.';
} catch (error) {
  status.textContent = `Voice loading failed: ${error instanceof Error ? error.message : String(error)}`;
}
updateButtons();

velocityInput.addEventListener('input', () => {
  velocityValue.value = velocityInput.value;
});

async function playNote(duration: number | null) {
  if (!ready || starting || leaving) return;
  if (!noteInput.reportValidity()) {
    status.textContent = 'Enter an integer MIDI pitch from 0 to 127.';
    return;
  }
  const note = noteInput.valueAsNumber;
  const velocity = velocityInput.valueAsNumber;
  const voice = selector.value;
  starting = true;
  updateButtons();
  status.textContent = 'Starting audio…';
  try {
    await opm.start();
    if (leaving) return;
    if (activeId !== null) {
      opm.stop(activeId);
      activeId = null;
      holding = false;
    }
    activeId = opm.playNote({ voice, note, velocity, duration });
    holding = duration === null;
    description = `${voice} · MIDI ${note} · velocity ${velocity} · #${activeId}`;
    status.textContent = `Waiting for note start: ${description}`;
  } catch (error) {
    status.textContent = `Playback failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    starting = false;
    updateButtons();
  }
}

play.addEventListener('click', () => { void playNote(0.7); });
hold.addEventListener('click', () => { void playNote(null); });
release.addEventListener('click', () => {
  if (activeId === null || !holding || starting || leaving) return;
  try {
    opm.stop(activeId);
    holding = false;
    status.textContent = `Release requested: ${description}`;
  } catch (error) {
    status.textContent = `Release failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  updateButtons();
});

window.addEventListener('pagehide', () => {
  leaving = true;
  activeId = null;
  holding = false;
  updateButtons();
  void opm.close().catch(error => {
    status.textContent = `Audio cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
  });
});
window.addEventListener('pageshow', () => {
  leaving = false;
  updateButtons();
});
