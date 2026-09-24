import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveReminderTriggers,
  reconcileScheduler,
  resolveZonedDateTime,
} from '../extension/core/reminders.js';

const eventId = '11111111-1111-4111-8111-111111111111';
const reminderA = '22222222-2222-4222-8222-111111111111';
const reminderB = '22222222-2222-4222-8222-222222222222';

// An offset subtracted from a date near the start of the era lands outside the years an ISO instant can spell, and the
// expanded form Date gives back ("-000001-12-31T23:00:00.000Z") is no timestamp any record may hold. The trigger is
// dropped exactly as an unresolvable wall time is: one reminder is lost, not every reminder in the store.
test('a trigger that lands outside the instants a record can hold is skipped, not derived', () => {
  const triggers = deriveReminderTriggers([
    {
      id: eventId, revision: 0, name: 'Year zero', precision: 'timed', startsAt: '0000-01-01T00:00:00.000Z',
      localDate: '0000-01-01', localTime: '00:00', timeZone: 'UTC',
      reminders: [{ id: reminderA, kind: 'offset', offsetMinutes: 60 }, { id: reminderB, kind: 'offset', offsetMinutes: 0 }],
    },
  ], '2026-09-12T12:00:00.000Z');
  assert.deepEqual(triggers.map(({ reminderId }) => reminderId), [reminderB]);
  assert.equal(triggers[0].triggerAt, '0000-01-01T00:00:00.000Z');
});

// A timed event stays relevant a quarter of an hour past its start, and for one after 23:45 on the last day an instant
// can spell, that end is in year 10000 - written "+010000-…", which sorts before every ordinary instant. The reminder
// was reported missed eight thousand years early, and the wake time after an overdue one was no instant at all.
test('an event at the very end of the instants a record can hold is neither missed early nor woken at no instant', () => {
  const event = {
    id: eventId, revision: 0, name: 'Last sale', precision: 'timed', startsAt: '9999-12-31T23:50:00.000Z',
    localDate: '9999-12-31', localTime: '23:50', timeZone: 'UTC', reminders: [{ id: reminderA, kind: 'offset', offsetMinutes: 0 }],
  };
  const waiting = reconcileScheduler([event], { alerts: [] }, '2026-09-12T12:00:00.000Z');
  assert.deepEqual(waiting.missedTriggerIds, []);
  assert.equal(waiting.nextWakeAt, '9999-12-31T23:50:00.000Z');

  const overdue = reconcileScheduler([event], { alerts: [] }, '9999-12-31T23:55:00.000Z');
  assert.deepEqual(overdue.missedTriggerIds, []);
  assert.deepEqual(Object.keys(overdue.overdueByEvent), [eventId]);
  assert.equal(overdue.nextWakeAt, '9999-12-31T23:59:59.999Z', 'the wake time is still an instant a record can hold');
});

test('resolves a unique London local time and rejects DST gaps and overlaps', () => {
  assert.deepEqual(resolveZonedDateTime({
    localDate: '2026-02-10', localTime: '10:30', timeZone: 'Europe/London', disambiguation: 'reject',
  }), { ok: true, value: { startsAt: '2026-02-10T10:30:00.000Z' } });
  assert.equal(resolveZonedDateTime({
    localDate: '2026-03-29', localTime: '01:30', timeZone: 'Europe/London', disambiguation: 'reject',
  }).error.code, 'nonexistent');
  assert.equal(resolveZonedDateTime({
    localDate: '2026-10-25', localTime: '01:30', timeZone: 'Europe/London', disambiguation: 'reject',
  }).error.code, 'ambiguous');
  assert.equal(resolveZonedDateTime({
    localDate: '03/04/26', localTime: '10:00', timeZone: 'Europe/London', disambiguation: 'reject',
  }).error.code, 'invalid-date');
  assert.equal(resolveZonedDateTime({
    localDate: '2026-01-01', localTime: '10:00', timeZone: 'Mars/Olympus', disambiguation: 'reject',
  }).error.code, 'invalid-time-zone');
});

test('derives timed and date-only reminders with identities that survive an event edit', () => {
  const timed = {
    id: eventId, revision: 3, name: 'Timed', precision: 'timed',
    startsAt: '2026-10-10T12:00:00.000Z', timeZone: 'Europe/London', localDate: '2026-10-10',
    reminders: [{ id: reminderA, kind: 'offset', offsetMinutes: 60 }],
  };
  const dateOnly = {
    id: '33333333-3333-4333-8333-333333333333', revision: 1, name: 'Day', precision: 'date-only',
    timeZone: 'Europe/London', localDate: '2027-01-01',
    reminders: [{ id: reminderB, kind: 'wall-time', daysBefore: 1, localTime: '09:00' }],
  };
  const triggers = deriveReminderTriggers([timed, dateOnly], '2026-01-01T00:00:00.000Z');
  assert.equal(triggers[0].triggerAt, '2026-10-10T11:00:00.000Z');
  assert.equal(triggers[0].id, `${eventId}:${reminderA}:2026-10-10T11:00:00.000Z`);
  assert.equal(triggers[1].triggerAt, '2026-12-31T09:00:00.000Z');

  const renamed = deriveReminderTriggers([{ ...timed, revision: 4, name: 'Renamed' }], '2026-01-01T00:00:00.000Z');
  assert.equal(renamed[0].id, triggers[0].id);
  assert.equal(renamed[0].eventRevision, 4);
});

test('reconciliation returns one next wake, overdue batches, and expired precise reminders', () => {
  const event = {
    id: eventId, revision: 0, name: 'Sale', precision: 'timed', timeZone: 'UTC',
    localDate: '2026-09-12', startsAt: '2026-09-12T12:00:00.000Z',
    reminders: [
      { id: reminderA, kind: 'offset', offsetMinutes: 60 },
      { id: reminderB, kind: 'offset', offsetMinutes: 10 },
    ],
  };
  const before = reconcileScheduler([event], { alerts: [] }, '2026-09-12T10:00:00.000Z');
  assert.equal(before.nextWakeAt, '2026-09-12T11:00:00.000Z');

  const due = reconcileScheduler([event], { alerts: [] }, '2026-09-12T11:55:00.000Z');
  assert.equal(due.overdueByEvent[eventId].length, 2);
  assert.equal(due.nextWakeAt, '2026-09-12T12:15:00.001Z');

  const trigger = deriveReminderTriggers([event])[0];
  const claimed = reconcileScheduler([event], { alerts: [{
    triggerId: trigger.id, status: 'claimed', claimedAt: '2026-09-12T11:54:30.000Z',
  }] }, '2026-09-12T11:55:00.000Z');
  assert.equal(claimed.overdueByEvent[eventId].some(({ id }) => id === trigger.id), false);
  assert.equal(claimed.nextWakeAt, '2026-09-12T11:59:30.000Z');

  const expired = reconcileScheduler([event], { alerts: [] }, '2026-09-12T12:16:00.000Z');
  assert.equal(expired.missedTriggerIds.length, 2);
  assert.equal(expired.overdueByEvent[eventId], undefined);
});

test('an evening reminder survives a local midnight that does not exist or happens twice', () => {
  const santiago = {
    id: eventId, revision: 0, name: 'Santiago sale', precision: 'date-only',
    timeZone: 'America/Santiago', localDate: '2026-09-05',
    reminders: [{ id: reminderA, kind: 'wall-time', daysBefore: 0, localTime: '20:00' }],
  };
  assert.equal(deriveReminderTriggers([santiago])[0].triggerAt, '2026-09-06T00:00:00.000Z');
  const plan = reconcileScheduler([santiago], { alerts: [] }, '2026-09-06T00:30:00.000Z');
  assert.equal(plan.missedTriggerIds.length, 0);
  assert.equal(plan.overdueByEvent[eventId].length, 1);
  assert.equal(plan.nextWakeAt, '2026-09-06T04:00:00.001Z');

  const havana = {
    ...santiago, timeZone: 'America/Havana', localDate: '2026-10-31',
    reminders: [{ id: reminderA, kind: 'wall-time', daysBefore: 0, localTime: '21:00' }],
  };
  const ambiguous = reconcileScheduler([havana], { alerts: [] }, '2026-11-01T04:30:00.000Z');
  assert.equal(ambiguous.missedTriggerIds.length, 0);
  assert.equal(ambiguous.nextWakeAt, '2026-11-01T05:00:00.001Z');
});

test('date-only reminders remain actionable through the confirmed local event day', () => {
  const event = {
    id: eventId, revision: 0, name: 'Auction day', precision: 'date-only', timeZone: 'Europe/London',
    localDate: '2026-09-12',
    reminders: [{ id: reminderA, kind: 'wall-time', daysBefore: 0, localTime: '09:00' }],
  };
  const plan = reconcileScheduler([event], { alerts: [] }, '2026-09-12T20:00:00.000Z');
  assert.equal(plan.overdueByEvent[eventId].length, 1);
});
