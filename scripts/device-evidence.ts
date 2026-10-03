import { readFile, stat } from 'node:fs/promises';
import { evaluateDeviceEvidenceFiles } from './device-evidence-model.js';
import type { EvidenceFile } from './device-evidence-model.js';

// Usage: npm run device-evidence -- [--require-complete] ios.json android.json [...]
// Review stdout is an artifact; original input captures are never changed or uploaded.
const args = process.argv.slice(2);
const requireComplete = args[0] === '--require-complete';
const files = requireComplete ? args.slice(1) : args;
if (files.length === 0 || files.length > 16 || files.some(file => file.startsWith('--'))) {
  console.error('Usage: device-evidence [--require-complete] FILE.json [...up to 16 files]');
  process.exit(2);
}
try {
  const inputs: EvidenceFile[] = [];
  for (const file of files) {
    const info = await stat(file);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new RangeError(`${file}: evidence must be a regular file of at most 2 MiB`);
    inputs.push({ file, source: await readFile(file, 'utf8') });
  }
  const summary = evaluateDeviceEvidenceFiles(inputs);
  console.log(JSON.stringify({ schema: 'opm-device-evidence-review-1', ...summary,
    evidence: 'Declared manual hardware results are unauthenticated. Complete means 36 passing declared cells in exact recorded version/workload scopes, not certification of a phone family. Read originals, notes and events.' }, null, 2));
  if (requireComplete && !summary.complete) {
    process.exitCode = 1;
    console.error('Collective review is incomplete: no exact recorded package/workload campaign has all 36 passing declared cells in complete device/policy scopes.');
  }
} catch (error) {
  console.error(`Invalid evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
