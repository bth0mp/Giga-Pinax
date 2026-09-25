// @ts-check
// The store's side of the reminders: after a command changes an auction or a lot, the alerts are
// brought into line with the triggers the open lots' events derive, and the next wake is planned.
import { deriveReminderTriggers, formerTriggerIds, reconcileScheduler } from './core/reminders.js';
import { baseRecord, getNow } from './store-builders.js';
/**
 * @typedef {import('./core/types.js').Snapshot} Snapshot
 * @typedef {import('./core/types.js').Alert} Alert
 * @typedef {import('./core/types.js').CommandContext} CommandContext
 * @typedef {import('./core/types.js').SchedulePlan} SchedulePlan
 */

const ALERT_STATE_RANK = {
  pending: 0, due: 1, claimed: 2, delivered: 3, missed: 4, snoozed: 5, acknowledged: 6,
};
// The states that hold a decision about a reminder: it was delivered or is being delivered, the collector dismissed or
// snoozed it, or its day passed. An alert in one of them keeps it when the reminder moves (followMovedReminders).
const SETTLED = new Set(['delivered', 'acknowledged', 'missed', 'snoozed', 'claimed']);

/**
 * @param {Alert[]} alerts
 * @returns {Alert[]}
 */
function adoptTriggerIds(alerts) {
  // Alerts written before 0.32 embed the event revision in their trigger ID, so an edited event
  // recreated every alert as pending. Rebuild the current identity from the alert's own fields
  // rather than by parsing the stored string, and keep the collector's decision if two legacy
  // alerts collapse onto one identity.
  const byTrigger = new Map();
  for (const alert of alerts) {
    alert.triggerId = `${alert.eventId}:${alert.reminderId}:${alert.triggerAt}`;
    const kept = byTrigger.get(alert.triggerId);
    if (!kept || ALERT_STATE_RANK[alert.status] > ALERT_STATE_RANK[kept.status]) {
      byTrigger.set(alert.triggerId, alert);
    }
  }
  return [...byTrigger.values()];
}

/**
 * V-04 moved a stamped sale-day reminder from R3's instant, late in the auction's day, to one before 09:00 there. An alert
 * 0.38.0 left settled at the old instant (delivered or being delivered, acknowledged, snoozed or missed) takes the new one
 * and keeps its state and times, so the collector's decision stands: the reminder does not ring twice, a snooze ends when
 * asked, and a delivery in flight waits for its retry. One still to ring (pending or due) is left to be replaced, and
 * rings at the new instant. An alert already at the new instant, as a merge can bring, is kept and the old one dropped. Nothing else moves: a trigger that R3 and V-04 place alike, an unstamped reminder, or an
 * alert already at the new instant. The alerts are changed in place.
 * @param {Alert[]} alerts
 * @param {import('./core/types.js').AuctionEvent[]} events
 * @param {Map<string, import('./core/types.js').ReminderTrigger>} triggersById
 * @param {string} now
 * @returns {void}
 */
function followMovedReminders(alerts, events, triggersById, now) {
  const moved = formerTriggerIds(events);
  if (moved.size === 0) return;
  const byTrigger = new Map(alerts.map((alert) => [alert.triggerId, alert]));
  for (const [triggerId, formerId] of moved) {
    const alert = byTrigger.get(formerId);
    const trigger = triggersById.get(triggerId);
    if (!alert || !trigger || byTrigger.has(triggerId) || !SETTLED.has(alert.status)) continue;
    alert.triggerId = triggerId;
    alert.triggerAt = trigger.triggerAt;
    alert.revision += 1;
    alert.updatedAt = now;
  }
}

/**
 * Brings the alerts and the scheduler of a root being written into line with its events; the root is
 * changed in place and the plan it was reconciled to is returned.
 * @param {Snapshot} next
 * @param {CommandContext} context
 * @returns {SchedulePlan}
 */
function reconcileIntoSnapshot(next, context) {
  const now = getNow(context);
  const events = next.auctionEvents.filter((event) => event.reminderScope === 'standalone' ||
    next.lots.some((lot) => lot.auctionEventId === event.id && lot.outcome.status === 'open'));
  const triggers = deriveReminderTriggers(events, now);
  const triggersById = new Map(triggers.map((trigger) => [trigger.id, trigger]));
  next.alerts = adoptTriggerIds(next.alerts);
  followMovedReminders(next.alerts, events, triggersById, now);
  next.alerts = next.alerts.filter((alert) => triggersById.has(alert.triggerId));
  const existing = new Set(next.alerts.map(({ triggerId }) => triggerId));
  for (const trigger of triggers) {
    if (existing.has(trigger.id)) continue;
    next.alerts.push(baseRecord({
      triggerId: trigger.id,
      eventId: trigger.eventId,
      eventRevision: trigger.eventRevision,
      reminderId: trigger.reminderId,
      triggerAt: trigger.triggerAt,
      status: 'pending',
    }, context));
  }
  const plan = reconcileScheduler(events, { alerts: next.alerts }, now);
  const missed = new Set(plan.missedTriggerIds);
  const due = new Set(Object.values(plan.overdueByEvent).flat().map(({ id }) => id));
  for (const alert of next.alerts) {
    let status = alert.status;
    if (missed.has(alert.triggerId)) status = 'missed';
    else if (due.has(alert.triggerId) && (['pending', 'snoozed'].includes(status) ||
      // A claimed alert carries its claim time (records.js alertResult).
      (status === 'claimed' && Date.parse(/** @type {string} */ (alert.claimedAt)) + 5 * 60 * 1000 <= Date.parse(now)))) status = 'due';
    // The event revision is copied onto the alert for display, so a surviving alert refreshes it.
    const eventRevision = triggersById.get(alert.triggerId)?.eventRevision ?? alert.eventRevision;
    if (status === alert.status && eventRevision === alert.eventRevision) continue;
    if (status !== alert.status && status === 'missed') alert.missedAt = now;
    alert.status = status;
    alert.eventRevision = eventRevision;
    alert.revision += 1;
    alert.updatedAt = now;
  }
  next.scheduler = {
    revision: next.scheduler.revision + 1,
    nextWakeAt: plan.nextWakeAt,
    lastReconciledAt: now,
  };
  return plan;
}

/**
 * The collector's zone, from the context the writer runs in (background.js gives the browser's), or null where it gives
 * none the browser can read.
 * @param {CommandContext} context
 * @returns {string | null}
 */
function collectorZone(context) {
  try {
    const zone = typeof context.timeZone === 'function' ? context.timeZone() : context.timeZone;
    if (typeof zone !== 'string' || !zone) return null;
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
    return zone;
  } catch {
    return null;
  }
}

/**
 * Q-19: a date-only reminder the collector sets rings on their clock from then on, so it takes the collector's zone
 * (reminders.js). A reminder is set when it is new, when its own day count or time changed, or when its auction's sale
 * day or time zone did. Any other reminder keeps what it holds - its stored zone, or none - so a rename or a note never
 * moves a reminder or brings back one already acknowledged (review Important 1); the workspace form sends reminders back
 * without the field, so it is taken from the stored record, not the draft. Only a save does this: a reconcile, a load or
 * an import leaves the reminders an auction holds as they are. The event is changed in place.
 * @param {import('./core/types.js').AuctionEvent} event
 * @param {import('./core/types.js').AuctionEvent | null} existing the auction as stored before this save, or null for a new one
 * @param {CommandContext} context
 * @returns {void}
 */
function ringOnCollectorClock(event, existing, context) {
  if (event.precision !== 'date-only') return;
  const zone = collectorZone(context);
  const dayMoved = !existing || existing.precision !== 'date-only' || existing.localDate !== event.localDate ||
    existing.timeZone !== event.timeZone;
  for (const reminder of event.reminders) {
    if (reminder.kind !== 'wall-time') continue;
    const before = dayMoved ? undefined : existing?.reminders.find(({ id }) => id === reminder.id);
    if (before?.kind === 'wall-time' && before.daysBefore === reminder.daysBefore && before.localTime === reminder.localTime) {
      if (before.collectorTimeZone === undefined) delete reminder.collectorTimeZone;
      else reminder.collectorTimeZone = before.collectorTimeZone;
    } else if (zone !== null) reminder.collectorTimeZone = zone;
  }
}

export { reconcileIntoSnapshot, ringOnCollectorClock };
