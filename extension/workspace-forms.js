// @ts-check
// The workspace's forms and the records they stand for (workspace.js): a coin, its bid and its outcome
// read into form fields and back, a page's draft read into the coin editor and the auction it offers,
// and an auction's reminders read into their two controls and back.
import { FEE_SHEET_FIELDS, buildBidCalculation, feeSheetEstimate, feeSheetTexts, housePresetFor } from './bid-tools.js';
import { calculateBidCost, formatMoney, parseMoney, parsePremiumPercent } from './core/money.js';
import { bidPremiumRate, feeSheetOf } from './core/projections.js';
/**
 * @typedef {import('./core/types.js').Lot} Lot
 * @typedef {import('./core/types.js').Money} Money
 * @typedef {import('./core/types.js').Reminder} Reminder
 * @typedef {import('./core/types.js').SourceLink} SourceLink
 */
/** @typedef {Record<string, string>} FormValues */
/**
 * The two reminder controls of the auction form: on or off, and an offset in minutes or a wall time.
 * @typedef {{ firstEnabled: boolean, firstValue: *, secondEnabled: boolean, secondValue: * }} ReminderControls
 */

/**
 * The lot a details form describes, as lot.save takes it. Throws a RangeError for a weight or diameter
 * out of range, with the sentence the form shows.
 * @param {Lot | null | undefined} existing
 * @param {Record<string, *>} values
 * @param {string | undefined} originalManualUrl
 * @returns {Record<string, *>}
 */
export function buildWorkspaceLotDraft(existing, values, originalManualUrl) {
  /** @type {Record<string, *>} */
  const lot = { ...(existing?.id ? { id: existing.id } : {}), title: String(values.title ?? '').trim(), sourceLinks: mergeLotSourceLinks(existing?.sourceLinks, values.sourceUrl, originalManualUrl) };
  for (const key of ['reference', 'lotNumber', 'auctionEventId']) if (values[key]) lot[key] = String(values[key]).trim();
  lot.notes = String(values.notes ?? '');
  const auctionContext = { pageUrl: String(values.auctionPageUrl ?? '').trim() };
  for (const [field, key] of [['canonicalUrl', 'auctionCanonicalUrl'], ['house', 'auctionHouse'], ['saleId', 'auctionSaleId'], ['lotNumber', 'auctionLotNumber']]) {
    const value = String(values[key] ?? '').trim(); if (value) auctionContext[field] = value;
  }
  if (auctionContext.pageUrl) lot.auctionContext = auctionContext;
  else if (existing?.auctionContext) lot.auctionContext = null;
  const photoUrls = [values.photoUrl1, values.photoUrl2].map((value) => String(value ?? '').trim()).filter(Boolean);
  const coinDetails = { photoUrls };
  const weightText = String(values.weightGrams ?? '').trim(); const weight = Number(weightText); if (weightText && (!Number.isFinite(weight) || weight < 0.001 || weight > 1000)) throw new RangeError('Enter a valid weight from 0.001 to 1000 grams.'); if (weightText) coinDetails.weightMg = Math.round(weight * 1000);
  const diameterText = String(values.diameterMm ?? '').trim(); const diameter = Number(diameterText); if (diameterText && (!Number.isFinite(diameter) || diameter < 0.01 || diameter > 1000)) throw new RangeError('Enter a valid diameter from 0.01 to 1000 millimetres.'); if (diameterText) coinDetails.diameterHundredthsMm = Math.round(diameter * 100);
  if (String(values.condition ?? '').trim()) coinDetails.condition = String(values.condition).trim();
  if (photoUrls.length || coinDetails.weightMg || coinDetails.diameterHundredthsMm || coinDetails.condition) lot.coinDetails = coinDetails;
  else if (existing?.coinDetails) lot.coinDetails = null;
  if (Array.isArray(values.provenanceNotes)) lot.provenanceNotes = structuredClone(values.provenanceNotes);
  if (existing?.costEstimate) lot.costEstimate = structuredClone(existing.costEstimate);
  return lot;
}

// The one reading of a coin into the details form: the populate path and the rebase merge have to
// agree on what a record puts in every field, or the merge cannot tell a collector's edit from it.
// ponytail: provenance rows are a repeating subtree, not a field, so they are populated but never merged.
/**
 * @param {*} lot
 * @returns {FormValues}
 */
export function lotFormValues(lot) {
  const context = lot?.auctionContext ?? {};
  const details = lot?.coinDetails ?? {};
  return {
    id: lot?.id ?? '',
    title: lot?.title ?? '',
    reference: lot?.reference ?? '',
    lotNumber: lot?.lotNumber ?? '',
    notes: lot?.notes ?? '',
    auctionEventId: lot?.auctionEventId ?? '',
    sourceUrl: lot?.sourceLinks?.find((link) => link.source === 'manual')?.url ?? '',
    auctionPageUrl: context.pageUrl ?? '',
    auctionCanonicalUrl: context.canonicalUrl ?? '',
    auctionHouse: context.house ?? '',
    auctionSaleId: context.saleId ?? '',
    auctionLotNumber: context.lotNumber ?? '',
    weightGrams: details.weightMg ? String(details.weightMg / 1000) : '',
    diameterMm: details.diameterHundredthsMm ? String(details.diameterHundredthsMm / 100) : '',
    condition: details.condition ?? '',
    photoUrl1: details.photoUrls?.[0] ?? '',
    photoUrl2: details.photoUrls?.[1] ?? '',
  };
}

// A premium written back into the bid form: a number's own text is ASCII with a point in every
// locale, which is what the parser reads, and basis points over 100 never need more than two places.
/**
 * @param {*} buyerPremiumBps
 * @returns {string}
 */
export function premiumInputText(buyerPremiumBps) {
  return Number.isInteger(buyerPremiumBps) ? String(buyerPremiumBps / 100) : '';
}

/**
 * @param {Lot | null | undefined} lot
 * @param {string} [locale]
 * @param {string} [fallbackCurrency]
 * @returns {{ amount: string, currency: string, premium: string }}
 */
export function bidFormValues(lot, locale = 'en-US', fallbackCurrency = 'USD') {
  // The bid in force binds; a plan is only what the form shows before one is placed. Right after a cancellation the
  // cancelled terms fill the form, for the collector to save again or change; the store keeps no plan for them.
  const last = lot?.bidHistory?.at(-1);
  const terms = lot?.activeBid ?? lot?.plannedBid ?? (last?.action === 'externally-cancelled' && last.amount ? last : undefined);
  return {
    amount: moneyInputText(terms?.amount, locale),
    currency: terms?.amount?.currency ?? fallbackCurrency,
    premium: premiumInputText(terms?.buyerPremiumBps),
  };
}

// The Bid tab is one form (G-09): the maximum hammer and premium, the fee sheet saved with the bid, and a budget
// fold, worked out with the calculator's own arithmetic. These read its fields; the page only draws the answers.

// The fee sheet and the budget grid a coin's bid form opens with: the lot's saved fee sheet when it is in the bid's
// currency, else blank - fees in another currency are never shown as this bid's.
/**
 * @param {Lot | null | undefined} lot
 * @param {string} currency
 * @returns {Record<string, string>}
 */
export function bidFeeFields(lot, currency) {
  const estimate = lot?.costEstimate?.currency === currency ? lot.costEstimate : null;
  return {
    ...feeSheetTexts(feeSheetOf(estimate)),
    increment: estimate && estimate.incrementMinor !== 1 ? moneyInputText({ currency, minor: estimate.incrementMinor }) : '',
    minimum: estimate?.minimumBidMinor ? moneyInputText({ currency, minor: estimate.minimumBidMinor }) : '',
  };
}

// The bid grid the budget fold types: blank is the fixed grid of one minor unit from nothing.
/** @type {(text: *, currency: string, locale: string, fallback: number) => *} */
const gridMinor = (text, currency, locale, fallback) => {
  if (!String(text ?? '').trim()) return { ok: true, value: fallback };
  const parsed = parseMoney(String(text), currency, locale);
  return parsed.ok ? { ok: true, value: parsed.value.minor } : parsed;
};

// The fee sheet a bid is saved with: the one typed; none at all (null) when the collector cleared the lot's own sheet
// in this currency, which takes it off; nothing said (undefined) when there was none to show, so a sheet in another
// currency stays as it was.
/**
 * @param {Lot | null | undefined} lot
 * @param {Record<string, *>} values the bid form's currency, fee sheet, increment and minimum
 * @param {string} [locale]
 * @returns {{ ok: true, value: import('./core/types.js').CostEstimate | null | undefined } | { ok: false, error: { message: string, field: string } }}
 */
export function bidEstimateToSend(lot, values, locale = 'en-US') {
  const currency = String(values.currency);
  const shown = lot?.costEstimate?.currency === currency ? lot.costEstimate : null;
  // The form shows the saved grid, so a blank box is the default grid, not the saved one.
  const increment = gridMinor(values.increment, currency, locale, 1);
  if (!increment.ok) return { ok: false, error: { message: increment.error.message, field: 'increment' } };
  if (increment.value < 1) return { ok: false, error: { message: 'Enter an increment greater than zero.', field: 'increment' } };
  const minimum = gridMinor(values.minimum, currency, locale, 0);
  if (!minimum.ok) return { ok: false, error: { message: minimum.error.message, field: 'minimum' } };
  const fees = feeSheetEstimate(values, { currency, locale, incrementMinor: increment.value, minimumBidMinor: minimum.value });
  if (!fees.ok) return { ok: false, error: { message: fees.error.message, field: fees.error.field } };
  if (fees.value) return { ok: true, value: /** @type {import('./core/types.js').CostEstimate} */ (fees.value) };
  // An increment or minimum with no fee is kept as a grid only: never as fees of nothing (Fix round, Minor 1).
  if (increment.value !== 1 || minimum.value !== 0) {
    return { ok: true, value: { currency, shippingMinor: 0, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: increment.value, minimumBidMinor: minimum.value, gridOnly: true } };
  }
  return { ok: true, value: shown ? null : undefined };
}

// The live line under the maximum and premium: what the bid costs all in, with the calculator's arithmetic. A line
// that cannot be worked out says what it is waiting for, and says nothing while the maximum is empty.
/**
 * @param {Record<string, *>} values
 * @param {string} [locale]
 * @returns {string}
 */
export function bidLiveLine(values, locale = 'en-US') {
  if (!String(values.amount ?? '').trim()) return '';
  const amount = parseMoney(String(values.amount), String(values.currency), locale);
  if (!amount.ok) return amount.error.message;
  if (!String(values.premium ?? '').trim()) return 'Add the buyer’s premium to see what this bid costs all in.';
  const premium = parsePremiumPercent(String(values.premium), locale);
  if (!premium.ok) return premium.error.message;
  const fees = feeSheetEstimate(values, { currency: String(values.currency), locale });
  if (!fees.ok) return fees.error.message;
  const cost = calculateBidCost(amount.value, premium.value, fees.value ?? {});
  if (!cost.ok) return cost.error.message;
  const feeMinor = cost.value.total.minor - cost.value.hammerPlusPremium.minor;
  return [`≈ ${formatMoney(cost.value.total, locale)} all-in`, `premium ${formatMoney(cost.value.premium, locale)}`,
    fees.value ? `fees ${formatMoney({ currency: cost.value.total.currency, minor: feeMinor }, locale)}` : 'no fees recorded'].join(' · ');
}

// The budget fold's answer: the highest hammer whose whole cost fits, on the house's ladder when its preset is chosen
// and in this currency, else on the increment typed here.
/**
 * @param {Record<string, *>} values
 * @param {{ currency: string, tiers: Array<{ from: number, step: number }> } | null} ladder
 * @param {string} [locale]
 * @returns {{ text: string, hammer: import('./core/types.js').Money | null }}
 */
export function bidBudgetAnswer(values, ladder, locale = 'en-US') {
  if (!String(values.budget ?? '').trim()) return { text: 'Type the most you will pay in all, and the highest hammer it allows appears here.', hammer: null };
  if (!String(values.premium ?? '').trim()) return { text: 'Add the buyer’s premium first: the budget has to cover it.', hammer: null };
  const texts = Object.fromEntries(FEE_SHEET_FIELDS.map(({ name }) => [name, String(values[name] ?? '')]));
  const calculated = /** @type {*} */ (buildBidCalculation({
    mode: 'budget', amountText: String(values.budget), premiumText: String(values.premium), currency: String(values.currency), locale, ladder,
    shippingText: texts.shipping, paymentPercentText: texts.paymentPercent, paymentFixedText: texts.paymentFixed,
    premiumVatText: texts.premiumVat, platformFeeText: texts.platformFee, importVatText: texts.importVat,
    incrementText: String(values.increment ?? ''), minimumText: String(values.minimum ?? ''),
  }));
  if (!calculated.ok) return { text: calculated.error.message, hammer: null };
  const text = `Maximum hammer ${formatMoney(calculated.value.hammer, locale)} · ${formatMoney(calculated.value.total, locale)} all-in${calculated.ladderNotice ? `. ${calculated.ladderNotice}` : ''}`;
  return { text, hammer: calculated.value.hammer };
}

// A dirty form rebased from the record it was populated from onto a newer one: every field the
// collector has not touched follows the new record, and every field they did touch is theirs.
/**
 * @param {Record<string, *> | null | undefined} valuesFromOldRecord
 * @param {Record<string, *> | null | undefined} valuesFromNewRecord
 * @param {Record<string, *> | null | undefined} currentValues
 * @returns {Record<string, *>}
 */
export function mergeRebasedFields(valuesFromOldRecord, valuesFromNewRecord, currentValues) {
  const fields = {};
  for (const [field, value] of Object.entries(valuesFromNewRecord ?? {})) {
    const current = currentValues?.[field];
    if (current !== (valuesFromOldRecord ?? {})[field] || current === value) continue;
    fields[field] = value;
  }
  return fields;
}

/**
 * What a current-lot draft offers the coin editor, each field bounded and every address http(s).
 * @param {*} payload
 * @returns {Record<string, *>}
 */
export function lotDraftToEditor(payload) {
  const bounded = (value, maximum) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : '';
  const result = {
    title: bounded(payload?.title, 200),
    reference: bounded(payload?.reference, 120),
    sourceUrl: bounded(payload?.pageUrl, 2048),
  };
  if (payload?.auctionContext?.pageUrl) result.auctionContext = structuredClone(payload.auctionContext);
  // What the page stated about its sale, each for the collector to keep or clear before the coin is saved.
  const photoUrl = bounded(payload?.photoUrl, 2048);
  if (/^https?:\/\//i.test(photoUrl)) result.photoUrl = photoUrl;
  const estimateNote = estimateNoteText(payload?.estimate);
  if (estimateNote) result.estimateNote = estimateNote;
  if (closesAtParts(payload?.closesAt)) result.closesAt = payload.closesAt;
  if (closesAtParts(payload?.startsAt)) result.startsAt = payload.startsAt;
  // The provenance the page lists, offered only where the lot page can stand as each entry's source.
  if ((result.auctionContext?.pageUrl || result.sourceUrl) && Array.isArray(payload?.provenance)) {
    const provenance = payload.provenance.slice(0, 10).map((entry) => ({
      text: bounded(entry?.text, 300), source: bounded(entry?.source, 120),
      year: Number.isInteger(entry?.year) ? entry.year : null, lot: bounded(entry?.lot, 20),
    })).filter((entry) => entry.text);
    if (provenance.length) result.provenance = provenance;
  }
  return result;
}

// The lot has no estimate field of its own, so the page's figure is kept as a line of its notes, in the page's currency and that currency's own
// places, as written: nothing is converted.
/**
 * @param {*} estimate
 * @returns {string}
 */
export function estimateNoteText(estimate) {
  if (!Number.isSafeInteger(estimate?.minor) || estimate.minor <= 0 || typeof estimate.currency !== 'string' || !/^[A-Z]{3}$/.test(estimate.currency)) return '';
  /** @type {number} a currency format always resolves its fraction digits */
  let places;
  try { places = /** @type {number} */ (new Intl.NumberFormat('en', { style: 'currency', currency: estimate.currency }).resolvedOptions().maximumFractionDigits); }
  catch { return ''; }
  const digits = String(estimate.minor).padStart(places + 1, '0');
  const figure = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
  return `Estimate from page: ${estimate.currency} ${figure}`;
}

// A closing as a draft holds it (core/drafts.js validateDraftPayload): a day, or a day and time with the offset the page wrote.
const CLOSES_AT = /^(\d{4})-(\d{2})-(\d{2})(?:T((?:[01]\d|2[0-3]):[0-5]\d)(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)))?$/;
/**
 * @param {*} value
 * @returns {{ localDate: string, timed: boolean } | null}
 */
function closesAtParts(value) {
  const match = typeof value === 'string' ? CLOSES_AT.exec(value) : null;
  if (!match) return null;
  const [, year, month, day, time] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return { localDate: `${year}-${month}-${day}`, timed: Boolean(time) };
}

// The auction a draft offers for its closing - or, where the page gave none, for the start of the sale its auction event names - in the
// collector's own time zone. A time the page gave with its offset is the same instant written in that zone, so no zone is ever guessed for the
// page; a day stays a date-only auction day. The collector names and confirms it on save.
/**
 * @param {{ closesAt?: *, startsAt?: *, pageUrl?: * }} [draft]
 * @param {string} [timeZone]
 * @returns {Record<string, *> | null}
 */
export function offeredEventFromDraft({ closesAt, startsAt, pageUrl } = {}, timeZone) {
  const closing = closesAtParts(closesAt);
  const when = closing ? closesAt : startsAt;
  const parts = closing ?? closesAtParts(startsAt);
  if (!parts) return null;
  const precision = parts.timed ? 'timed' : 'date-only';
  const event = { eventKind: !parts.timed ? 'auction-day' : closing ? 'lot-closes' : 'auction-starts', precision, localDate: parts.localDate, timeZone };
  try { new Intl.DateTimeFormat('en', { timeZone }).format(0); }
  catch { return null; }
  if (parts.timed) {
    const local = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', numberingSystem: 'latn',
    }).formatToParts(new Date(Date.parse(when))).map(({ type, value }) => [type, value]));
    event.localDate = `${local.year}-${local.month}-${local.day}`;
    event.localTime = `${local.hour}:${local.minute}`;
  }
  return {
    ...event, reminderScope: 'linked-lots', reminders: createEventDraft(precision).reminders,
    capturedText: `From the page: ${when}`, ...(typeof pageUrl === 'string' && /^https?:\/\//i.test(pageUrl) ? { capturedFromUrl: pageUrl } : {}),
  };
}

// The house an auction is from: its name cut before the sale's number - a token holding a digit, a Roman numeral, or
// `E-Sale`, `Auction`, `Auktion` or `Sale` followed by one - with case and spacing set aside. `Roma Numismatics E-Sale
// 130` and `Roma Numismatics Auction XXV` are both `roma numismatics`; `Heritage Europe 78` is not `Heritage 3110`'s
// house. Fewer than three characters name no house.
const ROMAN_NUMERAL = /^(?=[mdclxvi])m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i;
const SALE_WORD = /^(?:e-?sale|e-?auction|auction|auktion|sale)$/i;
const bare = (token) => token.replace(/[.,:;]+$/, '');
const saleNumber = (token) => /\d/.test(token) || ROMAN_NUMERAL.test(bare(token));
const houseKey = (name) => {
  const tokens = String(name ?? '').normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  const kept = [];
  for (const [index, token] of tokens.entries()) {
    if (saleNumber(token) || (SALE_WORD.test(bare(token)) && saleNumber(tokens[index + 1] ?? ''))) break;
    kept.push(token);
  }
  const key = kept.join(' ').toLocaleLowerCase('en-US').replace(/[\s,.:;–-]+$/, '');
  return key.length >= 3 ? key : '';
};
// The time zone the collector gave the same house's most recently saved auction, offered for its next one: the saved
// auctions are what remembers it, so nothing new is stored. Only the same house name proposes a zone; any other name,
// however alike, leaves the collector's own zone.
/**
 * @param {Array<{ id?: string, name?: string, timeZone?: string, updatedAt?: string }> | null | undefined} events
 * @param {*} name
 * @param {string | null} [excludeId]
 * @returns {{ timeZone: string, from: string } | null}
 */
export function rememberedZone(events, name, excludeId = null) {
  const key = houseKey(name);
  if (!key) return null;
  const match = (events ?? []).filter((event) => event.id !== excludeId && event.timeZone && houseKey(event.name) === key)
    .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))[0];
  return match ? { timeZone: String(match.timeZone), from: String(match.name) } : null;
}

/**
 * @param {'timed' | 'date-only'} [precision]
 * @returns {{ precision: 'timed' | 'date-only', reminders: Array<Record<string, *>> }}
 */
export function createEventDraft(precision = 'timed') {
  if (precision === 'date-only') return {
    precision,
    reminders: [
      { id: 'previous-day', kind: 'wall-time', daysBefore: 1, localTime: '09:00' },
      { id: 'auction-day', kind: 'wall-time', daysBefore: 0, localTime: '09:00' },
    ],
  };
  return {
    precision: 'timed',
    reminders: [
      { id: '24-hours', kind: 'offset', offsetMinutes: 1440 },
      { id: '1-hour', kind: 'offset', offsetMinutes: 60 },
    ],
  };
}

/**
 * @param {SourceLink[] | null | undefined} existing
 * @param {*} editedManualUrl
 * @param {string | undefined} originalManualUrl
 * @returns {Array<Record<string, *>>}
 */
export function mergeLotSourceLinks(existing, editedManualUrl, originalManualUrl) {
  const retained = [...(existing ?? [])];
  const url = String(editedManualUrl ?? '').trim();
  const index = retained.findIndex((link) => link.source === 'manual' && (originalManualUrl === undefined || link.url === originalManualUrl));
  if (index >= 0 && url) retained[index] = { ...retained[index], url };
  else if (index >= 0) retained.splice(index, 1);
  else if (url) retained.push({ source: 'manual', url });
  return retained;
}

// Written into a field the collector saves again, so in the one form the money parser reads in every
// locale: ASCII digits and a point. The locale is accepted for call-site symmetry only.
/**
 * @param {Money | null | undefined} money
 * @param {string} [locale] accepted for call-site symmetry only
 * @returns {string}
 */
export function moneyInputText(money, locale = 'en-US') {
  if (!money) return '';
  const absolute = BigInt(Math.abs(money.minor));
  return `${money.minor < 0 ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

// The outcome form opens on the action the collector is about to take: an open lot on Won, in the currency of the bid
// in force (else the plan's, else the default), and a settled lot on what was recorded. The placed bid is offered as
// the hammer box's hint only, never as its value, and a won coin's acquisition day is the attached auction's, else
// today. The premium rate a won coin is costed on is its outcome's own, else its bid's, else its plan's, else the rate
// of the collector's preset for the lot's house, and the form says which; the fee sheet is the outcome's, else the one
// saved with the lot, in the hammer's currency, else the house preset's VAT and platform fee beside its rate. The fees
// fold opens by itself when the lot carries no rate or no fee sheet (Q-01).
/**
 * @param {Lot | null | undefined} lot
 * @param {string} [locale]
 * @param {{ defaultCurrency?: string, event?: { localDate?: string } | null, today?: string, presets?: Array<Record<string, *>> }} [context]
 * @returns {Record<string, *>}
 */
export function outcomeDraftForLot(lot, locale = 'en-US', { defaultCurrency = 'USD', event = null, today = '', presets = [] } = {}) {
  const settled = Boolean(lot?.outcome?.status && lot.outcome.status !== 'open');
  const bidCurrency = lot?.activeBid?.amount?.currency ?? lot?.plannedBid?.amount?.currency ?? defaultCurrency;
  const hammerCurrency = lot?.outcome?.hammer?.currency ?? bidCurrency;
  const terms = lot?.outcome?.status === 'won' ? lot.outcome.terms : undefined;
  let rate = null; let premiumSource = ''; let preset = null;
  if (Number.isInteger(terms?.buyerPremiumBps)) { rate = terms?.buyerPremiumBps; premiumSource = 'as recorded with this outcome'; }
  else if (Number.isInteger(recordsPremiumRate(lot))) { rate = recordsPremiumRate(lot); premiumSource = lot?.activeBid ? 'from your bid' : lot?.plannedBid && rate === lot.plannedBid.buyerPremiumBps ? 'from your plan' : 'from your last bid'; }
  else if ((preset = housePresetFor(presets, lot?.auctionContext?.house))) { rate = preset.buyerPremiumBps; premiumSource = `from your ${preset.name} preset`; }
  // "No fees were charged beyond the premium" is the outcome's `costEstimate: null`: ticked, with no sheet shown.
  const noFees = Boolean(terms) && Object.hasOwn(terms, 'costEstimate') && terms?.costEstimate === null;
  const saved = noFees ? null : terms?.costEstimate ?? feeSheetOf(lot?.costEstimate);
  const estimate = saved?.currency === hammerCurrency ? saved : null;
  const fees = estimate || noFees ? feeSheetTexts(estimate) : feeSheetTexts(preset ? { premiumVatBps: preset.premiumVatBps, platformFeeBps: preset.platformFeeBps } : null);
  return {
    status: settled ? String(lot?.outcome?.status) : 'won',
    hammer: moneyInputText(lot?.outcome?.hammer, locale),
    hammerCurrency,
    invoice: moneyInputText(lot?.outcome?.actualInvoice, locale),
    invoiceCurrency: lot?.outcome?.actualInvoice?.currency ?? hammerCurrency,
    bindingActive: '',
    hammerPlaceholder: settled ? '' : lot?.activeBid?.amount ? `Your bid ${moneyInputText(lot.activeBid.amount, locale)}`
      : lot?.plannedBid?.amount ? `Your plan ${moneyInputText(lot.plannedBid.amount, locale)}` : '',
    acquisitionDate: lot?.collectionEntryId ? '' : event?.localDate ?? today,
    // A first win goes into the collection unless the collector says otherwise (Q-09); a coin already in it is never
    // offered a second entry, which the store would refuse.
    addToCollection: !settled && !lot?.collectionEntryId,
    premium: premiumInputText(rate),
    premiumSource,
    fees,
    feesOpen: rate === null || (!estimate && !noFees),
    noFees,
  };
}

// The rate the store would cost a won coin on from its bids alone: the bid in force, else the last settled one or the
// plan.
const recordsPremiumRate = (lot) => (Number.isInteger(lot?.activeBid?.buyerPremiumBps) ? lot?.activeBid?.buyerPremiumBps : bidPremiumRate(lot));
const sameFeeSheet = (left, right) => Boolean(left && right) && ['currency', 'incrementMinor', 'minimumBidMinor', ...FEE_SHEET_FIELDS.map(({ key }) => key)]
  .every((key) => (left[key] ?? null) === (right[key] ?? null));

// The terms a Won outcome is saved with (Q-01): only what the coin's own records do not already say - a rate other than
// its bid's, a fee sheet other than the lot's - so a coin won on its bid's terms keeps no copy of them. Terms the
// outcome kept that the form no longer states are taken off (`null`); nothing to state and nothing kept is `undefined`.
/**
 * @param {Lot | null | undefined} lot
 * @param {Record<string, *>} values the form's premium, fee sheet and hammer currency
 * @param {string} [locale]
 * @returns {{ ok: true, value: Record<string, *> | null | undefined } | { ok: false, error: { message: string, field: string } }}
 */
export function outcomeTermsFromForm(lot, values, locale = 'en-US') {
  const premiumText = String(values.premium ?? '').trim();
  let rate = null;
  if (premiumText) {
    const parsed = parsePremiumPercent(premiumText, locale);
    if (!parsed.ok) return { ok: false, error: { message: parsed.error.message, field: 'premium' } };
    rate = parsed.value;
  }
  const fees = feeSheetEstimate(values, {
    currency: values.hammerCurrency, locale, incrementMinor: lot?.costEstimate?.incrementMinor ?? 1, minimumBidMinor: lot?.costEstimate?.minimumBidMinor ?? 0,
  });
  if (!fees.ok) return { ok: false, error: { message: fees.error.message, field: fees.error.field } };
  /** @type {Record<string, *>} */
  const terms = {};
  if (rate !== null && rate !== recordsPremiumRate(lot)) terms.buyerPremiumBps = rate;
  // Ticked, there were no fees beyond the premium, whatever the fields hold; blank, the sheet saved with the bid applies;
  // typed, the typed sheet overrides it.
  if (values.noFees) terms.costEstimate = null;
  else if (fees.value && !sameFeeSheet(fees.value, feeSheetOf(lot?.costEstimate))) terms.costEstimate = fees.value;
  if (Object.keys(terms).length) return { ok: true, value: terms };
  return { ok: true, value: lot?.outcome?.terms ? null : undefined };
}

/**
 * @param {Array<Record<string, *>> | null | undefined} existing
 * @param {'timed' | 'date-only'} precision
 * @param {ReminderControls} controls
 * @returns {Array<Record<string, *>>}
 */
export function mergeEventReminders(existing, precision, controls) {
  const kind = precision === 'date-only' ? 'wall-time' : 'offset';
  const sameKind = (existing ?? []).filter((item) => item.kind === kind);
  if (kind === 'offset') {
    const first = sameKind[0]; const second = sameKind[1];
    return [
      ...(controls.firstEnabled ? [{ ...(first?.id ? { id: first.id } : { id: 'hours-before' }), kind, offsetMinutes: controls.firstValue }] : []),
      ...(controls.secondEnabled ? [{ ...(second?.id ? { id: second.id } : { id: 'minutes-before' }), kind, offsetMinutes: controls.secondValue }] : []),
      ...sameKind.slice(2),
    ];
  }
  const previous = sameKind.find((item) => item.daysBefore === 1);
  const sameDay = sameKind.find((item) => item.daysBefore === 0);
  const represented = new Set([previous, sameDay].filter(Boolean));
  return [
    ...(controls.firstEnabled ? [{ ...(previous?.id ? { id: previous.id } : { id: 'previous-day' }), kind, daysBefore: 1, localTime: controls.firstValue }] : []),
    ...(controls.secondEnabled ? [{ ...(sameDay?.id ? { id: sameDay.id } : { id: 'auction-day' }), kind, daysBefore: 0, localTime: controls.secondValue }] : []),
    ...sameKind.filter((item) => !represented.has(item)),
  ];
}

/**
 * @param {Array<Record<string, *>> | null | undefined} reminders
 * @param {'timed' | 'date-only'} precision
 * @returns {ReminderControls}
 */
export function reminderControlsForPrecision(reminders, precision) {
  if (precision === 'date-only') {
    const previous = (reminders ?? []).find((item) => item.kind === 'wall-time' && item.daysBefore === 1);
    const sameDay = (reminders ?? []).find((item) => item.kind === 'wall-time' && item.daysBefore === 0);
    return { firstEnabled: Boolean(previous), firstValue: previous?.localTime ?? '09:00', secondEnabled: Boolean(sameDay), secondValue: sameDay?.localTime ?? '09:00' };
  }
  const [first, second] = (reminders ?? []).filter((item) => item.kind === 'offset');
  return { firstEnabled: Boolean(first), firstValue: first?.offsetMinutes ?? 1440, secondEnabled: Boolean(second), secondValue: second?.offsetMinutes ?? 60 };
}

// Where a record path the store refuses (`lots[0].coinDetails.photoUrls[0]`) lives in the details form, so the page can
// open its section and name it. Null for a part of the record the form holds elsewhere or not at all.
/** @type {Array<[RegExp, (match: RegExpExecArray) => string]>} */
const LOT_FIELD_PATHS = [
  [/\.coinDetails\.photoUrls\[(\d)\]$/, (match) => `photoUrl${Number(match[1]) + 1}`],
  [/\.coinDetails\.weightMg$/, () => 'weightGrams'], [/\.coinDetails\.diameterHundredthsMm$/, () => 'diameterMm'], [/\.coinDetails\.condition$/, () => 'condition'],
  [/\.auctionContext\.pageUrl$/, () => 'auctionPageUrl'], [/\.auctionContext\.canonicalUrl$/, () => 'auctionCanonicalUrl'], [/\.auctionContext\.house$/, () => 'auctionHouse'],
  [/\.auctionContext\.saleId$/, () => 'auctionSaleId'], [/\.auctionContext\.lotNumber$/, () => 'auctionLotNumber'],
  [/\.sourceLinks\[\d+\](?:\.url)?$/, () => 'sourceUrl'], [/^[^.]*\.(title|reference|lotNumber|notes)$/, (match) => match[1]],
];
/**
 * @param {*} path
 * @returns {string | null}
 */
export function lotFieldForPath(path) {
  for (const [pattern, field] of LOT_FIELD_PATHS) {
    const match = pattern.exec(String(path ?? ''));
    if (match) return field(match);
  }
  return null;
}
