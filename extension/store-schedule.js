// @ts-check
// The store's side of the reminders: after a command changes an auction or a lot, the alerts are
// brought into line with the triggers the open lots' events derive, and the next wake is planned.
import { deriveReminderTriggers, reconcileScheduler } from './core/reminders.js';
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
  next.alerts = adoptTriggerIds(next.alerts).filter((alert) => triggersById.has(alert.triggerId));
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

export { reconcileIntoSnapshot };
