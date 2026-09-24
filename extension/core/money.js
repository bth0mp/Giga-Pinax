import { failure } from './validate.js';

export const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);

const CURRENCY_SET = new Set(CURRENCIES);
export const FRACTION_DIGITS = 2;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const DECIMAL = /^(\d+)([.,])(\d+)$/;
// Auction houses group with a comma, a point, an apostrophe or a space, so a grouped amount is
// recognized by its shape rather than by the browser locale, which is often not the seller's.
// Swiss listings group with the typographic apostrophe; a grouping space may be plain, no-break
// or narrow, written as escapes here so an invisible byte cannot be lost in an edit.
const GROUPED = /^(\d{1,3})((['\u2019 \u00a0\u202f,.])\d{3}(?:\3\d{3})*)(?:([.,])(\d{1,2}))?$/;
const ambiguousMessage = (input) =>
  `“${input}” could mean two different amounts; write it without a thousands separator, for example 1200 or 1200.00.`;

// Returns the digits of an unambiguous amount, or null when the text cannot be read at all.
// `1,200` is neither: only the collector knows whether that is 1200 or 1.20, so it is refused.
function splitAmount(input) {
  if (/^\d+$/.test(input)) return { whole: input, fraction: '' };
  const decimal = DECIMAL.exec(input);
  if (decimal) {
    if (decimal[3].length <= 2) return { whole: decimal[1], fraction: decimal[3] };
    return decimal[3].length === 3 && decimal[1].length <= 3 ? { ambiguous: true } : null;
  }
  const grouped = GROUPED.exec(input);
  if (!grouped) return null;
  const [, lead, groups, groupSeparator, decimalSeparator, fraction] = grouped;
  if (decimalSeparator === groupSeparator) return null;
  return { whole: lead + groups.split(groupSeparator).join(''), fraction: fraction ?? '' };
}

// The locale is accepted for call-site symmetry with formatting; parsing never depends on it.
function parseFixed(text, maximumMinor, subject) {
  if (typeof text !== 'string') {
    return failure('invalid-format', `${subject} must be entered as text.`);
  }

  const input = text.trim();
  if (input.length > 32) return failure('input-too-long', `${subject} input is too long.`);
  const parts = splitAmount(input);
  if (!parts) {
    return failure(
      'invalid-format',
      `${subject} must be digits with at most two decimal places, written like 1200, 1200.50 or 1200,50.`,
    );
  }
  if (parts.ambiguous) return failure('ambiguous-amount', ambiguousMessage(input));

  const whole = BigInt(parts.whole);
  const fraction = BigInt(parts.fraction.padEnd(FRACTION_DIGITS, '0'));
  const minor = whole * 100n + fraction;
  if (minor > maximumMinor) {
    return failure('unsafe-money', `${subject} is outside the supported integer range.`);
  }
  return { ok: true, value: Number(minor) };
}

export function validateMoney(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failure('invalid-money', 'Money must be an object.');
  }
  if (!CURRENCY_SET.has(value.currency)) {
    return failure('unsupported-currency', 'Currency must be USD, EUR, GBP, or CHF.', 'currency');
  }
  if (!Number.isSafeInteger(value.minor) || value.minor < 0) {
    return failure(
      'invalid-minor-units',
      'Money minor units must be a non-negative safe integer.',
      'minor',
    );
  }
  return { ok: true, value };
}

export function parseMoney(text, currency, locale = 'en-US') {
  if (!CURRENCY_SET.has(currency)) {
    return failure('unsupported-currency', 'Currency must be USD, EUR, GBP, or CHF.', 'currency');
  }
  const parsed = parseFixed(text, MAX_SAFE_BIGINT, 'Money');
  if (!parsed.ok) return parsed;
  return { ok: true, value: { currency, minor: parsed.value } };
}

export function parsePremiumPercent(text, locale = 'en-US') {
  const parsed = parseFixed(text, 10000n, 'Buyer premium');
  if (!parsed.ok) {
    if (parsed.error.code === 'unsafe-money') {
      return failure('invalid-basis-points', 'Buyer premium must be between 0% and 100%.');
    }
    return parsed;
  }
  return { ok: true, value: parsed.value };
}

export function formatMoney(money, locale = 'en-US') {
  const checked = validateMoney(money);
  if (!checked.ok) throw new TypeError(checked.error.message);

  const whole = BigInt(money.minor) / 100n;
  const fraction = String(money.minor % 100).padStart(FRACTION_DIGITS, '0');
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: FRACTION_DIGITS,
    maximumFractionDigits: FRACTION_DIGITS,
  });
  return formatter.formatToParts(whole)
    .map((part) => part.type === 'fraction' ? fraction : part.value)
    .join('');
}

export function calculatePremium(hammer, buyerPremiumBps) {
  const checked = validateMoney(hammer);
  if (!checked.ok) return checked;
  if (!Number.isInteger(buyerPremiumBps) || buyerPremiumBps < 0 || buyerPremiumBps > 10000) {
    return failure(
      'invalid-basis-points',
      'Buyer premium basis points must be an integer from 0 through 10,000.',
      'buyerPremiumBps',
    );
  }

  const hammerMinor = BigInt(hammer.minor);
  const premiumMinor = (hammerMinor * BigInt(buyerPremiumBps) + 5000n) / 10000n;
  const totalMinor = hammerMinor + premiumMinor;
  if (premiumMinor > MAX_SAFE_BIGINT || totalMinor > MAX_SAFE_BIGINT) {
    return failure('unsafe-money', 'Premium calculation is outside the supported integer range.');
  }

  return {
    ok: true,
    value: {
      premium: { currency: hammer.currency, minor: Number(premiumMinor) },
      hammerPlusPremium: { currency: hammer.currency, minor: Number(totalMinor) },
    },
  };
}

export const MAX_INCREMENT_TIERS = 20;

// A tier the collector typed on a numbered list is easier to point at by its number than by an
// error path, so a tier's failure says which tier it was.
function tierFailure(index, message, path) {
  const result = failure('invalid-ladder', message, path);
  result.error.tier = index;
  return result;
}

// Every rule of a ladder except the anchor at zero. The fixed increment field is the one-tier case
// of the same code, and its one tier is anchored at the collector's minimum bid instead.
function ladderShape(tiers, path) {
  if (!Array.isArray(tiers) || tiers.length === 0 || tiers.length > MAX_INCREMENT_TIERS) {
    return failure('invalid-ladder', `An increment ladder needs 1 to ${MAX_INCREMENT_TIERS} tiers.`, path);
  }
  let previousFrom = -1;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const tierPath = `${path}[${index}]`;
    if (!tier || typeof tier !== 'object' || Array.isArray(tier)) {
      return tierFailure(index, 'Each tier must be a from and a step.', tierPath);
    }
    if (!Number.isSafeInteger(tier.from) || tier.from < 0 || tier.from <= previousFrom) {
      return tierFailure(index, 'Each tier must start above the tier before it.', `${tierPath}.from`);
    }
    if (!Number.isSafeInteger(tier.step) || tier.step < 1) {
      return tierFailure(index, 'Each tier needs a step greater than zero.', `${tierPath}.step`);
    }
    previousFrom = tier.from;
  }
  return { ok: true, value: tiers };
}

// The house's own schedule as the collector copied it: the first tier starts at zero so that every
// bid falls in exactly one tier.
export function validateLadderTiers(tiers, path = 'tiers') {
  const shape = ladderShape(tiers, path);
  if (!shape.ok) return shape;
  return tiers[0].from === 0
    ? { ok: true, value: tiers }
    : tierFailure(0, 'The first tier must start at 0.', `${path}[0].from`);
}

// A stored ladder keeps the currency its tiers are written in: the schedule is in the house's own
// money, which is not always the currency the calculator is set to.
export function validateIncrementLadder(ladder, path = 'incrementLadder') {
  if (!ladder || typeof ladder !== 'object' || Array.isArray(ladder)) {
    return failure('invalid-ladder', 'An increment ladder needs a currency and its tiers.', path);
  }
  if (!CURRENCY_SET.has(ladder.currency)) {
    return failure('unsupported-currency', 'Currency must be USD, EUR, GBP, or CHF.', `${path}.currency`);
  }
  const tiers = validateLadderTiers(ladder.tiers, `${path}.tiers`);
  return tiers.ok ? { ok: true, value: ladder } : tiers;
}

// The tier a bid falls in: the last one that starts at or below it.
function tierIndexAt(tiers, minor) {
  let index = 0;
  while (index + 1 < tiers.length && tiers[index + 1].from <= minor) index += 1;
  return index;
}

// The smallest bid on the ladder at or above `minor`, which is `minor` itself when it already sits
// on the grid of its tier. A step that would carry past the next tier stops at that tier's start,
// which is on the grid by definition.
function nextOnLadder(tiers, minor) {
  const floored = Math.max(minor, tiers[0].from);
  const index = tierIndexAt(tiers, floored);
  const { from, step } = tiers[index];
  const remainder = (floored - from) % step;
  if (remainder === 0) return floored;
  const candidate = floored + (step - remainder);
  const nextTier = tiers[index + 1];
  return nextTier ? Math.min(candidate, nextTier.from) : candidate;
}

// The highest bid on the ladder at or below `minor`, which is never below the tier it falls in.
function previousOnLadder(tiers, minor) {
  const { from, step } = tiers[tierIndexAt(tiers, minor)];
  return from + Math.floor((minor - from) / step) * step;
}

// A minimum bid the house's schedule does not allow is rounded up, never down: a bid below the grid
// is not a bid the house would take.
export function nextBidOnLadder(tiers, minor) {
  const shape = ladderShape(tiers, 'incrementLadder');
  if (!shape.ok) return shape;
  const valid = optionInteger(minor, 'minor');
  if (!valid.ok) return valid;
  const next = nextOnLadder(tiers, minor);
  return Number.isSafeInteger(next)
    ? { ok: true, value: next }
    : failure('unsafe-money', 'The next bid on this ladder is outside the supported integer range.');
}

function optionInteger(value, key, { positive = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > maximum) {
    return failure('invalid-option', `${key} must be ${positive ? 'a positive' : 'a non-negative'} safe integer.`, key);
  }
  return { ok: true, value };
}

export function calculateBidCost(hammer, buyerPremiumBps, options = {}) {
  const checked = validateMoney(hammer);
  if (!checked.ok) return checked;
  const premium = calculatePremium(hammer, buyerPremiumBps);
  if (!premium.ok) return premium;
  const values = { shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, ...options };
  for (const key of ['shippingMinor', 'paymentFeeMinor']) {
    const valid = optionInteger(values[key], key); if (!valid.ok) return valid;
  }
  const feeBps = optionInteger(values.paymentFeeBps, 'paymentFeeBps', { maximum: 10000 });
  if (!feeBps.ok) return feeBps;
  const base = BigInt(premium.value.hammerPlusPremium.minor) + BigInt(values.shippingMinor);
  const percentageFee = (base * BigInt(values.paymentFeeBps) + 5000n) / 10000n;
  const paymentFee = percentageFee + BigInt(values.paymentFeeMinor);
  const total = base + paymentFee;
  if ([base, paymentFee, total].some((value) => value > MAX_SAFE_BIGINT)) {
    return failure('unsafe-money', 'Bid cost calculation is outside the supported integer range.');
  }
  const money = (minor) => ({ currency: hammer.currency, minor: Number(minor) });
  return { ok: true, value: {
    hammer: { ...hammer }, premium: premium.value.premium,
    hammerPlusPremium: premium.value.hammerPlusPremium,
    shipping: money(BigInt(values.shippingMinor)), paymentFee: money(paymentFee), total: money(total),
  }};
}

export function calculateAffordableBid(budget, buyerPremiumBps, options = {}) {
  const checked = validateMoney(budget); if (!checked.ok) return checked;
  const values = { shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0, ...options };
  for (const key of ['shippingMinor', 'paymentFeeMinor', 'minimumBidMinor']) {
    const valid = optionInteger(values[key], key); if (!valid.ok) return valid;
  }
  for (const [key, config] of [['paymentFeeBps', { maximum: 10000 }], ['incrementMinor', { positive: true }]]) {
    const valid = optionInteger(values[key], key, config); if (!valid.ok) return valid;
  }
  // A house ladder replaces the fixed grid; without one the fixed increment is a single tier
  // anchored at the minimum bid, which is the grid this calculator has always used.
  const tiers = values.ladder === undefined
    ? [{ from: values.minimumBidMinor, step: values.incrementMinor }]
    : values.ladder;
  if (values.ladder !== undefined) {
    const valid = validateLadderTiers(values.ladder, 'ladder');
    if (!valid.ok) return valid;
  }
  const premiumCheck = calculatePremium({ currency: budget.currency, minor: 0 }, buyerPremiumBps);
  if (!premiumCheck.ok) return premiumCheck;
  const affordable = (minor) => {
    const result = calculateBidCost({ currency: budget.currency, minor: Number(minor) }, buyerPremiumBps, values);
    return result.ok && result.value.total.minor <= budget.minor;
  };
  // The lowest bid worth trying: positive, at or above the minimum, and rounded up onto the grid.
  const floor = nextOnLadder(tiers, Math.max(values.minimumBidMinor, 1));
  if (!Number.isSafeInteger(floor)) return failure('unsafe-money', 'The lowest bid on this grid is outside the supported integer range.');
  if (!affordable(floor)) return failure('no-affordable-bid', 'No positive bid on this grid is affordable.');
  // Total cost never falls as the hammer rises, so the affordable hammers are exactly those at or
  // below one boundary: find it, then step back onto the grid of whichever tier it lands in. That
  // step back is what puts the answer in a lower tier when the tier above is out of reach.
  let low = BigInt(floor);
  let high = BigInt(budget.minor) + 1n;
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (affordable(middle)) low = middle; else high = middle;
  }
  const hammer = previousOnLadder(tiers, Number(low));
  return calculateBidCost({ currency: budget.currency, minor: hammer }, buyerPremiumBps, values);
}

