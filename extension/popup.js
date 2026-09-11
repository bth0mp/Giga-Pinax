import { HOST_ORIGINS, lookupById, lookupType, parseReference } from './lookup.js';
import { ACSEARCH_ORIGIN, buildSearchUrl, defaultTerm, fetchPrices } from './prices.js';
import { DEFAULT_NUMBER, STORAGE_KEY, rememberTerm, restorePreferences } from './preferences.js';

const $ = (id) => document.getElementById(id);
const api = globalThis.browser ?? globalThis.chrome;
const LABELS_KEY = 'giga-pinax-labels-v1';
const NETWORK_MESSAGE = 'Couldn’t reach numismatics.org. Check your connection and try again.';
const PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it.';
const ACSEARCH_NETWORK_MESSAGE = 'Couldn’t reach acsearch. Check your connection and try again.';
const ACSEARCH_PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact acsearch.info to fetch prices. Select “Get prices” again to allow it.';
const SIGN_IN_MESSAGE = 'acsearch didn’t show prices. Sign in with an acsearch account that includes hammer prices, then select “Get prices” again.';
const EMPTY_TERM_MESSAGE = 'Enter a search term for acsearch, such as “Nero 306”.';
const QUICK_ERROR = 'Couldn’t read that reference. Try “RIC I² Nero 306”, “Crawford 44/5” or “Price 23”, or use the fields below.';
const CORPUS_NAME = { ocre: 'OCRE', pella: 'PELLA', crro: 'CRRO' };
const NOT_FOUND_HINT = { ocre: 'Check the volume, edition and number.', crro: 'Check the number.', pella: 'Check the number.' };
const REFERENCE_LABEL = { Price: 'Price number', RIC: 'RIC number (including any suffix)', RRC: 'Crawford number' };
const REFERENCE_HELP = { Price: 'Example: Price 23', RIC: 'Example: I (2nd edition), Nero 306', RRC: 'Example: 44/5' };

let rawPreferences = null;
try { rawPreferences = localStorage.getItem(STORAGE_KEY); }
catch { $('storage-note').hidden = false; }
let preferences = restorePreferences(rawPreferences);
let requestId = 0;
let priceRequestId = 0;
let currentCard = null;

const labelCache = {
  read() { try { return JSON.parse(localStorage.getItem(LABELS_KEY)) ?? {}; } catch { return {}; } },
  get(slug) { return this.read()[slug]; },
  set(slug, label) { try { localStorage.setItem(LABELS_KEY, JSON.stringify({ ...this.read(), [slug]: label })); } catch { /* cache is optional */ } },
};

function currentReference() {
  return { catalogue: $('catalogue').value, number: $('reference-number').value,
    volume: $('ric-volume').value, section: $('ric-section').value };
}

function savePreferences() {
  preferences = { ...preferences, ...currentReference(), currency: $('currency').value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
  catch { $('storage-note').hidden = false; }
}

function updateFields() {
  const catalogue = $('catalogue').value;
  const isRic = catalogue === 'RIC';
  $('ric-fields').hidden = !isRic;
  $('ric-volume').required = isRic;
  $('ric-section').required = isRic;
  $('reference-label').textContent = REFERENCE_LABEL[catalogue];
  $('reference-help').textContent = REFERENCE_HELP[catalogue];
}

// An empty one-box leaves the guided fields alone; a parsed one fills them so they show what was understood. False when it doesn't parse.
function applyQuickReference() {
  const text = $('quick-reference').value;
  if (!text.trim()) return true;
  const parsed = parseReference(text);
  if (!parsed) return false;
  $('catalogue').value = parsed.catalogue;
  $('reference-number').value = parsed.number;
  if (parsed.catalogue === 'RIC') {
    $('ric-volume').value = parsed.volume;
    $('ric-section').value = parsed.section;
  }
  updateFields();
  return true;
}

function setPricesBusy(busy) {
  $('prices-button').disabled = busy;
  $('prices-label').textContent = busy ? 'Fetching…' : 'Get prices';
}

function clearPrices() {
  priceRequestId += 1;
  $('prices-panel').hidden = true;
  $('prices-error').hidden = true;
  $('prices-note').hidden = true;
  $('signin-link').hidden = true;
  setPricesBusy(false);
}

function clearOutput() {
  $('form-error').hidden = true;
  $('form-error').textContent = '';
  $('candidates').hidden = true;
  $('result').hidden = true;
  $('lookup-prompt').hidden = true;
  $('reference-number').removeAttribute('aria-invalid');
  $('quick-reference').removeAttribute('aria-invalid');
  $('announcement').textContent = '';
  currentCard = null;
  clearPrices();
}

function showError(message, field = 'reference-number') {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  $(field).setAttribute('aria-invalid', 'true');
}

function setBusy(busy) {
  $('lookup-button').disabled = busy;
  $('lookup-label').textContent = busy ? 'Looking up…' : 'Look up';
}

function updateAcsearchLink() {
  const term = $('price-term').value.trim() || currentCard?.label || '';
  $('acsearch-link').href = buildSearchUrl({ term, currency: $('currency').value });
}

function renderCard(card) {
  $('result-reference').textContent = card.label;
  $('result-summary').textContent = [card.authority, card.denomination, card.mint, card.material, card.dates].filter(Boolean).join(' · ');
  $('type-link').href = `https://numismatics.org/${card.corpus}/id/${encodeURIComponent(card.id)}`;
  $('type-link').setAttribute('aria-label', `View ${card.label} on numismatics.org, opens a new tab`);
  for (const side of ['obverse', 'reverse']) {
    $(`${side}-legend`).textContent = card[side].legend ?? '';
    $(`${side}-legend`).hidden = !card[side].legend;
    $(`${side}-description`).textContent = card[side].description ?? '—';
  }
  currentCard = card;
  const saved = Object.hasOwn(preferences.terms, card.id) ? preferences.terms[card.id] : '';
  $('price-term').value = saved || defaultTerm(currentReference());
  clearPrices();
  updateAcsearchLink();
  $('result').hidden = false;
  $('announcement').textContent = `Found ${card.label}.`;
}

function renderCandidates(candidates, corpus) {
  $('candidate-list').replaceChildren(...candidates.map(({ id, title }) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    button.textContent = title;
    button.addEventListener('click', () => run(() => lookupById(corpus, id, { cache: labelCache })));
    item.append(button);
    return item;
  }));
  $('candidates').hidden = false;
  $('announcement').textContent = `${candidates.length} possible matches. Choose one.`;
}

function renderPrices(summary, currency, term) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const median = money.format(summary.median);
  $('median-amount').textContent = median;
  $('median-currency').textContent = currency;
  $('median-currency').hidden = median.includes(currency);
  const { count } = summary;
  let period = `${count} ${count === 1 ? 'sale' : 'sales'} matching “${term}”`;
  if (summary.earliest !== null) period += ` · ${summary.earliest === summary.latest ? summary.earliest : `${summary.earliest}–${summary.latest}`}`;
  if (summary.total > count) period += ` · ${summary.total - count} not counted`;
  $('sale-period').textContent = period;
  $('range-amount').textContent = `${money.format(summary.lowerQuartile)}–${money.format(summary.upperQuartile)}`;
  const span = summary.max - summary.min;
  const percent = (value) => (span > 0 ? ((value - summary.min) / span) * 100 : 50);
  $('range-box').style.left = `${percent(summary.lowerQuartile)}%`;
  $('range-box').style.width = `${span > 0 ? percent(summary.upperQuartile) - percent(summary.lowerQuartile) : 0}%`;
  $('range-median').style.left = `${percent(summary.median)}%`;
  $('sale-count').textContent = String(count);
  $('sale-list').replaceChildren(...summary.priced.map((sale) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    const link = document.createElement('a');
    link.href = `https://www.acsearch.info/search.html?id=${encodeURIComponent(sale.id)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = sale.title || `Lot ${sale.id}`;
    label.append(`${sale.date} · `, link);
    const amount = document.createElement('strong');
    amount.textContent = money.format(sale.amount);
    row.append(label, amount);
    return row;
  }));
  $('price-note').textContent = summary.capped
    ? 'Hammer prices exclude buyer’s fees, tax and shipping. Only the 100 most recent sales are counted.'
    : 'Hammer prices exclude buyer’s fees, tax and shipping.';
  $('sale-details').open = false;
  $('prices-panel').hidden = false;
  const spoken = median.includes(currency) ? median : `${median} ${currency}`;
  $('announcement').textContent = `Median ${spoken} over ${count} ${count === 1 ? 'sale' : 'sales'}.`;
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

async function run(perform) {
  const id = ++requestId;
  clearOutput();
  setBusy(true);
  let outcome;
  try { outcome = await perform(); }
  catch { outcome = { status: 'network' }; }
  finally { if (id === requestId) setBusy(false); }
  if (id !== requestId) return;
  if (outcome.status === 'ok') {
    renderCard(outcome.card);
    // Same click, same guarded path as Get prices, but only when acsearch access is already granted (never prompts) and without remembering the term.
    const term = $('price-term').value.trim();
    const currency = $('currency').value;
    const ticket = priceRequestId;
    if (term && await hasAcsearchAccess() && id === requestId && ticket === priceRequestId) runPrices(term, currency, { remember: false });
  }
  else if (outcome.status === 'candidates') renderCandidates(outcome.candidates, outcome.corpus);
  else if (outcome.status === 'none') showError(`No ${outcome.query} found in ${CORPUS_NAME[outcome.corpus]}. ${NOT_FOUND_HINT[outcome.corpus]}`);
  else showError(NETWORK_MESSAGE);
}

async function runPrices(term, currency, { remember = true } = {}) {
  if (!currentCard) return;
  if (remember) {
    preferences = rememberTerm(preferences, currentCard.id, term);
    savePreferences();
  }
  updateAcsearchLink();
  clearPrices();
  const id = ++priceRequestId;
  setPricesBusy(true);
  let outcome;
  try { outcome = await fetchPrices({ term, currency }); }
  catch { outcome = { status: 'network' }; }
  finally { if (id === priceRequestId) setPricesBusy(false); }
  if (id !== priceRequestId) return;
  if (outcome.status === 'ok') renderPrices(outcome.summary, currency, term);
  else if (outcome.status === 'signed-out') showPricesNote(SIGN_IN_MESSAGE, true);
  else if (outcome.status === 'empty') showPricesNote(`acsearch returned no sales for “${outcome.term}”. Try a broader term.`, false);
  else if (outcome.status === 'unpriced') showPricesNote(`No hammer prices among the sales acsearch returned for “${outcome.term}”.`, false);
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

$('catalogue').value = preferences.catalogue;
$('currency').value = preferences.currency;
$('reference-number').value = preferences.number;
$('ric-volume').value = preferences.volume;
$('ric-section').value = preferences.section;
updateFields();

$('quick-reference').addEventListener('change', () => {
  if (!$('quick-reference').value.trim() || !applyQuickReference()) return;
  savePreferences();
  clearOutput();
  $('lookup-prompt').hidden = false;
});
// A guided edit (here and in the form input handler) clears the one-box, so a stale one-box value can never override the correction on the next Look up.
$('catalogue').addEventListener('change', () => {
  $('quick-reference').value = '';
  $('reference-number').value = DEFAULT_NUMBER[$('catalogue').value];
  updateFields();
  savePreferences();
  clearOutput();
  $('lookup-prompt').hidden = false;
});
$('currency').addEventListener('change', () => {
  savePreferences();
  clearPrices();
  updateAcsearchLink();
  $('announcement').textContent = `Currency set to ${$('currency').value}.`;
});
$('reference-form').addEventListener('input', (event) => {
  if (!['reference-number', 'ric-volume', 'ric-section'].includes(event.target.id)) return;
  $('quick-reference').value = '';
  clearOutput();
  $('lookup-prompt').hidden = false;
  savePreferences();
});
$('reference-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  // Parsing and validation stay synchronous so the permission request below is still the first await and keeps the user gesture.
  // The form is novalidate so an unparsed one-box shows QUICK_ERROR instead of the browser's required-field bubble.
  if (!applyQuickReference()) { clearOutput(); showError(QUICK_ERROR, 'quick-reference'); return; }
  if (!$('reference-form').reportValidity()) {
    $('form-error').hidden = true;
    $('form-error').textContent = '';
    $('quick-reference').removeAttribute('aria-invalid');
    return;
  }
  const access = requestHostAccess([...HOST_ORIGINS]);
  savePreferences();
  if (!(await access)) { clearOutput(); showError(PERMISSION_MESSAGE); return; }
  run(() => lookupType(currentReference(), { cache: labelCache }));
});
$('price-term').addEventListener('input', updateAcsearchLink);
$('prices-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!currentCard || $('prices-button').disabled) return;
  const term = $('price-term').value.trim();
  if (!term) { clearPrices(); showPricesError(EMPTY_TERM_MESSAGE); return; }
  const currency = $('currency').value;
  const access = requestHostAccess([ACSEARCH_ORIGIN]);
  setPricesBusy(true);
  // Every change that bumps priceRequestId goes through clearPrices(), which also resets the button, so returning here never leaves it disabled.
  const ticket = priceRequestId;
  const allowed = await access;
  if (ticket !== priceRequestId) return;
  if (!allowed) { clearPrices(); showPricesError(ACSEARCH_PERMISSION_MESSAGE); return; }
  runPrices(term, currency);
});
