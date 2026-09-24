import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { runPage } from './helpers/dom.mjs';

// A page split into modules is loaded the way a browser evaluates it: its own modules first, in one
// sandbox with it, and anything a sandbox of scripts would do differently is refused.
const pageFiles = (files) => {
  const folder = mkdtempSync(join(tmpdir(), 'giga-pinax-page-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  return (name) => pathToFileURL(join(folder, name));
};

test('a page runs after its own modules, in its sandbox, in the order a browser evaluates them', () => {
  const file = pageFiles({
    'page.js': "import { shared } from './lib.js';\nimport { part } from './part.js';\nconst page = () => `${part()}+page`;\nlog.push(page());\n",
    'part.js': "import { shared } from './base.js';\nexport function part() { return shared('part'); }\nlog.push('part');\n",
    'base.js': "export const shared = (name) => `${name}:${document.title}`;\nlog.push('base');\n",
  });
  const log = [];
  runPage(vm.createContext({ log, document: { title: 'sandbox' } }), file('page.js'), new Set(['part.js', 'base.js']));
  assert.deepEqual(log, ['base', 'part', 'part:sandbox+page']);
});

test('a name two of a page\'s modules both declare is refused, not replaced', () => {
  const file = pageFiles({
    'page.js': "import { part } from './part.js';\nfunction label() { return 'page'; }\n",
    'part.js': "export function part() { return label(); }\nfunction label() { return 'part'; }\n",
  });
  assert.throws(() => runPage(vm.createContext({}), file('page.js'), new Set(['part.js'])), /label is declared by both/);
});

test('an import or export form a sandbox script cannot run is refused', () => {
  const file = pageFiles({
    'page.js': "import { part } from './part.js';\n",
    'part.js': "const part = () => 1;\nexport { part };\n",
  });
  assert.throws(() => runPage(vm.createContext({}), file('page.js'), new Set(['part.js'])), /keeps "export \{ part \};"/);
});
