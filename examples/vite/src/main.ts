import type { OPM as Synth, OPMEvent } from 'opm.js';
import type * as APIModule from 'opm.js';

type API = typeof APIModule;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const status = document.querySelector<HTMLElement>('#status')!;
let synth: Synth | undefined;
let context: AudioContext | undefined;
let gain: GainNode | undefined;
let unsubscribe: (() => void) | undefined;
const lifetime = new AbortController();
let disposed = false;
let note: number | undefined;
let busy = false;

const report = (event: OPMEvent) => {
  if (event.type === 'reset') {
    note = undefined;
    stop.disabled = true;
    status.textContent = `Reset: ${event.reason}`;
  }
  if (event.type === 'error') status.textContent = `Error: ${event.error.message}`;
  if (event.type === 'note' && event.id === note) {
    status.textContent = event.state;
    if (event.state === 'started' && context && typeof context.getOutputTimestamp === 'function') {
      const stamp = context.getOutputTimestamp();
      if (stamp.performanceTime > 0 && Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime)) {
        // Both timestamp fields describe the same device-output instant; do not add latency again.
        const outputTime = stamp.performanceTime + (event.time - stamp.contextTime) * 1000;
        status.title = `Estimated device-output onset: ${outputTime.toFixed(1)} ms on the performance clock`;
      }
    }
    if (['ended', 'rejected', 'stolen', 'cancelled'].includes(event.state)) {
      note = undefined;
      stop.disabled = true;
    }
  }
};
const onPlay = async () => {
  if (busy || disposed) return;
  busy = true;
  play.disabled = true;
  try {
    // Initiate resume synchronously within the trusted user gesture.
    context ??= new AudioContext();
    await context.resume();
    const url = `${import.meta.env.BASE_URL}opm/api/index.js`;
    // Import the actual installed package tree; processor-relative dependencies stay external.
    const { OPM } = await import(/* @vite-ignore */ url) as API;
    if (disposed) return;
    if (!synth) {
      gain = context.createGain();
      gain.gain.value = 0.08;
      gain.connect(context.destination);
      synth = new OPM({ context, destination: gain,
        workletUrl: `${import.meta.env.BASE_URL}opm/worklet/processor.js` });
      unsubscribe = synth.subscribe(report);
    }
    await synth.start();
    if (disposed) return;
    if (note !== undefined) synth.stop(note);
    note = synth.playNote({ note: 60, velocity: 0.65, duration: 10 });
    stop.disabled = false;
    status.textContent = 'Playing';
  } catch (error) {
    if (!disposed) status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    busy = false;
    play.disabled = disposed;
  }
};
const onStop = async () => {
  if (disposed || note === undefined || !synth) return;
  stop.disabled = true;
  try {
    const commandId = synth.stop(note);
    await synth.waitForCommand(commandId, { signal: lifetime.signal });
    // Admission is not release-tail completion; the ended event updates the visible state.
  } catch (error) {
    if (!disposed) status.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
};
play.addEventListener('click', onPlay);
stop.addEventListener('click', onStop);

window.addEventListener('pagehide', () => {
  disposed = true;
  lifetime.abort();
  unsubscribe?.();
  unsubscribe = undefined;
  play.removeEventListener('click', onPlay);
  stop.removeEventListener('click', onStop);
  // OPM borrows this host context, so the host must close it separately.
  const hostContext = context;
  context = undefined;
  const engine = synth;
  synth = undefined;
  const output = gain;
  gain = undefined;
  void (async () => {
    try { await engine?.dispose(); }
    finally {
      output?.disconnect();
      if (hostContext && hostContext.state !== 'closed') await hostContext.close();
    }
  })().catch(() => { /* Page teardown cannot present a useful recovery UI. */ });
}, { once: true });
