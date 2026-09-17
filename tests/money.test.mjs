import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENCIES,
  calculateMaximumHammer,
  calculateAffordableBid,
  calculateBidCost,
  calculatePremium,
  formatMoney,
  parseMoney,
  parsePremiumPercent,
  sumMoney,
  validateMoney,
} from '../extension/core/money.js';

test('calculates full bid cost with half-up percentage fees', () => {
  assert.deepEqual(calculateBidCost({ currency: 'GBP', minor: 10000 }, 2250, {
    shippingMinor: 1000, paymentFeeBps: 300, paymentFeeMinor: 20,
  }), { ok: true, value: {
    hammer: { currency: 'GBP', minor: 10000 }, premium: { currency: 'GBP', minor: 2250 },
    hammerPlusPremium: { currency: 'GBP', minor: 12250 }, shipping: { currency: 'GBP', minor: 1000 },
    paymentFee: { currency: 'GBP', minor: 418 }, total: { currency: 'GBP', minor: 13668 },
  }});
});

test('finds the highest affordable hammer on the configured bid grid', () => {
  const result = calculateAffordableBid({ currency: 'EUR', minor: 15000 }, 2000, {
    shippingMinor: 500, paymentFeeBps: 250, paymentFeeMinor: 50,
    incrementMinor: 1000, minimumBidMinor: 2000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.hammer.minor, 11000);
  assert.ok(result.value.total.minor <= 15000);
  assert.ok(calculateBidCost({ currency: 'EUR', minor: 12000 }, 2000, {
    shippingMinor: 500, paymentFeeBps: 250, paymentFeeMinor: 50,
  }).value.total.minor > 15000);
});

test('affordable bids stay within budget, on the grid and maximal across randomized fees', () => {
  // Deterministic linear congruential generator: a failing case can be replayed from its index.
  let seed = 20260917;
  const next = (bound) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % bound;
  };
  for (let index = 0; index < 400; index += 1) {
    const budget = { currency: 'EUR', minor: next(2_000_000) };
    const buyerPremiumBps = next(10001);
    const options = {
      shippingMinor: next(20000), paymentFeeBps: next(3000), paymentFeeMinor: next(5000),
      incrementMinor: 1 + next(5000), minimumBidMinor: next(50000),
    };
    const result = calculateAffordableBid(budget, buyerPremiumBps, options);
    if (!result.ok) {
      assert.equal(result.error.code, 'no-affordable-bid', JSON.stringify({ index, budget, buyerPremiumBps, options }));
      const first = options.minimumBidMinor === 0 ? options.incrementMinor : options.minimumBidMinor;
      assert.ok(calculateBidCost({ currency: 'EUR', minor: first }, buyerPremiumBps, options).value.total.minor > budget.minor, `index ${index}`);
      continue;
    }
    const hammer = result.value.hammer.minor;
    assert.ok(result.value.total.minor <= budget.minor, `index ${index} within budget`);
    assert.ok(hammer >= Math.max(options.minimumBidMinor, 1), `index ${index} positive bid`);
    assert.equal((hammer - options.minimumBidMinor) % options.incrementMinor, 0, `index ${index} on the grid`);
    const above = calculateBidCost({ currency: 'EUR', minor: hammer + options.incrementMinor }, buyerPremiumBps, options);
    assert.ok(!above.ok || above.value.total.minor > budget.minor, `index ${index} maximal`);
  }
});

test('rejects fee overflow and reports when no positive grid bid is affordable', () => {
  assert.equal(calculateBidCost({ currency: 'USD', minor: Number.MAX_SAFE_INTEGER }, 0, {
    shippingMinor: 1,
  }).error.code, 'unsafe-money');
  assert.equal(calculateAffordableBid({ currency: 'USD', minor: 99 }, 0, {
    minimumBidMinor: 100, incrementMinor: 10,
  }).error.code, 'no-affordable-bid');
  assert.equal(calculateAffordableBid({ currency: 'USD', minor: 95 }, 0, {
    minimumBidMinor: 0, incrementMinor: 10,
  }).value.hammer.minor, 90);
  assert.equal(calculateAffordableBid({ currency: 'USD', minor: 100 }, 'unknown').error.code, 'invalid-basis-points');
  assert.equal(calculateAffordableBid({ currency: 'USD', minor: 100 }, 0, { incrementMinor: 0 }).error.code, 'invalid-option');
});
import { formatMinorInput } from '../extension/bid-tools.js';

test('formats calculator inputs with the active locale decimal boundary', () => {
  assert.equal(formatMinorInput(12345, 'en-US'), '123.45');
  assert.equal(formatMinorInput(12345, 'de-DE'), '123,45');
  assert.equal(formatMinorInput(null, 'de-DE'), '');
});

test('finds the maximal affordable hammer using the forward premium rounding', () => {
  for (const [budget, bps, expected] of [
    [{ currency: 'USD', minor: 12500 }, 2500, 10000],
    [{ currency: 'GBP', minor: 2 }, 5000, 1],
    [{ currency: 'EUR', minor: 100 }, 0, 100],
    [{ currency: 'CHF', minor: 0 }, 3300, 0],
  ]) {
    const result = calculateMaximumHammer(budget, bps);
    assert.equal(result.ok, true);
    assert.equal(result.value.hammer.minor, expected);
    assert.ok(calculatePremium(result.value.hammer, bps).value.hammerPlusPremium.minor <= budget.minor);
    if (expected < Number.MAX_SAFE_INTEGER) {
      const next = calculatePremium({ ...result.value.hammer, minor: expected + 1 }, bps);
      assert.ok(!next.ok || next.value.hammerPlusPremium.minor > budget.minor);
    }
  }
});

test('maximum hammer rejects unknown premiums and unsafe inputs without coercion', () => {
  const budget = { currency: 'USD', minor: 10000 };
  for (const bps of [null, undefined, 2.5, -1, 10001]) {
    assert.equal(calculateMaximumHammer(budget, bps).ok, false, String(bps));
  }
  assert.equal(calculateMaximumHammer({ currency: 'USD', minor: Number.MAX_SAFE_INTEGER }, 0).ok, true);
  assert.equal(calculateMaximumHammer({ currency: 'USD', minor: Number.MAX_SAFE_INTEGER + 1 }, 0).error.code, 'invalid-minor-units');
});

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

test('accepts either decimal separator and grouped amounts whatever the locale', () => {
  for (const locale of ['en-US', 'de-DE', 'de-CH']) {
    for (const [text, minor] of [
      ['12.50', 1250], ['12,50', 1250], ['1,200.50', 120050], ['1.200,50', 120050],
      ["1'200.50", 120050], ['1 200,50', 120050], ['1 200', 120000], ['1,200,000', 120000000],
      ['0.05', 5], ['1200', 120000],
    ]) {
      assert.deepEqual(parseMoney(text, 'USD', locale), { ok: true, value: { currency: 'USD', minor } }, `${text} in ${locale}`);
    }
  }
});

test('refuses a lone separator before three digits instead of guessing the amount', () => {
  for (const text of ['1,200', '1.200', '1.001', '12,345']) {
    const parsed = parseMoney(text, 'USD', 'en-US');
    assert.equal(parsed.error.code, 'ambiguous-amount', text);
    assert.equal(parsed.error.message, 'Write 1200 or 1200.00; “1,200” could mean two different amounts.');
  }
  assert.equal(parsePremiumPercent('1,200', 'en-US').error.code, 'ambiguous-amount');
});

test('rejects malformed money with an error that names the accepted forms', () => {
  const message = parseMoney('twelve fifty', 'USD', 'en-US').error.message;
  assert.equal(message, 'Money must be digits with at most two decimal places, written like 1200, 1200.50 or 1200,50.');
  assert.equal(parsePremiumPercent('twenty', 'en-US').error.message, 'Buyer premium must be digits with at most two decimal places, written like 1200, 1200.50 or 1200,50.');
});

test('rejects ambiguous or unsafe money input instead of rounding it', () => {
  for (const text of ['-1.00', '+1.00', '1e2', 'NaN', 'Infinity', '1.001', '1,200.5.0', '1.200.50', '1,20,000', '.50', '1.', '']) {
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
