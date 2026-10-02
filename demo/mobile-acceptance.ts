type Policy = 'cancel' | 'preserve';
type Judgment = 'pass' | 'fail' | 'unverified';
const scenarios = {
  'lock-unlock': 'Begin, lock for at least 30 seconds, unlock, listen before and after tapping Start / resume. Record whether the held gate resumed and whether the +5-second onset replayed.',
  'switch-app': 'Begin, switch to another app for at least 30 seconds, return, listen and tap Start / resume. Check duplicate gates and unexpected replay.',
  'call-interruption': 'Begin, receive an actual call or system audio interruption, return and tap Start / resume. Record whether the OS interrupted the context; do not equate no interruption with policy proof.',
  'bluetooth-route': 'Begin, connect then disconnect a Bluetooth audio device. Record route names, actual sample rate and audible gaps before/after Start / resume.',
  'headset-route': 'Begin, insert then remove a wired/USB headset. Record route changes and audible gaps; an unavailable connector remains unverified.',
  'battery-saver': 'Begin, enable Low Power Mode / Battery Saver, switch away and return, then resume. Record battery level and settings in notes; the browser cannot detect the mode reliably.',
  'long-play': 'Begin and listen for at least 10 minutes, including background/foreground if desired. Mark every audible dropout. Retained event history is bounded; elapsed duration is still recorded.',
  'main-thread-stall': 'Begin, press Stall main thread (2 seconds), and listen. Timer gaps are observations, not proof of AudioWorklet underruns or a physical OS interruption.',
  'dispose-recreate': 'Begin, press Dispose synth, check silence, then Start / resume. The old gate must not return; the borrowed context remains owned by this page.',
} as const;
type Scenario = keyof typeof scenarios;
type Observation = Record<string, unknown>;
interface Run {
  id: number; scenario: Scenario; policy: Policy; startedAt: string; endedAt: string | null;
  durationSeconds: number; environment: string; device: string; os: string; browser: string;
  userAgent: string; sampleRate: number | null; endSampleRate: number | null;
  endPolicy: Policy | null;
  manualJudgment: Judgment; acceptanceStatus: Judgment; listened: boolean; notes: string;
  observations: Observation[]; droppedObservations: number; markers: Observation[];
}
const MAX_RUNS = 24, MAX_EVENTS = 256, MAX_MARKERS = 64;

// Keep external error/event text bounded and use textContent throughout, never HTML.
function safe(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.slice(0, 240);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || typeof value === 'boolean') return value;
  if (depth >= 4 || typeof value !== 'object') return null;
  if (Array.isArray(value)) return value.slice(0, 32).map(item => safe(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => [key.slice(0, 80), safe(item, depth + 1)]));
}

export function installAcceptanceHarness(host: {
  sampleRate: () => number | null; policy: () => Policy; ready: () => boolean;
  begin: () => void; end: () => void;
}): { record: (event: Observation) => Observation } {
  const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
  const choice = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!;
  const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!;
  const output = document.querySelector<HTMLOutputElement>('#acceptance-status')!;
  const instructions = document.querySelector<HTMLParagraphElement>('#scenario-instructions')!;
  const summary = document.querySelector<HTMLPreElement>('#acceptance-runs')!;
  const runs: Run[] = [];
  let active: Run | null = null, started = 0, nextId = 1, droppedRuns = 0, totalEvents = 0;
  const record = (event: Observation): Observation => {
    const bounded = safe({ ...event, observedAt: performance.now(), wallTime: new Date().toISOString(),
      contextSampleRate: host.sampleRate() }) as Observation;
    totalEvents++;
    if (active) {
      active.observations.push(bounded);
      if (active.observations.length > MAX_EVENTS) { active.observations.shift(); active.droppedObservations++; }
    }
    return bounded;
  };
  const display = () => {
    instructions.textContent = scenarios[choice('scenario').value as Scenario];
    button('begin-scenario').disabled = Boolean(active);
    button('finish-scenario').disabled = !active;
    button('marker').disabled = !active;
    button('stall').disabled = !active || active.scenario !== 'main-thread-stall';
    for (const id of ['scenario', 'device-environment', 'device-model', 'device-os', 'device-browser']) {
      document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!.disabled = Boolean(active);
    }
    summary.textContent = runs.map(run => `#${run.id} ${run.environment} ${run.scenario} / ${run.policy}: ${run.acceptanceStatus}` +
      (run.endedAt ? ` (${run.durationSeconds}s; manual ${run.manualJudgment})` : ' (recording; unverified)')).join('\n');
  };
  choice('scenario').addEventListener('change', display);
  button('begin-scenario').addEventListener('click', () => {
    if (active) return;
    if (!host.ready()) { output.textContent = 'Start audio first. A running context is required to capture its actual sample rate.'; return; }
    const metadata = ['device-model', 'device-os', 'device-browser'].map(id => field(id).value.trim().slice(0, 120));
    if (metadata.some(value => !value)) { output.textContent = 'Enter device, OS version and browser version. Use desktop metadata for smoke runs, not fabricated phone details.'; return; }
    started = performance.now();
    active = { id: nextId++, scenario: choice('scenario').value as Scenario, policy: host.policy(),
      startedAt: new Date().toISOString(), endedAt: null, durationSeconds: 0,
      environment: choice('device-environment').value, device: metadata[0]!, os: metadata[1]!, browser: metadata[2]!,
      userAgent: navigator.userAgent.slice(0, 240), sampleRate: host.sampleRate(), endSampleRate: null, endPolicy: null,
      manualJudgment: 'unverified', acceptanceStatus: 'unverified', listened: false, notes: '',
      observations: [], droppedObservations: 0, markers: [] };
    runs.push(active);
    if (runs.length > MAX_RUNS) { runs.shift(); droppedRuns++; }
    choice('judgment').value = 'unverified'; field('listened').checked = false;
    field('scenario-notes').value = ''; field('marker-note').value = '';
    record({ type: 'scenario-begin', scenario: active.scenario, policy: active.policy });
    try { host.begin(); output.textContent = `Recording #${active.id}. Held gate plus +5-second onset submitted. Follow the instructions, then record your manual judgment.`; }
    catch (error) { record({ type: 'scenario-setup-error', message: String(error) }); output.textContent = 'Setup failed; leave unverified or manually record a failure. See events.'; }
    display();
  });
  button('marker').addEventListener('click', () => {
    if (!active) return;
    if (active.markers.length >= MAX_MARKERS) { output.textContent = '64-marker limit reached. Finish and begin another capture; no markers were silently discarded.'; return; }
    const marker = { type: 'subjective-marker', kind: choice('marker-kind').value,
      elapsedSeconds: Math.round((performance.now() - started) / 100) / 10,
      note: field('marker-note').value.slice(0, 240), wallTime: new Date().toISOString() };
    active.markers.push(marker); record(marker);
    output.textContent = `Marker recorded: ${marker.kind}. This is a manual observation, not an audio underrun measurement.`;
  });
  button('stall').addEventListener('click', () => {
    if (!active || active.scenario !== 'main-thread-stall') return;
    record({ type: 'intentional-main-thread-stall', requestedMilliseconds: 2000 });
    const until = performance.now() + 2000;
    while (performance.now() < until) { /* Bounded, explicit manual stress stimulus. */ }
    record({ type: 'intentional-main-thread-stall-ended' });
    output.textContent = 'Main thread stalled for 2 seconds. Mark what you actually heard; a delayed UI is not an audio dropout.';
  });
  button('finish-scenario').addEventListener('click', () => {
    if (!active) return;
    active.durationSeconds = Math.round((performance.now() - started) / 100) / 10;
    active.manualJudgment = choice('judgment').value as Judgment;
    active.listened = field('listened').checked;
    active.notes = field('scenario-notes').value.slice(0, 1200);
    active.endSampleRate = host.sampleRate();
    active.endPolicy = host.policy();
    const physical = ['physical-ios-safari', 'physical-android-chrome'].includes(active.environment);
    // Declared physical/manual evidence is not independently authenticated by this page.
    active.acceptanceStatus = physical && active.listened ? active.manualJudgment : 'unverified';
    if (active.scenario === 'long-play' && active.durationSeconds < 600 && active.acceptanceStatus === 'pass') active.acceptanceStatus = 'unverified';
    if (active.endPolicy !== active.policy && active.acceptanceStatus === 'pass') active.acceptanceStatus = 'unverified';
    active.endedAt = new Date().toISOString();
    try { host.end(); }
    catch (error) { record({ type: 'scenario-cleanup-error', message: String(error) }); active.acceptanceStatus = 'unverified'; }
    record({ type: 'scenario-finish', acceptanceStatus: active.acceptanceStatus, manualJudgment: active.manualJudgment });
    output.textContent = `Capture #${active.id} finished: ${active.acceptanceStatus}. Desktop/automation and incomplete listening remain unverified; no hardware result is certified.`;
    active = null; display();
  });
  button('report').addEventListener('click', () => {
    if (active) {
      active.durationSeconds = Math.round((performance.now() - started) / 100) / 10;
      active.notes = field('scenario-notes').value.slice(0, 1200);
    }
    const coverage = ['physical-ios-safari', 'physical-android-chrome'].flatMap(environment =>
      Object.keys(scenarios).flatMap(scenario => (['cancel', 'preserve'] as const).map(policy => {
        const run = [...runs].reverse().find(item => item.environment === environment && item.scenario === scenario && item.policy === policy && item.endedAt);
        return { environment, scenario, policy, acceptanceStatus: run?.acceptanceStatus ?? 'unverified', runId: run?.id ?? null };
      })));
    const report = { format: 'opm-local-device-acceptance', version: 1, exportedAt: new Date().toISOString(),
      limits: { runs: MAX_RUNS, eventsPerRun: MAX_EVENTS, markersPerRun: MAX_MARKERS, notesCharacters: 1200 },
      droppedRuns, totalObservedEvents: totalEvents, runs, coverage,
      evidence: 'User-declared device metadata and manual judgments; observations are not automated physical acceptance. No audio recording or network upload. No independent device verification.' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'opm-device-observations.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    output.textContent = 'Bounded local JSON exported. Active, absent and desktop scenarios remain unverified. Nothing uploaded. Review identifiers before sharing.';
  });
  display();
  return { record };
}
