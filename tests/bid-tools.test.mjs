import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as money from '../extension/core/money.js';
import { FakeDocument, browserGlobals, pageSource, parseHtmlFile } from './helpers/dom.mjs';
import {
  buildBidCalculation, calculatorInputsForLot, createPreferenceRevisionGate, formatIncrementLadder,
  formatMinorInput, housePresetsText, ladderTierText, parseHousePresets, parseIncrementLadder, presetFromFields, presetsWithPremium, snapshotSupersedes,
} from '../extension/bid-tools.js';

test('calculator includes shipping and percentage plus fixed payment fees', () => {
  const result = buildBidCalculation({ mode: 'total', amountText: '100', premiumText: '20', shippingText: '10', paymentPercentText: '3', paymentFixedText: '2', incrementText: '1', minimumText: '0', currency: 'USD', locale: 'en-US' });
  assert.equal(result.ok, true);
  assert.equal(result.value.total.minor, 13590);
  assert.deepEqual(result.costEstimate, { currency: 'USD', shippingMinor: 1000, paymentFeeBps: 300, paymentFeeMinor: 200, incrementMinor: 100, minimumBidMinor: 0 });
});

// A house's VAT on its premium and a platform's fee on the hammer are part of what the lot costs, and
// part of the estimate the lot is saved with. Left blank they are not written at all, so an estimate
// keeps the shape every earlier version saved and reads.
test('the calculator adds VAT on the premium and a platform fee on the hammer, and saves them with the estimate', () => {
  const input = { mode: 'total', amountText: '1000', premiumText: '25', premiumVatText: '19', platformFeeText: '3', currency: 'CHF', locale: 'en-US' };
  const result = buildBidCalculation(input);
  assert.equal(result.value.premiumVat.minor, 4750);
  assert.equal(result.value.platformFee.minor, 3000);
  assert.equal(result.value.total.minor, 132750);
  assert.equal(result.costEstimate.premiumVatBps, 1900);
  assert.equal(result.costEstimate.platformFeeBps, 300);
  const plain = buildBidCalculation({ ...input, premiumVatText: ' ', platformFeeText: '' });
  assert.equal(plain.value.total.minor, 125000);
  assert.equal(Object.hasOwn(plain.costEstimate, 'premiumVatBps'), false);
  assert.equal(Object.hasOwn(plain.costEstimate, 'platformFeeBps'), false);
  // The budget answer is the highest hammer whose whole cost, VAT included, fits.
  assert.equal(buildBidCalculation({ ...input, mode: 'budget', amountText: '1297.50', platformFeeText: '' }).value.hammer.minor, 100000);
  const refused = buildBidCalculation({ ...input, premiumVatText: '120' });
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /^VAT on premium /);
});

test('a saved estimate fills the VAT and platform fee fields, and an older one leaves them blank', () => {
  const values = { lotId: 'lot-a', currency: 'EUR', hammerMinor: 100000, buyerPremiumBps: 2500,
    costEstimate: { shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0, premiumVatBps: 1900, platformFeeBps: 250 } };
  const inputs = calculatorInputsForLot(values, { loadedLotId: null });
  assert.equal(inputs.premiumVat, '19.00');
  assert.equal(inputs.platformFee, '2.50');
  const older = calculatorInputsForLot({ ...values, costEstimate: { shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0 } }, { loadedLotId: null });
  assert.equal(older.premiumVat, '');
  assert.equal(older.platformFee, '');
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
    paymentPercent: '2.50', paymentFixed: '0.00', increment: '10.00', minimum: '20.00', premiumVat: '', platformFee: '', importVat: '',
    preset: '', ladder: null,
  });
  assert.equal(calculatorInputsForLot(values, { loadedLotId: 'lot-a', mode: 'total', locale: 'en-US' }), null);
  const budget = calculatorInputsForLot(values, { loadedLotId: null, mode: 'budget', locale: 'en-US' });
  assert.equal(Object.hasOwn(budget, 'amount'), false);
  assert.equal(budget.premium, '20.00');
  assert.deepEqual(calculatorInputsForLot({ currency: 'GBP' }, { loadedLotId: 'lot-a', locale: 'en-US' }), {
    currency: 'GBP', amount: '', premium: '', shipping: '', paymentPercent: '', paymentFixed: '', increment: '', minimum: '', premiumVat: '', platformFee: '', importVat: '',
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

// "1,200" is twelve hundred to a collector whose browser groups thousands with a comma, and could be
// 1.20 to one whose browser writes decimals with it, so the calculator and the ladder box read it
// with the collector's own locale.
test('the calculator and the ladder box read a lone thousands group in the collector\'s locale', () => {
  const input = { mode: 'total', amountText: '1,200', premiumText: '20', currency: 'USD' };
  assert.equal(buildBidCalculation({ ...input, locale: 'en-US' }).value.hammer.minor, 120000);
  assert.equal(buildBidCalculation({ ...input, locale: 'de-DE' }).error.code, 'ambiguous-amount');
  assert.equal(buildBidCalculation({ ...input, amountText: '1.200', currency: 'EUR', locale: 'de-DE' }).value.hammer.minor, 120000);
  assert.deepEqual(parseIncrementLadder('0: 50\n1,000: 100', 'USD', 'en-US').value.tiers, [{ from: 0, step: 5000 }, { from: 100000, step: 10000 }]);
  assert.equal(parseIncrementLadder('0: 50\n1,000: 100', 'EUR', 'de-DE').ok, false);
  assert.deepEqual(parseIncrementLadder('0: 50\n1.000: 100', 'EUR', 'de-DE').value.tiers, [{ from: 0, step: 5000 }, { from: 100000, step: 10000 }]);
  assert.equal(presetFromFields({ name: 'Leu', premiumText: '20', ladderText: '0: 50\n1.000: 100', ladderCurrency: 'CHF' }, { locale: 'de-DE' }).ok, true);
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
});

// Every field the calculator fills from a saved lot is read back by the same parser, so it is
// written the one way that parser reads in every locale: ASCII digits, a point, no grouping. ar-EG
// and fa-IR write ٫ as their decimal mark, and bn-BD its own digits; neither could be read back.
const FIELD_LOCALES = ['ar-EG', 'fa-IR', 'bn-BD', 'de-DE', 'en-US'];

test('the calculator fields a lot fills are written so the parser reads them back in every locale', () => {
  const values = {
    lotId: 'lot-a', currency: 'EUR', hammerMinor: 123456, buyerPremiumBps: 2250,
    costEstimate: { shippingMinor: 1550, paymentFeeBps: 275, paymentFeeMinor: 35, incrementMinor: 1000, minimumBidMinor: 2000 },
  };
  for (const locale of FIELD_LOCALES) {
    const inputs = calculatorInputsForLot(values, { loadedLotId: null, mode: 'total', locale });
    assert.deepEqual(
      [inputs.amount, inputs.premium, inputs.shipping, inputs.paymentPercent, inputs.paymentFixed, inputs.increment, inputs.minimum],
      ['1234.56', '22.50', '15.50', '2.75', '0.35', '10.00', '20.00'],
      locale,
    );
    assert.equal(formatMinorInput(2250, locale), '22.50', locale);
    const calculated = buildBidCalculation({
      mode: 'total', amountText: inputs.amount, premiumText: inputs.premium, shippingText: inputs.shipping,
      paymentPercentText: inputs.paymentPercent, paymentFixedText: inputs.paymentFixed, incrementText: inputs.increment,
      minimumText: inputs.minimum, currency: 'EUR', locale,
    });
    assert.equal(calculated.ok, true, `${locale}: ${calculated.error?.message}`);
    assert.equal(calculated.value.hammer.minor, 123456, locale);
    assert.equal(calculated.buyerPremiumBps, 2250, locale);
    assert.deepEqual(calculated.costEstimate, { currency: 'EUR', ...values.costEstimate }, locale);
  }
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

test("a preset row carries the house's VAT on premium and platform fee, and names the field an error belongs to", () => {
  assert.deepEqual(presetFromFields({ name: 'Künker', premiumText: '25', premiumVatText: '19', platformFeeText: '', ladderText: '', ladderCurrency: 'EUR' }), {
    ok: true, value: { name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900 },
  });
  assert.deepEqual(presetFromFields({ name: 'biddr house', premiumText: '18', premiumVatText: '', platformFeeText: '3', ladderText: '', ladderCurrency: 'EUR' }).value,
    { name: 'biddr house', buyerPremiumBps: 1800, platformFeeBps: 300 });
  // A preset saved before these fields existed has neither key, and a blank row writes neither.
  assert.deepEqual(presetFromFields({ name: 'Roma', premiumText: '20' }).value, { name: 'Roma', buyerPremiumBps: 2000 });
  assert.equal(presetFromFields({ name: 'Roma', premiumText: '20', premiumVatText: 'twenty' }).error.field, 'premiumVat');
  assert.equal(presetFromFields({ name: 'Roma', premiumText: '20', platformFeeText: '101' }).error.field, 'platformFee');
});

// The calculator's fields are the house's terms as saved: a charge typed is written, a charge blanked
// is taken off the preset, and only a charge the caller says nothing about is left as it was.
test('saving from the calculator writes the VAT and platform fee it holds, and clears one left blank', () => {
  const presets = [{ name: 'Künker', buyerPremiumBps: 2000, premiumVatBps: 1900, platformFeeBps: 100 }];
  assert.deepEqual(presetsWithPremium(presets, 'Künker', 2500), [{ name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900, platformFeeBps: 100 }]);
  assert.deepEqual(presetsWithPremium(presets, 'Künker', 2500, { premiumVatBps: 2000, platformFeeBps: 100 }),
    [{ name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 2000, platformFeeBps: 100 }]);
  assert.deepEqual(presetsWithPremium(presets, 'Künker', 2500, { premiumVatBps: null, platformFeeBps: 100 }),
    [{ name: 'Künker', buyerPremiumBps: 2500, platformFeeBps: 100 }]);
  assert.deepEqual(presetsWithPremium(presets, 'Künker', 2500, { premiumVatBps: null, platformFeeBps: null }),
    [{ name: 'Künker', buyerPremiumBps: 2500 }]);
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

// The calculator mounted the way a page mounts it, in a sandbox whose extension calls are answered
// by the test: bid-tools.js with its imports handed in as globals, as the settings tests load theirs.
async function mountCalculator({ snapshot, session = null, options = {} }) {
  const document = new FakeDocument();
  const container = document.createElement('div');
  const commands = [];
  const sandbox = {
    ...money,
    getSnapshot: async () => snapshot,
    sendCommand: async (command) => { commands.push(structuredClone(command)); return { ok: true, value: command.preferences }; },
    newRequestId: () => `request-${commands.length + 1}`,
    subscribeToSnapshots: () => () => {},
    ...(session ? { browser: { storage: { session: { get: async (key) => ({ [key]: session[key] }), set: async (items) => { Object.assign(session, structuredClone(items)); }, onChanged: { addListener() {}, removeListener() {} } } } } } : {}),
    ...browserGlobals(document),
    Object, Array, String, Number, Boolean, Math, Promise, Set, Map, RegExp, Intl, Error, TypeError, JSON, Date, structuredClone,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(pageSource(new URL('../extension/bid-tools.js', import.meta.url)), context, { filename: 'bid-tools.js' });
  const mounted = context.mountBidCalculator(container, options);
  for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => { setImmediate(resolve); });
  const inputs = container.querySelectorAll('input');
  // A control by the caption of its label, as the collector finds it.
  const field = (caption) => container.querySelectorAll('label')
    .find((label) => label.querySelector('span')?.textContent === caption)?.querySelector('input, select');
  return {
    mounted,
    commands,
    container,
    field,
    output: container.querySelector('.bid-calculator-output'),
    figure: container.querySelector('.bid-calculator-figure'),
    label: container.querySelector('.bid-calculator-label'),
    note: container.querySelector('.bid-calculator-note'),
    premium: inputs[1],
    presetName: inputs.at(-1),
    save: container.querySelectorAll('button').find((button) => button.textContent === 'Save house preset'),
    status: container.querySelector('.bid-calculator-status'),
  };
}

// A preferences record without a whole-number revision cannot be saved against, and the page says
// that in words rather than as the TypeError reading it would throw.
test('saving a preset over preferences without a revision says so and sends nothing', async () => {
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { preferences: { currency: 'USD', housePremiumPresets: [] } } } });
  calculator.premium.value = '20';
  calculator.presetName.value = 'Roma';
  await calculator.save.click();
  assert.deepEqual(calculator.commands, []);
  assert.equal(calculator.status.textContent, 'House presets are not ready, so the preset was not saved. Reload the page and try again.');
  assert.equal(calculator.status.dataset.error, 'true');
  assert.equal(calculator.save.disabled, false);
});

test('saving a preset sends it against the revision the calculator read', async () => {
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { revision: 2, preferences: { revision: 5, currency: 'USD', housePremiumPresets: [] } } } });
  calculator.premium.value = '20';
  calculator.presetName.value = 'Roma';
  await calculator.save.click();
  assert.equal(calculator.commands.length, 1);
  assert.equal(calculator.commands[0].expectedRevision, 5);
  assert.deepEqual(calculator.commands[0].preferences.housePremiumPresets, [{ name: 'Roma', buyerPremiumBps: 2000 }]);
  assert.equal(calculator.status.textContent, 'Saved Roma: premium 20.00%, no VAT on premium, no platform fee.');
});

const KUNKER = { name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900 };
const settle = async () => { for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => { setImmediate(resolve); }); };

test('the calculator has VAT on premium and platform fee fields, and names both in its answer', async () => {
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { preferences: { revision: 1, currency: 'CHF', housePremiumPresets: [] } } } });
  const vat = calculator.field('VAT on premium %');
  const platform = calculator.field('Platform fee % on hammer');
  assert.ok(vat && platform, 'both fields are under Fees and bid increments');
  assert.ok(vat.closest('.bid-calculator-fees'));
  calculator.field('Currency').value = 'CHF';
  calculator.field('Hammer price').value = '1000';
  calculator.premium.value = '25';
  vat.value = '19';
  await vat.emit('input');
  assert.match(calculator.output.textContent, /premium CHF\s?250\.00 \(25%\) · VAT on premium CHF\s?47\.50/);
  assert.match(calculator.figure.textContent, /^CHF\s?1,297\.50$/);
  assert.doesNotMatch(calculator.output.textContent, /platform fee/, 'a platform fee nobody entered is not listed');
  platform.value = '3';
  await platform.emit('input');
  assert.match(calculator.output.textContent, /platform fee CHF\s?30\.00/);
  assert.doesNotMatch(calculator.note.textContent, /Tax is excluded/);
});

test('choosing a house fills its VAT and platform fee, and a house without them clears both', async () => {
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { preferences: { revision: 1, currency: 'EUR', housePremiumPresets: [
    KUNKER, { name: 'Biddr house', buyerPremiumBps: 1800, platformFeeBps: 300 }, { name: 'Old preset', buyerPremiumBps: 2000 },
  ] } } } });
  const preset = calculator.field('House preset');
  assert.deepEqual(preset.options.map((option) => option.textContent), [
    'Choose house preset', 'Künker — 25.00% + 19.00% VAT', 'Biddr house — 18.00% · 3.00% platform fee', 'Old preset — 20.00%',
  ]);
  const pick = async (name) => { preset.value = preset.options.find((option) => option.textContent.startsWith(name)).value; await preset.emit('change'); };
  await pick('Künker');
  assert.deepEqual([calculator.premium.value, calculator.field('VAT on premium %').value, calculator.field('Platform fee % on hammer').value], ['25.00', '19.00', '']);
  await pick('Biddr');
  assert.deepEqual([calculator.premium.value, calculator.field('VAT on premium %').value, calculator.field('Platform fee % on hammer').value], ['18.00', '', '3.00']);
  await pick('Old preset');
  assert.deepEqual([calculator.field('VAT on premium %').value, calculator.field('Platform fee % on hammer').value], ['', '']);
});

test('saving a house from the calculator saves the VAT and platform fee typed there', async () => {
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { revision: 2, preferences: { revision: 5, currency: 'EUR', housePremiumPresets: [] } } } });
  calculator.premium.value = '25';
  calculator.field('VAT on premium %').value = '19';
  calculator.presetName.value = 'Künker';
  await calculator.save.click();
  await settle();
  assert.deepEqual(calculator.commands[0].preferences.housePremiumPresets, [KUNKER]);
  calculator.field('VAT on premium %').value = 'nineteen';
  calculator.presetName.value = 'Künker';
  await calculator.save.click();
  assert.equal(calculator.commands.length, 1, 'a VAT that cannot be read saves nothing');
  assert.match(calculator.status.textContent, /^VAT on premium /);
});

// Which step of the house's schedule a bid stands on, said in the house's own money, so the collector
// does not have to open Settings to see that €1,033 sits on the €1,000 tier of €100 steps.
test('the ladder note names the tier a hammer stands on and its step', () => {
  const tiers = [{ from: 0, step: 500 }, { from: 10000, step: 1000 }, { from: 100000, step: 10000 }, { from: 200000, step: 25000 }];
  assert.equal(ladderTierText(tiers, 103300, 'EUR', 'en-US'), 'on the €1,000–€2,000 tier, steps of €100');
  assert.equal(ladderTierText(tiers, 100000, 'EUR', 'en-US'), 'on the €1,000–€2,000 tier, steps of €100', 'a tier starts at its own from');
  assert.equal(ladderTierText(tiers, 999, 'EUR', 'en-US'), 'on the €0–€100 tier, steps of €5');
  assert.equal(ladderTierText(tiers, 900000, 'EUR', 'en-US'), 'on the tier from €2,000, steps of €250', 'the top tier has no end');
  assert.equal(ladderTierText([{ from: 0, step: 250 }, { from: 5050, step: 550 }], 6000, 'GBP', 'en-GB'), 'on the tier from £50.50, steps of £5.50');
  assert.equal(ladderTierText(tiers, 103300, 'EUR', 'de-DE'), 'on the 1.000 €–2.000 € tier, steps of 100 €');
  assert.equal(ladderTierText(null, 100, 'EUR', 'en-US'), '');
  assert.equal(ladderTierText(tiers, -1, 'EUR', 'en-US'), '');
});

test('the calculator says which tier of the chosen house the hammer is on', async () => {
  const leu = { name: 'Leu', buyerPremiumBps: 2000, incrementLadder: { currency: 'CHF', tiers: [{ from: 0, step: 500 }, { from: 100000, step: 10000 }, { from: 200000, step: 20000 }] } };
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { preferences: { revision: 1, currency: 'CHF', housePremiumPresets: [leu] } } } });
  calculator.field('Currency').value = 'CHF';
  const preset = calculator.field('House preset');
  preset.value = 'leu';
  await preset.emit('change');
  const ladderNote = calculator.container.querySelector('.bid-calculator-ladder');
  assert.equal(ladderNote.textContent, 'Leu: 3 increment tiers you entered in Settings. Bids follow those tiers, not the fixed increment.');
  const hammer = calculator.field('Hammer price');
  hammer.value = '1033';
  await hammer.emit('input');
  assert.equal(ladderNote.textContent, 'Leu: 3 increment tiers you entered in Settings. The next valid bid, CHF\u00a01,100.00, is on the CHF\u00a01,000–CHF\u00a02,000 tier, steps of CHF\u00a0100.');
  hammer.value = '1100';
  await hammer.emit('input');
  assert.match(ladderNote.textContent, /The hammer, CHF.1,100\.00, is on the CHF.1,000–CHF.2,000 tier, steps of CHF.100\.$/);
});

// House terms travel between collectors as text: JSON a person can read, validated on the way in as
// strictly as the store validates a saved preset, and stripped of anything a preset does not hold.
test('house presets are copied as readable JSON and read back unchanged', () => {
  const presets = [
    { name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900, incrementLadder: { currency: 'EUR', tiers: [{ from: 0, step: 500 }, { from: 100000, step: 5000 }] } },
    { name: 'Heritage', buyerPremiumBps: 2000, platformFeeBps: 300 },
  ];
  const text = housePresetsText(presets);
  assert.equal(JSON.parse(text).format, 'giga-pinax-house-presets');
  assert.deepEqual(parseHousePresets(text), { ok: true, value: presets });
  // The presets list of a backup's preferences pastes as well.
  assert.deepEqual(parseHousePresets(JSON.stringify(presets)).value, presets);
  // Keys a preset does not hold are left behind.
  assert.deepEqual(parseHousePresets(JSON.stringify([{ name: 'Roma', buyerPremiumBps: 2000, note: '<img src=x>', revision: 9 }])).value, [{ name: 'Roma', buyerPremiumBps: 2000 }]);
});

test('pasted house presets are refused whole, with the house and field at fault', () => {
  const refuse = (value) => parseHousePresets(typeof value === 'string' ? value : JSON.stringify(value));
  assert.equal(refuse('not json').error.message, 'The pasted text is not house presets copied from Giga Pinax.');
  assert.equal(refuse({ format: 'something-else', presets: [] }).error.message, 'The pasted text is not house presets copied from Giga Pinax.');
  assert.equal(refuse([]).error.message, 'The pasted text holds no house presets.');
  assert.match(refuse([{ name: 'Roma', buyerPremiumBps: 20000 }]).error.message, /^House 1 \(Roma\): /);
  assert.match(refuse([{ name: 'Roma', buyerPremiumBps: 2000 }, { name: 'Leu', buyerPremiumBps: 2000, premiumVatBps: -1 }]).error.message, /^House 2 \(Leu\): /);
  assert.match(refuse([{ name: 'Roma', buyerPremiumBps: 2000, incrementLadder: { currency: 'EUR', tiers: [{ from: 5, step: 1 }] } }]).error.message, /^House 1 \(Roma\): /);
  assert.match(refuse([{ name: '', buyerPremiumBps: 2000 }]).error.message, /^House 1: /);
  assert.equal(refuse([{ name: 'Roma', buyerPremiumBps: 2000 }, { name: ' roma ', buyerPremiumBps: 2100 }]).error.message, 'The pasted text names Roma twice.');
  assert.match(refuse(Array.from({ length: 51 }, (_, index) => ({ name: `House ${index}`, buyerPremiumBps: 0 }))).error.message, /at most 50/);
  assert.equal(refuse('x'.repeat(200001)).error.message, 'The pasted text is too long to be house presets.');
});

test('blanking VAT in the calculator and saving the house takes the VAT off it, and says what was saved', async () => {
  const leu = { name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900, platformFeeBps: 150, incrementLadder: { currency: 'EUR', tiers: [{ from: 0, step: 500 }] } };
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { revision: 2, preferences: { revision: 5, currency: 'EUR', housePremiumPresets: [leu] } } } });
  const preset = calculator.field('House preset');
  preset.value = 'künker';
  await preset.emit('change');
  assert.equal(calculator.field('VAT on premium %').value, '19.00');
  calculator.field('VAT on premium %').value = '  ';
  calculator.presetName.value = 'Künker';
  await calculator.save.click();
  await settle();
  const { premiumVatBps, ...kept } = leu;
  assert.equal(premiumVatBps, 1900);
  assert.deepEqual(calculator.commands[0].preferences.housePremiumPresets, [kept]);
  assert.equal(calculator.status.textContent, 'Saved Künker: premium 25.00%, no VAT on premium, platform fee 1.50%. Its increment ladder is unchanged.');
});

// Q-04: import VAT or duty on the invoice, a field of the fee sheet, named in the answer and saved with the estimate;
// Settings' usual rate starts it for a house in another currency than the collector's default, and only then.
test('the calculator adds import VAT, names it, and starts it from Settings for a sale in another currency', async () => {
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { preferences: { revision: 1, currency: 'GBP', importVatBps: 500, housePremiumPresets: [] } } } });
  const importVat = calculator.field('Import VAT / duty %');
  assert.ok(importVat.closest('.bid-calculator-fees'));
  const currency = calculator.field('Currency');
  currency.value = 'GBP'; await currency.emit('input');
  assert.equal(importVat.value, '', 'a sale in the collector’s own currency crosses no border');
  currency.value = 'EUR'; await currency.emit('input');
  assert.equal(importVat.value, '5.00');
  calculator.field('Hammer price').value = '1000';
  calculator.premium.value = '25';
  calculator.field('Shipping').value = '15';
  await importVat.emit('input');
  assert.match(calculator.output.textContent, /import VAT €63\.25 · shipping €15\.00/);
  assert.equal(calculator.figure.textContent, '€1,328.25');
  currency.value = 'GBP'; await currency.emit('input');
  assert.equal(importVat.value, '5.00', 'a rate the collector has seen in a calculation stays until they change it');
  importVat.value = ''; await importVat.emit('input');
  currency.value = 'CHF'; await currency.emit('input');
  assert.equal(importVat.value, '5.00', 'a blank field is started again for another foreign sale');
  const result = buildBidCalculation({ mode: 'total', amountText: '1000', premiumText: '25', importVatText: '5', currency: 'EUR', locale: 'en-US' });
  assert.equal(result.costEstimate.importVatBps, 500);
  assert.equal(Object.hasOwn(buildBidCalculation({ mode: 'total', amountText: '1000', premiumText: '25', currency: 'EUR', locale: 'en-US' }).costEstimate, 'importVatBps'), false);
});

// The one fee sheet the calculator, the Bid tab and the Outcome tab share: all blank is no fee sheet (fees not
// recorded); once one fee is typed a blank one is none; the optional charges are written only when typed.
test('a fee sheet read from its fields is null when blank, and names the field an error belongs to', async () => {
  const { feeSheetEstimate, feeSheetTexts, FEE_SHEET_FIELDS } = await import('../extension/bid-tools.js');
  assert.deepEqual(FEE_SHEET_FIELDS.map(({ name }) => name), ['premiumVat', 'platformFee', 'importVat', 'shipping', 'paymentPercent', 'paymentFixed']);
  assert.deepEqual(feeSheetEstimate({ shipping: ' ' }, { currency: 'EUR' }), { ok: true, value: null });
  assert.deepEqual(feeSheetEstimate({ importVat: '5' }, { currency: 'EUR', incrementMinor: 1000 }).value,
    { currency: 'EUR', shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1000, minimumBidMinor: 0, importVatBps: 500 });
  assert.equal(feeSheetEstimate({ shipping: 'ten' }, { currency: 'EUR' }).error.field, 'shipping');
  assert.equal(feeSheetEstimate({ importVat: '120' }, { currency: 'EUR' }).error.field, 'importVat');
  assert.deepEqual(feeSheetTexts({ shippingMinor: 1500, paymentFeeBps: 0, importVatBps: 500 }),
    { premiumVat: '', platformFee: '', importVat: '5.00', shipping: '15.00', paymentPercent: '', paymentFixed: '' });
});

// G-15: the answer is a stat block like the median's - what it is, the figure, one line of what makes it up with the
// lines that are nothing left out - and no card or heading of its own inside the Calculator tab.
test('the calculator answers with a labelled figure and one line, and in budget mode the figure is the hammer', async () => {
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { preferences: { revision: 1, currency: 'USD', housePremiumPresets: [] } } } });
  assert.equal(calculator.container.querySelector('h3'), null, 'the tab is the heading');
  assert.equal(calculator.figure.hidden, true);
  calculator.field('Currency').value = 'USD';
  calculator.field('Hammer price').value = '260';
  calculator.premium.value = '20';
  await calculator.premium.emit('input');
  assert.deepEqual([calculator.label.textContent, calculator.figure.textContent, calculator.output.textContent],
    ['All-in total', '$312.00', 'Hammer $260.00 · premium $52.00 (20%) · no fees']);
  const mode = calculator.field('Calculation');
  mode.value = 'budget'; await mode.emit('change');
  calculator.field('Total budget').value = '312';
  await calculator.premium.emit('input');
  assert.deepEqual([calculator.label.textContent, calculator.figure.textContent, calculator.output.textContent],
    ['Maximum hammer', '$260.00', 'All-in $312.00 · premium $52.00 (20%) · no fees']);
  const markup = parseHtmlFile(new URL('../extension/popup.html', import.meta.url));
  assert.equal(markup.getElementById('companion-bid-calculator').className, '', 'no card inside the tab');
});

// G-24 (N15 cleanup): the calculator is keyed by a real key, not by a fingerprint passed as a lot id.
test('the calculator reloads only under another key, and a caller without one keys by lot id', () => {
  const values = { key: 'lot-a|EUR|15000|2000', lotId: 'lot-a', currency: 'EUR', hammerMinor: 15000, buyerPremiumBps: 2000 };
  assert.equal(calculatorInputsForLot(values, { loadedKey: 'lot-a|EUR|15000|2000' }), null);
  assert.ok(calculatorInputsForLot(values, { loadedKey: 'lot-a|EUR|14000|2000' }), 'the same coin with new terms loads again');
  assert.equal(calculatorInputsForLot({ lotId: 'lot-a', currency: 'EUR' }, { loadedKey: 'lot-a' }), null);
  assert.ok(calculatorInputsForLot({ currency: 'GBP' }, { loadedKey: 'lot-a' }), 'no key: always loads');
});

// G-04: the popup's session medians, read defensively: one entry per provider, each in its own shape - filed under its
// own provider, a provider this tool searches, the median in minor units, a real count and a time not in the future.
test('session medians are read per provider and only in their exact shape', async () => {
  const { readSessionMedians, sessionMedianAge } = await import('../extension/bid-tools.js');
  const now = Date.parse('2026-09-25T12:00:00.000Z');
  const at = now - 3 * 60000;
  const acsearch = { reference: ' RIC I² Nero 306 ', provider: 'acsearch', currency: 'USD', median: 24000, count: 2, at };
  const coinarchives = { reference: 'RIC I² Nero 306', provider: 'coinarchives', currency: 'GBP', median: 19000, count: 5, at };
  assert.deepEqual(readSessionMedians({ acsearch, coinarchives }, now), [
    { reference: 'RIC I² Nero 306', provider: 'acsearch', providerLabel: 'acsearch', currency: 'USD', median: { currency: 'USD', minor: 24000 }, count: 2, at },
    { reference: 'RIC I² Nero 306', provider: 'coinarchives', providerLabel: 'CoinArchives', currency: 'GBP', median: { currency: 'GBP', minor: 19000 }, count: 5, at },
  ]);
  assert.equal(readSessionMedians({ acsearch: { ...acsearch, at: new Date(at).toISOString() } }, now)[0].at, at);
  for (const bad of [{ ...acsearch, provider: 'coinarchives' }, { ...acsearch, currency: 'JPY' }, { ...acsearch, median: { currency: 'EUR', minor: 24000 } },
    { ...acsearch, median: 0 }, { ...acsearch, median: 1.5 }, { ...acsearch, count: 0 }, { ...acsearch, count: '2' }, { ...acsearch, at: 'yesterday' },
    { ...acsearch, at: now + 3600000 }, { ...acsearch, reference: '' }, { ...acsearch, reference: 7 }, null, 'x']) {
    assert.deepEqual(readSessionMedians({ acsearch: bad }, now), [], JSON.stringify(bad));
  }
  assert.deepEqual(readSessionMedians({ ebay: { ...acsearch, provider: 'ebay' } }, now), []);
  assert.deepEqual(readSessionMedians(acsearch, now), [], 'a bare entry is not the keyed record');
  assert.deepEqual(readSessionMedians(null, now), []);
  assert.equal(sessionMedianAge(now - 3 * 60000, now), 'seen 3 min ago');
  assert.equal(sessionMedianAge(now - 2 * 3600000, now), 'seen 2 h ago');
});

test('the calculator offers the session median above the fields and puts it in the hammer in its own currency', async () => {
  const session = { 'giga-pinax-session-median': { acsearch: { reference: 'RIC I² Nero 306', provider: 'acsearch', currency: 'GBP', median: 24000, count: 2, at: Date.now() } } };
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { preferences: { revision: 1, currency: 'USD', housePremiumPresets: [] } } }, session });
  const box = calculator.container.querySelector('.bid-calculator-median');
  assert.equal(box.hidden, false);
  // Fix round, Minor 6: the reference once, then one short line per provider, so two medians leave the figure in view.
  assert.equal(box.children[0].textContent, 'For RIC I² Nero 306');
  const line = box.children[1];
  assert.equal(line.children[0].textContent, 'acsearch median £240.00 · 2 sales');
  assert.equal(calculator.field('Currency').value, 'GBP', 'an empty calculator follows the lookup’s currency');
  calculator.field('Currency').value = 'USD'; await calculator.field('Currency').emit('input');
  await line.children[1].click();
  assert.equal(calculator.field('Currency').value, 'GBP');
  assert.equal(calculator.field('Hammer price').value, '240.00');
  const mode = calculator.field('Calculation'); mode.value = 'budget'; await mode.emit('change');
  assert.equal(box.hidden, true, 'a median is a hammer, not a budget');
});

// G-01 (Calculator part): the popup's calculator keeps what was typed in session storage and puts it back when the popup
// opens again within 30 minutes; the preferred currency arriving afterwards does not wipe it.
test('the popup calculator puts back what was typed, and a bare default no longer resets it', async () => {
  const { readCalculatorMemory, CALCULATOR_MEMORY_KEY } = await import('../extension/bid-tools.js');
  const session = {};
  const snapshot = { ok: true, value: { preferences: { revision: 1, currency: 'USD', housePremiumPresets: [] } } };
  const first = await mountCalculator({ snapshot, session, options: { remember: true } });
  first.field('Currency').value = 'EUR'; await first.field('Currency').emit('input');
  first.field('Hammer price').value = '1000'; await first.field('Hammer price').emit('input');
  first.premium.value = '25'; await first.premium.emit('input');
  first.field('Shipping').value = '15'; await first.field('Shipping').emit('input');
  assert.equal(session[CALCULATOR_MEMORY_KEY].texts.shipping, '15');
  const again = await mountCalculator({ snapshot, session, options: { remember: true } });
  assert.deepEqual([again.field('Currency').value, again.field('Hammer price').value, again.premium.value, again.field('Shipping').value], ['EUR', '1000', '25', '15']);
  assert.equal(again.figure.textContent, '€1,265.00');
  again.mounted.setValues({ currency: 'USD' });
  assert.equal(again.field('Currency').value, 'EUR', 'the preferred currency arriving later does not reset what was put back');
  const plain = await mountCalculator({ snapshot, session });
  assert.equal(plain.field('Hammer price').value, '', 'a calculator that does not remember puts nothing back');
  const now = Date.parse('2026-09-25T12:00:00.000Z');
  const record = { version: 1, at: now - 60000, mode: 'total', currency: 'EUR', texts: { amount: '1000' } };
  assert.equal(readCalculatorMemory(record, now).texts.amount, '1000');
  for (const bad of [{ ...record, at: now - 31 * 60000 }, { ...record, at: now + 3600000 }, { ...record, currency: 'JPY' }, { ...record, mode: 'x' },
    { ...record, texts: { amount: 7 } }, { ...record, texts: { amount: 'x'.repeat(33) } }, { ...record, texts: {} }, { ...record, version: 2 }, null]) {
    assert.equal(readCalculatorMemory(bad, now), null, JSON.stringify(bad));
  }
});

// Fix round, Important 1: the popup reads the session median before the preferred currency arrives; the currency the
// median set is the collector's context, and the bare preferred-currency default must not undo it.
test('an empty calculator keeps the median’s currency when the preferred currency arrives after it', async () => {
  const session = { 'giga-pinax-session-median': { acsearch: { reference: 'RIC I² Nero 306', provider: 'acsearch', currency: 'GBP', median: 24000, count: 2, at: Date.now() } } };
  const calculator = await mountCalculator({ snapshot: { ok: true, value: { preferences: { revision: 1, currency: 'USD', housePremiumPresets: [] } } }, session, options: { remember: true } });
  assert.equal(calculator.field('Currency').value, 'GBP', 'the session read comes first');
  calculator.mounted.setValues({ currency: 'USD' });
  assert.equal(calculator.field('Currency').value, 'GBP', 'the preference second does not override it');
});

