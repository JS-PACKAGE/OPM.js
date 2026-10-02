import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

export const browserEngines = { chromium, firefox, webkit };
export type BrowserEngine = keyof typeof browserEngines;

// Smoke and stress use the same deployed module URLs, trusted gesture, CSP,
// MIME and real 404 behavior. Only built dist assets are exposed to Chromium.
export async function startBrowserFixture(title: string) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; object-src 'none'" });
        response.end(`<!doctype html><title>${title}</title><button id="start">Start audio check</button>`);
        return;
      }
      const path = resolve(root, '.' + decodeURIComponent(pathname));
      if (!path.startsWith(resolve(root, 'dist') + sep)) {
        response.writeHead(403).end();
        return;
      }
      const data = await readFile(path);
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(data);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'HTTP fixture needs a TCP address');
  return { server, url: `http://127.0.0.1:${address.port}/` };
}
