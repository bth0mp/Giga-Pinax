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

// Loop N19: the same lot captured from a tracking link and from its canonical page was saved twice, since only the page address was compared. A
// page is the same lot as the page another names as its canonical one. Two canonical addresses alone prove nothing: a catalogue that names its sale
// page as every lot's canonical one would make every lot of the sale one lot, and the store would refuse to save the second.
test('a lot is the same lot as the page another names canonical, and two canonical addresses alone are not', () => {
  const saved = [{ id: 'canon', auctionContext: { pageUrl: 'https://house.test/lot/7', canonicalUrl: 'https://house.test/lot/7' } }];
  assert.equal(findDuplicateLot(saved, { auctionContext: { pageUrl: 'https://mail.test/c?u=7', canonicalUrl: 'https://house.test/lot/7#photo' } }).id, 'canon');
  const tracked = [{ id: 'tracked', auctionContext: { pageUrl: 'https://mail.test/c?u=7', canonicalUrl: 'https://house.test/lot/7' } }];
  assert.equal(findDuplicateLot(tracked, { auctionContext: { pageUrl: 'https://house.test/lot/7?utm_source=x' } }).id, 'tracked');
  // Every lot of a sale naming the sale page as canonical is still its own lot.
  const sale = [{ id: 'one', auctionContext: { pageUrl: 'https://house.test/lot/1', canonicalUrl: 'https://house.test/sale/5' } }];
  assert.equal(findDuplicateLot(sale, { auctionContext: { pageUrl: 'https://house.test/lot/2', canonicalUrl: 'https://house.test/sale/5' } }), null);
  // A complete house, sale and lot identity that differs still wins over a matching address.
  const identified = [{ id: 'seven', auctionContext: { pageUrl: 'https://house.test/lot/7', house: 'CNG', saleId: '1', lotNumber: '7' } }];
  assert.equal(findDuplicateLot(identified, { auctionContext: { pageUrl: 'https://x.test', canonicalUrl: 'https://house.test/lot/7', house: 'CNG', saleId: '1', lotNumber: '8' } }), null);
  // A canonical address that is no web address is ignored.
  assert.equal(findDuplicateLot([{ id: 'bad', auctionContext: { pageUrl: 'javascript:alert(1)' } }],
    { auctionContext: { pageUrl: 'https://b.test/2', canonicalUrl: 'javascript:alert(1)' } }), null);
});
