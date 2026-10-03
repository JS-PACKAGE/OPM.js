'use strict';
// Search remains local, works from file://, and only creates text nodes and links.
const input = document.querySelector('#docs-search');
const results = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
const form = input?.closest('form');
if (input && results && status && form) {
  form.addEventListener('submit', event => event.preventDefault());
  input.addEventListener('input', () => {
    const terms = input.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    results.replaceChildren();
    if (!terms.length) { status.textContent = ''; return; }
    const matches = (window.OPM_DOC_SEARCH || []).filter(entry => terms.every(term => entry.text.toLocaleLowerCase().includes(term)));
    for (const entry of matches.slice(0, 40)) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.textContent = entry.title;
      link.href = entry.href;
      item.append(link);
      results.append(item);
    }
    status.textContent = matches.length ? `${matches.length} matches${matches.length > 40 ? '; first 40 shown. Refine your search.' : '.'}` : 'No matches.';
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { const first = results.querySelector('a'); if (first) { event.preventDefault(); first.focus(); } }
    if (event.key === 'Escape') { input.value = ''; input.dispatchEvent(new Event('input')); }
  });
  results.addEventListener('keydown', event => {
    const links = Array.from(results.querySelectorAll('a'));
    const index = links.indexOf(document.activeElement);
    if (index < 0) return;
    if (event.key === 'ArrowDown' && links[index + 1]) { event.preventDefault(); links[index + 1].focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); (links[index - 1] || input).focus(); }
    if (event.key === 'Escape') { event.preventDefault(); input.focus(); }
  });
}
