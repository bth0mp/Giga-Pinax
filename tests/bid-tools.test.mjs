import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBidCalculation, createPreferenceRevisionGate } from '../extension/bid-tools.js';

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
