// The popup's access to the sites it reads (popup.js): whether an origin is granted, asking for it
// inside the collector's own gesture, and the Reference box kept across the prompt that can close the
// popup in Firefox.
import { ACSEARCH_ORIGIN } from './prices.js';
import { $ } from './popup-shell.js';

const api = globalThis.browser ?? globalThis.chrome;

// Origins this popup has already seen granted: permissions.request opens no prompt for them, so nothing it does can close the popup.
const grantedOrigins = new Set();
function noteGranted(origins, allowed) {
  if (allowed) for (const origin of origins) grantedOrigins.add(origin);
  return allowed;
}

async function hasHostAccess(origins) {
  if (!api?.permissions?.contains) return true;
  try { return noteGranted(origins, (await api.permissions.contains({ origins })) === true); } catch { return false; }
}

// Checks without prompting; true on a plain page with no permissions API, false if the check fails.
async function hasAcsearchAccess() {
  if (!api?.permissions?.contains) return true;
  try { return noteGranted([ACSEARCH_ORIGIN], (await api.permissions.contains({ origins: [ACSEARCH_ORIGIN] })) === true); }
  catch { return false; }
}

// Firefox closes the popup over its own permission prompt, taking what was typed with it, and "select Look up again" then has nothing to look up. The
// Reference box is kept in the extension's own session area, which outlives that document; the popup's sessionStorage dies with it, which is the case
// this exists for. ponytail: where storage.session is missing, nothing is kept - no other store survives the closing popup.
const PENDING_KEY = 'giga-pinax-pending-reference-v1';
const sessionArea = () => api?.storage?.session ?? null;
function rememberPendingReference() {
  // Never awaited: permissions.request must stay the first await after the user gesture, or the browser no longer treats it as one.
  try { void Promise.resolve(sessionArea()?.set({ [PENDING_KEY]: $('quick-reference').value })).catch(() => {}); }
  catch { /* the prompt still opens; only the refill is lost */ }
}
function forgetPendingReference() {
  try { void Promise.resolve(sessionArea()?.remove(PENDING_KEY)).catch(() => {}); }
  catch { /* nothing was kept */ }
}

// Called synchronously from a submit handler so the request keeps the user gesture; resolves true without a prompt when access is already granted.
// remember is for the two flows a closed popup costs something: a reference typed into the box and looked up. The price buttons and the online fallback
// ask about a reference that is already on the card, so they keep none - keeping one there wrote it back after the lookup had forgotten it.
function requestHostAccess(origins, { remember = false } = {}) {
  if (!api?.permissions?.request) return Promise.resolve(true);
  // Only a prompt can close the popup, and only an origin this popup has not seen granted opens one.
  const kept = remember && origins.some((origin) => !grantedOrigins.has(origin));
  if (kept) rememberPendingReference();
  let pending;
  try { pending = api.permissions.request({ origins }); } catch (error) { pending = Promise.reject(error); }
  return Promise.resolve(pending).catch(() => {
    try { return Promise.resolve(api.permissions.contains({ origins })).catch(() => true); }
    catch { return true; }
  }).then((allowed) => {
    // Answered here, so this popup outlived its own prompt: the box still holds what was typed, and there is nothing left to put back.
    if (kept) forgetPendingReference();
    return noteGranted(origins, allowed);
  });
}

export {
  PENDING_KEY, api, forgetPendingReference, hasAcsearchAccess, hasHostAccess, requestHostAccess, sessionArea,
};
