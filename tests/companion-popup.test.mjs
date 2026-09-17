import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
globalThis.addEventListener = (type, listener) => {
  if (type === 'giga-pinax-card') cardListeners.push(listener);
  if (type === 'giga-pinax-lookup-received') lookupListeners.push(listener);
};
globalThis.dispatchEvent = () => true;
globalThis.requestAnimationFrame = (callback) => { callback(); return 0; };

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
} = await import('../extension/companion-popup.js');

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
  lookupListeners.length = 0;
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
  assert.equal(shouldRevealRefine({ status: 'candidates' }), true);
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
    // A reply nobody could read names no reason a collector could act on, so it is never shown as one.
    assert.equal(page.element('companion-status').textContent, announced, name);

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
  assert.equal(page.element('companion-status').textContent, '');

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
  assert.equal(page.element('companion-status').textContent, 'Extension storage is unavailable.');

  page.element('currency').value = 'CHF';
  await page.element('currency').emit('change');
  await settle();
  assert.equal(page.element('companion-status').textContent, 'The currency could not be saved.');

  // Said once: every later change would only repeat it over whatever the page is saying by then.
  page.element('companion-status').textContent = 'Nothing to report.';
  page.element('currency').value = 'EUR';
  await page.element('currency').emit('change');
  await settle();
  assert.equal(page.element('companion-status').textContent, 'Nothing to report.');
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
  const markup = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.match(markup, /id="form-error"[^>]*role="alert"/);
  assert.doesNotMatch(markup, /id="companion-capture-error"[^>]*role="alert"/);
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
  assert.equal(Object.hasOwn(commands.filter(({ type }) => type === 'draft.save').at(-1).payload, 'auctionContext'), false);
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
  assert.equal(Object.hasOwn(lastSaved(), 'auctionContext'), false, 'the sent lookup carries no page of its own');
  // The capture editor no longer claims a page it is not standing for.
  assert.equal(page.element('companion-capture-source').textContent, 'Auction context cleared. Captured fields remain available for research.');
  assert.equal(page.element('companion-capture-reference').value, 'Price 23', 'the captured fields stay available');
});

test('both watchlist actions visibly share one synchronous pending guard', () => {
  const source = readFileSync(new URL('../extension/companion-popup.js', import.meta.url), 'utf8');
  assert.match(source, /if \(draftSavePending\) return;[\s\S]*companion-save-watchlist'\)\.disabled = true;[\s\S]*companion-capture-watchlist'\)\.disabled = true;/);
  assert.match(source, /finally \{[\s\S]*draftSavePending = false;[\s\S]*companion-save-watchlist[\s\S]*companion-capture-watchlist/);
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
