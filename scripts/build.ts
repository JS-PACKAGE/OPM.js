import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { minify } from 'terser';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outdir = join(root, 'dist');
const voiceFiles = (await readdir(join(root, 'src/voices'))).sort();
const files: { path: string; data: Buffer }[] = [];
const configPath = join(root, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));
}
const emitted = program.emit(undefined, (path, data) => files.push({ path, data: Buffer.from(data) }));
if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error('TypeScript declaration emit failed');
const result = await build({
  absWorkingDir: root,
  entryPoints: [
    'src/api/index.ts', 'src/core/index.ts', 'src/worklet/processor.ts',
    ...voiceFiles.filter(file => extname(file) === '.ts' && !file.endsWith('.d.ts')).map(file => `src/voices/${file}`),
  ],
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outbase: 'src',
  outdir,
  chunkNames: 'chunks/[hash]',
  legalComments: 'inline',
  write: false,
});
for (const file of result.outputFiles) {
  const { code } = await minify(file.text, {
    module: true,
    ecma: 2022,
    compress: { passes: 10, pure_getters: false, unsafe: false, unsafe_math: false },
    // Public method names and voice/message property names must remain stable.
    mangle: { properties: false },
    format: { comments: 'some' },
  });
  if (code === undefined) throw new Error(`Minification produced no output: ${file.path}`);
  files.push({ path: file.path, data: Buffer.from(code + '\n') });
}
for (const file of voiceFiles.filter(file => extname(file) === '.json')) {
  const data: unknown = JSON.parse(await readFile(join(root, 'src/voices', file), 'utf8'));
  files.push({ path: join(outdir, 'voices', file), data: Buffer.from(JSON.stringify(data) + '\n') });
}
// Demos remain directly deployable: TypeScript is only a development dependency.
const demos = await build({
  absWorkingDir: root,
  entryPoints: ['demo/main.ts', 'demo/song.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: join(outdir, 'demo'),
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
for (const file of demos.outputFiles) files.push({ path: file.path, data: Buffer.from(file.contents) });

// dist is generated only; retain readable source and legal files outside it.
await rm(outdir, { recursive: true, force: true });
const sizes: { file: string; bytes: number; gzip: number; brotli: number }[] = [];
for (const { path, data } of files) {
  const gzip = gzipSync(data, { level: 9 });
  const brotli = brotliCompressSync(data, { params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
  } });
  await mkdir(dirname(path), { recursive: true });
  await Promise.all([
    writeFile(path, data), writeFile(`${path}.gz`, gzip), writeFile(`${path}.br`, brotli),
  ]);
  sizes.push({ file: relative(outdir, path), bytes: data.length, gzip: gzip.length, brotli: brotli.length });
}
console.table(sizes);
console.log('Total:', sizes.reduce((sum, size) => ({
  bytes: sum.bytes + size.bytes, gzip: sum.gzip + size.gzip, brotli: sum.brotli + size.brotli,
}), { bytes: 0, gzip: 0, brotli: 0 }));
