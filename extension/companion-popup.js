import { CURRENCIES, formatMoney } from './core/money.js';
// The one definition of the message, shared with the function that returns it. Static because the
// note is owed even where the import below could not run; only browser-api.js needs that tolerance.
import { CURRENCY_NOT_SAVED } from './companion-preferences.js';
import { projectExposure } from './core/records.js';
import { lotsNeedingOutcome } from './core/projections.js';
import { recordDiagnostic } from './core/diagnostics.js';
import { localDateAtInstant } from './core/reminders.js';
import { buildResearchDraft, buildResearchQuery, collectCurrentLotCandidates, draftPageValues } from './current-lot.js';
import { mountBidCalculator } from './bid-tools.js';
import { mountSourcesMenu } from './source-menu.js';
import { openResearchPanel, openSettings, openWorkspace } from './navigation.js';
import { parseReference } from './lookup.js';
import { validateDraftPayload } from './core/drafts.js';
import { buildWorkspaceLotDraft, lotDraftToEditor, lotFormValues, offeredEventFromDraft } from './workspace-forms.js';
import { eventWhen } from './workspace-views.js';

const TABS = Object.freeze(['research', 'calculator', 'watchlist']);
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

// One spelling of a reference wherever the popup writes one (the card, a Recent chip, the coin a save makes): the short canonical form a collector
// types. OCRE titles a second edition in words ("RIC I (second edition) Nero 306", "RIC II, Part 3 (second edition) Hadrian 12"); the short form is
// "RIC I² Nero 306" and "RIC II.3² Hadrian 12", which parseReference reads back as the same reference. Every other label is already short.
const SECOND_EDITION = /^RIC (X|IX|VIII|VII|VI|V|IV|III|II|I)(?:, Part (\d))? \((?:second|2nd) edition\) (\S.*)$/;
export function displayReference(label) {
  const text = String(label ?? '');
  const match = SECOND_EDITION.exec(text);
  return match ? `RIC ${match[1]}${match[2] ? `.${match[2]}` : ''}² ${match[3]}` : text;
}
// The edition a short form leaves out, said once in the card's source line: "RIC I, second edition".
export function editionName(label) {
  const match = SECOND_EDITION.exec(String(label ?? ''));
  return match ? `RIC ${match[1]}${match[2] ? `, part ${match[2]}` : ''}, second edition` : '';
}
// A coin's name is its card's summary line without the metal ("Nero · As · Rome · AD 62–68"), never the reference again; a card with none of
// those (a reference kept only for its prices) is named by its reference.
export function cardName(card) {
  const summary = [card?.authority, card?.denomination, card?.mint, card?.dates].filter(Boolean).join(' · ');
  return summary || displayReference(card?.label);
}

// A list of types stands outside Refine (popup.html), so it opens nothing: only a reference that needs a ruler typed, or a guided field in error, does.
export function shouldRevealRefine(outcome, field = '') {
  return outcome?.status === 'too-many'
    || Boolean(field && ['catalogue', 'reference-number', 'ric-volume', 'ric-section'].includes(field));
}

// Research coin needs a query as well as a draft: a capture that gave no readable reference has fields to edit and can still be saved to the watchlist,
// but nothing to look up. A capture that failed read nothing, so it opens no editor to fill: its reason stands beside the button instead.
export function captureControlsState(pending, hasDraft, researchable = hasDraft, failed = false) {
  return { editorVisible: !pending && !failed, fieldsDisabled: pending, actionsDisabled: pending || !hasDraft,
    researchDisabled: pending || !hasDraft || !researchable };
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

// The stored preference wins over the display cache the research half showed, but it is applied
// through that half's own change handler rather than by assigning the value: a start-up or
// handed-over lookup has already priced under the cached currency, and those prices, the acsearch
// link and the cache itself all have to follow. A value the select already shows is not a change.
export function applyPreferredCurrency(select, preferred) {
  if (!select || !CURRENCIES.includes(preferred) || select.value === preferred) return false;
  select.value = preferred;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

const DRAFT_BUDGET = 9500;

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
  // What the captured page states about its lot, for the workspace to offer: an estimate, when it closes, a photo link, its provenance. A page
  // can write every address as long as a draft allows, so these give way, provenance first, before the draft outgrows the store's bound
  // (LIMITS.draftPayloadBytes in core/records.js) and is refused with the coin's own fields in it.
  const full = { ...payload, ...draftPageValues(input) };
  for (const field of ['provenance', 'photoUrl', 'estimate', 'startsAt', 'closesAt']) {
    if (new TextEncoder().encode(JSON.stringify(full)).length <= DRAFT_BUDGET) break;
    delete full[field];
  }
  return full;
}

// The values a captured page gave about its sale belong to that page's lot, so they come off with its auction context.
const PAGE_VALUES = Object.freeze(['estimate', 'closesAt', 'startsAt', 'photoUrl', 'provenance']);
const withoutPageValues = (draft) => Object.fromEntries(Object.entries(draft).filter(([key]) => !PAGE_VALUES.includes(key)));
// The page values a capture held that its draft payload had no room for, in the words the collector reads them in.
const PAGE_VALUE_NAMES = Object.freeze({ estimate: 'estimate', closesAt: 'closing time', startsAt: 'start time', photoUrl: 'photo link', provenance: 'provenance' });
export function pageValuesLeftOff(draft, payload) {
  return PAGE_VALUES.filter((field) => draft?.[field] && !Object.hasOwn(payload ?? {}, field)).map((field) => PAGE_VALUE_NAMES[field]);
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

// A reference as the watchlist compares it: the fields parseReference reads from it, so "RIC I² Nero 306" and "RIC I (second edition) Nero 306" are one
// coin; text that reads as no reference is compared as written, spacing and case aside.
const squash = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export function referenceKey(reference) {
  const parsed = String(reference ?? '').trim() ? parseReference(String(reference)) : null;
  if (!parsed) return squash(reference);
  return [parsed.catalogue, parsed.volume, parsed.section, parsed.number].map(squash).join('|');
}

// The saved coins a card's reference names, the open ones first and the newest of each first.
export function savedLotsFor(snapshot, reference) {
  const key = referenceKey(reference);
  if (!key) return [];
  const open = (lot) => (lot.outcome?.status ?? 'open') === 'open';
  return (snapshot?.lots ?? []).filter((lot) => lot?.reference && referenceKey(lot.reference) === key)
    .sort((left, right) => Number(open(right)) - Number(open(left)) || String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')));
}

const OUTCOME_WORDS = Object.freeze({ won: 'Won, in your collection', lost: 'Lost', withdrawn: 'Withdrawn', unsold: 'Unsold' });
// What the card says of a coin already saved under its reference: where it stands, the bid in force or planned, and its auction and when.
export function savedLineText(lots, snapshot, { now = new Date().toISOString(), locale = 'en-US' } = {}) {
  const lot = lots?.[0];
  if (!lot) return '';
  const status = lot.outcome?.status ?? 'open';
  const parts = [status === 'open' ? 'On your watchlist' : `Saved · ${OUTCOME_WORDS[status] ?? status}`];
  const money = (amount) => { try { return formatMoney(amount, locale); } catch { return ''; } };
  if (status === 'open' && lot.activeBid?.amount) parts.push(`Bid active ${money(lot.activeBid.amount)}`);
  else if (status === 'open' && lot.plannedBid?.amount) parts.push(`Bid planned ${money(lot.plannedBid.amount)}`);
  const event = lot.auctionEventId ? (snapshot?.auctionEvents ?? []).find(({ id }) => id === lot.auctionEventId) : null;
  if (event?.name) parts.push(event.name);
  if (event && status === 'open') { const { relative } = eventWhen(event, { now, locale }); if (relative) parts.push(relative); }
  if (lots.length > 1) parts.push(`${lots.length} coins saved`);
  return parts.filter(Boolean).join(' · ');
}

// A bare reference (a card, or an acsearch lot's Watch) is saved in one step: validated as the workspace validates the draft it would have opened,
// read into the coin exactly as the workspace's details form reads that draft, and saved by the command its Save details sends. What a captured
// page stated (an estimate, a closing time, a photo, provenance, its auction) still goes to the workspace for review, which is where it earns one.
export const DIRECT_SAVE_FIELDS = Object.freeze(['target', 'title', 'reference', 'pageUrl', 'closesAt']);
export function savesDirectly(payload) {
  return Boolean(payload && typeof payload === 'object' && Object.keys(payload).every((key) => DIRECT_SAVE_FIELDS.includes(key)));
}
export function directLotFromPayload(payload) {
  const { closesAt, ...kept } = payload ?? {};
  const checked = validateDraftPayload('current-lot', kept);
  if (!checked.ok) return { ok: false, message: checked.error.message };
  const values = lotDraftToEditor(checked.value);
  // The details form asks for a title; a card always gives one, and a reference alone is named by itself.
  const title = values.title || values.reference;
  if (!title) return { ok: false, message: 'There is nothing to save: this card has no reference.' };
  return { ok: true, lot: buildWorkspaceLotDraft(null, { title, reference: values.reference, sourceUrl: values.sourceUrl, notes: '' }, undefined) };
}
// The sale day of a Watched lot, offered as the date-only auction the workspace would have offered, to attach once the collector says so.
export function offeredSaleDay(closesAt, pageUrl, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(closesAt ?? '')) ? offeredEventFromDraft({ closesAt, pageUrl }, timeZone) : null;
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
    ...Object.fromEntries(PAGE_VALUES.map((field) => [field, draft?.[field]])),
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
// How long a message stands in a hint line before the line's own words come back.
const SAID_FOR_MS = 8000;
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

  // Said to a screen reader alone: for a message already on screen where it belongs.
  const speak = (message) => {
    const live = $('announcement');
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = message; });
  };
  // A message is said where it happened: in the hint line under the control that caused it (the Save hint, the capture line, the Upcoming note, the
  // storage note), for a while, and then that line's own words come back. Nothing is drawn over the panel, so the Reference box is never covered.
  // The live region speaks it too. With no line (a Watch whose failure the research half shows beside its list), it is only spoken.
  const swapped = new Map();
  const announce = (message, error = false, anchor = 'storage-note') => {
    speak(message);
    const line = anchor ? $(anchor) : null;
    if (!line) return;
    const own = swapped.get(anchor) ?? { text: line.textContent, hidden: line.hidden, timer: 0 };
    clearTimeout(own.timer);
    line.textContent = message;
    line.hidden = false;
    line.classList.toggle('said-error', error);
    own.timer = setTimeout(() => {
      swapped.delete(anchor);
      if (line.textContent !== message) return;
      line.textContent = own.text;
      line.hidden = own.hidden;
      line.classList.toggle('said-error', false);
    }, SAID_FOR_MS);
    swapped.set(anchor, own);
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
  // The Reference box, from anywhere in the popup: the skip link that leads the header, Ctrl+K (⌘K on a Mac) on any tab, or "/" when the keyboard
  // is not in a text field. The box's text is selected, so typing replaces it.
  const toReference = () => {
    activate('research');
    $('quick-reference').focus();
    $('quick-reference').select?.();
  };
  $('skip-to-research')?.addEventListener('click', (event) => { event.preventDefault(); toReference(); });
  addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '') || event.target?.isContentEditable === true;
    const chord = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'k';
    const slash = event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!chord && !slash) return;
    event.preventDefault();
    toReference();
  });
  for (const name of TABS) {
    $(`companion-tab-${name}`).addEventListener('click', () => activate(name));
    $(`companion-tab-${name}`).addEventListener('keydown', (event) => {
      const next = moveCompanionTab(name, event.key);
      if (next === name) return;
      event.preventDefault(); activate(next, true);
    });
  }

  const calculator = mountBidCalculator($('companion-bid-calculator'), { compact: true });

  // Current source starts folded; it opens by itself where there is a page to capture - the active tab a web page the extension may read, which the
  // toolbar popup's click grants - so it is one line everywhere else.
  void callExtension((globalThis.browser ?? globalThis.chrome)?.tabs, 'query', captureTabQuery(mode))
    .then((tabs) => { if (capturableTab(tabs)) $('companion-current-lot').open = true; })
    .catch(() => { /* no tab to read: it stays folded */ });

  const renderSummary = () => {
    const summary = buildWatchlistSummary(snapshot);
    $('companion-next-event').textContent = summary.nextEvent?.name ?? 'No upcoming auction';
    $('companion-due-count').textContent = String(summary.dueAuctionCount);
    // Lots whose auction has ended with no outcome recorded, and the way to the workspace queue that lists them.
    const ended = lotsNeedingOutcome(snapshot).length;
    $('companion-needs-outcome').hidden = ended === 0;
    $('companion-open-needs-outcome').textContent = `${ended} ${ended === 1 ? 'lot' : 'lots'} ended without an outcome`;
    for (const currency of CURRENCIES) {
      const item = summary.exposure[currency];
      $('companion-exposure-' + currency).textContent = `${formatMoney({ currency, minor: item.hammerMinor }, navigator.language)}${item.unknownPremiumCount ? ` · ${item.unknownPremiumCount} premium unknown` : ''}`;
    }
  };

  // Every place a save button is put back asks the same question, so a page that cannot save never enables one by a side door.
  const canSave = (payload) => canSaveWatchlist(Boolean(bridge) && !storageUnavailable, payload);
  // A line of words and buttons, "Saved to your watchlist · Open · Undo": what happened, and what can be done about it, where it happened.
  const fillLine = (line, parts) => {
    const shown = parts.filter(Boolean);
    line.replaceChildren();
    shown.forEach((part, index) => {
      if (index) line.append(' · ');
      if (typeof part === 'string') { line.append(part); return; }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = part.label;
      if (part.name) button.setAttribute('aria-label', part.name);
      button.addEventListener('click', part.action);
      line.append(button);
    });
    line.hidden = shown.length === 0;
  };
  const openLot = (lotId, anchor) => void navigate(() => openWorkspace('watchlist', undefined, '', lotId), 'Couldn’t open the workspace.', anchor);
  const openAction = (lotId, anchor) => ({ label: 'Open', name: 'Open this coin in the workspace', action: () => openLot(lotId, anchor) });
  // The coin a save from this page made a moment ago, which Undo takes back for ten seconds: where it was saved (the card or the Upcoming list), the
  // coin as stored and the auction attached to it, if any.
  let justSaved = null;
  const UNDO_FOR_MS = 10000;
  // The card says whether its reference is already saved, and then offers that coin rather than a second one: Save gives way to the line.
  const renderCardSaved = () => {
    const line = $('companion-saved-line');
    const save = $('companion-save-watchlist');
    if (justSaved?.where === 'card') { save.hidden = true; return; }
    const lots = safeCard?.reference ? savedLotsFor(snapshot, safeCard.reference) : [];
    if (!lots.length) { fillLine(line, []); save.hidden = false; return; }
    fillLine(line, [savedLineText(lots, snapshot, { locale: navigator.language }), openAction(lots[0].id, 'companion-save-hint')]);
    save.hidden = true;
  };
  const forgetJustSaved = (where) => {
    if (justSaved?.where !== where) return;
    clearTimeout(justSaved.timer);
    justSaved = null;
  };
  const clearCard = () => {
    safeCard = null;
    $('companion-save-watchlist').disabled = true;
    forgetJustSaved('card');
    renderCardSaved();
  };
  addEventListener('giga-pinax-card', (event) => {
    safeCard = buildWatchlistDraftPayload({ ...event.detail, auctionContext: researchAuctionContext });
    $('companion-save-watchlist').disabled = !canSave(safeCard);
    forgetJustSaved('card');
    renderCardSaved();
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
  let savePending = false;
  const PENDING_MESSAGE = 'Another lot is still being saved to the watchlist. Try again in a moment.';
  const holdSaveButtons = () => {
    $('companion-save-watchlist').disabled = true;
    $('companion-capture-watchlist').disabled = true;
  };
  const releaseSaveButtons = () => {
    $('companion-save-watchlist').disabled = !canSave(safeCard);
    $('companion-capture-watchlist').disabled = !canSave(watchlistPayloadFromCapture(reviewedCapture()));
  };
  // anchor: the hint line under the control the save came from.
  const saveWatchlistDraft = async (payload, leftOff = [], anchor = 'companion-save-hint') => {
    if (!bridge || storageUnavailable || !payload) { announce(STORAGE_UNAVAILABLE, true, anchor); return { ok: false, message: STORAGE_UNAVAILABLE }; }
    if (savePending) { announce(PENDING_MESSAGE, true, anchor); return { ok: false, message: PENDING_MESSAGE }; }
    savePending = true;
    holdSaveButtons();
    try {
      const saved = await runVisibleAction(async () => draftSaver(payload), 'Couldn’t save these details to the watchlist.');
      if (!saved.ok) { announce(saved.message, true, anchor); return saved; }
      // Said whenever the size bound took something off the page's values, so nothing goes missing without a word.
      announce(leftOff.length ? `Watchlist details are ready to review. Left off, the draft being at its size bound: ${leftOff.join(', ')}.` : 'Watchlist details are ready to review.',
        false, anchor);
      return saved;
    } finally {
      savePending = false;
      releaseSaveButtons();
    }
  };
  // What the store answered is what this page shows until its next snapshot arrives with it, so the lines never wait on the subscription.
  const keepInView = (lot, event = null) => {
    snapshot = { ...snapshot, lots: [...(snapshot.lots ?? []).filter(({ id }) => id !== lot?.id), lot].filter(Boolean),
      ...(event ? { auctionEvents: [...(snapshot.auctionEvents ?? []).filter(({ id }) => id !== event.id), event] } : {}) };
  };
  // One request per coin until the store has answered it: a save whose reply was lost is sent again under the same request, and the store answers it
  // from its ledger rather than saving the coin twice.
  let directRequest = null;
  const NO_ANSWER = 'The watchlist did not answer. Try again.';
  const sendDirect = async (command) => {
    try { return (await bridge.sendCommand(command)) ?? { ok: false, outcome: 'unknown', message: NO_ANSWER }; }
    catch (error) { return { ok: false, outcome: 'unknown', message: error?.message || NO_ANSWER }; }
  };
  const saveDirect = async (payload, anchor) => {
    const refuse = (message) => { if (anchor) announce(message, true, anchor); return { ok: false, message }; };
    if (!bridge || storageUnavailable || !payload) return refuse(STORAGE_UNAVAILABLE);
    if (savePending) return refuse(PENDING_MESSAGE);
    const built = directLotFromPayload(payload);
    if (!built.ok) return refuse(built.message);
    const identity = draftIdentity(payload);
    if (directRequest?.identity !== identity) directRequest = { identity, requestId: bridge.newRequestId() };
    savePending = true;
    holdSaveButtons();
    try {
      const reply = await sendDirect({ type: 'lot.save', requestId: directRequest.requestId, expectedRevision: null, lot: built.lot });
      if (!reply.ok) {
        if ((reply.outcome ?? reply.error?.outcome) !== 'unknown') directRequest = null;
        return refuse(reply.message || reply.error?.message || 'Couldn’t save this coin to the watchlist.');
      }
      directRequest = null;
      keepInView(reply.value);
      return { ok: true, lot: reply.value };
    } finally {
      savePending = false;
      releaseSaveButtons();
    }
  };
  // Undo takes the coin back, and the auction a Watch attached to it; a coin changed since in a way the store will not delete (a bid placed on it)
  // is refused by the store, and the line says why.
  const undoSave = async (entry, line, anchor) => {
    if (justSaved !== entry) return;
    clearTimeout(entry.timer);
    const current = (snapshot.lots ?? []).find(({ id }) => id === entry.lot.id) ?? entry.lot;
    const reply = await sendDirect({ type: 'lot.delete', requestId: bridge.newRequestId(), lotId: entry.lot.id, expectedRevision: current.revision });
    if (!reply.ok) { announce(reply.message || 'Couldn’t take this coin off the watchlist.', true, anchor); return; }
    if (entry.event) await sendDirect({ type: 'event.delete', requestId: bridge.newRequestId(), eventId: entry.event.id, expectedRevision: entry.event.revision });
    justSaved = null;
    snapshot = { ...snapshot, lots: (snapshot.lots ?? []).filter(({ id }) => id !== entry.lot.id) };
    fillLine(line, []);
    announce('Removed from your watchlist.', false, anchor);
    renderCardSaved();
  };
  // Saved: the line says so, with Open and Undo; after ten seconds Undo goes, and the line says where the coin stands.
  const confirmSaved = (entry, line, anchor, extra = []) => {
    if (justSaved && justSaved !== entry) clearTimeout(justSaved.timer);
    justSaved = entry;
    const words = entry.event ? 'Saved to your watchlist with its sale day' : 'Saved to your watchlist';
    fillLine(line, [words, openAction(entry.lot.id, anchor), { label: 'Undo', name: 'Undo: take this coin off the watchlist', action: () => void undoSave(entry, line, anchor) }, ...extra]);
    speak(`${words}.`);
    entry.timer = setTimeout(() => {
      if (justSaved !== entry) return;
      justSaved = null;
      if (entry.where === 'card') renderCardSaved();
      else fillLine(line, ['On your watchlist', openAction(entry.lot.id, anchor)]);
    }, UNDO_FOR_MS);
  };
  $('companion-save-watchlist').addEventListener('click', async () => {
    const payload = safeCard;
    // A card carrying a captured page's values goes to the workspace for review, as before.
    if (!savesDirectly(payload)) { void saveWatchlistDraft(payload); return; }
    const saved = await saveDirect(payload, 'companion-save-hint');
    if (!saved.ok || safeCard !== payload) return;
    confirmSaved({ where: 'card', lot: saved.lot, event: null, timer: 0 }, $('companion-saved-line'), 'companion-save-hint');
    $('companion-save-watchlist').hidden = true;
  });
  // Watch on an upcoming acsearch lot (popup.js): saved in one step with the lot's title, the card's reference and the lot's own acsearch page, said
  // under the list with Open and Undo, and its sale day offered as a date-only auction to attach with Add. Nothing opens by itself. No captured page
  // rides along, since the lot is acsearch's. A failure is handed back, to be shown beside the list Watch was pressed in.
  const attachSaleDay = async (entry, offer, line) => {
    if (justSaved !== entry || entry.event) return;
    clearTimeout(entry.timer);
    entry.offerRequest ??= bridge.newRequestId();
    const eventReply = await sendDirect({ type: 'event.save', requestId: entry.offerRequest, expectedRevision: null, event: { ...offer, name: entry.lot.title.slice(0, 300) } });
    if (!eventReply.ok) { announce(eventReply.message || 'Couldn’t add the auction.', true, 'upcoming-note'); confirmSaved(entry, line, 'upcoming-note'); return; }
    const values = lotFormValues(entry.lot);
    const lot = buildWorkspaceLotDraft(entry.lot, { ...values, auctionEventId: eventReply.value.id }, values.sourceUrl);
    const lotReply = await sendDirect({ type: 'lot.save', requestId: bridge.newRequestId(), expectedRevision: entry.lot.revision, lot });
    if (!lotReply.ok) {
      // The auction goes with the attachment that failed, so nothing is left behind that the collector did not see saved.
      await sendDirect({ type: 'event.delete', requestId: bridge.newRequestId(), eventId: eventReply.value.id, expectedRevision: eventReply.value.revision });
      announce(lotReply.message || 'Couldn’t attach the auction to this coin.', true, 'upcoming-note');
      confirmSaved(entry, line, 'upcoming-note');
      return;
    }
    keepInView(lotReply.value, eventReply.value);
    confirmSaved({ ...entry, lot: lotReply.value, event: eventReply.value }, line, 'upcoming-note');
  };
  const saleDayText = (localDate) => {
    // Written as the popup writes a sale's day ("12 Oct 2099").
    try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${localDate}T12:00:00Z`)); }
    catch { return localDate; }
  };
  addEventListener('giga-pinax-watch', async (event) => {
    const payload = buildWatchlistDraftPayload(event.detail);
    const line = $('upcoming-saved');
    // A lot already saved from its acsearch page is offered, not saved twice.
    const existing = payload.pageUrl ? (snapshot.lots ?? []).find((lot) => lot.sourceLinks?.some(({ url }) => url === payload.pageUrl)) : null;
    if (existing) { fillLine(line, ['Already on your watchlist', openAction(existing.id, 'upcoming-note')]); speak('Already on your watchlist.'); return; }
    const saved = await saveDirect(payload, null);
    if (!saved.ok) {
      speak(saved.message);
      dispatchEvent(new CustomEvent('giga-pinax-watch-failed', { detail: { message: saved.message } }));
      return;
    }
    const entry = { where: 'upcoming', lot: saved.lot, event: null, timer: 0 };
    const offer = offeredSaleDay(payload.closesAt, payload.pageUrl);
    const day = offer ? saleDayText(offer.localDate) : '';
    const extra = offer ? [`add its sale day ${day} as an auction?`, { label: 'Add', name: `Add the sale day ${day} as an auction`, action: () => void attachSaleDay(entry, offer, line) }] : [];
    confirmSaved(entry, line, 'upcoming-note', extra);
  });

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
  const applyCaptureState = (pending, hasDraft = Boolean(captureDraft), failed = false) => {
    const state = captureControlsState(pending, hasDraft, Boolean(buildResearchQuery(reviewedCapture())), failed);
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
      if (buildResearchQuery(reviewedCapture())) announce('Current-page details are ready to review.', false, 'companion-capture-source');
      else showCaptureError(CAPTURE_NO_REFERENCE);
    } catch (error) {
      if (requestId !== captureRequestId) return;
      // The kind of failure only: the page's address, title and text stay out of the local diagnostics list.
      void recordDiagnostic({ area: 'capture', code: 'failed' });
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
      $('companion-capture-source').textContent = '';
      applyCaptureState(false, false, true);
      // Said once, beside the button that failed, and never over the Reference box's own line.
      $('companion-capture-error').textContent = error.message;
      $('companion-capture-error').hidden = false;
      speak(error.message);
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
    const payload = watchlistPayloadFromCapture(draft);
    void saveWatchlistDraft(payload, pageValuesLeftOff(draft, payload), 'companion-capture-source');
  });
  // The captured page comes off the card, the editor and the save, wherever the reason: the collector asked, or the lookup
  // stopped being about that page.
  const dropAuctionContext = () => {
    if (captureDraft) captureDraft = { ...withoutPageValues(captureDraft), auctionContext: null };
    researchAuctionContext = null;
    safeCard = clearAuctionContextFromPayload(safeCard);
    if (globalThis.gigaPinaxWatchlistReference) {
      globalThis.gigaPinaxWatchlistReference = clearAuctionContextFromPayload(globalThis.gigaPinaxWatchlistReference);
    }
    $('companion-save-watchlist').disabled = !canSave(safeCard);
    $('companion-capture-source').textContent = 'Auction context cleared. Captured fields remain available for research.';
  };
  $('companion-clear-auction-context').addEventListener('click', () => {
    if (!captureDraft) return;
    dropAuctionContext();
    announce('Auction context cleared.', false, 'companion-capture-source');
  });
  // A lookup this window was SENT is about a page somebody right-clicked on, not the one captured here, so the captured
  // page must not ride along on the coin saved from it. popup.js says so before it opens the card. A reference typed into
  // this window by hand is still about the captured page and keeps it.
  addEventListener('giga-pinax-lookup-received', () => {
    if (researchAuctionContext) dropAuctionContext();
  });
  // A link that could not open says so under the Watchlist tab's own buttons, or in the storage note for the header's.
  const navigate = async (action, fallback, anchor = 'storage-note') => {
    const result = await runVisibleAction(action, fallback);
    if (!result.ok) announce(result.message, true, anchor);
  };
  for (const id of ['companion-open-workspace', 'companion-open-watchlist']) {
    $(id).addEventListener('click', () => void navigate(() => openWorkspace('watchlist'), 'Couldn’t open the watchlist.', 'companion-runtime-note'));
  }
  $('companion-open-needs-outcome').addEventListener('click', () => void navigate(() => openWorkspace('watchlist', undefined, 'needs-outcome'),
    'Couldn’t open the watchlist.', 'companion-runtime-note'));
  $('open-workspace').addEventListener('click', () => void navigate(() => openWorkspace('watchlist'), 'Couldn’t open the workspace.'));
  $('open-settings').addEventListener('click', () => void navigate(() => openSettings(), 'Couldn’t open Settings.'));
  $('open-panel').addEventListener('click', () => void navigate(() => openResearchPanel(), 'Couldn’t open the research panel.'));

  // Set once the snapshot has been read: only then is there a revision to write the currency against.
  let currencyWritable = false;
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
      currencyWritable = true;
      const currency = snapshot.preferences?.currency;
      if (CURRENCIES.includes(currency)) calculator.setValues({ currency });
      // Applied before the listener below is registered: this is the stored value itself, so there is
      // nothing for it to write back.
      applyPreferredCurrency($('currency'), currency);
      renderSummary();
      renderCardSaved();
      // Said only where it is the whole story: a bridge that cannot save has a graver note of its own, below.
      if (preferencesBlocked) showStorageNote(PREFERENCES_UNAVAILABLE);
    } else {
      showStorageUnavailable();
      announce(reply?.message || STORAGE_UNAVAILABLE, true);
    }
    bridge.subscribeToSnapshots((incoming) => { snapshot = incoming; renderSummary(); renderCardSaved(); });
  }
  // Registered whether or not the snapshot could be read: the research half has already cached the
  // choice for the next window, so what a failed start-up owes the collector is the reason it will
  // not outlive this profile's session - said once, rather than silence on every change.
  let currencyNoteShown = false;
  $('currency').addEventListener('change', () => {
    const chosen = $('currency').value;
    if (!CURRENCIES.includes(chosen)) return;
    if (!currencyWritable) {
      if (!currencyNoteShown) announce(CURRENCY_NOT_SAVED, true);
      currencyNoteShown = true;
      return;
    }
    // Price research never waits on storage, so the write is sent and answered for on its own.
    void saveCurrency(bridge, chosen, snapshot.preferences)
      .then((saved) => {
        if (saved?.ok) snapshot = { ...snapshot, preferences: saved.value };
        else announce(saved?.message || CURRENCY_NOT_SAVED, true);
      })
      .catch((error) => announce(error?.message || CURRENCY_NOT_SAVED, true));
  });
  activate('research');
  renderSummary();
}

if (typeof document !== 'undefined') void initCompanionPopup().catch(() => showStorageUnavailable());
