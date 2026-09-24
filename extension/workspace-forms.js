// @ts-check
// The workspace's forms and the records they stand for (workspace.js): a coin, its bid and its outcome
// read into form fields and back, a page's draft read into the coin editor and the auction it offers,
// and an auction's reminders read into their two controls and back.
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
  const terms = lot?.plannedBid ?? lot?.activeBid;
  return {
    amount: moneyInputText(terms?.amount, locale),
    currency: terms?.amount?.currency ?? fallbackCurrency,
    premium: premiumInputText(terms?.buyerPremiumBps),
  };
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

/**
 * @param {Lot | null | undefined} lot
 * @param {string} [locale]
 * @returns {Record<string, string>}
 */
export function outcomeDraftForLot(lot, locale = 'en-US') {
  return {
    status: lot?.outcome?.status ?? 'won',
    hammer: moneyInputText(lot?.outcome?.hammer, locale),
    hammerCurrency: lot?.outcome?.hammer?.currency ?? 'USD',
    invoice: moneyInputText(lot?.outcome?.actualInvoice, locale),
    invoiceCurrency: lot?.outcome?.actualInvoice?.currency ?? 'USD',
    bindingActive: '',
  };
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
