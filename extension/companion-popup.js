import { formatMoney } from './core/money.js';
import { projectExposure } from './core/records.js';
import { localDateAtInstant } from './core/reminders.js';
import { buildResearchDraft, buildResearchQuery, collectCurrentLotCandidates } from './current-lot.js';
import { mountBidCalculator } from './bid-tools.js';
import { mountSourcesMenu } from './source-menu.js';
import { openResearchPanel, openSettings, openWorkspace } from './navigation.js';

const TABS = Object.freeze(['research', 'calculator', 'watchlist']);
const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);
const bounded = (value, maximum) => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, maximum)
  : '';

export function documentMode(search = '') {
  const parameters = new URLSearchParams(search);
  const panel = parameters.get('panel') === '1';
  const windowed = parameters.get('window') === '1';
  // Only the lookup window takes a right-click's reference: the panel fallback stands in for a sidebar the browser wouldn't open, and a lookup sent to
  // it would land beside the page it was meant to leave.
  return { panel, windowed, acceptsLookupMessages: windowed && !panel };
}

export function shouldRevealRefine(outcome, field = '') {
  return outcome?.status === 'candidates' || outcome?.status === 'too-many'
    || Boolean(field && ['catalogue', 'reference-number', 'ric-volume', 'ric-section'].includes(field));
}

// Research coin needs a query as well as a draft: a capture that gave no readable reference has fields to edit and can still be saved to the watchlist,
// but nothing to look up.
export function captureControlsState(pending, hasDraft, researchable = hasDraft) {
  return { editorVisible: !pending, fieldsDisabled: pending, actionsDisabled: pending || !hasDraft, researchDisabled: pending || !hasDraft || !researchable };
}

export async function runVisibleAction(action, fallback) {
  try {
    const result = await action();
    return result?.ok === false ? { ok: false, message: result.message || fallback } : { ok: true };
  } catch (error) { return { ok: false, message: error?.message || fallback }; }
}

export function moveCompanionTab(current, key) {
  const index = Math.max(0, TABS.indexOf(current));
  if (key === 'Home') return TABS[0];
  if (key === 'End') return TABS.at(-1);
  if (key === 'ArrowRight') return TABS[(index + 1) % TABS.length];
  if (key === 'ArrowLeft') return TABS[(index - 1 + TABS.length) % TABS.length];
  return current;
}

export function buildWatchlistDraftPayload(input) {
  const payload = { target: 'watchlist' };
  const title = bounded(input?.title, 200);
  const reference = bounded(input?.reference, 120);
  const pageUrl = bounded(input?.pageUrl, 2048);
  if (title) payload.title = title;
  if (reference) payload.reference = reference;
  if (pageUrl) payload.pageUrl = pageUrl;
  const contextPageUrl = bounded(input?.auctionContext?.pageUrl, 2048);
  if (contextPageUrl) {
    payload.auctionContext = { pageUrl: contextPageUrl };
    const canonicalUrl = bounded(input?.auctionContext?.canonicalUrl, 2048);
    if (canonicalUrl) payload.auctionContext.canonicalUrl = canonicalUrl;
    for (const field of ['house', 'saleId', 'lotNumber']) {
      const value = bounded(input?.auctionContext?.[field], 120);
      if (value) payload.auctionContext[field] = value;
    }
  }
  return payload;
}

export function clearAuctionContextFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const { auctionContext, ...rest } = payload;
  return rest;
}

export function replaceAuctionContextInPayload(payload, auctionContext) {
  const clean = clearAuctionContextFromPayload(payload);
  return clean && auctionContext ? { ...clean, auctionContext } : clean;
}

// Which coin a payload is about: a storage outcome nobody can tell (unknown) keeps its own payload and request id, so the same save is retried rather
// than written twice - but only for that coin. A different reference or page is a different save and starts its own request.
const draftIdentity = (payload) => `${payload?.reference ?? ''}\n${payload?.pageUrl ?? ''}`;

export function createDraftSaver({ newRequestId: makeRequestId, sendCommand: send, openDraft }) {
  let pending = null;
  let retry = null;
  return (payload) => {
    if (pending) return pending;
    const identity = draftIdentity(payload);
    if (retry?.identity !== identity) retry = null;
    if (!retry) retry = { identity, requestId: makeRequestId(), payload, draftId: null };
    pending = (async () => {
      if (!retry.draftId) {
        const reply = await send({ type: 'draft.save', requestId: retry.requestId, kind: 'current-lot', payload: retry.payload });
        if (!reply?.ok) {
          // No reply at all is no outcome to read: the save is not known to have been refused, so its request is kept for the retry.
          const outcome = reply ? reply.outcome ?? reply.error?.outcome : 'unknown';
          if (outcome !== 'unknown') retry = null;
          return reply ?? { ok: false };
        }
        retry.draftId = reply.value.id;
      }
      const opened = await openDraft(retry.draftId);
      if (opened?.ok === false) return opened;
      retry = null;
      return { ok: true };
    })().catch((error) => ({ ok: false, message: error?.message || 'Could not save these details.' }))
      .finally(() => { pending = null; });
    return pending;
  };
}

export function canSaveWatchlist(hasRuntime, payload) {
  return Boolean(hasRuntime && (payload?.title || payload?.reference));
}

export function extensionRuntimeAvailable(api) {
  return typeof api?.runtime?.sendMessage === 'function';
}

export function watchlistPayloadFromCapture(draft) {
  const title = ['ruler', 'denomination', 'mint']
    .map((field) => bounded(draft?.[field]?.value, 120))
    .filter(Boolean)
    .join(' ');
  return buildWatchlistDraftPayload({
    title: title || draft?.pageTitle,
    reference: draft?.reference?.value,
    pageUrl: draft?.pageUrl,
    auctionContext: Object.hasOwn(draft ?? {}, 'auctionContext') ? draft.auctionContext : (draft?.pageUrl ? { pageUrl: draft.pageUrl } : undefined),
  });
}

export function buildWatchlistSummary(snapshot, now = new Date().toISOString()) {
  const events = [...(snapshot?.auctionEvents ?? [])]
    .filter((event) => event.startsAt
      ? event.startsAt >= now
      : event.localDate >= localDateAtInstant(event.timeZone, now))
    .sort((left, right) => (left.startsAt ?? left.localDate).localeCompare(right.startsAt ?? right.localDate));
  const dueEventIds = new Set((snapshot?.alerts ?? [])
    .filter((alert) => ['due', 'claimed', 'delivered'].includes(alert.status) && alert.eventId)
    .map((alert) => alert.eventId));
  const projected = projectExposure({ lots: snapshot?.lots ?? [] });
  const exposure = {};
  for (const currency of CURRENCIES) exposure[currency] = projected[currency] ?? {
    hammerMinor: 0, knownHammerPlusBpMinor: 0, bindingCount: 0, unknownPremiumCount: 0, byEvent: {},
  };
  return { nextEvent: events[0] ?? null, dueAuctionCount: dueEventIds.size, exposure };
}

function openExtensionPage(path) {
  const api = globalThis.browser ?? globalThis.chrome;
  const url = api?.runtime?.getURL?.(path) ?? path;
  if (api?.tabs?.create) return api.tabs.create({ url });
  return globalThis.open?.(url, '_blank', 'noopener,noreferrer');
}

async function callExtension(receiver, method, ...args) {
  const fn = receiver?.[method];
  if (!fn) throw new Error('This browser action is unavailable.');
  if (globalThis.browser) return fn.call(receiver, ...args);
  return new Promise((resolve, reject) => fn.call(receiver, ...args, (value) => {
    const error = globalThis.chrome?.runtime?.lastError;
    if (error) reject(new Error(error.message)); else resolve(value);
  }));
}

// The toolbar popup and the side panel belong to a browser window, so its active tab is the page being looked at. The lookup window is the extension's
// own window, whose active tab is this page: the tab to read is the last browser window's instead.
export function captureTabQuery(mode) {
  return mode?.windowed ? { active: true, lastFocusedWindow: true, windowType: 'normal' } : { active: true, currentWindow: true };
}

// Only a page the extension may inject into: settings pages, the extension's own pages and local files answer a query like any other tab, and reading
// them is neither allowed nor an auction lot.
export function capturableTab(tabs) {
  const tab = tabs?.[0];
  if (!Number.isInteger(tab?.id)) return null;
  try { return ['http:', 'https:'].includes(new URL(String(tab.url ?? '')).protocol) ? tab : null; }
  catch { return null; }
}

const CAPTURE_UNREADABLE = 'This page can\'t be read. Open the auction lot in a tab, then select Capture again.';
// Said of a capture as it arrives and of the fields as they are edited, so it names neither the page nor the keystroke.
const CAPTURE_NO_REFERENCE = 'These details hold no catalogue reference to look up. Add one below, such as “RIC 306”, or type it in the Reference box.';
const PANEL_ACCESS_HINT = 'The Giga Pinax toolbar button grants access to the page you are on.';
const captureFailureMessage = (mode) => mode?.panel ? `${CAPTURE_UNREADABLE} ${PANEL_ACCESS_HINT}` : CAPTURE_UNREADABLE;

// A page that cannot be read leaves no context behind: a tab title and address kept from a refused injection would name a page nothing was read from,
// and would be saved to the watchlist as the lot's own.
export async function captureCurrentPage(api, call = callExtension, mode = { panel: false, windowed: false }) {
  const refuse = () => new Error(captureFailureMessage(mode));
  let tabs;
  try { tabs = await call(api?.tabs, 'query', captureTabQuery(mode)); }
  catch { throw refuse(); }
  const tab = capturableTab(tabs);
  if (!tab) throw refuse();
  let results;
  try {
    results = await call(api?.scripting, 'executeScript', { target: { tabId: tab.id }, func: collectCurrentLotCandidates });
  } catch { throw refuse(); }
  const capture = results?.[0]?.result;
  if (!capture) throw refuse();
  return capture;
}

const STORAGE_UNAVAILABLE = 'Extension storage is unavailable.';
// Only for a bridge that throws rather than answering: saveCurrency names every failure it returns.
const CURRENCY_NOT_SAVED = 'The currency could not be saved.';
// What blocked site data actually costs: the preferences popup.js keeps in localStorage. The watchlist lives in extension storage, reached through the
// background, so the note must not promise a loss that is not one.
const PREFERENCES_UNAVAILABLE = 'Appearance and lookup preferences can\'t be remembered in this browser profile. Watchlist records are not affected.';

// Nothing durable can be saved for the rest of this page's life: every later answer - a result card, a finished save, an edited capture - asks this
// before putting a save button back, so the note and the disabled buttons never disagree.
let storageUnavailable = false;

// The note popup.js shows for its own unreadable preferences. Written without the page's helpers, since start-up may have failed before they existed.
function showStorageNote(message = '') {
  const note = document.getElementById('storage-note');
  if (!note) return;
  if (message) note.textContent = message;
  note.hidden = false;
}

// Only the background bridge can say a record cannot be kept, and when it does nothing durable can be saved for the rest of this page's life: the two
// buttons that would save something are the ones that go, and the note keeps the wording it already had for that.
function showStorageUnavailable() {
  storageUnavailable = true;
  showStorageNote();
  for (const id of ['companion-save-watchlist', 'companion-capture-watchlist']) {
    const button = document.getElementById(id);
    if (button) button.disabled = true;
  }
}

async function initCompanionPopup() {
  const $ = (id) => document.getElementById(id);
  let bridge;
  let initializeCompanionPreferences;
  let saveCurrency;
  let snapshot = { lots: [], auctionEvents: [], alerts: [] };
  let safeCard = null;
  let captureDraft = null;
  let researchAuctionContext;
  let captureRequestId = 0;
  const mode = documentMode(location.search);
  document.documentElement.classList.toggle('panel-mode', mode.panel);
  document.documentElement.classList.toggle('windowed', mode.windowed);
  mountSourcesMenu($('sources-menu'));
  try {
    bridge = await import('./browser-api.js');
    ({ initializeCompanionPreferences, saveCurrency } = await import('./companion-preferences.js'));
  } catch { /* the calculator remains useful in a standalone page */ }
  if (!extensionRuntimeAvailable(globalThis.browser ?? globalThis.chrome)) bridge = null;

  const announce = (message, error = false) => {
    $('companion-status').textContent = message;
    $('companion-status').classList.toggle('companion-error', error);
    const live = $('announcement');
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = message; });
  };
  const activate = (name, focus = false) => {
    for (const tabName of TABS) {
      const selected = tabName === name;
      $(`companion-tab-${tabName}`).setAttribute('aria-selected', String(selected));
      $(`companion-tab-${tabName}`).tabIndex = selected ? 0 : -1;
      $(`companion-panel-${tabName}`).hidden = !selected;
    }
    if (focus) $(`companion-tab-${name}`).focus();
  };
  for (const name of TABS) {
    $(`companion-tab-${name}`).addEventListener('click', () => activate(name));
    $(`companion-tab-${name}`).addEventListener('keydown', (event) => {
      const next = moveCompanionTab(name, event.key);
      if (next === name) return;
      event.preventDefault(); activate(next, true);
    });
  }

  const calculator = mountBidCalculator($('companion-bid-calculator'), { compact: true });

  const renderSummary = () => {
    const summary = buildWatchlistSummary(snapshot);
    $('companion-next-event').textContent = summary.nextEvent?.name ?? 'No upcoming auction';
    $('companion-due-count').textContent = String(summary.dueAuctionCount);
    for (const currency of CURRENCIES) {
      const item = summary.exposure[currency];
      $('companion-exposure-' + currency).textContent = `${formatMoney({ currency, minor: item.hammerMinor }, navigator.language)}${item.unknownPremiumCount ? ` · ${item.unknownPremiumCount} premium unknown` : ''}`;
    }
  };

  // Every place a save button is put back asks the same question, so a page that cannot save never enables one by a side door.
  const canSave = (payload) => canSaveWatchlist(Boolean(bridge) && !storageUnavailable, payload);
  const clearCard = () => {
    safeCard = null;
    $('companion-save-watchlist').disabled = true;
  };
  addEventListener('giga-pinax-card', (event) => {
    safeCard = buildWatchlistDraftPayload({ ...event.detail, auctionContext: researchAuctionContext });
    $('companion-save-watchlist').disabled = !canSave(safeCard);
  });
  if (globalThis.gigaPinaxWatchlistReference) {
    safeCard = buildWatchlistDraftPayload(globalThis.gigaPinaxWatchlistReference);
    $('companion-save-watchlist').disabled = !canSave(safeCard);
  }
  for (const id of ['quick-reference', 'catalogue', 'ric-volume', 'ric-section', 'reference-number']) {
    $(id)?.addEventListener('input', clearCard);
    $(id)?.addEventListener('change', clearCard);
  }

  const draftSaver = bridge && createDraftSaver({
    newRequestId: bridge.newRequestId,
    sendCommand: bridge.sendCommand,
    openDraft: (id) => openExtensionPage(`workspace.html#lot-draft=${encodeURIComponent(id)}`),
  });
  let draftSavePending = false;
  const saveWatchlistDraft = async (payload) => {
    if (!bridge || storageUnavailable || !payload) return announce(STORAGE_UNAVAILABLE, true);
    if (draftSavePending) return;
    draftSavePending = true;
    $('companion-save-watchlist').disabled = true;
    $('companion-capture-watchlist').disabled = true;
    try {
      const saved = await runVisibleAction(async () => draftSaver(payload), 'Couldn’t save these details to the watchlist.');
      if (!saved.ok) return announce(saved.message, true);
      announce('Watchlist details are ready to review.');
    } finally {
      draftSavePending = false;
      $('companion-save-watchlist').disabled = !canSave(safeCard);
      const currentCapturePayload = watchlistPayloadFromCapture(reviewedCapture());
      $('companion-capture-watchlist').disabled = !canSave(currentCapturePayload);
    }
  };
  $('companion-save-watchlist').addEventListener('click', () => void saveWatchlistDraft(safeCard));

  const reviewedCapture = () => {
    if (!captureDraft) return null;
    const draft = { ...captureDraft };
    for (const field of ['ruler', 'denomination', 'mint', 'reference']) {
      const value = $(`companion-capture-${field}`).value.trim();
      if (value) draft[field] = { value, provenance: 'manual' }; else delete draft[field];
    }
    return draft;
  };
  const captureFieldIds = ['ruler', 'denomination', 'mint', 'reference'].map((field) => `companion-capture-${field}`);
  // The reason Research coin is disabled belongs where the fields are being edited, and beside the Reference box the lookup would have answered in.
  // #form-error is popup.js's line as much as this one's, so only the line this page put there is ever taken back.
  let shownFormError = '';
  const showCaptureError = (message) => {
    // Written again, the alert beside the fields is read out again: the same reason, still true, is left as it stands.
    if ($('companion-capture-error').textContent === message) return;
    $('companion-capture-error').textContent = message;
    $('companion-capture-error').hidden = !message;
    if (message) {
      $('form-error').textContent = message;
      $('form-error').hidden = false;
      shownFormError = message;
    } else if (shownFormError && $('form-error').textContent === shownFormError) {
      $('form-error').textContent = '';
      $('form-error').hidden = true;
      shownFormError = '';
    }
  };
  const applyCaptureState = (pending, hasDraft = Boolean(captureDraft)) => {
    const state = captureControlsState(pending, hasDraft, Boolean(buildResearchQuery(reviewedCapture())));
    $('companion-capture-editor').hidden = !state.editorVisible;
    for (const id of captureFieldIds) $(id).disabled = state.fieldsDisabled;
    $('companion-use-capture').disabled = state.researchDisabled;
    $('companion-capture-watchlist').disabled = state.actionsDisabled || !bridge || storageUnavailable;
  };
  for (const id of captureFieldIds) $(id).addEventListener('input', () => {
    if (!captureDraft) captureDraft = buildResearchDraft({ pageTitle: '', pageUrl: '', candidates: {} });
    const edited = captureFieldIds.some((fieldId) => $(fieldId).value.trim());
    // Read again from the fields as they now stand: the reason Research coin is off goes when they can be looked up, and not at the first keystroke.
    showCaptureError(edited && !buildResearchQuery(reviewedCapture()) ? CAPTURE_NO_REFERENCE : '');
    applyCaptureState(false, edited);
  });
  $('companion-capture-current').addEventListener('click', async () => {
    const requestId = ++captureRequestId;
    const captureButton = $('companion-capture-current');
    captureButton.disabled = true;
    captureButton.textContent = 'Capturing…';
    captureDraft = null;
    showCaptureError('');
    applyCaptureState(true, false);
    try {
      const api = globalThis.browser ?? globalThis.chrome;
      const capture = await captureCurrentPage(api, undefined, mode);
      if (requestId !== captureRequestId) return;
      captureDraft = buildResearchDraft(capture);
      researchAuctionContext = captureDraft.auctionContext;
      safeCard = replaceAuctionContextInPayload(safeCard, researchAuctionContext);
      if (globalThis.gigaPinaxWatchlistReference) {
        globalThis.gigaPinaxWatchlistReference = replaceAuctionContextInPayload(globalThis.gigaPinaxWatchlistReference, researchAuctionContext);
      }
      for (const field of ['ruler', 'denomination', 'mint', 'reference']) $(`companion-capture-${field}`).value = captureDraft[field]?.value ?? '';
      $('companion-capture-source').textContent = captureDraft.pageUrl ? `From ${captureDraft.pageTitle || captureDraft.pageUrl}` : 'Page extraction unavailable. Enter the fields manually.';
      applyCaptureState(false, true);
      $('companion-capture-ruler').focus();
      // The message is an alert beside the Reference box already: announcing it as well would have it read out twice.
      if (buildResearchQuery(reviewedCapture())) announce('Current-page details are ready to review.');
      else showCaptureError(CAPTURE_NO_REFERENCE);
    } catch (error) {
      if (requestId !== captureRequestId) return;
      captureDraft = null;
      // The page nothing could be read from is now the page being looked at: the last one's context is no longer shown in the editor, so it must not
      // travel with the next coin saved from this page either.
      researchAuctionContext = null;
      safeCard = clearAuctionContextFromPayload(safeCard);
      if (globalThis.gigaPinaxWatchlistReference) {
        globalThis.gigaPinaxWatchlistReference = clearAuctionContextFromPayload(globalThis.gigaPinaxWatchlistReference);
      }
      $('companion-save-watchlist').disabled = !canSave(safeCard);
      for (const id of captureFieldIds) $(id).value = '';
      $('companion-capture-source').textContent = error.message;
      applyCaptureState(false, false);
      announce(error.message, true);
    } finally {
      if (requestId === captureRequestId) {
        captureButton.disabled = false;
        captureButton.textContent = 'Capture current page';
      }
    }
  });
  $('companion-use-capture').addEventListener('click', () => {
    const draft = reviewedCapture();
    if (!draft) return;
    researchAuctionContext = draft.auctionContext;
    $('quick-reference').value = buildResearchQuery(draft);
    $('quick-reference').dispatchEvent(new Event('input', { bubbles: true }));
    $('reference-form').requestSubmit();
  });
  $('companion-capture-watchlist').addEventListener('click', () => {
    const draft = reviewedCapture();
    if (!draft) return;
    void saveWatchlistDraft(watchlistPayloadFromCapture(draft));
  });
  $('companion-clear-auction-context').addEventListener('click', () => {
    if (!captureDraft) return;
    captureDraft = { ...captureDraft, auctionContext: null };
    researchAuctionContext = null;
    safeCard = clearAuctionContextFromPayload(safeCard);
    if (globalThis.gigaPinaxWatchlistReference) {
      globalThis.gigaPinaxWatchlistReference = clearAuctionContextFromPayload(globalThis.gigaPinaxWatchlistReference);
    }
    $('companion-save-watchlist').disabled = !canSave(safeCard);
    $('companion-capture-source').textContent = 'Auction context cleared. Captured fields remain available for research.';
    announce('Auction context cleared.');
  });
  const navigate = async (action, fallback) => {
    const result = await runVisibleAction(action, fallback);
    if (!result.ok) announce(result.message, true);
  };
  for (const id of ['companion-open-workspace', 'companion-open-watchlist']) $(id).addEventListener('click', () => void navigate(() => openWorkspace('watchlist'), 'Couldn’t open the watchlist.'));
  $('open-settings').addEventListener('click', () => void navigate(() => openSettings(), 'Couldn’t open Settings.'));
  $('open-panel').addEventListener('click', () => void navigate(() => openResearchPanel(), 'Couldn’t open the research panel.'));

  if (!bridge || !initializeCompanionPreferences) {
    $('companion-runtime-note').hidden = false;
    document.querySelectorAll('[data-companion-runtime]').forEach((element) => { element.disabled = true; });
  } else {
    // Blocked site data makes reading localStorage itself throw, and a background that answers nothing leaves no reply to read: either way the page
    // still calculates and looks up references, so it says what it cannot do instead of stopping here.
    let stored = null;
    let preferencesBlocked = false;
    try { stored = localStorage; } catch { preferencesBlocked = true; }
    // A background that answers nothing at all leaves a reply the migration would read an outcome from and throw over, naming no reason a collector
    // could act on: it is answered for here, where it arrives, so every other failure still speaks for itself.
    const answering = { ...bridge, getSnapshot: async () => (await bridge.getSnapshot()) ?? { ok: false, message: '' } };
    const reply = await initializeCompanionPreferences(answering, stored).catch((error) => ({ ok: false, message: error?.message }));
    if (reply?.ok) {
      snapshot = reply.value;
      const currency = snapshot.preferences?.currency;
      if (CURRENCIES.includes(currency)) {
        calculator.setValues({ currency });
        // The stored preference is the one home for the default currency: it replaces the seed the
        // research half showed before this reply arrived. Nothing is looked up at start-up, so the
        // select is set without the change its own handler answers.
        $('currency').value = currency;
      }
      // Price research never waits on storage, so the write is sent and answered for on its own.
      $('currency').addEventListener('change', () => {
        const chosen = $('currency').value;
        if (!CURRENCIES.includes(chosen)) return;
        void saveCurrency(bridge, chosen, snapshot.preferences)
          .then((saved) => {
            if (saved?.ok) snapshot = { ...snapshot, preferences: saved.value };
            else announce(saved?.message || CURRENCY_NOT_SAVED, true);
          })
          .catch((error) => announce(error?.message || CURRENCY_NOT_SAVED, true));
      });
      renderSummary();
      // Said only where it is the whole story: a bridge that cannot save has a graver note of its own, below.
      if (preferencesBlocked) showStorageNote(PREFERENCES_UNAVAILABLE);
    } else {
      showStorageUnavailable();
      announce(reply?.message || STORAGE_UNAVAILABLE, true);
    }
    bridge.subscribeToSnapshots((incoming) => { snapshot = incoming; renderSummary(); });
  }
  activate('research');
  renderSummary();
}

if (typeof document !== 'undefined') void initCompanionPopup().catch(() => showStorageUnavailable());
