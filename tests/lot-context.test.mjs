import test from 'node:test';
import assert from 'node:assert/strict';

import { findDuplicateLot, normalizeAuctionUrl } from '../extension/core/lot-context.js';

test('normalizes auction URLs without destroying identity query or path case', () => {
  assert.equal(normalizeAuctionUrl('HTTPS://Example.COM/Lot/AbC?id=9&utm_source=x#photo'), 'https://example.com/Lot/AbC?id=9');
  assert.equal(normalizeAuctionUrl('javascript:alert(1)'), null);
});

test('keeps a fragment that routes to a lot and drops a cosmetic one', () => {
  assert.equal(normalizeAuctionUrl('https://house.test/sale#/lot/101'), 'https://house.test/sale#/lot/101');
  assert.equal(normalizeAuctionUrl('https://house.test/sale#!/lot/101'), 'https://house.test/sale#!/lot/101');
  assert.equal(normalizeAuctionUrl('https://house.test/lot/7#top'), 'https://house.test/lot/7');
});

test('separates fragment-routed lots and trusts a complete identity over a shared URL', () => {
  const routed = [{ id: 'one-oh-one', auctionContext: { pageUrl: 'https://house.test/sale#/lot/101' } }];
  assert.equal(findDuplicateLot(routed, { auctionContext: { pageUrl: 'https://house.test/sale#/lot/102' } }), null);
  assert.equal(findDuplicateLot(routed, { auctionContext: { pageUrl: 'https://house.test/sale#/lot/101' } }).id, 'one-oh-one');

  const identified = [{ id: 'seven', auctionContext: { pageUrl: 'https://house.test/sale', house: 'CNG', saleId: '123', lotNumber: '7' } }];
  const eight = { auctionContext: { pageUrl: 'https://house.test/sale', house: 'CNG', saleId: '123', lotNumber: '8' } };
  assert.equal(findDuplicateLot(identified, eight), null);
  assert.equal(findDuplicateLot(identified, { auctionContext: { pageUrl: 'https://house.test/sale' } }).id, 'seven');
});

test('finds duplicate lots only from auction URL or complete house sale lot identity', () => {
  const lots = [
    { id: 'one', title: 'Same', auctionContext: { pageUrl: 'https://house.test/lot/7?utm_campaign=x' } },
    { id: 'two', title: 'Other', auctionContext: { pageUrl: 'https://other.test/a', house: ' CNG ', saleId: ' 123 ', lotNumber: ' 7 ' } },
  ];
  assert.equal(findDuplicateLot(lots, { auctionContext: { pageUrl: 'https://house.test/lot/7#top' } }).id, 'one');
  assert.equal(findDuplicateLot(lots, { auctionContext: { pageUrl: 'https://new.test/x', house: 'cng', saleId: '123', lotNumber: '7' } }).id, 'two');
  assert.equal(findDuplicateLot(lots, { title: 'Same', reference: 'one' }), null);
  assert.equal(findDuplicateLot(lots, lots[0], 'one'), null);
  assert.equal(findDuplicateLot([{ id: 'type', sourceLinks: [{ source: 'coinarchives', sourceRecordId: 'RIC-1', url: 'https://catalogue.test/types/RIC-1' }] }],
    { sourceLinks: [{ source: 'coinarchives', sourceRecordId: 'RIC-1', url: 'https://catalogue.test/types/RIC-1' }] }), null);
});
