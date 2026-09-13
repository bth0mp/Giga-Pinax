import { calculatePremium, formatMoney, parseMoney, parsePremiumPercent } from './core/money.js';
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
  return { panel, windowed, acceptsLookupMessages: windowed };
}

export function shouldRevealRefine(outcome, field = '') {
  return outcome?.status === 'candidates' || outcome?.status === 'too-many'
    || Boolean(field && ['catalogue', 'reference-number', 'ric-volume', 'ric-section'].includes(field));
}

export function captureControlsState(pending, hasDraft) {
  return { editorVisible: !pending, fieldsDisabled: pending, actionsDisabled: pending || !hasDraft };
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

export function buildCalculatorView({ hammerText, premiumPercentText, currency, locale = 'en-US' }) {
  const hammer = parseMoney(hammerText, currency, locale);
  if (!hammer.ok) return { status: 'invalid', hammer: null, premium: null, total: null, error: hammer.error };
  if (typeof premiumPercentText !== 'string' || !premiumPercentText.trim()) {
    return { status: 'unknown-premium', hammer: hammer.value, premium: null, total: null, error: null };
  }
  const basisPoints = parsePremiumPercent(premiumPercentText, locale);
  if (!basisPoints.ok) return { status: 'invalid', hammer: hammer.value, premium: null, total: null, error: basisPoints.error };
  const calculated = calculatePremium(hammer.value, basisPoints.value);
  if (!calculated.ok) return { status: 'invalid', hammer: hammer.value, premium: null, total: null, error: calculated.error };
  return {
    status: 'complete', hammer: hammer.value, buyerPremiumBps: basisPoints.value,
    premium: calculated.value.premium, total: calculated.value.hammerPlusPremium, error: null,
  };
}

export function buildWatchlistDraftPayload(input) {
  const payload = { target: 'watchlist' };
  const title = bounded(input?.title, 200);
  const reference = bounded(input?.reference, 120);
  const pageUrl = bounded(input?.pageUrl, 2048);
  if (title) payload.title = title;
  if (reference) payload.reference = reference;
  if (pageUrl) payload.pageUrl = pageUrl;
  return payload;
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

export async function captureCurrentPage(api, call = callExtension) {
  const tabs = await call(api?.tabs, 'query', { active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab?.id) throw new Error('The current page could not be read. Enter the fields manually.');
  const fallback = { pageTitle: tab.title ?? '', pageUrl: tab.url ?? '', candidates: {} };
  try {
    const results = await call(api?.scripting, 'executeScript', {
      target: { tabId: tab.id }, func: collectCurrentLotCandidates,
    });
    return results?.[0]?.result ?? fallback;
  } catch { return fallback; }
}

async function initCompanionPopup() {
  const $ = (id) => document.getElementById(id);
  let bridge;
  let initializeCompanionPreferences;
  let snapshot = { lots: [], auctionEvents: [], alerts: [] };
  let safeCard = null;
  let captureDraft = null;
  let captureRequestId = 0;
  const mode = documentMode(location.search);
  document.documentElement.classList.toggle('panel-mode', mode.panel);
  document.documentElement.classList.toggle('windowed', mode.windowed);
  mountSourcesMenu($('sources-menu'));
  try {
    bridge = await import('./browser-api.js');
    ({ initializeCompanionPreferences } = await import('./companion-preferences.js'));
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

  const clearCard = () => {
    safeCard = null;
    $('companion-save-watchlist').disabled = true;
  };
  addEventListener('giga-pinax-card', (event) => {
    safeCard = buildWatchlistDraftPayload(event.detail);
    $('companion-save-watchlist').disabled = !canSaveWatchlist(Boolean(bridge), safeCard);
  });
  if (globalThis.gigaPinaxWatchlistReference) {
    safeCard = buildWatchlistDraftPayload(globalThis.gigaPinaxWatchlistReference);
    $('companion-save-watchlist').disabled = !canSaveWatchlist(Boolean(bridge), safeCard);
  }
  for (const id of ['quick-reference', 'catalogue', 'ric-volume', 'ric-section', 'reference-number']) {
    $(id)?.addEventListener('input', clearCard);
    $(id)?.addEventListener('change', clearCard);
  }

  const saveWatchlistDraft = async (payload) => {
    if (!bridge || !payload) return announce('Extension storage is unavailable.', true);
    const saved = await runVisibleAction(async () => {
      const command = { type: 'draft.save', requestId: bridge.newRequestId(), kind: 'current-lot', payload };
      const reply = await bridge.sendCommand(command);
      if (!reply.ok) return reply;
      const opened = await openExtensionPage(`workspace.html#lot-draft=${encodeURIComponent(reply.value.id)}`);
      return opened?.ok === false ? opened : { ok: true };
    }, 'Couldn’t save these details to the watchlist.');
    if (!saved.ok) return announce(saved.message, true);
    announce('Watchlist details are ready to review.');
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
  const applyCaptureState = (pending, hasDraft = Boolean(captureDraft)) => {
    const state = captureControlsState(pending, hasDraft);
    $('companion-capture-editor').hidden = !state.editorVisible;
    for (const id of captureFieldIds) $(id).disabled = state.fieldsDisabled;
    $('companion-use-capture').disabled = state.actionsDisabled;
    $('companion-capture-watchlist').disabled = state.actionsDisabled || !bridge;
  };
  for (const id of captureFieldIds) $(id).addEventListener('input', () => {
    if (!captureDraft) captureDraft = buildResearchDraft({ pageTitle: '', pageUrl: '', candidates: {} });
    applyCaptureState(false, captureFieldIds.some((fieldId) => $(fieldId).value.trim()));
  });
  $('companion-capture-current').addEventListener('click', async () => {
    const requestId = ++captureRequestId;
    const captureButton = $('companion-capture-current');
    captureButton.disabled = true;
    captureButton.textContent = 'Capturing…';
    captureDraft = null;
    applyCaptureState(true, false);
    try {
      const api = globalThis.browser ?? globalThis.chrome;
      const capture = await captureCurrentPage(api);
      if (requestId !== captureRequestId) return;
      captureDraft = buildResearchDraft(capture);
      for (const field of ['ruler', 'denomination', 'mint', 'reference']) $(`companion-capture-${field}`).value = captureDraft[field]?.value ?? '';
      $('companion-capture-source').textContent = captureDraft.pageUrl ? `From ${captureDraft.pageTitle || captureDraft.pageUrl}` : 'Page extraction unavailable. Enter the fields manually.';
      applyCaptureState(false, true);
      $('companion-capture-ruler').focus();
      announce('Current-page details are ready to review.');
    } catch (error) {
      if (requestId !== captureRequestId) return;
      captureDraft = null;
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
    $('quick-reference').value = buildResearchQuery(draft);
    $('quick-reference').dispatchEvent(new Event('input', { bubbles: true }));
    $('reference-form').requestSubmit();
  });
  $('companion-capture-watchlist').addEventListener('click', () => {
    const draft = reviewedCapture();
    if (!draft) return;
    void saveWatchlistDraft(watchlistPayloadFromCapture(draft));
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
    const reply = await initializeCompanionPreferences(bridge, localStorage);
    if (reply.ok) {
      snapshot = reply.value;
      const currency = snapshot.preferences?.currency;
      if (CURRENCIES.includes(currency)) calculator.setValues({ currency });
      renderSummary();
    } else announce(reply.message, true);
    bridge.subscribeToSnapshots((incoming) => { snapshot = incoming; renderSummary(); });
  }
  activate('research');
  renderSummary();
}

if (typeof document !== 'undefined') void initCompanionPopup();
