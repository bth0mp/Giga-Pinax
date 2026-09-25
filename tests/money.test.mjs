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
    premiumVat: { currency: 'GBP', minor: 0 }, platformFee: { currency: 'GBP', minor: 0 },
    hammerPlusPremium: { currency: 'GBP', minor: 12250 }, shipping: { currency: 'GBP', minor: 1000 },
    importVat: { currency: 'GBP', minor: 0 }, paymentFee: { currency: 'GBP', minor: 418 }, total: { currency: 'GBP', minor: 13668 },
  }});
});

// Künker: 25 % premium and 19 % German VAT on that premium, which is 29.75 % on the hammer, not 25 %.
// A live platform adds its own fee on the hammer alone. The percentage payment fee then applies to
// everything the invoice carries, these two included.
test('VAT on the premium and a platform fee on the hammer join the cost before the payment fee', () => {
  const hammer = { currency: 'CHF', minor: 100000 };
  assert.equal(calculateBidCost(hammer, 2500, { premiumVatBps: 1900 }).value.total.minor, 129750,
    'CHF 1,000 at 25 % + 19 % VAT on the premium costs CHF 1,297.50');
  assert.deepEqual(calculateBidCost(hammer, 2500, {
    premiumVatBps: 1900, platformFeeBps: 300, shippingMinor: 2000, paymentFeeBps: 200,
  }), { ok: true, value: {
    hammer, premium: { currency: 'CHF', minor: 25000 }, premiumVat: { currency: 'CHF', minor: 4750 },
    platformFee: { currency: 'CHF', minor: 3000 }, hammerPlusPremium: { currency: 'CHF', minor: 125000 },
    shipping: { currency: 'CHF', minor: 2000 }, importVat: { currency: 'CHF', minor: 0 }, paymentFee: { currency: 'CHF', minor: 2695 },
    total: { currency: 'CHF', minor: 137445 },
  }});
  // The VAT is worked out on the premium as invoiced, half up: 20 % of £0.05 is £0.01.
  assert.equal(calculateBidCost({ currency: 'GBP', minor: 25 }, 2000, { premiumVatBps: 2000 }).value.premiumVat.minor, 1);
  for (const key of ['premiumVatBps', 'platformFeeBps', 'importVatBps']) {
    for (const bad of [-1, 10001, 1.5, '19', null]) {
      assert.equal(calculateBidCost(hammer, 2500, { [key]: bad }).error?.code, 'invalid-option', `${key} ${bad}`);
      assert.equal(calculateAffordableBid(hammer, 2500, { [key]: bad }).error?.code, 'invalid-option', `${key} ${bad}`);
    }
  }
});

// Q-04: a coin crossing a border pays import VAT or duty on hammer + premium + shipping (the CIF value), to the carrier
// or customs rather than on the house's invoice, so the house's payment fee is not charged on it.
test('import VAT is charged on hammer, premium and shipping, and joins the total after the payment fee', () => {
  const hammer = { currency: 'EUR', minor: 100000 };
  const cost = calculateBidCost(hammer, 2500, { shippingMinor: 1500, paymentFeeBps: 300, importVatBps: 500 }).value;
  // 1,000 + 250 + 15 = 1,265.00; 5 % is 63.25. The payment fee is 3 % of 1,265.00 = 37.95.
  assert.equal(cost.importVat.minor, 6325);
  assert.equal(cost.paymentFee.minor, 3795);
  assert.equal(cost.total.minor, 126500 + 3795 + 6325);
  // VAT on the premium and a platform fee are the house's, not part of the value customs charges on.
  assert.equal(calculateBidCost(hammer, 2500, { premiumVatBps: 1900, platformFeeBps: 300, importVatBps: 500 }).value.importVat.minor, 6250);
  // A budget answer counts it, so it is never too high for a foreign sale.
  const budget = calculateAffordableBid({ currency: 'EUR', minor: 136620 }, 2500, { shippingMinor: 1500, paymentFeeBps: 300, importVatBps: 500, incrementMinor: 1000 });
  assert.equal(budget.value.hammer.minor, 100000);
  assert.equal(calculateAffordableBid({ currency: 'EUR', minor: 136619 }, 2500, { shippingMinor: 1500, paymentFeeBps: 300, importVatBps: 500, incrementMinor: 1000 }).value.hammer.minor, 99000);
});

// The one direction a budget answer must never err in is too high.
test('the affordable hammer counts VAT on the premium and the platform fee, so it is never too high', () => {
  const budget = { currency: 'CHF', minor: 129750 };
  assert.equal(calculateAffordableBid(budget, 2500, { premiumVatBps: 1900 }).value.hammer.minor, 100000);
  assert.equal(calculateAffordableBid(budget, 2500).value.hammer.minor, 103800, 'without the VAT the answer was CHF 38 too high');
  let seed = 20260924;
  const next = (bound) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % bound;
  };
  for (let index = 0; index < 300; index += 1) {
    const money = { currency: 'EUR', minor: next(2_000_000) };
    const buyerPremiumBps = next(3001);
    const options = {
      premiumVatBps: next(2600), platformFeeBps: next(500), shippingMinor: next(5000), paymentFeeBps: next(400),
      incrementMinor: 1 + next(2000), minimumBidMinor: next(20000),
    };
    const result = calculateAffordableBid(money, buyerPremiumBps, options);
    if (!result.ok) {
      assert.equal(result.error.code, 'no-affordable-bid', `index ${index}`);
      continue;
    }
    assert.ok(result.value.total.minor <= money.minor, `index ${index} within budget`);
    const above = calculateBidCost({ currency: 'EUR', minor: result.value.hammer.minor + options.incrementMinor }, buyerPremiumBps, options);
    assert.ok(above.value.total.minor > money.minor, `index ${index} maximal`);
  }
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
  assert.equal(validateIncrementLadder({ currency: 'XAU', tiers }).error.path, 'incrementLadder.currency');
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
  // The four every earlier version knew come first, in their old order.
  assert.deepEqual(CURRENCIES.slice(0, 4), ['USD', 'EUR', 'GBP', 'CHF']);
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
    // A malformed tag, which Intl rejects, gives no grouping to trust.
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
  assert.equal(parsePremiumPercent('twenty', 'en-US').error.message, 'Buyer’s premium must be digits with at most two decimal places, written like 1200, 1200.50 or 1200,50.');
});

test('rejects ambiguous or unsafe money input instead of rounding it', () => {
  for (const text of ['-1.00', '+1.00', '1e2', 'NaN', 'Infinity', '1.001', '1,200.5.0', '1.200.50', '1,20,000', '.50', '1.', '']) {
    assert.equal(parseMoney(text, 'USD', 'en-US').ok, false, text);
  }
  assert.equal(parseMoney('90071992547409.92', 'USD', 'en-US').error.code, 'unsafe-money');
  assert.equal(parseMoney('1'.repeat(100), 'USD', 'en-US').error.code, 'input-too-long');
  assert.equal(parseMoney('1.00', 'XAU', 'en-US').error.code, 'unsupported-currency');
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
  assert.equal(validateMoney({ currency: 'XAU', minor: 1 }).ok, false);
  assert.equal(validateMoney({ currency: 'jpy', minor: 1 }).ok, false);
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

// --- More currencies (G-23 / Q-15) ------------------------------------------------------------------------------

import { UNSUPPORTED_CURRENCY_MESSAGE, formatAmount, minorDigits, plainAmount, plainDecimal } from '../extension/core/money.js';

const NEW_CURRENCIES = ['AUD', 'CAD', 'CZK', 'DKK', 'HKD', 'HUF', 'JPY', 'NOK', 'PLN', 'SEK'];
const OLD_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF'];
const LOCALES = ['en-US', 'en-GB', 'de-DE', 'de-CH', 'fr-FR', 'sv-SE', 'ja-JP', 'hu-HU', 'pl-PL', 'en-IN', 'ar-EG'];

test('the currencies collectors bid in, each with its ISO 4217 minor units', () => {
  assert.deepEqual([...CURRENCIES], [...OLD_CURRENCIES, ...NEW_CURRENCIES]);
  for (const code of CURRENCIES) assert.equal(minorDigits(code), code === 'JPY' ? 0 : 2, code);
  assert.equal(minorDigits('XAU'), null);
  assert.equal(minorDigits('jpy'), null);
  assert.equal(minorDigits(undefined), null);
  assert.equal(UNSUPPORTED_CURRENCY_MESSAGE, 'Currency must be one of USD, EUR, GBP, CHF, AUD, CAD, CZK, DKK, HKD, HUF, JPY, NOK, PLN or SEK.');
  assert.equal(parseMoney('1', 'XAU').error.message, UNSUPPORTED_CURRENCY_MESSAGE);
});

// The table is fixed so a stored count never changes meaning with the browser. It is pinned to ISO 4217 here, not to
// Intl, whose figure follows the runtime's CLDR data and differs between browsers and Node versions (HUF: 2 or 0).
test('the minor-units table is ISO 4217 for every currency', () => {
  const ISO_4217 = { USD: 2, EUR: 2, GBP: 2, CHF: 2, AUD: 2, CAD: 2, CZK: 2, DKK: 2, HKD: 2, HUF: 2, JPY: 0, NOK: 2, PLN: 2, SEK: 2 };
  assert.deepEqual([...CURRENCIES].sort(), Object.keys(ISO_4217).sort());
  for (const code of CURRENCIES) assert.equal(minorDigits(code), ISO_4217[code], code);
});

test('an amount is shown with the table places whatever the runtime CLDR says', () => {
  assert.match(formatMoney({ currency: 'HUF', minor: 150000 }, 'en-US'), /1,500\.00/);
  assert.match(formatMoney({ currency: 'JPY', minor: 1200000 }, 'en-US'), /1,200,000(?!\.)/);
});

test('a JPY 1,200,000 hammer is 1,200,000 yen from typed text to minor units, display and plain text', () => {
  for (const locale of LOCALES) {
    for (const text of ['1200000', '1,200,000', '1.200.000', '1 200 000', "1'200'000", '1200000.00', '1,200,000.00']) {
      assert.deepEqual(parseMoney(text, 'JPY', locale), { ok: true, value: { currency: 'JPY', minor: 1200000 } }, `${text} in ${locale}`);
    }
  }
  const hammer = { currency: 'JPY', minor: 1200000 };
  assert.equal(formatMoney(hammer, 'en-US'), '¥1,200,000');
  assert.equal(formatMoney(hammer, 'ja-JP'), '￥1,200,000');
  assert.equal(formatMoney(hammer, 'de-DE'), '1.200.000 ¥');
  assert.equal(formatAmount(hammer, 'en-US'), '1,200,000');
  assert.equal(plainAmount(hammer), '1200000');
  // A premium on whole yen is rounded half up to whole yen, as the invoice is.
  const cost = calculateBidCost(hammer, 1750, { shippingMinor: 3000, premiumVatBps: 1000 });
  assert.equal(cost.value.premium.minor, 210000);
  assert.equal(cost.value.premiumVat.minor, 21000);
  assert.equal(cost.value.total.minor, 1434000);
  assert.equal(formatMoney(cost.value.total, 'en-US'), '¥1,434,000');
  assert.equal(calculatePremium({ currency: 'JPY', minor: 1 }, 5000).value.premium.minor, 1);
  assert.equal(calculatePremium({ currency: 'JPY', minor: 1 }, 4999).value.premium.minor, 0);
});

test('a yen amount with a place it cannot have is refused, never rounded', () => {
  for (const text of ['1200.5', '1200,50', '1,200,000.01', '0.01', '1200.05']) {
    const parsed = parseMoney(text, 'JPY', 'en-US');
    assert.equal(parsed.error?.code, 'invalid-format', text);
    assert.equal(parsed.error.message, 'Money in JPY is whole units with no decimal places, written like 1200 or 1,200.');
  }
  // Where the locale does not group with it, "1.200" stays as ambiguous as it is for any currency, and the example
  // given has no places.
  assert.equal(parseMoney('1.200', 'JPY', 'en-US').error.message,
    '“1.200” could mean two different amounts; write it without a thousands separator, for example 1200.');
  assert.deepEqual(parseMoney('1.200', 'JPY', 'de-DE').value, { currency: 'JPY', minor: 1200 });
  assert.equal(parseMoney('9007199254740991', 'JPY').value.minor, Number.MAX_SAFE_INTEGER);
  assert.equal(parseMoney('9007199254740992', 'JPY').error.code, 'unsafe-money');
});

test('the forint keeps its two ISO places: whole forints are stored and shown exactly', () => {
  assert.deepEqual(parseMoney('1 200 000', 'HUF', 'hu-HU').value, { currency: 'HUF', minor: 120000000 });
  assert.deepEqual(parseMoney('950,50', 'HUF', 'hu-HU').value, { currency: 'HUF', minor: 95050 });
  assert.equal(formatMoney({ currency: 'HUF', minor: 120000000 }, 'en-US'), 'HUF 1,200,000.00');
  assert.equal(plainAmount({ currency: 'HUF', minor: 120000000 }), '1200000.00');
});

test('every new currency round-trips typed text, minor units, plain text and display exactly', () => {
  let seed = 7;
  const random = () => { seed = (seed * 48271) % 2147483647; return seed; };
  for (const currency of NEW_CURRENCIES) {
    for (let index = 0; index < 200; index += 1) {
      const minor = index < 3 ? [0, 1, Number.MAX_SAFE_INTEGER][index] : random() * (index % 2 ? 1 : 4096) % Number.MAX_SAFE_INTEGER;
      const text = plainAmount({ currency, minor });
      for (const locale of ['en-US', 'de-DE', 'ar-EG']) {
        assert.deepEqual(parseMoney(text, currency, locale).value, { currency, minor }, `${currency} ${text} ${locale}`);
      }
      const shown = formatAmount({ currency, minor }, 'en-US').replace(/,/g, '');
      assert.equal(shown, text, `${currency} ${minor}`);
      assert.ok(formatMoney({ currency, minor }, 'en-US').includes(formatAmount({ currency, minor }, 'en-US')));
    }
  }
});

// Every earlier version wrote two places for every amount; for the four currencies it knew, each conversion must give
// exactly what it gave. These are the old conversions, copied from v0.37.0, as the oracle.
function oldFormatMoney(money, locale, narrow = false) {
  const whole = BigInt(money.minor) / 100n;
  const fraction = String(money.minor % 100).padStart(2, '0');
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency', currency: money.currency, ...(narrow ? { currencyDisplay: 'narrowSymbol' } : {}),
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return formatter.formatToParts(whole).map((part) => part.type === 'fraction' ? fraction : part.value).join('');
}
function oldLineFigure(money, locale) {
  const whole = BigInt(money.minor) / 100n;
  const fraction = String(money.minor % 100).padStart(2, '0');
  let format;
  try { format = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { format = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  return format.formatToParts(whole).map((part) => (part.type === 'fraction' ? fraction : part.value)).join('');
}
function oldDecimal(minor) {
  if (!Number.isSafeInteger(minor) || minor < 0) return '';
  const digits = String(minor).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

test('the four currencies earlier versions knew convert exactly as they did', () => {
  let seed = 11;
  const random = () => { seed = (seed * 48271) % 2147483647; return seed; };
  const minors = [0, 1, 5, 99, 100, 101, 25050, 120000, 13668, Number.MAX_SAFE_INTEGER];
  for (let index = 0; index < 150; index += 1) minors.push(random() * (index % 3 ? 1 : 4194304) % Number.MAX_SAFE_INTEGER);
  for (const currency of OLD_CURRENCIES) {
    for (const minor of minors) {
      const money = { currency, minor };
      assert.equal(plainAmount(money), oldDecimal(minor), `${currency} ${minor}`);
      assert.equal(plainDecimal(minor), oldDecimal(minor));
      for (const locale of LOCALES) {
        assert.equal(formatMoney(money, locale), oldFormatMoney(money, locale), `${currency} ${minor} ${locale}`);
        assert.equal(formatMoney(money, locale, { narrow: true }), oldFormatMoney(money, locale, true));
        assert.equal(formatAmount(money, locale), oldLineFigure(money, locale));
      }
    }
  }
  assert.equal(formatAmount({ currency: 'EUR', minor: 120050 }, 'not a locale!'), oldLineFigure({ minor: 120050 }, 'not a locale!'));
  // Typed text reads to the same count it always did.
  for (const text of ['1200', '1200.5', '1200.50', '1,200.50', '1.200,50', "1'200.50", '1 200,50', '0.05', '12,50', '1200.00']) {
    for (const locale of ['en-US', 'de-DE', 'de-CH']) {
      for (const currency of OLD_CURRENCIES) {
        const parsed = parseMoney(text, currency, locale);
        assert.ok(parsed.ok, `${text} ${locale}`);
        assert.equal(plainAmount(parsed.value), oldDecimal(parsed.value.minor));
      }
    }
  }
  assert.deepEqual(parseMoney('1200.5', 'USD').value, { currency: 'USD', minor: 120050 });
  assert.equal(parseMoney('1.200', 'USD', 'en-US').error.message,
    '“1.200” could mean two different amounts; write it without a thousands separator, for example 1200 or 1200.00.');
  assert.equal(parseMoney('1200.505', 'USD').ok, false);
  assert.equal(parsePremiumPercent('22.505').ok, false);
});

// The narrow symbol is shown only where it names one currency: "$" is the US dollar to an en-US reader, so the
// Australian, Canadian and Hong Kong dollars keep "A$", "CA$" and "HK$", and a "kr" no locale here gives to one crown
// keeps the code.
test('the narrow symbol is used only where it names one currency for the locale', () => {
  const narrow = (currency, locale = 'en-US') => formatMoney({ currency, minor: 120000 }, locale, { narrow: true });
  assert.deepEqual(['USD', 'AUD', 'CAD', 'HKD', 'EUR', 'GBP', 'CHF'].map((code) => narrow(code)),
    ['$1,200.00', 'A$1,200.00', 'CA$1,200.00', 'HK$1,200.00', '€1,200.00', '£1,200.00', 'CHF 1,200.00']);
  for (const code of ['DKK', 'NOK', 'SEK']) assert.equal(narrow(code), `${code} 1,200.00`, code);
  // A sign only one listed currency has is narrow as before.
  assert.equal(narrow('PLN'), 'zł 1,200.00');
  assert.equal(narrow('CZK'), 'Kč 1,200.00');
  assert.equal(formatMoney({ currency: 'JPY', minor: 1200000 }, 'en-US', { narrow: true }), '¥1,200,000');
  // Where the locale gives "$" to its own dollar, that dollar has it and the others do not.
  assert.equal(narrow('AUD', 'en-AU'), '$1,200.00');
  assert.equal(narrow('USD', 'en-AU'), 'USD 1,200.00');
  assert.equal(narrow('CAD', 'en-CA'), '$1,200.00');
  assert.equal(narrow('SEK', 'sv-SE'), '1 200,00 kr');
  // Where no listed currency has "$" as its own sign, it stays with the US dollar, as every earlier version showed it.
  assert.equal(narrow('USD', 'en-GB'), '$1,200.00');
  assert.equal(narrow('AUD', 'en-GB'), 'A$1,200.00');
});

// One money rule for every page (cycle 5): each page writes an amount with formatMoney(money, its locale, { narrow: true }),
// and the workspace calls it in exactly that shape. The same yen, crown and franc read the same on every page.
test('the one page rule writes each amount with the narrow sign only where it names one currency', () => {
  const page = (currency, minor, locale) => formatMoney({ currency, minor }, locale, { narrow: true }).replace(/ /g, ' ');
  assert.equal(page('JPY', 1200000, 'en-GB'), '¥1,200,000');
  assert.equal(page('SEK', 1250000, 'en-GB'), 'SEK 12,500.00');
  assert.equal(page('CHF', 120000, 'en-GB'), 'CHF 1,200.00');
  assert.equal(page('GBP', 65000, 'en-GB'), '£650.00');
  assert.equal(page('EUR', 130000, 'de-DE'), '1.300,00 €');
  assert.equal(page('USD', 120000, 'de-DE'), '1.200,00 $');
});

// A page passes the browser's language as it is; one Intl cannot read must not take the page down with it.
test('formatMoney writes a locale Intl refuses in en-US rather than throwing', () => {
  for (const locale of ['en_GB', 'not a locale', '']) {
    assert.equal(formatMoney({ currency: 'GBP', minor: 65000 }, locale, { narrow: true }), '£650.00', JSON.stringify(locale));
    assert.equal(formatMoney({ currency: 'USD', minor: 65000 }, locale), '$650.00', JSON.stringify(locale));
  }
});

// A house schedule prints its tiers in whole units, and the price panel its medians rounded to the unit: `whole` leaves
// the places off an amount that has none to show, and keeps them on one that has.
test('formatMoney with whole leaves the places off a whole amount only', () => {
  const whole = (currency, minor, locale = 'en-GB') => formatMoney({ currency, minor }, locale, { narrow: true, whole: true }).replace(/ /g, ' ');
  assert.equal(whole('GBP', 100000), '£1,000');
  assert.equal(whole('GBP', 100050), '£1,000.50');
  assert.equal(whole('EUR', 100000, 'de-DE'), '1.000 €');
  assert.equal(whole('JPY', 1200000), '¥1,200,000');
  assert.equal(whole('SEK', 1250000), 'SEK 12,500');
  assert.equal(whole('HUF', 150000, 'en-US'), 'Ft 1,500');
  assert.equal(whole('USD', 0, 'en-US'), '$0');
});
