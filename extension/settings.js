import { exportBackup, previewImport, validateBackup } from './core/backup.js';
import { parsePremiumPercent } from './core/money.js';
import { formatMinorInput } from './bid-tools.js';
import * as bridge from './browser-api.js';
import { initializeCompanionPreferences } from './companion-preferences.js';
import './updates.js';
import { catalogueMetadataText, defaultLocalCatalogue } from './local-catalogue.js';

const $ = (id) => document.getElementById(id);
let preferencesSnapshot;
let pendingImport = null;
let previewGeneration = 0;

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
  row.append(nameLabel, bpsLabel, remove);
  return row;
}

function render() {
  $('currency').value = preferencesSnapshot.preferences.currency;
  $('theme').value = localStorage.getItem('giga-pinax-theme-v1') ?? '';
  $('premium-list').replaceChildren(
    ...(preferencesSnapshot.preferences.housePremiumPresets ?? []).map(premiumRow),
  );
}

function collectPresets() {
  const values = [];
  for (const [index, row] of [...document.querySelectorAll('.premium-row')].entries()) {
    const name = row.querySelector('.premium-name').value.trim();
    const parsed = parsePremiumPercent(
      row.querySelector('.premium-value').value,
      navigator.language,
    );
    if (!name) throw new Error(`House ${index + 1} needs a name.`);
    if (!parsed.ok) throw new Error(`House ${index + 1}: ${parsed.error.message}`);
    values.push({ name, buyerPremiumBps: parsed.value });
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
  $('save-settings').disabled = false;
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
    const url = URL.createObjectURL(new Blob([result.value], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `giga-pinax-${new Date().toISOString().slice(0, 10)}.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    status('Backup exported.');
  } catch (error) {
    status(error.message || 'Could not export the backup.', true);
  }
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
    const counts = result.value.counts;
    const outgoing = Object.values(counts.outgoing).reduce((sum, count) => sum + count, 0);
    const incoming = Object.values(counts.incoming).reduce((sum, count) => sum + count, 0);
    $('import-counts').textContent = `Local: ${outgoing} records. Backup: ${incoming} records.`;
    $('import-conflicts').replaceChildren(...result.value.conflicts.map((conflict) => {
      const item = document.createElement('li');
      item.textContent = `${conflict.collection}: ${conflict.reason}`;
      return item;
    }));
    $('confirm-import').disabled = !result.value.snapshot || result.value.conflicts.length > 0;
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
  $('confirm-import').disabled = true;
  try {
    const reply = await bridge.sendCommand({
      type: 'backup.import',
      requestId: bridge.newRequestId(),
      expectedRevision: pending.expectedRevision,
      mode: pending.mode,
      document: pending.document,
    });
    if (!reply.ok) throw new Error(reply.message || 'Local data changed. Preview the import again.');
    clearPreview();
    await load();
    status('Backup imported.');
  } catch (error) {
    clearPreview();
    status(error.message || 'Could not import the backup. Preview it again.', true);
  }
});

clearPreview();
void load().catch((error) => status(error.message || 'Could not load settings.', true));
void loadCatalogueInfo();
