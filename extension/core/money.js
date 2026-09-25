// @ts-check
import { failure } from './validate.js';
/**
 * @typedef {import('./types.js').Money} Money
 * @typedef {import('./types.js').LadderTier} LadderTier
 * @typedef {import('./types.js').IncrementLadder} IncrementLadder
 * @typedef {import('./types.js').Failure} Failure
 */
/**
 * @template T
 * @typedef {import('./types.js').Result<T>} Result
 */
/**
 * The fees a cost is worked out with; each defaults to zero. VAT on the premium is charged on the
 * premium alone (Künker, Roma, Leu), a platform fee on the hammer alone (biddr, NumisBids, Sixbid), and
 * import VAT or duty on hammer + premium + shipping (the CIF value a carrier or customs charges on when
 * the coin crosses a border: UK 5 %, Germany 7 %).
 * @typedef {object} BidCostOptions
 * @property {number} [shippingMinor]
 * @property {number} [paymentFeeBps]
 * @property {number} [paymentFeeMinor]
 * @property {number} [premiumVatBps]
 * @property {number} [platformFeeBps]
 * @property {number} [importVatBps]
 */
/**
 * The fees, and the grid a bid must sit on: a fixed increment from the minimum bid, or a house ladder.
 * @typedef {BidCostOptions & { incrementMinor?: number, minimumBidMinor?: number, ladder?: LadderTier[] }} AffordableBidOptions
 */
/**
 * @typedef {object} BidCost
 * @property {Money} hammer
 * @property {Money} premium
 * @property {Money} premiumVat
 * @property {Money} platformFee
 * @property {Money} hammerPlusPremium
 * @property {Money} shipping
 * @property {Money} importVat
 * @property {Money} paymentFee
 * @property {Money} total
 */

// The currencies an amount may be recorded in, and each one's minor units: the ISO 4217 exponent, fixed here rather
// than read from the browser, because a stored amount is a count of these units and must mean the same thing in
// every browser for good. The table agrees with Intl's own (`resolvedOptions().maximumFractionDigits`), which a test
// checks. The yen has no minor unit, so a JPY amount is whole yen. The forint keeps its ISO 4217 two places although
// no coin smaller than a forint circulates and houses sell in whole forints: an amount typed in whole forints is
// stored and shown exactly, with .00. The first four are the ones every earlier version knew, in their old order.
// Nothing is ever converted between them.
const MINOR_UNITS = Object.freeze({
  USD: 2, EUR: 2, GBP: 2, CHF: 2,
  AUD: 2, CAD: 2, CZK: 2, DKK: 2, HKD: 2, HUF: 2, JPY: 0, NOK: 2, PLN: 2, SEK: 2,
});
export const CURRENCIES = Object.freeze(Object.keys(MINOR_UNITS));
// The currencies price research is asked in: acsearch converts its hammer prices into one of these, and the popup's
// research form offers only these. They keep their own set; a default bid currency beyond them leaves research alone.
export const RESEARCH_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);

const CURRENCY_SET = new Set(CURRENCIES);
// The places of a percentage: basis points are hundredths of a percent.
export const FRACTION_DIGITS = 2;
export const UNSUPPORTED_CURRENCY_MESSAGE = `Currency must be one of ${CURRENCIES.slice(0, -1).join(', ')} or ${CURRENCIES.at(-1)}.`;

/**
 * The minor units of a supported currency: 2 for cents, 0 for the yen. Anything else is not a currency here.
 * @param {*} currency
 * @returns {number | null}
 */
export function minorDigits(currency) {
  return CURRENCY_SET.has(currency) ? MINOR_UNITS[/** @type {keyof typeof MINOR_UNITS} */ (currency)] : null;
}

/**
 * A count of minor units as plain text in the one form the money parser reads in every locale: ASCII digits, a
 * point before the places and no grouping - 25050 with two places is "250.50", 1200000 with none is "1200000".
 * Anything but a whole non-negative count writes nothing.
 * @param {*} minor
 * @param {number} [digits]
 * @returns {string}
 */
export function plainDecimal(minor, digits = FRACTION_DIGITS) {
  if (!Number.isSafeInteger(minor) || minor < 0) return '';
  if (digits === 0) return String(minor);
  const text = String(minor).padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/**
 * An amount as plain text in its own currency's places (see plainDecimal); a currency this build does not know is
 * written with two, as every amount was before there were others.
 * @param {*} money
 * @returns {string}
 */
export function plainAmount(money) {
  return plainDecimal(money?.minor, minorDigits(money?.currency) ?? FRACTION_DIGITS);
}
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const DECIMAL = /^(\d+)([.,])(\d+)$/;
// Auction houses group with a comma, a point, an apostrophe or a space, so a grouped amount is
// recognized by its shape rather than by the browser locale, which is often not the seller's.
// Swiss listings group with the typographic apostrophe; a grouping space may be plain, no-break
// or narrow, written as escapes here so an invisible byte cannot be lost in an edit.
const GROUPED = /^(\d{1,3})((['\u2019 \u00a0\u202f,.])\d{3}(?:\3\d{3})*)(?:([.,])(\d{1,2}))?$/;
const ambiguousMessage = (input, digits) =>
  `“${input}” could mean two different amounts; write it without a thousands separator, for example 1200${digits ? ` or 1200.${'0'.repeat(digits)}` : ''}.`;
// What a readable amount looks like, with the places this amount may have.
const formatMessage = (subject, digits, currency) => (digits === 0
  ? `${subject} in ${currency} is whole units with no decimal places, written like 1200 or 1,200.`
  : `${subject} must be digits with at most two decimal places, written like 1200, 1200.50 or 1200,50.`);

// `1,200` or `1.200`: three digits after a separator, behind at most three, read as well as a thousands group as three decimal places.
/** @type {(whole: string, fraction: string) => boolean} */
export const ambiguousGrouping = (whole, fraction) => fraction.length === 3 && whole.length <= 3;

// The thousands separator of the collector's own locale, when it is a comma or a point and that locale
// writes its decimals with the other one. A malformed tag, which Intl rejects, gives none; a well-formed
// tag Intl does not know falls back to its root locale, which groups with a comma.
/** @type {(locale: string) => string | null} */
function localeGroup(locale) {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
    const group = parts.find((part) => part.type === 'group')?.value;
    const decimal = parts.find((part) => part.type === 'decimal')?.value;
    return (group === ',' && decimal === '.') || (group === '.' && decimal === ',') ? group : null;
  } catch {
    return null;
  }
}

// Returns the digits of an unambiguous amount, or null when the text cannot be read at all.
// `1,200` is read with the collector's locale: where a comma groups thousands and a point marks
// decimals (en-US) it is twelve hundred, since three decimals are never money here; where the comma
// is the decimal mark (de-DE) it could be 1.20 as well, so it is refused. `1.200` the other way round.
/**
 * @param {string} input
 * @param {string} locale
 * @returns {{ whole: string, fraction: string, ambiguous?: false } | { ambiguous: true } | null}
 */
function splitAmount(input, locale) {
  if (/^\d+$/.test(input)) return { whole: input, fraction: '' };
  const decimal = DECIMAL.exec(input);
  if (decimal) {
    if (decimal[3].length <= 2) return { whole: decimal[1], fraction: decimal[3] };
    if (!ambiguousGrouping(decimal[1], decimal[3])) return null;
    // A group never follows a lone zero: `0,200` is a decimal typed with a third place, not two hundred.
    const grouping = decimal[1] !== '0' && decimal[2] === localeGroup(locale);
    return grouping ? { whole: decimal[1] + decimal[3], fraction: '' } : { ambiguous: true };
  }
  const grouped = GROUPED.exec(input);
  if (!grouped) return null;
  const [, lead, groups, groupSeparator, decimalSeparator, fraction] = grouped;
  if (decimalSeparator === groupSeparator) return null;
  return { whole: lead + groups.split(groupSeparator).join(''), fraction: fraction ?? '' };
}

// Only a lone `1,200` or `1.200` depends on the locale; every other shape reads the same everywhere.
// The places are the amount's own: two for a percentage and for most currencies, none for the yen. A place the
// amount cannot have is refused unless it is a zero, which changes nothing: "1200.00" yen is exactly 1200 yen, and
// "1200.50" yen is no amount at all, never one rounded to 1200 or 1201.
/**
 * @param {*} text
 * @param {bigint} maximumMinor
 * @param {string} subject
 * @param {string} locale
 * @param {number} [digits]
 * @param {string} [currency] named in the message of an amount with no places
 * @returns {Result<number>}
 */
function parseFixed(text, maximumMinor, subject, locale, digits = FRACTION_DIGITS, currency = '') {
  if (typeof text !== 'string') {
    return failure('invalid-format', `${subject} must be entered as text.`);
  }

  const input = text.trim();
  if (input.length > 32) return failure('input-too-long', `${subject} input is too long.`);
  const parts = splitAmount(input, locale);
  if (parts?.ambiguous) return failure('ambiguous-amount', ambiguousMessage(input, digits));
  if (!parts || /[^0]/.test(parts.fraction.slice(digits))) {
    return failure('invalid-format', formatMessage(subject, digits, currency));
  }

  const whole = BigInt(parts.whole);
  const fraction = BigInt(parts.fraction.slice(0, digits).padEnd(digits, '0') || '0');
  const minor = whole * 10n ** BigInt(digits) + fraction;
  if (minor > maximumMinor) {
    return failure('unsafe-money', `${subject} is outside the supported integer range.`);
  }
  return { ok: true, value: Number(minor) };
}

/**
 * @param {*} value
 * @returns {Result<Money>}
 */
export function validateMoney(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failure('invalid-money', 'Money must be an object.');
  }
  if (!CURRENCY_SET.has(value.currency)) {
    return failure('unsupported-currency', UNSUPPORTED_CURRENCY_MESSAGE, 'currency');
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

/**
 * @param {string} text
 * @param {string} currency
 * @param {string} [locale]
 * @returns {Result<Money>}
 */
export function parseMoney(text, currency, locale = 'en-US') {
  if (!CURRENCY_SET.has(currency)) {
    return failure('unsupported-currency', UNSUPPORTED_CURRENCY_MESSAGE, 'currency');
  }
  const parsed = parseFixed(text, MAX_SAFE_BIGINT, 'Money', locale, /** @type {number} */ (minorDigits(currency)), currency);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { currency, minor: parsed.value } };
}

// A percentage typed as text, as basis points; the subject names the field in its errors.
/**
 * @param {string} text
 * @param {string} [locale]
 * @param {string} [subject]
 * @returns {Result<number>} basis points
 */
export function parsePercent(text, locale = 'en-US', subject = 'Percentage') {
  const parsed = parseFixed(text, 10000n, subject, locale);
  if (!parsed.ok) {
    if (parsed.error.code === 'unsafe-money') {
      return failure('invalid-basis-points', `${subject} must be between 0% and 100%.`);
    }
    return parsed;
  }
  return { ok: true, value: parsed.value };
}

/**
 * @param {string} text
 * @param {string} [locale]
 * @returns {Result<number>} basis points
 */
export function parsePremiumPercent(text, locale = 'en-US') {
  return parsePercent(text, locale, 'Buyer premium');
}

/**
 * An amount in the collector's locale. `narrow` writes the narrow symbol ("$", not "US$"), where only one currency is in
 * view and the code is named beside it.
 * @param {Money} money
 * @param {string} [locale]
 * @param {{ narrow?: boolean }} [options]
 * @returns {string}
 */
export function formatMoney(money, locale = 'en-US', { narrow = false } = {}) {
  const checked = validateMoney(money);
  if (!checked.ok) throw new TypeError(checked.error.message);
  const digits = /** @type {number} */ (minorDigits(money.currency));
  return exactParts(money.minor, digits, new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    ...(narrow ? { currencyDisplay: narrowDisplay(money.currency, locale) } : {}),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }));
}

// A currency's sign in a locale, as a display writes it.
/**
 * @param {string} currency
 * @param {string} locale
 * @param {'symbol' | 'narrowSymbol'} display
 * @returns {string}
 */
const currencySign = (currency, locale, display) => new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: display })
  .formatToParts(0).find((part) => part.type === 'currency')?.value ?? '';

// The narrow sign is written only where it names one currency for the reader. "$" is the narrow sign of four dollars
// here: in en-US it is the US dollar's own sign, so the Australian, Canadian and Hong Kong dollars keep "A$", "CA$" and
// "HK$"; in en-AU it is the Australian dollar's, so the US dollar keeps its standard sign. Where the locale gives a
// shared sign to none of them, it stays with the one of the four currencies every earlier version knew that has it -
// the US dollar keeps "$" in en-GB, as it always did - and a sign none of those has ("kr" in en-US) names no one.
/** @type {Map<string, 'symbol' | 'narrowSymbol'>} */
const narrowDisplays = new Map();
/**
 * @param {string} currency
 * @param {string} locale
 * @returns {'symbol' | 'narrowSymbol'}
 */
function narrowDisplay(currency, locale) {
  const key = `${locale}
${currency}`;
  const known = narrowDisplays.get(key);
  if (known) return known;
  const sign = currencySign(currency, locale, 'narrowSymbol');
  const sharing = CURRENCIES.filter((code) => currencySign(code, locale, 'narrowSymbol') === sign);
  const owner = sharing.length === 1 ? currency
    : sharing.find((code) => currencySign(code, locale, 'symbol') === sign) ?? sharing.find((code) => CURRENCIES.indexOf(code) < 4);
  /** @type {'symbol' | 'narrowSymbol'} */
  const display = owner === currency ? 'narrowSymbol' : 'symbol';
  narrowDisplays.set(key, display);
  return display;
}

// The locale's formatter lays out the whole units, and the places are written in from the stored count itself, so
// no amount passes through a floating-point number on its way to the page.
/**
 * @param {number} minor
 * @param {number} digits
 * @param {Intl.NumberFormat} formatter
 * @returns {string}
 */
function exactParts(minor, digits, formatter) {
  const scale = 10n ** BigInt(digits);
  const whole = BigInt(minor) / scale;
  const fraction = String(BigInt(minor) % scale).padStart(digits, '0');
  return formatter.formatToParts(whole)
    .map((part) => part.type === 'fraction' ? fraction : part.value)
    .join('');
}

/**
 * An amount's figure alone, as a money line shows it beside the currency it names once: the collector's grouping and
 * decimal mark, the currency's own places, no symbol. A locale Intl refuses falls back to en-US.
 * @param {Money} money
 * @param {string} [locale]
 * @returns {string}
 */
export function formatAmount(money, locale = 'en-US') {
  const checked = validateMoney(money);
  if (!checked.ok) throw new TypeError(checked.error.message);
  const digits = /** @type {number} */ (minorDigits(money.currency));
  const options = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  let formatter;
  try { formatter = new Intl.NumberFormat(locale, options); } catch { formatter = new Intl.NumberFormat('en-US', options); }
  return exactParts(money.minor, digits, formatter);
}

/**
 * @param {Money} hammer
 * @param {*} buyerPremiumBps checked here: an integer from 0 through 10,000
 * @returns {Result<{ premium: Money, hammerPlusPremium: Money }>}
 */
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
/**
 * @param {number} index
 * @param {string} message
 * @param {string} path
 * @returns {Failure}
 */
function tierFailure(index, message, path) {
  const result = failure('invalid-ladder', message, path);
  result.error.tier = index;
  return result;
}

// Every rule of a ladder except the anchor at zero. The fixed increment field is the one-tier case
// of the same code, and its one tier is anchored at the collector's minimum bid instead.
/**
 * @param {*} tiers
 * @param {string} path
 * @returns {Result<LadderTier[]>}
 */
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
/**
 * @param {*} tiers
 * @param {string} [path]
 * @returns {Result<LadderTier[]>}
 */
export function validateLadderTiers(tiers, path = 'tiers') {
  const shape = ladderShape(tiers, path);
  if (!shape.ok) return shape;
  return tiers[0].from === 0
    ? { ok: true, value: tiers }
    : tierFailure(0, 'The first tier must start at 0.', `${path}[0].from`);
}

// A stored ladder keeps the currency its tiers are written in: the schedule is in the house's own
// money, which is not always the currency the calculator is set to.
/**
 * @param {*} ladder
 * @param {string} [path]
 * @returns {Result<IncrementLadder>}
 */
export function validateIncrementLadder(ladder, path = 'incrementLadder') {
  if (!ladder || typeof ladder !== 'object' || Array.isArray(ladder)) {
    return failure('invalid-ladder', 'An increment ladder needs a currency and its tiers.', path);
  }
  if (!CURRENCY_SET.has(ladder.currency)) {
    return failure('unsupported-currency', UNSUPPORTED_CURRENCY_MESSAGE, `${path}.currency`);
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
/**
 * @param {LadderTier[]} tiers
 * @param {number} minor
 * @returns {Result<number>}
 */
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

/**
 * @param {*} value
 * @param {string} key
 * @param {{ positive?: boolean, maximum?: number }} [bounds]
 * @returns {Result<number>}
 */
function optionInteger(value, key, { positive = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > maximum) {
    return failure('invalid-option', `${key} must be ${positive ? 'a positive' : 'a non-negative'} safe integer.`, key);
  }
  return { ok: true, value };
}

const FEE_DEFAULTS = Object.freeze({ shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, premiumVatBps: 0, platformFeeBps: 0, importVatBps: 0 });

// Every fee a cost is worked out with: amounts are non-negative, percentages from 0 through 100 %.
/**
 * @param {Record<string, any>} values
 * @returns {Result<any>}
 */
function feeOptions(values) {
  for (const key of ['shippingMinor', 'paymentFeeMinor']) {
    const valid = optionInteger(values[key], key); if (!valid.ok) return valid;
  }
  for (const key of ['paymentFeeBps', 'premiumVatBps', 'platformFeeBps', 'importVatBps']) {
    const valid = optionInteger(values[key], key, { maximum: 10000 }); if (!valid.ok) return valid;
  }
  return { ok: true, value: values };
}

/**
 * @param {Money} hammer
 * @param {*} buyerPremiumBps checked here: an integer from 0 through 10,000
 * @param {BidCostOptions} [options]
 * @returns {Result<BidCost>}
 */
export function calculateBidCost(hammer, buyerPremiumBps, options = {}) {
  const checked = validateMoney(hammer);
  if (!checked.ok) return checked;
  const premium = calculatePremium(hammer, buyerPremiumBps);
  if (!premium.ok) return premium;
  const values = { ...FEE_DEFAULTS, ...options };
  const valid = feeOptions(values); if (!valid.ok) return valid;
  // Each share is rounded half up on its own, as an invoice rounds each line: the VAT on the premium
  // as the house invoices it, the platform's fee on the hammer.
  const share = (minor, bps) => (minor * BigInt(bps) + 5000n) / 10000n;
  const premiumVat = share(BigInt(premium.value.premium.minor), values.premiumVatBps);
  const platformFee = share(BigInt(hammer.minor), values.platformFeeBps);
  const base = BigInt(premium.value.hammerPlusPremium.minor) + premiumVat + platformFee + BigInt(values.shippingMinor);
  const paymentFee = share(base, values.paymentFeeBps) + BigInt(values.paymentFeeMinor);
  // Import VAT is paid to the carrier or customs, not on the house's invoice, so the house's payment fee is not
  // charged on it; it is charged on the coin's value as customs reads it: hammer, premium and shipping.
  const importVat = share(BigInt(premium.value.hammerPlusPremium.minor) + BigInt(values.shippingMinor), values.importVatBps);
  const total = base + paymentFee + importVat;
  if ([base, paymentFee, importVat, total].some((value) => value > MAX_SAFE_BIGINT)) {
    return failure('unsafe-money', 'Bid cost calculation is outside the supported integer range.');
  }
  const money = (minor) => ({ currency: hammer.currency, minor: Number(minor) });
  return { ok: true, value: {
    hammer: { ...hammer }, premium: premium.value.premium, premiumVat: money(premiumVat), platformFee: money(platformFee),
    hammerPlusPremium: premium.value.hammerPlusPremium,
    shipping: money(BigInt(values.shippingMinor)), importVat: money(importVat), paymentFee: money(paymentFee), total: money(total),
  }};
}

/**
 * @param {Money} budget
 * @param {*} buyerPremiumBps checked here: an integer from 0 through 10,000
 * @param {AffordableBidOptions} [options]
 * @returns {Result<BidCost>}
 */
export function calculateAffordableBid(budget, buyerPremiumBps, options = {}) {
  const checked = validateMoney(budget); if (!checked.ok) return checked;
  const values = { ...FEE_DEFAULTS, incrementMinor: 1, minimumBidMinor: 0, ...options };
  const fees = feeOptions(values); if (!fees.ok) return fees;
  const minimum = optionInteger(values.minimumBidMinor, 'minimumBidMinor'); if (!minimum.ok) return minimum;
  const increment = optionInteger(values.incrementMinor, 'incrementMinor', { positive: true }); if (!increment.ok) return increment;
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

