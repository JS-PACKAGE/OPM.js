// demo/song.ts
import { OPM } from "../api/index.js";
var opm = new OPM({ onEvent(event) {
  if (event.type === "note" && event.state === "rejected") {
    status.textContent = `\u97F3\u7B26\u672A\u88AB\u63A5\u53D7\uFF1A${event.reason}`;
  } else if (event.type === "error") {
    status.textContent = `\u97F3\u8A0A\u5931\u6557\uFF1A${event.error.message}`;
  }
} });
var play = document.querySelector("#play");
var stop = document.querySelector("#stop");
var status = document.querySelector("#status");
var beatSeconds = 0.5;
var melody = [
  [72, 72, 79, 79],
  [81, 81, 79],
  [77, 77, 76, 76],
  [74, 74, 72],
  [79, 79, 77, 77],
  [76, 76, 74],
  [79, 79, 77, 77],
  [76, 76, 74],
  [72, 72, 79, 79],
  [81, 81, 79],
  [77, 77, 76, 76],
  [74, 74, 72]
];
var chords = [
  [48, 52, 55],
  [45, 48, 52],
  [41, 45, 48],
  [43, 47, 50],
  [43, 47, 50],
  [48, 52, 55],
  [43, 47, 50],
  [48, 52, 55],
  [48, 52, 55],
  [45, 48, 52],
  [41, 45, 48],
  [48, 52, 55]
];
var songSeconds = melody.length * 4 * beatSeconds;
var notes = [];
var finishTimer;
function playSong() {
  for (let bar = 0; bar < melody.length; bar++) {
    const start = bar * 4 * beatSeconds;
    for (const note of chords[bar]) {
      notes.push(opm.playNote({
        note,
        time: start,
        duration: 4 * beatSeconds - 0.1,
        velocity: 0.55,
        pan: -0.35
      }));
    }
    let beat = 0;
    for (let i = 0; i < melody[bar].length; i++) {
      const length = i === 2 && melody[bar].length === 3 ? 2 : 1;
      notes.push(opm.playNote({
        note: melody[bar][i],
        time: start + beat * beatSeconds,
        duration: length * beatSeconds - 0.05,
        velocity: 0.85,
        pan: 0.35
      }));
      beat += length;
    }
  }
}
play.addEventListener("click", async () => {
  play.disabled = true;
  try {
    await opm.start();
    playSong();
    stop.disabled = false;
    status.textContent = "\u64AD\u653E\u4E2D\uFF1A\u300A\u5C0F\u661F\u661F\u300B";
    finishTimer = window.setTimeout(() => {
      notes = [];
      stop.disabled = true;
      play.disabled = false;
      status.textContent = "\u64AD\u653E\u5B8C\u7562";
    }, (songSeconds + 0.2) * 1e3);
  } catch (error) {
    for (const id of notes) opm.stop(id);
    notes = [];
    play.disabled = false;
    status.textContent = `\u64AD\u653E\u5931\u6557\uFF1A${error instanceof Error ? error.message : String(error)}`;
  }
});
stop.addEventListener("click", () => {
  clearTimeout(finishTimer);
  for (const id of notes) opm.stop(id);
  notes = [];
  stop.disabled = true;
  play.disabled = false;
  status.textContent = "\u5DF2\u505C\u6B62";
});
