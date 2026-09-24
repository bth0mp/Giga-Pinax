import { parseReference } from './lookup.js';

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
  // ponytail: an offer's price and priceCurrency and a product's image are read past, not kept - the current-lot draft payload holds target, title,
  // reference, pageUrl and auctionContext (validateDraftPayload in core/records.js) and has no photo link or estimate field to carry them into.
  // Two addresses for one page: a hash route ("#/lot/43") addresses the lot itself, so only a cosmetic anchor such as
  // #photo is dropped - the rule core/lot-context.js reads a lot's address by, repeated here because this function is
  // injected into the page and can import nothing. A trailing slash is the same directory either way.
  const sameUrl = (left, right) => {
    const settled = (value) => { try { const url = new URL(value); if (!/^#[/!]/.test(url.hash)) url.hash = ''; return url.href.replace(/\/$/, ''); } catch { return ''; } };
    const address = settled(left);
    return Boolean(address) && address === settled(right);
  };
  const products = [];
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
      if (!types.includes('Product')) continue;
      const texts = [];
      for (const field of ['name', 'description']) {
        const text = limit(typeof entry[field] === 'string' ? entry[field] : '', 500);
        if (text) texts.push(text);
      }
      // An offer describes a sale, not a coin, so it says nothing about the lot; but the canonical Product markup puts the page's address on the offer
      // and none on the product, so its addresses are the product's for naming the page it is shown on.
      const offered = [].concat(entry.offers ?? []).slice(0, 10).map((offer) => webUrl(offer?.url));
      if (texts.length) products.push({ texts, urls: [webUrl(entry.url), ...offered].filter(Boolean) });
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
  return {
    pageTitle,
    pageUrl,
    ...(canonicalUrl ? { canonicalUrl } : {}),
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
