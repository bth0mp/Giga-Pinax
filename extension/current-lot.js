export function collectCurrentLotCandidates(root = globalThis.document, pageLocation = globalThis.location) {
  const limit = (value, maximum) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : '';
  const visible = (element) => {
    if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    const view = root?.defaultView ?? globalThis;
    if (typeof view.getComputedStyle === 'function') {
      const style = view.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const pageTitle = limit(root?.title ?? '', 200);
  const canonicalUrl = limit(root?.querySelector?.('link[rel="canonical"]')?.href ?? '', 2048);
  const pageUrl = limit(pageLocation?.href || '', 2048);
  const nodes = [...(root?.querySelectorAll?.('h1,h2,h3,dt,dd,th,td,label,[itemprop],.lot-title,.description') ?? [])]
    .slice(0, 120)
    .filter(visible);
  const visibleLines = nodes.map((element) => limit(element.textContent ?? '', 500)).filter(Boolean);
  const selection = limit(root?.getSelection?.().toString?.() ?? globalThis.getSelection?.().toString?.() ?? '', 500);
  const lines = [...(selection ? [{ text: selection, provenance: 'selection' }] : []),
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
  const combined = lines.map((line) => line.text).join(' ');
  if (!candidates.denomination) {
    const match = /\b(AV|AR|AE)?\s*(aureus|solidus|denarius|antoninianus|sestertius|tetradrachm|drachm|didrachm|stater|follis)\b/i.exec(combined);
    if (match) candidates.denomination = { value: limit(match[0], 120), provenance: selection && selection.includes(match[0]) ? 'selection' : 'visible-text' };
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

export function buildResearchDraft(capture, context = {}) {
  const now = context.now ?? new Date().toISOString();
  const newId = context.newId ?? (() => globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`);
  const draft = { id: newId(), dataClass: 'collector', purpose: 'launcher-input' };
  for (const field of ['ruler', 'denomination', 'mint', 'reference']) {
    const candidate = capture?.candidates?.[field];
    const value = bounded(candidate?.value, 120);
    if (value) draft[field] = { value, provenance: ['selection', 'visible-text', 'title', 'manual'].includes(candidate?.provenance) ? candidate.provenance : 'manual' };
  }
  const rawText = bounded(capture?.rawText, 3000);
  const pageTitle = bounded(capture?.pageTitle, 200);
  const pageUrl = bounded(capture?.pageUrl, 2048);
  if (rawText) draft.rawText = rawText;
  if (pageTitle) draft.pageTitle = pageTitle;
  if (pageUrl) draft.pageUrl = pageUrl;
  if (pageUrl) {
    const auctionContext = { pageUrl };
    const canonicalUrl = bounded(capture?.canonicalUrl, 2048);
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
