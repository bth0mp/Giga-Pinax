import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LIMITS,
  SCHEMA_VERSION,
  createEmptySnapshot,
  migrateSnapshot,
  projectExposure,
  quarantineEntryId,
  quarantineInvalidRecords,
  restartUnusableRevisions,
  followOutcome,
  setOutcome,
  unusableRevisions,
  validateDraftPayload,
  validateEventLocalTimes,
  validateSnapshot,
} from '../extension/core/records.js';

test('capture and research drafts accept validated auction context', () => {
  const auctionContext = { pageUrl: 'https://house.test/lot/1', house: 'House', saleId: 'S', lotNumber: '1' };
  assert.equal(validateDraftPayload('current-lot', { target: 'watchlist', title: 'Coin', auctionContext }).ok, true);
  assert.equal(validateDraftPayload('auction-capture', { rawText: 'Coin', pageUrl: 'https://house.test/lot/1', auctionContext }).ok, true);
  assert.equal(validateDraftPayload('research-highlight', { rawText: 'Coin', auctionContext }).ok, true);
  assert.equal(validateDraftPayload('auction-capture', { auctionContext: { pageUrl: 'file:///bad' } }).ok, false);
});

// 0.34 (W2a): what a lot page states about its sale rides on a current-lot draft for the collector to confirm - an estimate in the page's own
// currency and minor units, a closing day or a closing time with its offset, and a photo link - each validated here as it is kept.
test('a current-lot draft carries the page’s estimate, closing time and photo only in their validated shapes', () => {
  const draft = (fields) => validateDraftPayload('current-lot', { target: 'watchlist', title: 'Coin', ...fields });
  for (const fields of [
    { estimate: { minor: 120000, currency: 'EUR' } }, { estimate: { minor: 5000, currency: 'JPY' } },
    { closesAt: '2026-10-15' }, { closesAt: '2026-10-15T14:00+02:00' }, { closesAt: '2026-10-15T12:00Z' }, { closesAt: '2026-10-15T09:30-05:00' },
    { photoUrl: 'https://house.test/27.jpg' }, { startsAt: '2026-10-15' }, { startsAt: '2026-10-15T10:00+02:00' },
  ]) assert.equal(draft(fields).ok, true, JSON.stringify(fields));
  for (const [fields, path] of [
    [{ estimate: { minor: 1200, currency: 'eur' } }, 'payload.estimate.currency'],
    [{ estimate: { minor: 1200, currency: 'EURO' } }, 'payload.estimate.currency'],
    [{ estimate: { minor: 12.5, currency: 'EUR' } }, 'payload.estimate.minor'],
    [{ estimate: { minor: 0, currency: 'EUR' } }, 'payload.estimate.minor'],
    [{ estimate: { minor: 1200 } }, 'payload.estimate.currency'],
    [{ estimate: { minor: 1200, currency: 'EUR', converted: true } }, 'payload.estimate.converted'],
    [{ estimate: '1200 EUR' }, 'payload.estimate'],
    [{ closesAt: '2026-10-15T14:00' }, 'payload.closesAt'],
    [{ closesAt: '2026-02-30' }, 'payload.closesAt'],
    [{ closesAt: '2026-10-15T24:00Z' }, 'payload.closesAt'],
    [{ closesAt: '2026-10-15T14:00+15:00' }, 'payload.closesAt'],
    [{ closesAt: '2026-10-15T14:00+14:30' }, 'payload.closesAt'],
    [{ closesAt: '2026-10-15T14:00-14:01' }, 'payload.closesAt'],
    [{ closesAt: 'next Tuesday' }, 'payload.closesAt'],
    [{ startsAt: '2026-10-15T10:00' }, 'payload.startsAt'],
    [{ photoUrl: 'javascript:alert(1)' }, 'payload.photoUrl'],
    [{ photoUrl: `https://house.test/${'x'.repeat(2048)}` }, 'payload.photoUrl'],
  ]) {
    const result = draft(fields);
    assert.equal(result.ok, false, JSON.stringify(fields));
    assert.equal(result.error.path, path, JSON.stringify(fields));
  }
  // Only the watchlist's own draft kind takes them.
  assert.equal(validateDraftPayload('auction-capture', { rawText: 'Coin', photoUrl: 'https://house.test/27.jpg' }).ok, false);
});

test('a current-lot draft carries the page’s provenance entries only in their validated shape', () => {
  const draft = (provenance) => validateDraftPayload('current-lot', { target: 'watchlist', title: 'Coin', provenance });
  assert.equal(draft([{ text: 'Ex Leu 7 (1973), lot 123', source: 'Leu 7', year: 1973, lot: '123' }, { text: 'Ex Hess' }]).ok, true);
  for (const [provenance, path] of [
    ['Ex Leu 7', 'payload.provenance'],
    [Array.from({ length: 11 }, () => ({ text: 'Ex Leu' })), 'payload.provenance'],
    [[{ text: '' }], 'payload.provenance[0].text'],
    [[{ text: 'x'.repeat(301) }], 'payload.provenance[0].text'],
    [[{ text: 'Ex Leu', source: 'x'.repeat(121) }], 'payload.provenance[0].source'],
    [[{ text: 'Ex Leu', year: '1973' }], 'payload.provenance[0].year'],
    [[{ text: 'Ex Leu', year: 99999 }], 'payload.provenance[0].year'],
    [[{ text: 'Ex Leu', lot: 'x'.repeat(21) }], 'payload.provenance[0].lot'],
    [[{ text: 'Ex Leu', sourceUrl: 'https://x.test' }], 'payload.provenance[0].sourceUrl'],
    [[null], 'payload.provenance[0]'],
  ]) {
    const result = draft(provenance);
    assert.equal(result.ok, false, JSON.stringify(provenance).slice(0, 80));
    assert.equal(result.error.path, path, JSON.stringify(provenance).slice(0, 80));
  }
});

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

test('creates the complete version 2 durable root contract', () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.deepEqual(createEmptySnapshot(NOW), {
    schemaVersion: 2,
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

test('the migration hook passes a current-version root through untouched', () => {
  const snapshot = createEmptySnapshot(NOW);
  assert.equal(migrateSnapshot(snapshot), snapshot);
  assert.equal(validateSnapshot(migrateSnapshot(snapshot)).ok, true);
  assert.deepEqual(migrateSnapshot({ schemaVersion: SCHEMA_VERSION + 1 }), { schemaVersion: SCHEMA_VERSION + 1 });
  assert.equal(migrateSnapshot(null), null);
});

// The version 1 preferences record, exactly as a profile written by the previous build holds it.
const VERSION_ONE_PREFERENCES = Object.freeze({
  schemaVersion: 1,
  revision: 4,
  currency: 'GBP',
  catalogue: 'RIC',
  number: '306',
  volume: 'I (2nd edition)',
  section: 'Nero',
  sampleMode: true,
  desktopAlertsEnabled: true,
  housePremiumPresets: [
    { name: 'CNG', buyerPremiumBps: 2000, incrementLadder: { currency: 'EUR', tiers: [{ from: 0, step: 500 }] } },
    { name: 'Roma', buyerPremiumBps: 2400 },
  ],
  createdAt: NOW,
  updatedAt: NOW,
});

function versionOneSnapshot() {
  const stored = createEmptySnapshot(NOW);
  stored.schemaVersion = 1;
  stored.preferences = structuredClone(VERSION_ONE_PREFERENCES);
  return stored;
}

test('version two drops the research form from preferences and keeps everything else', () => {
  const stored = versionOneSnapshot();
  const migrated = migrateSnapshot(stored);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.preferences, {
    schemaVersion: SCHEMA_VERSION,
    revision: 4,
    currency: 'GBP',
    desktopAlertsEnabled: true,
    housePremiumPresets: [
      { name: 'CNG', buyerPremiumBps: 2000, incrementLadder: { currency: 'EUR', tiers: [{ from: 0, step: 500 }] } },
      { name: 'Roma', buyerPremiumBps: 2400 },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(validateSnapshot(migrated).ok, true);
  // Pure: the stored root the caller still holds is not the one that was rewritten.
  assert.deepEqual(stored.preferences, VERSION_ONE_PREFERENCES);
  assert.equal(stored.schemaVersion, 1);
  // Idempotent: a root already at this version is returned as it stands.
  assert.equal(migrateSnapshot(migrated), migrated);
});

test('version two migrates a root that never wrote preferences', () => {
  const stored = createEmptySnapshot(NOW);
  stored.schemaVersion = 1;
  const migrated = migrateSnapshot(stored);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.preferences, null);
  assert.equal(validateSnapshot(migrated).ok, true);
});

test('preferences carrying the older keys are migrated rather than quarantined', () => {
  const stored = versionOneSnapshot();
  stored.lots.push(makeLot(IDS.lotUsdKnown));
  const repaired = quarantineInvalidRecords(migrateSnapshot(stored), NOW);
  assert.equal(repaired.ok, true);
  assert.equal(repaired.value.quarantine, undefined);
  assert.equal(repaired.value.preferences.currency, 'GBP');
});

test('quarantine sets aside only the records that stopped validating', () => {
  const snapshot = snapshotWith(makeLot(IDS.lotUsdKnown), makeLot(IDS.lotUsdUnknown));
  snapshot.lots[1].outcome = { status: 'maybe' };
  assert.equal(validateSnapshot(snapshot).ok, false);
  const rescued = quarantineInvalidRecords(snapshot, NOW);
  assert.equal(rescued.ok, true);
  assert.equal(validateSnapshot(rescued.value).ok, true);
  assert.deepEqual(rescued.value.lots.map(({ id }) => id), [IDS.lotUsdKnown]);
  assert.deepEqual(rescued.value.quarantine, [{
    collection: 'lots', record: snapshot.lots[1], reason: 'invalid-enum', quarantinedAt: NOW,
  }]);
  assert.deepEqual(quarantineInvalidRecords(snapshot, NOW).value.quarantine[0].record, snapshot.lots[1]);
});

test('quarantine clears optional references and follows required ones', () => {
  const snapshot = snapshotWith(
    makeLot(IDS.lotUsdKnown, { auctionEventId: IDS.eventUsd, alternativeGroupId: IDS.group, priority: 1 }),
    makeLot(IDS.lotEur, { alternativeGroupId: IDS.group, priority: 2 }),
    makeLot(IDS.lotUsdUnknown, { collectionEntryId: IDS.collection }),
  );
  snapshot.alternativeGroups.push({
    id: IDS.group, revision: 0, dataClass: 'collector', name: 'One coin', createdAt: NOW, updatedAt: NOW,
  });
  snapshot.collectionEntries.push({
    id: IDS.collection, revision: 0, dataClass: 'collector', lotId: IDS.lotUsdUnknown,
    title: 'Acquired', acquisitionDate: '2026-09-12', sourceLinks: [], createdAt: NOW, updatedAt: NOW,
  });
  snapshot.alerts.push({
    id: IDS.history, revision: 0, dataClass: 'collector',
    triggerId: `${IDS.eventUsd}:${IDS.history}:${NOW}`, eventId: IDS.eventUsd, eventRevision: 0,
    reminderId: IDS.history, triggerAt: NOW, status: 'pending', createdAt: NOW, updatedAt: NOW,
  });
  snapshot.auctionEvents[0].eventKind = 'bring-your-own';
  snapshot.lots[2].title = '';
  snapshot.alternativeGroups[0].name = 42;

  const rescued = quarantineInvalidRecords(snapshot, NOW);
  assert.equal(rescued.ok, true);
  assert.equal(validateSnapshot(rescued.value).ok, true);
  assert.deepEqual(rescued.value.quarantine.map(({ collection }) => collection).sort(),
    ['alerts', 'alternativeGroups', 'auctionEvents', 'collectionEntries', 'lots']);
  const [linked] = rescued.value.lots;
  assert.equal(Object.hasOwn(linked, 'auctionEventId'), false, 'an unknown event is an optional link');
  assert.equal(Object.hasOwn(linked, 'alternativeGroupId'), false);
  assert.equal(Object.hasOwn(linked, 'priority'), false);
  assert.equal(rescued.value.lots.length, 2);
});

test('quarantine writes down every reference it clears so a recovery can restore it', () => {
  const snapshot = snapshotWith(
    makeLot(IDS.lotUsdKnown, { auctionEventId: IDS.eventUsd, alternativeGroupId: IDS.group, priority: 1 }),
    makeLot(IDS.lotEur, { collectionEntryId: IDS.collection }),
  );
  snapshot.alternativeGroups.push({
    id: IDS.group, revision: 0, dataClass: 'collector', name: 'One coin', createdAt: NOW, updatedAt: NOW,
  });
  snapshot.auctionEvents[0].eventKind = 'bring-your-own';
  snapshot.alternativeGroups[0].name = 42;

  const rescued = quarantineInvalidRecords(snapshot, NOW);
  assert.equal(rescued.ok, true);
  assert.equal(validateSnapshot(rescued.value).ok, true);
  const cleared = new Map(rescued.value.quarantine.map((entry) => [entry.collection, entry.clearedReferences]));
  assert.deepEqual(cleared.get('auctionEvents'), [
    { collection: 'lots', id: IDS.lotUsdKnown, field: 'auctionEventId', value: IDS.eventUsd },
  ]);
  assert.deepEqual(cleared.get('alternativeGroups'), [
    { collection: 'lots', id: IDS.lotUsdKnown, field: 'alternativeGroupId', value: IDS.group },
    { collection: 'lots', id: IDS.lotUsdKnown, field: 'priority', value: 1 },
  ]);
  assert.deepEqual(cleared.get('collectionEntries'), [
    { collection: 'lots', id: IDS.lotEur, field: 'collectionEntryId', value: IDS.collection },
  ]);
  const missingEntry = rescued.value.quarantine.find(({ collection }) => collection === 'collectionEntries');
  assert.deepEqual([missingEntry.record, missingEntry.reason], [null, 'missing-record']);
  assert.equal(
    JSON.stringify(quarantineInvalidRecords(rescued.value, NOW).value),
    JSON.stringify(rescued.value),
    'the repair applied to its own output must change nothing',
  );
});

// An entry carried in from an earlier repair used not to count as a cause, so a root repaired,
// written, and then broken the same way again opened a second entry for a record already in the bin.
test('a reference cleared to a record already set aside lands on the entry it is already in', () => {
  const LATER = '2026-09-13T12:00:00.000Z';
  const broken = { ...makeEvent(IDS.eventEur, 'EUR auction'), eventKind: 'bring-your-own' };
  const snapshot = snapshotWith(makeLot(IDS.lotUsdKnown, { auctionEventId: IDS.eventEur }));
  snapshot.auctionEvents = snapshot.auctionEvents.filter(({ id }) => id !== IDS.eventEur);
  snapshot.quarantine = [{
    collection: 'auctionEvents', record: broken, reason: 'invalid-enum', quarantinedAt: NOW,
  }];

  const rescued = quarantineInvalidRecords(snapshot, LATER);
  assert.equal(rescued.ok, true);
  assert.equal(validateSnapshot(rescued.value).ok, true);
  assert.deepEqual(rescued.value.quarantine, [{
    collection: 'auctionEvents', record: broken, reason: 'invalid-enum', quarantinedAt: NOW,
    clearedReferences: [
      { collection: 'lots', id: IDS.lotUsdKnown, field: 'auctionEventId', value: IDS.eventEur },
    ],
  }]);
});

// The note lands on an entry carried in from an earlier repair, which may already hold it: a root
// repaired, written, linked to the same broken record again and repaired again wrote the same link
// down twice, and Settings said "2 links cleared" for the one link.
test('a link cleared twice to one set-aside record is written down once', () => {
  const LATER = '2026-09-13T12:00:00.000Z';
  const reference = { collection: 'lots', id: IDS.lotUsdKnown, field: 'auctionEventId', value: IDS.eventEur };
  const broken = { ...makeEvent(IDS.eventEur, 'EUR auction'), eventKind: 'bring-your-own' };
  const snapshot = snapshotWith(makeLot(IDS.lotUsdKnown, { auctionEventId: IDS.eventEur }));
  snapshot.auctionEvents = snapshot.auctionEvents.filter(({ id }) => id !== IDS.eventEur);
  snapshot.quarantine = [{
    collection: 'auctionEvents', record: broken, reason: 'invalid-enum', quarantinedAt: NOW,
    clearedReferences: [reference],
  }];

  const rescued = quarantineInvalidRecords(snapshot, LATER);
  assert.equal(rescued.ok, true);
  assert.equal(validateSnapshot(rescued.value).ok, true);
  assert.deepEqual(rescued.value.quarantine, [{
    collection: 'auctionEvents', record: broken, reason: 'invalid-enum', quarantinedAt: NOW,
    clearedReferences: [reference],
  }], 'one link, one line, however often the repair clears it');
  // A second link from the same field of another lot is a different link and is still written down.
  const other = { ...reference, id: IDS.lotEur };
  snapshot.lots.push(makeLot(IDS.lotEur, { auctionEventId: IDS.eventEur }));
  const both = quarantineInvalidRecords(snapshot, LATER);
  assert.equal(both.ok, true);
  assert.deepEqual(both.value.quarantine[0].clearedReferences, [reference, other]);
});

// Only entries carrying the very same record fold, so two duplicates of one ID keep both bodies.
test('two set-aside copies of one record fold, while two different bodies do not', () => {
  const LATER = '2026-09-13T12:00:00.000Z';
  const broken = { ...makeLot(IDS.lotEur), outcome: { status: 'maybe' } };
  const reference = { collection: 'lots', id: IDS.lotUsdKnown, field: 'auctionEventId', value: IDS.eventUsd };
  const snapshot = snapshotWith(makeLot(IDS.lotUsdKnown, { auctionEventId: IDS.eventUsd }));
  snapshot.quarantine = [
    { collection: 'lots', record: broken, reason: 'invalid-enum', quarantinedAt: LATER, clearedReferences: [reference] },
    { collection: 'lots', record: structuredClone(broken), reason: 'invalid-enum', quarantinedAt: NOW },
    { collection: 'lots', record: { ...structuredClone(broken), title: 'Another body' }, reason: 'invalid-enum', quarantinedAt: NOW },
  ];
  // Something has to take the root through a repair: the bin is only folded while one runs.
  snapshot.lots.push(makeLot(IDS.lotChf, { outcome: { status: 'maybe' } }));

  const rescued = quarantineInvalidRecords(snapshot, LATER);
  assert.equal(rescued.ok, true);
  assert.deepEqual(rescued.value.quarantine, [
    { collection: 'lots', record: broken, reason: 'invalid-enum', quarantinedAt: NOW, clearedReferences: [reference] },
    { collection: 'lots', record: { ...broken, title: 'Another body' }, reason: 'invalid-enum', quarantinedAt: NOW },
    { collection: 'lots', record: snapshot.lots[1], reason: 'invalid-enum', quarantinedAt: LATER },
  ]);
});

// Only the first entry held for an ID used to be tried, so A, B and a byte-identical B' left three
// entries in the bin, two of them the same bytes - and therefore the same entry ID, which Settings
// names its Restore buttons by. Every body held for the ID is tried now.
test('a third copy folds into whichever body it matches, not only the first', () => {
  const LATER = '2026-09-13T12:00:00.000Z';
  const broken = { ...makeLot(IDS.lotEur), outcome: { status: 'maybe' } };
  const other = { ...structuredClone(broken), title: 'Another body' };
  const snapshot = snapshotWith(makeLot(IDS.lotUsdKnown, { auctionEventId: IDS.eventUsd }));
  snapshot.quarantine = [
    { collection: 'lots', record: broken, reason: 'invalid-enum', quarantinedAt: NOW },
    { collection: 'lots', record: other, reason: 'invalid-enum', quarantinedAt: LATER },
    { collection: 'lots', record: structuredClone(other), reason: 'invalid-enum', quarantinedAt: NOW },
  ];
  snapshot.lots.push(makeLot(IDS.lotChf, { outcome: { status: 'maybe' } }));

  const rescued = quarantineInvalidRecords(snapshot, LATER);
  assert.equal(rescued.ok, true);
  const bodies = rescued.value.quarantine.filter(({ record }) => record?.id === IDS.lotEur);
  assert.equal(bodies.length, 2, 'two bodies, two entries');
  assert.equal(bodies[1].quarantinedAt, NOW, 'and the later copy folded into the earlier date');
  const ids = rescued.value.quarantine.map(quarantineEntryId);
  assert.equal(new Set(ids).size, ids.length, 'so no two entries answer to one entry ID');
});

// An entry that holds no record is the note of a cause that was never in storage. Only entries with
// a record ID registered as causes, so a root repaired, written and broken the same way again opened
// a second note beside the identical one already in the bin.
test('a second repair of a cause that has no record of its own folds into the note already there', () => {
  const LATER = '2026-09-13T12:00:00.000Z';
  const reference = { collection: 'lots', id: IDS.lotUsdKnown, field: 'auctionEventId', value: IDS.eventEur };
  const snapshot = snapshotWith(makeLot(IDS.lotUsdKnown, { auctionEventId: IDS.eventEur }));
  snapshot.auctionEvents = snapshot.auctionEvents.filter(({ id }) => id !== IDS.eventEur);
  snapshot.quarantine = [{
    collection: 'auctionEvents', record: null, reason: 'missing-record', quarantinedAt: NOW,
    clearedReferences: [reference],
  }];

  const rescued = quarantineInvalidRecords(snapshot, LATER);
  assert.equal(rescued.ok, true);
  assert.equal(validateSnapshot(rescued.value).ok, true);
  assert.deepEqual(rescued.value.quarantine, [{
    collection: 'auctionEvents', record: null, reason: 'missing-record', quarantinedAt: NOW,
    clearedReferences: [reference],
  }], 'one cause, one note, however often the repair runs');
});

test('a collection entry claimed by a second lot unlinks the impostor and keeps both lots', () => {
  const snapshot = snapshotWith(
    makeLot(IDS.lotUsdKnown, { collectionEntryId: IDS.collection }),
    makeLot(IDS.lotEur, { collectionEntryId: IDS.collection }),
  );
  snapshot.collectionEntries.push({
    id: IDS.collection, revision: 0, dataClass: 'collector', lotId: IDS.lotUsdKnown,
    title: 'Acquired', acquisitionDate: '2026-09-12', sourceLinks: [], createdAt: NOW, updatedAt: NOW,
  });
  assert.equal(validateSnapshot(snapshot).error.path, 'lots[1].collectionEntryId');

  const rescued = quarantineInvalidRecords(snapshot, NOW);
  assert.equal(rescued.ok, true);
  assert.equal(validateSnapshot(rescued.value).ok, true);
  assert.deepEqual(rescued.value.lots.map(({ id }) => id), [IDS.lotUsdKnown, IDS.lotEur]);
  assert.equal(rescued.value.lots[0].collectionEntryId, IDS.collection, 'the owning lot keeps its entry');
  assert.equal(Object.hasOwn(rescued.value.lots[1], 'collectionEntryId'), false);
  assert.deepEqual(rescued.value.quarantine, [{
    collection: 'collectionEntries',
    record: null,
    reason: 'entry-claimed-by-another-lot',
    quarantinedAt: NOW,
    clearedReferences: [
      { collection: 'lots', id: IDS.lotEur, field: 'collectionEntryId', value: IDS.collection },
    ],
  }]);
});

test('broken bookkeeping is dropped by the repair instead of being exported in quarantine', () => {
  const snapshot = snapshotWith(makeLot());
  snapshot.drafts.push({ id: IDS.history, kind: 'unknown-kind' });
  snapshot.recentCommands.push({ requestId: IDS.collection });
  assert.equal(validateSnapshot(snapshot).ok, false);

  const rescued = quarantineInvalidRecords(snapshot, NOW);
  assert.equal(rescued.ok, true);
  assert.deepEqual(rescued.value.drafts, []);
  assert.deepEqual(rescued.value.recentCommands, []);
  assert.equal(Object.hasOwn(rescued.value, 'quarantine'), false,
    'scratch and ledger rows are not collector records and backups strip them');
});

const GROUP_KEPT = '22222222-2222-4222-8222-333333333333';
const GROUP_DUPLICATE = '22222222-2222-4222-8222-444444444444';

test('quarantine renumbers only the groups whose priorities validation rejects', () => {
  const snapshot = snapshotWith(
    makeLot(IDS.lotUsdKnown, { alternativeGroupId: GROUP_KEPT, priority: 2 }),
    makeLot(IDS.lotEur, { alternativeGroupId: GROUP_KEPT, priority: 1 }),
    makeLot(IDS.lotChf, { alternativeGroupId: GROUP_DUPLICATE, priority: 1 }),
    makeLot(IDS.lotPlanned, { alternativeGroupId: GROUP_DUPLICATE, priority: 1 }),
    makeLot(IDS.lotTerminal, { alternativeGroupId: IDS.group, priority: 1 }),
    makeLot(IDS.lotUsdUnknown, { alternativeGroupId: IDS.group, priority: 2 }),
  );
  for (const id of [GROUP_KEPT, GROUP_DUPLICATE, IDS.group]) {
    snapshot.alternativeGroups.push({
      id, revision: 0, dataClass: 'collector', name: 'Pick one', createdAt: NOW, updatedAt: NOW,
    });
  }
  snapshot.lots[4].outcome = { status: 'maybe' };

  const rescued = quarantineInvalidRecords(snapshot, NOW);
  assert.equal(rescued.ok, true);
  assert.equal(validateSnapshot(rescued.value).ok, true);
  const priorities = new Map(rescued.value.lots.map((lot) => [lot.id, lot.priority]));
  assert.deepEqual([priorities.get(IDS.lotUsdKnown), priorities.get(IDS.lotEur)], [2, 1],
    'a group that validates keeps the ordering the collector gave it');
  assert.deepEqual([priorities.get(IDS.lotPlanned), priorities.get(IDS.lotChf)], [1, 2],
    'a duplicate priority is broken by the lot IDs, not by storage order');
  assert.equal(priorities.get(IDS.lotUsdUnknown), 1, 'the survivor of a rescued member closes the gap');

  const renumbered = rescued.value.quarantine
    .filter(({ collection }) => collection === 'alternativeGroups')
    .flatMap(({ clearedReferences }) => clearedReferences);
  assert.deepEqual(renumbered, [
    { collection: 'lots', id: IDS.lotChf, field: 'priority', value: 1 },
    { collection: 'lots', id: IDS.lotUsdUnknown, field: 'priority', value: 2 },
  ]);
});

test('quarantine compacts the priorities left behind by a rescued group member', () => {
  const snapshot = snapshotWith(
    makeLot(IDS.lotUsdKnown, { alternativeGroupId: IDS.group, priority: 1 }),
    makeLot(IDS.lotEur, { alternativeGroupId: IDS.group, priority: 2 }),
    makeLot(IDS.lotChf, { alternativeGroupId: IDS.group, priority: 3 }),
  );
  snapshot.alternativeGroups.push({
    id: IDS.group, revision: 0, dataClass: 'collector', name: 'Pick one', createdAt: NOW, updatedAt: NOW,
  });
  snapshot.lots[1].revision = -1;
  const rescued = quarantineInvalidRecords(snapshot, NOW);
  assert.equal(validateSnapshot(rescued.value).ok, true);
  assert.deepEqual(rescued.value.lots.map(({ priority }) => priority), [1, 2]);
});

test('quarantine reports an unusable root instead of guessing at its shape', () => {
  const missing = snapshotWith(makeLot());
  delete missing.lots;
  assert.equal(quarantineInvalidRecords(missing, NOW).ok, false);
  assert.equal(quarantineInvalidRecords(createEmptySnapshot(NOW), 'noon').ok, false);
});

// Damage to what the whole store shares - the settings, the schedule, the scratch and the ledger, the root's own
// counters - refused every command, a plain read included, although not one coin was at fault. Each is something the
// store can run without or build again, so the repair sets the settings aside whole and starts the rest again.
test('damage to the parts of the root every record shares is repaired without touching a record', () => {
  const settings = {
    schemaVersion: SCHEMA_VERSION, revision: 0, currency: 'JPY', housePremiumPresets: [],
    desktopAlertsEnabled: false, createdAt: NOW, updatedAt: NOW,
  };
  const snapshot = snapshotWith(makeLot());
  snapshot.preferences = structuredClone(settings);
  snapshot.scheduler = { revision: 0, nextWakeAt: 'soon', lastReconciledAt: null };
  snapshot.drafts = null;
  snapshot.recentCommands = 'gone';
  snapshot.revision = Number.MAX_SAFE_INTEGER;
  assert.equal(validateSnapshot(snapshot).ok, false);

  const rescued = quarantineInvalidRecords(snapshot, NOW);
  assert.equal(rescued.ok, true, rescued.error?.message);
  assert.equal(rescued.value.lots.length, 1, 'the coin is still there');
  assert.equal(rescued.value.preferences, null, 'the store runs as if the settings were never made');
  assert.deepEqual(rescued.value.quarantine, [{
    collection: 'preferences', record: settings, reason: 'invalid-enum', quarantinedAt: NOW,
  }], 'and the settings themselves wait in the bin, whole');
  assert.deepEqual(rescued.value.scheduler, { revision: 0, nextWakeAt: null, lastReconciledAt: null });
  assert.deepEqual(rescued.value.drafts, []);
  assert.deepEqual(rescued.value.recentCommands, []);
  assert.equal(rescued.value.revision, 0, 'the root counts again from a number the next write can add one to');

  // Settings from a later version are set aside the same way: the root around them is this version's.
  const later = snapshotWith(makeLot());
  later.preferences = { ...structuredClone(settings), currency: 'GBP', schemaVersion: SCHEMA_VERSION + 1 };
  later.revision = -1;
  later.updatedAt = 'yesterday';
  const repaired = quarantineInvalidRecords(later, NOW);
  assert.equal(repaired.ok, true, repaired.error?.message);
  assert.equal(repaired.value.preferences, null);
  assert.equal(repaired.value.quarantine[0].collection, 'preferences');
  assert.equal(repaired.value.revision, 0);
  assert.equal(repaired.value.updatedAt, NOW);
  assert.deepEqual(unusableRevisions({ revision: Number.MAX_SAFE_INTEGER }), [{ collection: 'root', id: null, field: 'revision' }]);
});

test('a validated root carries its quarantine and rejects a malformed entry', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.quarantine = [{ collection: 'lots', record: { id: 'kept' }, reason: 'invalid-id', quarantinedAt: NOW }];
  assert.equal(validateSnapshot(snapshot).ok, true);
  snapshot.quarantine = [{ collection: 'lots', record: { id: 'kept' }, reason: 'invalid-id' }];
  assert.equal(validateSnapshot(snapshot).ok, false);
  snapshot.quarantine = 'lost';
  assert.equal(validateSnapshot(snapshot).ok, false);

  const cleared = { collection: 'lots', id: IDS.lotEur, field: 'auctionEventId', value: IDS.eventUsd };
  const entry = { collection: 'lots', record: null, reason: 'missing-record', quarantinedAt: NOW };
  snapshot.quarantine = [{ ...entry, clearedReferences: [cleared] }];
  assert.equal(validateSnapshot(snapshot).ok, true);
  snapshot.quarantine = [{ ...entry, clearedReferences: [{ collection: 'lots', id: IDS.lotEur, field: 'auctionEventId' }] }];
  assert.equal(validateSnapshot(snapshot).ok, false, 'a cleared reference without its value restores nothing');
  snapshot.quarantine = [{ ...entry, clearedReferences: { ...cleared } }];
  assert.equal(validateSnapshot(snapshot).ok, false);
  snapshot.quarantine = [{ ...entry, clearedReferences: new Array(LIMITS.clearedReferences + 1).fill(cleared) }];
  assert.equal(validateSnapshot(snapshot).ok, false);
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

test('keeps stored event instants authoritative and requires matching reminder kinds', () => {
  const snapshot = snapshotWith();
  Object.assign(snapshot.auctionEvents[0], {
    precision: 'timed', localDate: '2026-10-10', localTime: '12:00', timeZone: 'UTC',
    startsAt: '2026-10-10T12:00:00.000Z',
    reminders: [{ id: IDS.history, kind: 'offset', offsetMinutes: 60 }],
  });
  // Browser time-zone data must never lock a collector out of stored data.
  snapshot.auctionEvents[0].startsAt = '2026-10-10T13:00:00.000Z';
  assert.equal(validateSnapshot(snapshot).ok, true);
  snapshot.auctionEvents[0].startsAt = 'not-an-instant';
  assert.equal(validateSnapshot(snapshot).error.path, 'auctionEvents[0].startsAt');

  snapshot.auctionEvents[0].startsAt = '2026-10-10T12:00:00.000Z';
  snapshot.auctionEvents[0].reminders[0] = {
    ...snapshot.auctionEvents[0].reminders[0], kind: 'wall-time', daysBefore: 0, localTime: '09:00',
  };
  delete snapshot.auctionEvents[0].reminders[0].offsetMinutes;
  const result = validateSnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.equal(result.error.path, 'auctionEvents[0].reminders[0].kind');

  Object.assign(snapshot.auctionEvents[0], {
    precision: 'date-only', localDate: '2026-03-29', timeZone: 'Europe/London',
    reminders: [{ id: IDS.history, kind: 'wall-time', daysBefore: 0, localTime: '01:30' }],
  });
  delete snapshot.auctionEvents[0].localTime;
  delete snapshot.auctionEvents[0].startsAt;
  assert.equal(validateSnapshot(snapshot).ok, true);
  assert.equal(validateEventLocalTimes(snapshot.auctionEvents[0]).error.path, 'event.reminders[0].localTime');
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
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    currency: 'GBP',
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

// A revision is only ever compared and counted up, so a number that cannot be counted up exactly is not one: at
// 2^53-1 the next write is no longer a safe integer, and a crafted backup that planted one made every later save and
// every reconcile fail validation for good. The ceiling leaves 2^52 writes of headroom, which nobody reaches.
test('a revision no write could reach is refused wherever one is stored', () => {
  const above = LIMITS.revision + 1;
  const snapshot = snapshotWith(makeLot());
  snapshot.preferences = {
    schemaVersion: SCHEMA_VERSION, revision: 0, currency: 'GBP', desktopAlertsEnabled: false, createdAt: NOW, updatedAt: NOW,
  };
  snapshot.alerts.push({
    id: '77777777-7777-4777-8777-777777777777', revision: 0, dataClass: 'collector',
    triggerId: `${IDS.eventUsd}:88888888-8888-4888-8888-888888888888:2026-10-01T08:00:00.000Z`,
    eventId: IDS.eventUsd, eventRevision: 0, reminderId: '88888888-8888-4888-8888-888888888888',
    triggerAt: '2026-10-01T08:00:00.000Z', status: 'pending', createdAt: NOW, updatedAt: NOW,
  });
  snapshot.auctionEvents[0].reminders.push({ id: '88888888-8888-4888-8888-888888888888', kind: 'wall-time', daysBefore: 0, localTime: '09:00' });
  assert.equal(validateSnapshot(snapshot).ok, true);
  for (const [path, set] of [
    ['lots[0].revision', (value) => { snapshot.lots[0].revision = value; }],
    ['preferences.revision', (value) => { snapshot.preferences.revision = value; }],
    ['scheduler.revision', (value) => { snapshot.scheduler.revision = value; }],
    ['alerts[0].eventRevision', (value) => { snapshot.alerts[0].eventRevision = value; }],
  ]) {
    set(above);
    assert.equal(validateSnapshot(snapshot).error.path, path);
    set(LIMITS.revision);
    assert.equal(validateSnapshot(snapshot).ok, true, path);
    set(0);
  }
});

// Validation accepts the ceiling itself, so a record stopped exactly there would be refused by its very next write: the
// count would land one above. Everything that has to be written to again stays below the usable ceiling, and the gap
// between the two is the headroom the counting needs.
test('the usable ceiling leaves room above it for the writes a record still has coming', () => {
  assert.ok(LIMITS.usableRevision < LIMITS.revision, 'the usable ceiling is below the one validation accepts');
  assert.equal(LIMITS.revision - LIMITS.usableRevision, 2 ** 32, 'and far enough below it that no run of writes crosses it');
  assert.ok(Number.isSafeInteger(LIMITS.usableRevision));
  const snapshot = snapshotWith(makeLot(IDS.lotUsdKnown, { revision: LIMITS.usableRevision }));
  assert.equal(validateSnapshot(snapshot).ok, true, 'the usable ceiling itself is an ordinary revision');
  assert.deepEqual(unusableRevisions(snapshot), []);
  snapshot.lots[0].revision = LIMITS.usableRevision + 1;
  assert.deepEqual(unusableRevisions(snapshot), [{ collection: 'lots', id: IDS.lotUsdKnown, field: 'revision' }]);
  snapshot.lots[0].revision = LIMITS.revision;
  assert.equal(unusableRevisions(snapshot).length, 1, 'the ceiling validation accepts is itself past use');
});

// A root that was valid yesterday has to load today, so a revision above the usable ceiling is restarted instead of
// condemning the record that carries it: the collector keeps their coins, and every later write counts again from a
// number the arithmetic can hold. Nothing below the usable ceiling is touched.
test('a stored revision past the usable ceiling is restarted, not quarantined', () => {
  const snapshot = snapshotWith(makeLot(IDS.lotUsdKnown, { revision: Number.MAX_SAFE_INTEGER }));
  snapshot.preferences = {
    schemaVersion: SCHEMA_VERSION, revision: LIMITS.revision, currency: 'GBP', desktopAlertsEnabled: false, createdAt: NOW, updatedAt: NOW,
  };
  snapshot.scheduler.revision = LIMITS.usableRevision + 1;
  const rescued = quarantineInvalidRecords(snapshot, NOW);
  assert.equal(rescued.ok, true, rescued.error?.message);
  assert.equal(rescued.value.lots.length, 1, 'the coin is still there');
  assert.equal(rescued.value.lots[0].revision, 0);
  assert.equal(rescued.value.preferences.revision, 0);
  assert.equal(rescued.value.scheduler.revision, 0);
  assert.equal(rescued.value.quarantine, undefined, 'nothing had to be set aside');

  // Run again over what it produced, and over a root that never had one: the pass is cheap enough for every load.
  const ordinary = snapshotWith(makeLot(IDS.lotUsdKnown, { revision: LIMITS.usableRevision }));
  assert.deepEqual(restartUnusableRevisions(rescued.value), []);
  assert.deepEqual(restartUnusableRevisions(ordinary), []);
  assert.equal(ordinary.lots[0].revision, LIMITS.usableRevision, 'an ordinary revision is left where it is');
});

test('rejects duplicate or out-of-bounds house premium presets and oversized lot notes', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.preferences = { schemaVersion: SCHEMA_VERSION, revision: 0, currency: 'USD', desktopAlertsEnabled: false, housePremiumPresets: [{ name: 'CNG', buyerPremiumBps: 2000 }, { name: ' cng ', buyerPremiumBps: 2200 }], createdAt: NOW, updatedAt: NOW };
  assert.equal(validateSnapshot(snapshot).error.code, 'duplicate-name');
  snapshot.preferences.housePremiumPresets = Array.from({ length: 51 }, (_, index) => ({ name: `House ${index}`, buyerPremiumBps: 0 }));
  assert.equal(validateSnapshot(snapshot).error.code, 'collection-limit');
  snapshot.preferences.housePremiumPresets = [];
  snapshot.lots.push(makeLot(IDS.lotUsdKnown, { notes: 'x'.repeat(LIMITS.notes + 1) }));
  assert.equal(validateSnapshot(snapshot).ok, false);
});

test('a house preset may carry an optional increment ladder that older data simply lacks', () => {
  const snapshot = createEmptySnapshot(NOW);
  const preferences = { schemaVersion: SCHEMA_VERSION, revision: 0, currency: 'USD', desktopAlertsEnabled: false, housePremiumPresets: [{ name: 'CNG', buyerPremiumBps: 2000 }], createdAt: NOW, updatedAt: NOW };
  snapshot.preferences = preferences;
  // The field is optional, so a root written before this version needs no migration to validate.
  assert.equal(validateSnapshot(migrateSnapshot(snapshot)).ok, true);
  const ladder = (tiers, currency = 'EUR') => { preferences.housePremiumPresets[0].incrementLadder = { currency, tiers }; };
  ladder([{ from: 0, step: 500 }, { from: 10000, step: 1000 }]);
  assert.equal(validateSnapshot(snapshot).ok, true);
  // The tiers are in the house's own currency, which the calculator's currency need not match.
  ladder([{ from: 0, step: 500 }], 'JPY');
  assert.equal(validateSnapshot(snapshot).error.path, 'preferences.housePremiumPresets[0].incrementLadder.currency');
  preferences.housePremiumPresets[0].incrementLadder = [{ from: 0, step: 500 }];
  assert.equal(validateSnapshot(snapshot).error.path, 'preferences.housePremiumPresets[0].incrementLadder');
  ladder([{ from: 100, step: 500 }]);
  assert.equal(validateSnapshot(snapshot).error.path, 'preferences.housePremiumPresets[0].incrementLadder.tiers[0].from');
  ladder([{ from: 0, step: 500 }, { from: 10000, step: 0 }]);
  assert.equal(validateSnapshot(snapshot).error.code, 'invalid-ladder');
  ladder([]);
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
      knownTotalMinor: 0,
      totalCount: 0,
      byEvent: {
        [IDS.eventChf]: {
          hammerMinor: 10000,
          knownHammerPlusBpMinor: 12500,
          bindingCount: 1,
          unknownPremiumCount: 0,
          knownTotalMinor: 0,
          totalCount: 0,
        },
      },
    },
    EUR: {
      hammerMinor: 8000,
      knownHammerPlusBpMinor: 9600,
      bindingCount: 1,
      unknownPremiumCount: 0,
      knownTotalMinor: 0,
      totalCount: 0,
      byEvent: {
        [IDS.eventEur]: {
          hammerMinor: 8000,
          knownHammerPlusBpMinor: 9600,
          bindingCount: 1,
          unknownPremiumCount: 0,
          knownTotalMinor: 0,
          totalCount: 0,
        },
      },
    },
    USD: {
      hammerMinor: 30000,
      knownHammerPlusBpMinor: 12500,
      bindingCount: 2,
      unknownPremiumCount: 1,
      knownTotalMinor: 0,
      totalCount: 0,
      byEvent: {
        [IDS.eventUsd]: {
          hammerMinor: 30000,
          knownHammerPlusBpMinor: 12500,
          bindingCount: 2,
          unknownPremiumCount: 1,
          knownTotalMinor: 0,
          totalCount: 0,
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
    // The settled bid's premium rate is known; the lot has no fees saved, so the cost says so.
    cost: { buyerPremiumBps: 2500, premium: { currency: 'USD', minor: 2375 }, missing: ['fees'] },
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

// 0.34 final review: the one own-key test the core modules share lives in core/fields.js; the projections import it rather than keep a copy.
test('core/projections.js takes OWN from core/fields.js and declares no copy of its own', () => {
  const source = readFileSync(new URL('../extension/core/projections.js', import.meta.url), 'utf8');
  assert.match(source, /^import \{[^}]*\bOWN\b[^}]*\} from '\.\/fields\.js';$/m);
  assert.doesNotMatch(source, /^(?:export )?(?:const|let|function) OWN\b/m);
});

// N1: what a won coin really cost, worked out from what the collector recorded for it and stored
// with the outcome. Künker's terms: 25 % premium with 19 % VAT on the premium.
const settledWon = (minor, buyerPremiumBps) => ({
  id: IDS.history, action: 'settled-won', amount: { currency: 'EUR', minor }, recordedAt: NOW,
  ...(buyerPremiumBps === undefined ? {} : { buyerPremiumBps }),
});
const KUENKER_FEES = Object.freeze({
  currency: 'EUR', shippingMinor: 1500, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1000, minimumBidMinor: 0,
  premiumVatBps: 1900,
});

test('a won coin carries its real cost: hammer, premium, VAT on the premium and every recorded fee, in one currency', () => {
  const lot = makeLot(IDS.lotEur, {
    activeBid: { amount: { currency: 'EUR', minor: 150000 }, buyerPremiumBps: 2500, placedAt: NOW },
    bidHistory: [{ ...settledWon(150000, 2500), action: 'placed' }],
    costEstimate: { ...KUENKER_FEES, platformFeeBps: 300 },
  });
  const won = setOutcome(lot, { status: 'won', hammer: { currency: 'EUR', minor: 130000 } }, NOW);
  assert.equal(won.ok, true, won.error?.message);
  // 1,300.00 + 325.00 premium + 61.75 VAT on it + 39.00 platform fee + 15.00 shipping = 1,740.75.
  assert.deepEqual(won.value.outcome.cost, {
    buyerPremiumBps: 2500,
    premium: { currency: 'EUR', minor: 32500 },
    premiumVat: { currency: 'EUR', minor: 6175 },
    platformFee: { currency: 'EUR', minor: 3900 },
    shipping: { currency: 'EUR', minor: 1500 },
    paymentFee: { currency: 'EUR', minor: 0 },
    total: { currency: 'EUR', minor: 174075 },
  });
  assert.equal(validateSnapshot(snapshotWith(won.value)).ok, true);
});

test('a missing figure makes the cost incomplete and says which, never a guess', () => {
  const noFees = setOutcome(makeLot(IDS.lotEur, {
    activeBid: { amount: { currency: 'EUR', minor: 150000 }, buyerPremiumBps: 2500, placedAt: NOW },
    bidHistory: [{ ...settledWon(150000, 2500), action: 'placed' }],
  }), { status: 'won', hammer: { currency: 'EUR', minor: 130000 } }, NOW);
  assert.deepEqual(noFees.value.outcome.cost, { buyerPremiumBps: 2500, premium: { currency: 'EUR', minor: 32500 }, missing: ['fees'] });

  const noRate = setOutcome(makeLot(IDS.lotEur, { costEstimate: KUENKER_FEES }),
    { status: 'won', hammer: { currency: 'EUR', minor: 130000 } }, NOW);
  assert.deepEqual(noRate.value.outcome.cost, { missing: ['premium-rate'] });

  const otherCurrency = setOutcome(makeLot(IDS.lotEur, {
    plannedBid: { amount: { currency: 'EUR', minor: 150000 }, buyerPremiumBps: 2000 },
    costEstimate: { ...KUENKER_FEES, currency: 'CHF' },
  }), { status: 'won', hammer: { currency: 'EUR', minor: 130000 } }, NOW);
  assert.deepEqual(otherCurrency.value.outcome.cost,
    { buyerPremiumBps: 2000, premium: { currency: 'EUR', minor: 26000 }, missing: ['fee-currency'] },
    'fees recorded in francs are never converted into a euro total');

  const noHammer = setOutcome(makeLot(IDS.lotEur), { status: 'won' }, NOW);
  assert.deepEqual(noHammer.value.outcome.cost, { missing: ['hammer', 'premium-rate', 'fees'] });
  for (const result of [noFees, noRate, otherCurrency, noHammer]) {
    assert.equal(validateSnapshot(snapshotWith(result.value)).ok, true);
  }
});

test('a hammer corrected on a won coin is costed again from the bid that won it, and only a won coin has a cost', () => {
  const lot = makeLot(IDS.lotEur, {
    outcome: { status: 'won', hammer: { currency: 'EUR', minor: 100000 }, verification: 'personal-unverified' },
    bidHistory: [settledWon(150000, 2000)],
    costEstimate: { ...KUENKER_FEES, premiumVatBps: undefined },
  });
  delete lot.costEstimate.premiumVatBps;
  const corrected = setOutcome(lot, { status: 'won', hammer: { currency: 'EUR', minor: 120000 } }, NOW);
  assert.equal(corrected.value.outcome.cost.total.minor, 120000 + 24000 + 1500);
  assert.equal(corrected.value.outcome.correctedAt, NOW);

  const lost = setOutcome(corrected.value, { status: 'lost', hammer: { currency: 'EUR', minor: 200000 } }, NOW);
  assert.equal(Object.hasOwn(lost.value.outcome, 'cost'), false, 'another bidder’s hammer is no cost of the collector’s');
  const reopened = setOutcome(corrected.value, { status: 'open', bindingActive: false }, NOW);
  assert.equal(Object.hasOwn(reopened.value.outcome, 'cost'), false);
  const supplied = setOutcome(makeLot(IDS.lotEur), { status: 'won', hammer: { currency: 'EUR', minor: 1 }, cost: { total: { currency: 'EUR', minor: 1 } } }, NOW);
  assert.deepEqual(supplied.value.outcome.cost, { missing: ['premium-rate', 'fees'] }, 'the store works the cost out; a caller cannot supply one');
});

test('a stored cost is held to its outcome: won only, the hammer’s currency, and a total that is its parts', () => {
  const won = setOutcome(makeLot(IDS.lotEur, {
    plannedBid: { amount: { currency: 'EUR', minor: 150000 }, buyerPremiumBps: 2500 }, costEstimate: KUENKER_FEES,
  }), { status: 'won', hammer: { currency: 'EUR', minor: 130000 } }, NOW).value;
  const broken = (change) => { const lot = structuredClone(won); change(lot.outcome); return validateSnapshot(snapshotWith(lot)); };
  assert.equal(broken((outcome) => { outcome.cost.total.minor += 1; }).error.code, 'invalid-cost');
  assert.equal(broken((outcome) => { outcome.cost.premium.currency = 'USD'; }).error.code, 'invalid-cost');
  assert.equal(broken((outcome) => { outcome.cost.missing = ['fees']; }).error.code, 'invalid-cost');
  assert.equal(broken((outcome) => { delete outcome.cost.total; }).error.code, 'invalid-cost');
  assert.equal(broken((outcome) => { outcome.cost = { missing: ['guessed'] }; }).error.code, 'invalid-enum');
  assert.equal(broken((outcome) => { outcome.status = 'lost'; }).error.code, 'invalid-cost');
  // A coin won before costs were worked out carries none, and still validates.
  const older = structuredClone(won); delete older.outcome.cost;
  assert.equal(validateSnapshot(snapshotWith(older)).ok, true);
});

// N12: an entry says which of its fields the collector corrected on it, from a closed list, each once.
test('a collection entry’s corrected fields are named from a closed list, each once', () => {
  const lot = makeLot(IDS.lotEur, { outcome: { status: 'won' }, collectionEntryId: IDS.collection });
  const entry = (editedFields) => ({
    id: IDS.collection, revision: 0, dataClass: 'collector', lotId: IDS.lotEur, title: 'Coin', acquisitionDate: '2026-09-12',
    sourceLinks: [], createdAt: NOW, updatedAt: NOW, ...(editedFields ? { editedFields } : {}),
  });
  const root = (editedFields) => { const snapshot = snapshotWith(lot); snapshot.collectionEntries.push(entry(editedFields)); return validateSnapshot(snapshot); };
  assert.equal(root(undefined).ok, true, 'an entry written before corrections existed');
  assert.equal(root(['acquisitionDate', 'actualInvoice', 'notes']).ok, true);
  assert.equal(root(['hammer']).error.code, 'invalid-enum');
  assert.equal(root(['notes', 'notes']).error.code, 'duplicate-field');
  assert.equal(root('notes').error.code, 'collection-limit');
});

// Fix round, Important 2: one rule for an entry following its won lot, used by the store, a merge and the load.
test('followOutcome carries a won lot\u2019s hammer and invoice to its entry, except an invoice the collector corrected', () => {
  const eur = (minor) => ({ currency: 'EUR', minor });
  const lot = makeLot(IDS.lotEur, { outcome: { status: 'won', hammer: eur(131000), actualInvoice: eur(160000), verification: 'personal-unverified' } });
  const entry = { hammer: eur(130000), actualInvoice: eur(159000) };
  assert.equal(followOutcome(entry, lot), true);
  assert.deepEqual(entry, { hammer: eur(131000), actualInvoice: eur(160000) });
  assert.equal(followOutcome(entry, lot), false, 'an entry already in step is left alone');
  const corrected = { hammer: eur(130000), actualInvoice: eur(1), editedFields: ['actualInvoice'] };
  assert.equal(followOutcome(corrected, lot), true);
  assert.deepEqual(corrected.actualInvoice, eur(1));
  assert.deepEqual(corrected.hammer, eur(131000));
  const cleared = { hammer: eur(131000), editedFields: ['actualInvoice'] };
  assert.equal(followOutcome(cleared, lot), false, 'an invoice the collector cleared stays cleared');
  const lost = { hammer: eur(130000) };
  assert.equal(followOutcome(lost, { ...lot, outcome: { status: 'lost', hammer: eur(9), verification: 'personal-unverified' } }), false);
  assert.deepEqual(lost.hammer, eur(130000));
  const noHammer = { hammer: eur(130000) };
  assert.equal(followOutcome(noHammer, { ...lot, outcome: { status: 'won' } }), true);
  assert.equal(Object.hasOwn(noHammer, 'hammer'), false);
});

// Fix round, Minor 3: after a re-open, a plan revised later than the last win is the rate the coin is won on again.
test('a coin re-opened, planned again and won again is costed at the newest rate', () => {
  const lot = makeLot(IDS.lotEur, {
    outcome: { status: 'open' },
    plannedBid: { amount: { currency: 'EUR', minor: 100000 }, buyerPremiumBps: 2000 },
    bidHistory: [
      { id: '55555555-5555-4555-8555-000000000001', action: 'settled-won', amount: { currency: 'EUR', minor: 90000 }, buyerPremiumBps: 2500, recordedAt: NOW },
      { id: '55555555-5555-4555-8555-000000000002', action: 'reopened-inactive', amount: { currency: 'EUR', minor: 90000 }, buyerPremiumBps: 2500, recordedAt: NOW },
      { id: '55555555-5555-4555-8555-000000000003', action: 'planned-revised', amount: { currency: 'EUR', minor: 100000 }, buyerPremiumBps: 2000, recordedAt: NOW },
    ],
  });
  const won = setOutcome(lot, { status: 'won', hammer: { currency: 'EUR', minor: 100000 } }, NOW);
  assert.equal(won.value.outcome.cost.buyerPremiumBps, 2000);
  // Without a later plan, the settled bid's rate stands even when an older plan is still saved.
  const settledLast = { ...lot, bidHistory: [lot.bidHistory[2], lot.bidHistory[0], lot.bidHistory[1]] };
  assert.equal(setOutcome(settledLast, { status: 'won', hammer: { currency: 'EUR', minor: 100000 } }, NOW).value.outcome.cost.buyerPremiumBps, 2500);
});

// Q-01: a coin won without a recorded bid (a floor bid, a phone bid, a coin entered from the invoice) gets its cost
// from the premium rate and fee sheet the Outcome form states. The store still works the cost out; the terms are
// inputs, kept with the outcome so a later correction of the hammer is costed on them again.
test('a coin won without a bid is costed from the premium and fees its outcome states, and they are kept for a correction', () => {
  const lot = makeLot(IDS.lotEur);
  const hammer = { currency: 'EUR', minor: 90000 };
  const won = setOutcome(lot, { status: 'won', hammer, terms: { buyerPremiumBps: 2000, costEstimate: KUENKER_FEES } }, NOW);
  assert.equal(won.ok, true, won.error?.message);
  // 900.00 + 180.00 premium + 34.20 VAT on it + 15.00 shipping.
  assert.equal(won.value.outcome.cost.total.minor, 90000 + 18000 + 3420 + 1500);
  assert.deepEqual(won.value.outcome.terms, { buyerPremiumBps: 2000, costEstimate: KUENKER_FEES });
  assert.equal(validateSnapshot(snapshotWith(won.value)).ok, true);

  const rateOnly = setOutcome(lot, { status: 'won', hammer, terms: { buyerPremiumBps: 2000 } }, NOW);
  assert.deepEqual(rateOnly.value.outcome.cost, { buyerPremiumBps: 2000, premium: { currency: 'EUR', minor: 18000 }, missing: ['fees'] });

  const corrected = setOutcome(won.value, { status: 'won', hammer: { currency: 'EUR', minor: 100000 } }, NOW);
  assert.deepEqual(corrected.value.outcome.terms, won.value.outcome.terms, 'a correction that does not restate the terms keeps them');
  assert.equal(corrected.value.outcome.cost.total.minor, 100000 + 20000 + 3800 + 1500);
  const cleared = setOutcome(won.value, { status: 'won', hammer, terms: null }, NOW);
  assert.equal(Object.hasOwn(cleared.value.outcome, 'terms'), false);
  assert.deepEqual(cleared.value.outcome.cost, { missing: ['premium-rate', 'fees'] });
  const lost = setOutcome(won.value, { status: 'lost', hammer }, NOW);
  assert.equal(Object.hasOwn(lost.value.outcome, 'terms'), false, 'terms belong to a won coin only');
});

test('the outcome’s own terms are what the coin was won on, over the bid’s rate and the lot’s fee sheet', () => {
  const lot = makeLot(IDS.lotEur, {
    activeBid: { amount: { currency: 'EUR', minor: 150000 }, buyerPremiumBps: 2500, placedAt: NOW },
    bidHistory: [{ ...settledWon(150000, 2500), action: 'placed' }],
    costEstimate: KUENKER_FEES,
  });
  const won = setOutcome(lot, { status: 'won', hammer: { currency: 'EUR', minor: 100000 }, terms: { buyerPremiumBps: 2000 } }, NOW);
  assert.equal(won.value.outcome.cost.buyerPremiumBps, 2000);
  assert.equal(won.value.outcome.cost.premiumVat.minor, 3800, 'the lot’s own fee sheet still applies where the outcome states none');
});

test('outcome terms are refused off a won coin, in another currency than the hammer, or out of shape', () => {
  const lot = makeLot(IDS.lotEur);
  const hammer = { currency: 'EUR', minor: 90000 };
  const refused = (outcome) => setOutcome(lot, outcome, NOW);
  assert.equal(refused({ status: 'lost', hammer, terms: { buyerPremiumBps: 2000 } }).error.path, 'outcome.terms');
  assert.equal(refused({ status: 'won', hammer, terms: { costEstimate: { ...KUENKER_FEES, currency: 'CHF' } } }).error.path, 'outcome.terms.costEstimate.currency');
  assert.equal(refused({ status: 'won', hammer, terms: { buyerPremiumBps: 10001 } }).error.path, 'outcome.terms.buyerPremiumBps');
  assert.equal(refused({ status: 'won', hammer, terms: { costEstimate: { ...KUENKER_FEES, shippingMinor: -1 } } }).error.path, 'outcome.terms.costEstimate.shippingMinor');
  assert.equal(refused({ status: 'won', hammer, terms: 'twenty' }).error.path, 'outcome.terms');
  const stored = setOutcome(lot, { status: 'won', hammer, terms: { buyerPremiumBps: 2000 } }, NOW).value;
  const broken = structuredClone(stored); broken.outcome.status = 'lost'; delete broken.outcome.cost;
  assert.equal(validateSnapshot(snapshotWith(broken)).error.path, `lots[0].outcome.terms`);
});

// Q-05: a lot placed with a rate, settled Lost by a slip of the radio button and corrected to Won keeps its rate.
test('a coin corrected from Lost to Won is costed at the rate its settled bid carried', () => {
  const lot = makeLot(IDS.lotEur, {
    activeBid: { amount: { currency: 'EUR', minor: 50000 }, buyerPremiumBps: 2000, placedAt: NOW },
    bidHistory: [{ ...settledWon(50000, 2000), action: 'placed' }],
    costEstimate: KUENKER_FEES,
  });
  const lost = setOutcome(lot, { status: 'lost', hammer: { currency: 'EUR', minor: 65000 } }, NOW);
  const won = setOutcome(lost.value, { status: 'won', hammer: { currency: 'EUR', minor: 48000 } }, NOW);
  assert.equal(won.value.outcome.cost.buyerPremiumBps, 2000);
  assert.equal(won.value.outcome.cost.total.minor, 48000 + 9600 + 1824 + 1500);
  // Re-opened without the terms being active again, then won: the re-open entry carries the same rate.
  const reopened = setOutcome(lost.value, { status: 'open', bindingActive: false }, NOW);
  const wonAfterReopen = setOutcome(reopened.value, { status: 'won', hammer: { currency: 'EUR', minor: 48000 } }, NOW);
  assert.equal(wonAfterReopen.value.outcome.cost.buyerPremiumBps, 2000);
});

// Q-04: import VAT saved with the fee sheet is costed on a won coin as its own part. The stored total stays the
// hammer and the five parts 0.36.0 checks, so a backup from this version still imports there; the import VAT is kept
// beside it and costTotal adds it.
test('a won coin’s import VAT is kept beside its total, and the full total adds it', async () => {
  const { costTotal, costFees } = await import('../extension/core/projections.js');
  const lot = makeLot(IDS.lotEur, {
    plannedBid: { amount: { currency: 'EUR', minor: 100000 }, buyerPremiumBps: 2500 },
    costEstimate: { ...KUENKER_FEES, importVatBps: 500 },
  });
  const won = setOutcome(lot, { status: 'won', hammer: { currency: 'EUR', minor: 100000 } }, NOW);
  const cost = won.value.outcome.cost;
  // 1,000 + 250 + 15 shipping = 1,265.00 at 5 %.
  assert.deepEqual(cost.importVat, { currency: 'EUR', minor: 6325 });
  assert.equal(cost.total.minor, 100000 + 25000 + 4750 + 1500, 'the stored total is the house invoice, shipping and payment fee');
  assert.equal(costTotal(cost).minor, 100000 + 25000 + 4750 + 1500 + 6325);
  assert.equal(costFees(cost).minor, 4750 + 1500 + 6325);
  assert.equal(validateSnapshot(snapshotWith(won.value)).ok, true);
  const broken = structuredClone(won.value); broken.outcome.cost.importVat.currency = 'USD';
  assert.equal(validateSnapshot(snapshotWith(broken)).error.code, 'invalid-cost');
  const noTotal = structuredClone(won.value); delete noTotal.outcome.cost.total; noTotal.outcome.cost.missing = ['fees'];
  assert.equal(validateSnapshot(snapshotWith(noTotal)).error.code, 'invalid-cost', 'import VAT belongs to a complete cost');
  const badRate = structuredClone(won.value); badRate.costEstimate.importVatBps = 10001;
  assert.equal(validateSnapshot(snapshotWith(badRate)).error.path, 'lots[0].costEstimate.importVatBps');
});

// Q-11: what leaves the account if every active bid wins: hammer, premium and the fees saved beside each bid, in the
// bid's currency, counted only where the premium is known and the fee sheet is in that currency - never converted.
test('exposure adds the all-in total of the bids whose premium and fees are known in their own currency', () => {
  const fees = { currency: 'EUR', shippingMinor: 1500, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0, premiumVatBps: 1900 };
  const exposure = projectExposure(snapshotWith(
    makeLot(IDS.lotEur, { auctionEventId: IDS.eventEur, activeBid: { amount: { currency: 'EUR', minor: 130000 }, buyerPremiumBps: 2000, placedAt: NOW }, costEstimate: fees }),
    makeLot(IDS.lotChf, { auctionEventId: IDS.eventEur, activeBid: { amount: { currency: 'EUR', minor: 10000 }, buyerPremiumBps: 2000, placedAt: NOW }, costEstimate: { ...fees, currency: 'CHF' } }),
    makeLot(IDS.lotPlanned, { auctionEventId: IDS.eventEur, activeBid: { amount: { currency: 'EUR', minor: 10000 }, placedAt: NOW }, costEstimate: fees }),
  ));
  // 1,300 + 260 premium + 49.40 VAT on it + 15 shipping.
  assert.equal(exposure.EUR.knownTotalMinor, 130000 + 26000 + 4940 + 1500);
  assert.equal(exposure.EUR.totalCount, 1, 'fees in francs and an unknown premium are left out, not guessed');
  assert.equal(exposure.EUR.bindingCount, 3);
  assert.equal(exposure.EUR.byEvent[IDS.eventEur].knownTotalMinor, 130000 + 26000 + 4940 + 1500);
});

// Fix round, Important 2: "No fees were charged beyond the premium" is `terms.costEstimate: null` - a complete cost of
// hammer + premium, over the fee sheet saved with the bid; a correction that restates nothing keeps it.
test('outcome terms with no fee sheet cost the coin at hammer and premium alone, over the bid’s sheet', () => {
  const lot = makeLot(IDS.lotEur, {
    activeBid: { amount: { currency: 'EUR', minor: 150000 }, buyerPremiumBps: 2000, placedAt: NOW },
    bidHistory: [{ ...settledWon(150000, 2000), action: 'placed' }],
    costEstimate: KUENKER_FEES,
  });
  const none = setOutcome(lot, { status: 'won', hammer: { currency: 'EUR', minor: 100000 }, terms: { costEstimate: null } }, NOW);
  assert.equal(none.ok, true, none.error?.message);
  assert.equal(none.value.outcome.cost.total.minor, 100000 + 20000);
  assert.equal(none.value.outcome.cost.shipping.minor, 0);
  assert.deepEqual(none.value.outcome.terms, { costEstimate: null });
  assert.equal(validateSnapshot(snapshotWith(none.value)).ok, true);
  const corrected = setOutcome(none.value, { status: 'won', hammer: { currency: 'EUR', minor: 110000 } }, NOW);
  assert.equal(corrected.value.outcome.cost.total.minor, 110000 + 22000, 'kept over a correction');
  const blank = setOutcome(lot, { status: 'won', hammer: { currency: 'EUR', minor: 100000 } }, NOW);
  assert.equal(blank.value.outcome.cost.total.minor, 100000 + 20000 + 3800 + 1500, 'no terms: the bid’s sheet applies');
});

// Fix round, Minor 1: a grid-only sheet (increment and minimum, no fee recorded) is no fee sheet for a coin's cost.
test('a grid-only sheet records no fees: the won cost names the gap, and gridOnly is true or absent', () => {
  const grid = { currency: 'EUR', shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 2500, minimumBidMinor: 10000, gridOnly: true };
  const lot = makeLot(IDS.lotEur, { plannedBid: { amount: { currency: 'EUR', minor: 100000 }, buyerPremiumBps: 2000 }, costEstimate: grid });
  const won = setOutcome(lot, { status: 'won', hammer: { currency: 'EUR', minor: 100000 } }, NOW);
  assert.deepEqual(won.value.outcome.cost.missing, ['fees']);
  assert.equal(validateSnapshot(snapshotWith(won.value)).ok, true);
  const broken = structuredClone(won.value); broken.costEstimate.gridOnly = false;
  assert.equal(validateSnapshot(snapshotWith(broken)).error.path, 'lots[0].costEstimate.gridOnly');
});

// Re-review: a grid-only sheet holds no fee, and an outcome's own terms carry fees, never a grid alone.
test('gridOnly is refused beside a fee, and inside an outcome’s terms', () => {
  const grid = { currency: 'EUR', shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 2500, minimumBidMinor: 0, gridOnly: true };
  for (const fee of [{ shippingMinor: 1500 }, { paymentFeeBps: 100 }, { paymentFeeMinor: 50 }, { premiumVatBps: 1900 }, { platformFeeBps: 300 }, { importVatBps: 500 }]) {
    const lot = makeLot(IDS.lotEur, { costEstimate: { ...grid, ...fee } });
    assert.equal(validateSnapshot(snapshotWith(lot)).error?.path, 'lots[0].costEstimate.gridOnly', JSON.stringify(fee));
  }
  assert.equal(validateSnapshot(snapshotWith(makeLot(IDS.lotEur, { costEstimate: { ...grid, premiumVatBps: 0 } }))).ok, true, 'a fee of nothing is no fee');
  const refused = setOutcome(makeLot(IDS.lotEur), { status: 'won', hammer: { currency: 'EUR', minor: 100000 }, terms: { costEstimate: grid } }, NOW);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.path, 'outcome.terms.costEstimate.gridOnly');
});

// Re-review: a grid-only sheet beside an active bid adds nothing to the all-in exposure.
test('a grid-only sheet beside an active bid counts no fees in the all-in exposure', () => {
  const grid = { currency: 'EUR', shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 2500, minimumBidMinor: 0, gridOnly: true };
  const exposure = projectExposure(snapshotWith(makeLot(IDS.lotEur, {
    auctionEventId: IDS.eventEur, activeBid: { amount: { currency: 'EUR', minor: 100000 }, buyerPremiumBps: 2000, placedAt: NOW }, costEstimate: grid,
  })));
  assert.equal(exposure.EUR.totalCount, 0);
  assert.equal(exposure.EUR.knownTotalMinor, 0);
});
