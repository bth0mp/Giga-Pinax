import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveReminderTriggers,
  localDateAtInstant,
  reconcileScheduler,
  reminderNotice,
  resolveZonedDateTime,
  sameZone,
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

// N14: a zone is named as a collector says it - the place in its IANA name - and a zone with no place by its offset.
test('a time zone is named by its place', () => {
  assert.equal(zonePlace('Europe/London'), 'London');
  assert.equal(zonePlace('America/New_York'), 'New York');
  assert.equal(zonePlace('America/Argentina/Buenos_Aires'), 'Buenos Aires');
  assert.equal(zonePlace('UTC'), 'UTC');
  assert.equal(zonePlace('Etc/UTC'), 'UTC');
  // Review Minor 2: a zone with no place reads as its offset, never as an Etc id whose sign is the other way round.
  assert.equal(zonePlace('Etc/GMT+5'), 'GMT-5');
  assert.equal(zonePlace('Etc/GMT-2'), 'GMT+2');
  assert.equal(zonePlace('Etc/GMT+0'), 'UTC');
  assert.equal(zonePlace('Etc/Unknown'), 'Etc/Unknown');
  assert.equal(zonePlace(''), '');
  assert.equal(zonePlace(undefined), '');
});

// Review Minor 1: two names of one zone are the same zone, so an Etc/UTC auction is not "another zone" to a UTC browser.
test('two names of one time zone are the same zone', () => {
  assert.equal(sameZone('UTC', 'Etc/UTC'), true);
  assert.equal(sameZone('Etc/GMT', 'UTC'), true);
  assert.equal(sameZone('Europe/London', 'Europe/London'), true);
  assert.equal(sameZone('Europe/London', 'Europe/Dublin'), false);
  // A name no browser knows is compared as it is written.
  assert.equal(sameZone('Mars/Olympus', 'Mars/Olympus'), true);
  assert.equal(sameZone('Mars/Olympus', 'UTC'), false);
  const trigger = {
    id: 'x', eventId, eventRevision: 0, reminderId: reminderA, triggerAt: '2026-10-02T09:00:00.000Z', eventName: 'Nomos 30',
    precision: /** @type {const} */ ('date-only'), localDate: '2026-10-02', timeZone: 'Etc/UTC',
  };
  assert.doesNotMatch(reminderNotice(trigger, { eventKind: 'auction-day', timeZone: 'UTC', locale: 'en-GB' }), /UTC/);
});

// N14 (lead's decision): a date-only sale day is a calendar day in the auction's zone and its reminders still go off at
// their wall time there, so the notification names the sale day and the reminder's time on the collector's clock and on
// the auction's, with its place. Review Minor 3: the collector's clock comes first, so a banner that cuts the text keeps
// it. A day is named where it is not the sale day (yours) or not your day (the auction's). The zone is named only when
// it is not the collector's own.
test('a date-only reminder’s notification names the sale day, your clock, then the auction’s clock and place', () => {
  const trigger = (triggerAt) => ({
    id: 'x', eventId, eventRevision: 0, reminderId: reminderA, triggerAt, eventName: 'Nomos 30',
    precision: /** @type {const} */ ('date-only'), localDate: '2026-10-02', timeZone: 'Europe/London',
  });
  const onTheDay = trigger('2026-10-02T08:00:00.000Z');
  const dayBefore = trigger('2026-10-01T08:00:00.000Z');
  const view = (timeZone) => ({ eventKind: 'auction-day', timeZone, locale: 'en-GB' });
  assert.equal(reminderNotice(onTheDay, view('Europe/Berlin')), 'Sale day Fri 2 Oct — 10:00 your time, 9:00 London');
  assert.equal(reminderNotice(dayBefore, view('Europe/Berlin')), 'Sale day Fri 2 Oct — Thu 1 Oct 10:00 your time, 9:00 London');
  // 09:00 in London on the sale day is still the evening before in Honolulu: both days are named.
  assert.equal(reminderNotice(onTheDay, view('Pacific/Honolulu')), 'Sale day Fri 2 Oct — Thu 1 Oct 22:00 your time, Fri 2 Oct 9:00 London');
  // 23:30 in London the evening before is already the sale day's morning in Sydney.
  assert.equal(reminderNotice(trigger('2026-10-01T22:30:00.000Z'), view('Australia/Sydney')), 'Sale day Fri 2 Oct — 8:30 your time, Thu 1 Oct 23:30 London');
  assert.equal(reminderNotice(onTheDay, view('Europe/London')), 'Sale day Fri 2 Oct — 9:00 your time');
  assert.equal(reminderNotice(dayBefore, view('Europe/London')), 'Sale day Fri 2 Oct — Thu 1 Oct 9:00 your time');
});

test('a timed reminder’s notification names the auction’s time on your clock, then on its own with its place', () => {
  const trigger = {
    id: 'x', eventId, eventRevision: 0, reminderId: reminderA, triggerAt: '2026-10-16T11:00:00.000Z', eventName: 'Leu Web Auction 32',
    precision: /** @type {const} */ ('timed'), eventStartsAt: '2026-10-16T12:00:00.000Z', localDate: '2026-10-16', timeZone: 'Europe/Zurich',
  };
  const view = (timeZone, eventKind = 'lot-closes') => ({ eventKind, timeZone, locale: 'en-GB' });
  assert.equal(reminderNotice(trigger, view('America/New_York')), 'Closes Fri 16 Oct, 8:00 your time — 14:00 Zurich');
  assert.equal(reminderNotice(trigger, view('Pacific/Auckland')), 'Closes Sat 17 Oct, 1:00 your time — Fri 16 Oct 14:00 Zurich');
  assert.equal(reminderNotice(trigger, view('Europe/Zurich', 'auction-starts')), 'Starts Fri 16 Oct, 14:00 your time');
  // An event whose kind is not known reads as an auction, and a zone no browser knows never throws or names a clock it
  // cannot read.
  assert.equal(reminderNotice(trigger, { timeZone: 'Europe/Zurich', locale: 'en-GB' }), 'Auction Fri 16 Oct, 14:00 your time');
  assert.equal(reminderNotice({ ...trigger, timeZone: 'Mars/Olympus' }, view('Europe/Zurich')), 'Closes Fri 16 Oct, 14:00 your time');
  // The collector's language decides how a date and a time are written.
  assert.equal(reminderNotice(trigger, { eventKind: 'lot-closes', timeZone: 'America/New_York', locale: 'en-US' }),
    'Closes Fri, Oct 16, 8:00 AM your time — 2:00 PM Zurich');
});

// Review Minor 3: a macOS banner shows about two lines, some 90 characters. In en-US, for the zones with the longest place
// names and collectors on either side of the date line, every notice stays within 90 characters and your clock within
// the first 60.
test('a reminder’s notification stays short enough for a banner, with your clock near the start', () => {
  const places = Intl.supportedValuesOf('timeZone').filter((zone) => zone.includes('/') && !zone.startsWith('Etc/'))
    .sort((left, right) => zonePlace(right).length - zonePlace(left).length || left.localeCompare(right)).slice(0, 6);
  const viewers = ['Pacific/Honolulu', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Pacific/Kiritimati'];
  let longest = '';
  for (const timeZone of [...places, 'America/Argentina/Buenos_Aires']) {
    const events = [{
      id: eventId, revision: 0, name: 'Sale', eventKind: 'auction-day', precision: 'date-only', localDate: '2026-09-30', timeZone,
      reminders: ['00:30', '12:30', '23:30'].flatMap((localTime, index) => [0, 1, 2].map((daysBefore) => (
        { id: `${index}${daysBefore}`, kind: 'wall-time', daysBefore, localTime }))),
    }, ...['00:30', '12:30', '23:30'].map((localTime) => {
      const resolved = resolveZonedDateTime({ localDate: '2026-09-30', localTime, timeZone, disambiguation: 'reject' });
      return { id: eventId, revision: 0, name: 'Lot', eventKind: 'lot-closes', precision: 'timed', localDate: '2026-09-30', localTime, timeZone,
        startsAt: resolved.ok ? resolved.value.startsAt : '', reminders: [{ id: 'r', kind: 'offset', offsetMinutes: 60 }] };
    }).filter(({ startsAt }) => startsAt)];
    for (const event of events) {
      for (const trigger of deriveReminderTriggers(/** @type {*} */ ([event]))) {
        for (const viewer of viewers) {
          const notice = reminderNotice(trigger, { eventKind: event.eventKind, timeZone: viewer, locale: 'en-US' });
          assert.ok(notice.indexOf('your time') + 'your time'.length <= 60, notice);
          if (notice.length > longest.length) longest = notice;
        }
      }
    }
  }
  assert.ok(longest.length <= 90, `${longest.length}: ${longest}`);
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

// Q-19 (lead's rule), bounded by V-04: a date-only reminder saved from now on rings on the collector's own clock. The zone
// is the one it was saved with (`collectorTimeZone`), never read again, so a reminder does not move under a stored alert.
// - The sale-day reminder ("Auction day", 0 days before) rings before the sale day's business starts where the auction
//   is: between the day's start and 09:00 there. Inside that, at its own time on the collector's clock (the latest such
//   instant); where none falls inside, at the latest minute between 08:00 and 21:00 on their clock; else at 09:00 there.
// - The day-before reminder ("Previous day") keeps R3's rule: its own time on the latest of the collector's days that
//   still falls inside the day before the sale day where the auction is; else the latest waking minute; else that day's start.
const dateOnlyDay = (timeZone, localDate, reminders) => ({
  id: eventId, revision: 0, name: 'Sale', eventKind: 'auction-day', precision: /** @type {const} */ ('date-only'),
  localDate, timeZone, reminderScope: 'standalone', reminders,
});
const onCollectorClock = (collectorTimeZone, daysBefore, localTime = '09:00') => (
  { id: daysBefore === 0 ? reminderA : reminderB, kind: 'wall-time', daysBefore, localTime, collectorTimeZone });
const ringsAt = (event) => deriveReminderTriggers(/** @type {*} */ ([event])).map(({ reminderId, triggerAt }) => [reminderId, triggerAt]);

test('a date-only sale day in Zurich reminds a New York collector the evening before it opens, not at 03:00', () => {
  const event = dateOnlyDay('Europe/Zurich', '2026-10-23', [onCollectorClock('America/New_York', 1), onCollectorClock('America/New_York', 0)]);
  assert.deepEqual(ringsAt(event), [
    [reminderB, '2026-10-22T13:00:00.000Z'], // Thu 22 Oct 09:00 New York, 15:00 Zurich (the day before)
    [reminderA, '2026-10-23T01:00:00.000Z'], // Thu 22 Oct 21:00 New York, Fri 03:00 Zurich (before the sale's morning)
  ]);
  // A reminder saved before Q-19, with no collector zone, keeps its instant: 09:00 Zurich, 03:00 New York.
  assert.deepEqual(ringsAt(dateOnlyDay('Europe/Zurich', '2026-10-23', [{ id: reminderA, kind: 'wall-time', daysBefore: 0, localTime: '09:00' }])),
    [[reminderA, '2026-10-23T07:00:00.000Z']]);
});

// V-04: R3's rule took the latest collector 09:00 inside the whole sale day, which for an auction east of the collector
// is the auction's evening, after the lots have closed.
test('a sale-day reminder never rings after 09:00 where the auction is', () => {
  // Taisei, Tokyo, Sun 11 Oct: R3 rang Sun 09:00 New York, 22:00 Tokyo. Now Sat 20:00 New York, Sun 09:00 Tokyo.
  assert.deepEqual(ringsAt(dateOnlyDay('Asia/Tokyo', '2026-10-11', [onCollectorClock('America/New_York', 1), onCollectorClock('America/New_York', 0)])),
    [[reminderB, '2026-10-10T13:00:00.000Z'], [reminderA, '2026-10-11T00:00:00.000Z']]);
  // Künker, Berlin, Tue 6 Oct, for a Los Angeles collector: 09:00 Berlin is 00:00 Los Angeles, and the day starts at
  // 15:00 Los Angeles on the 5th, so the latest waking minute is 21:00 Los Angeles on the 5th, 06:00 Berlin.
  assert.deepEqual(ringsAt(dateOnlyDay('Europe/Berlin', '2026-10-06', [onCollectorClock('America/Los_Angeles', 0)])),
    [[reminderA, '2026-10-06T04:00:00.000Z']]);
  // Noble, Sydney, for a London collector: Sydney's day starts at 15:00 London and its 09:00 is midnight London, so the
  // reminder rings at 21:00 London, 06:00 Sydney.
  assert.deepEqual(ringsAt(dateOnlyDay('Australia/Sydney', '2026-07-22', [onCollectorClock('Europe/London', 0)])),
    [[reminderA, '2026-07-21T20:00:00.000Z']]);
  // Auckland's sale for a New York collector on New Zealand's spring-forward day (27 Sep 2026: its midnight is 12:00Z on
  // the 26th, its 09:00 is 20:00Z): New York's 09:00 is 13:00Z, inside the window, and wins as the reminder's own time.
  assert.deepEqual(ringsAt(dateOnlyDay('Pacific/Auckland', '2026-09-27', [onCollectorClock('America/New_York', 0)])),
    [[reminderA, '2026-09-26T13:00:00.000Z']]);
});

test('a date-only reminder rings at its own time on the collector’s clock where that falls inside its bounds', () => {
  // A New York sale day starts at 04:00Z and its 09:00 is 13:00Z: Tokyo's 09:00 falls outside, so the reminder rings at
  // 21:00 Tokyo (12:00Z), 08:00 New York. R3 rang at Tokyo's 09:00 on the 3rd, 20:00 New York, eleven hours into the sale day.
  assert.deepEqual(ringsAt(dateOnlyDay('America/New_York', '2026-10-02', [onCollectorClock('Asia/Tokyo', 0)])),
    [[reminderA, '2026-10-02T12:00:00.000Z']]);
  // A London collector at a New York sale: New York's day starts at 05:00 London, and 09:00 London is 04:00 New York.
  assert.deepEqual(ringsAt(dateOnlyDay('America/New_York', '2026-10-02', [onCollectorClock('Europe/London', 0)])),
    [[reminderA, '2026-10-02T08:00:00.000Z']]);
  // The reminder's own time is kept on the collector's clock: 20:00 in London, before 09:00 in Sydney.
  assert.deepEqual(ringsAt(dateOnlyDay('Australia/Sydney', '2026-06-10', [onCollectorClock('Europe/London', 0, '20:00')])),
    [[reminderA, '2026-06-09T19:00:00.000Z']]);
  // Where the collector's zone is the auction's, 09:00 is both the reminder's time and the bound.
  assert.deepEqual(ringsAt(dateOnlyDay('Europe/London', '2026-10-02', [onCollectorClock('Europe/London', 1), onCollectorClock('Europe/London', 0)])),
    [[reminderB, '2026-10-01T08:00:00.000Z'], [reminderA, '2026-10-02T08:00:00.000Z']]);
});

test('with no waking minute before the sale’s morning, a sale-day reminder rings at 09:00 where the auction is', () => {
  // Noronha is two hours behind London: London's sale day runs 22:00 to 07:00 Noronha until its 09:00, all outside
  // 08:00–21:00 there, so the reminder rings at 09:00 London.
  assert.deepEqual(ringsAt(dateOnlyDay('Europe/London', '2026-01-15', [onCollectorClock('America/Noronha', 0)])),
    [[reminderA, '2026-01-15T09:00:00.000Z']]);
  // A collector's zone the browser cannot read gives 09:00 where the auction is, and the day's start for the day before.
  assert.deepEqual(ringsAt(dateOnlyDay('Europe/London', '2026-10-02', [onCollectorClock('Mars/Olympus', 1), onCollectorClock('Mars/Olympus', 0)])),
    [[reminderB, '2026-09-30T23:00:00.000Z'], [reminderA, '2026-10-02T08:00:00.000Z']]);
});

test('a day-before reminder keeps R3’s rule: the latest waking minute inside its day where no 09:00 is', () => {
  // London springs forward on 29 March 2026, so that day runs 00:00Z to 23:00Z. Brisbane's 09:00 is 23:00Z, which falls
  // at its end on the 30th and an hour before its start on the 29th: neither is inside it. The latest instant inside it
  // between 08:00 and 21:00 in Brisbane is 08:59 on the 30th, a minute before the day ends in London.
  assert.deepEqual(ringsAt(dateOnlyDay('Europe/London', '2026-03-30', [onCollectorClock('Australia/Brisbane', 1)])),
    [[reminderB, '2026-03-29T22:59:00.000Z']]);
  // The day-before reminder of a New York sale for a Tokyo collector: 09:00 Tokyo on the sale day, 20:00 New York the
  // evening before, as R3 gave.
  assert.deepEqual(ringsAt(dateOnlyDay('America/New_York', '2026-10-03', [onCollectorClock('Asia/Tokyo', 1)])),
    [[reminderB, '2026-10-03T00:00:00.000Z']]);
});

// The rule, worked out from its words by scanning the auction's day, for every pair of the zones the R3 review used
// (London, New York, Sydney, Tokyo, Los Angeles, Kiritimati, Pago Pago, Kathmandu) and Auckland and Zurich, as the
// collector's zone and the auction's, on each zone's 2026 clock-change days and the days after them and an ordinary day,
// for the day-before and on-the-day reminders at 09:00 (and at 20:00 on the days after). Every sale-day reminder is at or after the sale day's start and
// at or before its 09:00 there; every day-before one inside the day before; and the two never swap.
test('date-only reminders ring by the rule for ten zones either side, on the days the clocks change', () => {
  const zones = ['Europe/London', 'America/New_York', 'Australia/Sydney', 'Asia/Tokyo', 'America/Los_Angeles',
    'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kathmandu', 'Pacific/Auckland', 'Europe/Zurich'];
  const shift = (date, by) => new Date(Date.parse(`${date}T00:00:00Z`) + by * 86400000).toISOString().slice(0, 10);
  const changes = ['2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25', '2026-04-05', '2026-10-04', '2026-09-27'];
  const days = [...changes.flatMap((day) => [day, shift(day, 1)]), '2026-06-15'];
  const clock = (timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const at = (localDate, localTime, timeZone) => Date.parse(resolveZonedDateTime({ localDate, localTime, timeZone, disambiguation: 'reject' }).value.startsAt);
  const waking = (time) => time >= '08:00' && time <= '21:00';
  // The latest instant from `from` to `last` whose collector's clock passes `reads`: every zone here is a whole
  // number of quarter hours from UTC, so the clock reaches a whole time or 21:00 on a quarter hour from a midnight.
  const latestIn = (from, last, passes) => {
    if (passes(last)) return last;
    let found = null;
    for (let instant = from; instant < last; instant += 15 * 60000) if (passes(instant)) found = instant;
    return found;
  };
  let fallbacks = 0;
  let morningFallbacks = 0;
  let cases = 0;
  for (const auction of zones) {
    for (const collector of zones) {
      const reads = clock(collector);
      for (const [index, localDate] of days.entries()) {
        const localTime = index % 2 ? '20:00' : '09:00';
        const derived = new Map(ringsAt(dateOnlyDay(auction, localDate, [onCollectorClock(collector, 1, localTime), onCollectorClock(collector, 0, localTime)])));
        const saleStart = at(localDate, '00:00', auction);
        const morning = at(localDate, '09:00', auction);
        // The day before: its own time inside it, else the latest waking minute inside it, else its start.
        const dayBefore = at(shift(localDate, -1), '00:00', auction);
        const ownTime = (instant) => reads.format(instant) === localTime;
        const awake = (instant) => waking(reads.format(instant));
        let before = latestIn(dayBefore, saleStart - 60000, ownTime);
        if (before === null) {
          fallbacks += 1;
          before = latestIn(dayBefore, saleStart - 60000, awake);
        }
        before ??= dayBefore;
        // The sale day: its own time between the day's start and 09:00 there, else the latest waking minute there, else 09:00.
        let onTheDay = latestIn(saleStart, morning, ownTime);
        if (onTheDay === null) {
          fallbacks += 1;
          onTheDay = latestIn(saleStart, morning, awake);
        }
        if (onTheDay === null) morningFallbacks += 1;
        onTheDay ??= morning;
        const label = `${collector} collector, ${auction} sale day ${localDate} at ${localTime}`;
        assert.equal(derived.get(reminderB), new Date(before).toISOString(), `${label}, the day before`);
        assert.equal(derived.get(reminderA), new Date(onTheDay).toISOString(), `${label}, on the day`);
        const [previous, sameDay] = [Date.parse(derived.get(reminderB)), Date.parse(derived.get(reminderA))];
        assert.ok(previous >= dayBefore && previous < saleStart, label);
        assert.ok(sameDay >= saleStart && sameDay <= morning, `${label}: after 09:00 where the auction is`);
        cases += 2;
      }
    }
  }
  assert.equal(cases, zones.length * zones.length * days.length * 2);
  assert.ok(fallbacks < cases / 2, `${fallbacks} of ${cases} needed the waking-hours fallback`);
  assert.ok(morningFallbacks > 0, 'the 09:00 fallback is reached');
});

// No sale-day reminder, in any zone the browser knows, rings after 09:00 on the sale day where the auction is or before
// that day starts there, whatever time the collector gave it. The bounds are found here by reading the auction's clock
// every quarter hour, not by the code under test.
test('no sale-day reminder rings after its sale’s 09:00, for any auction zone', () => {
  const reminders = [['America/New_York', '09:00'], ['Asia/Tokyo', '23:30'], ['Pacific/Kiritimati', '00:30'], ['America/Noronha', '20:00']]
    .map(([collectorTimeZone, localTime], index) => ({ id: `r${index}`, kind: 'wall-time', daysBefore: 0, localTime, collectorTimeZone }));
  let checked = 0;
  for (const auction of Intl.supportedValuesOf('timeZone')) {
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: auction, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    for (const localDate of ['2026-03-29']) {
      let start = Date.parse(`${localDate}T00:00:00Z`) - 15 * 3600000;
      while (localDateAtInstant(auction, start) !== localDate) start += 15 * 60000;
      let morning = start;
      while (clock.format(morning) < '09:00') morning += 15 * 60000;
      for (const [id, ring] of ringsAt(dateOnlyDay(auction, localDate, reminders))) {
        assert.ok(Date.parse(ring) >= start && Date.parse(ring) <= morning, `${id} at ${auction} ${localDate}: ${ring}`);
        checked += 1;
      }
    }
  }
  assert.equal(checked, Intl.supportedValuesOf('timeZone').length * reminders.length);
});

// The banner bound above, for reminders that ring on the collector's clock: the auction's day and clock are the parts
// most often named now, since its zone's time is no longer the reminder's own.
test('a notification for a reminder on the collector’s clock stays short enough for a banner', () => {
  const places = Intl.supportedValuesOf('timeZone').filter((zone) => zone.includes('/') && !zone.startsWith('Etc/'))
    .sort((left, right) => zonePlace(right).length - zonePlace(left).length || left.localeCompare(right)).slice(0, 6);
  const viewers = ['Pacific/Honolulu', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Pacific/Kiritimati'];
  let longest = '';
  for (const timeZone of [...places, 'America/Argentina/Buenos_Aires']) {
    for (const viewer of viewers) {
      const reminders = ['00:30', '09:00', '23:30'].flatMap((localTime, index) => [0, 1, 2].map((daysBefore) => (
        { id: `${index}${daysBefore}`, kind: 'wall-time', daysBefore, localTime, collectorTimeZone: viewer })));
      for (const trigger of deriveReminderTriggers(/** @type {*} */ ([dateOnlyDay(timeZone, '2026-09-30', reminders)]))) {
        const notice = reminderNotice(trigger, { eventKind: 'auction-day', timeZone: viewer, locale: 'en-US' });
        assert.ok(notice.indexOf('your time') + 'your time'.length <= 60, notice);
        if (notice.length > longest.length) longest = notice;
      }
    }
  }
  assert.ok(longest.length <= 90, `${longest.length}: ${longest}`);
});

test('a date-only reminder on the collector’s clock is announced with their 09:00 first', () => {
  const [trigger] = deriveReminderTriggers(/** @type {*} */ ([dateOnlyDay('Europe/London', '2026-10-02', [onCollectorClock('America/New_York', 1)])]));
  assert.equal(reminderNotice(trigger, { eventKind: 'auction-day', timeZone: 'America/New_York', locale: 'en-GB' }),
    'Sale day Fri 2 Oct — Thu 1 Oct 9:00 your time, 14:00 London');
});
