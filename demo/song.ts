import { OPM, createLookaheadScheduler } from '../src/api/index.js';
import type { LookaheadNote } from '../src/api/index.js';

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
const score: LookaheadNote[] = [];
for (let bar = 0; bar < melody.length; bar++) {
  const at = bar * 4 * beatSeconds;
  for (const note of chords[bar]) score.push({ note, at, duration: 4 * beatSeconds - 0.1, velocity: 0.55, pan: -0.35 });
  let beat = 0;
  for (let index = 0; index < melody[bar].length; index++) {
    const length = index === 2 && melody[bar].length === 3 ? 2 : 1;
    score.push({ note: melody[bar][index], at: at + beat * beatSeconds,
      duration: length * beatSeconds - 0.05, velocity: 0.85, pan: 0.35 });
    beat += length;
  }
}
score.sort((left, right) => left.at - right.at);
let index = 0;
let origin: number | null = null;
let playing = false;
let leaving = false;
const live = new Set<number>();

function finish(message: string) {
  playing = false;
  scheduler.stop();
  live.clear();
  stop.disabled = true;
  play.disabled = leaving;
  status.textContent = message;
}

const opm = new OPM({ onEvent(event) {
  if (event.type === 'error') { finish(`Audio failed: ${event.error.message}`); return; }
  if (event.type !== 'note') return;
  if (event.state === 'accepted') live.add(event.id);
  else if (['ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) live.delete(event.id);
  if (event.state === 'rejected') status.textContent = `Note rejected: ${event.reason}`;
  if (playing && index === score.length && live.size === 0) finish('Playback complete');
} });

const scheduler = createLookaheadScheduler(opm, ({ from, to, maxNotes }) => {
  origin ??= from + 0.1;
  const batch: LookaheadNote[] = [];
  // Timer stalls skip missed beats rather than bursting an entire song into the worklet.
  while (index < score.length && origin + score[index].at < from) index++;
  while (index < score.length && origin + score[index].at < to) {
    if (batch.length >= maxNotes) throw new RangeError('Song window exceeds its note batch');
    const note = score[index++];
    batch.push({ ...note, at: origin + note.at, late: 'drop' });
  }
  if (index === score.length && live.size === 0 && batch.length === 0) finish('Playback complete');
  return batch;
}, { horizon: 0.2, interval: 0.025, maxNotes: 16, onError(error) { finish(`Scheduling failed: ${error.message}`); } });

play.addEventListener('click', async () => {
  if (playing || leaving) return;
  play.disabled = true;
  playing = true;
  index = 0;
  origin = null;
  try {
    await scheduler.start();
    if (!playing || leaving) return;
    stop.disabled = false;
    status.textContent = 'Playing Twinkle, Twinkle, Little Star — 200 ms absolute-time lookahead';
  } catch (error) {
    finish(`Playback failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});
stop.addEventListener('click', () => { finish('Stopped'); });
window.addEventListener('pagehide', () => {
  leaving = true;
  finish('Stopped');
  void opm.close().catch(error => { status.textContent = `Audio cleanup failed: ${error instanceof Error ? error.message : String(error)}`; });
});
window.addEventListener('pageshow', () => { leaving = false; play.disabled = false; });
