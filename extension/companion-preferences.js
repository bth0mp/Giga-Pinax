import { CURRENCIES } from './core/money.js';

export const GIGA_PREFERENCES_KEY = 'giga-pinax-preferences-v1';
const LEGACY_COMPANION_PREFERENCES_KEY = 'coin-lookup-test-preferences-v1';

const DEFAULT_CURRENCY = 'USD';
// Said by saveCurrency for a bridge that answers nothing, and by the popup for one that cannot be
// asked at all: one wording for the same loss, defined where the function that returns it lives.
export const CURRENCY_NOT_SAVED = 'The currency could not be saved.';

function storedValue(storage, key) {
  try { return storage?.getItem?.(key) ?? null; }
  catch { return null; }
}

// Both local keys held a whole research form; the currency is the only field of it the durable root
// still keeps, so it is all that is read out of either one. Untrusted: anything else is the default.
function storedCurrency(raw) {
  let saved;
  try { saved = JSON.parse(raw); } catch { saved = null; }
  return saved && typeof saved === 'object' && !Array.isArray(saved) && CURRENCIES.includes(saved.currency)
    ? saved.currency
    : DEFAULT_CURRENCY;
}

// The research popup opens, looks up and prices before the background can answer, so it prices in a
// display cache of the default currency kept in the local storage the extension's pages share. A
// page that changes the stored default writes that cache too: without it the next popup priced once
// in the currency just replaced and then showed an empty panel. Only the currency is written; the
// rest of the cache belongs to the research form.
export function cacheDefaultCurrency(storage, currency) {
  if (!CURRENCIES.includes(currency)) return false;
  let cached;
  try { cached = JSON.parse(storedValue(storage, GIGA_PREFERENCES_KEY)); } catch { cached = null; }
  const kept = cached && typeof cached === 'object' && !Array.isArray(cached) ? cached : {};
  try { storage?.setItem?.(GIGA_PREFERENCES_KEY, JSON.stringify({ ...kept, currency })); }
  catch { return false; }
  return true;
}

// The snapshot is the single home for the default currency, and preferences.save is gated on the
// revision the caller read. A save that loses that race is retried once against the revision a
// re-read reports; a second conflict is another view still writing, and is left to it rather than
// answered by a loop that would keep overwriting whatever it finds.
export async function saveCurrency(bridge, currency, preferences) {
  const write = async (current) => {
    if (!current || !Number.isInteger(current.revision)) {
      return { ok: false, code: 'not-ready', message: 'Preferences are not ready. Reload and try again.' };
    }
    const reply = await bridge.sendCommand({
      type: 'preferences.save',
      requestId: bridge.newRequestId(),
      expectedRevision: current.revision,
      preferences: { currency },
    });
    return reply ?? { ok: false, message: CURRENCY_NOT_SAVED };
  };
  const first = await write(preferences);
  if (first.ok || first.code !== 'conflict') return first;
  const reread = await bridge.getSnapshot();
  if (!reread?.ok) return reread ?? { ok: false, message: CURRENCY_NOT_SAVED };
  return write(reread.value.preferences);
}

export async function initializeCompanionPreferences(bridge, storage) {
  const current = await bridge.getSnapshot();
  if (!current.ok || current.value.preferences) return current;

  // The seed, used once: the key the companion wrote before this build if it is still there, else
  // the research form's own. After this the snapshot is the single home for the default currency.
  const legacy = storedValue(storage, LEGACY_COMPANION_PREFERENCES_KEY);
  const preferences = {
    currency: storedCurrency(legacy ?? storedValue(storage, GIGA_PREFERENCES_KEY)),
  };
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
