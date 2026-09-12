import { calculatePremium, formatMoney, parseMoney, parsePremiumPercent } from './core/money.js';
import { projectExposure } from './core/records.js';
import { localDateAtInstant } from './core/reminders.js';
import { buildResearchDraft, buildResearchQuery, collectCurrentLotCandidates } from './current-lot.js';

const TABS = Object.freeze(['research', 'calculator', 'watchlist']);
const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);
const bounded = (value, maximum) => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, maximum)
  : '';

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

async function initCompanionPopup() {
  const $ = (id) => document.getElementById(id);
  let bridge;
  let initializeCompanionPreferences;
  let snapshot = { lots: [], auctionEvents: [], alerts: [] };
  let safeCard = null;
  let captureDraft = null;
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

  const renderCalculator = () => {
    const view = buildCalculatorView({
      hammerText: $('companion-hammer').value,
      premiumPercentText: $('companion-premium-percent').value,
      currency: $('companion-calculator-currency').value,
      locale: navigator.language,
    });
    $('companion-calculator-error').hidden = !view.error;
    $('companion-calculator-error').textContent = view.error?.message ?? '';
    $('companion-premium-output').textContent = view.premium ? formatMoney(view.premium, navigator.language) : '—';
    $('companion-total-output').textContent = view.total ? formatMoney(view.total, navigator.language) : '—';
    $('companion-calculator-note').textContent = view.status === 'unknown-premium'
      ? 'Buyer’s premium is unknown, so no total is shown.' : '';
  };
  $('companion-calculator-form').addEventListener('input', renderCalculator);
  $('companion-calculator-form').addEventListener('submit', (event) => { event.preventDefault(); renderCalculator(); });

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
    const command = { type: 'draft.save', requestId: bridge.newRequestId(), kind: 'current-lot', payload };
    const reply = await bridge.sendCommand(command);
    if (!reply.ok) return announce(reply.message, true);
    announce('Watchlist details are ready to review.');
    await openExtensionPage(`workspace.html#lot-draft=${encodeURIComponent(reply.value.id)}`);
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
  $('companion-capture-current').addEventListener('click', async () => {
    $('companion-capture-editor').hidden = false;
    try {
      const api = globalThis.browser ?? globalThis.chrome;
      const tabs = await callExtension(api?.tabs, 'query', { active: true, currentWindow: true });
      const tab = tabs?.[0];
      if (!tab?.id) throw new Error('The current page could not be read. Enter the fields manually.');
      let capture = { pageTitle: tab.title ?? '', pageUrl: tab.url ?? '', candidates: {} };
      try {
        const results = await callExtension(api?.scripting, 'executeScript', { target: { tabId: tab.id }, func: collectCurrentLotCandidates });
        capture = results?.[0]?.result ?? capture;
      } catch { /* title and URL remain available for an editable fallback */ }
      captureDraft = buildResearchDraft(capture);
      for (const field of ['ruler', 'denomination', 'mint', 'reference']) $(`companion-capture-${field}`).value = captureDraft[field]?.value ?? '';
      $('companion-capture-source').textContent = captureDraft.pageUrl ? `From ${captureDraft.pageTitle || captureDraft.pageUrl}` : 'Page extraction unavailable. Enter the fields manually.';
      $('companion-capture-ruler').focus();
      announce('Current-page details are ready to review.');
    } catch (error) {
      captureDraft = buildResearchDraft({ pageTitle: '', pageUrl: '', candidates: {} });
      $('companion-capture-source').textContent = error.message;
      announce(error.message, true);
    }
  });
  $('companion-use-capture').addEventListener('click', () => {
    const draft = reviewedCapture();
    if (!draft) return;
    $('quick-reference').value = buildResearchQuery(draft);
    $('quick-reference').dispatchEvent(new Event('input', { bubbles: true }));
    $('quick-reference').focus();
    announce('Reviewed fields copied to Reference. Select Look up when ready.');
  });
  $('companion-capture-watchlist').addEventListener('click', () => {
    const draft = reviewedCapture();
    if (!draft) return;
    void saveWatchlistDraft(watchlistPayloadFromCapture(draft));
  });
  for (const id of ['companion-open-workspace', 'companion-open-watchlist']) {
    $(id).addEventListener('click', () => openExtensionPage('workspace.html#watchlist'));
  }

  if (!bridge || !initializeCompanionPreferences) {
    $('companion-runtime-note').hidden = false;
    document.querySelectorAll('[data-companion-runtime]').forEach((element) => { element.disabled = true; });
  } else {
    const reply = await initializeCompanionPreferences(bridge, localStorage);
    if (reply.ok) {
      snapshot = reply.value;
      const currency = snapshot.preferences?.currency;
      if (CURRENCIES.includes(currency)) $('companion-calculator-currency').value = currency;
      renderSummary(); renderCalculator();
    } else announce(reply.message, true);
    bridge.subscribeToSnapshots((incoming) => { snapshot = incoming; renderSummary(); });
  }
  activate('research');
  renderCalculator(); renderSummary();
}

if (typeof document !== 'undefined') void initCompanionPopup();
