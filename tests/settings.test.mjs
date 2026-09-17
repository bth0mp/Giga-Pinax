import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { importWithSafetyCopy } from '../extension/core/backup.js';

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
