import { computeStatistics } from './core/evidence.js';
import { calculatePremium, formatMoney, parseMoney, parsePremiumPercent } from './core/money.js';
import { projectExposure } from './core/records.js';
import { buildUserInitiatedSearch } from './source-launchers.js';

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

export function lotDraftToEditor(payload) {
  const bounded = (value, maximum) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : '';
  return {
    title: bounded(payload?.title, 200),
    reference: bounded(payload?.reference, 120),
    sourceUrl: bounded(payload?.pageUrl, 2048),
  };
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
  let backup = null;
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
  let pendingImport = null;
  let pendingRetry = null;
  let eventDraftId = null;
  let researchDraftId = null;
  let lotDraftId = null;
  let activeQuery = { id: requestId(), text: '' };
  let selectedQueryId = activeQuery.id;
  let lastEventPrecision = 'timed';
  try {
    bridge = await import('./browser-api.js');
    backup = await import('./core/backup.js');
    ({ initializeCompanionPreferences } = await import('./companion-preferences.js'));
  } catch { /* standalone */ }
  if (typeof (globalThis.browser ?? globalThis.chrome)?.runtime?.sendMessage !== 'function') bridge = null;

  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  };
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
      if (reply.code === 'conflict') $('conflict-note').hidden = false;
      if (reply.outcome === 'unknown') {
        const committed = await refresh();
        if (commandWasCommitted(committed, command.requestId)) {
          const ledgerValue = committed?.recentCommands?.find((item) => item.requestId === command.requestId)?.reply?.value;
          const preserved = completeEditor(ledgerValue);
          if (committed) acceptIncoming(committed);
          pendingRetry = null; $('unknown-note').hidden = true;
          announce(preserved ? 'The save was committed. Newer edits remain in the form for review.' : 'The save was committed and has been verified from the request ledger.');
          return { ok: true, requestId: command.requestId, value: null };
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
    announce(preserved ? 'Saved. Newer edits remain in the form for review.' : 'Saved.');
    return reply;
  };

  document.querySelectorAll('[data-editor]').forEach((form) => form.addEventListener('input', () => {
    const editor = form.dataset.editor;
    dirtyEditors.add(editor);
    editorVersions.set(editor, (editorVersions.get(editor) ?? 0) + 1);
  }));
  $('reload-snapshot').addEventListener('click', () => {
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
    fillSelect($('lot-form').elements.auctionEventId, snapshot.auctionEvents ?? [], 'Unassigned');
    fillSelect($('bid-form').elements.lotId, snapshot.lots ?? []);
    fillSelect($('outcome-form').elements.lotId, snapshot.lots ?? []);
    for (const lot of snapshot.lots ?? []) {
      const card = text('article', '', 'record'); card.append(text('h3', lot.title));
      card.append(text('p', [lot.reference, lot.lotNumber ? `Lot ${lot.lotNumber}` : '', lot.outcome?.status].filter(Boolean).join(' · ')));
      if (lot.plannedBid) card.append(text('p', `Planned ${formatMoney(lot.plannedBid.amount)}${Number.isInteger(lot.plannedBid.buyerPremiumBps) ? ` + ${lot.plannedBid.buyerPremiumBps / 100}% BP` : ' · premium unknown'}`));
      if (lot.activeBid) card.append(text('p', `Externally active ${formatMoney(lot.activeBid.amount)}${Number.isInteger(lot.activeBid.buyerPremiumBps) ? ` + ${lot.activeBid.buyerPremiumBps / 100}% BP` : ' · premium unknown'}`));
      const edit = text('button', 'Edit'); edit.type = 'button';
      edit.addEventListener('click', () => {
        const form = $('lot-form'); const originalManualUrl = lot.sourceLinks?.find((link) => link.source === 'manual')?.url; beginEditor('lot', { id: lot.id, revision: lot.revision, record: structuredClone(lot), originalManualUrl }); form.elements.id.value = lot.id; form.elements.title.value = lot.title; form.elements.reference.value = lot.reference ?? ''; form.elements.lotNumber.value = lot.lotNumber ?? ''; form.elements.auctionEventId.value = lot.auctionEventId ?? ''; form.elements.sourceUrl.value = originalManualUrl ?? ''; document.querySelectorAll('[data-add-selected]').forEach((button) => { button.disabled = false; }); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.elements.title.focus();
      }); card.append(edit); list.append(card);
    }
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
      const editGroup = text('button', 'Edit group name'); editGroup.type = 'button'; editGroup.addEventListener('click', () => { const form = $('group-form'); beginEditor('group', { id: group.id, revision: group.revision, record: structuredClone(group) }); form.elements.id.value = group.id; form.elements.name.value = group.name; form.elements.name.focus(); });
      const add = text('button', 'Add selected lot'); add.type = 'button'; add.dataset.addSelected = ''; add.disabled = !$('lot-form').elements.id.value;
      add.addEventListener('click', () => { const ids = [...members.map((lot) => lot.id), $('lot-form').elements.id.value].filter((id, index, all) => id && all.indexOf(id) === index); void send(buildGroupReorderCommand(group, ids, snapshot)); });
      const remove = text('button', 'Remove group'); remove.type = 'button'; remove.addEventListener('click', () => { if (confirm(`Delete group “${group.name}”? Its lots will remain.`)) void send({ type: 'group.delete', requestId: requestId(), groupId: group.id, expectedRevision: group.revision }); });
      actions.append(editGroup, add, remove); card.append(actions); groups.append(card);
    }
    if (!dirtyEditors.has('bid')) loadBidEditor();
    if (!dirtyEditors.has('outcome')) loadOutcomeEditor();
  }
  $('new-lot').addEventListener('click', () => { $('lot-form').reset(); $('lot-form').elements.id.value = ''; beginEditor('lot', { id: null, revision: null, record: null }); document.querySelectorAll('[data-add-selected]').forEach((button) => { button.disabled = true; }); $('lot-form').elements.title.focus(); });
  $('lot-form').addEventListener('submit', (event) => {
    event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('lot') ?? { id: null, revision: null, record: null };
    const lot = { ...(basis.id ? { id: basis.id } : {}), title: f.title.value.trim(), sourceLinks: mergeLotSourceLinks(basis.record?.sourceLinks, f.sourceUrl.value, basis.originalManualUrl) };
    for (const key of ['reference', 'lotNumber', 'auctionEventId']) if (f[key].value) lot[key] = f[key].value;
    void send(buildLotSaveCommand(lot, basis.revision), 'lot').then((reply) => {
      const draftId = draftToConsumeAfterLotSave(reply, lotDraftId);
      if (draftId) {
        lotDraftId = null;
        void send({ type: 'draft.consume', requestId: requestId(), draftId });
      }
    });
  });
  $('delete-lot').addEventListener('click', () => { const basis = editorBases.get('lot'); if (basis?.id && confirm(`Remove “${basis.record.title}”?`)) void send({ type: 'lot.delete', requestId: requestId(), lotId: basis.id, expectedRevision: basis.revision }, 'lot'); });
  $('group-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('group') ?? { id: null, revision: null }; void send({ type: 'group.save', requestId: requestId(), expectedRevision: basis.revision, group: { ...(basis.id ? { id: basis.id } : {}), name: f.name.value.trim() } }, 'group'); });

  const bidMoney = (form) => {
    const money = parseMoney(form.amount.value, form.currency.value, navigator.language); if (!money.ok) return money;
    const value = { amount: money.value }; if (form.premium.value.trim()) { const premium = parsePremiumPercent(form.premium.value, navigator.language); if (!premium.ok) return premium; value.buyerPremiumBps = premium.value; }
    return { ok: true, value };
  };
  const loadBidEditor = () => {
    const f = $('bid-form').elements; const lot = snapshot.lots.find((item) => item.id === f.lotId.value);
    beginEditor('bid', lot ? { id: lot.id, revision: lot.revision, record: structuredClone(lot) } : { id: null, revision: null, record: null });
    const terms = lot?.plannedBid ?? lot?.activeBid; f.amount.value = moneyInputText(terms?.amount, navigator.language); f.currency.value = terms?.amount.currency ?? snapshot.preferences?.currency ?? 'USD'; f.premium.value = Number.isInteger(terms?.buyerPremiumBps) ? new Intl.NumberFormat(navigator.language, { useGrouping: false, maximumFractionDigits: 2 }).format(terms.buyerPremiumBps / 100) : '';
  };
  $('bid-form').elements.lotId.addEventListener('change', loadBidEditor);
  $('bid-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('bid'); const parsed = bidMoney(f); if (!basis?.id || !parsed.ok) return announce(parsed.error?.message ?? 'Choose a lot.', true); const action = event.submitter?.value; if (action === 'place' && !confirm('Confirm that this bid is already active at the auction house.')) return; void send({ type: action === 'place' ? 'bid.place' : 'bid.plan', requestId: requestId(), lotId: basis.id, expectedRevision: basis.revision, [action === 'place' ? 'activeBid' : 'plannedBid']: parsed.value }, 'bid'); });
  $('cancel-bid').addEventListener('click', () => { const basis = editorBases.get('bid'); if (basis?.record?.activeBid && confirm('Confirm that you cancelled this bid outside the extension.')) void send({ type: 'bid.cancel', requestId: requestId(), lotId: basis.id, expectedRevision: basis.revision }, 'bid'); });

  function renderEvents() {
    const list = $('event-list'); list.replaceChildren();
    for (const event of snapshot.auctionEvents ?? []) { const card = text('article', '', 'record'); card.append(text('h3', event.name)); card.append(text('p', `${event.eventKind} · ${event.localDate}${event.localTime ? ` ${event.localTime}` : ' · date only'} · ${event.timeZone}`)); const edit = text('button', 'Edit'); edit.type = 'button'; edit.addEventListener('click', () => { beginEditor('event', { id: event.id, revision: event.revision, record: structuredClone(event) }); populateEventForm(event); $('event-form').scrollIntoView(); }); card.append(edit); list.append(card); }
    const due = (snapshot.alerts ?? []).filter((alert) => ['due', 'claimed', 'delivered', 'snoozed'].includes(alert.status)); const alerts = $('alert-list'); alerts.replaceChildren(...due.map((alert) => text('p', `${snapshot.auctionEvents.find((event) => event.id === alert.eventId)?.name ?? 'Auction'} · ${alert.status}`, 'record'))); $('ack-alerts').dataset.ids = due.map((item) => item.triggerId ?? item.id).join(',');
  }
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
  $('event-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('event') ?? { id: null, revision: null }; const reminders = mergeEventReminders(basis.record?.reminders, f.precision.value, f.precision.value === 'date-only'
    ? { firstEnabled: f.reminderDayBefore.checked, firstValue: f.reminderDayBeforeTime.value, secondEnabled: f.reminderDayOf.checked, secondValue: f.reminderDayOfTime.value }
    : { firstEnabled: f.reminder24h.checked, firstValue: Number(f.reminder24hValue.value), secondEnabled: f.reminder1h.checked, secondValue: Number(f.reminder1hValue.value) });
    const eventDraft = { ...(basis.id ? { id: basis.id } : {}), name: f.name.value.trim(), eventKind: f.eventKind.value, precision: f.precision.value, localDate: f.localDate.value, timeZone: f.timeZone.value.trim(), reminderScope: f.reminderScope.value, reminders }; if (f.precision.value === 'timed') eventDraft.localTime = f.localTime.value; for (const key of ['capturedText', 'capturedFromUrl']) if (f[key].value) eventDraft[key] = f[key].value; if (!confirm(`Save ${eventDraft.name} on ${eventDraft.localDate}${eventDraft.localTime ? ` at ${eventDraft.localTime}` : ' as date only'} in ${eventDraft.timeZone}?`)) return; void send({ type: 'event.save', requestId: requestId(), expectedRevision: basis.revision, event: eventDraft }, 'event').then((reply) => { if (reply?.ok && eventDraftId) { const draftId = eventDraftId; eventDraftId = null; void send({ type: 'draft.consume', requestId: requestId(), draftId }); } }); });
  $('delete-event').addEventListener('click', () => { const basis = editorBases.get('event'); if (basis?.id && confirm(`Remove “${basis.record.name}”?`)) void send({ type: 'event.delete', requestId: requestId(), eventId: basis.id, expectedRevision: basis.revision }, 'event'); });
  const displayedAlertIds = () => $('ack-alerts').dataset.ids.split(',').filter(Boolean);
  $('ack-alerts').addEventListener('click', () => void send({ type: 'alert.ack', requestId: requestId(), triggerIds: displayedAlertIds() }));
  $('snooze-alerts').addEventListener('click', () => void send({ type: 'alert.snooze', requestId: requestId(), triggerIds: displayedAlertIds(), snoozedUntil: new Date(Date.now() + 15 * 60_000).toISOString() }));
  $('mark-all-read').addEventListener('click', () => void send({ type: 'alert.markAllRead', requestId: requestId() }));
  $('enable-notifications').addEventListener('click', async () => { if (!bridge) return; if (!snapshot.preferences) return announce('Preferences are not ready. Reload and try again.', true); const allowed = await bridge.requestNotificationPermission(); const current = snapshot.preferences; void send({ type: 'preferences.save', requestId: requestId(), expectedRevision: current.revision, preferences: { currency: current.currency, catalogue: current.catalogue, number: current.number, volume: current.volume, section: current.section, sampleMode: current.sampleMode, desktopAlertsEnabled: allowed } }); });

  function renderExposure() { const root = $('exposure-list'); root.replaceChildren(); const sections = buildExposureSections(snapshot); if (!sections.length) return root.append(text('p', 'No externally active bids.')); for (const section of sections) { const card = text('article', '', 'exposure-card'); card.append(text('h3', section.currency)); card.append(text('div', formatMoney({ currency: section.currency, minor: section.hammerMinor }), 'exposure-total')); card.append(text('p', `Binding hammer · ${section.bindingCount} bid${section.bindingCount === 1 ? '' : 's'}`)); card.append(text('p', `Known hammer + BP ${formatMoney({ currency: section.currency, minor: section.knownHammerPlusBpMinor })}`)); if (section.unknownPremiumCount) card.append(text('p', `Incomplete — premium unknown for ${section.unknownPremiumCount} bid${section.unknownPremiumCount === 1 ? '' : 's'}`)); for (const event of section.events) card.append(text('p', `${event.name}: ${formatMoney({ currency: section.currency, minor: event.hammerMinor })}`)); root.append(card); } }

  function renderHistory() {
    const root = $('history-list'); root.replaceChildren();
    for (const lot of (snapshot.lots ?? []).filter((item) => item.outcome?.status !== 'open')) { const card = text('article', '', 'record'); card.append(text('h3', `${lot.title} · ${lot.outcome.status}`)); if (lot.outcome.hammer) card.append(text('p', `Hammer ${formatMoney(lot.outcome.hammer)}`)); if (lot.outcome.actualInvoice) card.append(text('p', `Actual invoice ${formatMoney(lot.outcome.actualInvoice)} (user-entered charged total)`)); card.append(text('p', `${lot.bidHistory?.length ?? 0} bid-history entries · personal/unverified`)); root.append(card); }
    const collection = $('collection-list'); collection.replaceChildren(text('h3', 'Collection entries'));
    for (const entry of snapshot.collectionEntries ?? []) {
      const card = text('article', '', 'record'); card.append(text('p', `${entry.title} · ${entry.acquisitionDate}${entry.reviewReason ? ` · review: ${entry.reviewReason}` : ''}`));
      if (entry.reviewReason) { const actions = text('div', '', 'actions'); for (const decision of ['keep', 'remove']) { const button = text('button', decision === 'keep' ? 'Keep collection entry' : 'Remove collection entry'); button.type = 'button'; button.addEventListener('click', () => void send({ type: 'collection.review.resolve', requestId: requestId(), collectionEntryId: entry.id, expectedRevision: entry.revision, decision })); actions.append(button); } card.append(actions); }
      collection.append(card);
    }
  }
  const updateOutcomeVisibility = () => { const f = $('outcome-form').elements; const basis = editorBases.get('outcome'); $('passed-outcome').disabled = Boolean(basis?.record?.activeBid); $('reopen-choice').hidden = f.status.value !== 'open'; };
  const loadOutcomeEditor = () => {
    const f = $('outcome-form').elements; const lot = snapshot.lots.find((item) => item.id === f.lotId.value); beginEditor('outcome', lot ? { id: lot.id, revision: lot.revision, record: structuredClone(lot) } : { id: null, revision: null, record: null });
    const draft = outcomeDraftForLot(lot, navigator.language); f.status.value = draft.status; f.hammer.value = draft.hammer; f.hammerCurrency.value = draft.hammerCurrency; f.invoice.value = draft.invoice; f.invoiceCurrency.value = draft.invoiceCurrency; f.bindingActive.value = draft.bindingActive; f.addToCollection.checked = false; f.acquisitionDate.value = ''; f.collectionNotes.value = ''; updateOutcomeVisibility();
  };
  $('outcome-form').addEventListener('change', (event) => { if (event.target.name === 'lotId') loadOutcomeEditor(); else if (event.target.name === 'status') updateOutcomeVisibility(); });
  $('outcome-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('outcome'); const lot = basis?.record; if (!lot) return announce('Choose a lot.', true); const status = f.status.value; const outcome = { status }; if (['won', 'lost'].includes(status)) { if (f.hammer.value) { const money = parseMoney(f.hammer.value, f.hammerCurrency.value, navigator.language); if (!money.ok) return announce(money.error.message, true); outcome.hammer = money.value; } if (f.invoice.value) { const money = parseMoney(f.invoice.value, f.invoiceCurrency.value, navigator.language); if (!money.ok) return announce(money.error.message, true); outcome.actualInvoice = money.value; } } if (status === 'open' && ['won', 'lost'].includes(lot.outcome.status)) { if (!f.bindingActive.value) return announce('Choose whether the prior binding terms are externally active.', true); outcome.bindingActive = f.bindingActive.value === 'true'; } const command = { type: 'lot.outcome.set', requestId: requestId(), lotId: lot.id, expectedRevision: basis.revision, outcome }; if (status === 'won' && f.addToCollection.checked) command.addToCollection = { title: lot.title, acquisitionDate: f.acquisitionDate.value, sourceLinks: lot.sourceLinks ?? [], ...(f.collectionNotes.value ? { notes: f.collectionNotes.value } : {}) }; void send(command, 'outcome'); });

  $('export-backup').addEventListener('click', () => { if (!backup) return; const exported = backup.exportBackup(snapshot, new Date().toISOString()); if (!exported.ok) return announce(exported.error.message, true); const blob = new Blob([exported.value], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `auction-companion-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); announce('Backup exported.'); });
  $('import-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!backup) return; const formElement = event.currentTarget; const file = $('import-file').files?.[0]; if (!file) return announce('Choose a backup file.', true); const currentSnapshot = snapshot; const expectedRevision = currentSnapshot.revision; const raw = await file.text(); const validated = backup.validateBackup(raw); if (!validated.ok) return announce(validated.error.message, true); const mode = new FormData(formElement).get('mode'); const preview = backup.previewImport(currentSnapshot, validated.value, mode); if (!preview.ok) return announce(preview.error.message, true); pendingImport = { document: raw, mode, preview: preview.value, expectedRevision };
    const panel = $('import-preview'); panel.hidden = false; panel.replaceChildren(text('strong', `${mode === 'replace' ? 'Replace' : 'Merge'} preview at local revision ${expectedRevision}`), text('pre', JSON.stringify(preview.value.counts, null, 2)));
    if (preview.value.conflicts.length) { panel.append(text('p', 'Resolve these stable-ID conflicts before importing:')); const list = document.createElement('ul'); for (const conflict of preview.value.conflicts) list.append(text('li', `${conflict.collection} · ${conflict.id} · ${conflict.reason}`)); panel.append(list); }
    $('confirm-import').hidden = false; $('confirm-import').disabled = !preview.value.snapshot;
    announce(preview.value.snapshot ? 'Import preview ready. No records changed.' : 'Import preview has conflicts and cannot be confirmed.', !preview.value.snapshot);
  });
  $('confirm-import').addEventListener('click', () => { if (!pendingImport?.preview.snapshot) return; if (pendingImport.mode === 'replace' && !confirm('Replace local records with the reviewed backup?')) return; void send(buildBackupImportCommand(pendingImport)).then((reply) => { if (reply?.ok) { pendingImport = null; $('confirm-import').hidden = true; } }); });

  function resetEditors() {
    for (const id of ['lot-form', 'group-form', 'bid-form', 'event-form', 'outcome-form', 'evidence-form']) $(id).reset();
    $('lot-form').elements.id.value = ''; $('event-form').elements.id.value = ''; lastEventPrecision = $('event-form').elements.precision.value; updatePrecision();
  }
  function resetEditor(editor) {
    const form = $(`${editor}-form`);
    if (!form) return;
    form.reset();
    if (editor === 'lot' || editor === 'event') form.elements.id.value = '';
    if (editor === 'event') { lastEventPrecision = form.elements.precision.value; updatePrecision(); }
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
      populateEventForm({ ...createEventDraft('timed'), precision: 'timed', eventKind: 'auction-starts', reminderScope: 'standalone', name: draft.payload.rawText?.slice(0, 500) || 'Captured auction', capturedText: draft.payload.rawText ?? '', capturedFromUrl: draft.payload.pageUrl ?? '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      dirtyEditors.add('event');
      announce('Captured auction draft loaded. Confirm every date and reminder before saving.');
    } else if (match[1] === 'lot-draft') {
      if (draft.kind !== 'current-lot' || draft.payload?.target !== 'watchlist') return announce('This draft cannot be used for a watchlist lot.', true);
      lotDraftId = draft.id;
      const values = lotDraftToEditor(draft.payload);
      const form = $('lot-form');
      form.reset();
      form.elements.id.value = '';
      form.elements.title.value = values.title;
      form.elements.reference.value = values.reference;
      form.elements.sourceUrl.value = values.sourceUrl;
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
