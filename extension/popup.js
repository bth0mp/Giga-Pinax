import { HOST_ORIGINS, lookupById, lookupType } from './lookup.js';
import { STORAGE_KEY, restorePreferences } from './preferences.js';

const $ = (id) => document.getElementById(id);
const api = globalThis.browser ?? globalThis.chrome;
const LABELS_KEY = 'giga-pinax-labels-v1';
const NETWORK_MESSAGE = 'Couldn’t reach numismatics.org. Check your connection and try again.';
const PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it.';

let rawPreferences = null;
try { rawPreferences = localStorage.getItem(STORAGE_KEY); }
catch { $('storage-note').hidden = false; }
let preferences = restorePreferences(rawPreferences);
let requestId = 0;

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

function clearOutput() {
  $('form-error').hidden = true;
  $('candidates').hidden = true;
  $('result').hidden = true;
  $('lookup-prompt').hidden = true;
  $('reference-number').removeAttribute('aria-invalid');
  $('announcement').textContent = '';
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
  $('acsearch-link').href = `https://www.acsearch.info/search.html?term=${encodeURIComponent(card.label)}`;
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

async function run(perform) {
  const id = ++requestId;
  clearOutput();
  setBusy(true);
  let outcome;
  try { outcome = await perform(); }
  finally { if (id === requestId) setBusy(false); }
  if (id !== requestId) return;
  if (outcome.status === 'ok') renderCard(outcome.card);
  else if (outcome.status === 'candidates') renderCandidates(outcome.candidates, outcome.corpus);
  else if (outcome.status === 'none') showError(`No ${outcome.query} found in ${outcome.corpus === 'ocre' ? 'OCRE' : 'PELLA'}. Check the volume, edition and number.`);
  else showError(NETWORK_MESSAGE);
}

// Firefox MV3 grants host permissions lazily; Chromium grants them at install, so contains() short-circuits there.
async function ensureHostAccess() {
  if (!api?.permissions?.request) return true;
  const origins = [...HOST_ORIGINS];
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
  if (!(await ensureHostAccess())) { clearOutput(); showError(PERMISSION_MESSAGE); return; }
  run(() => lookupType(currentReference(), { cache: labelCache }));
});
