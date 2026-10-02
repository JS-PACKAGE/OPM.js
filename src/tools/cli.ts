/// <reference types="node" />
import { checkDeployment, copyAssets } from './assets.js';

const USAGE = `Usage:
  opm-assets copy <destination>   Atomically copy the complete dist tree + LICENSE into a NEW directory
  opm-assets check <base-url>     Verify a deployed copy byte-for-byte over HTTP(S) (loopback HTTP allowed)

copy never overwrites an existing directory: use a fresh release-specific path (for example public/audio/opm-1.8.0).
check compares status, JavaScript MIME, nosniff and SHA-256 with the installed release; it does not test CSP or audio.
`;

export interface CliOutput { out(line: string): void; err(line: string): void }

/** Returns a process exit code. Machine-readable results are one JSON object on stdout. */
export async function main(argv: readonly string[], io: CliOutput = { out: line => console.log(line), err: line => console.error(line) }): Promise<number> {
  const [command, target, ...rest] = argv;
  if (command === '--help' || command === '-h' || command === undefined) { io.out(USAGE); return command === undefined ? 2 : 0; }
  if (target === undefined || rest.length > 0 || (command !== 'copy' && command !== 'check')) { io.err(USAGE); return 2; }
  try {
    const result = command === 'copy' ? await copyAssets({ destination: target }) : await checkDeployment(target);
    io.out(JSON.stringify({ command, ...result }));
    return 0;
  } catch (error) {
    io.err(`opm-assets ${command} failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
