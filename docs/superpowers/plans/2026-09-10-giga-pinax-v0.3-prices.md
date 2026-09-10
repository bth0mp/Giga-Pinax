# Giga Pinax v0.3 Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add acsearch hammer-price statistics (median, middle 50%, sales list) to the type card, fetched one page per click with the collector's own acsearch session and an editable search term.

**Architecture:** A new pure module `extension/prices.js` builds the acsearch search URL, extracts the lot JSON the results page embeds, parses prices, and summarises them; one composing `fetchPrices` takes an injectable `fetch`. `preferences.js` gains CHF and a per-type remembered term. `popup.js` wires a small prices form and renders the median layout ported from `prototype/styles.css`. No background scripts, no content scripts.

**Tech Stack:** Vanilla ES modules, Manifest V3, Node 22 `node:test`, Python 3 stdlib packager, `web-ext` lint only.

**Spec:** `docs/superpowers/specs/2026-09-10-giga-pinax-v0.3-prices-design.md`

## Global Constraints

- One acsearch request per Get prices click; never more than one page; nothing from acsearch cached beyond the current result; no background activity. This is the scope acsearch approved.
- No runtime dependencies, no bundler, no remote fonts/images. Node built-in test runner only.
- Never fabricate a result. Exact strings: sign-in note `Sign in on acsearch with your own account, then select “Get prices” again.`; empty `acsearch returned no sales for “{term}”. Try a broader term.`; unpriced `No hammer prices among the sales acsearch returned for “{term}”.`; network `Couldn’t reach acsearch. Check your connection and try again.`; permission `Giga Pinax needs permission to contact acsearch.info to fetch prices. Select “Get prices” again to allow it.`
- Search URL exactly `https://www.acsearch.info/search.html?term={term}&category=1&currency={usd|eur|gbp|chf}&order=1`, sent with `credentials: 'include'` and a 15-second `AbortController` timeout.
- `host_permissions` exactly `["https://numismatics.org/*", "https://nomisma.org/*", "https://www.acsearch.info/*"]`; no `permissions`, `content_scripts`, `background`, or optional-permission keys. Firefox `data_collection_permissions.required` stays `["none"]`.
- Version `0.3.0` everywhere: manifests, ZIP names `giga-pinax-{browser}-0.3.0.zip`, docs.
- Storage keys unchanged: `giga-pinax-preferences-v1`, `giga-pinax-labels-v1`. Currencies `USD, EUR, GBP, CHF`.
- Remote strings only ever reach the DOM through `textContent`; links are constructed from the lot `id`, never from remote URLs.
- Test fixture `tests/fixtures/acsearch-search-nero-306.html` is a real logged-out page trimmed to three lots (all prices `*`); do not hand-edit it.
- Commit after every task; messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Working directory `Z:\Ancient Coin Browser extension` on Windows; shell is Git Bash; quote paths; `dist/` is git-ignored build output.

## File Structure

| File | Responsibility |
|---|---|
| `extension/prices.js` (new) | `ACSEARCH_ORIGIN`, `buildSearchUrl`, `extractLots`, `parsePrice`, `defaultTerm`, `summarise`, `fetchPrices`. |
| `extension/preferences.js` | Adds `CHF`, `terms` map validation, `rememberTerm`. |
| `extension/popup.html/css/js` | Prices form, panel, states; median layout styles. |
| `manifests/*.json`, `scripts/build.py`, `tests/test_packages.py` | Version, host permission, asset list. |
| `tests/prices.test.mjs` (new), `tests/preferences.test.mjs` | Unit tests. |
| `README.md`, `docs/INSTALL.md`, `install/index.html` | Docs. |

---

### Task 1: Search URL, lot extraction, price parsing, default term

**Files:**
- Create: `extension/prices.js`
- Test: `tests/prices.test.mjs`

**Interfaces:**
- Produces: `ACSEARCH_ORIGIN = 'https://www.acsearch.info/*'`; `buildSearchUrl({term, currency, order = 1}) → string`; `extractLots(html) → Array<{id, title, date, price}> | null`; `parsePrice(text) → number | null` (positive finite numbers only); `defaultTerm({catalogue, number, section}) → string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/prices.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSearchUrl, extractLots, parsePrice, defaultTerm } from '../extension/prices.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('buildSearchUrl targets acsearch search with term, ancient category, currency and most-recent order', () => {
  assert.equal(buildSearchUrl({ term: ' Nero 306 ', currency: 'USD' }), 'https://www.acsearch.info/search.html?term=Nero+306&category=1&currency=usd&order=1');
  assert.equal(buildSearchUrl({ term: 'Price 23', currency: 'CHF', order: 0 }), 'https://www.acsearch.info/search.html?term=Price+23&category=1&currency=chf&order=0');
  assert.equal(buildSearchUrl({ term: 'a&b=c', currency: 'EUR' }), 'https://www.acsearch.info/search.html?term=a%26b%3Dc&category=1&currency=eur&order=1');
});

test('extractLots reads the embedded results array from a real page', () => {
  const lots = extractLots(fixture('acsearch-search-nero-306.html'));
  assert.equal(lots.length, 3);
  assert.deepEqual(Object.keys(lots[0]), ['id', 'title', 'date', 'price']);
  assert.equal(lots[0].id, '16937025');
  assert.equal(lots[0].title, 'Heritage Auctions, Auction 61635, Lot 23312');
  assert.match(lots[0].date, /^\d{2}\.\d{2}\.\d{4}$/);
  assert.ok(lots.every((lot) => lot.price === '*'));
});

test('extractLots survives "];" inside descriptions and rejects pages without the array', () => {
  const page = '<script>acsearch.initSearchResults = [{"id":1,"title":"A","description":"see [RIC 306]; nice","date":"01.02.2023","price":"1,200","last":false}]; acsearch.x=1;</script>';
  assert.deepEqual(extractLots(page), [{ id: '1', title: 'A', date: '01.02.2023', price: '1,200' }]);
  assert.equal(extractLots('<html>no results here</html>'), null);
  assert.equal(extractLots('acsearch.initSearchResults = [{broken]; '), null);
  assert.equal(extractLots(''), null);
  assert.deepEqual(extractLots('acsearch.initSearchResults = [];'), []);
});

test('parsePrice tolerates common separators and rejects non-prices', () => {
  assert.equal(parsePrice('1,200'), 1200);
  assert.equal(parsePrice("1'200"), 1200);
  assert.equal(parsePrice('1 200'), 1200);
  assert.equal(parsePrice('1200 USD'), 1200);
  assert.equal(parsePrice('$ 1,200.50'), 1200.5);
  assert.equal(parsePrice('1.200,50'), 1200.5);
  assert.equal(parsePrice('12.5'), 12.5);
  assert.equal(parsePrice('950'), 950);
  for (const bad of ['*', '', ' ', 'abc', '0', '-', null, undefined]) assert.equal(parsePrice(bad), null);
});

test('defaultTerm builds the acsearch term from the guided reference', () => {
  assert.equal(defaultTerm({ catalogue: 'RIC', section: ' Nero ', number: '306' }), 'Nero 306');
  assert.equal(defaultTerm({ catalogue: 'Price', number: ' 23 ' }), 'Price 23');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/prices.test.mjs`
Expected: `Cannot find module '.../extension/prices.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `extension/prices.js`:

```js
export const ACSEARCH_ORIGIN = 'https://www.acsearch.info/*';
const SEARCH_URL = 'https://www.acsearch.info/search.html';
const MARKER = 'acsearch.initSearchResults = ';

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function buildSearchUrl({ term, currency, order = 1 }) {
  const params = new URLSearchParams({
    term: squash(term),
    category: '1',
    currency: String(currency ?? 'USD').toLowerCase(),
    order: String(order),
  });
  return `${SEARCH_URL}?${params}`;
}

// ponytail: the page inlines its lots as JSON; try each "];" until one parses, so a "];" inside a description can't truncate it.
export function extractLots(html) {
  const text = String(html ?? '');
  const start = text.indexOf(MARKER);
  if (start < 0) return null;
  const from = start + MARKER.length;
  let end = text.indexOf('];', from);
  while (end >= 0) {
    try {
      const lots = JSON.parse(text.slice(from, end + 1));
      if (Array.isArray(lots)) {
        return lots.filter((lot) => lot && typeof lot === 'object').map((lot) => ({
          id: String(lot.id ?? ''), title: String(lot.title ?? ''), date: String(lot.date ?? ''), price: String(lot.price ?? ''),
        }));
      }
      return null;
    } catch { /* a "];" inside a string; keep scanning */ }
    end = text.indexOf('];', end + 1);
  }
  return null;
}

function normaliseNumber(digits) {
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(digits)) return digits.replace(/[.,]/g, '');
  const decimal = digits.lastIndexOf(',') > digits.lastIndexOf('.') ? ',' : '.';
  const other = decimal === ',' ? '.' : ',';
  return digits.split(other).join('').replace(decimal, '.');
}

// ponytail: acsearch's logged-in price format is unconfirmed; this accepts the usual separator styles and is checked on a real account.
export function parsePrice(text) {
  const raw = String(text ?? '').trim();
  if (!raw || raw === '*') return null;
  const digits = raw.replace(/[^\d.,' ]/g, '').replace(/[' ]/g, '');
  if (!/\d/.test(digits)) return null;
  const value = Number(normaliseNumber(digits));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function defaultTerm({ catalogue, number, section }) {
  return catalogue === 'RIC' ? squash(`${squash(section)} ${squash(number)}`) : squash(`Price ${squash(number)}`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/prices.test.mjs`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extension/prices.js tests/prices.test.mjs
git commit -m "Add acsearch search URL, lot extraction and price parsing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Statistics and the composed fetch

**Files:**
- Modify: `extension/prices.js` (append)
- Test: `tests/prices.test.mjs` (append)

**Interfaces:**
- Consumes: `buildSearchUrl`, `extractLots`, `parsePrice` from Task 1; `TIMEOUT_MS` from `extension/lookup.js`.
- Produces: `summarise(lots) → {total, count, signedOut, capped, priced: Array<{id, title, date, price, amount}>, median, lowerQuartile, upperQuartile, min, max, earliest, latest}` (numbers or `null`; `earliest`/`latest` are four-digit years); `fetchPrices({term, currency}, {fetchImpl?, timeoutMs?}) → Promise<{status:'ok', summary} | {status:'signed-out'} | {status:'empty', term} | {status:'unpriced', term} | {status:'network'}>`.

- [ ] **Step 1: Write the failing tests**

Extend the import line to `import { buildSearchUrl, extractLots, parsePrice, defaultTerm, summarise, fetchPrices } from '../extension/prices.js';` and append:

```js
const lot = (price, date = '01.01.2024', id = '1') => ({ id, title: `Lot ${id}`, date, price });

test('summarise computes median and interpolated quartiles over priced lots only', () => {
  const amounts = [90, 110, 135, 165, 180, 215, 245, 310, 450];
  const lots = [
    ...amounts.map((amount, index) => lot(String(amount), `01.0${index + 1}.${2019 + (index % 3)}`, String(index))),
    lot('*', '01.01.2020', 'x'),
    lot('', '01.01.2021', 'y'),
  ];
  const summary = summarise(lots);
  assert.equal(summary.total, 11);
  assert.equal(summary.count, 9);
  assert.equal(summary.signedOut, false);
  assert.equal(summary.median, 180);
  assert.equal(summary.lowerQuartile, 135);
  assert.equal(summary.upperQuartile, 245);
  assert.equal(summary.min, 90);
  assert.equal(summary.max, 450);
  assert.equal(summary.earliest, 2019);
  assert.equal(summary.latest, 2021);
  assert.equal(summary.capped, false);
  assert.deepEqual(summary.priced.map((entry) => entry.amount).slice(0, 3), [90, 110, 135]);
});

test('summarise handles one, two and a hundred lots, and flags signed-out pages', () => {
  const one = summarise([lot('500')]);
  assert.deepEqual([one.median, one.lowerQuartile, one.upperQuartile, one.min, one.max], [500, 500, 500, 500, 500]);
  const two = summarise([lot('100'), lot('300')]);
  assert.deepEqual([two.median, two.lowerQuartile, two.upperQuartile], [200, 150, 250]);
  const hundred = summarise(Array.from({ length: 100 }, (_, index) => lot(String(index + 1), '01.01.2024', String(index))));
  assert.equal(hundred.count, 100);
  assert.equal(hundred.median, 50.5);
  assert.equal(hundred.capped, true);
  const out = summarise([lot('*'), lot('*')]);
  assert.equal(out.signedOut, true);
  assert.equal(out.count, 0);
  assert.equal(out.median, null);
  const unsold = summarise([lot(''), lot('-')]);
  assert.equal(unsold.signedOut, false);
  assert.equal(unsold.count, 0);
  const empty = summarise([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.signedOut, false);
  assert.equal(empty.earliest, null);
});

function fakeFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => { calls.push({ url, init }); return { ok, status, text: async () => body }; };
  impl.calls = calls;
  return impl;
}

test('fetchPrices sends credentials to acsearch and classifies outcomes', async () => {
  const signedOut = fakeFetch(fixture('acsearch-search-nero-306.html'));
  assert.deepEqual(await fetchPrices({ term: 'Nero 306', currency: 'USD' }, { fetchImpl: signedOut }), { status: 'signed-out' });
  assert.equal(signedOut.calls[0].url, 'https://www.acsearch.info/search.html?term=Nero+306&category=1&currency=usd&order=1');
  assert.equal(signedOut.calls[0].init.credentials, 'include');
  assert.ok(signedOut.calls[0].init.signal instanceof AbortSignal);

  const page = (lots) => `<script>acsearch.initSearchResults = ${JSON.stringify(lots)};</script>`;
  const ok = await fetchPrices({ term: 'Nero 306', currency: 'EUR' }, { fetchImpl: fakeFetch(page([lot('100'), lot('300'), lot('*')])) });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.summary.median, 200);
  assert.equal(ok.summary.total, 3);
  assert.deepEqual(await fetchPrices({ term: 'zzz', currency: 'USD' }, { fetchImpl: fakeFetch(page([])) }), { status: 'empty', term: 'zzz' });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot(''), lot('-')])) }), { status: 'unpriced', term: 'q' });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch('<html>changed</html>') }), { status: 'network' });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch('', { ok: false, status: 503 }) }), { status: 'network' });
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: hang, timeoutMs: 20 }), { status: 'network' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/prices.test.mjs`
Expected: SyntaxError — `summarise` not exported.

- [ ] **Step 3: Write the minimal implementation**

Add `import { TIMEOUT_MS } from './lookup.js';` as the first line of `extension/prices.js`, then append:

```js
const PAGE_SIZE = 100;

export function summarise(lots) {
  const priced = lots.map((entry) => ({ ...entry, amount: parsePrice(entry.price) })).filter((entry) => entry.amount !== null);
  const amounts = priced.map((entry) => entry.amount).sort((a, b) => a - b);
  const at = (fraction) => {
    const position = fraction * (amounts.length - 1);
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return amounts[low] + (amounts[high] - amounts[low]) * (position - low);
  };
  const years = priced.map((entry) => Number.parseInt(entry.date.slice(-4), 10)).filter(Number.isFinite);
  const has = amounts.length > 0;
  return {
    total: lots.length,
    count: amounts.length,
    signedOut: lots.length > 0 && !has && lots.every((entry) => String(entry.price).trim() === '*'),
    capped: lots.length >= PAGE_SIZE,
    priced,
    median: has ? at(0.5) : null,
    lowerQuartile: has ? at(0.25) : null,
    upperQuartile: has ? at(0.75) : null,
    min: has ? amounts[0] : null,
    max: has ? amounts[amounts.length - 1] : null,
    earliest: years.length ? Math.min(...years) : null,
    latest: years.length ? Math.max(...years) : null,
  };
}

export async function fetchPrices({ term, currency }, options = {}) {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(buildSearchUrl({ term, currency }), { signal: controller.signal, credentials: 'include' });
    if (!response.ok) return { status: 'network' };
    const lots = extractLots(await response.text());
    if (!lots) return { status: 'network' };
    if (lots.length === 0) return { status: 'empty', term };
    const summary = summarise(lots);
    if (summary.signedOut) return { status: 'signed-out' };
    if (summary.count === 0) return { status: 'unpriced', term };
    return { status: 'ok', summary };
  } catch {
    return { status: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/prices.test.mjs`
Expected: `# pass 8`, `# fail 0`, runner exits promptly.

- [ ] **Step 5: Commit**

```bash
git add extension/prices.js tests/prices.test.mjs
git commit -m "Summarise acsearch lots and compose the one-page price fetch

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: CHF and remembered terms in preferences

**Files:**
- Modify: `extension/preferences.js`
- Test: `tests/preferences.test.mjs`

**Interfaces:**
- Produces: `CURRENCIES = ['USD','EUR','GBP','CHF']`; `restorePreferences(raw)` now returns `{currency, catalogue, number, volume, section, terms}` where `terms` is `{[typeId]: string}` with at most 50 entries, keys and values capped at 120 characters; `rememberTerm(preferences, typeId, term) → preferences` (moves/adds `typeId` as the newest entry, drops the oldest beyond 50).

- [ ] **Step 1: Update and extend the tests**

In `tests/preferences.test.mjs`, change the import to `import { restorePreferences, rememberTerm, STORAGE_KEY, CURRENCIES } from '../extension/preferences.js';`, change `defaults` to

```js
const defaults = { currency: 'USD', catalogue: 'Price', number: '23', volume: 'I (2nd edition)', section: 'Nero', terms: {} };
```

change the `assert.deepEqual(saved, {...})` expectation in the second test to include `terms: {}`, change the `CURRENCIES` assertion to `['USD', 'EUR', 'GBP', 'CHF']`, and append:

```js
test('terms are restored per type id, sanitised and capped at 50', () => {
  const saved = restorePreferences(JSON.stringify({ terms: { 'price.23': 'Price 23 tetradrachm', bad: 7, ['x'.repeat(200)]: 'y'.repeat(200) } }));
  assert.equal(saved.terms['price.23'], 'Price 23 tetradrachm');
  assert.equal(saved.terms.bad, undefined);
  assert.equal(Object.keys(saved.terms).length, 2);
  assert.equal(saved.terms['x'.repeat(120)].length, 120);
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`t${index}`, `term ${index}`]));
  assert.equal(Object.keys(restorePreferences(JSON.stringify({ terms: many })).terms).length, 50);
  assert.deepEqual(restorePreferences(JSON.stringify({ terms: ['nope'] })).terms, {});
  assert.equal(restorePreferences(JSON.stringify({ currency: 'CHF' })).currency, 'CHF');
});

test('rememberTerm stores the newest term last and drops the oldest beyond 50', () => {
  let preferences = restorePreferences(null);
  for (let index = 0; index < 55; index += 1) preferences = rememberTerm(preferences, `t${index}`, `term ${index}`);
  assert.equal(Object.keys(preferences.terms).length, 50);
  assert.equal(preferences.terms.t0, undefined);
  assert.equal(preferences.terms.t54, 'term 54');
  preferences = rememberTerm(preferences, 't10', 'updated');
  assert.equal(Object.keys(preferences.terms).at(-1), 't10');
  assert.equal(preferences.terms.t10, 'updated');
  assert.equal(rememberTerm(preferences, 'k', 'v'.repeat(200)).terms.k.length, 120);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/preferences.test.mjs`
Expected: SyntaxError — `rememberTerm` not exported.

- [ ] **Step 3: Write the implementation**

Replace `extension/preferences.js` with:

```js
export const STORAGE_KEY = 'giga-pinax-preferences-v1';
export const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CHF']);
const TERM_LIMIT = 50;

const text = (value, fallback) => (typeof value === 'string' ? value.slice(0, 120) : fallback);

function restoreTerms(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const terms = {};
  for (const [key, term] of Object.entries(value).slice(-TERM_LIMIT)) {
    if (key && typeof term === 'string') terms[key.slice(0, 120)] = term.slice(0, 120);
  }
  return terms;
}

export function restorePreferences(raw) {
  let saved;
  try { saved = JSON.parse(raw); } catch { saved = null; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const catalogue = saved.catalogue === 'RIC' ? 'RIC' : 'Price';
  return {
    currency: CURRENCIES.includes(saved.currency) ? saved.currency : 'USD',
    catalogue,
    number: text(saved.number, catalogue === 'RIC' ? '306' : '23'),
    volume: text(saved.volume, 'I (2nd edition)'),
    section: text(saved.section, 'Nero'),
    terms: restoreTerms(saved.terms),
  };
}

export function rememberTerm(preferences, typeId, term) {
  const terms = { ...preferences.terms };
  delete terms[typeId];
  terms[typeId] = String(term).slice(0, 120);
  const keys = Object.keys(terms).slice(-TERM_LIMIT);
  return { ...preferences, terms: Object.fromEntries(keys.map((key) => [key, terms[key]])) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/preferences.test.mjs`
Expected: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extension/preferences.js tests/preferences.test.mjs
git commit -m "Remember acsearch terms per type and add CHF

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Version, acsearch permission and packaging

**Files:**
- Modify: `manifests/brave.json`, `manifests/firefox.json`, `scripts/build.py:23-33`, `tests/test_packages.py:16-28`, `tests/test_packages.py:41`, `tests/test_packages.py:99`, and the two `DIST.glob("giga-pinax-*.zip")` lines are unchanged.

- [ ] **Step 1: Update the package tests**

In `tests/test_packages.py`: add `"prices.js",` to `ASSETS` after `"preferences.js",`; set `HOST_PERMISSIONS = ["https://numismatics.org/*", "https://nomisma.org/*", "https://www.acsearch.info/*"]`; change `"0.2.0"` to `"0.3.0"` in the manifest assertion and in the ZIP name f-string.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m unittest discover -s tests -p 'test_*.py'`
Expected: failures on version, host permissions, asset list (missing `prices.js` in the package) and ZIP names.

- [ ] **Step 3: Update manifests and builder**

In both manifests set `"version": "0.3.0"` and

```json
  "host_permissions": [
    "https://numismatics.org/*",
    "https://nomisma.org/*",
    "https://www.acsearch.info/*"
  ],
```

Leave every other key untouched (Firefox keeps `strict_min_version "142.0"` and `data_collection_permissions.required ["none"]`).

In `scripts/build.py` add `"prices.js",` to `ASSET_PATHS` after `"preferences.js",`.

Then `rm -f dist/giga-pinax-*-0.2.0.zip`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m unittest discover -s tests -p 'test_*.py' -v`
Expected: `Ran 6 tests`, `OK`; `dist/` contains the two `0.3.0` ZIPs.

- [ ] **Step 5: Commit**

```bash
git add manifests scripts/build.py tests/test_packages.py
git commit -m "Bump to 0.3.0 and declare the acsearch host permission

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Popup prices form and panel

**Files:**
- Modify: `extension/popup.html`, `extension/popup.css`, `extension/popup.js`

**Interfaces:**
- Consumes: `ACSEARCH_ORIGIN`, `buildSearchUrl`, `defaultTerm`, `fetchPrices` from `prices.js`; `rememberTerm`, `restorePreferences`, `STORAGE_KEY` from `preferences.js`; `HOST_ORIGINS`, `lookupById`, `lookupType` from `lookup.js`.

- [ ] **Step 1: Edit `extension/popup.html`**

Add CHF to the currency select:

```html
<select id="currency" name="currency"><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="CHF">CHF</option></select>
```

Replace the two lines inside `#result` that start with `<div class="range-block">` and `<a id="acsearch-link"` with:

```html
        <form id="prices-form" class="prices">
          <label for="price-term">acsearch search</label>
          <div class="search-row"><input id="price-term" name="term" required maxlength="120" autocomplete="off" spellcheck="false"><button id="prices-button" class="primary-button" type="submit"><span id="prices-label">Get prices</span></button></div>
          <p id="prices-error" class="form-error" role="alert" hidden></p>
          <p id="prices-note" class="prices-note" role="status" hidden><span id="prices-note-text"></span> <a id="signin-link" href="https://www.acsearch.info/login.html" target="_blank" rel="noopener noreferrer" hidden>Sign in <span aria-hidden="true">↗</span></a></p>
        </form>
        <section id="prices-panel" class="prices-panel" aria-label="acsearch hammer prices" hidden>
          <div class="median-block"><p class="metric-label">Median hammer price</p><div class="median-line"><strong id="median-amount"></strong><span id="median-currency"></span></div><p id="sale-period" class="sale-period"></p></div>
          <div class="range-block"><div><p class="metric-label">Middle 50% of sales</p><strong id="range-amount"></strong></div><div class="range-visual" aria-hidden="true"><span class="range-whisker"></span><span id="range-box" class="range-box"></span><span id="range-median" class="range-median"></span></div></div>
          <details id="sale-details" class="sale-details"><summary><span>Inspect sales</span><span class="sale-count"><span id="sale-count"></span><span class="chevron" aria-hidden="true">⌄</span></span></summary><ol id="sale-list" class="sale-list"></ol></details>
          <p id="price-note" class="price-note"></p>
        </section>
        <a id="acsearch-link" class="primary-button acsearch-button" href="https://www.acsearch.info/" target="_blank" rel="noopener noreferrer">Search on acsearch <span aria-hidden="true">↗</span></a>
```

- [ ] **Step 2: Edit `extension/popup.css`**

Delete the `.range-block {...}` and `.price-pending {...}` lines and insert, in their place:

```css
.prices {margin-top:12px; padding-top:12px; border-top:1px solid var(--border);}
.prices-note {font-size:12px; line-height:1.5; color:var(--muted); padding-top:9px;}
.prices-note a {white-space:nowrap;}
.median-block {margin-top:12px;}
.median-line {display:flex; align-items:baseline; gap:8px; margin-top:2px;}
.median-line strong {font-size:46px; line-height:1.1; letter-spacing:-.055em; font-weight:600; font-variant-numeric:tabular-nums;}
#median-currency {font-size:12px; font-weight:600; color:var(--muted);}
.sale-period {font-size:11px; color:var(--muted); margin-top:5px;}
.range-block {background:var(--soft); border:1px solid var(--border); border-radius:8px; margin-top:11px; padding:8px 12px; display:flex; align-items:center; gap:12px;}
.range-block strong {display:block; font-size:17px; font-weight:600; letter-spacing:-.02em; margin-top:3px; font-variant-numeric:tabular-nums;}
.range-visual {position:relative; height:22px; width:100px; margin-left:auto; flex-shrink:0;}
.range-whisker {position:absolute; top:10px; left:0; right:0; border-top:1px solid var(--muted);}
.range-whisker::before,.range-whisker::after {content:""; position:absolute; height:9px; border-left:1px solid var(--muted); top:-5px;}
.range-whisker::after {right:0;}
.range-box {position:absolute; top:2px; height:17px; border:1px solid var(--accent); background:var(--accent-soft); border-radius:2px;}
.range-median {position:absolute; height:21px; border-left:2px solid var(--accent); top:0;}
.sale-details {margin-top:10px; border-top:1px solid var(--border); border-bottom:1px solid var(--border);}
.sale-details summary {list-style:none; cursor:pointer; display:flex; justify-content:space-between; align-items:center; min-height:42px; font-size:12px; font-weight:600;}
.sale-details summary::-webkit-details-marker {display:none;}
.sale-count {display:flex; align-items:center; gap:13px; color:var(--muted);}
.chevron {font-size:15px;}
.sale-details[open] .chevron {transform:rotate(180deg);}
.sale-list {list-style:none; padding:0; margin:0 0 5px;}
.sale-list li {display:flex; gap:10px; justify-content:space-between; align-items:center; padding:10px 0; border-top:1px solid var(--border); font-size:12px;}
.sale-list li span {color:var(--muted); min-width:0; overflow-wrap:anywhere;}
.sale-list li strong {font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap;}
.price-note {font-size:11px; line-height:1.5; color:var(--muted); margin-top:8px;}
```

In the `@media (max-width:359px)` block add `.range-visual {width:70px;}`.

- [ ] **Step 3: Write `extension/popup.js`**

```js
import { HOST_ORIGINS, lookupById, lookupType } from './lookup.js';
import { ACSEARCH_ORIGIN, buildSearchUrl, defaultTerm, fetchPrices } from './prices.js';
import { STORAGE_KEY, rememberTerm, restorePreferences } from './preferences.js';

const $ = (id) => document.getElementById(id);
const api = globalThis.browser ?? globalThis.chrome;
const LABELS_KEY = 'giga-pinax-labels-v1';
const NETWORK_MESSAGE = 'Couldn’t reach numismatics.org. Check your connection and try again.';
const PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it.';
const ACSEARCH_NETWORK_MESSAGE = 'Couldn’t reach acsearch. Check your connection and try again.';
const ACSEARCH_PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact acsearch.info to fetch prices. Select “Get prices” again to allow it.';
const SIGN_IN_MESSAGE = 'Sign in on acsearch with your own account, then select “Get prices” again.';

let rawPreferences = null;
try { rawPreferences = localStorage.getItem(STORAGE_KEY); }
catch { $('storage-note').hidden = false; }
let preferences = restorePreferences(rawPreferences);
let requestId = 0;
let priceRequestId = 0;
let currentCard = null;

const labelCache = {
  read() { try { return JSON.parse(localStorage.getItem(LABELS_KEY)) ?? {}; } catch { return {}; } },
  get(slug) { return this.read()[slug]; },
  set(slug, label) { try { localStorage.setItem(LABELS_KEY, JSON.stringify({ ...this.read(), [slug]: label })); } catch { /* cache is optional */ } },
};

function currentReference() {
  return { catalogue: $('catalogue').value, number: $('reference-number').value,
    volume: $('ric-volume').value, section: $('ric-section').value };
}

function savePreferences() {
  preferences = { ...preferences, ...currentReference(), currency: $('currency').value };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
  catch { $('storage-note').hidden = false; }
}

function updateFields() {
  const isRic = $('catalogue').value === 'RIC';
  $('ric-fields').hidden = !isRic;
  $('ric-volume').required = isRic;
  $('ric-section').required = isRic;
  $('reference-label').textContent = isRic ? 'RIC number (including any suffix)' : 'Price number';
  $('reference-help').textContent = isRic ? 'Example: I (2nd edition), Nero 306' : 'Example: Price 23';
}

function setPricesBusy(busy) {
  $('prices-button').disabled = busy;
  $('prices-label').textContent = busy ? 'Fetching…' : 'Get prices';
}

function clearPrices() {
  priceRequestId += 1;
  $('prices-panel').hidden = true;
  $('prices-error').hidden = true;
  $('prices-note').hidden = true;
  $('signin-link').hidden = true;
  setPricesBusy(false);
}

function clearOutput() {
  $('form-error').hidden = true;
  $('candidates').hidden = true;
  $('result').hidden = true;
  $('lookup-prompt').hidden = true;
  $('reference-number').removeAttribute('aria-invalid');
  $('announcement').textContent = '';
  currentCard = null;
  clearPrices();
}

function showError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  $('reference-number').setAttribute('aria-invalid', 'true');
}

function setBusy(busy) {
  $('lookup-button').disabled = busy;
  $('lookup-label').textContent = busy ? 'Looking up…' : 'Look up';
}

function updateAcsearchLink() {
  const term = $('price-term').value.trim() || currentCard?.label || '';
  $('acsearch-link').href = buildSearchUrl({ term, currency: $('currency').value });
}

function renderCard(card) {
  $('result-reference').textContent = card.label;
  $('result-summary').textContent = [card.authority, card.denomination, card.mint, card.material, card.dates].filter(Boolean).join(' · ');
  $('type-link').href = `https://numismatics.org/${card.corpus}/id/${encodeURIComponent(card.id)}`;
  $('type-link').setAttribute('aria-label', `View ${card.label} on numismatics.org, opens a new tab`);
  for (const side of ['obverse', 'reverse']) {
    $(`${side}-legend`).textContent = card[side].legend ?? '';
    $(`${side}-legend`).hidden = !card[side].legend;
    $(`${side}-description`).textContent = card[side].description ?? '—';
  }
  currentCard = card;
  $('price-term').value = preferences.terms[card.id] ?? defaultTerm(currentReference());
  clearPrices();
  updateAcsearchLink();
  $('result').hidden = false;
  $('announcement').textContent = `Found ${card.label}.`;
}

function renderCandidates(candidates, corpus) {
  $('candidate-list').replaceChildren(...candidates.map(({ id, title }) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    button.textContent = title;
    button.addEventListener('click', () => run(() => lookupById(corpus, id, { cache: labelCache })));
    item.append(button);
    return item;
  }));
  $('candidates').hidden = false;
  $('announcement').textContent = `${candidates.length} possible matches. Choose one.`;
}

function renderPrices(summary, currency) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  $('median-amount').textContent = money.format(summary.median);
  $('median-currency').textContent = currency;
  const years = summary.earliest === summary.latest ? String(summary.earliest) : `${summary.earliest}–${summary.latest}`;
  $('sale-period').textContent = `${summary.count} ${summary.count === 1 ? 'sale' : 'sales'} · ${years}`;
  $('range-amount').textContent = `${money.format(summary.lowerQuartile)}–${money.format(summary.upperQuartile)}`;
  const span = summary.max - summary.min;
  const percent = (value) => (span > 0 ? ((value - summary.min) / span) * 100 : 50);
  $('range-box').style.left = `${span > 0 ? percent(summary.lowerQuartile) : 0}%`;
  $('range-box').style.width = `${span > 0 ? percent(summary.upperQuartile) - percent(summary.lowerQuartile) : 100}%`;
  $('range-median').style.left = `${percent(summary.median)}%`;
  $('sale-count').textContent = String(summary.count);
  $('sale-list').replaceChildren(...summary.priced.map((sale) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    const link = document.createElement('a');
    link.href = `https://www.acsearch.info/search.html?id=${encodeURIComponent(sale.id)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = sale.title || `Lot ${sale.id}`;
    label.append(`${sale.date} · `, link);
    const amount = document.createElement('strong');
    amount.textContent = money.format(sale.amount);
    row.append(label, amount);
    return row;
  }));
  $('price-note').textContent = summary.capped
    ? 'Hammer prices exclude buyer’s fees, tax and shipping. Only the 100 most recent sales are counted.'
    : 'Hammer prices exclude buyer’s fees, tax and shipping.';
  $('sale-details').open = false;
  $('prices-panel').hidden = false;
  $('announcement').textContent = `Median ${money.format(summary.median)} ${currency} over ${summary.count} ${summary.count === 1 ? 'sale' : 'sales'}.`;
}

function showPricesNote(message, withSignIn) {
  $('prices-note-text').textContent = message;
  $('signin-link').hidden = !withSignIn;
  $('prices-note').hidden = false;
}

function showPricesError(message) {
  $('prices-error').textContent = message;
  $('prices-error').hidden = false;
}

async function run(perform) {
  const id = ++requestId;
  clearOutput();
  setBusy(true);
  let outcome;
  try { outcome = await perform(); }
  catch { outcome = { status: 'network' }; }
  finally { if (id === requestId) setBusy(false); }
  if (id !== requestId) return;
  if (outcome.status === 'ok') renderCard(outcome.card);
  else if (outcome.status === 'candidates') renderCandidates(outcome.candidates, outcome.corpus);
  else if (outcome.status === 'none') showError(`No ${outcome.query} found in ${outcome.corpus === 'ocre' ? 'OCRE' : 'PELLA'}. Check the volume, edition and number.`);
  else showError(NETWORK_MESSAGE);
}

async function runPrices() {
  if (!currentCard) return;
  const term = $('price-term').value.trim();
  preferences = rememberTerm(preferences, currentCard.id, term);
  savePreferences();
  updateAcsearchLink();
  clearPrices();
  const id = ++priceRequestId;
  setPricesBusy(true);
  let outcome;
  try { outcome = await fetchPrices({ term, currency: $('currency').value }); }
  catch { outcome = { status: 'network' }; }
  finally { if (id === priceRequestId) setPricesBusy(false); }
  if (id !== priceRequestId) return;
  if (outcome.status === 'ok') renderPrices(outcome.summary, $('currency').value);
  else if (outcome.status === 'signed-out') showPricesNote(SIGN_IN_MESSAGE, true);
  else if (outcome.status === 'empty') showPricesNote(`acsearch returned no sales for “${outcome.term}”. Try a broader term.`, false);
  else if (outcome.status === 'unpriced') showPricesNote(`No hammer prices among the sales acsearch returned for “${outcome.term}”.`, false);
  else showPricesError(ACSEARCH_NETWORK_MESSAGE);
}

// Firefox MV3 grants host permissions lazily; Chromium grants them at install, so contains() short-circuits there.
async function ensureHostAccess(origins) {
  if (!api?.permissions?.request) return true;
  try { if (await api.permissions.contains({ origins })) return true; } catch { return true; }
  try { return await api.permissions.request({ origins }); } catch { return false; }
}

$('catalogue').value = preferences.catalogue;
$('currency').value = preferences.currency;
$('reference-number').value = preferences.number;
$('ric-volume').value = preferences.volume;
$('ric-section').value = preferences.section;
updateFields();

$('catalogue').addEventListener('change', () => {
  $('reference-number').value = $('catalogue').value === 'RIC' ? '306' : '23';
  updateFields();
  savePreferences();
  clearOutput();
  $('lookup-prompt').hidden = false;
});
$('currency').addEventListener('change', () => {
  savePreferences();
  clearPrices();
  updateAcsearchLink();
  $('announcement').textContent = `Currency set to ${$('currency').value}.`;
});
$('reference-form').addEventListener('input', (event) => {
  if (!['reference-number', 'ric-volume', 'ric-section'].includes(event.target.id)) return;
  clearOutput();
  $('lookup-prompt').hidden = false;
  savePreferences();
});
$('reference-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  savePreferences();
  if (!(await ensureHostAccess([...HOST_ORIGINS]))) { clearOutput(); showError(PERMISSION_MESSAGE); return; }
  run(() => lookupType(currentReference(), { cache: labelCache }));
});
$('price-term').addEventListener('input', updateAcsearchLink);
$('prices-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!(await ensureHostAccess([ACSEARCH_ORIGIN]))) { clearPrices(); showPricesError(ACSEARCH_PERMISSION_MESSAGE); return; }
  runPrices();
});
```

- [ ] **Step 4: Run every automated check**

```bash
node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
python scripts/build.py
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors
node --check extension/popup.js
```

Expected: `# pass 23`, `# fail 0`; `OK`; four dist paths; lint `0 errors, 0 warnings`; `node --check` silent.

- [ ] **Step 5: Verify in a served tab (controller)**

Serve the project and open `dist/brave/popup.html`. acsearch's page is not CORS-open, so in a plain tab the real fetch fails and the network message shows; that is expected and is check 1. For the rendering checks, stub `window.fetch` in the page console before pressing Get prices (the module resolves the global `fetch` at call time):

1. Price 23 → card renders; Get prices with the real fetch → `Couldn’t reach acsearch. Check your connection and try again.` in `#prices-error` (CORS in a plain tab), button back to `Get prices`.
2. Stub fetch to return the three-lot fixture body → the sign-in note with a visible `Sign in ↗` link, no red error, no panel.
3. Stub fetch to return `<script>acsearch.initSearchResults = [...9 lots with prices 90…450, dates across 2019–2021...];</script>` → panel shows `$180`, `USD`, `9 sales · 2019–2021`, `$135–$245`, list of 9 rows each linking to `search.html?id=…`, note without the "100 most recent" sentence, range box left 12.5% width 30.56%, median marker left 25%.
4. Same stub with 100 lots → note gains `Only the 100 most recent sales are counted.`
5. Edit the term to `Nero 306 as`, press Get prices (stubbed) → preferences in localStorage contain `terms["ric.1(2).ner.306"] = "Nero 306 as"` after an RIC lookup; reload, look up the same type → the term field restores `Nero 306 as`; Search on acsearch href contains `term=Nero+306+as&category=1&currency=usd&order=1`.
6. Change currency to CHF → panel hides, link href carries `currency=chf`.
7. Console clean; `document.body.scrollWidth === 400` at a 400×600 viewport with the panel and open sales list.

- [ ] **Step 6: Commit**

```bash
git add extension/popup.html extension/popup.css extension/popup.js
git commit -m "Add acsearch prices form and median panel to the popup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`, `docs/INSTALL.md`, `install/index.html`

- [ ] **Step 1: Update `README.md`**

Replace the first two paragraphs with:

```markdown
A toolbar extension for desktop Brave and Firefox that looks up ancient coin types by catalogue reference and shows what they have sold for. Version **0.3.0** resolves RIC references through [OCRE](https://numismatics.org/ocre/) and Price references through [PELLA](https://numismatics.org/pella/), open datasets from the American Numismatic Society published under the Open Database License, then fetches the 100 most recent matching sales from acsearch using your own acsearch account and shows the median hammer price, the middle 50%, and the sales behind them.

acsearch has approved this workflow for the extension: each collector uses their own account, one search runs per click, one page of results is read, and nothing from acsearch is stored. Prices require an acsearch account with price access; without one the extension says so and links to their sign-in page.
```

Replace the "What it does" list with:

```markdown
- Guided entry for Price numbers, or RIC volume/edition, ruler section and number.
- Exact-title matching against the ANS search API; near matches are offered as a short list.
- Ruler, denomination, mint, material, date range, obverse and reverse legends and descriptions.
- An editable acsearch search term (pre-filled from the reference, remembered per type) and a **Get prices** button.
- Median hammer price, middle 50% with a range visual, date span, and an expandable list of the sales linking to acsearch.
- Currency USD, EUR, GBP or CHF, passed to acsearch so hammer prices arrive converted.
- Contacts only `numismatics.org`, `nomisma.org` and `www.acsearch.info` (the last with your own session). Your preferences stay in the browser; only the reference or term you look up is sent.
```

Update the checks block to `node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs` and the fixtures sentence to `Fixtures under \`tests/fixtures/\` are real API responses captured on 2026-09-10, including a logged-out acsearch page trimmed to three lots.` Replace the History paragraph with `\`prototype/\` preserves the original layout preview. Design decisions are recorded in \`docs/superpowers/specs/\`.`

- [ ] **Step 2: Update `docs/INSTALL.md`**

Change `0.2.0` to `0.3.0` everywhere (intro and the four `dist/` paths). Replace the intro sentence with:

```markdown
Version **0.3.0** looks up RIC and Price coin types from the American Numismatic Society's open OCRE and PELLA datasets and fetches recent hammer prices from acsearch with your own account. It contacts `numismatics.org` and `nomisma.org` when you select **Look up**, and `www.acsearch.info` when you select **Get prices**. Nothing else is contacted and nothing from acsearch is stored.
```

Under "Test in Brave" change the permission sentence to `Brave grants access to \`numismatics.org\`, \`nomisma.org\` and \`www.acsearch.info\` at install.`

Under "Test temporarily in Firefox" replace the permission paragraph with:

```markdown
The first time you select **Look up**, Firefox asks whether Giga Pinax may access `numismatics.org` and `nomisma.org`; the first time you select **Get prices**, it asks about `www.acsearch.info`. Allow each. If the popup closes while a prompt is open, reopen it and select the button again. If you decline, the popup explains what it needs and you can select the button again.
```

Replace the "What to try" list with:

```markdown
- **Price 23**, then **RIC I (2nd edition), Nero 306**.
- Select **Get prices**. If you are not signed in on acsearch, the popup says so with a sign-in link; sign in on acsearch's own website, then select **Get prices** again.
- Edit the acsearch search term (for example add the denomination) and select **Get prices** again; the term is remembered for that type.
- Expand **Inspect sales** to see each sale with a link to it on acsearch.
- A number that doesn't exist, such as **RIC I (2nd edition), Nero 9999999**: the popup says it was not found rather than inventing a result.
- **RIC I, Nero 306** with the edition left out of the volume field: a short "Did you mean" list offers the full reference to choose.
- Close and reopen the popup: your last reference, currency and terms are remembered locally.
```

- [ ] **Step 3: Update `install/index.html`**

Change `0.2.0` to `0.3.0` in the eyebrow and both ZIP hrefs. Replace the `<h1>` with `Types and hammer prices, in your toolbar.` and the intro paragraph with:

```html
    <p class="intro">Version 0.3.0 looks up RIC and Price coin types from the American Numismatic Society's open OCRE and PELLA datasets and fetches the 100 most recent matching sales from acsearch with your own account. Install it in Brave or try it temporarily in Firefox.</p>
```

Replace the Firefox permission note with `<p class="note"><strong>First use asks for access</strong> to numismatics.org, nomisma.org and www.acsearch.info. Allow each; if the popup closes, reopen it and select the button again.</p>`

Replace the try-it section's two paragraphs with:

```html
<p>Try <strong>Price 23</strong> or <strong>RIC I (2nd edition), Nero 306</strong>, then <strong>Get prices</strong>. Sign in on acsearch first if the popup asks you to.</p><p>Edit the acsearch search term to narrow the sales, and expand <strong>Inspect sales</strong> to open any of them on acsearch. Your choices stay in your browser.</p>
```

Replace the footer's first span with `<span>Prices from acsearch with your own account · Contacts numismatics.org, nomisma.org and acsearch.info only · Local preferences</span>`.

- [ ] **Step 4: Verify**

```bash
python scripts/build.py
node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors
git grep -n "0\.2\.0\|Prices not connected\|not connected yet\|permission request .* pending" -- README.md docs/INSTALL.md install/index.html extension manifests
```

Expected: all checks clean and the grep prints nothing. Controller opens `install/` in a served tab and confirms both ZIP links return 200 and there are no console errors.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/INSTALL.md install/index.html
git commit -m "Document acsearch prices in Giga Pinax 0.3.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification results

Task 5 Step 5, performed by the controller on 2026-09-10 in the in-app Chromium browser at a 400×600 viewport, against `extension/popup.html` served by `python -m http.server 8777` (a plain tab; `chrome.permissions` absent, so permission branches were not exercised; acsearch responses stubbed by wrapping `window.fetch` for `https://www.acsearch.info/` only, all other requests real):

1. Price 23 resolved; term pre-filled `Price 23`; acsearch link `…search.html?term=Price+23&category=1&currency=usd&order=1`. Real Get prices in a plain tab → CORS block → `Couldn’t reach acsearch. Check your connection and try again.`, button restored. Pass (the packaged extension's host permission lifts CORS; that path is for the user to confirm).
2. Real logged-out fixture → sign-in note with visible `Sign in ↗` to `https://www.acsearch.info/login.html`, no error, no panel; exactly one request, `credentials: "include"`. Pass.
3. Nine lots 90…450 across 2019–2021 plus one unsold → `$180`, `USD`, `9 sales · 2019–2021`, `$135–$245`, box left 12.5% width 30.56%, median marker 25%, 9 rows linking `search.html?id=…` with `noopener noreferrer`, fee note without the 100-sales sentence, announcement `Median $180 USD over 9 sales.` Pass.
4. 100 lots → `100 sales · 2016–2025` and the `Only the 100 most recent sales are counted.` sentence. Pass.
5. RIC I (2nd ed.) Nero 306 → term `Nero 306`; edited to `Nero 306 as`; one request with that term; stored `terms["ric.1(2).ner.306"] = "Nero 306 as"` alongside `price.23`; after reload and re-lookup the field restored `Nero 306 as`. Changing the reference hid the panel. Pass.
6. Currency → CHF hid the panel and the link carried `currency=chf`; CHF persisted across reload. Pass.
7. `body` and `documentElement` scrollWidth 400 with panel and open sales list; console clean apart from the expected CORS error in check 1. Pass.

Task 6 Step 4 served-page check: `http://localhost:8777/install/` shows `GIGA PINAX · VERSION 0.3.0` and `Types and hammer prices, in your toolbar.`; `HEAD` on `giga-pinax-brave-0.3.0.zip` and `giga-pinax-firefox-0.3.0.zip` returned 200; no stale 0.2.0 or "not connected" text; no popup-preview link; every `target="_blank"` link has `noopener`; no console messages. Pass.

Re-verification after the final-review fixes (`d2e030c`, `d2c14ae`), same setup: a whitespace-only term shows `Enter a search term for acsearch, such as “Nero 306”.` and sends nothing, storing no term; five Get prices clicks made exactly five requests, every one with `credentials: "include"` and `cache: "no-store"`; nine `… USD` prices plus one unsold give `$180`, `$135–$245` and `9 sales matching “Price 23” · 2019–2021 · 1 without a price`; `200 EUR`/`300 EUR` with USD selected give the "No hammer prices" note, announced; CHF shows `CHF 180` with the separate code label hidden and announces `Median CHF 180 over 9 sales.`; a single price draws the box at 50% with zero width; the real logged-out fixture gives the new sign-in note with its link, announced once (`#prices-note` has no role); `#price-term` is described by the error and note; 400 px with no overflow. Pass.

## Remaining for the user

- Reload in Brave, look up a type, select Get prices on your Premium account, and report whether numbers appear. If the panel reports no hammer prices although acsearch shows them, paste one lot's price text as acsearch displays it; the parser and a trimmed logged-in fixture get adjusted in a follow-up.
- Firefox temporary install: Get prices works without a prompt (access is granted at install); optionally turn acsearch access off in about:addons and confirm Get prices asks again.
