import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Enumerate compiled tests consistently across shells, including Windows.
const directory = new URL('../test/', import.meta.url);
const files = (await readdir(directory)).filter(file => file.endsWith('.test.js')).sort();
if (files.length === 0) throw new Error('No compiled behavioral tests found');
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files.map(file => fileURLToPath(new URL(file, directory)))], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
