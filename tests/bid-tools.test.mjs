import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildBidCalculation, calculatorInputsForLot, createPreferenceRevisionGate, formatIncrementLadder,
  formatMinorInput, parseIncrementLadder, presetFromFields, presetsWithPremium, snapshotSupersedes,
} from '../extension/bid-tools.js';

test('calculator includes shipping and percentage plus fixed payment fees', () => {
  const result = buildBidCalculation({ mode: 'total', amountText: '100', premiumText: '20', shippingText: '10', paymentPercentText: '3', paymentFixedText: '2', incrementText: '1', minimumText: '0', currency: 'USD', locale: 'en-US' });
  assert.equal(result.ok, true);
  assert.equal(result.value.total.minor, 13590);
  assert.deepEqual(result.costEstimate, { currency: 'USD', shippingMinor: 1000, paymentFeeBps: 300, paymentFeeMinor: 200, incrementMinor: 100, minimumBidMinor: 0 });
});

test('budget calculator honors the fixed minimum and increment grid', () => {
  const result = buildBidCalculation({ mode: 'budget', amountText: '135', premiumText: '20', shippingText: '10', paymentPercentText: '3', paymentFixedText: '2', incrementText: '10', minimumText: '10', currency: 'USD', locale: 'en-US' });
  assert.equal(result.ok, true);
  assert.equal(result.value.hammer.minor, 9000);
  assert.equal(result.value.total.minor, 12354);
});

test('preference revision gate rejects delayed initial and save replies after a newer subscription', () => {
  const applied = [];
  const take = createPreferenceRevisionGate((preferences) => applied.push(preferences.revision));
  assert.equal(take({ preferences: { revision: 5 } }), true);
  assert.equal(take({ preferences: { revision: 4 } }), false);
  assert.equal(take({ preferences: { revision: 5 } }), false);
  assert.equal(take({ preferences: { revision: 6 } }), true);
  assert.deepEqual(applied, [5, 6]);
});

test('preference revision gate follows a replace import that restarted the preferences revision', () => {
  const applied = [];
  const take = createPreferenceRevisionGate((preferences) => applied.push(preferences.revision));
  assert.equal(take({ revision: 9, updatedAt: '2026-09-17T10:00:00.000Z', preferences: { revision: 5 } }), true);
  assert.equal(take({ revision: 9, updatedAt: '2026-09-17T10:00:00.000Z', preferences: { revision: 4 } }), false);
  assert.equal(take({ revision: 10, updatedAt: '2026-09-17T11:00:00.000Z', preferences: { revision: 1 } }), true);
  assert.equal(take({ revision: 10, updatedAt: '2026-09-17T11:00:00.000Z', preferences: { revision: 2 } }), true);
  assert.deepEqual(applied, [5, 1, 2]);
});

test('preference revision gate refuses a snapshot older than the one it already accepted', () => {
  const applied = [];
  const take = createPreferenceRevisionGate((preferences) => applied.push(preferences.revision));
  assert.equal(take({ revision: 9, updatedAt: '2026-09-17T10:00:00.000Z', preferences: { revision: 5 } }), true);
  assert.equal(take({ revision: 10, updatedAt: '2026-09-17T11:00:00.000Z', preferences: { revision: 1 } }), true);
  // A reply that was already in flight when the replace import landed: its higher preferences
  // revision belongs to the records that were replaced.
  assert.equal(take({ revision: 9, updatedAt: '2026-09-17T10:00:00.000Z', preferences: { revision: 5 } }), false);
  assert.deepEqual(applied, [5, 1]);
});

test('a snapshot supersedes the accepted one only on a newer revision or timestamp', () => {
  assert.equal(snapshotSupersedes({ revision: 3 }, { revision: 2 }), true);
  assert.equal(snapshotSupersedes({ revision: 2 }, { revision: 3 }), false);
  assert.equal(snapshotSupersedes({ revision: 2 }, { revision: 2 }), false);
  assert.equal(snapshotSupersedes({ updatedAt: '2026-09-17T11:00:00.000Z' }, { updatedAt: '2026-09-17T10:00:00.000Z' }), true);
  assert.equal(snapshotSupersedes({ preferences: {} }, null), false);
});

test('the calculator loads a lot only when the selection changes and never overwrites a budget', () => {
  const values = {
    lotId: 'lot-a', currency: 'EUR', hammerMinor: 15000, buyerPremiumBps: 2000,
    costEstimate: { shippingMinor: 500, paymentFeeBps: 250, paymentFeeMinor: 0, incrementMinor: 1000, minimumBidMinor: 2000 },
  };
  assert.deepEqual(calculatorInputsForLot(values, { loadedLotId: null, mode: 'total', locale: 'en-US' }), {
    currency: 'EUR', amount: '150.00', premium: '20.00', shipping: '5.00',
    paymentPercent: '2.50', paymentFixed: '0.00', increment: '10.00', minimum: '20.00',
    preset: '', ladder: null,
  });
  assert.equal(calculatorInputsForLot(values, { loadedLotId: 'lot-a', mode: 'total', locale: 'en-US' }), null);
  const budget = calculatorInputsForLot(values, { loadedLotId: null, mode: 'budget', locale: 'en-US' });
  assert.equal(Object.hasOwn(budget, 'amount'), false);
  assert.equal(budget.premium, '20.00');
  assert.deepEqual(calculatorInputsForLot({ currency: 'GBP' }, { loadedLotId: 'lot-a', locale: 'en-US' }), {
    currency: 'GBP', amount: '', premium: '', shipping: '', paymentPercent: '', paymentFixed: '', increment: '', minimum: '',
    preset: '', ladder: null,
  });
});

// A ladder belongs to the house that published it, not to whatever lot is on screen. Another lot's
// premium and minimum on house A's tiers is not a grid anyone bids on.
test('another lot clears the chosen house and the tiers that came with it', () => {
  const inputs = calculatorInputsForLot(
    { lotId: 'lot-b', currency: 'EUR', costEstimate: { incrementMinor: 1000, minimumBidMinor: 0 } },
    { loadedLotId: 'lot-a', mode: 'total', locale: 'en-US' },
  );
  assert.equal(inputs.preset, '', 'the house select goes back to its blank option');
  assert.equal(inputs.ladder, null, 'the lot is calculated on its own saved increment until a house is chosen again');
});

test('blank optional fees and increment use locale-independent defaults', () => {
  const result = buildBidCalculation({ mode: 'total', amountText: '100,00', premiumText: '20', shippingText: '', paymentPercentText: '', paymentFixedText: '', incrementText: '', minimumText: '', currency: 'EUR', locale: 'de-DE' });
  assert.equal(result.ok, true);
  assert.equal(result.value.total.minor, 12000);
  assert.equal(result.costEstimate.incrementMinor, 1);
});

const EUR_LADDER = { currency: 'EUR', tiers: [{ from: 0, step: 500 }, { from: 10000, step: 1000 }] };

test('an increment ladder is typed one tier per line, in the currency the tiers are written in', () => {
  const parsed = parseIncrementLadder('0: 5\n100: 10,00\n\n 1 000 : 25 ', 'EUR');
  assert.deepEqual(parsed.value, { currency: 'EUR', tiers: [{ from: 0, step: 500 }, { from: 10000, step: 1000 }, { from: 100000, step: 2500 }] });
  assert.equal(parseIncrementLadder('   ', 'EUR').value, null, 'an empty ladder box means no ladder');
  assert.equal(parseIncrementLadder('   ', 'JPY').value, null, 'a currency nobody chose does not matter without tiers');
  assert.equal(parseIncrementLadder('0: 5', 'JPY').error.field, 'ladderCurrency');
  assert.equal(parseIncrementLadder('0 5', 'EUR').ok, false);
  assert.match(parseIncrementLadder('0: 5\n100', 'EUR').error.message, /^Line 2: /);
  assert.match(parseIncrementLadder('0: 5\n100: x', 'EUR').error.message, /^Line 2: /);
  assert.match(parseIncrementLadder('100: 5', 'EUR').error.message, /^Line 1: /);
  assert.match(parseIncrementLadder('0: 5\n100: 0', 'EUR').error.message, /^Line 2: /);
  assert.match(parseIncrementLadder('0: 5\n100: 10\n50: 1', 'EUR').error.message, /^Line 3: /);
  assert.equal(parseIncrementLadder(Array.from({ length: 21 }, (_, index) => `${index * 100}: 5`).join('\n'), 'EUR').ok, false);
});

// The box is filled from stored tiers and read back by the shared money parser, which accepts a
// point everywhere. A locale's own decimal mark does not survive that trip: ar-EG writes ٫, which
// the parser refuses, so a ladder written that way could never be saved again.
test('ladder text is written with a point and no grouping, whatever the locale is', () => {
  const tiers = [{ from: 0, step: 500 }, { from: 100000, step: 2500 }];
  const text = formatIncrementLadder(tiers);
  assert.equal(text, '0.00: 5.00\n1000.00: 25.00');
  assert.deepEqual(parseIncrementLadder(text, 'EUR').value, { currency: 'EUR', tiers });
  assert.equal(formatIncrementLadder(null), '');
  assert.equal(formatMinorInput(500, 'ar-EG').includes('.'), false, 'the localized field format is not this one');
});

test('a preset row reports which field its error belongs to', () => {
  assert.deepEqual(presetFromFields({ name: ' Nomos  AG ', premiumText: '22.5', ladderText: '0: 5', ladderCurrency: 'CHF' }), {
    ok: true, value: { name: 'Nomos AG', buyerPremiumBps: 2250, incrementLadder: { currency: 'CHF', tiers: [{ from: 0, step: 500 }] } },
  });
  const noLadder = presetFromFields({ name: 'Nomos', premiumText: '22.5', ladderText: '', ladderCurrency: 'CHF' });
  assert.equal(Object.hasOwn(noLadder.value, 'incrementLadder'), false, 'an empty box stores no ladder at all');
  assert.equal(presetFromFields({ name: '  ', premiumText: '22.5' }).error.field, 'name');
  assert.equal(presetFromFields({ name: 'Nomos', premiumText: 'about 20' }).error.field, 'premium');
  assert.equal(presetFromFields({ name: 'Nomos', premiumText: '20', ladderText: '5: 5', ladderCurrency: 'CHF' }).error.field, 'ladder');
  assert.equal(presetFromFields({ name: 'Nomos', premiumText: '20', ladderText: '0: 5', ladderCurrency: '' }).error.field, 'ladderCurrency');
});

test('saving a premium from the calculator keeps the ladder that editor never showed', () => {
  const presets = [
    { name: 'Nomos AG', buyerPremiumBps: 2000, incrementLadder: { currency: 'CHF', tiers: [{ from: 0, step: 500 }] } },
    { name: 'Other House', buyerPremiumBps: 1500 },
  ];
  assert.deepEqual(presetsWithPremium(presets, ' nomos   ag ', 2250), [
    { name: 'Other House', buyerPremiumBps: 1500 },
    { name: 'nomos ag', buyerPremiumBps: 2250, incrementLadder: { currency: 'CHF', tiers: [{ from: 0, step: 500 }] } },
  ]);
  assert.deepEqual(presetsWithPremium(undefined, 'New House', 1000), [{ name: 'New House', buyerPremiumBps: 1000 }]);
});

test('the budget calculator walks a house ladder instead of the fixed increment', () => {
  const result = buildBidCalculation({ mode: 'budget', amountText: '150', premiumText: '20', shippingText: '5', paymentPercentText: '2.5', paymentFixedText: '0.50', incrementText: '0.01', minimumText: '', ladder: EUR_LADDER, currency: 'EUR', locale: 'en-US' });
  assert.equal(result.ok, true);
  assert.equal(result.value.hammer.minor, 11000);
  assert.equal(result.ladderNotice, '');
  // The ladder is a house schedule, not part of the lot's saved cost estimate.
  assert.equal(Object.hasOwn(result.costEstimate, 'ladder'), false);
  assert.equal(result.costEstimate.incrementMinor, 1);
});

// The tiers are amounts in the house's own money. Applying them to another currency would invent a
// schedule that house never published, so the fixed increment stands in and the page says why.
test('a ladder in another currency is not applied, and the calculator says so', () => {
  const input = { mode: 'budget', amountText: '150', premiumText: '20', shippingText: '5', paymentPercentText: '2.5', paymentFixedText: '0.50', incrementText: '7', minimumText: '', ladder: EUR_LADDER, locale: 'en-US' };
  const matched = buildBidCalculation({ ...input, currency: 'EUR' });
  assert.equal(matched.value.hammer.minor, 11000, 'a bid on the house\'s tiers');
  assert.equal(matched.ladderNotice, '');
  const mismatched = buildBidCalculation({ ...input, currency: 'USD' });
  assert.equal(mismatched.ladderNotice, 'This house’s increments are in EUR; the calculator is set to USD, so the fixed increment is used.');
  assert.equal(mismatched.value.hammer.minor, 11200, 'a bid on the fixed 7.00 grid instead');
  assert.equal(buildBidCalculation({ ...input, currency: 'USD', ladder: null }).ladderNotice, '');
  // Tiers that are not a schedule are refused rather than quietly replaced by the fixed increment.
  const broken = buildBidCalculation({ ...input, currency: 'EUR', ladder: { currency: 'EUR', tiers: [{ from: 5, step: 1 }] } });
  assert.equal(broken.error.code, 'invalid-ladder');
});

test('the total calculator names the next valid bid when the hammer is off the ladder', () => {
  const off = buildBidCalculation({ mode: 'total', amountText: '96', premiumText: '20', ladder: EUR_LADDER, currency: 'EUR', locale: 'en-US' });
  assert.equal(off.nextValidBid.minor, 10000, 'rounding up stops at the next tier');
  const on = buildBidCalculation({ mode: 'total', amountText: '110', premiumText: '20', ladder: EUR_LADDER, currency: 'EUR', locale: 'en-US' });
  assert.equal(on.nextValidBid.minor, 11000, 'a bid already on the grid is its own next valid bid');
  // Without a ladder the fixed increment and minimum are the grid.
  const fixed = buildBidCalculation({ mode: 'total', amountText: '96', premiumText: '20', incrementText: '10', minimumText: '20', currency: 'EUR', locale: 'en-US' });
  assert.equal(fixed.nextValidBid.minor, 10000);
  const belowMinimum = buildBidCalculation({ mode: 'total', amountText: '5', premiumText: '20', incrementText: '10', minimumText: '20', currency: 'EUR', locale: 'en-US' });
  assert.equal(belowMinimum.nextValidBid.minor, 2000);
});

// The house's schedule says which bids exist; the lot's minimum says where bidding starts. A next
// valid bid below the minimum is not a bid the auctioneer would take either.
test('the next valid bid on a ladder is never below the minimum bid', () => {
  const ladder = { currency: 'EUR', tiers: [{ from: 0, step: 300 }, { from: 10000, step: 1000 }] };
  const below = buildBidCalculation({ mode: 'total', amountText: '5', premiumText: '20', minimumText: '20', incrementText: '10', ladder, currency: 'EUR', locale: 'en-US' });
  assert.equal(below.value.hammer.minor, 500);
  assert.equal(below.nextValidBid.minor, 2100, 'the first bid on the ladder at or above the 20.00 minimum');
  const above = buildBidCalculation({ mode: 'total', amountText: '50', premiumText: '20', minimumText: '20', incrementText: '10', ladder, currency: 'EUR', locale: 'en-US' });
  assert.equal(above.nextValidBid.minor, 5100);
});

test('preset save has a synchronous pending guard and disables its control', () => {
  const source = readFileSync(new URL('../extension/bid-tools.js', import.meta.url), 'utf8');
  assert.match(source, /if \(presetSavePending\) return;[\s\S]*presetSavePending = true;[\s\S]*save\.disabled = true;/);
  assert.match(source, /finally \{[\s\S]*presetSavePending = false;[\s\S]*save\.disabled = false;/);
});
