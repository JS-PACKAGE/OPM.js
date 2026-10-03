/// <reference types="node" />
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CopyAssetsOptions {
  destination: string;
  /** Advanced: deploy this installed opm.js package directory instead of the one containing this module. */
  packageRoot?: string;
}
export interface AssetDeployment {
  readonly version: string;
  readonly destination: string;
  readonly files: number;
  readonly bytes: number;
  readonly reused: boolean;
}
export interface CheckDeploymentOptions {
  /** Overall deadline, integer milliseconds in 1..60000; default 15000. */
  timeoutMs?: number;
  /** Require production X-Content-Type-Options: nosniff; default true. */
  requireNosniff?: boolean;
  /** Advanced: compare with this installed opm.js package directory instead of the one containing this module. */
  packageRoot?: string;
}
export interface DeploymentCheck {
  readonly version: string;
  readonly baseUrl: string;
  readonly files: number;
  readonly bytes: number;
  readonly limitations: readonly string[];
}
interface Asset { path: string; bytes: number; sha256: string }
interface Manifest { format: 1; package: 'opm.js'; version: string; assets: Asset[] }
const MAX_FILES = 4096;
const MAX_BYTES = 16 * 1024 * 1024;
const MANIFEST = 'opm-assets.json';

function data(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
    throw new TypeError('Asset options must be a plain data object');
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError('Unknown asset option');
    const property = Object.getOwnPropertyDescriptor(input, key)!;
    if (!Object.hasOwn(property, 'value')) throw new TypeError('Asset options must not contain accessors');
    result[key] = property.value;
  }
  return result;
}
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function packageRoot(explicit?: unknown): Promise<string> {
  if (explicit !== undefined) {
    if (typeof explicit !== 'string' || explicit.length === 0 || explicit.length > 4096 || explicit.includes('\0')) throw new TypeError('packageRoot must be a nonempty filesystem path');
    const root = resolve(explicit);
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (pkg.name !== 'opm.js') throw new Error('packageRoot is not an opm.js package');
    return realpath(root);
  }
  // The second candidate supports the development compiler's .dev/src/tools layout.
  for (const url of [new URL('../../', import.meta.url), new URL('../../../', import.meta.url)]) {
    const root = resolve(fileURLToPath(url));
    let text: string;
    try { text = await readFile(join(root, 'package.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const pkg = JSON.parse(text) as { name?: unknown };
    if (pkg.name === 'opm.js') return realpath(root);
  }
  throw new Error('Cannot locate the installed OPM.js package');
}
async function inventory(root: string): Promise<Manifest> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error('Invalid package version');
  const assets: Asset[] = [];
  let total = 0;
  async function visit(directory: string, prefix = ''): Promise<void> {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Distribution directories must not be symlinks');
    for (const entry of (await readdir(directory)).sort()) {
      if (!/^[A-Za-z0-9_.-]+$/.test(entry) || entry === '.' || entry === '..') throw new Error('Unexpected distribution path');
      const path = prefix + entry;
      const source = join(directory, entry);
      const stat = await lstat(source);
      if (stat.isSymbolicLink()) throw new Error(`Distribution symlink: ${path}`);
      if (stat.isDirectory()) await visit(source, `${path}/`);
      else {
        if (!stat.isFile() || !/\.(?:js|js\.map|d\.ts)$/.test(path)) throw new Error(`Unexpected distribution asset: ${path}`);
        total += stat.size;
        if (assets.length >= MAX_FILES || total > MAX_BYTES) throw new RangeError('Distribution exceeds deployment budget');
        const bytes = await readFile(source);
        if (bytes.byteLength !== stat.size) throw new Error('Distribution changed during inspection');
        assets.push({ path, bytes: bytes.byteLength, sha256: digest(bytes) });
      }
    }
  }
  await visit(join(root, 'dist'));
  const paths = new Set(assets.map(asset => asset.path));
  for (const path of ['api/index.js', 'core/index.js', 'worklet/processor.js', 'worklet/fx-processor.js', 'worker/render.js']) {
    if (!paths.has(path)) throw new Error(`Incomplete distribution: ${path}`);
  }
  for (const path of paths) if (path.endsWith('.js') && (!paths.has(`${path}.map`) || !paths.has(path.replace(/\.js$/, '.d.ts')))) {
    throw new Error(`Missing map/declaration companion: ${path}`);
  }
  const licensePath = join(root, 'LICENSE');
  const licenseStat = await lstat(licensePath);
  if (!licenseStat.isFile() || licenseStat.isSymbolicLink() || licenseStat.size > 65536) throw new Error('Invalid package license');
  const license = await readFile(licensePath);
  total += license.byteLength;
  if (total > MAX_BYTES) throw new RangeError('Distribution exceeds deployment budget');
  assets.push({ path: 'LICENSE', bytes: license.byteLength, sha256: digest(license) });
  return { format: 1, package: 'opm.js', version: pkg.version, assets };
}
async function matching(destination: string, manifest: Manifest): Promise<boolean> {
  const stat = await lstat(destination);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  const expected = new Set(manifest.assets.map(asset => asset.path));
  expected.add(MANIFEST);
  let count = 0;
  async function walk(directory: string, prefix = ''): Promise<boolean> {
    for (const name of await readdir(directory)) {
      const path = prefix + name;
      const stat = await lstat(join(directory, name));
      if (stat.isSymbolicLink()) return false;
      if (stat.isDirectory()) { if (!await walk(join(directory, name), `${path}/`)) return false; }
      else if (!stat.isFile() || !expected.has(path) || ++count > expected.size) return false;
    }
    return true;
  }
  if (!await walk(destination) || count !== expected.size) return false;
  if ((await readFile(join(destination, MANIFEST), 'utf8')) !== JSON.stringify(manifest, null, 2) + '\n') return false;
  for (const asset of manifest.assets) {
    const path = join(destination, ...asset.path.split('/'));
    const stat = await lstat(path);
    if (stat.size !== asset.bytes || digest(await readFile(path)) !== asset.sha256) return false;
  }
  return true;
}

/** Resolve existing ancestors before testing overlap, including not-yet-created parents. */
async function canonicalDestination(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return join(await canonicalDestination(dirname(path)), basename(path));
  }
}

/** Node-only. Atomically create a complete release-specific directory; never overwrite host files. */
export async function copyAssets(options: CopyAssetsOptions): Promise<AssetDeployment> {
  const input = data(options, ['destination', 'packageRoot']);
  if (typeof input.destination !== 'string' || input.destination.length === 0 || input.destination.length > 4096 || input.destination.includes('\0')) {
    throw new TypeError('destination must be a nonempty filesystem path');
  }
  const destination = resolve(input.destination);
  const root = await packageRoot(input.packageRoot);
  const source = join(root, 'dist');
  const canonical = await canonicalDestination(destination);
  if (canonical === root || canonical.startsWith(root + sep) || source.startsWith(canonical + sep)) {
    throw new Error('Deployment destination must not overlap the package');
  }
  const manifest = await inventory(root);
  const bytes = manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const result = (reused: boolean): AssetDeployment => Object.freeze({ version: manifest.version, destination, files: manifest.assets.length + 1, bytes, reused });
  if (await exists(destination)) {
    if (await matching(destination, manifest)) return result(true);
    throw new Error('Destination exists and differs; use a fresh release-specific directory. No host files were overwritten.');
  }
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(join(dirname(destination), '.opm-assets-'));
  try {
    for (const asset of manifest.assets) {
      const target = join(staging, ...asset.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await copyFile(asset.path === 'LICENSE' ? join(root, 'LICENSE') : join(source, ...asset.path.split('/')), target, constants.COPYFILE_EXCL);
      if (digest(await readFile(target)) !== asset.sha256) throw new Error('Distribution changed during copying');
    }
    await writeFile(join(staging, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    if (await exists(destination)) throw new Error('Destination was created concurrently; no files were overwritten');
    await rename(staging, destination);
    return result(false);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Fetch and hash the complete installed release; this does not certify page CSP or audible playback. */
export async function checkDeployment(baseUrl: string | URL, options: CheckDeploymentOptions = {}): Promise<DeploymentCheck> {
  const input = data(options, ['timeoutMs', 'requireNosniff', 'packageRoot']);
  const timeout = input.timeoutMs === undefined ? 15000 : input.timeoutMs;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 60000) throw new RangeError('timeoutMs must be an integer in 1..60000');
  const nosniff = input.requireNosniff === undefined ? true : input.requireNosniff;
  if (typeof nosniff !== 'boolean') throw new TypeError('requireNosniff must be boolean');
  if (typeof baseUrl !== 'string' && !(baseUrl instanceof URL)) throw new TypeError('baseUrl must be a string or URL');
  const url = new URL(baseUrl instanceof URL ? URL.prototype.toString.call(baseUrl) : baseUrl);
  const loopback = url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.hash || url.search || url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Deployment URL must be HTTPS or loopback HTTP, without credentials, query or fragment');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  const manifest = await inventory(await packageRoot(input.packageRoot));
  const signal = AbortSignal.timeout(timeout);
  let bytes = 0;
  let cursor = 0;
  async function check(): Promise<void> {
    while (cursor < manifest.assets.length) {
      const asset = manifest.assets[cursor++];
      const response = await fetch(new URL(asset.path, url), { redirect: 'error', signal });
      if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new Error(`Deployment HTTP ${response.status}: ${asset.path}`); }
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (asset.path.endsWith('.js') && !['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(mime ?? '')) {
        await response.body.cancel(); throw new Error(`Invalid JavaScript MIME: ${asset.path}`);
      }
      if (nosniff && response.headers.get('x-content-type-options')?.toLowerCase() !== 'nosniff') {
        await response.body.cancel(); throw new Error(`Missing X-Content-Type-Options: nosniff: ${asset.path}`);
      }
      const hash = createHash('sha256');
      const reader = response.body.getReader();
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          bytes += part.value.byteLength;
          if (size > asset.bytes || bytes > MAX_BYTES) throw new RangeError(`Deployment byte budget exceeded: ${asset.path}`);
          hash.update(part.value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      if (size !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error(`Deployment bytes differ from installed release: ${asset.path}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, manifest.assets.length) }, check));
  return Object.freeze({ version: manifest.version, baseUrl: url.href, files: manifest.assets.length, bytes,
    limitations: Object.freeze(['Checks installed-release bytes, HTTP status, MIME and optional nosniff only.', 'Page CSP, native Worker/AudioWorklet startup, device deadlines and listening need separate runtime acceptance.']) });
}
