import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

interface Heading { level: number; title: string; id: string }
interface Page { source?: string; file: string; title: string; body: string; headings: Heading[] }
interface SearchEntry { title: string; text: string; href: string }
const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text: string): string => text.replace(/[&<>"']/g, char => HTML_ENTITIES[char]!);
const portable = (path: string): string => path.split(sep).join('/');
// A filename is never a URL scheme; encode components before exposing filesystem paths.
const relativeUrl = (path: string): string => './' + portable(path).split('/').map(component => encodeURIComponent(component)).join('/');
const slug = (text: string): string => text.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '').replace(/\s/g, '-') || 'section';
const plain = (text: string): string => text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`+/g, '').replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2');

// Stop at the link's closing delimiter, not a later adjacent link; URLs may contain balanced parentheses.
function markdownLink(text: string): readonly [string, string, string, string, string | undefined] | null {
  const label = /^(!?)\[([^\]]+)\]\(/.exec(text);
  if (!label) return null;
  let cursor = label[0].length, href: string;
  if (text[cursor] === '<') {
    const end = text.indexOf('>', cursor + 1);
    if (end < 0) return null;
    href = text.slice(cursor + 1, end); cursor = end + 1;
  } else {
    const start = cursor; let depth = 0;
    for (; cursor < text.length; cursor++) {
      const char = text[cursor]!;
      if (char === '\\' && cursor + 1 < text.length) { cursor++; continue; }
      if (char === '(') depth++;
      else if (char === ')') { if (depth === 0) break; depth--; }
      else if (/\s/.test(char)) break;
    }
    if (depth !== 0) return null;
    href = text.slice(start, cursor).replace(/\\([\\()])/g, '$1');
  }
  if (!href) return null;
  const beforeSpace = cursor;
  while (/\s/.test(text[cursor] ?? '')) cursor++;
  let title: string | undefined;
  const quote = text[cursor];
  if (cursor > beforeSpace && (quote === '"' || quote === "'")) {
    const end = text.indexOf(quote, cursor + 1);
    if (end < 0) return null;
    title = text.slice(cursor + 1, end); cursor = end + 1;
    while (/\s/.test(text[cursor] ?? '')) cursor++;
  }
  return text[cursor] === ')' ? [text.slice(0, cursor + 1), label[1]!, label[2]!, href, title] : null;
}

/** Repository Markdown is the source of truth; raw HTML is deliberately treated as text. */
function markdown(source: string, link: (href: string) => string): { body: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const counts = new Map<string, number>();
  const inline = (text: string): string => {
    let out = '';
    for (let i = 0; i < text.length;) {
      const rest = text.slice(i);
      const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest);
      if (code) { out += `<code>${escape(code[2]!.replace(/\n/g, ' '))}</code>`; i += code[0].length; continue; }
      const item = markdownLink(rest);
      if (item) {
        const href = link(item[3]!);
        out += item[1] ? `<img src="${escape(href)}" alt="${escape(plain(item[2]!))}" loading="lazy">` : `<a href="${escape(href)}"${item[4] ? ` title="${escape(item[4])}"` : ''}>${inline(item[2]!)}</a>`;
        i += item[0].length; continue;
      }
      const auto = /^<(https?:\/\/[^>]+|[^\s<>]+@[^\s<>]+)>/.exec(rest);
      if (auto) { const value = auto[1]!; out += `<a href="${escape(link(value.includes('@') && !value.includes('://') ? `mailto:${value}` : value))}">${escape(value)}</a>`; i += auto[0].length; continue; }
      let matched = false;
      for (const [mark, tag] of [['**', 'strong'], ['__', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em']] as const) {
        if (!rest.startsWith(mark) || (mark === '_' && /\w/.test(text[i - 1] ?? ''))) continue;
        const end = text.indexOf(mark, i + mark.length);
        if (end <= i + mark.length) continue;
        out += `<${tag}>${inline(text.slice(i + mark.length, end))}</${tag}>`; i = end + mark.length; matched = true; break;
      }
      if (matched) continue;
      if (text[i] === '\\' && /[\\`*{}\[\]()#+.!_>~-]/.test(text[i + 1] ?? '')) { out += escape(text[i + 1]!); i += 2; continue; }
      out += escape(text[i]!); i++;
    }
    return out;
  };
  const cells = (line: string): string[] => {
    const result: string[] = []; let value = ''; let ticks = 0;
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (char === '\\' && line[i + 1] === '|') { value += '|'; i++; continue; }
      if (char === '`') { let length = 1; while (line[i + length] === '`') length++; value += '`'.repeat(length); i += length - 1; if (!ticks) ticks = length; else if (ticks === length) ticks = 0; continue; }
      if (char === '|' && !ticks) { result.push(value.trim()); value = ''; } else value += char;
    }
    result.push(value.trim());
    if (line.trim().startsWith('|')) result.shift();
    if (line.trim().endsWith('|')) result.pop();
    return result;
  };
  const listItem = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/;
  const starts = (lines: string[], i: number): boolean => /^(?:\s*$|#{1,6}\s|\s*```|\s*~~~|\s*>|\s*[-+*]\s|\s*\d+[.)]\s|\s*(?:---+|\*\*\*+|___+)\s*$)/.test(lines[i]!) || (i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1]!));
  const blocks = (lines: string[]): string => {
    const out: string[] = [];
    for (let i = 0; i < lines.length;) {
      const line = lines[i]!;
      if (!line.trim()) { i++; continue; }
      const fence = /^\s*(`{3,}|~{3,})([^\s]*)\s*$/.exec(line);
      if (fence) {
        const content: string[] = []; i++;
        while (i < lines.length && !new RegExp(`^\\s*${fence[1]![0]}{${fence[1]!.length},}\\s*$`).test(lines[i]!)) content.push(lines[i++]!);
        if (i === lines.length) throw new Error('Unclosed Markdown code fence');
        i++; out.push(`<pre><code${fence[2] ? ` class="language-${escape(fence[2])}"` : ''}>${escape(content.join('\n'))}</code></pre>`); continue;
      }
      const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
      if (heading) {
        const title = plain(heading[2]!); const base = slug(title); const count = counts.get(base) ?? 0; counts.set(base, count + 1);
        const id = count ? `${base}-${count}` : base; const level = heading[1]!.length;
        headings.push({ level, title, id }); out.push(`<h${level} id="${escape(id)}">${inline(heading[2]!)} <a class="anchor" href="#${escape(id)}" aria-label="Link to ${escape(title)}">#</a></h${level}>`); i++; continue;
      }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        const quote: string[] = []; while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*> ?/, ''));
        out.push(`<blockquote>${blocks(quote)}</blockquote>`); continue;
      }
      if (i + 1 < lines.length && line.includes('|') && cells(lines[i + 1]!).every(cell => /^:?-{3,}:?$/.test(cell))) {
        const header = cells(line); const alignment = cells(lines[i + 1]!); i += 2;
        const cellHtml = (value: string, n: number, tag: string): string => `<${tag}${tag === 'th' ? ' scope="col"' : ''}${alignment[n]?.endsWith(':') ? ` class="${alignment[n]!.startsWith(':') ? 'align-center' : 'align-right'}"` : ''}>${inline(value)}</${tag}>`;
        const rows: string[] = []; while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) { const row = cells(lines[i++]!); rows.push(`<tr>${header.map((_, n) => cellHtml(row[n] ?? '', n, 'td')).join('')}</tr>`); }
        out.push(`<div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable table"><table><thead><tr>${header.map((value, n) => cellHtml(value, n, 'th')).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`); continue;
      }
      const first = listItem.exec(line);
      if (first) {
        const indent = first[1]!.length; const ordered = /^\d/.test(first[2]!); const items: string[] = [];
        while (i < lines.length) {
          const item = listItem.exec(lines[i]!);
          if (!item || item[1]!.length !== indent || /^\d/.test(item[2]!) !== ordered) break;
          const content = [item[3]!]; const width = item[1]!.length + item[2]!.length + 1; i++;
          while (i < lines.length) {
            if (!lines[i]!.trim()) { if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) { content.push(''); i++; continue; } break; }
            const next = listItem.exec(lines[i]!);
            if (next && next[1]!.length <= indent) break;
            const leading = /^\s*/.exec(lines[i]!)![0].length;
            if (leading <= indent) break;
            content.push(lines[i++]!.slice(Math.min(width, leading)));
          }
          items.push(`<li>${blocks(content)}</li>`);
          if (!lines[i]?.trim()) i++;
        }
        const tag = ordered ? 'ol' : 'ul'; out.push(`<${tag}${ordered && first[2] !== '1.' ? ` start="${parseInt(first[2]!, 10)}"` : ''}>${items.join('')}</${tag}>`); continue;
      }
      if (/^ {4}\S/.test(line)) {
        const content: string[] = []; while (i < lines.length && (/^ {4}/.test(lines[i]!) || !lines[i]!.trim())) content.push(lines[i++]!.slice(4));
        out.push(`<pre><code>${escape(content.join('\n'))}</code></pre>`); continue;
      }
      const paragraph = [line]; i++;
      while (i < lines.length && !starts(lines, i)) paragraph.push(lines[i++]!);
      out.push(`<p>${paragraph.map(value => inline(value.replace(/ {2}$/, '')) + (/ {2}$/.test(value) ? '<br>' : '')).join('\n')}</p>`);
    }
    return out.join('\n');
  };
  return { body: blocks(source.replace(/\r\n?/g, '\n').split('\n')), headings };
}

async function declarations(root: string): Promise<{ page: Page; search: SearchEntry[] }> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name: string; exports: Record<string, { types: string }> };
  const entries: { name: string; path: string }[] = [];
  for (const [name, target] of Object.entries(pkg.exports)) {
    if (!target.types) throw new Error(`Missing public declaration target: ${name}`);
    if (target.types.includes('*')) {
      const folder = dirname(join(root, target.types)); const prefix = target.types.slice(0, target.types.indexOf('*')); const suffix = target.types.slice(target.types.indexOf('*') + 1);
      for (const file of (await readdir(folder)).sort()) {
        if (!file.endsWith(suffix)) continue;
        const match = portable(relative(root, join(folder, file))).slice(prefix.replace(/^\.\//, '').length, -suffix.length || undefined);
        const specifier = name.replace('*', match);
        if (pkg.exports[specifier]) continue;
        entries.push({ name: pkg.name + specifier.slice(1), path: join(folder, file) });
      }
    } else entries.push({ name: name === '.' ? pkg.name : pkg.name + name.slice(1), path: join(root, target.types) });
  }
  const program = ts.createProgram(entries.map(entry => entry.path), { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ['node'], lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'] });
  const checker = program.getTypeChecker(); const search: SearchEntry[] = [];
  const sources = program.getSourceFiles().filter(file => file.fileName.startsWith(join(root, 'dist') + sep)).sort((a, b) => a.fileName.localeCompare(b.fileName));
  const sourceIds = new Map(sources.map(file => [file.fileName, `declaration-${slug(portable(relative(join(root, 'dist'), file.fileName)))}`]));
  const headings: Heading[] = [{ level: 1, title: 'Generated API reference', id: 'generated-api-reference' }];
  const sections: string[] = [];
  for (const entry of entries) {
    const file = program.getSourceFile(entry.path); const module = file && checker.getSymbolAtLocation(file);
    if (!file || !module) throw new Error(`Cannot read public declarations: ${entry.name}`);
    const id = `module-${slug(entry.name)}`; headings.push({ level: 2, title: entry.name, id });
    const symbols = checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name));
    const rows = symbols.map(symbol => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const declaration = target.declarations?.[0]; const source = declaration?.getSourceFile(); const targetId = source && sourceIds.get(source.fileName);
      if (!targetId) throw new Error(`Missing declaration for public export ${entry.name}:${symbol.name}`);
      const kind = target.flags & ts.SymbolFlags.Value ? 'value / type where applicable' : 'type';
      search.push({ title: `${entry.name} · ${symbol.name}`, text: `${entry.name} ${symbol.name} ${kind}`, href: `${relativeUrl('api.html')}#${targetId}` });
      return `<tr><th scope="row"><a href="#${escape(targetId)}"><code>${escape(symbol.name)}</code></a></th><td>${kind}</td><td><code>${escape(portable(relative(join(root, 'dist'), source!.fileName)))}</code></td></tr>`;
    });
    sections.push(`<section><h2 id="${id}">${escape(entry.name)}</h2><table><thead><tr><th scope="col">Export</th><th scope="col">Kind</th><th scope="col">Declaration</th></tr></thead><tbody>${rows.join('')}</tbody></table></section>`);
  }
  for (const file of sources) {
    search.push({ title: `Declarations · ${portable(relative(join(root, 'dist'), file.fileName))}`, text: file.text, href: `${relativeUrl('api.html')}#${sourceIds.get(file.fileName)!}` });
    const title = portable(relative(join(root, 'dist'), file.fileName)); const id = sourceIds.get(file.fileName)!;
    headings.push({ level: 2, title, id }); sections.push(`<section><h2 id="${escape(id)}">${escape(title)}</h2><pre><code class="language-typescript">${escape(file.text)}</code></pre></section>`);
  }
  return { page: { file: 'api.html', title: 'Generated API reference', headings, body: '<h1 id="generated-api-reference">Generated API reference</h1><p>This reference describes the current build, including unreleased checkout additions; it does not retroactively change historical release archives.</p><p>Generated from the compiler-emitted declarations for every package export. Export tables identify the public import surfaces; the complete declaration files below include their supporting types, comments, overloads and private-member markers. Supporting modules are not additional public import promises. No signatures are handwritten or abridged.</p>' + sections.join('\n') }, search };
}

/** Called after dist emit so the API always describes the same build as the shipped modules. */
export async function buildDocs(root: string): Promise<void> {
  const directory = join(root, 'doc'); await mkdir(directory, { recursive: true });
  const sources = ['README.md', 'SECURITY.md', 'CHANGELOG.md', ...(await readdir(directory)).filter(file => file.endsWith('.md')).sort().map(file => `doc/${file}`)];
  const outputs = new Map(sources.map(source => [resolve(root, source), source.startsWith('doc/') ? source.slice(4).replace(/\.md$/, '.html') : source.toLowerCase().replace(/\.md$/, '.html')]));
  const pages: Page[] = []; const search: SearchEntry[] = [];
  for (const source of sources) {
    const text = await readFile(join(root, source), 'utf8');
    const rendered = markdown(text, href => {
      let canonical: string;
      try { canonical = decodeURIComponent(href); } catch { return '#'; }
      // Validate decoded input before routing it; browsers strip embedded tabs/newlines.
      if (/[\u0000-\u0020\u007f]/.test(href) || /[\u0000-\u001f\u007f]/.test(canonical) || /^[\\/]{2}/.test(canonical.trimStart())) return '#';
      const scheme = /^[a-z][a-z\d+.-]*:/i.exec(canonical.trimStart())?.[0];
      if (scheme && !/^(https?:|mailto:)$/i.test(scheme)) return '#';
      if (/^(https?:|mailto:)/i.test(href)) {
        try {
          const url = new URL(href);
          return /^(https?:|mailto:)$/.test(url.protocol) ? href : '#';
        } catch { return '#'; }
      }
      if (href.startsWith('#')) return href;
      const match = /^([^?#]*)(.*)$/.exec(href)!;
      const path = decodeURIComponent(match[1]!); const target = resolve(dirname(join(root, source)), path);
      if (path.endsWith('.md')) {
        const output = outputs.get(target); if (!output) throw new Error(`Unmapped documentation link in ${source}: ${href}`);
        return relativeUrl(output) + match[2]!;
      }
      return relativeUrl(relative(directory, target)) + match[2]!;
    });
    const file = outputs.get(resolve(root, source))!; const title = rendered.headings[0]?.title ?? source;
    pages.push({ source, file, title, ...rendered });
    search.push({ title, text: `${title} ${plain(text)}`, href: relativeUrl(file) });
    for (const heading of rendered.headings) search.push({ title: `${title} · ${heading.title}`, text: `${title} ${heading.title}`, href: `${relativeUrl(file)}#${heading.id}` });
  }
  const api = await declarations(root); pages.push(api.page); search.push(...api.search);
  pages.unshift({ file: 'index.html', title: 'OPM.js documentation', headings: [], body: '<h1>OPM.js documentation</h1><p>Guides are generated from the shipped Markdown source. The API reference contains compiler-generated declarations for all public entry points.</p><ul>' + pages.map(page => `<li><a href="${escape(relativeUrl(page.file))}">${escape(page.title)}</a></li>`).join('') + '</ul><p><a href="https://opm.js-package.xyz/">Online demos</a> · <a href="https://github.com/YueyuHoshizora/OPM.js">Source repository</a></p>' });
  for (const page of pages) {
    const nav = pages.map(item => `<li><a href="${escape(relativeUrl(item.file))}"${item.file === page.file ? ' aria-current="page"' : ''}>${escape(item.title)}</a></li>`).join('');
    const toc = page.headings.filter(heading => heading.level <= 3).map(heading => `<li class="depth-${heading.level}"><a href="#${escape(heading.id)}">${escape(heading.title)}</a></li>`).join('');
    const sourceLink = page.source ? `<p class="source">Generated from <a href="${escape(relativeUrl(relative(directory, join(root, page.source))))}">Markdown source</a>. Edit the source, not this HTML.</p>` : '';
    await writeFile(join(directory, page.file), `<!doctype html>\n<html lang="${page.file.includes('zh-TW') ? 'zh-Hant' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(page.title)} — OPM.js</title><link rel="stylesheet" href="site.css"><script src="search-data.js" defer></script><script src="site.js" defer></script></head><body><a class="skip" href="#content">Skip to content</a><header><a href="index.html">OPM.js documentation</a><a href="https://opm.js-package.xyz/">Online demos</a></header><div class="layout"><aside><form role="search"><label for="docs-search">Search guides and API exports</label><input id="docs-search" type="search" autocomplete="off" aria-controls="search-results"><p id="search-status" role="status" aria-live="polite"></p><ul id="search-results"></ul></form><nav aria-label="Documentation"><ul>${nav}</ul></nav>${toc ? `<nav aria-label="On this page"><h2>On this page</h2><ul>${toc}</ul></nav>` : ''}</aside><main id="content" tabindex="-1">${sourceLink}${page.body}</main></div></body></html>\n`);
  }
  await writeFile(join(directory, 'search-data.js'), `// Generated documentation search data.\nwindow.OPM_DOC_SEARCH = ${JSON.stringify(search).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};\n`);
}
