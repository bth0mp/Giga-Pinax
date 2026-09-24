import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENCIES,
  MAX_INCREMENT_TIERS,
  calculateAffordableBid,
  calculateBidCost,
  calculatePremium,
  formatMoney,
  nextBidOnLadder,
  parseMoney,
  parsePremiumPercent,
  validateIncrementLadder,
  validateLadderTiers,
  validateMoney,
} from '../extension/core/money.js';

// The ladder's grid, walked the way a collector reads it off the house's published terms: start at
// each tier's own `from` and add that tier's step until the next tier begins. Nothing here asks the
// code under test where the grid is, so a walk that disagrees with it is a real disagreement.
function* ladderGrid(tiers, ceiling) {
  for (const [index, tier] of tiers.entries()) {
    const end = index + 1 < tiers.length ? tiers[index + 1].from : Infinity;
    for (let point = tier.from; point < end && point <= ceiling; point += tier.step) yield point;
  }
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

test('a ladder\'s tiers are ordered, anchored at zero and bounded, and name the tier at fault', () => {
  assert.equal(validateLadderTiers([{ from: 0, step: 500 }, { from: 10000, step: 1000 }]).ok, true);
  assert.equal(validateLadderTiers([]).error.code, 'invalid-ladder');
  assert.equal(validateLadderTiers('0: 5').error.code, 'invalid-ladder');
  assert.equal(validateLadderTiers([{ from: 100, step: 5 }]).error.path, 'tiers[0].from');
  assert.equal(validateLadderTiers([{ from: 0, step: 0 }]).error.path, 'tiers[0].step');
  assert.equal(validateLadderTiers([{ from: 0, step: 5 }, { from: 0, step: 10 }]).error.path, 'tiers[1].from');
  assert.equal(validateLadderTiers([{ from: 0, step: 5 }, { from: -1, step: 10 }]).error.path, 'tiers[1].from');
  assert.equal(validateLadderTiers([{ from: 0, step: 5 }, { from: 10, step: 1.5 }]).error.path, 'tiers[1].step');
  // The tier at fault is reported, so a caller that read the tiers off a numbered list does not
  // have to pick the number back out of the error path.
  assert.equal(validateLadderTiers([{ from: 100, step: 5 }]).error.tier, 0);
  assert.equal(validateLadderTiers([{ from: 0, step: 5 }, { from: 10, step: 1.5 }]).error.tier, 1);
  assert.equal(validateLadderTiers([{ from: 0, step: 5 }, 'x', { from: 20, step: 5 }]).error.tier, 1);
  const tooMany = Array.from({ length: MAX_INCREMENT_TIERS + 1 }, (_, index) => ({ from: index * 100, step: 10 }));
  assert.equal(validateLadderTiers(tooMany).error.code, 'invalid-ladder');
  assert.equal(validateLadderTiers(tooMany.slice(0, MAX_INCREMENT_TIERS)).ok, true);
  assert.equal(validateLadderTiers(null, 'preset.tiers').error.path, 'preset.tiers');
});

// A house's schedule is written in that house's own money, so the currency travels with the tiers
// rather than being read off whatever the calculator happens to be set to.
test('a stored increment ladder carries the currency its tiers are written in', () => {
  const tiers = [{ from: 0, step: 500 }, { from: 10000, step: 1000 }];
  assert.deepEqual(validateIncrementLadder({ currency: 'EUR', tiers }), { ok: true, value: { currency: 'EUR', tiers } });
  assert.equal(validateIncrementLadder({ tiers }).error.path, 'incrementLadder.currency');
  assert.equal(validateIncrementLadder({ currency: 'JPY', tiers }).error.path, 'incrementLadder.currency');
  assert.equal(validateIncrementLadder({ currency: 'eur', tiers }).error.code, 'unsupported-currency');
  assert.equal(validateIncrementLadder({ currency: 'EUR', tiers: [{ from: 100, step: 5 }] }, 'preset.ladder').error.path, 'preset.ladder.tiers[0].from');
  assert.equal(validateIncrementLadder(tiers).error.path, 'incrementLadder');
  assert.equal(validateIncrementLadder(null).error.code, 'invalid-ladder');
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

// A house whose step does not divide the tier it opens: stepping on from 90 would reach 120, past a
// tier that starts at 100. Every tier above reads 0, 30, 60, 90, 100, 150, 200 — and 120 is not a
// bid this house would take.
test('a step that does not divide its tier stops at the tier above, not past it', () => {
  const tiers = [{ from: 0, step: 30 }, { from: 100, step: 50 }];
  assert.equal(nextBidOnLadder(tiers, 90).value, 90);
  assert.equal(nextBidOnLadder(tiers, 91).value, 100);
  assert.equal(nextBidOnLadder(tiers, 100).value, 100);
  assert.equal(nextBidOnLadder(tiers, 101).value, 150);
  assert.equal(nextBidOnLadder(tiers, 110).value, 150);
  const bid = (minor, minimumBidMinor = 0) =>
    calculateAffordableBid({ currency: 'EUR', minor }, 0, { ladder: tiers, minimumBidMinor });
  assert.equal(bid(149).value.hammer.minor, 100);
  assert.equal(bid(150).value.hammer.minor, 150);
  assert.equal(bid(110, 91).value.hammer.minor, 100, 'the floor rounds up to the tier above, not past it');
  assert.equal(bid(149, 101).error.code, 'no-affordable-bid');
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

test('affordable ladder bids stay within budget, on the walked grid and maximal', () => {
  // Deterministic, and read from the high bits: the multiply stays exact inside `Math.imul`, and
  // the low bits of a congruential sequence are far too regular to choose between four case shapes.
  let seed = 20260918;
  const next = (bound) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 4294967296) * bound);
  };
  let steppedOverATier = 0;
  let exactlyOnBudget = 0;
  let floorRoundedUp = 0;
  for (let index = 0; index < 300; index += 1) {
    const tiers = [];
    for (let tier = 0, count = 1 + next(5), from = 0; tier < count; tier += 1) {
      const width = 20 + next(900);
      // A step that divides the tier it opens never reaches past that tier's end, so a ladder built
      // only from those would never exercise the boundary at all.
      let step = 3 + next(width - 3);
      while (width % step === 0) step += 1;
      tiers.push({ from, step });
      from += width;
      if (tier + 1 < count) steppedOverATier += 1;
    }
    const top = tiers[tiers.length - 1].from;
    const ceiling = top + 120000;
    const grid = [...ladderGrid(tiers, ceiling)];
    const gridPoint = () => grid[next(grid.length)];
    const shape = next(4);
    const options = { minimumBidMinor: 0, ladder: tiers };
    let buyerPremiumBps = next(10001);
    let budget;
    if (shape === 0) {
      Object.assign(options, { shippingMinor: next(20000), paymentFeeBps: next(3000), paymentFeeMinor: next(5000), minimumBidMinor: next(top + 5000) });
      budget = next(top + 120000);
    } else if (shape === 1) {
      // A minimum just off the grid, with a budget that covers it but not the bid above it: the
      // answer must be no bid at all rather than the grid point below the minimum.
      Object.assign(options, { shippingMinor: next(2000), paymentFeeBps: next(1000), paymentFeeMinor: next(500), minimumBidMinor: gridPoint() + 1 });
      budget = calculateBidCost({ currency: 'EUR', minor: options.minimumBidMinor }, buyerPremiumBps, options).value.total.minor + next(4);
    } else if (shape === 2) {
      // No fees and no premium, so a budget that is itself a grid point is exactly affordable.
      buyerPremiumBps = 0;
      budget = gridPoint();
      exactlyOnBudget += 1;
    } else {
      // A minimum in the last stretch of a tier, where stepping on would carry past the tier above.
      const tier = tiers[next(tiers.length)];
      Object.assign(options, { paymentFeeMinor: next(300), minimumBidMinor: Math.max(0, tier.from - 1 - next(tier.step)) });
      budget = options.minimumBidMinor + next(tier.step * 3 + 100);
    }
    const trace = () => JSON.stringify({ index, shape, budget, buyerPremiumBps, options });
    const result = calculateAffordableBid({ currency: 'EUR', minor: budget }, buyerPremiumBps, options);
    // One walk of the house's own schedule answers all three questions: where the lowest allowed bid
    // is, whether the answer is a point on that walk, and which point comes next above it.
    let floor = null;
    let onGrid = false;
    let above = null;
    const hammer = result.ok ? result.value.hammer.minor : null;
    for (const point of ladderGrid(tiers, ceiling + 120000)) {
      if (floor === null && point >= Math.max(options.minimumBidMinor, 1)) floor = point;
      if (!result.ok) { if (floor !== null) break; continue; }
      if (point === hammer) onGrid = true;
      if (point > hammer) { above = point; break; }
    }
    if (floor > options.minimumBidMinor) floorRoundedUp += 1;
    if (!result.ok) {
      assert.equal(result.error.code, 'no-affordable-bid', trace());
      assert.ok(calculateBidCost({ currency: 'EUR', minor: floor }, buyerPremiumBps, options).value.total.minor > budget, `index ${index}: ${floor} was affordable after all`);
      continue;
    }
    assert.ok(result.value.total.minor <= budget, `index ${index} within budget`);
    assert.ok(onGrid, `index ${index}: ${hammer} is not a bid on this house's schedule`);
    assert.ok(hammer >= floor, `index ${index}: ${hammer} is below the lowest allowed bid ${floor}`);
    const cost = calculateBidCost({ currency: 'EUR', minor: above }, buyerPremiumBps, options);
    assert.ok(!cost.ok || cost.value.total.minor > budget, `index ${index}: ${above} was affordable too`);
  }
  // The generator is only worth this much if it really produced the shapes the invariants turn on.
  assert.ok(steppedOverATier > 0 && exactlyOnBudget > 0 && floorRoundedUp > 0);
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

test('formats calculator inputs with a point whatever the locale, so the parser reads them back', () => {
  assert.equal(formatMinorInput(12345, 'en-US'), '123.45');
  assert.equal(formatMinorInput(12345, 'de-DE'), '123.45');
  assert.equal(formatMinorInput(12345, 'ar-EG'), '123.45');
  assert.equal(formatMinorInput(null, 'de-DE'), '');
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

test('a lone separator before three digits is a thousands group where the browser locale groups with it', () => {
  // Where "," groups thousands and "." is the decimal mark, "1,200" is how the collector writes twelve hundred.
  for (const locale of ['en-US', 'en-GB', 'en-IN']) {
    for (const [text, minor] of [['1,200', 120000], ['12,345', 1234500], ['999,000', 99900000]]) {
      assert.deepEqual(parseMoney(text, 'USD', locale), { ok: true, value: { currency: 'USD', minor } }, `${text} in ${locale}`);
    }
  }
  // And where "." groups and "," is the decimal mark, "1.200" is.
  for (const locale of ['de-DE', 'es-ES', 'it-IT', 'nl-NL']) {
    assert.deepEqual(parseMoney('1.200', 'EUR', locale), { ok: true, value: { currency: 'EUR', minor: 120000 } }, locale);
  }
});

test('refuses a lone separator before three digits where the locale does not group with it, and quotes the amount', () => {
  const message = (text) => `“${text}” could mean two different amounts; write it without a thousands separator, for example 1200 or 1200.00.`;
  for (const [locale, texts] of [
    ['en-US', ['1.200', '1.001', '0,200']],
    // "," is the decimal mark here, so "1,200" could be one point two.
    ['de-DE', ['1,200', '12,345']],
    ['fr-FR', ['1,200', '1.200']],
    ['de-CH', ['1,200', '1.200']],
    // A tag the browser cannot read gives no grouping to trust.
    ['not a locale!', ['1,200', '1.200']],
  ]) {
    for (const text of texts) {
      const parsed = parseMoney(text, 'USD', locale);
      assert.equal(parsed.error?.code, 'ambiguous-amount', `${text} in ${locale}`);
      assert.equal(parsed.error.message, message(text));
    }
  }
  assert.equal(parsePremiumPercent('1,200', 'de-DE').error.code, 'ambiguous-amount');
  // Twelve hundred percent is read as the amount it is, and refused as a premium.
  assert.equal(parsePremiumPercent('1,200', 'en-US').error.code, 'invalid-basis-points');
  // Two decimals are a decimal in every locale.
  assert.deepEqual(parseMoney('1,20', 'USD', 'en-US'), { ok: true, value: { currency: 'USD', minor: 120 } });
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

test('formats stored minor units without changing their currency', () => {
  assert.equal(formatMoney({ currency: 'USD', minor: 123456 }, 'en-US'), '$1,234.56');
  assert.equal(
    formatMoney({ currency: 'USD', minor: Number.MAX_SAFE_INTEGER }, 'en-US'),
    '$90,071,992,547,409.91',
  );
});
