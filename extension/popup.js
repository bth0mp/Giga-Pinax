import { HOST_ORIGINS, lookupById, lookupType, parseReference } from './lookup.js';
import { ACSEARCH_ORIGIN, buildSearchUrl, chooseTerm, fetchPrices, quoteList, summaryText } from './prices.js';
import { DEFAULT_NUMBER, DEFAULT_SECTION, STORAGE_KEY, THEME_KEY, rememberRecent, rememberTerm, restorePreferences, restoreTheme } from './preferences.js';
import { BOP_KINGS, RIC_VOLUMES, sectionsOf, selectOptions } from './catalogues.js';
import { queryFromSearch } from './selection.js';

const $ = (id) => document.getElementById(id);
const api = globalThis.browser ?? globalThis.chrome;
const LABELS_KEY = 'giga-pinax-labels-v1';
const NETWORK_MESSAGE = 'Couldn’t reach numismatics.org. Check your connection and try again.';
const PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it.';
const ACSEARCH_NETWORK_MESSAGE = 'Couldn’t reach acsearch. Check your connection and try again.';
const ACSEARCH_PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact acsearch.info to fetch prices. Select “Get prices” again to allow it.';
const SIGN_IN_MESSAGE = 'acsearch didn’t show prices. Sign in with an acsearch account that includes hammer prices, then select “Get prices”.';
const ACCESS_HINT = 'Select “Get prices” to let Giga Pinax fetch acsearch prices.';
const EMPTY_TERM_MESSAGE = 'Enter a search term for acsearch, such as “Nero 306”.';
const COPY_FAILED_MESSAGE = 'Couldn’t copy the summary.';
const QUICK_ERROR = 'Couldn’t read that reference. Try “RIC I² Nero 306”, “Crawford 44/5”, “SC 1266.2”, “Bop Euthydemus I 24A” or “Price 23”, or use the fields below.';
const CORPUS_NAME = { ocre: 'OCRE', pella: 'PELLA', crro: 'CRRO', sco: 'SCO', bigr: 'BIGR' };
const NOT_FOUND_HINT = { ocre: 'Check the volume, edition and number.', crro: 'Check the number.', pella: 'Check the number.', sco: 'Check the number.', bigr: 'Check the king and Bop number.' };
const REFERENCE_LABEL = { Price: 'Price number', RIC: 'RIC number (including any suffix)', RRC: 'Crawford number', SC: 'Seleucid Coins number', Bop: 'Bop number' };
const REFERENCE_HELP = { Price: 'Example: Price 23', RIC: 'Example: 306, with I² (2nd ed.) and Nero chosen above', RRC: 'Example: 44/5', SC: 'Example: 1266.2', Bop: 'Example: 24A' };

let rawPreferences = null;
try { rawPreferences = localStorage.getItem(STORAGE_KEY); }
catch { $('storage-note').hidden = false; }
let preferences = restorePreferences(rawPreferences);
let requestId = 0;
let priceRequestId = 0;
let currentCard = null;
// What the prices panel is showing, for Copy summary; only in memory, and cleared with the panel.
let shownPrices = null;
let copiedTimer = 0;

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

function currentReference() {
  return { catalogue: $('catalogue').value, number: $('reference-number').value,
    volume: $('ric-volume').value, section: $('ric-section').value };
}

function savePreferences() {
  preferences = { ...preferences, ...currentReference(), currency: $('currency').value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
  catch { $('storage-note').hidden = false; }
}

// A select is rebuilt from its list plus the wanted value (selectOptions appends an unlisted one, so a typed "Euthydemos" or a parsed "IV, Part 1"
// is shown and used exactly as it came), each option built with new Option(label, value), never markup; a blank value with no blank option shows the first.
function fillSelect(select, entries, value) {
  const wanted = String(value ?? '');
  select.replaceChildren(...selectOptions(entries, wanted).map((option) => new Option(option.label, option.value)));
  select.value = wanted;
  if (select.selectedIndex < 0 && select.options.length) select.selectedIndex = 0;
}

// The Volume select always lists the RIC volumes; the section select lists the kings for Bop and the chosen volume's sections otherwise.
function fillSelects(catalogue, volume, section) {
  fillSelect($('ric-volume'), RIC_VOLUMES, volume);
  fillSelect($('ric-section'), catalogue === 'Bop' ? BOP_KINGS : sectionsOf($('ric-volume').value), section);
}

function updateFields() {
  const catalogue = $('catalogue').value;
  const isRic = catalogue === 'RIC';
  const isBop = catalogue === 'Bop';
  $('ric-fields').hidden = !isRic && !isBop;
  $('volume-field').hidden = !isRic;
  $('ric-fields').classList.toggle('single', isBop);
  $('section-label').textContent = isBop ? 'King' : 'Ruler or mint section';
  $('ric-volume').required = isRic;
  $('ric-section').required = isRic;
  $('reference-label').textContent = REFERENCE_LABEL[catalogue];
  $('reference-help').textContent = REFERENCE_HELP[catalogue];
}

function fillFields(parsed) {
  $('catalogue').value = parsed.catalogue;
  $('reference-number').value = parsed.number;
  // Only a RIC reference carries a volume and only RIC and Bop a section; the other catalogues leave the hidden selects untouched.
  if (parsed.catalogue === 'RIC' || parsed.catalogue === 'Bop') {
    fillSelects(parsed.catalogue, parsed.catalogue === 'RIC' ? parsed.volume : $('ric-volume').value, parsed.section);
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

function clearPrices() {
  priceRequestId += 1;
  shownPrices = null;
  resetCopyLabel();
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

// Only a reference that wasn't found or read marks its field invalid; network and permission messages name no field.
function showError(message, field) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  if (field) $(field).setAttribute('aria-invalid', 'true');
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
  const citation = card.bop?.citation ? `Bopearachchi ${card.bop.citation}` : '';
  $('result-citation').textContent = citation;
  $('result-citation').hidden = !citation;
  $('type-link').href = `https://numismatics.org/${card.corpus}/id/${encodeURIComponent(card.id)}`;
  $('type-link').setAttribute('aria-label', `View ${card.label} on numismatics.org, opens a new tab`);
  for (const side of ['obverse', 'reverse']) {
    $(`${side}-legend`).textContent = card[side].legend ?? '';
    $(`${side}-legend`).hidden = !card[side].legend;
    $(`${side}-description`).textContent = card[side].description ?? '—';
  }
  currentCard = card;
  const saved = Object.hasOwn(preferences.terms, card.id) ? preferences.terms[card.id] : '';
  $('price-term').value = chooseTerm(currentReference(), saved);
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
    // Like a Recent chip: the chosen title fills the guided fields, so the acsearch term follows the chosen type, not the mistyped one.
    button.addEventListener('click', () => {
      $('quick-reference').value = '';
      const parsed = parseReference(title);
      if (parsed) { fillFields(parsed); savePreferences(); }
      run(() => lookupById(corpus, id, { cache: labelCache }));
    });
    item.append(button);
    return item;
  }));
  $('candidates').hidden = false;
  $('announcement').textContent = `${candidates.length} possible matches. Choose one.`;
}

// A chip is a user action like a "Did you mean" choice: it fills the guided fields from the stored title (so the acsearch term follows it) and makes no permission request.
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
    button.addEventListener('click', () => {
      $('quick-reference').value = '';
      const parsed = parseReference(entry.label);
      if (parsed) { fillFields(parsed); savePreferences(); }
      run(() => lookupById(entry.corpus, entry.id, { cache: labelCache }));
    });
    item.append(button);
    return item;
  }));
  $('recent').hidden = preferences.recent.length === 0;
  const chips = [...$('recent-list').querySelectorAll('button')];
  const target = chips.find((chip) => chip.dataset.key === focusedKey) || chips[0];
  if (refocus && target) target.focus();
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
  shownPrices = { card: currentCard, summary, currency, term };
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
    // A BIGR card fills King and Bop number from itself (title and citation), so the acsearch term follows the chosen type; chips and suggestions carry no parsable Bop label.
    if (outcome.card.bop) fillFields({ catalogue: 'Bop', number: outcome.card.bop.series ?? '', volume: '', section: outcome.card.bop.king });
    renderCard(outcome.card);
    preferences = rememberRecent(preferences, outcome.card);
    savePreferences();
    renderRecent();
    // Same click, same guarded path as Get prices, but only when acsearch access is already granted (never prompts) and without remembering the term.
    // Without access, the same guards decide whether to say how to allow it instead.
    const term = $('price-term').value.trim();
    const currency = $('currency').value;
    const ticket = priceRequestId;
    if (!term) return;
    const granted = await hasAcsearchAccess();
    if (id !== requestId || ticket !== priceRequestId) return;
    if (granted) runPrices(term, currency, { remember: false });
    else {
      showPricesNote(ACCESS_HINT, false);
      $('announcement').textContent = `Found ${outcome.card.label}. ${ACCESS_HINT}`;
    }
  }
  else if (outcome.status === 'candidates') renderCandidates(outcome.candidates, outcome.corpus);
  else if (outcome.status === 'none') showError(`No ${outcome.query} found in ${CORPUS_NAME[outcome.corpus]}. ${NOT_FOUND_HINT[outcome.corpus]}`, 'reference-number');
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

$('catalogue').value = preferences.catalogue;
$('currency').value = preferences.currency;
$('reference-number').value = preferences.number;
fillSelects(preferences.catalogue, preferences.volume, preferences.section);
updateFields();
renderRecent();
applyStoredTheme();
syncThemeButton();

$('quick-reference').addEventListener('change', () => {
  if (!$('quick-reference').value.trim() || !applyQuickReference()) return;
  savePreferences();
  clearOutput();
  $('lookup-prompt').hidden = false;
});
// A guided edit (here and in the form input handler) clears the one-box, so a stale one-box value can never override the correction on the next Look up.
// A new catalogue starts from its defaults: RIC from the first volume with its default section and number, so a remembered volume can't pair with a
// section it lacks; Bop from its default king and number, keeping the hidden volume.
$('catalogue').addEventListener('change', () => {
  const catalogue = $('catalogue').value;
  $('quick-reference').value = '';
  $('reference-number').value = DEFAULT_NUMBER[catalogue];
  if (Object.hasOwn(DEFAULT_SECTION, catalogue)) fillSelects(catalogue, catalogue === 'RIC' ? RIC_VOLUMES[0].value : $('ric-volume').value, DEFAULT_SECTION[catalogue]);
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
// A new volume lists its own sections: the current section stays when the volume has it (Rome, Hadrian), else the first is chosen; a volume outside the
// list has no sections, so the current one is kept as the extra option. The form's input handler has already cleared the one-box and the output.
$('ric-volume').addEventListener('change', () => {
  const sections = sectionsOf($('ric-volume').value);
  const current = $('ric-section').value;
  fillSelect($('ric-section'), sections, sections.length === 0 || sections.includes(current) ? current : sections[0]);
  savePreferences();
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
// writeText is the first call in the click, so it keeps the user gesture; a missing clipboard API throws here and is reported like a refusal.
// Success relabels the button for 2 seconds; a newer copy restarts the timer, and clearPrices() puts the label back at once.
$('copy-summary').addEventListener('click', async () => {
  const shown = shownPrices;
  if (!shown) return;
  try {
    await navigator.clipboard.writeText(summaryText(shown.card, shown.summary, shown.currency, shown.term));
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
$('theme-toggle').addEventListener('click', () => chooseTheme(shownTheme() === 'dark' ? 'light' : 'dark'));
// Only matters while following the system: shownTheme reads a stored choice first.
darkScheme.addEventListener('change', syncThemeButton);

// A right-click lookup opens popup.html?q=<selection>: the text goes only into the Reference box, and requestSubmit runs the same submit handler as Look up.
const selected = queryFromSearch(location.search);
if (selected) { $('quick-reference').value = selected; $('reference-form').requestSubmit(); }
