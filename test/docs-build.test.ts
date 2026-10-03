import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocs } from '../scripts/docs-build.js';

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'opm-docs-test-'));
  await mkdir(join(root, 'doc'));
  for (const directory of ['api', 'core', 'voices', 'tools']) await mkdir(join(root, 'dist', directory), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'opm.js', type: 'module', exports: {
    '.': { types: './dist/api/index.d.ts' }, './core': { types: './dist/core/index.d.ts' },
    './voices/*.js': { types: './dist/voices/*.d.ts' }, './tools/assets.js': { types: './dist/tools/assets.d.ts' },
  } }));
  await writeFile(join(root, 'dist/api/index.d.ts'), "export { compile } from '../core/index.js';\nexport type { Options } from '../core/types.js';\n");
  await writeFile(join(root, 'dist/core/index.d.ts'), "import type { Options } from './types.js';\n/** Full overloads remain visible. */\nexport declare function compile(input: string, options?: Options): number;\nexport declare function compile(input: readonly number[], options?: Options): number;\n");
  await writeFile(join(root, 'dist/core/types.d.ts'), 'export interface Options { readonly limits: readonly [number, number]; mode?: "safe" | "strict"; }\n');
  await writeFile(join(root, 'dist/voices/brass.d.ts'), 'export declare const brass: { readonly name: "brass" };\n');
  await writeFile(join(root, 'dist/tools/assets.d.ts'), 'export declare function copyAssets(destination: string): Promise<void>;\n');
  await writeFile(join(root, 'doc/guide.md'), '# Guide\n\n## Repeated\n');
  await writeFile(join(root, 'README.md'), '# Fixture\n\n[Guide](./doc/guide.md#repeated)\n');
  await writeFile(join(root, 'SECURITY.md'), '# Security\n');
  await writeFile(join(root, 'CHANGELOG.md'), '# Changes\n');
  return root;
}

function renderedLinks(html: string): { label: string; href: string }[] {
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => ({
    label: match[2]!.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, entity => entities[entity]!),
    href: match[1]!.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => entities[entity]!),
  }));
}

async function searchEntries(root: string): Promise<{ title: string; href: string }[]> {
  const data = await readFile(join(root, 'doc/search-data.js'), 'utf8');
  return JSON.parse(data.slice(data.indexOf(' = ') + 3).trim().slice(0, -1)) as { title: string; href: string }[];
}

test('static documentation escapes text, preserves Markdown structures and rewrites only local guide links', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'doc/guide.md'), '# Guide\n\n## Repeated\n\n## Repeated\n\n## 繁體中文\n\n[README](../README.md#fixture) · [Checkout](https://github.com/example/repo/blob/tag/README.md) · [Unsafe](javascript:alert)\n\n<script>alert("bad")</script>\n\n```html\n</code><script>alert("bad")</script>\n```\n\n| Name | Contract |\n| --- | ---: |\n| **Strong** | `a | b` |\n\n> Quoted *text*.\n\n1. First\n   - Nested\n2. Second\n');
    await buildDocs(root);
    const html = await readFile(join(root, 'doc/guide.html'), 'utf8');
    assert.match(html, /id="repeated"/);
    assert.match(html, /id="repeated-1"/);
    assert.match(html, /id="繁體中文"/);
    const links = renderedLinks(html);
    const base = 'https://docs.example/doc/guide.html';
    assert.equal(new URL(links.find(link => link.label === 'README')!.href, base).href, 'https://docs.example/doc/readme.html#fixture');
    assert.equal(new URL(links.find(link => link.label === 'Checkout')!.href, base).href, 'https://github.com/example/repo/blob/tag/README.md');
    assert.equal(new URL(links.find(link => link.label === 'Unsafe')!.href, base).href, new URL('#', base).href);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;\/code&gt;&lt;script&gt;alert\(&quot;bad&quot;\)/);
    assert.match(html, /<strong>Strong<\/strong>/);
    assert.match(html, /<code>a \| b<\/code>/);
    assert.match(html, /<blockquote><p>Quoted <em>text<\/em>/);
    assert.match(html, /<ol><li><p>First<\/p>\n<ul><li><p>Nested/);
    assert.match(html, /<label for="docs-search">/);
    assert.match(html, /aria-label="Documentation"/);
    const entries = await searchEntries(root);
    assert.ok(entries.some(entry => new URL(entry.href, base).href === 'https://docs.example/doc/guide.html#repeated-1'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rendered Markdown URLs reject decoded schemes, controls and malformed escapes at every sink', async () => {
  const root = await fixture();
  try {
    const unsafe = [
      'javascript%3Aalert%281%29', 'JaVaScRiPt%3Aalert%281%29', 'data%3Atext/html%2Cpayload',
      'java%09script%3Aalert%281%29', 'java%0Ascript%3Aalert%281%29', 'java%0Dscript%3Aalert%281%29',
      '%20javascript%3Aalert%281%29', '%00javascript%3Aalert%281%29', 'vbscript%3Apayload',
      '//evil.example/path', '%2F%2Fevil.example/path', '%5C%5Cevil.example/path',
      'https://safe.example/%0Apath', 'mailto:user@example.com%0Dpayload', '#anchor%09payload',
      './guide.md?value=%00', './guide.md#heading%7F', './bad%file.svg', './bad%E0%A4.svg',
    ];
    await writeFile(join(root, 'doc/guide.md'), '# Guide\n\n' + unsafe.map((href, i) => `[Unsafe ${i}](${href})\n\n![Image ${i}](${href})`).join('\n\n'));
    await buildDocs(root);
    const html = await readFile(join(root, 'doc/guide.html'), 'utf8');
    const links = renderedLinks(html).filter(link => link.label.startsWith('Unsafe '));
    const images = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)];
    assert.equal(links.length, unsafe.length);
    assert.equal(images.length, unsafe.length);
    for (const href of [...links.map(link => link.href), ...images.map(image => image[1]!)]) {
      assert.equal(href, '#');
      for (const base of ['https://docs.example/doc/guide.html', 'file:///docs/guide.html']) {
        assert.equal(new URL(href, base).href, new URL('#', base).href);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('filesystem-derived nav, index, search and source links cannot become URL schemes', async () => {
  const root = await fixture();
  try {
    const names = ['javascript:alert(1)', 'data:payload', 'javascript:\talert', 'guide #?% 中文'];
    for (const [i, name] of names.entries()) await writeFile(join(root, 'doc', `${name}.md`), `# Filename ${i}\n\n## Detail\n`);
    await buildDocs(root);
    const index = renderedLinks(await readFile(join(root, 'doc/index.html'), 'utf8'));
    const guide = renderedLinks(await readFile(join(root, 'doc/guide.html'), 'utf8'));
    const entries = await searchEntries(root);
    for (const [i, name] of names.entries()) {
      const page = renderedLinks(await readFile(join(root, 'doc', `${name}.html`), 'utf8'));
      for (const base of ['https://docs.example/doc/index.html', 'file:///docs/index.html']) {
        const expectedPage = new URL(`./${encodeURIComponent(name + '.html')}`, base).href;
        const expectedSource = new URL(`./${encodeURIComponent(name + '.md')}`, base).href;
        const indexLinks = index.filter(link => link.label === `Filename ${i}`);
        assert.equal(indexLinks.length, 2); // Navigation and the index listing.
        for (const link of [...indexLinks, ...guide.filter(link => link.label === `Filename ${i}`)]) {
          assert.ok(link.href.startsWith('./'));
          assert.equal(new URL(link.href, base).href, expectedPage);
        }
        assert.equal(new URL(page.find(link => link.label === 'Markdown source')!.href, base).href, expectedSource);
        const search = entries.filter(entry => entry.title === `Filename ${i}` || entry.title === `Filename ${i} · Detail`);
        assert.equal(search.length, 2);
        for (const entry of search) {
          assert.ok(entry.href.startsWith('./'));
          assert.equal(new URL(entry.href, base).href, expectedPage + (entry.title.endsWith(' · Detail') ? '#detail' : ''));
        }
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rendered URLs preserve encoded relative files, Markdown rewrites, queries, fragments and safe external links', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'doc', 'nested folder'));
    await writeFile(join(root, 'doc', 'nested folder', '圖片 #?.svg'), '<svg/>');
    await writeFile(join(root, 'doc', 'space 中文.md'), '# 空間\n\n## 繁體中文\n');
    await writeFile(join(root, 'doc/guide.md'), '# Guide\n\n' + [
      '[Nested](./nested%20folder/%E5%9C%96%E7%89%87%20%23%3F.svg?value=a%26b&next=%23part#image)',
      '[Unicode](./space%20%E4%B8%AD%E6%96%87%2Emd?value=a%26b#%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87)',
      '[Parent](../README.md?view=full#fixture)', '[Anchor](#guide)',
      '[HTTP](http://example.com/path?query=a%26b#part)', '[HTTPS](https://example.com/path?next=%23part#part)',
      '[Mail](mailto:user@example.com?subject=Hello%20world)',
      '[Colon file](./javascript%3Aasset.svg)', '[Encoded separator](./nested%20folder%2Fasset.svg)',
    ].join('\n\n'));
    await buildDocs(root);
    const links = renderedLinks(await readFile(join(root, 'doc/guide.html'), 'utf8'));
    const expected: Record<string, string> = {
      Nested: './nested%20folder/%E5%9C%96%E7%89%87%20%23%3F.svg?value=a%26b&next=%23part#image',
      Unicode: './space%20%E4%B8%AD%E6%96%87.html?value=a%26b#%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87',
      Parent: './readme.html?view=full#fixture', Anchor: '#guide',
      HTTP: 'http://example.com/path?query=a%26b#part', HTTPS: 'https://example.com/path?next=%23part#part',
      Mail: 'mailto:user@example.com?subject=Hello%20world',
      'Colon file': './javascript%3Aasset.svg', 'Encoded separator': './nested%20folder/asset.svg',
    };
    for (const [label, href] of Object.entries(expected)) {
      const actual = links.find(link => link.label === label);
      assert.ok(actual, label);
      for (const base of ['https://docs.example/doc/guide.html', 'file:///docs/guide.html']) {
        assert.equal(new URL(actual.href, base).href, new URL(href, base).href, label);
      }
    }
    const heading = renderedLinks(await readFile(join(root, 'doc', 'space 中文.html'), 'utf8')).find(link => link.href === '#繁體中文');
    assert.ok(heading);
    assert.equal(new URL(heading.href, 'https://docs.example/doc/space.html').hash, '#%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('documentation rejects missing local Markdown targets and unclosed code fences', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'doc/guide.md'), '# Guide\n\n[Missing](./missing.md)\n');
    await assert.rejects(buildDocs(root), Error);
    await writeFile(join(root, 'doc/guide.md'), '# Guide\n\n```ts\nconst incomplete = true;\n');
    await assert.rejects(buildDocs(root), Error);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('adjacent multilingual links and balanced URL parentheses retain their own destinations', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'doc/guide.md'), '# Guide\n\n## Repeated\n\n[API](../README.md#fixture)，宿主見[Local guide](./guide.md#repeated)。[Parentheses](https://example.test/a(b(c)) "URL title")\n');
    await buildDocs(root);
    const links = renderedLinks(await readFile(join(root, 'doc/guide.html'), 'utf8'));
    const base = 'https://docs.example/doc/guide.html';
    assert.equal(new URL(links.find(link => link.label === 'API')!.href, base).href, 'https://docs.example/doc/readme.html#fixture');
    assert.equal(new URL(links.find(link => link.label === 'Local guide')!.href, base).href, 'https://docs.example/doc/guide.html#repeated');
    assert.equal(new URL(links.find(link => link.label === 'Parentheses')!.href, base).href, 'https://example.test/a(b(c))');
  } finally { await rm(root, { recursive: true, force: true }); }
});
