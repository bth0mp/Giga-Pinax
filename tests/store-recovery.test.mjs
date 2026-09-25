import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseHtmlFile } from './helpers/dom.mjs';
import { mountRecovery } from '../extension/store-recovery.js';

const NOW = '2026-09-25T10:00:00.000Z';
const UNREADABLE = { ok: false, code: 'storage', message: 'Stored data is invalid: Expected an object.', reason: 'unreadable' };
const bridge = { newRequestId: () => 'request-1', sendCommand: async () => ({ ok: false }) };

// Review Minor 7: in the popup the notice went above the header, where the unfocused skip link sat over its last line.
test('X-02: the recovery notice goes under the header it is given, and first in main without one', () => {
  const popup = parseHtmlFile(new URL('../extension/popup.html', import.meta.url));
  const header = popup.querySelector('.popup-header');
  const card = mountRecovery({ document: popup, bridge, reply: UNREADABLE, after: header });
  const main = popup.querySelector('main');
  assert.equal(main.children.indexOf(card), main.children.indexOf(header) + 1);
  assert.equal(main.children[0], header, 'the header, and its skip link, stay first');

  const workspace = parseHtmlFile(new URL('../extension/workspace.html', import.meta.url));
  const first = mountRecovery({ document: workspace, bridge, reply: UNREADABLE });
  assert.equal(workspace.querySelector('main').children[0], first);

  // The popup gives its header: one line in companion-popup.js.
  const source = readFileSync(new URL('../extension/companion-popup.js', import.meta.url), 'utf8');
  assert.match(source, /mountRecovery\(\{ document, bridge, reply, after: document\.querySelector\('\.popup-header'\) \}\)/);
});
