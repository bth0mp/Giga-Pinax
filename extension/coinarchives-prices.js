import { coinArchivesUrl, summarise } from './prices.js';

export const COINARCHIVES_PUBLIC_MAX_BYTES = 512 * 1024;
export const COINARCHIVES_PUBLIC_RESULT_CAP = 100;
const ORIGIN = 'https://www.coinarchives.com';
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const emptyExcluded = () => ({ upcoming: 0, toBePosted: 0, unpriced: 0, malformedPrice: 0, malformedDate: 0, futureDate: 0, duplicateId: 0, conflictingId: 0 });
const text = (html) => String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
const normalizedQuery = (value) => text(value).toLocaleLowerCase('en-US');
const nativeSummary = (lots, currency) => {
  const summary = summarise(lots.map((lot) => ({ ...lot, price: String(lot.amount) })), currency);
  summary.priced = lots;
  return summary;
};

function isoDate(value) {
  const match = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), MONTHS[match[2]], Number(match[1])));
  if (date.getUTCDate() !== Number(match[1]) || date.getUTCMonth() !== MONTHS[match[2]]) return null;
  return date.toISOString().slice(0, 10);
}

function baseResult({ term, section, currency, url }) {
  return { source: 'coinarchives-public', term, section, url: url || coinArchivesUrl(term, section), matchedCount: 0, renderedCount: 0, cap: COINARCHIVES_PUBLIC_RESULT_CAP, capped: false, lots: [], selectedLots: [], summary: summarise([], currency), availableCurrencyCounts: {}, excluded: emptyExcluded(), dateSpan: null };
}

export function parseCoinArchivesPublic(html, { term, section = 'a', currency, now = new Date(), url } = {}) {
  const result = baseResult({ term, section, currency, url });
  if (!['a', 'w'].includes(section) || !String(term || '').trim() || !/^[A-Z]{3}$/.test(currency || '')) return { ...result, status: 'layout', reason: 'input' };
  if (/closest\s+matches/i.test(html)) return { ...result, status: 'closest' };
  const header = /<(?:span|div)\b[^>]*class=["'][^"']*\bheadertext\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i.exec(html)?.[1];
  const countMatch = header && /^\s*Your search for\s*<b>\s*'?([\s\S]*?)<\/b>\s*'?\s*matched\s+(\d+)\s+lots?\s+from auctions added in the last six months\./i.exec(header);
  if (!countMatch) return { ...result, status: /(?:matched\s+0\s+lots?|no\s+(?:matching\s+)?lots)/i.test(header || '') ? 'empty' : 'layout' };
  if (normalizedQuery(countMatch[1]) !== normalizedQuery(term)) return { ...result, status: 'closest' };
  result.matchedCount = Number(countMatch[2]);
  result.capped = result.matchedCount > result.cap;
  const rows = [...String(html).matchAll(/<tr\s+id=["'](\d+)["'][^>]*>([\s\S]*?)<\/tr>/gi)];
  result.renderedCount = rows.length;
  if (result.matchedCount === 0) return { ...result, status: 'empty' };
  if (rows.length !== Math.min(result.matchedCount, result.cap)) return { ...result, status: 'layout', reason: 'count' };

  const candidates = [];
  for (const [, id, body] of rows) {
    const link = /<a\b[^>]*class=["']R["'][^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<div\b[^>]*class=["']auctiontitle["'][^>]*>([\s\S]*?)<\/div>/i.exec(body);
    const dateCell = /<nobr>([\s\S]*?)<\/nobr>/i.exec(body);
    const priceCell = /<td\b[^>]*class=["']price["'][^>]*>([\s\S]*?)<\/td>/i.exec(body);
    if (!link || !dateCell || !priceCell) return { ...result, status: 'layout', reason: 'row' };
    const href = text(link[1]);
    const lotUrl = new URL(href, `${ORIGIN}/${section}/`);
    const title = text(link[2]);
    if (!title || lotUrl.origin !== ORIGIN || lotUrl.pathname !== `/${section}/lotviewer.php` || lotUrl.searchParams.get('LotID') !== id || !lotUrl.searchParams.get('AucID') || !lotUrl.searchParams.get('Lot') || !lotUrl.searchParams.get('Val')) return { ...result, status: 'layout', reason: 'link' };
    const rawPrice = text(priceCell[1]);
    const rawDate = text(dateCell[1]);
    const fingerprint = JSON.stringify({ title, date: rawDate, price: rawPrice, url: lotUrl.href });
    if (/^Upcoming Auction$/i.test(rawPrice)) { candidates.push({ id, fingerprint, exclusion: 'upcoming' }); continue; }
    if (/^To Be Posted$/i.test(rawPrice)) { candidates.push({ id, fingerprint, exclusion: 'toBePosted' }); continue; }
    if (!/\d/.test(rawPrice)) { candidates.push({ id, fingerprint, exclusion: 'unpriced' }); continue; }
    const priceMatch = /^(\d{1,3}(?:,\d{3})*|\d+) ([A-Z]{3})$/.exec(rawPrice);
    if (!priceMatch) { candidates.push({ id, fingerprint, exclusion: 'malformedPrice' }); continue; }
    const date = isoDate(rawDate);
    if (!date) { candidates.push({ id, fingerprint, exclusion: 'malformedDate' }); continue; }
    if (date > new Date(now).toISOString().slice(0, 10)) { candidates.push({ id, fingerprint, exclusion: 'futureDate' }); continue; }
    const amount = Number(priceMatch[1].replaceAll(',', ''));
    if (!Number.isSafeInteger(amount) || amount <= 0) { candidates.push({ id, fingerprint, exclusion: 'malformedPrice' }); continue; }
    candidates.push({ id, fingerprint, lot: { id, title, date, price: `${priceMatch[1]} ${priceMatch[2]}`, amount, currency: priceMatch[2], url: lotUrl.href, source: 'coinarchives' } });
  }

  const byId = new Map();
  for (const lot of candidates) {
    const prior = byId.get(lot.id);
    if (!prior) byId.set(lot.id, [lot]); else prior.push(lot);
  }
  for (const group of byId.values()) {
    if (!group.every((entry) => entry.fingerprint === group[0].fingerprint)) { result.excluded.conflictingId += group.length; continue; }
    result.excluded.duplicateId += group.length - 1;
    if (group[0].lot) result.lots.push(group[0].lot);
    else result.excluded[group[0].exclusion] += 1;
  }
  result.lots.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  for (const lot of result.lots) result.availableCurrencyCounts[lot.currency] = (result.availableCurrencyCounts[lot.currency] || 0) + 1;
  result.availableCurrencyCounts = Object.fromEntries(Object.entries(result.availableCurrencyCounts).sort());
  result.selectedLots = result.lots.filter((lot) => lot.currency === currency);
  result.summary = nativeSummary(result.selectedLots, currency);
  if (result.lots.length) result.dateSpan = { earliest: result.lots.at(-1).date, latest: result.lots[0].date };
  return { ...result, status: result.selectedLots.length ? 'ok' : result.lots.length ? 'no-currency' : 'unpriced' };
}

async function boundedText(response, maxBytes) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > maxBytes) { await response.body?.cancel?.(); throw new Error('too-large'); }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('too-large');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('too-large'); }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function fetchCoinArchivesPrices({ term, section = 'a', currency }, { fetchImpl = fetch, now = new Date(), timeoutMs = 15000, maxBytes = COINARCHIVES_PUBLIC_MAX_BYTES } = {}) {
  const url = coinArchivesUrl(term, section);
  const fallback = baseResult({ term, section, currency, url });
  if (!['a', 'w'].includes(section)) return { ...fallback, status: 'network', reason: 'input' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Accept: 'text/html' }, signal: controller.signal });
    if (!response.ok) { await response.body?.cancel?.(); return { ...fallback, status: 'network', reason: 'http', httpStatus: response.status }; }
    if (response.url && response.url !== url) { await response.body?.cancel?.(); return { ...fallback, status: 'network', reason: 'redirect' }; }
    const contentType = response.headers?.get?.('content-type');
    if (contentType && !/^text\/html\b/i.test(contentType)) { await response.body?.cancel?.(); return { ...fallback, status: 'network', reason: 'content-type' }; }
    const html = await boundedText(response, maxBytes);
    return parseCoinArchivesPublic(html, { term, section, currency, now, url });
  } catch (error) {
    return { ...fallback, status: 'network', reason: error?.message === 'too-large' ? 'too-large' : error?.name === 'AbortError' ? 'timeout' : 'fetch' };
  } finally {
    clearTimeout(timer);
  }
}
