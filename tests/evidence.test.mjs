import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStatistics,
  deduplicateEvidence,
  normalizeSourceUrl,
  sameEventKey,
  validateSaleEvidence,
} from '../extension/core/evidence.js';

const observedAt = '2026-09-12T10:00:00.000Z';

function observation(id, overrides = {}) {
  return {
    id,
    queryId: 'query-1',
    source: 'manual',
    retrievedAt: observedAt,
    houseSaleId: `Sale ${id}`,
    auctionHouse: 'Example Numismatics',
    auctionName: `Auction ${id}`,
    auctionDate: '2024-05-06',
    lotNumber: '27',
    priceBasis: 'hammer',
    amount: { currency: 'USD', minor: 10000 },
    dataClass: 'collector',
    ...overrides,
  };
}

function evidence(id, minor, overrides = {}) {
  const resolved = Object.hasOwn(overrides, 'resolved')
    ? overrides.resolved
    : { priceBasis: 'hammer', hammer: { currency: 'USD', minor }, resolution: 'source-agreement' };
  const item = observation(`${id}-observation`, {
    ...(resolved?.hammer ? { amount: { ...resolved.hammer } } : {}),
    ...overrides.observation,
  });
  return {
    id,
    dataClass: item.dataClass,
    observations: [item],
    resolved,
    inclusion: 'included',
    ...overrides,
  };
}

const filters = Object.freeze({
  currency: 'USD',
  fromDate: '2000-01-01',
  toDate: '2026-12-31',
  sources: ['manual'],
  mode: 'live',
});

test('normalizes source URLs without erasing lot identity', () => {
  assert.deepEqual(
    normalizeSourceUrl('HTTPS://Example.test:443/lot?lotId=27&utm_source=x&gclid=y#/lot/27'),
    { ok: true, value: 'https://example.test/lot?lotId=27#/lot/27' },
  );
  assert.deepEqual(
    normalizeSourceUrl('https://x.test/?id=2&utmish=keep&auction_id=3&fbclid=x#identity'),
    { ok: true, value: 'https://x.test/?id=2&utmish=keep&auction_id=3#identity' },
  );
  assert.notEqual(
    normalizeSourceUrl('https://x.test/?lot=1#/detail/1').value,
    normalizeSourceUrl('https://x.test/?lot=2#/detail/2').value,
  );
  for (const value of ['', 'not a URL', 'http://example.test', 'javascript:alert(1)']) {
    assert.equal(normalizeSourceUrl(value).ok, false);
  }
});

test('event identity requires house-issued sale identity and never promotes a provider ID', () => {
  const canonical = observation('ca-1', {
    source: 'coinarchives',
    sourceRecordId: 'provider-901',
    auctionHouse: ' Example   NUMISMATICS ',
    houseSaleId: ' Auction 42 ',
    lotNumber: ' 27 A ',
    dataClass: 'authorized',
  });
  const mapped = observation('ac-1', {
    source: 'acsearch',
    sourceRecordId: 'provider-313',
    auctionHouse: 'example numismatics',
    houseSaleId: 'auction 42',
    lotNumber: '27 a',
    houseSaleIdMapping: {
      providerRecordId: 'provider-313',
      houseSaleId: 'auction 42',
      basis: 'provider-field-mapped-to-house-catalogue',
    },
    dataClass: 'authorized',
  });
  assert.equal(sameEventKey(canonical).ok, true);
  assert.deepEqual(sameEventKey(mapped), sameEventKey(canonical));

  const providerOnly = { ...canonical, houseSaleId: undefined, auctionName: 'Auction 42' };
  assert.equal(sameEventKey(providerOnly).ok, false);
  assert.equal(sameEventKey(providerOnly).error.code, 'weak-sale-identity');
  assert.notDeepEqual(
    sameEventKey(canonical),
    sameEventKey({ ...canonical, houseSaleId: 'Auction 43' }),
  );
});

test('deduplicates a mapped cross-provider event while retaining every claim and provenance field', () => {
  const first = observation('ca-1', {
    source: 'coinarchives',
    sourceRecordId: 'ca-record',
    sourceUrl: 'https://www.coinarchives.com/a/lotviewer.php?LotID=1',
    houseSaleId: 'Auction 42',
    auctionName: 'Auction 42',
    dataClass: 'authorized',
  });
  const second = observation('ac-1', {
    source: 'acsearch',
    sourceRecordId: 'ac-record',
    sourceUrl: 'https://www.acsearch.info/search.html?id=2#lot',
    houseSaleId: 'Auction 42',
    auctionName: 'Auction 42',
    houseSaleIdMapping: {
      providerRecordId: 'ac-record',
      houseSaleId: 'Auction 42',
      basis: 'collector-verified-catalogue',
    },
    dataClass: 'authorized',
  });

  const result = deduplicateEvidence([first, second]);
  assert.equal(result.ok, true);
  assert.equal(result.value.evidence.length, 1);
  assert.deepEqual(result.value.mergedObservationIds, ['ac-1']);
  assert.deepEqual(result.value.conflicts, []);
  assert.deepEqual(result.value.evidence[0].observations, [first, second]);
  assert.deepEqual(result.value.evidence[0].resolved, {
    priceBasis: 'hammer',
    hammer: { currency: 'USD', minor: 10000 },
    resolution: 'source-agreement',
  });
});

test('keeps later events, weak identities, and sample observations separate', () => {
  const common = { title: 'same presumed specimen', reference: 'RIC 1' };
  const result = deduplicateEvidence([
    observation('event-1', { ...common, houseSaleId: 'Sale A' }),
    observation('event-2', { ...common, houseSaleId: 'Sale B', auctionDate: '2025-05-06' }),
    observation('weak-1', { ...common, houseSaleId: undefined }),
    observation('weak-2', { ...common, houseSaleId: undefined }),
    observation('sample-1', { ...common, houseSaleId: 'Sale A', dataClass: 'sample' }),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.value.evidence.length, 5);
  assert.deepEqual(result.value.mergedObservationIds, []);
});

test('same-event disagreements retain every observation and become explicit conflicts', () => {
  const observations = [
    observation('base', { houseSaleId: 'Sale 50', auctionName: 'Spring', auctionDate: '2024-05-06' }),
    observation('amount', { houseSaleId: 'Sale 50', amount: { currency: 'USD', minor: 10100 } }),
    observation('currency', { houseSaleId: 'Sale 50', amount: { currency: 'EUR', minor: 10000 } }),
    observation('basis', { houseSaleId: 'Sale 50', priceBasis: 'estimate' }),
    observation('identity', { houseSaleId: 'Sale 50', auctionName: 'Spring evening', auctionDate: '2024-05-07' }),
  ];
  const result = deduplicateEvidence(observations);
  assert.equal(result.ok, true);
  const [row] = result.value.evidence;
  assert.deepEqual(row.observations, observations);
  assert.equal(row.inclusion, 'excluded');
  assert.equal(row.exclusionReason, 'conflict');
  assert.deepEqual(row.conflictFields, ['auctionName', 'auctionDate', 'amount', 'currency', 'priceBasis']);
  assert.deepEqual(result.value.conflicts, [row.id]);
});

test('missing optional auction metadata does not create a contradiction', () => {
  const result = deduplicateEvidence([
    observation('named', { houseSaleId: 'Sale 60', auctionName: 'Spring sale' }),
    observation('unnamed', { houseSaleId: 'Sale 60', auctionName: undefined }),
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.conflicts, []);
  assert.equal(result.value.evidence[0].inclusion, 'included');
});

test('deduplication validates required observation fields and money', () => {
  assert.equal(deduplicateEvidence([observation('bad', { id: '' })]).ok, false);
  assert.equal(deduplicateEvidence([observation('bad', { auctionDate: '06/05/2024' })]).ok, false);
  assert.equal(deduplicateEvidence([observation('bad', { amount: { currency: 'USD', minor: 1.5 } })]).ok, false);
  assert.equal(deduplicateEvidence([observation('bad', { retrievedAt: '2026-02-30T10:00:00.000Z' })]).ok, false);
});

test('deduplication emits stable UUID-form evidence IDs', () => {
  const source = observation('observation-1');
  const first = deduplicateEvidence([source]).value.evidence[0].id;
  const second = deduplicateEvidence([{ ...source }]).value.evidence[0].id;
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first, second);
});

test('validates complete durable sale evidence and rejects sample or malformed claims in live mode', () => {
  const valid = {
    id: '10000000-0000-4000-8000-000000000001',
    dataClass: 'authorized',
    saleIdentity: {
      auctionHouse: 'Example Numismatics',
      houseSaleId: 'Auction 42',
      lotNumber: '27',
    },
    observations: [{
      ...observation('ignored'),
      id: '10000000-0000-4000-8000-000000000002',
      queryId: '10000000-0000-4000-8000-000000000003',
      queryLabel: 'Nero denarius RIC 306',
      source: 'acsearch',
      dataClass: 'authorized',
      houseSaleId: 'Auction 42',
      houseSaleIdMapping: {
        providerRecordId: 'ac-27',
        houseSaleId: 'Auction 42',
        basis: 'collector-verified-catalogue',
      },
    }],
    resolved: {
      priceBasis: 'hammer',
      hammer: { currency: 'USD', minor: 10000 },
      resolution: 'source-agreement',
    },
    inclusion: 'included',
  };
  assert.deepEqual(validateSaleEvidence(valid), { ok: true, value: valid });
  assert.equal(validateSaleEvidence({ ...valid, dataClass: 'sample' }).ok, false);
  assert.equal(validateSaleEvidence({ ...valid, observations: [{ ...valid.observations[0], sourceUrl: 'http://unsafe.test' }] }).ok, false);
  assert.doesNotThrow(() => validateSaleEvidence({ ...valid, observations: [{ ...valid.observations[0], sourceUrl: null }] }));
  assert.equal(validateSaleEvidence({ ...valid, observations: [{ ...valid.observations[0], sourceUrl: null }] }).ok, false);
  assert.equal(validateSaleEvidence({ ...valid, observations: [{ ...valid.observations[0], queryLabel: ' padded ' }] }).ok, false);
  assert.equal(validateSaleEvidence({ ...valid, observations: [{ ...valid.observations[0], queryLabel: 'bad\nlabel' }] }).ok, false);
  assert.equal(validateSaleEvidence({ ...valid, resolved: { ...valid.resolved, hammer: { currency: 'USD', minor: 1.5 } } }).ok, false);
  assert.equal(validateSaleEvidence({ ...valid, inclusion: 'excluded' }).ok, false);
  assert.equal(validateSaleEvidence({ ...valid, inclusion: 'other' }).ok, false);
  assert.equal(validateSaleEvidence({ ...valid, resolved: { ...valid.resolved, resolution: 'guessed' } }).ok, false);
  assert.equal(validateSaleEvidence({ ...valid, resolved: { ...valid.resolved, hammer: { currency: 'USD', minor: 999 } } }).ok, false);

  const sample = {
    ...valid,
    id: 'sample-row',
    dataClass: 'sample',
    observations: [{ ...valid.observations[0], id: 'sample-observation', queryId: 'sample-query', source: 'manual', dataClass: 'sample' }],
  };
  assert.equal(validateSaleEvidence(sample, { mode: 'sample' }).ok, true);
});

test('computes the specified median-of-halves statistics from integer minor units', () => {
  const amounts = [9000, 11000, 13500, 16500, 18000, 21500, 24500, 31000, 45000];
  const result = computeStatistics(amounts.map((minor, index) => evidence(`sale-${index}`, minor)), filters);
  assert.equal(result.validationError, null);
  assert.deepEqual(
    [result.count, result.median.minor, result.lowerQuartile.minor, result.upperQuartile.minor],
    [9, 18000, 12250, 27750],
  );
  assert.equal(result.presentation.eligible, true);
  assert.equal(result.presentation.label, 'Evidence-backed');
  assert.deepEqual(result.includedIds, amounts.map((_, index) => `sale-${index}`));
});

test('rounds half-minor medians away from zero and labels three or four rows limited', () => {
  const result = computeStatistics(
    [100, 101, 200, 201].map((minor, index) => evidence(`even-${index}`, minor)),
    filters,
  );
  assert.deepEqual(
    [result.median.minor, result.lowerQuartile.minor, result.upperQuartile.minor],
    [151, 101, 201],
  );
  assert.deepEqual(result.presentation, { eligible: true, label: 'Limited evidence' });
});

test('suppresses headline statistics below three included sales', () => {
  for (const count of [0, 1, 2]) {
    const result = computeStatistics(
      Array.from({ length: count }, (_, index) => evidence(`small-${count}-${index}`, index + 1)),
      filters,
    );
    assert.equal(result.count, count);
    assert.equal(result.median, null);
    assert.equal(result.lowerQuartile, null);
    assert.equal(result.upperQuartile, null);
    assert.deepEqual(result.presentation, { eligible: false, label: 'Insufficient evidence' });
  }
});

test('applies inclusive dates, source and currency filters without cross-currency mixing', () => {
  const candidates = [
    evidence('from-boundary', 100, { observation: { auctionDate: '2020-01-01' } }),
    evidence('to-boundary', 200, { observation: { auctionDate: '2020-12-31' } }),
    evidence('too-early', 300, { observation: { auctionDate: '2019-12-31' } }),
    evidence('wrong-source', 400, { observation: { source: 'acsearch', dataClass: 'authorized' }, dataClass: 'authorized' }),
    evidence('wrong-currency', 500, {
      observation: { auctionDate: '2020-06-01' },
      resolved: { priceBasis: 'hammer', hammer: { currency: 'EUR', minor: 500 }, resolution: 'source-agreement' },
    }),
  ];
  const result = computeStatistics(candidates, {
    ...filters,
    fromDate: '2020-01-01',
    toDate: '2020-12-31',
  });
  assert.deepEqual(result.includedIds, ['from-boundary', 'to-boundary']);
  assert.deepEqual(result.excluded, [
    { id: 'too-early', reason: 'date' },
    { id: 'wrong-source', reason: 'source-filter' },
    { id: 'wrong-currency', reason: 'currency' },
  ]);
});

test('retains explicit reasons for non-comparable, conflicted, and collector-excluded evidence', () => {
  const candidates = [
    evidence('collector', 1, { inclusion: 'excluded', exclusionReason: 'collector-excluded' }),
    evidence('conflict', 1, { inclusion: 'excluded', exclusionReason: 'conflict', conflictFields: ['amount'] }),
    evidence('estimate', 1, { resolved: undefined, observations: [observation('estimate-ob', { priceBasis: 'estimate' })] }),
    evidence('unsold', 1, { resolved: undefined, observations: [observation('unsold-ob', { priceBasis: 'unsold', amount: undefined })] }),
    evidence('missing', 1, { resolved: undefined, observations: [observation('missing-ob', { priceBasis: 'missing', amount: undefined })] }),
    evidence('bp', 1, { resolved: undefined, observations: [observation('bp-ob', { priceBasis: 'hammer-plus-bp' })] }),
  ];
  const result = computeStatistics(candidates, filters);
  assert.deepEqual(result.excluded, [
    { id: 'collector', reason: 'collector-excluded' },
    { id: 'conflict', reason: 'conflict' },
    { id: 'estimate', reason: 'estimate' },
    { id: 'unsold', reason: 'unsold' },
    { id: 'missing', reason: 'missing-price' },
    { id: 'bp', reason: 'not-comparable' },
  ]);
  assert.equal(result.coverage.conflicts, 1);
  assert.deepEqual(result.coverage.exclusionCounts, {
    'collector-excluded': 1,
    conflict: 1,
    estimate: 1,
    unsold: 1,
    'missing-price': 1,
    'not-comparable': 1,
  });
});

test('computes each supported currency independently', () => {
  const rows = ['USD', 'EUR', 'GBP', 'CHF'].flatMap((currency) => [100, 200, 300].map((minor, index) => evidence(
    `${currency}-${index}`,
    minor,
    { resolved: { priceBasis: 'hammer', hammer: { currency, minor }, resolution: 'source-agreement' } },
  )));
  for (const currency of ['USD', 'EUR', 'GBP', 'CHF']) {
    const result = computeStatistics(rows, { ...filters, currency });
    assert.equal(result.count, 3);
    assert.deepEqual(result.median, { currency, minor: 200 });
  }
});

test('isolates fictional samples from live evidence and carries provenance and coverage', () => {
  const sample = evidence('sample', 100, {
    dataClass: 'sample',
    observation: { dataClass: 'sample', queryId: 'sample-query', retrievedAt: '2026-09-10T00:00:00.000Z' },
  });
  const live = evidence('live', 200);
  const liveResult = computeStatistics([sample, live], filters);
  assert.deepEqual(liveResult.includedIds, ['live']);
  assert.deepEqual(liveResult.excluded, [{ id: 'sample', reason: 'sample-data' }]);
  assert.equal(liveResult.fictional, false);
  assert.deepEqual(liveResult.provenance.queryIds, ['query-1']);
  assert.deepEqual(liveResult.provenance.retrievedAt, [observedAt]);

  const sampleResult = computeStatistics([sample, live], { ...filters, mode: 'sample' });
  assert.deepEqual(sampleResult.includedIds, ['sample']);
  assert.deepEqual(sampleResult.excluded, [{ id: 'live', reason: 'not-sample-data' }]);
  assert.equal(sampleResult.fictional, true);
  assert.deepEqual(sampleResult.coverage, {
    availableSources: ['manual'],
    unavailableSources: [],
    conflicts: 0,
    exclusionCounts: { 'not-sample-data': 1 },
    incomplete: true,
  });
});

test('does not report sample-only sources or provenance as live coverage', () => {
  const sample = evidence('sample-ca', 100, {
    dataClass: 'sample',
    observation: { source: 'coinarchives', dataClass: 'sample', queryId: 'sample-query' },
  });
  const result = computeStatistics([sample], { ...filters, sources: ['coinarchives'] });
  assert.deepEqual(result.coverage.availableSources, []);
  assert.deepEqual(result.coverage.unavailableSources, ['coinarchives']);
  assert.deepEqual(result.provenance, { queryIds: [], retrievedAt: [] });
});

test('a collector-selected resolution follows its chosen observation through filters', () => {
  const ca = observation('ca', { source: 'coinarchives', dataClass: 'authorized', houseSaleId: 'Sale 99', amount: { currency: 'USD', minor: 100 } });
  const ac = observation('ac', { source: 'acsearch', dataClass: 'authorized', houseSaleId: 'Sale 99', amount: { currency: 'USD', minor: 200 } });
  const row = {
    id: 'resolved-conflict',
    dataClass: 'authorized',
    observations: [ca, ac],
    conflictFields: ['amount'],
    resolved: {
      priceBasis: 'hammer',
      hammer: { currency: 'USD', minor: 200 },
      resolution: 'collector-selected-observation',
      observationId: 'ac',
      resolvedAt: observedAt,
    },
    inclusion: 'included',
  };
  const caOnly = computeStatistics([row], { ...filters, sources: ['coinarchives'] });
  assert.equal(caOnly.count, 0);
  assert.deepEqual(caOnly.excluded, [{ id: 'resolved-conflict', reason: 'source-filter' }]);

  const acOnly = computeStatistics([row], { ...filters, sources: ['acsearch'] });
  assert.deepEqual(acOnly.includedIds, ['resolved-conflict']);
});

test('reports invalid filters in one consistent StatisticsResult shape', () => {
  const invalidCases = [
    [{ ...filters, currency: 'BTC' }, 'filters.currency'],
    [{ ...filters, fromDate: '01/01/2020' }, 'filters.fromDate'],
    [{ ...filters, toDate: '1999-12-31' }, 'filters.dateRange'],
    [{ ...filters, sources: [] }, 'filters.sources'],
    [{ ...filters, mode: 'other' }, 'filters.mode'],
  ];
  for (const [badFilters, path] of invalidCases) {
    const result = computeStatistics([], badFilters);
    assert.equal(result.count, 0);
    assert.equal(result.median, null);
    assert.equal(result.validationError.path, path);
  }
});
