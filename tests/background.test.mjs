import test from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMA_VERSION } from '../extension/core/records.js';
import { STORAGE_KEY } from '../extension/store.js';
import { LOOKUP_LAUNCH_MESSAGE, LOOKUP_MESSAGE, showInWindow } from '../extension/selection.js';

const listeners = {
  messages: [], installed: [], startup: [], clicked: [], alarms: [], notificationClicks: [], permissionsAdded: [],
};
const menus = [];
const stored = {};
const badges = [];
const titles = [];
const CAPTURE_FAILURE_TITLE = 'Giga Pinax: the last page capture could not be saved. Open the workspace to check your records.';
const OPEN_FAILURE_TITLE = 'Giga Pinax: the capture was saved, but the workspace could not be opened. Open it from the toolbar.';
const RECONCILE_FAILURE_TITLE = 'Giga Pinax: auction reminders could not be rescheduled. Open the workspace to check your auctions.';
const storageCalls = { get: 0, set: 0 };
let notificationsAllowed = false;
let notificationResult = 'notification-id';
let notificationCalls = 0;
let storageSetFails = false;
let tabCreateFails = false;
let tabCalls = 0;

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
      async get(key) {
        storageCalls.get += 1;
        return Object.hasOwn(stored, key) ? { [key]: structuredClone(stored[key]) } : {};
      },
      async set(items) {
        storageCalls.set += 1;
        if (storageSetFails) throw new Error('storage is full');
        Object.assign(stored, structuredClone(items));
      },
    },
  },
  alarms: {
    async clear() { return true; },
    create() {},
    onAlarm: { addListener(listener) { listeners.alarms.push(listener); } },
  },
  action: {
    // The browser keeps the badge across worker restarts, so the fake reports the last one set.
    async getBadgeText() { return badges.at(-1) ?? ''; },
    async setBadgeText({ text }) { badges.push(text); },
    async setBadgeBackgroundColor() {},
    async setTitle({ title }) { titles.push(title); },
  },
  permissions: {
    async contains() { return notificationsAllowed; },
    onAdded: { addListener(listener) { listeners.permissionsAdded.push(listener); } },
  },
  notifications: { async create() { notificationCalls += 1; if (notificationResult instanceof Error) throw notificationResult; return notificationResult; } },
  tabs: { async create() { tabCalls += 1; if (tabCreateFails) throw new Error('no tab'); } },
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
  assert.equal(rawReply.value.schemaVersion, SCHEMA_VERSION);
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
    preferences: { currency: 'USD' },
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

test('a notifications permission granted after start registers one click handler', () => {
  assert.equal(listeners.notificationClicks.length, 0, 'the optional API is absent at worker start');
  assert.equal(listeners.permissionsAdded.length, 1);
  globalThis.browser.notifications.onClicked = {
    addListener(listener) { listeners.notificationClicks.push(listener); },
  };
  for (let round = 0; round < 2; round += 1) {
    for (const listener of listeners.permissionsAdded) listener({ permissions: ['notifications'] });
  }
  assert.equal(listeners.notificationClicks.length, 1);
});

test('a capture that cannot be saved or shown is surfaced instead of silently dropped', async () => {
  const click = (menuItemId) => listeners.clicked[0]({
    menuItemId, selectionText: 'Nero denarius, Rome', pageUrl: 'https://house.test/sale',
  });
  storageSetFails = true;
  click('auction-companion:track-auction');
  for (let index = 0; index < 6; index += 1) await flush();
  storageSetFails = false;
  assert.equal(badges.at(-1), '!');
  assert.equal(titles.at(-1), CAPTURE_FAILURE_TITLE, 'the badge alone does not say what went wrong');

  // A command can only come from an extension page, so the collector has the workspace open.
  await send({ type: 'snapshot.get', requestId: crypto.randomUUID() });
  for (let index = 0; index < 6; index += 1) await flush();
  assert.notEqual(badges.at(-1), '!', 'the failure must go away once the collector can see it');
  assert.equal(titles.at(-1), '');

  const tabsBefore = tabCalls;
  tabCreateFails = true;
  click('auction-companion:research-selection');
  for (let index = 0; index < 6; index += 1) await flush();
  tabCreateFails = false;
  assert.equal(tabCalls, tabsBefore + 1, 'the saved draft must still try to open the workspace');
  assert.equal(badges.at(-1), '!', 'a capture that could not be shown is surfaced too');
  assert.equal(titles.at(-1), OPEN_FAILURE_TITLE, 'a draft that was saved must not be reported as lost');

  click('auction-companion:research-selection');
  for (let index = 0; index < 8; index += 1) await flush();
  assert.notEqual(badges.at(-1), '!', 'a capture that works clears the earlier failure');
  assert.equal(titles.at(-1), '');
});

test('a reconcile with nothing to change reads once and writes nothing', async () => {
  await send({ type: 'scheduler.reconcile', requestId: crypto.randomUUID() });
  const before = { ...storageCalls };
  const reply = await send({ type: 'scheduler.reconcile', requestId: crypto.randomUUID() });
  assert.equal(reply.ok, true);
  assert.equal(storageCalls.set, before.set);
  assert.ok(storageCalls.get - before.get <= 2, `an idle reconcile read ${storageCalls.get - before.get} times`);
});

// A context-menu click is what wakes an idle worker, so the module's own reconcile is always in
// flight when the capture fails, and its badge refresh lands after the failure badge.
test('a capture that fails on a cold wake keeps its badge', async () => {
  const clickedBefore = listeners.clicked.length;
  storageSetFails = true;
  await import(`../extension/background.js?coldwake=${Date.now()}`);
  listeners.clicked[clickedBefore]({
    menuItemId: 'auction-companion:track-auction',
    selectionText: 'Nero denarius, Rome',
    pageUrl: 'https://house.test/sale',
  });
  for (let index = 0; index < 40; index += 1) await flush();
  storageSetFails = false;
  assert.equal(badges.at(-1), '!', 'the waking reconcile wiped the only sign of a lost capture');
  assert.equal(titles.at(-1), CAPTURE_FAILURE_TITLE);
});

// A worker idles out about thirty seconds after the click that woke it, while the browser keeps
// the badge and the tooltip, so the flag has to be read back from the toolbar rather than assumed.
test('a worker restarted after a failed capture leaves the warning standing', async () => {
  badges.push('!');
  titles.push(CAPTURE_FAILURE_TITLE);
  await import(`../extension/background.js?restart=${Date.now()}`);
  for (let index = 0; index < 40; index += 1) await flush();
  assert.equal(badges.at(-1), '!', 'the restarted worker wiped a warning the browser still showed');
  assert.equal(titles.at(-1), CAPTURE_FAILURE_TITLE);

  const restarted = listeners.messages.at(-1);
  await new Promise((resolve) => restarted({ type: 'snapshot.get', requestId: crypto.randomUUID() }, {}, resolve));
  for (let index = 0; index < 12; index += 1) await flush();
  assert.notEqual(badges.at(-1), '!', 'the recovered warning must still be retired by a later capture');
  assert.equal(titles.at(-1), '');
});

// A reconcile the collector did not ask for has no reply anybody reads: an alarm, an install, or the one that follows a
// save. When it failed, the reminders simply stopped and nothing anywhere said so.
test('a reconcile nobody asked for says so when it fails instead of stopping the reminders in silence', async () => {
  const intact = structuredClone(stored[STORAGE_KEY]);
  // A root the repair cannot rescue: every command that reads it fails, including the reconcile.
  stored[STORAGE_KEY].lots = 'not a list';
  const logged = [];
  const realError = console.error;
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  try {
    listeners.alarms[0]({ name: 'auction-companion:scheduler' });
    for (let index = 0; index < 12; index += 1) await flush();
  } finally {
    console.error = realError;
    stored[STORAGE_KEY] = intact;
  }
  assert.equal(badges.at(-1), '!');
  assert.equal(titles.at(-1), RECONCILE_FAILURE_TITLE, 'the badge alone does not say what went wrong');
  assert.equal(logged.length, 1, 'and the reason is in the log for a bug report');
  assert.match(logged[0], /reconcile/i);

  // Retired the same way every other warning is: the collector opening an extension page.
  await send({ type: 'snapshot.get', requestId: crypto.randomUUID() });
  for (let index = 0; index < 8; index += 1) await flush();
  assert.notEqual(badges.at(-1), '!');
  assert.equal(titles.at(-1), '');
});

test.after(() => { delete globalThis.browser; });
