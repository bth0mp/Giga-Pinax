import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS,
  SCHEMA_VERSION,
  createEmptySnapshot,
  projectExposure,
  setOutcome,
  validateSnapshot,
} from '../extension/core/records.js';

const NOW = '2026-09-12T12:00:00.000Z';
const IDS = Object.freeze({
  eventUsd: '11111111-1111-4111-8111-111111111111',
  eventEur: '11111111-1111-4111-8111-222222222222',
  eventChf: '11111111-1111-4111-8111-333333333333',
  group: '22222222-2222-4222-8222-222222222222',
  lotUsdKnown: '33333333-3333-4333-8333-111111111111',
  lotUsdUnknown: '33333333-3333-4333-8333-222222222222',
  lotEur: '33333333-3333-4333-8333-333333333333',
  lotChf: '33333333-3333-4333-8333-666666666666',
  lotPlanned: '33333333-3333-4333-8333-444444444444',
  lotTerminal: '33333333-3333-4333-8333-555555555555',
  collection: '44444444-4444-4444-8444-444444444444',
  history: '55555555-5555-4555-8555-555555555555',
});

function makeEvent(id, name = 'Auction') {
  return {
    id,
    revision: 0,
    dataClass: 'collector',
    name,
    eventKind: 'auction-day',
    precision: 'date-only',
    localDate: '2026-10-01',
    timeZone: 'Europe/London',
    reminderScope: 'linked-lots',
    reminders: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeLot(id = IDS.lotUsdKnown, overrides = {}) {
  return {
    id,
    revision: 0,
    dataClass: 'collector',
    title: 'Test coin',
    sourceLinks: [],
    bidHistory: [],
    outcome: { status: 'open' },
    outcomeHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function snapshotWith(...lots) {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.auctionEvents.push(makeEvent(IDS.eventUsd, 'USD auction'));
  snapshot.auctionEvents.push(makeEvent(IDS.eventEur, 'EUR auction'));
  snapshot.auctionEvents.push(makeEvent(IDS.eventChf, 'CHF auction'));
  snapshot.lots.push(...lots);
  return snapshot;
}

test('creates the complete version 1 durable root contract', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(createEmptySnapshot(NOW), {
    schemaVersion: 1,
    revision: 0,
    updatedAt: NOW,
    preferences: null,
    lots: [],
    auctionEvents: [],
    alternativeGroups: [],
    evidence: [],
    collectionEntries: [],
    drafts: [],
    alerts: [],
    scheduler: { revision: 0, nextWakeAt: null, lastReconciledAt: null },
    recentCommands: [],
  });
  assert.equal(validateSnapshot(createEmptySnapshot(NOW)).ok, true);
});

test('alert capacity covers every supported event reminder', () => {
  assert.equal(LIMITS.alerts, LIMITS.auctionEvents * LIMITS.reminders);
});

test('validates stable ids, revisions, enums, bounded fields, and absent unknown premiums', () => {
  const valid = snapshotWith(makeLot(IDS.lotUsdKnown, {
    auctionEventId: IDS.eventUsd,
    plannedBid: { amount: { currency: 'USD', minor: 10000 } },
  }));
  assert.equal(validateSnapshot(valid).ok, true);

  const invalidCases = [
    ['id', (copy) => { copy.lots[0].id = 'lot-1'; }],
    ['revision', (copy) => { copy.lots[0].revision = 0.5; }],
    ['enum', (copy) => { copy.lots[0].outcome.status = 'maybe'; }],
    ['bound', (copy) => { copy.lots[0].title = 'x'.repeat(LIMITS.title + 1); }],
    ['unknown premium represented as null', (copy) => { copy.lots[0].plannedBid.buyerPremiumBps = null; }],
    ['premium above maximum', (copy) => { copy.lots[0].plannedBid.buyerPremiumBps = 10001; }],
  ];
  for (const [label, mutate] of invalidCases) {
    const copy = structuredClone(valid);
    mutate(copy);
    assert.equal(validateSnapshot(copy).ok, false, label);
  }
});

test('rejects normalized calendar overflow in otherwise ISO-shaped timestamps', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.updatedAt = '2026-02-30T12:00:00.000Z';
  assert.equal(validateSnapshot(snapshot).error.code, 'invalid-timestamp');
});

test('requires timed event instants and reminder kinds to match confirmed local fields', () => {
  const snapshot = snapshotWith();
  Object.assign(snapshot.auctionEvents[0], {
    precision: 'timed', localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC',
    startsAt: '2026-10-10T12:00:00.000Z',
    reminders: [{ id: IDS.history, kind: 'offset', offsetMinutes: 60 }],
  });
  snapshot.auctionEvents[0].startsAt = '2026-10-11T12:00:00.000Z';
  let result = validateSnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.equal(result.error.path, 'auctionEvents[0].startsAt');

  snapshot.auctionEvents[0].startsAt = '2026-10-10T12:00:00.000Z';
  snapshot.auctionEvents[0].reminders[0] = {
    ...snapshot.auctionEvents[0].reminders[0], kind: 'wall-time', daysBefore: 0, localTime: '09:00',
  };
  delete snapshot.auctionEvents[0].reminders[0].offsetMinutes;
  result = validateSnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.equal(result.error.path, 'auctionEvents[0].reminders[0].kind');

  Object.assign(snapshot.auctionEvents[0], {
    precision: 'date-only', localDate: '2026-03-29', timeZone: 'Europe/London',
    reminders: [{ id: IDS.history, kind: 'wall-time', daysBefore: 0, localTime: '01:30' }],
  });
  delete snapshot.auctionEvents[0].localTime;
  delete snapshot.auctionEvents[0].startsAt;
  result = validateSnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.equal(result.error.path, 'auctionEvents[0].reminders[0].localTime');
});

test('rejects broken foreign links and duplicate alternative priorities', () => {
  const snapshot = snapshotWith(
    makeLot(IDS.lotUsdKnown, { alternativeGroupId: IDS.group, priority: 1 }),
    makeLot(IDS.lotUsdUnknown, { alternativeGroupId: IDS.group, priority: 1 }),
  );
  snapshot.alternativeGroups.push({
    id: IDS.group,
    revision: 0,
    dataClass: 'collector',
    name: 'One Greek silver coin',
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(validateSnapshot(snapshot).error.code, 'duplicate-priority');

  snapshot.lots[1].priority = 2;
  snapshot.lots[0].auctionEventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(validateSnapshot(snapshot).error.code, 'foreign-key');
});

test('requires alternative priorities to stay compact from one through group size', () => {
  const snapshot = snapshotWith(
    makeLot(IDS.lotUsdKnown, { alternativeGroupId: IDS.group, priority: 1 }),
    makeLot(IDS.lotUsdUnknown, { alternativeGroupId: IDS.group, priority: 3 }),
  );
  snapshot.alternativeGroups.push({
    id: IDS.group,
    revision: 0,
    dataClass: 'collector',
    name: 'Buy one',
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(validateSnapshot(snapshot).error.code, 'noncompact-priority');
});

test('rejects sample fixtures from durable live records and collection history', () => {
  const sampleLot = snapshotWith(makeLot(IDS.lotUsdKnown, { dataClass: 'sample' }));
  assert.equal(validateSnapshot(sampleLot).error.code, 'invalid-data-class');

  const sampleHistory = snapshotWith(makeLot());
  sampleHistory.collectionEntries.push({
    id: IDS.collection,
    revision: 0,
    dataClass: 'sample',
    lotId: IDS.lotUsdKnown,
    title: 'Fictional acquisition',
    acquisitionDate: '2026-09-12',
    sourceLinks: [],
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(validateSnapshot(sampleHistory).error.code, 'invalid-data-class');
});

test('requires lot and collection-entry links to name each other', () => {
  const snapshot = snapshotWith(
    makeLot(IDS.lotUsdKnown, { collectionEntryId: IDS.collection }),
    makeLot(IDS.lotUsdUnknown),
  );
  snapshot.collectionEntries.push({
    id: IDS.collection,
    revision: 0,
    dataClass: 'collector',
    lotId: IDS.lotUsdUnknown,
    title: 'Different coin',
    acquisitionDate: '2026-09-12',
    sourceLinks: [],
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(validateSnapshot(snapshot).error.code, 'foreign-key');
});

test('validates concrete preferences, scheduler, alert, draft, and request-ledger records', () => {
  const snapshot = snapshotWith(makeLot());
  snapshot.preferences = {
    schemaVersion: 1,
    revision: 0,
    currency: 'GBP',
    catalogue: 'RIC',
    number: '306',
    volume: 'I (2nd edition)',
    section: 'Nero',
    sampleMode: false,
    desktopAlertsEnabled: false,
    housePremiumPresets: [{ name: 'CNG', buyerPremiumBps: 2250 }],
    createdAt: NOW,
    updatedAt: NOW,
  };
  snapshot.drafts.push({
    id: '66666666-6666-4666-8666-666666666666',
    revision: 0,
    dataClass: 'collector',
    kind: 'auction-capture',
    payload: { rawText: 'Sale on 1 October', pageUrl: 'https://example.test/auction' },
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: '2026-09-12T12:30:00.000Z',
  });
  snapshot.alerts.push({
    id: '77777777-7777-4777-8777-777777777777',
    revision: 0,
    dataClass: 'collector',
    triggerId: `${IDS.eventUsd}:0:88888888-8888-4888-8888-888888888888::2026-10-01T08:00:00.000Z`,
    eventId: IDS.eventUsd,
    eventRevision: 0,
    reminderId: '88888888-8888-4888-8888-888888888888',
    triggerAt: '2026-10-01T08:00:00.000Z',
    status: 'pending',
    createdAt: NOW,
    updatedAt: NOW,
  });
  snapshot.auctionEvents[0].reminders.push({
    id: '88888888-8888-4888-8888-888888888888',
    kind: 'wall-time',
    daysBefore: 0,
    localTime: '09:00',
  });
  snapshot.recentCommands.push({
    requestId: '99999999-9999-4999-8999-999999999999',
    commandType: 'lot.save',
    revision: 1,
    committedAt: NOW,
    reply: { ok: true, requestId: '99999999-9999-4999-8999-999999999999', revision: 1, value: null },
  });
  assert.equal(validateSnapshot(snapshot).ok, true);

  snapshot.alerts[0].status = 'claimed';
  assert.equal(validateSnapshot(snapshot).error.path, 'alerts[0].attemptedAt');

  snapshot.alerts[0].status = 'unknown';
  assert.equal(validateSnapshot(snapshot).ok, false);
});

test('rejects duplicate or out-of-bounds house premium presets and oversized lot notes', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.preferences = { schemaVersion: 1, revision: 0, currency: 'USD', catalogue: 'Price', number: '23', volume: '', section: '', sampleMode: false, desktopAlertsEnabled: false, housePremiumPresets: [{ name: 'CNG', buyerPremiumBps: 2000 }, { name: ' cng ', buyerPremiumBps: 2200 }], createdAt: NOW, updatedAt: NOW };
  assert.equal(validateSnapshot(snapshot).error.code, 'duplicate-name');
  snapshot.preferences.housePremiumPresets = Array.from({ length: 51 }, (_, index) => ({ name: `House ${index}`, buyerPremiumBps: 0 }));
  assert.equal(validateSnapshot(snapshot).error.code, 'collection-limit');
  snapshot.preferences.housePremiumPresets = [];
  snapshot.lots.push(makeLot(IDS.lotUsdKnown, { notes: 'x'.repeat(LIMITS.notes + 1) }));
  assert.equal(validateSnapshot(snapshot).ok, false);
});

test('durable current-lot drafts cannot contain fetched provider results', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.drafts.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 0, dataClass: 'collector',
    kind: 'current-lot', payload: {
      target: 'watchlist', title: 'Nero denarius', reference: 'RIC 306',
      acsearchRows: [{ hammer: 'CHF 200' }],
    },
    createdAt: NOW, updatedAt: NOW, expiresAt: '2026-09-12T12:30:00.000Z',
  });
  const result = validateSnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.equal(result.error.path, 'drafts[0].payload.acsearchRows');
});

test('delegates complete live SaleEvidence validation at the snapshot boundary', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.evidence.push({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    revision: 0,
    dataClass: 'collector',
    createdAt: NOW,
    updatedAt: NOW,
    observations: [{
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      queryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      source: 'manual',
      dataClass: 'collector',
      retrievedAt: NOW,
      auctionHouse: 'Example Auctions',
      auctionDate: '2026-09-01',
      lotNumber: '12',
      priceBasis: 'hammer',
      amount: { currency: 'USD', minor: 10000 },
    }],
    resolved: {
      priceBasis: 'hammer',
      hammer: { currency: 'USD', minor: 10000 },
      resolution: 'source-agreement',
    },
    inclusion: 'included',
  });
  assert.equal(validateSnapshot(snapshot).ok, true);

  snapshot.evidence[0].inclusion = 'invented';
  assert.equal(validateSnapshot(snapshot).ok, false);

  delete snapshot.evidence[0].observations;
  assert.equal(validateSnapshot(snapshot).ok, false);
});

test('projects every open active bid by currency and event without planned or terminal amounts', () => {
  const snapshot = snapshotWith(
    makeLot(IDS.lotUsdKnown, {
      auctionEventId: IDS.eventUsd,
      alternativeGroupId: IDS.group,
      priority: 1,
      plannedBid: { amount: { currency: 'USD', minor: 5000 }, buyerPremiumBps: 2500 },
      activeBid: { amount: { currency: 'USD', minor: 10000 }, buyerPremiumBps: 2500, placedAt: NOW },
    }),
    makeLot(IDS.lotUsdUnknown, {
      auctionEventId: IDS.eventUsd,
      alternativeGroupId: IDS.group,
      priority: 2,
      activeBid: { amount: { currency: 'USD', minor: 20000 }, placedAt: NOW },
    }),
    makeLot(IDS.lotEur, {
      auctionEventId: IDS.eventEur,
      activeBid: { amount: { currency: 'EUR', minor: 8000 }, buyerPremiumBps: 2000, placedAt: NOW },
    }),
    makeLot(IDS.lotChf, {
      auctionEventId: IDS.eventChf,
      activeBid: { amount: { currency: 'CHF', minor: 10000 }, buyerPremiumBps: 2500, placedAt: NOW },
    }),
    makeLot(IDS.lotPlanned, {
      auctionEventId: IDS.eventUsd,
      plannedBid: { amount: { currency: 'USD', minor: 999900 }, buyerPremiumBps: 2500 },
    }),
    makeLot(IDS.lotTerminal, {
      auctionEventId: IDS.eventUsd,
      activeBid: { amount: { currency: 'USD', minor: 50000 }, buyerPremiumBps: 2500, placedAt: NOW },
      outcome: { status: 'lost' },
    }),
  );
  snapshot.alternativeGroups.push({
    id: IDS.group,
    revision: 0,
    dataClass: 'collector',
    name: 'Buy one',
    createdAt: NOW,
    updatedAt: NOW,
  });

  assert.deepEqual(projectExposure(snapshot), {
    CHF: {
      hammerMinor: 10000,
      knownHammerPlusBpMinor: 12500,
      bindingCount: 1,
      unknownPremiumCount: 0,
      byEvent: {
        [IDS.eventChf]: {
          hammerMinor: 10000,
          knownHammerPlusBpMinor: 12500,
          bindingCount: 1,
          unknownPremiumCount: 0,
        },
      },
    },
    EUR: {
      hammerMinor: 8000,
      knownHammerPlusBpMinor: 9600,
      bindingCount: 1,
      unknownPremiumCount: 0,
      byEvent: {
        [IDS.eventEur]: {
          hammerMinor: 8000,
          knownHammerPlusBpMinor: 9600,
          bindingCount: 1,
          unknownPremiumCount: 0,
        },
      },
    },
    USD: {
      hammerMinor: 30000,
      knownHammerPlusBpMinor: 12500,
      bindingCount: 2,
      unknownPremiumCount: 1,
      byEvent: {
        [IDS.eventUsd]: {
          hammerMinor: 30000,
          knownHammerPlusBpMinor: 12500,
          bindingCount: 2,
          unknownPremiumCount: 1,
        },
      },
    },
  });
});

test('won and lost settle active bids while preserving planned terms and audit history', () => {
  const lot = makeLot(IDS.lotUsdKnown, {
    plannedBid: { amount: { currency: 'USD', minor: 9000 }, buyerPremiumBps: 2500 },
    activeBid: { amount: { currency: 'USD', minor: 10000 }, buyerPremiumBps: 2500, placedAt: NOW },
  });
  const result = setOutcome(lot, {
    status: 'won',
    hammer: { currency: 'USD', minor: 9500 },
    actualInvoice: { currency: 'GBP', minor: 8000 },
  }, '2026-09-13T12:00:00.000Z');

  assert.equal(result.ok, true);
  assert.equal(result.value.revision, 1);
  assert.equal('activeBid' in result.value, false);
  assert.deepEqual(result.value.plannedBid, lot.plannedBid);
  assert.deepEqual(result.value.outcome, {
    status: 'won',
    hammer: { currency: 'USD', minor: 9500 },
    actualInvoice: { currency: 'GBP', minor: 8000 },
    verification: 'personal-unverified',
  });
  assert.deepEqual(result.value.bidHistory.at(-1), {
    id: result.value.bidHistory.at(-1).id,
    action: 'settled-won',
    amount: { currency: 'USD', minor: 10000 },
    buyerPremiumBps: 2500,
    recordedAt: '2026-09-13T12:00:00.000Z',
  });
  assert.equal(result.value.outcomeHistory.at(-1).from, 'open');
  assert.equal(result.value.outcomeHistory.at(-1).to, 'won');
});

test('blocks Passed until external cancellation has removed the active declaration', () => {
  const active = makeLot(IDS.lotUsdKnown, {
    activeBid: { amount: { currency: 'USD', minor: 10000 }, placedAt: NOW },
  });
  assert.equal(setOutcome(active, { status: 'passed' }, NOW).error.code, 'active-bid');

  const cancelled = {
    ...active,
    activeBid: undefined,
    bidHistory: [{
      id: IDS.history,
      action: 'externally-cancelled',
      amount: { currency: 'USD', minor: 10000 },
      recordedAt: NOW,
    }],
  };
  delete cancelled.activeBid;
  const passed = setOutcome(cancelled, { status: 'passed' }, NOW);
  assert.equal(passed.ok, true);
  assert.deepEqual(passed.value.outcome, { status: 'passed' });
});

test('does not treat an omitted active bid as proof of external cancellation', () => {
  const undeclaredCancellation = makeLot(IDS.lotUsdKnown, {
    bidHistory: [{
      id: IDS.history,
      action: 'placed',
      amount: { currency: 'USD', minor: 10000 },
      recordedAt: NOW,
    }],
  });
  assert.equal(
    setOutcome(undeclaredCancellation, { status: 'passed' }, NOW).error.code,
    'invalid-bid-state',
  );
});

test('reopening a won or lost lot requires and records an active or inactive binding decision', () => {
  const settled = makeLot(IDS.lotUsdKnown, {
    outcome: { status: 'lost' },
    bidHistory: [{
      id: IDS.history,
      action: 'settled-lost',
      amount: { currency: 'USD', minor: 12000 },
      buyerPremiumBps: 1800,
      recordedAt: NOW,
    }],
  });
  assert.equal(setOutcome(settled, { status: 'open' }, NOW).error.code, 'reopen-decision-required');

  const active = setOutcome(settled, { status: 'open', bindingActive: true }, NOW);
  assert.deepEqual(active.value.activeBid, {
    amount: { currency: 'USD', minor: 12000 },
    buyerPremiumBps: 1800,
    placedAt: NOW,
  });
  assert.equal(active.value.bidHistory.at(-1).action, 'reopened-active');

  const inactive = setOutcome(settled, { status: 'open', bindingActive: false }, NOW);
  assert.equal('activeBid' in inactive.value, false);
  assert.equal(inactive.value.bidHistory.at(-1).action, 'reopened-inactive');
});

test('correcting won flags its linked collection entry for explicit review', () => {
  const lot = makeLot(IDS.lotUsdKnown, {
    outcome: { status: 'won', hammer: { currency: 'USD', minor: 10000 }, verification: 'personal-unverified' },
    collectionEntryId: IDS.collection,
  });
  const corrected = setOutcome(lot, { status: 'lost' }, NOW);
  assert.equal(corrected.ok, true);
  assert.equal(corrected.value.collectionReviewReason, 'source-lot-no-longer-won');
  assert.equal(corrected.value.outcome.correctedAt, NOW);
});
