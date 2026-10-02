import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REGISTRY = 'https://registry.npmjs.org';
const MAX_TARBALL_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const REPOSITORY = 'https://github.com/YueyuHoshizora/OPM.js';

function command(binary: string, args: string[], cwd?: string): string {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${binary} verification failed\n${result.stderr}`);
  return result.stdout;
}

async function registryBytes(source: string, limit: number): Promise<Buffer> {
  const url = new URL(source);
  assert.equal(url.origin, REGISTRY, 'Only the public npm registry is allowed');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `Registry verification requires HTTP 200, received ${response.status}`);
  assert.ok(response.body, 'Registry response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      assert.ok(bytes <= limit, 'Registry response exceeds byte budget');
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, bytes);
}

const args = process.argv.slice(2);
const localOnly = args[0] === '--local';
if (localOnly) args.shift();
const [archiveArgument, version, commit] = args;
assert.ok(args.length === (localOnly ? 2 : 3),
  'Usage: registry-verify [--local] REVIEWED.tgz VERSION [REVIEWED_COMMIT]');
assert.ok(archiveArgument);
assert.match(version!, /^\d+\.\d+\.\d+$/);
if (!localOnly) assert.match(commit!, /^[a-f0-9]{40}$/);
const archive = resolve(archiveArgument);
const size = (await stat(archive)).size;
assert.ok(size > 0 && size <= MAX_TARBALL_BYTES, 'Reviewed tarball exceeds byte budget');
const local = await readFile(archive);
const sha256 = createHash('sha256').update(local).digest('hex');
const sha512Bytes = createHash('sha512').update(local).digest();
const sha512 = sha512Bytes.toString('hex');
const integrity = `sha512-${sha512Bytes.toString('base64')}`;
const entries = command('tar', ['-tzf', archive]).trim().split('\n');
assert.ok(entries.length > 0 && entries.length <= 4096, 'Package file-count budget exceeded');
assert.equal(new Set(entries).size, entries.length, 'Duplicate archive paths');
const files = new Set(entries.map(path => {
  assert.ok(path.startsWith('package/') && !path.split('/').some(part => part === '' || part === '..' || part === '.'), 'Unsafe archive path');
  const relative = path.slice('package/'.length);
  assert.ok(/^(?:dist\/[a-zA-Z0-9_./-]+\.(?:js|js\.map|d\.ts)|doc\/[a-zA-Z0-9_./-]+|bin\/opm-assets\.js|package\.json|README\.md|CHANGELOG\.md|SECURITY\.md|LICENSE)$/.test(relative),
    `Unexpected package file: ${relative}`);
  return relative;
}));
for (const file of files) {
  if (!file.startsWith('dist/')) continue;
  const stem = file.replace(/\.(?:js\.map|d\.ts|js)$/, '');
  assert.ok(files.has(`${stem}.js`) && files.has(`${stem}.js.map`) && files.has(`${stem}.d.ts`), `Incomplete distribution: ${file}`);
}
assert.ok(files.has('LICENSE') && files.has('dist/api/index.js') && files.has('dist/core/index.js'));
const pkg = JSON.parse(command('tar', ['-xOf', archive, 'package/package.json'])) as {
  name: string; version: string; dependencies?: object; optionalDependencies?: object; peerDependencies?: object;
};
assert.equal(pkg.name, 'opm.js');
assert.equal(pkg.version, version);
for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
  assert.equal(Object.keys(pkg[key] ?? {}).length, 0, `${key} must remain empty`);
}

if (!localOnly) {
  const metadata = JSON.parse((await registryBytes(`${REGISTRY}/opm.js/${version}`, MAX_JSON_BYTES)).toString()) as {
    name: string; version: string; dependencies?: object; optionalDependencies?: object; peerDependencies?: object;
    dist: { integrity: string; tarball: string;
      attestations?: { url: string; provenance?: { predicateType: string } } };
  };
  assert.equal(metadata.name, pkg.name);
  assert.equal(metadata.version, version);
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    assert.equal(Object.keys(metadata[key] ?? {}).length, 0, `Registry ${key} must remain empty`);
  }
  assert.equal(metadata.dist.integrity, integrity, 'Registry integrity differs from reviewed tarball');
  const downloaded = await registryBytes(metadata.dist.tarball, MAX_TARBALL_BYTES);
  assert.ok(local.equals(downloaded), 'Registry bytes differ from reviewed tarball');
  assert.equal(metadata.dist.attestations?.provenance?.predicateType, 'https://slsa.dev/provenance/v1', 'Missing supported build provenance');
  const attestations = JSON.parse((await registryBytes(metadata.dist.attestations!.url, MAX_JSON_BYTES)).toString()) as {
    attestations: { predicateType: string; bundle: { dsseEnvelope: { payload: string } } }[];
  };
  const provenance = attestations.attestations.find(item => item.predicateType === 'https://slsa.dev/provenance/v1');
  assert.ok(provenance, 'Missing provenance envelope');
  const statement = JSON.parse(Buffer.from(provenance.bundle.dsseEnvelope.payload, 'base64').toString()) as {
    subject: { name: string; digest: { sha512?: string } }[];
    predicate: { buildDefinition: { externalParameters: { workflow: { repository: string; path: string; ref: string } };
      resolvedDependencies: { uri: string; digest: { gitCommit?: string } }[] } };
  };
  assert.ok(statement.subject.some(subject => subject.name === `pkg:npm/opm.js@${version}` && subject.digest.sha512 === sha512), 'Provenance artifact mismatch');
  const definition = statement.predicate.buildDefinition;
  assert.equal(definition.externalParameters.workflow.repository, REPOSITORY);
  assert.equal(definition.externalParameters.workflow.path, '.github/workflows/npm-publish.yml');
  const parts = version!.split('.');
  const tag = parts[2] === '0' ? `v${parts[0]}.${parts[1]}` : `v${version}`;
  assert.equal(definition.externalParameters.workflow.ref, `refs/tags/${tag}`);
  assert.ok(definition.resolvedDependencies.some(dependency =>
    dependency.uri.startsWith(`git+${REPOSITORY}@`) && dependency.digest.gitCommit === commit), 'Provenance source commit mismatch');
  // Reading a DSSE payload is not signature verification. npm performs the
  // cryptographic registry/Sigstore checks on the actual registry installation.
  const directory = await mkdtemp(join(tmpdir(), 'opm-registry-verify-'));
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '--registry', REGISTRY, `opm.js@${version}`], directory);
    const installed = JSON.parse(await readFile(join(directory, 'node_modules/opm.js/package.json'), 'utf8')) as typeof pkg;
    assert.equal(installed.name, pkg.name);
    assert.equal(installed.version, version);
    const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { integrity?: string }>;
    };
    assert.deepEqual(Object.keys(lock.packages).sort(), ['', 'node_modules/opm.js'], 'Registry install added unexpected dependencies');
    assert.equal(lock.packages['node_modules/opm.js']?.integrity, integrity, 'Installed artifact differs from reviewed bytes');
    const signatureOutput = command('npm', ['audit', 'signatures', '--registry', REGISTRY], directory);
    process.stdout.write(signatureOutput);
    const smoke = command(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { renderSequence, encodeWav } from 'opm.js/core';
      import { brass } from 'opm.js/voices/brass.js';
      const result=renderSequence([{type:'note',id:1,time:0,duration:0.02,note:69,voice:brass}],{sampleRate:8000,mixGain:0.1});
      assert.equal(result.diagnostics.errors,0);
      assert.ok(result.left.every(Number.isFinite) && result.left.some(value=>Math.abs(value)>0.00001));
      const wav=encodeWav({left:result.left,right:result.right,sampleRate:result.sampleRate});
      assert.equal(new DataView(wav.buffer,wav.byteOffset).getUint32(40,true),result.left.length*4);
      console.log(JSON.stringify({registryConsumer:'PASS',frames:result.left.length,wavBytes:wav.length}));
    `], directory);
    process.stdout.write(smoke);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ verification: localOnly ? 'local-artifact-only' : 'registry-integrity-provenance-consumer',
  name: pkg.name, version, sha256, integrity, files: [...files].sort(), registryVerified: !localOnly, sourceCommit: localOnly ? null : commit }));
