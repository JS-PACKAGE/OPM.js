import { OPM } from '../src/api/index.js';

const start = document.querySelector<HTMLButtonElement>('#start')!;
const connect = document.querySelector<HTMLButtonElement>('#connect')!;
const disconnect = document.querySelector<HTMLButtonElement>('#disconnect')!;
const hold = document.querySelector<HTMLButtonElement>('#hold')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const dispose = document.querySelector<HTMLButtonElement>('#dispose')!;
const diagnostics = document.querySelector<HTMLButtonElement>('#diagnostics')!;
const volume = document.querySelector<HTMLInputElement>('#volume')!;
const volumeValue = document.querySelector<HTMLOutputElement>('#volume-value')!;
const contextState = document.querySelector<HTMLOutputElement>('#context-state')!;
const routingState = document.querySelector<HTMLOutputElement>('#routing-state')!;
const noteState = document.querySelector<HTMLOutputElement>('#note-state')!;
const diagnosticsState = document.querySelector<HTMLOutputElement>('#diagnostics-state')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;

let host: AudioContext | null = null;
let hostGain: GainNode | null = null;
let opm: OPM | null = null;
let connected = false;
let heldId: number | null = null;
let busy = false;
let leaving = false;
let revision = 0;

function updateControls(): void {
  const ready = opm?.node != null && host?.state !== 'closed';
  const running = host?.state === 'running';
  if (!ready) {
    connected = false;
    heldId = null;
  }
  start.disabled = leaving || busy || (ready && running);
  connect.disabled = leaving || busy || !ready || connected;
  disconnect.disabled = leaving || busy || !ready || !connected;
  hold.disabled = leaving || busy || !ready || !running || heldId !== null;
  stop.disabled = leaving || busy || !ready || heldId === null;
  dispose.disabled = leaving || busy || opm === null;
  // A disconnected worklet may not process messages until it rejoins the graph.
  diagnostics.disabled = leaving || busy || !ready || !running || !connected;
  contextState.textContent = host ? `${host.state} (${host.sampleRate} Hz, host-owned)` : 'Not created';
  routingState.textContent = connected ? 'OPM → host GainNode → destination'
    : hostGain ? 'OPM disconnected; host GainNode → destination retained' : 'Host GainNode not created';
  noteState.textContent = heldId === null ? 'No held note' : `Held note #${heldId} (MIDI 60 / C4)`;
}

start.addEventListener('click', async () => {
  const currentRevision = revision;
  busy = true;
  updateControls();
  try {
    // Creation and resume begin in the click handler, never during page load.
    if (!host) {
      host = new AudioContext();
      host.addEventListener('statechange', updateControls);
      hostGain = host.createGain();
      hostGain.gain.value = volume.valueAsNumber;
      hostGain.connect(host.destination);
    }
    if (!opm) {
      const instance = new OPM({
        context: host,
        destination: null,
        onEvent(event) {
          if (leaving || opm !== instance) return;
          if (event.type === 'error') {
            status.textContent = `Audio failed: ${event.error.message}`;
          } else if (event.type === 'note') {
            if (event.state === 'rejected') {
              status.textContent = `Note #${event.id} rejected: ${event.reason ?? 'reason not supplied'}`;
            }
            if (event.id === heldId && ['released', 'ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)) {
              heldId = null;
            }
          }
          updateControls();
        },
      });
      opm = instance;
    }
    const instance = opm;
    const context = host;
    await context.resume();
    if (leaving || revision !== currentRevision) return;
    await instance.start();
    if (leaving || revision !== currentRevision) return;
    status.textContent = connected
      ? `OPM resumed; host context is ${context.state}, routing retained.`
      : `OPM started; host context is ${context.state}. destination: null; connect the GainNode manually.`;
  } catch (error) {
    if (!leaving && revision === currentRevision) {
      status.textContent = `Start failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    if (revision === currentRevision) {
      busy = false;
      updateControls();
    }
  }
});

connect.addEventListener('click', () => {
  try {
    if (!opm || !hostGain) throw new Error('Start OPM first.');
    opm.connect(hostGain);
    connected = true;
    status.textContent = 'Connected to the host GainNode; volume is controlled by the host.';
  } catch (error) {
    status.textContent = `Connection failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  updateControls();
});

disconnect.addEventListener('click', () => {
  try {
    if (!opm || !hostGain) throw new Error('Start OPM first.');
    opm.disconnect(hostGain);
    connected = false;
    status.textContent = 'Disconnected OPM → GainNode. The note is not stopped, and the host context is not suspended.';
  } catch (error) {
    status.textContent = `Disconnection failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  updateControls();
});

hold.addEventListener('click', () => {
  try {
    if (!opm) throw new Error('Start OPM first.');
    if (heldId !== null) return;
    heldId = opm.playNote({ note: 60, duration: null, velocity: 0.7 });
    status.textContent = connected
      ? `Held note #${heldId} started; adjust volume or disconnect routing.`
      : `Held note #${heldId} queued while disconnected; connect the GainNode to hear it.`;
  } catch (error) {
    status.textContent = `Playback failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  updateControls();
});

stop.addEventListener('click', () => {
  try {
    if (!opm || heldId === null) return;
    opm.stop(heldId);
    status.textContent = `Release requested for held note #${heldId}; its tail will end naturally.`;
    heldId = null;
  } catch (error) {
    status.textContent = `Stop failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  updateControls();
});

volume.addEventListener('input', () => {
  try {
    const value = volume.valueAsNumber;
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Volume must be between 0 and 1.');
    volumeValue.textContent = `${Math.round(value * 100)}%`;
    if (host && hostGain && host.state !== 'closed') {
      hostGain.gain.setTargetAtTime(value, host.currentTime, 0.01);
    }
  } catch (error) {
    status.textContent = `Volume adjustment failed: ${error instanceof Error ? error.message : String(error)}`;
  }
});

diagnostics.addEventListener('click', async () => {
  const currentRevision = revision;
  busy = true;
  updateControls();
  try {
    if (!opm) throw new Error('Start OPM first.');
    const info = await opm.getDiagnostics();
    if (leaving || revision !== currentRevision) return;
    diagnosticsState.textContent = `Voices ${info.activeVoices}; pending events ${info.pendingEvents}; errors ${info.errors}; rejected notes ${info.rejectedNotes}.`;
    status.textContent = 'Received diagnostics from the real AudioWorklet.';
  } catch (error) {
    if (!leaving && revision === currentRevision) {
      status.textContent = `Diagnostics failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    if (revision === currentRevision) {
      busy = false;
      updateControls();
    }
  }
});

dispose.addEventListener('click', async () => {
  const currentRevision = revision;
  busy = true;
  updateControls();
  try {
    if (!opm || !host) throw new Error('No OPM instance to dispose.');
    const instance = opm;
    const context = host;
    await instance.close();
    if (leaving || revision !== currentRevision) return;
    opm = null;
    heldId = null;
    connected = false;
    diagnosticsState.textContent = 'OPM disposed; restart and reconnect to read diagnostics again.';
    status.textContent = `OPM node disposed (node = ${String(instance.node)}); borrowed host context remains ${context.state}, not closed or suspended by OPM. You can start again.`;
  } catch (error) {
    if (!leaving && revision === currentRevision) {
      status.textContent = `Disposal failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    if (revision === currentRevision) {
      busy = false;
      updateControls();
    }
  }
});

window.addEventListener('pagehide', () => {
  leaving = true;
  revision++;
  busy = false;
  const instance = opm;
  const context = host;
  opm = null;
  host = null;
  heldId = null;
  connected = false;
  hostGain?.disconnect();
  hostGain = null;
  context?.removeEventListener('statechange', updateControls);
  updateControls();
  void instance?.close().catch(error => {
    status.textContent = `OPM cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
  });
  if (context && context.state !== 'closed') {
    // This page is the host, so only its teardown closes the borrowed context.
    void context.close().catch(error => {
      status.textContent = `Host cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
    });
  }
});

window.addEventListener('pageshow', () => {
  if (!leaving) return;
  leaving = false;
  diagnosticsState.textContent = 'Available while connected and the host is running.';
  status.textContent = 'Page restored; the previous host was cleaned up. Click Start again.';
  updateControls();
});

updateControls();
