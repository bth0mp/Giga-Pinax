import { computeStatistics } from './core/evidence.js';
import { calculateBidCost, calculatePremium, formatMoney, parseMoney, parsePremiumPercent } from './core/money.js';
import { projectExposure } from './core/records.js';
import { buildUserInitiatedSearch } from './source-launchers.js';
import { mountBidCalculator } from './bid-tools.js';
import { mountSourcesMenu } from './source-menu.js';
import { openSettings } from './navigation.js';

const ROUTES = Object.freeze(['search', 'watchlist', 'auctions', 'bids', 'history']);
const requestId = () => globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function routeFromHash(hash) {
  if (typeof hash === 'string' && hash.startsWith('#event-draft=')) return 'auctions';
  if (typeof hash === 'string' && hash.startsWith('#lot-draft=')) return 'watchlist';
  const route = String(hash ?? '').replace(/^#/, '').split(/[?=]/, 1)[0];
  return ROUTES.includes(route) ? route : 'search';
}

export function applyActiveRoute(routes, active, panelFor, linkFor) {
  for (const route of routes) {
    panelFor(route).hidden = route !== active;
    const link = linkFor(route);
    if (!link) continue;
    if (route === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

export const editorCompletion = (submittedVersion, currentVersion) =>
  submittedVersion === currentVersion ? 'reset' : 'preserve';
export const sameEditorIdentity = (submitted, current) => {
  const submittedId = submitted?.id ?? null;
  const currentId = current?.id ?? null;
  return submittedId === null || currentId === null ? submitted === current : submittedId === currentId;
};

export function chooseSelectedLot(state, lotId, lots = []) {
  if (lotId === null) return { selectedLotId: null, mode: 'list' };
  if (!(lots ?? []).some((lot) => lot.id === lotId)) return state;
  return { selectedLotId: lotId, mode: 'detail' };
}

export function filterWorkspaceLots(lots, query) {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  if (!needle) return [...(lots ?? [])];
  return (lots ?? []).filter((lot) => [lot.title, lot.reference, lot.lotNumber]
    .some((value) => String(value ?? '').toLocaleLowerCase().includes(needle)));
}

const OPEN_OUTCOME = (lot) => !lot?.outcome?.status || lot.outcome.status === 'open';
export function auctionTimeLabel(event) {
  if (!event?.localDate) return 'Time unknown';
  const kind = event.eventKind === 'lot-closes' ? 'Lot deadline' : event.eventKind === 'auction-day' ? 'Auction day' : 'Event starts';
  if (event.precision === 'timed' && event.localTime) return `${kind} · ${event.localDate} at ${event.localTime} ${event.timeZone}`;
  return `${kind} · ${event.localDate} (date only, ${event.timeZone})`;
}

export function auctionQueueForLots(lots, events, queue = 'all-open', now = new Date().toISOString()) {
  const eventById = new Map((events ?? []).map((event) => [event.id, event]));
  const nowMs = Date.parse(now);
  const entries = (lots ?? []).map((lot, index) => ({ lot, event: eventById.get(lot.auctionEventId) ?? null, index }));
  const matches = ({ lot, event }) => {
    if (queue === 'all-coins') return true;
    if (queue === 'completed') return !OPEN_OUTCOME(lot);
    if (!OPEN_OUTCOME(lot)) return false;
    if (queue === 'closing-soon') {
      const eventMs = event?.precision === 'timed' ? Date.parse(event.startsAt) : NaN;
      return Number.isFinite(eventMs) && eventMs >= nowMs && eventMs <= nowMs + 48 * 60 * 60 * 1000;
    }
    if (queue === 'needs-research') return !String(lot.reference ?? '').trim();
    if (queue === 'planned') return Boolean(lot.plannedBid) && !lot.activeBid;
    if (queue === 'active') return Boolean(lot.activeBid);
    return true;
  };
  const sortKey = ({ event }) => event?.precision === 'timed' && Number.isFinite(Date.parse(event.startsAt))
    ? [0, Date.parse(event.startsAt)] : event?.localDate ? [1, Date.parse(`${event.localDate}T00:00:00Z`)] : [2, 0];
  return entries.filter(matches).sort((left, right) => {
    const a = sortKey(left); const b = sortKey(right);
    return a[0] - b[0] || a[1] - b[1] || left.index - right.index;
  });
}

export function comparisonSelectionAfterToggle(selectedIds, lotId) {
  const selected = [...new Set(selectedIds ?? [])];
  if (selected.includes(lotId)) return selected.filter((id) => id !== lotId);
  return selected.length >= 4 ? selected : [...selected, lotId];
}

export function comparisonPickerLabel(lot) {
  const parts = [String(lot?.title ?? '').trim() || 'Untitled coin'];
  const reference = String(lot?.reference ?? '').trim(); if (reference && reference !== parts[0]) parts.push(reference);
  const context = lot?.auctionContext ?? {};
  const identity = [context.house, context.saleId ? `sale ${context.saleId}` : '', context.lotNumber ? `lot ${context.lotNumber}` : ''].filter(Boolean).join(' ');
  if (identity) parts.push(identity); else if (lot?.lotNumber) parts.push(`lot ${lot.lotNumber}`);
  return parts.join(' · ');
}

export function comparisonProvenanceRows(notes) {
  return (notes ?? []).map((note) => ({
    id: note.id, text: note.text, sourceUrl: note.sourceUrl,
    dateLabel: `${note.auctionDate ? `Auction date ${note.auctionDate} · ` : ''}Recorded ${String(note.recordedAt).slice(0, 10)}`,
  }));
}

export function comparisonRows(lots, selectedIds) {
  const byId = new Map((lots ?? []).map((lot) => [lot.id, lot]));
  return (selectedIds ?? []).map((id) => byId.get(id)).filter(Boolean).map((lot) => {
    const terminal = Boolean(lot.outcome?.status && lot.outcome.status !== 'open');
    const bid = terminal ? null : lot.activeBid ?? lot.plannedBid ?? null;
    const amount = terminal ? lot.outcome?.hammer ?? null : bid?.amount ?? null;
    const amountRole = terminal ? 'Final hammer' : lot.activeBid ? 'Active maximum' : lot.plannedBid ? 'Planned maximum' : 'Saved amount';
    const estimate = lot.costEstimate;
    const estimateLabel = terminal ? '' : !estimate ? 'No saved fee estimate' : !amount || estimate.currency !== amount.currency
      ? `Fee estimate unavailable for ${amount?.currency ?? 'this amount'}; recalculate`
      : `${estimate.currency} fees: shipping ${((estimate.shippingMinor ?? 0) / 100).toFixed(2)} + fixed ${((estimate.paymentFeeMinor ?? 0) / 100).toFixed(2)} + ${((estimate.paymentFeeBps ?? 0) / 100).toFixed(2)}%`;
    let totalLabel = terminal ? '' : Number.isInteger(bid?.buyerPremiumBps) ? 'Estimated total unknown; recalculate fees' : 'Estimated total unknown; buyer premium not recorded';
    if (!terminal && amount && Number.isInteger(bid?.buyerPremiumBps) && estimate?.currency === amount.currency) {
      const calculated = calculateBidCost(amount, bid.buyerPremiumBps, estimate);
      if (calculated.ok) totalLabel = `Estimated total ${calculated.value.total.currency} ${moneyInputText(calculated.value.total, 'en-US')}`;
    }
    const actualTotalLabel = terminal && lot.outcome?.actualInvoice ? `Actual invoice ${lot.outcome.actualInvoice.currency} ${moneyInputText(lot.outcome.actualInvoice, 'en-US')}` : '';
    return { ...lot, amountLabel: amount ? `${amountRole} ${amount.currency} ${moneyInputText(amount, 'en-US')}` : terminal ? 'Final hammer not recorded' : 'No saved amount', estimateLabel, totalLabel, actualTotalLabel };
  });
}

export function buildWorkspaceLotDraft(existing, values, originalManualUrl) {
  const lot = { ...(existing?.id ? { id: existing.id } : {}), title: String(values.title ?? '').trim(), sourceLinks: mergeLotSourceLinks(existing?.sourceLinks, values.sourceUrl, originalManualUrl) };
  for (const key of ['reference', 'lotNumber', 'auctionEventId']) if (values[key]) lot[key] = String(values[key]).trim();
  lot.notes = String(values.notes ?? '');
  const auctionContext = { pageUrl: String(values.auctionPageUrl ?? '').trim() };
  for (const [field, key] of [['canonicalUrl', 'auctionCanonicalUrl'], ['house', 'auctionHouse'], ['saleId', 'auctionSaleId'], ['lotNumber', 'auctionLotNumber']]) {
    const value = String(values[key] ?? '').trim(); if (value) auctionContext[field] = value;
  }
  if (auctionContext.pageUrl) lot.auctionContext = auctionContext;
  else if (existing?.auctionContext) lot.auctionContext = null;
  const photoUrls = [values.photoUrl1, values.photoUrl2].map((value) => String(value ?? '').trim()).filter(Boolean);
  const coinDetails = { photoUrls };
  const weightText = String(values.weightGrams ?? '').trim(); const weight = Number(weightText); if (weightText && (!Number.isFinite(weight) || weight < 0.001 || weight > 1000)) throw new RangeError('Enter a valid weight from 0.001 to 1000 grams.'); if (weightText) coinDetails.weightMg = Math.round(weight * 1000);
  const diameterText = String(values.diameterMm ?? '').trim(); const diameter = Number(diameterText); if (diameterText && (!Number.isFinite(diameter) || diameter < 0.01 || diameter > 1000)) throw new RangeError('Enter a valid diameter from 0.01 to 1000 millimetres.'); if (diameterText) coinDetails.diameterHundredthsMm = Math.round(diameter * 100);
  if (String(values.condition ?? '').trim()) coinDetails.condition = String(values.condition).trim();
  if (photoUrls.length || coinDetails.weightMg || coinDetails.diameterHundredthsMm || coinDetails.condition) lot.coinDetails = coinDetails;
  else if (existing?.coinDetails) lot.coinDetails = null;
  if (Array.isArray(values.provenanceNotes)) lot.provenanceNotes = structuredClone(values.provenanceNotes);
  if (existing?.costEstimate) lot.costEstimate = structuredClone(existing.costEstimate);
  return lot;
}

export function lotStatusLabel(lot) {
  const status = lot?.outcome?.status;
  if (status && status !== 'open') return ({ won: 'Won', lost: 'Lost', passed: 'Passed' })[status] ?? 'Closed';
  if (lot?.activeBid) return 'Bid active';
  if (lot?.plannedBid) return 'Bid planned';
  return 'Watching';
}

export function buildLotUndoCommand(undo, newRequestId = requestId) {
  if (!undo?.previous?.id || undo.previous.id !== undo?.saved?.id || !Number.isInteger(undo.saved.revision)) return null;
  const { revision, dataClass, createdAt, updatedAt, ...lot } = structuredClone(undo.previous);
  for (const key of ['auctionContext', 'coinDetails', 'provenanceNotes', 'costEstimate']) if (!Object.hasOwn(lot, key)) lot[key] = null;
  return buildLotSaveCommand({ ...lot, notes: lot.notes ?? '' }, undo.saved.revision, newRequestId);
}

export function selectionAfterLotSave(current, submitted, submittedVersion, currentVersion, savedId) {
  if (submittedVersion !== currentVersion || current.selectedLotId !== submitted.selectedLotId || current.mode !== submitted.mode) return current;
  return { selectedLotId: savedId, mode: 'detail' };
}

export function lotSaveFollowup(current, submitted, saved, editorPreserved, hasPrevious = true, interactionChanged = false) {
  const sameSelection = current.selectedLotId === submitted.selectedLotId && current.mode === submitted.mode;
  const savedMatches = submitted.selectedLotId === null || submitted.selectedLotId === saved?.id;
  const completed = !editorPreserved && !interactionChanged && sameSelection && savedMatches && Boolean(saved?.id);
  return { selection: completed && submitted.selectedLotId === null ? { selectedLotId: saved.id, mode: 'detail' } : current, offerUndo: completed && hasPrevious };
}

export function buildAttachEventCommand(record, auctionEventId, newRequestId = requestId) {
  if (!record?.id || !Number.isInteger(record.revision) || !auctionEventId) return null;
  const { revision, dataClass, createdAt, updatedAt, ...lot } = structuredClone(record);
  return buildLotSaveCommand({ ...lot, auctionEventId }, revision, newRequestId);
}

const DETAIL_TABS = Object.freeze(['details', 'bid', 'reminders', 'outcome']);
export function moveDetailTab(active, key) {
  const index = Math.max(0, DETAIL_TABS.indexOf(active));
  if (key === 'Home') return DETAIL_TABS[0];
  if (key === 'End') return DETAIL_TABS.at(-1);
  if (key === 'ArrowRight') return DETAIL_TABS[(index + 1) % DETAIL_TABS.length];
  if (key === 'ArrowLeft') return DETAIL_TABS[(index - 1 + DETAIL_TABS.length) % DETAIL_TABS.length];
  return active;
}
export const sameEventReturnContext = (submitted, current, submittedVersion, currentVersion) =>
  submitted === current && submittedVersion === currentVersion;

export function lotDraftToEditor(payload) {
  const bounded = (value, maximum) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : '';
  const result = {
    title: bounded(payload?.title, 200),
    reference: bounded(payload?.reference, 120),
    sourceUrl: bounded(payload?.pageUrl, 2048),
  };
  if (payload?.auctionContext?.pageUrl) result.auctionContext = structuredClone(payload.auctionContext);
  return result;
}

export function draftToConsumeAfterLotSave(reply, draftId) {
  return reply?.ok && draftId ? draftId : null;
}

export function receiveWorkspaceSnapshot(state, snapshot) {
  if (state.dirtyEditors?.size) return { ...state, conflict: { pendingSnapshot: snapshot } };
  return { ...state, snapshot, conflict: null };
}

export function buildLotSaveCommand(lot, expectedRevision, newRequestId = requestId) {
  return { type: 'lot.save', requestId: newRequestId(), expectedRevision, lot };
}

export function buildBidSaveCommand(action, basis, bid, costEstimate, newRequestId = requestId) {
  const command = { type: action === 'place' ? 'bid.place' : 'bid.plan', requestId: newRequestId(), lotId: basis.id, expectedRevision: basis.revision, [action === 'place' ? 'activeBid' : 'plannedBid']: bid };
  if (costEstimate?.currency === bid?.amount?.currency) command.costEstimate = structuredClone(costEstimate);
  return command;
}

export function buildGroupReorderCommand(group, orderedLotIds, snapshot, newRequestId = requestId) {
  const lotById = new Map((snapshot?.lots ?? []).map((lot) => [lot.id, lot]));
  const targetMemberIds = (snapshot?.lots ?? []).filter((lot) => lot.alternativeGroupId === group.id).map((lot) => lot.id);
  let affectedLotIds = [...new Set([...targetMemberIds, ...orderedLotIds])];
  const affectedGroupIds = new Set([group.id]);
  for (const lotId of affectedLotIds) { const sourceGroup = lotById.get(lotId)?.alternativeGroupId; if (sourceGroup) affectedGroupIds.add(sourceGroup); }
  affectedLotIds = [...new Set([...affectedLotIds, ...(snapshot?.lots ?? []).filter((lot) => affectedGroupIds.has(lot.alternativeGroupId)).map((lot) => lot.id)])];
  const groupById = new Map((snapshot?.alternativeGroups ?? []).map((item) => [item.id, item]));
  return {
    type: 'group.reorder', requestId: newRequestId(), groupId: group.id,
    expectedRevision: group.revision, orderedLotIds: [...orderedLotIds],
    expectedGroupRevisions: Object.fromEntries([...affectedGroupIds].map((id) => [id, groupById.get(id)?.revision]).filter(([, revision]) => Number.isInteger(revision))),
    expectedLotRevisions: Object.fromEntries(affectedLotIds.map((id) => [id, lotById.get(id)?.revision]).filter(([, revision]) => Number.isInteger(revision))),
  };
}

export function createEventDraft(precision = 'timed') {
  if (precision === 'date-only') return {
    precision,
    reminders: [
      { id: 'previous-day', kind: 'wall-time', daysBefore: 1, localTime: '09:00' },
      { id: 'auction-day', kind: 'wall-time', daysBefore: 0, localTime: '09:00' },
    ],
  };
  return {
    precision: 'timed',
    reminders: [
      { id: '24-hours', kind: 'offset', offsetMinutes: 1440 },
      { id: '1-hour', kind: 'offset', offsetMinutes: 60 },
    ],
  };
}

export function buildExposureSections(snapshot) {
  const exposure = projectExposure({ lots: snapshot?.lots ?? [] });
  const eventNames = new Map((snapshot?.auctionEvents ?? []).map((event) => [event.id, event.name]));
  return Object.entries(exposure).map(([currency, totals]) => ({
    currency,
    ...totals,
    events: Object.entries(totals.byEvent).map(([eventId, eventTotals]) => ({
      eventId,
      name: eventId === 'unassigned' ? 'Unassigned lots' : eventNames.get(eventId) ?? 'Unknown auction',
      ...eventTotals,
    })),
  }));
}

export function evidenceRowsForQuery(rows, queryId) {
  if (!queryId) return [];
  return (rows ?? []).filter((row) => row.observations?.some((observation) => observation.queryId === queryId));
}

export function mergeLotSourceLinks(existing, editedManualUrl, originalManualUrl) {
  const retained = [...(existing ?? [])];
  const url = String(editedManualUrl ?? '').trim();
  const index = retained.findIndex((link) => link.source === 'manual' && (originalManualUrl === undefined || link.url === originalManualUrl));
  if (index >= 0 && url) retained[index] = { ...retained[index], url };
  else if (index >= 0) retained.splice(index, 1);
  else if (url) retained.push({ source: 'manual', url });
  return retained;
}

export function commandWasCommitted(snapshot, commandRequestId) {
  return (snapshot?.recentCommands ?? []).some((item) => item.requestId === commandRequestId);
}

export function moneyInputText(money, locale = 'en-US') {
  if (!money) return '';
  const absolute = BigInt(Math.abs(money.minor));
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  return `${money.minor < 0 ? '-' : ''}${absolute / 100n}${decimal}${String(absolute % 100n).padStart(2, '0')}`;
}

export function outcomeDraftForLot(lot, locale = 'en-US') {
  return {
    status: lot?.outcome?.status ?? 'won',
    hammer: moneyInputText(lot?.outcome?.hammer, locale),
    hammerCurrency: lot?.outcome?.hammer?.currency ?? 'USD',
    invoice: moneyInputText(lot?.outcome?.actualInvoice, locale),
    invoiceCurrency: lot?.outcome?.actualInvoice?.currency ?? 'USD',
    bindingActive: '',
  };
}

export function mergeEventReminders(existing, precision, controls) {
  const kind = precision === 'date-only' ? 'wall-time' : 'offset';
  const sameKind = (existing ?? []).filter((item) => item.kind === kind);
  if (kind === 'offset') {
    const first = sameKind[0]; const second = sameKind[1];
    return [
      ...(controls.firstEnabled ? [{ ...(first?.id ? { id: first.id } : { id: 'hours-before' }), kind, offsetMinutes: controls.firstValue }] : []),
      ...(controls.secondEnabled ? [{ ...(second?.id ? { id: second.id } : { id: 'minutes-before' }), kind, offsetMinutes: controls.secondValue }] : []),
      ...sameKind.slice(2),
    ];
  }
  const previous = sameKind.find((item) => item.daysBefore === 1);
  const sameDay = sameKind.find((item) => item.daysBefore === 0);
  const represented = new Set([previous, sameDay].filter(Boolean));
  return [
    ...(controls.firstEnabled ? [{ ...(previous?.id ? { id: previous.id } : { id: 'previous-day' }), kind, daysBefore: 1, localTime: controls.firstValue }] : []),
    ...(controls.secondEnabled ? [{ ...(sameDay?.id ? { id: sameDay.id } : { id: 'auction-day' }), kind, daysBefore: 0, localTime: controls.secondValue }] : []),
    ...sameKind.filter((item) => !represented.has(item)),
  ];
}

export function reminderControlsForPrecision(reminders, precision) {
  if (precision === 'date-only') {
    const previous = (reminders ?? []).find((item) => item.kind === 'wall-time' && item.daysBefore === 1);
    const sameDay = (reminders ?? []).find((item) => item.kind === 'wall-time' && item.daysBefore === 0);
    return { firstEnabled: Boolean(previous), firstValue: previous?.localTime ?? '09:00', secondEnabled: Boolean(sameDay), secondValue: sameDay?.localTime ?? '09:00' };
  }
  const [first, second] = (reminders ?? []).filter((item) => item.kind === 'offset');
  return { firstEnabled: Boolean(first), firstValue: first?.offsetMinutes ?? 1440, secondEnabled: Boolean(second), secondValue: second?.offsetMinutes ?? 60 };
}

export function buildBackupImportCommand(pendingImport, newRequestId = requestId) {
  return { type: 'backup.import', requestId: newRequestId(), expectedRevision: pendingImport.expectedRevision, mode: pendingImport.mode, document: pendingImport.document };
}

async function initWorkspace() {
  const $ = (id) => document.getElementById(id);
  let bridge = null;
  let initializeCompanionPreferences = null;
  let snapshot = { revision: 0, lots: [], auctionEvents: [], alternativeGroups: [], evidence: [], collectionEntries: [], alerts: [], recentCommands: [] };
  const dirtyEditors = new Set();
  const editorBases = new Map();
  const editorVersions = new Map();
  const beginEditor = (editor, basis) => {
    editorBases.set(editor, basis);
    editorVersions.set(editor, (editorVersions.get(editor) ?? 0) + 1);
  };
  let pendingSnapshot = null;
  let pendingRetry = null;
  let selection = { selectedLotId: null, mode: 'list' };
  let comparisonSelection = [];
  let lotInteractionGeneration = 0;
  let lastLotUndo = null;
  let bidCalculator = null;
  let calculatorCostEstimate = null;
  let eventReturnLot = null;
  let activeDetailTab = 'details';
  let eventDraftId = null;
  let researchDraftId = null;
  let lotDraftId = null;
  let activeQuery = { id: requestId(), text: '' };
  let selectedQueryId = activeQuery.id;
  let lastEventPrecision = 'timed';
  try {
    bridge = await import('./browser-api.js');
    ({ initializeCompanionPreferences } = await import('./companion-preferences.js'));
  } catch { /* standalone */ }
  if (typeof (globalThis.browser ?? globalThis.chrome)?.runtime?.sendMessage !== 'function') bridge = null;
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
  const provenanceValues = () => [...$('provenance-editor').querySelectorAll('.provenance-row')].map((row) => ({
    id: row.dataset.id || requestId(),
    text: row.querySelector('[name="provenanceText"]').value.trim(),
    sourceUrl: row.querySelector('[name="provenanceSourceUrl"]').value.trim(),
    recordedAt: row.dataset.recordedAt || new Date().toISOString(),
    ...(row.querySelector('[name="provenanceAuctionDate"]').value ? { auctionDate: row.querySelector('[name="provenanceAuctionDate"]').value } : {}),
  })).filter((item) => item.text || item.sourceUrl);
  const appendProvenanceEditor = (entry = {}) => {
    const row = document.createElement('div'); row.className = 'provenance-row'; row.dataset.id = entry.id ?? requestId(); row.dataset.recordedAt = entry.recordedAt ?? new Date().toISOString();
    row.innerHTML = '<label>Note<textarea name="provenanceText" maxlength="1000" required></textarea></label><label>Source URL<input name="provenanceSourceUrl" type="url" maxlength="2048" required></label><label>Auction date <span class="optional">optional</span><input name="provenanceAuctionDate" type="date"></label><div class="form-actions"><button class="quiet" type="button">Remove entry</button></div>';
    row.querySelector('[name="provenanceText"]').value = entry.text ?? ''; row.querySelector('[name="provenanceSourceUrl"]').value = entry.sourceUrl ?? ''; row.querySelector('[name="provenanceAuctionDate"]').value = entry.auctionDate ?? '';
    row.querySelector('button').addEventListener('click', () => { row.remove(); $('lot-form').dispatchEvent(new Event('input', { bubbles: true })); });
    $('provenance-editor').append(row);
  };
  mountSourcesMenu($('source-menu'));
  $('evidence-to').value = `${new Date().getFullYear()}-12-31`;
  $('open-settings').addEventListener('click', () => void openSettings());
  const detailPanels = {
    details: $('lot-form'), bid: $('bid-form').closest('.detail-section'),
    reminders: $('selected-reminders').closest('.detail-section'), outcome: $('outcome-form').closest('.detail-section'),
  };
  const detailTabs = document.createElement('div'); detailTabs.className = 'detail-tabs'; detailTabs.setAttribute('role', 'tablist'); detailTabs.setAttribute('aria-label', 'Coin record sections');
  const tabButtons = new Map();
  const showDetailTab = (name, focus = false) => {
    if (!DETAIL_TABS.includes(name) || tabButtons.get(name)?.disabled) return;
    activeDetailTab = name;
    for (const tab of DETAIL_TABS) { const selected = tab === name; tabButtons.get(tab).setAttribute('aria-selected', String(selected)); tabButtons.get(tab).tabIndex = selected ? 0 : -1; detailPanels[tab].hidden = !selected; }
    if (focus) tabButtons.get(name).focus();
  };
  for (const name of DETAIL_TABS) { const button = text('button', ({ details: 'Details', bid: 'Bid', reminders: 'Reminders', outcome: 'Outcome' })[name], 'quiet'); button.type = 'button'; button.setAttribute('role', 'tab'); button.id = `detail-tab-${name}`; detailPanels[name].id ||= `detail-panel-${name}`; button.setAttribute('aria-controls', detailPanels[name].id); detailPanels[name].setAttribute('role', 'tabpanel'); detailPanels[name].setAttribute('aria-labelledby', button.id); button.addEventListener('click', () => showDetailTab(name)); button.addEventListener('keydown', (event) => { const next = moveDetailTab(name, event.key); if (next !== name) { event.preventDefault(); showDetailTab(next, true); } }); tabButtons.set(name, button); detailTabs.append(button); }
  $('coin-editor').querySelector('.detail-heading').after(detailTabs); showDetailTab('details');

  const announce = (message, error = false) => {
    $('workspace-status').textContent = message;
    $('workspace-status').classList.toggle('error', error);
    $('announcement').textContent = '';
    requestAnimationFrame(() => { $('announcement').textContent = message; });
  };
  const setRoute = () => {
    const active = routeFromHash(location.hash);
    applyActiveRoute(ROUTES, active, (route) => $(`route-${route}`), (route) => document.querySelector(`[data-route="${route}"]`));
    document.querySelector(`[data-route="${active}"]`)?.focus({ preventScroll: true });
  };
  addEventListener('hashchange', setRoute);

  const acceptIncoming = (incoming, force = false) => {
    if (!force && dirtyEditors.size) {
      pendingSnapshot = incoming;
      $('conflict-note').hidden = false;
      return false;
    }
    snapshot = incoming;
    pendingSnapshot = null;
    $('conflict-note').hidden = true;
    renderAll();
    return true;
  };
  const refresh = async (force = false) => {
    if (!bridge) return;
    const reply = await bridge.getSnapshot();
    if (!reply.ok) return announce(reply.message, true);
    if (acceptIncoming(reply.value, force)) announce('Local records loaded.');
    return reply.value;
  };
  const send = async (command, editor) => {
    if (!bridge) return announce('Extension storage is unavailable in this page.', true);
    const submittedVersion = editor ? editorVersions.get(editor) ?? 0 : null;
    const submittedBasis = editor ? editorBases.get(editor) : null;
    const completeEditor = (value) => {
      if (!editor) return false;
      if (editorCompletion(submittedVersion, editorVersions.get(editor) ?? 0) === 'reset') {
        dirtyEditors.delete(editor); editorBases.delete(editor); resetEditor(editor);
        return false;
      }
      const currentBasis = editorBases.get(editor);
      if (sameEditorIdentity(submittedBasis, currentBasis) && value && typeof value === 'object' && typeof value.id === 'string' && Number.isInteger(value.revision)) {
        const originalManualUrl = editor === 'lot' ? value.sourceLinks?.find((link) => link.source === 'manual')?.url : currentBasis?.originalManualUrl;
        editorBases.set(editor, { ...currentBasis, id: value.id, revision: value.revision, record: structuredClone(value), ...(editor === 'lot' ? { originalManualUrl } : {}) });
      }
      dirtyEditors.add(editor);
      $('conflict-note').hidden = false;
      return true;
    };
    announce('Saving…');
    const reply = await bridge.sendCommand(command);
    if (!reply.ok) {
      if (editor === 'lot') {
        const status = $('lot-action-status'); status.replaceChildren(document.createTextNode(reply.message ?? 'The coin could not be saved.')); status.classList.add('error');
        const existingLotId = reply.existingLotId ?? reply.error?.existingLotId;
        if (reply.code === 'duplicate' && existingLotId) {
          const open = text('button', 'Open existing coin', 'quiet'); open.type = 'button'; open.addEventListener('click', () => selectLot(existingLotId)); status.append(document.createTextNode(' '), open);
        }
      }
      if (reply.code === 'conflict') $('conflict-note').hidden = false;
      if (reply.outcome === 'unknown') {
        const committed = await refresh();
        if (commandWasCommitted(committed, command.requestId)) {
          const ledgerValue = committed?.recentCommands?.find((item) => item.requestId === command.requestId)?.reply?.value;
          const preserved = completeEditor(ledgerValue);
          if (committed) acceptIncoming(committed);
          pendingRetry = null; $('unknown-note').hidden = true;
          announce(preserved ? 'The save was committed. Newer edits remain in the form for review.' : 'The save was committed and has been verified from the request ledger.');
          return { ok: true, requestId: command.requestId, value: ledgerValue ?? null, editorPreserved: preserved };
        }
        pendingRetry = { command, editor };
        $('unknown-note').hidden = false;
        announce('Save outcome is uncertain. Review committed records before retrying the same request.', true);
        return reply;
      }
      announce(reply.message, true);
      return reply;
    }
    const preserved = completeEditor(reply.value);
    await refresh();
    if (editor === 'lot') $('lot-action-status').classList.remove('error');
    announce(preserved ? 'Saved. Newer edits remain in the form for review.' : 'Saved.');
    return { ...reply, editorPreserved: preserved };
  };

  document.querySelectorAll('[data-editor]').forEach((form) => form.addEventListener('input', () => {
    const editor = form.dataset.editor;
    if (editor === 'lot') lotInteractionGeneration += 1;
    dirtyEditors.add(editor);
    editorVersions.set(editor, (editorVersions.get(editor) ?? 0) + 1);
  }));
  $('reload-snapshot').addEventListener('click', () => {
    lotInteractionGeneration += 1;
    dirtyEditors.clear(); editorBases.clear(); editorVersions.clear(); resetEditors();
    if (pendingSnapshot) { snapshot = pendingSnapshot; pendingSnapshot = null; renderAll(); }
    else void refresh(true);
    $('conflict-note').hidden = true;
  });
  $('retry-uncertain').addEventListener('click', () => {
    if (!pendingRetry) return;
    const retry = pendingRetry; pendingRetry = null; $('unknown-note').hidden = true;
    void send(retry.command, retry.editor);
  });

  const openSource = async (source) => {
    ensureActiveQuery();
    const built = buildUserInitiatedSearch(source, $('research-query').value);
    if (!built.ok) return announce(built.error.message, true);
    const tabs = globalThis.browser?.tabs ?? globalThis.chrome?.tabs;
    if (tabs?.create) await tabs.create({ url: built.value.url });
    else globalThis.open(built.value.url, '_blank', 'noopener,noreferrer');
    if (researchDraftId) { const draftId = researchDraftId; researchDraftId = null; void send({ type: 'draft.consume', requestId: requestId(), draftId }); }
    announce(`${source === 'coinarchives' ? 'CoinArchives' : 'acsearch'} search opened. Only the edited query was sent.`);
  };
  $('launch-ca').addEventListener('click', () => void openSource('coinarchives'));
  $('launch-ac').addEventListener('click', () => void openSource('acsearch'));
  $('research-form').addEventListener('submit', (event) => { event.preventDefault(); announce('Choose CoinArchives or acsearch to open this edited query.'); });

  function ensureActiveQuery() {
    const queryText = $('research-query').value.trim();
    if (queryText !== activeQuery.text) activeQuery = { id: requestId(), text: queryText };
    selectedQueryId = activeQuery.id;
    return activeQuery.id;
  }

  const selectedSources = () => [...document.querySelectorAll('[name="evidence-source"]:checked')].map((item) => item.value);
  function renderEvidence() {
    const queryIds = [...new Set((snapshot.evidence ?? []).flatMap((row) => (row.observations ?? []).map((item) => item.queryId)).filter(Boolean))];
    const queryLabels = new Map();
    for (const observation of (snapshot.evidence ?? []).flatMap((row) => row.observations ?? [])) if (observation.queryLabel) queryLabels.set(observation.queryId, observation.queryLabel);
    if (!queryIds.includes(activeQuery.id)) queryIds.unshift(activeQuery.id);
    const querySelect = $('evidence-query');
    querySelect.replaceChildren(...queryIds.map((id) => {
      const option = text('option', id === activeQuery.id ? `Current query · ${activeQuery.text || 'untitled'}` : queryLabels.has(id) ? `${queryLabels.get(id)} · ${id.slice(0, 8)}` : `Saved set · ${id}`);
      option.value = id; return option;
    }));
    if (!queryIds.includes(selectedQueryId)) selectedQueryId = activeQuery.id;
    querySelect.value = selectedQueryId;
    const evidenceRows = evidenceRowsForQuery(snapshot.evidence ?? [], selectedQueryId);
    const filters = { currency: $('evidence-currency').value, fromDate: $('evidence-from').value, toDate: $('evidence-to').value, sources: selectedSources(), mode: 'live' };
    const stats = computeStatistics(evidenceRows, filters);
    const output = $('statistics-output');
    output.replaceChildren();
    if (stats.validationError) output.append(text('p', stats.validationError.message));
    else {
      output.append(text('strong', `${stats.count} included`));
      output.append(text('span', stats.median ? `Median ${formatMoney(stats.median)}` : 'No headline median'));
      output.append(text('span', stats.lowerQuartile ? `Middle 50% ${formatMoney(stats.lowerQuartile)}–${formatMoney(stats.upperQuartile)}` : 'Middle 50% unavailable'));
      output.append(text('span', stats.presentation.label));
      output.append(text('span', `Hammer · ${filters.fromDate} to ${filters.toDate}`));
      const available = stats.coverage.availableSources.length ? stats.coverage.availableSources.join(', ') : 'none';
      const unavailable = stats.coverage.unavailableSources.length ? ` · unavailable: ${stats.coverage.unavailableSources.join(', ')}` : '';
      const exclusions = Object.entries(stats.coverage.exclusionCounts).map(([reason, count]) => `${reason} ${count}`).join(', ');
      output.append(text('span', `Coverage: ${available}${unavailable}${exclusions ? ` · excluded: ${exclusions}` : ''}`));
    }
    const list = $('evidence-list'); list.replaceChildren();
    const effectiveExclusions = new Map(stats.excluded.map((item) => [item.id, item.reason]));
    for (const row of evidenceRows) {
      const card = text('article', '', 'record');
      card.append(text('h4', row.saleIdentity ? `${row.saleIdentity.auctionHouse}, ${row.saleIdentity.houseSaleId}, lot ${row.saleIdentity.lotNumber}` : `Observation ${row.id}`));
      card.append(text('p', `${row.inclusion}${row.exclusionReason ? `: ${row.exclusionReason}` : ''}${row.conflictFields?.length ? ` · conflicts: ${row.conflictFields.join(', ')}` : ''}`));
      for (const observation of row.observations ?? []) {
        const amount = observation.amount ? formatMoney(observation.amount) : 'No amount';
        card.append(text('p', `${observation.source} · ${observation.auctionDate} · ${observation.priceBasis} · ${amount}${observation.retrievedAt ? ` · retrieved ${observation.retrievedAt}` : ''}`));
        card.append(text('p', `Query ${observation.queryLabel ?? observation.queryId}`));
        if (observation.sourceUrl) {
          const link = text('a', 'Open source claim'); link.href = observation.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
        }
      }
      card.append(text('p', effectiveExclusions.has(row.id) ? `Effective result: excluded (${effectiveExclusions.get(row.id)})` : 'Effective result: included'));
      const actions = text('div', '', 'actions');
      const toggle = text('button', row.inclusion === 'included' ? 'Exclude' : 'Include'); toggle.type = 'button';
      toggle.addEventListener('click', () => void send({ type: 'evidence.include', requestId: requestId(), evidenceId: row.id, expectedRevision: row.revision, inclusion: row.inclusion === 'included' ? 'excluded' : 'included', ...(row.inclusion === 'included' ? { exclusionReason: 'collector-excluded' } : {}) }));
      actions.append(toggle);
      for (const observation of (row.observations ?? []).filter((item) => item.priceBasis === 'hammer' && item.amount)) {
        const choose = text('button', `Use ${observation.source} claim`); choose.type = 'button';
        choose.addEventListener('click', () => void send({ type: 'evidence.resolve', requestId: requestId(), evidenceId: row.id, expectedRevision: row.revision, resolution: { kind: 'observation', observationId: observation.id } }));
        actions.append(choose);
      }
      if (row.conflictFields?.length) {
        const currency = row.observations?.find((item) => item.amount)?.amount?.currency ?? filters.currency;
        const entered = document.createElement('input'); entered.inputMode = 'decimal'; entered.placeholder = `Entered hammer (${currency})`; entered.setAttribute('aria-label', `Entered hammer for ${row.id}`);
        const chooseEntered = text('button', 'Use entered hammer'); chooseEntered.type = 'button';
        chooseEntered.addEventListener('click', () => { const parsed = parseMoney(entered.value, currency, navigator.language); if (!parsed.ok) return announce(parsed.error.message, true); void send({ type: 'evidence.resolve', requestId: requestId(), evidenceId: row.id, expectedRevision: row.revision, resolution: { kind: 'entered', hammer: parsed.value } }); });
        actions.append(entered, chooseEntered);
      }
      card.append(actions); list.append(card);
    }
  }
  $('evidence-filters').addEventListener('input', (event) => {
    if (event.target === $('evidence-query')) {
      selectedQueryId = event.target.value;
      const selectedObservation = (snapshot.evidence ?? []).flatMap((row) => row.observations ?? []).find((item) => item.queryId === selectedQueryId);
      activeQuery = { id: selectedQueryId, text: selectedObservation?.queryLabel ?? $('research-query').value.trim() };
      if (selectedObservation?.queryLabel) $('research-query').value = selectedObservation.queryLabel;
    }
    renderEvidence();
  });
  $('evidence-form').addEventListener('submit', (event) => {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const basis = form.get('priceBasis');
    let amount;
    if (!['unsold', 'missing'].includes(basis)) {
      const parsed = parseMoney(String(form.get('amount')), String(form.get('currency')), navigator.language);
      if (!parsed.ok) return announce(parsed.error.message, true); amount = parsed.value;
    }
    const queryLabel = $('research-query').value.trim();
    const observation = { queryId: ensureActiveQuery(), ...(queryLabel ? { queryLabel } : {}), source: 'manual', auctionHouse: String(form.get('auctionHouse')).trim(), auctionDate: String(form.get('auctionDate')), lotNumber: String(form.get('lotNumber')).trim(), priceBasis: basis, ...(amount ? { amount } : {}) };
    for (const key of ['houseSaleId', 'auctionName', 'sourceUrl']) { const value = String(form.get(key) ?? '').trim(); if (value) observation[key] = value; }
    void send({ type: 'evidence.add', requestId: requestId(), observation }, 'evidence').then((reply) => { if (reply?.ok && researchDraftId) { const draftId = researchDraftId; researchDraftId = null; void send({ type: 'draft.consume', requestId: requestId(), draftId }); } });
  });

  function fillSelect(select, items, emptyLabel) {
    const current = select.value; select.replaceChildren();
    if (emptyLabel !== undefined) { const option = text('option', emptyLabel); option.value = ''; select.append(option); }
    for (const item of items) { const option = text('option', item.name ?? item.title); option.value = item.id; select.append(option); }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }
  function renderLots() {
    const list = $('lot-list'); list.replaceChildren();
    const knownLotIds = new Set((snapshot.lots ?? []).map((lot) => lot.id)); comparisonSelection = comparisonSelection.filter((id) => knownLotIds.has(id));
    fillSelect($('lot-form').elements.auctionEventId, snapshot.auctionEvents ?? [], 'No auction attached');
    const queuedLots = auctionQueueForLots(snapshot.lots ?? [], snapshot.auctionEvents ?? [], $('lot-queue').value).map(({ lot }) => lot);
    const visibleLots = filterWorkspaceLots(queuedLots, $('lot-filter').value);
    $('lot-count').textContent = `${visibleLots.length} of ${(snapshot.lots ?? []).length} coins`;
    if (!visibleLots.length) list.append(text('p', (snapshot.lots ?? []).length ? 'No coins match this filter.' : 'No coins yet. Add the first coin to begin.', 'empty-row'));
    for (const lot of visibleLots) {
      const row = text('button', '', 'coin-row'); row.type = 'button'; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(selection.selectedLotId === lot.id));
      const main = text('span', '', 'coin-row-main'); main.append(text('strong', lot.reference || lot.title), text('span', lot.reference ? lot.title : (lot.lotNumber ? `Lot ${lot.lotNumber}` : 'Uncatalogued coin')));
      const event = (snapshot.auctionEvents ?? []).find((item) => item.id === lot.auctionEventId);
      const meta = text('span', '', 'coin-row-meta'); meta.append(text('span', event ? `${event.name} · ${auctionTimeLabel(event)}` : 'Time unknown'), text('span', lotStatusLabel(lot), 'row-status'));
      const amounts = text('span', '', 'coin-row-bids');
      if (lot.plannedBid) amounts.append(text('span', `Plan ${formatMoney(lot.plannedBid.amount)}`));
      if (lot.activeBid) amounts.append(text('span', `Placed ${formatMoney(lot.activeBid.amount)}`));
      row.append(main, meta, amounts);
      row.addEventListener('click', () => selectLot(lot.id));
      list.append(row);
    }
    const picker = $('comparison-picker'); picker.replaceChildren();
    const comparisonChoices = filterWorkspaceLots(snapshot.lots ?? [], $('lot-filter').value);
    for (const lot of comparisonChoices) {
      const label = document.createElement('label'); label.className = 'compare-choice';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = comparisonSelection.includes(lot.id); checkbox.disabled = !checkbox.checked && comparisonSelection.length >= 4;
      checkbox.addEventListener('change', () => { comparisonSelection = comparisonSelectionAfterToggle(comparisonSelection, lot.id); renderLots(); });
      label.append(checkbox, document.createTextNode(comparisonPickerLabel(lot))); picker.append(label);
    }
    $('comparison-count').textContent = `${comparisonSelection.length} selected · choose 2–4 coins`;
    $('open-comparison').disabled = comparisonSelection.length < 2 || comparisonSelection.length > 4;
    const groups = $('group-list'); groups.replaceChildren();
    for (const group of snapshot.alternativeGroups ?? []) {
      const members = (snapshot.lots ?? []).filter((lot) => lot.alternativeGroupId === group.id).sort((a, b) => a.priority - b.priority);
      const card = text('article', '', 'record'); card.append(text('h4', group.name));
      if (!members.length) card.append(text('p', 'No lots assigned'));
      for (const [index, lot] of members.entries()) {
        const line = text('div', '', 'actions'); line.append(text('span', `${index + 1}. ${lot.title}`));
        const reorder = (label, nextIndex) => { const button = text('button', label); button.type = 'button'; button.disabled = nextIndex < 0 || nextIndex >= members.length; button.addEventListener('click', () => { const ids = members.map((item) => item.id); [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]]; void send(buildGroupReorderCommand(group, ids, snapshot)); }); return button; };
        line.append(reorder('Move up', index - 1), reorder('Move down', index + 1));
        const removeMember = text('button', 'Remove from group'); removeMember.type = 'button'; removeMember.addEventListener('click', () => void send(buildGroupReorderCommand(group, members.filter((item) => item.id !== lot.id).map((item) => item.id), snapshot))); line.append(removeMember);
        card.append(line);
      }
      const actions = text('div', '', 'actions');
      const editGroup = text('button', 'Edit group name'); editGroup.type = 'button'; editGroup.addEventListener('click', () => { const form = $('group-form'); form.hidden = false; beginEditor('group', { id: group.id, revision: group.revision, record: structuredClone(group) }); form.elements.id.value = group.id; form.elements.name.value = group.name; form.elements.name.focus(); });
      const add = text('button', 'Add selected coin'); add.type = 'button'; add.dataset.addSelected = ''; add.disabled = !selection.selectedLotId;
      add.addEventListener('click', () => { const ids = [...members.map((lot) => lot.id), selection.selectedLotId].filter((id, index, all) => id && all.indexOf(id) === index); void send(buildGroupReorderCommand(group, ids, snapshot)); });
      const remove = text('button', 'Remove group'); remove.type = 'button'; remove.addEventListener('click', () => { if (confirm(`Delete group “${group.name}”? Its lots will remain.`)) void send({ type: 'group.delete', requestId: requestId(), groupId: group.id, expectedRevision: group.revision }); });
      actions.append(editGroup, add, remove); card.append(actions); groups.append(card);
    }
    renderSelectedLot();
  }
  const canLeaveSelectedEditors = () => !['lot', 'bid', 'outcome'].some((editor) => dirtyEditors.has(editor)) || confirm('Discard unsaved changes and open another coin?');
  function selectLot(lotId, { focus = true } = {}) {
    if (lotId === selection.selectedLotId) { selection = { ...selection, mode: 'detail' }; $('coin-workspace').dataset.mobileView = 'detail'; renderLots(); if (focus) $('selected-title').focus?.(); return; }
    if (lotId !== selection.selectedLotId && !canLeaveSelectedEditors()) return;
    if (lotId !== selection.selectedLotId) lotInteractionGeneration += 1;
    for (const editor of ['lot', 'bid', 'outcome']) { dirtyEditors.delete(editor); editorBases.delete(editor); }
    selection = chooseSelectedLot(selection, lotId, snapshot.lots ?? []);
    for (const tab of DETAIL_TABS) tabButtons.get(tab).disabled = false;
    showDetailTab('details');
    if (lastLotUndo?.saved?.id !== selection.selectedLotId) $('undo-lot').hidden = true;
    $('coin-workspace').dataset.mobileView = selection.mode;
    renderLots();
    if (focus) $('selected-title').focus?.();
  }
  function renderSelectedLot() {
    const lot = (snapshot.lots ?? []).find((item) => item.id === selection.selectedLotId);
    $('coin-empty').hidden = Boolean(lot) || selection.mode === 'detail'; $('coin-editor').hidden = !lot && selection.mode !== 'detail';
    if (!lot) return;
    for (const tab of DETAIL_TABS) tabButtons.get(tab).disabled = false;
    $('bid-form').disabled = false; $('outcome-form').disabled = false;
    const f = $('lot-form').elements; const originalManualUrl = lot.sourceLinks?.find((link) => link.source === 'manual')?.url;
    if (!dirtyEditors.has('lot')) {
      beginEditor('lot', { id: lot.id, revision: lot.revision, record: structuredClone(lot), originalManualUrl }); f.id.value = lot.id; f.title.value = lot.title; f.reference.value = lot.reference ?? ''; f.lotNumber.value = lot.lotNumber ?? ''; f.notes.value = lot.notes ?? ''; f.auctionEventId.value = lot.auctionEventId ?? ''; f.sourceUrl.value = originalManualUrl ?? '';
      const context = lot.auctionContext ?? {}; f.auctionPageUrl.value = context.pageUrl ?? ''; f.auctionCanonicalUrl.value = context.canonicalUrl ?? ''; f.auctionHouse.value = context.house ?? ''; f.auctionSaleId.value = context.saleId ?? ''; f.auctionLotNumber.value = context.lotNumber ?? '';
      const details = lot.coinDetails ?? {}; f.weightGrams.value = details.weightMg ? String(details.weightMg / 1000) : ''; f.diameterMm.value = details.diameterHundredthsMm ? String(details.diameterHundredthsMm / 100) : ''; f.condition.value = details.condition ?? ''; f.photoUrl1.value = details.photoUrls?.[0] ?? ''; f.photoUrl2.value = details.photoUrls?.[1] ?? '';
      $('provenance-editor').replaceChildren(); for (const entry of lot.provenanceNotes ?? []) appendProvenanceEditor(entry);
    }
    $('selected-reference').textContent = lot.reference || 'Uncatalogued'; $('selected-title').textContent = lot.title; $('selected-title').tabIndex = -1; $('selected-status').textContent = lotStatusLabel(lot);
    if (lot.auctionContext?.pageUrl) $('open-auction').href = lot.auctionContext.pageUrl; else $('open-auction').removeAttribute('href');
    $('research-reference').disabled = !String(lot.reference ?? '').trim();
    $('delete-lot').hidden = false;
    $('undo-lot').hidden = lastLotUndo?.saved?.id !== lot.id;
    $('bid-form').elements.lotId.value = lot.id; $('outcome-form').elements.lotId.value = lot.id;
    if (!dirtyEditors.has('bid')) loadBidEditor(lot); if (!dirtyEditors.has('outcome')) loadOutcomeEditor(lot);
    const event = (snapshot.auctionEvents ?? []).find((item) => item.id === lot.auctionEventId); const attached = $('attached-event'); attached.replaceChildren();
    attached.append(text('p', event ? `${event.name} · ${event.localDate}${event.localTime ? ` at ${event.localTime}` : ''}` : 'No auction is attached.'));
    $('edit-selected-event').textContent = event ? 'Edit auction' : 'Add auction'; $('edit-selected-event').dataset.eventId = event?.id ?? '';
    const reminders = $('selected-reminders'); reminders.replaceChildren();
    if (!event) reminders.append(text('p', 'Attach an auction to set reminders.', 'field-note'));
    else for (const reminder of event.reminders ?? []) reminders.append(text('p', reminder.kind === 'offset' ? `${reminder.offsetMinutes} minutes before` : `${reminder.daysBefore ? 'Previous day' : 'Auction day'} at ${reminder.localTime}`, 'reminder-row'));
  }
  $('lot-filter').addEventListener('input', renderLots);
  $('lot-queue').addEventListener('change', renderLots);
  $('open-comparison').addEventListener('click', () => {
    const grid = $('comparison-grid'); grid.replaceChildren();
    for (const lot of comparisonRows(snapshot.lots ?? [], comparisonSelection)) {
      const card = text('article', '', 'comparison-card'); card.append(text('h4', lot.title, 'comparison-title'));
      if (lot.reference) card.append(text('p', lot.reference, 'comparison-reference'));
      card.append(text('p', lot.amountLabel, 'comparison-amount'));
      if (lot.actualTotalLabel) card.append(text('p', lot.actualTotalLabel, 'comparison-total'));
      if (lot.estimateLabel) card.append(text('p', lot.estimateLabel, 'comparison-fees'));
      if (lot.totalLabel) card.append(text('p', lot.totalLabel, 'comparison-total'));
      const details = lot.coinDetails ?? {};
      card.append(text('p', [details.weightMg ? `${(details.weightMg / 1000).toFixed(3)} g` : '', details.diameterHundredthsMm ? `${(details.diameterHundredthsMm / 100).toFixed(2)} mm` : '', details.condition ?? ''].filter(Boolean).join(' · ') || 'No physical details'));
      for (const photoUrl of details.photoUrls ?? []) {
        const host = (() => { try { return new URL(photoUrl).host; } catch { return 'external host'; } })();
        card.append(text('p', `External image: ${host}`, 'field-note'));
        const image = document.createElement('img'); image.alt = `${lot.title} collector-linked photo`; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.src = photoUrl;
        image.addEventListener('error', () => { const fallback = text('div', 'Photo unavailable', 'photo-fallback'); image.replaceWith(fallback); }); card.append(image);
      }
      const provenance = comparisonProvenanceRows(lot.provenanceNotes);
      if (provenance.length) {
        const section = text('section', '', 'comparison-provenance'); section.append(text('h5', 'Sourced provenance'));
        for (const entry of provenance) { const item = text('div', '', 'comparison-provenance-item'); item.append(text('p', entry.text), text('p', entry.dateLabel, 'comparison-provenance-date')); const source = text('a', 'Open provenance source'); source.href = entry.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; item.append(source); section.append(item); }
        card.append(section);
      }
      grid.append(card);
    }
    $('comparison-dialog').showModal();
  });
  $('back-to-coins').addEventListener('click', () => { selection = { ...selection, mode: 'list' }; $('coin-workspace').dataset.mobileView = 'list'; $('lot-list').querySelector('[aria-selected="true"]')?.focus(); });
  $('new-lot').addEventListener('click', () => { if (!canLeaveSelectedEditors()) return; lotInteractionGeneration += 1; for (const editor of ['bid', 'outcome']) { dirtyEditors.delete(editor); editorBases.delete(editor); resetEditor(editor); } selection = { selectedLotId: null, mode: 'detail' }; lastLotUndo = null; $('undo-lot').hidden = true; $('delete-lot').hidden = true; $('lot-action-status').textContent = ''; $('lot-action-status').classList.remove('error'); $('coin-workspace').dataset.mobileView = 'detail'; $('coin-empty').hidden = true; $('coin-editor').hidden = false; $('lot-form').reset(); $('provenance-editor').replaceChildren(); $('open-auction').removeAttribute('href'); $('research-reference').disabled = true; $('lot-form').elements.id.value = ''; beginEditor('lot', { id: null, revision: null, record: null }); $('bid-form').disabled = true; $('outcome-form').disabled = true; for (const tab of DETAIL_TABS.slice(1)) tabButtons.get(tab).disabled = true; showDetailTab('details'); $('selected-reference').textContent = 'New watchlist coin'; $('selected-title').textContent = 'Add coin'; $('selected-status').textContent = 'Draft'; $('lot-form').elements.title.focus(); });
  $('add-provenance').addEventListener('click', () => { appendProvenanceEditor(); $('lot-form').dispatchEvent(new Event('input', { bubbles: true })); });
  $('research-reference').addEventListener('click', () => { const reference = $('lot-form').elements.reference.value.trim(); if (reference) window.open(`popup.html?panel=1&reference=${encodeURIComponent(reference)}`, '_blank', 'noopener'); });
  $('new-group').addEventListener('click', () => { $('group-form').hidden = false; $('group-form').reset(); beginEditor('group', { id: null, revision: null, record: null }); $('group-form').elements.name.focus(); });
  $('lot-form').addEventListener('submit', (event) => {
    event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('lot') ?? { id: null, revision: null, record: null };
    let lot;
    try { lot = buildWorkspaceLotDraft(basis.record, { title: f.title.value, reference: f.reference.value, lotNumber: f.lotNumber.value, notes: f.notes.value, auctionEventId: f.auctionEventId.value, sourceUrl: f.sourceUrl.value, auctionPageUrl: f.auctionPageUrl.value, auctionCanonicalUrl: f.auctionCanonicalUrl.value, auctionHouse: f.auctionHouse.value, auctionSaleId: f.auctionSaleId.value, auctionLotNumber: f.auctionLotNumber.value, weightGrams: f.weightGrams.value, diameterMm: f.diameterMm.value, condition: f.condition.value, photoUrl1: f.photoUrl1.value, photoUrl2: f.photoUrl2.value, provenanceNotes: provenanceValues() }, basis.originalManualUrl); }
    catch (error) { return announce(error.message, true); }
    const previous = basis.id ? structuredClone(basis.record) : null;
    const submittedSelection = { ...selection }; const submittedInteractionGeneration = lotInteractionGeneration;
    void send(buildLotSaveCommand(lot, basis.revision), 'lot').then((reply) => {
      if (reply?.ok && reply.value?.id) {
        const interactionChanged = submittedInteractionGeneration !== lotInteractionGeneration;
        const followup = lotSaveFollowup(selection, submittedSelection, reply.value, reply.editorPreserved, Boolean(previous), interactionChanged); selection = followup.selection;
        if (!reply.editorPreserved && !interactionChanged && selection.selectedLotId === reply.value.id) {
          lastLotUndo = followup.offerUndo ? { previous, saved: structuredClone(reply.value) } : null;
          $('undo-lot').hidden = !lastLotUndo;
          $('lot-action-status').textContent = previous ? 'Details saved. You can undo this edit until the coin changes again.' : 'Coin added to the watchlist.'; renderLots();
        }
      }
      const draftId = draftToConsumeAfterLotSave(reply, lotDraftId);
      if (draftId) {
        lotDraftId = null;
        void send({ type: 'draft.consume', requestId: requestId(), draftId });
      }
    });
  });
  $('undo-lot').addEventListener('click', () => {
    if (dirtyEditors.has('lot') && !confirm('Discard the unsaved detail changes and undo the last saved edit?')) return;
    const command = buildLotUndoCommand(lastLotUndo);
    const current = (snapshot.lots ?? []).find((lot) => lot.id === lastLotUndo?.saved?.id);
    if (!command || current?.revision !== command.expectedRevision) { lastLotUndo = null; $('undo-lot').hidden = true; return announce('This coin changed after the edit, so it cannot be safely undone.', true); }
    dirtyEditors.delete('lot');
    void send(command).then((reply) => { if (reply?.ok) { lastLotUndo = null; $('undo-lot').hidden = true; $('lot-action-status').textContent = 'Last details edit undone.'; } });
  });
  $('delete-lot').addEventListener('click', () => { const basis = editorBases.get('lot'); if (basis?.id && confirm(`Remove “${basis.record.title}”?`)) void send({ type: 'lot.delete', requestId: requestId(), lotId: basis.id, expectedRevision: basis.revision }, 'lot'); });
  $('group-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('group') ?? { id: null, revision: null }; void send({ type: 'group.save', requestId: requestId(), expectedRevision: basis.revision, group: { ...(basis.id ? { id: basis.id } : {}), name: f.name.value.trim() } }, 'group'); });

  const bidMoney = (form) => {
    const money = parseMoney(form.amount.value, form.currency.value, navigator.language); if (!money.ok) return money;
    const value = { amount: money.value }; if (form.premium.value.trim()) { const premium = parsePremiumPercent(form.premium.value, navigator.language); if (!premium.ok) return premium; value.buyerPremiumBps = premium.value; }
    return { ok: true, value };
  };
  const loadBidEditor = (selectedLot) => {
    const f = $('bid-form').elements; const lot = selectedLot ?? snapshot.lots.find((item) => item.id === f.lotId.value);
    beginEditor('bid', lot ? { id: lot.id, revision: lot.revision, record: structuredClone(lot) } : { id: null, revision: null, record: null });
    const terms = lot?.plannedBid ?? lot?.activeBid; f.amount.value = moneyInputText(terms?.amount, navigator.language); f.currency.value = terms?.amount.currency ?? snapshot.preferences?.currency ?? 'USD'; f.premium.value = Number.isInteger(terms?.buyerPremiumBps) ? new Intl.NumberFormat(navigator.language, { useGrouping: false, maximumFractionDigits: 2 }).format(terms.buyerPremiumBps / 100) : '';
    calculatorCostEstimate = lot?.costEstimate?.currency === f.currency.value ? structuredClone(lot.costEstimate) : null;
    bidCalculator?.setValues({ currency: f.currency.value, hammerMinor: terms?.amount?.minor ?? null, buyerPremiumBps: terms?.buyerPremiumBps ?? null, costEstimate: calculatorCostEstimate });
  };
  bidCalculator = mountBidCalculator($('workspace-calculator'), { currency: snapshot.preferences?.currency ?? 'USD', compact: false, onUseHammer: ({ hammer, buyerPremiumBps, costEstimate }) => {
    calculatorCostEstimate = costEstimate ?? null;
    const f = $('bid-form').elements; f.amount.value = moneyInputText(hammer, navigator.language); f.currency.value = hammer.currency; f.premium.value = Number.isInteger(buyerPremiumBps) ? new Intl.NumberFormat(navigator.language, { useGrouping: false, maximumFractionDigits: 2 }).format(buyerPremiumBps / 100) : '';
    for (const control of [f.amount, f.currency, f.premium]) control.dispatchEvent(new Event('input', { bubbles: true }));
  } });
  $('bid-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('bid'); const parsed = bidMoney(f); if (!basis?.id || !parsed.ok) return announce(parsed.error?.message ?? 'Choose a lot.', true); const action = event.submitter?.value; if (action === 'place' && !confirm('Confirm that this bid is already active at the auction house.')) return; void send(buildBidSaveCommand(action, basis, parsed.value, calculatorCostEstimate), 'bid'); });
  $('cancel-bid').addEventListener('click', () => { const basis = editorBases.get('bid'); if (basis?.record?.activeBid && confirm('Confirm that you cancelled this bid outside the extension.')) void send({ type: 'bid.cancel', requestId: requestId(), lotId: basis.id, expectedRevision: basis.revision }, 'bid'); });

  function renderEvents() {
    const list = $('event-list'); list.replaceChildren();
    for (const event of snapshot.auctionEvents ?? []) { const card = text('article', '', 'record'); card.append(text('h3', event.name)); card.append(text('p', `${event.localDate}${event.localTime ? ` at ${event.localTime}` : ' · date only'} · ${event.timeZone}`)); const edit = text('button', 'Edit auction'); edit.type = 'button'; edit.addEventListener('click', () => openEventEditor(event)); card.append(edit); list.append(card); }
    const due = (snapshot.alerts ?? []).filter((alert) => ['due', 'claimed', 'delivered', 'snoozed'].includes(alert.status)); const alerts = $('alert-list'); const alertLabel = { due: 'Due', claimed: 'Being delivered', delivered: 'Delivered', snoozed: 'Snoozed' }; alerts.replaceChildren(...due.map((alert) => text('p', `${snapshot.auctionEvents.find((event) => event.id === alert.eventId)?.name ?? 'Auction'} · ${alertLabel[alert.status]}`, 'record'))); $('ack-alerts').dataset.ids = due.map((item) => item.triggerId ?? item.id).join(',');
  }
  const openEventEditor = (event) => { $('event-form').hidden = false; beginEditor('event', event ? { id: event.id, revision: event.revision, record: structuredClone(event) } : { id: null, revision: null, record: null }); if (event) populateEventForm(event); else { $('event-form').reset(); $('event-form').elements.id.value = ''; updatePrecision(); } $('event-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('event-form').elements.name.focus(); };
  $('new-event').addEventListener('click', () => openEventEditor(null));
  $('edit-selected-event').addEventListener('click', () => { const event = (snapshot.auctionEvents ?? []).find((item) => item.id === $('edit-selected-event').dataset.eventId); eventReturnLot = event ? null : structuredClone((snapshot.lots ?? []).find((lot) => lot.id === selection.selectedLotId) ?? null); location.hash = '#auctions'; openEventEditor(event ?? null); });
  const populateEventForm = (event) => {
    const f = $('event-form').elements;
    for (const key of ['id', 'name', 'eventKind', 'localDate', 'localTime', 'timeZone', 'reminderScope', 'capturedText', 'capturedFromUrl']) if (f[key]) f[key].value = event[key] ?? '';
    f.precision.value = event.precision ?? 'timed';
    setReminderControls(f.precision.value, reminderControlsForPrecision(event.reminders ?? [], f.precision.value));
    lastEventPrecision = f.precision.value;
    updatePrecision();
  };
  const setReminderControls = (precision, controls) => {
    const f = $('event-form').elements;
    if (precision === 'date-only') {
      f.reminderDayBefore.checked = controls.firstEnabled; f.reminderDayBeforeTime.value = controls.firstValue;
      f.reminderDayOf.checked = controls.secondEnabled; f.reminderDayOfTime.value = controls.secondValue;
    } else {
      f.reminder24h.checked = controls.firstEnabled; f.reminder24hValue.value = String(controls.firstValue);
      f.reminder1h.checked = controls.secondEnabled; f.reminder1hValue.value = String(controls.secondValue);
    }
  };
  const updatePrecision = () => { const dateOnly = $('event-form').elements.precision.value === 'date-only'; $('event-time-label').hidden = dateOnly; $('event-form').elements.localTime.required = !dateOnly; $('event-form').elements.reminder24h.parentElement.hidden = dateOnly; $('event-form').elements.reminder1h.parentElement.hidden = dateOnly; $('event-form').elements.reminderDayBefore.parentElement.hidden = !dateOnly; $('event-form').elements.reminderDayOf.parentElement.hidden = !dateOnly; };
  $('event-form').addEventListener('change', (event) => {
    if (event.target.name !== 'precision') return;
    const precision = event.target.value;
    if (precision !== lastEventPrecision) setReminderControls(precision, reminderControlsForPrecision(createEventDraft(precision).reminders, precision));
    lastEventPrecision = precision;
    updatePrecision();
  }); updatePrecision();
  $('event-form').hidden = true;
  $('event-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('event') ?? { id: null, revision: null }; const reminders = mergeEventReminders(basis.record?.reminders, f.precision.value, f.precision.value === 'date-only'
    ? { firstEnabled: f.reminderDayBefore.checked, firstValue: f.reminderDayBeforeTime.value, secondEnabled: f.reminderDayOf.checked, secondValue: f.reminderDayOfTime.value }
    : { firstEnabled: f.reminder24h.checked, firstValue: Number(f.reminder24hValue.value), secondEnabled: f.reminder1h.checked, secondValue: Number(f.reminder1hValue.value) });
    const eventDraft = { ...(basis.id ? { id: basis.id } : {}), name: f.name.value.trim(), eventKind: f.eventKind.value, precision: f.precision.value, localDate: f.localDate.value, timeZone: f.timeZone.value.trim(), reminderScope: f.reminderScope.value, reminders }; if (f.precision.value === 'timed') eventDraft.localTime = f.localTime.value; for (const key of ['capturedText', 'capturedFromUrl']) if (f[key].value) eventDraft[key] = f[key].value; if (!confirm(`Save ${eventDraft.name} on ${eventDraft.localDate}${eventDraft.localTime ? ` at ${eventDraft.localTime}` : ' as date only'} in ${eventDraft.timeZone}?`)) return; const submittedReturnLot = eventReturnLot; const submittedEventVersion = editorVersions.get('event') ?? 0; void send({ type: 'event.save', requestId: requestId(), expectedRevision: basis.revision, event: eventDraft }, 'event').then((reply) => {
      if (!reply?.ok) return;
      if (eventDraftId) { const draftId = eventDraftId; eventDraftId = null; void send({ type: 'draft.consume', requestId: requestId(), draftId }); }
      if (submittedReturnLot && sameEventReturnContext(submittedReturnLot, eventReturnLot, submittedEventVersion, editorVersions.get('event') ?? 0)) {
        const returnLot = submittedReturnLot; eventReturnLot = null;
        const current = (snapshot.lots ?? []).find((lot) => lot.id === returnLot.id);
        if (selection.selectedLotId !== returnLot.id || current?.revision !== returnLot.revision) return announce('Auction saved, but the coin changed before it could be attached. Attach it from coin details.', true);
        const attach = buildAttachEventCommand(returnLot, reply.value?.id);
        if (!attach) return announce('Auction saved, but its confirmed identity was unavailable. Attach it from coin details.', true);
        void send(attach).then((attached) => { if (attached?.ok) { location.hash = '#watchlist'; announce('Auction saved and attached to the coin.'); } });
      }
    }); });
  $('delete-event').addEventListener('click', () => { const basis = editorBases.get('event'); if (basis?.id && confirm(`Remove “${basis.record.name}”?`)) void send({ type: 'event.delete', requestId: requestId(), eventId: basis.id, expectedRevision: basis.revision }, 'event'); });
  const displayedAlertIds = () => $('ack-alerts').dataset.ids.split(',').filter(Boolean);
  $('ack-alerts').addEventListener('click', () => void send({ type: 'alert.ack', requestId: requestId(), triggerIds: displayedAlertIds() }));
  $('snooze-alerts').addEventListener('click', () => void send({ type: 'alert.snooze', requestId: requestId(), triggerIds: displayedAlertIds(), snoozedUntil: new Date(Date.now() + 15 * 60_000).toISOString() }));
  $('mark-all-read').addEventListener('click', () => void send({ type: 'alert.markAllRead', requestId: requestId() }));
  $('enable-notifications').addEventListener('click', async () => { if (!bridge) return; if (!snapshot.preferences) return announce('Preferences are not ready. Reload and try again.', true); const allowed = await bridge.requestNotificationPermission(); const current = snapshot.preferences; void send({ type: 'preferences.save', requestId: requestId(), expectedRevision: current.revision, preferences: { currency: current.currency, catalogue: current.catalogue, number: current.number, volume: current.volume, section: current.section, sampleMode: current.sampleMode, desktopAlertsEnabled: allowed } }); });

  function renderExposure() { const root = $('exposure-list'); root.replaceChildren(); const sections = buildExposureSections(snapshot); if (!sections.length) return root.append(text('p', 'No externally active bids.')); for (const section of sections) { const card = text('article', '', 'exposure-card'); card.append(text('h3', section.currency)); card.append(text('div', formatMoney({ currency: section.currency, minor: section.hammerMinor }), 'exposure-total')); card.append(text('p', `Binding hammer · ${section.bindingCount} bid${section.bindingCount === 1 ? '' : 's'}`)); card.append(text('p', `Known hammer + BP ${formatMoney({ currency: section.currency, minor: section.knownHammerPlusBpMinor })}`)); if (section.unknownPremiumCount) card.append(text('p', `Incomplete — premium unknown for ${section.unknownPremiumCount} bid${section.unknownPremiumCount === 1 ? '' : 's'}`)); for (const event of section.events) card.append(text('p', `${event.name}: ${formatMoney({ currency: section.currency, minor: event.hammerMinor })}`)); root.append(card); } }

  function renderHistory() {
    const root = $('history-list'); root.replaceChildren();
    for (const lot of (snapshot.lots ?? []).filter((item) => item.outcome?.status !== 'open')) { const card = text('article', '', 'record'); card.append(text('h3', `${lot.title} · ${lotStatusLabel(lot)}`)); if (lot.outcome.hammer) card.append(text('p', `Hammer ${formatMoney(lot.outcome.hammer)}`)); if (lot.outcome.actualInvoice) card.append(text('p', `Actual invoice ${formatMoney(lot.outcome.actualInvoice)} (your recorded total)`)); card.append(text('p', `${lot.bidHistory?.length ?? 0} recorded bid change${lot.bidHistory?.length === 1 ? '' : 's'}`)); root.append(card); }
    const collection = $('collection-list'); collection.replaceChildren(text('h3', 'Collection entries'));
    for (const entry of snapshot.collectionEntries ?? []) {
      const card = text('article', '', 'record'); card.append(text('p', `${entry.title} · ${entry.acquisitionDate}${entry.reviewReason ? ` · review: ${entry.reviewReason}` : ''}`));
      if (entry.reviewReason) { const actions = text('div', '', 'actions'); for (const decision of ['keep', 'remove']) { const button = text('button', decision === 'keep' ? 'Keep collection entry' : 'Remove collection entry'); button.type = 'button'; button.addEventListener('click', () => void send({ type: 'collection.review.resolve', requestId: requestId(), collectionEntryId: entry.id, expectedRevision: entry.revision, decision })); actions.append(button); } card.append(actions); }
      collection.append(card);
    }
  }
  const updateOutcomeVisibility = () => { const f = $('outcome-form').elements; const basis = editorBases.get('outcome'); $('passed-outcome').disabled = Boolean(basis?.record?.activeBid); $('reopen-choice').hidden = f.status.value !== 'open'; };
  const loadOutcomeEditor = (selectedLot) => {
    const f = $('outcome-form').elements; const lot = selectedLot ?? snapshot.lots.find((item) => item.id === f.lotId.value); beginEditor('outcome', lot ? { id: lot.id, revision: lot.revision, record: structuredClone(lot) } : { id: null, revision: null, record: null });
    const draft = outcomeDraftForLot(lot, navigator.language); f.status.value = draft.status; f.hammer.value = draft.hammer; f.hammerCurrency.value = draft.hammerCurrency; f.invoice.value = draft.invoice; f.invoiceCurrency.value = draft.invoiceCurrency; f.bindingActive.value = draft.bindingActive; f.addToCollection.checked = false; f.acquisitionDate.value = ''; f.collectionNotes.value = ''; updateOutcomeVisibility();
  };
  $('outcome-form').addEventListener('change', (event) => { if (event.target.name === 'lotId') loadOutcomeEditor(); else if (event.target.name === 'status') updateOutcomeVisibility(); });
  $('outcome-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('outcome'); const lot = basis?.record; if (!lot) return announce('Choose a lot.', true); const status = f.status.value; const outcome = { status }; if (['won', 'lost'].includes(status)) { if (f.hammer.value) { const money = parseMoney(f.hammer.value, f.hammerCurrency.value, navigator.language); if (!money.ok) return announce(money.error.message, true); outcome.hammer = money.value; } if (f.invoice.value) { const money = parseMoney(f.invoice.value, f.invoiceCurrency.value, navigator.language); if (!money.ok) return announce(money.error.message, true); outcome.actualInvoice = money.value; } } if (status === 'open' && ['won', 'lost'].includes(lot.outcome.status)) { if (!f.bindingActive.value) return announce('Choose whether the prior binding terms are externally active.', true); outcome.bindingActive = f.bindingActive.value === 'true'; } const command = { type: 'lot.outcome.set', requestId: requestId(), lotId: lot.id, expectedRevision: basis.revision, outcome }; if (status === 'won' && f.addToCollection.checked) command.addToCollection = { title: lot.title, acquisitionDate: f.acquisitionDate.value, sourceLinks: lot.sourceLinks ?? [], ...(f.collectionNotes.value ? { notes: f.collectionNotes.value } : {}) }; void send(command, 'outcome'); });

  function resetEditors() {
    for (const id of ['lot-form', 'group-form', 'bid-form', 'event-form', 'outcome-form', 'evidence-form']) $(id).reset();
    $('lot-form').elements.id.value = ''; $('event-form').elements.id.value = ''; lastEventPrecision = $('event-form').elements.precision.value; updatePrecision();
  }
  function resetEditor(editor) {
    const form = $(`${editor}-form`);
    if (!form) return;
    form.reset();
    if (editor === 'lot' || editor === 'event') form.elements.id.value = '';
    if (editor === 'event') { lastEventPrecision = form.elements.precision.value; updatePrecision(); form.hidden = true; }
    if (editor === 'group') form.hidden = true;
  }
  async function loadRouteDraft() {
    if (!bridge) return;
    const match = /^#(event-draft|research-draft|lot-draft)=([^&]+)$/.exec(location.hash);
    if (!match) return;
    const reply = await bridge.sendCommand({ type: 'draft.get', requestId: requestId(), draftId: decodeURIComponent(match[2]) });
    if (!reply.ok) return announce(reply.message, true);
    const draft = reply.value;
    if (match[1] === 'event-draft') {
      eventDraftId = draft.id; beginEditor('event', { id: null, revision: null, record: null });
      $('event-form').hidden = false;
      populateEventForm({ ...createEventDraft('timed'), precision: 'timed', eventKind: 'auction-starts', reminderScope: 'standalone', name: draft.payload.rawText?.slice(0, 500) || 'Captured auction', capturedText: draft.payload.rawText ?? '', capturedFromUrl: draft.payload.pageUrl ?? '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      dirtyEditors.add('event');
      announce('Captured auction draft loaded. Confirm every date and reminder before saving.');
    } else if (match[1] === 'lot-draft') {
      if (draft.kind !== 'current-lot' || draft.payload?.target !== 'watchlist') return announce('This draft cannot be used for a watchlist lot.', true);
      lotInteractionGeneration += 1;
      lotDraftId = draft.id;
      const values = lotDraftToEditor(draft.payload);
      const form = $('lot-form');
      selection = { selectedLotId: null, mode: 'detail' }; $('coin-workspace').dataset.mobileView = 'detail'; $('coin-empty').hidden = true; $('coin-editor').hidden = false;
      form.reset();
      form.elements.id.value = '';
      form.elements.title.value = values.title;
      form.elements.reference.value = values.reference;
      form.elements.sourceUrl.value = values.sourceUrl;
      form.elements.auctionPageUrl.value = values.auctionContext?.pageUrl ?? '';
      form.elements.auctionCanonicalUrl.value = values.auctionContext?.canonicalUrl ?? '';
      form.elements.auctionHouse.value = values.auctionContext?.house ?? '';
      form.elements.auctionSaleId.value = values.auctionContext?.saleId ?? '';
      form.elements.auctionLotNumber.value = values.auctionContext?.lotNumber ?? '';
      $('provenance-editor').replaceChildren();
      beginEditor('lot', { id: null, revision: null, record: null });
      dirtyEditors.add('lot');
      form.elements.title.focus();
      announce('Reference draft loaded. Review the lot details, then save to add it to the watchlist.');
    } else {
      researchDraftId = draft.id; $('research-query').value = draft.payload.rawText ?? ''; activeQuery = { id: requestId(), text: $('research-query').value.trim() }; selectedQueryId = activeQuery.id; renderEvidence(); $('research-query').focus();
      announce('Captured research text loaded. Edit it before opening a source or saving evidence.');
    }
  }
  function renderAll() { renderEvidence(); renderLots(); renderEvents(); renderExposure(); renderHistory(); }
  setRoute();
  if (!bridge) { $('runtime-note').hidden = false; document.querySelectorAll('[data-needs-runtime]').forEach((item) => { item.disabled = true; }); renderAll(); announce('Standalone preview: durable features are unavailable.'); }
  else {
    const initialized = initializeCompanionPreferences ? await initializeCompanionPreferences(bridge, localStorage) : await bridge.getSnapshot();
    if (!initialized.ok) announce(initialized.message, true);
    else { acceptIncoming(initialized.value, true); announce('Local records loaded.'); }
    await loadRouteDraft(); bridge.subscribeToSnapshots((incoming) => { acceptIncoming(incoming); });
  }
}

if (typeof document !== 'undefined') void initWorkspace();
