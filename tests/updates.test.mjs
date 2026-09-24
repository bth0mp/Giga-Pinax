import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// A store keeps the extension up to date itself, and its listing is where an update comes from: the card's download
// link would hand that collector a ZIP to install over a managed install. Only an unpacked or temporary install, which
// no store updates, carries no update_url and still needs the card.
test('the Updates card belongs to an install no store keeps up to date', () => {
  assert.equal(buildUpdateView({ version: '0.32.0' }).fromStore, false);
  assert.equal(buildUpdateView({ version: '0.32.0', browser_specific_settings: { gecko: { id: 'x@test' } } }).fromStore, false);
  for (const update_url of ['https://clients2.google.com/service/update2/crx', 'https://versioncheck.addons.mozilla.org/update/x.json']) {
    const view = buildUpdateView({ version: '0.32.0', update_url });
    assert.equal(view.fromStore, true, update_url);
    // Nothing else is reworded: the card is simply not shown.
    assert.equal(view.versionText, 'Installed version 0.32.0');
  }
  // The page hides the card itself; the rest of it is unchanged.
  const source = readFileSync(new URL('../extension/updates.js', import.meta.url), 'utf8');
  assert.match(source, /getElementById\('updates'\)[\s\S]{0,80}hidden = view\.fromStore/);
});

// A signed Firefox build names its own update manifest under browser_specific_settings.gecko, and Firefox keeps an
// installed XPI up to date from it: the card's ZIP would only hand that collector a temporary add-on in place of a
// permanent one. The same manifest is loaded through about:debugging too, and a temporary add-on is never updated, so
// it keeps the card; a build whose install type is not known keeps it as well, since only an update it would miss is
// at stake.
test('a signed Firefox install that updates itself hides the card; a temporary one keeps it', () => {
  const manifest = {
    version: '0.34.0',
    browser_specific_settings: { gecko: { id: 'giga-pinax@local.invalid', update_url: 'https://bth0mp.github.io/Giga-Pinax/firefox/updates.json' } },
  };
  for (const installType of ['normal', 'sideload', 'admin', 'other']) {
    assert.equal(buildUpdateView(manifest, { installType }).fromStore, true, installType);
  }
  assert.equal(buildUpdateView(manifest, { installType: 'development' }).fromStore, false);
  assert.equal(buildUpdateView(manifest).fromStore, false);
  assert.equal(buildUpdateView(manifest, { installType: undefined }).fromStore, false);
  // Without an update manifest nothing updates it, whatever the install type.
  assert.equal(buildUpdateView({ version: '0.34.0', browser_specific_settings: { gecko: { id: 'x@test' } } }, { installType: 'normal' }).fromStore, false);
  // The Chromium rule is unchanged: a store's update_url alone decides it.
  assert.equal(buildUpdateView({ version: '0.34.0' }, { installType: 'normal' }).fromStore, false);
  assert.equal(buildUpdateView({ version: '0.34.0', update_url: 'https://clients2.google.com/service/update2/crx' }, { installType: 'development' }).fromStore, true);
});
