import { readFile, stat } from 'node:fs/promises';
import { evaluateListeningEvidenceFiles } from './listening-evidence-model.js';
import type { ListeningEvidenceFile } from './listening-evidence-model.js';

// npm run --silent listening-evidence -- FILE.json [...] > listening-review.json
// This emits a separate review artifact, never modifies captures or preset metadata.
const files = process.argv.slice(2);
if (files.length < 1 || files.length > 16 || files.some(file => file.startsWith('--'))) {
  console.error('Usage: listening-evidence FILE.json [...up to 16 files]');
  process.exit(2);
}
try {
  const inputs: ListeningEvidenceFile[] = [];
  for (const file of files) {
    const info = await stat(file);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new RangeError(`${file}: evidence must be a regular file of at most 2 MiB`);
    inputs.push({ file, source: await readFile(file, 'utf8') });
  }
  const summary = evaluateListeningEvidenceFiles(inputs);
  console.log(JSON.stringify({ schema: 'opm-listening-evidence-review-1', ...summary,
    evidence: 'Human subjective preferences and patch hash identities are declared and unauthenticated; exports do not include patches to recompute hashes. Counts are assessments, not artistic acceptance, listener authentication, LUFS, hardware fidelity or an automatic recommendation to change host trim. Read exact conditions and original notes; metadata remains unchanged.' }, null, 2));
} catch (error) {
  console.error(`Invalid listening evidence: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
