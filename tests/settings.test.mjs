import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';

import * as backup from '../extension/core/backup.js';
import * as bidTools from '../extension/bid-tools.js';
import * as csv from '../extension/core/csv.js';
import * as diagnostics from '../extension/core/diagnostics.js';
import * as companionPreferences from '../extension/companion-preferences.js';
import * as localCatalogue from '../extension/local-catalogue.js';
import * as money from '../extension/core/money.js';
import * as storeRecovery from '../extension/store-recovery.js';
import { SCHEMA_VERSION, createEmptySnapshot, quarantineEntryId, validateSnapshot } from '../extension/core/records.js';
import { GIGA_PREFERENCES_KEY } from '../extension/companion-preferences.js';
import { LOCAL_CORPORA, catalogueMetadataText } from '../extension/local-catalogue.js';
import { browserGlobals, pageSource, parseHtmlFile } from './helpers/dom.mjs';
import { skip } from './helpers/bundle.mjs';

const NOW = '2026-09-12T12:00:00.000Z';
const LATER = '2026-09-13T12:00:00.000Z';
const uuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const settle = async (turns = 6) => {
  for (let turn = 0; turn < turns; turn += 1) await new Promise((resolve) => { setImmediate(resolve); });
};

function preferences(extra = {}) {
  return {
    schemaVersion: SCHEMA_VERSION, revision: 3, currency: 'USD', desktopAlertsEnabled: false,
    createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

function lot(id, extra = {}) {
  return {
    id, revision: 0, dataClass: 'collector', title: 'Coin', sourceLinks: [], bidHistory: [],
    outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

function snapshotWith({ lots = [], quarantine = null, ...extra } = {}) {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.revision = 7;
  snapshot.preferences = preferences();
  snapshot.lots.push(...lots);
  if (quarantine) snapshot.quarantine = quarantine;
  return Object.assign(snapshot, extra);
}

const LATEST = '2026-09-14T12:00:00.000Z';
const backupDocument = (snapshot, at = NOW) => {
  const result = backup.exportBackup(snapshot, at);
  assert.equal(result.ok, true, result.error?.message);
  return result.value;
};

const fileOf = (text) => ({ size: Buffer.byteLength(text), text: async () => text });

// The settings page, loaded the way tests/popup-research.test.mjs loads the research popup: its own
// markup parsed into the fake DOM, its imports handed in as sandbox globals, and a bridge that
// answers commands out of the test rather than out of a browser. updates.js runs first because the
// page imports it before its own body runs, and the Updates card is what that import draws.
function loadSettings({
  snapshot = snapshotWith(),
  manifest = { version: '0.32.1' },
  reply = () => ({ ok: true }),
  stored = new Map(),
  confirmAnswers = [],
  catalogueMetadata = async () => null,
  language = 'en-US',
  siteDataBlocked = false,
  snapshotReply = { ok: true, value: snapshot },
  diagnosticsStored = {},
  clipboard: givenClipboard = null,
  getSelf = null,
  hash = '',
  // What the store answers the gauge's storage.usage with (K-13); that read is kept out of `commands`, which list writes.
  usage = { ok: false },
} = {}) {
  const copied = [];
  const closedTabs = [];
  const clipboard = givenClipboard ?? { writeText: async (text) => { copied.push(text); } };
  const document = parseHtmlFile(new URL('../extension/settings.html', import.meta.url));
  const created = [];
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName) => {
    const element = createElement(tagName);
    created.push(element);
    return element;
  };

  const commands = [];
  const prompts = [];
  const blobs = [];
  const state = { snapshot: snapshotReply };
  let requestIds = 0;
  const bridge = {
    newRequestId: () => `request-${(requestIds += 1)}`,
    getSnapshot: async () => state.snapshot,
    sendCommand: async (command) => {
      if (command.type === 'storage.usage') return typeof usage === 'function' ? usage() : usage;
      // Copied out of the sandbox realm, so a test can compare it with objects of its own.
      commands.push(structuredClone(command));
      return reply(command, state);
    },
  };

  const diagnosticsStorage = {
    get: async (key) => (Object.hasOwn(diagnosticsStored, key) ? { [key]: structuredClone(diagnosticsStored[key]) } : {}),
    set: async (items) => { Object.assign(diagnosticsStored, structuredClone(items)); },
  };
  const localStorage = {
    getItem: (key) => (stored.has(key) ? stored.get(key) : null),
    setItem: (key, value) => { stored.set(key, String(value)); },
    removeItem: (key) => { stored.delete(key); },
  };
  const confirm = (message) => {
    prompts.push(message);
    return confirmAnswers.length ? confirmAnswers.shift() : true;
  };

  const sandbox = {
    ...backup, ...money, ...bidTools, ...companionPreferences, ...localCatalogue, ...csv, ...storeRecovery,
    diagnosticsText: diagnostics.diagnosticsText,
    defaultLocalCatalogue: { metadata: catalogueMetadata },
    bridge,
    ...browserGlobals(document, { localStorage, confirm, downloads: blobs, language }),
    navigator: { language, clipboard },
    browser: { runtime: { getManifest: () => manifest }, ...(getSelf ? { management: { getSelf } } : {}),
      tabs: { getCurrent: async () => ({ id: 7 }), remove: async (id) => { closedTabs.push(id); } } },
    location: { hash },
    // The diagnostics buffer lives in extension storage; the page reads and clears it through the real module.
    readDiagnostics: () => diagnostics.readDiagnostics({ storage: diagnosticsStorage }),
    clearDiagnostics: () => diagnostics.clearDiagnostics({ storage: diagnosticsStorage }),
    globalThis: null,
    Date, JSON, Object, Array, String, Number, Boolean, Math, Promise, Set, Map, RegExp, Intl,
    Error, TypeError, TextEncoder, structuredClone,
  };
  // A browser that blocks site data for the extension throws on reading localStorage at all.
  if (siteDataBlocked) {
    Object.defineProperty(sandbox, 'localStorage', {
      get() { throw new Error("Failed to read the 'localStorage' property from 'Window': Access is denied for this document."); },
    });
  }
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  for (const name of ['updates.js', 'settings.js']) {
    const url = new URL(`../extension/${name}`, import.meta.url);
    vm.runInContext(pageSource(url), context, { filename: url.pathname });
  }

  // Each download is one object URL followed by one anchor that is clicked, so the two line up.
  const downloads = () => created
    .filter((element) => element.tagName === 'a' && element.clickCount > 0)
    .map((element, index) => ({ name: element.download, text: blobs[index]?.parts?.[0], type: blobs[index]?.type }));

  return {
    document,
    element: (id) => document.getElementById(id),
    status: () => document.getElementById('settings-status').textContent,
    statusIsError: () => document.getElementById('settings-status').dataset.error,
    commands,
    prompts,
    downloads,
    stored,
    state,
    copied,
    diagnosticsStored,
    closedTabs,
  };
}

async function openSettings(options) {
  const page = loadSettings(options);
  await settle();
  return page;
}

// --- the presets editor -------------------------------------------------------------------------

test('a preset control is named by its field and described by its hint and its error', async () => {
  const page = await openSettings();
  await page.element('add-premium').click();
  const row = page.document.querySelector('.premium-row');
  const ladder = row.querySelector('.premium-ladder');
  const field = ladder.closest('.premium-field');
  // The hint is a description, not part of the control's name: a textarea called "Increment tiers,
  // one tier per line: the amount the tier starts at…" is read out in full every time it is reached.
  assert.equal(field.querySelector('label').textContent, 'Increment tiers');
  assert.equal(field.querySelector('label').querySelector('.premium-hint'), null);
  const described = ladder.getAttribute('aria-describedby').split(' ');
  assert.deepEqual(
    described.map((id) => page.element(id).className),
    ['premium-hint', 'premium-error'],
  );
  assert.match(page.element(described[0]).textContent, /^Optional\. One tier per line/);
  assert.equal(field.querySelector('.premium-error').getAttribute('role'), 'alert');
});

// A placeholder inside a named house's row reads as that house's own schedule. Nothing in the box
// may look like numbers a collector could take for the tiers.
test('the empty tiers box shows the shape of a line, not numbers that could pass for a ladder', async () => {
  const page = await openSettings();
  await page.element('add-premium').click();
  const row = page.document.querySelector('.premium-row');
  assert.equal(row.querySelector('.premium-ladder').placeholder, 'from: step');
  assert.equal(row.querySelector('.premium-ladder').value, '');
  assert.doesNotMatch(row.querySelector('.premium-ladder').placeholder, /\d/);
  // Nowhere in the row does a placeholder open with a figure a collector could read as a real one.
  for (const control of row.querySelectorAll('input, textarea')) {
    assert.doesNotMatch(control.placeholder, /^\d/, control.className);
  }
});

// One announcement per error: the row's own alert, beside the field it is about.
test('a refused preset row is announced once, beside the field, not again in the page status', async () => {
  const page = await openSettings();
  await page.element('add-premium').click();
  const row = page.document.querySelector('.premium-row');
  row.querySelector('.premium-name').value = 'Roma Numismatics';
  row.querySelector('.premium-value').value = 'twenty';
  await page.element('save-settings').click();

  const expected = bidTools.presetFromFields(
    { name: 'Roma Numismatics', premiumText: 'twenty', ladderText: '', ladderCurrency: 'USD' },
    { locale: 'en-US' },
  );
  assert.equal(expected.ok, false);
  const control = row.querySelector('.premium-value');
  assert.equal(control.closest('.premium-field').querySelector('.premium-error').textContent,
    expected.error.message);
  assert.equal(control.getAttribute('aria-invalid'), 'true');
  assert.equal(page.document.activeElement, control);
  assert.equal(page.status(), '', 'the page status says nothing the row has already announced');
  assert.deepEqual(page.commands, [], 'and nothing is saved');
});

test('a saved row is carried into the command as the parsed preset, and the row is redrawn from it', async () => {
  const page = await openSettings({
    reply: (command, state) => {
      const next = preferences({ revision: 4, currency: command.preferences.currency, housePremiumPresets: command.preferences.housePremiumPresets });
      state.snapshot = { ok: true, value: { ...state.snapshot.value, preferences: next } };
      return { ok: true, value: next };
    },
  });
  await page.element('add-premium').click();
  const row = page.document.querySelector('.premium-row');
  row.querySelector('.premium-name').value = '  Roma   Numismatics ';
  row.querySelector('.premium-value').value = '22.50';
  row.querySelector('.premium-ladder-currency').value = 'GBP';
  row.querySelector('.premium-ladder').value = '0: 10\n1000: 50';
  await page.element('save-settings').click();
  await settle();

  assert.equal(page.commands.length, 1);
  assert.equal(page.commands[0].type, 'preferences.save');
  assert.equal(page.commands[0].expectedRevision, 3);
  assert.deepEqual(page.commands[0].preferences.housePremiumPresets, [{
    name: 'Roma Numismatics',
    buyerPremiumBps: 2250,
    incrementLadder: { currency: 'GBP', tiers: [{ from: 0, step: 1000 }, { from: 100000, step: 5000 }] },
  }]);
  assert.equal(page.status(), 'Settings saved.');
  assert.equal(page.element('save-settings').disabled, false);
});

// A house's VAT on its premium and a platform's fee on the hammer are part of its terms: typed once
// in its row, carried by every calculation that picks the house.
test('a preset row takes VAT on premium and a platform fee, and saves them only when typed', async () => {
  const page = await openSettings({ reply: (command) => ({ ok: true, value: preferences({ revision: 4, housePremiumPresets: command.preferences.housePremiumPresets }) }) });
  await page.element('add-premium').click();
  await page.element('add-premium').click();
  const [kunker, plain] = page.document.querySelectorAll('.premium-row');
  const label = (control) => control.closest('.premium-field').querySelector('label').querySelector('span').textContent;
  assert.equal(label(kunker.querySelector('.premium-vat')), 'VAT on premium %');
  assert.equal(label(kunker.querySelector('.premium-platform')), 'Platform fee % on hammer');
  kunker.querySelector('.premium-name').value = 'Künker';
  kunker.querySelector('.premium-value').value = '25';
  kunker.querySelector('.premium-vat').value = '19';
  plain.querySelector('.premium-name').value = 'Heritage';
  plain.querySelector('.premium-value').value = '20';
  plain.querySelector('.premium-platform').value = '3';
  await page.element('save-settings').click();
  await settle();
  assert.deepEqual(page.commands[0].preferences.housePremiumPresets, [
    { name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900 },
    { name: 'Heritage', buyerPremiumBps: 2000, platformFeeBps: 300 },
  ]);
});

test('a VAT that cannot be read is refused beside its own field', async () => {
  const page = await openSettings();
  await page.element('add-premium').click();
  const row = page.document.querySelector('.premium-row');
  row.querySelector('.premium-name').value = 'Künker';
  row.querySelector('.premium-value').value = '25';
  row.querySelector('.premium-vat').value = '190';
  await page.element('save-settings').click();
  const vat = row.querySelector('.premium-vat');
  assert.equal(vat.closest('.premium-field').querySelector('.premium-error').textContent, 'VAT on premium must be between 0% and 100%.');
  assert.equal(vat.getAttribute('aria-invalid'), 'true');
  assert.deepEqual(page.commands, []);
});

test('a saved preset with VAT and a platform fee is drawn back and saves unchanged in every locale', async () => {
  const saved = { name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900, platformFeeBps: 150 };
  for (const language of ['ar-EG', 'de-DE', 'en-US']) {
    const page = await openSettings({
      language,
      snapshot: snapshotWith({ preferences: preferences({ housePremiumPresets: [saved] }) }),
      reply: () => ({ ok: true, value: preferences({ revision: 4, housePremiumPresets: [saved] }) }),
    });
    const row = page.document.querySelector('.premium-row');
    assert.deepEqual([row.querySelector('.premium-vat').value, row.querySelector('.premium-platform').value], ['19.00', '1.50'], language);
    await page.element('save-settings').click();
    assert.deepEqual(page.commands[0].preferences.housePremiumPresets, [saved], language);
  }
});

test('Copy house presets puts the houses as they stand in the rows on the clipboard', async () => {
  const saved = [{ name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900 }];
  const page = await openSettings({ snapshot: snapshotWith({ preferences: preferences({ housePremiumPresets: saved }) }) });
  await page.element('add-premium').click();
  const added = page.document.querySelectorAll('.premium-row')[1];
  added.querySelector('.premium-name').value = 'Roma';
  added.querySelector('.premium-value').value = '20';
  await page.element('copy-presets').click();
  await settle();
  assert.deepEqual(bidTools.parseHousePresets(page.copied[0]).value, [...saved, { name: 'Roma', buyerPremiumBps: 2000 }]);
  assert.equal(page.element('paste-status').textContent, '2 house presets copied. Paste them into Settings in another browser.');
  assert.equal(page.element('paste-status').dataset.error, 'false');
  assert.equal(page.status(), '', 'said once, beside the button, not again at the foot of the page');
  assert.deepEqual(page.commands, [], 'copying saves nothing');
});

// The share fold sits at the top of the page and the page status at its foot, thousands of pixels
// below at phone width: what Copy and Add pasted houses answer is said beside them, as an alert.
test('the copy and paste answers have a line of their own right under Add pasted houses', async () => {
  const page = await openSettings();
  const line = page.element('paste-status');
  assert.equal(line.getAttribute('role'), 'alert');
  const siblings = page.element('paste-presets').parentNode.children;
  assert.equal(siblings[siblings.indexOf(page.element('paste-presets')) + 1], line);
  await page.element('copy-presets').click();
  await settle();
  assert.equal(line.textContent, 'There are no house presets to copy.');
  assert.equal(line.dataset.error, 'true');
  assert.equal(page.status(), '');
});

test('Copy house presets refuses a row it cannot read, beside that row', async () => {
  const page = await openSettings();
  await page.element('add-premium').click();
  const row = page.document.querySelector('.premium-row');
  row.querySelector('.premium-name').value = 'Roma';
  row.querySelector('.premium-value').value = 'twenty';
  await page.element('copy-presets').click();
  await settle();
  assert.deepEqual(page.copied, []);
  assert.equal(row.querySelector('.premium-value').getAttribute('aria-invalid'), 'true');
});

test('pasted house presets become rows to review, update a house of the same name, and save nothing by themselves', async () => {
  const page = await openSettings({ snapshot: snapshotWith({ preferences: preferences({ housePremiumPresets: [{ name: 'Roma', buyerPremiumBps: 2000 }] }) }) });
  page.element('paste-presets-text').value = bidTools.housePresetsText([
    { name: 'roma', buyerPremiumBps: 2400 },
    { name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900, incrementLadder: { currency: 'EUR', tiers: [{ from: 0, step: 500 }] } },
  ]);
  await page.element('paste-presets').click();
  const rows = page.document.querySelectorAll('.premium-row');
  assert.deepEqual(rows.map((row) => row.querySelector('.premium-name').value), ['roma', 'Künker']);
  assert.deepEqual(rows.map((row) => row.querySelector('.premium-value').value), ['24.00', '25.00']);
  assert.equal(rows[1].querySelector('.premium-vat').value, '19.00');
  assert.equal(rows[1].querySelector('.premium-ladder-currency').value, 'EUR');
  assert.equal(page.element('paste-status').textContent, '1 house added and 1 updated. Review them, then Save settings.');
  assert.equal(page.status(), '');
  assert.equal(page.element('paste-presets-text').value, '');
  assert.deepEqual(page.commands, []);
});

test('pasted text that is not house presets changes no row and says why', async () => {
  const page = await openSettings({ snapshot: snapshotWith({ preferences: preferences({ housePremiumPresets: [{ name: 'Roma', buyerPremiumBps: 2000 }] }) }) });
  page.element('paste-presets-text').value = '[{"name":"Roma","buyerPremiumBps":20000}]';
  await page.element('paste-presets').click();
  assert.equal(page.document.querySelector('.premium-value').value, '20.00');
  assert.match(page.element('paste-status').textContent, /^House 1 \(Roma\): /);
  assert.equal(page.element('paste-status').dataset.error, 'true');
  assert.equal(page.status(), '', 'the refusal is not sent to the foot of the page, out of sight');
  assert.equal(page.element('paste-presets-text').value, '[{"name":"Roma","buyerPremiumBps":20000}]', 'the text stays to be corrected');
});

// A list of houses reads as a list: each ladder is folded under a line saying what it holds, and it
// opens itself when Save has something to say about it.
test('each ladder is folded under a line that says what it holds, and opens on its own error', async () => {
  const page = await openSettings({ snapshot: snapshotWith({ preferences: preferences({ housePremiumPresets: [
    { name: 'Leu', buyerPremiumBps: 2000, incrementLadder: { currency: 'CHF', tiers: [{ from: 0, step: 500 }, { from: 100000, step: 10000 }] } },
    { name: 'Roma', buyerPremiumBps: 2000 },
  ] }) }) });
  const [leu, roma] = page.document.querySelectorAll('.premium-row');
  const folded = (row) => row.querySelector('.premium-ladder-details');
  assert.equal(folded(leu).querySelector('summary').textContent, 'Increment ladder · 2 tiers in CHF');
  assert.equal(folded(roma).querySelector('summary').textContent, 'Increment ladder · none');
  assert.equal(folded(leu).open, false);
  assert.ok(folded(leu).querySelector('.premium-ladder'), 'the tiers box is inside the fold');
  const tiers = roma.querySelector('.premium-ladder');
  tiers.value = '5: 5';
  await tiers.emit('input');
  assert.equal(folded(roma).querySelector('summary').textContent, 'Increment ladder · 1 tier in USD');
  await page.element('save-settings').click();
  assert.equal(folded(roma).open, true);
  assert.equal(page.document.activeElement, tiers);
  assert.deepEqual(page.commands, []);
});

test('removing a row takes it out of the next save', async () => {
  const page = await openSettings({
    snapshot: snapshotWith({
      preferences: preferences({ housePremiumPresets: [{ name: 'Roma', buyerPremiumBps: 2000 }] }),
    }),
    reply: () => ({ ok: true, value: preferences({ revision: 4 }) }),
  });
  await settle();
  assert.equal(page.document.querySelectorAll('.premium-row').length, 1);
  await page.document.querySelector('.premium-remove').querySelector('button').click();
  assert.equal(page.document.querySelectorAll('.premium-row').length, 0);
  await page.element('save-settings').click();
  assert.deepEqual(page.commands[0].preferences.housePremiumPresets, []);
});

// A saved row is drawn back into fields the next Save reads, so a row nobody touched has to save
// as it was in every locale: ar-EG and fa-IR write ٫ as their decimal mark, which the parser refuses.
test('a preset row nobody touched saves unchanged whatever the browser locale is', async () => {
  const saved = { name: 'Roma', buyerPremiumBps: 2250, incrementLadder: { currency: 'EUR', tiers: [{ from: 0, step: 500 }, { from: 100000, step: 2500 }] } };
  for (const language of ['ar-EG', 'fa-IR', 'bn-BD', 'de-DE', 'en-US']) {
    const page = await openSettings({
      language,
      snapshot: snapshotWith({ preferences: preferences({ housePremiumPresets: [saved] }) }),
      reply: () => ({ ok: true, value: preferences({ revision: 4, housePremiumPresets: [saved] }) }),
    });
    const row = page.document.querySelector('.premium-row');
    assert.equal(row.querySelector('.premium-value').value, '22.50', language);
    await page.element('save-settings').click();
    assert.equal(row.querySelector('.premium-value').getAttribute('aria-invalid'), null, language);
    assert.equal(page.commands.length, 1, `${language}: the untouched row is saved`);
    assert.deepEqual(page.commands[0].preferences.housePremiumPresets, [saved], language);
  }
});

// Every row has a Remove button, so the house it removes is what tells one from another by name.
test('each Remove button is named by the house its row holds', async () => {
  const page = await openSettings({
    snapshot: snapshotWith({ preferences: preferences({ housePremiumPresets: [
      { name: 'Roma', buyerPremiumBps: 2000 }, { name: 'Leu Numismatik', buyerPremiumBps: 1800 },
    ] }) }),
  });
  const removeOf = (row) => row.querySelector('.premium-remove').querySelector('button');
  const rows = () => page.document.querySelectorAll('.premium-row');
  assert.deepEqual(rows().map((row) => removeOf(row).getAttribute('aria-label')), ['Remove Roma', 'Remove Leu Numismatik']);
  assert.deepEqual(rows().map((row) => removeOf(row).textContent), ['Remove', 'Remove'], 'the visible text starts the name');

  await page.element('add-premium').click();
  const added = rows()[2];
  assert.equal(removeOf(added).getAttribute('aria-label'), 'Remove unnamed house');
  added.querySelector('.premium-name').value = '  Nomos  AG ';
  await added.querySelector('.premium-name').emit('input');
  assert.equal(removeOf(added).getAttribute('aria-label'), 'Remove Nomos AG');
});

// A conflict is not something a second click can fix, so the refusal says what will.
test('a Save refused because presets changed elsewhere says how to see them without losing input', async () => {
  const page = await openSettings({
    reply: () => ({ ok: false, code: 'conflict', outcome: 'not-committed', message: 'Preferences changed in another view.' }),
  });
  page.element('currency').value = 'CHF';
  await page.element('save-settings').click();
  await settle();
  assert.match(page.status(), /^Preferences changed in another view\. Note what you typed, then reload this page to see the settings saved elsewhere\.$/);
  assert.equal(page.statusIsError(), 'true');
  assert.equal(page.element('currency').value, 'CHF', 'what was typed stays on the page');
});

// --- the default currency -----------------------------------------------------------------------

test('saving a new default currency sends it and writes the cache the research popup prices from', async () => {
  const stored = new Map();
  const page = await openSettings({
    stored,
    reply: (command) => ({ ok: true, value: preferences({ revision: 4, currency: command.preferences.currency }) }),
  });
  assert.equal(page.element('currency').value, 'USD', 'the page opens on the stored default');
  assert.equal(JSON.parse(stored.get(GIGA_PREFERENCES_KEY)).currency, 'USD');

  page.element('currency').value = 'EUR';
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.commands.length, 1);
  assert.equal(page.commands[0].preferences.currency, 'EUR');
  assert.equal(JSON.parse(stored.get(GIGA_PREFERENCES_KEY)).currency, 'EUR');
  assert.equal(page.status(), 'Settings saved.');
});

test('a refused currency save is reported as an error and changes neither the cache nor the page', async () => {
  const stored = new Map();
  const page = await openSettings({
    stored,
    reply: () => ({ ok: false, message: 'Local data changed. Reload and review your changes.' }),
  });
  page.element('currency').value = 'CHF';
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.status(), 'Local data changed. Reload and review your changes.');
  assert.equal(page.statusIsError(), 'true');
  assert.equal(JSON.parse(stored.get(GIGA_PREFERENCES_KEY)).currency, 'USD');
  assert.equal(page.element('save-settings').disabled, false, 'the control comes back');
});

test('the chosen theme is remembered locally and applied to the open page', async () => {
  const stored = new Map();
  const page = await openSettings({ stored, reply: () => ({ ok: true, value: preferences({ revision: 4 }) }) });
  page.element('theme').value = 'dark';
  await page.element('save-settings').click();
  await settle();
  assert.equal(stored.get('giga-pinax-theme-v1'), 'dark');
  assert.equal(page.document.documentElement.dataset.theme, 'dark');

  page.element('theme').value = '';
  await page.element('save-settings').click();
  await settle();
  assert.equal(stored.has('giga-pinax-theme-v1'), false);
  assert.equal(page.document.documentElement.dataset.theme, undefined);
});

// Blocked site data costs the theme and the popup's currency cache, both kept in localStorage. The
// settings themselves live in extension storage, so the page loads and saves them all the same.
test('with site data blocked the page still loads and saves, and says the theme cannot be remembered', async () => {
  const page = await openSettings({
    siteDataBlocked: true,
    reply: (command) => ({ ok: true, value: preferences({ revision: 4, currency: command.preferences.currency }) }),
  });
  assert.equal(page.status(), '', 'loading is not reported as a failure');
  assert.equal(page.element('save-settings').disabled, false);
  assert.equal(page.element('currency').value, 'USD');

  page.element('currency').value = 'EUR';
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.commands.at(-1).preferences.currency, 'EUR');
  assert.equal(page.status(), 'Settings saved.');

  page.element('theme').value = 'dark';
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.document.documentElement.dataset.theme, 'dark', 'the open page still takes the theme');
  assert.equal(page.status(), 'Settings saved. This browser profile blocks site data, so the theme applies to this page only and can’t be remembered.');
  assert.equal(page.statusIsError(), 'false');
});

// Specimen photos load from museum servers, so they are the collector's choice, off until he makes it. The switch lives beside the theme, in the
// local storage the popup shares, and is never part of the stored preferences a backup carries.
test('Show specimen photos is off by default, remembered locally when switched on, and forgotten when off', async () => {
  const stored = new Map();
  const page = await openSettings({ stored, reply: () => ({ ok: true, value: preferences({ revision: 4 }) }) });
  const toggle = page.element('specimen-photos');
  assert.equal(toggle.type, 'checkbox');
  assert.equal(toggle.checked, false);
  assert.equal(toggle.closest('label').textContent.trim(), 'Show specimen photos');
  // The popup never prompts for nomisma.org for photos, so a Firefox collector who withheld it is told why none appear.
  assert.match(page.element('photos').textContent, /Firefox.*nomisma\.org/);
  toggle.checked = true;
  await page.element('save-settings').click();
  await settle();
  assert.equal(stored.get('giga-pinax-specimen-photos-v1'), 'on');
  assert.equal(page.status(), 'Settings saved.');
  assert.equal('specimenPhotos' in page.commands.at(-1).preferences, false, 'the switch is no stored preference');

  const reopened = await openSettings({ stored, reply: () => ({ ok: true, value: preferences({ revision: 5 }) }) });
  assert.equal(reopened.element('specimen-photos').checked, true);
  reopened.element('specimen-photos').checked = false;
  await reopened.element('save-settings').click();
  await settle();
  assert.equal(stored.has('giga-pinax-specimen-photos-v1'), false);
});

test('with site data blocked, specimen photos cannot be switched on and the page says so', async () => {
  const page = await openSettings({ siteDataBlocked: true, reply: () => ({ ok: true, value: preferences({ revision: 4 }) }) });
  page.element('specimen-photos').checked = true;
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.status(), 'Settings saved. This browser profile blocks site data, so specimen photos can’t be switched on.');
  // The box says what the popup will do: the switch applies nothing it could not store, so it is unticked, and the page holds nothing unsaved.
  assert.equal(page.element('specimen-photos').checked, false);
  page.element('specimen-photos').checked = true;
  page.element('theme').value = 'dark';
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.status(), 'Settings saved. This browser profile blocks site data, so the theme applies to this page only and can’t be remembered, and specimen photos can’t be switched on.');
});

// --- import: preview, then confirm ---------------------------------------------------------------

async function preview(page, documentText, mode = 'merge') {
  for (const radio of page.document.querySelectorAll('[name="mode"]')) radio.checked = radio.value === mode;
  page.element('import-file').files = [fileOf(documentText)];
  await page.element('import-form').emit('submit');
  await settle();
}

test('a previewed merge shows the counts and the change lines the backup would make', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1))] });
  const incoming = snapshotWith({ lots: [lot(uuid(1)), lot(uuid(2), { title: 'Imported coin' })] });
  const page = await openSettings({ snapshot: current });
  await preview(page, backupDocument(incoming));

  const expected = backup.previewImport(current, backup.validateBackup(backupDocument(incoming)).value, 'merge');
  assert.equal(expected.ok, true, expected.error?.message);
  assert.equal(page.element('import-preview').hidden, false);
  assert.equal(page.element('import-counts').textContent, backup.importCountsText(expected.value));
  assert.deepEqual(
    page.element('import-conflicts').children.map((item) => item.textContent),
    [...backup.importChangeLines(expected.value), ...backup.importIssueLines(expected.value)],
  );
  assert.equal(page.element('confirm-import').disabled, false);
  assert.equal(page.status(), 'Review the import summary, then confirm.');
  assert.deepEqual(page.commands, [], 'a preview writes nothing');
});

test('an unreadable file is refused with the reason and leaves no preview to confirm', async () => {
  const page = await openSettings();
  await preview(page, '{"format":"not-giga-pinax"}');
  assert.equal(page.element('import-preview').hidden, true);
  assert.equal(page.element('confirm-import').disabled, true);
  assert.equal(page.statusIsError(), 'true');
  assert.equal(page.status(), 'Backup format is not recognized.');
});

test('choosing another file drops the preview so a stale summary can never be confirmed', async () => {
  const current = snapshotWith();
  const page = await openSettings({ snapshot: current });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(2))] })));
  assert.equal(page.element('confirm-import').disabled, false);
  await page.element('import-file').emit('change');
  assert.equal(page.element('import-preview').hidden, true);
  assert.equal(page.element('confirm-import').disabled, true);
  await page.element('confirm-import').click();
  await settle();
  assert.deepEqual(page.commands, [], 'the dropped preview confirms nothing');
});

test('a merge that adds only new records is sent without a safety copy', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1))] });
  const page = await openSettings({ snapshot: current, reply: () => ({ ok: true }) });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(1)), lot(uuid(2))] })));
  await page.element('confirm-import').click();
  await settle();

  const sent = page.commands.filter(({ type }) => type === 'backup.import');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].mode, 'merge');
  assert.equal(sent[0].expectedRevision, 7);
  assert.deepEqual(page.downloads(), [], 'nothing local is overwritten, so nothing is copied out');
  assert.equal(page.status(), 'Backup imported.');
  assert.equal(page.element('import-preview').hidden, true);
});

test('a merge that overwrites a record downloads the safety copy before the command', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1), { title: 'Local title' })] });
  const incoming = snapshotWith({ lots: [lot(uuid(1), { title: 'Imported title', updatedAt: LATER })] });
  const document = backupDocument(incoming, LATEST);
  const order = [];
  const page = await openSettings({
    snapshot: current,
    reply: (command) => { order.push(command.type); return { ok: true }; },
  });
  await preview(page, document);
  await page.element('confirm-import').click();
  await settle();

  const [copy] = page.downloads();
  assert.equal(page.downloads().length, 1);
  assert.match(copy.name, /^giga-pinax-before-import-.*\.json$/);
  assert.deepEqual(JSON.parse(copy.text).data.lots.map(({ title }) => title), ['Local title'],
    'the copy holds the records the import is about to overwrite');
  assert.deepEqual(order, ['backup.import'], 'and it reached the browser first');
  assert.equal(page.status(), `Download of a safety copy started: ${copy.name}. Backup imported.`);
});

test('a replace asks first, and declining sends nothing', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1))] });
  const page = await openSettings({ snapshot: current, confirmAnswers: [false] });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(2))] })), 'replace');
  await page.element('confirm-import').click();
  await settle();
  assert.deepEqual(page.prompts, ['Replace local records with this backup?']);
  assert.deepEqual(page.commands, []);
  assert.deepEqual(page.downloads(), []);
  assert.equal(page.element('confirm-import').disabled, false, 'the preview is still there to confirm');
});

test('a replace that is agreed to copies the local records out and then sends the import', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1), { title: 'Local title' })] });
  const page = await openSettings({ snapshot: current, reply: () => ({ ok: true }) });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(2))] })), 'replace');
  await page.element('confirm-import').click();
  await settle();

  const [copy] = page.downloads();
  assert.deepEqual(page.prompts, ['Replace local records with this backup?']);
  assert.match(copy.name, /^giga-pinax-before-import-/);
  assert.deepEqual(JSON.parse(copy.text).data.lots.map(({ id }) => id), [uuid(1)]);
  assert.equal(page.commands.at(-1).mode, 'replace');
  assert.equal(page.status(), `Download of a safety copy started: ${copy.name}. Backup imported.`);
});

// The copy is the promise the confirmation rests on. When it cannot be made, the raw rescue file
// stands in and the collector is asked a second time, naming what went wrong and what was written.
test('a safety copy that cannot be made falls back to the raw file and a second confirmation', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1), { title: 'Local title' })] });
  const page = await openSettings({
    snapshot: current,
    reply: (command) => (command.type === 'snapshot.raw' ? { ok: true, value: { rescued: true } } : { ok: true }),
  });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(2))] })), 'replace');
  page.state.snapshot = { ok: false, message: 'Could not read local records.' };
  await page.element('confirm-import').click();
  await settle();

  const files = page.downloads();
  assert.equal(files.length, 1);
  assert.match(files[0].name, /^giga-pinax-raw-/);
  assert.equal(JSON.parse(files[0].text).kind, 'raw-rescue');
  assert.equal(page.prompts.length, 2, 'the replace question, then the question about the copy');
  assert.ok(page.prompts[1].includes('Could not read local records.'), page.prompts[1]);
  assert.ok(page.prompts[1].includes(files[0].name), page.prompts[1]);
  assert.equal(page.commands.at(-1).type, 'backup.import');
  // No copy was made, so none is claimed - and the page says plainly that it could not read itself
  // back afterwards either, rather than leaving a stale page looking current.
  assert.equal(page.status(), 'Backup imported, but this page could not reload: Could not read local records.');
});

test('declining the second confirmation leaves the local records alone', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1))] });
  const page = await openSettings({
    snapshot: current,
    confirmAnswers: [true, false],
    reply: (command) => (command.type === 'snapshot.raw' ? { ok: false, message: 'gone' } : { ok: true }),
  });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(2))] })), 'replace');
  page.state.snapshot = { ok: false, message: 'Could not read local records.' };
  await page.element('confirm-import').click();
  await settle();
  assert.equal(page.commands.some(({ type }) => type === 'backup.import'), false);
  assert.equal(page.status(), 'Import cancelled. Nothing was changed.');
});

test('a refused import says so without claiming anything was imported', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1))] });
  const page = await openSettings({
    snapshot: current,
    reply: () => ({ ok: false, message: 'Local data changed. Preview the import again.' }),
  });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(1)), lot(uuid(2))] })));
  await page.element('confirm-import').click();
  await settle();
  assert.equal(page.status(), 'Local data changed. Preview the import again.');
  assert.equal(page.statusIsError(), 'true');
  assert.equal(page.element('import-preview').hidden, true);
});

// --- set-aside records --------------------------------------------------------------------------

const SET_ASIDE = [
  { collection: 'lots', record: { id: uuid(5) }, reason: 'invalid-enum', quarantinedAt: NOW },
  {
    collection: 'auctionEvents', record: null, reason: 'missing-record', quarantinedAt: LATER,
    clearedReferences: [{ collection: 'lots', id: uuid(6), field: 'auctionEventId', value: uuid(7) }],
  },
];

test('the set-aside card stays out of the way until there is something in it', async () => {
  const page = await openSettings();
  assert.equal(page.element('data-health').hidden, true);
  assert.equal(page.element('quarantine-list').children.length, 0);
});

test('every set-aside record with a record to put back gets a Restore button of its own', async () => {
  const page = await openSettings({ snapshot: snapshotWith({ quarantine: SET_ASIDE }) });
  assert.equal(page.element('data-health').hidden, false);
  assert.equal(page.element('quarantine-summary').textContent, backup.quarantineSummaryText(SET_ASIDE));

  const rows = page.element('quarantine-list').children;
  assert.deepEqual(rows.map((row) => row.querySelector('span').textContent),
    backup.quarantineRows(SET_ASIDE).map(({ line }) => line));
  assert.deepEqual(rows.map((row) => row.querySelector('button')?.textContent), ['Restore', undefined],
    'an entry holding only cleared links has no record to put back');
  // Every row carries a button of this name, so the line beside it is what tells them apart.
  const [first] = rows;
  assert.equal(first.querySelector('button').getAttribute('aria-describedby'),
    first.querySelector('span').id);
});

test('Restore names its own entry, says what the store answered, and reads the list again', async () => {
  const restored = { collection: 'lots', id: uuid(5), restoredReferences: [], keptReferences: [] };
  const page = await openSettings({
    snapshot: snapshotWith({ quarantine: SET_ASIDE }),
    reply: (command, state) => {
      state.snapshot = { ok: true, value: snapshotWith({ quarantine: [SET_ASIDE[1]] }) };
      return { ok: true, value: restored };
    },
  });
  await page.element('quarantine-list').children[0].querySelector('button').click();
  await settle();

  assert.deepEqual(page.commands.map(({ type, entryId }) => [type, entryId]),
    [['quarantine.restore', quarantineEntryId(SET_ASIDE[0])]]);
  assert.equal(page.status(), backup.quarantineRestoreText(restored));
  assert.equal(page.element('quarantine-list').children.length, 1, 'the list is read again after the write');
});

test('a Restore the store refuses says so and offers the button again', async () => {
  const page = await openSettings({
    snapshot: snapshotWith({ quarantine: SET_ASIDE }),
    reply: () => ({ ok: false, message: 'That record could not be put back.' }),
  });
  const button = page.element('quarantine-list').children[0].querySelector('button');
  await button.click();
  await settle();
  assert.equal(page.status(), 'That record could not be put back.');
  assert.equal(page.statusIsError(), 'true');
  assert.equal(button.disabled, false);
});

// Typing a preset and putting a set-aside record back are two separate jobs on one page: the second
// reads the list again and leaves every field the collector has not saved exactly as it was typed.
async function typeUnsavedSettings(page) {
  await page.element('add-premium').click();
  const rows = page.document.querySelectorAll('.premium-row');
  rows[1].querySelector('.premium-name').value = 'Leu Numismatik';
  rows[1].querySelector('.premium-value').value = '18.5';
  rows[0].querySelector('.premium-value').value = '22';
  page.element('currency').value = 'CHF';
  page.element('theme').value = 'dark';
}

const unsavedSettingsOf = (page) => ({
  currency: page.element('currency').value,
  theme: page.element('theme').value,
  rows: page.document.querySelectorAll('.premium-row').map((row) => [
    row.querySelector('.premium-name').value, row.querySelector('.premium-value').value,
  ]),
});

const TYPED = { currency: 'CHF', theme: 'dark', rows: [['Roma', '22'], ['Leu Numismatik', '18.5']] };

test('Restore reads the set-aside list again and keeps every setting not yet saved', async () => {
  const roma = [{ name: 'Roma', buyerPremiumBps: 2000 }];
  const restored = { collection: 'lots', id: uuid(5), restoredReferences: [], keptReferences: [] };
  const page = await openSettings({
    snapshot: snapshotWith({ quarantine: SET_ASIDE, preferences: preferences({ housePremiumPresets: roma }) }),
    reply: (command, state) => {
      if (command.type === 'preferences.save') return { ok: true, value: preferences({ revision: 4 }) };
      state.snapshot = { ok: true, value: snapshotWith({ quarantine: [SET_ASIDE[1]], preferences: preferences({ housePremiumPresets: roma }) }) };
      return { ok: true, value: restored };
    },
  });
  await typeUnsavedSettings(page);
  await page.element('quarantine-list').children[0].querySelector('button').click();
  await settle();

  assert.equal(page.status(), backup.quarantineRestoreText(restored));
  assert.equal(page.element('quarantine-list').children.length, 1, 'the list is read again');
  assert.deepEqual(unsavedSettingsOf(page), TYPED, 'nothing typed is redrawn away');
  await page.element('save-settings').click();
  await settle();
  const saved = page.commands.at(-1);
  assert.equal(saved.type, 'preferences.save');
  assert.equal(saved.expectedRevision, 3);
  assert.equal(saved.preferences.currency, 'CHF');
  assert.deepEqual(saved.preferences.housePremiumPresets,
    [{ name: 'Roma', buyerPremiumBps: 2200 }, { name: 'Leu Numismatik', buyerPremiumBps: 1850 }]);
});

// The revision the page saves against moves only when the settings it drew are still the settings
// stored: another view's new presets are not overwritten by a page that never showed them.
test('after Restore the page saves against a newer revision only when the stored settings are unchanged', async () => {
  const roma = [{ name: 'Roma', buyerPremiumBps: 2000 }];
  for (const [elsewhere, expectedRevision] of [
    [{ desktopAlertsEnabled: true }, 4],
    [{ housePremiumPresets: [{ name: 'Nomos', buyerPremiumBps: 1800 }] }, 3],
  ]) {
    const page = await openSettings({
      snapshot: snapshotWith({ quarantine: SET_ASIDE, preferences: preferences({ housePremiumPresets: roma }) }),
      reply: (command, state) => {
        if (command.type === 'preferences.save') return { ok: true, value: preferences({ revision: 5 }) };
        state.snapshot = { ok: true, value: snapshotWith({ preferences: preferences({ revision: 4, housePremiumPresets: roma, ...elsewhere }) }) };
        return { ok: true, value: { collection: 'lots', id: uuid(5), restoredReferences: [], keptReferences: [] } };
      },
    });
    await page.element('quarantine-list').children[0].querySelector('button').click();
    await settle();
    await page.element('save-settings').click();
    await settle();
    assert.equal(page.commands.at(-1).expectedRevision, expectedRevision, JSON.stringify(elsewhere));
  }
});

test('an import confirmed over unsaved settings keeps them and says the imported ones are not shown', async () => {
  const stored = new Map();
  const current = snapshotWith({ lots: [lot(uuid(1))], preferences: preferences({ housePremiumPresets: [{ name: 'Roma', buyerPremiumBps: 2000 }] }) });
  const page = await openSettings({
    stored,
    snapshot: current,
    reply: (command, state) => {
      state.snapshot = { ok: true, value: snapshotWith({
        lots: [lot(uuid(1)), lot(uuid(2))], quarantine: [SET_ASIDE[1]],
        preferences: preferences({ revision: 1, currency: 'GBP', housePremiumPresets: [{ name: 'Imported', buyerPremiumBps: 1500 }] }),
      }) };
      return { ok: true };
    },
  });
  await typeUnsavedSettings(page);
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(1)), lot(uuid(2))] })));
  await page.element('confirm-import').click();
  await settle();

  assert.deepEqual(unsavedSettingsOf(page), TYPED, 'the typed settings are still on the page');
  assert.match(page.status(), /^Backup imported\. .*not saved.*reload this page/i);
  assert.equal(page.element('quarantine-list').children.length, 1, 'the set-aside list follows the import');
  assert.equal(JSON.parse(stored.get(GIGA_PREFERENCES_KEY)).currency, 'GBP', 'the popup prices in the imported default');
});

// A backup's preferences can carry the very revision the page holds, so the store alone cannot
// tell a Save from this page apart from one made after seeing the imported settings.
test('after an import kept unsaved settings over imported ones, Save refuses rather than overwrite them', async () => {
  const imported = [{ name: 'Imported', buyerPremiumBps: 1500 }];
  const page = await openSettings({
    snapshot: snapshotWith({ lots: [lot(uuid(1))], preferences: preferences({ housePremiumPresets: [{ name: 'Roma', buyerPremiumBps: 2000 }] }) }),
    reply: (command, state) => {
      if (command.type === 'preferences.save') return { ok: true, value: preferences({ revision: 4 }) };
      state.snapshot = { ok: true, value: snapshotWith({ preferences: preferences({ revision: 3, currency: 'GBP', housePremiumPresets: imported }) }) };
      return { ok: true };
    },
  });
  await typeUnsavedSettings(page);
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(1)), lot(uuid(2))] })), 'replace');
  await page.element('confirm-import').click();
  await settle();
  await page.element('save-settings').click();
  await settle();

  assert.equal(page.commands.some(({ type }) => type === 'preferences.save'), false, 'the imported presets are not overwritten');
  assert.match(page.status(), /not saved.*note what you typed, then reload this page to see the imported settings/i);
  assert.equal(page.statusIsError(), 'true');
  assert.deepEqual(unsavedSettingsOf(page), TYPED, 'what was typed stays on the page');
  assert.equal(page.element('save-settings').disabled, false);
});

test('an import confirmed with nothing unsaved redraws the page from the imported settings', async () => {
  const page = await openSettings({
    snapshot: snapshotWith({ lots: [lot(uuid(1))], preferences: preferences({ housePremiumPresets: [{ name: 'Roma', buyerPremiumBps: 2000 }] }) }),
    reply: (command, state) => {
      state.snapshot = { ok: true, value: snapshotWith({
        preferences: preferences({ revision: 1, currency: 'GBP', housePremiumPresets: [{ name: 'Imported', buyerPremiumBps: 1500 }] }),
      }) };
      return { ok: true };
    },
  });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(1)), lot(uuid(2))] })));
  await page.element('confirm-import').click();
  await settle();
  assert.equal(page.status(), 'Backup imported.');
  assert.deepEqual(unsavedSettingsOf(page), { currency: 'GBP', theme: '', rows: [['Imported', '15.00']] });
});

// A page whose first read failed drew no settings, so there is nothing typed to keep and the import
// is the chance to load it.
test('an import on a page that could not load its settings loads the page', async () => {
  const page = await openSettings({
    snapshotReply: { ok: false, message: 'Worker asleep.' },
    reply: (command, state) => {
      state.snapshot = { ok: true, value: snapshotWith({ preferences: preferences({ revision: 1, currency: 'GBP' }) }) };
      return { ok: true };
    },
  });
  assert.equal(page.status(), 'Worker asleep.');
  assert.equal(page.element('save-settings').disabled, true);

  page.state.snapshot = { ok: true, value: snapshotWith({ lots: [lot(uuid(1))] }) };
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(1)), lot(uuid(2))] })));
  await page.element('confirm-import').click();
  await settle();
  assert.equal(page.status(), 'Backup imported.');
  assert.equal(page.statusIsError(), 'false');
  assert.equal(page.element('currency').value, 'GBP');
  assert.equal(page.element('save-settings').disabled, false);
});

test('the set-aside records can be taken out as a file of their own', async () => {
  const page = await openSettings({ snapshot: snapshotWith({ quarantine: SET_ASIDE }) });
  await page.element('download-quarantine').click();
  await settle();
  const [file] = page.downloads();
  assert.match(file.name, /^giga-pinax-set-aside-.*\.json$/);
  assert.deepEqual(JSON.parse(file.text).quarantine, SET_ASIDE);
  assert.equal(page.status(), 'Set-aside records exported.');
});

// --- exports --------------------------------------------------------------------------------------

test('Export raw data writes exactly what storage holds, unvalidated, as a rescue file', async () => {
  const raw = { schemaVersion: SCHEMA_VERSION, drafts: [{ id: 'draft' }], nonsense: true };
  const page = await openSettings({
    reply: (command) => (command.type === 'snapshot.raw' ? { ok: true, value: raw } : { ok: false }),
  });
  await page.element('export-raw').click();
  await settle();

  assert.deepEqual(page.commands.map(({ type }) => type), ['snapshot.raw']);
  const [file] = page.downloads();
  assert.match(file.name, /^giga-pinax-raw-.*\.json$/);
  const written = JSON.parse(file.text);
  assert.equal(written.kind, 'raw-rescue');
  assert.deepEqual(written.data, raw, 'the rescue file strips nothing');
  assert.equal(page.status(), 'Raw data exported.');
});

test('a rescue export that storage cannot answer says so and writes no file', async () => {
  const page = await openSettings({ reply: () => ({ ok: false, message: 'Could not read local storage.' }) });
  await page.element('export-raw').click();
  await settle();
  assert.deepEqual(page.downloads(), []);
  assert.equal(page.status(), 'Could not read local storage.');
  assert.equal(page.statusIsError(), 'true');
});

test('Export backup writes an importable file of the current records', async () => {
  const page = await openSettings({ snapshot: snapshotWith({ lots: [lot(uuid(1))] }) });
  await page.element('export-backup').click();
  await settle();
  const [file] = page.downloads();
  assert.match(file.name, /^giga-pinax-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(backup.validateBackup(file.text).ok, true);
  assert.equal(page.status(), 'Backup exported.');
});

// --- VAT on premium and platform fee in stored records ---------------------------------------------

const OLD_ESTIMATE = { currency: 'EUR', shippingMinor: 1500, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1000, minimumBidMinor: 0 };

// Both charges are optional keys a preset and a lot's estimate may carry; a backup written before they
// existed has neither, and imports as it always did.
test('a backup from before VAT on premium and platform fees still validates, previews and imports', async () => {
  const old = snapshotWith({
    preferences: preferences({ housePremiumPresets: [{ name: 'Roma', buyerPremiumBps: 2000, incrementLadder: { currency: 'GBP', tiers: [{ from: 0, step: 500 }] } }] }),
    lots: [lot(uuid(2), { costEstimate: OLD_ESTIMATE })],
  });
  const documentText = backupDocument(old);
  assert.doesNotMatch(documentText, /premiumVatBps|platformFeeBps/);
  const validated = backup.validateBackup(documentText);
  assert.equal(validated.ok, true, validated.error?.message);
  assert.deepEqual(validated.value.lots[0].costEstimate, OLD_ESTIMATE);
  const page = await openSettings({ snapshot: snapshotWith(), reply: () => ({ ok: true }) });
  await preview(page, documentText);
  assert.equal(page.element('confirm-import').disabled, false);
  await page.element('confirm-import').click();
  await settle();
  const sent = page.commands.filter(({ type }) => type === 'backup.import');
  assert.equal(sent.length, 1);
  assert.equal(page.status(), 'Backup imported.');
});

test('a preset and an estimate carry VAT on premium and a platform fee from 0 to 100 %, and nothing else', () => {
  const withCharges = (presetCharges, estimateCharges) => snapshotWith({
    preferences: preferences({ housePremiumPresets: [{ name: 'Künker', buyerPremiumBps: 2500, ...presetCharges }] }),
    lots: [lot(uuid(3), { costEstimate: { ...OLD_ESTIMATE, ...estimateCharges } })],
  });
  const good = withCharges({ premiumVatBps: 1900, platformFeeBps: 0 }, { premiumVatBps: 1900, platformFeeBps: 300 });
  assert.equal(validateSnapshot(good).ok, true);
  assert.equal(backup.validateBackup(backupDocument(good)).ok, true);
  for (const bad of [-1, 10001, 19.5, '1900', null]) {
    for (const key of ['premiumVatBps', 'platformFeeBps']) {
      assert.equal(validateSnapshot(withCharges({ [key]: bad }, {})).error?.path, `preferences.housePremiumPresets[0].${key}`, `preset ${key} ${bad}`);
      assert.equal(validateSnapshot(withCharges({}, { [key]: bad })).error?.path, `lots[0].costEstimate.${key}`, `estimate ${key} ${bad}`);
    }
  }
});

// --- CSV export ----------------------------------------------------------------------------------

test('Export CSV offers every table and downloads the chosen one as a UTF-8 CSV file', async () => {
  const snapshot = snapshotWith({ lots: [lot(uuid(1), { title: '=Hadrian, "denarius"' })] });
  const page = await openSettings({ snapshot });
  const choices = page.element('csv-table').querySelectorAll('option');
  assert.deepEqual(choices.map((option) => option.value), csv.CSV_TABLES.map(({ key }) => key));
  assert.deepEqual(choices.map((option) => option.textContent), csv.CSV_TABLES.map(({ label }) => label));

  await page.element('export-csv').click();
  await settle();
  const [file] = page.downloads();
  assert.match(file.name, /^giga-pinax-lots-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(file.type, 'text/csv;charset=utf-8');
  assert.equal(file.text, csv.csvFiles(snapshot).lots);
  assert.equal(page.status(), 'Watchlist lots exported as CSV.');
  assert.equal(page.statusIsError(), 'false');
});

test('Export CSV writes the table chosen in the list, one file per click', async () => {
  const snapshot = snapshotWith({ lots: [lot(uuid(1), {
    bidHistory: [{ id: uuid(9), action: 'planned-revised', amount: { currency: 'EUR', minor: 1000 }, recordedAt: NOW }],
    plannedBid: { amount: { currency: 'EUR', minor: 1000 } },
  })] });
  const page = await openSettings({ snapshot });
  page.element('csv-table').value = 'bids';
  await page.element('export-csv').click();
  await settle();
  page.element('csv-table').value = 'outcomes';
  await page.element('export-csv').click();
  await settle();
  const files = page.downloads();
  assert.deepEqual(files.map(({ name }) => name.replace(/-\d{4}-\d{2}-\d{2}/, '')), ['giga-pinax-bids.csv', 'giga-pinax-outcomes.csv']);
  assert.equal(files[0].text, csv.csvFiles(snapshot).bids);
  assert.equal(page.status(), 'Outcome history exported as CSV.');
});

test('a CSV export that cannot read the records says so and writes no file', async () => {
  const page = await openSettings({ snapshotReply: { ok: false, message: 'Could not read local records.' } });
  await page.element('export-csv').click();
  await settle();
  assert.deepEqual(page.downloads(), []);
  assert.equal(page.status(), 'Could not read local records.');
  assert.equal(page.statusIsError(), 'true');
});

// --- diagnostics ----------------------------------------------------------------------------------

const DIAGNOSTIC_ENTRIES = [
  { at: '2026-09-20T08:00:00.000Z', page: 'popup', area: 'acsearch', code: 'http', status: 503, version: '0.32.1' },
  { at: '2026-09-21T09:30:00.000Z', page: 'background', area: 'store', code: 'storage', version: '0.32.1' },
];

test('the Diagnostics card says how many failures are kept, and copies them as plain text', async () => {
  const page = await openSettings({ diagnosticsStored: { [diagnostics.DIAGNOSTICS_KEY]: DIAGNOSTIC_ENTRIES } });
  assert.equal(page.element('diagnostics-count').textContent, '2 failures recorded on this device.');
  assert.match(page.element('diagnostics').textContent, /catalogue lookup, specimen photos, acsearch/);
  await page.element('copy-diagnostics').click();
  await settle();
  assert.equal(page.copied.length, 1);
  const [text] = page.copied;
  assert.match(text, /^Giga Pinax diagnostics\nVersion: 0\.32\.1\nCopied: \d{4}-\d{2}-\d{2}T[\d:.]+Z\n/);
  assert.ok(text.endsWith([
    'Failures recorded: 2 (oldest first, at most 50 kept)',
    '2026-09-20T08:00:00.000Z popup acsearch http 503 (0.32.1)',
    '2026-09-21T09:30:00.000Z background local records storage (0.32.1)',
    '',
  ].join('\n')), text);
  assert.equal(page.status(), 'Diagnostics copied.');
  assert.equal(page.statusIsError(), 'false');
});

test('with nothing recorded the card says so, and a copy still says so in words', async () => {
  const page = await openSettings();
  assert.equal(page.element('diagnostics-count').textContent, 'No failures recorded.');
  await page.element('copy-diagnostics').click();
  await settle();
  assert.match(page.copied[0], /No failures recorded\.\n$/);
});

test('a clipboard that refuses the copy is reported, and nothing claims it worked', async () => {
  const page = await openSettings({
    diagnosticsStored: { [diagnostics.DIAGNOSTICS_KEY]: DIAGNOSTIC_ENTRIES },
    clipboard: { writeText: async () => { throw new Error('Document is not focused.'); } },
  });
  await page.element('copy-diagnostics').click();
  await settle();
  assert.equal(page.status(), 'The diagnostics could not be copied. Click Copy diagnostics again with this page in front.');
  assert.equal(page.statusIsError(), 'true');
});

test('Clear empties the diagnostics and says so', async () => {
  const page = await openSettings({ diagnosticsStored: { [diagnostics.DIAGNOSTICS_KEY]: DIAGNOSTIC_ENTRIES } });
  await page.element('clear-diagnostics').click();
  await settle();
  assert.deepEqual(page.diagnosticsStored[diagnostics.DIAGNOSTICS_KEY], []);
  assert.equal(page.element('diagnostics-count').textContent, 'No failures recorded.');
  assert.equal(page.status(), 'Diagnostics cleared.');
  assert.equal(page.element('clear-diagnostics').getAttribute('aria-label'), 'Clear diagnostics');
});

test('the diagnostics are never written into an exported backup', async () => {
  const page = await openSettings({ diagnosticsStored: { [diagnostics.DIAGNOSTICS_KEY]: DIAGNOSTIC_ENTRIES } });
  await page.element('export-backup').click();
  await settle();
  const [file] = page.downloads();
  assert.ok(!file.text.includes('acsearch') && !file.text.includes('diagnostics'));
});

// --- the Updates card ---------------------------------------------------------------------------

// A store writes update_url into the manifest it serves and keeps the extension up to date itself,
// so the card — whose link hands out a ZIP to install by hand — has nothing to tell that collector.
test('the Updates card is hidden for a store install and shown for one that updates by hand', async () => {
  const store = await openSettings({ manifest: { version: '0.32.1', update_url: 'https://clients2.google.com/service/update2/crx' } });
  assert.equal(store.element('updates').hidden, true);

  const sideloaded = await openSettings({ manifest: { version: '0.32.1' } });
  assert.equal(sideloaded.element('updates').hidden, false);
  assert.equal(sideloaded.element('updates-version').textContent, 'Installed version 0.32.1');
  assert.equal(sideloaded.element('updates-browser').textContent, 'Chrome or Brave');
  assert.match(sideloaded.element('updates-download').getAttribute('href'), /giga-pinax-brave\.zip$/);

  const firefox = await openSettings({ manifest: { version: '0.32.1', browser_specific_settings: { gecko: {} } } });
  assert.equal(firefox.element('updates-browser').textContent, 'Firefox');
  assert.match(firefox.element('updates-download').getAttribute('href'), /giga-pinax-firefox\.zip$/);
});

// A signed Firefox build names its own update manifest, and Firefox keeps an installed XPI up to date from it; the
// same build loaded as a temporary add-on is never updated, and the browser says which it is.
test('the Updates card is hidden for a signed Firefox install and shown for the same build loaded temporarily', async () => {
  const manifest = {
    version: '0.34.0',
    browser_specific_settings: { gecko: { id: 'giga-pinax@local.invalid', update_url: 'https://bth0mp.github.io/Giga-Pinax/firefox/updates.json' } },
  };
  const signed = await openSettings({ manifest, getSelf: async () => ({ installType: 'normal' }) });
  assert.equal(signed.element('updates').hidden, true);

  const temporary = await openSettings({ manifest, getSelf: async () => ({ installType: 'development' }) });
  assert.equal(temporary.element('updates').hidden, false);
  assert.equal(temporary.element('updates-browser').textContent, 'Firefox');

  // A browser that cannot say keeps the card: an update the collector would otherwise miss is what is at stake.
  const unknown = await openSettings({ manifest, getSelf: async () => { throw new Error('no management API'); } });
  assert.equal(unknown.element('updates').hidden, false);
  const missing = await openSettings({ manifest });
  assert.equal(missing.element('updates').hidden, false);
});

// --- the bundled-data panel ------------------------------------------------------------------------

// The panel is a set of claims about what the package carries, so each one is checked against the package.
const dataRoot = new URL('../extension/data/', import.meta.url);
// The corpus directories, without the two files extension/data holds for all of them at once.
const bundledCorpora = () => readdirSync(dataRoot).filter((name) => !name.includes('.')).sort();
const corpusMetadata = (corpus) => JSON.parse(readFileSync(new URL(`${corpus}/metadata.json`, dataRoot), 'utf8'));

// These two read the bundle itself, so they skip where extension/data is not checked out.
test('the bundled-data panel names every corpus the package carries, and only those', { skip }, async () => {
  const bundled = bundledCorpora();
  assert.deepEqual(Object.keys(LOCAL_CORPORA).sort(), bundled);
  const page = await openSettings({ catalogueMetadata: async (corpus) => corpusMetadata(corpus) });

  // One table row per corpus, each built from that corpus's own metadata rather than from a sentence written here:
  // the bundle, its type counts and what it leaves out, the day its local files were made, and its source and licence.
  const rows = page.element('catalogue-list').children;
  assert.deepEqual(rows.map((row) => row.querySelector('th').textContent), Object.keys(LOCAL_CORPORA).map((corpus) => LOCAL_CORPORA[corpus].label));
  const count = (value) => new Intl.NumberFormat('en-GB').format(value);
  for (const [index, corpus] of Object.keys(LOCAL_CORPORA).entries()) {
    const metadata = corpusMetadata(corpus);
    const [types, files, links] = rows[index].querySelectorAll('td');
    assert.equal(types.querySelector('span').textContent, `${count(metadata.activeRecordCount)} active of ${count(metadata.recordCount)}`, corpus);
    assert.equal(types.querySelector('small')?.textContent,
      metadata.excluded ? `Leaving out ${count(metadata.excluded.count)}: ${metadata.excluded.reason}.` : undefined, corpus);
    assert.equal(files.querySelector('span').textContent, new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${metadata.generatedOn}T00:00:00Z`)), corpus);
    assert.deepEqual(links.querySelectorAll('a').map((link) => link.textContent), ['Source', 'Licence'], corpus);
    // Each link says whose source and licence it is, since every row has one of each.
    assert.deepEqual(links.querySelectorAll('a').map((link) => link.getAttribute('aria-label')),
      [`${LOCAL_CORPORA[corpus].label} source`, `${LOCAL_CORPORA[corpus].label} licence`], corpus);
  }

  // The sentence beside the rows says which references are answered locally and which still go online. Bopearachchi
  // is not bundled — BIGR's export carries no Bopearachchi citation to verify a hit against — so it must be named as
  // online, and it must not be listed as a corpus the package carries.
  const panel = page.element('catalogue-data').textContent;
  assert.match(panel, /RIC, Crawford, Price, Seleucid Coins, CPE and Newell \(Demetrius Poliorcetes\) lookups use this local data\./);
  assert.match(panel, /Bopearachchi references and any lookup the local data cannot answer go online/);
  // The names travel with the package now, so the panel says so — and says what it still cannot name. It must not go
  // back to claiming a local card shows nothing but identifiers, and it must not claim every concept has a name.
  assert.match(panel, /English Nomisma\.org names for every authority, denomination, mint, material and portrait/);
  assert.match(panel, /CC BY 3\.0/);
  assert.match(panel, /shows as the identifier the record carries, and none is ever guessed/);
  // Every name the panel promises is really in the file beside the records.
  const labels = JSON.parse(readFileSync(new URL('nomisma-labels.json', dataRoot), 'utf8'));
  assert.equal(labels.schemaVersion, 1);
  assert.ok(Object.keys(labels.labels).length > 1000);
  assert.match(readFileSync(new URL('NOTICE.txt', dataRoot), 'utf8'), /Creative Commons Attribution 3\.0/);
  assert.equal(bundled.includes('bigr'), false);
  assert.equal(page.element('catalogue-coverage'), null, 'no hand-written coverage claim beside the rows');
});

test('a corpus whose files cannot be read keeps its row and says so', async () => {
  const page = await openSettings({ catalogueMetadata: async () => null });
  const rows = page.element('catalogue-list').children;
  assert.equal(rows.length, Object.keys(LOCAL_CORPORA).length);
  for (const row of rows) {
    assert.equal(row.querySelectorAll('td').at(-1).textContent, 'Local catalogue unavailable.');
    assert.deepEqual(row.querySelectorAll('a'), []);
  }
});

test('each panel row reports the counts and the date its own corpus metadata carries', { skip }, () => {
  for (const corpus of bundledCorpora()) {
    const metadata = corpusMetadata(corpus);
    const line = catalogueMetadataText(metadata);
    assert.match(line, new RegExp(`${LOCAL_CORPORA[corpus].label} records`), corpus);
    assert.match(line, /Local files generated \d+ \w+ \d{4}\./, corpus);
    // A corpus bundled in part says how much it leaves out; one bundled whole makes no such claim.
    assert.equal(/leaving out/.test(line), Object.hasOwn(metadata, 'excluded'), corpus);
    assert.ok(metadata.sourceUrl.startsWith('https://'), corpus);
  }
});

// --- the safety-copy sequence, on its own ---------------------------------------------------------

const COPY = { text: '{"copy":true}', name: 'giga-pinax-before-import-2026-09-12T12-00-00.000Z.json' };
const RAW = { text: '{"raw":true}', name: 'giga-pinax-raw-2026-09-12T12-00-00.000Z.json' };

function harness(overrides = {}) {
  const calls = [];
  const prompts = [];
  const deps = {
    exportCopy: async () => { calls.push('exportCopy'); return COPY; },
    exportRaw: async () => { calls.push('exportRaw'); return RAW; },
    download: (text, name) => { calls.push(`download:${name}`); },
    confirm: (message) => { calls.push('confirm'); prompts.push(message); return true; },
    send: async () => { calls.push('send'); return { ok: true }; },
    ...overrides,
  };
  return { calls, prompts, deps };
}

test('the safety copy reaches the browser before the command that overwrites it', async () => {
  const { calls, deps } = harness();
  const result = await backup.importWithSafetyCopy(deps);
  assert.deepEqual(calls, ['exportCopy', `download:${COPY.name}`, 'send']);
  assert.equal(result.sent, true);
  assert.equal(result.copied, COPY.name);
  assert.deepEqual(result.reply, { ok: true });
});

test('a copy that cannot be made falls back to the raw export and a second confirmation', async () => {
  const { calls, prompts, deps } = harness({
    exportCopy: async () => { calls.push('exportCopy'); throw new Error('Could not read local records.'); },
  });
  const result = await backup.importWithSafetyCopy(deps);
  assert.deepEqual(calls, ['exportCopy', 'exportRaw', `download:${RAW.name}`, 'confirm', 'send']);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].includes('Could not read local records.'), true);
  assert.equal(prompts[0].includes(RAW.name), true);
  assert.equal(result.sent, true);
  assert.equal(result.copied, null);
});

test('declining the second confirmation aborts without sending anything', async () => {
  const { calls, deps } = harness({
    exportCopy: async () => { calls.push('exportCopy'); throw new Error('storage unavailable'); },
    confirm: () => { calls.push('confirm'); return false; },
  });
  const result = await backup.importWithSafetyCopy(deps);
  assert.equal(calls.includes('send'), false, 'nothing is overwritten once the collector declines');
  assert.equal(result.sent, false);
  assert.equal(result.reply, undefined);
});

test('a raw export that also fails still asks, and says the file could not be written', async () => {
  const { calls, prompts, deps } = harness({
    exportCopy: async () => { calls.push('exportCopy'); throw new Error('storage unavailable'); },
    exportRaw: async () => { calls.push('exportRaw'); throw new Error('storage unavailable'); },
  });
  const result = await backup.importWithSafetyCopy(deps);
  assert.deepEqual(calls, ['exportCopy', 'exportRaw', 'confirm', 'send']);
  assert.equal(prompts[0].includes('could not be downloaded either'), true);
  assert.equal(result.sent, true);
});

test('a download the browser refuses counts as a failed copy, not as a saved one', async () => {
  const { calls, deps } = harness({
    download: (text, name) => {
      calls.push(`download:${name}`);
      if (name === COPY.name) throw new Error('Download blocked.');
    },
  });
  const result = await backup.importWithSafetyCopy(deps);
  assert.deepEqual(
    calls,
    ['exportCopy', `download:${COPY.name}`, 'exportRaw', `download:${RAW.name}`, 'confirm', 'send'],
  );
  assert.equal(result.copied, null, 'no copy may be reported when the download threw');
});

test('a command that throws is handed back with the copy that did reach the browser', async () => {
  const { calls, deps } = harness({
    send: async () => { calls.push('send'); throw new Error('port closed'); },
  });
  const result = await backup.importWithSafetyCopy(deps);
  assert.deepEqual(calls, ['exportCopy', `download:${COPY.name}`, 'send']);
  assert.equal(result.copied, COPY.name, 'the page can still say which file it downloaded');
  assert.equal(result.error.message, 'port closed');
  assert.equal(result.reply, undefined);
});

test('a refused command is reported without claiming the import happened', async () => {
  const { deps } = harness({ send: async () => ({ ok: false, message: 'Local data changed.' }) });
  const result = await backup.importWithSafetyCopy(deps);
  assert.equal(result.sent, true);
  assert.equal(result.reply.ok, false);
  assert.equal(result.copied, COPY.name, 'the copy still reached disk and is still worth naming');
});

// Q-04: the usual import VAT for a sale in another currency than the default, off (blank) by default.
test('import VAT for a foreign sale is off until typed, saved as a rate, and cleared by blanking it', async () => {
  const page = await openSettings({
    snapshot: snapshotWith({ preferences: preferences({ importVatBps: 500 }) }),
    reply: (command) => ({ ok: true, value: preferences({ revision: 4, ...command.preferences }) }),
  });
  assert.equal(page.element('import-vat').value, '5.00');
  page.element('import-vat').value = '';
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.commands[0].preferences.importVatBps, null, 'blank turns it off');
  page.element('import-vat').value = 'twenty';
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.commands.length, 1, 'a rate that cannot be read saves nothing');
  assert.match(page.status(), /^Import VAT /);
  page.element('import-vat').value = '7';
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.commands[1].preferences.importVatBps, 700);
});

// G-25: opened from the popup, Settings has no page to return to, so its header link closes the tab; opened from the
// workspace, it offers the way back.
test('Settings opened from the popup offers Close, and from the workspace the way back', async () => {
  const fromPopup = await openSettings({});
  const link = fromPopup.element('settings-return');
  assert.equal(link.textContent, 'Close');
  await link.click(); await settle();
  assert.deepEqual(fromPopup.closedTabs, [7]);
  const fromWorkspace = await openSettings({ hash: '#from-workspace' });
  assert.equal(fromWorkspace.element('settings-return').textContent, 'Return to workspace');
  assert.equal(fromWorkspace.element('settings-return').getAttribute('href'), 'workspace.html#watchlist');
});

// --- More currencies (G-23 / Q-15) ------------------------------------------------------------------------------

test('the default bid currency offers every currency, and one prices are not researched in leaves the popup’s own', async () => {
  const stored = new Map();
  const page = await openSettings({
    stored,
    reply: (command) => ({ ok: true, value: preferences({ revision: 4, currency: command.preferences.currency }) }),
  });
  const options = page.element('currency').querySelectorAll('option').map((option) => option.value);
  assert.deepEqual(options, [...money.CURRENCIES]);
  page.element('currency').value = 'SEK';
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.commands[0].preferences.currency, 'SEK');
  assert.equal(JSON.parse(stored.get(GIGA_PREFERENCES_KEY)).currency, 'USD', 'the research popup keeps pricing in USD');
  assert.equal(page.status(), 'Settings saved.');
  // Each house's ladder currency offers them too.
  await page.element('add-premium').click();
  const ladderCurrency = page.document.querySelector('.premium-ladder-currency');
  assert.deepEqual(ladderCurrency.querySelectorAll('option').map((option) => option.value), [...money.CURRENCIES]);
});

test('a yen ladder is drawn in whole yen and saves unchanged in every locale', async () => {
  const saved = { name: 'Taisei', buyerPremiumBps: 1500, incrementLadder: { currency: 'JPY', tiers: [{ from: 0, step: 1000 }, { from: 100000, step: 5000 }] } };
  for (const language of ['ar-EG', 'de-DE', 'ja-JP', 'en-US']) {
    const page = await openSettings({
      language,
      snapshot: snapshotWith({ preferences: preferences({ currency: 'JPY', housePremiumPresets: [saved] }) }),
      reply: () => ({ ok: true, value: preferences({ revision: 4, currency: 'JPY', housePremiumPresets: [saved] }) }),
    });
    assert.equal(page.element('currency').value, 'JPY', language);
    const row = page.document.querySelector('.premium-row');
    assert.equal(row.querySelector('.premium-ladder').value, '0: 1000\n100000: 5000', language);
    assert.equal(row.querySelector('.premium-ladder-currency').value, 'JPY');
    await page.element('save-settings').click();
    assert.equal(page.commands.length, 1, language);
    assert.deepEqual(page.commands[0].preferences.housePremiumPresets, [saved], language);
    assert.equal(page.commands[0].preferences.currency, 'JPY');
  }
});

// The page draws the saved house rows only once the worker answers, and drawing them replaces the list: a house added
// or a field typed before then would be wiped. So nothing that edits the settings works until they have loaded.
test('the settings cannot be edited before they have loaded, and can once they have', async () => {
  const EDITORS = ['currency', 'import-vat', 'add-premium', 'copy-presets', 'paste-presets'];
  const failed = await openSettings({ snapshotReply: { ok: false, message: 'Worker asleep.' } });
  for (const id of EDITORS) assert.equal(failed.element(id).disabled, true, `${id} waits for the settings`);
  const loaded = await openSettings({});
  for (const id of EDITORS) assert.equal(loaded.element(id).disabled, false, `${id} works once they have loaded`);
});

// H-02 (cycle 5): the theme and the photos switch live in this page's local storage, not with the worker, so they are
// drawn at once and a late answer from the worker never puts them back. What was chosen before it answered stands,
// and counts as a change to save.
test('a theme and the photos switch chosen before the settings load are kept when they load', async () => {
  let answer;
  const late = new Promise((resolve) => { answer = resolve; });
  const stored = new Map([['giga-pinax-theme-v1', 'light']]);
  const page = loadSettings({ stored, snapshotReply: late, reply: () => ({ ok: true, value: preferences({ revision: 4 }) }) });
  await settle();
  assert.equal(page.element('theme').value, 'light', 'drawn from local storage before the worker answers');
  assert.equal(page.element('theme').disabled, false);
  assert.equal(page.element('specimen-photos').disabled, false);
  page.element('theme').value = 'dark';
  page.element('specimen-photos').checked = true;
  answer({ ok: true, value: snapshotWith() });
  await settle(); await settle();
  assert.equal(page.element('save-settings').disabled, false, 'the settings have loaded');
  assert.equal(page.element('theme').value, 'dark');
  assert.equal(page.element('specimen-photos').checked, true);
  await page.element('save-settings').click();
  await settle();
  assert.equal(page.stored.get('giga-pinax-theme-v1'), 'dark');
  assert.equal(page.stored.get('giga-pinax-specimen-photos-v1'), 'on');
});

// H-12 (cycle 5, Settings part): one filled button per form. Save settings is the page's action, and Confirm import the
// import preview's; Export backup and the update link are secondary, as every other action on the page is.
test('Settings fills only its Save settings and Confirm import buttons', () => {
  const markup = parseHtmlFile(new URL('../extension/settings.html', import.meta.url));
  const quiet = ['secondary', 'quiet', 'danger', 'text-button'];
  const filled = [...markup.querySelectorAll('button'), ...markup.querySelectorAll('a.button')]
    .filter((control) => !quiet.some((kind) => String(control.getAttribute('class') ?? '').split(/\s+/).includes(kind)))
    .map((control) => control.id);
  assert.deepEqual(filled.sort(), ['confirm-import', 'save-settings']);
});

// H-09 (cycle 5): Settings says buyer's premium, as the calculator and the workspace do.
test('Settings names the buyer’s premium in the glossary’s words', async () => {
  const page = await openSettings({ snapshot: snapshotWith({ preferences: preferences({ housePremiumPresets: [{ name: 'Roma', buyerPremiumBps: 2000 }] }) }) });
  const html = readFileSync(new URL('../extension/settings.html', import.meta.url), 'utf8');
  assert.match(html, /Each house’s buyer’s premium/);
  assert.doesNotMatch(html, /buyer premium/i);
  const captions = [...page.document.querySelectorAll('span')].map((span) => span.textContent);
  assert.ok(captions.some((caption) => caption.startsWith('Buyer’s premium %')), JSON.stringify(captions));
});

// --- X-02: records nothing can read ------------------------------------------------------------------

const UNREADABLE = { ok: false, code: 'storage', outcome: 'not-committed', message: 'Stored data is invalid: Expected an object.', reason: 'unreadable' };
// A store whose records cannot be read: every read says so, the rescue copy answers with what storage holds at
// revision 41, and a reset or a Replace import brings a readable root back.
function unreadableStore(extra = () => null) {
  return (command, state) => {
    const answered = extra(command, state);
    if (answered) return answered;
    if (command.type === 'snapshot.raw') return { ok: true, requestId: command.requestId, revision: 41, value: 'not a root' };
    if (command.type === 'store.reset' || command.type === 'backup.import') {
      state.snapshot = { ok: true, value: snapshotWith() };
      return { ok: true, requestId: command.requestId, revision: 42, value: command.type === 'store.reset' ? { reset: true } : { mode: 'replace' } };
    }
    return UNREADABLE;
  };
}

test('X-02: Settings over unreadable records puts the ways out at the top, not at the foot', async () => {
  const page = await openSettings({ snapshotReply: UNREADABLE, reply: unreadableStore() });
  const notice = page.element('store-recovery');
  assert.ok(notice, 'the notice is drawn');
  assert.equal(page.document.querySelector('main').children[0], notice, 'first in the page');
  assert.equal(notice.getAttribute('role'), 'alert');
  assert.equal(page.element('store-recovery-title').textContent, 'Your records can’t be read');
  assert.match(notice.textContent, /They are damaged\. Nothing has been changed\./);
  assert.equal(page.element('store-recovery-download').textContent, 'Download the stored data');
  assert.equal(page.element('store-recovery-reset').textContent, 'Start fresh, keeping a copy');
  assert.match(notice.textContent, /import a backup below, under Backup and import, with Replace local records/);
  assert.equal(page.status(), 'Your records can’t be read. The notice at the top of this page has the ways out.');
});

test('X-02: a newer version’s records say so', async () => {
  const page = await openSettings({ snapshotReply: { ...UNREADABLE, newerVersion: true }, reply: unreadableStore() });
  assert.match(page.element('store-recovery').textContent, /written by a newer version of Giga Pinax/);
});

test('X-02: Download the stored data hands the rescue file to the browser and changes nothing', async () => {
  const page = await openSettings({ snapshotReply: UNREADABLE, reply: unreadableStore() });
  await page.element('store-recovery-download').click();
  await settle();
  const [file] = page.downloads();
  assert.match(file.name, /^giga-pinax-raw-.*\.json$/);
  assert.equal(JSON.parse(file.text).data, 'not a root');
  assert.deepEqual(page.commands.map(({ type }) => type).filter((type) => type !== 'snapshot.get'), ['snapshot.raw']);
  assert.match(page.element('store-recovery-status').textContent, /^Download started: giga-pinax-raw-.*\. Keep it/);
});

test('X-02: Start fresh downloads the rescue file first, asks, resets at its revision, and loads again', async () => {
  const order = [];
  const page = await openSettings({
    snapshotReply: UNREADABLE,
    reply: unreadableStore((command) => { order.push(command.type); return null; }),
  });
  await page.element('store-recovery-reset').click();
  await settle();
  const [file] = page.downloads();
  assert.match(file.name, /^giga-pinax-raw-/);
  assert.equal(page.prompts.length, 1);
  assert.match(page.prompts[0], new RegExp(`downloading as ${file.name.replace(/[.]/g, '\\.')}`));
  assert.deepEqual(order.filter((type) => type !== 'snapshot.get' && type !== 'preferences.migrateIfAbsent'), ['snapshot.raw', 'store.reset']);
  assert.equal(page.commands.find(({ type }) => type === 'store.reset').expectedRevision, 41);
  assert.equal(page.element('store-recovery'), null, 'the page loaded again and the notice went');
  assert.equal(page.element('save-settings').disabled, false);
});

test('X-02: Start fresh declined keeps the copy and resets nothing', async () => {
  const page = await openSettings({ snapshotReply: UNREADABLE, reply: unreadableStore(), confirmAnswers: [false] });
  await page.element('store-recovery-reset').click();
  await settle();
  assert.equal(page.downloads().length, 1);
  assert.equal(page.commands.some(({ type }) => type === 'store.reset'), false);
  assert.match(page.element('store-recovery-status').textContent, /^Download started: .*\. Nothing was reset\.$/);
});

test('X-02: a copy that cannot be made resets nothing', async () => {
  const page = await openSettings({
    snapshotReply: UNREADABLE,
    reply: unreadableStore((command) => (command.type === 'snapshot.raw' ? { ok: false, message: 'Unable to read local storage.' } : null)),
  });
  await page.element('store-recovery-reset').click();
  await settle();
  assert.deepEqual(page.downloads(), []);
  assert.deepEqual(page.prompts, []);
  assert.equal(page.commands.some(({ type }) => type === 'store.reset'), false);
  assert.equal(page.element('store-recovery-status').textContent, 'Unable to read local storage. Nothing was reset.');
});

test('X-02: a Replace import is taken over unreadable records, the rescue file going to disk first', async () => {
  const order = [];
  const page = await openSettings({
    snapshotReply: UNREADABLE,
    reply: unreadableStore((command) => { order.push(command.type); return null; }),
  });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(2))] })), 'replace');
  assert.equal(page.element('import-preview').hidden, false);
  assert.equal(page.element('import-counts').textContent, 'Local: 0 records. Backup: 1 records. Replaces the records that can’t be read; a copy of them downloads first.');
  await page.element('confirm-import').click();
  await settle();
  const [copy] = page.downloads();
  assert.match(copy.name, /^giga-pinax-raw-/);
  const sent = page.commands.find(({ type }) => type === 'backup.import');
  assert.equal(sent.mode, 'replace');
  assert.equal(sent.overUnreadable, true);
  assert.equal(sent.expectedRevision, 41);
  assert.ok(order.indexOf('snapshot.raw') < order.indexOf('backup.import'));
  assert.equal(page.element('store-recovery'), null, 'the page loaded the imported records');
});

test('X-02: a merge over unreadable records is refused with the one way that works', async () => {
  const page = await openSettings({ snapshotReply: UNREADABLE, reply: unreadableStore() });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(2))] })), 'merge');
  assert.equal(page.element('import-preview').hidden, true);
  assert.equal(page.status(), 'Your records can’t be read, so a backup can only replace them. Choose Replace local records, then Preview import.');
});

// --- X-03: a set-aside record can be fixed or removed -------------------------------------------------

const damaged = (extra) => ({ collection: 'lots', record: lot(uuid(9), { reference: 'RIC IV Philip I 27b', ...extra }), reason: 'invalid-string', quarantinedAt: NOW });

test('X-03: the set-aside card comes first on the page, and a damaged coin is named with its field', async () => {
  const entry = damaged({ title: 42 });
  const page = await openSettings({ snapshot: snapshotWith({ quarantine: [entry] }) });
  assert.equal(page.document.querySelector('main').children[0], page.element('data-health'));
  assert.equal(page.element('data-health-title').textContent, 'Set-aside records');
  const [row] = page.element('quarantine-list').children;
  assert.equal(row.querySelector('span').textContent, 'Coin “RIC IV Philip I 27b”: title is not text of up to 300 characters (set aside 2026-09-12)');
  assert.deepEqual(row.querySelectorAll('button').map((button) => button.textContent), ['Restore', 'Remove', 'Put back with this title']);
  assert.equal(row.querySelector('.set-aside-value').value, '42');
});

test('X-03: Put back with this title sends the correction, and one without an optional field clears it', async () => {
  const title = damaged({ title: 42 });
  const notes = damaged({ notes: 7 });
  const page = await openSettings({
    snapshot: snapshotWith({ quarantine: [title, notes] }),
    reply: () => ({ ok: true, value: { collection: 'lots', id: uuid(9), restoredReferences: [], keptReferences: [] } }),
  });
  const [titleRow, notesRow] = page.element('quarantine-list').children;
  titleRow.querySelector('.set-aside-value').value = 'Philip I, antoninianus';
  const put = titleRow.querySelectorAll('button').find((button) => button.textContent === 'Put back with this title');
  await put.click();
  await settle();
  const without = notesRow.querySelectorAll('button').find((button) => button.textContent === 'Put back without the notes');
  await without.click();
  await settle();
  assert.deepEqual(page.commands.filter(({ type }) => type === 'quarantine.restore').map(({ entryId, edit }) => [entryId, edit]), [
    [quarantineEntryId(title), { field: 'title', value: 'Philip I, antoninianus' }],
    [quarantineEntryId(notes), { field: 'notes', value: null }],
  ]);
});

test('X-03: Remove asks first, names the coin, and takes it out of the list', async () => {
  const entry = damaged({ title: 42 });
  const page = await openSettings({
    snapshot: snapshotWith({ quarantine: [entry] }),
    confirmAnswers: [false, true],
    reply: (command, state) => {
      state.snapshot = { ok: true, value: snapshotWith() };
      return { ok: true, value: { collection: 'lots', id: uuid(9) } };
    },
  });
  const remove = () => page.element('quarantine-list').children[0].querySelectorAll('button').find((button) => button.textContent === 'Remove');
  await remove().click();
  await settle();
  assert.deepEqual(page.commands, [], 'declined: nothing sent');
  await remove().click();
  await settle();
  assert.deepEqual(page.prompts, Array(2).fill('Remove this coin “RIC IV Philip I 27b” for good? Download set-aside records first if you may want it later.'));
  assert.deepEqual(page.commands.map(({ type, entryId }) => [type, entryId]), [['quarantine.remove', quarantineEntryId(entry)]]);
  assert.equal(page.status(), 'The coin “RIC IV Philip I 27b” was removed from the set-aside records.');
  assert.equal(page.element('data-health').hidden, true);
});

test('X-03: Settings opened for the set-aside records from the workspace keeps its way back', async () => {
  const page = await openSettings({ hash: '#from-workspace%3Fdata-health' });
  assert.equal(page.element('settings-return').textContent, 'Return to workspace');
});

// --- K-13 / X-09: how full the store is --------------------------------------------------------------

const MiB = 1024 * 1024;
test('K-13: Settings shows how much of the 5 MB the records use, and warns from 80%', async () => {
  const quiet = await openSettings({ usage: { ok: true, value: { bytes: Math.round(1.6 * MiB), limit: 5 * MiB } } });
  assert.equal(quiet.element('storage-gauge').hidden, false);
  assert.equal(quiet.element('storage-used').textContent, '1.6 MB of 5 MB used');
  assert.equal(quiet.element('storage-meter').getAttribute('value'), String(Math.round(1.6 * MiB)));
  assert.equal(quiet.element('storage-meter').getAttribute('high'), String(4 * MiB));
  assert.equal(quiet.element('storage-warning').hidden, true);

  const filling = await openSettings({ usage: { ok: true, value: { bytes: Math.round(4.1 * MiB), limit: 5 * MiB } } });
  assert.equal(filling.element('storage-used').textContent, '4.1 MB of 5 MB used');
  assert.equal(filling.element('storage-warning').hidden, false);
  assert.equal(filling.element('storage-warning').textContent, 'Your records are filling the 5 MB Giga Pinax can keep in this browser. Export a backup, then remove old coins or comparables you no longer need.');

  const full = await openSettings({ usage: { ok: true, value: { bytes: 5 * MiB + 2000, limit: 5 * MiB } } });
  assert.equal(full.element('storage-used').textContent, '5.01 MB of 5 MB used');
  assert.match(full.element('storage-warning').textContent, /^Your records fill the 5 MB .* only changes that make them smaller can be saved\./);

  const unknown = await openSettings();
  assert.equal(unknown.element('storage-gauge').hidden, true, 'no figure is shown that the store did not give');
});

test('K-13: Preview and Confirm say they are working while a large backup is read and imported', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const current = snapshotWith({ lots: [lot(uuid(1))] });
  const page = await openSettings({ snapshot: current, reply: async () => { await held; return { ok: true }; } });
  await preview(page, backupDocument(snapshotWith({ lots: [lot(uuid(1)), lot(uuid(2))] })));
  assert.equal(page.element('preview-import').textContent, 'Preview import', 'back to its name once read');
  const confirming = page.element('confirm-import').click();
  await settle();
  assert.equal(page.element('confirm-import').textContent, 'Importing…');
  release();
  await confirming;
  await settle();
  assert.equal(page.element('confirm-import').textContent, 'Confirm import');
});

// --- X-13: said before Confirm, not after it ----------------------------------------------------------

test('X-13: a merge that would change nothing says so and offers no Confirm', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1))] });
  const page = await openSettings({ snapshot: current });
  await preview(page, backupDocument(current));
  assert.equal(page.element('import-counts').textContent, 'Nothing to import: every record in this backup is already here, unchanged.');
  assert.equal(page.element('confirm-import').disabled, true);
  assert.equal(page.status(), 'Nothing to import: every record in this backup is already here, unchanged.');
});

test('X-13: an import that would not fit is refused in the preview, with the figure, before Confirm', async () => {
  const current = snapshotWith({ lots: [lot(uuid(1))] });
  // A backup whose coins carry notes enough to take the records past the 5 MB bound.
  const big = snapshotWith({ lots: [lot(uuid(1)), ...Array.from({ length: 1100 }, (_, index) => lot(uuid(100 + index), { notes: 'n'.repeat(4900) }))] });
  const page = await openSettings({ snapshot: current });
  await preview(page, backupDocument(big));
  assert.equal(page.element('confirm-import').disabled, true);
  assert.match(page.status(), /^This import would not fit: your records would take 5\.\d+ MB, more than the 5 MB Giga Pinax can keep in this browser\./);
  assert.equal(page.statusIsError(), 'true');
});
