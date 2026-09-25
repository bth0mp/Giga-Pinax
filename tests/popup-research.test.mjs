import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

import * as lookup from '../extension/lookup.js';
import * as prices from '../extension/prices.js';
import * as preferences from '../extension/preferences.js';
import * as catalogues from '../extension/catalogues.js';
import * as selection from '../extension/selection.js';
import * as lot from '../extension/lot.js';
import * as companion from '../extension/companion-popup.js';
import * as localCatalogue from '../extension/local-catalogue.js';
import * as coinArchivesPrices from '../extension/coinarchives-prices.js';
import { parseHtml, runPage } from './helpers/dom.mjs';

// No test here reaches the network. The popup's own lookup goes online after a local miss with whatever fetch the module finds, and in this process
// that was Node's: 33 lookups went to numismatics.org, kept the file waiting seconds for their sockets, and made what a test saw depend on the site.
// Refused, each is the network failure a lookup already reports, as it would be on a machine with no connection.
globalThis.fetch = async (url) => { throw new TypeError(`no network in tests: ${url}`); };

// A lookup reaches this window from this extension's own background, or from another of its pages.
const SENDER = { id: 'giga-pinax@test', url: 'moz-extension://test/background.js' };

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

class TestElement {
  static panelScroll = 0;
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.href = '';
    this.scrollTop = 0;
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    const classes = new Set();
    this.classList = { toggle(name, force = !classes.has(name)) { if (force) classes.add(name); else classes.delete(name); return force; },
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains: (name) => classes.has(name) };
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async emit(type, detail = {}) {
    const event = { target: this, preventDefault() {}, ...detail };
    return Promise.all((this.listeners.get(type) ?? []).map((listener) => listener(event)));
  }
  // As the other half of the page reaches this one: the same listeners, run synchronously.
  dispatchEvent(event) { void this.emit(event?.type); return true; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll() { return []; }
  contains() { return false; }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { delete this[name]; }
  toggleAttribute(name, force) { this[name] = force; }
  // A box given a top by a test sits in the scrolling panel and moves up as the panel scrolls; the panel and the row pinned to its top stay put.
  getBoundingClientRect() {
    const top = (this.top ?? 0) - (['popup-scroll', 'quick-search'].includes(this.id) ? 0 : TestElement.panelScroll);
    return { top, bottom: top + (this.height ?? 0), height: this.height ?? 0 };
  }
  // Recorded, so a test can show the popup never scrolls with it: it scrolls every ancestor, the document included.
  scrollIntoView() { this.scrolledIntoView = (this.scrolledIntoView ?? 0) + 1; }
  scrollTo(options) {
    this.scrolledTo = [...(this.scrolledTo ?? []), options];
    this.scrollTop = options.top;
    if (this.id === 'popup-scroll') TestElement.panelScroll = options.top;
  }
  focus() { this.focused = (this.focused ?? 0) + 1; }
  reportValidity() { return true; }
  setSelectionRange() {}
  // As a browser does for Enter in a field and for the tool's own submissions: the same handler runs, with no submitter button.
  requestSubmit(submitter) { return this.emit('submit', { submitter }); }
}

async function loadPopup({ permissionRequest, priceFetch, coinArchivesFetch = async () => ({ status: 'empty' }), localProvider = null,
  permissionContains = async () => true, lookupTypeImpl = lookup.lookupType, formValidity = true, search = '', focusedId = '',
  session = new Map(), sessionArea = true, sessionGate = null, messageListeners = [], clipboard = [], stored = new Map(),
  specimenFetch = lookup.fetchSpecimens, timers = null }) {
  const elements = new Map();
  TestElement.panelScroll = 0;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new TestElement(id));
    return elements.get(id);
  };
  element('catalogue').value = 'Price';
  element('currency').value = 'USD';
  element('reference-number').value = '23';
  element('period').elements = ['all', '5y', '2y'].map((value) => Object.assign(new TestElement(), { value }));
  element('ric-volume').selectedOptions = [{ label: 'Any volume' }];
  element('reference-form').reportValidity = () => formValidity;

  const document = {
    activeElement: null,
    documentElement: Object.assign(new TestElement(), { dataset: {} }),
    getElementById: element,
    querySelector: (selector) => selector === '.popup-scroll' ? element('popup-scroll') : null,
    createElement: () => new TestElement(),
    // The by-year strip is drawn in SVG: each node records the namespace and tag it was made with, and its attributes as properties.
    createElementNS: (namespace, tag) => Object.assign(new TestElement(), { namespace, tag }),
  };
  if (focusedId) document.activeElement = element(focusedId);
  // The extension's own session area, as both browsers answer it: a promise, and a store that outlives the popup document a permission prompt closed.
  const writes = [];
  const browser = {
    permissions: {
      request: permissionRequest,
      contains: permissionContains,
    },
    runtime: { id: 'giga-pinax@test', getURL: (path) => `moz-extension://test/${path}`, onMessage: { addListener: (listener) => messageListeners.push(listener) } },
    windows: { getCurrent: async () => ({ id: 7 }) },
    storage: sessionArea ? {
      session: {
        get: async (key) => { if (sessionGate) await sessionGate; return session.has(key) ? { [key]: session.get(key) } : {}; },
        set: async (items) => { for (const [key, value] of Object.entries(items)) { writes.push(value); session.set(key, String(value)); } },
        remove: async (key) => { session.delete(key); },
      },
    } : {},
  };
  const dispatched = [];
  const window = new TestElement('window');
  window.open = () => {};
  window.close = () => {};
  const sandbox = {
    ...lookup, ...prices, ...preferences, ...catalogues, ...selection, ...lot, ...companion, ...localCatalogue, ...coinArchivesPrices,
    createLocalCatalogue: () => localProvider,
    fetchPrices: priceFetch,
    fetchCoinArchivesPrices: coinArchivesFetch,
    lookupType: lookupTypeImpl,
    fetchSpecimens: specimenFetch,
    browser,
    document,
    window,
    globalThis: null,
    localStorage: {
      getItem: (key) => (stored.has(key) ? stored.get(key) : null),
      setItem: (key, value) => { stored.set(key, String(value)); },
    },
    location: { search, href: `moz-extension://test/popup.html${search}` },
    navigator: { clipboard: { writeText: async (text) => { clipboard.push(text); } } },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    Option: class extends TestElement { constructor(label, value) { super(); this.label = label; this.value = value; } },
    Event: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    URL, URLSearchParams, Intl, Date, Object, String, Math, JSON, Promise, WeakMap, WeakSet, Set, AbortController,
    // Timers never run unless a test asks to hold them (timers: []) and run them itself.
    setTimeout: (callback) => { timers?.push(callback); return 0; },
    clearTimeout() {},
    // The page announces a received lookup on the window, for the companion half that is not loaded here. Each one is kept
    // with the card still on screen at the time, so what the other half would have seen is what this records.
    dispatchEvent: (event) => { dispatched.push({ type: event?.type, reference: element('result-reference').textContent, detail: event?.detail }); return true; },
    console,
  };
  sandbox.globalThis = sandbox;

  runPage(vm.createContext(sandbox), new URL('../extension/popup.js', import.meta.url));
  return { element, document, window, writes, clipboard, stored, dispatched };
}

const oneSale = {
  status: 'ok',
  lots: [{ id: 'sale-1', title: 'Price 23', date: '2025-01-01', price: '120' }],
};

const coinArchivesSale = {
  status: 'ok', source: 'coinarchives-public', term: 'Price 23', section: 'a', url: 'https://www.coinarchives.com/a/results.php?search=Price+23&s=0',
  matchedCount: 3, renderedCount: 3, cap: 100, capped: false,
  lots: [{ id: 'ca-1', title: 'Auction 1, Lot 2', date: '2025-02-01', price: 'USD 150', amount: 150, currency: 'USD', url: 'https://www.coinarchives.com/a/lotviewer.php?LotID=1', source: 'coinarchives' }],
  selectedLots: [{ id: 'ca-1', title: 'Auction 1, Lot 2', date: '2025-02-01', price: 'USD 150', amount: 150, currency: 'USD', url: 'https://www.coinarchives.com/a/lotviewer.php?LotID=1', source: 'coinarchives' }],
  summary: { count: 1, median: 150, earliest: 2025, latest: 2025 }, availableCurrencyCounts: { EUR: 1, USD: 1 },
  excluded: { upcoming: 1, toBePosted: 0, unpriced: 1, malformedPrice: 0, malformedDate: 0, futureDate: 0, duplicateId: 0, conflictingId: 0 }, dateSpan: { earliest: '2025-02-01', latest: '2025-02-01' },
};

test('the refined Search submits restored fields with an empty or stale top Reference', async () => {
  const lookedUp = [];
  const card = { id: 'rrc-234.1', corpus: 'crro', label: 'RRC 234/1', obverse: {}, reverse: {} };
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async (reference) => { lookedUp.push(reference); return { status: 'ok', card }; } });
  popup.element('catalogue').value = 'RRC';
  popup.element('reference-number').value = '234/1';
  popup.element('quick-reference').value = 'RIC I² Nero 306';
  await popup.element('reference-form').emit('submit', { submitter: popup.element('refine-lookup-button') });
  await settle();
  assert.equal(popup.element('quick-reference').value, '');
  assert.equal(lookedUp.length, 1);
  assert.equal(lookedUp[0].catalogue, 'RRC');
  assert.equal(lookedUp[0].number, '234/1');
});

test('Enter in a refined text input uses refined fields even when restored fields were untouched', async () => {
  const lookedUp = [];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async (reference) => { lookedUp.push(reference); return { status: 'none', corpus: 'crro', query: 'RRC 234/1' }; } });
  popup.element('catalogue').value = 'RRC';
  popup.element('reference-number').value = '234/1';
  await popup.element('reference-number').emit('keydown', { key: 'Enter' });
  await popup.element('reference-form').emit('submit');
  assert.equal(lookedUp.length, 1);
  assert.equal(lookedUp[0].number, '234/1');
});

// Where the cursor happens to be is not a choice of search: the right-click's lookup is submitted by the tool itself, and reading it as a refined
// search threw the selection away and looked up the stored fields instead.
test('a right-click lookup is never read as a refined search, wherever focus was left', async () => {
  for (const focusedId of ['ric-section', 'reference-number']) {
    const lookedUp = [];
    const popup = await loadPopup({ search: '?q=RIC%20I%C2%B2%20Nero%20306', focusedId, permissionRequest: async () => true,
      priceFetch: async () => ({ status: 'empty' }), lookupTypeImpl: async (reference) => { lookedUp.push(reference); return { status: 'network' }; } });
    await settle();
    assert.equal(popup.element('quick-reference').value, 'RIC I² Nero 306', focusedId);
    assert.equal(lookedUp.length, 1, focusedId);
    assert.equal(lookedUp[0].section, 'Nero', focusedId);
    assert.equal(lookedUp[0].number, '306', focusedId);
    // Alt+Shift+G, type, Enter: the cursor waits in the Reference box whatever the lookup did.
    assert.ok(popup.element('quick-reference').focused, focusedId);
  }
});

// Firefox closes the popup over its own permission prompt, taking the typed reference and everything the document held with it; "select Look up again"
// only works if the reference outlived that document, which only the extension's own session store does. A prompt that closes the popup never answers
// this document, so the request is made here as that leaves it: pending for good.
test('a reference typed before a permission prompt is waiting when the popup opens again', async () => {
  const session = new Map();
  const popup = await loadPopup({ session, permissionRequest: () => new Promise(() => {}), priceFetch: async () => ({ status: 'empty' }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(session.get('giga-pinax-pending-reference-v1'), 'Price 23');
  const reopened = await loadPopup({ session, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async () => ({ status: 'ok', card: { id: 'price.23', corpus: 'pella', label: 'Price 23', obverse: {}, reverse: {} } }) });
  await settle();
  assert.equal(reopened.element('quick-reference').value, 'Price 23');
  assert.ok(reopened.element('quick-reference').focused);
  await reopened.element('reference-form').emit('submit');
  await settle();
  const afterLookup = await loadPopup({ session, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }) });
  await settle();
  assert.equal(afterLookup.element('quick-reference').value, '');
});

// The store answers after the popup has opened, so a reference left over from the prompt must never land on top of what is being typed now.
test('a restored reference waits for an empty Reference box, and a browser without the session area keeps none', async () => {
  const typed = await loadPopup({ session: new Map([['giga-pinax-pending-reference-v1', 'Price 23']]),
    permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }) });
  typed.element('quick-reference').value = 'RRC 44/5';
  await settle();
  assert.equal(typed.element('quick-reference').value, 'RRC 44/5');

  const session = new Map();
  const old = await loadPopup({ session, sessionArea: false, permissionRequest: async () => false, priceFetch: async () => ({ status: 'empty' }) });
  old.element('quick-reference').value = 'Price 23';
  await old.element('reference-form').emit('submit');
  await settle();
  assert.equal(session.size, 0);
});

// Every answer ends the lookup the reference was kept for, and an origin already granted opens no prompt to keep one for.
test('an answered lookup keeps no reference, and access already granted was never a prompt', async () => {
  const session = new Map();
  const popup = await loadPopup({ session, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async () => ({ status: 'none', corpus: 'pella', query: 'Price 23' }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.deepEqual(popup.writes, ['Price 23']);
  assert.equal(session.size, 0);
  popup.element('quick-reference').value = 'Price 24';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.deepEqual(popup.writes, ['Price 23']);
});

// A price button prompts for its own origin, and the first CoinArchives click always prompts: what it kept was written after the lookup that owned the
// reference had already forgotten it, and every popup after that opened with the old reference in the box. Only what a closing popup would lose is kept.
test('the price buttons keep no reference, so the next popup opens with an empty box', async () => {
  const session = new Map();
  const popup = await loadPopup({ session, permissionRequest: async () => true, priceFetch: async () => oneSale, coinArchivesFetch: async () => coinArchivesSale,
    lookupTypeImpl: async () => ({ status: 'ok', card: { id: 'price.23', corpus: 'pella', label: 'Price 23', obverse: {}, reverse: {} } }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.equal(session.size, 0);
  const reopened = await loadPopup({ session, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }) });
  await settle();
  assert.equal(reopened.element('quick-reference').value, '');
});

// The reference was kept for a lookup nobody is waiting for any more: he has typed another one over it, and that lookup answers for the box now.
test('a lookup a later one has replaced keeps no reference', async () => {
  const session = new Map();
  const first = deferred();
  const second = deferred();
  let lookups = 0;
  const popup = await loadPopup({ session, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: () => (++lookups === 1 ? first.promise : second.promise) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  popup.element('quick-reference').value = 'Price 24';
  await popup.element('reference-form').emit('submit');
  await settle();
  first.resolve({ status: 'none', corpus: 'pella', query: 'Price 23' });
  await settle();
  assert.deepEqual(popup.writes, ['Price 23']);
  assert.equal(session.size, 0);
});

// The window was asked to show a card while the session store was still answering about an older reference: the card is its subject now, and a reference
// the store hands over afterwards would land in the box of a window looking at something else.
test('a lookup that arrives first leaves no room for a restored reference', async () => {
  const gate = deferred();
  const listeners = [];
  const popup = await loadPopup({ search: '?window=1', messageListeners: listeners, sessionGate: gate.promise,
    session: new Map([['giga-pinax-pending-reference-v1', 'Price 23']]),
    permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }) });
  listeners[0]({ type: 'giga-pinax-lookup', url: 'popup.html?window=1&corpus=pella&id=price.23' }, SENDER, () => {});
  gate.resolve();
  await settle();
  assert.equal(popup.element('quick-reference').value, '');
});

test('only the lookup window answers a lookup sent to an open window', async () => {
  const fallback = [];
  await loadPopup({ search: '?panel=1&window=1', messageListeners: fallback, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }) });
  assert.deepEqual(fallback, []);
  const listeners = [];
  const popup = await loadPopup({ search: '?window=1', messageListeners: listeners, permissionRequest: async () => true,
    priceFetch: async () => ({ status: 'empty' }), lookupTypeImpl: async () => ({ status: 'network' }) });
  assert.equal(listeners.length, 1);
  const answers = [];
  assert.equal(listeners[0]({ type: 'giga-pinax-lookup', url: 'popup.html?window=1&q=Price%2023' }, SENDER, (answer) => answers.push(answer)), true);
  await settle();
  assert.equal(popup.element('quick-reference').value, 'Price 23');
  assert.equal(answers.length, 1);
  assert.equal(answers[0].windowId, 7);
});

// The other half of this page holds the auction context of the page it captured, and a lookup sent here is about a page
// somebody right-clicked on instead. It is told before the card is built, because the card is what carries the context into
// a save. A reference typed into this window by hand says nothing: that lookup is still about the captured page.
test('a lookup sent to this window is announced to the rest of the page before the card is opened', async () => {
  const listeners = [];
  const popup = await loadPopup({ search: '?window=1', messageListeners: listeners, permissionRequest: async () => true,
    priceFetch: async () => ({ status: 'empty' }), lookupTypeImpl: async () => ({ status: 'network' }) });
  popup.dispatched.length = 0;
  listeners[0]({ type: 'giga-pinax-lookup', url: 'popup.html?window=1&q=Price%2023' }, SENDER, () => {});
  await settle();
  const received = popup.dispatched.filter(({ type }) => type === 'giga-pinax-lookup-received');
  assert.equal(received.length, 1);
  assert.equal(received[0].reference, '', 'said while the window still shows no card, so the next one is built without the page');

  // A hand-typed reference is not a lookup this window was sent.
  popup.dispatched.length = 0;
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.deepEqual(popup.dispatched.filter(({ type }) => type === 'giga-pinax-lookup-received'), []);
});

// The lookup window takes an address from a message and opens it. Only this extension sends one: a page that could send
// this message would choose what the collector's open window looks up, and be answered with the window's own id.
test('a lookup is taken only from this extension’s own pages', async () => {
  const listeners = [];
  const popup = await loadPopup({ search: '?window=1', messageListeners: listeners, permissionRequest: async () => true,
    priceFetch: async () => ({ status: 'empty' }), lookupTypeImpl: async () => ({ status: 'network' }) });
  const answers = [];
  const ask = (sender) => listeners[0]({ type: selection.LOOKUP_MESSAGE, url: 'popup.html?window=1&q=Price%2023' }, sender, (answer) => answers.push(answer));
  for (const sender of [{ id: 'somebody-else@test', url: 'moz-extension://other/background.js' },
    { id: 'giga-pinax@test', url: 'https://house.test/sale' }, undefined]) {
    assert.equal(ask(sender), false);
  }
  await settle();
  assert.deepEqual(answers, []);
  assert.equal(popup.element('quick-reference').value, '');
  assert.equal(ask(SENDER), true);
  await settle();
  assert.equal(popup.element('quick-reference').value, 'Price 23');
});

test('refined Search validates before requesting permission or fetching', async () => {
  let permissions = 0, lookups = 0;
  const popup = await loadPopup({ permissionRequest: async () => { permissions += 1; return true; }, priceFetch: async () => ({ status: 'empty' }), formValidity: false,
    lookupTypeImpl: async () => { lookups += 1; return { status: 'network' }; } });
  popup.element('catalogue').value = 'RRC';
  popup.element('reference-number').value = '';
  await popup.element('reference-form').emit('submit', { submitter: popup.element('refine-lookup-button') });
  assert.equal(permissions, 0);
  assert.equal(lookups, 0);
});

test('refined and quick submitters share busy state while keeping empty quick submission safe', async () => {
  const lookupResult = deferred();
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: () => lookupResult.promise });
  popup.element('catalogue').value = 'RRC';
  popup.element('reference-number').value = '234/1';
  const submission = popup.element('reference-form').emit('submit', { submitter: popup.element('refine-lookup-button') });
  await settle();
  assert.equal(popup.element('lookup-button').disabled, true);
  assert.equal(popup.element('refine-lookup-button').disabled, true);
  assert.equal(popup.element('lookup-label').textContent, 'Looking up…');
  assert.equal(popup.element('refine-lookup-label').textContent, 'Searching…');
  lookupResult.resolve({ status: 'none', corpus: 'crro', query: 'RRC 234/1' });
  await submission;
  const safe = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }) });
  safe.element('quick-reference').value = '';
  await safe.element('reference-form').emit('submit', { submitter: safe.element('lookup-button') });
  assert.match(safe.element('form-error').textContent, /Type a reference/i);
});

test('CoinArchives prices require a dedicated click and render a separate public-source median', async () => {
  const permission = deferred();
  let calls = 0;
  let requestedOrigins;
  const popup = await loadPopup({
    permissionRequest: ({ origins }) => { requestedOrigins = origins; return permission.promise; },
    permissionContains: async ({ origins }) => !origins.includes('https://www.coinarchives.com/*'),
    priceFetch: async () => oneSale,
    coinArchivesFetch: async () => { calls += 1; return coinArchivesSale; },
  });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(calls, 0);
  const click = popup.element('coinarchives-prices-button').emit('click');
  assert.equal([...requestedOrigins].join(','), 'https://www.coinarchives.com/*');
  assert.equal(calls, 0);
  permission.resolve(true);
  await click;
  await settle();
  assert.equal(calls, 1);
  assert.equal(popup.element('coinarchives-prices-panel').hidden, false);
  assert.match(popup.element('coinarchives-median').textContent, /150/);
  assert.match(popup.element('coinarchives-sample').textContent, /1 sale · 1 Feb 2025/);
  assert.match(popup.element('coinarchives-coverage').textContent, /added in the past 6 months.*first 100 results/i);
  assert.match(popup.element('coinarchives-counts').textContent, /Other currencies not converted: 1 EUR.*1 unpriced.*1 upcoming/);
  assert.equal(popup.element('prices-panel').hidden, false);
  popup.element('price-term').value = 'edited only for acsearch';
  await popup.element('price-term').emit('input');
  // The public search follows the card, never the acsearch term, and its basis line names the search it ran.
  assert.match(popup.element('coinarchives-coverage').textContent, /CoinArchives public results for Price 23:/);
  assert.equal(popup.element('coinarchives-link').href, coinArchivesSale.url);
});

test('CoinArchives refresh does not reset acsearch exclusions', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale, coinArchivesFetch: async () => coinArchivesSale });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  const exclude = popup.element('sale-list').children[0].children[2];
  await exclude.emit('click');
  assert.equal(popup.element('curation-count').textContent, '0 included · 1 excluded');
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.equal(popup.element('curation-count').textContent, '0 included · 1 excluded');
});

test('CoinArchives period redraw never displays a zero median and a failed retry cannot resurrect old results', async () => {
  let attempt = 0;
  const old = { ...coinArchivesSale, selectedLots: coinArchivesSale.selectedLots.map((sale) => ({ ...sale, date: '2020-02-01' })) };
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale,
    coinArchivesFetch: async () => (++attempt === 1 ? old : { ...coinArchivesSale, status: 'network' }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('coinarchives-prices-button').emit('click');
  popup.element('period').elements[2].checked = true;
  await popup.element('period').emit('change', { target: { value: '2y' } });
  assert.equal(popup.element('coinarchives-median-line').hidden, true);
  assert.match(popup.element('coinarchives-sample').textContent, /No recorded sales in this period/);
  assert.equal(popup.element('announcement').textContent, 'CoinArchives: No recorded sales in this period.');
  await popup.element('coinarchives-prices-button').emit('click');
  assert.equal(popup.element('coinarchives-prices-panel').hidden, true);
  await popup.element('period').emit('change', { target: { value: 'all' } });
  assert.equal(popup.element('coinarchives-prices-panel').hidden, true);
});

test('a denied or failed CoinArchives request leaves acsearch results and its edited term intact', async () => {
  const popup = await loadPopup({ permissionRequest: async () => false, priceFetch: async () => oneSale, coinArchivesFetch: async () => { throw new Error('must not fetch'); } });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  popup.element('price-term').value = 'edited acsearch term';
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.equal(popup.element('prices-panel').hidden, false);
  assert.equal(popup.element('price-term').value, 'edited acsearch term');
  assert.match(popup.element('coinarchives-prices-error').textContent, /permission/i);
});

test('a reference edit prevents a delayed CoinArchives result from rendering', async () => {
  const result = deferred();
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale, coinArchivesFetch: () => result.promise });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  const click = popup.element('coinarchives-prices-button').emit('click');
  await settle();
  popup.element('quick-reference').value = 'Price 24';
  await popup.element('quick-reference').emit('input');
  result.resolve(coinArchivesSale);
  await click;
  await settle();
  assert.equal(popup.element('coinarchives-prices-panel').hidden, true);
});

test('a currency change prevents a delayed old-currency CoinArchives result from rendering', async () => {
  const result = deferred();
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale, coinArchivesFetch: () => result.promise });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  const click = popup.element('coinarchives-prices-button').emit('click');
  await settle();
  popup.element('currency').value = 'GBP';
  await popup.element('currency').emit('change');
  result.resolve(coinArchivesSale);
  await click;
  await settle();
  assert.equal(popup.element('coinarchives-prices-panel').hidden, true);
});

test('guided lookup starts and displays prices while catalogue permission is still pending', async () => {
  const ans = deferred();
  const price = deferred();
  let priceStarted = 0;
  const popup = await loadPopup({
    permissionRequest: () => ans.promise,
    priceFetch: () => { priceStarted += 1; return price.promise; },
  });

  popup.element('quick-reference').value = 'Price 23';
  const submission = popup.element('reference-form').emit('submit');
  await settle();

  assert.equal(popup.element('research-prices').hidden, false);
  assert.equal(priceStarted, 1);
  assert.equal(popup.element('prices-button').disabled, true);

  price.resolve(oneSale);
  await settle();
  assert.equal(popup.element('prices-panel').hidden, false);
  assert.match(popup.element('median-amount').textContent, /120/);

  ans.resolve(false);
  await submission;
  assert.equal(popup.element('prices-panel').hidden, false);
  assert.match(popup.element('median-amount').textContent, /120/);
  assert.equal(popup.element('price-term').value, '"Price 23"');
});

test('RIC local hit neither requests nor waits for ANS permission', async () => {
  let requested = 0;
  let remote = 0;
  const card = { id: 'ric.1(2).ner.306', corpus: 'ocre', label: 'RIC I (second edition) Nero 306', source: 'local', authority: 'nero', denomination: 'as', mint: 'rome', material: 'ae', portrait: null, dates: 'AD 62–68', obverse: { legend: 'NERO', description: 'Head' }, reverse: { legend: null, description: 'Temple' } };
  const popup = await loadPopup({
    permissionRequest: async () => { requested += 1; return false; },
    permissionContains: async () => false,
    priceFetch: async () => ({ status: 'empty', term: 'Nero 306' }),
    localProvider: { serves: (corpus) => corpus === 'ocre', lookupType: async () => ({ status: 'ok', card }), lookupById: async () => ({ status: 'ok', card }) },
  });
  popup.element('quick-reference').value = 'RIC I² Nero 306';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(requested, 0);
  assert.equal(remote, 0);
  // Loop 3 (G-08): the heading writes the short canonical form; the long edition name stays in the source line.
  assert.equal(popup.element('result-reference').textContent, 'RIC I² Nero 306');
  assert.equal(popup.element('result-source').textContent, 'Local OCRE catalogue · RIC I, second edition');
});

// Loop 3 (G-08): one reference in one spelling everywhere the popup writes it - the card, the Recent chip and the coin a save would make - and the
// coin's name is the card's summary line (without the metal), never the reference again.
test('the card, its Recent chip and its watchlist coin write the reference one way, and name the coin by its summary', async () => {
  const card = { id: 'ric.1(2).ner.306', corpus: 'ocre', label: 'RIC I (second edition) Nero 306', source: 'local', authority: 'Nero', denomination: 'As', mint: 'Rome', material: 'Bronze', portrait: null, dates: 'AD 62–68', obverse: { legend: 'NERO', description: 'Head' }, reverse: { legend: null, description: 'Temple' } };
  const popup = await loadPopup({
    permissionRequest: async () => true, permissionContains: async () => false,
    priceFetch: async () => ({ status: 'empty', term: 'Nero 306' }),
    localProvider: { serves: (corpus) => corpus === 'ocre', lookupType: async () => ({ status: 'ok', card }), lookupById: async () => ({ status: 'ok', card }) },
  });
  popup.element('quick-reference').value = 'RIC I² Nero 306';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('result-reference').textContent, 'RIC I² Nero 306');
  const chip = popup.element('recent-list').children[0].children[0];
  assert.equal(chip.textContent, 'RIC I² Nero 306');
  const saved = popup.dispatched.filter(({ type }) => type === 'giga-pinax-card').at(-1).detail;
  assert.equal(saved.reference, 'RIC I² Nero 306');
  assert.equal(saved.title, 'Nero · As · Rome · AD 62–68');
  // Other editions and catalogues keep their own short forms.
  assert.equal(companion.displayReference('RIC II, Part 3 (second edition) Hadrian 12'), 'RIC II.3² Hadrian 12');
  assert.equal(companion.displayReference('RIC II, Part 1 (second edition) Titus 5'), 'RIC II.1² Titus 5');
  assert.equal(companion.displayReference('RIC III Antoninus Pius 1000'), 'RIC III Antoninus Pius 1000');
  assert.equal(companion.displayReference('RRC 44/5'), 'RRC 44/5');
  assert.equal(companion.displayReference('Price 23'), 'Price 23');
  // The short form reads back as the same reference.
  assert.deepEqual(lookup.parseReference('RIC II.3² Hadrian 12'), lookup.parseReference('RIC II, Part 3 (second edition) Hadrian 12'));
});

test('RIC local miss offers an explicit online permission button', async () => {
  let requested = 0;
  const popup = await loadPopup({
    permissionRequest: async () => { requested += 1; return false; }, permissionContains: async () => false,
    priceFetch: async () => ({ status: 'empty', term: 'Nero 99999' }),
    localProvider: { serves: (corpus) => corpus === 'ocre', lookupType: async () => ({ status: 'none' }), lookupById: async () => ({ status: 'none' }) },
  });
  popup.element('quick-reference').value = 'RIC Nero 99999';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(requested, 0);
  assert.equal(popup.element('online-fallback').hidden, false);
  assert.match(popup.element('form-error').textContent, /local OCRE catalogue/);
  await popup.element('online-fallback').onclick();
  await settle();
  assert.equal(requested, 1);
});

// Bundled corpora no longer prompt at Look up, so Check online is now the usual place a Firefox prompt closes the popup.
// A prompt that closes it takes the typed reference with it unless this request remembers it, as Look up's own does.
test('Check online keeps the typed reference, because its prompt is what closes the popup', async () => {
  const session = new Map();
  const popup = await loadPopup({
    session, permissionContains: async () => false, permissionRequest: () => new Promise(() => {}),
    priceFetch: async () => ({ status: 'empty', term: 'Nero 99999' }),
    localProvider: { serves: (corpus) => corpus === 'ocre', lookupType: async () => ({ status: 'none' }), lookupById: async () => ({ status: 'none' }) },
  });
  popup.element('quick-reference').value = 'RIC Nero 99999';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(session.get('giga-pinax-pending-reference-v1'), undefined, 'a bundled lookup asks for nothing, so there is nothing to keep');
  void popup.element('online-fallback').onclick();
  await settle();
  assert.equal(session.get('giga-pinax-pending-reference-v1'), 'RIC Nero 99999');
});

// The corpora bundled beside OCRE, through the popup rather than through the catalogue: every gate here reads the
// corpus the reference names, so a provider that serves only OCRE would never exercise one of them.
const PRICE_CARD = { id: 'price.23', corpus: 'pella', label: 'Price 23', source: 'local', authority: 'Alexander III of Macedon',
  denomination: 'Tetradrachm', mint: null, material: 'Silver', portrait: null, dates: '336–323 BC',
  obverse: { legend: null, description: 'Head of Herakles' }, reverse: { legend: 'ΑΛΕΞΑΝΔΡΟΥ', description: 'Zeus' } };

// The online half of a lookup, counted and never made: the local half is the real code path under test.
function onlineCounter(outcome) {
  const attempts = [];
  return {
    attempts,
    impl: async (reference, options = {}) => (options.online === false
      ? lookup.lookupType(reference, options)
      : (attempts.push(reference), outcome)),
  };
}

test('a bundled Price reference costs no permission prompt and no request', async () => {
  let requested = 0;
  const online = onlineCounter({ status: 'none', corpus: 'pella', query: 'Price 23' });
  const popup = await loadPopup({
    permissionRequest: async () => { requested += 1; return false; }, permissionContains: async () => false,
    priceFetch: async () => ({ status: 'empty', term: 'Price 23' }),
    lookupTypeImpl: online.impl,
    localProvider: { serves: (corpus) => corpus === 'pella', lookupType: async () => ({ status: 'ok', card: PRICE_CARD }),
      lookupById: async () => ({ status: 'ok', card: PRICE_CARD }) },
  });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(requested, 0);
  assert.deepEqual(online.attempts, []);
  assert.equal(popup.element('result-reference').textContent, 'Price 23');
  assert.equal(popup.element('result-source').textContent, 'Local PELLA catalogue');
});

test('a local miss names the catalogue it really searched, not OCRE', async () => {
  for (const [text, corpus, name] of [['Price 99999', 'pella', 'PELLA'], ['Crawford 999/9', 'crro', 'CRRO'],
    ['SC 999999', 'sco', 'SCO'], ['RIC Nero 99999', 'ocre', 'OCRE']]) {
    const online = onlineCounter({ status: 'none', corpus, query: text });
    const popup = await loadPopup({
      permissionRequest: async () => false, permissionContains: async () => false,
      priceFetch: async () => ({ status: 'empty', term: text }),
      lookupTypeImpl: online.impl,
      localProvider: { serves: (served) => served === corpus, lookupType: async () => ({ status: 'none' }),
        lookupById: async () => ({ status: 'none' }) },
    });
    popup.element('quick-reference').value = text;
    await popup.element('reference-form').emit('submit');
    await settle();
    assert.equal(popup.element('online-fallback').hidden, false, text);
    assert.match(popup.element('form-error').textContent, new RegExp(`local ${name} catalogue`), text);
  }
});

test('a local miss for a bundled corpus falls back online exactly once', async () => {
  const online = onlineCounter({ status: 'none', corpus: 'pella', query: 'Price 99999' });
  const popup = await loadPopup({
    permissionRequest: async () => true, permissionContains: async () => true,
    priceFetch: async () => ({ status: 'empty', term: 'Price 99999' }),
    lookupTypeImpl: online.impl,
    localProvider: { serves: (corpus) => corpus === 'pella', lookupType: async () => ({ status: 'none' }),
      lookupById: async () => ({ status: 'none' }) },
  });
  popup.element('quick-reference').value = 'Price 99999';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(online.attempts.length, 1);
  assert.match(popup.element('form-error').textContent, /No Price 99999 found in PELLA/);
});

test('editing cancels a delayed online permission retry', async () => {
  const permission = deferred();
  let localCalls = 0;
  const card = { id: 'x', corpus: 'ocre', label: 'RIC I (second edition) Nero 1', source: 'local', obverse: {}, reverse: {} };
  const popup = await loadPopup({
    permissionRequest: () => permission.promise, permissionContains: async () => false,
    priceFetch: async () => ({ status: 'empty', term: 'Nero 1' }),
    localProvider: { serves: (corpus) => corpus === 'ocre', lookupType: async () => (++localCalls === 1 ? { status: 'none' } : { status: 'ok', card }), lookupById: async () => ({ status: 'none' }) },
  });
  popup.element('quick-reference').value = 'RIC Nero 1';
  await popup.element('reference-form').emit('submit');
  await settle();
  const retry = popup.element('online-fallback').onclick();
  popup.element('quick-reference').value = 'RIC Nero 2';
  await popup.element('quick-reference').emit('input');
  permission.resolve(true);
  await retry;
  await settle();
  assert.equal(localCalls, 1);
  assert.equal(popup.element('result').hidden, true);
});

test('editing during the granted-permission check prevents an obsolete online fallback', async () => {
  const contains = deferred();
  let localCalls = 0;
  const popup = await loadPopup({
    permissionRequest: async () => true, permissionContains: () => contains.promise,
    priceFetch: async () => ({ status: 'empty', term: 'Nero 1' }),
    localProvider: { serves: (corpus) => corpus === 'ocre', lookupType: async () => { localCalls += 1; return { status: 'none' }; }, lookupById: async () => ({ status: 'none' }) },
  });
  popup.element('quick-reference').value = 'RIC Nero 1';
  const submission = popup.element('reference-form').emit('submit');
  await settle();
  popup.element('quick-reference').value = 'RIC Nero 2';
  await popup.element('quick-reference').emit('input');
  contains.resolve(true);
  await submission;
  await settle();
  assert.equal(localCalls, 1);
  assert.equal(popup.element('result').hidden, true);
});

test('editing the reference prevents a delayed automatic price result from rendering', async () => {
  const price = deferred();
  const popup = await loadPopup({
    permissionRequest: async () => false,
    priceFetch: () => price.promise,
  });

  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  popup.element('quick-reference').value = 'Price 24';
  await popup.element('quick-reference').emit('input');
  price.resolve(oneSale);
  await settle();

  assert.equal(popup.element('prices-panel').hidden, true);
  assert.equal(popup.element('median-amount').textContent, '');
});

test('changing currency prevents a delayed old-currency result from rendering', async () => {
  const price = deferred();
  const popup = await loadPopup({
    permissionRequest: async () => false,
    priceFetch: () => price.promise,
  });

  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  popup.element('currency').value = 'GBP';
  await popup.element('currency').emit('change');
  price.resolve(oneSale);
  await settle();

  assert.equal(popup.element('prices-panel').hidden, true);
  assert.equal(popup.element('median-amount').textContent, '');
});

// 0.32: acsearch answers with every lot holding the words, so a row that never cites the reference is left out of the median by default. It stays in
// Inspect sales, can be counted by hand like any other row, and Reset puts the default back.
const citingSale = (id, price, description) => ({ id, title: `Lot ${id}`, date: '2025-01-01', price, description });
const mixedSales = {
  status: 'ok',
  lots: [citingSale('s1', '100', 'Macedon, Alexander III. Tetradrachm. Price 23. Very Fine.'),
    citingSale('s2', '300', 'Macedon, Alexander III. Tetradrachm (4.23 g). Price 3014. Very Fine.')],
};

test('a result that does not cite the reference is left out of the median and counted', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.match(popup.element('median-amount').textContent, /100/);
  assert.equal(popup.element('cited-count').hidden, false);
  // The line names the reference, and its figures are the ones the median beside it rests on.
  assert.equal(popup.element('cited-count').textContent, '1 of 2 results cite Price 23');
  assert.equal(popup.element('curation-count').textContent, '1 included · 1 excluded');
  assert.match(popup.element('announcement').textContent, /1 of 2 results cite Price 23/);
  const toggle = popup.element('sale-list').children[1].children[2];
  assert.equal(toggle.textContent, 'Include');
  await toggle.emit('click');
  assert.match(popup.element('median-amount').textContent, /200/);
  // Both sales are counted now, but only one of them cites the reference, and the line says so (fix round 1 of the 0.33 review).
  assert.equal(popup.element('cited-count').textContent, '1 of 2 results cite Price 23; 2 of 2 counted');
  // The redrawn row keeps the keyboard where it was.
  assert.equal(popup.element('sale-list').children[1].children[2].focused, 1);
  await popup.element('reset-curation').emit('click');
  assert.match(popup.element('median-amount').textContent, /100/);
  assert.equal(popup.element('cited-count').textContent, '1 of 2 results cite Price 23');
});

// 0.32 review: a filter a collector can neither see nor switch off is a median he cannot check.
test('the citation filter is named, checked by default and can be switched off', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('citing-row').hidden, false);
  assert.equal(popup.element('citing-label').textContent, 'Citing Price 23');
  // Loop 3 (G-03): the pill is short; its tooltip is the whole sentence.
  assert.equal(popup.element('citing-row').title, 'Only results citing Price 23');
  assert.equal(popup.element('citing-filter').checked, true);
  assert.match(popup.element('median-amount').textContent, /100/);
  popup.element('citing-filter').checked = false;
  await popup.element('citing-filter').emit('change');
  assert.match(popup.element('median-amount').textContent, /200/);
  assert.equal(popup.element('cited-count').hidden, true);
  assert.equal(popup.element('curation-count').textContent, '2 included · 0 excluded');
});

// The filter judges the card's reference, so it may only judge a search that still looks for it.
test('a term that searches something else is never filtered, and offers no filter', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  popup.element('price-term').value = 'Müller 5';
  await popup.element('prices-form').emit('submit');
  await settle();
  assert.equal(popup.element('citing-row').hidden, true);
  assert.match(popup.element('median-amount').textContent, /200/);
  // 0.33 review (R8): the filter going off is said, in the panel, the announcement and the copied summary alike.
  const line = 'This search does not look for Price 23, so all 2 results are counted.';
  assert.equal(popup.element('cited-count').hidden, false);
  assert.equal(popup.element('cited-count').textContent, line);
  assert.ok(popup.element('announcement').textContent.includes(line));
  await popup.element('copy-summary').emit('click');
  assert.ok(popup.clipboard[0].split('\n').includes(line));
});

// The ruler a collector types between the volume and the number is how dealers cite the coin, so his search still looks for it and is filtered.
test('a typed term that names the ruler inside the citation keeps the filter on', async () => {
  const lots = [citingSale('n1', '100', 'Nero. As. RIC I 306. VF'), citingSale('n2', '300', 'Nero. As. RIC I 3061. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'RIC I Nero 306';
  await popup.element('reference-form').emit('submit');
  await settle();
  popup.element('price-term').value = 'RIC I Nero 306';
  await popup.element('prices-form').emit('submit');
  await settle();
  assert.equal(popup.element('citing-row').hidden, false);
  assert.match(popup.element('median-amount').textContent, /100/);
  assert.equal(popup.element('cited-count').textContent, '1 of 2 results cite RIC 306');
});

// A page of descriptions the filter cannot read (a provider that returns none, a layout it no longer knows) would otherwise empty the median.
test('a page whose text never names the reference is counted whole', async () => {
  const lots = [citingSale('s1', '100', 'Group lot of eight Greek silver coins. Very Fine.'),
    citingSale('s2', '300', 'Group lot of five Greek silver coins. Very Fine.')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.match(popup.element('median-amount').textContent, /200/);
  assert.equal(popup.element('cited-count').textContent, 'No result text names Price 23, so all 2 results are counted.');
  assert.match(popup.element('announcement').textContent, /No result text names Price 23, so all 2 results are counted\./);
  await popup.element('copy-summary').emit('click');
  assert.match(popup.clipboard[0], /\nNo result text names Price 23, so all 2 results are counted\./);
});

// The period is drawn from the page without another request, and the collector's own decisions survive it.
test('a hand-included row stays counted when the period changes', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('sale-list').children[1].children[2].emit('click');
  assert.match(popup.element('median-amount').textContent, /200/);
  await popup.element('period').emit('change', { target: { value: '5y' } });
  assert.match(popup.element('median-amount').textContent, /200/);
  assert.equal(popup.element('curation-count').textContent, '2 included · 0 excluded');
});

// Only the 100 most recent lots come back, whatever the filters then leave: the collector has to know there may be more.
test('the page’s cap is reported even when the filters drop most of it', async () => {
  const lots = Array.from({ length: 100 }, (_, index) => citingSale(`s${index}`, '100',
    index === 0 ? 'Macedon. Tetradrachm. Price 23. VF' : 'Macedon. Tetradrachm. Price 3014. VF'));
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.match(popup.element('price-note').textContent, /acsearch returns the 100 most recent sales/);
  assert.match(popup.element('sale-period').textContent, /^100\+ matches on acsearch/);
});

// Reset undoes the collector's own decisions only, so it is offered as the way back only where it would bring a sale back.
test('an empty median never points at a Reset that would leave it empty', async () => {
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', denomination: 'Tetradrachm', obverse: {}, reverse: {} };
  const lots = [citingSale('s1', '100', 'Alexander III. Drachm. Price 23. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }),
    lookupTypeImpl: async () => ({ status: 'ok', card }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  popup.element('denomination-filter').checked = true;
  await popup.element('denomination-filter').emit('change');
  assert.equal(popup.element('sale-strength').textContent, 'No results are counted. Include one under Inspect sales.');
  // Counted by hand, then excluded again: Reset would only put the toggle's own exclusion back, so it is not what the panel points at.
  await popup.element('sale-list').children[0].children[2].emit('click');
  await popup.element('sale-list').children[0].children[2].emit('click');
  assert.equal(popup.element('sale-strength').textContent, 'No results are counted. Include one under Inspect sales.');
});

// A denomination the filter could only match as an English word is no filter at all.
test('a denomination too short to match as a word offers no toggle', async () => {
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', denomination: 'As', obverse: {}, reverse: {} };
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale,
    lookupTypeImpl: async () => ({ status: 'ok', card }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('denomination-row').hidden, true);
});

test('the denomination toggle is offered by the verified card and filters on its own word', async () => {
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', denomination: 'Tetradrachm', obverse: {}, reverse: {} };
  const lots = [citingSale('s1', '100', 'Alexander III. Tetradrachm. Price 23. VF'), citingSale('s2', '300', 'Alexander III. Drachm. Price 23. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }),
    lookupTypeImpl: async () => ({ status: 'ok', card }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('denomination-row').hidden, false);
  assert.equal(popup.element('denomination-label').textContent, 'Naming “tetradrachm”');
  assert.equal(popup.element('denomination-filter').checked, false);
  assert.match(popup.element('median-amount').textContent, /200/);
  popup.element('denomination-filter').checked = true;
  await popup.element('denomination-filter').emit('change');
  assert.match(popup.element('median-amount').textContent, /100/);
  assert.match(popup.element('cited-count').textContent, /1 of 2 results name “tetradrachm”/);
  popup.element('denomination-filter').checked = false;
  await popup.element('denomination-filter').emit('change');
  assert.match(popup.element('median-amount').textContent, /200/);
  assert.equal(popup.element('cited-count').hidden, true);
});

// Nomisma gives a RIC mint both its English names, and the lookup opens the card under either; the card that came back
// was then compared to the typed reference letter by letter, so "RIC VII Trier 12" opened RIC VII Treveri 12 and then
// counted it as somebody else's coin: no denomination toggle, no type URL in Copy summary, and the term not remembered.
test('a card found under a mint’s other English name is still this reference’s card', async () => {
  const card = { id: 'ric.7.tri.12', corpus: 'ocre', label: 'RIC VII Treveri 12', denomination: 'Solidus', obverse: {}, reverse: {} };
  const lots = [citingSale('s1', '100', 'Constantine I. Solidus. RIC VII Trier 12. VF'), citingSale('s2', '300', 'Constantine I. Follis. RIC VII Trier 12. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }),
    lookupTypeImpl: async () => ({ status: 'ok', card }) });
  popup.element('quick-reference').value = 'RIC VII Trier 12';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('denomination-row').hidden, false);
  assert.equal(popup.element('denomination-label').textContent, 'Naming “solidus”');
  await popup.element('copy-summary').emit('click');
  assert.match(popup.clipboard[0], /numismatics\.org\/ocre\/id\/ric\.7\.tri\.12/);
});

// A dealer cites the range OCRE titles the record over, and the guided fields below hold one number: dropping the range
// looked up the first number of it instead, which is a different record wherever OCRE files the range itself.
test('a cited range reaches the lookup, and a refined search of the fields does not', async () => {
  const asked = [];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async (reference) => { asked.push(reference); return { status: 'none' }; } });
  popup.element('quick-reference').value = 'Hadrian 100-102';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(asked.at(-1).number, '100');
  assert.equal(asked.at(-1).range, '100-102');
  // The refined search is the fields themselves, and no field holds a range.
  await popup.element('reference-form').emit('submit', { submitter: { id: 'refine-lookup-button' } });
  await settle();
  assert.equal(asked.at(-1).range, undefined);
});

// The card decides what the price panel may offer: its denomination, and the type URL Copy summary ends with. When the
// prices came back first the panel was drawn without one and never drawn again, so the toggle was simply not there.
test('prices that arrive before the card are drawn again once it does', async () => {
  const looked = deferred();
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', denomination: 'Tetradrachm', obverse: {}, reverse: {} };
  const lots = [citingSale('s1', '100', 'Alexander III. Tetradrachm. Price 23. VF'), citingSale('s2', '300', 'Alexander III. Drachm. Price 23. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }),
    lookupTypeImpl: () => looked.promise });
  popup.element('quick-reference').value = 'Price 23';
  const submission = popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('denomination-row').hidden, true, 'no card yet, so nothing to filter by');
  looked.resolve({ status: 'ok', card });
  await submission;
  await settle();
  assert.equal(popup.element('denomination-row').hidden, false);
  assert.equal(popup.element('denomination-label').textContent, 'Naming “tetradrachm”');
  await popup.element('copy-summary').emit('click');
  assert.match(popup.clipboard[0], /numismatics\.org\/pella\/id\/price\.23/);
});

// The denomination toggle is a decision about one coin, exactly as the citation toggle is, so another coin starts without it.
test('the denomination toggle resets on a new lookup', async () => {
  const card = (id, denomination) => ({ id, corpus: 'pella', label: id.replace('price.', 'Price '), denomination, obverse: {}, reverse: {} });
  const lots = [citingSale('s1', '100', 'Alexander III. Tetradrachm. Price 23. VF'), citingSale('s2', '300', 'Alexander III. Drachm. Price 23. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }),
    lookupTypeImpl: async (reference) => ({ status: 'ok', card: card(`price.${reference.number}`, 'Tetradrachm') }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  popup.element('denomination-filter').checked = true;
  await popup.element('denomination-filter').emit('change');
  assert.match(popup.element('median-amount').textContent, /100/);
  popup.element('quick-reference').value = 'Price 24';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('denomination-filter').checked, false);
  assert.match(popup.element('median-amount').textContent, /200/);
});

test('a median per grade appears once a bucket rests on three sales', async () => {
  const graded = (id, price, grade) => citingSale(id, price, `Alexander III. Tetradrachm. Price 23. ${grade}`);
  const lots = [graded('s1', '100', 'Very Fine'), graded('s2', '200', 'gVF'), graded('s3', '300', 'VF'), graded('s4', '900', 'Extremely Fine')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('grade-medians').hidden, false);
  assert.deepEqual(popup.element('grade-medians').children.map((line) => line.textContent), ['VF · $200 · 3 sales']);
  await popup.element('copy-summary').emit('click');
  assert.match(popup.clipboard[0], /\nVF · \$200 · 3 sales/);
});

test('a redraw takes the verified card, so Copy summary heads the text with its label', async () => {
  const looked = deferred();
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale, lookupTypeImpl: () => looked.promise });
  popup.element('quick-reference').value = 'Price 23';
  const submission = popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('copy-summary').emit('click');
  assert.match(popup.clipboard[0], /^Price 23\n/);
  looked.resolve({ status: 'ok', card: { id: 'price.23', corpus: 'pella', label: 'Price 23 (Babylon)', obverse: {}, reverse: {} } });
  await submission;
  await settle();
  await popup.element('period').emit('change', { target: { value: 'all' } });
  await popup.element('copy-summary').emit('click');
  assert.match(popup.clipboard[1], /^Price 23 \(Babylon\)\n/);
});

// 0.32 review, round 2: "is the page's text readable at all" is a fact about the page, not about a period of it. A page of citations whose last two
// years happen to hold two strangers was counted whole, with the message that said nothing on the page named the reference.
const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
test('a period without a citing row is explained, not counted whole', async () => {
  const lots = [citingSale('s1', '100', 'Alexander III. Tetradrachm. Price 23. VF'), citingSale('s2', '300', 'Alexander III. Tetradrachm. Price 23. VF'),
    citingSale('s3', '500', 'Alexander III. Tetradrachm. Price 23. VF'), citingSale('s4', '700', 'Alexander III. Tetradrachm. Price 3014. VF'),
    citingSale('s5', '900', 'Alexander III. Tetradrachm. Price 3014. VF')];
  // The three citations sold years ago; only the two strangers are inside the last two years.
  for (const [index, date] of [daysAgo(1500), daysAgo(1400), daysAgo(1300), daysAgo(30), daysAgo(20)].entries()) lots[index].date = date;
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  // The N of M line counts the period's own rows, so a page-wide count cannot stand in for it.
  assert.equal(popup.element('cited-count').textContent, '3 of 5 results cite Price 23');
  assert.match(popup.element('median-amount').textContent, /300/);
  await popup.element('period').emit('change', { target: { value: '2y' } });
  assert.equal(popup.element('cited-count').textContent, '0 of 2 results cite Price 23');
  assert.equal(popup.element('sale-strength').textContent, 'No results are counted. Include one under Inspect sales.');
  // The filter is still on, and still says so: its state is the collector's, not the period's.
  assert.equal(popup.element('citing-filter').checked, true);
  assert.equal(popup.element('citing-row').hidden, false);
});

// A row put back by hand and taken out again is out of the median, so it is out of the count beside it: it never cited the reference.
test('a row excluded by hand is no longer counted as a citation', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  const toggle = () => popup.element('sale-list').children[1].children[2];
  await toggle().emit('click');
  assert.equal(popup.element('cited-count').textContent, '1 of 2 results cite Price 23; 2 of 2 counted');
  await toggle().emit('click');
  assert.equal(popup.element('cited-count').textContent, '1 of 2 results cite Price 23');
  assert.equal(popup.element('curation-count').textContent, '1 included · 1 excluded');
});

// 0.32 review, round 2: the toggles sat inside the acsearch panel, so a collector who fetched only the public CoinArchives prices — the signed-out
// path — had no way to switch the citation filter off.
test('the toggles stand above both panels and one state governs both', async () => {
  const publicLot = (id, amount, description) => ({ id, title: `Auction, Lot ${id}`, description, date: '2025-02-01', price: `USD ${amount}`, amount,
    currency: 'USD', url: `https://www.coinarchives.com/a/lotviewer.php?LotID=${id}`, source: 'coinarchives' });
  const selectedLots = [publicLot('ca-1', 150, 'Macedon. Tetradrachm. Price 23. VF'), publicLot('ca-2', 950, 'Macedon. Tetradrachm. Price 3014. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    coinArchivesFetch: async () => ({ ...coinArchivesSale, lots: selectedLots, selectedLots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  // No acsearch results at all: the toggle is still there, because the public panel has rows it applies to.
  assert.equal(popup.element('prices-panel').hidden, true);
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.equal(popup.element('price-filters').hidden, false);
  assert.equal(popup.element('citing-row').hidden, false);
  assert.equal(popup.element('citing-filter').checked, true);
  assert.match(popup.element('coinarchives-median').textContent, /150/);
  popup.element('citing-filter').checked = false;
  await popup.element('citing-filter').emit('change');
  assert.match(popup.element('coinarchives-median').textContent, /550/);
  assert.equal(popup.element('coinarchives-cited').hidden, true);
});

// The state is the collector's until he looks up another coin: a re-fetch of the same reference keeps it, and both panels are redrawn with it.
test('the citation toggle survives a re-fetch and resets on a new lookup', async () => {
  const publicLot = (id, amount, description) => ({ id, title: `Auction, Lot ${id}`, description, date: '2025-02-01', price: `USD ${amount}`, amount,
    currency: 'USD', url: `https://www.coinarchives.com/a/lotviewer.php?LotID=${id}`, source: 'coinarchives' });
  const selectedLots = [publicLot('ca-1', 150, 'Macedon. Tetradrachm. Price 23. VF'), publicLot('ca-2', 950, 'Macedon. Tetradrachm. Price 3014. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales,
    coinArchivesFetch: async () => ({ ...coinArchivesSale, lots: selectedLots, selectedLots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  popup.element('citing-filter').checked = false;
  await popup.element('citing-filter').emit('change');
  // One state, both panels: neither median is filtered any more.
  assert.match(popup.element('median-amount').textContent, /200/);
  assert.match(popup.element('coinarchives-median').textContent, /550/);
  await popup.element('prices-form').emit('submit');
  await settle();
  assert.equal(popup.element('citing-filter').checked, false);
  assert.match(popup.element('median-amount').textContent, /200/);
  // Another coin is another question: the filter comes back on.
  popup.element('quick-reference').value = 'Price 24';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('citing-filter').checked, true);
});

// A bucket resting on three sales beside a median resting on twelve says nothing about the other nine unless the panel says how many carry no grade.
test('the grade medians say how much of the sample carries no grade', async () => {
  const graded = (id, price, grade) => citingSale(id, price, `Alexander III. Tetradrachm. Price 23. ${grade}`);
  const lots = [graded('s1', '100', 'Very Fine'), graded('s2', '200', 'gVF'), graded('s3', '300', 'VF'), graded('s4', '900', 'Ex Slg. Müller')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('ungraded-count').hidden, false);
  assert.equal(popup.element('ungraded-count').textContent, '1 of 4 results carry no grade');
  await popup.element('copy-summary').emit('click');
  assert.match(popup.clipboard[0], /\nVF · \$200 · 3 sales\n1 of 4 results carry no grade/);
});

// A public row the filter leaves out is still a sale the collector may know is his type: it stays listed, and counting it is one click, as on acsearch.
test('the CoinArchives median leaves out a public row that does not cite the reference, and takes it back by hand', async () => {
  const publicLot = (id, amount, description) => ({ id, title: `Auction, Lot ${id}`, description, date: '2025-02-01', price: `USD ${amount}`, amount,
    currency: 'USD', url: `https://www.coinarchives.com/a/lotviewer.php?LotID=${id}`, source: 'coinarchives' });
  // The third row's page carried no lot text at all, which is never read as "not this type".
  const selectedLots = [publicLot('ca-1', 150, 'Macedon. Tetradrachm. Price 23. VF'), publicLot('ca-2', 950, 'Macedon. Tetradrachm. Price 3014. VF'),
    publicLot('ca-3', 250, '')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale,
    coinArchivesFetch: async () => ({ ...coinArchivesSale, lots: selectedLots, selectedLots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.match(popup.element('coinarchives-median').textContent, /200/);
  assert.equal(popup.element('coinarchives-cited').textContent, '2 of 3 results cite Price 23');
  assert.equal(popup.element('coinarchives-sale-list').children.length, 3);
  const toggle = popup.element('coinarchives-sale-list').children[1].children[2];
  assert.equal(toggle.textContent, 'Include');
  await toggle.emit('click');
  assert.match(popup.element('coinarchives-median').textContent, /250/);
  // A redraw (here a period the collector chose) keeps what he counted.
  await popup.element('period').emit('change', { target: { value: '5y' } });
  assert.match(popup.element('coinarchives-median').textContent, /250/);
});

// 0.32 review, round 3: the denomination toggle stands above both panels and says "Only results naming …", but it filtered acsearch alone. It now
// governs the public median too, with its own count under that panel, and a public row whose page carried no lot text is never dropped on the
// missing data — the rule the citation filter already follows there.
test('the denomination toggle governs the public panel too, and never drops a row with no text', async () => {
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', denomination: 'Tetradrachm', obverse: {}, reverse: {} };
  const publicLot = (id, amount, description) => ({ id, title: `Auction, Lot ${id}`, description, date: '2025-02-01', price: `USD ${amount}`, amount,
    currency: 'USD', url: `https://www.coinarchives.com/a/lotviewer.php?LotID=${id}`, source: 'coinarchives' });
  const selectedLots = [publicLot('ca-1', 100, 'Macedon. Tetradrachm. Price 23. VF'), publicLot('ca-2', 900, 'Macedon. Drachm. Price 23. VF'),
    publicLot('ca-3', 200, '')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale,
    lookupTypeImpl: async () => ({ status: 'ok', card }),
    coinArchivesFetch: async () => ({ ...coinArchivesSale, lots: selectedLots, selectedLots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.match(popup.element('coinarchives-median').textContent, /200/);
  assert.equal(popup.element('coinarchives-cited').hidden, true);
  popup.element('denomination-filter').checked = true;
  await popup.element('denomination-filter').emit('change');
  assert.match(popup.element('coinarchives-median').textContent, /150/);
  assert.equal(popup.element('coinarchives-cited').textContent, '2 of 3 results name “tetradrachm”');
  // The same hand-include semantics: the drachm can be counted back, and the count beside the median follows.
  const toggle = popup.element('coinarchives-sale-list').children[1].children[2];
  assert.equal(toggle.textContent, 'Include');
  await toggle.emit('click');
  assert.match(popup.element('coinarchives-median').textContent, /200/);
  // Nothing is left out any more, but the drachm still names no tetradrachm, so the line stays and says what the median rests on — the rule the
  // acsearch panel's own filter lines follow.
  assert.equal(popup.element('coinarchives-cited').textContent, '2 of 3 results name “tetradrachm”; 3 of 3 counted');
  popup.element('denomination-filter').checked = false;
  await popup.element('denomination-filter').emit('change');
  assert.equal(popup.element('coinarchives-cited').hidden, true);
});

// 0.32 review, round 3: a failed re-fetch cleared the public panel's state without redrawing the toggles above it, so the citation switch stayed on
// screen with no rows left behind it.
test('a failed CoinArchives re-fetch takes the toggles down with the panel', async () => {
  const publicLot = { id: 'ca-1', title: 'Auction, Lot 1', description: 'Macedon. Tetradrachm. Price 23. VF', date: '2025-02-01', price: 'USD 150',
    amount: 150, currency: 'USD', url: 'https://www.coinarchives.com/a/lotviewer.php?LotID=1', source: 'coinarchives' };
  let failing = false;
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    coinArchivesFetch: async () => (failing ? { status: 'layout', term: 'Price 23' } : { ...coinArchivesSale, lots: [publicLot], selectedLots: [publicLot] }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.equal(popup.element('price-filters').hidden, false);
  failing = true;
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.equal(popup.element('coinarchives-prices-panel').hidden, true);
  assert.equal(popup.element('price-filters').hidden, true);
});

// One home for the default currency: the snapshot preference the background keeps. Local storage
// keeps a display cache of the last choice beside it, because a lookup window opens, looks up and
// prices before the bridge can answer: without the cache that research runs in whatever currency the
// profile held before the upgrade, however often the collector has changed it since.
const PREFERENCES_CACHE_KEY = 'giga-pinax-preferences-v1';
const cachedCurrency = (stored) => JSON.parse(stored.get(PREFERENCES_CACHE_KEY)).currency;
const seeded = (currency) => new Map([[PREFERENCES_CACHE_KEY,
  JSON.stringify({ currency, catalogue: 'Price', number: '23' })]]);
const priceTwentyThree = { id: 'price.23', corpus: 'pella', label: 'Price 23', obverse: {}, reverse: {} };

async function chooseCurrency(stored, currency) {
  const popup = await loadPopup({ stored, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }) });
  popup.element('currency').value = currency;
  await popup.element('currency').emit('change');
  return popup;
}

test('a chosen currency is cached, and the next window prices in it before the bridge answers', async () => {
  const stored = seeded('USD');
  await chooseCurrency(stored, 'EUR');
  assert.equal(cachedCurrency(stored), 'EUR');

  const fetched = [];
  const reopened = await loadPopup({ stored, search: '?window=1&q=Price%2023', permissionRequest: async () => true,
    priceFetch: async (request) => { fetched.push(request.currency); return { status: 'empty' }; },
    lookupTypeImpl: async () => ({ status: 'ok', card: priceTwentyThree }) });
  await settle();
  await settle();
  assert.equal(reopened.element('currency').value, 'EUR');
  assert.deepEqual(fetched, ['EUR']);
});

test('a lookup handed to an open window keeps the cached currency', async () => {
  const stored = seeded('USD');
  await chooseCurrency(stored, 'EUR');

  const fetched = [];
  const messageListeners = [];
  const open = await loadPopup({ stored, search: '?window=1&q=Price%2023', messageListeners, permissionRequest: async () => true,
    priceFetch: async (request) => { fetched.push(request.currency); return { status: 'empty' }; },
    lookupTypeImpl: async () => ({ status: 'ok', card: priceTwentyThree }) });
  await settle();
  await settle();
  messageListeners[0]({ type: selection.LOOKUP_MESSAGE, url: 'popup.html?window=1&q=Price%2023' }, SENDER, () => {});
  await settle();
  await settle();
  assert.equal(open.element('currency').value, 'EUR');
  assert.deepEqual(fetched, ['EUR', 'EUR']);
});

// The snapshot still wins when it answers, but it is applied the way a collector's own choice is, so
// the prices already fetched under the cached currency go, the acsearch link follows, and the cache
// records what is now shown.
test('a stored preference arriving late switches the select, the cache and the prices already shown', async () => {
  const stored = seeded('EUR');
  const fetched = [];
  const popup = await loadPopup({ stored, search: '?window=1&q=Price%2023', permissionRequest: async () => true,
    priceFetch: async (request) => { fetched.push(request.currency); return oneSale; },
    lookupTypeImpl: async () => ({ status: 'ok', card: priceTwentyThree }) });
  await settle();
  await settle();
  assert.deepEqual(fetched, ['EUR']);
  assert.equal(popup.element('prices-panel').hidden, false);

  assert.equal(companion.applyPreferredCurrency(popup.element('currency'), 'GBP'), true);
  assert.equal(popup.element('currency').value, 'GBP');
  assert.equal(cachedCurrency(stored), 'GBP');
  assert.match(popup.element('acsearch-link').href, /currency=gbp/);
  assert.equal(popup.element('announcement').textContent, 'Currency set to GBP.');
  // acsearch access is already granted, so the same search is simply run again in the new currency: an empty panel with
  // a Get prices button on it is not what the collector asked for by having a default currency.
  await settle();
  await settle();
  assert.deepEqual(fetched, ['EUR', 'GBP']);
  assert.equal(popup.element('prices-panel').hidden, false);

  // The stored value the select already shows is not a change: nothing is cleared and nothing is said.
  popup.element('announcement').textContent = '';
  assert.equal(companion.applyPreferredCurrency(popup.element('currency'), 'GBP'), false);
  assert.equal(popup.element('announcement').textContent, '');
});

// Re-pricing must never be the thing that asks for acsearch: a prompt closes the popup in Firefox, and nobody pressed
// anything here. Without access the panel simply waits for Get prices, as it always did.
test('a currency change never prompts for acsearch, so an ungranted window keeps its empty panel', async () => {
  const stored = seeded('EUR');
  const fetched = [];
  let prompts = 0;
  const popup = await loadPopup({ stored, search: '?window=1&q=Price%2023',
    permissionRequest: async () => { prompts += 1; return true; }, permissionContains: async () => false,
    priceFetch: async (request) => { fetched.push(request.currency); return oneSale; },
    lookupTypeImpl: async () => ({ status: 'ok', card: priceTwentyThree }) });
  await settle();
  await settle();
  const before = prompts;
  assert.equal(companion.applyPreferredCurrency(popup.element('currency'), 'GBP'), true);
  await settle();
  await settle();
  assert.equal(prompts, before, 'a currency change asks for nothing');
  assert.deepEqual(fetched, [], 'and fetches nothing it has no access for');
  assert.equal(popup.element('prices-panel').hidden, true);
});

test('a profile whose bridge never answers keeps the chosen currency across sessions', async () => {
  const stored = seeded('USD');
  await chooseCurrency(stored, 'GBP');
  const later = await loadPopup({ stored, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }) });
  assert.equal(later.element('currency').value, 'GBP');
});

// The default term is already an exact phrase in acsearch's own quotes; wrapping it in curly quotes again read as “"Price 23"”.
// Loop 1 (P-04): the term is no longer repeated in the matches line; it is shown once, beside Change search, exactly as it is written.
test('a quoted search term is shown as written beside Change search, not quoted a second time', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('price-search-term').textContent, '"Price 23"');
  assert.doesNotMatch(popup.element('sale-period').textContent, /Price 23|[“”]/);
});

// A RIC term with a ruler in front of it opens on the ruler's name, so it was wrapped after all and the line read
// “Nero ("RIC 306" …)” — a pair of quotes around a term that carries its own. A term with quotes or brackets in it is left as it stands.
test('a term that carries its own quotes or brackets is not wrapped in a second pair', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales });
  popup.element('quick-reference').value = 'RIC I Nero 306';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('price-search-term').textContent, 'Nero ("RIC 306" "RIC I 306" "RIC I, 306")');
});

// 0.33 review (R1): a bare RIC number names a type in every volume, and "RIC 237" priced all of them — a median across Caracalla's denarii,
// Vespasian's aurei and Constantine's folles beside "Choose a type". Nothing is fetched until one type is chosen, and choosing one prices it.
const acrossVolumes = { status: 'ok', lots: [citingSale('v1', '1,000', 'Caracalla. Denarius. RIC IV 237. VF'),
  citingSale('v2', '3,000', 'Vespasian. Aureus. RIC II.1 237. EF'), citingSale('v3', '200', 'Constantine I. Follis. RIC VII Treveri 237. EF')] };
const ricChoices = { status: 'candidates', corpus: 'ocre', partial: true, candidates: [{ id: 'ric.4.crl.237', title: 'RIC IV Caracalla 237' },
  { id: 'ric.2_1(2).ves.237', title: 'RIC II, Part 1 (second edition) Vespasian 237' }] };

test('a bare RIC number fetches no prices until a type is chosen', async () => {
  const fetched = [];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async (request) => { fetched.push(request.term); return acrossVolumes; },
    lookupTypeImpl: async () => ricChoices });
  popup.element('quick-reference').value = 'RIC 237';
  await popup.element('reference-form').emit('submit');
  await settle();
  await settle();
  assert.equal(popup.element('candidates').hidden, false);
  assert.deepEqual(fetched, []);
  assert.equal(popup.element('prices-panel').hidden, true);
  assert.equal(popup.element('median-amount').textContent, '');
});

test('a bare RIC number answered with too many types shows no median', async () => {
  const fetched = [];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async (request) => { fetched.push(request.term); return acrossVolumes; },
    lookupTypeImpl: async () => ({ status: 'too-many', corpus: 'ocre', query: 'RIC 12' }) });
  popup.element('quick-reference').value = 'RIC 12';
  await popup.element('reference-form').emit('submit');
  await settle();
  await settle();
  assert.match(popup.element('form-error').textContent, /too many types/);
  assert.deepEqual(fetched, []);
  assert.equal(popup.element('prices-panel').hidden, true);
});

test('a bare RIC number with a single type prices the type that was found', async () => {
  const fetched = [];
  const card = { id: 'ric.4.crl.237', corpus: 'ocre', label: 'RIC IV Caracalla 237', denomination: 'Denarius', obverse: {}, reverse: {} };
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async (request) => { fetched.push(request.term); return acrossVolumes; },
    lookupTypeImpl: async () => ({ status: 'ok', card }) });
  popup.element('quick-reference').value = 'RIC 237';
  await popup.element('reference-form').emit('submit');
  await settle();
  await settle();
  assert.deepEqual(fetched, ['Caracalla ("RIC 237" "RIC IV 237" "RIC IV, 237")']);
  assert.equal(popup.element('prices-panel').hidden, false);
  assert.equal(popup.element('cited-count').textContent, '1 of 3 results cite RIC 237');
});

// 0.33 review, fix round 1: a bare RIC number starts no price research, so a failed Check online had no auction search below to offer and said
// nothing more than that the catalogue was unreachable. It says what would let the collector search auction results.
test('a bare RIC number whose online lookup fails says how to search auction results', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => acrossVolumes,
    lookupTypeImpl: async () => ({ status: 'online-required', corpus: 'ocre', query: 'RIC 237', retry: async () => ({ status: 'network' }) }) });
  popup.element('quick-reference').value = 'RIC 237';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('online-fallback').hidden, false);
  await popup.element('online-fallback').onclick();
  await settle();
  await settle();
  assert.equal(popup.element('form-error').textContent,
    'Couldn’t connect to numismatics.org. Try the catalogue lookup again later. Type a ruler or volume to search auction results.');
  assert.equal(popup.element('prices-panel').hidden, true);
});

// A volume narrows the number to one book, but a book still holds several types of it: prices already fetched go when the lookup offers a choice.
test('prices fetched for a RIC reference go when the lookup offers a choice of types', async () => {
  const price = deferred();
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => price.promise,
    lookupTypeImpl: async () => { await settle(); return ricChoices; } });
  popup.element('quick-reference').value = 'RIC IV 237';
  await popup.element('reference-form').emit('submit');
  price.resolve(acrossVolumes);
  await settle();
  await settle();
  await settle();
  assert.equal(popup.element('candidates').hidden, false);
  assert.equal(popup.element('prices-panel').hidden, true);
  assert.equal(popup.element('prices-note').hidden, false);
  assert.match(popup.element('prices-note-text').textContent, /Choose one type/);
});

// 0.33 review (S3): a reply past the byte bound is not a connection that failed, and the collector is told which it was.
test('an acsearch reply too large to read says so, not that acsearch was unreachable', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'network', reason: 'too-large' }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('prices-error').hidden, false);
  assert.match(popup.element('prices-error').textContent, /too large to read/);
});

// 0.33 review (R3): a currency change fetches the same search again, and acsearch gives a lot the same id in every currency, so the rows the collector
// counted or left out by hand are still his decisions. They were silently dropped; they are kept now, and the announcement says so.
test('a currency re-fetch keeps the rows included and excluded by hand', async () => {
  const fetched = [];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async (request) => { fetched.push(request.currency); return mixedSales; } });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('sale-list').children[1].children[2].emit('click');
  assert.match(popup.element('median-amount').textContent, /200/);
  popup.element('currency').value = 'EUR';
  await popup.element('currency').emit('change');
  await settle();
  await settle();
  assert.deepEqual(fetched, ['USD', 'EUR']);
  assert.match(popup.element('median-amount').textContent, /200/);
  assert.equal(popup.element('curation-count').textContent, '2 included · 0 excluded');
  assert.equal(popup.element('reset-curation').disabled, false);
  assert.match(popup.element('announcement').textContent, /Sales you included or excluded by hand are kept\./);
  // A new lookup is another question, and starts from the filters' own choice again.
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('curation-count').textContent, '1 included · 1 excluded');
});

// 0.33 review (R9): a row counted by hand still does not cite the reference, so the line no longer counts it among those that do. It says both
// figures, over the same results, alike in the panel, the announcement and the copied summary.
test('a row included by hand is counted, not said to cite the reference', async () => {
  const lots = [citingSale('c1', '100', 'Alexander III. Tetradrachm. Price 23. VF'), citingSale('c2', '300', 'Alexander III. Tetradrachm. Price 3014. VF'),
    citingSale('c3', '500', 'Alexander III. Tetradrachm. Price 3015. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('cited-count').textContent, '1 of 3 results cite Price 23');
  await popup.element('sale-list').children[1].children[2].emit('click');
  const line = '1 of 3 results cite Price 23; 2 of 3 counted';
  assert.equal(popup.element('cited-count').textContent, line);
  assert.ok(popup.element('announcement').textContent.includes(`${line}.`));
  await popup.element('copy-summary').emit('click');
  assert.ok(popup.clipboard[0].split('\n').includes(line));
  // Even where the two numbers agree, other rows than the citing ones are counted, and the line says so.
  await popup.element('sale-list').children[0].children[2].emit('click');
  assert.equal(popup.element('cited-count').textContent, '1 of 3 results cite Price 23; 1 of 3 counted');
});

// 0.33 review, fix round 1: with every uncited row counted by hand the filter drops nothing, but the median still rests on rows that do not cite
// the reference, so the line stays and says both figures.
test('the citation line stays when every uncited row is included by hand', async () => {
  const lots = [citingSale('c1', '100', 'Alexander III. Tetradrachm. Price 23. VF'), citingSale('c2', '300', 'Alexander III. Tetradrachm. Price 3014. VF'),
    citingSale('c3', '500', 'Alexander III. Tetradrachm. Price 3015. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('sale-list').children[1].children[2].emit('click');
  await popup.element('sale-list').children[2].children[2].emit('click');
  assert.equal(popup.element('curation-count').textContent, '3 included · 0 excluded');
  const line = '1 of 3 results cite Price 23; 3 of 3 counted';
  assert.equal(popup.element('cited-count').textContent, line);
  assert.equal(popup.element('cited-count').hidden, false);
  assert.ok(popup.element('announcement').textContent.includes(`${line}.`));
  await popup.element('copy-summary').emit('click');
  assert.ok(popup.clipboard[0].split('\n').includes(line));
});

// 0.33 review (R10): acsearch lists the most recent lots first, so a full page that reaches back past the period's start holds every sale of the
// period there is. The "+" says acsearch may hold more; it is kept for a period the page does not reach the start of, and for All.
test('the matches line adds "+" only where the page may not hold the whole period', async () => {
  const lots = Array.from({ length: 100 }, (_, index) => ({ ...citingSale(`p${index}`, '100', 'Macedon. Tetradrachm. Price 23. VF'),
    date: daysAgo(index < 50 ? 30 + index : 4000 + index) }));
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.match(popup.element('sale-period').textContent, /^100\+ matches on acsearch$/);
  await popup.element('period').emit('change', { target: { value: '5y' } });
  assert.match(popup.element('sale-period').textContent, /^50 matches on acsearch$/);
  // A full page every lot of which falls inside the period may be followed by more of them.
  const recent = lots.map((entry, index) => ({ ...entry, date: daysAgo(30 + index) }));
  const again = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots: recent }) });
  again.element('quick-reference').value = 'Price 23';
  await again.element('reference-form').emit('submit');
  await settle();
  await again.element('period').emit('change', { target: { value: '5y' } });
  assert.match(again.element('sale-period').textContent, /^100\+ matches on acsearch$/);
});

// 0.33 review (P10): "Check online" carried a class no stylesheet the popup loads defines, so it drew as the browser's bare default button.
test('every class a popup button carries is styled by a stylesheet the popup loads', () => {
  const read = (name) => readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8');
  const html = read('popup.html');
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => read(match[1])).join('\n');
  const classes = new Set([...html.matchAll(/<button\b[^>]*\bclass="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)));
  // String.raw keeps the pattern's backslashes, which a plain template literal drops ("\." would be any character). A class name is letters, digits
  // and hyphens, none of which means anything to a pattern outside a bracket.
  const styled = (name, css) => new RegExp(String.raw`\.${name}(?![\w-])`).test(css);
  // The check itself: a class is styled only by its own selector, not by one it is the tail or the head of.
  assert.equal(styled('quiet', 'p.xquiet { color: red; }'), false);
  assert.equal(styled('quiet', '.quietly { color: red; }'), false);
  assert.equal(styled('online-fallback', '.online-fallback-x { color: red; }'), false);
  assert.equal(styled('online-fallback', 'button.online-fallback { color: red; }'), true);
  const unstyled = [...classes].filter((name) => !styled(name, sheets));
  assert.deepEqual(unstyled, []);
});

// 0.33 review (P8): a currency change takes the CoinArchives median down, since its public prices are never converted and it is fetched only on a
// click. It no longer goes without a word: the panel's place says why and how to get it back, and so does the announcement.
test('a currency change says why the CoinArchives median went and how to fetch it again', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale, coinArchivesFetch: async () => coinArchivesSale });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.equal(popup.element('coinarchives-prices-panel').hidden, false);
  popup.element('currency').value = 'EUR';
  await popup.element('currency').emit('change');
  assert.equal(popup.element('coinarchives-prices-panel').hidden, true);
  assert.equal(popup.element('coinarchives-prices-note').hidden, false);
  assert.match(popup.element('coinarchives-prices-note').textContent, /in USD.*Get CoinArchives prices.*EUR/);
  assert.match(popup.element('announcement').textContent, /^Currency set to EUR\. .*CoinArchives/);
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.equal(popup.element('coinarchives-prices-note').hidden, true);
  // The median fetched again in euros goes the same way at the next change.
  popup.element('currency').value = 'GBP';
  await popup.element('currency').emit('change');
  assert.match(popup.element('coinarchives-prices-note').textContent, /in EUR.*GBP/);
  // Nothing to explain when no CoinArchives median was on show.
  const quiet = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale });
  quiet.element('quick-reference').value = 'Price 23';
  await quiet.element('reference-form').emit('submit');
  await settle();
  quiet.element('currency').value = 'EUR';
  await quiet.element('currency').emit('change');
  assert.equal(quiet.element('coinarchives-prices-note').hidden, true);
  assert.equal(quiet.element('announcement').textContent, 'Currency set to EUR.');
});

// 0.33 review (P7): two controls took the keyboard with them when they went. A refined Search closes the Refine reference section it was pressed in,
// and Reset disables itself once there is nothing left to reset; either dropped focus to the top of the document. Focus now lands on what is left.
test('focus stays in the popup when refine closes over it or Reset disables itself', async () => {
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', obverse: {}, reverse: {} };
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales, lookupTypeImpl: async () => ({ status: 'ok', card }) });
  popup.element('refine-reference').open = true;
  popup.element('refine-reference').contains = (node) => node === popup.element('refine-lookup-button');
  popup.document.activeElement = popup.element('refine-lookup-button');
  await popup.element('reference-form').emit('submit', { submitter: popup.element('refine-lookup-button') });
  await settle();
  assert.equal(popup.element('refine-reference').open, false);
  assert.equal(popup.element('refine-summary').focused, 1);
  // Reset, pressed from the keyboard, leaves it on the Inspect sales summary it sits under.
  await popup.element('sale-list').children[1].children[2].emit('click');
  assert.equal(popup.element('reset-curation').disabled, false);
  popup.document.activeElement = popup.element('reset-curation');
  await popup.element('reset-curation').emit('click');
  assert.equal(popup.element('reset-curation').disabled, true);
  assert.equal(popup.element('sale-summary').focused, 1);
});

// A mint with no volume is filed in several volumes, so "RIC 40 (Ticinum)" names no single type: nothing is fetched with the collector's session
// before a type is chosen, as for a bare number.
test('a RIC mint written with no volume fetches no prices until a type is chosen', async () => {
  const fetched = [];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async (request) => { fetched.push(request.term); return acrossVolumes; },
    lookupTypeImpl: async () => ({ ...ricChoices, candidates: [{ id: 'ric.7.tic.40', title: 'RIC VII Ticinum 40' }] }) });
  popup.element('quick-reference').value = 'RIC 40 (Ticinum)';
  await popup.element('reference-form').emit('submit');
  await settle();
  await settle();
  assert.deepEqual(fetched, []);
  assert.equal(popup.element('median-amount').textContent, '');
});

// 0.34 (I2): the lots on the fetched page that have not been sold yet. Far-future days, so the tests hold whatever day they run on.
const upcomingSale = (id, date, description) => ({ id, title: `Roma Numismatics, E-Sale 200, Lot ${id}`, date, price: '*', description });
const withUpcoming = {
  status: 'ok',
  lots: [citingSale('s1', '100', 'Macedon, Alexander III. Tetradrachm. Price 23. Very Fine.'),
    upcomingSale('u1', '12.10.2099 14:00', 'Macedon, Alexander III. Tetradrachm. Price 23. EF.'),
    upcomingSale('u2', '01.11.2099', 'Macedon, Alexander III. Tetradrachm. Price 3014. EF.'),
    upcomingSale('u3', '01.12.2099', 'Macedon, Alexander III. Tetradrachm. Price 23. VF.'),
    // Past and unsold: not coming up.
    upcomingSale('old', '01.01.2024', 'Macedon, Alexander III. Tetradrachm. Price 23. VF.')],
};

test('upcoming lots are listed under the acsearch panel, filtered as the median is, and copied', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => withUpcoming });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('upcoming').hidden, false);
  const rows = () => popup.element('upcoming-list').children;
  // Soonest first, and only the lots that cite the reference while the citation filter is on, which it says in the median's own words.
  assert.equal(rows().length, 2);
  assert.equal(rows()[0].children[0].children[0], '2099-10-12 · ');
  assert.equal(rows()[0].children[0].children[1].textContent, 'Roma Numismatics, E-Sale 200, Lot u1');
  assert.equal(rows()[0].children[0].children[1].href, 'https://www.acsearch.info/search.html?id=u1');
  assert.equal(rows()[1].children[0].children[1].textContent, 'Roma Numismatics, E-Sale 200, Lot u3');
  assert.equal(popup.element('upcoming-filtered').textContent, '2 of 3 results cite Price 23');
  assert.equal(popup.element('upcoming-filtered').hidden, false);
  await popup.element('copy-summary').emit('click');
  assert.ok(popup.clipboard[0].split('\n').includes('Upcoming: 2 lots, first on 2099-10-12'));
  // The one toggle governs the list too.
  popup.element('citing-filter').checked = false;
  await popup.element('citing-filter').emit('change');
  assert.equal(rows().length, 3);
  assert.equal(popup.element('upcoming-filtered').hidden, true);
  // A new reference takes the list away with the panel.
  popup.element('quick-reference').value = 'Price 24';
  await popup.element('quick-reference').emit('input');
  assert.equal(popup.element('upcoming').hidden, true);
  assert.equal(rows().length, 0);
});

test('Watch hands an upcoming lot to the watchlist half with its acsearch page and its sale day, date only', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => withUpcoming });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  const watch = popup.element('upcoming-list').children[0].children[1];
  assert.equal(watch.textContent, 'Watch');
  // The list says what Watch does, and no longer that the day stays behind.
  const basis = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  // Loop 3 (G-02): Watch saves in one step, and its sale day waits for Add.
  assert.match(basis, /Watch saves the lot to your watchlist and offers its sale day as an auction to add\./);
  assert.doesNotMatch(basis, /add its auction there to be reminded/);
  assert.equal(watch['aria-label'], 'Watch Roma Numismatics, E-Sale 200, Lot u1, sale on 2099-10-12');
  popup.dispatched.length = 0;
  await watch.emit('click');
  assert.deepEqual(popup.dispatched.map(({ type, detail }) => ({ type, detail: { ...detail } })), [{ type: 'giga-pinax-watch', detail: {
    title: 'Roma Numismatics, E-Sale 200, Lot u1', reference: 'Price 23', pageUrl: 'https://www.acsearch.info/search.html?id=u1', closesAt: '2099-10-12' } }]);
});

// A search whose only hits are lots not sold yet has no median to show, and those lots are exactly what the collector may want to know about.
test('a page without a counted price still lists its upcoming lots', async () => {
  const lots = withUpcoming.lots.slice(1);
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'unpriced', term: '"Price 23"', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('prices-panel').hidden, true);
  assert.equal(popup.element('prices-note').hidden, false);
  assert.equal(popup.element('upcoming').hidden, false);
  assert.equal(popup.element('upcoming-list').children.length, 2);
  // The toggle stands for the list as it does for a median.
  assert.equal(popup.element('citing-row').hidden, false);
  assert.match(popup.element('announcement').textContent, /Upcoming: 2 lots, first on 2099-10-12\.$/);
  popup.element('citing-filter').checked = false;
  await popup.element('citing-filter').emit('change');
  assert.equal(popup.element('upcoming-list').children.length, 3);
});


// 0.34 (I2): the Upcoming list and the by-year strip are new elements; the page looks every element up by id, and one missing from the markup throws
// only when the panel is drawn. Every id the page names is in the page, and the new list starts hidden.
test('every element the popup looks up by id is in its markup', () => {
  const read = (name) => readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8');
  const markup = parseHtml(read('popup.html'));
  // The page and the modules it was split into (popup-*.js), which look elements up for it.
  const modules = [...read('popup.js').matchAll(/from '\.\/(popup-[\w-]+\.js)';/g)].map((match) => match[1]);
  const code = ['popup.js', ...modules].map(read).join('\n');
  const ids = [...new Set([...code.matchAll(/\$\('([\w-]+)'\)/g)].map((match) => match[1]))];
  assert.ok(ids.includes('upcoming-list'));
  assert.deepEqual(ids.filter((id) => !markup.getElementById(id)), []);
  assert.equal(markup.getElementById('upcoming').hidden, true);
});
const saleIn = (id, price, date) => ({ ...citingSale(id, price, 'Macedon, Alexander III. Tetradrachm. Price 23. Very Fine.'), date });
const byYear = { status: 'ok', lots: [saleIn('a', '100', '01.01.2023'), saleIn('b', '200', '01.02.2023'), saleIn('c', '300', '01.03.2023'),
  saleIn('d', '400', '01.01.2024'), saleIn('e', '500', '01.02.2024'), saleIn('f', '600', '01.03.2024'), saleIn('g', '900', '01.01.2025')] };

test('the median by year is drawn under the range from the counted sales, with its lines for screen readers and the copy', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => byYear });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('year-medians').hidden, false);
  // 0.34 review (M1): the strip keeps its natural size, 48px a year, and the figure scrolls sideways rather than shrinking its labels.
  assert.equal(popup.element('year-strip').style.width, '96px');
  assert.equal(popup.element('year-strip').style.height, '74px');
  assert.equal(popup.element('year-strip')['aria-label'], 'Median by year: 2023, $200 from 3 sales; 2024, $500 from 3 sales.');
  assert.deepEqual(popup.element('year-lines').children.map((line) => line.textContent), ['2023 · $200 · 3 sales', '2024 · $500 · 3 sales']);
  // One bar per year, and under it the year and the count; every node is SVG.
  const nodes = popup.element('year-strip').children;
  assert.ok(nodes.every((node) => node.namespace === 'http://www.w3.org/2000/svg'));
  assert.equal(nodes.filter((node) => node.tag === 'rect').length, 2);
  const texts = nodes.filter((node) => node.tag === 'text').map((node) => node.textContent);
  for (const text of ['2023', '2024', '3 sales']) assert.ok(texts.includes(text), text);
  await popup.element('copy-summary').emit('click');
  assert.match(popup.clipboard[0], /\n2023 · \$200 · 3 sales\n2024 · \$500 · 3 sales/);
  // A sale left out by hand leaves 2024 on two: the year goes.
  await popup.element('sale-list').children[3].children[2].emit('click');
  assert.deepEqual(popup.element('year-lines').children.map((line) => line.textContent), ['2023 · $200 · 3 sales']);
});

test('the CoinArchives panel draws its own median by year, never pooled with acsearch', async () => {
  const publicLot = (id, amount, date) => ({ id, title: `Auction, Lot ${id}`, description: 'Alexander III. Tetradrachm. Price 23.', date, price: `USD ${amount}`, amount,
    currency: 'USD', url: `https://www.coinarchives.com/a/lotviewer.php?LotID=${id}`, source: 'coinarchives' });
  const selectedLots = [publicLot('p1', 150, '2025-02-01'), publicLot('p2', 250, '2025-03-01'), publicLot('p3', 350, '2025-04-01')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => byYear,
    coinArchivesFetch: async () => ({ ...coinArchivesSale, lots: selectedLots, selectedLots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  // One year is one bar, which says nothing the median does not: the strip stays down (fix round, from L2's P-09). Its lines, in L2's wording, stay.
  assert.equal(popup.element('coinarchives-year-medians').hidden, true);
  assert.deepEqual(popup.element('coinarchives-year-lines').children.map((line) => line.textContent), ['2025 · $250 · 3 sales']);
  assert.deepEqual(popup.element('year-lines').children.map((line) => line.textContent), ['2023 · $200 · 3 sales', '2024 · $500 · 3 sales']);
});

// The toggles stand for the rows on show: clearing the Upcoming list takes them down with it, as it does after a re-fetch that finds nothing and after
// Get prices with an emptied term, which clears the panel once and asks nothing.
test('clearing the Upcoming list takes the toggles down with it', async () => {
  const replies = [{ status: 'unpriced', term: '"Price 23"', lots: withUpcoming.lots.slice(1) }, { status: 'empty', term: '"Price 23"' }];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => replies.shift() ?? { status: 'empty', term: 'x' } });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('citing-row').hidden, false);
  popup.element('price-term').value = '';
  await popup.element('prices-form').emit('submit');
  await settle();
  assert.equal(popup.element('upcoming').hidden, true);
  assert.equal(popup.element('citing-row').hidden, true);
  assert.equal(popup.element('price-filters').hidden, true);
});

// 0.34 review (I2): a page with no counted price and no lot still to come has nothing for the toggles to govern, so none is offered, as in 0.33.
test('a page with no counted price and nothing coming up offers no price toggles', async () => {
  const lots = [upcomingSale('p1', '01.01.2024', 'Macedon. Tetradrachm. Price 23. VF.'), upcomingSale('p2', '01.02.2024', 'Macedon. Tetradrachm. Price 3014. VF.')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'unpriced', term: '"Price 23"', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('prices-note').hidden, false);
  assert.equal(popup.element('upcoming').hidden, true);
  assert.equal(popup.element('citing-row').hidden, true);
  assert.equal(popup.element('price-filters').hidden, true);
});

// 0.34 review (M1): many years would shrink a strip fitted to the column until its labels could not be read; it scrolls instead, and a keyboard can
// reach the scroll region, which is named by its caption.
test('the by-year figures scroll sideways at their natural width, reachable by keyboard', () => {
  const read = (name) => readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8');
  const markup = parseHtml(read('popup.html'));
  for (const prefix of ['', 'coinarchives-']) {
    const figure = markup.getElementById(`${prefix}year-medians`);
    assert.equal(figure.getAttribute('tabindex'), '0', prefix);
    const caption = markup.getElementById(figure.getAttribute('aria-labelledby'));
    assert.equal(caption?.textContent, 'Median by year', prefix);
  }
  const css = read('popup.css');
  assert.match(css, /\.year-medians \{[^}]*overflow-x:auto/);
  assert.doesNotMatch(/\.year-strip \{[^}]*\}/.exec(css)[0], /width:100%/);
});

// 0.34 review (M4): a title is page text of any length; the row, its button's name and the draft all take the draft's own 200 characters.
test('an upcoming lot’s title is shown, spoken and handed over bounded', async () => {
  const long = `Roma ${'x'.repeat(5000)}`;
  const lots = [{ ...upcomingSale('u9', '12.10.2099', 'Macedon. Tetradrachm. Price 23. EF.'), title: long }];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'unpriced', term: '"Price 23"', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  const [row] = popup.element('upcoming-list').children;
  assert.equal(row.children[0].children[1].textContent, long.slice(0, 200));
  assert.equal(row.children[1]['aria-label'], `Watch ${long.slice(0, 200)}, sale on 2099-10-12`);
  popup.dispatched.length = 0;
  await row.children[1].emit('click');
  assert.equal(popup.dispatched[0].detail.title, long.slice(0, 200));
});

// 0.34 review (M5): the other half of the page says a failed Watch on its own status line, at the foot of the popup; the collector is looking at the
// list, so the reason is written beside it too, and goes with the next Watch or the next result.
test('a failed Watch is said beside the Upcoming list', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => withUpcoming });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('upcoming-status').hidden, true);
  await popup.window.emit('giga-pinax-watch-failed', { detail: { message: 'Extension storage is unavailable.' } });
  assert.equal(popup.element('upcoming-status').textContent, 'Extension storage is unavailable.');
  assert.equal(popup.element('upcoming-status').hidden, false);
  await popup.element('upcoming-list').children[0].children[1].emit('click');
  assert.equal(popup.element('upcoming-status').hidden, true);
  await popup.window.emit('giga-pinax-watch-failed', { detail: { message: 'Draft store is full.' } });
  popup.element('quick-reference').value = 'Price 24';
  await popup.element('quick-reference').emit('input');
  assert.equal(popup.element('upcoming-status').hidden, true);
});

// --- Show specimen photos --------------------------------------------------------------------------------------------------------------------------

// Nomisma's answer for RIC I² Nero 306, as tests/specimens.test.mjs reads it: six photographed specimens.
const specimenAnswer = () => readFileSync(new URL('./fixtures/nomisma-specimens-nero-306.json', import.meta.url), 'utf8');
const neroCard = { id: 'ric.1(2).ner.306', corpus: 'ocre', label: 'RIC I (second edition) Nero 306', denomination: 'As', obverse: {}, reverse: {} };
const SPECIMENS_ON = () => new Map([['giga-pinax-specimen-photos-v1', 'on']]);
// The real query function over a fetch that counts what it is asked and answers with the fixture, or with what a test hands it.
function specimenNetwork(text = specimenAnswer()) {
  const requests = [];
  const fetchImpl = async (url) => { requests.push(url); return { ok: true, status: 200, headers: new Map(), text: async () => text }; };
  return { requests, specimenFetch: (card, options) => lookup.fetchSpecimens(card, { ...options, fetchImpl }) };
}
async function lookUpNero(options) {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale,
    lookupTypeImpl: async () => ({ status: 'ok', card: { ...neroCard, source: 'local' } }), ...options });
  popup.element('quick-reference').value = 'RIC I² Nero 306';
  await popup.element('reference-form').emit('submit');
  await settle(); await settle();
  return popup;
}
const images = (item) => item.children[0].children;

test('with Show specimen photos off, a card makes no specimen request at all', async () => {
  const network = specimenNetwork();
  const popup = await lookUpNero({ specimenFetch: network.specimenFetch });
  assert.equal(popup.element('result').hidden, false);
  assert.equal(popup.element('specimens').hidden, true);
  assert.equal(network.requests.length, 0);
});

test('switched on, one query per card draws at most three specimen pairs, each captioned and linked, with no javascript: image', async () => {
  const data = JSON.parse(specimenAnswer());
  // The first specimen's obverse offers nothing a browser should load, so that specimen is left out, never drawn half-empty.
  data.results.bindings[0].obverseThumbnail.value = 'javascript:alert(1)';
  data.results.bindings[0].obverseDepiction.value = 'javascript:alert(1)';
  const network = specimenNetwork(JSON.stringify(data));
  const stored = SPECIMENS_ON();
  const popup = await lookUpNero({ stored, specimenFetch: network.specimenFetch });
  assert.equal(network.requests.length, 1);
  assert.ok(network.requests[0].startsWith('https://nomisma.org/query?'));
  assert.equal(popup.element('specimens').hidden, false);
  const items = popup.element('specimen-list').children;
  assert.equal(items.length, 3);
  for (const item of items) {
    const [obverse, reverse] = images(item);
    for (const image of [obverse, reverse]) {
      assert.match(image.src, /^https?:\/\//);
      assert.equal(image.loading, 'lazy');
      assert.equal(image.referrerpolicy, 'no-referrer');
    }
    assert.match(obverse.alt, /^Obverse, /);
    assert.match(reverse.alt, /^Reverse, /);
    const link = item.children[1];
    assert.match(link.href, /^https?:\/\//);
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
  }
  assert.deepEqual(items.map((item) => item.children[1].textContent),
    ['Bibliothèque nationale de France', 'Oldenburg Municipal Museum', 'Münzkabinett der Universität Göttingen']);
  assert.ok(!items.some((item) => images(item).some((image) => image.src.startsWith('javascript:'))));
  const markup = parseHtml(readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  assert.equal(markup.getElementById('specimens').hidden, true, 'the strip starts hidden');
  assert.match(markup.getElementById('specimens-credit').textContent, /Nomisma\.org/);
  // Nothing about the photos is kept: no stored key holds an image or a specimen page, and Copy summary never names them.
  await popup.element('copy-summary').emit('click');
  assert.ok(popup.clipboard[0].includes('Nero 306'));
  for (const text of [...stored.values(), popup.clipboard[0]]) assert.ok(!/gallica|kenom|collectionimages|specimen/i.test(text), text);
});

test('a slow specimen query never delays the card, and a late answer for a card no longer shown is dropped', async () => {
  let answer;
  const asked = [];
  const signals = [];
  const specimenFetch = (card, options) => { asked.push(card.id); signals.push(options?.signal); return new Promise((resolve) => { answer = resolve; }); };
  let lookups = 0;
  const popup = await lookUpNero({ stored: SPECIMENS_ON(), specimenFetch,
    lookupTypeImpl: async () => ((lookups += 1) === 1 ? { status: 'ok', card: { ...neroCard } } : { status: 'none', corpus: 'ocre', query: 'RIC 1' }) });
  assert.equal(asked.length, 1);
  assert.equal(popup.element('result').hidden, false, 'the card is on screen while the query waits');
  assert.equal(popup.element('result-reference').textContent, 'RIC I² Nero 306');
  assert.equal(popup.element('specimens').hidden, true);
  assert.equal(signals[0]?.aborted, false, 'the query carries a signal of its own');
  // The collector looks up something else before Nomisma answers, and that lookup finds nothing.
  // Clearing the card cancels its query too, rather than leaving it running for the rest of its deadline.
  popup.element('quick-reference').value = 'RIC 1';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(signals[0].aborted, true);
  answer([{ page: 'https://example.org/coin', collection: 'Example Museum', obverse: 'https://example.org/o.jpg', reverse: 'https://example.org/r.jpg' }]);
  await settle(); await settle();
  assert.equal(popup.element('specimens').hidden, true);
  assert.equal(popup.element('specimen-list').children.length, 0);
  assert.equal(asked.length, 1);
});

test('no specimen request for candidates, for a card with no type, or without access to nomisma.org', async () => {
  const candidates = specimenNetwork();
  const listed = await lookUpNero({ stored: SPECIMENS_ON(), specimenFetch: candidates.specimenFetch,
    lookupTypeImpl: async () => ({ status: 'candidates', corpus: 'ocre', partial: true, candidates: [{ id: 'a', title: 'RIC I Nero 306' }, { id: 'b', title: 'RIC II Titus 306' }] }) });
  assert.equal(listed.element('candidates').hidden, false);
  assert.equal(candidates.requests.length, 0);

  const other = specimenNetwork();
  await lookUpNero({ stored: SPECIMENS_ON(), specimenFetch: other.specimenFetch,
    lookupTypeImpl: async () => ({ status: 'ok', card: { id: 'BCD Boiotia 174b', corpus: 'other', label: 'BCD Boiotia 174b', obverse: {}, reverse: {} } }) });
  assert.equal(other.requests.length, 0);

  const refused = specimenNetwork();
  const popup = await lookUpNero({ stored: SPECIMENS_ON(), specimenFetch: refused.specimenFetch,
    permissionContains: async ({ origins }) => !origins.includes('https://nomisma.org/*') });
  assert.equal(popup.element('result').hidden, false);
  assert.equal(refused.requests.length, 0);
});

// Loop 1 (P-02): reveal() used scrollIntoView, which scrolls every ancestor of the answer - the document too, while a lot's answer made the page
// taller than the popup for a moment - and the header and tabs went off the top for good. Only the panel is scrolled now, by its own scrollTo.
test('bringing the answer into view scrolls the panel alone, never the document', async () => {
  const timers = [];
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', obverse: {}, reverse: {} };
  const popup = await loadPopup({ timers, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async () => ({ status: 'ok', card }) });
  Object.assign(popup.element('popup-scroll'), { top: 100, height: 400 });
  popup.element('result').top = 420;
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  for (const run of timers.splice(0)) run();
  assert.equal(popup.element('result').scrolledIntoView, undefined);
  assert.equal(popup.element('popup-scroll').scrolledTo?.[0]?.top, 320);
});

test('the popup frame keeps absolutely placed text inside its scrolling panel', () => {
  const css = readFileSync(new URL('../extension/popup.css', import.meta.url), 'utf8');
  // Without a containing block of its own, a visually hidden line deep in the answer is placed against the page and stretches the document.
  assert.match(css, /\.popup-scroll \{[^}]*position:relative/);
});

// Loop 1 (P-01): the coin comes before its prices. The card was drawn under the price panel, so prices arriving two seconds after it pushed it off
// the popup; now the card is first, the median's room is held while acsearch answers, and the answer landing moves nothing the collector is reading.
test('the card comes before the price panel in the popup', () => {
  const html = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="result"') < html.indexOf('id="research-prices"'));
});

test('while acsearch answers, the median block holds its place, and a failed answer takes it down', async () => {
  const answer = deferred();
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: () => answer.promise });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('prices-panel').hidden, false);
  assert.equal(popup.element('prices-panel').dataset.state, 'loading');
  assert.equal(popup.element('median-amount').textContent, '—');
  assert.equal(popup.element('sale-strength').textContent, 'Fetching acsearch…');
  assert.equal(popup.element('median-line').hidden, false);
  for (const id of ['copy-summary', 'check-row', 'sale-details']) assert.equal(popup.element(id).hidden, true, id);
  answer.resolve({ status: 'signed-out' });
  await settle();
  assert.equal(popup.element('prices-panel').hidden, true);
  assert.equal(popup.element('prices-note').hidden, false);
});

test('prices that land under a card on screen do not scroll the popup again', async () => {
  const timers = [];
  const answer = deferred();
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', obverse: {}, reverse: {} };
  const popup = await loadPopup({ timers, permissionRequest: async () => true, priceFetch: () => answer.promise,
    lookupTypeImpl: async () => ({ status: 'ok', card }) });
  Object.assign(popup.element('popup-scroll'), { top: 100, height: 400 });
  popup.element('result').top = 104;
  popup.element('research-prices').top = 700;
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  answer.resolve(oneSale);
  await settle();
  assert.equal(popup.element('prices-panel').dataset.state, 'ready');
  for (const run of timers.splice(0)) run();
  assert.equal(popup.element('popup-scroll').scrolledTo, undefined);
});

// Loop 1 (P-08): every lookup scrolled the Reference box out of view, so a second lookup began by scrolling back up. The row with the box and Look up
// stays at the top of the panel, the answer is brought up to just under it, and the "Reference changed" prompt sits beside the box.
test('the Reference box stays in view: the answer is brought up under it, not over it', async () => {
  const timers = [];
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', obverse: {}, reverse: {} };
  const popup = await loadPopup({ timers, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async () => ({ status: 'ok', card }) });
  Object.assign(popup.element('popup-scroll'), { top: 100, height: 400 });
  popup.element('quick-search').height = 56;
  popup.element('result').top = 420;
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  for (const run of timers.splice(0)) run();
  assert.equal(popup.element('popup-scroll').scrolledTo?.[0]?.top, 264);
});

test('the row holding the Reference box is sticky, and the lookup prompt sits under it', () => {
  const html = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  const markup = parseHtml(html);
  const row = markup.getElementById('quick-search');
  assert.ok(row, 'the sticky row has an id reveal() can measure');
  assert.equal(markup.getElementById('quick-reference').parentNode, row);
  const form = html.slice(html.indexOf('<form id="reference-form"'), html.indexOf('</form>'));
  assert.match(form, /id="lookup-prompt"/);
  const css = readFileSync(new URL('../extension/popup.css', import.meta.url), 'utf8');
  assert.match(css, /\.quick-search \{[^}]*position:sticky; top:0/);
});

// Prices that come in before the card are brought into view, but the card arriving after them is the answer: the passes still waiting for the prices
// must not scroll past it.
test('a card arriving after its prices is what stays in view', async () => {
  const timers = [];
  const lookedUp = deferred();
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', obverse: {}, reverse: {} };
  const popup = await loadPopup({ timers, permissionRequest: async () => true, priceFetch: async () => oneSale,
    lookupTypeImpl: () => lookedUp.promise });
  Object.assign(popup.element('popup-scroll'), { top: 100, height: 400 });
  popup.element('research-prices').top = 700;
  popup.element('result').top = 420;
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('prices-panel').dataset.state, 'ready');
  lookedUp.resolve({ status: 'ok', card });
  await settle();
  for (const run of timers.splice(0)) run();
  assert.deepEqual(popup.element('popup-scroll').scrolledTo?.map(({ top }) => top), [320]);
});

// Loop 1 (P-04): the panel said everything twice. Its lines are one stat block (sales, years and the last sale on one line; what the filters left out
// and how many matches on the next), one basis line at its foot, and the search folded under Change search until something needs Get prices.
test('the acsearch panel reads as one stat block with one basis line', async () => {
  const lots = [citingSale('a', '220', 'Macedon. Tetradrachm. Price 23. VF'), { ...citingSale('b', '300', 'Macedon. Tetradrachm. Price 23. VF'), date: '01.06.2025' },
    citingSale('c', '380', 'Macedon. Tetradrachm. Price 23. VF'), citingSale('d', '999', 'Macedon. Tetradrachm. Price 3014. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('sale-strength').textContent, '3 sales · 2025');
  const last = popup.element('last-sale').children;
  assert.equal(last[0], 'last $300 on ');
  assert.equal(last[1].textContent, '1 Jun 2025');
  assert.equal(popup.element('cited-count').textContent, '3 of 4 results cite Price 23');
  assert.equal(popup.element('sale-period').textContent, '4 matches on acsearch');
  assert.equal(popup.element('range-all').textContent, 'all $220–$380');
  // Three sales in one year draw no strip, so the basis line says nothing about one.
  assert.equal(popup.element('price-note').textContent, 'Hammer only, no premium, tax or shipping');
  assert.equal(popup.element('year-medians').hidden, true);
  assert.equal(popup.element('price-search').open, false);
});

test('a note or an error that needs Get prices opens Change search', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'signed-out' }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('prices-note').hidden, false);
  assert.equal(popup.element('price-search').open, true);
  const ungranted = await loadPopup({ permissionRequest: async () => true, permissionContains: async () => false, priceFetch: async () => oneSale });
  ungranted.element('quick-reference').value = 'Price 23';
  await ungranted.element('reference-form').emit('submit');
  await settle();
  assert.equal(ungranted.element('price-search').open, true);
});

test('each provider names its results link in its own heading, and the year strip keeps no footnote of its own', () => {
  const html = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  for (const [heading, link] of [['acsearch</h3>', 'acsearch-link'], ['CoinArchives</h3>', 'coinarchives-link']]) {
    const row = html.slice(html.lastIndexOf('<div class="provider-heading">', html.indexOf(heading)), html.indexOf('</div>', html.indexOf(heading)));
    assert.match(row, new RegExp(`id="${link}"`), link);
  }
  assert.doesNotMatch(html, /class="search-links"|coinarchives-source-link|coinarchives-query/);
  const markup = parseHtml(html);
  for (const id of ['year-medians', 'coinarchives-year-medians']) assert.equal(markup.getElementById(id).querySelectorAll('.price-basis').length, 0, id);
  const search = html.slice(html.indexOf('<details id="price-search"'), html.indexOf('</details>', html.indexOf('<details id="price-search"')));
  assert.match(search, /<form id="prices-form"/);
});

// Loop 1 (P-05): the first popup showed its placeholder in the typed value's bold mono, so it read as a value, and nothing said what to do. The
// placeholder now reads as one (short enough to show whole beside Look up at 320 px), and until something has been looked up three example chips
// look up on a click, over one line on what follows.
test('the Reference placeholder reads as a placeholder, not a value', () => {
  const markup = parseHtml(readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  assert.equal(markup.getElementById('quick-reference').getAttribute('placeholder'), 'Reference or pasted lot text');
  const css = readFileSync(new URL('../extension/popup.css', import.meta.url), 'utf8');
  assert.match(css, /\.quick-search input::placeholder \{[^}]*font-weight:400[^}]*color:var\(--muted\)/);
});

test('before the first lookup, example chips look up on a click, and they go once there is a Recent row', async () => {
  const lookedUp = [];
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', obverse: {}, reverse: {} };
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async (reference) => { lookedUp.push(reference); return { status: 'ok', card }; } });
  assert.equal(popup.element('first-run').hidden, false);
  const chips = popup.element('example-list').children.map((item) => item.children[0]);
  assert.deepEqual(chips.map((chip) => chip.textContent), ['RIC I² Nero 306', 'Crawford 44/5', 'Price 23']);
  await chips[2].emit('click');
  await settle();
  assert.equal(popup.element('quick-reference').value, 'Price 23');
  assert.equal(lookedUp.length, 1);
  assert.equal(lookedUp[0].catalogue, 'Price');
  assert.equal(popup.element('first-run').hidden, true);
  // Every example is a reference the box reads.
  for (const example of chips.map((chip) => chip.textContent)) assert.ok(lookup.parseReference(example), example);
});

// Loop 1 (P-03): the footer's credit took two lines and dropped the arrow of "acsearch ↗" under the word at every width. The credit keeps every
// corpus it names (tests/pco-agco.test.mjs) but loses its "Type data:" prefix, so it fits one line in the 400 px popup, and the link never breaks.
test('the footer credit fits the popup on one line, and the acsearch link never breaks', () => {
  const html = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  const footer = html.slice(html.indexOf('<footer class="popup-footer">'), html.indexOf('</footer>'));
  assert.match(footer, /<span>ANS OCRE, PELLA, CRRO, SCO, PCO, AGCO &amp; BIGR \(ODbL\)<\/span>/);
  const css = readFileSync(new URL('../extension/popup.css', import.meta.url), 'utf8');
  assert.match(css, /\.popup-footer a \{[^}]*white-space:nowrap/);
});

// Loop 1 (P-06): "RIC 237" listed 47 types flat, each ending in the same "Local catalogue" badge, inside the open Refine form. The list now stands
// outside Refine, grouped by volume under a small heading with its count, says once where the types came from, and above 12 rows offers a filter.
const volumeChoices = (count) => ({ status: 'candidates', corpus: 'ocre', partial: true, candidates: [
  ...['Augustus', 'Galba', 'Nero'].map((ruler) => ({ id: `ric.1(2).${ruler}.237`, title: `RIC I (second edition) ${ruler} 237`, source: 'local' })),
  ...['Caracalla', 'Elagabalus', 'Gordian III', 'Philip I', 'Septimius Severus', 'Severus Alexander', 'Volusian', 'Maximinus I', 'Balbinus', 'Pupienus']
    .map((ruler) => ({ id: `ric.4.${ruler}.237`, title: `RIC IV ${ruler} 237`, source: 'local' })),
  { id: 'ric.7.tri.237', title: 'RIC VII Treveri 237', source: 'local' },
].slice(0, count) });

test('a list of types is grouped by volume, says once where it came from, and stays out of Refine', async () => {
  const opened = [];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async () => volumeChoices(14),
    localProvider: { serves: () => true, lookupById: async (corpus, id) => { opened.push(id); return { status: 'ok', card: { id, corpus, label: 'RIC IV Caracalla 237', obverse: {}, reverse: {} } }; } } });
  popup.element('quick-reference').value = 'RIC 237';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('candidates').hidden, false);
  assert.equal(popup.element('refine-reference').open, false);
  assert.equal(popup.element('candidates-count').textContent, '14 types, local catalogue');
  const groups = popup.element('candidate-list').children;
  assert.deepEqual(groups.map((group) => group.children[0].textContent), ['RIC I² · 3', 'RIC IV · 10', 'RIC VII · 1']);
  // Each heading names its own list, so a screen reader says "RIC IV, list, 10 items".
  for (const group of groups) assert.equal(group.children[1]['aria-labelledby'], group.children[0].id);
  assert.ok(groups.every((group) => group.children[0].id));
  const row = groups[1].children[1].children[0].children[0];
  assert.equal(row['aria-label'], 'RIC IV Caracalla 237');
  assert.equal(row.children[0].textContent, 'Caracalla');
  assert.equal(JSON.stringify(row.children).includes('Local catalogue'), false);
  // Above 12 rows, a filter narrows them, and a volume left empty goes with its rows.
  assert.equal(popup.element('candidate-filter').hidden, false);
  popup.element('candidate-filter').value = 'treveri';
  await popup.element('candidate-filter').emit('input');
  assert.deepEqual(groups.map((group) => group.hidden), [true, true, false]);
  popup.element('candidate-filter').value = 'sever';
  await popup.element('candidate-filter').emit('input');
  // The count follows the filter: two of RIC IV's ten are Severan.
  assert.deepEqual(groups.map((group) => [group.hidden, group.children[0].textContent]), [[true, 'RIC I² · 0'], [false, 'RIC IV · 2'], [true, 'RIC VII · 0']]);
  popup.element('candidate-filter').value = 'treveri';
  await popup.element('candidate-filter').emit('input');
  assert.equal(groups[1].children[1].children[0].hidden, true);
  await row.emit('click');
  await settle();
  assert.deepEqual(opened, ['ric.4.Caracalla.237']);
});

test('a short list of types keeps no filter and no volume headings', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async () => volumeChoices(3) });
  popup.element('quick-reference').value = 'RIC 237';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('candidate-filter').hidden, true);
  assert.equal(popup.element('candidates-count').textContent, '3 types, local catalogue');
  assert.deepEqual(popup.element('candidate-list').children.map((item) => item.children[0]['aria-label']),
    ['RIC I (second edition) Augustus 237', 'RIC I (second edition) Galba 237', 'RIC I (second edition) Nero 237']);
});

test('the list of types stands outside the Refine form', () => {
  const html = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  const refine = html.slice(html.indexOf('<details id="refine-reference"'), html.indexOf('</details>', html.indexOf('<details id="refine-reference"')));
  assert.doesNotMatch(refine, /id="candidates"/);
  assert.match(html, /id="candidates"/);
});

// Loop 1 (P-07): the header read "Panel ▸ Sources Settings" - a disclosure marker between two plain buttons - and the theme switch was hidden. Sources
// draws as the other two do, with a trailing ⌄, and the switch is an icon button in the header again, writing the same choice Settings → Appearance
// shows (the last one made wins, wherever it was made).
test('the header shows Sources like its neighbours and a working theme switch', async () => {
  const markup = parseHtml(readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  const toggle = markup.getElementById('theme-toggle');
  assert.equal(toggle.hidden, false);
  assert.equal(toggle.getAttribute('aria-hidden'), null);
  assert.equal(toggle.getAttribute('tabindex'), null);
  assert.match(toggle.getAttribute('class'), /\bicon-button\b/);
  for (const id of ['icon-moon', 'icon-sun']) assert.equal(markup.getElementById(id).querySelectorAll('svg').length, 1, id);
  const css = readFileSync(new URL('../extension/popup.css', import.meta.url), 'utf8');
  assert.match(css, /\.header-actions summary \{[^}]*list-style:none/);
  // Loop 2 (M2 fix round): its ⌄ is the chevron every fold draws, from the shared layer; the popup no longer draws a glyph of its own.
  assert.doesNotMatch(css, /\.header-actions[^{]*summary::after/);
  const layer = readFileSync(new URL('../extension/design-tokens.css', import.meta.url), 'utf8');
  assert.match(layer, /:is\(\.sources-menu[^{]*>summary::after\{content:""[^}]*border-right:[^}]*border-bottom:/);
  const stored = new Map();
  const popup = await loadPopup({ stored, permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }) });
  // The system is dark here, so the switch offers light, and remembers it under the key Settings writes.
  assert.equal(popup.element('theme-toggle')['aria-pressed'], 'true');
  await popup.element('theme-toggle').emit('click');
  assert.equal(popup.document.documentElement.dataset.theme, 'light');
  assert.equal(stored.get('giga-pinax-theme-v1'), 'light');
  assert.equal(popup.element('theme-toggle')['aria-pressed'], 'false');
});

// Fix round (review Important 1): the citing-filter row was drawn only when the prices landed, so everything under it, the held median included,
// dropped 28 px. It is drawn while acsearch answers, from the reference and term already known, and says the same once the answer is in.
test('the filter row is drawn while acsearch answers, so its arrival moves nothing', async () => {
  const answer = deferred();
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: () => answer.promise });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('prices-panel').dataset.state, 'loading');
  assert.equal(popup.element('price-filters').hidden, false);
  assert.equal(popup.element('citing-row').hidden, false);
  assert.equal(popup.element('citing-label').textContent, 'Citing Price 23');
  answer.resolve(mixedSales);
  await settle();
  assert.equal(popup.element('price-filters').hidden, false);
  assert.equal(popup.element('citing-label').textContent, 'Citing Price 23');
});

test('a search that is not the reference\'s own draws no filter row while it loads', async () => {
  const first = deferred();
  const later = deferred();
  const answers = [first, later];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: () => answers.shift().promise });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  first.resolve(mixedSales);
  await settle();
  // The edited term searches something else: no citation filter applies to it, loading or loaded.
  popup.element('price-term').value = 'Alexander tetradrachm';
  await popup.element('prices-form').emit('submit');
  await settle();
  assert.equal(popup.element('prices-panel').dataset.state, 'loading');
  assert.equal(popup.element('citing-row').hidden, true);
});

// Fix round (review Minor 2, 3, 6, 7).
// Fix round 2 (re-review Important 3 and Minor 8): the stat lines were cut with an ellipsis at 360 and 320, hiding "1 without a price". They wrap
// now, and the block holds a second line's room under 400 px, so one wrap moves nothing; the trend, which arrives with the answer, stands under the
// range block, beside the year strip and the grade medians that arrive with it.
test('Change search never wraps; the stat lines wrap inside a held height; the trend comes after the range', () => {
  const css = readFileSync(new URL('../extension/popup.css', import.meta.url), 'utf8');
  assert.match(css, /\.price-search summary > span:first-child \{[^}]*flex-shrink:0; white-space:nowrap/);
  const statMeta = /\.stat-meta \{[^}]*\}/.exec(css)[0];
  assert.doesNotMatch(statMeta, /nowrap|ellipsis|overflow:hidden/);
  assert.match(css, /\.median-block \{min-height:98px;\}/);
  assert.match(css, /@media \(max-width:399px\) \{[^@]*\.median-block \{min-height:115px;\}/);
  const html = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="range-block"') < html.indexOf('id="sale-trend"'));
  assert.ok(html.indexOf('id="sale-trend"') < html.indexOf('id="year-medians"'));
});

test('each stat line carries its whole text as a tooltip, since a narrow panel may cut it', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => mixedSales });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('stat-sales').title, `${popup.element('sale-strength').textContent} · ${popup.element('last-sale').children.map((part) => part.textContent ?? part).join('')}`);
  assert.equal(popup.element('stat-counts').title, `${popup.element('cited-count').textContent} · ${popup.element('sale-period').textContent}`);
});

test('the Reference box is described only by its error line', () => {
  const markup = parseHtml(readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  assert.equal(markup.getElementById('quick-reference').getAttribute('aria-describedby'), 'form-error');
});

test('the example chips go once a lookup has answered or the box holds text', async () => {
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }),
    lookupTypeImpl: async () => volumeChoices(3) });
  assert.equal(popup.element('first-run').hidden, false);
  popup.element('quick-reference').value = 'R';
  await popup.element('quick-reference').emit('input');
  assert.equal(popup.element('first-run').hidden, true);
  popup.element('quick-reference').value = '';
  await popup.element('quick-reference').emit('input');
  assert.equal(popup.element('first-run').hidden, false);
  popup.element('quick-reference').value = 'RIC 237';
  await popup.element('reference-form').emit('submit');
  await settle();
  // A list of types is an answer: it has no Recent row, and still the examples go.
  assert.equal(popup.element('candidates').hidden, false);
  popup.element('quick-reference').value = '';
  await popup.element('quick-reference').emit('input');
  assert.equal(popup.element('first-run').hidden, true);
});

// Fix round 2 (with L2's futureText): a lot dated after today with a price in its field is never counted as a sale. The coverage line names it as
// such, in the words Copy summary uses, instead of lumping it with prices that could not be read.
test('the coverage line names future-dated lots apart from uncounted prices', async () => {
  const lots = [citingSale('a', '220', 'Macedon. Tetradrachm. Price 23. VF'), citingSale('b', '300', 'Macedon. Tetradrachm. Price 23. VF'),
    { ...citingSale('c', '380', 'Macedon. Tetradrachm. Price 23. VF'), date: '01.06.2099' }];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('sale-period').textContent, '3 matches on acsearch · 1 future-dated lot not counted');
});

// Loop 3 (G-03): in the 600 px popup the median was on the bottom edge. What stood above it takes less room without losing anything: Save is a small
// button in the card's heading row beside Type, its hint a tooltip; the sides and the specimens fold into one line; the citing and denomination
// switches are pills in the sales period's row, and the section's name is said to a screen reader only.
test('the card and the filter row give the median room: Save in the heading, one fold, the filters among the period pills', () => {
  const markup = parseHtml(readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  const save = markup.getElementById('companion-save-watchlist');
  assert.ok(save.closest('.type-heading'), 'Save stands in the heading row');
  assert.match(save.className, /secondary-button/);
  assert.equal(save.textContent.trim(), 'Save');
  assert.match(save.getAttribute('title'), /^Saves the reference/);
  assert.equal(markup.getElementById('specimens').closest('details')?.id, 'sides-details');
  assert.equal(markup.getElementById('sides-summary').textContent, 'Obverse · reverse');
  for (const id of ['citing-row', 'denomination-row']) assert.ok(markup.getElementById(id).closest('.research-heading'), id);
  assert.match(markup.getElementById('research-prices-title').className, /sr-only/);
  const css = readFileSync(new URL('../extension/popup.css', import.meta.url), 'utf8');
  assert.match(css, /\.result \{margin:0 16px; padding:12px 0;/);
  assert.match(css, /\.sides-details > summary \{min-height:28px;\}/);
});

test('specimens found fold under the sides, and the fold says so', async () => {
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', source: 'local', obverse: {}, reverse: {} };
  const popup = await loadPopup({ permissionRequest: async () => true, permissionContains: async () => true, priceFetch: async () => ({ status: 'empty' }),
    stored: new Map([['giga-pinax-specimen-photos-v1', 'on']]),
    specimenFetch: async () => [{ page: 'https://example.org/1', collection: 'Museum', obverse: 'https://example.org/o.jpg', reverse: 'https://example.org/r.jpg' }],
    localProvider: { serves: () => true, lookupType: async () => ({ status: 'ok', card }), lookupById: async () => ({ status: 'ok', card }) } });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  for (let turn = 0; turn < 10; turn += 1) await settle();
  assert.equal(popup.element('specimens').hidden, false);
  assert.equal(popup.element('sides-summary').textContent, 'Obverse · reverse · specimens');
  await popup.element('quick-reference').emit('input');
  assert.equal(popup.element('sides-summary').textContent, 'Obverse · reverse');
});

// Loop 3 (G-21): Recent was the last thing before the footer, under a 1,215 px answer. It stands under the Reference row, steps aside while a new
// reference is typed, and comes back with the answer.
test('Recent stands under the Reference row, steps aside while typing, and comes back with the answer', async () => {
  const markup = parseHtml(readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  assert.ok(markup.getElementById('recent').closest('.quick-row'), 'Recent is in the Reference row');
  assert.equal(markup.getElementById('recent-more').hidden, true);
  const card = { id: 'price.23', corpus: 'pella', label: 'Price 23', source: 'local', obverse: {}, reverse: {} };
  const stored = new Map([[preferences.STORAGE_KEY, JSON.stringify({ recent: [{ corpus: 'pella', id: 'price.24', label: 'Price 24' }] })]]);
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'empty' }), stored,
    localProvider: { serves: () => true, lookupType: async () => ({ status: 'ok', card }), lookupById: async () => ({ status: 'ok', card }) } });
  assert.equal(popup.element('recent').hidden, false);
  popup.element('quick-reference').value = 'Price';
  await popup.element('quick-reference').emit('input');
  assert.equal(popup.element('recent').hidden, true, 'hidden while typing');
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('recent').hidden, false, 'back with the answer');
  popup.element('quick-reference').value = '';
  await popup.element('quick-reference').emit('input');
  assert.equal(popup.element('recent').hidden, false, 'an emptied box shows it');
});

// Loop 3 (G-13): the Research tab named nothing of the workspace, and "Panel" said nothing of what it gives. The header opens the workspace by name;
// the side panel is an icon whose name says what it is for; first run says that a saved coin is tracked there.
test('the header opens the workspace by name and the side panel is an icon that says what it keeps', () => {
  const markup = parseHtml(readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  const actions = [...markup.querySelector('.header-actions').children];
  assert.equal(actions[0].id, 'open-workspace');
  assert.equal(actions[0].textContent.trim(), 'Workspace');
  const panel = markup.getElementById('open-panel');
  assert.match(panel.className, /icon-button/);
  assert.equal(panel.getAttribute('aria-label'), 'Keep the popup open beside the page (side panel)');
  assert.equal(panel.textContent.trim(), '');
  assert.equal(panel.parentElement.className, 'popup-header');
  assert.match(markup.getElementById('first-run').textContent, /Save a coin to track its auction, bid and outcome in the workspace\./);
});
