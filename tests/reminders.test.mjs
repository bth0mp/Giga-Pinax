import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveReminderTriggers,
  reconcileScheduler,
  reminderNotice,
  resolveZonedDateTime,
  zonePlace,
} from '../extension/core/reminders.js';
import { STORAGE_KEY, createCommandWriter } from '../extension/store.js';

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

// N14: a zone is named as a collector says it - the place in its IANA name - and only a zone with no place keeps its id.
test('a time zone is named by its place', () => {
  assert.equal(zonePlace('Europe/London'), 'London');
  assert.equal(zonePlace('America/New_York'), 'New York');
  assert.equal(zonePlace('America/Argentina/Buenos_Aires'), 'Buenos Aires');
  assert.equal(zonePlace('UTC'), 'UTC');
  assert.equal(zonePlace('Etc/UTC'), 'UTC');
  assert.equal(zonePlace('Etc/GMT-2'), 'Etc/GMT-2');
  assert.equal(zonePlace(''), '');
  assert.equal(zonePlace(undefined), '');
});

// N14 (lead's decision): a date-only sale day is a calendar day in the auction's zone and its reminders still go off at
// their wall time there, so the notification names the sale day and the auction's place, and the reminder's time on the
// auction's clock and on the collector's. The zone is named only when it is not the collector's own.
test('a date-only reminder’s notification names the sale day, the auction’s place and both clocks', () => {
  const trigger = (triggerAt) => ({
    id: 'x', eventId, eventRevision: 0, reminderId: reminderA, triggerAt, eventName: 'Nomos 30',
    precision: /** @type {const} */ ('date-only'), localDate: '2026-10-02', timeZone: 'Europe/London',
  });
  const onTheDay = trigger('2026-10-02T08:00:00.000Z');
  const dayBefore = trigger('2026-10-01T08:00:00.000Z');
  const view = (timeZone) => ({ eventKind: 'auction-day', timeZone, locale: 'en-GB' });
  assert.equal(reminderNotice(onTheDay, view('Europe/Berlin')), 'Sale day Fri 2 Oct (London) — reminder for 9:00 London, 10:00 your time');
  assert.equal(reminderNotice(dayBefore, view('Europe/Berlin')), 'Sale day Fri 2 Oct (London) — reminder for Thu 1 Oct 9:00 London, 10:00 your time');
  // 09:00 in London on the sale day is still the evening before in Honolulu, and the collector's day is named.
  assert.equal(reminderNotice(onTheDay, view('Pacific/Honolulu')), 'Sale day Fri 2 Oct (London) — reminder for 9:00 London, Thu 1 Oct 22:00 your time');
  assert.equal(reminderNotice(onTheDay, view('Europe/London')), 'Sale day Fri 2 Oct — reminder for 9:00 your time');
  assert.equal(reminderNotice(dayBefore, view('Europe/London')), 'Sale day Fri 2 Oct — reminder for Thu 1 Oct 9:00 your time');
});

test('a timed reminder’s notification names the auction’s time and place and the collector’s time', () => {
  const trigger = {
    id: 'x', eventId, eventRevision: 0, reminderId: reminderA, triggerAt: '2026-10-16T11:00:00.000Z', eventName: 'Leu Web Auction 32',
    precision: /** @type {const} */ ('timed'), eventStartsAt: '2026-10-16T12:00:00.000Z', localDate: '2026-10-16', timeZone: 'Europe/Zurich',
  };
  const view = (timeZone, eventKind = 'lot-closes') => ({ eventKind, timeZone, locale: 'en-GB' });
  assert.equal(reminderNotice(trigger, view('America/New_York')), 'Closes Fri 16 Oct, 14:00 (Zurich) — 8:00 your time');
  assert.equal(reminderNotice(trigger, view('Pacific/Auckland')), 'Closes Fri 16 Oct, 14:00 (Zurich) — Sat 17 Oct 1:00 your time');
  assert.equal(reminderNotice(trigger, view('Europe/Zurich', 'auction-starts')), 'Starts Fri 16 Oct, 14:00 your time');
  // An event whose kind is not known reads as an auction, and a zone no browser knows never throws.
  assert.equal(reminderNotice(trigger, { timeZone: 'Europe/Zurich', locale: 'en-GB' }), 'Auction Fri 16 Oct, 14:00 your time');
  const unknownZone = reminderNotice({ ...trigger, timeZone: 'Mars/Olympus' }, view('Europe/Zurich'));
  assert.match(unknownZone, /^Closes 2026-10-16/);
  // The collector's language decides how a date and a time are written.
  assert.equal(reminderNotice(trigger, { eventKind: 'lot-closes', timeZone: 'America/New_York', locale: 'en-US' }),
    'Closes Fri, Oct 16, 2:00 PM (Zurich) — 8:00 AM your time');
});

// N14: the reminders a 0.35.0 store holds keep their instants. A date-only reminder at 09:00 still goes off at 09:00 in
// the auction's zone, whatever the collector's zone, and every alert already stored keeps its identity and its state.
// The root below is what 0.35.0 wrote for a London sale day and a Zurich lot closing (its command ledger left out).
const STORE_0_35_0 = {"schemaVersion":2,"revision":3,"updatedAt":"2026-09-30T08:30:00.000Z","preferences":null,"lots":[],"auctionEvents":[{"id":"00000000-0000-4000-8000-000000000002","revision":0,"dataClass":"collector","createdAt":"2026-09-24T12:00:00.000Z","updatedAt":"2026-09-24T12:00:00.000Z","name":"Nomos 30","eventKind":"auction-day","precision":"date-only","localDate":"2026-10-01","timeZone":"Europe/London","reminderScope":"standalone","reminders":[{"kind":"wall-time","daysBefore":1,"localTime":"09:00","id":"00000000-0000-4000-8000-000000000003"},{"kind":"wall-time","daysBefore":0,"localTime":"09:00","id":"00000000-0000-4000-8000-000000000004"}]},{"id":"00000000-0000-4000-8000-000000000006","revision":0,"dataClass":"collector","createdAt":"2026-09-24T12:00:00.000Z","updatedAt":"2026-09-24T12:00:00.000Z","name":"Leu Web Auction 32","eventKind":"lot-closes","precision":"timed","localDate":"2026-10-16","localTime":"14:00","timeZone":"Europe/Zurich","startsAt":"2026-10-16T12:00:00.000Z","reminderScope":"standalone","reminders":[{"kind":"offset","offsetMinutes":1440,"id":"00000000-0000-4000-8000-000000000007"},{"kind":"offset","offsetMinutes":60,"id":"00000000-0000-4000-8000-000000000008"}]}],"alternativeGroups":[],"evidence":[],"collectionEntries":[],"drafts":[],"alerts":[{"id":"00000000-0000-4000-8000-000000000010","revision":1,"dataClass":"collector","createdAt":"2026-09-30T08:30:00.000Z","updatedAt":"2026-09-30T08:30:00.000Z","triggerId":"00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003:2026-09-30T08:00:00.000Z","eventId":"00000000-0000-4000-8000-000000000002","eventRevision":0,"reminderId":"00000000-0000-4000-8000-000000000003","triggerAt":"2026-09-30T08:00:00.000Z","status":"due"},{"id":"00000000-0000-4000-8000-000000000011","revision":0,"dataClass":"collector","createdAt":"2026-09-30T08:30:00.000Z","updatedAt":"2026-09-30T08:30:00.000Z","triggerId":"00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000004:2026-10-01T08:00:00.000Z","eventId":"00000000-0000-4000-8000-000000000002","eventRevision":0,"reminderId":"00000000-0000-4000-8000-000000000004","triggerAt":"2026-10-01T08:00:00.000Z","status":"pending"},{"id":"00000000-0000-4000-8000-000000000012","revision":0,"dataClass":"collector","createdAt":"2026-09-30T08:30:00.000Z","updatedAt":"2026-09-30T08:30:00.000Z","triggerId":"00000000-0000-4000-8000-000000000006:00000000-0000-4000-8000-000000000007:2026-10-15T12:00:00.000Z","eventId":"00000000-0000-4000-8000-000000000006","eventRevision":0,"reminderId":"00000000-0000-4000-8000-000000000007","triggerAt":"2026-10-15T12:00:00.000Z","status":"pending"},{"id":"00000000-0000-4000-8000-000000000013","revision":0,"dataClass":"collector","createdAt":"2026-09-30T08:30:00.000Z","updatedAt":"2026-09-30T08:30:00.000Z","triggerId":"00000000-0000-4000-8000-000000000006:00000000-0000-4000-8000-000000000008:2026-10-16T11:00:00.000Z","eventId":"00000000-0000-4000-8000-000000000006","eventRevision":0,"reminderId":"00000000-0000-4000-8000-000000000008","triggerAt":"2026-10-16T11:00:00.000Z","status":"pending"}],"scheduler":{"revision":1,"nextWakeAt":"2026-10-01T08:00:00.000Z","lastReconciledAt":"2026-09-30T08:30:00.000Z"},"recentCommands":[]};

test('reminders stored by 0.35.0 keep their instants and their alerts', async () => {
  const stored = STORE_0_35_0.alerts.map(({ triggerId, triggerAt, status }) => ({ triggerId, triggerAt, status }));
  assert.deepEqual(deriveReminderTriggers(/** @type {*} */ (STORE_0_35_0.auctionEvents)).map(({ id, triggerAt }) => ({ id, triggerAt })),
    stored.map(({ triggerId, triggerAt }) => ({ id: triggerId, triggerAt })));

  let value = structuredClone(STORE_0_35_0);
  const storage = {
    async get(key) { return { [key]: structuredClone(value) }; },
    async set(items) { value = structuredClone(items[STORAGE_KEY]); },
  };
  let now = '2026-09-30T20:00:00.000Z';
  let nextId = 100;
  const writer = createCommandWriter(storage, { now: () => now, newId: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}` });
  const reconcile = () => writer.commitCommand({ type: 'scheduler.reconcile', requestId: crypto.randomUUID() });
  const evening = await reconcile();
  assert.equal(evening.ok, true, evening.message);
  assert.equal(evening.value.nextWakeAt, '2026-10-01T08:00:00.000Z', '09:00 in London on the sale day, as 0.35.0 set it');
  assert.deepEqual(value.alerts.map(({ triggerId, triggerAt, status }) => ({ triggerId, triggerAt, status })), stored);

  now = '2026-10-01T08:00:30.000Z';
  const saleDay = await reconcile();
  assert.equal(saleDay.ok, true, saleDay.message);
  assert.deepEqual(value.alerts.map(({ triggerId, triggerAt, status }) => ({ triggerId, triggerAt, status })),
    stored.map((alert, index) => (index === 1 ? { ...alert, status: 'due' } : alert)));
});
