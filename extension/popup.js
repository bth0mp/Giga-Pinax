import { HOST_ORIGINS, INVISIBLE, buildQuery, fetchSpecimens, filingNote, lookupById, lookupType, parseReference, rpcUrl } from './lookup.js';
import { ACSEARCH_ORIGIN, PERIODS, buildSearchUrl, chooseTerm, citesReference, coinArchivesSection, coinArchivesTerm, coinArchivesUrl, createPriceCuration, defaultTerm, fetchPrices, filterableDenomination, filtersCitations, futureText, gradeMedians, gradeText, isoDay, lastSale, localDay, lotsInPeriod, mediansByYear, namesDenomination, parsePrice, priceCheck, pricePanelVisibility, quotedTerm, quoteList, referenceName, saleDate, searchCategory, searchesReference, stableResultId, summarise, summaryText, trendOf, trendText, ungradedText, upcomingLots, upcomingText } from './prices.js';
import { DEFAULT_NUMBER, DEFAULT_SECTION, STORAGE_KEY, THEME_KEY, recallStep, rememberRecent, rememberedTerm, rememberTerm, restorePreferences } from './preferences.js';
import { BIGR_KINGS, CORPORA, RIC_RULERS, RIC_VOLUMES, VOLUME_OPTIONS, catalogueForCorpus, catalogueOf, isMintOnly, sectionMismatch, selectOptions, volumeFor } from './catalogues.js';
import { LOOKUP_LAUNCH_MESSAGE, LOOKUP_MESSAGE, cardFromSearch, cardUrlFor, lookupLaunchSucceeded, queryFromSearch, selectionQuery } from './selection.js';
import { findReferences, isLot, lotLabel, lotLookup, oneLine } from './lot.js';
import { cardName, displayReference, documentMode, editionName, shouldRevealRefine, wantPillText } from './companion-popup.js';
import { fetchCoinArchivesPrices } from './coinarchives-prices.js';
import { formatMoney, minorDigits } from './core/money.js';
import { openWantsFor, ricSectionKey, wantBadgeText } from './core/wantlist.js';
import { createLocalCatalogue } from './local-catalogue.js';
import { PENDING_KEY, api, forgetPendingReference, hasAcsearchAccess, hasHostAccess, requestHostAccess, sessionArea } from './popup-access.js';
import {
  ACCESS_HINT, ACSEARCH_HOME, ACSEARCH_NETWORK_MESSAGE, ACSEARCH_PERMISSION_MESSAGE, ACSEARCH_TOO_LARGE_MESSAGE, CHECK_MESSAGE,
  COINARCHIVES_HOME, COINARCHIVES_ORIGIN, COPY_FAILED_MESSAGE, EMPTY_OTHER_MESSAGE, EMPTY_QUICK_MESSAGE, EMPTY_TERM_MESSAGE, EXAMPLE_REFERENCES,
  NO_REFERENCES_MESSAGE, OTHER_SUMMARY, PERMISSION_MESSAGE, PRICES_WAIT_MESSAGE, QUICK_ERROR, SIGN_IN_MESSAGE,
  catalogueFailureMessage, coinArchivesFailure, onlineMessage,
} from './popup-messages.js';
import { candidateGroups, coinArchivesCounts, filterLines, folded, lotLink, lotTitle, lotUrl, rangePercent, renderYears, sales, specimenItem, spokenFilters } from './popup-drawing.js';
import { $, applyStoredTheme, chooseTheme, clearRicNote, darkScheme, markScroll, placeAtTop, revealAgain, ricChanged, shownTheme, syncThemeButton } from './popup-shell.js';

const LABELS_KEY = 'giga-pinax-labels-v1';

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
// The acsearch lots not sold yet, as the Upcoming list under the panel shows them: the whole page they came from, so a toggle can redraw the list.
let shownUpcoming = null;
// A search under way, for the filter row above the panel: drawn while acsearch answers from the reference and term already known, so the row is in its
// place before the prices are and their arrival moves nothing (renderPriceFilters). Cleared with the panel.
let pendingPrices = null;
// Watch on an upcoming lot hands it to the other half of this page, which owns the watchlist draft path (companion-popup.js).
const WATCH_EVENT = 'giga-pinax-watch';
let coinArchivesRequestId = 0;
const priceCuration = createPriceCuration('acsearch');
// The public panel curates its own rows: the same filter, the same Include, over the results CoinArchives returned.
const coinArchivesCuration = createPriceCuration('coinarchives');
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
  if (localCatalogue?.serves(corpus) !== true) return lookupById(corpus, id, { cache: labelCache });
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

// A Number or Ruler/King pasted from a dealer page can carry the hidden characters parseReference drops ("23" plus a soft hyphen is no Price 23), so the
// guided fields are read without them: the lookup, its acsearch term, the saved fields and the ruler's volume.
const visible = (id) => $(id).value.replace(INVISIBLE, '');
function currentReference() {
  return { catalogue: $('catalogue').value, number: visible('reference-number'),
    volume: $('ric-volume').value, section: visible('ric-section') };
}

// The default currency is stored in the durable root, written through the background bridge by the
// companion half of this page. The copy kept here is a display cache: a lookup window opens, looks
// up and prices before that bridge can answer, and it has to do so in the currency last chosen
// rather than one the profile held before the durable root existed. The stored preference still
// wins once it arrives (companion-popup.js), which puts it back through the change handler below.
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
  $('reference-label').textContent = catalogueOf(catalogue)?.label;
  $('reference-help').textContent = catalogueOf(catalogue)?.help;
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
// The range a dealer cites ("Hadrian 100-102"), which OCRE titles 658 of its own records over. No guided field holds one,
// so it is kept here for the submit that parsed it to put back on the reference it looks up.
let quickRange = '';
function applyQuickReference() {
  const text = $('quick-reference').value;
  quickRange = '';
  if (!text.trim()) return true;
  const parsed = parseReference(text);
  if (!parsed) return false;
  quickRange = parsed.range ?? '';
  fillFields(parsed);
  return true;
}

function setPricesBusy(busy) {
  $('prices-button').disabled = busy;
  $('prices-label').textContent = busy ? 'Fetching…' : 'Get prices';
}

// While acsearch answers, the median block is drawn with its label, a dash and what is happening, and the range block keeps its room: the panel has
// its final height before the prices are in it, so their arrival moves nothing below the card. Nothing of a previous answer is shown in it.
const LOADING_HIDDEN = ['cited-count', 'sale-trend', 'last-sale', 'sale-period', 'year-medians', 'grade-medians', 'ungraded-count', 'check-row',
  'check-result', 'sale-details', 'copy-summary', 'price-note'];
function showPricesLoading(term, context) {
  pendingPrices = { context, searched: filtersCitations(context.reference) && searchesReference(term, context.reference) };
  renderPriceFilters();
  $('prices-panel').dataset.state = 'loading';
  $('median-amount').textContent = '—';
  $('median-currency').textContent = '';
  $('sale-strength').textContent = 'Fetching acsearch…';
  $('median-line').hidden = false;
  $('range-block').hidden = false;
  for (const id of LOADING_HIDDEN) $(id).hidden = true;
  $('prices-panel').hidden = false;
}

function resetCopyLabel() {
  clearTimeout(copiedTimer);
  $('copy-summary').textContent = 'Copy summary';
}

// A currency re-fetch keeps the collector's own decisions (keepCuration): acsearch and CoinArchives give a lot the same id in every currency.
function clearAcsearchPrices({ keepCuration = false } = {}) {
  priceRequestId += 1;
  if (!keepCuration) priceCuration.reset();
  shownPrices = null;
  keepMedian('acsearch', null);
  shownUpcoming = null;
  pendingPrices = null;
  renderPriceFilters();
  resetCopyLabel();
  $('prices-panel').hidden = true;
  $('prices-panel').dataset.state = '';
  // The dash and "Fetching" of a search this replaces go with it.
  $('median-amount').textContent = '';
  $('sale-strength').textContent = '';
  $('upcoming').hidden = true;
  $('upcoming-list').replaceChildren();
  $('upcoming-status').hidden = true;
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

function clearCoinArchivesPrices({ keepCuration = false } = {}) {
  coinArchivesRequestId += 1;
  if (!keepCuration) coinArchivesCuration.reset();
  shownCoinArchivesPrices = null;
  keepMedian('coinarchives', null);
  renderPriceFilters();
  $('coinarchives-prices-panel').hidden = true;
  $('coinarchives-prices-error').hidden = true;
  $('coinarchives-prices-error').textContent = '';
  $('coinarchives-prices-note').hidden = true;
  $('coinarchives-details').open = false;
  $('coinarchives-prices-button').disabled = false;
  $('coinarchives-prices-label').textContent = 'Get CoinArchives prices';
}

function clearPrices(options) {
  clearAcsearchPrices(options);
  clearCoinArchivesPrices(options);
}

// A basis line's parts, those that apply, as one line.
const basisLine = (...parts) => parts.filter(Boolean).join(' · ');
// Said once, in the basis line, wherever a strip of medians by year is drawn.
const YEARS_BASIS = 'by year: years with at least 3 counted sales';
// A sale's day as acsearch dates it ("01.06.2028"), written out ("1 Jun 2028"); a date that does not read is shown as it came.
const saleDay = (text) => {
  const day = isoDay(text);
  return day ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)) : String(text ?? '');
};

// A day on a list of lots as the Watchlist tab writes a sale day (H-11): "Thu 1 Jun", in the browser's language, with the year only when it is not
// this year; an upcoming lot's day with its weekday, a sale already held without. A date that does not read is shown as it came.
function listDay(text, { weekday = false } = {}) {
  const day = isoDay(text);
  if (!day) return String(text ?? '');
  const options = { day: 'numeric', month: 'short', timeZone: 'UTC', ...(weekday ? { weekday: 'short' } : {}),
    ...(day.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) };
  const date = new Date(`${day}T12:00:00Z`);
  try { return new Intl.DateTimeFormat(navigator.language, options).format(date); } catch { return new Intl.DateTimeFormat('en-GB', options).format(date); }
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
  $('prices-restored').hidden = true;
  // What a Watch said under the Upcoming list belongs to the list it was pressed in, which this clears.
  $('upcoming-saved').hidden = true;
  $('upcoming-saved').replaceChildren();
  clearSpecimens();
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
  // The term searched is shown folded, beside "Change search", exactly as it is written: the panel's lines no longer repeat it.
  $('price-search-term').textContent = $('price-term').value.trim();
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
  // Another coin is another question: both filters come back to their defaults for a new lookup, while a re-fetch of the same one keeps what the collector set.
  onlyCiting = true;
  onlyDenomination = false;
  const chosen = identity ? chooseTerm(reference, rememberedTerm(preferences, identity)) : term;
  researchContext = Object.freeze({ reference: Object.freeze({ ...reference }), label: buildQuery(reference).query, identity, term: chosen,
    currency: $('currency').value, priceTicket: priceRequestId });
  $('price-term').value = chosen;
  // The search runs by itself, so its form starts folded; a note or an error that needs Get prices opens it.
  $('price-search').open = false;
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
  // Nomisma gives a RIC mint both its English names and the lookup opens the card under either, so the card that came back
  // is this reference's card whichever of them was typed ("RIC VII Trier 12" is RIC VII Treveri 12). The want list reads a
  // section through the same helper, so a card and a want never disagree about it.
  if (reference.catalogue === 'RIC') return field(reference.volume) === field(context.reference.volume) && ricSectionKey(reference.section) === ricSectionKey(context.reference.section);
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

// restoring: the last answer drawn again at start-up, which scrolls nothing and asks no site for anything.
function renderCard(card, { restoring = false } = {}) {
  // A reference without type data has no type page and no sides to show, only its prices.
  const other = card.corpus === 'other';
  // The heading writes the reference as it is typed ("RIC I² Nero 306"); the edition it abbreviates is said in the source line.
  $('result-reference').textContent = displayReference(card.label);
  // The card names the catalogue it came out of, so a collector reading "Local PELLA catalogue" knows which bundle answered.
  const source = [card.source === 'local' ? `Local ${catalogueForCorpus(card.corpus).corpusName} catalogue` : '', editionName(card.label)].filter(Boolean).join(' · ');
  $('result-source').textContent = source;
  $('result-source').hidden = !source;
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
  // The coin a save makes is named by its summary line and keeps the reference in its one short spelling.
  // The card's reading goes with it, as the Upcoming rows read it, for the want list: a Bopearachchi card's label is no reference the rules read.
  const reading = referenceFromCard(card);
  globalThis.gigaPinaxWatchlistReference = Object.freeze({
    title: other ? card.label : cardName(card),
    reference: displayReference(card.label),
    pageUrl: other ? (rpc ?? '') : $('type-link').href,
    ...(reading ? { reading: Object.freeze({ ...reading }) } : {}),
  });
  dispatchEvent(new CustomEvent('giga-pinax-card', { detail: globalThis.gigaPinaxWatchlistReference }));
  $('result').hidden = false;
  // Closing the section hides whatever inside it had the keyboard (a refined Search, Enter in a field), and a busy Search may already have lost it to
  // the document; either way it goes to the section's own summary, which stays on screen, rather than back to the top of the popup.
  const focused = document.activeElement;
  const refocus = $('refine-reference').open && (!focused || focused === document.body || $('refine-reference').contains(focused));
  $('refine-reference').open = false;
  if (refocus) $('refine-summary').focus({ preventScroll: true });
  announce(announcement(card));
  if (restoring) return;
  revealAgain('result');
  void showSpecimens(card);
}

// Show specimen photos, switched on in Settings and read from the local storage both pages share: 'on', or anything else for off. Off, a card asks
// nothing. On, a card of one type asks Nomisma once for photographed specimens after it is drawn, so a slow or failed answer never holds the card
// up, and an answer for a card no longer shown is dropped. Nothing about the photos is kept: not the answer, not an image address, not in the Recent
// list and not in Copy summary. Only a granted nomisma.org is asked; the popup never prompts for it here.
const SPECIMEN_PHOTOS_KEY = 'giga-pinax-specimen-photos-v1';
let specimenTicket = 0;
// The shown card's query, cancelled with the card, so a superseded query stops rather than running out its deadline.
let specimenRequest = null;
function specimenPhotosOn() {
  try { return localStorage.getItem(SPECIMEN_PHOTOS_KEY) === 'on'; } catch { return false; }
}

function clearSpecimens() {
  specimenTicket += 1;
  specimenRequest?.abort();
  specimenRequest = null;
  $('specimens').hidden = true;
  $('specimen-list').replaceChildren();
  $('sides-summary').textContent = 'Obverse · reverse';
}

async function showSpecimens(card) {
  clearSpecimens();
  if (card.corpus === 'other' || !specimenPhotosOn()) return;
  const ticket = specimenTicket;
  const shown = () => ticket === specimenTicket && currentCard === card;
  if (!(await hasHostAccess(['https://nomisma.org/*'])) || !shown()) return;
  specimenRequest = new AbortController();
  const specimens = await fetchSpecimens(card, { signal: specimenRequest.signal });
  if (!shown() || !specimens.length) return;
  $('specimen-list').replaceChildren(...specimens.slice(0, 3).map(specimenItem));
  $('specimens').hidden = false;
  // The photos fold with the legends, and the fold's line says they are there.
  $('sides-summary').textContent = 'Obverse · reverse · specimens';
}

// The rows of the list of types on show, with the title each is filtered by and the volume group it sits in (null in a list that is not grouped).
let candidateRows = [];
// A partial RIC search lists every type with the number, so it asks for a choice; near misses and Bop lists stay suggestions. A long RIC list is grouped
// by volume, and where every type came from the bundled data that is said once, beside the count, rather than on every row. Past twelve rows a filter
// narrows them.
function renderCandidates(candidates, corpus, partial, personMismatch = false) {
  $('candidates-label').textContent = personMismatch ? 'No matching ruler found locally. Other types with this reference:' : partial ? 'Choose a type:' : 'Did you mean:';
  const local = candidates.every(({ source }) => source === 'local');
  $('candidates-count').textContent = `${candidates.length} ${candidates.length === 1 ? 'type' : 'types'}${local ? ', local catalogue' : ''}`;
  const groups = candidateGroups(candidates);
  candidateRows = [];
  const row = ({ id, title, source }, split = null, group = null) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    // The whole title is the button's name wherever the row shows only part of it under its volume's heading.
    button.setAttribute('aria-label', title);
    if (split) {
      const ruler = document.createElement('strong');
      ruler.textContent = split.section;
      const rest = document.createElement('span');
      rest.className = 'candidate-rest';
      rest.textContent = split.rest;
      button.append(ruler, ' ', rest);
    } else button.textContent = title;
    // A list mixing bundled and online types still marks the bundled ones.
    if (source === 'local' && !local) {
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
    candidateRows.push({ item, title: folded(title), group });
    return item;
  };
  $('candidate-list').replaceChildren(...(groups ? groups.map(({ name, rows }, index) => {
    const group = document.createElement('li');
    group.className = 'candidate-group';
    const title = document.createElement('p');
    title.className = 'candidate-heading';
    title.id = `candidate-group-${index}`;
    // The heading counts the rows on show under it, so the filter keeps it true (below).
    group.dataset.name = name;
    title.textContent = `${name} · ${rows.length}`;
    const list = document.createElement('ul');
    list.className = 'candidate-rows';
    // The heading names its list, so a screen reader says "RIC IV, list, 8 items".
    list.setAttribute('aria-labelledby', title.id);
    list.append(...rows.map(({ candidate, section, rest }) => row(candidate, { section, rest }, group)));
    group.append(title, list);
    return group;
  }) : candidates.map((candidate) => row(candidate))));
  $('candidate-filter').value = '';
  $('candidate-filter').hidden = candidates.length <= 12;
  $('candidates').hidden = false;
  announce(`${candidates.length} possible matches. Choose one.`);
  revealAgain('candidates');
}

// The filter keeps the rows whose title holds what is typed, and a volume with none of them left goes with its rows. Enter in it filters, never submits
// the form it stands in.
$('candidate-filter').addEventListener('input', () => {
  const wanted = folded($('candidate-filter').value.trim());
  for (const entry of candidateRows) entry.item.hidden = Boolean(wanted) && !entry.title.includes(wanted);
  for (const group of new Set(candidateRows.map((entry) => entry.group).filter(Boolean))) {
    const shown = candidateRows.filter((entry) => entry.group === group && !entry.item.hidden).length;
    group.hidden = shown === 0;
    group.children[0].textContent = `${group.dataset.name} · ${shown}`;
  }
});
$('candidate-filter').addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });

// A chip, or its label recalled into the Reference box and sent unchanged, is a user action like a "Did you mean" choice: it fills the guided fields
// from the stored title (so the acsearch term follows it), reopens the type by corpus and id (a BIGR title or an SC "Ad." title would not read back) and makes
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
  // A corpus the package carries answers without a request, so nothing is asked of the browser before the lookup;
  // one it does not carry (Bopearachchi, whose citations only the online records hold) needs access as it always did.
  const bundled = localCatalogue?.serves(buildQuery(reference).corpus) === true;
  const access = bundled ? null : requestHostAccess(other ? [ACSEARCH_ORIGIN] : [...HOST_ORIGINS], { remember: true });
  beginResearch(reference, async () => {
    const context = researchContext;
    const allowed = bundled ? true : await access;
    if (pick !== lotPick || context !== researchContext) return { status: 'cancelled' };
    if (!allowed && !other) return { status: 'permission' };
    if (allowed && other && context.priceTicket === priceRequestId && !requestedPriceContexts.has(context)) runPrices(context.term, context.currency, { remember: false, context });
    return bundled ? localFirstType(reference) : lookupType(reference, { cache: labelCache, localProvider: localCatalogue });
  }, note);
}

// Lot text lists every reference in it, in text order. A single type-data reference opens at once (the user's 0.18 decision), its row marked
// chosen; several wait for a pick, so a lot fetches nothing it wasn't asked for.
function showLot(text) {
  const { references, rulers } = findReferences(text);
  forgetAnswer();
  answered = true;
  typingReference = false;
  showRecent();
  renderFirstRun();
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
    // The chip writes the reference as the card heading does; its tooltip keeps the catalogue's own title.
    button.textContent = displayReference(entry.label);
    button.title = entry.label;
    button.dataset.key = `${entry.corpus}:${entry.id}`;
    button.addEventListener('click', () => openRecent(entry));
    item.append(button);
    return item;
  }));
  showRecent();
  renderFirstRun();
  const chips = [...$('recent-list').querySelectorAll('button')];
  const target = chips.find((chip) => chip.dataset.key === focusedKey) || chips[0];
  if (refocus && target) target.focus();
}

// Recent stands under the Reference row, one line of chips with the rest behind More. It steps aside while a new reference is being typed, and comes
// back with the lookup's answer or an emptied box.
let typingReference = false;
function showRecent() {
  $('recent').hidden = preferences.recent.length === 0 || typingReference;
  const list = $('recent-list');
  const expanded = $('recent').classList.contains('expanded');
  // More is offered only where the line hides a chip.
  $('recent-more').hidden = $('recent').hidden || (!expanded && !(list.scrollHeight > list.clientHeight + 1));
}
$('recent-more').addEventListener('click', () => {
  const expanded = !$('recent').classList.contains('expanded');
  $('recent').classList.toggle('expanded', expanded);
  $('recent-more').textContent = expanded ? 'Less' : 'More';
  $('recent-more').setAttribute('aria-expanded', String(expanded));
});

// The examples are for a popup that has looked nothing up yet: they go with the first answer of any kind (a card, a list of types, an error) or a
// Recent row, and while the box holds text.
let answered = false;
function renderFirstRun() {
  $('first-run').hidden = answered || preferences.recent.length > 0 || Boolean($('quick-reference').value.trim());
}

// An example chip looks up as if typed and sent: the box shows it, and the lookup runs through Look up's own handler.
$('example-list').replaceChildren(...EXAMPLE_REFERENCES.map((example) => {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = example;
  button.addEventListener('click', () => {
    $('quick-reference').value = example;
    $('quick-reference').dispatchEvent(new Event('input', { bubbles: true }));
    $('quick-reference').focus({ preventScroll: true });
    $('reference-form').requestSubmit();
  });
  item.append(button);
  return item;
}));

// The filters an acsearch page is drawn with, for the median and the Upcoming list alike.
// Only a verified card carries a denomination to offer, and only one a whole-word match can tell from an ordinary word.
// The citation filter judges the reference the card is about, so it only applies while the term still searches it: a term the collector edited to
// find something else is his own search, and every row it found is counted. It also never empties the statistics — a page whose text names the
// reference nowhere (a provider that gives no lot text, a layout nobody reads any more) is counted whole and says so. Whether the text can be read
// at all is a fact about the page acsearch returned, not about the period on show: a period of that page holding no citation is simply a period
// without a sale of this type, and the count beside the empty median says so.
function acsearchFilter(lots, term, reference, card) {
  const denomination = filterableDenomination(card.denomination);
  const wanted = onlyDenomination ? denomination : '';
  const searched = filtersCitations(reference) && searchesReference(term, reference);
  const unsearched = filtersCitations(reference) && !searched;
  const uncited = searched && lots.length > 0 && !lots.some((sale) => citesReference(sale.description, reference));
  const citing = searched && onlyCiting && !uncited;
  const passes = { citing: (sale) => citesReference(sale.description, reference), denomination: (sale) => !String(sale.description ?? '').trim() || namesDenomination(sale.description, wanted) };
  const reason = (sale) => (citing && !passes.citing(sale) ? 'not-cited' : wanted && !passes.denomination(sale) ? 'other-denomination' : null);
  return { denomination, wanted, searched, unsearched, uncited, citing, passes, reason };
}

// The lots on the page that are not sold yet, under the panel: only those the median's own filters would count, and the filter line in the median's
// own words over them. Nothing is fetched for it and nothing a collector decided by hand applies, since none of these rows is a sale to include.
// Each row links the lot on acsearch and offers Watch; the list is the page's, so the 100-lot cap holds for it too.
// The want list, as the other half of this page hands it over (G-22): an Upcoming row citing a wanted type says "On your want list", matched by the
// catalogue rules against the card - only once a card of one type has been verified for this research, so a list of candidates, or a reference
// still waiting for its card, marks nothing - and against the row's own citation of it. Nothing is fetched for it.
let wantList = Array.isArray(globalThis.gigaPinaxWants) ? globalThis.gigaPinaxWants : [];
window.addEventListener('giga-pinax-wants', (event) => {
  wantList = Array.isArray(event.detail) ? event.detail : [];
  if (shownUpcoming?.context === researchContext) renderUpcoming(shownUpcoming.lots, shownUpcoming.term);
});
function wantedForContext(context) {
  const card = verifiedPriceCards.get(context);
  const reference = card ? referenceFromCard(card) : null;
  return reference ? openWantsFor(wantList, reference) : [];
}

function renderUpcoming(lots, term, context = researchContext, card = priceCard(context)) {
  if (!context) return [];
  const { denomination, wanted, searched, unsearched, uncited, citing, passes, reason } = acsearchFilter(lots, term, context.reference, card);
  const wants = wantedForContext(context);
  const wantWords = wantBadgeText(wants, navigator.language);
  const wantPill = wantPillText(wants, navigator.language);
  const upcoming = upcomingLots(lots, new Date());
  const listed = upcoming.filter((sale) => reason(sale) === null);
  const filters = filterLines(upcoming, { reasonFor: reason }, { name: referenceName(context.reference), denomination: wanted, citing, uncited, unsearched, passes });
  $('upcoming-filtered').textContent = filters.join(' · ');
  $('upcoming-filtered').hidden = filters.length === 0;
  $('upcoming-list').replaceChildren(...listed.map((sale) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    const day = listDay(sale.date, { weekday: true });
    const title = lotTitle(sale);
    label.append(`${day} · `, lotLink(sale, title));
    const watch = document.createElement('button');
    watch.type = 'button';
    watch.className = 'text-button sale-toggle';
    watch.textContent = 'Watch';
    watch.setAttribute('aria-label', `Watch ${title}, sale on ${day}`);
    watch.addEventListener('click', () => watchUpcoming(sale, context));
    // A row citing the wanted type carries the card's want pill after its title (H-05), its whole terms the tooltip; its Watch saves it in one step,
    // as on any other row.
    if (wants.length && passes.citing(sale)) {
      const badge = document.createElement('mark');
      badge.className = 'pill want-pill';
      badge.textContent = wantPill;
      badge.title = wantWords;
      label.append(' ', badge);
      watch.setAttribute('aria-label', `Watch ${title}, sale on ${day}. ${wantWords}`);
    }
    row.append(label, watch);
    return row;
  }));
  $('upcoming').hidden = upcoming.length === 0;
  // The toggles stand for rows on show: a page with no lot still to come gives them nothing to govern. Any future row keeps them, even one the filter
  // hides, so the collector can switch the filter off to see it.
  shownUpcoming = upcoming.length ? { context, lots, term, searched, denomination } : null;
  renderPriceFilters();
  return listed;
}

// Watch saves the lot as a watchlist draft through the path Save to watchlist takes (companion-popup.js builds the payload and opens the workspace
// draft for the collector to confirm): the lot's title, the card's reference and the lot's own acsearch page. The sale day goes with it as the
// draft's closing day, a date and never a time, and the workspace offers it as a date-only auction day to confirm.
function watchUpcoming(sale, context) {
  if (context !== researchContext) return;
  $('upcoming-status').hidden = true;
  dispatchEvent(new CustomEvent(WATCH_EVENT, { detail: Object.freeze({ title: lotTitle(sale), reference: displayReference(priceCard(context).label),
    pageUrl: lotUrl(sale), closesAt: isoDay(sale.date) }) }));
}

// A Watch the other half could not save: it speaks the reason and hands it back to be shown here,
// beside the list the collector pressed Watch in. The live region has already spoken it, so this line is only seen.
window.addEventListener('giga-pinax-watch-failed', (event) => {
  $('upcoming-status').textContent = String(event.detail?.message ?? '');
  $('upcoming-status').hidden = $('upcoming').hidden || !$('upcoming-status').textContent;
});

// The two toggles stand above both providers' panels: one state governs both medians, and either panel may be the only one a collector fetched — the
// public CoinArchives search is the whole of the signed-out path. Each is offered while a panel on show has rows it applies to.
function renderPriceFilters() {
  const shown = shownPrices ?? shownCoinArchivesPrices ?? shownUpcoming ?? pendingPrices;
  // The Upcoming list follows the same toggles, and on a page without a counted price it is the only thing they govern.
  const citing = Boolean(shownPrices?.searched || shownCoinArchivesPrices?.searched || shownUpcoming?.searched || pendingPrices?.searched);
  // Both panels filter on the denomination the verified card carries, so either may be the one offering the toggle; a search under way offers the
  // one its card carries as soon as the card is verified, as the answer will.
  const pendingDenomination = pendingPrices ? filterableDenomination(priceCard(pendingPrices.context).denomination) : '';
  const denomination = shownPrices?.denomination || shownCoinArchivesPrices?.denomination || shownUpcoming?.denomination || pendingDenomination || '';
  // Each toggle is a pill in the row with the sales period: its name short on the pill, the whole sentence its tooltip.
  $('citing-row').hidden = !citing;
  $('citing-label').textContent = citing ? `Citing ${referenceName(shown?.context?.reference ?? {})}` : '';
  $('citing-row').title = citing ? `Only results citing ${referenceName(shown?.context?.reference ?? {})}` : '';
  $('citing-filter').checked = onlyCiting;
  $('denomination-row').hidden = !denomination;
  $('denomination-label').textContent = denomination ? `Naming “${denomination}”` : '';
  $('denomination-row').title = denomination ? `Only results naming “${denomination}”` : '';
  $('denomination-filter').checked = onlyDenomination && Boolean(denomination);
  $('price-filters').hidden = !citing && !denomination;
}

// The panels' figures are hammer prices in whole units, as acsearch and CoinArchives print them, and medians rounded to the unit. They are written
// by the one page rule, formatMoney in the browser's language with the narrow sign, and keep no places a rounded figure does not have. A figure
// that is no amount at all writes a dash rather than taking the panel down.
function panelMoney(currency) {
  const scale = 10 ** (minorDigits(currency) ?? 2);
  return (value) => {
    try { return formatMoney({ currency, minor: Math.round(value) * scale }, navigator.language, { narrow: true, whole: true }); } catch { return '—'; }
  };
}

// Draws the chosen period from the page's lots, with no request, as of the collector's own date: everything on the panel follows the period
// except the trend and the last sale, which come from the whole page. A period without a counted sale keeps only the buttons, the trend and the
// last sale. The announcement names a period other than All, and All too when the collector has just chosen it (named).
// The card comes from the current state at every redraw, never from the one frozen at the first: a lookup still running when the prices arrived
// verifies it a moment later, and Copy summary must head the text with that label.
function renderPrices(lots, currency, term, named = false, context = shownPrices?.context ?? researchContext, card = priceCard(context)) {
  if (!context) return;
  const money = { format: panelMoney(currency) };
  const now = localDay(new Date());
  const period = PERIODS.find((entry) => entry.value === preferences.period);
  const reference = context.reference;
  const name = referenceName(reference);
  // The whole page, before a filter or a hand decision: how far it reaches is the page's own fact, not the median's.
  const pageSummary = summarise(lots, currency);
  const eligibleLots = pageSummary.priced;
  // The rows the median rests on, before any filter: everything counted below is counted over these, so the panel's figures agree with each other.
  const periodLots = lotsInPeriod(eligibleLots, period.value, now);
  const { denomination, wanted, searched, unsearched, uncited, citing, passes, reason } = acsearchFilter(lots, term, reference, card);
  // A row that does not cite the reference is no sale of this type; with the toggle on, nor is one that never names the denomination. Either can
  // still be counted by hand, and Reset restores this default rather than an empty set.
  priceCuration.filter(reason);
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
  const years = summary.earliest === null ? '' : ` · ${summary.earliest === summary.latest ? summary.earliest : `${summary.earliest}–${summary.latest}`}`;
  const counts = priceCuration.counts(periodLots);
  // Nothing counted: either the period holds no sale with a price, or every sale in it is excluded. Reset undoes only the collector's own decisions,
  // so it is offered as the way back only where it would leave a sale counted.
  const noPeriodSales = period.years ? `No sales with a price in the last ${period.years} years.` : 'No included sales have a recorded price.';
  const none = periodLots.length === 0 ? noPeriodSales
    : priceCuration.changed() && priceCuration.defaultIncluded(periodLots).length > 0 ? 'All sales are excluded. Reset to include them.'
      : 'No results are counted. Include one under Inspect sales.';
  $('sale-strength').textContent = empty ? none : `${sales(count)}${years}`;
  const filters = filterLines(periodLots, priceCuration, { name, denomination: wanted, citing, uncited, unsearched, passes });
  $('cited-count').textContent = filters.join(' · ');
  $('cited-count').hidden = filters.length === 0;
  const trend = trendOf(includedLots, currency, now);
  $('sale-trend').textContent = trend ? trendText(trend, money.format) : '';
  $('sale-trend').hidden = !trend;
  const last = lastSale(page);
  $('last-sale').hidden = !last;
  if (last) {
    // The name keeps the date it shows, so a screen reader or voice control still finds it.
    const link = lotLink(last, saleDay(last.date));
    link.setAttribute('aria-label', `Last sale ${saleDay(last.date)} on acsearch, opens a new tab`);
    $('last-sale').replaceChildren(`last ${money.format(last.amount)} on `, link);
  }
  // What the panel was drawn from: the results themselves, before any filter left one out, so the "+" says how much acsearch held. The query is not
  // repeated here: it is shown beside Change search, where it can be edited.
  // Lots with no price at all (unsold, unpriced) are told apart from prices that could not be counted (another currency, an unread format).
  const drawnFrom = summarise(lotsInPeriod(lots, period.value, now), currency);
  const { total, unpriced } = drawnFrom;
  // A lot dated after today is no sale whatever its price field holds: it is named apart (L2's futureText, the words Copy summary uses), not lumped
  // with prices that could not be read.
  const future = drawnFrom.future ?? 0;
  const skipped = total - drawnFrom.count - unpriced - future;
  // "+" only when acsearch may hold more of them: the page is full and no lot on it, listed newest first, is dated before the period starts. One that
  // is proves the page reaches back past the period, so every sale of the period is already on it.
  const reachesBack = lots.some((sale) => saleDate(sale.date) !== null && lotsInPeriod([sale], period.value, now).length === 0);
  let drawn = `${total}${pageSummary.capped && !reachesBack ? '+' : ''} ${total === 1 ? 'match' : 'matches'} on acsearch`;
  if (unpriced) drawn += ` · ${unpriced} without a price`;
  if (future) drawn += ` · ${futureText(drawnFrom)}`;
  if (skipped) drawn += ` · ${skipped} not counted`;
  $('sale-period').textContent = drawn;
  // A narrow panel may cut a stat line short, so each carries its whole text as a tooltip.
  const whole = (...ids) => ids.filter((id) => !$(id).hidden).map((id) => $(id).textContent || [...$(id).children].map((part) => part.textContent ?? part).join('')).join(' · ');
  $('sale-period').hidden = false;
  $('price-note').hidden = false;
  $('stat-sales').title = whole('sale-strength', 'last-sale');
  $('stat-counts').title = whole('cited-count', 'sale-period');
  $('curation-count').textContent = `${counts.included} included · ${counts.excluded} excluded`;
  $('reset-curation').disabled = !priceCuration.changed();
  $('range-amount').textContent = `${money.format(summary.lowerQuartile)}–${money.format(summary.upperQuartile)}`;
  // The whisker's ends in numbers: a quarter of the sales lie above the middle 50%, so the top sale is printed too.
  $('range-all').textContent = count === 1 ? '1 sale' : `all ${money.format(summary.min)}–${money.format(summary.max)}`;
  const span = summary.max - summary.min;
  const percent = (value) => rangePercent(summary, value);
  $('range-box').style.left = `${percent(summary.lowerQuartile)}%`;
  $('range-box').style.width = `${span > 0 ? percent(summary.upperQuartile) - percent(summary.lowerQuartile) : 0}%`;
  $('range-median').style.left = `${percent(summary.median)}%`;
  // A median for each grade the dealers gave, under the range it splits up; only the rows now counted, and only a bucket that rests on enough of them.
  const countedLots = lotsInPeriod(includedLots, period.value, now);
  const grades = gradeMedians(countedLots, currency);
  $('grade-medians').replaceChildren(...grades.map((bucket) => {
    const line = document.createElement('li');
    line.textContent = gradeText(bucket, money.format);
    return line;
  }));
  $('grade-medians').hidden = grades.length === 0 || !visibility.statistics;
  // How much of the sample the buckets leave unsaid, so a thin bucket is never read as the whole of it.
  const ungraded = grades.length ? ungradedText(countedLots) : '';
  $('ungraded-count').textContent = ungraded;
  $('ungraded-count').hidden = !ungraded || $('grade-medians').hidden;
  // The median of each year's counted sales, under the range: the same rows the median rests on, this provider's and this currency's only.
  const byYear = mediansByYear(countedLots, currency);
  renderYears('', byYear, money.format);
  $('sale-count').textContent = String(count);
  let restore = null;
  $('sale-list').replaceChildren(...periodLots.map((sale) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.append(`${listDay(sale.date)} · `, lotLink(sale, sale.title || `Lot ${sale.id}`));
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
      focusSaleId = stableResultId(sale, 'acsearch');
      renderPrices(lots, currency, term, true, context);
    });
    if (focusSaleId === stableResultId(sale, 'acsearch')) restore = toggle;
    row.append(label, amount, toggle);
    return row;
  }));
  focusSaleId = null;
  if (restore) restore.focus();
  // The panel's one basis line, at its foot: what the figures are, how much of acsearch the page holds (only the 100 most recent lots), and which years
  // the strip draws.
  $('price-note').textContent = basisLine('Hammer only, no premium, tax or shipping', pageSummary.capped && 'acsearch returns the 100 most recent sales',
    byYear.length > 1 && YEARS_BASIS);
  const upcoming = renderUpcoming(lots, term, context, card);
  pendingPrices = null;
  shownPrices = { context, card, lots, currency, term, summary, searched, denomination, extras: { period, last, trend, filters, grades, ungraded, years: byYear, upcoming } };
  renderPriceFilters();
  showCheck();
  $('prices-panel').dataset.state = 'ready';
  $('prices-panel').hidden = false;
  keepMedian('acsearch', medianEntry('acsearch', context, currency, summary));
  if (context === researchContext) rememberAnswer();
  const spoken = median.includes(currency) ? median : `${median} ${currency}`;
  const heading = named || period.years ? `${period.label}: median` : 'Median';
  const left = filters.length ? ` ${spokenFilters(filters)}` : '';
  $('announcement').textContent = empty ? `${none}${left}` : `${heading} ${spoken} from ${count} recorded ${count === 1 ? 'sale' : 'sales'}.${left}`;
}

function setCoinArchivesBusy(busy) {
  $('coinarchives-prices-button').disabled = busy;
  $('coinarchives-prices-label').textContent = busy ? 'Fetching…' : 'Get CoinArchives prices';
}

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
  const unsearched = filtersCitations(reference) && !searched;
  // Readable or not is a fact about the page CoinArchives returned, as on the acsearch panel, so a period of it may still hold no citation at all.
  const uncited = searched && outcome.selectedLots.length > 0 && !outcome.selectedLots.some((sale) => citesReference(sale.description, reference));
  const citing = searched && onlyCiting && !uncited;
  // The denomination toggle governs this median too: it is the verified card's own word, and the card is the same one the acsearch panel reads. A
  // public row whose page carried no lot text says nothing about its denomination either, and nothing here is ever dropped on missing data.
  const denomination = filterableDenomination(priceCard(context).denomination);
  const wanted = onlyDenomination ? denomination : '';
  const passes = { citing: (sale) => citesReference(sale.description, reference),
    denomination: (sale) => !String(sale.description ?? '').trim() || namesDenomination(sale.description, wanted) };
  coinArchivesCuration.filter((sale) => (citing && !passes.citing(sale) ? 'not-cited'
    : wanted && !passes.denomination(sale) ? 'other-denomination' : null));
  const used = coinArchivesCuration.included(periodLots);
  const summary = summarise(used.map((lot) => ({ ...lot, price: String(lot.amount) })), currency);
  summary.priced = used;
  const money = { format: panelMoney(currency) };
  const median = summary.count ? money.format(summary.median) : '—';
  for (const radio of $('period').elements) radio.checked = radio.value === preferences.period;
  $('coinarchives-median').textContent = summary.count ? median : '';
  $('coinarchives-median-line').hidden = summary.count === 0;
  $('coinarchives-median-currency').textContent = summary.count && !median.includes(currency) ? currency : '';
  const dates = used.map(({ date }) => date).sort();
  const formatDate = (date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  const dateSpan = dates.length ? ` · ${dates[0] === dates.at(-1) ? formatDate(dates[0]) : `${formatDate(dates[0])}–${formatDate(dates.at(-1))}`}` : '';
  $('coinarchives-sample').textContent = summary.count ? `${period.label}: ${sales(summary.count)}${dateSpan}` : `${period.label}: No recorded sales in this period.`;
  $('coinarchives-counts').textContent = coinArchivesCounts(outcome, currency);
  const filters = filterLines(periodLots, coinArchivesCuration, { name, denomination: wanted, citing, uncited, unsearched, passes });
  $('coinarchives-cited').textContent = filters.join(' · ');
  $('coinarchives-cited').hidden = filters.length === 0;
  const byYear = mediansByYear(used.map((lot) => ({ ...lot, price: String(lot.amount) })), currency);
  renderYears('coinarchives-', byYear, money.format);
  // The public panel's one basis line, with the search it ran: CoinArchives takes one spelling of the citation, and nothing else shows it.
  $('coinarchives-coverage').textContent = basisLine('Hammer only, no premium, tax or shipping, no currency conversion',
    `CoinArchives public results for ${outcome.term}: auctions added in the past 6 months, first 100 results`, byYear.length > 1 && YEARS_BASIS);
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
    link.textContent = `${listDay(sale.date)} · ${sale.title || `Lot ${sale.id}`}`;
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
      focusSaleId = stableResultId(sale, 'coinarchives');
      renderCoinArchivesPrices(shown, true);
    });
    if (focusSaleId === stableResultId(sale, 'coinarchives')) restore = toggle;
    row.append(link, amount, toggle);
    return row;
  }));
  focusSaleId = null;
  if (restore) restore.focus();
  // The heading's results link opens the very search these prices came from.
  $('coinarchives-link').href = outcome.url;
  $('coinarchives-prices-error').hidden = true;
  $('coinarchives-prices-panel').hidden = false;
  shownCoinArchivesPrices = { context, outcome, currency, summary, searched, denomination };
  keepMedian('coinarchives', medianEntry('coinarchives', context, currency, summary));
  renderPriceFilters();
  const left = filters.length ? ` ${spokenFilters(filters)}` : '';
  if (named) $('announcement').textContent = summary.count
    ? `${period.label}: CoinArchives median ${median} from ${summary.count} recorded ${summary.count === 1 ? 'sale' : 'sales'}.${left}`
    : `CoinArchives: No recorded sales in this period.${left}`;
}

function showCoinArchivesError(message) {
  shownCoinArchivesPrices = null;
  keepMedian('coinarchives', null);
  $('coinarchives-prices-panel').hidden = true;
  // The toggles above both panels follow the one that has just gone: a failed re-fetch left the citation switch on screen with no rows behind it.
  renderPriceFilters();
  $('coinarchives-prices-error').textContent = message;
  $('coinarchives-prices-error').hidden = false;
  $('announcement').textContent = message;
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
  $('price-search').open = true;
  $('prices-note-text').textContent = message;
  $('signin-link').hidden = !withSignIn;
  $('prices-note').hidden = false;
  $('announcement').textContent = message;
}

function showPricesError(message) {
  $('price-search').open = true;
  $('prices-error').textContent = message;
  $('prices-error').hidden = false;
}

// A RIC number with no volume, no section and no single ruler names a type in every volume ("RIC 237" is Caracalla's denarius, Vespasian's aureus and
// Constantine's follis), so a median of it would mix them all. Its prices wait for one type: run() prices a card that arrives with no research of its
// own, and a chosen candidate begins research with its own volume and ruler.
const blank = (value) => !String(value ?? '').trim();
// A mint with no volume ("RIC 40 (Ticinum)") is filed in several volumes, so it names no single type either and waits like a bare number.
// A lot row with a dotted letter behind its number ("RIC IV 27 b.") may be the plain type or the lettered one, and the lookup offers both: it names
// no single type until the collector chooses one.
const namesOneType = (reference) => !reference.dottedLetter && (reference.catalogue !== 'RIC' || !blank(reference.volume)
  || (!blank(reference.section) && !isMintOnly(reference.section)) || reference.rulers?.length === 1);

// A Bopearachchi reference is searched on acsearch by what its card says (the king and series BIGR files it under), so its prices wait for the card, as
// a bare RIC number's wait for a type: a card that cannot be had (no network, no access) leaves nothing searched, rather than a median for a query
// nobody checked under an error the collector cannot see.
const pricesWaitForCard = (reference) => reference?.catalogue === 'Bop';

// A choice of types, or too many to list: prices already fetched for the reference mix those types, so they go, and the panel says why.
function setPricesAside() {
  if (!researchContext) return;
  clearAcsearchPrices();
  clearCoinArchivesPrices();
  $('prices-note-text').textContent = PRICES_WAIT_MESSAGE;
  $('prices-note').hidden = false;
}

function beginResearch(reference, perform, note = '', identity = null) {
  forgetAnswer();
  clearOutput();
  typingReference = false;
  showRecent();
  const hasPrices = reference && namesOneType(reference) && !pricesWaitForCard(reference) && initialisePriceResearch(reference, identity);
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
  // A lookup another has replaced: nobody is waiting for this answer, and the reference it was kept for has been typed over.
  if (id !== requestId) { forgetPendingReference(); return; }
  if (outcome.status !== 'cancelled') { answered = true; renderFirstRun(); }
  // The lookup the typed reference was kept for has answered, whatever it answered: only a cancelled lookup, and one still waiting for access, keep it.
  if (!['cancelled', 'permission', 'online-required'].includes(outcome.status)) forgetPendingReference();
  if (outcome.status === 'ok') {
    // A card fills the fields from itself, so the acsearch term follows the chosen type: a BIGR card its King and Bop number (title and citation;
    // chips and suggestions carry no parsable Bop label), an OCRE card its RIC fields from its title (a lone "Hadrian 12" hit shows II.3² Hadrian 12),
    // an Other card its text (a chip's text can read as a type reference when Other was chosen by hand).
    const title = outcome.card.corpus === 'ocre' ? parseReference(outcome.card.label) : null;
    if (outcome.card.bop) fillFields({ catalogue: 'Bop', number: outcome.card.bop.series ?? '', volume: '', section: outcome.card.bop.king });
    else if (outcome.card.corpus === 'other') fillFields({ catalogue: 'Other', number: outcome.card.label, volume: '', section: '' });
    // A PELLA title that does not read back would leave the last reference in the fields, and both searches with it. Every bundled title reads back
    // now that Price P and L numbers are read ("Price P1"), so this is for a title only the online catalogue carries.
    else if (outcome.card.corpus === 'pella' && !parseReference(outcome.card.label)) fillFields({ catalogue: 'Price', number: outcome.card.id.replace(/^price\./, ''), volume: '', section: '' });
    else if (title) fillFields(title);
    renderCard(outcome.card);
    if (researchContext && cardMatchesContext(outcome.card, researchContext)) {
      verifiedPriceCards.set(researchContext, outcome.card);
      // Prices that came back before the card were drawn without one: the denomination to offer and the type URL Copy
      // summary ends with are both the card's, so the panel is drawn again now that this context has one.
      if (shownPrices?.context === researchContext) {
        resetCopyLabel();
        renderPrices(shownPrices.lots, shownPrices.currency, shownPrices.term);
      } else if (shownUpcoming?.context === researchContext) renderUpcoming(shownUpcoming.lots, shownUpcoming.term);
      // A search still under way draws the denomination toggle this card offers now, before its answer lands under it.
      else if (pendingPrices?.context === researchContext) renderPriceFilters();
    }
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
    rememberAnswer();
  }
  else if (outcome.status === 'candidates') {
    if (outcome.partial && researchContext?.reference.catalogue === 'RIC') setPricesAside();
    renderCandidates(outcome.candidates, outcome.corpus, outcome.partial, outcome.personMismatch);
  }
  else if (outcome.status === 'permission') showError(PERMISSION_MESSAGE);
  else if (outcome.status === 'online-required') {
    showError(onlineMessage(outcome.corpus));
    const button = $('online-fallback');
    button.hidden = false;
    button.disabled = false;
    button.onclick = async () => {
      if (button.disabled) return;
      const access = requestHostAccess([...HOST_ORIGINS], { remember: true });
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
  else if (outcome.status === 'too-many') {
    setPricesAside();
    if (shouldRevealRefine(outcome)) $('refine-reference').open = true;
    showError(`${outcome.query} matches too many types to list. Type a ruler to narrow it down.`);
  }
  else if (outcome.status === 'none') showError(`No ${outcome.query} found in ${catalogueForCorpus(outcome.corpus)?.corpusName}. ${catalogueForCorpus(outcome.corpus)?.notFoundHint}`, 'reference-number');
  else {
    if (revision !== referenceRevision) return;
    const hasFallback = Boolean(researchContext && failedReference);
    showError(catalogueFailureMessage(outcome, hasFallback, Boolean(failedReference) && !namesOneType(failedReference)));
  }
  // A lookup that failed is answered by its error, under the box it was typed in: that is what comes into view, never the prices below it.
  if (!$('form-error').hidden) revealAgain('form-error');
}

async function runPrices(term, currency, { remember = true, context = researchContext, keepCuration = false } = {}) {
  if (!context || context !== researchContext) return;
  const card = verifiedPriceCards.get(context) ?? context.identity;
  if (remember && card && cardMatchesContext(card, context)) {
    preferences = rememberTerm(preferences, card, term);
    savePreferences();
  }
  requestedPriceContexts.add(context);
  updateAcsearchLink();
  $('prices-restored').hidden = true;
  clearAcsearchPrices({ keepCuration });
  const id = ++priceRequestId;
  setPricesBusy(true);
  showPricesLoading(term, context);
  let outcome;
  try { outcome = await fetchPrices({ term, currency, category: searchCategory(context.reference) }); }
  catch { outcome = { status: 'network' }; }
  finally { if (id === priceRequestId) setPricesBusy(false); }
  if (id !== priceRequestId || context !== researchContext) return;
  if (outcome.status === 'ok') { renderPrices(outcome.lots, currency, term, false, context, priceCard(context)); revealPrices(); return; }
  // No median to hold a place for: the note below says why, and the filter row drawn for the search goes unless something on show still needs it.
  $('prices-panel').hidden = true;
  $('prices-panel').dataset.state = '';
  pendingPrices = null;
  renderPriceFilters();
  if (outcome.status === 'signed-out') showPricesNote(SIGN_IN_MESSAGE, true);
  else if (outcome.status === 'empty') showPricesNote(`acsearch returned no sales for “${outcome.term}”. Try a broader term.`, false);
  else if (outcome.status === 'unpriced') {
    const examples = outcome.examples ? ` Unrecognised prices: ${quoteList(outcome.examples)}.` : '';
    showPricesNote(`No hammer prices among the sales acsearch returned for “${outcome.term}”.${examples}`, false);
  }
  else showPricesError(outcome.reason === 'too-large' ? ACSEARCH_TOO_LARGE_MESSAGE : ACSEARCH_NETWORK_MESSAGE);
  // A page without a counted price still lists the lots not sold yet; the note is said first, then how many are coming up.
  if (outcome.lots) {
    const listed = renderUpcoming(outcome.lots, term, context);
    if (listed.length) $('announcement').textContent += ` ${upcomingText(listed)}.`;
  }
}

// The card is the answer and stands above the prices, so prices landing under it bring nothing into view: the collector is reading the coin. Only
// prices with no card above them (a lookup that failed, or has not answered yet) are the answer to bring into view.
function revealPrices() {
  if ($('result').hidden && $('form-error').hidden) revealAgain('research-prices');
}

// The last answer, kept for a popup that closes with every click on the page: the box, the card and the acsearch page it was drawn from, in the
// extension's session area, which lives until the browser closes and is never written to disk. A popup opened with nothing sent to it and nothing
// typed draws that answer again at once, from what was kept, and says how old it is; it asks nothing of any site - only Refresh does. A new lookup
// or Refresh replaces it. The side panel and the lookup window share it.
const LAST_ANSWER_KEY = 'giga-pinax-last-answer-v1';
const ANSWER_KEPT_FOR_MS = 30 * 60 * 1000;
// What a price panel shows of its median, for the workspace's bid evidence (read there, defensively, and never stored in a record): one entry per
// provider, keyed by provider, each { reference, provider, currency, median, count, at } with the median in minor units, the reference in the
// short spelling a saved coin carries ("RIC I² Nero 306"), and at in epoch ms. Only a median on show is kept; a panel cleared takes its entry.
const SESSION_MEDIAN_KEY = 'giga-pinax-session-median';
let sessionMedians = {};
const sessionWrite = (items) => { try { void Promise.resolve(sessionArea()?.set(items)).catch(() => {}); } catch { /* the answer is only not kept */ } };
const sessionRemove = (key) => { try { void Promise.resolve(sessionArea()?.remove(key)).catch(() => {}); } catch { /* nothing was kept */ } };
function keepMedian(provider, entry) {
  const had = Object.hasOwn(sessionMedians, provider);
  if (!entry && !had) return;
  const next = { ...sessionMedians };
  if (entry) next[provider] = entry; else delete next[provider];
  sessionMedians = next;
  if (Object.keys(next).length) sessionWrite({ [SESSION_MEDIAN_KEY]: next });
  else sessionRemove(SESSION_MEDIAN_KEY);
}
// A median in minor units: the currency's own places from money.js's table, as the stored money is.
const minorUnits = (amount, currency) => Math.round(amount * 10 ** (minorDigits(currency) ?? 2));
const medianEntry = (provider, context, currency, summary) => (summary.count > 0 && Number.isFinite(summary.median) ? {
  reference: displayReference(priceCard(context).label), provider, currency, median: minorUnits(summary.median, currency), count: summary.count,
  at: context.restoredAt ?? Date.now(),
} : null);

function rememberAnswer() {
  const context = researchContext;
  if (!currentCard || !context) return;
  const prices = shownPrices?.context === context ? shownPrices : null;
  sessionWrite({ [LAST_ANSWER_KEY]: { version: 1, query: $('quick-reference').value, card: currentCard, reference: { ...context.reference },
    term: context.term, currency: prices?.currency ?? context.currency, lots: prices?.lots ?? null, onlyCiting, onlyDenomination,
    shownAt: context.restoredAt ?? Date.now() } });
}
function forgetAnswer() {
  sessionRemove(LAST_ANSWER_KEY);
  keepMedian('acsearch', null);
  keepMedian('coinarchives', null);
}

// Read back defensively: the area is the extension's own, but an answer from an older version, or a torn one, is simply not drawn.
const plainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function readAnswer(stored, now = Date.now()) {
  if (!plainObject(stored) || stored.version !== 1 || !Number.isFinite(stored.shownAt)) return null;
  if (now - stored.shownAt > ANSWER_KEPT_FOR_MS || stored.shownAt > now + 60000) return null;
  const { card, reference } = stored;
  if (!plainObject(card) || typeof card.label !== 'string' || typeof card.id !== 'string' || !plainObject(card.obverse) || !plainObject(card.reverse)) return null;
  if (card.corpus !== 'other' && !CORPORA.includes(card.corpus)) return null;
  if (!plainObject(reference) || typeof reference.catalogue !== 'string' || typeof reference.number !== 'string') return null;
  if (typeof stored.term !== 'string' || typeof stored.currency !== 'string' || typeof stored.query !== 'string') return null;
  if (stored.lots !== null && !Array.isArray(stored.lots)) return null;
  return stored;
}

// "just now", "4 min ago": said once, as the answer is drawn.
const answerAge = (shownAt, now = Date.now()) => {
  const minutes = Math.floor((now - shownAt) / 60000);
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
};

let ageTimer = 0;
// The watchlist half (companion-popup.js) reads the store as the popup opens and says when it has. A restored card waits for that (H-11), so it
// lands with its status row instead of the row pushing the panel down a moment later; a fresh lookup never waits on the store.
// ponytail: capped at two seconds, so a worker that never answers still leaves the last answer drawn, with its row to follow.
const SNAPSHOT_WAIT_MS = 2000;
const storeRead = () => (globalThis.gigaPinaxSnapshotReady ? Promise.resolve() : new Promise((resolve) => {
  window.addEventListener('giga-pinax-snapshot-ready', () => resolve(), { once: true });
  setTimeout(resolve, SNAPSHOT_WAIT_MS);
}));
async function restoreLastAnswer(ticket) {
  let stored;
  try { [stored] = await Promise.all([sessionArea()?.get([PENDING_KEY, LAST_ANSWER_KEY]), storeRead()]); }
  catch { return; }
  // A reference a permission prompt interrupted is the collector's next Look up, and wins over the answer before it.
  if (selectionQuery(stored?.[PENDING_KEY] ?? '')) return;
  const answer = readAnswer(stored?.[LAST_ANSWER_KEY]);
  // He may have started typing, or looked something up, while the area answered: what he did is his, and the old answer stays away.
  if (!answer || ticket !== opening || $('quick-reference').value || currentCard || researchContext) return;
  $('quick-reference').value = answer.query;
  clearOutput();
  fillFields(answer.reference);
  answered = true;
  renderFirstRun();
  renderCard(answer.card, { restoring: true });
  // The research the answer was drawn from, as a lookup makes it, with the term and currency it had.
  researchContext = Object.freeze({ reference: Object.freeze({ ...answer.reference }), label: buildQuery(answer.reference).query, identity: answer.card,
    term: answer.term, currency: answer.currency, priceTicket: priceRequestId, restoredAt: answer.shownAt });
  if (cardMatchesContext(answer.card, researchContext)) verifiedPriceCards.set(researchContext, answer.card);
  onlyCiting = answer.onlyCiting !== false;
  onlyDenomination = answer.onlyDenomination === true;
  $('price-term').value = answer.term;
  $('price-search').open = false;
  updateAcsearchLink();
  updateCoinArchivesLink();
  $('research-prices').hidden = false;
  // Prices drawn in another currency than the one now chosen are not shown: Refresh fetches them in this one.
  if (answer.lots && answer.currency === $('currency').value) renderPrices(answer.lots, answer.currency, answer.term, false, researchContext, priceCard(researchContext));
  $('prices-restored-text').textContent = `as of ${answerAge(answer.shownAt)}`;
  $('prices-restored').hidden = false;
  // The age keeps up with the clock for as long as the line is on show: a side panel may stay open for an hour.
  clearInterval(ageTimer);
  ageTimer = setInterval(() => {
    if ($('prices-restored').hidden) return;
    $('prices-restored-text').textContent = `as of ${answerAge(answer.shownAt)}`;
  }, 60000);
  placeAtTop('result');
  announce(`Your last answer, from ${answerAge(answer.shownAt)}: ${displayReference(answer.card.label)}.`);
}
// Refresh asks acsearch again for the answer on show, with the collector's own click behind it, as Get prices does.
$('refresh-prices').addEventListener('click', () => {
  if (!researchContext || $('prices-button').disabled) return;
  $('prices-form').requestSubmit();
});

// Counted so a reference the store is still fetching cannot land in a window that has since been sent a lookup of its own (openFrom below).
let opening = 0;
async function restorePendingReference(ticket) {
  let stored;
  try { stored = await sessionArea()?.get(PENDING_KEY); }
  catch { return; }
  const pending = selectionQuery(stored?.[PENDING_KEY] ?? '');
  // The store answers after the popup has opened: whatever he has started typing by then is his, not the one the prompt interrupted.
  if (pending && ticket === opening && !$('quick-reference').value) $('quick-reference').value = pending;
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
// What this document is, and whether it is the one a right-click's lookup should reach: documentMode answers both, for this page and its companion half.
const { panel, windowed, acceptsLookupMessages } = documentMode(location.search);
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
  renderFirstRun();
  typingReference = Boolean($('quick-reference').value.trim());
  showRecent();
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
// Prices already on screen were fetched in the currency being replaced. Where acsearch access is already granted the same
// search is run again in the new one - the lookup that fetched them asked for nothing either - rather than leaving an
// empty panel with a Get prices button on it. This is what a default currency arriving from the durable root, after a
// Settings change or a replace import, does to a window that has already priced its lookup. Without access nothing is
// fetched and nothing is asked: a permission prompt closes the popup in Firefox, and nobody pressed anything here.
// CoinArchives is fetched only on a click and never converted, so its median goes with the old currency; the panel's place says so and how to get it
// back, and so does the announcement, rather than the median simply vanishing.
$('currency').addEventListener('change', () => {
  savePreferences();
  // An answer drawn again from the session is never fetched again by itself: its prices go, and Refresh stays beside the heading.
  const repriced = shownPrices?.context === researchContext && !researchContext.restoredAt ? researchContext : null;
  const publicCurrency = shownCoinArchivesPrices && shownCoinArchivesPrices.context === researchContext ? shownCoinArchivesPrices.currency : '';
  const term = $('price-term').value;
  const currency = $('currency').value;
  clearPrices({ keepCuration: true });
  updateAcsearchLink();
  const note = publicCurrency && publicCurrency !== currency
    ? `The CoinArchives median was in ${publicCurrency} and is not converted. Select “Get CoinArchives prices” to fetch it in ${currency}.` : '';
  $('coinarchives-prices-note').textContent = note;
  $('coinarchives-prices-note').hidden = !note;
  $('announcement').textContent = [`Currency set to ${currency}.`, note].filter(Boolean).join(' ');
  if (repriced) void repriceShownLots(repriced, term, $('currency').value);
});
async function repriceShownLots(context, term, currency) {
  if (!(await hasAcsearchAccess())) return;
  if (context !== researchContext || currency !== $('currency').value) return;
  await runPrices(term || context.term, currency, { remember: false, context, keepCuration: true });
  // The redraw announced the new median; nothing the collector decided by hand was reset, and he is told so.
  if (shownPrices?.context === context && priceCuration.changed()) $('announcement').textContent += ' Sales you included or excluded by hand are kept.';
}
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
// Enter in a guided field is a refined search, and says so here rather than being guessed at from the focus when the form is submitted: a submission the
// tool makes itself - a right-click's lookup, the captured coin's Research coin - leaves the cursor wherever it was, and reading that as a refined search
// threw away the very reference it was sent to look up.
// The key's own submission is the one it means: it follows in the same turn, and Enter that submitted nothing (a suggestion picked from the datalist)
// leaves no refined search waiting to be claimed by the next lookup.
let refinedEnter = false;
for (const id of ['ric-section', 'reference-number']) {
  $(id).addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    refinedEnter = true;
    setTimeout(() => { refinedEnter = false; }, 0);
  });
}
$('reference-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const refinedSubmit = event.submitter?.id === 'refine-lookup-button' || refinedEnter;
  refinedEnter = false;
  if (refinedSubmit) {
    $('quick-reference').value = '';
  } else {
    // A recalled label sent unchanged reopens as its chip does, first: an Other label naming two catalogues, or an SC "Ad." title, would read as lot text.
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
  // A refined search is the fields, and no field holds a range: only the box the range was written in carries one.
  if (!refinedSubmit && quickRange) reference.range = quickRange;
  // A corpus the package carries answers without a request, so nothing is asked of the browser before the lookup;
  // one it does not carry (Bopearachchi, whose citations only the online records hold) needs access as it always did.
  const bundled = localCatalogue?.serves(buildQuery(reference).corpus) === true;
  const access = bundled ? null : requestHostAccess(other ? [ACSEARCH_ORIGIN] : [...HOST_ORIGINS], { remember: true });
  savePreferences();
  beginResearch(reference, async () => {
    const context = researchContext;
    const allowed = bundled ? true : await access;
    if (context !== researchContext) return { status: 'cancelled' };
    if (!allowed && !other) return { status: 'permission' };
    if (allowed && other && context === researchContext && context.priceTicket === priceRequestId && !requestedPriceContexts.has(context)) {
      runPrices(context.term, context.currency, { remember: false, context });
    }
    return bundled ? localFirstType(reference) : lookupType(reference, { cache: labelCache, localProvider: localCatalogue });
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
  // Prices asked for on an answer drawn again from the session are new: the research stops carrying the old answer's time.
  if (researchContext?.restoredAt) {
    const fresh = Object.freeze({ ...researchContext, restoredAt: null });
    if (verifiedPriceCards.has(researchContext)) verifiedPriceCards.set(fresh, verifiedPriceCards.get(researchContext));
    researchContext = fresh;
  }
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
  $('coinarchives-prices-note').hidden = true;
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
    revealPrices();
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
// Both toggles are remembered for this view only, never stored, and each governs both providers — the citation filter and the denomination alike —
// so the two medians are drawn from the same rule and changing one redraws both panels. A new lookup puts the citation filter back on; a re-fetch or
// a period keeps what the collector set.
const redrawPrices = () => {
  if (shownPrices) {
    const { lots, currency, term } = shownPrices;
    renderPrices(lots, currency, term, true);
  } else if (shownUpcoming) renderUpcoming(shownUpcoming.lots, shownUpcoming.term, shownUpcoming.context);
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
// Reset disables itself once nothing is left to reset, which would drop the keyboard to the document: it goes to the Inspect sales summary instead.
$('reset-curation').addEventListener('click', () => {
  if (!shownPrices) return;
  const { lots, currency, term } = shownPrices;
  const focused = document.activeElement === $('reset-curation');
  priceCuration.reset();
  renderPrices(lots, currency, term, true);
  if (focused && $('reset-curation').disabled) $('sale-summary').focus();
});
// Only matters while following the system: shownTheme reads a stored choice first.
darkScheme.addEventListener('change', syncThemeButton);

// A right-click lookup opens popup.html?q=<selection>: the text goes only into the Reference box, and requestSubmit runs the same submit handler as Look up.
// The pop-out's window names a card instead and reopens it like a Recent chip: with the fields stored alongside it, and without a permission request.
// Either way the cursor then waits in the Reference box (Alt+Shift+G, type, Enter): Firefox popups can ignore autofocus.
function openFrom(search) {
  const ticket = ++opening;
  const selected = queryFromSearch(search) || selectionQuery(new URLSearchParams(search).get('reference'));
  const opened = cardFromSearch(search);
  if (selected) { $('quick-reference').value = selected; $('reference-form').requestSubmit(); }
  else if (opened && CORPORA.includes(opened.corpus)) beginResearch(null, () => localFirstId(opened.corpus, opened.id));
  // Nothing was sent here, so a reference a permission prompt interrupted is put back in the box, where Look up is waiting for it. It looks up nothing
  // by itself: the prompt was the answer to the last Look up, and this one is his to press.
  else if (!$('quick-reference').value) {
    void restorePendingReference(ticket);
    void restoreLastAnswer(ticket);
  }
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
// The panel fallback (panel=1&window=1) stands in for a sidebar the browser wouldn't open, so it never takes a lookup: only the lookup window answers,
// and a right-click made while just the fallback is open opens a lookup window of its own.
if (acceptsLookupMessages) api?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  // The message chooses what this window looks up, and is answered with the window's own id, so it is taken only from
  // this extension's own pages: its background, or another of its popups handing a lookup over.
  if (sender?.id !== api.runtime.id || !String(sender?.url ?? '').startsWith(api.runtime.getURL(''))) return false;
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
    // The other half of this page holds the auction context of the page it captured; this lookup is about a different
    // page, so it is told before the card it would be saved with is built.
    dispatchEvent(new CustomEvent('giga-pinax-lookup-received'));
    openFrom(search);
  }
  Promise.resolve(api.windows.getCurrent()).catch(() => null).then((current) => sendResponse({ windowId: current?.id }));
  return true;
});
openFrom(location.search);
