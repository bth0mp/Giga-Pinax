import { extensionApi, invokeExtensionMethod, storageLocalAdapter } from './browser-api.js';
import { createCommandWriter } from './store.js';
import { reconcileScheduler } from './core/reminders.js';
import { LOOKUP_LAUNCH_MESSAGE, LOOKUP_MESSAGE, isLookupWindowUrl, popupUrlFor, selectionQuery, showInWindow } from './selection.js';

const api = extensionApi();
const writer = createCommandWriter(storageLocalAdapter(), {
  now: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
});

const MENU_LOOKUP = 'giga-pinax-lookup';
const MENU_RESEARCH = 'auction-companion:research-selection';
const MENU_TRACK = 'auction-companion:track-auction';
const SCHEDULER_ALARM = 'auction-companion:scheduler';
const COMMAND_TYPES = new Set([
  'snapshot.get', 'snapshot.raw',
  'preferences.migrateIfAbsent', 'preferences.save',
  'lot.save', 'lot.delete',
  'group.save', 'group.delete', 'group.reorder',
  'bid.plan', 'bid.place', 'bid.cancel',
  'lot.outcome.set', 'collection.review.resolve',
  'event.save', 'event.delete',
  'evidence.add', 'evidence.include', 'evidence.resolve',
  'draft.save', 'draft.get', 'draft.consume',
  'alert.ack', 'alert.snooze', 'alert.markAllRead',
  'alert.claim', 'alert.delivery.record',
  'scheduler.reconcile', 'backup.import',
]);
const RECONCILE_AFTER = new Set([
  'preferences.save',
  'event.save', 'event.delete', 'lot.save', 'lot.delete', 'lot.outcome.set',
  'alert.ack', 'alert.snooze', 'alert.markAllRead', 'backup.import',
]);
let reconcileQueue = Promise.resolve();
let menuQueue = Promise.resolve();
// A context-menu click wakes an idle worker, so the reconcile this module starts is still in
// flight when a capture fails and would wipe the badge within milliseconds. The failure outranks
// the due count until the collector has had a chance to see it.
const CAPTURE_FAILURE_TITLE = 'Giga Pinax: the last page capture could not be saved. Open the workspace to check your records.';
const OPEN_FAILURE_TITLE = 'Giga Pinax: the capture was saved, but the workspace could not be opened. Open it from the toolbar.';
let captureFailed = false;

// The browser keeps the badge and the toolbar title across worker restarts, but module memory
// only lasts the ~30 s until the worker idles out, so the flag is read back from the badge the
// browser still shows. Without it a restart's own reconcile wipes the `!` and then declines to
// clear the title, stranding it for the rest of the session. A module cannot await at the top
// level and still register its listeners synchronously, so the recovery is awaited where it is read.
const captureFailureRecovered = (async () => {
  try {
    if (await invokeExtensionMethod(api.action.getBadgeText, api.action, {}) === '!') captureFailed = true;
  } catch {
    // A toolbar that will not report its badge leaves the warning to the next failure.
  }
})();

function commit(command) {
  return writer.commitCommand(command);
}

async function setAlarm(nextWakeAt) {
  await invokeExtensionMethod(api.alarms.clear, api.alarms, SCHEDULER_ALARM);
  if (nextWakeAt) api.alarms.create(SCHEDULER_ALARM, { when: Date.parse(nextWakeAt) });
}

async function snapshot() {
  const reply = await commit({ type: 'snapshot.get', requestId: crypto.randomUUID() });
  return reply.ok ? reply.value : null;
}

async function showBadge(text) {
  await invokeExtensionMethod(api.action.setBadgeText, api.action, { text });
  if (text) await invokeExtensionMethod(api.action.setBadgeBackgroundColor, api.action, { color: '#9f2d20' });
}

async function showDueBadge(state) {
  await captureFailureRecovered;
  if (captureFailed) return;
  const dueEvents = new Set(state.alerts
    .filter(({ status }) => ['due', 'claimed', 'delivered'].includes(status))
    .map(({ eventId }) => eventId));
  await showBadge(dueEvents.size === 0 ? '' : dueEvents.size > 99 ? '99+' : String(dueEvents.size));
}

async function refreshBadge() {
  const state = await snapshot();
  if (state) await showDueBadge(state);
}

async function notificationsAllowed(state) {
  if (!state.preferences?.desktopAlertsEnabled || !api.notifications) return false;
  return invokeExtensionMethod(api.permissions.contains, api.permissions, { permissions: ['notifications'] });
}

async function deliverOverdue(plan, state) {
  if (!(await notificationsAllowed(state))) return false;
  let claimedAny = false;
  for (const [eventId, triggers] of Object.entries(plan.overdueByEvent)) {
    const triggerIds = triggers.map(({ id }) => id);
    const claimed = await commit({
      type: 'alert.claim', requestId: crypto.randomUUID(), eventId, triggerIds,
    });
    if (!claimed.ok) continue;
    claimedAny = true;
    const recovery = await commit({ type: 'scheduler.reconcile', requestId: crypto.randomUUID() });
    if (recovery.ok) await setAlarm(recovery.value.nextWakeAt);
    let delivered = false;
    try {
      const first = triggers[0];
      const when = first.precision === 'timed'
        ? new Date(first.eventStartsAt).toLocaleString()
        : `${first.localDate} (${first.timeZone})`;
      const notificationId = await invokeExtensionMethod(api.notifications.create, api.notifications,
        `auction-companion:${eventId}`,
        {
          type: 'basic',
          iconUrl: api.runtime.getURL('icons/icon-128.png'),
          title: first.eventName,
          message: `Auction reminder: ${when}`,
        });
      delivered = notificationId !== false;
    } catch {
      delivered = false;
    }
    await commit({
      type: 'alert.delivery.record', requestId: crypto.randomUUID(), triggerIds, delivered,
    });
    const settled = await commit({ type: 'scheduler.reconcile', requestId: crypto.randomUUID() });
    if (settled.ok) await setAlarm(settled.value.nextWakeAt);
  }
  return claimedAny;
}

async function runReconcileRuntime() {
  const reply = await commit({ type: 'scheduler.reconcile', requestId: crypto.randomUUID() });
  if (!reply.ok) return reply;
  await setAlarm(reply.value.nextWakeAt);
  // One read serves both the badge and delivery: an idle wake must not re-read the whole root.
  const state = await snapshot();
  if (!state) return reply;
  await showDueBadge(state);
  const events = state.auctionEvents.filter((event) => event.reminderScope === 'standalone' ||
    state.lots.some((lot) => lot.auctionEventId === event.id && lot.outcome.status === 'open'));
  const plan = reconcileScheduler(events, { alerts: state.alerts }, new Date().toISOString());
  if (await deliverOverdue(plan, state)) await refreshBadge();
  return reply;
}

function reconcileRuntime() {
  const result = reconcileQueue.then(runReconcileRuntime);
  reconcileQueue = result.catch(() => undefined);
  return result;
}

async function processCommand(command) {
  if (command.type === 'scheduler.reconcile') return reconcileRuntime();
  const reply = await commit(command);
  try {
    if (reply.ok && RECONCILE_AFTER.has(command.type)) await reconcileRuntime();
    else if (reply.ok && ['bid.place', 'bid.cancel', 'lot.outcome.set'].includes(command.type)) await refreshBadge();
  } catch {
    // The durable command reply remains authoritative if a recoverable browser effect fails.
  }
  return reply;
}

function createMenus() {
  api.contextMenus.create({ id: MENU_LOOKUP, title: 'Look up “%s” in Giga Pinax', contexts: ['selection'] });
  api.contextMenus.create({ id: MENU_RESEARCH, title: 'Research highlighted coin', contexts: ['selection'] });
  api.contextMenus.create({ id: MENU_TRACK, title: 'Track this auction', contexts: ['selection'] });
}

function registerMenus() {
  const result = menuQueue.then(async () => {
    await invokeExtensionMethod(api.contextMenus.removeAll, api.contextMenus);
    createMenus();
  });
  menuQueue = result.catch(() => undefined);
  return result;
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === LOOKUP_LAUNCH_MESSAGE) {
    if (!isLookupWindowUrl(message.url)) {
      sendResponse({ ok: false, message: 'Invalid lookup window address.' });
      return false;
    }
    showInWindow(api, message.url).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, message: error.message || 'Unable to open the lookup window.' }),
    );
    return true;
  }
  if (message?.type === LOOKUP_MESSAGE || !COMMAND_TYPES.has(message?.type)) return false;
  // Only an extension page sends a command, so the collector is looking at their records.
  void clearCaptureFailure();
  processCommand(message).then(sendResponse, (error) => sendResponse({
    ok: false,
    requestId: message?.requestId ?? '',
    code: 'storage',
    outcome: 'not-committed',
    message: error.message || 'The command failed.',
  }));
  return true;
});

api.runtime.onInstalled.addListener(() => {
  void registerMenus().catch(() => undefined);
  void reconcileRuntime().catch(() => undefined);
});
api.runtime.onStartup.addListener(() => {
  void registerMenus().catch(() => undefined);
  void reconcileRuntime().catch(() => undefined);
});

// No workspace is open when a context menu is used, so the badge is the only place a capture
// that never arrived can be seen without asking for a further permission. The badge on its own
// says nothing, so the toolbar tooltip carries the explanation and what to do about it.
async function showCaptureFailure(title) {
  captureFailed = true;
  try {
    await showBadge('!');
    await invokeExtensionMethod(api.action.setTitle, api.action, { title });
  } catch {
    // A toolbar that will not take the warning leaves the command reply as the only account.
  }
}

// The next capture that works, or the collector opening any extension page, retires the warning.
async function clearCaptureFailure() {
  await captureFailureRecovered;
  if (!captureFailed) return;
  captureFailed = false;
  try {
    // An empty title falls back to the manifest's own, so the tooltip is restored, not blanked.
    await invokeExtensionMethod(api.action.setTitle, api.action, { title: '' });
    await refreshBadge();
  } catch {
    // The stale badge outliving its cause is better than a failed command reply.
  }
}

async function runMenuAction(info) {
  if (info.menuItemId === MENU_LOOKUP) {
    const query = selectionQuery(info.selectionText);
    if (query) await showInWindow(api, popupUrlFor(query));
    return;
  }
  if (info.menuItemId !== MENU_RESEARCH && info.menuItemId !== MENU_TRACK) return;
  const kind = info.menuItemId === MENU_TRACK ? 'auction-capture' : 'research-highlight';
  const rawText = String(info.selectionText ?? '').trim().slice(0, 500);
  const pageUrl = String(info.pageUrl ?? '').slice(0, 2048);
  const requestId = crypto.randomUUID();
  const reply = await processCommand({ type: 'draft.save', requestId, kind, payload: { rawText, pageUrl } });
  if (!reply.ok) {
    await showCaptureFailure(CAPTURE_FAILURE_TITLE);
    return;
  }
  await clearCaptureFailure();
  const route = kind === 'auction-capture' ? 'event-draft' : 'research-draft';
  try {
    await invokeExtensionMethod(api.tabs.create, api.tabs, {
      url: api.runtime.getURL(`workspace.html#${route}=${reply.value.id}`),
    });
  } catch {
    // The draft reached storage: only the window that would have shown it is missing, and telling
    // the collector their capture was lost would send them looking for work they still have.
    await showCaptureFailure(OPEN_FAILURE_TITLE);
  }
}

api.contextMenus.onClicked.addListener((info) => {
  void runMenuAction(info).catch(() => showCaptureFailure(CAPTURE_FAILURE_TITLE));
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCHEDULER_ALARM) void reconcileRuntime().catch(() => undefined);
});

// The notifications API only exists once its optional permission is granted, which can happen
// long after the worker started, so the click handler is registered again on every grant.
let notificationClicksRegistered = false;
function registerNotificationClicks() {
  if (notificationClicksRegistered || !api.notifications?.onClicked) return;
  api.notifications.onClicked.addListener(() => {
    void invokeExtensionMethod(api.tabs.create, api.tabs, {
      url: api.runtime.getURL('workspace.html#auctions'),
    }).catch(() => undefined);
  });
  notificationClicksRegistered = true;
}

registerNotificationClicks();
api.permissions?.onAdded?.addListener(() => registerNotificationClicks());

void registerMenus().catch(() => undefined);
void reconcileRuntime().catch(() => undefined);
