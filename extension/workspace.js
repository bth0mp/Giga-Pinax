import { computeStatistics } from './core/evidence.js';
import { LIMITS } from './core/fields.js';
import { formatMoney, parseMoney, parsePremiumPercent } from './core/money.js';
import { lotComparables, lotsNeedingOutcome, projectCollection, reminderInstants } from './core/projections.js';
import { buildUserInitiatedSearch } from './source-launchers.js';
import { mountBidCalculator } from './bid-tools.js';
import { mountSourcesMenu } from './source-menu.js';
import { openSettings } from './navigation.js';
import {
  bidFormValues, buildWorkspaceLotDraft, createEventDraft, lotDraftToEditor, lotFormValues, mergeEventReminders, mergeRebasedFields,
  lotFieldForPath, moneyInputText, offeredEventFromDraft, outcomeDraftForLot, premiumInputText, rememberedZone, reminderControlsForPrecision,
} from './workspace-forms.js';
import {
  COIN_REMOVED_NOTICE, SELECTED_LOT_EDITORS, buildAttachEventCommand, buildBidSaveCommand, buildGroupReorderCommand,
  buildLotSaveCommand, buildLotUndoCommand, commandReplacedRevisions, commandWasCommitted, conflictNoteMessage,
  draftToConsumeAfterLotSave, editorRecord, editorsWithChangedBasis, eventAttachDecision, lotSaveFollowup, planCommit,
  removedCoinNotice, removedHereAfterDeleteReply, requestId, selectionAfterSnapshot, submissionContext,
} from './workspace-editing.js';
import {
  DETAIL_TABS, ROUTES, applyActiveRoute, auctionQueueForLots, buildExposureSections, chooseSelectedLot,
  comparableSetOptions, comparableSummary, comparisonPickerLabel, comparisonProvenanceRows, comparisonRows, comparisonSelectionAfterToggle, eventWhen,
  evidenceRowsForQuery,
  filterWorkspaceLots, lotRowAmount, lotStatusLabel, lotStatusTone, moveDetailTab, reminderAtLabel, reminderLabel, routeFromHash, viewerTimeZone,
} from './workspace-views.js';

const WORKER_UNREACHABLE = "The extension's background worker could not be reached. Reload this page and check the record before retrying.";

async function initWorkspace() {
  const $ = (id) => document.getElementById(id);
  let bridge = null;
  let initializeCompanionPreferences = null;
  let snapshot = { revision: 0, lots: [], auctionEvents: [], alternativeGroups: [], evidence: [], collectionEntries: [], alerts: [], recentCommands: [] };
  const dirtyEditors = new Set();
  const editorBases = new Map();
  const editorVersions = new Map();
  const savesInFlight = new Set();
  // Following committed data is not the collector editing: only opening an editor and typing in it
  // move the edit version, which is what every after-save decision is compared against.
  const setBasis = (editor, basis) => { editorBases.set(editor, basis); };
  const beginEditor = (editor, basis) => {
    setBasis(editor, basis);
    editorVersions.set(editor, (editorVersions.get(editor) ?? 0) + 1);
  };
  let eventsById = new Map();
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
  const view = () => ({ locale: navigator.language });
  // An auction's name, its day and time, and how soon, the relative part toned: amber within 48 hours, muted once past.
  const eventLine = (event, className, tag = 'span', withName = true) => {
    const line = text(tag, '', className);
    if (!event) { line.textContent = 'No auction attached'; return line; }
    const { when, relative, tone } = eventWhen(event, view());
    line.append(document.createTextNode(withName ? `${event.name} · ${when}` : when));
    if (relative) { line.append(document.createTextNode(' · ')); line.append(text('span', relative, `when-relative${tone ? ` when-${tone}` : ''}`)); }
    return line;
  };
  // A record's ISO day, or the day of an instant, as the browser's language writes it.
  const dayText = (iso) => {
    const day = String(iso ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return String(iso ?? '');
    try { return new Intl.DateTimeFormat(navigator.language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`)); } catch { return day; }
  };
  const statusPill = (lot) => { const pill = text('span', lotStatusLabel(lot), 'status-pill'); pill.dataset.tone = lotStatusTone(lot); return pill; };
  // What a lot draft's page stated about its sale, offered until the drafted coin is saved or the form is left: the closing, and the auction
  // written for it once the collector has ticked it.
  let pageOffer = null;
  const clearPageValues = () => { pageOffer = null; $('lot-page-values').replaceChildren(); $('lot-page-values').hidden = true; };
  const showPageValues = (values, pageUrl) => {
    const root = $('lot-page-values');
    root.replaceChildren(text('p', 'Filled in from the page you captured. Check each before saving; nothing here is saved until you save the coin.', 'field-note'));
    if (values.estimateNote) root.append(text('p', `Estimate from the page: ${values.estimateNote.replace(/^Estimate from page: /, '')}, the price its offer states. It is written as a line of Notes; clear that line to leave it out.`, 'field-note'));
    if (values.photoUrl) root.append(text('p', 'Photo link from the page, in Photo URL 1. Clear it to leave it out.', 'field-note'));
    if (values.provenance?.length) root.append(text('p', `Provenance from the page: ${values.provenance.length === 1 ? 'one entry' : `${values.provenance.length} entries`} under Sourced provenance, each kept only if you tick it.`, 'field-note'));
    const offered = offeredEventFromDraft({ closesAt: values.closesAt, startsAt: values.startsAt, pageUrl }, Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (offered) {
      pageOffer = { closesAt: values.closesAt, startsAt: values.startsAt, pageUrl, eventId: null };
      const label = document.createElement('label');
      const box = document.createElement('input'); box.type = 'checkbox'; box.name = 'pageAuction';
      const when = offered.precision !== 'timed' ? `day on ${offered.localDate}`
        : `${offered.eventKind === 'auction-starts' ? 'starting' : 'closing'} ${offered.localDate} ${offered.localTime} (${offered.timeZone})`;
      label.append(box, document.createTextNode(` Add an auction ${when} when saving, from the page (${offered.capturedText.replace(/^From the page: /, '')}). An auction you choose under Auction reminder is used instead.`));
      root.append(label);
    }
    root.hidden = root.children.length < 2;
  };
  const provenanceValues = () => [...$('provenance-editor').querySelectorAll('.provenance-row')]
    .filter((row) => row.dataset.offered !== 'true' || row.querySelector('[name="provenanceKeep"]').checked).map((row) => ({
    id: row.dataset.id || requestId(),
    text: row.querySelector('[name="provenanceText"]').value.trim(),
    sourceUrl: row.querySelector('[name="provenanceSourceUrl"]').value.trim(),
    recordedAt: row.dataset.recordedAt || new Date().toISOString(),
    ...(row.querySelector('[name="provenanceAuctionDate"]').value ? { auctionDate: row.querySelector('[name="provenanceAuctionDate"]').value } : {}),
  })).filter((item) => item.text || item.sourceUrl);
  // A row the page offered (a lot draft's provenance) waits for the collector's tick: unticked, it is shown and never saved.
  const appendProvenanceEditor = (entry = {}, offered = null) => {
    const row = document.createElement('div'); row.className = 'provenance-row'; row.dataset.id = entry.id ?? requestId(); row.dataset.recordedAt = entry.recordedAt ?? new Date().toISOString();
    row.innerHTML = '<label>Note<textarea name="provenanceText" maxlength="1000" required></textarea></label><label>Source URL<input name="provenanceSourceUrl" type="url" maxlength="2048" required></label><label>Auction date <span class="optional">optional</span><input name="provenanceAuctionDate" type="date"></label><div class="form-actions"><button class="quiet" type="button">Remove entry</button></div>';
    if (offered) {
      row.dataset.offered = 'true';
      const keep = document.createElement('label'); const box = document.createElement('input'); box.type = 'checkbox'; box.name = 'provenanceKeep';
      const read = [offered.source, offered.year, offered.lot ? `lot ${offered.lot}` : ''].filter(Boolean).join(', ');
      keep.append(box, document.createTextNode(` Keep this entry. From the page${read ? `: ${read}` : ''}`));
      row.prepend(keep);
    }
    row.querySelector('[name="provenanceText"]').value = entry.text ?? ''; row.querySelector('[name="provenanceSourceUrl"]').value = entry.sourceUrl ?? ''; row.querySelector('[name="provenanceAuctionDate"]').value = entry.auctionDate ?? '';
    row.querySelector('button').addEventListener('click', () => { row.remove(); $('lot-form').dispatchEvent(new Event('input', { bubbles: true })); });
    $('provenance-editor').append(row);
  };
  mountSourcesMenu($('source-menu'));
  // Each text box holds what the store accepts for its field (core/fields.js), and says how much room is left once
  // nine tenths of it is used, so a long pasted title is shortened in the box rather than refused at save.
  const limited = document.querySelectorAll('[data-limit]');
  for (const control of limited) control.maxLength = LIMITS[control.dataset.limit];
  const updateCount = (control) => {
    const limit = LIMITS[control.dataset.limit]; const left = limit - String(control.value).length;
    let count = control.parentElement.querySelector('.char-count');
    if (left > limit / 10) { if (count) count.hidden = true; return; }
    if (!count) { count = text('span', '', 'char-count'); control.after(count); }
    count.textContent = `${left} character${left === 1 ? '' : 's'} left`; count.hidden = false;
  };
  const refreshCounts = (form) => { for (const control of form.querySelectorAll('[data-limit]')) updateCount(control); };
  // A control's own label, without the hints and counts beside it, and the folded section it sits in.
  const fieldLabel = (control) => [...(control?.closest('label')?.childNodes ?? [])].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim() || control?.name || 'this field';
  const sectionOf = (control) => control?.closest('details');
  const where = (control) => { const section = sectionOf(control); return section ? `${fieldLabel(control)} under ${section.querySelector('summary')?.textContent ?? 'its section'}` : fieldLabel(control); };
  // A value the browser refuses stops the submit before the page hears of it. The first refused control of a submit
  // opens its folded section, so the browser can show it, and is named, where Save used to do nothing at all.
  let invalidNamed = false;
  const nameInvalid = (report) => (event) => {
    const section = sectionOf(event.target); if (section) section.open = true;
    if (invalidNamed) return;
    invalidNamed = true; queueMicrotask(() => { invalidNamed = false; });
    report(`Check ${where(event.target)}: ${event.target?.validationMessage || 'the value is not valid.'}`);
  };
  $('lot-form').addEventListener('invalid', nameInvalid((message) => { $('lot-action-status').textContent = message; $('lot-action-status').classList.add('error'); }), true);
  $('outcome-form').addEventListener('invalid', nameInvalid((message) => announce(message, true)), true);
  for (const form of new Set([...limited].map((control) => control.closest('form')))) form?.addEventListener('input', (event) => { if (event.target?.dataset?.limit) updateCount(event.target); });
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

  const LOADED = 'Local records loaded.';
  const announce = (message, error = false) => {
    $('workspace-status').textContent = message;
    $('workspace-status').classList.toggle('error', error);
    $('announcement').textContent = '';
    requestAnimationFrame(() => { $('announcement').textContent = message; });
    // Loading is said and then let go, so it is not a standing line above every route; the status line keeps its
    // height, and a message said since is left alone.
    if (message === LOADED) setTimeout(() => { if ($('workspace-status').textContent === LOADED) $('workspace-status').textContent = ''; }, 3000);
  };
  // Only the collector's own use of the nav moves the focus there; when the page navigates itself
  // it is on its way to a field, and stealing the focus back would undo that.
  let routeChangeFromNav = false;
  const setRoute = (focusLink = false) => {
    const active = routeFromHash(location.hash);
    applyActiveRoute(ROUTES, active, (route) => $(`route-${route}`), (route) => document.querySelector(`[data-route="${route}"]`));
    if (active === 'search') offerSelectedReference();
    if (focusLink) document.querySelector(`[data-route="${active}"]`)?.focus({ preventScroll: true });
  };
  // A comparable saved while a coin is open belongs, unless the collector says otherwise, to that
  // coin's reference: an empty query box is filled with it, in view and editable, and typed text is
  // never replaced. The History route matches saved comparables by exactly this query text.
  const offerSelectedReference = () => {
    const reference = String((snapshot.lots ?? []).find((lot) => lot.id === selection.selectedLotId)?.reference ?? '').trim();
    if (!reference || $('research-query').value.trim()) return;
    $('research-query').value = reference;
    ensureActiveQuery();
    renderEvidence();
  };
  document.querySelector('.workspace-nav').addEventListener('click', (event) => { routeChangeFromNav = Boolean(event.target.closest('[data-route]')); });
  addEventListener('hashchange', () => { const fromNav = routeChangeFromNav; routeChangeFromNav = false; setRoute(fromNav); });

  const showConflictNote = (message) => {
    $('conflict-editors').textContent = message;
    $('conflict-note').hidden = !message;
  };
  const updateConflictNote = () => showConflictNote(conflictNoteMessage(editorsWithChangedBasis(snapshot, dirtyEditors, editorBases, savesInFlight)));
  const clearSelectedEditors = () => {
    for (const editor of SELECTED_LOT_EDITORS) { dirtyEditors.delete(editor); editorBases.delete(editor); resetEditor(editor); }
  };
  // The coin this page is deleting: any snapshot that drops it, including one that arrives before
  // the reply does, clears its editors without the "removed in another view" notice.
  let removedHere = null;
  // Every snapshot is taken: an editor the collector is typing in keeps its input, and the rest of
  // the page — lists, queues, alerts and the editors that are not dirty — follows committed data.
  // Returns whether losing the coin was announced, which no later message in this pass overwrites.
  const acceptIncoming = (incoming) => {
    snapshot = incoming;
    eventsById = new Map((snapshot.auctionEvents ?? []).map((event) => [event.id, event]));
    const selected = selectionAfterSnapshot(selection, snapshot);
    const clearedInput = removedCoinNotice(selection, selected, dirtyEditors, removedHere);
    if (selected !== selection) {
      selection = selected;
      lotInteractionGeneration += 1;
      clearSelectedEditors();
      lastLotUndo = null; $('undo-lot').hidden = true;
      $('coin-workspace').dataset.mobileView = 'list';
    }
    updateConflictNote();
    renderAll();
    // The banner belongs to the editors that still exist; losing typed input is said out loud.
    if (clearedInput) announce(COIN_REMOVED_NOTICE, true);
    return clearedInput;
  };
  const populateEditor = (editor) => {
    const record = editorBases.get(editor)?.record;
    if (!record) return;
    if (editor === 'lot') populateLotForm(record);
    else if (editor === 'bid') populateBidForm(record);
    else if (editor === 'outcome') populateOutcomeForm(record);
    else if (editor === 'event') { $('event-form').hidden = false; populateEventForm(record); }
    else if (editor === 'group') populateGroupForm(record);
  };
  // Only the forms another command of this page can change behind the collector's back are merged.
  // The outcome form's fields are written by `lot.outcome.set` alone, and the auction and group
  // forms' by `event.save` and `group.save` — each of those is that form's own save.
  const editorFormValues = {
    lot: (record) => lotFormValues(record),
    bid: (record) => bidFormValues(record, navigator.language, snapshot.preferences?.currency ?? 'USD'),
  };
  // A dirty form cannot be repopulated, but leaving it on the record it was populated from lets its
  // next save undo the commit: each field the collector has not touched follows the new record.
  const mergeRebasedEditor = (editor, previousRecord, incoming) => {
    const readValues = editorFormValues[editor];
    const record = editorBases.get(editor)?.record;
    if (!readValues || !record || !previousRecord) return;
    const elements = $(`${editor}-form`).elements;
    // The merged auction may be one this very commit created, so the select needs its option
    // before the value can hold; the render that follows repeats this harmlessly.
    if (editor === 'lot') fillSelect(elements.auctionEventId, incoming?.auctionEvents ?? [], 'No auction attached');
    const before = readValues(previousRecord);
    const current = Object.fromEntries(Object.keys(before).map((field) => [field, elements[field].value]));
    // Assigning a value fires no input event, so the dirty flag and edit version stay where the
    // collector left them.
    for (const [field, value] of Object.entries(mergeRebasedFields(before, readValues(record), current))) elements[field].value = value;
  };
  // A committed command decides what happens to every open editor in one place; the page only
  // carries that decision out.
  const applyPlan = (plan, incoming = snapshot) => {
    const merges = plan.merge.map((editor) => [editor, editorBases.get(editor)?.record ?? null]);
    editorBases.clear(); for (const [editor, basis] of plan.bases) editorBases.set(editor, basis);
    editorVersions.clear(); for (const [editor, version] of plan.versions) editorVersions.set(editor, version);
    dirtyEditors.clear(); for (const editor of plan.dirty) dirtyEditors.add(editor);
    for (const editor of plan.reset) resetEditor(editor);
    for (const editor of plan.repopulate) populateEditor(editor);
    for (const [editor, previousRecord] of merges) mergeRebasedEditor(editor, previousRecord, incoming);
    if (plan.conflicts) showConflictNote(conflictNoteMessage(plan.conflicts));
    updateDirtyMarks();
  };
  // `beforeRender` applies the commit that produced this snapshot, so the page renders the editors
  // as the commit left them rather than as they were when the save started.
  const refresh = async (beforeRender = null) => {
    if (!bridge) return { ok: false };
    let reply;
    try { reply = await bridge.getSnapshot(); }
    catch { announce(WORKER_UNREACHABLE, true); return { ok: false, unreachable: true }; }
    if (!reply.ok) { announce(reply.message, true); return { ok: false }; }
    beforeRender?.(reply.value);
    const removed = acceptIncoming(reply.value);
    if (!removed) announce(LOADED);
    return { ok: true, value: reply.value, removed };
  };
  const send = async (command, editor, previousAttempt = null) => {
    if (!bridge) return announce('Extension storage is unavailable in this page.', true);
    const { submittedVersion, submittedBasis } = submissionContext(previousAttempt, editor, editorVersions, editorBases);
    const submittedRevisions = previousAttempt?.submittedRevisions ?? commandReplacedRevisions(command, snapshot);
    let preserved = false;
    const commit = (value, incoming, snapshotFresh) => {
      // The reply is being applied now, so this editor stops being in flight and this plan is what
      // decides its banner.
      released();
      const plan = planCommit({
        editor, submittedBasis, submittedVersion, submittedRevisions, value,
        snapshot: incoming, snapshotFresh, pending: savesInFlight,
        bases: editorBases, versions: editorVersions, dirty: dirtyEditors,
      });
      preserved = plan.preserved;
      applyPlan(plan, incoming);
    };
    // A refreshed snapshot decides the editors; when the refresh itself failed the commit is still
    // applied, against what this page already has, so a saved form is never left blank.
    const commitAndRefresh = async (value) => {
      const refreshed = await refresh((incoming) => commit(value, incoming, true));
      if (!refreshed.ok) commit(value, snapshot, false);
      return refreshed;
    };
    announce('Saving…');
    if (editor) savesInFlight.add(editor);
    // The flag is held until the commit has been applied: a subscription snapshot arriving between
    // the reply and the refresh carries this page's own write, which is no conflict with the form
    // that produced it.
    const released = () => { savesInFlight.delete(editor); };
    let reply;
    try { reply = await bridge.sendCommand(command); }
    catch {
      released();
      // The worker may or may not have committed: the same request ID makes a retry idempotent.
      pendingRetry = { command, editor, submittedVersion, submittedBasis, submittedRevisions };
      $('unknown-note').hidden = false;
      announce(WORKER_UNREACHABLE, true);
      return { ok: false, requestId: command.requestId, code: 'unreachable', outcome: 'unknown', message: WORKER_UNREACHABLE };
    }
    if (!reply.ok) {
      if (editor === 'lot') {
        // A refused value is named, and its folded section opened, so the collector can see what to change.
        const field = lotFieldForPath(reply.path ?? reply.error?.path); const control = field ? $('lot-form').elements[field] : null;
        const status = $('lot-action-status'); status.replaceChildren(document.createTextNode(`${reply.message ?? 'The coin could not be saved.'}${control ? ` (${fieldLabel(control)})` : ''}`)); status.classList.add('error');
        if (control) { const section = sectionOf(control); if (section) section.open = true; control.focus(); }
        const existingLotId = reply.existingLotId ?? reply.error?.existingLotId;
        if (reply.code === 'duplicate' && existingLotId) {
          const open = text('button', 'Open existing coin', 'quiet'); open.type = 'button'; open.addEventListener('click', () => selectLot(existingLotId)); status.append(document.createTextNode(' '), open);
        }
      }
      // A conflict reply means the stored record moved on: nothing of this page's is in flight any
      // more, and the fresh snapshot decides which editors the note belongs to.
      let removed = false;
      if (reply.code === 'conflict') { released(); removed = Boolean((await refresh()).removed); }
      if (reply.outcome === 'unknown') {
        const committed = await refresh();
        if (commandWasCommitted(committed.value, command.requestId)) {
          const ledgerValue = committed.value?.recentCommands?.find((item) => item.requestId === command.requestId)?.reply?.value;
          commit(ledgerValue, committed.value, true);
          pendingRetry = null; $('unknown-note').hidden = true;
          // Losing the coin has already been said out loud; the outcome of the save would bury it.
          if (!committed.removed) announce(preserved ? 'The save was committed. Newer edits remain in the form for review.' : 'The save was committed and has been verified from the request ledger.');
          return { ok: true, requestId: command.requestId, value: ledgerValue ?? null, editorPreserved: preserved };
        }
        released();
        pendingRetry = { command, editor, submittedVersion, submittedBasis, submittedRevisions };
        $('unknown-note').hidden = false;
        announce('Save outcome is uncertain. Review committed records before retrying the same request.', true);
        return reply;
      }
      released();
      if (!removed) announce(reply.message, true);
      return reply;
    }
    const refreshed = await commitAndRefresh(reply.value);
    if (editor === 'lot') $('lot-action-status').classList.remove('error');
    // A failed refresh has already said the worker is unreachable, and a coin that went missing
    // during the save has already said so too; "Saved." would bury either.
    if (refreshed.ok && !refreshed.removed) announce(preserved ? 'Saved. Newer edits remain in the form for review.' : 'Saved.');
    return { ...reply, editorPreserved: preserved };
  };

  document.querySelectorAll('[data-editor]').forEach((form) => form.addEventListener('input', () => {
    const editor = form.dataset.editor;
    if (editor === 'lot') lotInteractionGeneration += 1;
    dirtyEditors.add(editor);
    editorVersions.set(editor, (editorVersions.get(editor) ?? 0) + 1);
    updateDirtyMarks();
  }));
  // Unsaved input lives only in this tab, so the browser's own prompt is the last thing between a
  // half-finished entry and a reload.
  addEventListener('beforeunload', (event) => {
    if (!dirtyEditors.size) return;
    event.preventDefault();
    event.returnValue = '';
  });
  // The banner names the forms whose records moved, so only those are discarded: unsaved input in
  // an editor nothing else touched is still the collector's.
  $('reload-snapshot').addEventListener('click', () => {
    const conflicted = editorsWithChangedBasis(snapshot, dirtyEditors, editorBases, savesInFlight);
    if (conflicted.includes('lot')) lotInteractionGeneration += 1;
    for (const editor of conflicted) { dirtyEditors.delete(editor); editorBases.delete(editor); editorVersions.delete(editor); resetEditor(editor); }
    updateDirtyMarks();
    void refresh();
    $('conflict-note').hidden = true;
  });
  $('retry-uncertain').addEventListener('click', () => {
    if (!pendingRetry) return;
    // The same request, resubmitted as it was first submitted: anything typed since the attempt
    // failed is newer than the save and stays in the form.
    const retry = pendingRetry; pendingRetry = null; $('unknown-note').hidden = true;
    // The retry is where an uncertain delete becomes certain, so it is also where the page finds
    // out whether the coin is still its own removal.
    void send(retry.command, retry.editor, retry).then((reply) => {
      if (retry.command.type === 'lot.delete') removedHere = removedHereAfterDeleteReply(removedHere, retry.command.lotId, reply);
    });
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
    const options = comparableSetOptions(snapshot.evidence, activeQuery);
    const querySelect = $('evidence-query');
    querySelect.replaceChildren(...options.map(({ id, label }) => { const option = text('option', label); option.value = id; return option; }));
    if (!options.some(({ id }) => id === selectedQueryId)) selectedQueryId = activeQuery.id;
    querySelect.value = selectedQueryId;
    const evidenceRows = evidenceRowsForQuery(snapshot.evidence ?? [], selectedQueryId);
    const filters = { currency: $('evidence-currency').value, fromDate: $('evidence-from').value, toDate: $('evidence-to').value, sources: selectedSources() };
    const stats = computeStatistics(evidenceRows, filters);
    const output = $('statistics-output');
    output.replaceChildren();
    if (stats.validationError && evidenceRows.length) output.append(text('p', stats.validationError.message));
    else {
      const { headline, leftOut } = comparableSummary(evidenceRows, stats, formatMoney);
      output.append(text('p', headline, 'metric-headline'));
      if (leftOut) output.append(text('p', leftOut, 'field-note'));
    }
    const list = $('evidence-list'); list.replaceChildren();
    const effectiveExclusions = new Map(stats.excluded.map((item) => [item.id, item.reason]));
    for (const row of evidenceRows) {
      const card = text('article', '', 'record');
      const first = row.observations?.[0];
      card.append(text('h4', row.saleIdentity ? `${row.saleIdentity.auctionHouse}, ${row.saleIdentity.houseSaleId}, lot ${row.saleIdentity.lotNumber}` : first ? `${first.auctionHouse}${first.houseSaleId ? `, ${first.houseSaleId}` : ''}, lot ${first.lotNumber}` : `Observation ${row.id}`));
      card.append(text('p', `${row.inclusion}${row.exclusionReason ? `: ${row.exclusionReason}` : ''}${row.conflictFields?.length ? ` · conflicts: ${row.conflictFields.join(', ')}` : ''}`));
      for (const observation of row.observations ?? []) {
        const amount = observation.amount ? formatMoney(observation.amount) : 'No amount';
        card.append(text('p', `${observation.source} · ${dayText(observation.auctionDate)} · ${observation.priceBasis} · ${amount}${observation.retrievedAt ? ` · retrieved ${dayText(observation.retrievedAt)}` : ''}`));
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
      // A set is shown in the currency most of its sales were knocked down in; the others stay out, never converted.
      const currencies = evidenceRowsForQuery(snapshot.evidence ?? [], selectedQueryId).map((row) => row.resolved?.hammer?.currency).filter(Boolean);
      const common = [...new Set(currencies)].sort((a, b) => currencies.filter((c) => c === b).length - currencies.filter((c) => c === a).length)[0];
      if (common && [...$('evidence-currency').options].some((option) => option.value === common)) $('evidence-currency').value = common;
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
  function renderCoinList() {
    const list = $('lot-list'); list.replaceChildren();
    const queuedLots = auctionQueueForLots(snapshot.lots ?? [], snapshot.auctionEvents ?? [], $('lot-queue').value).map(({ lot }) => lot);
    const visibleLots = filterWorkspaceLots(queuedLots, $('lot-filter').value);
    $('lot-count').textContent = `${visibleLots.length} of ${(snapshot.lots ?? []).length} coins`;
    const needingOutcome = new Set(lotsNeedingOutcome(snapshot).map((lot) => lot.id));
    if (!visibleLots.length) list.append(text('p', (snapshot.lots ?? []).length ? 'No coins match this filter.' : 'No coins yet. Add the first coin to begin.', 'empty-row'));
    for (const lot of visibleLots) {
      const row = text('button', '', 'coin-row'); row.type = 'button'; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(selection.selectedLotId === lot.id));
      const top = text('span', '', 'coin-row-top'); top.append(text('strong', lot.reference || lot.title, 'coin-row-title'));
      const amount = lotRowAmount(lot); if (amount) top.append(text('span', formatMoney(amount), 'coin-row-amount'));
      const sub = text('span', lot.reference ? lot.title : (lot.lotNumber ? `Lot ${lot.lotNumber}` : 'Uncatalogued coin'), 'coin-row-sub');
      const event = eventsById.get(lot.auctionEventId);
      const status = text('span', '', 'coin-row-status'); status.append(statusPill(lot));
      if (needingOutcome.has(lot.id)) { const ended = text('span', 'Ended · record outcome', 'status-pill'); ended.dataset.tone = 'ended'; status.append(ended); }
      if (event) status.append(text('span', event.name, 'coin-row-event'));
      row.append(top, sub, eventLine(event, 'coin-row-when', 'span', false), status);
      row.addEventListener('click', () => selectLot(lot.id));
      list.append(row);
    }
  }
  // Toggling a coin changes only the controls, never the checkbox the collector is standing on.
  function updateComparisonControls() {
    for (const box of $('comparison-picker').querySelectorAll('input[type="checkbox"]')) {
      box.checked = comparisonSelection.includes(box.dataset.lotId);
      box.disabled = !box.checked && comparisonSelection.length >= 4;
    }
    $('comparison-count').textContent = `${comparisonSelection.length} selected · choose 2–4 coins`;
    $('open-comparison').disabled = comparisonSelection.length < 2 || comparisonSelection.length > 4;
  }
  // The filter narrows the picker by hiding rows: rebuilding it on every keystroke is what used to
  // move the focus out of the box being typed in.
  function updateComparisonFilter() {
    const visible = new Set(filterWorkspaceLots(snapshot.lots ?? [], $('lot-filter').value).map((lot) => lot.id));
    for (const row of $('comparison-picker').querySelectorAll('label[data-lot-id]')) row.hidden = !visible.has(row.dataset.lotId);
  }
  function renderComparisonPicker() {
    const picker = $('comparison-picker'); picker.replaceChildren();
    for (const lot of snapshot.lots ?? []) {
      const label = document.createElement('label'); label.className = 'compare-choice'; label.dataset.lotId = lot.id;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.lotId = lot.id;
      checkbox.addEventListener('change', () => { comparisonSelection = comparisonSelectionAfterToggle(comparisonSelection, lot.id); updateComparisonControls(); });
      label.append(checkbox, document.createTextNode(comparisonPickerLabel(lot))); picker.append(label);
    }
    updateComparisonFilter();
    updateComparisonControls();
  }
  function populateGroupForm(group) {
    const form = $('group-form'); form.hidden = false; form.elements.id.value = group.id; form.elements.name.value = group.name;
  }
  function renderGroups() {
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
      const editGroup = text('button', 'Edit group name'); editGroup.type = 'button'; editGroup.addEventListener('click', () => { beginEditor('group', { id: group.id, revision: group.revision, record: structuredClone(group) }); populateGroupForm(group); $('group-form').elements.name.focus(); });
      const add = text('button', 'Add selected coin'); add.type = 'button'; add.dataset.addSelected = ''; add.disabled = !selection.selectedLotId;
      add.addEventListener('click', () => { const ids = [...members.map((lot) => lot.id), selection.selectedLotId].filter((id, index, all) => id && all.indexOf(id) === index); void send(buildGroupReorderCommand(group, ids, snapshot)); });
      const remove = text('button', 'Remove group'); remove.type = 'button'; remove.addEventListener('click', () => { if (confirm(`Delete group “${group.name}”? Its lots will remain.`)) void send({ type: 'group.delete', requestId: requestId(), groupId: group.id, expectedRevision: group.revision }); });
      actions.append(editGroup, add, remove); card.append(actions); groups.append(card);
    }
  }
  function renderLots() {
    const knownLotIds = new Set((snapshot.lots ?? []).map((lot) => lot.id));
    comparisonSelection = comparisonSelection.filter((id) => knownLotIds.has(id));
    fillSelect($('lot-form').elements.auctionEventId, snapshot.auctionEvents ?? [], 'No auction attached');
    renderCoinList(); renderComparisonPicker(); renderGroups(); renderSelectedLot();
  }
  const canLeaveSelectedEditors = () => !['lot', 'bid', 'outcome'].some((editor) => dirtyEditors.has(editor)) || confirm('Discard unsaved changes and open another coin?');
  function selectLot(lotId, { focus = true } = {}) {
    if (lotId === selection.selectedLotId) { selection = { ...selection, mode: 'detail' }; $('coin-workspace').dataset.mobileView = 'detail'; renderLots(); if (focus) $('selected-title').focus?.(); return; }
    if (lotId !== selection.selectedLotId && !canLeaveSelectedEditors()) return;
    // A lot draft left behind is discarded with its form, so no later save consumes it.
    lotDraftId = null;
    if (lotId !== selection.selectedLotId) lotInteractionGeneration += 1;
    for (const editor of ['lot', 'bid', 'outcome']) { dirtyEditors.delete(editor); editorBases.delete(editor); }
    selection = chooseSelectedLot(selection, lotId, snapshot.lots ?? []);
    for (const tab of DETAIL_TABS) tabButtons.get(tab).disabled = false;
    showDetailTab('details');
    if (lastLotUndo?.saved?.id !== selection.selectedLotId) $('undo-lot').hidden = true;
    $('coin-workspace').dataset.mobileView = selection.mode;
    renderLots(); updateDirtyMarks();
    if (focus) $('selected-title').focus?.();
  }
  function populateLotForm(lot) {
    const f = $('lot-form').elements;
    for (const [field, value] of Object.entries(lotFormValues(lot))) f[field].value = value;
    clearPageValues();
    $('provenance-editor').replaceChildren(); for (const entry of lot.provenanceNotes ?? []) appendProvenanceEditor(entry);
    openFilledGroups(lot.id); refreshCounts($('lot-form'));
  }
  // The folded sections of the details form open themselves when they hold a value. For the coin already shown, a
  // section the collector opened stays open when the form follows committed data; another coin starts afresh.
  let groupsShownFor;
  function openFilledGroups(recordId = null) {
    const fresh = recordId === null || recordId !== groupsShownFor;
    groupsShownFor = recordId;
    for (const group of $('lot-form').querySelectorAll('details')) {
      const filled = [...group.querySelectorAll('input, textarea, select')].some((control) => !['checkbox', 'radio', 'hidden'].includes(control.type) && String(control.value).trim())
        || Boolean(group.querySelector('.provenance-row'));
      group.open = fresh ? filled : group.open || filled;
    }
  }
  const updateDirtyMarks = () => { $('lot-dirty').hidden = !dirtyEditors.has('lot'); $('outcome-dirty').hidden = !dirtyEditors.has('outcome'); };
  function renderSelectedLot() {
    const lot = (snapshot.lots ?? []).find((item) => item.id === selection.selectedLotId);
    $('coin-empty').hidden = Boolean(lot) || selection.mode === 'detail'; $('coin-editor').hidden = !lot && selection.mode !== 'detail';
    if (!lot) return;
    for (const tab of DETAIL_TABS) tabButtons.get(tab).disabled = false;
    $('bid-form').disabled = false; $('outcome-form').disabled = false;
    // A settled lot's bids are history: the store refuses a change, so the form offers none and says why.
    const settled = Boolean(lot.outcome?.status && lot.outcome.status !== 'open');
    $('bid-fields').disabled = settled; $('bid-settled').hidden = !settled;
    if (!dirtyEditors.has('lot')) {
      setBasis('lot', { id: lot.id, revision: lot.revision, record: structuredClone(lot), originalManualUrl: lot.sourceLinks?.find((link) => link.source === 'manual')?.url });
      populateLotForm(lot);
    }
    $('selected-reference').textContent = lot.reference || 'Uncatalogued'; $('selected-title').textContent = lot.title; $('selected-title').tabIndex = -1; $('selected-status').textContent = lotStatusLabel(lot); $('selected-status').dataset.tone = lotStatusTone(lot);
    $('selected-ended').hidden = !lotsNeedingOutcome({ lots: [lot], auctionEvents: snapshot.auctionEvents }).length;
    if (lot.auctionContext?.pageUrl) $('open-auction').href = lot.auctionContext.pageUrl; else $('open-auction').removeAttribute('href');
    $('research-reference').disabled = !String(lot.reference ?? '').trim();
    $('delete-lot').hidden = false;
    $('undo-lot').hidden = lastLotUndo?.saved?.id !== lot.id;
    $('bid-form').elements.lotId.value = lot.id; $('outcome-form').elements.lotId.value = lot.id;
    if (!dirtyEditors.has('bid')) loadBidEditor(lot); if (!dirtyEditors.has('outcome')) loadOutcomeEditor(lot);
    renderBidEvidence();
    const event = eventsById.get(lot.auctionEventId); const attached = $('attached-event'); attached.replaceChildren();
    attached.append(event ? eventLine(event, '', 'p') : text('p', 'No auction is attached.'));
    $('edit-selected-event').textContent = event ? 'Edit auction' : 'Add auction'; $('edit-selected-event').dataset.eventId = event?.id ?? '';
    renderSelectedReminders(event);
  }
  // The Reminders tab: the attached auction and its time, then its reminders in words, or the standard two to add;
  // with no auction, the way to attach one.
  function renderSelectedReminders(event) {
    const reminders = $('selected-reminders'); reminders.replaceChildren();
    if (!event) {
      reminders.append(text('p', 'Attach an auction to set reminders.', 'field-note'));
      if ((snapshot.auctionEvents ?? []).length) {
        const attach = text('button', 'Attach auction', 'quiet'); attach.type = 'button'; attach.id = 'attach-auction';
        attach.addEventListener('click', () => { showDetailTab('details'); $('lot-form').elements.auctionEventId.focus(); });
        reminders.append(attach);
      }
      return;
    }
    reminders.append(eventLine(event, 'reminder-event', 'p'));
    const instants = reminderInstants(event);
    for (const reminder of event.reminders ?? []) {
      const row = text('div', '', 'reminder-row'); row.append(text('span', reminderLabel(reminder), 'reminder-when'));
      const instant = instants.get(reminder.id);
      if (instant) { const at = reminderAtLabel(instant, event.timeZone, view()); row.append(text('span', at.text, `reminder-at${at.tone ? ` when-${at.tone}` : ''}`)); }
      reminders.append(row);
    }
    if ((event.reminders ?? []).length) return;
    reminders.append(text('p', 'No reminders set.', 'field-note'));
    const standard = createEventDraft(event.precision === 'date-only' ? 'date-only' : 'timed').reminders;
    const add = text('button', `Add the standard two (${event.precision === 'date-only' ? 'the day before and on the day, at 09:00' : '1 day and 1 hour before'})`, 'quiet');
    add.type = 'button'; add.id = 'add-standard-reminders'; add.dataset.needsRuntime = ''; add.disabled = !bridge;
    add.addEventListener('click', () => void send({ type: 'event.save', requestId: requestId(), expectedRevision: event.revision, event: { ...eventDraftOf(event), reminders: standard } }));
    reminders.append(add);
  }
  // An auction as event.save takes it back: the fields the collector confirmed, never the ones the store derives.
  const eventDraftOf = (event) => Object.fromEntries(['id', 'name', 'eventKind', 'precision', 'localDate', 'localTime', 'timeZone', 'reminderScope', 'reminders', 'capturedText', 'capturedFromUrl']
    .filter((key) => event[key] !== undefined).map((key) => [key, structuredClone(event[key])]));
  // Typing in the filter only narrows the list: rebuilding the picker, the groups and the open
  // editors on every keystroke moved the focus and re-read records the collector was editing.
  let filterTimer = null;
  $('lot-filter').addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { renderCoinList(); updateComparisonFilter(); }, 150);
  });
  $('lot-queue').addEventListener('change', renderCoinList);
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
  $('new-lot').addEventListener('click', () => { if (!canLeaveSelectedEditors()) return; lotDraftId = null; lotInteractionGeneration += 1; clearSelectedEditors(); selection = { selectedLotId: null, mode: 'detail' }; lastLotUndo = null; $('undo-lot').hidden = true; $('delete-lot').hidden = true; $('lot-action-status').textContent = ''; $('lot-action-status').classList.remove('error'); $('coin-workspace').dataset.mobileView = 'detail'; $('coin-empty').hidden = true; $('coin-editor').hidden = false; $('lot-form').reset(); $('provenance-editor').replaceChildren(); openFilledGroups(); updateDirtyMarks(); $('open-auction').removeAttribute('href'); $('research-reference').disabled = true; $('lot-form').elements.id.value = ''; beginEditor('lot', { id: null, revision: null, record: null }); $('bid-form').disabled = true; $('outcome-form').disabled = true; for (const tab of DETAIL_TABS.slice(1)) tabButtons.get(tab).disabled = true; showDetailTab('details'); $('selected-reference').textContent = 'New watchlist coin'; $('selected-title').textContent = 'Add coin'; $('selected-status').textContent = 'Draft'; $('lot-form').elements.title.focus(); });
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
    // The auction the page's closing offers is written only when the collector ticked it and chose no auction of their own, and only once:
    // a coin save that fails after it keeps the auction it made for the next try, and one request stands for the offer, so a save repeated after
    // a lost reply is answered from the store's ledger with the auction already written. The auction never stands between the collector and the
    // coin: one the store refuses is left off, the coin is saved, and the status says so. Only an unreachable worker, which cannot save the coin
    // either, stops here, with the retry banner standing.
    const offer = pageOffer;
    const wanted = Boolean(offer && f.pageAuction?.checked && !lot.auctionEventId);
    if (wanted && offer.eventId) lot.auctionEventId = offer.eventId;
    const offeredEvent = wanted && !offer.eventId ? offeredEventFromDraft(offer, Intl.DateTimeFormat().resolvedOptions().timeZone) : null;
    if (offeredEvent) offer.requestId ??= requestId();
    const savedEvent = offeredEvent
      ? send({ type: 'event.save', requestId: offer.requestId, expectedRevision: null, event: { ...offeredEvent, name: lot.title.slice(0, 300) } })
      : Promise.resolve(null);
    let auctionProblem = '';
    void savedEvent.then((eventReply) => {
      if (offeredEvent) {
        if (eventReply?.ok && eventReply.value?.id) { offer.eventId = eventReply.value.id; lot.auctionEventId = eventReply.value.id; }
        else if (!eventReply || eventReply.code === 'unreachable') return null;
        else auctionProblem = String(eventReply.message || 'The auction could not be saved').replace(/\.?$/, '.');
      }
      return send(buildLotSaveCommand(lot, basis.revision), 'lot');
    }).then((reply) => {
      if (!reply) return;
      if (reply?.ok && reply.value?.id) {
        const interactionChanged = submittedInteractionGeneration !== lotInteractionGeneration;
        const followup = lotSaveFollowup(selection, submittedSelection, reply.value, reply.editorPreserved, Boolean(previous), interactionChanged); selection = followup.selection;
        if (!reply.editorPreserved && !interactionChanged && selection.selectedLotId === reply.value.id) {
          lastLotUndo = followup.offerUndo ? { previous, saved: structuredClone(reply.value) } : null;
          $('undo-lot').hidden = !lastLotUndo;
          $('lot-action-status').textContent = (previous ? 'Details saved. You can undo this edit until the coin changes again.' : 'Coin added to the watchlist.')
            + (auctionProblem ? ` The auction from the page was not added: ${auctionProblem} Add it under Auction reminder.` : ''); renderLots();
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
  $('delete-lot').addEventListener('click', () => {
    const basis = editorBases.get('lot');
    if (!basis?.id || !confirm(`Remove “${basis.record.title}”?`)) return;
    removedHere = basis.id;
    void send({ type: 'lot.delete', requestId: requestId(), lotId: basis.id, expectedRevision: basis.revision }, 'lot')
      .then((reply) => { removedHere = removedHereAfterDeleteReply(removedHere, basis.id, reply); });
  });
  $('group-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('group') ?? { id: null, revision: null }; void send({ type: 'group.save', requestId: requestId(), expectedRevision: basis.revision, group: { ...(basis.id ? { id: basis.id } : {}), name: f.name.value.trim() } }, 'group'); });

  const bidMoney = (form) => {
    const money = parseMoney(form.amount.value, form.currency.value, navigator.language); if (!money.ok) return money;
    const value = { amount: money.value }; if (form.premium.value.trim()) { const premium = parsePremiumPercent(form.premium.value, navigator.language); if (!premium.ok) return premium; value.buyerPremiumBps = premium.value; }
    return { ok: true, value };
  };
  function populateBidForm(lot) {
    const f = $('bid-form').elements;
    const terms = lot?.activeBid ?? lot?.plannedBid;
    for (const [field, value] of Object.entries(editorFormValues.bid(lot))) f[field].value = value;
    calculatorCostEstimate = lot?.costEstimate?.currency === f.currency.value ? structuredClone(lot.costEstimate) : null;
    // The calculator refills only for another coin or for saved terms that changed (it compares this key), so what the
    // collector typed in it survives every other re-render, and a bid just saved is followed.
    const termsKey = lot ? [lot.id, f.currency.value, terms?.amount?.minor ?? '', terms?.buyerPremiumBps ?? '', JSON.stringify(calculatorCostEstimate)].join('|') : null;
    bidCalculator?.setValues({ lotId: termsKey, currency: f.currency.value, hammerMinor: terms?.amount?.minor ?? null, buyerPremiumBps: terms?.buyerPremiumBps ?? null, costEstimate: calculatorCostEstimate });
  }
  // Beside the maximum hammer, what the coin's own saved comparables sold for: in the bid's currency, the other
  // currencies only counted, never converted or pooled, and worded as the collector's own records.
  function renderBidEvidence() {
    const strip = $('bid-evidence'); strip.replaceChildren();
    const lot = (snapshot.lots ?? []).find((item) => item.id === selection.selectedLotId);
    if (!lot) return;
    const reference = String(lot.reference ?? '').trim();
    if (!reference) { strip.append(text('p', 'Add a reference under Details to see your saved comparables here.', 'bid-evidence-figure')); return; }
    const currency = $('bid-form').elements.currency.value;
    const found = lotComparables(snapshot.evidence, reference);
    const own = found.find((item) => item.currency === currency);
    const years = (item) => item.firstYear === null ? '' : `, ${item.firstYear === item.lastYear ? item.firstYear : `${item.firstYear}–${item.lastYear}`}`;
    strip.append(text('p', !own ? `No saved comparables for ${reference} in ${currency}.`
      : own.median ? `Your saved comparables for ${reference}: median ${formatMoney(own.median)} from ${own.count}${years(own)}`
        : `Your saved comparables for ${reference}: ${own.count} in ${currency}, too few for a median${years(own)}`, 'bid-evidence-figure'));
    const others = found.filter((item) => item.currency !== currency);
    if (others.length) strip.append(text('p', `${own ? 'Also' : 'Saved'} ${others.map((item) => `${item.count} in ${item.currency}`).join(', ')}, not converted.`, 'bid-evidence-other'));
    const add = text('button', 'Add comparable', 'quiet'); add.type = 'button'; add.id = 'bid-add-comparable';
    add.addEventListener('click', () => {
      // The set already saved under this reference is the one the Search route opens on, so the new sale joins it.
      const saved = (snapshot.evidence ?? []).flatMap((row) => row.observations ?? []).find((item) => String(item.queryLabel ?? '').trim() === reference);
      $('research-query').value = reference;
      activeQuery = saved ? { id: saved.queryId, text: reference } : { id: requestId(), text: reference };
      selectedQueryId = activeQuery.id;
      routeChangeFromNav = false; location.hash = '#search'; setRoute(); renderEvidence();
      $('evidence-form').elements.auctionHouse.focus();
    });
    strip.append(add);
  }
  $('bid-form').addEventListener('input', (event) => { if (event.target === $('bid-form').elements.currency) renderBidEvidence(); });
  const loadBidEditor = (selectedLot) => {
    const lot = selectedLot ?? snapshot.lots.find((item) => item.id === $('bid-form').elements.lotId.value);
    setBasis('bid', lot ? { id: lot.id, revision: lot.revision, record: structuredClone(lot) } : { id: null, revision: null, record: null });
    populateBidForm(lot);
  };
  bidCalculator = mountBidCalculator($('workspace-calculator'), { currency: snapshot.preferences?.currency ?? 'USD', compact: false, onUseHammer: ({ hammer, buyerPremiumBps, costEstimate }) => {
    calculatorCostEstimate = costEstimate ?? null;
    const f = $('bid-form').elements; f.amount.value = moneyInputText(hammer, navigator.language); f.currency.value = hammer.currency; f.premium.value = premiumInputText(buyerPremiumBps);
    for (const control of [f.amount, f.currency, f.premium]) control.dispatchEvent(new Event('input', { bubbles: true }));
  } });
  $('bid-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('bid'); const parsed = bidMoney(f); if (!basis?.id || !parsed.ok) return announce(parsed.error?.message ?? 'Choose a lot.', true); const action = event.submitter?.value; if (action === 'place' && !confirm('Confirm that this bid is already active at the auction house.')) return; void send(buildBidSaveCommand(action, basis, parsed.value, calculatorCostEstimate), 'bid'); });
  $('cancel-bid').addEventListener('click', () => { const basis = editorBases.get('bid'); if (basis?.record?.activeBid && confirm('Confirm that you cancelled this bid outside the extension.')) void send({ type: 'bid.cancel', requestId: requestId(), lotId: basis.id, expectedRevision: basis.revision }, 'bid'); });

  function renderEvents() {
    const list = $('event-list'); list.replaceChildren();
    for (const event of snapshot.auctionEvents ?? []) { const card = text('article', '', 'record'); card.append(text('h3', event.name)); card.append(eventLine(event, '', 'p', false)); const edit = text('button', 'Edit auction'); edit.type = 'button'; edit.addEventListener('click', () => openEventEditor(event)); card.append(edit); list.append(card); }
    // A reminder that went off while the browser was closed is missed: listed with the due ones, acknowledged with
    // them, and never snoozed back into a moment already past.
    const due = (snapshot.alerts ?? []).filter((alert) => ['due', 'claimed', 'delivered', 'snoozed', 'missed'].includes(alert.status)); const alerts = $('alert-list'); const alertLabel = { due: 'Due', claimed: 'Being delivered', delivered: 'Delivered', snoozed: 'Snoozed', missed: 'Missed' };
    alerts.replaceChildren(...due.map((alert) => text('p', `${alertLabel[alert.status]} · ${eventsById.get(alert.eventId)?.name ?? 'Auction'}`, `record${alert.status === 'missed' ? ' alert-missed' : ''}`)));
    $('ack-alerts').dataset.ids = due.map((item) => item.triggerId ?? item.id).join(',');
    $('snooze-alerts').dataset.ids = due.filter((item) => item.status !== 'missed').map((item) => item.triggerId ?? item.id).join(',');
    if (bridge) { $('ack-alerts').disabled = !due.length; $('snooze-alerts').disabled = !$('snooze-alerts').dataset.ids; }
  }
  // Opening the auction editor from anywhere but a coin's "Add auction" drops the coin it would
  // otherwise attach itself to when saved.
  const openEventEditor = (event) => { eventReturnLot = null; zoneChosen = false; $('event-form').hidden = false; $('delete-event').hidden = !event; beginEditor('event', event ? { id: event.id, revision: event.revision, record: structuredClone(event) } : { id: null, revision: null, record: null }); if (event) populateEventForm(event); else { $('event-form').reset(); $('event-form').elements.id.value = ''; setEventZone(viewerTimeZone()); syncReminderChoices(); updatePrecision(); updateEventSummary(); } $('event-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('event-form').elements.name.focus(); };
  $('new-event').addEventListener('click', () => openEventEditor(null));
  $('edit-selected-event').addEventListener('click', () => { const event = (snapshot.auctionEvents ?? []).find((item) => item.id === $('edit-selected-event').dataset.eventId); routeChangeFromNav = false; location.hash = '#auctions'; openEventEditor(event ?? null); if (!event) eventReturnLot = structuredClone((snapshot.lots ?? []).find((lot) => lot.id === selection.selectedLotId) ?? null); });
  const populateEventForm = (event) => {
    const f = $('event-form').elements;
    for (const key of ['id', 'name', 'eventKind', 'localDate', 'localTime', 'reminderScope', 'capturedText', 'capturedFromUrl']) if (f[key]) f[key].value = event[key] ?? '';
    $('delete-event').hidden = !event.id;
    setEventZone(event.timeZone ?? viewerTimeZone());
    f.precision.value = event.precision ?? 'timed';
    setReminderControls(f.precision.value, reminderControlsForPrecision(event.reminders ?? [], f.precision.value));
    lastEventPrecision = f.precision.value;
    updatePrecision(); updateEventSummary();
  };
  // The time zone is picked from the browser's list; a name the list lacks is kept and shown under "Other…".
  const zoneChoices = (() => { let zones = []; try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* no list: Other… only */ } return [...new Set([...zones, 'UTC', viewerTimeZone()])].sort(); })();
  $('event-form').elements.timeZoneChoice.replaceChildren(...zoneChoices.map((zone) => { const option = text('option', zone.replaceAll('_', ' ')); option.value = zone; return option; }), (() => { const option = text('option', 'Other…'); option.value = 'other'; return option; })());
  // Whether the collector chose this form's zone: a zone they chose is never replaced by a remembered one.
  let zoneChosen = false;
  function setEventZone(zone, { note = '' } = {}) {
    const f = $('event-form').elements; const listed = zoneChoices.includes(zone);
    f.timeZone.value = zone; f.timeZoneChoice.value = listed ? zone : 'other'; $('time-zone-other').hidden = listed;
    $('time-zone-note').textContent = note; $('time-zone-note').hidden = !note;
  }
  // A new auction takes the zone the collector gave the same house's last auction, and says which auction that was.
  const offerRememberedZone = () => {
    const basis = editorBases.get('event');
    if (zoneChosen || basis?.id) return;
    const remembered = rememberedZone(snapshot.auctionEvents, $('event-form').elements.name.value);
    if (remembered) setEventZone(remembered.timeZone, { note: `The time zone of your last auction from this house, ${remembered.from}. Change it if this one differs.` });
    else if ($('time-zone-note').textContent) setEventZone(viewerTimeZone());
  };
  // Two reminder choices for a timed auction, a custom number of minutes only when asked for.
  const PRESET_OFFSETS = ['1440', '60', '30'];
  const reminderChoice = (enabled, minutes) => !enabled ? 'off' : PRESET_OFFSETS.includes(String(minutes)) ? String(minutes) : 'custom';
  function syncReminderChoices() {
    const f = $('event-form').elements;
    $('reminder-first-custom').hidden = f.reminderFirst.value !== 'custom';
    $('reminder-second-custom').hidden = f.reminderSecond.value !== 'custom';
  }
  const setReminderControls = (precision, controls) => {
    const f = $('event-form').elements;
    if (precision === 'date-only') {
      f.reminderDayBefore.checked = controls.firstEnabled; f.reminderDayBeforeTime.value = controls.firstValue;
      f.reminderDayOf.checked = controls.secondEnabled; f.reminderDayOfTime.value = controls.secondValue;
    } else {
      f.reminderFirst.value = reminderChoice(controls.firstEnabled, controls.firstValue); f.reminderFirstMinutes.value = String(controls.firstValue);
      f.reminderSecond.value = reminderChoice(controls.secondEnabled, controls.secondValue); f.reminderSecondMinutes.value = String(controls.secondValue);
      syncReminderChoices();
    }
  };
  // The timed reminders as the form holds them: on or off, and the minutes before; null while a custom count is no count.
  const timedReminderControls = () => {
    const f = $('event-form').elements;
    const read = (choice, custom) => (choice === 'custom' ? Number(custom) : Number(choice));
    const controls = { firstEnabled: f.reminderFirst.value !== 'off', firstValue: read(f.reminderFirst.value, f.reminderFirstMinutes.value), secondEnabled: f.reminderSecond.value !== 'off', secondValue: read(f.reminderSecond.value, f.reminderSecondMinutes.value) };
    const valid = (enabled, value) => !enabled || (Number.isInteger(value) && value >= 1);
    return valid(controls.firstEnabled, controls.firstValue) && valid(controls.secondEnabled, controls.secondValue) ? controls : null;
  };
  const updatePrecision = () => { const f = $('event-form').elements; const dateOnly = f.precision.value === 'date-only'; $('event-time-label').hidden = dateOnly; f.localTime.required = !dateOnly; $('timed-reminders').hidden = dateOnly; f.reminderDayBefore.parentElement.hidden = !dateOnly; f.reminderDayOf.parentElement.hidden = !dateOnly; $('date-only-reminder-note').hidden = !dateOnly; };
  // What Save auction will write, in words, where a confirm dialog used to ask.
  function updateEventSummary() {
    const f = $('event-form').elements;
    const dateOnly = f.precision.value === 'date-only';
    const kind = ({ 'auction-starts': 'auction starting', 'lot-closes': 'lot closing', 'auction-day': 'auction day' })[f.eventKind.value] ?? 'auction';
    const format = (options, date, fallback) => { try { return new Intl.DateTimeFormat(navigator.language, { ...options, timeZone: 'UTC' }).format(date); } catch { return fallback; } };
    const day = /^\d{4}-\d{2}-\d{2}$/.test(f.localDate.value) ? format({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }, new Date(`${f.localDate.value}T12:00:00Z`), f.localDate.value) : 'no date yet';
    const time = dateOnly ? ', date only' : /^\d{2}:\d{2}$/.test(f.localTime.value) ? `, ${format({ hour: 'numeric', minute: '2-digit' }, new Date(`1970-01-01T${f.localTime.value}:00Z`), f.localTime.value)}` : '';
    let reminders;
    if (dateOnly) {
      const parts = [f.reminderDayBefore.checked ? `the day before at ${f.reminderDayBeforeTime.value}` : '', f.reminderDayOf.checked ? `on the day at ${f.reminderDayOfTime.value}` : ''].filter(Boolean);
      reminders = parts.length ? `reminders ${parts.join(' and ')}` : 'no reminders';
    } else {
      const controls = timedReminderControls();
      const parts = controls ? [[controls.firstEnabled, controls.firstValue], [controls.secondEnabled, controls.secondValue]].filter(([enabled]) => enabled).map(([, minutes]) => reminderLabel({ kind: 'offset', offsetMinutes: minutes }).replace(/ before$/, '')) : [];
      reminders = !controls ? 'a custom reminder still to fill in' : parts.length ? `reminders ${parts.join(' and ')} before` : 'no reminders';
    }
    $('event-summary').textContent = `Saves “${f.name.value.trim() || 'this auction'}”: ${kind} ${day}${time} ${f.timeZone.value.trim() || '(no time zone)'}, with ${reminders}.`;
  }
  $('event-form').addEventListener('input', (event) => { if (event.target === $('event-form').elements.name) offerRememberedZone(); else if (event.target === $('event-form').elements.timeZone) zoneChosen = true; updateEventSummary(); });
  $('event-form').addEventListener('change', (event) => {
    const f = $('event-form').elements;
    if (event.target === f.timeZoneChoice) {
      zoneChosen = true; $('time-zone-note').hidden = true;
      const other = f.timeZoneChoice.value === 'other';
      $('time-zone-other').hidden = !other;
      if (other) f.timeZone.focus(); else f.timeZone.value = f.timeZoneChoice.value;
    }
    if (event.target === f.reminderFirst || event.target === f.reminderSecond) syncReminderChoices();
    if (event.target.name === 'precision') {
      const precision = event.target.value;
      if (precision !== lastEventPrecision) setReminderControls(precision, reminderControlsForPrecision(createEventDraft(precision).reminders, precision));
      lastEventPrecision = precision;
      updatePrecision();
    }
    updateEventSummary();
  }); updatePrecision();
  $('event-form').hidden = true;
  $('event-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('event') ?? { id: null, revision: null };
    const timed = f.precision.value === 'date-only' ? null : timedReminderControls();
    if (f.precision.value !== 'date-only' && !timed) return announce('Enter the minutes before for a custom reminder: a whole number from 1.', true);
    const reminders = mergeEventReminders(basis.record?.reminders, f.precision.value, timed ?? { firstEnabled: f.reminderDayBefore.checked, firstValue: f.reminderDayBeforeTime.value, secondEnabled: f.reminderDayOf.checked, secondValue: f.reminderDayOfTime.value });
    const eventDraft = { ...(basis.id ? { id: basis.id } : {}), name: f.name.value.trim(), eventKind: f.eventKind.value, precision: f.precision.value, localDate: f.localDate.value, timeZone: f.timeZone.value.trim(), reminderScope: f.reminderScope.value, reminders }; if (f.precision.value === 'timed') eventDraft.localTime = f.localTime.value; for (const key of ['capturedText', 'capturedFromUrl']) if (f[key].value) eventDraft[key] = f[key].value; const submittedReturnLot = eventReturnLot; const submittedEventVersion = editorVersions.get('event') ?? 0; void send({ type: 'event.save', requestId: requestId(), expectedRevision: basis.revision, event: eventDraft }, 'event').then((reply) => {
      if (!reply?.ok) return;
      if (eventDraftId) { const draftId = eventDraftId; eventDraftId = null; void send({ type: 'draft.consume', requestId: requestId(), draftId }); }
      const decision = eventAttachDecision({
        returnLot: submittedReturnLot, currentReturnLot: eventReturnLot,
        submittedVersion: submittedEventVersion, currentVersion: editorVersions.get('event') ?? 0,
        selectedLotId: selection.selectedLotId, snapshot, eventId: reply.value?.id,
      });
      if (decision.action === 'none') return;
      if (eventReturnLot === submittedReturnLot) eventReturnLot = null;
      if (decision.action === 'message') return announce(decision.message, true);
      const attach = buildAttachEventCommand(decision.lot, decision.eventId);
      if (!attach) return announce('Auction saved, but its confirmed identity was unavailable. Attach it from coin details.', true);
      void send(attach).then((attached) => { if (attached?.ok) { routeChangeFromNav = false; location.hash = '#watchlist'; announce('Auction saved and attached to the coin.'); } });
    }); });
  $('delete-event').addEventListener('click', () => { const basis = editorBases.get('event'); if (basis?.id && confirm(`Remove “${basis.record.name}”?`)) void send({ type: 'event.delete', requestId: requestId(), eventId: basis.id, expectedRevision: basis.revision }, 'event'); });
  const displayedAlertIds = (button) => String($(button).dataset.ids ?? '').split(',').filter(Boolean);
  $('ack-alerts').addEventListener('click', () => void send({ type: 'alert.ack', requestId: requestId(), triggerIds: displayedAlertIds('ack-alerts') }));
  $('snooze-alerts').addEventListener('click', () => void send({ type: 'alert.snooze', requestId: requestId(), triggerIds: displayedAlertIds('snooze-alerts'), snoozedUntil: new Date(Date.now() + 15 * 60_000).toISOString() }));
  $('mark-all-read').addEventListener('click', () => void send({ type: 'alert.markAllRead', requestId: requestId() }));
  $('enable-notifications').addEventListener('click', async () => { if (!bridge) return; if (!snapshot.preferences) return announce('Preferences are not ready. Reload and try again.', true); const allowed = await bridge.requestNotificationPermission(); const current = snapshot.preferences; void send({ type: 'preferences.save', requestId: requestId(), expectedRevision: current.revision, preferences: { currency: current.currency, desktopAlertsEnabled: allowed } }); });

  function renderExposure() { const root = $('exposure-list'); root.replaceChildren(); const sections = buildExposureSections(snapshot); if (!sections.length) return root.append(text('p', 'No externally active bids.')); for (const section of sections) { const card = text('article', '', 'exposure-card'); card.append(text('h3', section.currency)); card.append(text('div', formatMoney({ currency: section.currency, minor: section.hammerMinor }), 'exposure-total')); card.append(text('p', `Binding hammer · ${section.bindingCount} bid${section.bindingCount === 1 ? '' : 's'}`)); card.append(text('p', `Known hammer + BP ${formatMoney({ currency: section.currency, minor: section.knownHammerPlusBpMinor })}`)); if (section.unknownPremiumCount) card.append(text('p', `Incomplete — premium unknown for ${section.unknownPremiumCount} bid${section.unknownPremiumCount === 1 ? '' : 's'}`)); for (const event of section.events) card.append(text('p', `${event.name}: ${formatMoney({ currency: section.currency, minor: event.hammerMinor })}`)); root.append(card); } }

  // One row per currency, each in its own money: a hammer or invoice total covers the entries that
  // recorded one, and says how many of the currency's entries that is when it is not all of them.
  function collectionTotalsTable(view) {
    const wrap = text('div', '', 'table-scroll');
    const table = document.createElement('table'); table.id = 'collection-totals'; table.className = 'collection-totals';
    table.append(text('caption', 'Your recorded totals by currency'));
    const head = document.createElement('thead'); const headRow = document.createElement('tr');
    for (const label of ['Currency', 'Entries', 'Hammer', 'Invoice paid', 'Acquired']) { const cell = text('th', label); cell.setAttribute('scope', 'col'); headRow.append(cell); }
    head.append(headRow);
    const years = (totals) => totals.firstYear === null ? '—' : totals.firstYear === totals.lastYear ? String(totals.firstYear) : `${totals.firstYear}–${totals.lastYear}`;
    const total = (currency, minor, count, of) => {
      if (!count) return 'None recorded';
      const amount = minor === null ? 'Too large to total' : formatMoney({ currency, minor });
      return count < of ? `${amount} (${count} of ${of})` : amount;
    };
    const body = document.createElement('tbody');
    const row = (cells) => { const tr = document.createElement('tr'); const [first, ...rest] = cells; const header = text('th', first); header.setAttribute('scope', 'row'); tr.append(header, ...rest.map((value) => text('td', value))); body.append(tr); };
    for (const [currency, totals] of Object.entries(view.byCurrency)) {
      row([currency, String(totals.entryCount), total(currency, totals.hammerMinor, totals.hammerCount, totals.entryCount), total(currency, totals.invoiceMinor, totals.invoiceCount, totals.entryCount), years(totals)]);
    }
    if (view.unpriced.entryCount) row(['No amount recorded', String(view.unpriced.entryCount), '—', '—', years(view.unpriced)]);
    table.append(head, body); wrap.append(table);
    return wrap;
  }
  // The collector's own evidence for the entry's coin, worded as that and never as a value.
  const collectionComparablesLabel = (item) => {
    const comparables = item?.comparables;
    if (!comparables || comparables.status === 'no-reference') return 'No saved comparables: the coin has no reference to match';
    if (comparables.status === 'no-currency') return 'No saved comparables: no amount recorded, so no currency to compare in';
    if (comparables.status === 'none') return `No saved comparables for ${item.reference} in ${comparables.currency}`;
    if (comparables.status === 'too-few') return `Your saved comparables for ${item.reference}: ${comparables.count} in ${comparables.currency}, too few for a median`;
    return `Your saved comparables for ${item.reference}: median ${formatMoney(comparables.median)} from ${comparables.count} in ${comparables.currency}`;
  };
  function renderHistory() {
    const root = $('history-list'); root.replaceChildren();
    for (const lot of (snapshot.lots ?? []).filter((item) => item.outcome?.status !== 'open')) { const card = text('article', '', 'record'); card.append(text('h3', `${lot.title} · ${lotStatusLabel(lot)}`)); if (lot.outcome.hammer) card.append(text('p', `Hammer ${formatMoney(lot.outcome.hammer)}`)); if (lot.outcome.actualInvoice) card.append(text('p', `Actual invoice ${formatMoney(lot.outcome.actualInvoice)} (your recorded total)`)); card.append(text('p', `${lot.bidHistory?.length ?? 0} recorded bid change${lot.bidHistory?.length === 1 ? '' : 's'}`)); root.append(card); }
    const collection = $('collection-list'); collection.replaceChildren(text('h3', 'Collection entries'));
    const view = projectCollection(snapshot);
    const viewByEntry = new Map(view.entries.map((item) => [item.id, item]));
    if (!view.entries.length) collection.append(text('p', 'No collection entries yet.', 'field-note'));
    else {
      collection.append(text('p', 'From your own records: the amounts you entered and the comparables you saved. This is not an appraisal or a valuation, and no amount is converted between currencies.', 'field-note collection-note'));
      collection.append(collectionTotalsTable(view));
    }
    for (const entry of snapshot.collectionEntries ?? []) {
      const card = text('article', '', 'record'); card.append(text('p', `${entry.title} · ${entry.acquisitionDate}${entry.reviewReason ? ` · review: ${entry.reviewReason}` : ''}`));
      card.append(text('p', collectionComparablesLabel(viewByEntry.get(entry.id)), 'collection-comparables'));
      if (entry.reviewReason) { const actions = text('div', '', 'actions'); for (const decision of ['keep', 'remove']) { const button = text('button', decision === 'keep' ? 'Keep collection entry' : 'Remove collection entry'); button.type = 'button'; button.addEventListener('click', () => void send({ type: 'collection.review.resolve', requestId: requestId(), collectionEntryId: entry.id, expectedRevision: entry.revision, decision })); actions.append(button); } card.append(actions); }
      collection.append(card);
    }
  }
  // The re-open question and the "Still open" choice belong to a settled lot only: on an open lot both are no-ops.
  const updateOutcomeVisibility = () => {
    const f = $('outcome-form').elements; const lot = editorBases.get('outcome')?.record;
    const settled = ['won', 'lost'].includes(lot?.outcome?.status);
    $('passed-outcome').disabled = Boolean(lot?.activeBid); $('passed-help').hidden = !$('passed-outcome').disabled;
    $('open-outcome').closest('label').hidden = !lot?.outcome?.status || lot.outcome.status === 'open';
    $('reopen-choice').hidden = !(settled && f.status.value === 'open');
  };
  const showAcquisitionError = (message) => { $('acquisition-error').textContent = message; $('acquisition-error').hidden = !message; };
  const localToday = () => { try { return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', numberingSystem: 'latn' }).format(new Date()); } catch { return ''; } };
  function populateOutcomeForm(lot) {
    const f = $('outcome-form').elements;
    const draft = outcomeDraftForLot(lot, navigator.language, { defaultCurrency: snapshot.preferences?.currency ?? 'USD', event: eventsById.get(lot?.auctionEventId) ?? null, today: localToday() });
    f.status.value = draft.status; f.hammer.value = draft.hammer; f.hammer.placeholder = draft.hammerPlaceholder; f.hammerCurrency.value = draft.hammerCurrency; f.invoice.value = draft.invoice; f.invoiceCurrency.value = draft.invoiceCurrency; f.bindingActive.value = draft.bindingActive; f.addToCollection.checked = false; f.acquisitionDate.value = draft.acquisitionDate; f.collectionNotes.value = ''; showAcquisitionError(''); updateOutcomeVisibility();
  }
  const loadOutcomeEditor = (selectedLot) => {
    const lot = selectedLot ?? snapshot.lots.find((item) => item.id === $('outcome-form').elements.lotId.value);
    setBasis('outcome', lot ? { id: lot.id, revision: lot.revision, record: structuredClone(lot) } : { id: null, revision: null, record: null });
    populateOutcomeForm(lot);
  };
  $('outcome-form').addEventListener('change', (event) => { if (event.target.name === 'lotId') loadOutcomeEditor(); else if (event.target.name === 'status') updateOutcomeVisibility(); });
  $('outcome-form').addEventListener('submit', (event) => { event.preventDefault(); const f = event.currentTarget.elements; const basis = editorBases.get('outcome'); const lot = basis?.record; if (!lot) return announce('Choose a lot.', true); const status = f.status.value; const outcome = { status }; if (['won', 'lost'].includes(status)) { if (f.hammer.value) { const money = parseMoney(f.hammer.value, f.hammerCurrency.value, navigator.language); if (!money.ok) return announce(money.error.message, true); outcome.hammer = money.value; } if (f.invoice.value) { const money = parseMoney(f.invoice.value, f.invoiceCurrency.value, navigator.language); if (!money.ok) return announce(money.error.message, true); outcome.actualInvoice = money.value; } } if (status === 'open' && ['won', 'lost'].includes(lot.outcome.status)) { if (!f.bindingActive.value) return announce('Choose whether the prior binding terms are externally active.', true); outcome.bindingActive = f.bindingActive.value === 'true'; } const command = { type: 'lot.outcome.set', requestId: requestId(), lotId: lot.id, expectedRevision: basis.revision, outcome }; if (status === 'won' && f.addToCollection.checked && !f.acquisitionDate.value) { showAcquisitionError('Enter the acquisition date to add this coin to the collection.'); return f.acquisitionDate.focus(); } showAcquisitionError(''); if (status === 'won' && f.addToCollection.checked) command.addToCollection = { title: lot.title, acquisitionDate: f.acquisitionDate.value, sourceLinks: lot.sourceLinks ?? [], ...(f.collectionNotes.value ? { notes: f.collectionNotes.value } : {}) }; void send(command, 'outcome'); });

  function resetEditor(editor) {
    const form = $(`${editor}-form`);
    if (!form) return;
    form.reset();
    if (editor === 'lot' || editor === 'event') form.elements.id.value = '';
    if (editor === 'lot') clearPageValues();
    if (editor === 'event') { eventReturnLot = null; lastEventPrecision = form.elements.precision.value; setEventZone(viewerTimeZone()); syncReminderChoices(); updatePrecision(); form.hidden = true; }
    if (editor === 'group') form.hidden = true;
  }
  async function loadRouteDraft() {
    if (!bridge) return;
    const match = /^#(event-draft|research-draft|lot-draft)=([^&]+)$/.exec(location.hash);
    if (!match) return;
    let reply;
    try { reply = await bridge.sendCommand({ type: 'draft.get', requestId: requestId(), draftId: decodeURIComponent(match[2]) }); }
    catch { return announce(WORKER_UNREACHABLE, true); }
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
      if (values.photoUrl) form.elements.photoUrl1.value = values.photoUrl;
      if (values.estimateNote) form.elements.notes.value = values.estimateNote;
      $('provenance-editor').replaceChildren();
      clearPageValues();
      showPageValues(values, values.auctionContext?.pageUrl || values.sourceUrl);
      for (const entry of values.provenance ?? []) appendProvenanceEditor({ text: entry.text, sourceUrl: values.auctionContext?.pageUrl || values.sourceUrl }, entry);
      beginEditor('lot', { id: null, revision: null, record: null });
      dirtyEditors.add('lot');
      openFilledGroups(); updateDirtyMarks();
      form.elements.title.focus();
      announce('Reference draft loaded. Review the lot details, then save to add it to the watchlist.');
    } else {
      researchDraftId = draft.id; $('research-query').value = draft.payload.rawText ?? ''; activeQuery = { id: requestId(), text: $('research-query').value.trim() }; selectedQueryId = activeQuery.id; renderEvidence(); $('research-query').focus();
      announce('Captured research text loaded. Edit it before opening a source or saving evidence.');
    }
  }
  // An auction or group form left open follows committed data until the collector edits it, and
  // following it is not editing: the edit version stays where the collector left it.
  function renderOpenRecordForms() {
    for (const editor of ['event', 'group']) {
      const basis = editorBases.get(editor);
      if ($(`${editor}-form`).hidden || dirtyEditors.has(editor) || !basis?.id) continue;
      const record = editorRecord(snapshot, editor, basis.id);
      if (!record) { editorBases.delete(editor); resetEditor(editor); continue; }
      setBasis(editor, { ...basis, revision: record.revision, record: structuredClone(record) });
      populateEditor(editor);
    }
  }
  function renderAll() { renderEvidence(); renderLots(); renderEvents(); renderExposure(); renderHistory(); renderOpenRecordForms(); updateDirtyMarks(); }
  setRoute();
  if (!bridge) { $('runtime-note').hidden = false; document.querySelectorAll('[data-needs-runtime]').forEach((item) => { item.disabled = true; }); renderAll(); announce('Standalone preview: durable features are unavailable.'); }
  else {
    // Only the calls into the background worker mean "unreachable"; a failure while rendering is a
    // defect in this page and has to be visible rather than dressed up as a worker outage.
    let initialized = null;
    try { initialized = initializeCompanionPreferences ? await initializeCompanionPreferences(bridge, localStorage) : await bridge.getSnapshot(); }
    catch { initialized = null; }
    try {
      if (!initialized) { renderAll(); announce(WORKER_UNREACHABLE, true); }
      else if (!initialized.ok) { renderAll(); announce(initialized.message, true); }
      else if (!acceptIncoming(initialized.value)) announce(LOADED);
      await loadRouteDraft();
    } catch (error) {
      console.error(error);
      announce('The workspace could not finish loading. Reload this page to try again.', true);
    }
    bridge.subscribeToSnapshots((incoming) => { acceptIncoming(incoming); });
  }
}

if (typeof document !== 'undefined') void initWorkspace();
