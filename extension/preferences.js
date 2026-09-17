import { PERIODS } from './prices.js';
import { CATALOGUES, CORPORA, catalogueOf } from './catalogues.js';
import { CURRENCIES } from './core/money.js';

export const STORAGE_KEY = 'giga-pinax-preferences-v1';
// One column of the catalogue table: the example the guided fields start from, and the ruler or king beside it. A
// catalogue with no section of its own keeps RIC's ready, so choosing RIC fills the field rather than blanking it.
const column = (field) => Object.freeze(Object.fromEntries(Object.entries(CATALOGUES).flatMap(([name, entry]) => (entry[field] === undefined ? [] : [[name, entry[field]]]))));
export const DEFAULT_NUMBER = column('defaultNumber');
export const DEFAULT_SECTION = column('defaultSection');
export const RECENT_LIMIT = 6;
export const THEME_KEY = 'giga-pinax-theme-v1';
export const THEMES = Object.freeze(['light', 'dark']);
// The stored light/dark choice, or '' for "follow the system"; theme.js applies the same rule before the first paint.
export const restoreTheme = (raw) => (THEMES.includes(raw) ? raw : '');
const TERM_LIMIT = 50;

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

const boundedId = (id) => Array.from((String(id).toWellFormed?.() ?? String(id))).slice(0, 120).join('');
const termKey = ({ corpus, id }) => `${corpus}:${encodeURIComponent(boundedId(id))}`;
// A stored term keyed by a bare record id, from before the key carried its corpus: the corpus its identifier names.
const canonicalCorpus = (id) => Object.values(CATALOGUES).find((entry) => entry.idPrefix && id.startsWith(entry.idPrefix))?.corpus ?? '';

function restoreTerms(value, recent) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const terms = {};
  for (const [key, term] of Object.entries(value).slice(-TERM_LIMIT)) {
    if (!key || typeof term !== 'string') continue;
    const separator = key.indexOf(':');
    const namespacedCorpus = key.slice(0, separator);
    if (separator > 0 && CORPORA.includes(namespacedCorpus)) {
      let id;
      try { id = boundedId(decodeURIComponent(key.slice(separator + 1))); }
      catch { continue; }
      if (id) terms[termKey({ corpus: namespacedCorpus, id })] = term.slice(0, 120);
      continue;
    }
    const matches = recent.filter((entry) => entry.id === key);
    const corpus = canonicalCorpus(key) || (matches.length === 1 ? matches[0].corpus : '');
    if (corpus) terms[termKey({ corpus, id: key })] = term.slice(0, 120);
  }
  return terms;
}

export function restorePreferences(raw) {
  let saved;
  try { saved = JSON.parse(raw); } catch { saved = null; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const catalogue = catalogueOf(saved.catalogue) ? saved.catalogue : 'Price';
  const recent = restoreRecent(saved.recent);
  return {
    currency: CURRENCIES.includes(saved.currency) ? saved.currency : 'USD',
    catalogue,
    number: text(saved.number, DEFAULT_NUMBER[catalogue]),
    volume: text(saved.volume, 'I (2nd edition)'),
    section: text(saved.section, DEFAULT_SECTION[catalogue] ?? DEFAULT_SECTION.RIC),
    // The sales period the prices panel was last drawn for; only an exact PERIODS value, else All.
    period: PERIODS.some((entry) => entry.value === saved.period) ? saved.period : 'all',
    terms: restoreTerms(saved.terms, recent),
    recent,
  };
}

export function rememberRecent(preferences, card) {
  const entry = { id: String(card.id).slice(0, 120), corpus: card.corpus, label: String(card.label).slice(0, 120) };
  const older = preferences.recent.filter((other) => other.corpus !== entry.corpus || other.id !== entry.id);
  return { ...preferences, recent: [entry, ...older].slice(0, RECENT_LIMIT) };
}

// The Reference box's ArrowUp and ArrowDown walk the Recent labels, storing nothing: position -1 is the empty box, 0 the newest label. Up goes older and
// stops at the oldest, down goes newer and ends at the empty box. Null leaves the key to the box: it holds typed text, or there is nowhere to go.
export function recallStep(recent, position, value, key) {
  const shown = value === '' ? -1 : recent[position]?.label === value ? position : null;
  if (shown === null) return null;
  const next = Math.max(-1, Math.min(shown + (key === 'ArrowUp' ? 1 : -1), recent.length - 1));
  return next === shown ? null : { position: next, text: next < 0 ? '' : recent[next].label };
}

export function rememberedTerm(preferences, card) {
  return preferences.terms[termKey(card)] ?? '';
}

export function rememberTerm(preferences, card, term) {
  if (!String(term).trim()) return preferences;
  const identity = typeof card === 'string' ? { corpus: canonicalCorpus(card) || 'other', id: card } : card;
  if (!identity || !CORPORA.includes(identity.corpus) || !String(identity.id).trim()) return preferences;
  const key = termKey(identity);
  const terms = { ...preferences.terms };
  delete terms[key];
  terms[key] = String(term).slice(0, 120);
  const keys = Object.keys(terms).slice(-TERM_LIMIT);
  return { ...preferences, terms: Object.fromEntries(keys.map((key) => [key, terms[key]])) };
}
