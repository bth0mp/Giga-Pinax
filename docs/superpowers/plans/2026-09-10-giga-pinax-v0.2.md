# Giga Pinax v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the extension to Giga Pinax and replace its two hard-coded fictional samples with real RIC/Price type lookup from the ANS open datasets (OCRE, PELLA), leaving prices deliberately unconnected.

**Architecture:** A new dependency-free `extension/lookup.js` holds pure functions (query building, Atom parsing, exact-match picking, JSON-LD → card, date formatting) plus two composing async functions that take an injectable `fetch`. `popup.js` only wires DOM to those. Preferences move to a tiny `preferences.js`. Sample mode, the welcome screen and all fictional prices are deleted; the price layout survives untouched in `prototype/`.

**Tech Stack:** Vanilla ES modules, Manifest V3, Node 22 built-in test runner (`node:test`), Python 3 stdlib packager, `web-ext` for lint only.

**Spec:** `docs/superpowers/specs/2026-09-10-giga-pinax-v0.2-design.md`

## Global Constraints

- No runtime dependencies, no bundler, no remote fonts/images. Node built-in test runner only.
- Never fabricate a result. Every error path shows one of the exact messages in the spec.
- No code may request, read or parse acsearch content. The only acsearch touchpoints are plain links.
- Names: manifest `name` `Giga Pinax`; `version` `0.2.0`; gecko id `giga-pinax@local.invalid`; ZIPs `giga-pinax-{browser}-{version}.zip`; storage keys `giga-pinax-preferences-v1` and `giga-pinax-labels-v1`.
- `host_permissions` exactly `["https://numismatics.org/*", "https://nomisma.org/*"]` in both manifests. No `permissions`, `content_scripts` or `background`.
- Firefox `data_collection_permissions.required` stays `["none"]`.
- One lookup deadline of 15 s via `AbortController`, shared by every request in the lookup.
- Test fixtures in `tests/fixtures/` are real responses captured 2026-09-10; do not hand-edit them.
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Working directory is `Z:\Ancient Coin Browser extension` on Windows; the shell is Git Bash. Quote paths.

## File Structure

| File | Responsibility |
|---|---|
| `extension/lookup.js` (new) | Everything between the form and numismatics.org/nomisma.org: `buildQuery`, `parseFeed`, `pickMatch`, `formatDates`, `toCard`, `nomismaSlugs`, `nomismaLabel`, `resolveLabels`, `lookupType`, `lookupById`, `HOST_ORIGINS`. |
| `extension/preferences.js` (new) | `restorePreferences`, `STORAGE_KEY`. Validation of localStorage input. |
| `extension/popup.js` (rewrite) | DOM wiring only. |
| `extension/popup.html` (rewrite) | Form, candidates list, result card, price placeholder. |
| `extension/popup.css` (rewrite) | Same visual system, sample/welcome styles removed, card styles added. |
| `extension/sample-data.js` | Deleted. |
| `manifests/brave.json`, `manifests/firefox.json` | Rename, version, host permissions. |
| `scripts/build.py` | Asset list and ZIP prefix. |
| `tests/lookup.test.mjs` (new), `tests/preferences.test.mjs` (new) | Unit tests against fixtures and a fake fetch. |
| `tests/sample-data.test.mjs` | Deleted. |
| `tests/test_packages.py` | Updated names, assets, permissions. |
| `tests/fixtures/*` | Already captured: `ocre-search-nero-306.xml`, `pella-search-price-23.xml`, `ocre-nero-306.jsonld`, `pella-price-23.jsonld`, `nomisma-nero.jsonld`, `nomisma-as.jsonld`. |
| `README.md`, `docs/INSTALL.md`, `install/index.html` | Rename and new copy. |

---

### Task 1: Query building, feed parsing and match picking

**Files:**
- Create: `extension/lookup.js`
- Test: `tests/lookup.test.mjs`

**Interfaces:**
- Produces: `buildQuery({catalogue, number, volume, section}) → {corpus: 'ocre'|'pella', query: string}`; `parseFeed(xml: string) → Array<{id, title}>`; `pickMatch(entries, query) → {status:'ok', entry} | {status:'candidates', candidates} | {status:'none'}`; `HOST_ORIGINS`, `TIMEOUT_MS`.

- [ ] **Step 1: Write the failing tests**

Create `tests/lookup.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildQuery, parseFeed, pickMatch } from '../extension/lookup.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('buildQuery targets the right corpus and normalises ordinal editions', () => {
  assert.deepEqual(buildQuery({ catalogue: 'Price', number: ' 23 ' }), { corpus: 'pella', query: 'Price 23' });
  assert.deepEqual(
    buildQuery({ catalogue: 'RIC', volume: 'I (2nd edition)', section: ' Nero', number: '306' }),
    { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' },
  );
  assert.equal(buildQuery({ catalogue: 'RIC', volume: 'II', section: 'Hadrian', number: '  12a ' }).query, 'RIC II Hadrian 12a');
  assert.equal(buildQuery({ catalogue: 'RIC', volume: 'I (1st edition)', section: 'Nero', number: '1' }).query, 'RIC I (first edition) Nero 1');
});

test('parseFeed lists entry ids and titles from real Atom feeds', () => {
  assert.deepEqual(parseFeed(fixture('ocre-search-nero-306.xml')), [
    { id: 'ric.1(2).ner.306', title: 'RIC I (second edition) Nero 306' },
  ]);
  assert.deepEqual(parseFeed(fixture('pella-search-price-23.xml')).map((entry) => entry.id), ['price.1655', 'price.23']);
  assert.deepEqual(parseFeed('<feed><entry><title>A &amp; B</title><id>x</id></entry></feed>'), [{ id: 'x', title: 'A & B' }]);
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<feed><entry><title>no id</title></entry></feed>'), []);
});

test('pickMatch prefers the exact title regardless of rank, else offers up to five candidates', () => {
  const pella = parseFeed(fixture('pella-search-price-23.xml'));
  assert.equal(pickMatch(pella, 'price 23').entry.id, 'price.23');
  assert.equal(pickMatch(pella, '  Price   23 ').status, 'ok');
  const near = [{ id: 'a', title: 'RIC II Hadrian 12a' }, { id: 'b', title: 'RIC II Hadrian 12b' }];
  assert.deepEqual(pickMatch(near, 'RIC II Hadrian 12'), { status: 'candidates', candidates: near });
  assert.deepEqual(pickMatch([], 'RIC II Hadrian 12'), { status: 'none' });
  const many = Array.from({ length: 6 }, (_, index) => ({ id: String(index), title: `T ${index}` }));
  assert.deepEqual(pickMatch(many, 'nothing'), { status: 'none' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/lookup.test.mjs`
Expected: failure — `Cannot find module '.../extension/lookup.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `extension/lookup.js`:

```js
export const HOST_ORIGINS = Object.freeze(['https://numismatics.org/*', 'https://nomisma.org/*']);
export const TIMEOUT_MS = 10000;

const ORDINALS = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth' };
const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const norm = (value) => squash(value).toLowerCase();

export function buildQuery({ catalogue, number, volume, section }) {
  if (catalogue === 'RIC') {
    const edition = squash(volume).replace(/\b(1st|2nd|3rd|4th)\b/gi, (match) => ORDINALS[match.toLowerCase()]);
    return { corpus: 'ocre', query: squash(`RIC ${edition} ${squash(section)} ${squash(number)}`) };
  }
  return { corpus: 'pella', query: squash(`Price ${squash(number)}`) };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]);

// ponytail: regex over a fixed-shape Atom feed; switch to DOMParser if entries ever nest.
export function parseFeed(xml) {
  const entries = [];
  for (const [, body] of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const title = body.match(/<title>([^<]*)<\/title>/)?.[1];
    const id = body.match(/<id>([^<]*)<\/id>/)?.[1];
    if (title && id) entries.push({ id: unescape(id), title: unescape(title) });
  }
  return entries;
}

export function pickMatch(entries, query) {
  const wanted = norm(query);
  const exact = entries.find((entry) => norm(entry.title) === wanted);
  if (exact) return { status: 'ok', entry: exact };
  if (entries.length >= 1 && entries.length <= 5) return { status: 'candidates', candidates: entries };
  return { status: 'none' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/lookup.test.mjs`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extension/lookup.js tests/lookup.test.mjs tests/fixtures
git commit -m "Add lookup query building, Atom parsing and exact-match picking

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: JSON-LD to result card, dates and nomisma labels

**Files:**
- Modify: `extension/lookup.js` (append)
- Test: `tests/lookup.test.mjs` (append)

**Interfaces:**
- Produces: `formatDates(start, end) → string|null`; `toCard(jsonld, corpus, labels = {}) → Card|null` where `Card = {id, uri, corpus, label, authority, denomination, mint, material, dates, obverse:{legend, description}, reverse:{legend, description}}` (every value string or null except `id`, `uri`, `corpus`, `label`); `nomismaSlugs(jsonld) → string[]`; `nomismaLabel(jsonld, slug) → string|null`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lookup.test.mjs`, and extend the import line to
`import { buildQuery, parseFeed, pickMatch, formatDates, toCard, nomismaSlugs, nomismaLabel } from '../extension/lookup.js';`
and add `const json = (name) => JSON.parse(fixture(name));` under `fixture`.

```js
test('formatDates renders BC, AD, mixed and single years', () => {
  assert.equal(formatDates('0062', '0068'), 'AD 62–68');
  assert.equal(formatDates('-0336', '-0323'), '336–323 BC');
  assert.equal(formatDates('-0027', '0014'), '27 BC–AD 14');
  assert.equal(formatDates('0068', '0068'), 'AD 68');
  assert.equal(formatDates('-0323', undefined), '323 BC');
  assert.equal(formatDates(undefined, undefined), null);
});

test('toCard reads an OCRE record and substitutes nomisma labels', () => {
  const card = toCard(json('ocre-nero-306.jsonld'), 'ocre', { nero: 'Nero', as: 'As', rome: 'Rome', ae: 'Bronze' });
  assert.equal(card.id, 'ric.1(2).ner.306');
  assert.equal(card.uri, 'http://numismatics.org/ocre/id/ric.1(2).ner.306');
  assert.equal(card.corpus, 'ocre');
  assert.equal(card.label, 'RIC I (second edition) Nero 306');
  assert.deepEqual(
    [card.authority, card.denomination, card.mint, card.material, card.dates],
    ['Nero', 'As', 'Rome', 'Bronze', 'AD 62–68'],
  );
  assert.deepEqual(card.obverse, { legend: 'NERO CAESAR AVG GERM IMP', description: 'Head of Nero, laureate, right' });
  assert.equal(card.reverse.legend, 'PACE P R VBIQ PARTA IANVM CLVSIT S C');
});

test('toCard tolerates missing mint, legend and labels, preferring English text', () => {
  const card = toCard(json('pella-price-23.jsonld'), 'pella', {});
  assert.equal(card.mint, null);
  assert.equal(card.authority, 'alexander_iii');
  assert.equal(card.obverse.legend, null);
  assert.equal(card.obverse.description, 'Head of beardless Heracles right wearing lion skin headdress');
  assert.equal(card.reverse.legend, 'ΑΛΕΞΑΝΔΡΟΥ');
  assert.equal(card.dates, '336–323 BC');
  assert.equal(toCard({}, 'pella'), null);
  assert.equal(toCard(null, 'pella'), null);
});

test('nomismaSlugs lists referenced concepts in display order; nomismaLabel reads the English label', () => {
  assert.deepEqual(nomismaSlugs(json('ocre-nero-306.jsonld')), ['nero', 'as', 'rome', 'ae']);
  assert.deepEqual(nomismaSlugs(json('pella-price-23.jsonld')), ['alexander_iii', 'tetradrachm', 'ar']);
  assert.deepEqual(nomismaSlugs({}), []);
  assert.equal(nomismaLabel(json('nomisma-nero.jsonld'), 'nero'), 'Nero');
  assert.equal(nomismaLabel(json('nomisma-as.jsonld'), 'as'), 'As');
  assert.equal(nomismaLabel({}, 'nero'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/lookup.test.mjs`
Expected: SyntaxError — `formatDates` (and others) not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `extension/lookup.js`:

```js
const NOMISMA = 'https://nomisma.org/id/';
const NAMED_FIELDS = ['nmo:hasAuthority', 'nmo:hasDenomination', 'nmo:hasMint', 'nmo:hasMaterial'];

const graphOf = (jsonld) => (Array.isArray(jsonld?.['@graph']) ? jsonld['@graph'] : []);
const mainNode = (jsonld) => graphOf(jsonld).find((node) => typeof node['@id'] === 'string' && !node['@id'].includes('#')) ?? null;
const slugOf = (node) => (typeof node?.['@id'] === 'string' ? node['@id'].split('/').pop() : null);

function english(values) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const hit = list.find((value) => value?.['@language'] === 'en') ?? list[0];
  return typeof hit?.['@value'] === 'string' ? hit['@value'] : null;
}

export function formatDates(start, end) {
  const years = [start, end].map((year) => Number.parseInt(year, 10)).filter(Number.isFinite);
  if (years.length === 0) return null;
  const [a, b] = years.length === 1 ? [years[0], years[0]] : years;
  const era = (year) => (year < 0 ? `${-year} BC` : `AD ${year}`);
  if (a === b) return era(a);
  if (a < 0 && b < 0) return `${-a}–${-b} BC`;
  if (a > 0 && b > 0) return `AD ${a}–${b}`;
  return `${era(a)}–${era(b)}`;
}

export function nomismaSlugs(jsonld) {
  const main = mainNode(jsonld);
  return NAMED_FIELDS.map((field) => slugOf(main?.[field]?.[0])).filter(Boolean);
}

export function nomismaLabel(jsonld, slug) {
  const node = graphOf(jsonld).find((entry) => entry['@id'] === `nm:${slug}` || entry['@id'] === `${NOMISMA}${slug}` || entry['@id'] === `http://nomisma.org/id/${slug}`);
  return english(node?.['skos:prefLabel']);
}

export function toCard(jsonld, corpus, labels = {}) {
  const main = mainNode(jsonld);
  if (!main) return null;
  const uri = main['@id'];
  const id = uri.split('/').pop();
  const side = (name) => {
    const node = graphOf(jsonld).find((entry) => entry['@id'] === `${uri}#${name}`) ?? {};
    return { legend: english(node['nmo:hasLegend']), description: english(node['dcterms:description']) };
  };
  const named = (field) => {
    const slug = slugOf(main[field]?.[0]);
    return slug ? labels[slug] ?? slug : null;
  };
  return {
    id,
    uri,
    corpus,
    label: english(main['skos:prefLabel']) ?? id,
    authority: named('nmo:hasAuthority'),
    denomination: named('nmo:hasDenomination'),
    mint: named('nmo:hasMint'),
    material: named('nmo:hasMaterial'),
    dates: formatDates(main['nmo:hasStartDate']?.[0]?.['@value'], main['nmo:hasEndDate']?.[0]?.['@value']),
    obverse: side('obverse'),
    reverse: side('reverse'),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/lookup.test.mjs`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extension/lookup.js tests/lookup.test.mjs
git commit -m "Map OCRE/PELLA JSON-LD to a result card with nomisma labels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Composed lookup with fetch, timeout and label cache

**Files:**
- Modify: `extension/lookup.js` (append)
- Test: `tests/lookup.test.mjs` (append)

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces: `lookupType(reference, {fetchImpl?, cache?, timeoutMs?}) → Promise<{status:'ok', card} | {status:'candidates', candidates, corpus, query} | {status:'none', corpus, query} | {status:'network'}>`; `lookupById(corpus, id, {fetchImpl?, cache?, timeoutMs?}) → Promise<{status:'ok', card} | {status:'network'}>`; `resolveLabels(slugs, {fetchImpl, cache, signal}) → Promise<Record<slug,label>>`. `cache` is any object with `get(slug)` and `set(slug, label)` (a `Map` works).

- [ ] **Step 1: Write the failing tests**

Extend the import line with `lookupType, lookupById`. Append:

```js
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, { signal } = {}) => {
    calls.push(url);
    if (signal?.aborted) throw new Error('aborted');
    const hit = Object.entries(routes).find(([needle]) => url.includes(needle));
    if (!hit) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    return { ok: true, status: 200, text: async () => hit[1], json: async () => JSON.parse(hit[1]) };
  };
  impl.calls = calls;
  return impl;
}

test('lookupType resolves an exact RIC match into a labelled card and caches labels', async () => {
  const fetchImpl = fakeFetch({
    'ocre/apis/search': fixture('ocre-search-nero-306.xml'),
    'ocre/id/ric.1(2).ner.306.jsonld': fixture('ocre-nero-306.jsonld'),
    'nomisma.org/id/nero.jsonld': fixture('nomisma-nero.jsonld'),
    'nomisma.org/id/as.jsonld': fixture('nomisma-as.jsonld'),
  });
  const cache = new Map([['rome', 'Rome']]);
  const result = await lookupType({ catalogue: 'RIC', volume: 'I (2nd edition)', section: 'Nero', number: '306' }, { fetchImpl, cache });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.authority, 'Nero');
  assert.equal(result.card.denomination, 'As');
  assert.equal(result.card.mint, 'Rome');
  assert.equal(result.card.material, 'ae');
  assert.equal(cache.get('nero'), 'Nero');
  assert.ok(fetchImpl.calls[0].endsWith('/ocre/apis/search?q=RIC%20I%20(second%20edition)%20Nero%20306'));
  assert.ok(fetchImpl.calls[0].startsWith('https://numismatics.org/'));
  assert.ok(!fetchImpl.calls.some((url) => url.includes('rome.jsonld')));
});

test('lookupType reports candidates, none, network and timeout outcomes', async () => {
  const pella = fakeFetch({ 'pella/apis/search': fixture('pella-search-price-23.xml') });
  const near = await lookupType({ catalogue: 'Price', number: '2' }, { fetchImpl: pella });
  assert.equal(near.status, 'candidates');
  assert.equal(near.corpus, 'pella');
  assert.equal(near.query, 'Price 2');
  assert.equal(near.candidates.length, 2);

  const empty = fakeFetch({ 'pella/apis/search': '<feed></feed>' });
  assert.deepEqual(await lookupType({ catalogue: 'Price', number: '23000' }, { fetchImpl: empty }), { status: 'none', corpus: 'pella', query: 'Price 23000' });

  assert.deepEqual(await lookupType({ catalogue: 'Price', number: '23' }, { fetchImpl: fakeFetch({}) }), { status: 'network' });

  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  assert.deepEqual(await lookupType({ catalogue: 'Price', number: '23' }, { fetchImpl: hang, timeoutMs: 20 }), { status: 'network' });
});

test('lookupById fetches one record directly', async () => {
  const fetchImpl = fakeFetch({ 'pella/id/price.23.jsonld': fixture('pella-price-23.jsonld') });
  const result = await lookupById('pella', 'price.23', { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.label, 'Price 23');
  assert.equal(result.card.denomination, 'tetradrachm');
  assert.deepEqual(await lookupById('pella', 'price.23', { fetchImpl: fakeFetch({}) }), { status: 'network' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/lookup.test.mjs`
Expected: SyntaxError — `lookupType` not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `extension/lookup.js`:

```js
const ORIGIN = 'https://numismatics.org';

async function getText(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function getJson(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/ld+json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export async function resolveLabels(slugs, { fetchImpl, cache, signal }) {
  const labels = {};
  await Promise.all(slugs.map(async (slug) => {
    const cached = cache.get(slug);
    if (cached) { labels[slug] = cached; return; }
    try {
      const label = nomismaLabel(await getJson(`${NOMISMA}${slug}.jsonld`, fetchImpl, signal), slug);
      if (label) { labels[slug] = label; cache.set(slug, label); }
    } catch { /* unlabelled concepts fall back to their slug */ }
  }));
  return labels;
}

export async function lookupById(corpus, id, options = {}) {
  const { fetchImpl = fetch, cache = new Map(), timeoutMs = TIMEOUT_MS } = options;
  const timer = withTimeout(timeoutMs);
  try {
    const jsonld = await getJson(`${ORIGIN}/${corpus}/id/${id}.jsonld`, fetchImpl, timer.signal);
    const labels = await resolveLabels(nomismaSlugs(jsonld), { fetchImpl, cache, signal: timer.signal });
    const card = toCard(jsonld, corpus, labels);
    return card ? { status: 'ok', card } : { status: 'network' };
  } catch {
    return { status: 'network' };
  } finally {
    timer.done();
  }
}

export async function lookupType(reference, options = {}) {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;
  const { corpus, query } = buildQuery(reference);
  const timer = withTimeout(timeoutMs);
  let picked;
  try {
    const xml = await getText(`${ORIGIN}/${corpus}/apis/search?q=${encodeURIComponent(query)}`, fetchImpl, timer.signal);
    picked = pickMatch(parseFeed(xml), query);
  } catch {
    return { status: 'network' };
  } finally {
    timer.done();
  }
  if (picked.status !== 'ok') return { ...picked, corpus, query };
  return lookupById(corpus, picked.entry.id, options);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/lookup.test.mjs`
Expected: `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extension/lookup.js tests/lookup.test.mjs
git commit -m "Compose type lookup over fetch with timeout and label cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Preferences module

**Files:**
- Create: `extension/preferences.js`
- Test: `tests/preferences.test.mjs`

**Interfaces:**
- Produces: `restorePreferences(raw: string|null|undefined) → {currency, catalogue, number, volume, section}`; `STORAGE_KEY = 'giga-pinax-preferences-v1'`; `CURRENCIES = ['USD','EUR','GBP']`.

- [ ] **Step 1: Write the failing tests**

Create `tests/preferences.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { restorePreferences, STORAGE_KEY, CURRENCIES } from '../extension/preferences.js';

const defaults = { currency: 'USD', catalogue: 'Price', number: '23', volume: 'I (2nd edition)', section: 'Nero' };

test('corrupt or missing preferences fall back to Price 23 in USD', () => {
  for (const raw of [null, undefined, '', 'broken', 'null', '7', '[]']) {
    assert.deepEqual(restorePreferences(raw), defaults);
  }
});

test('saved preferences are constrained, trimmed to 120 characters and stripped of unknown keys', () => {
  const saved = restorePreferences(JSON.stringify({ currency: 'EUR', catalogue: 'RIC', number: '306A', volume: 'I (2nd edition)', section: 'Nero', sampleMode: true }));
  assert.deepEqual(saved, { currency: 'EUR', catalogue: 'RIC', number: '306A', volume: 'I (2nd edition)', section: 'Nero' });
  const invalid = restorePreferences(JSON.stringify({ currency: 'BTC', catalogue: 'RPC', number: {}, volume: 'x'.repeat(200) }));
  assert.equal(invalid.currency, 'USD');
  assert.equal(invalid.catalogue, 'Price');
  assert.equal(invalid.number, '23');
  assert.equal(invalid.volume.length, 120);
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'RIC' })).number, '306');
  assert.equal(STORAGE_KEY, 'giga-pinax-preferences-v1');
  assert.deepEqual([...CURRENCIES], ['USD', 'EUR', 'GBP']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/preferences.test.mjs`
Expected: `Cannot find module '.../extension/preferences.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `extension/preferences.js`:

```js
export const STORAGE_KEY = 'giga-pinax-preferences-v1';
export const CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP']);

const text = (value, fallback) => (typeof value === 'string' ? value.slice(0, 120) : fallback);

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
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/preferences.test.mjs`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add extension/preferences.js tests/preferences.test.mjs
git commit -m "Move preference validation into its own module

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Rename, host permissions and packaging

**Files:**
- Modify: `manifests/brave.json`, `manifests/firefox.json`, `scripts/build.py:22-33`, `scripts/build.py:109`, `scripts/build.py:128`, `scripts/build.py:138`
- Delete: `extension/sample-data.js`, `tests/sample-data.test.mjs`
- Test: `tests/test_packages.py`

**Interfaces:**
- Produces: packaged assets `popup.html, popup.css, popup.js, lookup.js, preferences.js, icon.svg, icons/*` and ZIPs `dist/giga-pinax-{brave,firefox}-0.2.0.zip`.

Note: after this task `extension/popup.js` still imports the deleted `sample-data.js`. Nothing automated loads it; Task 6 rewrites it.

- [ ] **Step 1: Update the package tests to the new contract**

In `tests/test_packages.py`:

Replace the `ASSETS` set (lines 16–26) with:

```python
ASSETS = {
    "popup.html",
    "popup.css",
    "popup.js",
    "lookup.js",
    "preferences.js",
    "icon.svg",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
}
HOST_PERMISSIONS = ["https://numismatics.org/*", "https://nomisma.org/*"]
```

In `test_manifests_expose_only_the_popup_and_existing_icons` replace the three assertions on name/version/description with:

```python
                self.assertEqual("Giga Pinax", manifest["name"])
                self.assertEqual("0.2.0", manifest["version"])
                self.assertIn("RIC", manifest["description"])
                self.assertNotIn("sample", manifest["description"].lower())
```

Replace `test_manifests_request_no_browser_or_host_permissions` entirely with:

```python
    def test_manifests_request_only_type_data_hosts(self) -> None:
        for browser in ("brave", "firefox"):
            with self.subTest(browser=browser):
                manifest = self.load_manifest(browser)
                self.assertEqual(HOST_PERMISSIONS, manifest["host_permissions"])
                for key in ("permissions", "optional_permissions", "optional_host_permissions", "content_scripts", "background"):
                    self.assertNotIn(key, manifest)
```

Add to `test_firefox_declares_identity_and_no_data_collection`, after the regex assertion:

```python
        self.assertEqual("giga-pinax@local.invalid", gecko["id"])
```

Replace every `coin-lookup-{browser}-0.1.1.zip` with `giga-pinax-{browser}-0.2.0.zip` (one place, line 97) and both `DIST.glob("coin-lookup-*.zip")` with `DIST.glob("giga-pinax-*.zip")` (lines 131 and 138).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m unittest discover -s tests -p 'test_*.py' -v`
Expected: failures on name, version, host_permissions, gecko id, ZIP names and asset list.

- [ ] **Step 3: Update the manifests**

Write `manifests/brave.json`:

```json
{
  "manifest_version": 3,
  "name": "Giga Pinax",
  "version": "0.2.0",
  "description": "Look up ancient coin types by RIC or Price reference using open numismatic data.",
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    }
  },
  "host_permissions": [
    "https://numismatics.org/*",
    "https://nomisma.org/*"
  ]
}
```

Write `manifests/firefox.json`:

```json
{
  "manifest_version": 3,
  "name": "Giga Pinax",
  "version": "0.2.0",
  "description": "Look up ancient coin types by RIC or Price reference using open numismatic data.",
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    }
  },
  "host_permissions": [
    "https://numismatics.org/*",
    "https://nomisma.org/*"
  ],
  "browser_specific_settings": {
    "gecko": {
      "id": "giga-pinax@local.invalid",
      "strict_min_version": "142.0",
      "data_collection_permissions": {
        "required": [
          "none"
        ]
      }
    }
  }
}
```

- [ ] **Step 4: Update the builder and delete the sample module**

In `scripts/build.py` replace `ASSET_PATHS` (lines 23–33) with:

```python
ASSET_PATHS = (
    "popup.html",
    "popup.css",
    "popup.js",
    "lookup.js",
    "preferences.js",
    "icon.svg",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
)
```

Change line 109 to `staged_zip = stage_root / f"giga-pinax-{browser}-{version}.zip"`, line 128 to `prefix=".giga-pinax-build-"`, and line 138 to `destination_zip = output_root / f"giga-pinax-{browser}-{version}.zip"`.

Then:

```bash
git rm -q extension/sample-data.js tests/sample-data.test.mjs
rm -f dist/coin-lookup-*.zip
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m unittest discover -s tests -p 'test_*.py' -v`
Expected: `Ran 6 tests`, `OK`. `dist/` now contains `giga-pinax-brave-0.2.0.zip` and `giga-pinax-firefox-0.2.0.zip`.

- [ ] **Step 6: Commit**

```bash
git add manifests scripts/build.py tests/test_packages.py
git commit -m "Rename packages to Giga Pinax 0.2.0 and declare type-data host permissions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Popup rewrite and browser verification

**Files:**
- Rewrite: `extension/popup.html`, `extension/popup.css`, `extension/popup.js`

**Interfaces:**
- Consumes: `lookupType`, `lookupById`, `HOST_ORIGINS` from `lookup.js`; `restorePreferences`, `STORAGE_KEY` from `preferences.js`.

- [ ] **Step 1: Write `extension/popup.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Giga Pinax</title>
  <link rel="icon" href="icons/icon-32.png">
  <link rel="stylesheet" href="popup.css">
  <script src="popup.js" type="module"></script>
</head>
<body>
  <main class="popup">
    <header class="popup-header">
      <img class="brand-icon" src="icons/icon-48.png" width="34" height="34" alt="">
      <div><h1>Giga Pinax</h1><p>Ancient coin reference</p></div>
    </header>
    <div class="popup-scroll">
      <form id="reference-form" class="reference-form">
        <div class="catalogue-row">
          <div><label for="catalogue">Catalogue</label><select id="catalogue" name="catalogue"><option value="Price">Price</option><option value="RIC">RIC</option></select></div>
          <div><label for="currency">Currency</label><select id="currency" name="currency"><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></div>
        </div>
        <div id="ric-fields" class="ric-fields" hidden>
          <div><label for="ric-volume">Volume / edition</label><input id="ric-volume" name="volume" maxlength="120" autocomplete="off"></div>
          <div><label for="ric-section">Ruler or mint section</label><input id="ric-section" name="section" maxlength="120" autocomplete="off"></div>
        </div>
        <label id="reference-label" for="reference-number">Price number</label>
        <div class="search-row"><input id="reference-number" name="reference" required maxlength="120" autocomplete="off" spellcheck="false" aria-describedby="reference-help form-error"><button id="lookup-button" class="primary-button" type="submit"><svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><span id="lookup-label">Look up</span></button></div>
        <p id="reference-help" class="field-hint">Example: Price 23</p>
        <p id="form-error" class="form-error" role="alert" hidden></p>
        <div id="candidates" class="candidates" hidden><p class="field-hint">Did you mean:</p><ul id="candidate-list" class="candidate-list"></ul></div>
      </form>
      <section id="result" class="result" aria-labelledby="result-reference" hidden>
        <div class="type-heading"><div><h2 class="catalogue-code" id="result-reference"></h2><p id="result-summary"></p></div><a id="type-link" class="type-link" href="https://numismatics.org/" target="_blank" rel="noopener noreferrer">Type <span aria-hidden="true">↗</span></a></div>
        <dl class="sides">
          <div><dt>Obverse</dt><dd><span id="obverse-legend" class="legend"></span><span id="obverse-description"></span></dd></div>
          <div><dt>Reverse</dt><dd><span id="reverse-legend" class="legend"></span><span id="reverse-description"></span></dd></div>
        </dl>
        <div class="range-block"><div><p class="metric-label">Prices</p><p class="price-pending">Prices not connected yet. Use “Search on acsearch” to view sales with your own account.</p></div></div>
        <a id="acsearch-link" class="primary-button acsearch-button" href="https://www.acsearch.info/" target="_blank" rel="noopener noreferrer">Search on acsearch <span aria-hidden="true">↗</span></a>
      </section>
      <p id="lookup-prompt" class="lookup-prompt" hidden>Reference changed. Select “Look up” to check it.</p>
      <p id="storage-note" class="storage-note" role="status" hidden>Preferences couldn’t be saved. This popup still works, but your choices may reset when reopened.</p>
      <noscript><p class="storage-note">Giga Pinax needs JavaScript to look up references.</p></noscript>
    </div>
    <footer class="popup-footer"><span>Type data: ANS OCRE &amp; PELLA (ODbL)</span><a href="https://www.acsearch.info/" target="_blank" rel="noopener noreferrer" aria-label="Open acsearch in a new tab">acsearch <span aria-hidden="true">↗</span></a></footer>
    <div id="announcement" class="sr-only" role="status" aria-live="polite"></div>
  </main>
</body>
</html>
```

- [ ] **Step 2: Write `extension/popup.css`**

```css
:root {
  color-scheme: light dark;
  --surface:#ffffff; --soft:#f3f6f7; --ink:#142a33; --muted:#526a74;
  --border:#d4dee2; --accent:#244c5a; --on-accent:#ffffff; --accent-soft:#e7f0f3;
  --focus:#23769a; --error:#ad2d38;
  font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,Arial,sans-serif;
  color:var(--ink); background:var(--surface); font-synthesis:none;
}
@media (prefers-color-scheme:dark) {
  :root { --surface:#172730; --soft:#1d303a; --ink:#e4eef1; --muted:#a4bbc4;
    --border:#3a535e; --accent:#a0cedc; --on-accent:#142a33; --accent-soft:#243d48;
    --focus:#a0cedc; --error:#ffafb6; }
}
* {box-sizing:border-box;}
[hidden] {display:none !important;}
html,body {margin:0; padding:0;}
/* Popup autosizing starts narrow; a viewport-based cap prevents it from growing. */
body {width:400px;}
button,input,select {font:inherit;}
button,select {cursor:pointer;}
a {color:var(--accent); text-underline-offset:3px;}
p,h1,h2 {margin:0;}
:focus-visible {outline:3px solid var(--focus); outline-offset:2px;}
button:hover,a:hover {filter:brightness(.92);}
.popup {width:100%; max-height:600px; display:flex; flex-direction:column; overflow:hidden;}
.popup-header {display:flex; align-items:center; gap:10px; padding:14px 20px; flex-shrink:0;}
.brand-icon {border-radius:8px; flex-shrink:0;}
h1 {font-size:15px; line-height:1.25; font-weight:650; letter-spacing:-.02em;}
.popup-header p {font-size:11px; margin-top:3px; color:var(--muted);}
.text-button {border:0; background:transparent; color:var(--accent); font-weight:600; font-size:12px; padding:12px;}
.popup-scroll {overflow-y:auto; scrollbar-width:thin; scrollbar-color:var(--border) transparent; min-height:0;}
.reference-form {padding:12px 20px; border-bottom:1px solid var(--border);}
label {display:block; font-size:12px; font-weight:600; margin-bottom:5px;}
select,input {width:100%; height:38px; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--ink); padding:0 10px; min-width:0; font-size:13px;}
.catalogue-row {display:grid; grid-template-columns:1fr 91px; gap:12px; margin-bottom:10px;}
.catalogue-row select {font-weight:600;}
.search-row {display:grid; grid-template-columns:minmax(60px,1fr) auto; gap:9px;}
.search-row input {height:42px; font-size:15px; font-weight:600; font-family:Consolas,"Liberation Mono",monospace;}
.primary-button {display:inline-flex; justify-content:center; align-items:center; gap:8px; min-height:42px; padding:0 14px; background:var(--accent); color:var(--on-accent); border:1px solid transparent; border-radius:7px; font-size:12px; font-weight:650; text-decoration:none;}
.primary-button svg {width:16px; height:16px; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; fill:none;}
.primary-button[disabled] {opacity:.6; cursor:progress;}
.field-hint {font-size:11px; line-height:1.4; color:var(--muted); margin-top:6px;}
.ric-fields {display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;}
.ric-fields input {font-size:12px;}
.ric-fields label {font-size:11px;}
.form-error {color:var(--error); font-size:12px; line-height:1.5; padding-top:9px;}
.candidates {padding-top:6px;}
.candidate-list {list-style:none; margin:0; padding:0;}
.candidate-list .text-button {display:block; width:100%; text-align:left; padding:8px 0; border-top:1px solid var(--border);}
.result {padding:12px 20px;}
.type-heading {display:flex; align-items:flex-start; gap:10px;}
.catalogue-code {font-family:Consolas,"Liberation Mono",monospace; letter-spacing:.03em; font-size:12px; line-height:1.3; font-weight:700; color:var(--accent); overflow-wrap:anywhere;}
.type-heading p {font-size:11px; line-height:1.3; color:var(--muted); margin-top:4px;}
.type-link {margin-left:auto; text-decoration:none; font-size:12px; white-space:nowrap; padding:4px 0 8px 8px;}
.sides {margin:12px 0 0; display:grid; gap:10px;}
.sides div {display:grid; grid-template-columns:62px 1fr; gap:8px; font-size:12px; line-height:1.45;}
.sides dt {color:var(--muted); font-weight:600;}
.sides dd {margin:0; display:grid; gap:2px; min-width:0;}
.legend {font-family:Consolas,"Liberation Mono",monospace; font-size:11px; letter-spacing:.03em; color:var(--accent); overflow-wrap:anywhere;}
.metric-label {font-size:12px; color:var(--muted);}
.range-block {background:var(--soft); border:1px solid var(--border); border-radius:8px; margin-top:12px; padding:8px 12px;}
.price-pending {font-size:12px; line-height:1.5; margin-top:3px;}
.acsearch-button {margin-top:10px; width:100%;}
.popup-footer {padding:8px 20px; min-height:40px; font-size:11px; color:var(--muted); border-top:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:8px; flex-shrink:0; background:var(--soft);}
.popup-footer a {text-decoration:none; padding:4px 0;}
.lookup-prompt,.storage-note {font-size:12px; line-height:1.5; padding:15px 20px; color:var(--muted);}
.storage-note {color:var(--error);}
.sr-only {position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0;}
@media (max-width:359px) {
  .popup-header,.reference-form,.result,.popup-footer {padding-left:13px; padding-right:13px;}
  .primary-button {padding:0 10px;}
}
```

- [ ] **Step 3: Write `extension/popup.js`**

```js
import { HOST_ORIGINS, lookupById, lookupType } from './lookup.js';
import { STORAGE_KEY, restorePreferences } from './preferences.js';

const $ = (id) => document.getElementById(id);
const api = globalThis.browser ?? globalThis.chrome;
const LABELS_KEY = 'giga-pinax-labels-v1';
const NETWORK_MESSAGE = 'Couldn’t reach numismatics.org. Check your connection and try again.';
const PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it.';

let rawPreferences = null;
try { rawPreferences = localStorage.getItem(STORAGE_KEY); }
catch { $('storage-note').hidden = false; }
let preferences = restorePreferences(rawPreferences);
let requestId = 0;

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

function clearOutput() {
  $('form-error').hidden = true;
  $('candidates').hidden = true;
  $('result').hidden = true;
  $('lookup-prompt').hidden = true;
  $('reference-number').removeAttribute('aria-invalid');
  $('announcement').textContent = '';
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

function renderCard(card) {
  $('result-reference').textContent = card.label;
  $('result-summary').textContent = [card.authority, card.denomination, card.mint, card.material, card.dates].filter(Boolean).join(' · ');
  $('type-link').href = card.uri.replace(/^http:/, 'https:');
  $('type-link').setAttribute('aria-label', `View ${card.label} on numismatics.org, opens a new tab`);
  for (const side of ['obverse', 'reverse']) {
    $(`${side}-legend`).textContent = card[side].legend ?? '';
    $(`${side}-legend`).hidden = !card[side].legend;
    $(`${side}-description`).textContent = card[side].description ?? '—';
  }
  $('acsearch-link').href = `https://www.acsearch.info/search.html?term=${encodeURIComponent(card.label)}`;
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

async function run(perform) {
  const id = ++requestId;
  clearOutput();
  setBusy(true);
  let outcome;
  try { outcome = await perform(); }
  finally { if (id === requestId) setBusy(false); }
  if (id !== requestId) return;
  if (outcome.status === 'ok') renderCard(outcome.card);
  else if (outcome.status === 'candidates') renderCandidates(outcome.candidates, outcome.corpus);
  else if (outcome.status === 'none') showError(`No ${outcome.query} found in ${outcome.corpus === 'ocre' ? 'OCRE' : 'PELLA'}. Check the volume, edition and number.`);
  else showError(NETWORK_MESSAGE);
}

// Firefox MV3 grants host permissions lazily; request() is a no-op where already granted.
async function ensureHostAccess() {
  if (!api?.permissions?.request) return true;
  try { return await api.permissions.request({ origins: [...HOST_ORIGINS] }); }
  catch { return false; }
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
  if (!(await ensureHostAccess())) { clearOutput(); showError(PERMISSION_MESSAGE); return; }
  run(() => lookupType(currentReference(), { cache: labelCache }));
});
```

- [ ] **Step 4: Run every automated check**

```bash
node --test tests/lookup.test.mjs tests/preferences.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
python scripts/build.py
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors
```

Expected: `# pass 12`; `OK`; four dist paths printed; lint `0 errors, 0 warnings`.

- [ ] **Step 5: Verify in a served tab**

numismatics.org and nomisma.org send `Access-Control-Allow-Origin: *`, so the packaged popup works in an ordinary tab.

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/dist/brave/popup.html` in the browser tool and confirm each:

1. Default state shows Price 23; "Look up" renders `Price 23`, summary `Alexander III of Macedon · Tetradrachm · Silver · 336–323 BC`, obverse description, reverse legend `ΑΛΕΞΑΝΔΡΟΥ`, Type link to `https://numismatics.org/pella/id/price.23`, acsearch link containing `term=Price%2023`.
2. Switch to RIC: fields appear with `I (2nd edition)` / `Nero` / `306`; "Look up" renders `RIC I (second edition) Nero 306`, summary `Nero · As · Rome · Bronze · AD 62–68`, both legends.
3. Change number to `9999999`, "Look up": red error `No RIC I (second edition) Nero 9999999 found in OCRE. Check the volume, edition and number.` and no result card.
4. Price number `2`: "Did you mean:" list with two candidates; choosing `Price 23` renders the card.
5. Reload the page: RIC fields and last reference are restored; the label cache key `giga-pinax-labels-v1` exists in localStorage with `nero`, `as`, `rome`, `ae`.
6. Read console: no errors or warnings.
7. No horizontal overflow: `document.documentElement.scrollWidth === 400`.

Record the results in the plan's verification section below. Stop the server afterwards.

- [ ] **Step 6: Commit**

```bash
git add extension/popup.html extension/popup.css extension/popup.js
git commit -m "Rewrite popup around live RIC/Price type lookup

Removes sample mode, fictional prices and the welcome screen; adds
candidate picking, a price placeholder and a manual acsearch link.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Documentation and delivery page

**Files:**
- Rewrite: `README.md`, `docs/INSTALL.md`, `install/index.html`

- [ ] **Step 1: Write `README.md`**

```markdown
# Giga Pinax

A toolbar extension for desktop Brave and Firefox that looks up ancient coin types by catalogue reference. Version **0.2.0** resolves RIC references through [OCRE](https://numismatics.org/ocre/) and Price references through [PELLA](https://numismatics.org/pella/), open datasets from the American Numismatic Society published under the Open Database License.

Auction prices are not connected. acsearch's terms do not permit automated retrieval, and a permission request describing this extension's one-lookup-per-collector workflow is pending. Each result links to the type page and to a manual acsearch search you run with your own account.

## Install

Run `python scripts/build.py` to create `dist/brave`, `dist/firefox` and the matching ZIPs, then follow [the installation guide](docs/INSTALL.md). The local `install/index.html` page provides downloads and step-by-step instructions when the project root is served with `python -m http.server 8765 --bind 127.0.0.1`.

## What it does

- Guided entry for Price numbers, or RIC volume/edition, ruler section and number.
- Exact-title matching against the ANS search API; near matches are offered as a short list.
- Ruler, denomination, mint, material, date range, obverse and reverse legends and descriptions.
- Remembers your last reference and currency choice locally. Currency affects nothing yet.
- Contacts only `numismatics.org` and `nomisma.org`. Nothing about you leaves the browser.

## Checks

```powershell
node --test tests/lookup.test.mjs tests/preferences.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors
```

The runtime has no dependencies. Building uses Python's standard library. `web-ext` is used only for validation. Fixtures under `tests/fixtures/` are real API responses captured on 2026-09-10.

## History

`prototype/` preserves the original layout preview, including the median-price design that returns once pricing is arranged. Design decisions are recorded in `docs/superpowers/specs/`.
```

- [ ] **Step 2: Write `docs/INSTALL.md`**

```markdown
# Install Giga Pinax

Version **0.2.0** looks up RIC and Price coin types from the American Numismatic Society's open OCRE and PELLA datasets. It contacts only `numismatics.org` and `nomisma.org`, and only when you select **Look up**. Prices are not connected; the acsearch links open acsearch's own website in a new tab.

## Build the packages

From the repository root, run:

```powershell
python scripts/build.py
```

The command creates these unpacked directories and matching ZIP archives:

```text
dist/brave/
dist/firefox/
dist/giga-pinax-brave-0.2.0.zip
dist/giga-pinax-firefox-0.2.0.zip
```

Run the same command again whenever an extension asset or manifest changes. You can build one target with `python scripts/build.py brave` or `python scripts/build.py firefox`.

## Test in Brave

1. Use `dist/brave`, or unzip `dist/giga-pinax-brave-0.2.0.zip` into its own folder.
2. Open `brave://extensions` in Brave.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the folder that contains `manifest.json`.
5. Open Giga Pinax from Brave's extensions menu. Pin it if you want its button to remain on the toolbar.

Brave grants access to `numismatics.org` and `nomisma.org` at install.

**Already installed?** Rebuild, then select **Reload** on Giga Pinax at `brave://extensions`. If you loaded an extracted copy, replace its files with the new ZIP's contents first. Reopen the toolbar popup to use the update.

## Test temporarily in Firefox

Use Firefox 142 or later.

1. Open `about:debugging`.
2. Select **This Firefox**.
3. Select **Load Temporary Add-on**.
4. Choose `dist/firefox/manifest.json`, or `dist/giga-pinax-firefox-0.2.0.zip`.
5. Open Giga Pinax from Firefox's extensions menu.

The first time you select **Look up**, Firefox asks whether Giga Pinax may access `numismatics.org` and `nomisma.org`. Allow it; the lookup then runs. If you decline, the popup explains what it needs and you can select **Look up** again.

Firefox removes a temporary add-on when Firefox restarts. Permanent installation needs a Mozilla-signed build; see Mozilla's [signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

**Already installed temporarily?** After rebuilding, select **Reload** for Giga Pinax under **This Firefox** at `about:debugging`, or load the updated ZIP again.

## What to try

- **Price 23**, then **RIC I (2nd edition), Nero 306**.
- A number that doesn't exist, such as **RIC I (2nd edition), Nero 9999999**: the popup says it was not found rather than inventing a result.
- **Price 2**: a short "Did you mean" list appears.
- Close and reopen the popup: your last reference and currency are remembered locally.
- **Type ↗** opens the ANS type page with specimen photographs. **Search on acsearch ↗** opens acsearch with the reference pre-filled; prices there require your own acsearch account.

## Remove

In Brave, open `brave://extensions` and select **Remove**. In Firefox, remove it from `about:debugging`, or close and restart Firefox.
```

- [ ] **Step 3: Write `install/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Install Giga Pinax</title>
  <link rel="icon" href="../extension/icons/icon-32.png">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <header><img src="../extension/icons/icon-48.png" width="42" height="42" alt=""><div><p class="eyebrow">GIGA PINAX · VERSION 0.2.0</p><h1>Real type lookup, in your toolbar.</h1></div></header>
    <p class="intro">Version 0.2.0 looks up RIC and Price coin types from the American Numismatic Society's open OCRE and PELLA datasets. Install it in Brave or try it temporarily in Firefox. Auction prices are not connected yet.</p>
    <div class="builds">
      <section aria-labelledby="brave-title"><p class="eyebrow">DESKTOP · UNPACKED EXTENSION</p><h2 id="brave-title">Brave</h2><p>Download once, extract the files, and load the folder into Brave.</p><a class="download" href="../dist/giga-pinax-brave-0.2.0.zip" download>Download Brave ZIP <span aria-hidden="true">↓</span></a><ol><li>Extract the downloaded ZIP into a folder you’ll keep.</li><li>Open <code>brave://extensions</code>.</li><li>Enable <strong>Developer mode</strong>, then select <strong>Load unpacked</strong>.</li><li>Choose the extracted folder containing <code>manifest.json</code>.</li><li>Pin <strong>Giga Pinax</strong> from the extensions menu.</li></ol><p class="note">Already working in the project? Load the <code>dist/brave</code> folder directly.</p><p class="note"><strong>Updating an existing install:</strong> Rebuild, then select <strong>Reload</strong> on Giga Pinax at <code>brave://extensions</code>. For an extracted copy, replace its files with this ZIP's contents first. Reopen the popup.</p></section>
      <section aria-labelledby="firefox-title"><p class="eyebrow">DESKTOP · FIREFOX 142+</p><h2 id="firefox-title">Firefox</h2><p>A temporary install lets you test the popup before the build is signed.</p><a class="download" href="../dist/giga-pinax-firefox-0.2.0.zip" download>Download Firefox ZIP <span aria-hidden="true">↓</span></a><ol><li>Open <code>about:debugging</code>.</li><li>Select <strong>This Firefox</strong>.</li><li>Select <strong>Load Temporary Add-on</strong>.</li><li>Choose the downloaded ZIP, or <code>manifest.json</code> from its extracted folder.</li><li>Open <strong>Giga Pinax</strong> from the extensions menu.</li></ol><p class="note"><strong>First lookup asks for access</strong> to numismatics.org and nomisma.org. Allow it to run lookups.</p><p class="note"><strong>Removed when Firefox restarts.</strong> Permanent installation needs a Mozilla-signed build. This ZIP is unsigned.</p></section>
    </div>
    <section class="try-it"><div><p class="eyebrow">WHAT TO TRY</p><h2>A reference and its type.</h2></div><p>Try <strong>Price 23</strong> or <strong>RIC I (2nd edition), Nero 306</strong>. Then try a number that doesn’t exist, and <strong>Price 2</strong> for a “Did you mean” list.</p><p>Your choices stay in your browser. <strong>Search on acsearch</strong> opens acsearch’s own website; prices there need your own account.</p></section>
    <footer><span>No prices yet · Contacts numismatics.org and nomisma.org only · Local preferences</span><nav aria-label="Installation references"><a href="https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked" target="_blank" rel="noopener noreferrer">Chromium install guide ↗</a><a href="https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/" target="_blank" rel="noopener noreferrer">Firefox install guide ↗</a></nav></footer>
  </main>
</body>
</html>
```

- [ ] **Step 4: Verify the page and the full check suite**

```bash
python scripts/build.py
node --test tests/lookup.test.mjs tests/preferences.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors
```

Serve the project (`python -m http.server 8765 --bind 127.0.0.1`), open `http://127.0.0.1:8765/install/`, confirm both ZIP links return HTTP 200 and the page has no console errors, then stop the server.

Confirm no stale names remain:

```bash
git grep -n -i "coin lookup\|coin-lookup\|sample-data\|sample prices" -- . ':!prototype' ':!docs/superpowers'
```

Expected: no output.

- [ ] **Step 5: Commit and push**

```bash
git add README.md docs/INSTALL.md install/index.html
git commit -m "Document Giga Pinax 0.2.0 type lookup and install flow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

---

## Verification results

Task 6 Step 5, performed by the controller on 2026-09-10 in the in-app Chromium browser against `dist/brave/popup.html` served by `python -m http.server 8777` (a plain tab, not a native toolbar popup; `chrome.permissions` was absent so the permission branch was not exercised):

1. Price 23: card `Price 23`, summary `Alexander III of Macedon · Tetradrachm · Silver · 336–323 BC`, obverse description present with legend hidden, reverse legend `ΑΛΕΞΑΝΔΡΟΥ`, Type link `https://numismatics.org/pella/id/price.23`, acsearch link `…search.html?term=Price%2023`. Pass.
2. RIC I (2nd edition) Nero 306: card `RIC I (second edition) Nero 306`, summary `Nero · As · Rome · Bronze · AD 62–68`, both legends and descriptions, Type link `https://numismatics.org/ocre/id/ric.1(2).ner.306`. Button read `Looking up…` and was disabled while pending. Pass.
3. RIC Nero 9999999: exact not-found message, `aria-invalid="true"`, no card. Pass.
4. Candidates: `Price 2` is a real PELLA record and resolved directly (correct). The real candidate case is omitting the edition — volume `I`, Nero 306 — which returns one non-exact title; the "Did you mean" list showed `RIC I (second edition) Nero 306` and choosing it rendered the card. Pass. One earlier attempt at this same query produced the network-error message after the 10 s timeout; the same query then completed in 6 s in the browser and 1.9 s via curl, so OCRE cold queries can approach the budget.
5. Reload: catalogue RIC, volume/section/number and currency restored; `giga-pinax-labels-v1` held `alexander_iii, tetradrachm, ar, nero, as, rome, ae, drachma`. Pass.
6. Console: no messages of any level across all runs. Pass.
7. At a 400×600 viewport, `document.body.scrollWidth` and `documentElement.scrollWidth` were 400 with a full card rendered. Pass.

Task 7 Step 4 served-page check, same session: `http://localhost:8777/install/` rendered with title `Install Giga Pinax`; `HEAD` on both download links returned 200 (`giga-pinax-brave-0.2.0.zip`, `giga-pinax-firefox-0.2.0.zip`); no link to a standalone popup preview; no console messages. Pass.

Native Brave toolbar rendering and the Firefox host-permission prompt remain for the user (see below).

## Remaining for the user

- Reload the extension in Brave and confirm the toolbar popup opens at full width and a lookup works.
- Load the Firefox ZIP temporarily and confirm the host-permission prompt appears once and a lookup works.
- Send the acsearch permission request.
