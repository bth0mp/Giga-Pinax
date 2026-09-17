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

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

class TestElement {
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
    this.classList = { toggle() {} };
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
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll() { return []; }
  contains() { return false; }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { delete this[name]; }
  toggleAttribute(name, force) { this[name] = force; }
  getBoundingClientRect() { return { top: 0 }; }
  scrollIntoView() {}
  focus() { this.focused = (this.focused ?? 0) + 1; }
  reportValidity() { return true; }
  setSelectionRange() {}
}

async function loadPopup({ permissionRequest, priceFetch, coinArchivesFetch = async () => ({ status: 'empty' }), localProvider = null,
  permissionContains = async () => true, lookupTypeImpl = lookup.lookupType, formValidity = true, clipboard = [] }) {
  const elements = new Map();
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
  };
  const browser = {
    permissions: {
      request: permissionRequest,
      contains: permissionContains,
    },
  };
  const window = new TestElement('window');
  window.open = () => {};
  window.close = () => {};
  const sandbox = {
    ...lookup, ...prices, ...preferences, ...catalogues, ...selection, ...lot, ...companion, ...localCatalogue, ...coinArchivesPrices,
    createLocalCatalogue: () => localProvider,
    fetchPrices: priceFetch,
    fetchCoinArchivesPrices: coinArchivesFetch,
    lookupType: lookupTypeImpl,
    browser,
    document,
    window,
    globalThis: null,
    localStorage: { getItem: () => null, setItem() {} },
    location: { search: '', href: 'moz-extension://test/popup.html' },
    navigator: { clipboard: { writeText: async (text) => { clipboard.push(text); } } },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    Option: class extends TestElement { constructor(label, value) { super(); this.label = label; this.value = value; } },
    Event: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    URL, URLSearchParams, Intl, Date, Object, String, Math, JSON, Promise, WeakMap, WeakSet, Set,
    setTimeout: () => 0,
    clearTimeout() {},
    dispatchEvent() {},
    console,
  };
  sandbox.globalThis = sandbox;

  const popupPath = new URL('../extension/popup.js', import.meta.url);
  const source = readFileSync(popupPath, 'utf8').replace(/^import .*?;\r?\n/gm, '');
  vm.runInNewContext(source, sandbox, { filename: popupPath.pathname });
  return { element, document, clipboard };
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
  popup.document.activeElement = popup.element('reference-number');
  await popup.element('reference-form').emit('submit');
  assert.equal(lookedUp.length, 1);
  assert.equal(lookedUp[0].number, '234/1');
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
  assert.match(popup.element('coinarchives-sample').textContent, /1 recorded sale.*2025/);
  assert.match(popup.element('coinarchives-coverage').textContent, /added in the past 6 months.*first 100 results/i);
  assert.match(popup.element('coinarchives-counts').textContent, /Other currencies not converted: 1 EUR.*1 unpriced.*1 upcoming/);
  assert.equal(popup.element('prices-panel').hidden, false);
  popup.element('price-term').value = 'edited only for acsearch';
  await popup.element('price-term').emit('input');
  assert.equal(popup.element('coinarchives-query').textContent, 'Query: Price 23');
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
    localProvider: { lookupType: async () => ({ status: 'ok', card }), lookupById: async () => ({ status: 'ok', card }) },
  });
  popup.element('quick-reference').value = 'RIC I² Nero 306';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(requested, 0);
  assert.equal(remote, 0);
  assert.equal(popup.element('result-reference').textContent, card.label);
  assert.equal(popup.element('result-source').textContent, 'Local OCRE catalogue');
});

test('RIC local miss offers an explicit online permission button', async () => {
  let requested = 0;
  const popup = await loadPopup({
    permissionRequest: async () => { requested += 1; return false; }, permissionContains: async () => false,
    priceFetch: async () => ({ status: 'empty', term: 'Nero 99999' }),
    localProvider: { lookupType: async () => ({ status: 'none' }), lookupById: async () => ({ status: 'none' }) },
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

test('editing cancels a delayed online permission retry', async () => {
  const permission = deferred();
  let localCalls = 0;
  const card = { id: 'x', corpus: 'ocre', label: 'RIC I (second edition) Nero 1', source: 'local', obverse: {}, reverse: {} };
  const popup = await loadPopup({
    permissionRequest: () => permission.promise, permissionContains: async () => false,
    priceFetch: async () => ({ status: 'empty', term: 'Nero 1' }),
    localProvider: { lookupType: async () => (++localCalls === 1 ? { status: 'none' } : { status: 'ok', card }), lookupById: async () => ({ status: 'none' }) },
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
    localProvider: { lookupType: async () => { localCalls += 1; return { status: 'none' }; }, lookupById: async () => ({ status: 'none' }) },
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
  assert.equal(popup.element('cited-count').textContent, '1 of 2 results cite this reference');
  assert.equal(popup.element('curation-count').textContent, '1 included · 1 excluded');
  assert.match(popup.element('announcement').textContent, /1 of 2 results cite this reference/);
  const toggle = popup.element('sale-list').children[1].children[2];
  assert.equal(toggle.textContent, 'Include');
  await toggle.emit('click');
  assert.match(popup.element('median-amount').textContent, /200/);
  // The redrawn row keeps the keyboard where it was.
  assert.equal(popup.element('sale-list').children[1].children[2].focused, 1);
  await popup.element('reset-curation').emit('click');
  assert.match(popup.element('median-amount').textContent, /100/);
  assert.equal(popup.element('cited-count').textContent, '1 of 2 results cite this reference');
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
  assert.equal(popup.element('denomination-label').textContent, 'Only results naming “tetradrachm”');
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

test('a median per grade appears once a bucket rests on three sales', async () => {
  const graded = (id, price, grade) => citingSale(id, price, `Alexander III. Tetradrachm. Price 23. ${grade}`);
  const lots = [graded('s1', '100', 'Very Fine'), graded('s2', '200', 'gVF'), graded('s3', '300', 'VF'), graded('s4', '900', 'Extremely Fine')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => ({ status: 'ok', lots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  assert.equal(popup.element('grade-medians').hidden, false);
  assert.deepEqual(popup.element('grade-medians').children.map((line) => line.textContent), ['VF: median $200 (3)']);
  await popup.element('copy-summary').emit('click');
  assert.match(popup.clipboard[0], /\nVF: median \$200 \(3\)/);
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

test('the CoinArchives median leaves out a public row that does not cite the reference', async () => {
  const publicLot = (id, amount, description) => ({ id, title: `Auction, Lot ${id}`, description, date: '2025-02-01', price: `USD ${amount}`, amount,
    currency: 'USD', url: `https://www.coinarchives.com/a/lotviewer.php?LotID=${id}`, source: 'coinarchives' });
  const selectedLots = [publicLot('ca-1', 150, 'Macedon. Tetradrachm. Price 23. VF'), publicLot('ca-2', 950, 'Macedon. Tetradrachm. Price 3014. VF')];
  const popup = await loadPopup({ permissionRequest: async () => true, priceFetch: async () => oneSale,
    coinArchivesFetch: async () => ({ ...coinArchivesSale, lots: selectedLots, selectedLots }) });
  popup.element('quick-reference').value = 'Price 23';
  await popup.element('reference-form').emit('submit');
  await settle();
  await popup.element('coinarchives-prices-button').emit('click');
  await settle();
  assert.match(popup.element('coinarchives-median').textContent, /150/);
  assert.match(popup.element('coinarchives-counts').textContent, /1 not citing this reference/);
  assert.equal(popup.element('coinarchives-sale-list').children.length, 1);
});
