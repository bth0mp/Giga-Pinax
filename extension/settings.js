import {
  MAX_BACKUP_BYTES, backupFileName, exportBackup, importChangeLines, importCountsText,
  importIssueLines, importWithSafetyCopy, previewImport, quarantineDocument, quarantineLines,
  quarantineSummaryText, rawExportDocument, validateBackup,
} from './core/backup.js';
import { formatIncrementLadder, formatMinorInput, presetFromFields } from './bid-tools.js';
import * as bridge from './browser-api.js';
import { initializeCompanionPreferences } from './companion-preferences.js';
import './updates.js';
import { catalogueMetadataText, defaultLocalCatalogue } from './local-catalogue.js';

const $ = (id) => document.getElementById(id);
let preferencesSnapshot;
let pendingImport = null;
let previewGeneration = 0;
let quarantined = [];

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
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

function premiumRow(item = { name: '', buyerPremiumBps: null }) {
  const row = document.createElement('div');
  row.className = 'premium-row';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Auction house';
  const name = document.createElement('input');
  name.className = 'premium-name';
  name.maxLength = 120;
  name.value = item.name;
  nameLabel.append(name);
  const bpsLabel = document.createElement('label');
  bpsLabel.textContent = 'Premium %';
  const bps = document.createElement('input');
  bps.className = 'premium-value';
  bps.type = 'text';
  bps.inputMode = 'decimal';
  bps.placeholder = 'e.g. 22.50';
  bps.value = formatMinorInput(item.buyerPremiumBps, navigator.language);
  bpsLabel.append(bps);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'quiet';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => row.remove());
  const ladderLabel = document.createElement('label');
  ladderLabel.className = 'premium-ladder-field';
  const ladderCaption = document.createElement('span');
  ladderCaption.textContent = 'Increment ladder (optional)';
  const ladderHint = document.createElement('span');
  ladderHint.className = 'premium-hint';
  // Giga Pinax ships no house's schedule: the tiers are the collector's own transcription, so the
  // example in the box says only what the format is.
  ladderHint.textContent = 'One tier per line, written “from: step”, in the house’s own currency. Copy the tiers from that house’s published terms — Giga Pinax ships no house’s ladder, and the example in the box is only the format.';
  const ladder = document.createElement('textarea');
  ladder.className = 'premium-ladder';
  ladder.rows = 4;
  ladder.placeholder = '0: 5\n100: 10\n500: 25';
  ladder.value = formatIncrementLadder(item.incrementLadder, navigator.language);
  ladderLabel.append(ladderCaption, ladderHint, ladder);
  const error = document.createElement('p');
  error.className = 'premium-error';
  error.setAttribute('role', 'alert');
  row.append(nameLabel, bpsLabel, remove, ladderLabel, error);
  return row;
}

const PRESET_FIELD_CLASS = { name: 'premium-name', premium: 'premium-value', ladder: 'premium-ladder' };

function renderDataHealth(entries) {
  quarantined = Array.isArray(entries) ? entries : [];
  const summary = quarantineSummaryText(quarantined);
  $('data-health').hidden = !summary;
  $('quarantine-summary').textContent = summary;
  $('quarantine-list').replaceChildren(...quarantineLines(quarantined).map((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
}

function render() {
  $('currency').value = preferencesSnapshot.preferences.currency;
  $('theme').value = localStorage.getItem('giga-pinax-theme-v1') ?? '';
  $('premium-list').replaceChildren(
    ...(preferencesSnapshot.preferences.housePremiumPresets ?? []).map(premiumRow),
  );
}

function collectPresets() {
  const rows = [...document.querySelectorAll('.premium-row')];
  for (const row of rows) {
    row.querySelector('.premium-error').textContent = '';
    for (const control of row.querySelectorAll('input, textarea')) control.removeAttribute('aria-invalid');
  }
  const values = [];
  for (const [index, row] of rows.entries()) {
    const field = presetFromFields({
      name: row.querySelector('.premium-name').value,
      premiumText: row.querySelector('.premium-value').value,
      ladderText: row.querySelector('.premium-ladder').value,
    }, { currency: $('currency').value, locale: navigator.language });
    if (field.ok) {
      values.push(field.value);
      continue;
    }
    // The message belongs beside the field it is about; the status line only says which house.
    const control = row.querySelector(`.${PRESET_FIELD_CLASS[field.error.field]}`);
    row.querySelector('.premium-error').textContent = field.error.message;
    control.setAttribute('aria-invalid', 'true');
    control.focus();
    throw new Error(`House ${index + 1}: ${field.error.message}`);
  }
  return values;
}

async function load() {
  const reply = await initializeCompanionPreferences(bridge, localStorage);
  if (!reply?.ok || !reply.value?.preferences) {
    throw new Error(reply?.message || 'Could not load settings.');
  }
  preferencesSnapshot = reply.value;
  render();
  renderDataHealth(preferencesSnapshot.quarantine);
  $('save-settings').disabled = false;
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

async function loadCatalogueInfo() {
  const metadata = await defaultLocalCatalogue?.metadata?.();
  $('catalogue-coverage').textContent = catalogueMetadataText(metadata);
  $('catalogue-source').href = metadata?.sourceUrl ?? 'https://numismatics.org/ocre/';
  $('catalogue-license').href = metadata?.licenseUrl ?? 'https://opendatacommons.org/licenses/odbl/';
}

$('add-premium').addEventListener('click', () => $('premium-list').append(premiumRow()));

$('save-settings').addEventListener('click', async () => {
  const button = $('save-settings');
  button.disabled = true;
  try {
    const presets = collectPresets();
    const theme = $('theme').value;
    const reply = await bridge.sendCommand({
      type: 'preferences.save',
      requestId: bridge.newRequestId(),
      expectedRevision: preferencesSnapshot.preferences.revision,
      preferences: { currency: $('currency').value, housePremiumPresets: presets },
    });
    if (!reply.ok) {
      throw new Error(reply.message || reply.error?.message || 'Could not save settings. Reload and review your changes.');
    }
    preferencesSnapshot.preferences = reply.value;
    if (theme) localStorage.setItem('giga-pinax-theme-v1', theme);
    else localStorage.removeItem('giga-pinax-theme-v1');
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    status('Settings saved.');
  } catch (error) {
    status(error.message || 'Could not save settings.', true);
  } finally {
    button.disabled = false;
  }
});

$('export-backup').addEventListener('click', async () => {
  try {
    const latest = await bridge.getSnapshot();
    if (!latest?.ok) throw new Error(latest?.message || 'Could not read local records.');
    const result = exportBackup(latest.value, new Date().toISOString());
    if (!result.ok) throw new Error(result.error.message);
    download(result.value, `giga-pinax-${new Date().toISOString().slice(0, 10)}.json`);
    status('Backup exported.');
  } catch (error) {
    status(error.message || 'Could not export the backup.', true);
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
  try {
    // Reading a file far larger than any backup into memory is what the bound is there to prevent.
    if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 16 MiB limit.');
    const documentText = await file.text();
    if (generation !== previewGeneration) return;
    const validated = validateBackup(documentText);
    if (!validated.ok) throw new Error(validated.error.message);
    const latest = await bridge.getSnapshot();
    if (generation !== previewGeneration) return;
    if (!latest?.ok) throw new Error(latest?.message || 'Could not read local records.');
    const currentSnapshot = latest.value;
    const result = previewImport(currentSnapshot, validated.value, mode);
    if (!result.ok) throw new Error(result.error.message);
    pendingImport = {
      generation,
      document: documentText,
      mode,
      preview: result.value,
      expectedRevision: currentSnapshot.revision,
    };
    $('import-counts').textContent = importCountsText(result.value);
    // Untrusted text from a backup file, so every line is written as text and never as markup.
    const lines = [...importChangeLines(result.value), ...importIssueLines(result.value)];
    $('import-conflicts').replaceChildren(...lines.map((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    }));
    $('confirm-import').disabled = !result.value.snapshot;
    $('import-preview').hidden = false;
    status('Review the import summary, then confirm.');
  } catch (error) {
    if (generation === previewGeneration) {
      clearPreview();
      status(error.message || 'Could not preview the backup.', true);
    }
  }
});

$('confirm-import').addEventListener('click', async () => {
  const pending = pendingImport;
  if (!pending?.preview.snapshot || pending.generation !== previewGeneration) return;
  if (pending.mode === 'replace' && !confirm('Replace local records with this backup?')) return;
  // Disabled before anything is downloaded or sent, so a second click cannot issue a second copy
  // and a second command.
  $('confirm-import').disabled = true;
  // A merge that replaces even one record overwrites a body this install never saw, so it earns
  // the same copy on disk as a replace does.
  const overwrites = pending.mode === 'replace' || pending.preview.counts.updated > 0;
  const send = () => bridge.sendCommand({
    type: 'backup.import',
    requestId: bridge.newRequestId(),
    expectedRevision: pending.expectedRevision,
    mode: pending.mode,
    document: pending.document,
  });
  let copied = '';
  try {
    const result = overwrites
      ? await importWithSafetyCopy({ exportCopy: safetyCopyFile, exportRaw: rawFile, download, confirm, send })
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
    // write up through its storage subscription.
    await load().catch((error) => status(`${copied}Backup imported, but this page could not reload: ${error.message}`, true));
  } catch (error) {
    clearPreview();
    status(`${copied}${error.message || 'Could not import the backup. Preview it again.'}`, true);
  }
});

clearPreview();
void load().catch((error) => status(error.message || 'Could not load settings.', true));
void loadCatalogueInfo();
