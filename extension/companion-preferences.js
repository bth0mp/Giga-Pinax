import { CURRENCIES } from './core/money.js';
import { restorePreferences } from './sample-data.js';

export const GIGA_PREFERENCES_KEY = 'giga-pinax-preferences-v1';
export const LEGACY_COMPANION_PREFERENCES_KEY = 'coin-lookup-test-preferences-v1';

const DEFAULT_COMPANION_PREFERENCES = Object.freeze({
  currency: 'USD',
  catalogue: 'Price',
  number: '23',
  volume: 'I (2nd edition)',
  section: 'Nero',
  sampleMode: false,
});

function storedValue(storage, key) {
  try { return storage?.getItem?.(key) ?? null; }
  catch { return null; }
}

function gigaCurrency(storage) {
  const raw = storedValue(storage, GIGA_PREFERENCES_KEY);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && CURRENCIES.includes(parsed.currency)
      ? parsed.currency
      : DEFAULT_COMPANION_PREFERENCES.currency;
  } catch {
    return DEFAULT_COMPANION_PREFERENCES.currency;
  }
}

export async function initializeCompanionPreferences(bridge, storage) {
  const current = await bridge.getSnapshot();
  if (!current.ok || current.value.preferences) return current;

  const legacy = storedValue(storage, LEGACY_COMPANION_PREFERENCES_KEY);
  const preferences = legacy === null
    ? { ...DEFAULT_COMPANION_PREFERENCES, currency: gigaCurrency(storage) }
    : restorePreferences(legacy);
  const migrated = await bridge.sendCommand({
    type: 'preferences.migrateIfAbsent',
    requestId: bridge.newRequestId(),
    preferences,
  });
  if (!migrated.ok) return migrated;

  if (legacy !== null) {
    try { storage?.removeItem?.(LEGACY_COMPANION_PREFERENCES_KEY); }
    catch { /* a later initialization may retry cleanup */ }
  }
  return bridge.getSnapshot();
}
