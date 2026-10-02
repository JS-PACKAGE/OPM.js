import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import type { Browser } from 'playwright';
import type * as APIModule from '../src/api/index.js';
import type * as CoreModule from '../src/core/index.js';
import type { OPM, OPMEvent, DiagnosticsEvent } from '../src/api/index.js';
import type { VoiceInput } from '../src/voices/schema.js';

interface SmokeStatus {
  stage: string;
  failure: { stage: string; message: string } | undefined;
  contexts: {
    role: string; state: AudioContextState; currentTime: number; sampleRate: number;
    maxChannelCount: number; workletReady: boolean;
  }[];
  userActivation: { isActive: boolean; hasBeenActive: boolean } | null;
}
interface SmokeResult {
  sampleRate: number;
  signal: number[];
  panSignal: number[];
  diagnostics: DiagnosticsEvent;
  lifecycle: { id: number; state: string }[];
}
declare global {
  interface Window {
    smoke: Promise<SmokeResult>;
    smokeStatus: () => SmokeStatus;
  }
}

const engines = { chromium, firefox, webkit };
const engine = process.argv[2] ?? 'chromium';
assert.ok(engine === 'chromium' || engine === 'firefox' || engine === 'webkit',
  'browser must be chromium, firefox or webkit');
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; object-src 'none'" });
      response.end('<!doctype html><title>OPM browser audio smoke</title><button id="start">Start audio smoke</button>');
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(resolve(root, 'dist') + sep)) {
      response.writeHead(403).end();
      return;
    }
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
let browser: Browser | undefined;
try {
  browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chromium' } : {}) });
  console.log(`[${engine}] ${browser.version()} on ${process.platform}/${process.arch}`);
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', error => {
    pageErrors.push(error.message);
    console.error(`[${engine}] page error: ${error.stack ?? error.message}`);
  });
  page.on('console', message => {
    if (message.text().startsWith('[audio smoke]') || ['warning', 'error'].includes(message.type())) {
      console.error(`[${engine}] ${message.type()}: ${message.text()}`);
    }
  });
  page.on('requestfailed', request => console.error(`[${engine}] request failed: ${request.url()} ${request.failure()?.errorText}`));
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'HTTP server must have a TCP address');
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.evaluate(async () => {
    let stage = 'loading modules';
    let borrowedContext: AudioContext | undefined;
    let borrowed: OPM | undefined;
    let owned: OPM | undefined;
    let failure: SmokeStatus['failure'];
    window.smokeStatus = () => ({
      stage, failure,
      contexts: [
        { role: 'borrowed', context: borrowedContext, synth: borrowed },
        { role: 'owned', context: owned?.context, synth: owned },
      ].flatMap(({ role, context, synth }) => context ? [{
        role, state: context.state, currentTime: context.currentTime, sampleRate: context.sampleRate,
        maxChannelCount: context.destination.maxChannelCount, workletReady: Boolean(synth?.node),
      }] : []),
      userActivation: navigator.userActivation ? {
        isActive: navigator.userActivation.isActive, hasBeenActive: navigator.userActivation.hasBeenActive,
      } : null,
    });
    const mark = (name: string) => {
      stage = name;
      console.info(`[audio smoke] ${JSON.stringify(window.smokeStatus())}`);
    };
    mark(stage);
    // Modules must load in the browser realm from deployed URLs, not in Node.
    const apiURL = '/dist/api/index.js';
    const coreURL = '/dist/core/index.js';
    const { OPM } = await import(apiURL) as typeof APIModule;
    const { HEADROOM } = await import(coreURL) as typeof CoreModule;
    const operator = () => ({ ratio: 1, level: 0.5, detune: 0,
      adsr: { a: 0, d: 0, s: 1, r: 0.03 } });
    const voice: VoiceInput = {
      version: 2, name: 'browser-tone', algorithm: 7, feedback: 0, modIndex: 0,
      lfo: { rate: 0, amDepth: 0, pmDepth: 0 },
      ops: [operator(), operator(), operator(), operator()],
    };
    function check(value: unknown, message: string): void {
      if (!value) throw new Error(message);
    }
    const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
    async function until(predicate: () => boolean | Promise<boolean>, message: string) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await predicate()) return;
        await sleep(20);
      }
      throw new Error(message);
    }
    const start = document.querySelector<HTMLButtonElement>('#start');
    if (!start) throw new Error('start button must exist');
    start.onclick = () => {
      window.smoke = (async () => {
        const context = new AudioContext();
        borrowedContext = context;
        const events: OPMEvent[] = [];
        const synth = new OPM({ context, destination: null, onEvent: event => events.push(event) });
        borrowed = synth;
        const splitter = context.createChannelSplitter(2);
        const analysers = [context.createAnalyser(), context.createAnalyser()];
        const mute = context.createGain();
        mute.gain.value = 0;
        mute.connect(context.destination);
        const buffers = analysers.map(analyser => {
          analyser.fftSize = 2048;
          analyser.connect(mute);
          return new Float32Array(analyser.fftSize);
        });
        analysers.forEach((analyser, index) => splitter.connect(analyser, index));
        function rms(index: number) {
          const analyser = analysers[index];
          const buffer = buffers[index];
          if (!analyser || !buffer) throw new Error('signal channel must exist');
          analyser.getFloatTimeDomainData(buffer);
          let sum = 0;
          for (const value of buffer) {
            check(Number.isFinite(value) && Math.abs(value) <= HEADROOM + 1e-6, 'finite signal and headroom');
            sum += value * value;
          }
          return Math.sqrt(sum / buffer.length);
        }
        try {
          mark('borrowed context start / worklet initialization');
          await Promise.all([synth.start(), synth.start()]);
          check(context.state === 'running', 'start must resume borrowed context');
          const id = synth.playNote({ voice, note: 69 }); // Omitted duration holds.
          await sleep(150);
          check(rms(0) < 1e-6 && rms(1) < 1e-6, 'destination:null must not auto-connect');
          synth.connect(splitter);
          mark('held stereo signal');
          await until(() => rms(0) > 0.05 && rms(1) > 0.05, 'held note must produce routed stereo audio');
          const signal = [rms(0), rms(1)];
          await sleep(350);
          check(rms(0) > 0.05, 'held gate must remain audible');
          mark('held diagnostics');
          const held = await synth.getDiagnostics();
          check(held.activeVoices === 1 && held.errors === 0, 'held diagnostic state');
          mark('disconnect / reconnect');
          synth.disconnect(splitter);
          await until(() => rms(0) < 1e-6 && rms(1) < 1e-6, 'disconnect must stop routed signal');
          synth.connect(splitter);
          await until(() => rms(0) > 0.05, 'reconnect must restore held signal');
          mark('context suspend');
          await context.suspend();
          const suspendedTime = context.currentTime;
          await sleep(100);
          check(context.state === 'suspended' && context.currentTime === suspendedTime, 'suspended audio clock');
          mark('initialized context start / resume');
          await synth.start();
          check(context.state === 'running', 'start resumes initialized context');
          mark('context suspend before explicit resume');
          await context.suspend();
          mark('explicit resume');
          await synth.resume();
          check(context.state === 'running', 'explicit resume');
          mark('held note release');
          synth.stop(id);
          await until(() => events.some(event => event.type === 'note' && event.id === id && event.state === 'ended'), 'released note must end');
          await until(() => rms(0) < 1e-5 && rms(1) < 1e-5, 'release/filter tail must become silent');
          mark('panned stereo signal');
          const panned = synth.playNote({ voice, note: 69, pan: 1, velocity: 0.5 });
          await until(() => rms(1) > 0.03, 'panned note right signal');
          check(rms(0) < 1e-6, 'full right pan silences opposite channel');
          const panSignal = [rms(0), rms(1)];
          synth.stop(panned);
          mark('panned note release / idle diagnostics');
          await until(() => events.some(event => event.type === 'note' && event.id === panned && event.state === 'ended'), 'panned release ends');
          const diagnostics = await synth.getDiagnostics();
          check(diagnostics.activeVoices === 0 && diagnostics.pendingEvents === 0 && diagnostics.errors === 0, 'idle diagnostics after release');
          mark('borrowed synth close');
          await synth.close();
          check(context.state === 'running', 'closing borrowed context must not suspend or close it');
          owned = new OPM({ destination: null });
          try {
            mark('owned context start');
            await owned.start();
            const original = owned.context;
            if (!original) throw new Error('owned context must exist after start');
            mark('owned context close');
            await owned.close();
            check(original.state === 'closed', 'owned context teardown');
            mark('owned context restart');
            await owned.start();
            check(owned.context && owned.context !== original && owned.context.state === 'running', 'owned context restart creates fresh running context');
          } catch (error) {
            failure = { stage, message: error instanceof Error ? error.message : String(error) };
            throw error;
          } finally {
            mark('owned context cleanup');
            await owned.close();
          }
          for (const noteId of [id, panned]) {
            for (const state of ['accepted', 'started', 'released', 'ended']) {
              check(events.filter(event => event.type === 'note' && event.id === noteId && event.state === state).length === 1,
                `note ${noteId} must emit ${state} exactly once`);
            }
          }
          mark('lifecycle verified');
          return { sampleRate: context.sampleRate, signal, panSignal, diagnostics,
            lifecycle: events.filter(event => event.type === 'note').map(event => ({ id: event.id, state: event.state })) };
        } catch (error) {
          failure ??= { stage, message: error instanceof Error ? error.message : String(error) };
          console.error(`[audio smoke] ${JSON.stringify(window.smokeStatus())}`);
          throw error;
        } finally {
          mark('borrowed context cleanup');
          await synth.close();
          splitter.disconnect();
          analysers.forEach(analyser => analyser.disconnect());
          mute.disconnect();
          await context.close();
        }
      })();
    };
    mark('waiting for trusted click');
  });
  await page.click('#start'); // Real trusted gesture; no fake AudioContext/worklet.
  let result;
  try {
    result = await page.evaluate(() => Promise.race([
      window.smoke,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
        `browser audio smoke timed out: ${JSON.stringify(window.smokeStatus())}`)), 30000)),
    ]));
  } catch (error) {
    const status = await page.evaluate(() => window.smokeStatus()).catch((statusError: unknown) => ({
      diagnosticError: statusError instanceof Error ? statusError.message : String(statusError),
    }));
    console.error(`[${engine}] smoke failed: ${JSON.stringify(status)}`);
    throw error;
  }
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ browser: engine, ...result, passed: true }, null, 2));
  await page.close();
} finally {
  if (browser) await browser.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
