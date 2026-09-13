import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCalculatorView,
  buildWatchlistDraftPayload,
  buildWatchlistSummary,
  canSaveWatchlist,
  extensionRuntimeAvailable,
  documentMode,
  shouldRevealRefine,
  captureCurrentPage,
  captureControlsState,
  runVisibleAction,
  moveCompanionTab,
  watchlistPayloadFromCapture,
} from '../extension/companion-popup.js';

test('capture controls prevent edits and stale actions while extraction is pending', () => {
  assert.deepEqual(captureControlsState(true, true), { editorVisible: false, fieldsDisabled: true, actionsDisabled: true });
  assert.deepEqual(captureControlsState(false, false), { editorVisible: true, fieldsDisabled: false, actionsDisabled: true });
  assert.deepEqual(captureControlsState(false, true), { editorVisible: true, fieldsDisabled: false, actionsDisabled: false });
});

test('navigation failures and thrown errors become visible action results', async () => {
  assert.deepEqual(await runVisibleAction(async () => ({ ok: false, message: 'Blocked' }), 'Fallback'), { ok: false, message: 'Blocked' });
  assert.deepEqual(await runVisibleAction(async () => { throw new Error('Closed'); }, 'Fallback'), { ok: false, message: 'Closed' });
  assert.deepEqual(await runVisibleAction(async () => undefined, 'Fallback'), { ok: true });
});

test('native panels ignore pop-out routing while the window fallback accepts it', () => {
  assert.deepEqual(documentMode('?panel=1'), { panel: true, windowed: false, acceptsLookupMessages: false });
  assert.deepEqual(documentMode('?panel=1&window=1'), { panel: true, windowed: true, acceptsLookupMessages: true });
  assert.deepEqual(documentMode('?window=1'), { panel: false, windowed: true, acceptsLookupMessages: true });
  assert.deepEqual(documentMode(''), { panel: false, windowed: false, acceptsLookupMessages: false });
});

test('ambiguity and guided-field errors reveal refinement', () => {
  assert.equal(shouldRevealRefine({ status: 'candidates' }), true);
  assert.equal(shouldRevealRefine({ status: 'too-many' }), true);
  assert.equal(shouldRevealRefine({ status: 'none' }, 'reference-number'), true);
  assert.equal(shouldRevealRefine({ status: 'network' }), false);
});

test('current-page capture stays pinned to the tab selected at action start', async () => {
  let target;
  const api = {
    tabs: { query: async () => [{ id: 27, title: 'Lot 27', url: 'https://auction.example/27' }] },
    scripting: { executeScript: async (request) => {
      target = request.target;
      return [{ result: { pageTitle: 'Extracted lot', pageUrl: 'https://auction.example/27', candidates: {} } }];
    } },
  };
  const capture = await captureCurrentPage(api, async (receiver, method, ...args) => receiver[method](...args));
  assert.deepEqual(target, { tabId: 27 });
  assert.equal(capture.pageUrl, 'https://auction.example/27');
});

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

test('date-only next auctions use each event local calendar day and sort with timed events', () => {
  const newYork = { id: 'ny', name: 'New York day', precision: 'date-only', localDate: '2026-09-12', timeZone: 'America/New_York' };
  const tokyoPast = { id: 'tokyo', name: 'Tokyo yesterday', precision: 'date-only', localDate: '2026-09-12', timeZone: 'Asia/Tokyo' };
  const timed = { id: 'timed', name: 'Timed sale', precision: 'timed', startsAt: '2026-09-13T01:00:00.000Z' };
  const summary = buildWatchlistSummary({ auctionEvents: [timed, tokyoPast, newYork], alerts: [], lots: [] }, '2026-09-13T00:30:00.000Z');
  assert.equal(summary.nextEvent.id, 'ny');
  const afterNewYorkMidnight = buildWatchlistSummary({ auctionEvents: [newYork], alerts: [], lots: [] }, '2026-09-13T04:00:00.001Z');
  assert.equal(afterNewYorkMidnight.nextEvent, null);
});
