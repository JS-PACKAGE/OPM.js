import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'acorn';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  assert.equal(Object.keys(manifest[key] ?? {}).length, 0, `${key} must remain empty`);
}
for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${name} must have an exact version`);
}

function command(args, cwd = root) {
  const result = spawnSync('npm', args, { cwd, encoding: 'utf8', timeout: 120000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `npm ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const runtime = JSON.parse(command(['ls', '--omit=dev', '--all', '--json']));
assert.equal(Object.keys(runtime.dependencies ?? {}).length, 0, 'installed runtime dependency tree must be empty');

// Parse real syntax so comments, escaped identifiers and optional calls cannot
// bypass the gate. This conservative policy also disallows aliases of sinks.
function inspect(node, path) {
  if (node.type === 'Identifier' && ['eval', 'Function'].includes(node.name)) {
    throw new Error(`${path}:${node.loc.start.line}: dynamic-code identifier ${node.name}`);
  }
  if (node.type === 'MemberExpression' && node.computed &&
      node.property.type === 'Literal' && ['eval', 'Function'].includes(node.property.value)) {
    throw new Error(`${path}:${node.loc.start.line}: dynamic-code property ${node.property.value}`);
  }
  if (node.type === 'ImportExpression' &&
      !(node.source.type === 'Literal' && typeof node.source.value === 'string')) {
    throw new Error(`${path}:${node.loc.start.line}: non-literal dynamic import`);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') inspect(child, path);
    } else if (value && typeof value.type === 'string') inspect(value, path);
  }
}
async function scan(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `unexpected source symlink: ${path}`);
    if (entry.isDirectory()) count += await scan(path);
    else if (entry.name.endsWith('.js')) {
      inspect(parse(await readFile(path, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', locations: true }), path);
      count++;
    }
  }
  return count;
}
const sources = await scan(join(root, 'src'));
const built = await scan(join(root, 'dist'));
assert.ok(sources > 0 && built > 0, 'build artifacts and source must exist');
console.log(JSON.stringify({ gate: 'zero-runtime-deps-and-dynamic-code', sources, built, passed: true }));

if (process.argv.includes('--package-smoke')) {
  const directory = await mkdtemp(join(tmpdir(), 'opm-package-smoke-'));
  try {
    const packed = JSON.parse(command(['pack', '--ignore-scripts', '--json', '--pack-destination', directory]));
    assert.equal(packed.length, 1);
    assert.ok(packed[0].files.some(file => file.path === 'LICENSE'), 'package must include license');
    for (const file of packed[0].files) {
      assert.ok(!/^(src|scripts|test|node_modules)\//.test(file.path), `unexpected packaged development file: ${file.path}`);
    }
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    command(['install', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, packed[0].filename)], directory);
    const script = `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      import { OPM } from 'opm.js';
      import { renderNote, encodeWav } from 'opm.js/core';
      import { brass } from 'opm.js/voices/brass.js';
      import { importDX7 } from 'opm.js/voices/dx7.js';
      assert.equal(typeof OPM, 'function');
      assert.equal(typeof importDX7, 'function');
      const result = renderNote({ voice: brass, note: 69, duration: 0.02, sampleRate: 8000 });
      assert.equal(result.diagnostics.errors, 0);
      assert.ok(result.left.some(value => Math.abs(value) > 0.0001));
      assert.ok(result.left.every(Number.isFinite));
      const wav = encodeWav({ left: result.left, right: result.right, sampleRate: result.sampleRate });
      assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), 'RIFF');
      assert.equal(new DataView(wav.buffer, wav.byteOffset).getUint32(40, true), result.left.length * 4);
      const pkg = JSON.parse(await readFile('node_modules/opm.js/package.json', 'utf8'));
      assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
      console.log(JSON.stringify({ gate: 'installed-package', version: pkg.version, frames: result.left.length, wavBytes: wav.length, passed: true }));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: directory, encoding: 'utf8', timeout: 30000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `installed package smoke failed\n${result.stdout}\n${result.stderr}`);
    process.stdout.write(result.stdout);
    const fixture = join(directory, 'public-api.ts');
    await writeFile(fixture, await readFile(join(root, 'scripts/types/public-api.ts'), 'utf8'));
    const types = spawnSync(process.execPath, [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
      '--target', 'ES2022', '--lib', 'ES2022,DOM', fixture,
    ], { cwd: directory, encoding: 'utf8', timeout: 30000 });
    if (types.error) throw types.error;
    assert.equal(types.status, 0, `installed package declaration smoke failed\n${types.stdout}\n${types.stderr}`);
    console.log(JSON.stringify({ gate: 'installed-package-types', passed: true }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
