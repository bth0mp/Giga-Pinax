export const STORAGE_KEY = 'giga-pinax-preferences-v1';
export const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);
export const DEFAULT_NUMBER = Object.freeze({ Price: '23', RIC: '306', RRC: '44/5', SC: '1266.2' });
export const RECENT_LIMIT = 6;
const TERM_LIMIT = 50;
const CORPORA = Object.freeze(['ocre', 'pella', 'crro', 'sco']);

const text = (value, fallback) => (typeof value === 'string' ? value.slice(0, 120) : fallback);

// Untrusted: keeps plain { id, corpus, label } entries with non-blank strings (stored untrimmed) and a known corpus, first copy of each type only, newest first.
function restoreRecent(value) {
  if (!Array.isArray(value)) return [];
  const recent = [];
  for (const entry of value) {
    if (recent.length === RECENT_LIMIT) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { id, corpus, label } = entry;
    if (typeof id !== 'string' || !id.trim() || typeof label !== 'string' || !label.trim() || !CORPORA.includes(corpus)) continue;
    const kept = { id: id.slice(0, 120), corpus, label: label.slice(0, 120) };
    if (!recent.some((other) => other.corpus === kept.corpus && other.id === kept.id)) recent.push(kept);
  }
  return recent;
}

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
  const catalogue = ['RIC', 'RRC', 'SC'].includes(saved.catalogue) ? saved.catalogue : 'Price';
  return {
    currency: CURRENCIES.includes(saved.currency) ? saved.currency : 'USD',
    catalogue,
    number: text(saved.number, DEFAULT_NUMBER[catalogue]),
    volume: text(saved.volume, 'I (2nd edition)'),
    section: text(saved.section, 'Nero'),
    terms: restoreTerms(saved.terms),
    recent: restoreRecent(saved.recent),
  };
}

export function rememberRecent(preferences, card) {
  const entry = { id: String(card.id).slice(0, 120), corpus: card.corpus, label: String(card.label).slice(0, 120) };
  const older = preferences.recent.filter((other) => other.corpus !== entry.corpus || other.id !== entry.id);
  return { ...preferences, recent: [entry, ...older].slice(0, RECENT_LIMIT) };
}

export function rememberTerm(preferences, typeId, term) {
  if (!String(term).trim()) return preferences;
  const terms = { ...preferences.terms };
  delete terms[typeId];
  terms[typeId] = String(term).slice(0, 120);
  const keys = Object.keys(terms).slice(-TERM_LIMIT);
  return { ...preferences, terms: Object.fromEntries(keys.map((key) => [key, terms[key]])) };
}
