import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENCIES,
  calculatePremium,
  formatMoney,
  parseMoney,
  parsePremiumPercent,
  sumMoney,
  validateMoney,
} from '../extension/core/money.js';

test('parses locale decimal money into exact integer minor units', () => {
  assert.deepEqual(parseMoney('100.25', 'USD', 'en-US'), {
    ok: true,
    value: { currency: 'USD', minor: 10025 },
  });
  assert.deepEqual(parseMoney('100,25', 'EUR', 'de-DE'), {
    ok: true,
    value: { currency: 'EUR', minor: 10025 },
  });
  assert.deepEqual(parseMoney('7', 'GBP', 'en-GB'), {
    ok: true,
    value: { currency: 'GBP', minor: 700 },
  });
  assert.deepEqual(parseMoney('100.00', 'CHF', 'de-CH'), {
    ok: true,
    value: { currency: 'CHF', minor: 10000 },
  });
  assert.deepEqual([...CURRENCIES], ['USD', 'EUR', 'GBP', 'CHF']);
});

test('rejects ambiguous or unsafe money input instead of rounding it', () => {
  for (const text of ['-1.00', '+1.00', '1e2', 'NaN', 'Infinity', '1.001', '1,000.00']) {
    assert.equal(parseMoney(text, 'USD', 'en-US').ok, false, text);
  }
  assert.equal(parseMoney('90071992547409.92', 'USD', 'en-US').error.code, 'unsafe-money');
  assert.equal(parseMoney('1'.repeat(100), 'USD', 'en-US').error.code, 'input-too-long');
  assert.equal(parseMoney('1.00', 'JPY', 'en-US').error.code, 'unsupported-currency');
});

test('validates stored money without coercing currency or minor units', () => {
  assert.deepEqual(validateMoney({ currency: 'EUR', minor: 0 }), {
    ok: true,
    value: { currency: 'EUR', minor: 0 },
  });
  assert.equal(validateMoney({ currency: 'USD', minor: -1 }).ok, false);
  assert.equal(validateMoney({ currency: 'USD', minor: 1.5 }).ok, false);
  assert.deepEqual(validateMoney({ currency: 'CHF', minor: 1 }), {
    ok: true,
    value: { currency: 'CHF', minor: 1 },
  });
  assert.equal(validateMoney({ currency: 'JPY', minor: 1 }).ok, false);
});

test('parses UI premium percentages into integer basis points', () => {
  assert.deepEqual(parsePremiumPercent('25', 'en-US'), { ok: true, value: 2500 });
  assert.deepEqual(parsePremiumPercent('25.75', 'en-US'), { ok: true, value: 2575 });
  assert.deepEqual(parsePremiumPercent('25,75', 'de-DE'), { ok: true, value: 2575 });
  assert.deepEqual(parsePremiumPercent('100.00', 'en-US'), { ok: true, value: 10000 });
});

test('rejects premium percentages that cannot be represented as bounded basis points', () => {
  for (const text of ['', '-1', '+1', '1e2', '25.001', '100.01', '1,000']) {
    assert.equal(parsePremiumPercent(text, 'en-US').ok, false, text);
  }
});

test('calculates buyer premium in integer minor units with exact half-up rounding', () => {
  const hammer = parseMoney('100.00', 'USD', 'en-US').value;
  assert.deepEqual(calculatePremium(hammer, 2500), {
    ok: true,
    value: {
      premium: { currency: 'USD', minor: 2500 },
      hammerPlusPremium: { currency: 'USD', minor: 12500 },
    },
  });
  assert.equal(
    calculatePremium({ currency: 'GBP', minor: 1 }, 5000).value.premium.minor,
    1,
  );
  assert.deepEqual(calculatePremium({ currency: 'CHF', minor: 10000 }, 2500), {
    ok: true,
    value: {
      premium: { currency: 'CHF', minor: 2500 },
      hammerPlusPremium: { currency: 'CHF', minor: 12500 },
    },
  });
});

test('rejects invalid basis points and premium arithmetic overflow', () => {
  const hammer = { currency: 'USD', minor: 10000 };
  for (const bps of [-1, 10001, 2.5, null]) {
    assert.equal(calculatePremium(hammer, bps).ok, false, String(bps));
  }
  assert.equal(
    calculatePremium({ currency: 'USD', minor: Number.MAX_SAFE_INTEGER }, 1).error.code,
    'unsafe-money',
  );
});

test('sums only one currency and guards the stored integer range', () => {
  assert.deepEqual(
    sumMoney([
      { currency: 'EUR', minor: 100 },
      { currency: 'EUR', minor: 225 },
    ], 'EUR'),
    { ok: true, value: { currency: 'EUR', minor: 325 } },
  );
  assert.deepEqual(sumMoney([], 'GBP'), {
    ok: true,
    value: { currency: 'GBP', minor: 0 },
  });
  assert.equal(sumMoney([{ currency: 'USD', minor: 1 }], 'EUR').error.code, 'currency-mismatch');
  assert.equal(sumMoney([
    { currency: 'USD', minor: Number.MAX_SAFE_INTEGER },
    { currency: 'USD', minor: 1 },
  ], 'USD').error.code, 'unsafe-money');
});

test('formats stored minor units without changing their currency', () => {
  assert.equal(formatMoney({ currency: 'USD', minor: 123456 }, 'en-US'), '$1,234.56');
  assert.equal(
    formatMoney({ currency: 'USD', minor: Number.MAX_SAFE_INTEGER }, 'en-US'),
    '$90,071,992,547,409.91',
  );
});
