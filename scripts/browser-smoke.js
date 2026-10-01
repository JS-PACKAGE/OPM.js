import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const engines = { chromium, firefox, webkit };
const engine = process.argv[2] ?? 'chromium';
assert.ok(Object.hasOwn(engines, engine), 'browser must be chromium, firefox or webkit');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
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
    response.writeHead(200, { 'Content-Type': path.endsWith('.json') ? 'application/json' : 'text/javascript' });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chromium' } : {}) });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const { OPM } = await import('/dist/api/index.js');
    const { HEADROOM } = await import('/dist/core/index.js');
    const voice = {
      version: 2, name: 'browser-tone', algorithm: 7, feedback: 0, modIndex: 0,
      lfo: { rate: 0, amDepth: 0, pmDepth: 0 },
      ops: Array.from({ length: 4 }, () => ({ ratio: 1, level: 0.5, detune: 0,
        adsr: { a: 0, d: 0, s: 1, r: 0.03 } })),
    };
    const check = (value, message) => { if (!value) throw new Error(message); };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function until(predicate, message) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await predicate()) return;
        await sleep(20);
      }
      throw new Error(message);
    }
    document.querySelector('#start').onclick = () => {
      window.smoke = (async () => {
        const context = new AudioContext();
        const events = [];
        const synth = new OPM({ context, destination: null, onEvent: event => events.push(event) });
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
        function rms(index) {
          analysers[index].getFloatTimeDomainData(buffers[index]);
          let sum = 0;
          for (const value of buffers[index]) {
            check(Number.isFinite(value) && Math.abs(value) <= HEADROOM + 1e-6, 'finite signal and headroom');
            sum += value * value;
          }
          return Math.sqrt(sum / buffers[index].length);
        }
        try {
          await Promise.all([synth.start(), synth.start()]);
          check(context.state === 'running', 'start must resume borrowed context');
          const id = synth.playNote({ voice, note: 69 }); // Omitted duration holds.
          await sleep(150);
          check(rms(0) < 1e-6 && rms(1) < 1e-6, 'destination:null must not auto-connect');
          synth.connect(splitter);
          await until(() => rms(0) > 0.05 && rms(1) > 0.05, 'held note must produce routed stereo audio');
          const signal = [rms(0), rms(1)];
          await sleep(350);
          check(rms(0) > 0.05, 'held gate must remain audible');
          const held = await synth.getDiagnostics();
          check(held.activeVoices === 1 && held.errors === 0, 'held diagnostic state');
          synth.disconnect(splitter);
          await until(() => rms(0) < 1e-6 && rms(1) < 1e-6, 'disconnect must stop routed signal');
          synth.connect(splitter);
          await until(() => rms(0) > 0.05, 'reconnect must restore held signal');
          await context.suspend();
          const suspendedTime = context.currentTime;
          await sleep(100);
          check(context.state === 'suspended' && context.currentTime === suspendedTime, 'suspended audio clock');
          await synth.start();
          check(context.state === 'running', 'start resumes initialized context');
          await context.suspend();
          await synth.resume();
          check(context.state === 'running', 'explicit resume');
          synth.stop(id);
          await until(() => events.some(event => event.type === 'note' && event.id === id && event.state === 'ended'), 'released note must end');
          await until(() => rms(0) < 1e-5 && rms(1) < 1e-5, 'release/filter tail must become silent');
          const panned = synth.playNote({ voice, note: 69, pan: 1, velocity: 0.5 });
          await until(() => rms(1) > 0.03, 'panned note right signal');
          check(rms(0) < 1e-6, 'full right pan silences opposite channel');
          const panSignal = [rms(0), rms(1)];
          synth.stop(panned);
          await until(() => events.some(event => event.type === 'note' && event.id === panned && event.state === 'ended'), 'panned release ends');
          const diagnostics = await synth.getDiagnostics();
          check(diagnostics.activeVoices === 0 && diagnostics.pendingEvents === 0 && diagnostics.errors === 0, 'idle diagnostics after release');
          await synth.close();
          check(context.state === 'running', 'closing borrowed context must not suspend or close it');
          const owned = new OPM({ destination: null });
          try {
            await owned.start();
            const original = owned.context;
            await owned.close();
            check(original.state === 'closed', 'owned context teardown');
            await owned.start();
            check(owned.context !== original && owned.context.state === 'running', 'owned context restart creates fresh running context');
          } finally { await owned.close(); }
          for (const noteId of [id, panned]) {
            for (const state of ['accepted', 'started', 'released', 'ended']) {
              check(events.filter(event => event.type === 'note' && event.id === noteId && event.state === state).length === 1,
                `note ${noteId} must emit ${state} exactly once`);
            }
          }
          return { sampleRate: context.sampleRate, signal, panSignal, diagnostics,
            lifecycle: events.filter(event => event.type === 'note').map(event => ({ id: event.id, state: event.state })) };
        } finally {
          await synth.close();
          splitter.disconnect();
          analysers.forEach(analyser => analyser.disconnect());
          mute.disconnect();
          await context.close();
        }
      })();
    };
  });
  await page.click('#start'); // Real trusted gesture; no fake AudioContext/worklet.
  const result = await page.evaluate(() => Promise.race([
    window.smoke,
    new Promise((_, reject) => setTimeout(() => reject(new Error('browser audio smoke timed out')), 30000)),
  ]));
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ browser: engine, ...result, passed: true }, null, 2));
  await page.close();
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
