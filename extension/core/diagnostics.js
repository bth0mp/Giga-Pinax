// A short local record of what failed, for the collector to copy into a bug report.
//
// It lives under its own key in extension storage, beside the records rather than inside them: never part of the
// validated root, a backup or the raw rescue file, and never sent anywhere. Each entry is built from an allow-list of
// fields, each checked against a fixed set or a fixed shape - when, which page, which area, what kind of failure, an
// HTTP status, a byte count and the extension version - so a search term, a reference, a URL, a record or any page
// text cannot reach it whatever a caller hands in. Recording is a side effect of a failure that is already being
// handled, so it never throws and never makes the caller wait on it.
//
// ponytail: two pages failing in the same instant can each read the list before the other writes, and one entry is
// then lost. Within one page the writes are queued; across pages a lost diagnostic is not worth a lock.

export const DIAGNOSTICS_KEY = 'gigaPinax:diagnostics:v1';
export const MAX_DIAGNOSTICS = 50;

const PAGES = new Set(['popup', 'workspace', 'settings', 'background']);
const AREAS = new Set(['lookup', 'specimens', 'acsearch', 'coinarchives', 'store', 'capture', 'reminders']);
const CODES = new Set([
  'http', 'network', 'timeout', 'aborted', 'too-large', 'parse', 'redirect', 'content-type',
  'storage', 'validation', 'conflict', 'unsupported', 'duplicate', 'not-saved', 'not-opened', 'failed',
]);
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const VERSION = /^\d{1,5}(?:\.\d{1,5}){0,3}$/;

const inSet = (set, value, fallback) => (typeof value === 'string' && set.has(value) ? value : fallback);

// The page an extension page is served as: popup.html (the side panel too), workspace.html, settings.html, and the
// background worker or the page Firefox generates for it.
export function pageFromPath(pathname) {
  const name = String(pathname ?? '').split('/').pop();
  if (name === 'popup.html') return 'popup';
  if (name === 'workspace.html') return 'workspace';
  if (name === 'settings.html') return 'settings';
  return /background/.test(name) ? 'background' : 'other';
}

// Every field is rebuilt from nothing: what is not on the list, or not in its shape, is left behind.
export function diagnosticEntry(input, { at, page, version } = {}) {
  if (!input || typeof input !== 'object' || !AREAS.has(input.area) || !INSTANT.test(String(at))) return null;
  const entry = { at, page: inSet(PAGES, page, 'other'), area: input.area, code: inSet(CODES, input.code, 'other') };
  if (Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) entry.status = input.status;
  if (Number.isSafeInteger(input.bytes) && input.bytes >= 0) entry.bytes = input.bytes;
  entry.version = typeof version === 'string' && VERSION.test(version) ? version : 'unknown';
  return entry;
}

// A stored entry is checked again as it is read, so a key edited by hand cannot carry text out through a copy.
const storedEntry = (entry) => (entry && typeof entry === 'object' && !Array.isArray(entry)
  ? diagnosticEntry(entry, entry) : null);

// A failed request described by its status or its kind. The error's message is never read: a browser can put the
// address, and with it the search term, into one.
export function fetchFailureFields(error) {
  if (Number.isInteger(error?.status)) return { code: 'http', status: error.status };
  if (error?.message === 'too-large') return { code: 'too-large' };
  if (error?.name === 'TimeoutError') return { code: 'timeout' };
  if (error?.name === 'AbortError') return { code: 'aborted' };
  if (error?.name === 'SyntaxError') return { code: 'parse' };
  return { code: 'network' };
}

function extensionApi() {
  return globalThis.browser ?? globalThis.chrome;
}

// The API is looked up when a failure is recorded, not when this module loads: lookup.js and prices.js import it,
// and they load in tests and pages long before, or entirely without, an extension API. Manifest V3 storage answers
// with a promise in Brave, Chrome and Firefox alike.
function extensionStorage() {
  const area = extensionApi()?.storage?.local;
  if (!area) return null;
  return { get: (key) => area.get(key), set: (items) => area.set(items) };
}

function manifestVersion() {
  try { return extensionApi()?.runtime?.getManifest?.()?.version; } catch { return undefined; }
}

function context(options) {
  return {
    storage: options.storage === undefined ? extensionStorage() : options.storage,
    at: typeof options.now === 'function' ? options.now() : new Date().toISOString(),
    page: options.page ?? pageFromPath(globalThis.location?.pathname),
    version: options.version ?? manifestVersion(),
  };
}

async function storedList(storage) {
  const value = (await storage.get(DIAGNOSTICS_KEY))?.[DIAGNOSTICS_KEY];
  return Array.isArray(value) ? value : [];
}

let queue = Promise.resolve();

// Resolves true once the entry is stored and false otherwise; it never rejects.
export function recordDiagnostic(input, options = {}) {
  const write = async () => {
    const { storage, at, page, version } = context(options ?? {});
    const entry = diagnosticEntry(input, { at, page: input?.page ?? page, version });
    if (!entry || !storage) return false;
    const kept = (await storedList(storage)).map(storedEntry).filter(Boolean);
    await storage.set({ [DIAGNOSTICS_KEY]: [...kept, entry].slice(-MAX_DIAGNOSTICS) });
    return true;
  };
  const result = queue.then(write).catch(() => false);
  queue = result;
  return result;
}

export function recordFetchFailure(area, error, extra = {}, options = {}) {
  try {
    return recordDiagnostic({ ...extra, ...fetchFailureFields(error), area }, options);
  } catch {
    return Promise.resolve(false);
  }
}

export async function readDiagnostics(options = {}) {
  const { storage } = context(options);
  if (!storage) return [];
  return (await storedList(storage)).map(storedEntry).filter(Boolean).slice(-MAX_DIAGNOSTICS);
}

export async function clearDiagnostics(options = {}) {
  const { storage } = context(options);
  if (storage) await storage.set({ [DIAGNOSTICS_KEY]: [] });
}

function entryLine(entry) {
  const parts = [entry.at, entry.page, entry.area, entry.code];
  if (entry.status !== undefined) parts.push(String(entry.status));
  if (entry.bytes !== undefined) parts.push(`over ${entry.bytes} bytes`);
  return `${parts.join(' ')} (${entry.version})`;
}

export function diagnosticsText(entries, { version, now } = {}) {
  const lines = [
    'Giga Pinax diagnostics',
    `Version: ${typeof version === 'string' && VERSION.test(version) ? version : 'unknown'}`,
    `Copied: ${INSTANT.test(String(now)) ? now : 'unknown'}`,
  ];
  const kept = (Array.isArray(entries) ? entries : []).map(storedEntry).filter(Boolean);
  if (kept.length === 0) lines.push('No failures recorded.');
  else lines.push(`Failures recorded: ${kept.length} (oldest first, at most ${MAX_DIAGNOSTICS} kept)`, ...kept.map(entryLine));
  return `${lines.join('\n')}\n`;
}
