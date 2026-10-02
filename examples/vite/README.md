# Installed-package Vite example

This standalone TypeScript host uses a real installed OPM package, not repository source imports. Vite is an exact **development-only** pin (`8.3.2`), verified against the [npm registry](https://registry.npmjs.org/vite/8.3.2). Node 22.12+ is required. OPM has no runtime package dependencies.

## Run the current local package

From the repository root:

```sh
npm ci
npm run build
npm pack --ignore-scripts
cd examples/vite
npm ci
npm install --no-save --package-lock=false ../../opm.js-1.6.0.tgz
npm run dev
```

Open the printed localhost address. Turn output volume down, then press **Play brass**; **Stop** releases the real worklet note. The host routes audio through a gain of 0.08, uses velocity 0.65 and bounds each note to ten seconds. This is a host listening trim, not a patch rewrite or limiter.

The host selects `BASE_URL + 'opm/worklet/processor.js'` through the same-origin `workletUrl` option. It uses an independent `subscribe()` listener and awaits the stop command's **admission**, not release-tail completion. Hover the status after onset for an output-time estimate derived from `getOutputTimestamp()` when available. Page teardown unsubscribes, aborts outstanding waits, permanently disposes the engine, disconnects its host gain and closes the host-owned context. See the [host integration recipe](../../doc/host-integration.md) for clock conversion and reusable component cleanup.

The example manifest and lockfile contain only development tooling, not a guessed registry OPM release or a machine-specific tarball path. `npm ci` installs locked Vite tooling; install the engine tarball separately with `--no-save --package-lock=false`. Running `npm ci` again removes that unsaved engine, so reinstall the tarball afterward. For an npm-published package, install the desired exact version with these same flags instead of the local tarball. The current package version is 1.6.0; registry availability is a separate publication prerequisite. The GitHub release does not publish it to npm.

```sh
npm run build
npm run preview
```

For a deployment under `/opm-example/`:

```sh
OPM_EXAMPLE_BASE=/opm-example/ npm run build
npm run preview
```

Deploy the **entire** generated `dist/` directory at the configured base. Do not move only the worklet file or only the app bundle. `copy-assets.mjs` resolves the installed package entry and copies its complete `dist` tree **and package-root LICENSE** to `public/opm/` before dev/build, replacing only that generated directory. Retain the deployed `opm/LICENSE` legal asset. Vite copies this public tree unchanged into production output. The app imports `BASE_URL + 'opm/api/index.js'` externally; OPM's worklet URL and relative ESM dependencies retain their installed layout. No Vite worklet rewrite, worker plugin or blob URL is assumed.

## Production headers and routing

Serve HTTPS (localhost is a secure-context exception), `.js` as `text/javascript`, and HTML as `text/html`. Recommended production response headers:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
```

No inline script, eval or blob permission is needed for this production host. Development HMR may need additional WebSocket allowances; do not loosen production CSP to accommodate the development server. Vite preview is a convenient local preview, not a hardened production server.

Missing `/opm/` assets must return **404**, not a SPA HTML fallback. In particular `opm/worklet/processor.js` and its relative imports must be same-origin, deployed at the same base and served as JavaScript. An absent processor or HTML MIME response must reject `OPM.start()`; the page displays the error instead of pretending audio is ready. Deploy the app and copied package tree atomically and avoid mixing cached files from different versions.

From the root, after building OPM and installing Playwright Chromium, `npm run vite-smoke` packs the current local artifact, installs it in this example, builds the non-root deployment and runs actual browser play/stop behind these headers. It verifies deployed license text, missing-worklet and incorrect-MIME rejection, and blocked inline script. It publishes nothing and installs the engine without changing this example's manifest or lockfile.

Generated `node_modules/`, `public/opm/`, `dist/` and local tarballs are not source files. This README describes expected behavior; verification results belong to the integration run.
