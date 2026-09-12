import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUpdateView } from '../extension/updates.js';

test('Chromium update guidance includes the installed version and preserves the installed folder', () => {
  const view = buildUpdateView({ version: '0.27.0' });

  assert.equal(view.versionText, 'Installed version 0.27.0');
  assert.equal(view.browserName, 'Chrome or Brave');
  assert.equal(view.downloadUrl, 'https://github.com/bth0mp/Giga-Pinax/releases/latest/download/giga-pinax-brave.zip');
  assert.match(view.instructions, /chrome:\/\/extensions or brave:\/\/extensions/);
  assert.match(view.instructions, /same installed folder, then select Reload/);
});

test('Firefox update guidance includes the installed version and temporary add-on path', () => {
  const view = buildUpdateView({
    version: '0.27.0',
    browser_specific_settings: { gecko: { id: 'giga-pinax@example.test' } },
  });

  assert.equal(view.versionText, 'Installed version 0.27.0');
  assert.equal(view.browserName, 'Firefox');
  assert.equal(view.downloadUrl, 'https://github.com/bth0mp/Giga-Pinax/releases/latest/download/giga-pinax-firefox.zip');
  assert.match(view.instructions, /about:debugging > This Firefox > Load Temporary Add-on/);
  assert.match(view.instructions, /select the downloaded ZIP/);
  assert.match(view.instructions, /unsigned temporary extensions must be loaded again after Firefox restarts/);
});
