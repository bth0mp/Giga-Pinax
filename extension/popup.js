import { resolveSample, restorePreferences, sampleAmounts, sampleSummary } from './sample-data.js';

const $ = (id) => document.getElementById(id);
const storageKey = 'coin-lookup-test-preferences-v1';
let rawPreferences = null;
try { rawPreferences = localStorage.getItem(storageKey); }
catch { $('storage-note').hidden = false; }
let preferences = restorePreferences(rawPreferences);

function currentReference() {
  return { catalogue: $('catalogue').value, number: $('reference-number').value,
    volume: $('ric-volume').value, section: $('ric-section').value };
}

function savePreferences() {
  preferences = { ...preferences, ...currentReference(), currency: $('currency').value };
  try { localStorage.setItem(storageKey, JSON.stringify(preferences)); }
  catch { $('storage-note').hidden = false; }
}

function setScreen(sampleMode) {
  $('announcement').textContent = '';
  $('welcome-screen').hidden = sampleMode;
  $('lookup-screen').hidden = !sampleMode;
  document.querySelector('.popup-scroll').scrollTop = 0;
}

function updateFields() {
  const isRic = $('catalogue').value === 'RIC';
  $('ric-fields').hidden = !isRic;
  $('ric-volume').required = isRic;
  $('ric-section').required = isRic;
  $('reference-label').textContent = isRic ? 'RIC number (including any suffix)' : 'Price number';
  $('reference-help').textContent = isRic ? 'Included example: I (2nd edition), Nero 306' : 'Included example: Price 23';
}

function formatPrices() {
  const currency = $('currency').value;
  const money = new Intl.NumberFormat('en-US', {style:'currency', currency, maximumFractionDigits:0});
  $('median-amount').textContent = money.format(sampleSummary.median);
  $('median-currency').textContent = currency;
  $('range-amount').textContent = `${money.format(sampleSummary.lowerQuartile)}–${money.format(sampleSummary.upperQuartile)}`;
  $('sale-list').replaceChildren(...sampleAmounts.map((amount, index) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    const price = document.createElement('strong');
    label.textContent = `Fictional sale ${String(index + 1).padStart(2, '0')}`;
    price.textContent = money.format(amount);
    row.append(label, price);
    return row;
  }));
}

function showSample(announce = false) {
  $('announcement').textContent = '';
  const sample = resolveSample(currentReference());
  $('lookup-prompt').hidden = true;
  $('form-error').hidden = Boolean(sample);
  $('sample-results').hidden = !sample;
  $('reference-number').removeAttribute('aria-invalid');
  if (!sample) {
    $('form-error').textContent = $('catalogue').value === 'RIC'
      ? 'This test build includes only RIC I (2nd edition), Nero 306. Live lookups are not connected yet.'
      : 'This test build includes only Price 23. Live lookups are not connected yet.';
    $('reference-number').setAttribute('aria-invalid', 'true');
    return;
  }
  $('result-reference').textContent = sample.label;
  $('result-type').textContent = sample.description;
  $('type-link').href = sample.typeUrl;
  $('type-link').setAttribute('aria-label', `View ${sample.label} in ${sample.typeSource}, opens a new tab`);
  formatPrices();
  if (announce) $('announcement').textContent = `Showing nine fictional sales for the ${sample.label} layout. These are not actual auction results.`;
}

$('catalogue').value = preferences.catalogue;
$('currency').value = preferences.currency;
$('reference-number').value = preferences.number;
$('ric-volume').value = preferences.volume;
$('ric-section').value = preferences.section;
updateFields();
setScreen(preferences.sampleMode);
if (preferences.sampleMode) showSample();

$('try-sample').addEventListener('click', () => {
  preferences.sampleMode = true;
  savePreferences();
  setScreen(true);
  showSample();
  $('reference-number').focus();
});
$('help-button').addEventListener('click', () => {
  setScreen(false);
  $('welcome-signin').focus();
});
$('catalogue').addEventListener('change', () => {
  $('reference-number').value = $('catalogue').value === 'RIC' ? '306' : '23';
  $('sale-details').open = false;
  updateFields();
  savePreferences();
  showSample(true);
});
$('currency').addEventListener('change', () => {
  savePreferences();
  formatPrices();
  $('announcement').textContent = $('sample-results').hidden
    ? `Currency set to ${$('currency').value}.`
    : `Sample amounts formatted in ${$('currency').value}. This is not a currency conversion.`;
});
$('reference-form').addEventListener('input', (event) => {
  if (!['reference-number', 'ric-volume', 'ric-section'].includes(event.target.id)) return;
  $('announcement').textContent = '';
  $('sample-results').hidden = true;
  $('form-error').hidden = true;
  $('lookup-prompt').hidden = false;
  $('reference-number').removeAttribute('aria-invalid');
  savePreferences();
});
$('reference-form').addEventListener('submit', (event) => {
  event.preventDefault();
  savePreferences();
  showSample(true);
});

// Sign-in is an ordinary external link. Never treat opening it as authentication.
