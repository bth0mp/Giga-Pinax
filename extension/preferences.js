export const STORAGE_KEY = 'giga-pinax-preferences-v1';
export const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);
const TERM_LIMIT = 50;

const text = (value, fallback) => (typeof value === 'string' ? value.slice(0, 120) : fallback);

function restoreTerms(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const terms = {};
  for (const [key, term] of Object.entries(value).slice(-TERM_LIMIT)) {
    if (key && typeof term === 'string') terms[key.slice(0, 120)] = term.slice(0, 120);
  }
  return terms;
}

export function restorePreferences(raw) {
  let saved;
  try { saved = JSON.parse(raw); } catch { saved = null; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const catalogue = saved.catalogue === 'RIC' ? 'RIC' : 'Price';
  return {
    currency: CURRENCIES.includes(saved.currency) ? saved.currency : 'USD',
    catalogue,
    number: text(saved.number, catalogue === 'RIC' ? '306' : '23'),
    volume: text(saved.volume, 'I (2nd edition)'),
    section: text(saved.section, 'Nero'),
    terms: restoreTerms(saved.terms),
  };
}

export function rememberTerm(preferences, typeId, term) {
  const terms = { ...preferences.terms };
  delete terms[typeId];
  terms[typeId] = String(term).slice(0, 120);
  const keys = Object.keys(terms).slice(-TERM_LIMIT);
  return { ...preferences, terms: Object.fromEntries(keys.map((key) => [key, terms[key]])) };
}
