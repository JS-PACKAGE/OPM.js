import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { checkDeployment, copyAssets } from '../src/tools/assets.js';
import { main } from '../src/tools/cli.js';

const REQUIRED = ['api/index', 'core/index', 'worklet/processor', 'worklet/fx-processor', 'worker/render'];
async function fixture(): Promise<{ root: string; temp: string }> {
  const temp = await mkdtemp(join(tmpdir(), 'opm-assets-test-'));
  const root = join(temp, 'package');
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'opm.js', version: '9.9.9' }));
  await writeFile(join(root, 'LICENSE'), 'license text\n');
  for (const stem of REQUIRED) {
    const base = join(root, 'dist', stem);
    await mkdir(dirname(base), { recursive: true });
    await writeFile(`${base}.js`, `export const stem = ${JSON.stringify(stem)};\n`);
    await writeFile(`${base}.js.map`, '{}\n');
    await writeFile(`${base}.d.ts`, 'export {};\n');
  }
  return { root, temp };
}
function serve(directory: string, mutate: (path: string, bytes: Buffer) => { type?: string; status?: number; bytes?: Buffer; nosniff?: boolean } = () => ({})): Promise<{ server: Server; url: string }> {
  const { promise, resolve } = Promise.withResolvers<{ server: Server; url: string }>();
    const server = createServer((request, response) => {
      void (async () => {
        const path = decodeURIComponent(new URL(request.url!, 'http://x').pathname).replace(/^\/opm\//, '');
        let bytes: Buffer;
        try { bytes = await readFile(join(directory, path)); } catch { response.statusCode = 404; response.end(); return; }
        const change = mutate(path, bytes);
        response.statusCode = change.status ?? 200;
        response.setHeader('content-type', change.type ?? (path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream'));
        if (change.nosniff !== false) response.setHeader('x-content-type-options', 'nosniff');
        response.end(change.bytes ?? bytes);
      })();
    });
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server has no TCP address');
    resolve({ server, url: `http://127.0.0.1:${address.port}/opm/` });
  });
  return promise;
}

test('copyAssets atomically creates a complete verified tree and never overwrites host files', async () => {
  const { root, temp } = await fixture();
  try {
    const target = join(temp, 'public', 'opm-9.9.9');
    const first = await copyAssets({ destination: target, packageRoot: root });
    assert.deepEqual([first.version, first.reused, first.files], ['9.9.9', false, REQUIRED.length * 3 + 2]);
    assert.equal(await readFile(join(target, 'LICENSE'), 'utf8'), 'license text\n');
    assert.equal(await readFile(join(target, 'api', 'index.js'), 'utf8'), 'export const stem = "api/index";\n');
    const manifest = JSON.parse(await readFile(join(target, 'opm-assets.json'), 'utf8')) as { assets: { path: string; sha256: string }[] };
    assert.ok(manifest.assets.every(asset => /^[0-9a-f]{64}$/.test(asset.sha256)));
    assert.equal((await copyAssets({ destination: target, packageRoot: root })).reused, true);

    await writeFile(join(target, 'api', 'index.js'), 'tampered\n');
    await assert.rejects(copyAssets({ destination: target, packageRoot: root }), /differs/);
    assert.equal(await readFile(join(target, 'api', 'index.js'), 'utf8'), 'tampered\n', 'a mismatching destination is reported, not repaired in place');

    const host = join(temp, 'hosted');
    await mkdir(host);
    await writeFile(join(host, 'keep.txt'), 'host file');
    await assert.rejects(copyAssets({ destination: host, packageRoot: root }), /differs/);
    assert.equal(await readFile(join(host, 'keep.txt'), 'utf8'), 'host file');

    await assert.rejects(copyAssets({ destination: join(root, 'dist', 'inside'), packageRoot: root }), /overlap/);
    await assert.rejects(copyAssets({ destination: root, packageRoot: root }), /overlap/);
    for (const bad of [{}, { destination: '' }, { destination: 'x\0y' }, { destination: target, extra: true }, { destination: join(temp, 'n'), packageRoot: join(temp, 'missing') }]) {
      await assert.rejects(copyAssets(bad as never));
    }
    await assert.rejects(copyAssets(Object.defineProperty({}, 'destination', { enumerable: true, get() { throw new Error('getter ran'); } }) as never), TypeError);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('a distribution missing any entry point, including the effects worklet, is rejected before copying', async () => {
  for (const missing of REQUIRED) {
    const { root, temp } = await fixture();
    try {
      for (const suffix of ['.js', '.js.map', '.d.ts']) await rm(join(root, 'dist', `${missing}${suffix}`));
      await assert.rejects(copyAssets({ destination: join(temp, 'public', 'opm'), packageRoot: root }), new RegExp(`Incomplete distribution: ${missing}\\.js`));
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
});

test('symlinked destination ancestors cannot deploy inside the source package', async () => {
  const { root, temp } = await fixture();
  try {
    const alias = join(temp, 'alias');
    await symlink(root, alias, 'dir');
    const destination = join(alias, 'dist', 'nested', 'deployment');
    await assert.rejects(copyAssets({ destination, packageRoot: root }), /overlap/);
    await assert.rejects(readFile(join(root, 'dist', 'nested', 'deployment', 'LICENSE')), { code: 'ENOENT' });
    await assert.rejects(copyAssets({ destination: join(root, 'dist', 'nested', 'deployment'), packageRoot: alias }), /overlap/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('filesystem roots reject before inspecting a destination tree', async () => {
  const { root, temp } = await fixture();
  try {
    // Isolate native-binding guards: even a regressed build must never inspect or
    // write outside this fixture. Only realpath may resolve the destination root.
    const program = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import { sep } from 'node:path';
      // An eval child has no test-module-relative URL; the parent selects it at runtime.
      const { copyAssets } = await import(process.argv[1]);
      const root = await fs.realpath(process.argv[2]);
      const methods = ['lstat', 'readdir', 'readFile', 'mkdir', 'mkdtemp', 'writeFile', 'copyFile', 'rename', 'rm'];
      const originals = Object.fromEntries(methods.map(name => [name, fs[name]]));
      let outsideOperations = 0;
      for (const name of methods) fs[name] = async (...args) => {
        const count = name === 'copyFile' || name === 'rename' ? 2 : 1;
        for (let index = 0; index < count; index++) {
          const path = args[index];
          if (typeof path !== 'string' || path !== root && !path.startsWith(root + sep)) {
            outsideOperations++;
            throw new Error('Fixture boundary blocked destination access');
          }
        }
        return originals[name](...args);
      };
      syncBuiltinESMExports();
      let rejected = false;
      try { await copyAssets({ destination: process.argv[3], packageRoot: root }); }
      catch { rejected = true; }
      finally {
        for (const name of methods) fs[name] = originals[name];
        syncBuiltinESMExports();
      }
      console.log(JSON.stringify({ rejected, outsideOperations }));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', program,
      new URL('../src/tools/assets.js', import.meta.url).href, root, parse(root).root],
    { encoding: 'utf8', timeout: 5000 });
    assert.deepEqual(JSON.parse(output), { rejected: true, outsideOperations: 0 });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

for (const phase of ['final-check', 'rename'] as const) test(`a destination populated before ${phase} is preserved and staging is removed`, async () => {
  const { root, temp } = await fixture();
  try {
    // The child makes the destination appear at the selected publication boundary.
    const program = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import { dirname, join } from 'node:path';
      const { copyAssets } = await import(process.argv[1]);
      const [root, destination, phase] = process.argv.slice(2);
      const originals = { lstat: fs.lstat, mkdtemp: fs.mkdtemp, rename: fs.rename };
      let staged = false, boundaries = 0;
      const populate = async () => {
        boundaries++;
        await fs.mkdir(destination);
        await fs.writeFile(join(destination, 'host.txt'), 'host data');
      };
      fs.mkdtemp = async (...args) => { const path = await originals.mkdtemp(...args); staged = true; return path; };
      fs.lstat = async (path, ...args) => {
        if (phase === 'final-check' && staged && path === destination && boundaries === 0) await populate();
        return originals.lstat(path, ...args);
      };
      fs.rename = async (from, to) => {
        if (phase === 'rename' && to === destination) await populate();
        return originals.rename(from, to);
      };
      syncBuiltinESMExports();
      let rejected = false;
      try { await copyAssets({ destination, packageRoot: root }); }
      catch { rejected = true; }
      finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
      console.log(JSON.stringify({
        rejected, boundaries,
        destination: await fs.readdir(destination),
        host: await fs.readFile(join(destination, 'host.txt'), 'utf8'),
        parent: await fs.readdir(dirname(destination)),
      }));
    `;
    const destination = join(temp, 'public', 'opm-race');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', program,
      new URL('../src/tools/assets.js', import.meta.url).href, root, destination, phase],
    { encoding: 'utf8', timeout: 5000 });
    assert.deepEqual(JSON.parse(output), { rejected: true, boundaries: 1, destination: ['host.txt'], host: 'host data', parent: ['opm-race'] });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('incomplete or unsafe source distributions never deploy a partial tree', async () => {
  const { root, temp } = await fixture();
  try {
    await rm(join(root, 'dist', 'worker', 'render.js.map'));
    const target = join(temp, 'out');
    await assert.rejects(copyAssets({ destination: target, packageRoot: root }), /companion/);
    await writeFile(join(root, 'dist', 'worker', 'render.js.map'), '{}\n');
    await symlink(join(root, 'LICENSE'), join(root, 'dist', 'link.js'));
    await assert.rejects(copyAssets({ destination: target, packageRoot: root }), /symlink/);
    await assert.rejects(readFile(join(target, 'LICENSE')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(temp, '.opm-assets-')), { code: 'ENOENT' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('checkDeployment accepts only byte-identical, correctly served assets', async () => {
  const { root, temp } = await fixture();
  const target = join(temp, 'public', 'opm');
  await copyAssets({ destination: target, packageRoot: root });
  const servers: Server[] = [];
  try {
    const good = await serve(target);
    servers.push(good.server);
    const result = await checkDeployment(good.url, { packageRoot: root });
    assert.equal(result.files, REQUIRED.length * 3 + 1);
    assert.ok(result.limitations.length >= 2);

    const cases: [string, (path: string, bytes: Buffer) => { type?: string; status?: number; bytes?: Buffer; nosniff?: boolean }, RegExp][] = [
      ['wrong MIME', path => path === 'worklet/processor.js' ? { type: 'text/html' } : {}, /MIME/],
      ['SPA fallback status', path => path === 'core/index.js' ? { status: 404 } : {}, /HTTP 404/],
      ['tampered bytes', (path, bytes) => path === 'api/index.js' ? { bytes: Buffer.concat([bytes, Buffer.from('//x')]) } : {}, /byte|differ/i],
      ['missing nosniff', () => ({ nosniff: false }), /nosniff/],
    ];
    for (const [label, mutate, pattern] of cases) {
      const { server, url } = await serve(target, mutate);
      servers.push(server);
      await assert.rejects(checkDeployment(url, { packageRoot: root }), pattern, label);
    }
    const lax = await serve(target, () => ({ nosniff: false }));
    servers.push(lax.server);
    assert.equal((await checkDeployment(lax.url, { packageRoot: root, requireNosniff: false })).files, REQUIRED.length * 3 + 1);
    for (const bad of ['http://example.com/opm/', 'https://user:pw@example.com/', 'https://example.com/opm/?a=1', 'https://example.com/opm/#x', 'ftp://example.com/']) {
      await assert.rejects(checkDeployment(bad, { packageRoot: root }), /HTTPS or loopback/);
    }
    await assert.rejects(checkDeployment(good.url, { packageRoot: root, timeoutMs: 0 }), RangeError);
  } finally {
    for (const server of servers) server.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('a failed deployment check cancels outstanding sibling responses before the request deadline', { timeout: 5000 }, async t => {
  const { root, temp } = await fixture();
  const responses: { url: string; response: ServerResponse }[] = [];
  const server = createServer((request, response) => {
    responses.push({ url: request.url!, response });
    if (responses.length === 4) server.emit('fixture-ready');
  });
  try {
    const listening = once(server, 'listening', { signal: t.signal });
    server.listen(0, '127.0.0.1');
    await listening;
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const ready = once(server, 'fixture-ready', { signal: t.signal });
    const failure = checkDeployment(`http://127.0.0.1:${address.port}/opm/`, { packageRoot: root, timeoutMs: 10000 })
      .then(() => undefined, (error: unknown) => error);
    await ready;
    const bad = responses.find(item => item.url.endsWith('.js'));
    assert.ok(bad);
    const siblings = responses.filter(item => item !== bad);
    // Native HTTP close events are the behavior under test, not a timed delay.
    const closed = Promise.all(siblings.map(item => once(item.response, 'close', { signal: t.signal })));
    bad.response.writeHead(200, { 'content-type': 'text/html', 'x-content-type-options': 'nosniff' });
    bad.response.end('not JavaScript');
    const error = await failure;
    assert.ok(error instanceof Error);
    await closed;
    assert.ok(siblings.every(item => item.response.destroyed && !item.response.writableEnded));
  } finally {
    server.closeAllConnections();
    const stopped = Promise.withResolvers<void>();
    server.close(() => stopped.resolve());
    await stopped.promise;
    await rm(temp, { recursive: true, force: true });
  }
});

test('opm-assets CLI reports machine-readable success and distinct failures', async () => {
  const { root, temp } = await fixture();
  const lines: string[] = [];
  const errors: string[] = [];
  const io = { out: (line: string) => lines.push(line), err: (line: string) => errors.push(line) };
  try {
    assert.equal(await main([], io), 2);
    assert.equal(await main(['copy'], io), 2);
    assert.equal(await main(['bogus', 'x'], io), 2);
    assert.equal(await main(['copy', join(temp, 'a'), 'extra'], io), 2);
    assert.equal(await main(['--help'], io), 0);
    const parsed = await copyAssets({ destination: join(temp, 'cli'), packageRoot: root });
    assert.equal(parsed.reused, false);
    assert.equal(await main(['check', 'http://example.com/'], io), 1);
    assert.match(errors.at(-1)!, /failed: .*HTTPS or loopback/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
