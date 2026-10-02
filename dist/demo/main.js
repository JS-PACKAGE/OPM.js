// demo/main.ts
import { OPM } from "../api/index.js";
import { renderNote, encodeWav } from "../core/index.js";
import { brass } from "../voices/brass.js";
import { importDX7, describeDX7 } from "../voices/dx7.js";
import { parseVoiceBank } from "../voices/schema.js";
import { examples } from "../voices/examples.js";
function element(selector2) {
  const result = document.querySelector(selector2);
  if (!result) throw new Error(`Missing demo element: ${selector2}`);
  return result;
}
var status = element("#status");
var release = element("#release");
var selector = element("#voice");
var voices = /* @__PURE__ */ new Map([["brass", brass]]);
var heldId = null;
var opm = new OPM({ onEvent(event) {
  if (event.type === "error") status.textContent = event.error.message;
  if (event.type === "note" && event.state === "rejected") {
    status.textContent = `Note rejected: ${event.reason}`;
  }
  if (event.type === "note" && event.id === heldId && ["ended", "stolen", "cancelled", "rejected"].includes(event.state)) {
    heldId = null;
    release.disabled = true;
  }
} });
function options() {
  return {
    voice: selector.value,
    velocity: Number(element("#velocity").value),
    pan: Number(element("#pan").value)
  };
}
function action(id, run) {
  const button = element(`#${id}`);
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      button.disabled = id === "release" && heldId === null;
    }
  });
}
function addVoice(voice) {
  opm.loadVoice(voice.name, voice);
  voices.set(voice.name, voice);
  if (![...selector.options].some((option) => option.value === voice.name)) {
    const option = document.createElement("option");
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
action("play", async () => {
  await opm.start();
  for (const note of [60, 64, 67]) opm.playNote({ ...options(), note, duration: 0.7 });
  status.textContent = `Playing ${selector.value} chord`;
});
action("hold", async () => {
  await opm.start();
  if (heldId !== null) opm.stop(heldId);
  heldId = opm.playNote({ ...options(), note: 60 });
  release.disabled = false;
  status.textContent = "Holding note \u2014 press Release note to end the gate";
});
action("release", async () => {
  if (heldId !== null) opm.stop(heldId);
  heldId = null;
  status.textContent = "Released note";
});
action("scaling", async () => {
  await opm.start();
  const voice = { ...brass, version: 2, ops: brass.ops.map((op) => ({
    ...op,
    keyScale: { breakpoint: 60, leftDbPerOctave: 0, rightDbPerOctave: 12 }
  })) };
  [48, 60, 72, 84].forEach((note, index) => {
    opm.playNote({ voice, note, time: index * 0.35, duration: 0.3, velocity: 0.8 });
  });
  status.textContent = "Playing key-scaled arpeggio: 12 dB attenuation per octave above C4";
});
action("suspend", async () => {
  await opm.start();
  await opm.context.suspend();
  status.textContent = "Audio suspended";
});
action("resume", async () => {
  await opm.resume();
  status.textContent = `Audio ${opm.context.state}`;
});
var dx7 = element("#dx7");
dx7.addEventListener("change", async () => {
  try {
    const file = dx7.files?.[0];
    if (!file) return;
    if (file.size > 4104) throw new RangeError("DX7 SysEx exceeds one standard bank");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const imported = importDX7(bytes);
    const descriptions = describeDX7(bytes);
    for (const voice of imported) addVoice(voice);
    selector.value = imported[0].name;
    status.textContent = `Imported ${imported.length} approximate DX7 voice(s). ${descriptions[0].warnings.join(" ")}`;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});
action("wav", async () => {
  const { left, right, sampleRate } = renderNote({
    voice: voices.get(selector.value),
    note: 60,
    duration: 0.7,
    velocity: options().velocity,
    pan: options().pan,
    sampleRate: 48e3
  });
  const bytes = encodeWav({ left, right, sampleRate });
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${selector.value}.wav`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
  status.textContent = "Downloaded stereo PCM16 WAV";
});
action("diagnostics", async () => {
  await opm.start();
  const info = await opm.getDiagnostics();
  status.textContent = `${info.activeVoices} active voices; ${info.pendingEvents} pending events; ${info.errors} errors; ${info.rejectedNotes} rejected notes`;
});
