import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { importWithSafetyCopy } from '../extension/core/backup.js';
import { LOCAL_CORPORA, catalogueMetadataText } from '../extension/local-catalogue.js';

// The presets editor is built by a page that cannot run outside the extension, so what it writes
// into the row is read here from its source, as the popup's own alert rule is.
const settingsSource = readFileSync(new URL('../extension/settings.js', import.meta.url), 'utf8');

test('a preset control is named by its field and described by its hint and its error', () => {
  assert.match(settingsSource, /premiumField\('Increment tiers', ladder,/);
  // The hint is a description, not part of the control's name: a textarea called "Increment tiers,
  // one tier per line: the amount the tier starts at…" is read out in full every time it is reached.
  assert.match(settingsSource, /label\.append\(caption, control\);/);
  assert.match(settingsSource, /control\.setAttribute\('aria-describedby', \[\.\.\.describedBy, error\.id\]\.join\(' '\)\);/);
  assert.doesNotMatch(settingsSource, /ladderLabel\.append\([^)]*Hint/);
});

// A placeholder inside a named house's row reads as that house's own schedule. Nothing in the box
// may look like numbers a collector could take for the tiers.
test('the empty tiers box shows the shape of a line, not numbers that could pass for a ladder', () => {
  assert.match(settingsSource, /ladder\.placeholder = 'from: step';/);
  assert.doesNotMatch(settingsSource, /placeholder = '\d/);
});

// One announcement per error: the row's own alert, beside the field it is about.
test('a refused preset row is announced once, beside the field, not again in the page status', () => {
  assert.match(settingsSource, /\.premium-error'\)\.textContent = field\.error\.message;/);
  assert.match(settingsSource, /if \(!presets\.ok\) \{\s*status\(''\);\s*return;/);
  assert.doesNotMatch(settingsSource, /throw new Error\(`House /);
});

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
  const result = await importWithSafetyCopy(deps);
  assert.deepEqual(calls, ['exportCopy', `download:${COPY.name}`, 'send']);
  assert.equal(result.sent, true);
  assert.equal(result.copied, COPY.name);
  assert.deepEqual(result.reply, { ok: true });
});

test('a copy that cannot be made falls back to the raw export and a second confirmation', async () => {
  const { calls, prompts, deps } = harness({
    exportCopy: async () => { calls.push('exportCopy'); throw new Error('Could not read local records.'); },
  });
  const result = await importWithSafetyCopy(deps);
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
  const result = await importWithSafetyCopy(deps);
  assert.equal(calls.includes('send'), false, 'nothing is overwritten once the collector declines');
  assert.equal(result.sent, false);
  assert.equal(result.reply, undefined);
});

test('a raw export that also fails still asks, and says the file could not be written', async () => {
  const { calls, prompts, deps } = harness({
    exportCopy: async () => { calls.push('exportCopy'); throw new Error('storage unavailable'); },
    exportRaw: async () => { calls.push('exportRaw'); throw new Error('storage unavailable'); },
  });
  const result = await importWithSafetyCopy(deps);
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
  const result = await importWithSafetyCopy(deps);
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
  const result = await importWithSafetyCopy(deps);
  assert.deepEqual(calls, ['exportCopy', `download:${COPY.name}`, 'send']);
  assert.equal(result.copied, COPY.name, 'the page can still say which file it downloaded');
  assert.equal(result.error.message, 'port closed');
  assert.equal(result.reply, undefined);
});

test('a refused command is reported without claiming the import happened', async () => {
  const { deps } = harness({ send: async () => ({ ok: false, message: 'Local data changed.' }) });
  const result = await importWithSafetyCopy(deps);
  assert.equal(result.sent, true);
  assert.equal(result.reply.ok, false);
  assert.equal(result.copied, COPY.name, 'the copy still reached disk and is still worth naming');
});

// The bundled-data panel is a set of claims about what the package carries, so each one is checked against the package.
const settingsHtml = readFileSync(new URL('../extension/settings.html', import.meta.url), 'utf8');
const dataRoot = new URL('../extension/data/', import.meta.url);

// The corpus directories, without the two files extension/data holds for all of them at once.
const bundledCorpora = () => readdirSync(dataRoot).filter((name) => !name.includes('.')).sort();

test('the bundled-data panel names every corpus the package carries, and only those', () => {
  const bundled = bundledCorpora();
  assert.deepEqual(Object.keys(LOCAL_CORPORA).sort(), bundled);
  // One row per corpus, each built from that corpus's own metadata rather than from a sentence written here.
  assert.match(settingsSource, /const corpora = Object\.keys\(LOCAL_CORPORA\);/);
  assert.match(settingsSource, /catalogueRow\(corpus, metadata\[index\]\)/);
  // The sentence beside the rows says which references are answered locally and which still go online. Bopearachchi
  // is not bundled — BIGR's export carries no Bopearachchi citation to verify a hit against — so it must be named as
  // online, and it must not be listed as a corpus the package carries.
  assert.match(settingsHtml, /RIC, Crawford, Price and Seleucid Coins lookups use this local data\./);
  assert.match(settingsHtml, /Bopearachchi references and any lookup the local data cannot answer go online/);
  // The names travel with the package now, so the panel says so — and says what it still cannot name. It must not go
  // back to claiming a local card shows nothing but identifiers, and it must not claim every concept has a name.
  assert.match(settingsHtml, /English Nomisma\.org names for every authority, denomination, mint, material and portrait/);
  assert.match(settingsHtml, /CC BY 3\.0/);
  assert.match(settingsHtml, /shows as the identifier the record carries, and none is ever guessed/);
  // Every name the panel promises is really in the file beside the records.
  const labels = JSON.parse(readFileSync(new URL('nomisma-labels.json', dataRoot), 'utf8'));
  assert.equal(labels.schemaVersion, 1);
  assert.ok(Object.keys(labels.labels).length > 1000);
  assert.match(readFileSync(new URL('NOTICE.txt', dataRoot), 'utf8'), /Creative Commons Attribution 3\.0/);
  assert.equal(bundled.includes('bigr'), false);
  assert.doesNotMatch(settingsHtml, /id="catalogue-coverage"/);
});

test('each panel row reports the counts and the date its own corpus metadata carries', () => {
  for (const corpus of bundledCorpora()) {
    const metadata = JSON.parse(readFileSync(new URL(`${corpus}/metadata.json`, dataRoot), 'utf8'));
    const line = catalogueMetadataText(metadata);
    assert.match(line, new RegExp(`${LOCAL_CORPORA[corpus].label} records`), corpus);
    assert.match(line, /Local files generated \d+ \w+ \d{4}\./, corpus);
    // A corpus bundled in part says how much it leaves out; one bundled whole makes no such claim.
    assert.equal(/leaving out/.test(line), Object.hasOwn(metadata, 'excluded'), corpus);
    assert.ok(metadata.sourceUrl.startsWith('https://'), corpus);
  }
});
