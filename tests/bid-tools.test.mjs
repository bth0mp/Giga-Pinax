import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildBidCalculation, calculatorInputsForLot, createPreferenceRevisionGate, formatIncrementLadder,
  parseIncrementLadder, presetFromFields, snapshotSupersedes,
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
  });
  assert.equal(calculatorInputsForLot(values, { loadedLotId: 'lot-a', mode: 'total', locale: 'en-US' }), null);
  const budget = calculatorInputsForLot(values, { loadedLotId: null, mode: 'budget', locale: 'en-US' });
  assert.equal(Object.hasOwn(budget, 'amount'), false);
  assert.equal(budget.premium, '20.00');
  assert.deepEqual(calculatorInputsForLot({ currency: 'GBP' }, { loadedLotId: 'lot-a', locale: 'en-US' }), {
    currency: 'GBP', amount: '', premium: '', shipping: '', paymentPercent: '', paymentFixed: '', increment: '', minimum: '',
  });
});

test('blank optional fees and increment use locale-independent defaults', () => {
  const result = buildBidCalculation({ mode: 'total', amountText: '100,00', premiumText: '20', shippingText: '', paymentPercentText: '', paymentFixedText: '', incrementText: '', minimumText: '', currency: 'EUR', locale: 'de-DE' });
  assert.equal(result.ok, true);
  assert.equal(result.value.total.minor, 12000);
  assert.equal(result.costEstimate.incrementMinor, 1);
});

test('an increment ladder is typed one tier per line and read back in the active locale', () => {
  const parsed = parseIncrementLadder('0: 5\n100: 10,00\n\n 1 000 : 25 ', 'EUR', 'de-DE');
  assert.deepEqual(parsed.value, [{ from: 0, step: 500 }, { from: 10000, step: 1000 }, { from: 100000, step: 2500 }]);
  assert.equal(parseIncrementLadder('   ', 'EUR', 'de-DE').value, null, 'an empty ladder box means no ladder');
  assert.equal(formatIncrementLadder(parsed.value, 'en-US'), '0.00: 5.00\n100.00: 10.00\n1000.00: 25.00');
  assert.equal(formatIncrementLadder(null, 'en-US'), '');
  assert.equal(parseIncrementLadder('0 5', 'EUR').ok, false);
  assert.match(parseIncrementLadder('0: 5\n100', 'EUR').error.message, /^Line 2: /);
  assert.match(parseIncrementLadder('0: 5\n100: x', 'EUR').error.message, /^Line 2: /);
  assert.match(parseIncrementLadder('100: 5', 'EUR').error.message, /^Line 1: /);
  assert.match(parseIncrementLadder('0: 5\n100: 0', 'EUR').error.message, /^Line 2: /);
  assert.equal(parseIncrementLadder(Array.from({ length: 21 }, (_, index) => `${index * 100}: 5`).join('\n'), 'EUR').ok, false);
});

test('a preset row reports which field its error belongs to', () => {
  assert.deepEqual(presetFromFields({ name: ' Nomos  AG ', premiumText: '22.5', ladderText: '0: 5' }, { currency: 'CHF' }), {
    ok: true, value: { name: 'Nomos AG', buyerPremiumBps: 2250, incrementLadder: [{ from: 0, step: 500 }] },
  });
  const noLadder = presetFromFields({ name: 'Nomos', premiumText: '22.5', ladderText: '' });
  assert.equal(Object.hasOwn(noLadder.value, 'incrementLadder'), false, 'an empty box stores no ladder at all');
  assert.equal(presetFromFields({ name: '  ', premiumText: '22.5' }).error.field, 'name');
  assert.equal(presetFromFields({ name: 'Nomos', premiumText: 'about 20' }).error.field, 'premium');
  assert.equal(presetFromFields({ name: 'Nomos', premiumText: '20', ladderText: '5: 5' }).error.field, 'ladder');
});

test('the budget calculator walks a house ladder instead of the fixed increment', () => {
  const ladder = [{ from: 0, step: 500 }, { from: 10000, step: 1000 }];
  const result = buildBidCalculation({ mode: 'budget', amountText: '150', premiumText: '20', shippingText: '5', paymentPercentText: '2.5', paymentFixedText: '0.50', incrementText: '0.01', minimumText: '', ladder, currency: 'EUR', locale: 'en-US' });
  assert.equal(result.ok, true);
  assert.equal(result.value.hammer.minor, 11000);
  // The ladder is a house schedule, not part of the lot's saved cost estimate.
  assert.equal(Object.hasOwn(result.costEstimate, 'ladder'), false);
  assert.equal(result.costEstimate.incrementMinor, 1);
});

test('the total calculator names the next valid bid when the hammer is off the ladder', () => {
  const ladder = [{ from: 0, step: 500 }, { from: 10000, step: 1000 }];
  const off = buildBidCalculation({ mode: 'total', amountText: '96', premiumText: '20', ladder, currency: 'EUR', locale: 'en-US' });
  assert.equal(off.nextValidBid.minor, 10000, 'rounding up stops at the next tier');
  const on = buildBidCalculation({ mode: 'total', amountText: '110', premiumText: '20', ladder, currency: 'EUR', locale: 'en-US' });
  assert.equal(on.nextValidBid.minor, 11000, 'a bid already on the grid is its own next valid bid');
  // Without a ladder the fixed increment and minimum are the grid.
  const fixed = buildBidCalculation({ mode: 'total', amountText: '96', premiumText: '20', incrementText: '10', minimumText: '20', currency: 'EUR', locale: 'en-US' });
  assert.equal(fixed.nextValidBid.minor, 10000);
  const belowMinimum = buildBidCalculation({ mode: 'total', amountText: '5', premiumText: '20', incrementText: '10', minimumText: '20', currency: 'EUR', locale: 'en-US' });
  assert.equal(belowMinimum.nextValidBid.minor, 2000);
});

test('preset save has a synchronous pending guard and disables its control', () => {
  const source = readFileSync(new URL('../extension/bid-tools.js', import.meta.url), 'utf8');
  assert.match(source, /if \(presetSavePending\) return;[\s\S]*presetSavePending = true;[\s\S]*save\.disabled = true;/);
  assert.match(source, /finally \{[\s\S]*presetSavePending = false;[\s\S]*save\.disabled = false;/);
});
