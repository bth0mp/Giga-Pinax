export const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);

const CURRENCY_SET = new Set(CURRENCIES);
const FRACTION_DIGITS = 2;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function failure(code, message, path) {
  const error = { code, message };
  if (path !== undefined) error.path = path;
  return { ok: false, error };
}

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

export function calculateMaximumHammer(budget, buyerPremiumBps) {
  const checked = validateMoney(budget);
  if (!checked.ok) return checked;
  if (!Number.isInteger(buyerPremiumBps) || buyerPremiumBps < 0 || buyerPremiumBps > 10000) {
    return failure(
      'invalid-basis-points',
      'Buyer premium basis points must be an integer from 0 through 10,000.',
      'buyerPremiumBps',
    );
  }

  const affordable = (minor) => {
    const premium = (minor * BigInt(buyerPremiumBps) + 5000n) / 10000n;
    return minor + premium <= BigInt(budget.minor);
  };
  let low = 0n;
  let high = BigInt(budget.minor) + 1n;
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (affordable(middle)) low = middle;
    else high = middle;
  }
  const hammer = { currency: budget.currency, minor: Number(low) };
  const forward = calculatePremium(hammer, buyerPremiumBps);
  if (!forward.ok) return forward;
  return {
    ok: true,
    value: {
      hammer,
      premium: forward.value.premium,
      hammerPlusPremium: forward.value.hammerPlusPremium,
    },
  };
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
  const premiumCheck = calculatePremium({ currency: budget.currency, minor: 0 }, buyerPremiumBps);
  if (!premiumCheck.ok) return premiumCheck;
  const affordable = (minor) => {
    const result = calculateBidCost({ currency: budget.currency, minor: Number(minor) }, buyerPremiumBps, values);
    return result.ok && result.value.total.minor <= budget.minor;
  };
  const minimum = BigInt(values.minimumBidMinor);
  const increment = BigInt(values.incrementMinor);
  const firstIndex = minimum === 0n ? 1n : 0n;
  if (!affordable(minimum + firstIndex * increment)) return failure('no-affordable-bid', 'No positive bid on this grid is affordable.');
  let low = firstIndex;
  let high = (BigInt(budget.minor) >= minimum ? (BigInt(budget.minor) - minimum) / increment + 1n : firstIndex + 1n);
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (affordable(minimum + middle * increment)) low = middle; else high = middle;
  }
  return calculateBidCost({ currency: budget.currency, minor: Number(minimum + low * increment) }, buyerPremiumBps, values);
}

export function sumMoney(values, currency) {
  if (!CURRENCY_SET.has(currency)) {
    return failure('unsupported-currency', 'Currency must be USD, EUR, GBP, or CHF.', 'currency');
  }
  if (!Array.isArray(values)) return failure('invalid-money-list', 'Money values must be an array.');

  let total = 0n;
  for (let index = 0; index < values.length; index += 1) {
    const checked = validateMoney(values[index]);
    if (!checked.ok) return { ...checked, error: { ...checked.error, path: `[${index}]` } };
    if (values[index].currency !== currency) {
      return failure('currency-mismatch', 'Money values cannot be summed across currencies.', `[${index}].currency`);
    }
    total += BigInt(values[index].minor);
    if (total > MAX_SAFE_BIGINT) {
      return failure('unsafe-money', 'Money sum is outside the supported integer range.');
    }
  }
  return { ok: true, value: { currency, minor: Number(total) } };
}
