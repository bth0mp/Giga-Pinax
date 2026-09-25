import {
  MAX_BACKUP_BYTES, backupFileName, exportBackup, importChangeLines, importCountsText, importFit, importNothingText, megabytesText, RECORDS_LIMIT_TEXT,
  importIssueLines, importWithSafetyCopy, previewImport, previewReplaceOverUnreadable, quarantineDocument, quarantineRestoreText,
  quarantineRows, quarantineSummaryText, rawExportDocument, validateBackup,
} from './core/backup.js';
import { isUnreadable, mountRecovery } from './store-recovery.js';
import { CSV_TABLES, csvFiles } from './core/csv.js';
import { clearDiagnostics, diagnosticsText, readDiagnostics, recentDiagnosticLines } from './core/diagnostics.js';
import { CURRENCIES, parsePercent } from './core/money.js';
import { formatIncrementLadder, formatMinorInput, housePresetsText, parseHousePresets, presetFromFields } from './bid-tools.js';
import * as bridge from './browser-api.js';
import { cacheDefaultCurrency, initializeCompanionPreferences } from './companion-preferences.js';
import './updates.js';
import { LOCAL_CORPORA, defaultLocalCatalogue } from './local-catalogue.js';

const $ = (id) => document.getElementById(id);
// Every currency select on the page lists the currencies an amount may be recorded in, in the one order money.js keeps.
function currencyOptions(select) {
  for (const code of CURRENCIES) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = code;
    select.append(option);
  }
  return select;
}
let preferencesSnapshot;
let pendingImport = null;
let previewGeneration = 0;
let quarantined = [];
// The page's settings fields as they were last drawn or saved, so a later redraw can tell whether it
// would throw away something the collector typed and has not saved.
let renderedForm = '';
// Set while the page keeps settings typed before an import over imported ones it does not show. The
// backup's preferences can carry the revision this page holds, so the store cannot refuse that Save
// as a conflict; the page refuses it itself until a reload draws the imported settings.
let behindStore = false;
const BEHIND_STORE_NOTE = 'Note what you typed, then reload this page to see the imported settings.';

const THEME_KEY = 'giga-pinax-theme-v1';
// Show specimen photos, kept beside the theme and read by the popup from the same local storage: 'on', or absent for off. It is never a stored
// preference, so no backup carries it, and storage the browser refuses or clears leaves it off.
const SPECIMEN_PHOTOS_KEY = 'giga-pinax-specimen-photos-v1';

// A browser profile that blocks site data makes reading localStorage itself throw. What it holds -
// the theme and the popup's currency cache - is a convenience: the settings live in extension
// storage, so the page loads and saves without it and says what it could not keep.
function siteStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function storedTheme() {
  try { return siteStorage()?.getItem(THEME_KEY) ?? ''; } catch { return ''; }
}

function rememberTheme(theme) {
  try {
    const storage = siteStorage();
    if (!storage) return false;
    if (theme) storage.setItem(THEME_KEY, theme);
    else storage.removeItem(THEME_KEY);
    return true;
  } catch {
    return false;
  }
}

function storedSpecimenPhotos() {
  try { return siteStorage()?.getItem(SPECIMEN_PHOTOS_KEY) === 'on'; } catch { return false; }
}

// Whether the switch now stands as asked: off always does, since nothing stored is also off.
function rememberSpecimenPhotos(on) {
  try {
    const storage = siteStorage();
    if (!storage) return !on;
    if (on) storage.setItem(SPECIMEN_PHOTOS_KEY, 'on');
    else storage.removeItem(SPECIMEN_PHOTOS_KEY);
    return true;
  } catch {
    return !on;
  }
}

function download(text, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function status(message, error = false) {
  $('settings-status').textContent = message;
  $('settings-status').dataset.error = String(error);
}

function clearPreview() {
  previewGeneration += 1;
  pendingImport = null;
  $('import-preview').hidden = true;
  $('confirm-import').disabled = true;
  $('import-counts').textContent = '';
  $('import-conflicts').replaceChildren();
}

let premiumFieldSequence = 0;

// One field of a preset row: its label, the sentence that explains it and the place its own error
// is shown. The hint stays outside the label so the control's accessible name is the field's name
// and nothing longer; both the hint and the error are reached through aria-describedby.
function premiumField(labelText, control, hintText = '') {
  premiumFieldSequence += 1;
  const field = document.createElement('div');
  field.className = 'premium-field';
  const label = document.createElement('label');
  const caption = document.createElement('span');
  caption.textContent = labelText;
  label.append(caption, control);
  field.append(label);
  const describedBy = [];
  if (hintText) {
    const hint = document.createElement('p');
    hint.className = 'premium-hint';
    hint.id = `premium-hint-${premiumFieldSequence}`;
    hint.textContent = hintText;
    field.append(hint);
    describedBy.push(hint.id);
  }
  const error = document.createElement('p');
  error.className = 'premium-error';
  error.id = `premium-error-${premiumFieldSequence}`;
  error.setAttribute('role', 'alert');
  control.setAttribute('aria-describedby', [...describedBy, error.id].join(' '));
  field.append(error);
  return field;
}

function premiumRow(item = { name: '', buyerPremiumBps: null }) {
  const row = document.createElement('div');
  row.className = 'premium-row';
  const name = document.createElement('input');
  name.className = 'premium-name';
  name.maxLength = 120;
  name.value = item.name;
  const bps = document.createElement('input');
  bps.className = 'premium-value';
  bps.type = 'text';
  bps.inputMode = 'decimal';
  bps.placeholder = 'e.g. 22.50';
  bps.value = formatMinorInput(item.buyerPremiumBps, navigator.language);
  // What the house charges on top of its premium: VAT on the premium alone, and a live-bidding
  // platform's fee on the hammer alone. Blank is none, and a blank field is not stored.
  const charge = (className, bpsValue) => {
    const input = document.createElement('input');
    input.className = className;
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = 'None';
    input.value = formatMinorInput(bpsValue, navigator.language);
    return input;
  };
  const vat = charge('premium-vat', item.premiumVatBps);
  const platform = charge('premium-platform', item.platformFeeBps);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'quiet';
  remove.textContent = 'Remove';
  // Every row has one, so its name says which house it takes away, and follows the name as typed.
  const nameRemove = () => {
    const house = name.value.trim().replace(/\s+/g, ' ');
    remove.setAttribute('aria-label', `Remove ${house || 'unnamed house'}`);
  };
  nameRemove();
  name.addEventListener('input', nameRemove);
  remove.addEventListener('click', () => row.remove());
  // The button sits in the same grid as the fields, under a blank caption line of its own, so that
  // it stays level with the inputs however tall a field's error grows.
  const removeField = document.createElement('div');
  removeField.className = 'premium-remove';
  removeField.append(remove);
  const currency = currencyOptions(document.createElement('select'));
  currency.className = 'premium-ladder-currency';
  currency.value = item.incrementLadder?.currency ?? $('currency').value;
  const ladder = document.createElement('textarea');
  ladder.className = 'premium-ladder';
  ladder.rows = 4;
  // Giga Pinax ships no house's schedule, and a plausible-looking example inside a named house's
  // row would read as that house's own tiers, so the empty box shows the shape of a line instead.
  ladder.placeholder = 'from: step';
  ladder.value = formatIncrementLadder(item.incrementLadder?.tiers, item.incrementLadder?.currency);
  const currencyField = premiumField('Ladder currency', currency,
    'The currency this house’s increments are written in. The tiers apply while the calculator is set to that currency.');
  const ladderField = premiumField('Increment tiers', ladder,
    'Optional. One tier per line: the amount the tier starts at, a colon, then the step from there. Copy the tiers from this house’s published terms — Giga Pinax ships no house’s ladder.');
  currencyField.classList.add('premium-ladder-field');
  ladderField.classList.add('premium-ladder-field');
  // The ladder is folded under a line that says what it holds, so a list of houses reads as a list and
  // the tiers open when they are wanted.
  const ladderDetails = document.createElement('details');
  ladderDetails.className = 'premium-ladder-details';
  const ladderSummary = document.createElement('summary');
  const summarize = () => {
    const count = ladder.value.split('\n').filter((line) => line.trim() !== '').length;
    ladderSummary.textContent = count
      ? `Increment ladder · ${count} ${count === 1 ? 'tier' : 'tiers'} in ${currency.value}`
      : 'Increment ladder · none';
  };
  summarize();
  ladder.addEventListener('input', summarize);
  currency.addEventListener('change', summarize);
  ladderDetails.append(ladderSummary, currencyField, ladderField);
  const vatField = premiumField('VAT on premium %', vat,
    'Optional. VAT the house adds to its premium only.');
  const platformField = premiumField('Platform fee % on hammer', platform,
    'Optional. A live-bidding platform’s fee.');
  // The two charges sit side by side on a line of their own, under the premium they belong with.
  const charges = document.createElement('div');
  charges.className = 'premium-charges';
  charges.append(vatField, platformField);
  row.append(premiumField('Auction house', name), premiumField('Buyer’s premium %', bps), removeField, charges, ladderDetails);
  return row;
}

const PRESET_FIELD_CLASS = {
  name: 'premium-name', premium: 'premium-value', premiumVat: 'premium-vat', platformFee: 'premium-platform', ladder: 'premium-ladder',
  ladderCurrency: 'premium-ladder-currency',
};

// Putting a record back is a command like any other: the store decides whether it can go back, and
// the page says what the reply says and reads the list again.
async function restoreSetAside(entryId, button, edits) {
  button.disabled = true;
  try {
    const reply = await bridge.sendCommand({
      type: 'quarantine.restore', requestId: bridge.newRequestId(), entryId, ...(edits ? { edits } : {}),
    });
    if (!reply?.ok) {
      throw new Error(reply?.message || reply?.error?.message || 'That record could not be put back.');
    }
    const restored = quarantineRestoreText(reply.value);
    status(restored);
    // Only the list is read again: a redraw of the whole page would throw away presets, a currency
    // or a theme typed above and not yet saved.
    await refreshDataHealth().catch((error) => status(`${restored} The list could not be read again: ${error.message}`, true));
  } catch (error) {
    button.disabled = false;
    status(error.message || 'That record could not be put back.', true);
  }
}

// Taking a set-aside record out of the list for good (X-03), once the collector has said so knowing the download exists.
async function removeSetAside(row, button) {
  const { noun, label } = row.problem;
  const named = label ? ` “${label}”` : '';
  if (!confirm(`Remove this ${noun}${named} for good? Download set-aside records first if you may want it later.`)) return;
  button.disabled = true;
  try {
    const reply = await bridge.sendCommand({ type: 'quarantine.remove', requestId: bridge.newRequestId(), entryId: row.id });
    if (!reply?.ok) throw new Error(reply?.message || 'That record could not be removed.');
    status(`The ${noun}${named} was removed from the set-aside records.`);
    await refreshDataHealth().catch((error) => status(`The ${noun} was removed. The list could not be read again: ${error.message}`, true));
  } catch (error) {
    button.disabled = false;
    status(error.message || 'That record could not be removed.', true);
  }
}

let quarantineRowSequence = 0;

// Untrusted text from a repaired record, so the line is written as text and never as markup. A record that does not
// validate is offered its one field to correct, or to go back without it where that field is optional (X-03).
function quarantineItem(row) {
  const item = document.createElement('li');
  const line = document.createElement('span');
  line.textContent = row.line;
  item.append(line);
  if (!row.restorable) return item;
  quarantineRowSequence += 1;
  line.id = `quarantine-line-${quarantineRowSequence}`;
  const control = (text, kind = 'quiet') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = kind;
    button.textContent = text;
    // Every row carries buttons of these names, so the line beside them is what tells them apart.
    button.setAttribute('aria-describedby', line.id);
    return button;
  };
  const restore = control('Restore');
  restore.addEventListener('click', () => { void restoreSetAside(row.id, restore); });
  const remove = control('Remove');
  remove.addEventListener('click', () => { void removeSetAside(row, remove); });
  item.append(' ', restore, ' ', remove);
  // Every field that stops it is offered at once, and one button sends every correction together (review Important 2).
  const fixable = (row.problem?.problems ?? []).filter(({ field, editable, clearable }) => field && (editable || clearable));
  if (!fixable.length) return item;
  const fix = document.createElement('div');
  fix.className = 'set-aside-fix';
  const readers = [];
  for (const { field, fieldLabel, editable, clearable, current } of fixable) {
    let input = null;
    let leaveOut = null;
    if (editable) {
      const label = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = `Correct the ${fieldLabel}`;
      input = document.createElement('input');
      input.className = 'set-aside-value';
      input.value = current;
      label.append(caption, input);
      fix.append(label);
    }
    if (clearable) {
      const label = document.createElement('label');
      leaveOut = document.createElement('input');
      leaveOut.type = 'checkbox';
      leaveOut.className = 'set-aside-leave-out';
      const caption = document.createElement('span');
      caption.textContent = `Leave out the ${fieldLabel}`;
      label.append(leaveOut, caption);
      fix.append(label);
    }
    readers.push(() => ({ field, value: leaveOut?.checked || !input ? null : input.value }));
  }
  const put = control(`Put back with ${fixable.length === 1 ? 'this correction' : 'these corrections'}`, 'secondary');
  put.addEventListener('click', () => { void restoreSetAside(row.id, put, readers.map((read) => read())); });
  fix.append(put);
  item.append(fix);
  return item;
}

function renderDataHealth(entries) {
  quarantined = Array.isArray(entries) ? entries : [];
  const summary = quarantineSummaryText(quarantined);
  $('data-health').hidden = !summary;
  $('quarantine-summary').textContent = summary;
  $('quarantine-list').replaceChildren(...quarantineRows(quarantined).map(quarantineItem));
}

// The theme and the photos switch are this page's own local storage, not the worker's, so they are drawn once, at
// once, and no answer from the worker draws them again: one chosen before it answered stands (H-02).
function renderAppearance() {
  $('theme').value = storedTheme();
  $('specimen-photos').checked = storedSpecimenPhotos();
}

// The worker's settings. The form they leave is compared with the theme and switch as stored, so one chosen and not
// yet saved still counts as a change.
function render() {
  $('currency').value = preferencesSnapshot.preferences.currency;
  $('import-vat').value = formatMinorInput(preferencesSnapshot.preferences.importVatBps);
  $('premium-list').replaceChildren(
    ...(preferencesSnapshot.preferences.housePremiumPresets ?? []).map(premiumRow),
  );
  renderedForm = formState({ theme: storedTheme(), specimenPhotos: storedSpecimenPhotos() });
}

function formState({ theme = $('theme').value, specimenPhotos = $('specimen-photos').checked } = {}) {
  return JSON.stringify({
    currency: $('currency').value,
    importVat: $('import-vat').value,
    theme,
    specimenPhotos,
    rows: [...document.querySelectorAll('.premium-row')]
      .map((row) => [...row.querySelectorAll('input, select, textarea')].map((control) => control.value)),
  });
}

// The two settings this page writes. Anything else in the record - desktop alerts - is kept by the
// store's own merge, so a revision that moved only for it overwrites nothing this page shows.
const sameSettings = (a, b) => Boolean(a && b) && a.currency === b.currency && (a.importVatBps ?? null) === (b.importVatBps ?? null) &&
  JSON.stringify(a.housePremiumPresets ?? []) === JSON.stringify(b.housePremiumPresets ?? []);

// How full the store is (K-13, X-09): "1.6 MB of 4.9 MB used" over a thin meter, and from 80% the way to make room.
const STORAGE_WARN_SHARE = 0.8;
async function refreshStorageUsage() {
  let reply = null;
  try { reply = await bridge.sendCommand({ type: 'storage.usage', requestId: bridge.newRequestId() }); } catch { /* the gauge stays hidden */ }
  const { bytes, limit } = reply?.ok && reply.value ? reply.value : {};
  if (!Number.isFinite(bytes) || !Number.isFinite(limit) || limit <= 0) {
    $('storage-gauge').hidden = true;
    return;
  }
  $('storage-gauge').hidden = false;
  $('storage-used').textContent = `${megabytesText(bytes)} of ${RECORDS_LIMIT_TEXT} used`;
  const meter = $('storage-meter');
  meter.setAttribute('max', String(limit));
  meter.setAttribute('high', String(Math.round(limit * STORAGE_WARN_SHARE)));
  meter.setAttribute('value', String(Math.min(bytes, limit)));
  const warning = $('storage-warning');
  warning.hidden = bytes < limit * STORAGE_WARN_SHARE;
  warning.textContent = bytes > limit
    ? 'Your records fill the 4.9 MB Giga Pinax can keep in this browser: only changes that make them smaller can be saved. Export a backup, then remove old coins or auctions you no longer need.'
    : 'Your records are filling the 4.9 MB Giga Pinax can keep in this browser. Export a backup, then remove old coins or auctions you no longer need.';
}

// Data health read again on its own. The revision the page saves against follows the store only
// while the store still holds the settings this page drew: presets another view saved since are not
// overwritten by a page that never showed them, and that save is refused as a conflict instead.
async function refreshDataHealth() {
  const latest = await bridge.getSnapshot();
  if (!latest?.ok) throw new Error(latest?.message || 'Could not read local records.');
  renderDataHealth(latest.value.quarantine);
  void refreshStorageUsage();
  if (sameSettings(latest.value.preferences, preferencesSnapshot?.preferences)) {
    preferencesSnapshot.preferences = latest.value.preferences;
  }
  return latest.value;
}

function collectPresets() {
  const rows = [...document.querySelectorAll('.premium-row')];
  for (const row of rows) {
    for (const error of row.querySelectorAll('.premium-error')) error.textContent = '';
    for (const control of row.querySelectorAll('input, select, textarea')) control.removeAttribute('aria-invalid');
  }
  const values = [];
  for (const row of rows) {
    const field = presetFromFields({
      name: row.querySelector('.premium-name').value,
      premiumText: row.querySelector('.premium-value').value,
      premiumVatText: row.querySelector('.premium-vat').value,
      platformFeeText: row.querySelector('.premium-platform').value,
      ladderText: row.querySelector('.premium-ladder').value,
      ladderCurrency: row.querySelector('.premium-ladder-currency').value,
    }, { locale: navigator.language });
    if (field.ok) {
      values.push(field.value);
      continue;
    }
    // The message belongs beside the field it is about, and that alert is the one announcement:
    // the same sentence in the page status line would be read out a second time.
    const control = row.querySelector(`.${PRESET_FIELD_CLASS[field.error.field]}`);
    // A field folded away is opened, so the message and the focus land where they can be seen.
    const folded = control.closest('details');
    if (folded) folded.open = true;
    control.closest('.premium-field').querySelector('.premium-error').textContent = field.error.message;
    control.setAttribute('aria-invalid', 'true');
    control.focus();
    return { ok: false };
  }
  return { ok: true, value: values };
}

// Records nothing can read (X-02): the notice at the top of the page offers the rescue copy and a fresh start, and the
// import form below takes a backup with Replace. Once either has worked the page loads again and the notice goes.
const UNREADABLE_NOTE = 'Your records can’t be read. The notice at the top of this page has the ways out.';
function showRecovery(reply) {
  mountRecovery({
    document, bridge, reply, download, confirm: (message) => confirm(message), importHint: 'below',
    reload: () => { void load().then(() => status('Started fresh. Your settings are new; import a backup to bring your records back.')).catch((error) => status(error.message, true)); },
  });
}
// What a page read that failed says: the recovery notice for records nothing can read, the store's own words otherwise.
function readFailure(reply, fallback) {
  if (isUnreadable(reply)) return new Error(UNREADABLE_NOTE);
  return new Error(reply?.message || fallback);
}

async function load() {
  const reply = await initializeCompanionPreferences(bridge, siteStorage());
  if (!reply?.ok || !reply.value?.preferences) {
    if (isUnreadable(reply)) showRecovery(reply);
    throw readFailure(reply, 'Could not load settings.');
  }
  document.getElementById('store-recovery')?.remove();
  preferencesSnapshot = reply.value;
  behindStore = false;
  // Settings and the research popup share this origin's local storage, and the popup prices from the cache before the
  // background can answer it. Written on every load, so the reload after an import carries the imported default too.
  cacheDefaultCurrency(siteStorage(), preferencesSnapshot.preferences.currency);
  render();
  renderDataHealth(preferencesSnapshot.quarantine);
  void refreshStorageUsage();
  // Drawing the saved rows replaces the list, so the editors wait for it (the markup starts them disabled): a house
  // added before the worker answered would otherwise be wiped by this render.
  for (const id of ['save-settings', 'currency', 'import-vat', 'add-premium', 'copy-presets', 'paste-presets']) $(id).disabled = false;
}

// The file the import would overwrite the current records with, ready to hand to the browser.
async function safetyCopyFile() {
  const latest = await bridge.getSnapshot();
  if (!latest?.ok) throw new Error(latest?.message || 'Could not read local records.');
  const now = new Date().toISOString();
  const result = exportBackup(latest.value, now);
  if (!result.ok) throw new Error(result.error.message);
  return { text: result.value, name: backupFileName('giga-pinax-before-import', now) };
}

async function rawFile() {
  const reply = await bridge.sendCommand({ type: 'snapshot.raw', requestId: bridge.newRequestId() });
  if (!reply?.ok) throw new Error(reply?.message || 'Could not read local storage.');
  const now = new Date().toISOString();
  return { text: rawExportDocument(reply.value, now), name: backupFileName('giga-pinax-raw', now) };
}

async function exportRaw() {
  const file = await rawFile();
  download(file.text, file.name);
}

// One table row per bundled corpus: its counts and what it leaves out, the day its own metadata says
// its local files were made, its source and its licence. A corpus whose files cannot be read keeps its
// row and says so, rather than dropping out of the list.
function catalogueRow(corpus, metadata) {
  const row = document.createElement('tr');
  const name = document.createElement('th');
  name.setAttribute('scope', 'row');
  name.textContent = LOCAL_CORPORA[corpus].label;
  row.append(name);
  const cell = (text, note = '') => {
    const td = document.createElement('td');
    const main = document.createElement('span');
    main.textContent = text;
    td.append(main);
    if (note) {
      const small = document.createElement('small');
      small.textContent = note;
      td.append(small);
    }
    row.append(td);
    return td;
  };
  const usable = Number.isInteger(metadata?.recordCount) && Number.isInteger(metadata?.activeRecordCount);
  if (!usable) {
    const td = cell('');
    td.setAttribute('colspan', '3');
    td.textContent = 'Local catalogue unavailable.';
    return row;
  }
  const count = (value) => new Intl.NumberFormat('en-GB').format(value);
  const left = Number.isInteger(metadata.excluded?.count) && typeof metadata.excluded.reason === 'string'
    ? `Leaving out ${count(metadata.excluded.count)}: ${metadata.excluded.reason}.` : '';
  cell(`${count(metadata.activeRecordCount)} active of ${count(metadata.recordCount)}`, left);
  const generated = typeof metadata.generatedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(metadata.generatedOn)
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${metadata.generatedOn}T00:00:00Z`))
    : 'Date unknown';
  cell(generated, metadata.publicationDate ? `Source published ${metadata.publicationDate}` : '');
  const links = document.createElement('td');
  links.className = 'catalogue-links';
  for (const [url, text] of [[metadata.sourceUrl, 'Source'], [metadata.licenseUrl, 'Licence']]) {
    if (!/^https:\/\//.test(String(url))) continue;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;
    link.setAttribute('aria-label', `${LOCAL_CORPORA[corpus].label} ${text.toLowerCase()}`);
    links.append(link);
  }
  row.append(links);
  return row;
}

async function loadCatalogueInfo() {
  const corpora = Object.keys(LOCAL_CORPORA);
  const metadata = await Promise.all(corpora.map((corpus) => defaultLocalCatalogue?.metadata?.(corpus) ?? null));
  $('catalogue-list').replaceChildren(...corpora.map((corpus, index) => catalogueRow(corpus, metadata[index])));
}

$('add-premium').addEventListener('click', () => $('premium-list').append(premiumRow()));

// What Copy and Add pasted houses answer is said on the line under the paste button: the share fold is
// at the top of the page, and the page status at its foot is out of sight from there.
function shareStatus(message, error = false) {
  $('paste-status').textContent = message;
  $('paste-status').dataset.error = String(error);
}

// The rows as they stand, read with the rule Save uses, so what is copied is what would be saved.
$('copy-presets').addEventListener('click', async () => {
  shareStatus('');
  const presets = collectPresets();
  // A row that cannot be read has already said so beside its own field.
  if (!presets.ok) return;
  if (presets.value.length === 0) {
    shareStatus('There are no house presets to copy.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(housePresetsText(presets.value));
    const count = presets.value.length;
    shareStatus(`${count} house ${count === 1 ? 'preset' : 'presets'} copied. Paste them into Settings in another browser.`);
  } catch {
    shareStatus('The house presets could not be copied. Click Copy house presets again with this page in front.', true);
  }
});

const nameKey = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

// Pasted houses become rows like any other: a house already listed under the same name is redrawn with
// the pasted terms, the rest are added, and Save settings is still what keeps them.
$('paste-presets').addEventListener('click', () => {
  const parsed = parseHousePresets($('paste-presets-text').value);
  if (!parsed.ok) {
    shareStatus(parsed.error.message, true);
    return;
  }
  let added = 0;
  let updated = 0;
  for (const preset of parsed.value) {
    const existing = [...document.querySelectorAll('.premium-row')]
      .find((row) => nameKey(row.querySelector('.premium-name').value) === nameKey(preset.name));
    if (existing) {
      existing.after(premiumRow(preset));
      existing.remove();
      updated += 1;
    } else {
      $('premium-list').append(premiumRow(preset));
      added += 1;
    }
  }
  $('paste-presets-text').value = '';
  const parts = [added ? `${added} ${added === 1 ? 'house' : 'houses'} added` : '', updated ? `${updated} updated` : ''].filter(Boolean);
  shareStatus(`${parts.join(' and ')}. Review them, then Save settings.`.replace(/^./, (first) => first.toUpperCase()));
});

$('save-settings').addEventListener('click', async () => {
  const button = $('save-settings');
  button.disabled = true;
  try {
    if (behindStore) throw new Error(`Settings not saved: this page does not show the imported settings, and saving would overwrite them unseen. ${BEHIND_STORE_NOTE}`);
    const presets = collectPresets();
    if (!presets.ok) {
      status('');
      return;
    }
    // Blank is off, which the store takes as null; anything else must read as a rate.
    const importVatText = $('import-vat').value.trim();
    const importVat = importVatText ? parsePercent(importVatText, navigator.language, 'Import VAT') : { ok: true, value: null };
    if (!importVat.ok) {
      $('import-vat').setAttribute('aria-invalid', 'true');
      $('import-vat').focus();
      throw new Error(importVat.error.message);
    }
    $('import-vat').removeAttribute('aria-invalid');
    const theme = $('theme').value;
    const specimenPhotos = $('specimen-photos').checked;
    const reply = await bridge.sendCommand({
      type: 'preferences.save',
      requestId: bridge.newRequestId(),
      expectedRevision: preferencesSnapshot.preferences.revision,
      preferences: { currency: $('currency').value, importVatBps: importVat.value, housePremiumPresets: presets.value },
    });
    if (!reply.ok) {
      const message = reply.message || reply.error?.message || 'Could not save settings. Reload and review your changes.';
      // Saving again is refused the same way, so the collector is told the one way out.
      throw new Error(reply.code === 'conflict'
        ? `${message} Note what you typed, then reload this page to see the settings saved elsewhere.`
        : message);
    }
    preferencesSnapshot.preferences = reply.value;
    cacheDefaultCurrency(siteStorage(), preferencesSnapshot.preferences.currency);
    // Nothing is lost by failing to clear a theme that could never have been stored.
    const themeKept = rememberTheme(theme) || !theme;
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    const photosKept = rememberSpecimenPhotos(specimenPhotos);
    // A switch that could not be stored applies nothing, so the box is unticked to say so rather than left showing a setting that is not in force.
    if (!photosKept) $('specimen-photos').checked = false;
    renderedForm = formState();
    const lost = [
      themeKept ? '' : 'the theme applies to this page only and can’t be remembered',
      photosKept ? '' : 'specimen photos can’t be switched on',
    ].filter(Boolean).join(', and ');
    status(lost ? `Settings saved. This browser profile blocks site data, so ${lost}.` : 'Settings saved.');
  } catch (error) {
    status(error.message || 'Could not save settings.', true);
  } finally {
    button.disabled = false;
  }
});

$('export-backup').addEventListener('click', async () => {
  try {
    const latest = await bridge.getSnapshot();
    if (!latest?.ok) throw readFailure(latest, 'Could not read local records.');
    const result = exportBackup(latest.value, new Date().toISOString());
    if (!result.ok) throw new Error(result.error.message);
    download(result.value, `giga-pinax-${new Date().toISOString().slice(0, 10)}.json`);
    status('Backup exported.');
  } catch (error) {
    status(error.message || 'Could not export the backup.', true);
  }
});

// One table per click. Several files from one click is what a zip would be for, and there is no zip library here.
// Without one, a browser treats the second and later downloads of a click as automatic: Chrome and Brave can hold
// them behind a "download multiple files" site permission, so a table could go missing without a word. A single
// download from a click is an ordinary one in Brave, Chrome and Firefox alike.
function renderCsvTables() {
  $('csv-table').replaceChildren(...CSV_TABLES.map(({ key, label }) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = label;
    return option;
  }));
  $('csv-table').value = CSV_TABLES[0].key;
}

$('export-csv').addEventListener('click', async () => {
  try {
    const table = CSV_TABLES.find(({ key }) => key === $('csv-table').value) ?? CSV_TABLES[0];
    const latest = await bridge.getSnapshot();
    if (!latest?.ok) throw readFailure(latest, 'Could not read local records.');
    const files = csvFiles(latest.value);
    download(files[table.key], `giga-pinax-${table.key}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    status(`${table.label} exported as CSV.`);
  } catch (error) {
    status(error.message || 'Could not export the CSV file.', true);
  }
});

// The diagnostics are the collector's to hand over: nothing reads them but this card, and only a copy takes them off
// the page. The list is read again for every copy, so a failure recorded since the page opened is in it.
function manifestVersion() {
  try { return (globalThis.browser ?? globalThis.chrome)?.runtime?.getManifest?.()?.version; } catch { return undefined; }
}

function showDiagnosticsCount(entries) {
  $('diagnostics-count').textContent = entries.length === 0 ? 'No failures recorded.'
    : `${entries.length} ${entries.length === 1 ? 'failure' : 'failures'} recorded on this device.${entries.length > 5 ? ' The latest five:' : ''}`;
  // The latest five, newest first, so what just failed is read without copying the list (X-16).
  $('diagnostics-recent').replaceChildren(...recentDiagnosticLines(entries).map((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
}

async function refreshDiagnostics() {
  try {
    showDiagnosticsCount(await readDiagnostics());
  } catch {
    $('diagnostics-count').textContent = 'The diagnostics could not be read.';
  }
}

$('copy-diagnostics').addEventListener('click', async () => {
  let entries;
  try {
    entries = await readDiagnostics();
  } catch {
    status('The diagnostics could not be read.', true);
    return;
  }
  showDiagnosticsCount(entries);
  try {
    await navigator.clipboard.writeText(diagnosticsText(entries, { version: manifestVersion(), now: new Date().toISOString() }));
    status('Diagnostics copied.');
  } catch {
    status('The diagnostics could not be copied. Click Copy diagnostics again with this page in front.', true);
  }
});

$('clear-diagnostics').addEventListener('click', async () => {
  try {
    await clearDiagnostics();
    showDiagnosticsCount([]);
    status('Diagnostics cleared.');
  } catch {
    status('The diagnostics could not be cleared.', true);
  }
});

// Raw data is the rescue route: it reads storage without validating it, so it stays available even
// when nothing else on this page could load.
$('export-raw').addEventListener('click', async () => {
  try {
    await exportRaw();
    status('Raw data exported.');
  } catch (error) {
    status(error.message || 'Could not export the raw data.', true);
  }
});

$('download-quarantine').addEventListener('click', () => {
  download(
    quarantineDocument(quarantined, new Date().toISOString()),
    backupFileName('giga-pinax-set-aside', new Date().toISOString()),
  );
  status('Set-aside records exported.');
});

for (const eventName of ['input', 'change']) $('import-file').addEventListener(eventName, clearPreview);
for (const radio of document.querySelectorAll('[name="mode"]')) radio.addEventListener('change', clearPreview);

$('import-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearPreview();
  const form = event.currentTarget;
  const mode = new FormData(form).get('mode');
  const generation = previewGeneration;
  const file = $('import-file').files?.[0];
  if (!file) return status('Choose a backup file.', true);
  // A large backup takes a second or more to read and compare, so the button says it is working (K-13).
  $('preview-import').textContent = 'Reading…';
  $('preview-import').disabled = true;
  try {
    // Reading a file far larger than any backup into memory is what the bound is there to prevent.
    if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 16 MiB limit.');
    const documentText = await file.text();
    if (generation !== previewGeneration) return;
    const validated = validateBackup(documentText);
    if (!validated.ok) throw new Error(validated.error.message);
    const latest = await bridge.getSnapshot();
    if (generation !== previewGeneration) return;
    // Over records nothing can read, a backup can only replace them, counted on from the revision the rescue copy reports
    // (X-02); the copy that goes to disk first is that rescue file.
    const overUnreadable = isUnreadable(latest);
    if (overUnreadable && mode !== 'replace') {
      throw new Error('Your records can’t be read, so a backup can only replace them. Choose Replace local records, then Preview import.');
    }
    if (!latest?.ok && !overUnreadable) throw new Error(latest?.message || 'Could not read local records.');
    let expectedRevision = latest.value?.revision;
    if (overUnreadable) {
      const raw = await bridge.sendCommand({ type: 'snapshot.raw', requestId: bridge.newRequestId() });
      if (generation !== previewGeneration) return;
      if (!raw?.ok) throw new Error(raw?.message || 'Could not read local storage.');
      expectedRevision = raw.revision;
    }
    const result = overUnreadable ? previewReplaceOverUnreadable(validated.value) : previewImport(latest.value, validated.value, mode);
    if (!result.ok) throw new Error(result.error.message);
    pendingImport = {
      generation,
      document: documentText,
      mode,
      preview: result.value,
      expectedRevision,
      overUnreadable,
    };
    // Said before Confirm, not after it (X-13): an import that would not fit, and a merge that would change nothing.
    const nothing = importNothingText(result.value);
    const fit = importFit(overUnreadable ? null : latest.value, result.value);
    $('import-counts').textContent = overUnreadable
      ? `${importCountsText(result.value).replace(/ Replaces everything local\.$/, '')} Replaces the records that can’t be read; a copy of them downloads first.`
      : importCountsText(result.value);
    // Untrusted text from a backup file, so every line is written as text and never as markup.
    const lines = [...importChangeLines(result.value), ...importIssueLines(result.value)];
    $('import-conflicts').replaceChildren(...lines.map((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    }));
    if (nothing) $('import-counts').textContent = nothing;
    $('confirm-import').disabled = !result.value.snapshot || Boolean(nothing) || !fit.ok;
    $('import-preview').hidden = false;
    status(nothing || fit.text || 'Review the import summary, then confirm.', !nothing && !fit.ok);
  } catch (error) {
    if (generation === previewGeneration) {
      clearPreview();
      status(error.message || 'Could not preview the backup.', true);
    }
  } finally {
    $('preview-import').textContent = 'Preview import';
    $('preview-import').disabled = false;
  }
});

$('confirm-import').addEventListener('click', async () => {
  const pending = pendingImport;
  if (!pending?.preview.snapshot || pending.generation !== previewGeneration) return;
  if (pending.mode === 'replace' && !confirm('Replace local records with this backup?')) return;
  // Disabled before anything is downloaded or sent, so a second click cannot issue a second copy
  // and a second command.
  $('confirm-import').disabled = true;
  $('confirm-import').textContent = 'Importing…';
  // A merge that replaces even one record overwrites a body this install never saw, so it earns
  // the same copy on disk as a replace does.
  const overwrites = pending.mode === 'replace' || pending.preview.counts.updated > 0;
  const send = () => bridge.sendCommand({
    type: 'backup.import',
    requestId: bridge.newRequestId(),
    expectedRevision: pending.expectedRevision,
    mode: pending.mode,
    document: pending.document,
    ...(pending.overUnreadable ? { overUnreadable: true } : {}),
  });
  let copied = '';
  try {
    const result = overwrites
      ? await importWithSafetyCopy({ exportCopy: pending.overUnreadable ? rawFile : safetyCopyFile, exportRaw: rawFile, download, confirm, send })
      : { sent: true, copied: null, reply: await send() };
    // A page cannot see a download land, so the wording claims only what it did. It is written down
    // before anything can throw, so a command that failed still reports the copy that was made.
    copied = result.copied ? `Download of a safety copy started: ${result.copied}. ` : '';
    if (!result.sent) {
      $('confirm-import').disabled = false;
      return status(`${copied}Import cancelled. Nothing was changed.`);
    }
    if (result.error) throw result.error;
    if (!result.reply?.ok) throw new Error(result.reply?.message || 'Local data changed. Preview the import again.');
    clearPreview();
    status(`${copied}Backup imported.`);
    // The imported records are this page's own state too, and an open workspace picks the same
    // write up through its storage subscription. A redraw would throw away settings typed and not
    // yet saved, so over those the page keeps them, reads only the set-aside list again and says so.
    // A page whose first load failed drew no settings, so it has nothing to keep and loads now.
    if (!preferencesSnapshot || formState() === renderedForm) {
      await load().catch((error) => status(`${copied}Backup imported, but this page could not reload: ${error.message}`, true));
      return;
    }
    await refreshDataHealth().then((latest) => {
      cacheDefaultCurrency(siteStorage(), latest.preferences?.currency);
      if (!sameSettings(latest.preferences, preferencesSnapshot.preferences)) {
        behindStore = true;
        status(`${copied}Backup imported. The settings above are the ones you had not saved, not the imported ones. ${BEHIND_STORE_NOTE}`);
      }
    }).catch((error) => status(`${copied}Backup imported, but this page could not reload: ${error.message}`, true));
  } catch (error) {
    clearPreview();
    status(`${copied}${error.message || 'Could not import the backup. Preview it again.'}`, true);
  } finally {
    $('confirm-import').textContent = 'Confirm import';
  }
});

// Settings opened from the workspace offers the way back to it; opened from the popup there is no page to return to, so
// the link closes this tab instead (G-25). The workspace says where it opened Settings from in the address.
async function closeSettingsTab() {
  const api = globalThis.browser ?? globalThis.chrome;
  try {
    const tab = await api?.tabs?.getCurrent?.();
    if (tab?.id !== undefined) { await api.tabs.remove(tab.id); return; }
  } catch { /* try the page's own close */ }
  try { globalThis.close?.(); } catch { /* nothing more a page can do */ }
}
// The workspace may name what it opened Settings for after its own mark ("#from-workspace%3Fdata-health").
if (!/^#from-workspace/.test(globalThis.location?.hash ?? '')) {
  $('settings-return').textContent = 'Close';
  $('settings-return').addEventListener('click', (event) => { event.preventDefault(); void closeSettingsTab(); });
}

clearPreview();
renderCsvTables();
renderAppearance();
currencyOptions($('currency'));
void refreshDiagnostics();
void load().catch((error) => status(error.message || 'Could not load settings.', true));
void loadCatalogueInfo();
