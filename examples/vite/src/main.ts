import type { OPM as Synth, OPMEvent } from 'opm.js';
import type * as APIModule from 'opm.js';

type API = typeof APIModule;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const status = document.querySelector<HTMLElement>('#status')!;
let synth: Synth | undefined;
let context: AudioContext | undefined;
let note: number | undefined;
let busy = false;

const report = (event: OPMEvent) => {
  if (event.type === 'error') status.textContent = `Error: ${event.error.message}`;
  if (event.type === 'note' && event.id === note) {
    status.textContent = event.state;
    if (event.state === 'ended' || event.state === 'rejected' || event.state === 'stolen') {
      note = undefined;
      stop.disabled = true;
    }
  }
};
play.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  play.disabled = true;
  try {
    // Initiate resume synchronously within the trusted user gesture.
    context ??= new AudioContext();
    const resumed = context.resume();
    const url = `${import.meta.env.BASE_URL}opm/api/index.js`;
    // Runtime deployment base selects an external copied module; bundling breaks worklet-relative URLs.
    const { OPM } = await import(/* @vite-ignore */ url) as API;
    if (!synth) {
      const gain = context.createGain();
      gain.gain.value = 0.08;
      gain.connect(context.destination);
      synth = new OPM({ context, destination: gain, onEvent: report });
    }
    await resumed;
    await synth.start();
    if (note !== undefined) synth.stop(note);
    note = synth.playNote({ note: 60, velocity: 0.65, duration: 10 });
    stop.disabled = false;
    status.textContent = 'Playing';
  } catch (error) {
    status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    busy = false;
    play.disabled = false;
  }
});
stop.addEventListener('click', () => {
  if (note !== undefined && synth) {
    synth.stop(note);
    status.textContent = 'Stopping';
    stop.disabled = true;
  }
});

window.addEventListener('pagehide', () => {
  // OPM borrows this host context, so the host must close it separately.
  const hostContext = context;
  context = undefined;
  const engine = synth;
  synth = undefined;
  void (async () => {
    try { await engine?.close(); }
    finally {
      if (hostContext && hostContext.state !== 'closed') await hostContext.close();
    }
  })().catch(() => { /* Page teardown cannot present a useful recovery UI. */ });
}, { once: true });
