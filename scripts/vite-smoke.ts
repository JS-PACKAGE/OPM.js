import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';

declare global {
  interface Window { opmProbe?: AnalyserNode }
}

// Verify the current packed artifact, not a previously published registry version.
const repository = fileURLToPath(new URL('../../', import.meta.url));
const example = resolve(repository, 'examples/vite');
const temporary = await mkdtemp(resolve(tmpdir(), 'opm-vite-'));
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: repository, encoding: 'utf8' })) as { filename: string }[];
  assert.equal(packed.length, 1);
  execFileSync('npm', ['ci'], { cwd: example, stdio: 'inherit' });
  execFileSync('npm', ['install', '--no-save', '--package-lock=false', resolve(temporary, packed[0]!.filename)], { cwd: example, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: example, stdio: 'inherit', env: { ...process.env, OPM_EXAMPLE_BASE: '/opm-example/' } });
} finally { await rm(temporary, { recursive: true, force: true }); }

const root = fileURLToPath(new URL('../../examples/vite/dist/', import.meta.url));
const base = '/opm-example/';
const csp = "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'";
let mode: 'ok' | 'missing' | 'mime' = 'ok';
let workletRequests = 0;
const mimeTypes: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!pathname.startsWith(base)) { response.writeHead(404).end(); return; }
    const relative = pathname.slice(base.length) || 'index.html';
    const path = resolve(root, relative);
    if (!path.startsWith(resolve(root) + sep)) { response.writeHead(403).end(); return; }
    const worklet = relative === 'opm/worklet/processor.js';
    if (worklet) workletRequests++;
    if (worklet && mode === 'missing') { response.writeHead(404).end('Missing worklet'); return; }
    const body = await readFile(path);
    const mime = worklet && mode === 'mime' ? 'text/html' : (mimeTypes[extname(path)] ?? 'application/octet-stream');
    response.writeHead(200, { 'Content-Type': mime, 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' });
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
const listening = Promise.withResolvers<void>();
server.listen(0, '127.0.0.1', listening.resolve);
await listening.promise;
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  for (const scenario of ['ok', 'missing', 'mime'] as const) {
    mode = scenario;
    workletRequests = 0;
    const page = await browser.newPage();
    try {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        const createGain = AudioContext.prototype.createGain;
        AudioContext.prototype.createGain = function () {
          const gain = createGain.call(this);
          const analyser = this.createAnalyser();
          gain.connect(analyser);
          window.opmProbe = analyser;
          return gain;
        };
      });
      const response = await page.goto(origin + base);
      assert.equal(response?.headers()['content-security-policy'], csp);
      const license = await page.request.get(origin + base + 'opm/LICENSE');
      assert.equal(license.status(), 200, 'deployed engine must retain its license');
      assert.equal(await license.text(), await readFile(resolve(repository, 'LICENSE'), 'utf8'));
      const nonexistent = await page.request.get(origin + base + 'opm/worklet/not-present.js');
      assert.equal(nonexistent.status(), 404, 'asset misses must not return SPA HTML');
      await page.click('#play');
      if (scenario === 'ok') {
        await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'started');
        assert.ok(workletRequests > 0, 'copied processor must load from the deployed subpath');
        await page.waitForFunction(() => {
          const analyser = window.opmProbe;
          if (!analyser) return false;
          const signal = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(signal);
          return signal.every(Number.isFinite) && signal.some(sample => Math.abs(sample) > 1e-6);
        });
        await page.click('#stop');
        await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'ended');
        assert.deepEqual(errors, []);
        const blocked = await page.evaluate(async () => {
          const script = document.createElement('script');
          script.textContent = 'document.documentElement.dataset.cspBypass = "yes"';
          document.head.append(script);
          const delay = Promise.withResolvers<void>();
          setTimeout(delay.resolve, 20);
          await delay.promise;
          return document.documentElement.dataset.cspBypass !== 'yes';
        });
        assert.equal(blocked, true, 'production CSP must block inline script');
      } else {
        await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('Error:'));
        assert.ok(workletRequests > 0);
        assert.equal(await page.isDisabled('#stop'), true, 'failed initialization must not expose a playable node');
      }
      console.log(`[vite smoke] ${scenario}: deployment subpath, CSP and worklet lifecycle verified`);
    } finally { await page.close(); }
  }
} finally {
  await browser?.close();
  const closed = Promise.withResolvers<void>();
  server.close(error => error ? closed.reject(error) : closed.resolve());
  await closed.promise;
}
