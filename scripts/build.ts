import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { minify } from 'terser';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outdir = join(root, 'dist');
const files: { path: string; data: Buffer }[] = [];
const configPath = join(root, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const demoEntries = [
  'demo/main.ts', 'demo/song.ts', 'demo/basic.ts', 'demo/modulation.ts',
  'demo/context.ts', 'demo/wav.ts', 'demo/audition.ts', 'demo/sequence.ts',
];
const demoDeclarations = new Set(demoEntries.map(path => path.replace(/\.ts$/, '.d.ts')));
const program = ts.createProgram(
  [...parsed.fileNames, ...demoEntries.map(path => join(root, path))],
  { ...parsed.options, rootDir: root },
);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));
}
const emitted = program.emit(undefined, (path, data) => {
  const parts = relative(outdir, path).split(sep);
  if (parts[0] === 'src') parts.shift();
  // Bundled demo helpers have no separate runtime module; do not ship orphan declarations.
  if (parts[0] === 'demo' && !demoDeclarations.has(parts.join('/'))) return;
  files.push({ path: join(outdir, ...parts), data: Buffer.from(data) });
});
if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error('TypeScript declaration emit failed');
const result = await build({
  absWorkingDir: root,
  entryPoints: parsed.fileNames.filter(path => !path.endsWith('.d.ts')),
  bundle: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outbase: 'src',
  outdir,
  legalComments: 'inline',
  sourcemap: 'external',
  sourcesContent: true,
  write: false,
});
// Demos remain directly deployable: TypeScript is only a development dependency.
const demos = await build({
  absWorkingDir: root,
  entryPoints: demoEntries,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: join(outdir, 'demo'),
  sourcemap: 'external',
  sourcesContent: true,
  write: false,
  plugins: [{
    name: 'deployed-demo-imports',
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/src\// }, args => ({
        path: args.path.replace('../src/', '../'), external: true,
      }));
    },
  }],
});
const outputs = [...result.outputFiles, ...demos.outputFiles];
const maps = new Map(outputs.filter(file => file.path.endsWith('.js.map')).map(file => [file.path, file.text]));
for (const file of outputs.filter(file => file.path.endsWith('.js'))) {
  const content = maps.get(`${file.path}.map`);
  if (content === undefined) throw new Error(`Missing source map: ${file.path}`);
  const { code, map } = await minify(file.text, {
    module: true,
    ecma: 2022,
    compress: { passes: 10, pure_getters: false, unsafe: false, unsafe_math: false },
    // Public method names and voice/message property names must remain stable.
    mangle: { properties: false },
    format: { comments: 'some' },
    sourceMap: { content, filename: basename(file.path), url: `${basename(file.path)}.map`, includeSources: true },
  });
  if (code === undefined || typeof map !== 'string') throw new Error(`Minification produced no code/map: ${file.path}`);
  files.push(
    { path: file.path, data: Buffer.from(code + '\n') },
    { path: `${file.path}.map`, data: Buffer.from(map + '\n') },
  );
}
const outputPaths = new Set(files.map(file => file.path));
for (const { path } of files.filter(file => file.path.endsWith('.js'))) {
  if (!outputPaths.has(`${path}.map`) || !outputPaths.has(path.replace(/\.js$/, '.d.ts'))) {
    throw new Error(`Incomplete JavaScript/map/declaration output: ${path}`);
  }
}

// dist is generated only; retain readable source and legal files outside it.
await rm(outdir, { recursive: true, force: true });
const sizes: { file: string; bytes: number }[] = [];
for (const { path, data } of files) {
  if (!path.endsWith('.js') && !path.endsWith('.d.ts') && !path.endsWith('.js.map')) throw new Error(`Unexpected distribution asset: ${path}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  sizes.push({ file: relative(outdir, path), bytes: data.length });
}
console.table(sizes);
console.log('Total bytes:', sizes.reduce((sum, size) => sum + size.bytes, 0));
