import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDeployment, copyAssets } from '../src/tools/assets.js';
import { main } from '../src/tools/cli.js';

const REQUIRED = ['api/index', 'core/index', 'worklet/processor', 'worker/render'];
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
