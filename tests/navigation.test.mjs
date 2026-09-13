import test from 'node:test';
import assert from 'node:assert/strict';

import { openResearchPanel, openSettings, openWorkspace } from '../extension/navigation.js';

test('opens the Chrome side panel synchronously with the current-window sentinel', async () => {
  const calls = [];
  const api = {
    windows: { WINDOW_ID_CURRENT: -2 },
    sidePanel: { open(options) { calls.push(options); return Promise.resolve(); } },
  };
  const pending = openResearchPanel(api);
  assert.deepEqual(calls, [{ windowId: -2 }]);
  assert.deepEqual(await pending, { ok: true, mode: 'side-panel' });
});

test('opens the Firefox sidebar synchronously inside the user gesture', async () => {
  let called = false;
  const api = { sidebarAction: { open() { called = true; return Promise.resolve(); } } };
  const pending = openResearchPanel(api);
  assert.equal(called, true);
  assert.deepEqual(await pending, { ok: true, mode: 'sidebar' });
});

test('uses the background-owned window fallback when native opening is unsupported or rejected', async () => {
  const messages = [];
  const runtime = {
    sendMessage(message) { messages.push(message); return Promise.resolve({ ok: true }); },
  };
  assert.deepEqual(await openResearchPanel({ runtime }), { ok: true, mode: 'window' });
  assert.deepEqual(await openResearchPanel({ runtime, sidePanel: { open() { return Promise.reject(new Error('denied')); } } }), { ok: true, mode: 'window' });
  assert.deepEqual(messages, [
    { type: 'giga-pinax-launch-lookup', url: 'popup.html?panel=1&window=1' },
    { type: 'giga-pinax-launch-lookup', url: 'popup.html?panel=1&window=1' },
  ]);
});

test('reports complete panel failure and leaves navigation callers open', async () => {
  const result = await openResearchPanel({
    sidePanel: { open() { throw new Error('native failed'); } },
    runtime: { sendMessage() { return Promise.resolve({ ok: false, message: 'Window blocked.' }); } },
  });
  assert.deepEqual(result, { ok: false, message: 'Window blocked.' });
});

test('settings and workspace routes use extension tabs with encoded fragments', async () => {
  const urls = [];
  const api = {
    runtime: { getURL: (path) => `moz-extension://test/${path}` },
    tabs: { create: ({ url }) => { urls.push(url); return Promise.resolve(); } },
  };
  assert.deepEqual(await openSettings('backup', api), { ok: true });
  assert.deepEqual(await openWorkspace('lot/a b', api), { ok: true });
  assert.deepEqual(urls, [
    'moz-extension://test/settings.html#backup',
    'moz-extension://test/workspace.html#lot%2Fa%20b',
  ]);
});
