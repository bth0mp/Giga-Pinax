import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBidCalculation, calculatorInputsForLot, createPreferenceRevisionGate, snapshotSupersedes } from '../extension/bid-tools.js';

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

test('preset save has a synchronous pending guard and disables its control', () => {
  const source = readFileSync(new URL('../extension/bid-tools.js', import.meta.url), 'utf8');
  assert.match(source, /if \(presetSavePending\) return;[\s\S]*presetSavePending = true;[\s\S]*save\.disabled = true;/);
  assert.match(source, /finally \{[\s\S]*presetSavePending = false;[\s\S]*save\.disabled = false;/);
});
