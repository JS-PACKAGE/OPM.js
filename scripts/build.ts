import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const sizes: { file: string; bytes: number }[] = [];
for (const { path, data } of files) {
  if (!path.endsWith('.js') && !path.endsWith('.d.ts')) throw new Error(`Unexpected distribution asset: ${path}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  sizes.push({ file: relative(outdir, path), bytes: data.length });
}
console.table(sizes);
console.log('Total bytes:', sizes.reduce((sum, size) => sum + size.bytes, 0));
