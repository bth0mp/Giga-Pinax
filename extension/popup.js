import { HOST_ORIGINS, INVISIBLE, buildQuery, filingNote, lookupById, lookupType, parseReference, rpcUrl } from './lookup.js';
import { ACSEARCH_ORIGIN, PERIODS, buildSearchUrl, chooseTerm, citesReference, coinArchivesSection, coinArchivesTerm, coinArchivesUrl, createPriceCuration, defaultTerm, fetchPrices, filterableDenomination, filtersCitations, gradeMedians, gradeText, lastSale, localDay, lotsInPeriod, namesDenomination, parsePrice, priceCheck, pricePanelVisibility, quoteList, referenceName, searchCategory, searchesReference, stableResultId, summarise, summaryText, trendOf, trendText } from './prices.js';
import { CORPORA, DEFAULT_NUMBER, DEFAULT_SECTION, STORAGE_KEY, THEME_KEY, recallStep, rememberRecent, rememberedTerm, rememberTerm, restorePreferences, restoreTheme } from './preferences.js';
import { BIGR_KINGS, RIC_RULERS, RIC_VOLUMES, VOLUME_OPTIONS, sectionMismatch, selectOptions, volumeFor } from './catalogues.js';
import { LOOKUP_LAUNCH_MESSAGE, LOOKUP_MESSAGE, cardFromSearch, cardUrlFor, lookupLaunchSucceeded, queryFromSearch, selectionQuery } from './selection.js';
import { findReferences, isLot, lotLabel, lotLookup, oneLine } from './lot.js';
import { shouldRevealRefine } from './companion-popup.js';
import { fetchCoinArchivesPrices } from './coinarchives-prices.js';
import { createLocalCatalogue } from './local-catalogue.js';

const $ = (id) => document.getElementById(id);
const api = globalThis.browser ?? globalThis.chrome;
const LABELS_KEY = 'giga-pinax-labels-v1';
const CONNECTION_MESSAGE = 'Couldn’t connect to numismatics.org. Try the catalogue lookup again later. You can still search auction results below.';
const CONNECTION_ONLY_MESSAGE = 'Couldn’t connect to numismatics.org. Try the catalogue lookup again later.';
const PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it.';
const ACSEARCH_NETWORK_MESSAGE = 'Couldn’t reach acsearch. Check your connection and try again.';
const ACSEARCH_PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact acsearch.info to fetch prices. Select “Get prices” again to allow it.';
const SIGN_IN_MESSAGE = 'acsearch didn’t show prices. Sign in with an acsearch account that includes hammer prices, then select “Get prices”.';
const ACCESS_HINT = 'Select “Get prices” to let Giga Pinax fetch acsearch prices.';
const EMPTY_TERM_MESSAGE = 'Enter a search term for acsearch, such as “Nero 306”.';
const ACSEARCH_HOME = 'https://www.acsearch.info/';
const COINARCHIVES_ORIGIN = 'https://www.coinarchives.com/*';
const COINARCHIVES_HOME = 'https://www.coinarchives.com/';
const EMPTY_OTHER_MESSAGE = 'Enter a reference, such as “BCD Boiotia 174b”.';
const COPY_FAILED_MESSAGE = 'Couldn’t copy the summary.';
const QUICK_ERROR = 'Couldn’t read that reference. Try “RIC 972”, “Titus 123”, “Crawford 44/5”, “SC 1266.2”, “Bop Euthydemus I 24A” or “Price 23”, or use the fields below.';
const CORPUS_NAME = { ocre: 'OCRE', pella: 'PELLA', crro: 'CRRO', sco: 'SCO', bigr: 'BIGR' };
const NOT_FOUND_HINT = { ocre: 'Check the ruler, volume and number.', crro: 'Check the number.', pella: 'Check the number.', sco: 'Check the number.', bigr: 'Check the king and Bop number.' };
const REFERENCE_LABEL = { Price: 'Price number', RIC: 'RIC number (including any suffix)', RRC: 'Crawford number', SC: 'Seleucid Coins number', Bop: 'Bop number', Other: 'Reference, as the dealer cites it' };
const REFERENCE_HELP = { Price: 'Example: Price 23', RIC: 'Example: 306 with Nero. Leave the ruler blank and choose Any volume to list every type with that number.', RRC: 'Example: 44/5', SC: 'Example: 1266.2', Bop: 'Example: 24A. Leave the king blank to list every king with that number.', Other: 'Example: BCD Boiotia 174b; HGC 4, 1218. No type data, only acsearch prices.' };
const OTHER_SUMMARY = 'No open type data for this reference. Prices from acsearch only.';
const CHECK_MESSAGE = 'Enter an amount such as 500.';
const NO_REFERENCES_MESSAGE = 'No catalogue references found in that text.';
const EMPTY_QUICK_MESSAGE = 'Type a reference in the Reference box, such as “RIC 972”.';
const ONLINE_MESSAGE = 'This type was not available in the local OCRE catalogue. Check online to search numismatics.org.';

let rawPreferences = null;
try { rawPreferences = localStorage.getItem(STORAGE_KEY); }
catch { $('storage-note').hidden = false; }
let preferences = restorePreferences(rawPreferences);
let requestId = 0;
let referenceRevision = 0;
let priceRequestId = 0;
let currentCard = null;
let researchContext = null;
// What the prices panel is showing, for Copy summary; only in memory, and cleared with the panel.
let shownPrices = null;
let shownCoinArchivesPrices = null;
let coinArchivesRequestId = 0;
const priceCuration = createPriceCuration();
// The public panel curates its own rows: the same filter, the same Include, over the results CoinArchives returned.
const coinArchivesCuration = createPriceCuration();
// The two toggles above the median, and the sale whose toggle the keyboard was on when a list was redrawn. All live in this view only; the citation
// filter starts on, because a result that never cites the reference is not a sale of this type until the collector says it is.
let onlyCiting = true;
let onlyDenomination = false;
let focusSaleId = null;
const verifiedPriceCards = new WeakMap();
const requestedPriceContexts = new WeakSet();
let copiedTimer = 0;
// The Recent label the arrow keys last put in the Reference box, by position (-1: none).
let recalled = -1;
// Bumped by every lot row pick and by clearLot(), so a pick still waiting on its permission prompt never opens over a newer one.
let lotPick = 0;
// "3 references found in this text." while a lot's single type opens at once: said before that lookup's own announcements, which would otherwise
// replace it before a screen reader speaks it; clearOutput() drops it, so only the lookup run() is handed it keeps it.
let lotNote = '';
const announce = (message) => { $('announcement').textContent = [lotNote, message].filter(Boolean).join(' '); };
// Look up belongs to the Reference box. The guided fields start from a stored or example number the tool filled in itself ("Price 23"), so they
// answer for a lookup only once the collector has chosen a catalogue or edited them on purpose; until then an empty box looks nothing up.
let guidedTouched = false;

// The form, a Recent row and the card together are taller than the popup, so the answer usually arrives below the fold and pressing Look up looks like
// nothing happened. reveal() brings the top of the answer into view; his own scrolling wins, since the panel having moved since the lookup began means
// he moved it. Errors never scroll: they belong beside the box he typed in.
const scroller = document.querySelector('.popup-scroll');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let restingScroll = 0;
const markScroll = () => { restingScroll = scroller.scrollTop; };
// The card grows after it is shown - Recent renders under it, then the prices panel arrives a second later - and until it does there may be nothing to
// scroll at all, so the answer is revealed again as it settles. Timers, not requestAnimationFrame: a popup whose window is not being painted never runs
// an animation frame, and the answer must still be where he can see it when he looks.
const revealAgain = (id) => { for (const wait of [0, 60, 400]) setTimeout(() => reveal(id), wait); };
// His own scrolling wins: the panel having moved since the lookup began means he moved it. Errors never scroll - they belong beside the box he typed in.
function reveal(id) {
  const view = scroller.getBoundingClientRect();
  const box = $(id).getBoundingClientRect();
  // Nothing to do once the answer starts at the top of the panel, which is also what stops the later passes from fighting the first.
  if (scroller.scrollTop !== restingScroll || box.top <= view.top + 8) return;
  $(id).scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  // Where the panel now rests is where we put it, or the next pass reads our own scroll as his and never moves.
  scroller.addEventListener('scrollend', markScroll, { once: true });
  setTimeout(markScroll, 700);
}

// A change the tool made to the guided fields by itself: shown under those fields for everyone, and said once — #ric-note is no live region, so a
// screen reader hears the announcement alone. It lasts until the next edit.
function ricChanged(message) {
  $('ric-note').textContent = message;
  $('announcement').textContent = message;
}
const clearRicNote = () => { $('ric-note').textContent = ''; };

// Read once per popup; get reads memory and set writes the whole object back. Missing, corrupt or unwritable storage leaves an in-memory cache.
function readLabels() {
  try {
    const stored = JSON.parse(localStorage.getItem(LABELS_KEY));
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch { return {}; }
}
const labelCache = {
  labels: readLabels(),
  get(slug) { return this.labels[slug]; },
  set(slug, label) {
    this.labels[slug] = label;
    try { localStorage.setItem(LABELS_KEY, JSON.stringify(this.labels)); } catch { /* cache is optional */ }
  },
};
const localCatalogue = createLocalCatalogue({ cache: labelCache });

async function hasHostAccess(origins) {
  if (!api?.permissions?.contains) return true;
  try { return (await api.permissions.contains({ origins })) === true; } catch { return false; }
}

async function localFirstType(reference) {
  const ticket = requestId;
  const context = researchContext;
  const local = await lookupType(reference, { cache: labelCache, localProvider: localCatalogue, online: false });
  if (ticket !== requestId || context !== researchContext) return { status: 'cancelled' };
  if (local.status !== 'online-required') return local;
  const granted = await hasHostAccess([...HOST_ORIGINS]);
  if (ticket !== requestId || context !== researchContext) return { status: 'cancelled' };
  if (granted) return lookupType(reference, { cache: labelCache, localProvider: localCatalogue, online: true });
  return { ...local, retry: () => lookupType(reference, { cache: labelCache, localProvider: localCatalogue, online: true }) };
}

async function localFirstId(corpus, id) {
  if (corpus !== 'ocre') return lookupById(corpus, id, { cache: labelCache });
  const ticket = requestId;
  const context = researchContext;
  const local = await lookupById(corpus, id, { cache: labelCache, localProvider: localCatalogue, online: false });
  if (ticket !== requestId || context !== researchContext) return { status: 'cancelled' };
  if (local.status !== 'online-required') return local;
  const granted = await hasHostAccess([...HOST_ORIGINS]);
  if (ticket !== requestId || context !== researchContext) return { status: 'cancelled' };
  if (granted) return lookupById(corpus, id, { cache: labelCache, localProvider: localCatalogue, online: true });
  return { ...local, retry: () => lookupById(corpus, id, { cache: labelCache, localProvider: localCatalogue, online: true }) };
}

// Light or dark: the popup follows the system scheme until the header button is used. That choice is stored under its own key as a bare
// 'light' or 'dark' (theme.js applies it before the first paint; restoreTheme validates it here too, so anything else falls back to the system).
const darkScheme = matchMedia('(prefers-color-scheme: dark)');
const shownTheme = () => document.documentElement.dataset.theme || (darkScheme.matches ? 'dark' : 'light');

// The button is "pressed" while dark is shown, and its icon shows what a click switches to: a moon in light, a sun in dark.
function syncThemeButton() {
  const dark = shownTheme() === 'dark';
  $('theme-toggle').setAttribute('aria-pressed', String(dark));
  $('theme-toggle').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  $('icon-sun').toggleAttribute('hidden', !dark);
  $('icon-moon').toggleAttribute('hidden', dark);
}

function applyStoredTheme() {
  let theme = '';
  try { theme = restoreTheme(localStorage.getItem(THEME_KEY)); } catch { /* unreadable storage: follow the system */ }
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

// A click switches to the opposite of what is shown and remembers it; a failed write shows the storage note like any other preference.
function chooseTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); }
  catch { $('storage-note').hidden = false; }
  syncThemeButton();
}

// A Number or Ruler/King pasted from a dealer page can carry the hidden characters parseReference drops ("23" plus a soft hyphen is no Price 23), so the
// guided fields are read without them: the lookup, its acsearch term, the saved fields and the ruler's volume.
const visible = (id) => $(id).value.replace(INVISIBLE, '');
function currentReference() {
  return { catalogue: $('catalogue').value, number: visible('reference-number'),
    volume: $('ric-volume').value, section: visible('ric-section') };
}

function savePreferences() {
  preferences = { ...preferences, ...currentReference(), currency: $('currency').value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
  catch { $('storage-note').hidden = false; }
}

// The Volume select lists Any volume and the RIC volumes, plus the wanted one when it is not listed (selectOptions), so a parsed "IV, Part 1" is
// shown and used exactly as it came; each option is a new Option(label, value), never markup. The Ruler/King input takes its value as given: blank
// means any.
function fillRicFields(volume, section) {
  const wanted = String(volume ?? '');
  $('ric-volume').replaceChildren(...selectOptions(VOLUME_OPTIONS, wanted).map((option) => new Option(option.label, option.value)));
  $('ric-volume').value = wanted;
  $('ric-section').value = String(section ?? '');
}

function updateFields() {
  const catalogue = $('catalogue').value;
  const isRic = catalogue === 'RIC';
  const isBop = catalogue === 'Bop';
  $('ric-fields').hidden = !isRic && !isBop;
  $('volume-field').hidden = !isRic;
  $('ric-fields').classList.toggle('single', isBop);
  $('section-label').textContent = isBop ? 'King' : 'Ruler or mint section';
  // The Ruler/King input suggests every RIC ruler and mint, or the BIGR kings for Bop, one new Option each, never markup.
  $('ric-section').placeholder = isBop ? 'Any king' : 'Any ruler';
  $('section-options').replaceChildren(...(isBop ? BIGR_KINGS : RIC_RULERS).map((name) => new Option(name, name)));
  // The note goes with the fields it explains: only RIC can ever write one, so Bop drops the reserved line instead of holding a blank it cannot fill,
  // and any refill of the fields — a chip, a chosen candidate, a card — drops the line written about the fields it replaced.
  $('ric-note').hidden = !isRic;
  clearRicNote();
  $('reference-label').textContent = REFERENCE_LABEL[catalogue];
  $('reference-help').textContent = REFERENCE_HELP[catalogue];
}

function fillFields(parsed) {
  $('catalogue').value = parsed.catalogue;
  $('reference-number').value = parsed.number;
  // Only a RIC reference carries a volume and only RIC and Bop a section; the other catalogues leave the hidden fields untouched.
  // A RIC reference without a volume takes the one its ruler implies ("Titus 123" shows II.1²), but an explicit volume is never changed:
  // RIC II (1926) numbers are not II.1² (2007) numbers, so "correcting" RIC II Titus 5 would show the wrong coin.
  if (parsed.catalogue === 'RIC' || parsed.catalogue === 'Bop') {
    fillRicFields(parsed.catalogue === 'RIC' ? parsed.volume || volumeFor(parsed.section, '') : $('ric-volume').value, parsed.section);
  }
  updateFields();
}

// An empty one-box leaves the guided fields alone; a parsed one fills them so they show what was understood. False when it doesn't parse.
function applyQuickReference() {
  const text = $('quick-reference').value;
  if (!text.trim()) return true;
  const parsed = parseReference(text);
  if (!parsed) return false;
  fillFields(parsed);
  return true;
}

function setPricesBusy(busy) {
  $('prices-button').disabled = busy;
  $('prices-label').textContent = busy ? 'Fetching…' : 'Get prices';
}

function resetCopyLabel() {
  clearTimeout(copiedTimer);
  $('copy-summary').textContent = 'Copy summary';
}

function clearAcsearchPrices() {
  priceRequestId += 1;
  priceCuration.reset();
  onlyCiting = true;
  shownPrices = null;
  resetCopyLabel();
  $('prices-panel').hidden = true;
  // A new result starts with Inspect sales folded; a period redraw leaves it as it was.
  $('sale-details').open = false;
  // A new lookup or currency starts the price check empty.
  $('check-amount').value = '';
  showCheck();
  $('prices-error').hidden = true;
  $('prices-note').hidden = true;
  $('signin-link').hidden = true;
  setPricesBusy(false);
}

function clearCoinArchivesPrices() {
  coinArchivesRequestId += 1;
  coinArchivesCuration.reset();
  shownCoinArchivesPrices = null;
  $('coinarchives-prices-panel').hidden = true;
  $('coinarchives-prices-error').hidden = true;
  $('coinarchives-prices-error').textContent = '';
  $('coinarchives-details').open = false;
  $('coinarchives-prices-button').disabled = false;
  $('coinarchives-prices-label').textContent = 'Get CoinArchives prices';
}

function clearPrices() {
  clearAcsearchPrices();
  clearCoinArchivesPrices();
}

// Clearing the output also cancels a lookup in flight, as clearPrices() cancels prices, so its card never refills fields edited while it ran.
function clearOutput() {
  requestId += 1;
  setBusy(false);
  $('form-error').hidden = true;
  $('form-error').textContent = '';
  $('candidates').hidden = true;
  $('result').hidden = true;
  $('research-prices').hidden = true;
  $('lookup-prompt').hidden = true;
  $('reference-number').removeAttribute('aria-invalid');
  $('quick-reference').removeAttribute('aria-invalid');
  $('announcement').textContent = '';
  $('online-fallback').hidden = true;
  $('online-fallback').disabled = false;
  $('online-fallback').onclick = null;
  // A note about the fields as they were must not outlive a lookup that rewrites them. Both writers announce after their own clearOutput(), so this
  // never erases a line just written.
  clearRicNote();
  lotNote = '';
  currentCard = null;
  researchContext = null;
  globalThis.gigaPinaxWatchlistReference = null;
  dispatchEvent(new CustomEvent('giga-pinax-card', { detail: null }));
  clearPrices();
}

function catalogueFailureMessage(outcome, hasFallback) {
  const searches = hasFallback ? ' You can still search auction results below.' : '';
  if (outcome.status === 'unavailable') return `numismatics.org is temporarily unavailable (HTTP ${outcome.httpStatus}). Try the catalogue lookup again later.${searches}`;
  if (outcome.status === 'rate-limited') return `numismatics.org is temporarily limiting requests (HTTP ${outcome.httpStatus}). Try the catalogue lookup again later.${searches}`;
  return hasFallback ? CONNECTION_MESSAGE : CONNECTION_ONLY_MESSAGE;
}

// Only a reference that wasn't found or read marks its field invalid; network and permission messages name no field.
function showError(message, field) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  if (field) $(field).setAttribute('aria-invalid', 'true');
  if (shouldRevealRefine({ status: 'error' }, field)) $('refine-reference').open = true;
  if (lotNote) announce('');
}

function setBusy(busy) {
  $('lookup-button').disabled = busy;
  $('refine-lookup-button').disabled = busy;
  $('lookup-label').textContent = busy ? 'Looking up…' : 'Look up';
  $('refine-lookup-label').textContent = busy ? 'Searching…' : 'Search';
}

// A card's title stands in for an empty term, but only when the reference gives words at all: a chip stored before 0.22 from a pasted description
// still opens its card, and searching that whole sentence as one phrase is what 0.22 stopped, so such a card searches neither site — both links
// stay on the site's home page, as they are before a lookup.
const cardFallbackTerm = () => researchContext?.label ?? '';

function updateAcsearchLink() {
  const term = $('price-term').value.trim() || cardFallbackTerm();
  // The category follows the reference on the card, not the edited term: a Krause reference searches modern coins.
  $('acsearch-link').href = term ? buildSearchUrl({ term, currency: $('currency').value, category: searchCategory(researchContext?.reference) }) : ACSEARCH_HOME;
}

// CoinArchives follows the reference on the card, never the edited acsearch term, whose quotes and brackets it can't read; only the user opens it.
function updateCoinArchivesLink() {
  const term = coinArchivesTerm(researchContext?.reference) || researchContext?.label || '';
  $('coinarchives-link').href = term ? coinArchivesUrl(term, coinArchivesSection(researchContext?.reference)) : COINARCHIVES_HOME;
  $('coinarchives-link').setAttribute('aria-label', term ? `Search CoinArchives for ${term}, opens a new tab` : 'Open CoinArchives, opens a new tab');
}

function priceCard(context) {
  return verifiedPriceCards.get(context) ?? { label: context?.label ?? '' };
}

function initialisePriceResearch(reference, identity = null) {
  const term = defaultTerm(reference);
  if (!term) return false;
  clearPrices();
  const chosen = identity ? chooseTerm(reference, rememberedTerm(preferences, identity)) : term;
  researchContext = Object.freeze({ reference: Object.freeze({ ...reference }), label: buildQuery(reference).query, identity, term: chosen,
    currency: $('currency').value, priceTicket: priceRequestId });
  $('price-term').value = chosen;
  updateAcsearchLink();
  updateCoinArchivesLink();
  $('research-prices').hidden = false;
  return true;
}

function referenceFromCard(card) {
  if (card.bop?.series) return { catalogue: 'Bop', number: card.bop.series, volume: '', section: card.bop.king ?? '' };
  const parsed = parseReference(card.label);
  if (parsed) return parsed;
  if (card.corpus === 'pella') return { catalogue: 'Price', number: card.id.replace(/^price\./, ''), volume: '', section: '' };
  return null;
}

function cardMatchesContext(card, context) {
  const reference = referenceFromCard(card);
  if (!reference) return false;
  const field = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (field(reference.catalogue) !== field(context.reference.catalogue) || field(reference.number) !== field(context.reference.number)) return false;
  if (reference.catalogue === 'RIC') return ['volume', 'section'].every((key) => field(reference[key]) === field(context.reference[key]));
  if (reference.catalogue === 'Bop') return field(reference.section) === field(context.reference.section);
  return true;
}

async function fetchAutomaticPrices() {
  const context = researchContext;
  const ticket = priceRequestId;
  const { term, currency } = context ?? {};
  if (!context) return;
  const granted = await hasAcsearchAccess();
  if (context !== researchContext || ticket !== priceRequestId) return;
  if (!granted) { showPricesNote(ACCESS_HINT, false); return; }
  runPrices(term, currency, { remember: false, context });
}

// What the live region says about a card: the filing note is the point of the feature, so it is spoken wherever the card is announced.
const announcement = (card, ...rest) => [`Found ${card.label}.`, filingNote(card), ...rest].filter(Boolean).join(' ');

function renderCard(card) {
  // A reference without type data has no type page and no sides to show, only its prices.
  const other = card.corpus === 'other';
  $('result-reference').textContent = card.label;
  $('result-source').textContent = card.source === 'local' ? 'Local OCRE catalogue' : '';
  $('result-source').hidden = card.source !== 'local';
  $('result-summary').textContent = other ? OTHER_SUMMARY : [card.authority, card.denomination, card.mint, card.material, card.dates].filter(Boolean).join(' · ');
  const citation = card.bop?.citation ? `Bopearachchi ${card.bop.citation}` : '';
  $('result-citation').textContent = citation;
  $('result-citation').hidden = !citation;
  // Why RIC files this type where it does, when it has something to say; a quiet card shows nothing and moves nothing.
  const filing = filingNote(card);
  $('result-filing').textContent = filing;
  $('result-filing').hidden = !filing;
  $('type-link').href = `https://numismatics.org/${card.corpus}/id/${encodeURIComponent(card.id)}`;
  $('type-link').setAttribute('aria-label', `View ${card.label} on numismatics.org, opens a new tab`);
  $('type-link').hidden = other;
  // An RPC reference has no type data here, but RPC Online has its page: that link takes the Type link's place, and only the user opens it.
  const rpc = other ? rpcUrl(card.label) : null;
  $('rpc-link').hidden = !rpc;
  if (rpc) {
    $('rpc-link').href = rpc;
    $('rpc-link').setAttribute('aria-label', `View ${card.label} on RPC Online, opens a new tab`);
  }
  $('sides-details').hidden = other;
  for (const side of ['obverse', 'reverse']) {
    $(`${side}-legend`).textContent = card[side].legend ?? '';
    $(`${side}-legend`).hidden = !card[side].legend;
    $(`${side}-description`).textContent = card[side].description ?? '—';
  }
  currentCard = card;
  globalThis.gigaPinaxWatchlistReference = Object.freeze({
    title: [card.label, card.denomination].filter(Boolean).join(' — '),
    reference: card.label,
    pageUrl: other ? (rpc ?? '') : $('type-link').href,
  });
  dispatchEvent(new CustomEvent('giga-pinax-card', { detail: globalThis.gigaPinaxWatchlistReference }));
  $('result').hidden = false;
  $('refine-reference').open = false;
  announce(announcement(card));
  revealAgain('result');
}

// A partial RIC search lists every type with the number, so it asks for a choice; near misses and Bop lists stay suggestions.
function renderCandidates(candidates, corpus, partial, personMismatch = false) {
  $('candidates-label').textContent = personMismatch ? 'No matching ruler found locally. Other types with this reference:' : partial ? 'Choose a type:' : 'Did you mean:';
  $('candidate-list').replaceChildren(...candidates.map(({ id, title, source }) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    button.textContent = title;
    if (source === 'local') {
      const badge = document.createElement('span');
      badge.className = 'source-badge candidate-source';
      badge.textContent = 'Local catalogue';
      button.append(badge);
    }
    // Like a Recent chip: the chosen title fills the guided fields, so the acsearch term follows the chosen type, not the mistyped one.
    button.addEventListener('click', () => {
      $('quick-reference').value = '';
      const parsed = parseReference(title);
      if (parsed) { fillFields(parsed); savePreferences(); }
      // The list this row sits in is about to be hidden with the row still in it, which drops focus to the body and restarts the next Tab at the top of
      // the popup; renderRecent keeps focus on a chip, and this keeps it on the box the choice came from.
      // preventScroll: without it the box is scrolled back into view, only for the card below to scroll away from it again — two movements for one click.
      $('quick-reference').focus({ preventScroll: true });
      beginResearch(parsed, () => localFirstId(corpus, id), '', { corpus, id, label: title });
    });
    item.append(button);
    return item;
  }));
  $('candidates').hidden = false;
  if (shouldRevealRefine({ status: 'candidates' })) $('refine-reference').open = true;
  announce(`${candidates.length} possible matches. Choose one.`);
  revealAgain('candidates');
}

// A chip, or its label recalled into the Reference box and sent unchanged, is a user action like a "Did you mean" choice: it fills the guided fields
// from the stored title (so the acsearch term follows it), reopens the type by corpus and id (a BIGR title or "Price P1" would not read back) and makes
// no permission request. It empties the lot list too, whose chosen row would name another type.
function openRecent(entry) {
  clearLot();
  $('quick-reference').value = '';
  const parsed = parseReference(entry.label);
  if (parsed) { fillFields(parsed); savePreferences(); }
  beginResearch(parsed, () => localFirstId(entry.corpus, entry.id), '', entry);
}

// The lot list lives outside #candidates, so a lookup's clearOutput() leaves it above the card; only a new Reference, a guided edit, a catalogue
// change, a Recent chip or a Look up that isn't lot text empties it.
function clearLot() {
  lotPick += 1;
  $('lot-list').replaceChildren();
  $('lot-refs').hidden = true;
}

// A chosen row (a findReferences item: its parsed reference is found.reference), like a Recent chip, fills the guided fields so the acsearch term
// follows it. The permission request comes before any await, so it keeps the click's (or Look up's) gesture: acsearch only for Other, whose card needs
// no access, as in the submit handler. note is the lot's count, said with an auto-opened lookup's announcements.
async function openLotReference(found, rulers, button, note = '') {
  const pick = ++lotPick;
  const fail = (message) => { clearOutput(); lotNote = note; showError(message); };
  for (const row of $('lot-list').querySelectorAll('button')) row.removeAttribute('aria-current');
  button.setAttribute('aria-current', 'true');
  fillFields(found.reference);
  savePreferences();
  const other = found.reference.catalogue === 'Other';
  if (other && !defaultTerm(currentReference())) { fail(EMPTY_OTHER_MESSAGE); return; }
  const reference = lotLookup(found, rulers);
  const localRic = reference.catalogue === 'RIC';
  const access = localRic ? null : requestHostAccess(other ? [ACSEARCH_ORIGIN] : [...HOST_ORIGINS]);
  beginResearch(reference, async () => {
    const context = researchContext;
    const allowed = localRic ? true : await access;
    if (pick !== lotPick || context !== researchContext) return { status: 'cancelled' };
    if (!allowed && !other) return { status: 'permission' };
    if (allowed && other && context.priceTicket === priceRequestId && !requestedPriceContexts.has(context)) runPrices(context.term, context.currency, { remember: false, context });
    return localRic ? localFirstType(reference) : lookupType(reference, { cache: labelCache });
  }, note);
}

// Lot text lists every reference in it, in text order. A single type-data reference opens at once (the user's 0.18 decision), its row marked
// chosen; several wait for a pick, so a lot fetches nothing it wasn't asked for.
function showLot(text) {
  const { references, rulers } = findReferences(text);
  clearOutput();
  clearLot();
  markScroll();
  if (references.length === 0) { showError(NO_REFERENCES_MESSAGE, 'quick-reference'); return; }
  const buttons = references.map((found) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    button.textContent = lotLabel(found, rulers);
    button.addEventListener('click', () => openLotReference(found, rulers, button));
    return button;
  });
  $('lot-list').replaceChildren(...buttons.map((button) => {
    const item = document.createElement('li');
    item.append(button);
    return item;
  }));
  $('lot-refs').hidden = false;
  const count = `${references.length} ${references.length === 1 ? 'reference' : 'references'} found in this text.`;
  $('announcement').textContent = count;
  const typed = references.flatMap((found, index) => (found.typed ? [index] : []));
  // The list is the answer only when it waits for a pick; a single type opens at once, and its card is what to bring into view.
  if (typed.length === 1) openLotReference(references[typed[0]], rulers, buttons[typed[0]], count);
  else revealAgain('lot-refs');
}

function renderRecent() {
  // Rebuilding drops focus to body; if a chip had focus, it returns to the same chip (a used chip is now first), else to the first chip.
  const refocus = $('recent-list').contains(document.activeElement);
  const focusedKey = refocus ? document.activeElement.dataset.key : undefined;
  $('recent-list').replaceChildren(...preferences.recent.map((entry) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.label;
    button.title = entry.label;
    button.dataset.key = `${entry.corpus}:${entry.id}`;
    button.addEventListener('click', () => openRecent(entry));
    item.append(button);
    return item;
  }));
  $('recent').hidden = preferences.recent.length === 0;
  const chips = [...$('recent-list').querySelectorAll('button')];
  const target = chips.find((chip) => chip.dataset.key === focusedKey) || chips[0];
  if (refocus && target) target.focus();
}

const sales = (count) => `${count} ${count === 1 ? 'sale' : 'sales'}`;
// Where an amount falls on the lowest–highest line, in percent; a single price has no span and sits in the middle.
const rangePercent = (summary, value) => (summary.max > summary.min ? ((value - summary.min) / (summary.max - summary.min)) * 100 : 50);

// A link to one lot on acsearch, in a new tab.
function lotLink(sale, text) {
  const link = document.createElement('a');
  link.href = `https://www.acsearch.info/search.html?id=${encodeURIComponent(sale.id)}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = text;
  return link;
}

// What the filters left out of the statistics, in the panel's own words; nothing is said about a filter that dropped no row. The rows counted are the
// ones the median itself rests on — the period on show — and a row the collector counted by hand counts here too, so the line and the median beside it
// say the same thing. A page that names the reference nowhere is counted whole instead, and says so.
function filterLines(periodLots, reasonFor, { name, denomination, citing, uncited }) {
  const total = periodLots.length;
  const kept = (reason) => periodLots.filter((sale) => reasonFor(sale) !== reason).length;
  if (uncited) return [`No result text names ${name}, so all ${total} ${total === 1 ? 'result is' : 'results are'} counted.`];
  const lines = [];
  const cited = citing ? kept('not-cited') : total;
  if (cited < total) lines.push(`${cited} of ${total} ${total === 1 ? 'result cites' : 'results cite'} ${name}`);
  const named = denomination ? kept('other-denomination') : total;
  if (named < total) lines.push(`${named} of ${total} ${total === 1 ? 'result names' : 'results name'} “${denomination}”`);
  return lines;
}

// The filter lines as a screen reader hears them, each its own sentence.
const spokenFilters = (filters) => filters.map((line) => (line.endsWith('.') ? line : `${line}.`)).join(' ');

// Draws the chosen period from the page's lots, with no request, as of the collector's own date: everything on the panel follows the period
// except the trend and the last sale, which come from the whole page. A period without a counted sale keeps only the buttons, the trend and the
// last sale. The announcement names a period other than All, and All too when the collector has just chosen it (named).
// The card comes from the current state at every redraw, never from the one frozen at the first: a lookup still running when the prices arrived
// verifies it a moment later, and Copy summary must head the text with that label.
function renderPrices(lots, currency, term, named = false, context = shownPrices?.context ?? researchContext, card = priceCard(context)) {
  if (!context) return;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const now = localDay(new Date());
  const period = PERIODS.find((entry) => entry.value === preferences.period);
  const reference = context.reference;
  const name = referenceName(reference);
  // The whole page, before a filter or a hand decision: how far it reaches is the page's own fact, not the median's.
  const pageSummary = summarise(lots, currency);
  const eligibleLots = pageSummary.priced;
  // The rows the median rests on, before any filter: everything counted below is counted over these, so the panel's figures agree with each other.
  const periodLots = lotsInPeriod(eligibleLots, period.value, now);
  // Only a verified card carries a denomination to offer, and only one a whole-word match can tell from an ordinary word.
  const denomination = filterableDenomination(card.denomination);
  $('denomination-row').hidden = !denomination;
  $('denomination-label').textContent = denomination ? `Only results naming “${denomination}”` : '';
  $('denomination-filter').checked = onlyDenomination && Boolean(denomination);
  const wanted = onlyDenomination ? denomination : '';
  // The citation filter judges the reference the card is about, so it only applies while the term still searches it: a term the collector edited to
  // find something else is his own search, and every row it found is counted. It also never empties the statistics — a page whose text names the
  // reference nowhere (a provider that gives no lot text, a layout nobody reads any more) is counted whole and says so.
  const searched = filtersCitations(reference) && searchesReference(term, reference);
  const uncited = searched && periodLots.length > 0 && !periodLots.some((sale) => citesReference(sale.description, reference));
  const citing = searched && onlyCiting && !uncited;
  $('citing-row').hidden = !searched;
  $('citing-label').textContent = searched ? `Only results citing ${name}` : '';
  $('citing-filter').checked = onlyCiting;
  // A row that does not cite the reference is no sale of this type; with the toggle on, nor is one that never names the denomination. Either can
  // still be counted by hand, and Reset restores this default rather than an empty set.
  priceCuration.filter((sale) => (citing && !citesReference(sale.description, reference) ? 'not-cited'
    : wanted && !namesDenomination(sale.description, wanted) ? 'other-denomination' : null));
  const includedLots = priceCuration.included(eligibleLots);
  const page = summarise(includedLots, currency);
  const summary = summarise(lotsInPeriod(includedLots, period.value, now), currency);
  const median = money.format(summary.median);
  $('median-amount').textContent = median;
  $('median-currency').textContent = currency;
  $('median-currency').hidden = median.includes(currency);
  const { count } = summary;
  const empty = count === 0;
  const visibility = pricePanelVisibility(count, eligibleLots.length);
  for (const id of ['median-line', 'range-block', 'check-row', 'check-result', 'copy-summary']) $(id).hidden = !visibility.statistics;
  $('sale-details').hidden = !visibility.curation;
  // How far to trust the median (its strength, the sales it rests on and their years), then what those were drawn from. Lots with no price at all
  // (unsold, unpriced) are told apart from prices that could not be counted (another currency, an unread format).
  const years = summary.earliest === null ? '' : `, ${summary.earliest === summary.latest ? summary.earliest : `${summary.earliest}–${summary.latest}`}`;
  const counts = priceCuration.counts(periodLots);
  // Nothing counted: either the period holds no sale with a price, or every sale in it is excluded. Reset undoes only the collector's own decisions,
  // so it is offered as the way back only where it would leave a sale counted.
  const noPeriodSales = period.years ? `No sales with a price in the last ${period.years} years.` : 'No included sales have a recorded price.';
  const none = periodLots.length === 0 ? noPeriodSales
    : priceCuration.changed() && priceCuration.defaultIncluded(periodLots).length > 0 ? 'All sales are excluded. Reset to include them.'
      : 'No results are counted. Include one under Inspect sales.';
  $('sale-strength').textContent = empty ? none : `${count} recorded ${count === 1 ? 'sale' : 'sales'}${years}`;
  const filters = filterLines(periodLots, priceCuration.reasonFor, { name, denomination: wanted, citing, uncited });
  $('cited-count').textContent = filters.join(' · ');
  $('cited-count').hidden = filters.length === 0;
  const trend = trendOf(includedLots, currency, now);
  $('sale-trend').textContent = trend ? trendText(trend, money.format) : '';
  $('sale-trend').hidden = !trend;
  const last = lastSale(page);
  $('last-sale').hidden = !last;
  if (last) {
    // The name keeps the date it shows, so a screen reader or voice control still finds it.
    const link = lotLink(last, last.date);
    link.setAttribute('aria-label', `Last sale ${last.date} on acsearch, opens a new tab`);
    $('last-sale').replaceChildren('Last sale ', link, ` · ${money.format(last.amount)}`);
  }
  // What the panel was drawn from: the results themselves, before any filter left one out, so the "+" and the note below say how much acsearch held.
  // Lots with no price at all (unsold, unpriced) are told apart from prices that could not be counted (another currency, an unread format).
  const drawnFrom = summarise(lotsInPeriod(lots, period.value, now), currency);
  const { total, unpriced } = drawnFrom;
  const skipped = total - drawnFrom.count - unpriced;
  // "+" only when every lot on the page falls in the period, so acsearch may hold more of them.
  let drawn = `Out of ${total}${pageSummary.capped ? '+' : ''} ${total === 1 ? 'match' : 'matches'}${period.years ? ` from the last ${period.years} years` : ''} for “${term}”`;
  if (unpriced) drawn += ` · ${unpriced} without a price`;
  if (skipped) drawn += ` · ${skipped} not counted`;
  $('sale-period').textContent = drawn;
  $('curation-count').textContent = `${counts.included} included · ${counts.excluded} excluded`;
  $('reset-curation').disabled = !priceCuration.changed();
  $('range-amount').textContent = `${money.format(summary.lowerQuartile)}–${money.format(summary.upperQuartile)}`;
  // The whisker's ends in numbers: a quarter of the sales lie above the middle 50%, so the top sale is printed too.
  $('range-all').textContent = count === 1 ? `1 sale ${money.format(summary.min)}` : `All ${count} sales ${money.format(summary.min)}–${money.format(summary.max)}`;
  const span = summary.max - summary.min;
  const percent = (value) => rangePercent(summary, value);
  $('range-box').style.left = `${percent(summary.lowerQuartile)}%`;
  $('range-box').style.width = `${span > 0 ? percent(summary.upperQuartile) - percent(summary.lowerQuartile) : 0}%`;
  $('range-median').style.left = `${percent(summary.median)}%`;
  // A median for each grade the dealers gave, under the range it splits up; only the rows now counted, and only a bucket that rests on enough of them.
  const grades = gradeMedians(lotsInPeriod(includedLots, period.value, now), currency);
  $('grade-medians').replaceChildren(...grades.map((bucket) => {
    const line = document.createElement('li');
    line.textContent = gradeText(bucket, money.format);
    return line;
  }));
  $('grade-medians').hidden = grades.length === 0 || !visibility.statistics;
  $('sale-count').textContent = String(count);
  let restore = null;
  $('sale-list').replaceChildren(...periodLots.map((sale) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.append(`${sale.date} · `, lotLink(sale, sale.title || `Lot ${sale.id}`));
    const amount = document.createElement('strong');
    amount.textContent = money.format(sale.amount);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'text-button sale-toggle';
    const excluded = priceCuration.isExcluded(sale);
    row.classList.toggle('excluded', excluded);
    toggle.textContent = excluded ? 'Include' : 'Exclude';
    toggle.setAttribute('aria-label', `${excluded ? 'Include' : 'Exclude'} ${sale.title || `lot ${sale.id}`} ${excluded ? 'in' : 'from'} statistics`);
    toggle.addEventListener('click', () => {
      if (excluded) priceCuration.include(sale); else priceCuration.exclude(sale);
      // The list is rebuilt from scratch, so the keyboard is put back on this row's own button, as Recent does with its chips.
      focusSaleId = stableResultId(sale);
      renderPrices(lots, currency, term, true, context);
    });
    if (focusSaleId === stableResultId(sale)) restore = toggle;
    row.append(label, amount, toggle);
    return row;
  }));
  focusSaleId = null;
  if (restore) restore.focus();
  // About the page, whatever the period and whatever the filters left: it holds only the 100 most recent lots.
  $('price-note').textContent = pageSummary.capped
    ? 'Hammer prices exclude buyer’s fees, tax and shipping. Only the 100 most recent sales are counted.'
    : 'Hammer prices exclude buyer’s fees, tax and shipping.';
  shownPrices = { context, card, lots, currency, term, summary, extras: { period, last, trend, filters, grades } };
  showCheck();
  $('prices-panel').hidden = false;
  const spoken = median.includes(currency) ? median : `${median} ${currency}`;
  const heading = named || period.years ? `${period.label}: median` : 'Median';
  const left = filters.length ? ` ${spokenFilters(filters)}` : '';
  $('announcement').textContent = empty ? `${none}${left}` : `${heading} ${spoken} from ${count} recorded ${count === 1 ? 'sale' : 'sales'}.${left}`;
}

function setCoinArchivesBusy(busy) {
  $('coinarchives-prices-button').disabled = busy;
  $('coinarchives-prices-label').textContent = busy ? 'Fetching…' : 'Get CoinArchives prices';
}

const coinArchivesCounts = (outcome, currency) => {
  const otherCurrencies = Object.entries(outcome.availableCurrencyCounts ?? {}).filter(([code]) => code !== currency)
    .map(([code, count]) => `${count} ${code}`).join(', ');
  const excluded = outcome.excluded ?? {};
  return [`${outcome.matchedCount} public results matched · ${outcome.renderedCount} rendered`, `${outcome.selectedLots.length} completed ${currency} prices available`,
    otherCurrencies && `Other currencies not converted: ${otherCurrencies}`, excluded.unpriced && `${excluded.unpriced} unpriced`,
    excluded.upcoming && `${excluded.upcoming} upcoming`, excluded.toBePosted && `${excluded.toBePosted} price${excluded.toBePosted === 1 ? '' : 's'} to be posted`,
    excluded.malformedPrice && `${excluded.malformedPrice} unreadable price${excluded.malformedPrice === 1 ? '' : 's'}`,
    excluded.malformedDate && `${excluded.malformedDate} unreadable date${excluded.malformedDate === 1 ? '' : 's'}`,
    excluded.futureDate && `${excluded.futureDate} future-dated`, excluded.duplicateId && `${excluded.duplicateId} duplicate ${excluded.duplicateId === 1 ? 'row' : 'rows'}`,
    excluded.conflictingId && `${excluded.conflictingId} conflicting ${excluded.conflictingId === 1 ? 'row' : 'rows'}`].filter(Boolean).join(' · ');
};

function renderCoinArchivesPrices(shown = shownCoinArchivesPrices, named = false) {
  if (!shown || shown.context !== researchContext) return;
  const { outcome, currency, context } = shown;
  const period = PERIODS.find((entry) => entry.value === preferences.period);
  const reference = context.reference;
  const name = referenceName(reference);
  // The public search takes one spelling of the citation, so a row that never cites the reference is no sale of this type here either. It reads by
  // the same rules as the acsearch panel, under the same toggle, and a row left out stays in the list below, one click from being counted.
  const periodLots = lotsInPeriod(outcome.selectedLots, period.value, localDay(new Date()));
  const searched = filtersCitations(reference) && searchesReference(outcome.term, reference);
  const uncited = searched && periodLots.length > 0 && !periodLots.some((sale) => citesReference(sale.description, reference));
  const citing = searched && onlyCiting && !uncited;
  coinArchivesCuration.filter((sale) => (citing && !citesReference(sale.description, reference) ? 'not-cited' : null));
  const used = coinArchivesCuration.included(periodLots);
  const summary = summarise(used.map((lot) => ({ ...lot, price: String(lot.amount) })), currency);
  summary.priced = used;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const median = summary.count ? money.format(summary.median) : '—';
  for (const radio of $('period').elements) radio.checked = radio.value === preferences.period;
  $('coinarchives-query').textContent = `Query: ${outcome.term}`;
  $('coinarchives-median').textContent = summary.count ? median : '';
  $('coinarchives-median-line').hidden = summary.count === 0;
  $('coinarchives-median-currency').textContent = summary.count && !median.includes(currency) ? currency : '';
  const dates = used.map(({ date }) => date).sort();
  const formatDate = (date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  const dateSpan = dates.length ? `, ${dates[0] === dates.at(-1) ? formatDate(dates[0]) : `${formatDate(dates[0])}–${formatDate(dates.at(-1))}`}` : '';
  $('coinarchives-sample').textContent = summary.count ? `${period.label}: ${summary.count} recorded ${summary.count === 1 ? 'sale' : 'sales'}${dateSpan}`
    : `${period.label}: No recorded sales in this period.`;
  $('coinarchives-coverage').textContent = 'Coverage: auctions added in the past 6 months; first 100 results.';
  $('coinarchives-counts').textContent = coinArchivesCounts(outcome, currency);
  const filters = filterLines(periodLots, coinArchivesCuration.reasonFor, { name, citing, uncited });
  $('coinarchives-cited').textContent = filters.join(' · ');
  $('coinarchives-cited').hidden = filters.length === 0;
  const counts = coinArchivesCuration.counts(periodLots);
  $('coinarchives-curation-count').textContent = `${counts.included} included · ${counts.excluded} excluded`;
  $('coinarchives-sale-count').textContent = String(summary.count);
  $('coinarchives-details').hidden = periodLots.length === 0;
  let restore = null;
  $('coinarchives-sale-list').replaceChildren(...periodLots.map((sale) => {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = sale.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${sale.date} · ${sale.title || `Lot ${sale.id}`}`;
    const amount = document.createElement('strong');
    amount.textContent = money.format(sale.amount);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'text-button sale-toggle';
    const excluded = coinArchivesCuration.isExcluded(sale);
    row.classList.toggle('excluded', excluded);
    toggle.textContent = excluded ? 'Include' : 'Exclude';
    toggle.setAttribute('aria-label', `${excluded ? 'Include' : 'Exclude'} ${sale.title || `lot ${sale.id}`} ${excluded ? 'in' : 'from'} statistics`);
    toggle.addEventListener('click', () => {
      if (excluded) coinArchivesCuration.include(sale); else coinArchivesCuration.exclude(sale);
      // The list is rebuilt from scratch, so the keyboard is put back on this row's own button, as the acsearch list does.
      focusSaleId = stableResultId(sale);
      renderCoinArchivesPrices(shown, true);
    });
    if (focusSaleId === stableResultId(sale)) restore = toggle;
    row.append(link, amount, toggle);
    return row;
  }));
  focusSaleId = null;
  if (restore) restore.focus();
  $('coinarchives-source-link').href = outcome.url;
  $('coinarchives-prices-error').hidden = true;
  $('coinarchives-prices-panel').hidden = false;
  shownCoinArchivesPrices = { context, outcome, currency, summary };
  const left = filters.length ? ` ${spokenFilters(filters)}` : '';
  if (named) $('announcement').textContent = summary.count
    ? `${period.label}: CoinArchives median ${median} from ${summary.count} recorded ${summary.count === 1 ? 'sale' : 'sales'}.${left}`
    : `CoinArchives: No recorded sales in this period.${left}`;
}

function showCoinArchivesError(message) {
  shownCoinArchivesPrices = null;
  $('coinarchives-prices-panel').hidden = true;
  $('coinarchives-prices-error').textContent = message;
  $('coinarchives-prices-error').hidden = false;
  $('announcement').textContent = message;
}

function coinArchivesFailure(outcome, currency) {
  if (outcome.status === 'empty') return `CoinArchives returned no public results for “${outcome.term}”.`;
  if (outcome.status === 'closest') return `CoinArchives showed a different closest search instead of “${outcome.term}”. Open the results to review it.`;
  if (outcome.status === 'no-currency') {
    const available = Object.entries(outcome.availableCurrencyCounts ?? {}).map(([code, count]) => `${count} ${code}`).join(', ');
    return `No completed public sales in ${currency}.${available ? ` Available without conversion: ${available}.` : ''}`;
  }
  if (outcome.status === 'unpriced') return 'CoinArchives returned public results, but no completed sales with a recorded hammer price.';
  if (outcome.status === 'layout') return 'CoinArchives results could not be read. Open the public results to review them.';
  return 'Couldn’t reach CoinArchives. Check your connection and try again.';
}

// Checked against the sales shown, never stored: blank shows nothing, text parsePrice can't read asks for an amount, and a readable one says how many
// sales it tops and its multiple of the median. Its marker sits where it falls on the lowest–highest line, or at an end with a caret pointing out.
// A period without a counted sale hides the check and has nothing to weigh it against.
function showCheck() {
  const text = $('check-amount').value.trim();
  const amount = text && shownPrices?.summary.count ? parsePrice(text, shownPrices.currency) : null;
  $('range-check').hidden = amount === null;
  if (amount === null) { $('check-result').textContent = text ? CHECK_MESSAGE : ''; return; }
  const { summary } = shownPrices;
  const { below, count, ratio } = priceCheck(summary, amount);
  $('check-result').textContent = `Higher than ${below} of ${sales(count)}, ${ratio.toFixed(1)}× the median`;
  const beyond = amount < summary.min ? 'low' : amount > summary.max ? 'high' : '';
  $('range-check').style.left = `${beyond === 'low' ? 0 : beyond === 'high' ? 100 : rangePercent(summary, amount)}%`;
  $('range-check').classList.toggle('beyond-low', beyond === 'low');
  $('range-check').classList.toggle('beyond-high', beyond === 'high');
}

function showPricesNote(message, withSignIn) {
  $('prices-note-text').textContent = message;
  $('signin-link').hidden = !withSignIn;
  $('prices-note').hidden = false;
  $('announcement').textContent = message;
}

function showPricesError(message) {
  $('prices-error').textContent = message;
  $('prices-error').hidden = false;
}

function beginResearch(reference, perform, note = '', identity = null) {
  clearOutput();
  const hasPrices = reference && initialisePriceResearch(reference, identity);
  run(perform, note, reference);
  if (hasPrices) fetchAutomaticPrices();
}

async function run(perform, note = '', failedReference = null) {
  markScroll();
  lotNote = note;
  const id = ++requestId;
  const revision = referenceRevision;
  setBusy(true);
  let outcome;
  try { outcome = await perform(); }
  catch { outcome = { status: 'network' }; }
  finally { if (id === requestId) setBusy(false); }
  if (id !== requestId) return;
  if (outcome.status === 'ok') {
    // A card fills the fields from itself, so the acsearch term follows the chosen type: a BIGR card its King and Bop number (title and citation;
    // chips and suggestions carry no parsable Bop label), an OCRE card its RIC fields from its title (a lone "Hadrian 12" hit shows II.3² Hadrian 12),
    // an Other card its text (a chip's text can read as a type reference when Other was chosen by hand).
    const title = outcome.card.corpus === 'ocre' ? parseReference(outcome.card.label) : null;
    if (outcome.card.bop) fillFields({ catalogue: 'Bop', number: outcome.card.bop.series ?? '', volume: '', section: outcome.card.bop.king });
    else if (outcome.card.corpus === 'other') fillFields({ catalogue: 'Other', number: outcome.card.label, volume: '', section: '' });
    // A PELLA title that does not read back ("Price P1") would leave the last reference in the fields, and both searches with it.
    else if (outcome.card.corpus === 'pella' && !parseReference(outcome.card.label)) fillFields({ catalogue: 'Price', number: outcome.card.id.replace(/^price\./, ''), volume: '', section: '' });
    else if (title) fillFields(title);
    renderCard(outcome.card);
    if (researchContext && cardMatchesContext(outcome.card, researchContext)) verifiedPriceCards.set(researchContext, outcome.card);
    if (!researchContext) {
      const reference = referenceFromCard(outcome.card);
      if (reference && initialisePriceResearch(reference, outcome.card)) {
        verifiedPriceCards.set(researchContext, outcome.card);
        fetchAutomaticPrices();
      }
    }
    preferences = rememberRecent(preferences, outcome.card);
    savePreferences();
    renderRecent();
  }
  else if (outcome.status === 'candidates') renderCandidates(outcome.candidates, outcome.corpus, outcome.partial, outcome.personMismatch);
  else if (outcome.status === 'permission') showError(PERMISSION_MESSAGE);
  else if (outcome.status === 'online-required') {
    showError(ONLINE_MESSAGE);
    const button = $('online-fallback');
    button.hidden = false;
    button.disabled = false;
    button.onclick = async () => {
      if (button.disabled) return;
      const access = requestHostAccess([...HOST_ORIGINS]);
      const owner = requestId;
      const expectedRevision = referenceRevision;
      const expectedContext = researchContext;
      button.disabled = true;
      const allowed = await access;
      if (owner !== requestId || expectedRevision !== referenceRevision || expectedContext !== researchContext) return;
      if (!allowed) {
        button.disabled = false;
        showError(PERMISSION_MESSAGE);
        return;
      }
      button.hidden = true;
      $('form-error').hidden = true;
      run(outcome.retry, '', failedReference);
    };
  }
  else if (outcome.status === 'cancelled') return;
  else if (outcome.status === 'too-many') { if (shouldRevealRefine(outcome)) $('refine-reference').open = true; showError(`${outcome.query} matches too many types to list. Type a ruler to narrow it down.`); }
  else if (outcome.status === 'none') showError(`No ${outcome.query} found in ${CORPUS_NAME[outcome.corpus]}. ${NOT_FOUND_HINT[outcome.corpus]}`, 'reference-number');
  else {
    if (revision !== referenceRevision) return;
    const hasFallback = Boolean(researchContext && failedReference);
    showError(catalogueFailureMessage(outcome, hasFallback));
  }
}

async function runPrices(term, currency, { remember = true, context = researchContext } = {}) {
  if (!context || context !== researchContext) return;
  const card = verifiedPriceCards.get(context) ?? context.identity;
  if (remember && card && cardMatchesContext(card, context)) {
    preferences = rememberTerm(preferences, card, term);
    savePreferences();
  }
  requestedPriceContexts.add(context);
  updateAcsearchLink();
  clearAcsearchPrices();
  const id = ++priceRequestId;
  setPricesBusy(true);
  let outcome;
  try { outcome = await fetchPrices({ term, currency, category: searchCategory(context.reference) }); }
  catch { outcome = { status: 'network' }; }
  finally { if (id === priceRequestId) setPricesBusy(false); }
  if (id !== priceRequestId || context !== researchContext) return;
  if (outcome.status === 'ok') { renderPrices(outcome.lots, currency, term, false, context, priceCard(context)); revealAgain('research-prices'); }
  else if (outcome.status === 'signed-out') showPricesNote(SIGN_IN_MESSAGE, true);
  else if (outcome.status === 'empty') showPricesNote(`acsearch returned no sales for “${outcome.term}”. Try a broader term.`, false);
  else if (outcome.status === 'unpriced') {
    const examples = outcome.examples ? ` Unrecognised prices: ${quoteList(outcome.examples)}.` : '';
    showPricesNote(`No hammer prices among the sales acsearch returned for “${outcome.term}”.${examples}`, false);
  }
  else showPricesError(ACSEARCH_NETWORK_MESSAGE);
}

// Checks without prompting; true on a plain page with no permissions API, false if the check fails.
async function hasAcsearchAccess() {
  if (!api?.permissions?.contains) return true;
  try { return (await api.permissions.contains({ origins: [ACSEARCH_ORIGIN] })) === true; }
  catch { return false; }
}

// Called synchronously from a submit handler so the request keeps the user gesture; resolves true without a prompt when access is already granted.
function requestHostAccess(origins) {
  if (!api?.permissions?.request) return Promise.resolve(true);
  let pending;
  try { pending = api.permissions.request({ origins }); } catch (error) { pending = Promise.reject(error); }
  return Promise.resolve(pending).catch(() => {
    try { return Promise.resolve(api.permissions.contains({ origins })).catch(() => true); }
    catch { return true; }
  });
}

// The saved fields, currency, sales period and Recent row: shown at start-up, and again when the lookup window takes a lookup sent to it (below).
function showStored() {
  $('catalogue').value = preferences.catalogue;
  $('currency').value = preferences.currency;
  for (const radio of $('period').elements) radio.checked = radio.value === preferences.period;
  $('reference-number').value = preferences.number;
  fillRicFields(preferences.volume, preferences.section);
  updateFields();
  renderRecent();
  // What is shown here is what was stored, not what he has just typed in.
  guidedTouched = false;
}
showStored();
applyStoredTheme();
syncThemeButton();
// A window opened with ?window=1 (right-click, the pop-out button) can be resized: the page fills it (popup.css) and offers no pop-out of its own.
const parameters = new URLSearchParams(location.search);
const panel = parameters.get('panel') === '1';
const windowed = parameters.get('window') === '1';
document.documentElement.classList.toggle('windowed', windowed);
document.documentElement.classList.toggle('panel-mode', panel);

// Lot text waits for Look up: parseReference would read only a piece of it into the fields.
$('quick-reference').addEventListener('change', () => {
  if (!$('quick-reference').value.trim() || isLot($('quick-reference').value) || !applyQuickReference()) return;
  savePreferences();
  clearOutput();
  $('lookup-prompt').hidden = false;
});
// ArrowUp and ArrowDown (no modifier) bring back the Recent labels while the box is empty or shows one, the caret at the end; typing forgets the
// position, and a recalled label sent unchanged reopens as its chip does (the submit handler).
$('quick-reference').addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const step = recallStep(preferences.recent, recalled, $('quick-reference').value, event.key);
  if (!step) return;
  event.preventDefault();
  referenceRevision += 1;
  clearOutput();
  recalled = step.position;
  clearLot();
  $('quick-reference').value = step.text;
  $('quick-reference').setSelectionRange(step.text.length, step.text.length);
});
// Typing begins a new reference, so neither an old catalogue answer nor its independent price research may arrive over it.
$('quick-reference').addEventListener('input', () => {
  referenceRevision += 1;
  clearOutput();
  recalled = -1;
  clearLot();
  clearRicNote();
  $('form-error').hidden = true;
  $('form-error').textContent = '';
  $('quick-reference').removeAttribute('aria-invalid');
  $('reference-number').removeAttribute('aria-invalid');
});
// A lot description pasted from a dealer page arrives in lines; the one-line box takes it with each break as ". " (oneLine: a break still ends the
// reference above it), up to its 3,000 characters (setRangeText ignores maxlength, so the room is cut here), and the input event does what typing would.
$('quick-reference').addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;
  event.preventDefault();
  const box = $('quick-reference');
  const { selectionStart: start, selectionEnd: end } = box;
  const room = Math.max(box.maxLength - (box.value.length - (end - start)), 0);
  box.setRangeText(oneLine(text).slice(0, room), start, end, 'end');
  box.dispatchEvent(new Event('input', { bubbles: true }));
});
// A guided edit (here and in the form input handler) clears the one-box, so a stale one-box value can never override the correction on the next Look up.
// A new catalogue starts from its defaults: RIC from the first volume with its default section and number, so a remembered volume can't pair with a
// section it lacks; Bop from its default king and number, keeping the hidden volume.
$('catalogue').addEventListener('change', () => {
  referenceRevision += 1;
  const catalogue = $('catalogue').value;
  // Choosing a catalogue is a deliberate move into the guided fields, which then answer for Look up with an empty Reference box.
  guidedTouched = true;
  clearRicNote();
  $('quick-reference').value = '';
  $('reference-number').value = DEFAULT_NUMBER[catalogue];
  if (Object.hasOwn(DEFAULT_SECTION, catalogue)) fillRicFields(catalogue === 'RIC' ? RIC_VOLUMES[0].value : $('ric-volume').value, DEFAULT_SECTION[catalogue]);
  updateFields();
  savePreferences();
  clearOutput();
  clearLot();
  $('lookup-prompt').hidden = false;
});
$('currency').addEventListener('change', () => {
  savePreferences();
  clearPrices();
  updateAcsearchLink();
  $('announcement').textContent = `Currency set to ${$('currency').value}.`;
});
// A listed volume clears a known ruler it lacks (Titus under I²), since blank means any ruler, and says so; Any volume, a volume OCRE does not list
// (a parsed "IV, Part 1") and text that names no known ruler keep it. The form's input handler has already cleared the one-box and the output, and a
// select's change comes after its input, so the announcement stays.
$('ric-volume').addEventListener('change', () => {
  const volume = $('ric-volume').value;
  const ruler = visible('ric-section');
  if (sectionMismatch(ruler, volume)) {
    $('ric-section').value = '';
    ricChanged(`Ruler cleared: ${ruler.trim()} is not in ${$('ric-volume').selectedOptions[0].label}.`);
  }
  savePreferences();
});
$('reference-form').addEventListener('input', (event) => {
  if (!['reference-number', 'ric-volume', 'ric-section'].includes(event.target.id)) return;
  referenceRevision += 1;
  guidedTouched = true;
  clearRicNote();
  $('quick-reference').value = '';
  clearOutput();
  clearLot();
  $('lookup-prompt').hidden = false;
  // Typing a RIC ruler moves the volume to the one that has it (Titus: II.1²), or to Any volume when several do (Hadrian, Antioch), unless the chosen
  // volume has it; text that names no known ruler leaves it alone. Announced here, after clearOutput() has emptied the live region.
  if (event.target.id === 'ric-section' && $('catalogue').value === 'RIC') {
    const volume = volumeFor(visible('ric-section'), $('ric-volume').value);
    if (volume !== $('ric-volume').value) {
      $('ric-volume').value = volume;
      ricChanged(`Volume set to ${$('ric-volume').selectedOptions[0].label}.`);
    }
  }
  savePreferences();
});
$('reference-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const activeRefinedInput = ['ric-section', 'reference-number'].includes(document.activeElement?.id);
  const refinedSubmit = event.submitter?.id === 'refine-lookup-button' || activeRefinedInput;
  if (refinedSubmit) {
    $('quick-reference').value = '';
  } else {
    // A recalled label sent unchanged reopens as its chip does, first: an Other label naming two catalogues, or "Price P1", would read as lot text.
    const entry = preferences.recent[recalled];
    if (entry && entry.label === $('quick-reference').value) { openRecent(entry); return; }
    // Lot text (long, two catalogue keys, or a reference inside other words) is listed instead of read as one reference; showLot's own permission request is still synchronous.
    if (isLot($('quick-reference').value)) { showLot($('quick-reference').value); return; }
    // The button sits beside the Reference box, so an empty box looks up nothing: the stored or example number below it was never typed, and looking it
    // up would open a coin nobody asked about. Fields the collector has chosen or edited himself still answer for it.
    if (!$('quick-reference').value.trim() && !guidedTouched) { clearOutput(); showError(EMPTY_QUICK_MESSAGE, 'quick-reference'); return; }
  }
  clearLot();
  // Parsing and validation stay synchronous so the permission request below is still the first await and keeps the user gesture.
  // The form is novalidate so an unparsed one-box shows QUICK_ERROR instead of the browser's required-field bubble.
  if (!refinedSubmit && !applyQuickReference()) { clearOutput(); showError(QUICK_ERROR, 'quick-reference'); return; }
  if (!$('reference-form').reportValidity()) {
    $('form-error').hidden = true;
    $('form-error').textContent = '';
    $('quick-reference').removeAttribute('aria-invalid');
    return;
  }
  // Other contacts nothing but acsearch, and its card needs no access at all: a refusal leaves the prices to the "Get prices" hint.
  const other = $('catalogue').value === 'Other';
  // Other is only an acsearch search, so text that gives none (blank, ";", no part with a letter and a digit) is refused before it makes a card.
  if (other && !defaultTerm(currentReference())) { clearOutput(); showError(EMPTY_OTHER_MESSAGE, 'reference-number'); return; }
  const reference = currentReference();
  const localRic = reference.catalogue === 'RIC';
  const access = localRic ? null : requestHostAccess(other ? [ACSEARCH_ORIGIN] : [...HOST_ORIGINS]);
  savePreferences();
  beginResearch(reference, async () => {
    const context = researchContext;
    const allowed = localRic ? true : await access;
    if (context !== researchContext) return { status: 'cancelled' };
    if (!allowed && !other) return { status: 'permission' };
    if (allowed && other && context === researchContext && context.priceTicket === priceRequestId && !requestedPriceContexts.has(context)) {
      runPrices(context.term, context.currency, { remember: false, context });
    }
    return localRic ? localFirstType(reference) : lookupType(reference, { cache: labelCache });
  });
});
$('price-term').addEventListener('input', updateAcsearchLink);
$('check-amount').addEventListener('input', showCheck);
// A period is remembered and drawn from the lots on show, never fetched; a typed check amount stays and is weighed again against the new sales.
$('period').addEventListener('change', (event) => {
  preferences = { ...preferences, period: event.target.value };
  savePreferences();
  if (shownPrices) {
    resetCopyLabel();
    renderPrices(shownPrices.lots, shownPrices.currency, shownPrices.term, true);
    showCheck();
  }
  if (shownCoinArchivesPrices) renderCoinArchivesPrices(shownCoinArchivesPrices, true);
});
// writeText is the first call in the click, so it keeps the user gesture; a missing clipboard API throws here and is reported like a refusal.
// Success relabels the button for 2 seconds; a newer copy restarts the timer, and clearPrices() puts the label back at once.
$('copy-summary').addEventListener('click', async () => {
  const shown = shownPrices;
  if (!shown) return;
  try {
    await navigator.clipboard.writeText(summaryText(shown.card, shown.summary, shown.currency, shown.term, shown.extras));
    $('announcement').textContent = 'Summary copied.';
    if (shownPrices !== shown) return;
    resetCopyLabel();
    $('copy-summary').textContent = 'Copied';
    copiedTimer = setTimeout(resetCopyLabel, 2000);
  } catch {
    $('announcement').textContent = COPY_FAILED_MESSAGE;
  }
});
$('prices-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const context = researchContext;
  if (!context || $('prices-button').disabled) return;
  const term = $('price-term').value.trim();
  if (!term) { clearAcsearchPrices(); showPricesError(EMPTY_TERM_MESSAGE); return; }
  const currency = $('currency').value;
  const access = requestHostAccess([ACSEARCH_ORIGIN]);
  clearAcsearchPrices();
  setPricesBusy(true);
  // Every change that bumps priceRequestId goes through clearPrices(), which also resets the button, so returning here never leaves it disabled.
  const ticket = priceRequestId;
  const allowed = await access;
  if (ticket !== priceRequestId) return;
  if (!allowed) { clearAcsearchPrices(); showPricesError(ACSEARCH_PERMISSION_MESSAGE); return; }
  runPrices(term, currency, { context });
});
$('coinarchives-prices-button').addEventListener('click', async () => {
  const context = researchContext;
  if (!context || $('coinarchives-prices-button').disabled) return;
  const access = requestHostAccess([COINARCHIVES_ORIGIN]);
  const ticket = ++coinArchivesRequestId;
  const term = coinArchivesTerm(context.reference) || context.label;
  const section = coinArchivesSection(context.reference);
  const currency = $('currency').value;
  $('coinarchives-prices-error').hidden = true;
  setCoinArchivesBusy(true);
  const allowed = await access;
  if (ticket !== coinArchivesRequestId || context !== researchContext) return;
  if (!allowed) {
    setCoinArchivesBusy(false);
    showCoinArchivesError('Giga Pinax needs permission to contact CoinArchives for public prices. Select “Get CoinArchives prices” again to allow it.');
    return;
  }
  let outcome;
  try { outcome = await fetchCoinArchivesPrices({ term, section, currency }); }
  catch { outcome = { status: 'network', term, section }; }
  if (ticket !== coinArchivesRequestId || context !== researchContext) return;
  setCoinArchivesBusy(false);
  if (outcome.status === 'ok') {
    shownCoinArchivesPrices = { context, outcome, currency };
    renderCoinArchivesPrices();
    revealAgain('research-prices');
  } else showCoinArchivesError(coinArchivesFailure(outcome, currency));
});
$('theme-toggle').addEventListener('click', () => chooseTheme(shownTheme() === 'dark' ? 'light' : 'dark'));
// Browsers fix a toolbar popup's size, so the pop-out shows the popup in a window you can resize and closes itself: the lookup window when one is open,
// else a new one (showInWindow). The window reopens the card it shows by corpus and id (below). A plain page, without the windows API, opens the same
// URL itself.
$('pop-out').addEventListener('click', async () => {
  const url = cardUrlFor(currentCard);
  if (!api?.windows?.create) { window.open(url, '_blank', 'popup,width=440,height=680'); return; }
  let reply = null;
  try { reply = await api.runtime.sendMessage({ type: LOOKUP_LAUNCH_MESSAGE, url }); } catch { /* background unavailable */ }
  if (lookupLaunchSucceeded(reply)) window.close();
  else announce(reply?.message || 'Couldn’t open the lookup window. Try again.');
});
// Both toggles are remembered for this view only, never stored: a redraw reads them, a new lookup keeps them, and nothing leaves the popup. Each
// governs both providers, so the two medians are always drawn from the same rule.
const redrawPrices = () => {
  if (shownPrices) {
    const { lots, currency, term } = shownPrices;
    renderPrices(lots, currency, term, true);
  }
  if (shownCoinArchivesPrices) renderCoinArchivesPrices(shownCoinArchivesPrices, true);
};
$('citing-filter').addEventListener('change', () => {
  onlyCiting = $('citing-filter').checked === true;
  redrawPrices();
});
$('denomination-filter').addEventListener('change', () => {
  onlyDenomination = $('denomination-filter').checked === true;
  redrawPrices();
});
$('reset-curation').addEventListener('click', () => {
  if (!shownPrices) return;
  const { lots, currency, term } = shownPrices;
  priceCuration.reset();
  renderPrices(lots, currency, term, true);
});
// Only matters while following the system: shownTheme reads a stored choice first.
darkScheme.addEventListener('change', syncThemeButton);

// A right-click lookup opens popup.html?q=<selection>: the text goes only into the Reference box, and requestSubmit runs the same submit handler as Look up.
// The pop-out's window names a card instead and reopens it like a Recent chip: with the fields stored alongside it, and without a permission request.
// Either way the cursor then waits in the Reference box (Alt+Shift+G, type, Enter): Firefox popups can ignore autofocus.
function openFrom(search) {
  const selected = queryFromSearch(search) || selectionQuery(new URLSearchParams(search).get('reference'));
  const opened = cardFromSearch(search);
  if (selected) { $('quick-reference').value = selected; $('reference-form').requestSubmit(); }
  else if (opened && CORPORA.includes(opened.corpus)) beginResearch(null, () => localFirstId(opened.corpus, opened.id));
  $('quick-reference').focus();
}
// Another Giga Pinax page saved (the toolbar popup beside a lookup window left open): this page takes up its Recent list and remembered terms, so its
// own next save keeps them. The fields and currency shown here stay as they are.
// A theme chosen there shows here too. A recalled label keeps its place when the list shifts under it, so Enter still reopens it as its chip.
window.addEventListener('storage', (event) => {
  if (event.key === THEME_KEY) { applyStoredTheme(); syncThemeButton(); return; }
  if (event.key !== STORAGE_KEY) return;
  const stored = restorePreferences(event.newValue);
  preferences = { ...preferences, recent: stored.recent, terms: stored.terms };
  if (recalled >= 0) recalled = preferences.recent.findIndex((entry) => entry.label === $('quick-reference').value);
  renderRecent();
});
// One lookup window: while this window is open, a right-click or the pop-out sends it the address it would have opened (showInWindow), read here like
// this page's own; the answer names the window so the sender brings it forward. The toolbar popup doesn't listen, so it never takes one. The window
// first takes up what the sender saved, as a new window does at start-up: a card sent by corpus and id is priced with its own fields, term and currency,
// and this window's older copy is never saved over the sender's Recent list, terms and currency.
if (windowed) api?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (message?.type !== LOOKUP_MESSAGE) return false;
  const search = new URL(String(message.url), location.href).search;
  const opened = cardFromSearch(search);
  // A pop-out with no card only brings this window forward: its fields, currency and card stay as they are.
  if (queryFromSearch(search) || (opened && CORPORA.includes(opened.corpus))) {
    try { preferences = restorePreferences(localStorage.getItem(STORAGE_KEY)); } catch { /* unreadable: keep this window's copy */ }
    recalled = -1;
    $('quick-reference').value = '';
    clearLot();
    showStored();
    openFrom(search);
  }
  Promise.resolve(api.windows.getCurrent()).catch(() => null).then((current) => sendResponse({ windowId: current?.id }));
  return true;
});
openFrom(location.search);
