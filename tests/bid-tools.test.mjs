import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as money from '../extension/core/money.js';
import { FakeDocument, browserGlobals, pageSource } from './helpers/dom.mjs';
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
    paymentPercent: '2.50', paymentFixed: '0.00', increment: '10.00', minimum: '20.00', premiumVat: '', platformFee: '',
    preset: '', ladder: null,
  });
  assert.equal(calculatorInputsForLot(values, { loadedLotId: 'lot-a', mode: 'total', locale: 'en-US' }), null);
  const budget = calculatorInputsForLot(values, { loadedLotId: null, mode: 'budget', locale: 'en-US' });
  assert.equal(Object.hasOwn(budget, 'amount'), false);
  assert.equal(budget.premium, '20.00');
  assert.deepEqual(calculatorInputsForLot({ currency: 'GBP' }, { loadedLotId: 'lot-a', locale: 'en-US' }), {
    currency: 'GBP', amount: '', premium: '', shipping: '', paymentPercent: '', paymentFixed: '', increment: '', minimum: '', premiumVat: '', platformFee: '',
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

test('saving from the calculator writes the VAT and platform fee it holds, and keeps what it was not given', () => {
  const presets = [{ name: 'Künker', buyerPremiumBps: 2000, premiumVatBps: 1900, platformFeeBps: 100 }];
  assert.deepEqual(presetsWithPremium(presets, 'Künker', 2500), [{ name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 1900, platformFeeBps: 100 }]);
  assert.deepEqual(presetsWithPremium(presets, 'Künker', 2500, { premiumVatBps: 2000 }),
    [{ name: 'Künker', buyerPremiumBps: 2500, premiumVatBps: 2000, platformFeeBps: 100 }]);
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
async function mountCalculator({ snapshot }) {
  const document = new FakeDocument();
  const container = document.createElement('div');
  const commands = [];
  const sandbox = {
    ...money,
    getSnapshot: async () => snapshot,
    sendCommand: async (command) => { commands.push(structuredClone(command)); return { ok: true, value: command.preferences }; },
    newRequestId: () => `request-${commands.length + 1}`,
    subscribeToSnapshots: () => () => {},
    ...browserGlobals(document),
    Object, Array, String, Number, Boolean, Math, Promise, Set, Map, RegExp, Intl, Error, TypeError, JSON, Date, structuredClone,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(pageSource(new URL('../extension/bid-tools.js', import.meta.url)), context, { filename: 'bid-tools.js' });
  context.mountBidCalculator(container);
  for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => { setImmediate(resolve); });
  const inputs = container.querySelectorAll('input');
  // A control by the caption of its label, as the collector finds it.
  const field = (caption) => container.querySelectorAll('label')
    .find((label) => label.querySelector('span')?.textContent === caption)?.querySelector('input, select');
  return {
    commands,
    container,
    field,
    output: container.querySelector('.bid-calculator-output'),
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
  assert.equal(calculator.status.textContent, 'House preset saved.');
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
  assert.match(calculator.output.textContent, /Premium CHF\s?250\.00 \+ VAT CHF\s?47\.50/);
  assert.match(calculator.output.textContent, /Total CHF\s?1,297\.50/);
  assert.doesNotMatch(calculator.output.textContent, /Platform fee/, 'a platform fee nobody entered is not listed');
  platform.value = '3';
  await platform.emit('input');
  assert.match(calculator.output.textContent, /Platform fee CHF\s?30\.00/);
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
