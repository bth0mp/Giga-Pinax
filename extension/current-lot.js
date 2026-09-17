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
  // checks stand in, as they did before.
  const visible = (element) => {
    if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    if (typeof element.checkVisibility === 'function') return element.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
    const view = root?.defaultView ?? globalThis;
    if (typeof view.getComputedStyle === 'function') {
      const style = view.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const pageTitle = limit(root?.title ?? '', 200);
  const pageUrl = webUrl(pageLocation?.href || '');
  // The lot as the page describes it to search engines, read before its text: JSON-LD is the page's own JSON, so it is parsed inside a try, only string
  // fields are taken, and each is cut to the same length as any other captured text. ponytail: an offer's price and image are read past, not kept - no
  // captured field holds them, and an asking price is no hammer price to weigh a median against.
  const structured = [];
  let structuredUrl = '';
  for (const script of [...(root?.querySelectorAll?.('script[type="application/ld+json"]') ?? [])].slice(0, 10)) {
    let parsed;
    try { parsed = JSON.parse(script?.textContent ?? ''); }
    catch { continue; }
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    for (let seen = 0; queue.length && seen < 50; seen += 1) {
      const entry = queue.shift();
      if (!entry || typeof entry !== 'object') continue;
      if (Array.isArray(entry['@graph'])) queue.push(...entry['@graph']);
      if (entry.offers) queue.push(...[].concat(entry.offers));
      if (![].concat(entry['@type'] ?? []).some((type) => type === 'Product' || type === 'Offer')) continue;
      for (const field of ['name', 'description']) {
        const text = limit(typeof entry[field] === 'string' ? entry[field] : '', 500);
        if (text) structured.push(text);
      }
      if (!structuredUrl) structuredUrl = webUrl(entry.url);
    }
  }
  const metaContent = (property) => limit(root?.querySelector?.(`meta[property="${property}"]`)?.content ?? '', 500);
  const openGraph = ['og:title', 'og:description'].map(metaContent).filter(Boolean);
  const canonicalUrl = webUrl(root?.querySelector?.('link[rel="canonical"]')?.href ?? '') || structuredUrl || webUrl(metaContent('og:url'));
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
    for (const line of lines) {
      const match = /\b(?:(?:RIC|RPC)\s+(?:[IVX]+(?:\.\d+)?\s+)?[A-Za-z0-9()./\-]+|(?:Price|Crawford|Sear|BMC)\s+[A-Za-z0-9()./\-]+)\b/i.exec(line.text);
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

export function buildResearchQuery(draft) {
  return ['ruler', 'denomination', 'mint', 'reference']
    .map((field) => bounded(draft?.[field]?.value, 120))
    .filter(Boolean)
    .join(' ')
    .slice(0, 400);
}
