import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENCIES,
  MAX_INCREMENT_TIERS,
  calculateMaximumHammer,
  calculateAffordableBid,
  calculateBidCost,
  calculatePremium,
  formatMoney,
  nextBidOnLadder,
  parseMoney,
  parsePremiumPercent,
  sumMoney,
  validateIncrementLadder,
  validateMoney,
} from '../extension/core/money.js';

// The tier a bid sits in, by the same rule the calculator uses: the last tier that starts at or
// below it. Written out here so the invariants are checked against the specification, not against
// the implementation that is under test.
function tierAt(tiers, minor) {
  return [...tiers].reverse().find((tier) => tier.from <= minor) ?? tiers[0];
}

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

test('an increment ladder is ordered, anchored at zero and bounded', () => {
  assert.equal(validateIncrementLadder([{ from: 0, step: 500 }, { from: 10000, step: 1000 }]).ok, true);
  assert.equal(validateIncrementLadder([]).error.code, 'invalid-ladder');
  assert.equal(validateIncrementLadder('0: 5').error.code, 'invalid-ladder');
  assert.equal(validateIncrementLadder([{ from: 100, step: 5 }]).error.path, 'incrementLadder[0].from');
  assert.equal(validateIncrementLadder([{ from: 0, step: 0 }]).error.path, 'incrementLadder[0].step');
  assert.equal(validateIncrementLadder([{ from: 0, step: 5 }, { from: 0, step: 10 }]).error.path, 'incrementLadder[1].from');
  assert.equal(validateIncrementLadder([{ from: 0, step: 5 }, { from: -1, step: 10 }]).error.path, 'incrementLadder[1].from');
  assert.equal(validateIncrementLadder([{ from: 0, step: 5 }, { from: 10, step: 1.5 }]).error.path, 'incrementLadder[1].step');
  const tooMany = Array.from({ length: MAX_INCREMENT_TIERS + 1 }, (_, index) => ({ from: index * 100, step: 10 }));
  assert.equal(validateIncrementLadder(tooMany).error.code, 'invalid-ladder');
  assert.equal(validateIncrementLadder(tooMany.slice(0, MAX_INCREMENT_TIERS)).ok, true);
  assert.equal(validateIncrementLadder(null, 'preset.ladder').error.path, 'preset.ladder');
});

test('the next bid on a ladder rounds up, never down, and lands on a tier boundary', () => {
  const tiers = [{ from: 0, step: 500 }, { from: 10000, step: 1000 }, { from: 50000, step: 2500 }];
  assert.equal(nextBidOnLadder(tiers, 0).value, 0);
  assert.equal(nextBidOnLadder(tiers, 1).value, 500);
  assert.equal(nextBidOnLadder(tiers, 500).value, 500, 'a bid exactly at a step is already on the grid');
  assert.equal(nextBidOnLadder(tiers, 10000).value, 10000, 'a bid exactly at a tier start is on the grid');
  assert.equal(nextBidOnLadder(tiers, 9600).value, 10000, 'the rounded bid stops at the next tier');
  assert.equal(nextBidOnLadder(tiers, 10001).value, 11000);
  assert.equal(nextBidOnLadder(tiers, 49500).value, 50000);
  assert.equal(nextBidOnLadder(tiers, 50001).value, 52500);
  // The fixed increment is the one-tier case, anchored wherever the collector's minimum sits.
  assert.equal(nextBidOnLadder([{ from: 2000, step: 1000 }], 100).value, 2000);
  assert.equal(nextBidOnLadder([{ from: 2000, step: 1000 }], 2001).value, 3000);
  assert.equal(nextBidOnLadder([{ from: 0, step: 5 }], -1).error.code, 'invalid-option');
  assert.equal(nextBidOnLadder([{ from: 0, step: 0 }], 5).error.code, 'invalid-ladder');
});

test('the affordable bid walks the ladder and may land below the budget-implied tier', () => {
  const tiers = [{ from: 0, step: 500 }, { from: 10000, step: 1000 }, { from: 50000, step: 2500 }];
  // No fees: the budget is the hammer, so the answer is the grid value at or below it.
  assert.equal(calculateAffordableBid({ currency: 'EUR', minor: 10999 }, 0, { ladder: tiers }).value.hammer.minor, 10000);
  assert.equal(calculateAffordableBid({ currency: 'EUR', minor: 9999 }, 0, { ladder: tiers }).value.hammer.minor, 9500);
  // A budget that reaches into the 2500 tier but not as far as its first step falls back to the
  // last bid of the tier below it.
  assert.equal(calculateAffordableBid({ currency: 'EUR', minor: 51000 }, 0, { ladder: tiers }).value.hammer.minor, 50000);
  assert.equal(calculateAffordableBid({ currency: 'EUR', minor: 52499 }, 0, { ladder: tiers }).value.hammer.minor, 50000);
  // A minimum the house's schedule does not allow is rounded up before it is used as the floor.
  const floored = calculateAffordableBid({ currency: 'EUR', minor: 12000 }, 0, { ladder: tiers, minimumBidMinor: 9600 });
  assert.equal(floored.value.hammer.minor, 12000);
  assert.equal(calculateAffordableBid({ currency: 'EUR', minor: 9800 }, 0, { ladder: tiers, minimumBidMinor: 9600 }).error.code, 'no-affordable-bid');
  // Fees push the affordable hammer down the ladder rather than off it.
  const withFees = calculateAffordableBid({ currency: 'EUR', minor: 15000 }, 2000, {
    shippingMinor: 500, paymentFeeBps: 250, paymentFeeMinor: 50, ladder: tiers,
  });
  assert.equal(withFees.value.hammer.minor, 11000);
  assert.ok(withFees.value.total.minor <= 15000);
  assert.equal(calculateAffordableBid({ currency: 'EUR', minor: 100 }, 0, { ladder: [{ from: 10, step: 5 }] }).error.code, 'invalid-ladder');
});

test('affordable ladder bids stay within budget, on the tier grid and maximal', () => {
  let seed = 20260918;
  const next = (bound) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % bound;
  };
  for (let index = 0; index < 400; index += 1) {
    const tiers = [{ from: 0, step: 1 + next(3000) }];
    for (let tier = 0; tier < next(6); tier += 1) {
      tiers.push({ from: tiers[tiers.length - 1].from + 1 + next(200000), step: 1 + next(20000) });
    }
    const budget = { currency: 'EUR', minor: next(2_000_000) };
    const buyerPremiumBps = next(10001);
    const options = {
      shippingMinor: next(20000), paymentFeeBps: next(3000), paymentFeeMinor: next(5000),
      minimumBidMinor: next(50000), ladder: tiers,
    };
    const trace = () => JSON.stringify({ index, budget, buyerPremiumBps, options });
    const floor = nextBidOnLadder(tiers, Math.max(options.minimumBidMinor, 1)).value;
    const result = calculateAffordableBid(budget, buyerPremiumBps, options);
    if (!result.ok) {
      assert.equal(result.error.code, 'no-affordable-bid', trace());
      assert.ok(calculateBidCost({ currency: 'EUR', minor: floor }, buyerPremiumBps, options).value.total.minor > budget.minor, trace());
      continue;
    }
    const hammer = result.value.hammer.minor;
    assert.ok(result.value.total.minor <= budget.minor, `index ${index} within budget`);
    assert.ok(hammer >= floor, `index ${index} at or above the rounded minimum`);
    const tier = tierAt(tiers, hammer);
    assert.equal((hammer - tier.from) % tier.step, 0, `index ${index} on the grid of its tier`);
    const above = calculateBidCost({ currency: 'EUR', minor: nextBidOnLadder(tiers, hammer + 1).value }, buyerPremiumBps, options);
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
      ["1'200.50", 120050], ['1’200.50', 120050], ['1 200,50', 120050], ['1 200', 120000],
      ['1 200,50', 120050], ['1 200,50', 120050], ['1,200,000', 120000000],
      ['0.05', 5], ['1200', 120000],
    ]) {
      assert.deepEqual(parseMoney(text, 'USD', locale), { ok: true, value: { currency: 'USD', minor } }, `${text} in ${locale}`);
    }
  }
});

test('refuses a lone separator before three digits and quotes the amount that was typed', () => {
  for (const text of ['1,200', '1.200', '1.001', '12,345']) {
    const parsed = parseMoney(text, 'USD', 'en-US');
    assert.equal(parsed.error.code, 'ambiguous-amount', text);
    assert.equal(parsed.error.message, `“${text}” could mean two different amounts; write it without a thousands separator, for example 1200 or 1200.00.`);
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
