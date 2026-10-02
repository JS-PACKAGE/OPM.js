import { OPM } from '../src/api/index.js';

const opm = new OPM({ onEvent(event) {
  if (event.type === 'note' && event.state === 'rejected') {
    status.textContent = `Note rejected: ${event.reason}`;
  } else if (event.type === 'error') {
    status.textContent = `Audio failed: ${event.error.message}`;
  }
} });
const play = document.querySelector<HTMLButtonElement>('#play')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const beatSeconds = 0.5;
// Each bar has four beats; a three-note bar holds its last note for two beats.
const melody = [
  [72, 72, 79, 79], [81, 81, 79],
  [77, 77, 76, 76], [74, 74, 72],
  [79, 79, 77, 77], [76, 76, 74],
  [79, 79, 77, 77], [76, 76, 74],
  [72, 72, 79, 79], [81, 81, 79],
  [77, 77, 76, 76], [74, 74, 72],
];
const chords = [
  [48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50],
  [43, 47, 50], [48, 52, 55], [43, 47, 50], [48, 52, 55],
  [48, 52, 55], [45, 48, 52], [41, 45, 48], [48, 52, 55],
];
const songSeconds = melody.length * 4 * beatSeconds;
let notes: number[] = [];
let finishTimer: number | undefined;

function playSong() {
  for (let bar = 0; bar < melody.length; bar++) {
    const start = bar * 4 * beatSeconds;
    for (const note of chords[bar]) {
      notes.push(opm.playNote({ note, time: start, duration: 4 * beatSeconds - 0.1,
        velocity: 0.55, pan: -0.35 }));
    }
    let beat = 0;
    for (let i = 0; i < melody[bar].length; i++) {
      const length = i === 2 && melody[bar].length === 3 ? 2 : 1;
      notes.push(opm.playNote({
        note: melody[bar][i], time: start + beat * beatSeconds,
        duration: length * beatSeconds - 0.05, velocity: 0.85, pan: 0.35,
      }));
      beat += length;
    }
  }
}

play.addEventListener('click', async () => {
  play.disabled = true;
  try {
    await opm.start();
    playSong();
    stop.disabled = false;
    status.textContent = 'Playing: Twinkle, Twinkle, Little Star';
    finishTimer = window.setTimeout(() => {
      notes = [];
      stop.disabled = true;
      play.disabled = false;
      status.textContent = 'Playback complete';
    }, (songSeconds + 0.2) * 1000);
  } catch (error) {
    for (const id of notes) opm.stop(id);
    notes = [];
    play.disabled = false;
    status.textContent = `Playback failed: ${error instanceof Error ? error.message : String(error)}`;
  }
});

stop.addEventListener('click', () => {
  clearTimeout(finishTimer);
  for (const id of notes) opm.stop(id);
  notes = [];
  stop.disabled = true;
  play.disabled = false;
  status.textContent = 'Stopped';
});
