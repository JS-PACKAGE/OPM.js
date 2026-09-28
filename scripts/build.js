import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { minify } from 'terser';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = join(root, 'dist');
const voiceFiles = (await readdir(join(root, 'src/voices'))).sort();
const result = await build({
  absWorkingDir: root,
  entryPoints: [
    'src/api/index.js', 'src/core/index.js', 'src/worklet/processor.js',
    ...voiceFiles.filter(file => extname(file) === '.js').map(file => `src/voices/${file}`),
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

const files = [];
for (const file of result.outputFiles) {
  const { code } = await minify(file.text, {
    module: true,
    ecma: 2022,
    compress: { passes: 10, pure_getters: false, unsafe: false, unsafe_math: false },
    // Public method names and voice/message property names must remain stable.
    mangle: { properties: false },
    format: { comments: 'some' },
  });
  files.push({ path: file.path, data: Buffer.from(code + '\n') });
}
for (const file of voiceFiles.filter(file => extname(file) === '.json')) {
  const data = JSON.parse(await readFile(join(root, 'src/voices', file), 'utf8'));
  files.push({ path: join(outdir, 'voices', file), data: Buffer.from(JSON.stringify(data) + '\n') });
}

// dist is generated only; retain readable source and legal files outside it.
await rm(outdir, { recursive: true, force: true });
const sizes = [];
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
