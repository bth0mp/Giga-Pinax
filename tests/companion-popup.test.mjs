import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseHtmlFile } from './helpers/dom.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));

// The page's own surroundings, hand-made as the other popup tests make them: the extension API answers what each case is about, and the listeners the
// page registers on the window are kept so a result card can be delivered to it afterwards.
let answerCommand = async () => ({ ok: true });
let answerTabs = async () => [{ id: 3, url: 'https://auction.example/27', title: 'Lot 27' }];
let answerScript = async () => [{ result: { pageTitle: 'Lot 27', pageUrl: 'https://auction.example/27', candidates: {} } }];
const cardListeners = [];
globalThis.browser = {
  runtime: { sendMessage: (command) => answerCommand(command) },
  storage: { onChanged: { addListener() {}, removeListener() {} } },
  tabs: { query: (query) => answerTabs(query), create: async () => ({ id: 9 }) },
  scripting: { executeScript: (request) => answerScript(request) },
};
const lookupListeners = [];
const watchListeners = [];
const keyListeners = [];
globalThis.addEventListener = (type, listener) => {
  if (type === 'keydown') keyListeners.push(listener);
  if (type === 'giga-pinax-card') cardListeners.push(listener);
  if (type === 'giga-pinax-lookup-received') lookupListeners.push(listener);
  if (type === 'giga-pinax-watch') watchListeners.push(listener);
};
globalThis.dispatchEvent = () => true;
globalThis.requestAnimationFrame = (callback) => { callback(); return 0; };
// The status line clears itself after some seconds; that timer must not keep this file running once its tests are done.
const nodeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, wait, ...rest) => {
  const timer = nodeSetTimeout(callback, wait, ...rest);
  if (wait >= 1000) timer.unref?.();
  return timer;
};

// Imported after the surroundings exist: browser-api.js takes up the extension API as it is evaluated, and the page starts itself where a document is.
const {
  buildWatchlistDraftPayload,
  buildWatchlistSummary,
  canSaveWatchlist,
  extensionRuntimeAvailable,
  documentMode,
  shouldRevealRefine,
  captureCurrentPage,
  captureControlsState,
  captureTabQuery,
  capturableTab,
  runVisibleAction,
  moveCompanionTab,
  watchlistPayloadFromCapture,
  createDraftSaver,
  clearAuctionContextFromPayload,
  replaceAuctionContextInPayload,
  directLotFromPayload,
  savesDirectly,
  savedLotsFor,
  coinsToWatch,
  savedPillText,
  savedLineText,
  dueText,
  watchlistCountText,
} = await import('../extension/companion-popup.js');
const { wantPillText } = await import('../extension/core/wantlist.js');

class TestElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.dataset = {};
    this.options = [];
    this.children = [];
    this.listeners = new Map();
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener() {}
  emit(type, detail = {}) {
    const event = { target: this, preventDefault() {}, ...detail };
    return Promise.all((this.listeners.get(type) ?? []).map((listener) => listener(event)));
  }
  // As the page reaches the research half's own handlers: the same listeners, run synchronously.
  dispatchEvent(event) { void this.emit(event?.type); return true; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { delete this[name]; }
  querySelectorAll() { return []; }
  focus() { this.focused = true; }
}

let loaded = 0;
// The element map of the page that holds the document, until the next one takes it over.
let started = null;
// Starts the real page: its own document, its own extension replies, and the card event the result panel sends it once it is running.
async function loadCompanion({ sendMessage, tabs, script, blockedLocalStorage = false, search = '',
  currency = 'USD', currencyChanges = [] }) {
  // A start-up reads globalThis.document where it resumes, not where it began, so a page still
  // starting when this one takes the document over would finish inside it and answer for it - the
  // wait below would then end on that page's word rather than this one's. The page before this one
  // has the document until it has had its last word in it.
  for (let tick = 0; started && tick < 200 && started('companion-tab-research')['aria-selected'] !== 'true'; tick += 1) await settle();
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new TestElement(id));
    return elements.get(id);
  };
  answerCommand = sendMessage;
  if (tabs) answerTabs = tabs;
  if (script) answerScript = script;
  // popup.js is the other half of this document and is not loaded here, so its own change handler -
  // the one that clears the prices, refreshes the acsearch link and writes the display cache - stands
  // in as a recorder: the select opens on the cached choice, and every change it is put through lands
  // in currencyChanges.
  element('currency').value = currency;
  element('currency').addEventListener('change', () => currencyChanges.push(element('currency').value));
  // As popup.html starts: the notes and the capture's error are hidden, and the two save buttons wait for something to save.
  for (const id of ['storage-note', 'companion-runtime-note', 'companion-capture-error']) element(id).hidden = true;
  for (const id of ['companion-save-watchlist', 'companion-capture-watchlist']) element(id).disabled = true;
  globalThis.document = {
    documentElement: new TestElement('html'),
    getElementById: element,
    createElement: () => new TestElement(),
    querySelectorAll: () => [],
  };
  globalThis.location = { search };
  if (blockedLocalStorage) Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Site data is blocked.'); } });
  else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
  // Each page keeps its giga-pinax-card listener for as long as it lives; the pages started before this one are never driven again, so they are let go
  // here rather than piling up on globalThis for the rest of the file.
  cardListeners.length = 0;
  keyListeners.length = 0;
  lookupListeners.length = 0;
  watchListeners.length = 0;
  started = element;
  await import(`../extension/companion-popup.js?start=${++loaded}`);
  // Start-up loads its own modules, so it finishes several turns later: the research tab being selected is its last word.
  for (let tick = 0; tick < 100 && element('companion-tab-research')['aria-selected'] !== 'true'; tick += 1) await settle();
  await settle();
  // Only this page's own listener, so an earlier case's page cannot answer for it.
  return {
    element,
    card: (detail) => cardListeners[0]?.({ type: 'giga-pinax-card', detail }),
    lookupReceived: () => lookupListeners[0]?.({ type: 'giga-pinax-lookup-received' }),
    watch: (detail) => watchListeners[0]?.({ type: 'giga-pinax-watch', detail }),
    key: (event) => { const sent = { preventDefault() { sent.prevented = true; }, ...event }; keyListeners[0]?.(sent); return sent; },
    setTabs: (answer) => { answerTabs = answer; },
    async click(id) { await element(id).emit('click'); for (let tick = 0; tick < 20; tick += 1) await settle(); },
    async type(field, value) { element(`companion-capture-${field}`).value = value; await element(`companion-capture-${field}`).emit('input'); },
  };
}

test('capture controls prevent edits and stale actions while extraction is pending', () => {
  assert.equal(captureControlsState(true, true).editorVisible, false);
  assert.equal(captureControlsState(true, true).fieldsDisabled, true);
  assert.equal(captureControlsState(false, false).actionsDisabled, true);
  assert.equal(captureControlsState(false, true).actionsDisabled, false);
});

test('navigation failures and thrown errors become visible action results', async () => {
  assert.deepEqual(await runVisibleAction(async () => ({ ok: false, message: 'Blocked' }), 'Fallback'), { ok: false, message: 'Blocked' });
  assert.deepEqual(await runVisibleAction(async () => { throw new Error('Closed'); }, 'Fallback'), { ok: false, message: 'Closed' });
  assert.deepEqual(await runVisibleAction(async () => undefined, 'Fallback'), { ok: true });
});

// Only the lookup window itself answers a right-click: the panel fallback stands in for a sidebar, so a lookup sent while it is open opens its own window.
test('native panels and the panel fallback ignore pop-out routing, which only the lookup window accepts', () => {
  assert.deepEqual(documentMode('?panel=1'), { panel: true, windowed: false, acceptsLookupMessages: false });
  assert.deepEqual(documentMode('?panel=1&window=1'), { panel: true, windowed: true, acceptsLookupMessages: false });
  assert.deepEqual(documentMode('?window=1'), { panel: false, windowed: true, acceptsLookupMessages: true });
  assert.deepEqual(documentMode(''), { panel: false, windowed: false, acceptsLookupMessages: false });
});

test('ambiguity and guided-field errors reveal refinement', () => {
  // Loop 1 (P-06): a list of types stands outside Refine, so choosing one no longer opens it.
  assert.equal(shouldRevealRefine({ status: 'candidates' }), false);
  assert.equal(shouldRevealRefine({ status: 'too-many' }), true);
  assert.equal(shouldRevealRefine({ status: 'none' }, 'reference-number'), true);
  assert.equal(shouldRevealRefine({ status: 'network' }), false);
});

test('current-page capture stays pinned to the tab selected at action start', async () => {
  let target;
  const queries = [];
  const api = {
    tabs: { query: async (query) => { queries.push(query); return [{ id: 27, title: 'Lot 27', url: 'https://auction.example/27' }]; } },
    scripting: { executeScript: async (request) => {
      target = request.target;
      return [{ result: { pageTitle: 'Extracted lot', pageUrl: 'https://auction.example/27', candidates: {} } }];
    } },
  };
  const capture = await captureCurrentPage(api, async (receiver, method, ...args) => receiver[method](...args));
  assert.deepEqual(target, { tabId: 27 });
  assert.deepEqual(queries, [{ active: true, currentWindow: true }]);
  assert.equal(capture.pageUrl, 'https://auction.example/27');
});

test('the lookup window captures the browser window it was opened from, not itself', () => {
  assert.deepEqual(captureTabQuery({ panel: false, windowed: false }), { active: true, currentWindow: true });
  assert.deepEqual(captureTabQuery({ panel: true, windowed: false }), { active: true, currentWindow: true });
  assert.deepEqual(captureTabQuery({ panel: true, windowed: true }), { active: true, lastFocusedWindow: true, windowType: 'normal' });
  assert.deepEqual(captureTabQuery({ panel: false, windowed: true }), { active: true, lastFocusedWindow: true, windowType: 'normal' });
});

test('only an http or https tab is capturable', () => {
  assert.equal(capturableTab([{ id: 3, url: 'https://auction.example/27' }])?.id, 3);
  assert.equal(capturableTab([{ id: 3, url: 'http://auction.example/27' }])?.id, 3);
  for (const tabs of [undefined, [], [{ id: 3 }], [{ url: 'https://auction.example/27' }], [{ id: 3, url: 'about:newtab' }],
    [{ id: 3, url: 'moz-extension://test/popup.html?window=1' }], [{ id: 3, url: 'file:///C:/lot.html' }]]) {
    assert.equal(capturableTab(tabs), null, JSON.stringify(tabs));
  }
});

test('an unreadable page stores nothing and says where the extension can read one', async () => {
  const unreadable = { tabs: { query: async () => [{ id: 3, url: 'about:newtab', title: 'New tab' }] }, scripting: { executeScript: async () => assert.fail('must not inject') } };
  const refused = { tabs: { query: async () => [{ id: 3, url: 'https://auction.example/27', title: 'Lot 27' }] },
    scripting: { executeScript: async () => { throw new Error('Cannot access contents of the page'); } } };
  const call = async (receiver, method, ...args) => receiver[method](...args);
  for (const api of [unreadable, refused]) {
    await assert.rejects(captureCurrentPage(api, call, { panel: false, windowed: false }),
      { message: 'This page can\'t be read. Open the auction lot in a tab, then select Capture again.' });
  }
  await assert.rejects(captureCurrentPage(unreadable, call, { panel: true, windowed: false }),
    (error) => error.message.startsWith('This page can\'t be read.') && /toolbar button/.test(error.message));
});

test('Research coin waits for a query the Reference box can read', () => {
  assert.deepEqual(captureControlsState(true, true, true), { editorVisible: false, fieldsDisabled: true, actionsDisabled: true, researchDisabled: true });
  assert.deepEqual(captureControlsState(false, true, false), { editorVisible: true, fieldsDisabled: false, actionsDisabled: false, researchDisabled: true });
  assert.deepEqual(captureControlsState(false, true, true), { editorVisible: true, fieldsDisabled: false, actionsDisabled: false, researchDisabled: false });
  assert.deepEqual(captureControlsState(false, false, false), { editorVisible: true, fieldsDisabled: false, actionsDisabled: true, researchDisabled: true });
});

test('companion tabs support click-order keyboard movement without side effects', () => {
  assert.equal(moveCompanionTab('research', 'ArrowRight'), 'calculator');
  assert.equal(moveCompanionTab('research', 'ArrowLeft'), 'watchlist');
  assert.equal(moveCompanionTab('calculator', 'Home'), 'research');
  assert.equal(moveCompanionTab('research', 'End'), 'watchlist');
  assert.equal(moveCompanionTab('watchlist', 'Space'), 'watchlist');
});

test('standalone page detection requires a callable extension message bridge', () => {
  assert.equal(extensionRuntimeAvailable(undefined), false);
  assert.equal(extensionRuntimeAvailable({ runtime: {} }), false);
  assert.equal(extensionRuntimeAvailable({ runtime: { sendMessage() {} } }), true);
});

test('standalone research never enables durable watchlist actions', () => {
  const payload = { target: 'watchlist', title: 'Nero denarius' };
  assert.equal(canSaveWatchlist(false, payload), false);
  assert.equal(canSaveWatchlist(true, payload), true);
  assert.equal(canSaveWatchlist(true, { target: 'watchlist' }), false);
});

test('reviewed current-page fields become a minimal watchlist draft', () => {
  assert.deepEqual(watchlistPayloadFromCapture({
    pageTitle: 'Auction lot 27', pageUrl: 'https://auction.example/lot/27',
    ruler: { value: 'Nero' }, denomination: { value: 'Denarius' }, mint: { value: 'Rome' }, reference: { value: 'RIC 306' },
    observations: [{ amount: 200 }], shownPrices: { median: 180 },
  }), {
    target: 'watchlist', title: 'Nero Denarius Rome', reference: 'RIC 306', pageUrl: 'https://auction.example/lot/27',
    auctionContext: { pageUrl: 'https://auction.example/lot/27' },
  });
});

test('watchlist transfer preserves reviewed auction context', () => {
  assert.deepEqual(buildWatchlistDraftPayload({
    title: 'Lot 27', pageUrl: 'https://auction.example/27',
    auctionContext: { pageUrl: 'https://auction.example/27', canonicalUrl: 'https://auction.example/lots/27', house: 'CNG', saleId: '130', lotNumber: '27' },
  }).auctionContext, { pageUrl: 'https://auction.example/27', canonicalUrl: 'https://auction.example/lots/27', house: 'CNG', saleId: '130', lotNumber: '27' });
});

test('clearing auction context rebuilds an existing card without losing its reference fields', () => {
  assert.deepEqual(clearAuctionContextFromPayload({
    target: 'watchlist', title: 'Nero denarius', reference: 'RIC 306',
    pageUrl: 'https://auction.example/27', auctionContext: { pageUrl: 'https://auction.example/27' },
  }), { target: 'watchlist', title: 'Nero denarius', reference: 'RIC 306', pageUrl: 'https://auction.example/27' });
});

test('a new capture replaces context on an already-built result card', () => {
  const card = { target: 'watchlist', title: 'Nero', reference: 'RIC 306', auctionContext: { pageUrl: 'https://old.test/1' } };
  assert.deepEqual(replaceAuctionContextInPayload(card, { pageUrl: 'https://new.test/2' }), {
    target: 'watchlist', title: 'Nero', reference: 'RIC 306', auctionContext: { pageUrl: 'https://new.test/2' },
  });
});

test('draft saver is single-flight and reuses request and draft identities across retries', async () => {
  let sends = 0; let opens = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const save = createDraftSaver({
    newRequestId: () => 'request-1',
    sendCommand: async (command) => { sends += 1; assert.equal(command.requestId, 'request-1'); await gate; return { ok: true, value: { id: 'draft-1' } }; },
    openDraft: async (id) => { opens += 1; assert.equal(id, 'draft-1'); return opens === 1 ? { ok: false, message: 'blocked' } : { ok: true }; },
  });
  const first = save({ title: 'Nero' });
  assert.strictEqual(save({ title: 'Nero' }), first);
  release();
  assert.equal((await first).ok, false);
  assert.equal((await save({ title: 'Nero' })).ok, true);
  assert.equal(sends, 1);
  assert.equal(opens, 2);
});

test('draft saver drops a definitely rejected payload so corrected input can use a fresh request', async () => {
  const commands = [];
  let next = 0;
  const save = createDraftSaver({
    newRequestId: () => `request-${++next}`,
    sendCommand: async (command) => { commands.push(command); return commands.length === 1 ? { ok: false, error: { code: 'invalid' } } : { ok: true, value: { id: 'draft-2' } }; },
    openDraft: async () => ({ ok: true }),
  });
  assert.equal((await save({ title: '' })).ok, false);
  assert.equal((await save({ title: 'Corrected' })).ok, true);
  assert.deepEqual(commands.map(({ requestId, payload }) => [requestId, payload.title]), [['request-1', ''], ['request-2', 'Corrected']]);
});

test('draft saver preserves request identity after an explicitly unknown storage outcome', async () => {
  const requestIds = [];
  let calls = 0;
  const save = createDraftSaver({
    newRequestId: () => 'request-unknown',
    sendCommand: async (command) => {
      requestIds.push(command.requestId); calls += 1;
      return calls === 1 ? { ok: false, code: 'storage', outcome: 'unknown' } : { ok: true, value: { id: 'draft-known' } };
    },
    openDraft: async () => ({ ok: true }),
  });
  assert.equal((await save({ title: 'Nero' })).ok, false);
  assert.equal((await save({ title: 'Changed but must not replace retry payload' })).ok, true);
  assert.deepEqual(requestIds, ['request-unknown', 'request-unknown']);
});

test('a retained retry belongs to its own coin, and an answerless send is not read for an outcome', async () => {
  const sent = [];
  let replies;
  const save = createDraftSaver({
    newRequestId: () => `request-${sent.length + 1}`,
    sendCommand: async (command) => { sent.push(command); return replies[sent.length - 1]; },
    openDraft: async () => ({ ok: true }),
  });
  replies = [{ ok: false, code: 'storage', outcome: 'unknown' }, { ok: true, value: { id: 'draft-2' } }];
  assert.equal((await save({ reference: 'RIC 306', pageUrl: 'https://auction.example/27' })).ok, false);
  // Another lot, not a retry of the first: the second save must not quietly store the coin the first one held.
  assert.equal((await save({ reference: 'RRC 234/1', pageUrl: 'https://auction.example/44' })).ok, true);
  assert.deepEqual(sent.map(({ requestId, payload }) => [requestId, payload.reference]), [['request-1', 'RIC 306'], ['request-2', 'RRC 234/1']]);

  replies = [undefined, { ok: true, value: { id: 'draft-3' } }];
  sent.length = 0;
  const silent = createDraftSaver({ newRequestId: () => 'request-silent', sendCommand: async () => { sent.push(1); return replies[sent.length - 1]; }, openDraft: async () => ({ ok: true }) });
  assert.equal((await silent({ reference: 'RIC 306' })).ok, false);
  assert.equal((await silent({ reference: 'RIC 306' })).ok, true);
});

// Nothing that arrives after a failed start-up may put the save buttons back: the note stays true until the page is opened again.
test('a companion start-up that cannot reach storage leaves its save buttons disabled for good', async () => {
  const snapshot = { ok: true, value: { lots: [], auctionEvents: [], alerts: [], preferences: { currency: 'USD', revision: 1 } } };
  const cases = [
    ['a refused snapshot', { sendMessage: async () => { throw new Error('Storage is blocked.'); } }, 'Storage is blocked.'],
    ['a background that answers nothing', { sendMessage: async () => undefined }, 'Extension storage is unavailable.'],
  ];
  for (const [name, options, announced] of cases) {
    const page = await loadCompanion(options);
    assert.equal(page.element('storage-note').hidden, false, name);
    assert.equal(page.element('companion-save-watchlist').disabled, true, name);
    assert.equal(page.element('companion-capture-watchlist').disabled, true, name);
    // A reply nobody could read names no reason a collector could act on, so it is never shown as one. It is said in the storage note, which is there
    // for exactly this, never over the panel.
    assert.equal(page.element('storage-note').textContent, announced, name);

    page.card({ title: 'Nero denarius', reference: 'RIC 306' });
    assert.equal(page.element('companion-save-watchlist').disabled, true, name);
    page.element('companion-capture-ruler').value = 'Nero';
    await page.element('companion-capture-ruler').emit('input');
    assert.equal(page.element('companion-capture-watchlist').disabled, true, name);
  }

  // With storage answering, the same card is saveable: the flag is what disabled the others, not the page failing to start at all.
  const working = await loadCompanion({ sendMessage: async () => snapshot });
  assert.equal(working.element('storage-note').hidden, true);
  working.card({ title: 'Nero denarius', reference: 'RIC 306' });
  assert.equal(working.element('companion-save-watchlist').disabled, false);
  working.element('companion-capture-ruler').value = 'Nero';
  await working.element('companion-capture-ruler').emit('input');
  assert.equal(working.element('companion-capture-watchlist').disabled, false);
});

const WORKING_SNAPSHOT = { ok: true, value: { lots: [], auctionEvents: [], alerts: [], preferences: { currency: 'USD', revision: 1 } } };

// A watchlist save goes to extension storage through the background and never touches localStorage, which is read once to carry an old preference over
// and copes with no store at all: a profile that blocks site data costs the remembered appearance and fields, and nothing a collector records.
test('blocked site data costs the remembered preferences, not the watchlist saves', async () => {
  const page = await loadCompanion({ blockedLocalStorage: true, sendMessage: async () => WORKING_SNAPSHOT });
  assert.equal(page.element('storage-note').hidden, false);
  assert.equal(page.element('storage-note').textContent,
    'Appearance and lookup preferences can\'t be remembered in this browser profile. Watchlist records are not affected.');

  page.card({ title: 'Nero denarius', reference: 'RIC 306' });
  assert.equal(page.element('companion-save-watchlist').disabled, false);
  page.element('companion-capture-ruler').value = 'Nero';
  await page.element('companion-capture-ruler').emit('input');
  assert.equal(page.element('companion-capture-watchlist').disabled, false);
});
// The durable root is the one home for the default currency, but the research half has already shown
// and cached the last choice and may have priced a start-up lookup under it: the stored value is
// applied through that half's own change handler, which clears those prices and refreshes its links.
test('the stored currency reaches the research select through its change handler, not past it', async () => {
  const commands = [];
  const currencyChanges = [];
  const reply = async (command) => {
    commands.push(command);
    return command.type === 'preferences.save'
      ? { ok: true, value: { currency: command.preferences.currency, revision: command.expectedRevision + 1 } }
      : { ok: true, value: { lots: [], auctionEvents: [], alerts: [], preferences: { currency: 'GBP', revision: 4 } } };
  };
  const page = await loadCompanion({ sendMessage: reply, currency: 'EUR', currencyChanges });
  assert.equal(page.element('currency').value, 'GBP');
  // The prices the window already fetched under EUR, its acsearch link and the cache all follow.
  assert.deepEqual(currencyChanges, ['GBP']);
  // The stored value is not a choice of the collector's, so nothing is written back over it.
  assert.deepEqual(commands.filter(({ type }) => type === 'preferences.save'), []);

  // A choice of his own is the one that writes, against the revision that was read.
  page.element('currency').value = 'CHF';
  await page.element('currency').emit('change');
  await settle();
  const saved = commands.filter(({ type }) => type === 'preferences.save');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].expectedRevision, 4);
  assert.deepEqual(saved[0].preferences, { currency: 'CHF' });
});

// A default outside the research currencies (SEK) is the collector's bid currency, not a research one: choosing where
// prices are researched in the popup leaves it alone, and the research select keeps the choice on its own.
test('a research currency chosen in the popup never overwrites a default outside the research currencies', async () => {
  const commands = [];
  const currencyChanges = [];
  const reply = async (command) => {
    commands.push(command);
    return command.type === 'preferences.save'
      ? { ok: true, value: { currency: command.preferences.currency, revision: command.expectedRevision + 1 } }
      : { ok: true, value: { lots: [], auctionEvents: [], alerts: [], preferences: { currency: 'SEK', revision: 4 } } };
  };
  const page = await loadCompanion({ sendMessage: reply, currency: 'EUR', currencyChanges });
  assert.equal(page.element('currency').value, 'EUR', 'research stays in its own currency');
  assert.deepEqual(currencyChanges, []);
  page.element('currency').value = 'CHF';
  await page.element('currency').emit('change');
  await settle();
  assert.deepEqual(commands.filter(({ type }) => type === 'preferences.save'), [], 'the SEK default is left as it is');
  assert.notEqual(page.element('storage-note').textContent, 'The currency could not be saved.');
});

// Nothing to clear and nothing to announce: the cache and the stored preference already agree, which
// is what every start-up after the first looks like.
test('a stored currency the research select already shows disturbs nothing', async () => {
  const currencyChanges = [];
  const page = await loadCompanion({ currency: 'GBP', currencyChanges, sendMessage: async () => (
    { ok: true, value: { lots: [], auctionEvents: [], alerts: [], preferences: { currency: 'GBP', revision: 4 } } }) });
  assert.equal(page.element('currency').value, 'GBP');
  assert.deepEqual(currencyChanges, []);
});

// The research half caches the choice either way, so it survives this window; what a start-up that
// never reached the background owes the collector is the reason it goes no further than that.
test('a currency change after a failed start-up is explained once rather than dropped in silence', async () => {
  const page = await loadCompanion({ sendMessage: async () => undefined });
  assert.equal(page.element('storage-note').textContent, 'Extension storage is unavailable.');

  page.element('currency').value = 'CHF';
  await page.element('currency').emit('change');
  await settle();
  assert.equal(page.element('storage-note').textContent, 'The currency could not be saved.');

  // Said once: every later change would only repeat it over whatever the page is saying by then.
  page.element('storage-note').textContent = 'Nothing to report.';
  page.element('currency').value = 'EUR';
  await page.element('currency').emit('change');
  await settle();
  assert.equal(page.element('storage-note').textContent, 'Nothing to report.');
});

const capturedPage = (candidates = {}) => async () => [{ result: { pageTitle: 'Lot 27', pageUrl: 'https://auction.example/27', candidates } }];

// The fields are where he is looking and where he is fixing it: the reason the button is off must not vanish at the first keystroke.
test('the reason Research coin is off stays in view until the fields can be looked up', async () => {
  const page = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT, script: capturedPage() });
  await page.click('companion-capture-current');
  const message = page.element('companion-capture-error').textContent;
  assert.match(message, /reference/i);
  assert.equal(page.element('companion-use-capture').disabled, true);

  await page.type('ruler', 'Nero');
  assert.equal(page.element('companion-capture-error').textContent, message);
  assert.equal(page.element('companion-capture-error').hidden, false);
  assert.equal(page.element('companion-use-capture').disabled, true);

  await page.type('reference', 'RIC 306');
  assert.equal(page.element('companion-capture-error').textContent, '');
  assert.equal(page.element('companion-capture-error').hidden, true);
  assert.equal(page.element('companion-use-capture').disabled, false);
});

test('a capture message is said once and never takes back what the lookup wrote', async () => {
  const page = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT, script: capturedPage() });
  await page.click('companion-capture-current');
  assert.equal(page.element('form-error').textContent, page.element('companion-capture-error').textContent);
  // One alert carries it; the live region is not given the same line to read out again.
  assert.equal(page.element('announcement').textContent, '');

  // The lookup answers about something else entirely, and the capture editor has no business erasing it.
  page.element('form-error').textContent = 'No Price 23 found in PELLA.';
  page.element('form-error').hidden = false;
  await page.type('reference', 'RIC 306');
  assert.equal(page.element('form-error').textContent, 'No Price 23 found in PELLA.');
  assert.equal(page.element('form-error').hidden, false);
});

// Only one element carries the message as an alert; the other shows it without asking to be read out.
test('the capture error is announced by one element, not by every place it appears', () => {
  const markup = parseHtmlFile(new URL('../extension/popup.html', import.meta.url));
  assert.equal(markup.getElementById('form-error').getAttribute('role'), 'alert');
  assert.equal(markup.getElementById('companion-capture-error').getAttribute('role'), null);
});

// A page that could not be read leaves no context behind - including the one the last page left, which the editor no longer shows.
test('a capture that fails takes the earlier page off the card it would be saved with', async () => {
  const commands = [];
  const page = await loadCompanion({
    sendMessage: async (command) => { commands.push(command); return command.type === 'draft.save' ? { ok: true, value: { id: 'draft-1' } } : WORKING_SNAPSHOT; },
    script: capturedPage({ reference: { value: 'RIC 306', provenance: 'structured-data' } }),
  });
  await page.click('companion-capture-current');
  page.card({ title: 'Nero denarius', reference: 'RIC 306' });
  await page.click('companion-save-watchlist');
  assert.deepEqual(commands.filter(({ type }) => type === 'draft.save').at(-1).payload.auctionContext, { pageUrl: 'https://auction.example/27' });

  page.setTabs(async () => [{ id: 3, url: 'about:newtab', title: 'New tab' }]);
  await page.click('companion-capture-current');
  page.card({ title: 'Nero denarius', reference: 'RIC 306' });
  await page.click('companion-save-watchlist');
  // With no page left on it the card is a bare reference, saved in one step (G-02), and nothing of the earlier page goes with it.
  const saved = commands.filter(({ type }) => type === 'lot.save').at(-1);
  assert.ok(saved, 'saved in one step');
  assert.equal(Object.hasOwn(saved.lot, 'auctionContext'), false);
});

// A right-click on another page sends its reference to this window. That lookup is not about the page captured here, so the
// captured page comes off the card: without this, a coin looked up from one site was filed under the sale open in another.
test('a lookup sent to this window takes the captured page off the coin saved from it', async () => {
  const commands = [];
  const page = await loadCompanion({
    sendMessage: async (command) => { commands.push(command); return command.type === 'draft.save' ? { ok: true, value: { id: 'draft-1' } } : WORKING_SNAPSHOT; },
    tabs: async () => [{ id: 3, url: 'https://auction.example/27', title: 'Lot 27' }],
    script: capturedPage({ reference: { value: 'Price 23', provenance: 'visible-text' } }),
  });
  const lastSaved = () => commands.filter(({ type }) => type === 'draft.save').at(-1).payload;
  await page.click('companion-capture-current');
  page.card({ title: 'Alexander tetradrachm', reference: 'Price 23' });
  await page.click('companion-save-watchlist');
  assert.deepEqual(lastSaved().auctionContext, { pageUrl: 'https://auction.example/27' });

  page.lookupReceived();
  page.card({ title: 'Roman Republic denarius', reference: 'RRC 44/5' });
  await page.click('companion-save-watchlist');
  // A bare reference again: saved in one step (G-02), with no page of its own.
  const direct = commands.filter(({ type }) => type === 'lot.save').at(-1);
  assert.equal(direct.lot.reference, 'RRC 44/5');
  assert.equal(Object.hasOwn(direct.lot, 'auctionContext'), false, 'the sent lookup carries no page of its own');
  // The capture editor no longer claims a page it is not standing for.
  assert.equal(page.element('companion-capture-source').textContent, 'Auction context cleared. Captured fields remain available for research.');
  assert.equal(page.element('companion-capture-reference').value, 'Price 23', 'the captured fields stay available');
});

// Loop 3 (G-02): the draft path and the one-step save share the guard: each refuses a save while another is pending, holds both save buttons
// before its first await, and gives them back when it is done.
test('every watchlist save visibly shares one synchronous pending guard', () => {
  const source = readFileSync(new URL('../extension/companion-popup.js', import.meta.url), 'utf8');
  assert.match(source, /const holdSaveButtons = \(\) => \{\n\s*\$\('companion-save-watchlist'\)\.disabled = true;\n\s*\$\('companion-capture-watchlist'\)\.disabled = true;/);
  for (const name of ['saveWatchlistDraft', 'saveDirect']) {
    const body = source.slice(source.indexOf(`const ${name} = async`), source.indexOf('\n  };', source.indexOf(`const ${name} = async`)));
    assert.match(body, /if \(savePending\)[^\n]*PENDING_MESSAGE/, name);
    const guard = body.indexOf('savePending = true;');
    assert.ok(guard > 0 && guard < body.indexOf('await'), `${name} takes the guard before its first await`);
    assert.match(body.slice(guard), /^savePending = true;\n\s*holdSaveButtons\(\);/, name);
    assert.match(body, /finally \{\n\s*savePending = false;\n\s*releaseSaveButtons\(\);/, name);
  }
});

test('watchlist transfer whitelists reference fields and excludes acsearch results', () => {
  const payload = buildWatchlistDraftPayload({
    reference: 'RIC I² Nero 306',
    title: 'Nero denarius',
    pageUrl: 'https://numismatics.org/ocre/id/ric.1(2).ner.306',
    shownPrices: { median: 180, lots: [{ id: 'provider-row', price: 200 }] },
    prices: [100, 200],
    currentCard: { description: 'must not serialize', fetchedClaims: [{ amount: 100 }] },
  });
  assert.deepEqual(payload, {
    target: 'watchlist',
    title: 'Nero denarius',
    reference: 'RIC I² Nero 306',
    pageUrl: 'https://numismatics.org/ocre/id/ric.1(2).ner.306',
  });
  assert.equal(JSON.stringify(payload).includes('provider-row'), false);
  assert.equal(JSON.stringify(payload).includes('median'), false);
});

test('watchlist summary keeps CHF exposure separate', () => {
  const summary = buildWatchlistSummary({
    auctionEvents: [{ id: 'next', name: 'Roma sale', startsAt: '2026-09-20T10:00:00.000Z' }],
    alerts: [{ eventId: 'next', status: 'due' }],
    lots: [{ auctionEventId: 'next', outcome: { status: 'open' }, activeBid: { amount: { currency: 'CHF', minor: 10000 }, buyerPremiumBps: 2500 } }],
  }, '2026-09-12T00:00:00.000Z');
  assert.equal(summary.nextEvent.name, 'Roma sale');
  assert.equal(summary.dueAuctionCount, 1);
  assert.equal(summary.exposure.CHF.hammerMinor, 10000);
  assert.equal(summary.exposure.USD.hammerMinor, 0);
});

test('date-only next auctions use each event local calendar day and sort with timed events', () => {
  const newYork = { id: 'ny', name: 'New York day', precision: 'date-only', localDate: '2026-09-12', timeZone: 'America/New_York' };
  const tokyoPast = { id: 'tokyo', name: 'Tokyo yesterday', precision: 'date-only', localDate: '2026-09-12', timeZone: 'Asia/Tokyo' };
  const timed = { id: 'timed', name: 'Timed sale', precision: 'timed', startsAt: '2026-09-13T01:00:00.000Z' };
  const summary = buildWatchlistSummary({ auctionEvents: [timed, tokyoPast, newYork], alerts: [], lots: [] }, '2026-09-13T00:30:00.000Z');
  assert.equal(summary.nextEvent.id, 'ny');
  const afterNewYorkMidnight = buildWatchlistSummary({ auctionEvents: [newYork], alerts: [], lots: [] }, '2026-09-13T04:00:00.001Z');
  assert.equal(afterNewYorkMidnight.nextEvent, null);
});

// Loop 3 (G-02): a bare reference saves in one step. The collector still confirms it - the line under the card says "Saved to your watchlist · Open ·
// Undo", and Undo takes it back - but nothing opens by itself, and the coin saved is the very coin the workspace's own draft confirmation would
// have saved from the same card: the same validation, the same reading into the details form, the same command.
const { createWorkspaceBackground, mountWorkspace } = await import('./helpers/dom.mjs');
const storeReplies = (background, commands = []) => async (command) => { commands.push(structuredClone(command)); return background.send(command); };
// A line as it is seen: a pill by its shown words (a pill with a spoken sentence hides its short words from a screen reader).
const shownWords = (part) => part.children?.find?.((child) => child['aria-hidden'] === 'true')?.textContent ?? part.textContent;
const lineParts = (line) => line.children.map((part) => (typeof part === 'string' ? part : `[${shownWords(part)}]`)).join('');
// A want pill's two parts: the short words (hidden from a screen reader) and the whole sentence (visually hidden).
const pillParts = (pill) => pill.children.map((part) => [part['aria-hidden'] ?? part.className, part.textContent]);
const lineButton = (line, label) => line.children.find((part) => typeof part !== 'string' && part.textContent === label);
const settleAll = async () => { for (let tick = 0; tick < 30; tick += 1) await settle(); };
const neroCard = { title: 'Nero · As · Rome · AD 62–68', reference: 'RIC I² Nero 306', pageUrl: 'https://numismatics.org/ocre/id/ric.1(2).ner.306' };

test('Save on a bare card saves the coin in one step, as the workspace would, and Undo takes it back', async () => {
  const background = await createWorkspaceBackground();
  const commands = [];
  const opened = [];
  const create = globalThis.browser.tabs.create;
  globalThis.browser.tabs.create = async ({ url }) => { opened.push(url); return { id: 9 }; };
  try {
    const page = await loadCompanion({ sendMessage: storeReplies(background, commands) });
    page.card(neroCard);
    assert.equal(page.element('companion-save-watchlist').disabled, false);
    await page.click('companion-save-watchlist');
    await settleAll();
    assert.deepEqual(opened, [], 'nothing opens by itself');
    assert.deepEqual(commands.filter(({ type }) => type === 'draft.save'), []);
    const [lot] = background.root().lots;
    assert.equal(lot.title, 'Nero · As · Rome · AD 62–68');
    assert.equal(lot.reference, 'RIC I² Nero 306');
    assert.deepEqual(lot.sourceLinks, [{ source: 'manual', url: neroCard.pageUrl }]);
    const line = page.element('companion-saved-line');
    assert.equal(line.hidden, false);
    // H-05: "Saved" is the row's pill, its sentence the tooltip; Open and Undo beside it.
    assert.equal(lineParts(line), '[Watching] · [Open] · [Undo]');
    assert.equal(line.children[0].title, 'Added to your watchlist');
    assert.equal(page.element('companion-status-row').hidden, false);
    assert.equal(page.element('companion-save-watchlist').hidden, true);

    // The workspace's own path from the same card - its draft, confirmed with Save details - saves the same coin.
    const other = await createWorkspaceBackground();
    const payload = buildWatchlistDraftPayload(neroCard);
    const draft = await other.send({ type: 'draft.save', kind: 'current-lot', payload });
    const workspace = await mountWorkspace({ background: other, hash: `#lot-draft=${draft.value.id}` });
    await workspace.saveDetails();
    await settleAll();
    const [confirmed] = other.root().lots;
    for (const field of ['title', 'reference', 'sourceLinks', 'notes', 'outcome', 'bidHistory']) assert.deepEqual(lot[field], confirmed[field], field);

    await lineButton(line, 'Undo').emit('click');
    await settleAll();
    assert.deepEqual(background.root().lots, []);
    assert.equal(line.hidden, true);
    assert.equal(page.element('companion-status-row').hidden, true, 'the row goes with its last pill');
    assert.equal(page.element('companion-save-hint').textContent, 'Removed from your watchlist.');
    assert.equal(page.element('companion-save-watchlist').hidden, false);
    // What the line said of that card is not said of the next one.
    page.card({ title: 'Price 23', reference: 'Price 23', pageUrl: 'https://numismatics.org/pella/id/price.23' });
    assert.equal(page.element('companion-save-hint').hidden, true);
  } finally {
    globalThis.browser.tabs.create = create;
  }
});

test('the one-step save refuses what the workspace would refuse, and says why under the button', async () => {
  const background = await createWorkspaceBackground();
  const commands = [];
  const page = await loadCompanion({ sendMessage: storeReplies(background, commands) });
  // The draft check the workspace's path starts with: a title past its bound is refused before anything is sent.
  assert.equal(directLotFromPayload({ target: 'watchlist', title: 'x'.repeat(250), reference: 'Price 23' }).ok, false);
  // The store's own check, which both paths end with: only an http or https page is kept.
  page.card({ title: 'Price 23', reference: 'Price 23', pageUrl: 'javascript:alert(1)' });
  await page.click('companion-save-watchlist');
  await settleAll();
  assert.deepEqual(background.root()?.lots ?? [], []);
  assert.equal(page.element('companion-save-hint').textContent, 'Expected an HTTP or HTTPS URL.');
  assert.equal(page.element('companion-saved-line').hidden, true);
  // A card carrying a captured page's values still goes to the workspace for review.
  assert.equal(savesDirectly({ target: 'watchlist', reference: 'Price 23', auctionContext: { pageUrl: 'https://auction.example/1' } }), false);
  assert.equal(savesDirectly({ target: 'watchlist', reference: 'Price 23', estimate: { currency: 'USD', minor: 100 } }), false);
  assert.equal(savesDirectly(buildWatchlistDraftPayload(neroCard)), true);
});

test('Undo lasts ten seconds; then the card says where the coin stands', async () => {
  const background = await createWorkspaceBackground();
  const realSetTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, wait) => { timers.push({ callback, wait }); return timers.length; };
  try {
    const page = await loadCompanion({ sendMessage: storeReplies(background) });
    page.card(neroCard);
    await page.click('companion-save-watchlist');
    await settleAll();
    timers.filter(({ wait }) => wait === 10000).at(-1).callback();
    assert.equal(lineParts(page.element('companion-saved-line')), '[Watching]');
    assert.equal(page.element('companion-saved-line').children[0].title, 'On your watchlist');
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

// Loop 3 (G-12): a coin already saved under the card's reference - in either spelling - is shown, with where it stands, instead of a second Save.
test('a card whose reference is saved shows where that coin stands and opens it, instead of offering a second Save', async () => {
  const event = { id: 'e1', name: 'Roma E-Sale 130', eventKind: 'auction-day', precision: 'date-only', localDate: '2099-10-12', timeZone: 'Europe/London' };
  const lot = { id: 'lot-1', title: 'Nero as', reference: 'RIC I (second edition) Nero 306', auctionEventId: 'e1', outcome: { status: 'open' },
    activeBid: { amount: { currency: 'GBP', minor: 65000 }, buyerPremiumBps: 2000 }, updatedAt: '2026-09-01T00:00:00.000Z' };
  const snapshot = { ok: true, value: { lots: [lot], auctionEvents: [event], alerts: [], preferences: { currency: 'USD', revision: 1 } } };
  const opened = [];
  const create = globalThis.browser.tabs.create;
  const getURL = globalThis.browser.runtime.getURL;
  globalThis.browser.tabs.create = async ({ url }) => { opened.push(url); return { id: 9 }; };
  globalThis.browser.runtime.getURL = (path) => `moz-extension://test/${path}`;
  try {
    const page = await loadCompanion({ sendMessage: async () => snapshot });
    page.card(neroCard);
    const line = page.element('companion-saved-line');
    assert.equal(line.hidden, false);
    // H-05: one short pill, whose click opens the coin; the whole sentence is its tooltip and its name. Fix round: the amount is whole where
    // it is exact, and the name begins with the pill's own words, so voice control can say what it sees.
    assert.match(lineParts(line), /^\[Watching · £650 bid · in \d+ days\]$/);
    const pill = line.children[0];
    assert.match(pill.title, /^On your watchlist · Bid active £650\.00 · Roma E-Sale 130 · in \d+ days$/);
    assert.equal(pill['aria-label'], `${pill.textContent}: ${pill.title} · Open this coin in the workspace`);
    assert.equal(page.element('companion-save-watchlist').hidden, true);
    await pill.emit('click');
    await settleAll();
    assert.deepEqual(opened, ['moz-extension://test/workspace.html#watchlist?lot=lot-1']);
    page.card({ title: 'Price 23', reference: 'Price 23', pageUrl: 'https://numismatics.org/pella/id/price.23' });
    assert.equal(line.hidden, true);
    assert.equal(page.element('companion-save-watchlist').hidden, false);
  } finally {
    globalThis.browser.tabs.create = create;
    globalThis.browser.runtime.getURL = getURL;
  }
  assert.deepEqual(savedLotsFor({ lots: [{ id: 'won', reference: 'RIC I² Nero 306', outcome: { status: 'won' } }, lot] }, 'RIC I² Nero 306').map(({ id }) => id), ['lot-1', 'won']);
  assert.equal(savedLineText([{ reference: 'Price 23', outcome: { status: 'won' } }], {}), 'In your collection');
  assert.deepEqual(savedLotsFor({ lots: [lot] }, 'RIC I² Nero 307'), []);
});

// Loop 3 (G-02): Watch on an upcoming acsearch lot saves that lot in one step too - its title, the card's reference and its own acsearch page, never
// the page captured here - and offers its sale day as a date-only auction, attached only when the collector presses Add.
test('Watch saves an upcoming lot in one step, and Add attaches its sale day as a date-only auction', async () => {
  const background = await createWorkspaceBackground();
  const commands = [];
  const opened = [];
  const create = globalThis.browser.tabs.create;
  globalThis.browser.tabs.create = async ({ url }) => { opened.push(url); return { id: 9 }; };
  try {
    const page = await loadCompanion({ sendMessage: storeReplies(background, commands), script: capturedPage({ reference: { value: 'Price 23', provenance: 'visible-text' } }) });
    await page.click('companion-capture-current');
    page.watch({ title: 'Roma Numismatics, E-Sale 200, Lot 9', reference: 'Price 23', pageUrl: 'https://www.acsearch.info/search.html?id=9', closesAt: '2099-10-12' });
    await settleAll();
    assert.deepEqual(opened, []);
    const [lot] = background.root().lots;
    assert.equal(lot.title, 'Roma Numismatics, E-Sale 200, Lot 9');
    assert.deepEqual(lot.sourceLinks, [{ source: 'manual', url: 'https://www.acsearch.info/search.html?id=9' }]);
    assert.equal(Object.hasOwn(lot, 'auctionContext'), false, 'the captured page does not ride along');
    assert.equal(Object.hasOwn(lot, 'auctionEventId'), false, 'no auction until the collector asks');
    const line = page.element('upcoming-saved');
    // Fix round (review M5): the sale day is written as the Watchlist tab writes one, in the browser's language.
    const day = new Intl.DateTimeFormat(navigator.language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date('2099-10-12T12:00:00Z'));
    assert.equal(lineParts(line), `[Watching] · [Open] · [Undo] · add its sale day ${day} as an auction? · [Add]`);
    await lineButton(line, 'Add').emit('click');
    await settleAll();
    const [event] = background.root().auctionEvents;
    assert.equal(event.eventKind, 'auction-day');
    assert.equal(event.precision, 'date-only');
    assert.equal(event.localDate, '2099-10-12');
    assert.equal(event.name, 'Roma Numismatics, E-Sale 200, Lot 9');
    assert.equal(background.root().lots[0].auctionEventId, event.id);
    assert.equal(lineParts(line), '[Watching with its sale day] · [Open] · [Undo]');
    assert.equal(line.children[0].title, 'Added to your watchlist with its sale day');
    // A second Watch of the same lot opens the one saved.
    page.watch({ title: 'Roma Numismatics, E-Sale 200, Lot 9', reference: 'Price 23', pageUrl: 'https://www.acsearch.info/search.html?id=9', closesAt: '2099-10-12' });
    await settleAll();
    assert.equal(lineParts(line), 'Already on your watchlist · [Open]');
    assert.equal(background.root().lots.length, 1);
  } finally {
    globalThis.browser.tabs.create = create;
  }
});

test('Undo after Add takes back the coin and the auction it made', async () => {
  const background = await createWorkspaceBackground();
  const page = await loadCompanion({ sendMessage: storeReplies(background) });
  page.watch({ title: 'Roma, Lot 10', reference: 'Price 23', pageUrl: 'https://www.acsearch.info/search.html?id=10', closesAt: '2099-10-12' });
  await settleAll();
  const line = page.element('upcoming-saved');
  await lineButton(line, 'Add').emit('click');
  await settleAll();
  assert.equal(background.root().auctionEvents.length, 1);
  await lineButton(line, 'Undo').emit('click');
  await settleAll();
  assert.deepEqual(background.root().lots, []);
  assert.deepEqual(background.root().auctionEvents, []);
});

// 0.34 review (M5): a Watch that could not be saved is handed back to the research half, where the collector pressed it; a Watch that worked hands
// nothing back.
test('a failed Watch hands its reason back to the research half', async () => {
  const replies = [{ ok: false, outcome: 'not-committed', message: 'The store is full.' }, { ok: true, value: { id: 'lot-8', revision: 0, title: 'Roma, Lot 8' } }];
  const page = await loadCompanion({ sendMessage: async (command) => (command.type === 'lot.save' ? replies.shift() : WORKING_SNAPSHOT) });
  const handedBack = [];
  const dispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (event) => { handedBack.push({ type: event.type, detail: event.detail }); return true; };
  const watched = { title: 'Roma, Lot 8', reference: 'Price 23', pageUrl: 'https://www.acsearch.info/search.html?id=8', closesAt: '2099-10-12' };
  page.watch(watched);
  await settleAll();
  assert.deepEqual(handedBack, [{ type: 'giga-pinax-watch-failed', detail: { message: 'The store is full.' } }]);
  assert.equal(page.element('announcement').textContent, 'The store is full.');
  page.watch(watched);
  await settleAll();
  globalThis.dispatchEvent = dispatch;
  assert.equal(handedBack.length, 1);
});

// 0.34 final review: a second Watch pressed while the first lot is still being saved is refused aloud, not dropped.
test('a second Watch while the first is saving is refused and handed back, and only the first is saved', async () => {
  const commands = [];
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const page = await loadCompanion({ sendMessage: async (command) => {
    commands.push(command);
    if (command.type !== 'lot.save') return WORKING_SNAPSHOT;
    await held;
    return { ok: true, value: { id: 'lot-9', revision: 0, title: command.lot.title } };
  } });
  const handedBack = [];
  const dispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (event) => { handedBack.push({ type: event.type, detail: event.detail }); return true; };
  page.watch({ title: 'Roma, Lot A', reference: 'Price 23', pageUrl: 'https://www.acsearch.info/search.html?id=1', closesAt: '2099-10-12' });
  await settle(); await settle();
  page.watch({ title: 'Roma, Lot B', reference: 'Price 24', pageUrl: 'https://www.acsearch.info/search.html?id=2', closesAt: '2099-10-12' });
  for (let tick = 0; tick < 5; tick += 1) await settle();
  release();
  await settleAll();
  globalThis.dispatchEvent = dispatch;
  const saved = commands.filter(({ type }) => type === 'lot.save');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].lot.title, 'Roma, Lot A');
  assert.deepEqual(handedBack, [{ type: 'giga-pinax-watch-failed',
    detail: { message: 'Another lot is still being saved to the watchlist. Try again in a moment.' } }]);
});

// A save whose reply was lost is sent again under the same request, which the store answers from its ledger: one coin, not two.
test('a one-step save retried after a lost reply is the same request', async () => {
  const background = await createWorkspaceBackground();
  const commands = [];
  let lose = true;
  const page = await loadCompanion({ sendMessage: async (command) => {
    commands.push(structuredClone(command));
    const reply = await background.send(command);
    if (command.type === 'lot.save' && lose) { lose = false; return undefined; }
    return reply;
  } });
  page.card(neroCard);
  await page.click('companion-save-watchlist');
  await settleAll();
  assert.equal(page.element('companion-save-hint').textContent, 'Giga Pinax’s background didn’t answer. Select Watch again — the same request is retried, never saved twice.');
  await page.click('companion-save-watchlist');
  await settleAll();
  const saves = commands.filter(({ type }) => type === 'lot.save');
  assert.equal(saves.length, 2);
  assert.equal(saves[0].requestId, saves[1].requestId);
  assert.equal(background.root().lots.length, 1);
});

// 0.34 (W2a): a capture the page refused is kept in the local diagnostics list as a kind of failure only - no page title, address or text reaches it.
test('a refused capture is recorded as a capture failure, with nothing of the page in it', async () => {
  const stored = {};
  globalThis.browser.storage.local = { get: async (key) => ({ [key]: stored[key] }), set: async (items) => { Object.assign(stored, items); } };
  try {
    const page = await loadCompanion({
      sendMessage: async () => WORKING_SNAPSHOT,
      tabs: async () => [{ id: 3, url: 'https://auction.example/secret-lot-27', title: 'Secret lot 27' }],
      script: async () => { throw new Error('Cannot access contents of https://auction.example/secret-lot-27'); },
    });
    await page.click('companion-capture-current');
    for (let tick = 0; tick < 20; tick += 1) await settle();
    const entries = stored['gigaPinax:diagnostics:v1'];
    assert.equal(entries?.length, 1);
    assert.equal(entries[0].area, 'capture');
    assert.equal(entries[0].code, 'failed');
    assert.equal(/auction\.example|secret|Lot 27/i.test(JSON.stringify(entries)), false);

    // A capture that works records nothing.
    page.setTabs(async () => [{ id: 3, url: 'https://auction.example/27', title: 'Lot 27' }]);
    answerScript = capturedPage({ reference: { value: 'RIC 306', provenance: 'visible-text' } });
    await page.click('companion-capture-current');
    for (let tick = 0; tick < 20; tick += 1) await settle();
    assert.equal(stored['gigaPinax:diagnostics:v1'].length, 1);
  } finally {
    delete globalThis.browser.storage.local;
  }
});

// 0.34 (W2a): the page's estimate, closing time and photo go with the captured lot to the workspace draft, in the shapes the draft holds, and come
// off it with the auction context when the collector clears that.
test('a captured lot takes the page’s estimate, closing time and photo to its draft, and only in their draft shapes', () => {
  const payload = buildWatchlistDraftPayload({
    title: 'Lot 27', pageUrl: 'https://auction.example/27',
    estimate: { minor: 120000, currency: 'EUR' }, closesAt: '2026-10-15T14:00+02:00', photoUrl: 'https://images.auction.example/27.jpg',
  });
  assert.deepEqual(payload, { target: 'watchlist', title: 'Lot 27', pageUrl: 'https://auction.example/27',
    estimate: { minor: 120000, currency: 'EUR' }, closesAt: '2026-10-15T14:00+02:00', photoUrl: 'https://images.auction.example/27.jpg' });
  assert.equal(buildWatchlistDraftPayload({ title: 'Lot', startsAt: '2026-10-15T10:00:00+02:00' }).startsAt, '2026-10-15T10:00+02:00');
  const refused = buildWatchlistDraftPayload({
    title: 'Lot 27', estimate: { minor: 12.5, currency: 'EUR', note: 'x' }, closesAt: '2026-10-15T14:00', photoUrl: 'javascript:alert(1)',
  });
  assert.deepEqual(refused, { target: 'watchlist', title: 'Lot 27', closesAt: '2026-10-15' });
  assert.equal(Object.hasOwn(buildWatchlistDraftPayload({ title: 'Lot', estimate: { minor: 5, currency: 'eur' } }), 'estimate'), false);
});

test('the capture’s own save carries the page values, and clearing the auction context takes them off', async () => {
  const commands = [];
  const page = await loadCompanion({
    sendMessage: async (command) => { commands.push(command); return command.type === 'draft.save' ? { ok: true, value: { id: 'draft-1' } } : WORKING_SNAPSHOT; },
    tabs: async () => [{ id: 3, url: 'https://auction.example/27', title: 'Lot 27' }],
    script: async () => [{ result: { pageTitle: 'Lot 27', pageUrl: 'https://auction.example/27', candidates: { reference: { value: 'RIC 306', provenance: 'structured-data' } },
      offerPrice: '1200', offerCurrency: 'EUR', closesAt: '2026-10-15T14:00:00+02:00', photoUrl: 'https://images.auction.example/27.jpg' } }],
  });
  const lastSaved = () => commands.filter(({ type }) => type === 'draft.save').at(-1).payload;
  await page.click('companion-capture-current');
  await page.click('companion-capture-watchlist');
  assert.deepEqual(lastSaved().estimate, { minor: 120000, currency: 'EUR' });
  assert.equal(lastSaved().closesAt, '2026-10-15T14:00+02:00');
  assert.equal(lastSaved().photoUrl, 'https://images.auction.example/27.jpg');

  await page.click('companion-clear-auction-context');
  await page.click('companion-capture-watchlist');
  for (const field of ['auctionContext', 'estimate', 'closesAt', 'photoUrl']) assert.equal(lastSaved()[field] ?? null, null, field);
  assert.equal(lastSaved().reference, 'RIC 306');
});

test('the captured lot’s provenance entries go to its draft and come off with its auction context', async () => {
  const entries = [{ text: 'Ex Leu 7 (1973), lot 123', source: 'Leu 7', year: 1973, lot: '123' }];
  assert.deepEqual(buildWatchlistDraftPayload({ title: 'Lot', provenance: [...entries, { text: '' }, { text: 'Ex Hess', year: 'soon', extra: 1 }] }).provenance,
    [...entries, { text: 'Ex Hess' }]);
  const commands = [];
  const page = await loadCompanion({
    sendMessage: async (command) => { commands.push(command); return command.type === 'draft.save' ? { ok: true, value: { id: 'draft-1' } } : WORKING_SNAPSHOT; },
    tabs: async () => [{ id: 3, url: 'https://auction.example/27', title: 'Lot 27' }],
    script: async () => [{ result: { pageTitle: 'Lot 27', pageUrl: 'https://auction.example/27', candidates: { reference: { value: 'RIC 306', provenance: 'visible-text' } },
      provenanceText: 'Ex Leu 7 (1973), lot 123.' } }],
  });
  const lastSaved = () => commands.filter(({ type }) => type === 'draft.save').at(-1).payload;
  await page.click('companion-capture-current');
  await page.click('companion-capture-watchlist');
  assert.deepEqual(lastSaved().provenance, entries);
  await page.click('companion-clear-auction-context');
  await page.click('companion-capture-watchlist');
  assert.equal(Object.hasOwn(lastSaved(), 'provenance'), false);
});

// A page can write addresses as long as a draft allows each one; what it states about the lot then gives way, provenance first, so the draft is
// never refused as too large and the coin's own fields always reach the workspace.
test('page values give way before a draft outgrows its storage bound, and the collector is told which', async () => {
  const long = (name) => `https://auction.example/${name}/${'x'.repeat(2000)}`;
  const provenance = Array.from({ length: 10 }, (_, index) => ({ text: `Ex ${'Leu '.repeat(45)}${index}`.slice(0, 199), source: 'y'.repeat(120), lot: '1'.repeat(20) }));
  const payload = buildWatchlistDraftPayload({ title: 'Lot', pageUrl: long('page'), auctionContext: { pageUrl: long('page'), canonicalUrl: long('canonical') },
    photoUrl: long('photo'), closesAt: '2026-10-15', estimate: { minor: 100, currency: 'EUR' }, provenance });
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).length <= 10000);
  assert.equal(Object.hasOwn(payload, 'provenance'), false);
  assert.equal(payload.closesAt, '2026-10-15');
  assert.equal(payload.auctionContext.canonicalUrl, long('canonical'));

  // A capture whose page writes such addresses: the draft is saved, and the announcement names what the size bound left off.
  const commands = [];
  const page = await loadCompanion({
    sendMessage: async (command) => { commands.push(command); return command.type === 'draft.save' ? { ok: true, value: { id: 'draft-1' } } : WORKING_SNAPSHOT; },
    tabs: async () => [{ id: 3, url: long('page'), title: 'Lot 27' }],
    script: async () => [{ result: { pageTitle: 'Lot 27', pageUrl: long('page'), canonicalUrl: long('canonical'), photoUrl: long('photo'),
      candidates: { reference: { value: 'RIC 306', provenance: 'visible-text' } },
      provenanceText: Array.from({ length: 10 }, (_, index) => `Ex Leu ${index} ${'collection '.repeat(18)}`).join('. ') } }],
  });
  await page.click('companion-capture-current');
  await page.click('companion-capture-watchlist');
  const saved = commands.filter(({ type }) => type === 'draft.save').at(-1).payload;
  assert.equal(Object.hasOwn(saved, 'provenance'), false);
  assert.equal(saved.photoUrl, long('photo'));
  assert.equal(page.element('companion-capture-source').textContent,
    'Watchlist details are ready to review. Left off, the draft being at its size bound: provenance.');

  // A draft with room for everything says nothing more.
  const roomy = await loadCompanion({
    sendMessage: async (command) => (command.type === 'draft.save' ? { ok: true, value: { id: 'draft-2' } } : WORKING_SNAPSHOT),
    tabs: async () => [{ id: 3, url: 'https://auction.example/27', title: 'Lot 27' }],
    script: async () => [{ result: { pageTitle: 'Lot 27', pageUrl: 'https://auction.example/27', candidates: { reference: { value: 'RIC 306', provenance: 'visible-text' } },
      provenanceText: 'Ex Leu 7 (1973), lot 123.' } }],
  });
  await roomy.click('companion-capture-current');
  await roomy.click('companion-capture-watchlist');
  assert.equal(roomy.element('companion-capture-source').textContent, 'Watchlist details are ready to review.');
});

// Loop 1 (P-05): Current source stood open on every popup with a paragraph of prose. It starts folded under a summary that says what it does, and
// opens by itself only where there is a page to capture: the active tab is a web page the extension may read.
test('Current source starts folded, and opens itself over a web page it could capture', async () => {
  const markup = parseHtmlFile(new URL('../extension/popup.html', import.meta.url));
  const details = markup.getElementById('companion-current-lot');
  assert.equal(details.getAttribute('open'), null);
  assert.equal(details.querySelector('summary').textContent, 'Capture the lot page you’re on');
  const page = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT, tabs: async () => [{ id: 3, url: 'https://auction.example/27', title: 'Lot 27' }] });
  await settle();
  assert.equal(page.element('companion-current-lot').open, true);
  const blank = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT, tabs: async () => [{ id: 3, url: 'about:newtab', title: 'New tab' }] });
  await settle();
  assert.equal(blank.element('companion-current-lot').open, false);
});

// Loop 1 (C-01): a failed capture opened the empty Ruler/Denomination/Mint/Reference editor and said why twice - under the button and again in the
// status line, which stood under the footer. The editor stays shut, the reason is said once beside the button, and the status line sits under the tabs.
test('a failed capture keeps the editor shut and says why once, beside the button', async () => {
  assert.equal(captureControlsState(false, false, false, true).editorVisible, false);
  const page = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT, tabs: async () => [{ id: 3, url: 'about:newtab', title: 'New tab' }] });
  page.element('companion-capture-editor').hidden = true;
  await page.click('companion-capture-current');
  assert.equal(page.element('companion-capture-editor').hidden, true);
  assert.match(page.element('companion-capture-error').textContent, /^This page can't be read\./);
  assert.equal(page.element('companion-capture-error').hidden, false);
  assert.equal(page.element('form-error').textContent, '');
  assert.match(page.element('announcement').textContent, /^This page can't be read\./);

  page.setTabs(async () => [{ id: 3, url: 'https://auction.example/27', title: 'Lot 27' }]);
  answerScript = capturedPage({ reference: { value: 'RIC 306', provenance: 'visible-text' } });
  await page.click('companion-capture-current');
  assert.equal(page.element('companion-capture-editor').hidden, false);
  assert.equal(page.element('companion-capture-error').hidden, true);
});

test('the capture error stands outside the editor, and messages are spoken by the one live region', () => {
  const markup = parseHtmlFile(new URL('../extension/popup.html', import.meta.url));
  const editor = markup.getElementById('companion-capture-editor');
  assert.equal(editor.querySelectorAll('#companion-capture-error').length, 0);
  assert.ok(markup.getElementById('companion-capture-error'));
  assert.equal(markup.getElementById('announcement').getAttribute('role'), 'status');
});

// Loop 1 (D-02): the calculator said "Enter an amount and buyer premium." in body text, as loud as a result, and stood a six-line explanation in the
// way of the figures. The prompt is muted until there is a result, and the explanation folds under its own summary; Fees keeps its accent.
test('the calculator mutes its prompt and folds its explanation', async () => {
  const page = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT });
  const root = page.element('companion-bid-calculator').children[0];
  const about = root.children.find((child) => child.className === 'bid-calculator-about');
  assert.ok(about, 'the explanation has a fold of its own');
  assert.equal(about.children[0].textContent, 'How the total is counted');
  assert.equal(about.children[1].className, 'bid-calculator-note');
  const css = readFileSync(new URL('../extension/bid-tools.css', import.meta.url), 'utf8');
  // No result yet is exactly when "Use in bid" is disabled, in every calculator, shown or not.
  assert.match(css, /\.bid-calculator:has\(\.bid-calculator-actions button:disabled\) \.bid-calculator-output\{[^}]*color:var\(--muted\);font-size:12px/);
  assert.match(css, /\.bid-calculator-about \.bid-calculator-note\{[^}]*font-size:11px/);
  assert.match(css, /\.bid-calculator-fees summary[^{]*\{[^}]*color:var\(--accent\)/);
});

// Loop 1 (K-01): after a lookup the header was thirty stops from the Reference box, and nothing brought the box back from the Calculator or Watchlist.
// A skip link leads the header, and Ctrl+K (⌘K on a Mac), or "/" outside a text field, takes the keyboard back to the box on the Research tab.
test('Ctrl+K, "/" and the skip link bring the Reference box back from any tab', async () => {
  const markup = parseHtmlFile(new URL('../extension/popup.html', import.meta.url));
  const header = markup.querySelector('.popup-header');
  const first = header.querySelectorAll('a, button, summary, input')[0];
  assert.equal(first.getAttribute('id'), 'skip-to-research');
  assert.equal(first.textContent, 'Skip to research');
  assert.equal(markup.getElementById('quick-reference').getAttribute('aria-keyshortcuts'), 'Control+K Meta+K');
  const page = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT });
  const box = page.element('quick-reference');
  let selected = 0;
  box.select = () => { selected += 1; };
  await page.click('companion-tab-calculator');
  assert.equal(page.element('companion-panel-research').hidden, true);
  const chord = page.key({ key: 'k', ctrlKey: true, target: page.element('companion-bid-calculator') });
  assert.equal(chord.prevented, true);
  assert.equal(page.element('companion-panel-research').hidden, false);
  assert.equal(page.element('companion-tab-research')['aria-selected'], 'true');
  assert.equal(box.focused, true);
  assert.equal(selected, 1);
  // "/" typed into a field is the character, not the shortcut.
  const typed = page.key({ key: '/', target: { tagName: 'INPUT' } });
  assert.equal(typed.prevented, undefined);
  const slash = page.key({ key: '/', target: { tagName: 'BODY' } });
  assert.equal(slash.prevented, true);
  box.focused = false;
  await page.click('companion-tab-watchlist');
  await page.element('skip-to-research').emit('click');
  assert.equal(page.element('companion-panel-research').hidden, false);
  assert.equal(box.focused, true);
});

test('a save that fails is said in the line under its button for a while, then the line goes', async () => {
  const markup = parseHtmlFile(new URL('../extension/popup.html', import.meta.url));
  assert.equal(markup.getElementById('companion-status'), null);
  assert.equal(markup.querySelectorAll('.status-anchor').length, 0);
  const hint = markup.getElementById('companion-save-hint');
  // Loop 3 (G-03): the line under Save is empty and hidden until something is said in it; what Save does is its tooltip.
  assert.equal(hint.textContent, '');
  assert.equal(hint.hidden, true);
  assert.match(markup.getElementById('companion-save-watchlist').getAttribute('title'), /^Add to your watchlist/);
  const realSetTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, wait) => { timers.push({ callback, wait }); return timers.length; };
  try {
    const page = await loadCompanion({ sendMessage: async (command) => (command.type === 'lot.save' ? { ok: false, outcome: 'not-committed', message: 'The store is full.' } : WORKING_SNAPSHOT) });
    page.element('companion-save-hint').hidden = true;
    page.card({ title: 'Price 23', reference: 'Price 23', pageUrl: 'https://numismatics.org/pella/id/price.23' });
    await page.click('companion-save-watchlist');
    assert.equal(page.element('companion-save-hint').textContent, 'The store is full.');
    assert.equal(page.element('companion-save-hint').hidden, false);
    assert.equal(page.element('announcement').textContent, 'The store is full.');
    const restore = timers.filter(({ wait }) => wait === 8000).at(-1);
    assert.ok(restore, 'the line is restored after 8 s');
    restore.callback();
    assert.equal(page.element('companion-save-hint').textContent, '');
    assert.equal(page.element('companion-save-hint').hidden, true);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

// Fix round 2 (N7, with L3's lotsNeedingOutcome): the Watchlist tab says how many lots ended with no outcome recorded, and opens the workspace on
// that queue.
test('the Watchlist tab counts lots ended without an outcome and opens their queue', async () => {
  const ended = { id: 'e1', name: 'Roma E-Sale 120', localDate: '2020-01-10', timeZone: 'Europe/London', precision: 'date' };
  const lots = [{ id: 'a', auctionEventId: 'e1', outcome: { status: 'open' } }, { id: 'b', auctionEventId: 'e1' }, { id: 'c', auctionEventId: 'e1', outcome: { status: 'won' } }];
  const snapshot = { ok: true, value: { lots, auctionEvents: [ended], alerts: [], preferences: { currency: 'USD', revision: 1 } } };
  const opened = [];
  const create = globalThis.browser.tabs.create;
  const getURL = globalThis.browser.runtime.getURL;
  globalThis.browser.tabs.create = async ({ url }) => { opened.push(url); return { id: 9 }; };
  globalThis.browser.runtime.getURL = (path) => `moz-extension://test/${path}`;
  try {
    const page = await loadCompanion({ sendMessage: async () => snapshot });
    assert.equal(page.element('companion-needs-outcome').hidden, false);
    assert.equal(page.element('companion-open-needs-outcome').textContent, '2 lots ended without an outcome');
    await page.click('companion-open-needs-outcome');
    assert.deepEqual(opened, ['moz-extension://test/workspace.html#watchlist?queue=needs-outcome']);
    const none = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT });
    assert.equal(none.element('companion-needs-outcome').hidden, true);
  } finally {
    globalThis.browser.tabs.create = create;
    globalThis.browser.runtime.getURL = getURL;
  }
});

test('the workspace opens on the queue its address names, and ignores one it does not list', async () => {
  const { mountWorkspace } = await import('./helpers/dom.mjs');
  const named = await mountWorkspace({ hash: '#watchlist?queue=needs-outcome' });
  assert.equal(named.document.getElementById('lot-queue').value, 'needs-outcome');
  const plain = await mountWorkspace({ hash: '#watchlist' });
  const unknown = await mountWorkspace({ hash: '#watchlist?queue=nonsense' });
  assert.equal(unknown.document.getElementById('lot-queue').value, plain.document.getElementById('lot-queue').value);
  assert.notEqual(unknown.document.getElementById('lot-queue').value, 'nonsense');
});

// Loop 3 (G-13): the workspace is named in the header, one click from every tab.
test('the header’s Workspace opens the workspace', async () => {
  const opened = [];
  const create = globalThis.browser.tabs.create;
  const getURL = globalThis.browser.runtime.getURL;
  globalThis.browser.tabs.create = async ({ url }) => { opened.push(url); return { id: 9 }; };
  globalThis.browser.runtime.getURL = (path) => `moz-extension://test/${path}`;
  try {
    const page = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT });
    await page.click('open-workspace');
    assert.deepEqual(opened, ['moz-extension://test/workspace.html#watchlist']);
  } finally {
    globalThis.browser.tabs.create = create;
    globalThis.browser.runtime.getURL = getURL;
  }
});

// Loop 3 (G-02, G-12): Open on a saved coin's line opens the workspace on that coin; an id the store no longer holds opens the list as before.
test('the workspace opens on the coin its address names', async () => {
  const background = await createWorkspaceBackground();
  const saved = await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Nero · As · Rome · AD 62–68', reference: 'RIC I² Nero 306', sourceLinks: [], notes: '' } });
  const named = await mountWorkspace({ background, hash: `#watchlist?lot=${saved.value.id}` });
  for (let tick = 0; tick < 20; tick += 1) await settle();
  assert.equal(named.$('selected-title').textContent, 'Nero · As · Rome · AD 62–68');
  assert.equal(named.$('coin-editor').hidden, false);
  const unknown = await mountWorkspace({ background, hash: '#watchlist?lot=00000000-0000-4000-8000-00000000ffff' });
  for (let tick = 0; tick < 20; tick += 1) await settle();
  assert.notEqual(unknown.$('selected-title').textContent, 'Nero · As · Rome · AD 62–68');
});

// Loop 3 (G-11, WL-01): the Watchlist tab said "Next auction" with no date, four zero rows of exposure, and the same thing twice as an icon and a button.
// It says when the next auction is, which coins want the collector now (each opening the workspace on that coin), and only the currencies that hold a
// bid, with the narrow symbol; one button, no intro. Q-14: a reminder missed while the browser was closed is counted too, and named apart.
test('the Watchlist tab says when, which coins, and only the bids that exist', async () => {
  const markup = parseHtmlFile(new URL('../extension/popup.html', import.meta.url));
  const panel = markup.getElementById('companion-panel-watchlist');
  assert.equal(markup.getElementById('companion-open-workspace'), null, 'no second way to the same place');
  assert.equal(panel.querySelectorAll('.companion-intro').length, 0);
  assert.equal(panel.querySelectorAll('button').filter((button) => !button.closest('.companion-needs-outcome')).length, 1);
  const now = new Date();
  const inDays = (days) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  const cng = { id: 'cng', name: 'CNG Feature Auction 130', eventKind: 'auction-day', precision: 'date-only', localDate: inDays(20), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const roma = { id: 'roma', name: 'Roma E-Sale 120', eventKind: 'auction-day', precision: 'date-only', localDate: '2020-01-10', timeZone: 'Europe/London' };
  const lots = [
    { id: 'a', title: 'Hadrian denarius', reference: 'RIC II.3 Hadrian 2726', auctionEventId: 'roma', outcome: { status: 'open' } },
    { id: 'b', title: 'Nero as', reference: 'RIC I (second edition) Nero 306', auctionEventId: 'cng', outcome: { status: 'open' }, activeBid: { amount: { currency: 'GBP', minor: 65000 }, buyerPremiumBps: 2000 } },
    { id: 'c', title: 'Won coin', auctionEventId: 'cng', outcome: { status: 'won' } },
  ];
  const alerts = [{ eventId: 'cng', status: 'due' }, { eventId: 'roma', status: 'missed' }];
  const snapshot = { ok: true, value: { lots, auctionEvents: [cng, roma], alerts, preferences: { currency: 'USD', revision: 1 } } };
  const opened = [];
  const create = globalThis.browser.tabs.create;
  const getURL = globalThis.browser.runtime.getURL;
  globalThis.browser.tabs.create = async ({ url }) => { opened.push(url); return { id: 9 }; };
  globalThis.browser.runtime.getURL = (path) => `moz-extension://test/${path}`;
  try {
    const page = await loadCompanion({ sendMessage: async () => snapshot });
    assert.match(page.element('companion-next-event').textContent, /^CNG Feature Auction 130 · sale day \w{3}, \w{3} \d+ · in 20 days$/);
    assert.equal(page.element('companion-due-count').textContent, '1 due · 1 missed');
    const rows = page.element('companion-coin-list').children.map((item) => item.children[0]);
    // H-16: a row leads with the coin's reference, as every workspace row does, then its title, then when.
    const parts = (button) => button.children.map((part) => (typeof part === 'string' ? part : `${part.className}:${part.textContent}`)).join('');
    assert.deepEqual(rows.map(parts), [
      'coin-reference:RIC II.3 Hadrian 2726 · coin-title:Hadrian denarius · coin-when:ended, record the outcome',
      'coin-reference:RIC I² Nero 306 · coin-title:Nero as · coin-when:in 20 days',
    ]);
    const unreferenced = coinsToWatch({ lots: [{ id: 'x', title: 'Unread coin', auctionEventId: 'cng', outcome: { status: 'open' } }], auctionEvents: [cng] });
    assert.deepEqual(unreferenced.map(({ reference, title, when }) => [reference, title, when]), [['', 'Unread coin', 'in 20 days']]);
    assert.equal(page.element('companion-coins').hidden, false);
    assert.equal(page.element('companion-empty').hidden, true, 'a tab with coins says nothing of their absence');
    const exposure = page.element('companion-exposure-list').children;
    assert.equal(exposure.length, 1, 'only the currency that holds a bid');
    assert.equal(exposure[0].children[0].textContent, 'GBP');
    assert.equal(exposure[0].children[1].textContent, '£650.00');
    await rows[1].emit('click');
    for (let tick = 0; tick < 20; tick += 1) await settle();
    assert.deepEqual(opened, ['moz-extension://test/workspace.html#watchlist?lot=b']);
    const empty = await loadCompanion({ sendMessage: async () => WORKING_SNAPSHOT });
    assert.equal(empty.element('companion-due-count').textContent, 'None due');
    assert.equal(empty.element('companion-next-event').textContent, 'No upcoming auction');
    assert.equal(empty.element('companion-coins').hidden, true);
    // H-07 (popup part): the tab with no coin at all says, once and in the workspace's voice, how one gets here.
    assert.equal(empty.element('companion-empty').hidden, false);
    assert.deepEqual(empty.element('companion-exposure-list').children.map((item) => item.textContent), ['No active bids']);
  } finally {
    globalThis.browser.tabs.create = create;
    globalThis.browser.runtime.getURL = getURL;
  }
  // The Watchlist tab writes each currency's amount with its narrow symbol, through formatMoney.
  const { formatMoney } = await import('../extension/core/money.js');
  assert.equal(formatMoney({ currency: 'USD', minor: 26000 }, 'en-GB', { narrow: true }), '$260.00');
  assert.match(formatMoney({ currency: 'CHF', minor: 120000 }, 'en-US', { narrow: true }), /^CHF\s1,200\.00$/);
  assert.deepEqual([dueText({ dueAuctionCount: 0, missedAuctionCount: 0 }), dueText({ dueAuctionCount: 2, missedAuctionCount: 0 }), dueText({ dueAuctionCount: 0, missedAuctionCount: 1 })],
    ['None due', '2 due', '1 missed']);
  assert.equal(buildWatchlistSummary({ alerts: [{ eventId: 'x', status: 'missed' }, { eventId: 'x', status: 'missed' }, { eventId: 'y', status: 'acknowledged' }] }).missedAuctionCount, 1);
});

// Fix round (review I1): Undo acts only on the coin whose line is on screen. Once the lookup that Watch was pressed in is gone, the old Undo does
// nothing, and the line goes with it.
test('Undo can never act on a lot that is no longer on screen', async () => {
  const background = await createWorkspaceBackground();
  const page = await loadCompanion({ sendMessage: storeReplies(background) });
  page.watch({ title: 'Roma, Lot 11', reference: 'RIC I² Nero 306', pageUrl: 'https://www.acsearch.info/search.html?id=11', closesAt: '2099-10-12' });
  await settleAll();
  const line = page.element('upcoming-saved');
  const undo = lineButton(line, 'Undo');
  assert.ok(undo);
  // The research half clears its output for the next lookup, and says so with an empty card.
  page.card(null);
  assert.equal(line.hidden, true);
  await undo.emit('click');
  await settleAll();
  assert.equal(background.root().lots.length, 1, 'the coin off screen is kept');
  // The same for a card's own line, once another card is on show.
  page.card(neroCard);
  await page.click('companion-save-watchlist');
  await settleAll();
  const cardUndo = lineButton(page.element('companion-saved-line'), 'Undo');
  page.card({ title: 'Price 23', reference: 'Price 23', pageUrl: 'https://numismatics.org/pella/id/price.23' });
  await cardUndo.emit('click');
  await settleAll();
  assert.equal(background.root().lots.length, 2);
});

// Fix round (review M6): the saved line is a status region, so the save is said once, by the line.
test('a save is announced once, by its line', async () => {
  const background = await createWorkspaceBackground();
  const page = await loadCompanion({ sendMessage: storeReplies(background) });
  page.card(neroCard);
  page.element('announcement').textContent = '';
  await page.click('companion-save-watchlist');
  await settleAll();
  assert.equal(page.element('announcement').textContent, '');
  assert.match(lineParts(page.element('companion-saved-line')), /^\[Watching\]/);
});

// Fix round (review M7): owning one example of a type is no reason not to watch another. A card whose every saved coin is settled keeps Save beside
// the line; an open one still takes its place.
test('a card whose saved coins are all settled still offers Save', async () => {
  const won = { id: 'won-1', title: 'Nero as', reference: 'RIC I² Nero 306', outcome: { status: 'won' } };
  const snapshot = { ok: true, value: { lots: [won], auctionEvents: [], alerts: [], preferences: { currency: 'USD', revision: 1 } } };
  const page = await loadCompanion({ sendMessage: async () => snapshot });
  page.card(neroCard);
  assert.equal(lineParts(page.element('companion-saved-line')), '[In your collection]');
  assert.equal(page.element('companion-save-watchlist').hidden, false);
  assert.equal(savedLineText([{ reference: 'Price 23', outcome: { status: 'lost' } }], {}), 'Saved · Lost');
});

// Fix round (review M8): a coin removed elsewhere (a workspace tab) inside the Undo window takes its "Saved" line with it.
test('a coin removed elsewhere takes its saved line with it', async () => {
  const background = await createWorkspaceBackground();
  const listeners = [];
  const onChanged = globalThis.browser.storage.onChanged;
  globalThis.browser.storage.onChanged = { addListener: (listener) => listeners.push(listener), removeListener() {} };
  try {
    const page = await loadCompanion({ sendMessage: storeReplies(background) });
    page.card(neroCard);
    await page.click('companion-save-watchlist');
    await settleAll();
    const [lot] = background.root().lots;
    await background.send({ type: 'lot.delete', lotId: lot.id, expectedRevision: lot.revision });
    for (const listener of listeners) listener({ 'auctionCompanion:v1': { newValue: background.root() } }, 'local');
    await settleAll();
    assert.equal(page.element('companion-saved-line').hidden, true);
    assert.equal(page.element('companion-save-watchlist').hidden, false);
  } finally {
    globalThis.browser.storage.onChanged = onChanged;
  }
});

// Q-11 (popup part): an exposure row gives what leaves the account if every bid wins, from the fees saved with the bids.
test('the Watchlist tab gives each currency its all-in figure beside the hammers', () => {
  const summary = buildWatchlistSummary({ lots: [
    { id: 'a', outcome: { status: 'open' }, activeBid: { amount: { currency: 'GBP', minor: 65000 }, buyerPremiumBps: 2000 },
      costEstimate: { currency: 'GBP', shippingMinor: 1500, paymentFeeBps: 0, paymentFeeMinor: 0, incrementMinor: 1, minimumBidMinor: 0 } },
    { id: 'b', outcome: { status: 'open' }, activeBid: { amount: { currency: 'GBP', minor: 10000 }, buyerPremiumBps: 2000 } },
  ] });
  assert.equal(summary.exposure.GBP.knownTotalMinor, 65000 + 13000 + 1500);
  assert.equal(summary.exposure.GBP.totalCount, 1);
  assert.equal(summary.exposure.USD.totalCount, 0);
});

// G-22: a card whose type is on the want list says so under it, with the want's terms, matched by the catalogue rules; the want list goes to the research
// half for its Upcoming rows, and follows every snapshot.
test('a card of a wanted type says “On your want list” under it, and the research half is handed the list', async () => {
  const background = await createWorkspaceBackground();
  await background.send({ type: 'want.save', expectedRevision: null, want: { reference: 'RIC I (second edition) Nero 306', maxPrice: { currency: 'GBP', minor: 65000 }, minGrade: 'VF' } });
  const listeners = [];
  const shared = [];
  const onChanged = globalThis.browser.storage.onChanged;
  const dispatch = globalThis.dispatchEvent;
  globalThis.browser.storage.onChanged = { addListener: (listener) => listeners.push(listener), removeListener() {} };
  globalThis.dispatchEvent = (event) => { if (event?.type === 'giga-pinax-wants') shared.push(event.detail); return true; };
  try {
    const page = await loadCompanion({ sendMessage: storeReplies(background) });
    assert.deepEqual(shared.at(-1).map(({ reference }) => reference), ['RIC I (second edition) Nero 306']);
    const line = page.element('companion-want-line');
    page.card(neroCard);
    assert.equal(line.hidden, false);
    // H-05: the want is the row's second pill, short; its sentence is the tooltip. Fix round: the sentence is also the pill's text for a screen
    // reader, in a visually hidden part the status line announces, and the short words are hidden from it.
    assert.equal(line.children[0].className, 'pill want-pill');
    assert.deepEqual(pillParts(line.children[0]), [['true', 'Wanted · up to £650 · VF+'], ['sr-only', 'On your want list · up to £650.00 · VF or better']]);
    assert.equal(line.children[0].title, 'On your want list · up to £650.00 · VF or better');
    assert.equal(page.element('companion-status-row').hidden, false);
    // A neighbouring type is not the want.
    page.card({ title: 'Nero · As', reference: 'RIC I² Nero 306a', pageUrl: 'https://numismatics.org/ocre/id/ric.1(2).ner.306a' });
    assert.equal(line.hidden, true);
    page.card(neroCard);
    assert.equal(line.hidden, false);
    // A lookup that answers with a list of candidates draws no card: the research half clears it, and the line goes.
    page.card(null);
    assert.equal(line.hidden, true);
    page.card(neroCard);
    // Typing a new reference takes the card, and the line with it.
    await page.element('quick-reference').emit('input');
    assert.equal(line.hidden, true);
    // Marked found in another view: the next snapshot takes the line away.
    page.card(neroCard);
    const lot = (await background.send({ type: 'lot.save', expectedRevision: null, lot: { title: 'Nero', reference: 'RIC I² Nero 306', sourceLinks: [] } })).value;
    await background.send({ type: 'lot.outcome.set', lotId: lot.id, expectedRevision: 0, outcome: { status: 'won' } });
    const [want] = background.root().wants;
    await background.send({ type: 'want.found', wantId: want.id, expectedRevision: 0, lotId: lot.id });
    for (const listener of listeners) listener({ 'auctionCompanion:v1': { newValue: background.root() } }, 'local');
    await settleAll();
    assert.equal(line.hidden, true);
    assert.equal(shared.at(-1)[0].foundLotId, lot.id, 'the research half hears of it too');
  } finally {
    globalThis.browser.storage.onChanged = onChanged;
    globalThis.dispatchEvent = dispatch;
  }
});

// Fix round (r1-review Important 1): a Bopearachchi card's label is not a reference the rules read ("Bactrian and Indo-Greek Coinage Euthydemus I
// 9C"), so the card hands over its reading, as the Upcoming rows read it (referenceFromCard), and the line is drawn from that.
test('a Bopearachchi card of a wanted type says so under it, from the reading the card hands over', async () => {
  const background = await createWorkspaceBackground();
  await background.send({ type: 'want.save', expectedRevision: null, want: { reference: 'Bopearachchi Euthydemus I 9C' } });
  const page = await loadCompanion({ sendMessage: storeReplies(background) });
  const line = page.element('companion-want-line');
  const bopCard = { title: 'Euthydemus I · Tetradrachm', reference: 'Bactrian and Indo-Greek Coinage Euthydemus I 9C', pageUrl: 'https://numismatics.org/bigr/id/bop.9c' };
  page.card({ ...bopCard, reading: { catalogue: 'Bop', number: '9C', volume: '', section: 'Euthydemus I' } });
  assert.equal(line.hidden, false);
  assert.deepEqual(pillParts(line.children[0]), [['true', 'Wanted'], ['sr-only', 'On your want list']]);
  page.card({ ...bopCard, reading: { catalogue: 'Bop', number: '9C', volume: '', section: 'Euthydemus II' } });
  assert.equal(line.hidden, true, 'another king is another type');
  page.card(bopCard);
  assert.equal(line.hidden, true, 'without a reading the label reads as nothing');
});

// H-04 (cycle 5): the card's saved line writes its bid by the one page rule - the browser's language, the narrow sign
// where it names one currency - as the Watchlist tab beside it does: ¥, never JP¥.
test('the saved line writes the bid in the browser locale with the narrow sign', () => {
  const lot = { reference: 'RIC I² Nero 306', activeBid: { amount: { currency: 'JPY', minor: 1200000 } } };
  assert.equal(savedLineText([lot], {}, { locale: 'en-GB' }), 'On your watchlist · Bid active ¥1,200,000');
  const sek = { reference: 'RIC I² Nero 306', plannedBid: { amount: { currency: 'SEK', minor: 1250000 } } };
  assert.equal(savedLineText([sek], {}, { locale: 'en-GB' }).replace(/\u00a0/g, ' '), 'On your watchlist · Bid planned SEK 12,500.00');
});

// Fix round (review Important 1): a pill never cuts an amount. It writes a whole amount without its places, as the card's short words, and an
// amount with pence in full; the row wraps rather than cutting a pill (companion-popup.css).
test('a status pill writes its amount whole where exact and in full otherwise, and nothing cuts it', () => {
  const bid = (minor) => [{ reference: 'Price 23', activeBid: { amount: { currency: 'GBP', minor } } }];
  assert.equal(savedPillText(bid(1250000), {}, { locale: 'en-GB' }), 'Watching · £12,500 bid');
  assert.equal(savedPillText(bid(1250050), {}, { locale: 'en-GB' }), 'Watching · £12,500.50 bid');
  assert.equal(savedPillText([{ reference: 'Price 23', plannedBid: { amount: { currency: 'JPY', minor: 1200000 } } }], {}, { locale: 'en-GB' }), 'Watching · ¥1,200,000 planned');
  assert.equal(wantPillText([{ maxPrice: { currency: 'GBP', minor: 1125000 }, minGrade: 'EF' }], 'en-GB'), 'Wanted · up to £11,250 · EF+');
  assert.equal(wantPillText([{ maxPrice: { currency: 'SEK', minor: 1250000 } }], 'en-GB').replace(/ /g, ' '), 'Wanted · up to SEK 12,500');
  // The full sentence keeps the places, as every other line does.
  assert.equal(savedLineText(bid(1250000), {}, { locale: 'en-GB' }), 'On your watchlist · Bid active £12,500.00');
  const css = readFileSync(new URL('../extension/companion-popup.css', import.meta.url), 'utf8');
  assert.match(css, /\.status-row \{[^}]*flex-wrap:wrap/);
  assert.doesNotMatch(css, /text-overflow:ellipsis/);
});

// Loop 6 (K-01): a coin saved from the card has no auction, and the tab named Watchlist listed only coins with one, so the newcomer's first save
// vanished from it. The tab says what the list holds, lists open coins with no sale (newest first, "no sale date · Add"), and the coin just saved
// leads the list for as long as the popup is open.
test('the Watchlist tab lists a coin with no auction, and the coin just saved leads it', async () => {
  const now = new Date();
  const inDays = (days) => new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cng = { id: 'cng', name: 'CNG 130', eventKind: 'auction-day', precision: 'date-only', localDate: inDays(20), timeZone: zone };
  const lots = [
    { id: 'old', title: 'Older coin', reference: 'Price 23', outcome: { status: 'open' }, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'new', title: 'Newer coin', reference: 'RIC I (second edition) Nero 306', outcome: { status: 'open' }, createdAt: '2026-02-01T00:00:00.000Z' },
    { id: 'sale', title: 'Coin with a sale', reference: 'Crawford 44/5', auctionEventId: 'cng', outcome: { status: 'open' } },
    { id: 'won', title: 'Won coin', reference: 'Price 24', outcome: { status: 'won' } },
  ];
  const snapshot = { lots, auctionEvents: [cng] };
  const rows = coinsToWatch(snapshot, { locale: 'en-GB' });
  assert.deepEqual(rows.map(({ lot, when, noSale }) => [lot.id, when, Boolean(noSale)]),
    [['sale', 'in 20 days', false], ['new', 'no sale date', true], ['old', 'no sale date', true]]);
  assert.deepEqual(coinsToWatch(snapshot, { first: 'old' }).map(({ lot }) => lot.id), ['old', 'sale', 'new']);
  assert.equal(watchlistCountText(snapshot), '3 coins on your watchlist · 1 with a sale coming');
  assert.equal(watchlistCountText({ lots: [lots[0]] }), '1 coin on your watchlist');
  assert.equal(watchlistCountText({ lots: [lots[3]] }), 'No coins on your watchlist');
  assert.equal(watchlistCountText({ lots: [] }), '', 'a store with no coin keeps its own empty state');

  const background = await createWorkspaceBackground();
  const opened = [];
  const create = globalThis.browser.tabs.create;
  const getURL = globalThis.browser.runtime.getURL;
  globalThis.browser.tabs.create = async ({ url }) => { opened.push(url); return { id: 9 }; };
  globalThis.browser.runtime.getURL = (path) => `moz-extension://test/${path}`;
  try {
    const page = await loadCompanion({ sendMessage: storeReplies(background) });
    assert.equal(page.element('companion-count').hidden, true);
    assert.equal(page.element('companion-empty').hidden, false);
    page.card(neroCard);
    await page.click('companion-save-watchlist');
    await settleAll();
    const [saved] = background.root().lots;
    assert.equal(page.element('companion-count').textContent, '1 coin on your watchlist');
    assert.equal(page.element('companion-count').hidden, false);
    assert.equal(page.element('companion-empty').hidden, true);
    assert.equal(page.element('companion-coins').hidden, false);
    const [item] = page.element('companion-coin-list').children;
    const [row, add] = item.children;
    assert.equal(row.children.map((part) => (typeof part === 'string' ? part : part.textContent)).join(''), 'RIC I² Nero 306 · Nero · As · Rome · AD 62–68 · no sale date');
    assert.equal(add.textContent, 'Add');
    assert.equal(add['aria-label'], 'Add a sale date to Nero · As · Rome · AD 62–68 in the workspace');
    await add.emit('click');
    await settleAll();
    assert.deepEqual(opened, [`moz-extension://test/workspace.html#watchlist?lot=${saved.id}`]);
  } finally {
    globalThis.browser.tabs.create = create;
    globalThis.browser.runtime.getURL = getURL;
  }
});

// Loop 6 (X-11): a Save whose message port closed printed the browser's own words ("The message port closed before a response was received.") under
// the card. Every bridge failure is one sentence naming the button to press again; the retry is the same request, and the store keeps one coin.
test('a save whose bridge throws says so in words, keeps its request for the retry, and records only the kind of failure', async () => {
  const background = await createWorkspaceBackground();
  const commands = [];
  let fail = true;
  const page = await loadCompanion({ sendMessage: async (command) => {
    commands.push(structuredClone(command));
    if (command.type === 'lot.save' && fail) { fail = false; await background.send(command); throw new Error('The message port closed before a response was received.'); }
    return background.send(command);
  } });
  page.card(neroCard);
  await page.click('companion-save-watchlist');
  await settleAll();
  const hint = page.element('companion-save-hint').textContent;
  assert.equal(hint, 'Giga Pinax’s background didn’t answer. Select Watch again — the same request is retried, never saved twice.');
  assert.doesNotMatch(hint, /port closed/);
  assert.equal(page.element('companion-save-watchlist').disabled, false);
  await page.click('companion-save-watchlist');
  await settleAll();
  const saves = commands.filter(({ type }) => type === 'lot.save');
  assert.equal(saves.length, 2);
  assert.equal(saves[0].requestId, saves[1].requestId);
  assert.equal(background.root().lots.length, 1, 'committed before the port closed, and not written twice');
  assert.equal(lineParts(page.element('companion-saved-line')), '[Watching] · [Open] · [Undo]');

  // The capture's draft path says the same of its own button, and keeps its request.
  const sent = [];
  const saver = createDraftSaver({ newRequestId: () => 'request-draft', sendCommand: async (command) => { sent.push(command.requestId); if (sent.length === 1) throw new Error('port closed'); return { ok: true, value: { id: 'draft-1' } }; },
    openDraft: async () => ({ ok: true }) });
  const first = await saver({ reference: 'RIC 306' });
  assert.equal(first.ok, false);
  assert.equal(first.unanswered, true);
  assert.equal(Object.hasOwn(first, 'message'), false, 'no browser words travel with it');
  assert.equal((await saver({ reference: 'RIC 306' })).ok, true);
  assert.deepEqual(sent, ['request-draft', 'request-draft']);
});

// Loop 6 (X-05, popup side): a Save whose reply never came left the button disabled for ever, with nothing said. After eight seconds the line under
// it says the save got no answer and offers the same request again; the button is back, and the retry stores one coin.
test('a save with no answer within eight seconds says so under Watch, gives Watch back, and retries the same request', async () => {
  const background = await createWorkspaceBackground();
  const realSetTimeout = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, wait) => { timers.push({ callback, wait }); return timers.length; };
  try {
    const commands = [];
    let hang = true;
    const page = await loadCompanion({ sendMessage: async (command) => {
      commands.push(structuredClone(command));
      if (command.type === 'lot.save' && hang) { hang = false; return new Promise(() => {}); }
      return background.send(command);
    } });
    page.card(neroCard);
    const clicked = page.element('companion-save-watchlist').emit('click');
    await settleAll();
    assert.equal(page.element('companion-save-watchlist').disabled, true, 'held while the save waits');
    const deadline = timers.find(({ wait }) => wait === 8000);
    assert.ok(deadline, 'the wait has a deadline');
    deadline.callback();
    await clicked;
    await settleAll();
    const hint = page.element('companion-save-hint');
    assert.equal(hint.hidden, false);
    assert.equal(lineParts(hint), 'The save didn’t get an answer. · [Retry the same request]');
    assert.equal(page.element('companion-save-watchlist').disabled, false);
    assert.equal(page.element('companion-save-watchlist').hidden, false);
    await lineButton(hint, 'Retry the same request').emit('click');
    await settleAll();
    const saves = commands.filter(({ type }) => type === 'lot.save');
    assert.equal(saves.length, 2);
    assert.equal(saves[0].requestId, saves[1].requestId);
    assert.equal(background.root().lots.length, 1);
    assert.equal(lineParts(page.element('companion-saved-line')), '[Watching] · [Open] · [Undo]');
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});
