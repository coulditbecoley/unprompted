import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const source = readFileSync(new URL('../app/questions/brand-highlight.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function('require', 'exports', compiled)(createRequire(import.meta.url), exports);
const render = (text, brand) => renderToStaticMarkup(createElement(exports.BrandHighlight, { text, brand }));
const marked = text => `<mark class="q-brand-highlight">${text}</mark>`;

test('highlight preserves casing and whitespace and excludes larger words', () => {
 assert.equal(render('Cursor CURSOR\ncursor cursors preCursor Cursor_2', 'Cursor'), `${marked('Cursor')} ${marked('CURSOR')}\n${marked('cursor')} cursors preCursor Cursor_2`);
 assert.equal(render('Claude Code and Claude', 'Claude Code'), `${marked('Claude Code')} and Claude`);
 assert.equal(render('caf\u00e9 caf\u00e9s', 'caf\u00e9'), `${marked('caf\u00e9')} caf\u00e9s`);
});
test('brand names are literal, even with regex punctuation', () => {
 for (const brand of ['C++', 'a.b', '[tool]', 'a(b)', 'x|y', '$tool', 'a\\b']) {
  assert.equal(render(brand, brand), marked(brand));
 }
});
test('raw HTML remains escaped, including inside the highlighted name', () => {
 assert.equal(render('<script>Cursor</script> & "x"', 'Cursor'), `&lt;script&gt;${marked('Cursor')}&lt;/script&gt; &amp; &quot;x&quot;`);
 assert.equal(render('<img src=x onerror=alert(1)>', '<img src=x onerror=alert(1)>'), marked('&lt;img src=x onerror=alert(1)&gt;'));
});
test('unfiltered, unmatched and empty text stays plain', () => {
 assert.equal(render('Cursor & text'), 'Cursor &amp; text');
 assert.equal(render('Cursor', ''), 'Cursor');
 assert.equal(render('Other tool', 'Cursor'), 'Other tool');
 assert.equal(render('', 'Cursor'), '');
});
