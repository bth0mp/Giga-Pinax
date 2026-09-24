import { parseReference } from './lookup.js';
import { readProvenance } from './lot.js';
import { ambiguousGrouping } from './core/money.js';

// Injected into the auction page by scripting.executeScript, so it stands alone: every helper it uses is defined inside it, and everything it reads is
// the page's own text, which the page controls. ponytail: no per-auction-house selector table - none of the houses' markup is verified here, so the
// same structured data, metadata and visible text are read on every page.
export function collectCurrentLotCandidates(root = globalThis.document, pageLocation = globalThis.location) {
  const limit = (value, maximum) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : '';
  // Only a page a browser can open again: the page writes its own canonical link and structured data, and "javascript:" there would be stored as the
  // lot's address and one day followed.
  const webUrl = (value) => {
    const text = limit(value, 2048);
    try { return ['http:', 'https:'].includes(new URL(text).protocol) ? text : ''; }
    catch { return ''; }
  };
  // checkVisibility answers for the ancestors too, so a lot inside a collapsed tab is not read as if it were on show; where it is missing the own-element
  // checks stand in, as they did before. Content the page has not laid out yet ("content-visibility: auto", below the fold) is not asked about: it is
  // the lot being shown, only further down.
  const visible = (element) => {
    if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    if (typeof element.checkVisibility === 'function') return element.checkVisibility({ visibilityProperty: true });
    const view = root?.defaultView ?? globalThis;
    if (typeof view.getComputedStyle === 'function') {
      const style = view.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const pageTitle = limit(root?.title ?? '', 200);
  const pageUrl = webUrl(pageLocation?.href || '');
  const canonicalLink = webUrl(root?.querySelector?.('link[rel="canonical"]')?.href ?? '');
  // The lot as the page describes it to search engines, read before its text: JSON-LD is the page's own JSON, so a script too long to be a lot's data is
  // left unread, each one is parsed inside a try, only string fields are taken, and each is cut to the same length as any other captured text. A type is
  // written as a bare name, as a schema.org address, or as a list of either.
  // What the page states about the sale is read as the page wrote it and shaped later, outside this function (pageEstimate, pageClosesAt): the first
  // offer's price and currency (an estimate or a starting price), when an offer ends, and the product's first photo that is a web address.
  // Two addresses for one page: a hash route ("#/lot/43") addresses the lot itself, so only a cosmetic anchor such as
  // #photo is dropped - the rule core/lot-context.js reads a lot's address by, repeated here because this function is
  // injected into the page and can import nothing. A trailing slash is the same directory either way.
  const sameUrl = (left, right) => {
    const settled = (value) => { try { const url = new URL(value); if (!/^#[/!]/.test(url.hash)) url.hash = ''; return url.href.replace(/\/$/, ''); } catch { return ''; } };
    const address = settled(left);
    return Boolean(address) && address === settled(right);
  };
  const products = [];
  const eventStarts = [];
  for (const script of [...(root?.querySelectorAll?.('script[type="application/ld+json"]') ?? [])].slice(0, 10)) {
    const source = typeof script?.textContent === 'string' ? script.textContent : '';
    if (!source || source.length > 200000) continue;
    let parsed;
    try { parsed = JSON.parse(source); }
    catch { continue; }
    const queue = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, 50);
    for (let seen = 0; queue.length && seen < 50; seen += 1) {
      const entry = queue.shift();
      if (!entry || typeof entry !== 'object') continue;
      // The graph is the page's own and as long as it cares to make it: only what the node budget still has room for is taken up.
      if (Array.isArray(entry['@graph'])) queue.push(...entry['@graph'].slice(0, Math.max(0, 49 - seen - queue.length)));
      const types = [].concat(entry['@type'] ?? []).map((type) => typeof type === 'string' ? type.replace(/^https?:\/\/schema\.org\//, '') : '');
      // An auction the page describes as an event: its start stands for the sale's date only where the page describes exactly one.
      if (types.includes('Event') || types.includes('SaleEvent')) eventStarts.push(limit(entry.startDate, 60));
      if (!types.includes('Product')) continue;
      const texts = [];
      for (const field of ['name', 'description']) {
        const text = limit(typeof entry[field] === 'string' ? entry[field] : '', 500);
        if (text) texts.push(text);
      }
      // An offer describes a sale, not a coin, so it says nothing about the lot; but the canonical Product markup puts the page's address on the offer
      // and none on the product, so its addresses are the product's for naming the page it is shown on.
      const offers = [].concat(entry.offers ?? []).slice(0, 10).filter((offer) => offer && typeof offer === 'object');
      const offered = offers.map((offer) => webUrl(offer.url));
      const priced = offers.find((offer) => (typeof offer.price === 'string' || typeof offer.price === 'number') && typeof offer.priceCurrency === 'string');
      const closing = offers.map((offer) => [offer.availabilityEnds, offer.validThrough].map((value) => limit(value, 60))
        .find((value) => /^\d{4}-\d{2}-\d{2}/.test(value))).find(Boolean) ?? '';
      const photo = [].concat(entry.image ?? []).slice(0, 10)
        .map((image) => webUrl(typeof image === 'string' ? image : image?.contentUrl ?? image?.url)).find(Boolean) ?? '';
      if (texts.length) {
        products.push({
          texts, urls: [webUrl(entry.url), ...offered].filter(Boolean), closing, photo,
          ...(priced ? { price: limit(String(priced.price), 40), currency: limit(priced.priceCurrency, 10) } : {}),
        });
      }
    }
  }
  // A page may describe several products (the lot, then "similar lots"): the one naming this page is the lot being shown, and with none, the first.
  const shownLot = products.find(({ urls }) => urls.some((url) => sameUrl(url, pageUrl) || sameUrl(url, canonicalLink))) ?? products[0];
  const structured = shownLot?.texts ?? [];
  const metaContent = (property) => limit(root?.querySelector?.(`meta[property="${property}"]`)?.content ?? '', 500);
  const openGraph = ['og:title', 'og:description'].map(metaContent).filter(Boolean);
  const canonicalUrl = canonicalLink || shownLot?.urls[0] || webUrl(metaContent('og:url'));
  // Visibility decides before the cap: 120 nodes of a hidden template would otherwise stand in for the lot on show.
  const nodes = [...(root?.querySelectorAll?.('h1,h2,h3,dt,dd,th,td,label,[itemprop],.lot-title,.description') ?? [])]
    .filter(visible)
    .slice(0, 120);
  const visibleLines = nodes.map((element) => limit(element.textContent ?? '', 500)).filter(Boolean);
  const selection = limit(root?.getSelection?.().toString?.() ?? globalThis.getSelection?.().toString?.() ?? '', 500);
  const lines = [...(selection ? [{ text: selection, provenance: 'selection' }] : []),
    ...structured.map((text) => ({ text, provenance: 'structured-data' })),
    ...openGraph.map((text) => ({ text, provenance: 'open-graph' })),
    ...visibleLines.map((text) => ({ text, provenance: 'visible-text' })),
    ...(pageTitle ? [{ text: pageTitle, provenance: 'title' }] : [])];
  const candidates = {};
  const patterns = {
    ruler: /^(?:ruler|emperor|king|issuer)\s*[:\-]\s*(.{2,120})$/i,
    denomination: /^(?:denomination|coin)\s*[:\-]\s*(.{2,120})$/i,
    mint: /^(?:mint|minted at)\s*[:\-]\s*(.{2,120})$/i,
    reference: /^(?:reference|references|catalog(?:ue)?)\s*[:\-]\s*(.{2,120})$/i,
  };
  for (const [field, pattern] of Object.entries(patterns)) {
    for (const line of lines) {
      const match = pattern.exec(line.text);
      if (match) {
        candidates[field] = { value: limit(match[1], 120), provenance: line.provenance };
        break;
      }
    }
  }
  if (!candidates.denomination) {
    for (const line of lines) {
      const match = /\b(AV|AR|AE)?\s*(aureus|solidus|denarius|antoninianus|sestertius|tetradrachm|drachm|didrachm|stater|follis)\b/i.exec(line.text);
      if (match) {
        candidates.denomination = { value: limit(match[0], 120), provenance: line.provenance };
        break;
      }
    }
  }
  if (!candidates.reference) {
    // A volume may carry its edition as a superscript (RIC I² 306, RIC II.1² 12). SC is Seleucid Coins only with a number behind it: "SC" alone is the
    // senate's mark in a Roman coin's field.
    for (const line of lines) {
      const match = /\b(?:(?:RIC|RPC)\s+(?:[IVX]+(?:\.\d+)?²?\s+)?[A-Za-z0-9()./\-]+|(?:Price|Crawford|Sear|BMC)\s+[A-Za-z0-9()./\-]+|SC\s+\d[A-Za-z0-9()./\-]*)\b/i.exec(line.text);
      if (match) {
        candidates.reference = { value: limit(match[0], 120), provenance: line.provenance };
        break;
      }
    }
  }
  const closesAt = shownLot?.closing || (eventStarts.length === 1 ? eventStarts[0] : '');
  // The lines that may carry the lot's provenance, each kept whole and once, so a sentence never runs on into the next line's text.
  const provenanceText = [...new Set([...structured, ...visibleLines].filter((text) => /\b(?:Ex|From|Provenance)\b/.test(text)))].join('\n').slice(0, 3000);
  return {
    pageTitle,
    pageUrl,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(shownLot?.price ? { offerPrice: shownLot.price, offerCurrency: shownLot.currency } : {}),
    ...(closesAt ? { closesAt } : {}),
    ...(shownLot?.photo ? { photoUrl: shownLot.photo } : {}),
    ...(provenanceText ? { provenanceText } : {}),
    rawText: limit(visibleLines.join('\n'), 3000),
    candidates,
    capturedSelection: selection || undefined,
  };
}

const bounded = (value, maximum) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : '';

// A capture is the page's own account of itself, and a context stored before this check may hold anything the page wrote: only an address a browser can
// open again is kept, so a draft never carries one that would be followed later.
const webAddress = (value) => {
  const text = bounded(value, 2048);
  try { return ['http:', 'https:'].includes(new URL(text).protocol) ? text : ''; }
  catch { return ''; }
};

// An estimate as the page's offer states it: the figure in that currency's own minor units, with the currency's three-letter code. A figure
// written with separators, a sign or more places than the currency has is not read, so nothing is rounded, and nothing is ever converted.
export function pageEstimate(price, currency) {
  const code = typeof currency === 'string' ? currency.trim() : '';
  const text = typeof price === 'number' ? String(price) : typeof price === 'string' ? price.trim() : '';
  const figure = /^(\d{1,15})(?:\.(\d{1,6}))?$/.exec(text);
  if (!/^[A-Z]{3}$/.test(code) || !figure) return null;
  let places;
  try { places = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits; }
  catch { return null; }
  const fraction = figure[2] ?? '';
  // "1.200" may be a grouped twelve hundred as well as a decimal: refused as the collector's own typed amounts are (core/money.js), unless the
  // currency's own three places make it a figure.
  if (places < 3 && ambiguousGrouping(figure[1], fraction)) return null;
  if (/[^0]/.test(fraction.slice(places))) return null;
  const minor = Number(`${figure[1]}${fraction.slice(0, places).padEnd(places, '0')}`);
  return Number.isSafeInteger(minor) && minor > 0 ? { minor, currency: code } : null;
}

// When the sale closes, as the page wrote it: a day stays a day, and a time is kept only with the offset written beside it, to the minute. A time
// with no offset names no zone, so only its day is kept; a time with seconds a minute cannot hold keeps its day rather than being rounded.
export function pageClosesAt(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (!match) return '';
  const [, year, month, day, hour, minute, second = '00', fraction = '', zone] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return '';
  const dayOnly = `${year}-${month}-${day}`;
  if (hour === undefined) return dayOnly;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return '';
  if (zone && zone !== 'Z') {
    const [, sign, offsetHours, offsetMinutes] = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
    if (Number(offsetHours) > 14 || Number(offsetMinutes) > 59) return '';
    if (!(second === '00' && /^0*$/.test(fraction))) return dayOnly;
    return `${dayOnly}T${hour}:${minute}${sign}${offsetHours}:${offsetMinutes}`;
  }
  if (!zone || second !== '00' || !/^0*$/.test(fraction)) return dayOnly;
  return `${dayOnly}T${hour}:${minute}Z`;
}

// Provenance entries as a draft holds them: each once, and all of them well inside the draft's storage bound.
function provenanceEntries(entries) {
  const kept = [];
  const seen = new Set();
  let length = 0;
  for (const entry of Array.isArray(entries) ? entries.slice(0, 10) : []) {
    const text = bounded(entry?.text, 300);
    if (!text || seen.has(text.toLocaleLowerCase('en-US')) || length + text.length > 2000) continue;
    seen.add(text.toLocaleLowerCase('en-US'));
    length += text.length;
    const item = { text };
    const source = bounded(entry.source, 120);
    if (source) item.source = source;
    if (Number.isInteger(entry.year) && entry.year >= 1000 && entry.year <= 2999) item.year = entry.year;
    const lot = bounded(entry.lot, 20);
    if (lot) item.lot = lot;
    kept.push(item);
  }
  return kept;
}

// The page values a draft may hold, taken again from whatever hands them over, so a watchlist draft carries them only in the shapes the store keeps.
export function draftPageValues(input) {
  const values = {};
  const estimate = input?.estimate;
  if (Number.isSafeInteger(estimate?.minor) && estimate.minor > 0 && typeof estimate.currency === 'string' && /^[A-Z]{3}$/.test(estimate.currency)) {
    values.estimate = { minor: estimate.minor, currency: estimate.currency };
  }
  const closesAt = pageClosesAt(input?.closesAt);
  if (closesAt) values.closesAt = closesAt;
  const photoUrl = webAddress(input?.photoUrl);
  if (photoUrl) values.photoUrl = photoUrl;
  const provenance = provenanceEntries(input?.provenance);
  if (provenance.length) values.provenance = provenance;
  return values;
}

// Where a captured field came from, kept as the capture labelled it; anything else was not written by collectCurrentLotCandidates and counts as typed.
const PROVENANCE = Object.freeze(['selection', 'structured-data', 'open-graph', 'visible-text', 'title', 'manual']);

export function buildResearchDraft(capture, context = {}) {
  const now = context.now ?? new Date().toISOString();
  const newId = context.newId ?? (() => globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`);
  const draft = { id: newId(), dataClass: 'collector', purpose: 'launcher-input' };
  for (const field of ['ruler', 'denomination', 'mint', 'reference']) {
    const candidate = capture?.candidates?.[field];
    const value = bounded(candidate?.value, 120);
    if (value) draft[field] = { value, provenance: PROVENANCE.includes(candidate?.provenance) ? candidate.provenance : 'manual' };
  }
  const rawText = bounded(capture?.rawText, 3000);
  const pageTitle = bounded(capture?.pageTitle, 200);
  const pageUrl = webAddress(capture?.pageUrl);
  if (rawText) draft.rawText = rawText;
  if (pageTitle) draft.pageTitle = pageTitle;
  if (pageUrl) draft.pageUrl = pageUrl;
  if (pageUrl) {
    const auctionContext = { pageUrl };
    const canonicalUrl = webAddress(capture?.canonicalUrl);
    if (canonicalUrl) auctionContext.canonicalUrl = canonicalUrl;
    for (const field of ['house', 'saleId', 'lotNumber']) {
      const value = bounded(capture?.auctionContext?.[field], 120);
      if (value) auctionContext[field] = value;
    }
    draft.auctionContext = auctionContext;
    // What the page states about its sale, for the collector to confirm or clear in the workspace; only from a page that was read.
    const estimate = pageEstimate(capture?.offerPrice, capture?.offerCurrency);
    const closesAt = pageClosesAt(capture?.closesAt);
    const photoUrl = webAddress(capture?.photoUrl);
    if (estimate) draft.estimate = estimate;
    if (closesAt) draft.closesAt = closesAt;
    if (photoUrl) draft.photoUrl = photoUrl;
    const provenance = provenanceEntries(readProvenance(typeof capture?.provenanceText === 'string' ? capture.provenanceText.slice(0, 3000) : ''));
    if (provenance.length) draft.provenance = provenance;
  }
  draft.capturedAt = now;
  return draft;
}

// The Reference box reads one catalogue reference, so a captured description is no query: "Nero AR denarius Rome RIC 306" reads as nothing and would
// look up nothing. The captured reference answers when it reads on its own, else its ruler with it ("Nero 306"); with neither, there is nothing to
// research and Research coin stays disabled rather than sending an error back.
export function buildResearchQuery(draft) {
  const reference = bounded(draft?.reference?.value, 120);
  const ruler = bounded(draft?.ruler?.value, 120);
  for (const candidate of [reference, ruler && reference ? `${ruler} ${reference}` : '']) {
    if (candidate && parseReference(candidate)) return candidate;
  }
  return '';
}
