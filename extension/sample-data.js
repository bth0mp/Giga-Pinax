// These amounts are fictional visual fixtures, never fetched auction results.
export const sampleAmounts = Object.freeze([90, 110, 135, 165, 180, 215, 245, 310, 450]);
export const sampleSummary = Object.freeze({ count: 9, median: 180, lowerQuartile: 135, upperQuartile: 245 });

const text = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 120) : fallback;

export function restorePreferences(raw) {
  let saved;
  try { saved = JSON.parse(raw); } catch { saved = null; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const catalogue = saved.catalogue === 'RIC' ? 'RIC' : 'Price';
  return {
    currency: ['USD', 'EUR', 'GBP', 'CHF'].includes(saved.currency) ? saved.currency : 'USD',
    catalogue,
    number: text(saved.number, catalogue === 'RIC' ? '306' : '23'),
    volume: text(saved.volume, 'I (2nd edition)'),
    section: text(saved.section, 'Nero'),
    sampleMode: saved.sampleMode === true,
  };
}

export function resolveSample({ catalogue, number, volume, section }) {
  if (catalogue === 'Price' && text(number).trim() === '23') {
    return { label: 'PRICE 23', description: 'Alexander III · Silver tetradrachm',
      typeUrl: 'https://numismatics.org/pella/id/price.23', typeSource: 'PELLA', fictional: true };
  }
  if (catalogue === 'RIC' && text(number).trim() === '306' &&
      text(volume).trim().toLowerCase() === 'i (2nd edition)' &&
      text(section).trim().toLowerCase() === 'nero') {
    return { label: 'RIC I (2nd ed.) · NERO 306', description: 'Nero · Roman Imperial Coinage',
      typeUrl: 'https://numismatics.org/ocre/id/ric.1%282%29.ner.306', typeSource: 'OCRE', fictional: true };
  }
  return null;
}
