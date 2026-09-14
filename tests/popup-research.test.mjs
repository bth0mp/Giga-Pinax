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
  focus() {}
  reportValidity() { return true; }
  setSelectionRange() {}
}

async function loadPopup({ permissionRequest, priceFetch, localProvider = null, permissionContains = async () => true }) {
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
    ...lookup, ...prices, ...preferences, ...catalogues, ...selection, ...lot, ...companion, ...localCatalogue,
    createLocalCatalogue: () => localProvider,
    fetchPrices: priceFetch,
    browser,
    document,
    window,
    globalThis: null,
    localStorage: { getItem: () => null, setItem() {} },
    location: { search: '', href: 'moz-extension://test/popup.html' },
    navigator: { clipboard: { writeText: async () => {} } },
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
  return { element };
}

const oneSale = {
  status: 'ok',
  lots: [{ id: 'sale-1', title: 'Price 23', date: '2025-01-01', price: '120' }],
};

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
  assert.equal(popup.element('price-term').value, 'Price 23');
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
