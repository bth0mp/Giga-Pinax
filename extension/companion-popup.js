import { CURRENCIES, RESEARCH_CURRENCIES, formatMoney } from './core/money.js';
// The one definition of the message, shared with the function that returns it. Static because the
// note is owed even where the import below could not run; only browser-api.js needs that tolerance.
import { CURRENCY_NOT_SAVED } from './companion-preferences.js';
import { projectExposure } from './core/records.js';
import { eventTiming, lotsNeedingOutcome } from './core/projections.js';
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
import { openWantsFor, wantBadgeText, wantPillText } from './core/wantlist.js';

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
// link and the cache itself all have to follow. A value the select already shows is not a change, and a default outside
// the research currencies (SEK, say) is not one the research select offers, so it keeps its own.
export function applyPreferredCurrency(select, preferred) {
  if (!select || !RESEARCH_CURRENCIES.includes(preferred) || select.value === preferred) return false;
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

// X-11: what the collector is told when the background never answered, or the message port closed under the save: the raw browser error ("The message
// port closed before a response was received.") is no sentence for him. It names the button to press again, and says why pressing it is safe.
export const noAnswerMessage = (button) => `Giga Pinax’s background didn’t answer. Select ${button} again — the same request is retried, never saved twice.`;
// X-05: a save whose answer never comes (a worker that died mid-command) is waited for this long, never for ever: then it is said under the button
// that was pressed, with the same request offered again, and the button comes back.
export const SAVE_ANSWER_MS = 8000;
const LATE = Symbol('late');
// A reply, or LATE once the wait is over. The send keeps going: a reply that comes later is the store's to keep, and the next snapshot shows it.
async function answerWithin(send, ms) {
  let timer = 0;
  const sent = Promise.resolve().then(send);
  sent.catch(() => {});
  try {
    return await Promise.race([sent, new Promise((resolve) => { timer = setTimeout(() => resolve(LATE), ms); })]);
  } finally {
    clearTimeout(timer);
  }
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
          return reply ?? { ok: false, outcome: 'unknown', unanswered: true };
        }
        retry.draftId = reply.value.id;
      }
      const opened = await openDraft(retry.draftId);
      if (opened?.ok === false) return opened;
      retry = null;
      return { ok: true };
    // A send that threw never reached the store's answer (the port closed): its request is kept for the retry, and the caller says so in words.
    // Once the draft is saved, only its opening can have failed.
    })().catch((error) => (retry?.draftId ? { ok: false, message: error?.message || 'Could not open these details in the workspace.' }
      : { ok: false, outcome: 'unknown', unanswered: true }))
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

const OUTCOME_WORDS = Object.freeze({ lost: 'Lost', withdrawn: 'Withdrawn', unsold: 'Unsold' });
// What there is to say of the coins saved under a card's reference: where the newest open one stands, its bid in force or planned (written by
// the one money rule), its auction and when.
// A pill's words write a whole amount without its places (whole), the sentence with them.
function savedFacts(lots, snapshot, { now, locale, whole = false }) {
  const lot = lots[0];
  const status = lot.outcome?.status ?? 'open';
  const money = (amount) => { try { return formatMoney(amount, locale, { narrow: true, whole }); } catch { return ''; } };
  const bid = status !== 'open' ? null : lot.activeBid?.amount ? { kind: 'active', amount: money(lot.activeBid.amount) }
    : lot.plannedBid?.amount ? { kind: 'planned', amount: money(lot.plannedBid.amount) } : null;
  const event = lot.auctionEventId ? (snapshot?.auctionEvents ?? []).find(({ id }) => id === lot.auctionEventId) : null;
  const relative = event && status === 'open' ? eventWhen(event, { now, locale }).relative : '';
  return { status, bid: bid?.amount ? bid : null, eventName: event?.name ?? '', relative };
}
// What the card says of a coin already saved under its reference, in full: where it stands, the bid in force or planned, and its auction and when.
// It is the tooltip and the name of the card's status pill.
export function savedLineText(lots, snapshot, { now = new Date().toISOString(), locale = 'en-US' } = {}) {
  if (!lots?.[0]) return '';
  const { status, bid, eventName, relative } = savedFacts(lots, snapshot, { now, locale });
  const parts = [status === 'open' ? 'On your watchlist' : status === 'won' ? 'In your collection' : `Saved · ${OUTCOME_WORDS[status] ?? status}`];
  if (bid) parts.push(`Bid ${bid.kind} ${bid.amount}`);
  parts.push(eventName, relative);
  if (lots.length > 1) parts.push(`${lots.length} coins saved`);
  return parts.filter(Boolean).join(' · ');
}
// The same coin as the card's status pill says it (H-05), short enough to share one row with the want: "Watching · £650 bid · in 25 h". The
// amount is whole where it is exact and in full where it is not: a pill never cuts or rounds one.
export function savedPillText(lots, snapshot, { now = new Date().toISOString(), locale = 'en-US' } = {}) {
  if (!lots?.[0]) return '';
  const { status, bid, relative } = savedFacts(lots, snapshot, { now, locale, whole: true });
  if (status !== 'open') return status === 'won' ? 'In your collection' : `Saved · ${OUTCOME_WORDS[status] ?? status}`;
  return ['Watching', bid ? `${bid.amount} ${bid.kind === 'active' ? 'bid' : 'planned'}` : '', relative].filter(Boolean).join(' · ');
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
  // Auctions with a reminder going off now, and those with one that went off while the browser was closed: a missed reminder is no less owed an
  // answer, so it is counted too, and named apart.
  const eventsWith = (statuses) => new Set((snapshot?.alerts ?? [])
    .filter((alert) => statuses.includes(alert.status) && alert.eventId)
    .map((alert) => alert.eventId));
  const dueEventIds = eventsWith(['due', 'claimed', 'delivered']);
  const missedEventIds = eventsWith(['missed']);
  const projected = projectExposure({ lots: snapshot?.lots ?? [] });
  const exposure = {};
  for (const currency of CURRENCIES) exposure[currency] = projected[currency] ?? {
    hammerMinor: 0, knownHammerPlusBpMinor: 0, bindingCount: 0, unknownPremiumCount: 0, knownTotalMinor: 0, totalCount: 0, byEvent: {},
  };
  return { nextEvent: events[0] ?? null, dueAuctionCount: dueEventIds.size, missedAuctionCount: missedEventIds.size, exposure };
}

// "1 due · 1 missed", or "None due".
export function dueText(summary) {
  const parts = [summary?.dueAuctionCount ? `${summary.dueAuctionCount} due` : '', summary?.missedAuctionCount ? `${summary.missedAuctionCount} missed` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'None due';
}

// The next auction as the workspace's rows say it: "CNG Feature Auction 130 · sale day Wed 14 Oct · in 20 days".
export function nextEventText(event, { now = new Date().toISOString(), locale = 'en-US' } = {}) {
  if (!event) return 'No upcoming auction';
  const { when, relative } = eventWhen(event, { now, locale });
  const day = when && when !== 'Time unknown' ? `${when.charAt(0).toLocaleLowerCase(locale)}${when.slice(1)}` : '';
  return [event.name, day, relative].filter(Boolean).join(' · ');
}


const openLot = (lot) => (lot?.outcome?.status ?? 'open') === 'open';
// The open coins whose auction is still to come or under way, with that auction and when it is.
function comingLots(snapshot, now) {
  const events = new Map((snapshot?.auctionEvents ?? []).map((event) => [event.id, event]));
  return (snapshot?.lots ?? [])
    .filter((lot) => openLot(lot) && events.has(lot.auctionEventId))
    .map((lot) => ({ lot, event: events.get(lot.auctionEventId), timing: eventTiming(events.get(lot.auctionEventId), now) }))
    .filter(({ timing }) => ['soon', 'upcoming', 'started'].includes(timing.state));
}

// The coins that want the collector now, at most five: those whose auction has ended with no outcome, then those whose auction is next, soonest first,
// then (K-01) the open coins with no auction at all, newest first, so a coin saved from the card is never missing from the tab named Watchlist. The coin
// the popup has just saved (first) leads the list whatever its state. Each is said as a workspace row says a coin (H-16): its reference first, then its
// title, then when; a coin with no sale says so, and noSale marks it for the row's Add.
export function coinsToWatch(snapshot, { now = new Date().toISOString(), locale = 'en-US', limit = 5, first = '' } = {}) {
  const row = (lot, when, noSale = false) => ({ lot, reference: displayReference(lot.reference ?? ''), title: String(lot.title ?? ''), when, ...(noSale ? { noSale } : {}) });
  const ended = lotsNeedingOutcome(snapshot, now).map((lot) => row(lot, 'ended, record the outcome'));
  const coming = comingLots(snapshot, now)
    .sort((left, right) => (left.timing.sortMs ?? Infinity) - (right.timing.sortMs ?? Infinity))
    .map(({ lot, event }) => row(lot, eventWhen(event, { now, locale }).relative));
  const newest = (lot) => String(lot.createdAt ?? lot.updatedAt ?? '');
  const unscheduled = (snapshot?.lots ?? [])
    .filter((lot) => openLot(lot) && !lot.auctionEventId)
    .sort((left, right) => newest(right).localeCompare(newest(left)))
    .map((lot) => row(lot, 'no sale date', true));
  const rows = [...ended, ...coming, ...unscheduled];
  const saved = first ? (snapshot?.lots ?? []).find((lot) => lot?.id === first) : null;
  if (!saved) return rows.slice(0, limit);
  const own = rows.find((entry) => entry.lot.id === first) ?? row(saved, openLot(saved) ? 'just saved' : '');
  return [own, ...rows.filter((entry) => entry !== own)].slice(0, limit);
}

// What the Watchlist tab holds, in one line over it (K-01): "3 coins on your watchlist · 1 with a sale coming". Empty for a store with no coin at all,
// which has its own empty state.
export function watchlistCountText(snapshot, now = new Date().toISOString()) {
  const lots = snapshot?.lots ?? [];
  if (!lots.length) return '';
  const open = lots.filter(openLot).length;
  if (!open) return 'No coins on your watchlist';
  const coming = comingLots(snapshot, now).length;
  return [`${open} ${open === 1 ? 'coin' : 'coins'} on your watchlist`, coming ? `${coming} with a sale coming` : ''].filter(Boolean).join(' · ');
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

  const calculator = mountBidCalculator($('companion-bid-calculator'), { compact: true, remember: true });

  // Current source starts folded; it opens by itself where there is a page to capture - the active tab a web page the extension may read, which the
  // toolbar popup's click grants - so it is one line everywhere else.
  void callExtension((globalThis.browser ?? globalThis.chrome)?.tabs, 'query', captureTabQuery(mode))
    .then((tabs) => { if (capturableTab(tabs)) $('companion-current-lot').open = true; })
    .catch(() => { /* no tab to read: it stays folded */ });

  // The Watchlist tab: the next auction and when, the auctions with a reminder going off or missed, the coins that want the collector now (each opening
  // the workspace on that coin), and the bids in force, only in the currencies that hold one.
  const renderSummary = () => {
    const now = new Date().toISOString();
    const locale = navigator.language;
    const summary = buildWatchlistSummary(snapshot, now);
    $('companion-next-event').textContent = nextEventText(summary.nextEvent, { now, locale });
    $('companion-due-count').textContent = dueText(summary);
    // Lots whose auction has ended with no outcome recorded, and the way to the workspace queue that lists them.
    const ended = lotsNeedingOutcome(snapshot).length;
    $('companion-needs-outcome').hidden = ended === 0;
    $('companion-open-needs-outcome').textContent = `${ended} ${ended === 1 ? 'lot' : 'lots'} ended without an outcome`;
    // K-01: what the list holds, over it, and every open coin can be one of its rows.
    const count = watchlistCountText(snapshot, now);
    $('companion-count').textContent = count;
    $('companion-count').hidden = !count;
    const coins = coinsToWatch(snapshot, { now, locale, first: savedThisSession });
    $('companion-coin-list').replaceChildren(...coins.map(({ lot, reference, title, when, noSale }) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      const parts = [['coin-reference', reference], ['coin-title', title], ['coin-when', when]].filter(([, words]) => words);
      parts.forEach(([className, words], index) => {
        const part = document.createElement('span');
        part.className = className;
        part.textContent = words;
        button.append(...(index ? [' · ', part] : [part]));
      });
      button.disabled = !bridge;
      button.addEventListener('click', () => openLot(lot.id, 'companion-runtime-note'));
      item.append(button);
      // A coin with no sale is one click from giving it one: Add opens it in the workspace, where its auction is chosen or added.
      if (noSale) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'text-button coin-add';
        add.textContent = 'Add';
        add.setAttribute('aria-label', `Add a sale date to ${title || reference || 'this coin'} in the workspace`);
        add.disabled = !bridge;
        add.addEventListener('click', () => openLot(lot.id, 'companion-runtime-note'));
        item.append(add);
      }
      return item;
    }));
    $('companion-coins').hidden = coins.length === 0;
    // With no coin saved at all, the tab says how one gets here (H-07); its values below stay as they are.
    $('companion-empty').hidden = (snapshot.lots ?? []).length > 0;
    const held = CURRENCIES.filter((currency) => summary.exposure[currency].hammerMinor > 0 || summary.exposure[currency].bindingCount > 0);
    $('companion-exposure-list').replaceChildren(...(held.length ? held.map((currency) => {
      const item = summary.exposure[currency];
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = currency;
      const amount = document.createElement('strong');
      amount.id = `companion-exposure-${currency}`;
      // Q-11: beside the hammers, what leaves the account if every bid wins, from the fees saved with the bids.
      const allIn = item.totalCount ? ` · all-in ${formatMoney({ currency, minor: item.knownTotalMinor }, locale, { narrow: true })} (${item.totalCount} of ${item.bindingCount} with fees)` : '';
      amount.textContent = `${formatMoney({ currency, minor: item.hammerMinor }, locale, { narrow: true })}${allIn}${item.unknownPremiumCount ? ` · ${item.unknownPremiumCount} premium unknown` : ''}`;
      row.append(name, amount);
      return row;
    }) : [Object.assign(document.createElement('li'), { className: 'companion-none', textContent: 'No active bids' })]));
  };

  // Every place a save button is put back asks the same question, so a page that cannot save never enables one by a side door.
  const canSave = (payload) => canSaveWatchlist(Boolean(bridge) && !storageUnavailable, payload);
  // The card's status row (H-05) shows while either of its two lines has something to say.
  const syncStatusRow = () => {
    const row = $('companion-status-row');
    if (row) row.hidden = $('companion-saved-line').hidden && $('companion-want-line').hidden;
  };
  // A status pill: its short words and its whole sentence as the tooltip. Where it leads somewhere it is a button, named by its own words and then
  // the sentence (so voice control can say what it sees); where it does not, the sentence is its text for a screen reader, which the status line
  // announces, and the short words are hidden from it.
  const pillNode = (part) => {
    const node = document.createElement(part.action ? 'button' : 'mark');
    node.className = part.kind ? `pill ${part.kind}` : 'pill';
    if (part.title) node.title = part.title;
    if (part.action) {
      node.type = 'button';
      node.textContent = part.pill;
      node.setAttribute('aria-label', part.name ? `${part.pill}: ${part.name}` : part.pill);
      node.addEventListener('click', part.action);
    } else if (part.title && part.title !== part.pill) {
      const shown = document.createElement('span');
      shown.setAttribute('aria-hidden', 'true');
      shown.textContent = part.pill;
      const spoken = document.createElement('span');
      spoken.className = 'sr-only';
      spoken.textContent = part.title;
      node.append(shown, spoken);
    } else {
      node.textContent = part.pill;
    }
    return node;
  };
  // A line of pills, words and buttons, "Saved · Open · Undo": what happened, and what can be done about it, where it happened.
  const fillLine = (line, parts) => {
    const shown = parts.filter(Boolean);
    line.replaceChildren();
    shown.forEach((part, index) => {
      if (index) line.append(' · ');
      if (typeof part === 'string') { line.append(part); return; }
      if (part.pill) { line.append(pillNode(part)); return; }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = part.label;
      if (part.name) button.setAttribute('aria-label', part.name);
      button.addEventListener('click', part.action);
      line.append(button);
    });
    line.hidden = shown.length === 0;
    syncStatusRow();
  };
  const openLot = (lotId, anchor) => void navigate(() => openWorkspace('watchlist', undefined, '', lotId), 'Couldn’t open the workspace.', anchor);
  const openAction = (lotId, anchor) => ({ label: 'Open', name: 'Open this coin in the workspace', action: () => openLot(lotId, anchor) });
  // A saved coin as one pill whose click opens it (H-05): its short words, its whole sentence as the tooltip, and that sentence with where it leads
  // as its name.
  const watchingPill = (pill, sentence, lotId, anchor) => ({ pill, title: sentence, kind: 'watch-pill', name: `${sentence} · Open this coin in the workspace`,
    action: () => openLot(lotId, anchor) });
  // The coin a save from this page made a moment ago, which Undo takes back for ten seconds: where it was saved (the card or the Upcoming list), the
  // coin as stored and the auction attached to it, if any.
  let justSaved = null;
  const UNDO_FOR_MS = 10000;
  // K-01: the coin this popup saved last leads the Watchlist tab's list for as long as the popup is open, whatever its state.
  let savedThisSession = '';
  // The card says whether its reference is already saved, and then offers that coin rather than a second one: Save gives way to the line.
  const renderCardSaved = () => {
    const line = $('companion-saved-line');
    const save = $('companion-save-watchlist');
    if (justSaved?.where === 'card') { save.hidden = true; return; }
    const lots = safeCard?.reference ? savedLotsFor(snapshot, safeCard.reference) : [];
    if (!lots.length) { fillLine(line, []); save.hidden = false; return; }
    const locale = navigator.language;
    fillLine(line, [watchingPill(savedPillText(lots, snapshot, { locale }), savedLineText(lots, snapshot, { locale }), lots[0].id, 'companion-save-hint')]);
    // A coin still open takes Save's place; owning one example (or losing one) is no reason not to watch another lot of the type.
    save.hidden = lots.some((lot) => (lot.outcome?.status ?? 'open') === 'open');
  };
  // The card's type on the want list (G-22): "On your want list · up to €800.00 · VF or better" under the card, matched by
  // the catalogue rules and only for the one type a card shows - a list of candidates draws no card, so it never says so.
  // The want list also goes to the research half, for its Upcoming rows; nothing is fetched for it.
  // The card's reading where it handed one over (a Bopearachchi card's label reads as nothing), else its reference.
  const readingOfCard = (card) => card?.reading ?? card?.reference ?? null;
  let cardReference = readingOfCard(globalThis.gigaPinaxWatchlistReference);
  // H-05: the want is the status row's second pill, "Wanted · up to £650.00 · VF+", its whole terms the tooltip.
  const renderCardWanted = () => {
    const line = $('companion-want-line');
    if (!line) return;
    const wants = cardReference ? openWantsFor(snapshot.wants, cardReference) : [];
    fillLine(line, wants.length ? [{ pill: wantPillText(wants, navigator.language), title: wantBadgeText(wants, navigator.language), kind: 'want-pill' }] : []);
  };
  const shareWants = () => {
    globalThis.gigaPinaxWants = Object.freeze([...(snapshot.wants ?? [])]);
    dispatchEvent(new CustomEvent('giga-pinax-wants', { detail: globalThis.gigaPinaxWants }));
  };
  const forgetJustSaved = (where) => {
    // What the line under Save said of the last card (a removal, a refusal) is not about the next one.
    if (where === 'card') { $('companion-save-hint').textContent = ''; $('companion-save-hint').hidden = true; }
    if (justSaved?.where !== where) return;
    clearTimeout(justSaved.timer);
    justSaved = null;
  };
  // The research half's output cleared (typing, a new lookup): what Watch said under its Upcoming list goes with that list, and its Undo with it.
  const clearUpcomingSaved = () => {
    forgetJustSaved('upcoming');
    fillLine($('upcoming-saved'), []);
  };
  const clearCard = () => {
    safeCard = null;
    cardReference = null;
    renderCardWanted();
    $('companion-save-watchlist').disabled = true;
    forgetJustSaved('card');
    clearUpcomingSaved();
    renderCardSaved();
  };
  addEventListener('giga-pinax-card', (event) => {
    if (!event.detail) clearUpcomingSaved();
    safeCard = buildWatchlistDraftPayload({ ...event.detail, auctionContext: researchAuctionContext });
    $('companion-save-watchlist').disabled = !canSave(safeCard);
    forgetJustSaved('card');
    renderCardSaved();
    cardReference = readingOfCard(event.detail);
    renderCardWanted();
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
    // X-05: a draft save with no answer within the wait is no answer, and keeps its request for the retry.
    sendCommand: async (command) => {
      const reply = await answerWithin(() => bridge.sendCommand(command), SAVE_ANSWER_MS);
      if (reply !== LATE) return reply;
      void recordDiagnostic({ area: 'store', code: 'timeout' });
      return undefined;
    },
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
      const answer = await draftSaver(payload);
      // A background that said nothing (X-11) is recorded as a kind of failure only, and said in words; a refusal says the store's own reason.
      if (answer?.unanswered) void recordDiagnostic({ area: 'store', code: 'not-saved' });
      const saved = answer?.unanswered ? { ok: false, message: noAnswerMessage(anchor === 'companion-save-hint' ? 'Watch' : 'Save to watchlist') }
        : answer?.ok ? { ok: true } : { ok: false, message: answer?.message || answer?.error?.message || 'Couldn’t save these details to the watchlist.' };
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
  // X-11: no reply, or an exception from the bridge, is one sentence that names the button to press again; the kind of failure goes to the local
  // diagnostics, never the browser's words.
  // X-05: a save waits SAVE_ANSWER_MS for its answer and no longer; it is then said as late, and its request kept for the retry.
  const LATE_MESSAGE = 'The save didn’t get an answer.';
  const sendDirect = async (command, button = 'Watch', wait = 0) => {
    try {
      const reply = wait ? await answerWithin(() => bridge.sendCommand(command), wait) : await bridge.sendCommand(command);
      if (reply === LATE) {
        void recordDiagnostic({ area: 'store', code: 'timeout' });
        return { ok: false, outcome: 'unknown', late: true, message: `${LATE_MESSAGE} Select ${button} again — the same request is retried, never saved twice.` };
      }
      if (reply) return reply;
    } catch { /* said below, as no answer */ }
    void recordDiagnostic({ area: 'store', code: 'not-saved' });
    return { ok: false, outcome: 'unknown', message: noAnswerMessage(button) };
  };
  // Late, under the card's own button: the sentence and the one verb that gets out, the same request sent again.
  const sayLate = (anchor, retry) => {
    const line = $(anchor);
    speak(LATE_MESSAGE);
    fillLine(line, [LATE_MESSAGE, { label: 'Retry the same request', name: 'Retry the same request; it is never saved twice', action: retry }]);
    line.classList.toggle('said-error', true);
  };
  const saveDirect = async (payload, anchor, retry = null) => {
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
      const reply = await sendDirect({ type: 'lot.save', requestId: directRequest.requestId, expectedRevision: null, lot: built.lot }, 'Watch', SAVE_ANSWER_MS);
      if (!reply.ok) {
        if ((reply.outcome ?? reply.error?.outcome) !== 'unknown') directRequest = null;
        if (reply.late && anchor && retry) { sayLate(anchor, retry); return { ok: false, late: true, message: reply.message }; }
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
    const reply = await sendDirect({ type: 'lot.delete', requestId: bridge.newRequestId(), lotId: entry.lot.id, expectedRevision: current.revision }, 'Undo');
    if (!reply.ok) { announce(reply.message || 'Couldn’t take this coin off the watchlist.', true, anchor); return; }
    if (entry.event) await sendDirect({ type: 'event.delete', requestId: bridge.newRequestId(), eventId: entry.event.id, expectedRevision: entry.event.revision });
    justSaved = null;
    snapshot = { ...snapshot, lots: (snapshot.lots ?? []).filter(({ id }) => id !== entry.lot.id) };
    if (savedThisSession === entry.lot.id) savedThisSession = '';
    renderSummary();
    fillLine(line, []);
    announce('Removed from your watchlist.', false, anchor);
    renderCardSaved();
  };
  // Saved: the line says so, with Open and Undo; after ten seconds Undo goes, and the line says where the coin stands.
  const confirmSaved = (entry, line, anchor, extra = []) => {
    if (justSaved && justSaved !== entry) clearTimeout(justSaved.timer);
    justSaved = entry;
    savedThisSession = entry.lot.id;
    renderSummary();
    // What the line under it said of an earlier save (a failure, a removal) is over.
    const hint = $(anchor);
    if (hint && anchor !== 'upcoming-note') { hint.textContent = ''; hint.hidden = true; }
    // K-14: one verb into the workspace. The card's button is Watch, as on an Upcoming lot, and what it made is Watching.
    const pill = entry.event ? 'Watching with its sale day' : 'Watching';
    // The line is a status region: it says the save once. "Watching" is its pill, with the sentence as the tooltip.
    fillLine(line, [{ pill, title: pill.replace('Watching', 'Added to your watchlist'), kind: 'watch-pill' }, openAction(entry.lot.id, anchor),
      { label: 'Undo', name: 'Undo: take this coin off the watchlist', action: () => void undoSave(entry, line, anchor) }, ...extra]);
    entry.timer = setTimeout(() => {
      if (justSaved !== entry) return;
      justSaved = null;
      if (entry.where === 'card') renderCardSaved();
      else fillLine(line, [watchingPill('Watching', 'On your watchlist', entry.lot.id, anchor)]);
    }, UNDO_FOR_MS);
  };
  const watchCard = async () => {
    const payload = safeCard;
    // A card carrying a captured page's values goes to the workspace for review, as before.
    if (!savesDirectly(payload)) { void saveWatchlistDraft(payload); return; }
    const saved = await saveDirect(payload, 'companion-save-hint', () => { if (safeCard === payload) void watchCard(); });
    if (!saved.ok || safeCard !== payload) return;
    confirmSaved({ where: 'card', lot: saved.lot, event: null, timer: 0 }, $('companion-saved-line'), 'companion-save-hint');
    $('companion-save-watchlist').hidden = true;
  };
  $('companion-save-watchlist').addEventListener('click', () => watchCard());
  // Watch on an upcoming acsearch lot (popup.js): saved in one step with the lot's title, the card's reference and the lot's own acsearch page, said
  // under the list with Open and Undo, and its sale day offered as a date-only auction to attach with Add. Nothing opens by itself. No captured page
  // rides along, since the lot is acsearch's. A failure is handed back, to be shown beside the list Watch was pressed in.
  const attachSaleDay = async (entry, offer, line) => {
    if (justSaved !== entry || entry.event) return;
    clearTimeout(entry.timer);
    entry.offerRequest ??= bridge.newRequestId();
    const eventReply = await sendDirect({ type: 'event.save', requestId: entry.offerRequest, expectedRevision: null, event: { ...offer, name: entry.lot.title.slice(0, 300) } }, 'Add');
    if (!eventReply.ok) { announce(eventReply.message || 'Couldn’t add the auction.', true, 'upcoming-note'); confirmSaved(entry, line, 'upcoming-note'); return; }
    const values = lotFormValues(entry.lot);
    const lot = buildWorkspaceLotDraft(entry.lot, { ...values, auctionEventId: eventReply.value.id }, values.sourceUrl);
    const lotReply = await sendDirect({ type: 'lot.save', requestId: bridge.newRequestId(), expectedRevision: entry.lot.revision, lot }, 'Add');
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
  addEventListener('giga-pinax-watch', async (event) => {
    const payload = buildWatchlistDraftPayload(event.detail);
    const line = $('upcoming-saved');
    // A lot already saved from its acsearch page is offered, not saved twice.
    const existing = payload.pageUrl ? (snapshot.lots ?? []).find((lot) => lot.sourceLinks?.some(({ url }) => url === payload.pageUrl)) : null;
    if (existing) { fillLine(line, ['Already on your watchlist', openAction(existing.id, 'upcoming-note')]); return; }
    const saved = await saveDirect(payload, null);
    if (!saved.ok) {
      speak(saved.message);
      dispatchEvent(new CustomEvent('giga-pinax-watch-failed', { detail: { message: saved.message } }));
      return;
    }
    const entry = { where: 'upcoming', lot: saved.lot, event: null, timer: 0 };
    const offer = offeredSaleDay(payload.closesAt, payload.pageUrl);
    // The day as the Watchlist tab writes one ("sale day Thu, Jun 1"), in the browser's language.
    const when = offer ? eventWhen(offer, { locale: navigator.language }).when : '';
    const day = when ? `${when.charAt(0).toLocaleLowerCase()}${when.slice(1)}` : '';
    const extra = offer ? [`add its ${day} as an auction?`, { label: 'Add', name: `Add the ${day} as an auction`, action: () => void attachSaleDay(entry, offer, line) }] : [];
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
  $('companion-open-watchlist').addEventListener('click', () => void navigate(() => openWorkspace('watchlist'), 'Couldn’t open the watchlist.', 'companion-runtime-note'));
  $('companion-open-needs-outcome').addEventListener('click', () => void navigate(() => openWorkspace('watchlist', undefined, 'needs-outcome'),
    'Couldn’t open the watchlist.', 'companion-runtime-note'));
  $('open-workspace').addEventListener('click', () => void navigate(() => openWorkspace('watchlist'), 'Couldn’t open the workspace.'));
  $('open-settings').addEventListener('click', () => void navigate(() => openSettings(), 'Couldn’t open Settings.'));
  // K-17: the credit line's link opens Settings at the local catalogue data, where each bundle is credited with its source and licence.
  $('open-credits')?.addEventListener('click', () => void navigate(() => openSettings('catalogue-data'), 'Couldn’t open Settings.'));
  $('open-panel').addEventListener('click', () => void navigate(() => openResearchPanel(), 'Couldn’t open the research panel.'));

  // Set once the snapshot has been read: only then is there a revision to write the currency against.
  let currencyWritable = false;
  // The research half draws a restored answer once the store has been read, or could not be (H-11), so the card lands with its status row.
  const snapshotRead = () => {
    globalThis.gigaPinaxSnapshotReady = true;
    dispatchEvent(new CustomEvent('giga-pinax-snapshot-ready'));
  };
  if (!bridge || !initializeCompanionPreferences) {
    $('companion-runtime-note').hidden = false;
    document.querySelectorAll('[data-companion-runtime]').forEach((element) => { element.disabled = true; });
    snapshotRead();
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
      renderCardWanted();
      shareWants();
      // Said only where it is the whole story: a bridge that cannot save has a graver note of its own, below.
      if (preferencesBlocked) showStorageNote(PREFERENCES_UNAVAILABLE);
    } else {
      showStorageUnavailable();
      announce(reply?.message || STORAGE_UNAVAILABLE, true);
    }
    snapshotRead();
    bridge.subscribeToSnapshots((incoming) => {
      snapshot = incoming;
      // A coin just saved and since removed elsewhere (a workspace tab) takes its line, and its Undo, with it.
      if (justSaved && !(snapshot.lots ?? []).some(({ id }) => id === justSaved.lot.id)) {
        const where = justSaved.where;
        forgetJustSaved(where);
        fillLine($(where === 'card' ? 'companion-saved-line' : 'upcoming-saved'), []);
      }
      renderSummary();
      renderCardSaved();
      renderCardWanted();
      shareWants();
    });
  }
  // Registered whether or not the snapshot could be read: the research half has already cached the
  // choice for the next window, so what a failed start-up owes the collector is the reason it will
  // not outlive this profile's session - said once, rather than silence on every change.
  let currencyNoteShown = false;
  $('currency').addEventListener('change', () => {
    const chosen = $('currency').value;
    if (!CURRENCIES.includes(chosen)) return;
    // A default outside the research currencies (SEK, JPY) is the collector's bid currency, which research cannot show:
    // the research select keeps its own choice (the research form's cache has it) and the default is left alone.
    const stored = snapshot?.preferences?.currency;
    if (CURRENCIES.includes(stored) && !RESEARCH_CURRENCIES.includes(stored)) return;
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
