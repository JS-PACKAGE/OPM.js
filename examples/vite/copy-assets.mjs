import { cp, mkdir, rm, access, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the installed package, never the repository's source tree.
const dist = resolve(dirname(fileURLToPath(import.meta.resolve('opm.js'))), '..');
await access(resolve(dist, 'worklet/processor.js'));
const target = fileURLToPath(new URL('./public/opm', import.meta.url));
await mkdir(dirname(target), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(dist, target, { recursive: true });
await copyFile(resolve(dist, '../LICENSE'), resolve(target, 'LICENSE'));
console.log(`Copied installed OPM dist to ${target}`);
