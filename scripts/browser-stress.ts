import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { browserEngines, startBrowserFixture } from './browser-runner.js';
import type * as APIModule from '../src/api/index.js';
import type * as CoreModule from '../src/core/index.js';
import type { DiagnosticsEvent, NoteEvent, OPMEvent } from '../src/api/index.js';
import type { VoiceInput } from '../src/voices/schema.js';

interface StressResult {
  sampleRate: number;
  elapsedMs: number;
  denseNotes: number;
  batches: number;
  batchSize: number;
  contentionBudgetMs: number;
  contentionChecksum: number;
  signal: { sampledWindows: number; nonzeroWindows: number; peak: number; maxRms: number };
  lifecycleCounts: Record<string, number>;
  rejectionReasons: string[];
  diagnostics: DiagnosticsEvent;
  observations: { timerGapsMs: number[]; diagnosticRoundTripsMs: number[] };
  limitations: string[];
}
declare global {
  interface Window {
    browserStress: Promise<StressResult>;
    browserStressStatus: () => { stage: string; events: number };
  }
}
const engine = process.argv[2] ?? 'chromium';
assert.ok(engine === 'chromium' || engine === 'firefox' || engine === 'webkit', 'browser must be chromium, firefox or webkit');
const { server, url } = await startBrowserFixture('OPM native AudioWorklet stress');
let browser: Browser | undefined;
try {
  browser = await browserEngines[engine].launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chromium' } : {}) });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url);
  await page.evaluate(async () => {
    // This test intentionally loads deployed modules in the browser realm.
    // Static Node imports cannot cross Playwright's serialized page boundary.
    const apiURL = '/dist/api/index.js';
    const coreURL = '/dist/core/index.js';
    const { OPM } = await import(apiURL) as typeof APIModule;
    const { HEADROOM } = await import(coreURL) as typeof CoreModule;
    let stage = 'waiting for trusted click';
    const events: OPMEvent[] = [];
    window.browserStressStatus = () => ({ stage, events: events.length });
    function check(value: unknown, message: string): asserts value {
      if (!value) throw new Error(`${stage}: ${message}`);
    }
    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
    async function until(predicate: () => boolean, message: string) {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (predicate()) return;
        await sleep(20);
      }
      throw new Error(`${stage}: ${message}`);
    }
    const start = document.querySelector<HTMLButtonElement>('#start');
    check(start, 'start button exists');
    start.onclick = () => {
      window.browserStress = (async () => {
        const started = performance.now();
        const context = new AudioContext();
        const synth = new OPM({ context, destination: null, onEvent: event => events.push(event) });
        const splitter = context.createChannelSplitter(2);
        const mute = context.createGain();
        mute.gain.value = 0;
        mute.connect(context.destination);
        const analysers = [context.createAnalyser(), context.createAnalyser()];
        const buffers = analysers.map((analyser, index) => {
          analyser.fftSize = 2048;
          splitter.connect(analyser, index);
          analyser.connect(mute);
          return new Float32Array(analyser.fftSize);
        });
        const signal = { sampledWindows: 0, nonzeroWindows: 0, peak: 0, maxRms: 0 };
        function sampleSignal() {
          let maxRms = 0;
          for (let channel = 0; channel < 2; channel++) {
            const buffer = buffers[channel];
            analysers[channel].getFloatTimeDomainData(buffer);
            let energy = 0;
            for (const sample of buffer) {
              check(Number.isFinite(sample) && Math.abs(sample) <= HEADROOM + 1e-6, 'actual rendered samples must be finite and within headroom');
              signal.peak = Math.max(signal.peak, Math.abs(sample));
              energy += sample * sample;
            }
            maxRms = Math.max(maxRms, Math.sqrt(energy / buffer.length));
          }
          signal.sampledWindows++;
          if (maxRms > 1e-4) signal.nonzeroWindows++;
          signal.maxRms = Math.max(signal.maxRms, maxRms);
          return maxRms;
        }
        const operator = (ratio: number) => ({ ratio, level: 0.4, detune: 0,
          adsr: { a: 0.001, d: 0.01, s: 0.7, r: 0.04 } });
        const voices: VoiceInput[] = Array.from({ length: 8 }, (_, algorithm): VoiceInput => ({
          version: 3, name: `stress-${algorithm}`, algorithm: algorithm as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
          feedback: algorithm % 2 === 0 ? 0 : 7, modIndex: 2,
          lfo: { rate: 5, amDepth: 0.1, pmDepth: 5 },
          ops: [operator(1), operator(2), operator(3), operator(0.5)],
        }));
        const timerGapsMs: number[] = [];
        const diagnosticRoundTripsMs: number[] = [];
        let lastTimer = performance.now();
        let timer: number | undefined;
        let contentionChecksum = 0;
        const batches = 32;
        const batchSize = 24;
        const contentionBudgetMs = 6;
        const ids: number[] = [];
        const diagnostics = async () => {
          const sent = performance.now();
          const result = await synth.getDiagnostics();
          diagnosticRoundTripsMs.push(performance.now() - sent);
          check(result.activeVoices >= 0 && result.activeVoices <= 8, 'bounded logical voice count');
          check(result.pendingEvents >= 0 && result.pendingEvents <= 256, 'bounded event queue');
          check(result.errors === 0, 'no processor/message errors');
          return result;
        };
        try {
          stage = 'starting native worklet';
          await synth.start();
          for (let algorithm = 0; algorithm < voices.length; algorithm++) synth.loadVoice(`stress-${algorithm}`, voices[algorithm]);
          check(context.state === 'running' && synth.node instanceof AudioWorkletNode, 'real running AudioWorkletNode');
          synth.connect(splitter);
          await until(() => context.currentTime > 0, 'audio clock advances');
          stage = 'held signal and explicit release';
          const probe = synth.playNote({ voice: voices[7], note: 69 });
          await until(() => sampleSignal() > 0.01, 'actual stereo output must be nonzero');
          synth.updateNote(probe, { pitch: 7, glide: 0.02, expression: 0.6, pan: 0.5, modulation: 0.8 });
          await sleep(50);
          synth.stop(probe);
          await until(() => events.some(event => event.type === 'note' && event.id === probe && event.state === 'ended'), 'explicit release ends');
          for (const state of ['accepted', 'started', 'released', 'ended']) {
            check(events.filter(event => event.type === 'note' && event.id === probe && event.state === state).length === 1, `held probe ${state} exactly once`);
          }
          // A running main-thread clock alone does not prove this new processor
          // has rendered; the completed signal probe establishes a past frame.
          stage = 'intentional late rejection';
          const lateId = synth.playNote({ voice: voices[0], note: 60, at: 0, late: 'drop', duration: 0.04 });
          await until(() => events.some(event => event.type === 'note' && event.id === lateId && event.state === 'rejected'), 'late note rejects');
          check(events.some(event => event.type === 'note' && event.id === lateId && event.reason === 'late'), 'late rejection is explicit');
          lastTimer = performance.now();
          timer = window.setInterval(() => {
            const now = performance.now();
            timerGapsMs.push(now - lastTimer);
            lastTimer = now;
          }, 10);
          stage = 'dense notes, fades, controls, scheduled releases and bounded main-thread contention';
          for (let batch = 0; batch < batches; batch++) {
            const batchIds: number[] = [];
            for (let i = 0; i < batchSize; i++) {
              const id = synth.playNote({ voice: `stress-${(batch + i) % 8}`, note: [36, 60, 84][i % 3] + i % 7,
                velocity: [0.2, 0.6, 1][i % 3], pan: [-1, 0, 1][i % 3],
                duration: i % 6 === 0 ? null : 0.09 });
              batchIds.push(id);
              ids.push(id);
            }
            const stopAt = context.currentTime + 0.07;
            for (const id of batchIds.slice(-8)) synth.updateNote(id, {
              pitch: batch % 2 === 0 ? 3 : -3, glide: 0.015, expression: 0.7, modulation: 1.2,
            });
            for (const id of batchIds) synth.stop(id, { at: stopAt });
            // Real, bounded main-thread work competes with native message delivery.
            // It is not an estimate of worklet CPU consumption or render deadlines.
            const deadline = performance.now() + contentionBudgetMs;
            while (performance.now() < deadline) contentionChecksum += Math.sin(contentionChecksum + 0.1);
            await sleep(30);
            sampleSignal();
            if (batch % 4 === 0) await diagnostics();
          }
          stage = 'settling release and fade tails';
          await until(() => ids.every(id => events.some(event => event.type === 'note' && event.id === id &&
            ['ended', 'stolen', 'cancelled', 'rejected'].includes(event.state))), 'every submitted dense note reaches a terminal state');
          await until(() => sampleSignal() < 1e-5, 'actual audio becomes silent after release');
          const final = await diagnostics();
          check(final.activeVoices === 0 && final.pendingEvents === 0, 'no leaked notes or scheduled controls/stops');
          check(final.rejectedNotes === 1, 'only intentional late note is rejected; bounded batches must not overflow');
          check(!events.some(event => event.type === 'error'), 'no API or processor errors');
          check(signal.nonzeroWindows >= batches / 2 && signal.peak > 0.01, 'substantial actual audio observed during dense stress');
          const noteEvents = events.filter((event): event is NoteEvent => event.type === 'note');
          for (const id of ids) {
            const lifecycle = noteEvents.filter(event => event.id === id);
            check(lifecycle.filter(event => ['ended', 'stolen', 'cancelled', 'rejected'].includes(event.state)).length === 1, 'one terminal event per dense note');
            check(lifecycle.filter(event => event.state === 'accepted').length === 1 &&
              lifecycle.filter(event => event.state === 'started').length === 1, 'each dense note accepted and started once');
            check(lifecycle.every(event => Number.isSafeInteger(event.frame) && event.frame >= 0 &&
              Math.abs(event.time - event.frame / context.sampleRate) < 1e-9), 'lifecycle audio-clock timestamps');
          }
          const lifecycleCounts: Record<string, number> = {};
          for (const event of noteEvents) lifecycleCounts[event.state] = (lifecycleCounts[event.state] ?? 0) + 1;
          check((lifecycleCounts.stolen ?? 0) >= batches * (batchSize - 8), 'dense admission actually exercises voice stealing/fades');
          return { sampleRate: context.sampleRate, elapsedMs: performance.now() - started, denseNotes: ids.length,
            batches, batchSize, contentionBudgetMs, contentionChecksum, signal, lifecycleCounts,
            rejectionReasons: noteEvents.filter(event => event.state === 'rejected').map(event => event.reason ?? 'unspecified'),
            diagnostics: final, observations: { timerGapsMs, diagnosticRoundTripsMs },
            limitations: [
              'Native AudioWorklet and actual analyser output, muted after analysis; no microphone or recording upload.',
              'Timer gaps and diagnostic round trips are main-thread wall-clock observations, not worklet CPU timing, GC, underrun, latency, or glitch counters.',
              'Periodic analyser snapshots cannot prove every audio sample was glitch-free; hardware/device/browser contention changes results.',
              'Bounded workload: 32 batches of 24 notes, eight logical voices, at most 6 ms requested main-thread contention per batch; no unbounded saturation benchmark.'
            ] };
        } finally {
          window.clearInterval(timer);
          await synth.close();
          splitter.disconnect();
          analysers.forEach(analyser => analyser.disconnect());
          mute.disconnect();
          await context.close();
        }
      })();
    };
  });
  await page.click('#start');
  const result = await page.evaluate(() => Promise.race([
    window.browserStress,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
      `native browser stress timed out: ${JSON.stringify(window.browserStressStatus())}`)), 30000)),
  ]));
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ browser: engine, browserVersion: browser.version(), platform: process.platform,
    architecture: process.arch, passed: true, ...result }, null, 2));
  await page.close();
} finally {
  if (browser) await browser.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
