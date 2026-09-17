import test from 'node:test';
import assert from 'node:assert/strict';

import { LOOKUP_LAUNCH_MESSAGE, LOOKUP_MESSAGE, showInWindow } from '../extension/selection.js';

const listeners = { messages: [], installed: [], startup: [], clicked: [], alarms: [], notificationClicks: [] };
const menus = [];
const stored = {};
let notificationsAllowed = false;
let notificationResult = 'notification-id';
let notificationCalls = 0;

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
  permissions: { async contains() { return notificationsAllowed; } },
  notifications: { async create() { notificationCalls += 1; if (notificationResult instanceof Error) throw notificationResult; return notificationResult; }, onClicked: { addListener(listener) { listeners.notificationClicks.push(listener); } } },
  tabs: { async create() {} },
  windows: { async create() {}, async update() {} },
};

await import(`../extension/background.js?integration=${Date.now()}`);

const flush = () => new Promise((resolve) => setImmediate(resolve));
const send = (message) => new Promise((resolve) => listeners.messages[0](message, {}, resolve));

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

  const rawReply = await send({ type: 'snapshot.raw', requestId: crypto.randomUUID() });
  assert.equal(rawReply.ok, true);
  assert.equal(rawReply.value.schemaVersion, 1);
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

test('popup lookup launches are validated and centralized through the background', async () => {
  const openedBefore = [];
  const originalCreate = globalThis.browser.windows.create;
  globalThis.browser.windows.create = async (options) => { openedBefore.push(options); return { id: 42 }; };
  const valid = await send({ type: LOOKUP_LAUNCH_MESSAGE, url: 'popup.html?window=1&q=Price+23' });
  assert.deepEqual(valid, { ok: true });
  assert.equal(openedBefore.length, 1);
  const invalid = await send({ type: LOOKUP_LAUNCH_MESSAGE, url: 'https://evil.test/popup.html?window=1' });
  assert.deepEqual(invalid, { ok: false, message: 'Invalid lookup window address.' });
  assert.equal(openedBefore.length, 1);
  globalThis.browser.windows.create = originalCreate;
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

test('enabling desktop alerts reconciles and delivers an already-due reminder', async () => {
  notificationsAllowed = true;
  const starts = new Date(Date.now() + 10 * 60 * 1000);
  const localDate = starts.toISOString().slice(0, 10);
  const localTime = starts.toISOString().slice(11, 16);
  const migrated = await send({
    type: 'preferences.migrateIfAbsent', requestId: crypto.randomUUID(),
    preferences: { currency: 'USD', catalogue: 'Price', number: '23', volume: '', section: '', sampleMode: false },
  });
  const event = await send({
    type: 'event.save', requestId: crypto.randomUUID(), expectedRevision: null,
    event: {
      name: 'Due now', eventKind: 'auction-starts', precision: 'timed',
      localDate, localTime, timeZone: 'UTC',
      reminderScope: 'standalone', reminders: [{ kind: 'offset', offsetMinutes: 20 }],
    },
  });
  assert.equal(migrated.ok, true);
  assert.equal(event.ok, true);
  const before = notificationCalls;
  const saved = await send({
    type: 'preferences.save', requestId: crypto.randomUUID(), expectedRevision: migrated.value.revision,
    preferences: { ...migrated.value, desktopAlertsEnabled: true },
  });
  assert.equal(saved.ok, true);
  assert.equal(notificationCalls, before + 1);
});

test('false and rejected notification deliveries retain a five-minute retry alarm', async () => {
  let index = 0;
  for (const result of [false, new Error('notification failed')]) {
    notificationResult = result;
    const starts = new Date(Date.now() + 10 * 60 * 1000);
    const before = notificationCalls;
    const event = await send({
      type: 'event.save', requestId: crypto.randomUUID(), expectedRevision: null,
      event: {
        name: `Retry ${index++}`, eventKind: 'auction-starts', precision: 'timed',
        localDate: starts.toISOString().slice(0, 10), localTime: starts.toISOString().slice(11, 16), timeZone: 'UTC',
        reminderScope: 'standalone', reminders: [{ kind: 'offset', offsetMinutes: 20 }],
      },
    });
    assert.equal(notificationCalls, before + 1);
    const state = await send({ type: 'snapshot.get', requestId: crypto.randomUUID() });
    const claimed = state.value.alerts.find(({ eventId, status }) => eventId === event.value.id && status === 'claimed');
    assert.ok(claimed);
    const earliestClaim = state.value.alerts.filter(({ status }) => status === 'claimed')
      .map(({ claimedAt }) => claimedAt).sort()[0];
    assert.equal(Date.parse(state.value.scheduler.nextWakeAt) - Date.parse(earliestClaim), 5 * 60 * 1000);
  }
  notificationResult = 'notification-id';
});

test.after(() => { delete globalThis.browser; });
