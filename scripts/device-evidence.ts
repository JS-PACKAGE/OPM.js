import { readFile, stat } from 'node:fs/promises';
import { evaluateDeviceEvidence } from './device-evidence-model.js';

// Usage: npm run device-evidence -- [--require-complete] opm-device-observations.json [...]
// The tool reviews exported files; it cannot create, certify or upload hardware evidence.
const args = process.argv.slice(2);
const requireComplete = args[0] === '--require-complete';
const files = requireComplete ? args.slice(1) : args;
if (files.length === 0 || files.length > 16) {
  console.error('Usage: device-evidence [--require-complete] FILE.json [...up to 16 files]');
  process.exit(2);
}
let failed = false;
for (const file of files) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new RangeError('evidence must be a regular file of at most 2 MiB');
    const summary = evaluateDeviceEvidence(await readFile(file, 'utf8'));
    console.log(JSON.stringify({ file, runs: summary.runs, counts: summary.counts, complete: summary.complete, warnings: summary.warnings,
      note: 'Physical results are user-declared and unauthenticated; unverified cells have no accepted capture.',
      cells: summary.cells.filter(cell => cell.status !== 'unverified' || cell.runId !== null) }, null, 2));
    if (requireComplete && !summary.complete) { failed = true; console.error(`${file}: ${summary.counts.unverified} unverified and ${summary.counts.fail} failed physical cells`); }
  } catch (error) {
    failed = true;
    console.error(`${file}: invalid evidence: ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exitCode = failed ? 1 : 0;
