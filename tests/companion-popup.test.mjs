import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCalculatorView,
  buildWatchlistDraftPayload,
  buildWatchlistSummary,
  canSaveWatchlist,
  extensionRuntimeAvailable,
  moveCompanionTab,
  watchlistPayloadFromCapture,
} from '../extension/companion-popup.js';

test('companion tabs support click-order keyboard movement without side effects', () => {
  assert.equal(moveCompanionTab('research', 'ArrowRight'), 'calculator');
  assert.equal(moveCompanionTab('research', 'ArrowLeft'), 'watchlist');
  assert.equal(moveCompanionTab('calculator', 'Home'), 'research');
  assert.equal(moveCompanionTab('research', 'End'), 'watchlist');
  assert.equal(moveCompanionTab('watchlist', 'Space'), 'watchlist');
});

test('standalone page detection requires a callable extension message bridge', () => {
  assert.equal(extensionRuntimeAvailable(undefined), false);
  assert.equal(extensionRuntimeAvailable({ runtime: {} }), false);
  assert.equal(extensionRuntimeAvailable({ runtime: { sendMessage() {} } }), true);
});

test('standalone research never enables durable watchlist actions', () => {
  const payload = { target: 'watchlist', title: 'Nero denarius' };
  assert.equal(canSaveWatchlist(false, payload), false);
  assert.equal(canSaveWatchlist(true, payload), true);
  assert.equal(canSaveWatchlist(true, { target: 'watchlist' }), false);
});

test('reviewed current-page fields become a minimal watchlist draft', () => {
  assert.deepEqual(watchlistPayloadFromCapture({
    pageTitle: 'Auction lot 27', pageUrl: 'https://auction.example/lot/27',
    ruler: { value: 'Nero' }, denomination: { value: 'Denarius' }, mint: { value: 'Rome' }, reference: { value: 'RIC 306' },
    observations: [{ amount: 200 }], shownPrices: { median: 180 },
  }), {
    target: 'watchlist', title: 'Nero Denarius Rome', reference: 'RIC 306', pageUrl: 'https://auction.example/lot/27',
  });
});

test('calculator uses exact CHF minor units and clears unknown premium output', () => {
  const valid = buildCalculatorView({ hammerText: '100.00', premiumPercentText: '25', currency: 'CHF', locale: 'de-CH' });
  assert.deepEqual(valid.premium, { currency: 'CHF', minor: 2500 });
  assert.deepEqual(valid.total, { currency: 'CHF', minor: 12500 });
  assert.equal(valid.error, null);

  const unknown = buildCalculatorView({ hammerText: '100.00', premiumPercentText: '', currency: 'CHF', locale: 'de-CH' });
  assert.equal(unknown.status, 'unknown-premium');
  assert.equal(unknown.total, null);
});

test('watchlist transfer whitelists reference fields and excludes acsearch results', () => {
  const payload = buildWatchlistDraftPayload({
    reference: 'RIC I² Nero 306',
    title: 'Nero denarius',
    pageUrl: 'https://numismatics.org/ocre/id/ric.1(2).ner.306',
    shownPrices: { median: 180, lots: [{ id: 'provider-row', price: 200 }] },
    prices: [100, 200],
    currentCard: { description: 'must not serialize', fetchedClaims: [{ amount: 100 }] },
  });
  assert.deepEqual(payload, {
    target: 'watchlist',
    title: 'Nero denarius',
    reference: 'RIC I² Nero 306',
    pageUrl: 'https://numismatics.org/ocre/id/ric.1(2).ner.306',
  });
  assert.equal(JSON.stringify(payload).includes('provider-row'), false);
  assert.equal(JSON.stringify(payload).includes('median'), false);
});

test('watchlist summary keeps CHF exposure separate', () => {
  const summary = buildWatchlistSummary({
    auctionEvents: [{ id: 'next', name: 'Roma sale', startsAt: '2026-09-20T10:00:00.000Z' }],
    alerts: [{ eventId: 'next', status: 'due' }],
    lots: [{ auctionEventId: 'next', outcome: { status: 'open' }, activeBid: { amount: { currency: 'CHF', minor: 10000 }, buyerPremiumBps: 2500 } }],
  }, '2026-09-12T00:00:00.000Z');
  assert.equal(summary.nextEvent.name, 'Roma sale');
  assert.equal(summary.dueAuctionCount, 1);
  assert.equal(summary.exposure.CHF.hammerMinor, 10000);
  assert.equal(summary.exposure.USD.hammerMinor, 0);
});
