import { HOST_ORIGINS, lookupById, lookupType } from './lookup.js';
import { ACSEARCH_ORIGIN, buildSearchUrl, defaultTerm, fetchPrices } from './prices.js';
import { STORAGE_KEY, rememberTerm, restorePreferences } from './preferences.js';

const $ = (id) => document.getElementById(id);
const api = globalThis.browser ?? globalThis.chrome;
const LABELS_KEY = 'giga-pinax-labels-v1';
const NETWORK_MESSAGE = 'Couldn’t reach numismatics.org. Check your connection and try again.';
const PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it.';
const ACSEARCH_NETWORK_MESSAGE = 'Couldn’t reach acsearch. Check your connection and try again.';
const ACSEARCH_PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact acsearch.info to fetch prices. Select “Get prices” again to allow it.';
const SIGN_IN_MESSAGE = 'Sign in on acsearch with your own account, then select “Get prices” again.';

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
  const isRic = $('catalogue').value === 'RIC';
  $('ric-fields').hidden = !isRic;
  $('ric-volume').required = isRic;
  $('ric-section').required = isRic;
  $('reference-label').textContent = isRic ? 'RIC number (including any suffix)' : 'Price number';
  $('reference-help').textContent = isRic ? 'Example: I (2nd edition), Nero 306' : 'Example: Price 23';
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
  $('candidates').hidden = true;
  $('result').hidden = true;
  $('lookup-prompt').hidden = true;
  $('reference-number').removeAttribute('aria-invalid');
  $('announcement').textContent = '';
  currentCard = null;
  clearPrices();
}

function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  $('reference-number').setAttribute('aria-invalid', 'true');
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
  $('price-term').value = preferences.terms[card.id] ?? defaultTerm(currentReference());
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

function renderPrices(summary, currency) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  $('median-amount').textContent = money.format(summary.median);
  $('median-currency').textContent = currency;
  const years = summary.earliest === summary.latest ? String(summary.earliest) : `${summary.earliest}–${summary.latest}`;
  $('sale-period').textContent = `${summary.count} ${summary.count === 1 ? 'sale' : 'sales'} · ${years}`;
  $('range-amount').textContent = `${money.format(summary.lowerQuartile)}–${money.format(summary.upperQuartile)}`;
  const span = summary.max - summary.min;
  const percent = (value) => (span > 0 ? ((value - summary.min) / span) * 100 : 50);
  $('range-box').style.left = `${span > 0 ? percent(summary.lowerQuartile) : 0}%`;
  $('range-box').style.width = `${span > 0 ? percent(summary.upperQuartile) - percent(summary.lowerQuartile) : 100}%`;
  $('range-median').style.left = `${percent(summary.median)}%`;
  $('sale-count').textContent = String(summary.count);
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
  $('announcement').textContent = `Median ${money.format(summary.median)} ${currency} over ${summary.count} ${summary.count === 1 ? 'sale' : 'sales'}.`;
}

function showPricesNote(message, withSignIn) {
  $('prices-note-text').textContent = message;
  $('signin-link').hidden = !withSignIn;
  $('prices-note').hidden = false;
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
  if (outcome.status === 'ok') renderCard(outcome.card);
  else if (outcome.status === 'candidates') renderCandidates(outcome.candidates, outcome.corpus);
  else if (outcome.status === 'none') showError(`No ${outcome.query} found in ${outcome.corpus === 'ocre' ? 'OCRE' : 'PELLA'}. Check the volume, edition and number.`);
  else showError(NETWORK_MESSAGE);
}

async function runPrices() {
  if (!currentCard) return;
  const term = $('price-term').value.trim();
  preferences = rememberTerm(preferences, currentCard.id, term);
  savePreferences();
  updateAcsearchLink();
  clearPrices();
  const id = ++priceRequestId;
  setPricesBusy(true);
  let outcome;
  try { outcome = await fetchPrices({ term, currency: $('currency').value }); }
  catch { outcome = { status: 'network' }; }
  finally { if (id === priceRequestId) setPricesBusy(false); }
  if (id !== priceRequestId) return;
  if (outcome.status === 'ok') renderPrices(outcome.summary, $('currency').value);
  else if (outcome.status === 'signed-out') showPricesNote(SIGN_IN_MESSAGE, true);
  else if (outcome.status === 'empty') showPricesNote(`acsearch returned no sales for “${outcome.term}”. Try a broader term.`, false);
  else if (outcome.status === 'unpriced') showPricesNote(`No hammer prices among the sales acsearch returned for “${outcome.term}”.`, false);
  else showPricesError(ACSEARCH_NETWORK_MESSAGE);
}

// Firefox MV3 grants host permissions lazily; Chromium grants them at install, so contains() short-circuits there.
async function ensureHostAccess(origins) {
  if (!api?.permissions?.request) return true;
  try { if (await api.permissions.contains({ origins })) return true; } catch { return true; }
  try { return await api.permissions.request({ origins }); } catch { return false; }
}

$('catalogue').value = preferences.catalogue;
$('currency').value = preferences.currency;
$('reference-number').value = preferences.number;
$('ric-volume').value = preferences.volume;
$('ric-section').value = preferences.section;
updateFields();

$('catalogue').addEventListener('change', () => {
  $('reference-number').value = $('catalogue').value === 'RIC' ? '306' : '23';
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
  clearOutput();
  $('lookup-prompt').hidden = false;
  savePreferences();
});
$('reference-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  savePreferences();
  if (!(await ensureHostAccess([...HOST_ORIGINS]))) { clearOutput(); showError(PERMISSION_MESSAGE); return; }
  run(() => lookupType(currentReference(), { cache: labelCache }));
});
$('price-term').addEventListener('input', updateAcsearchLink);
$('prices-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!(await ensureHostAccess([ACSEARCH_ORIGIN]))) { clearPrices(); showPricesError(ACSEARCH_PERMISSION_MESSAGE); return; }
  runPrices();
});
