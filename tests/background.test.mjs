import test from 'node:test';
import assert from 'node:assert/strict';

import { LOOKUP_MESSAGE, showInWindow } from '../extension/selection.js';

const listeners = { messages: [], installed: [], startup: [], clicked: [], alarms: [], notificationClicks: [] };
const menus = [];
const stored = {};

globalThis.browser = {
  runtime: {
    onMessage: { addListener(listener) { listeners.messages.push(listener); } },
    onInstalled: { addListener(listener) { listeners.installed.push(listener); } },
    onStartup: { addListener(listener) { listeners.startup.push(listener); } },
    getURL(path) { return `moz-extension://test/${path}`; },
  },
  contextMenus: {
    async removeAll() { menus.length = 0; },
    create(item) { menus.push(item); },
    onClicked: { addListener(listener) { listeners.clicked.push(listener); } },
  },
  storage: {
    local: {
      async get(key) { return Object.hasOwn(stored, key) ? { [key]: structuredClone(stored[key]) } : {}; },
      async set(items) { Object.assign(stored, structuredClone(items)); },
    },
  },
  alarms: {
    async clear() { return true; },
    create() {},
    onAlarm: { addListener(listener) { listeners.alarms.push(listener); } },
  },
  action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  permissions: { async contains() { return false; } },
  notifications: { async create() {}, onClicked: { addListener(listener) { listeners.notificationClicks.push(listener); } } },
  tabs: { async create() {} },
  windows: { async create() {}, async update() {} },
};

await import(`../extension/background.js?integration=${Date.now()}`);

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('combined background ignores lookup-window messages and accepts companion commands', async () => {
  assert.equal(listeners.messages.length, 1);
  const listener = listeners.messages[0];
  assert.equal(listener({ type: LOOKUP_MESSAGE, url: 'popup.html?window=1&q=Price+23' }, {}, () => {
    assert.fail('background must not answer the lookup window message');
  }), false);

  const reply = new Promise((resolve) => {
    assert.equal(listener({
      type: 'snapshot.get', requestId: '10000000-0000-4000-8000-000000000001',
    }, {}, resolve), true);
  });
  assert.equal((await reply).ok, true);
});

test('Giga showInWindow opens a window when the combined background declines its message', async () => {
  const opened = [];
  const listener = listeners.messages[0];
  const api = {
    runtime: {
      async sendMessage(message) {
        const handled = listener(message, {}, () => assert.fail('declined messages have no response'));
        if (handled === false) throw new Error('No receiver');
        return null;
      },
      getURL(path) { return `moz-extension://test/${path}`; },
    },
    windows: {
      async create(options) { opened.push(options); },
      async update() {},
    },
  };

  await showInWindow(api, 'popup.html?window=1&q=Price+23');
  assert.deepEqual(opened, [{
    url: 'moz-extension://test/popup.html?window=1&q=Price+23', type: 'popup', width: 440, height: 680,
  }]);
});

test('one registrar creates all three context menus after install and startup', async () => {
  assert.equal(listeners.installed.length, 1);
  assert.equal(listeners.startup.length, 1);

  listeners.installed[0]();
  await flush();
  await flush();
  assert.deepEqual(new Set(menus.map(({ id }) => id)), new Set([
    'giga-pinax-lookup',
    'auction-companion:research-selection',
    'auction-companion:track-auction',
  ]));

  listeners.startup[0]();
  await flush();
  await flush();
  assert.deepEqual(new Set(menus.map(({ id }) => id)), new Set([
    'giga-pinax-lookup',
    'auction-companion:research-selection',
    'auction-companion:track-auction',
  ]));

  listeners.installed[0]();
  listeners.startup[0]();
  await flush();
  await flush();
  await flush();
  assert.equal(menus.length, 3, 'overlapping lifecycle registration must serialize remove/create');
  assert.deepEqual(new Set(menus.map(({ id }) => id)), new Set([
    'giga-pinax-lookup',
    'auction-companion:research-selection',
    'auction-companion:track-auction',
  ]));
});

test.after(() => { delete globalThis.browser; });
