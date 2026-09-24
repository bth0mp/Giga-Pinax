// @ts-check
import { stripTracking } from './validate.js';
/** @typedef {import('./types.js').Lot} Lot */

/**
 * @param {*} value
 * @returns {string | null}
 */
export function normalizeAuctionUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // A hash route addresses the lot itself, so only cosmetic anchors such as #photo are dropped.
    if (!/^#[/!]/.test(url.hash)) url.hash = '';
    return stripTracking(url).href;
  } catch { return null; }
}

function tuple(context) {
  if (!context || typeof context !== 'object') return null;
  const values = ['house', 'saleId', 'lotNumber'].map((key) =>
    typeof context[key] === 'string' ? context[key].trim().toLocaleLowerCase('en-US') : '');
  return values.every(Boolean) ? values.join('\u0000') : null;
}

function identityUrls(lot) {
  const urls = [];
  if (lot?.auctionContext?.pageUrl) urls.push(lot.auctionContext.pageUrl);
  if (!lot?.auctionContext && Array.isArray(lot?.sourceLinks)) {
    for (const link of lot.sourceLinks) {
      if (link?.sourceRecordId && link?.url && /(?:^|[/?&=_-])(auction|sale|lot)(?:[/?&=_-]|$)/i.test(link.url)) urls.push(link.url);
    }
  }
  return new Set(urls.map(normalizeAuctionUrl).filter(Boolean));
}

/**
 * The saved lot the candidate is the same auction lot as, by its page or its house, sale and lot number.
 * @param {*} lots
 * @param {*} candidate
 * @param {string} [excludeId]
 * @returns {Lot | null}
 */
export function findDuplicateLot(lots, candidate, excludeId) {
  if (!Array.isArray(lots) || !candidate || typeof candidate !== 'object') return null;
  const candidateUrls = identityUrls(candidate);
  const candidateTuple = tuple(candidate.auctionContext);
  for (const lot of lots) {
    if (!lot || lot.id === excludeId) continue;
    const lotTuple = tuple(lot.auctionContext);
    // Two complete but different house, sale and lot identities are two lots, whatever page a
    // single-page catalogue serves them from.
    if (candidateTuple && lotTuple && lotTuple !== candidateTuple) continue;
    if ([...identityUrls(lot)].some((url) => candidateUrls.has(url))) return lot;
    if (candidateTuple && lotTuple === candidateTuple) return lot;
  }
  return null;
}
