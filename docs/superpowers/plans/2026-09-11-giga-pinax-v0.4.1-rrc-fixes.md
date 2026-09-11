# Giga Pinax v0.4.1 Reference-Matching Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Resolve exact references reliably (RRC 1/1 is falsely "not found" today), tolerate a typed catalogue prefix, and stop CRRO offering unrelated "Did you mean" types.

**Findings (probed 2026-09-11):**
- CRRO's search is loose: `RRC 1/1` returns 656 hits and the title `RRC 1/1` is not on the first page of 100, so exact matching fails although `crro/id/rrc-1.1` exists.
- A quoted phrase is exact on all three corpora: `"RRC 1/1"` → 1 hit, `"RRC 44/5"` → 1, `"RIC I (second edition) Nero 306"` → 1, `"Price 23"` → 1, `"Price 1"` → 1. Non-existent or partial references (`"RRC 44/5a"`, `"RIC I Nero 306"`) → 0, so the unquoted search is still needed for "Did you mean".
- Unquoted CRRO search also matches dates: `RRC 44/5a` offers `RRC 480/5a` and `RRC 480/5`.
- Typing the prefix shown in the help (`RRC 44/5`, `Price 23`) doubles it: `RRC RRC 44/5`, acsearch term `Crawford RRC 44/5`.

## Global Constraints

- Requests only to `numismatics.org`/`nomisma.org` for type lookup; nothing about acsearch changes. At most one extra search request, and only when the quoted search has no exact match.
- One shared 15 s deadline still spans every request of a lookup.
- No new permissions, dependencies or files beyond those listed. Fixtures `tests/fixtures/crro-search-quoted-rrc-1-1.xml` and `crro-rrc-1-1.jsonld` are real responses captured 2026-09-11; do not edit.
- Version `0.4.1` in manifests, package test, docs.
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths.

---

### Task 1: Quoted-first search, prefix stripping, CRRO candidate filter, 0.4.1

**Files:** `extension/lookup.js`, `extension/prices.js`, `extension/preferences.js`, `extension/popup.js`, `tests/lookup.test.mjs`, `tests/prices.test.mjs`, `tests/preferences.test.mjs`, `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`, `README.md`, `docs/INSTALL.md`, `install/index.html`.

**Behaviour:**

1. `extension/lookup.js` exports `referenceNumber(catalogue, number)`: whitespace-collapsed; for `RRC` strips one leading `RRC`, `Crawford` or `Cr.`/`Cr` (case-insensitive, followed by optional space); for `Price` strips one leading `Price`; RIC unchanged. `buildQuery` uses it for RRC and Price.
2. `lookupType` searches the quoted query first (`q=` + `encodeURIComponent('"' + query + '"')`). Exact title match → `lookupById` as now. Otherwise it runs the plain (unquoted) search and applies `pickMatch` to that. Both searches and the record/labels share the one timer. The returned `query` in `candidates`/`none` outcomes is the unquoted query.
3. For `crro`, candidates from the plain search are kept only when their title starts with `RRC {group}/`, where `{group}` is the text before the first `/` of the stripped number (e.g. `44` for `44/5a`); if none remain the outcome is `none`. Other corpora unchanged.
4. `extension/prices.js` `defaultTerm` uses `referenceNumber` for RRC (`Crawford {n}`) and Price (`Price {n}`).
5. `extension/preferences.js` exports `DEFAULT_NUMBER = Object.freeze({ Price: '23', RIC: '306', RRC: '44/5' })` and uses it; `extension/popup.js` imports it instead of its own copy, and the RRC help text becomes `Example: 44/5`.
6. Version 0.4.1: manifests `version`, `tests/test_packages.py` (version assertion and ZIP name), every `0.4.0` in README/INSTALL/install page. Remove stale `dist/giga-pinax-*-0.4.0.zip`.

**Tests — append to `tests/lookup.test.mjs`** (extend its import with `referenceNumber`):

```js
test('referenceNumber strips a typed catalogue prefix for RRC and Price only', () => {
  for (const typed of ['44/5', 'RRC 44/5', 'rrc44/5', 'Crawford 44/5', 'Cr. 44/5', ' Cr 44/5 ']) assert.equal(referenceNumber('RRC', typed), '44/5');
  assert.equal(referenceNumber('Price', 'Price 23'), '23');
  assert.equal(referenceNumber('RIC', 'RIC 306'), 'RIC 306');
  assert.deepEqual(buildQuery({ catalogue: 'RRC', number: 'Crawford 44/5' }), { corpus: 'crro', query: 'RRC 44/5' });
  assert.deepEqual(buildQuery({ catalogue: 'Price', number: 'price 23' }), { corpus: 'pella', query: 'Price 23' });
});

test('lookupType resolves an exact reference from the quoted search without a second search', async () => {
  const fetchImpl = fakeFetch({
    'crro/apis/search?q=%22': fixture('crro-search-quoted-rrc-1-1.xml'),
    'crro/id/rrc-1.1.jsonld': fixture('crro-rrc-1-1.jsonld'),
  });
  const result = await lookupType({ catalogue: 'RRC', number: 'RRC 1/1' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.label, 'RRC 1/1');
  assert.ok(fetchImpl.calls[0].includes('/crro/apis/search?q=%22RRC%201%2F1%22'));
  assert.equal(fetchImpl.calls.filter((url) => url.includes('/apis/search')).length, 1);
});

test('lookupType falls back to the plain search for suggestions, and CRRO suggestions stay in the typed group', async () => {
  const ocre = fakeFetch({ 'ocre/apis/search?q=%22': '<feed></feed>', 'ocre/apis/search?q=': fixture('ocre-search-nero-306.xml') });
  const near = await lookupType({ catalogue: 'RIC', volume: 'I', section: 'Nero', number: '306' }, { fetchImpl: ocre });
  assert.equal(near.status, 'candidates');
  assert.equal(near.query, 'RIC I Nero 306');
  assert.deepEqual(near.candidates.map((entry) => entry.id), ['ric.1(2).ner.306']);
  assert.equal(ocre.calls.filter((url) => url.includes('/apis/search')).length, 2);

  const feed = (...titles) => `<feed>${titles.map((title, index) => `<entry><title>${title}</title><id>x${index}</id></entry>`).join('')}</feed>`;
  const unrelated = fakeFetch({ 'crro/apis/search?q=%22': '<feed></feed>', 'crro/apis/search?q=': feed('RRC 480/5a', 'RRC 480/5') });
  assert.deepEqual(await lookupType({ catalogue: 'RRC', number: '44/5a' }, { fetchImpl: unrelated }), { status: 'none', corpus: 'crro', query: 'RRC 44/5a' });
  const related = fakeFetch({ 'crro/apis/search?q=%22': '<feed></feed>', 'crro/apis/search?q=': feed('RRC 480/5a', 'RRC 44/5', 'RRC 44/6') });
  const kept = await lookupType({ catalogue: 'RRC', number: '44/5a' }, { fetchImpl: related });
  assert.deepEqual(kept.candidates.map((entry) => entry.title), ['RRC 44/5', 'RRC 44/6']);
});
```

`fakeFetch` in that file matches the first route whose key is contained in the URL, in insertion order, so list the quoted key (`…?q=%22`) before the plain key (`…?q=`). The existing test `lookupType resolves an exact RIC match…` asserts the first call ends with the unquoted URL; update only that assertion to the quoted form `…/ocre/apis/search?q=%22RIC%20I%20(second%20edition)%20Nero%20306%22` — the behaviour change is intended. No other existing assertion changes.

**Append to `tests/prices.test.mjs`:**

```js
test('defaultTerm ignores a typed catalogue prefix', () => {
  assert.equal(defaultTerm({ catalogue: 'RRC', number: 'RRC 44/5' }), 'Crawford 44/5');
  assert.equal(defaultTerm({ catalogue: 'RRC', number: 'Cr. 44/5' }), 'Crawford 44/5');
  assert.equal(defaultTerm({ catalogue: 'Price', number: 'Price 23' }), 'Price 23');
});
```

**Append to `tests/preferences.test.mjs`** (extend its import with `DEFAULT_NUMBER`):

```js
test('DEFAULT_NUMBER is the single source of default reference numbers', () => {
  assert.deepEqual({ ...DEFAULT_NUMBER }, { Price: '23', RIC: '306', RRC: '44/5' });
  assert.ok(Object.isFrozen(DEFAULT_NUMBER));
});
```

**Verify:** new tests fail first for the expected reasons; then all Node suites pass (29 + 5 = 34, the one updated assertion included), Python suite, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check extension/popup.js`, and `git grep -n "0\.4\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing. Run each command on its own and check its exit status; do not pipe test output.

**Commit** the thirteen files: `Match exact references with a quoted search and release 0.4.1`.

## Verification (controller, fresh origin)

Result 2026-09-11, in-app Chromium at 400×600 against `extension/popup.html` on a never-cached origin (`http://localhost:8778`), live numismatics.org: RRC help `Example: 44/5`; `1/1` → `RRC 1/1`, `Anonymous · Uncertain value · Neapolis · Bronze · 326–242 BC`, type link `…/crro/id/rrc-1.1`, term `Crawford 1/1`; typed `RRC 44/5` → `RRC 44/5`, term `Crawford 44/5`; `44/5a` → `No RRC 44/5a found in CRRO. Check the number.` with no suggestions; RIC volume `I` Nero 306 → one suggestion `RIC I (second edition) Nero 306`; typed `Price 23` → `Price 23`, term `Price 23`; no overflow; console clean. Pass.

After the review fix (`a89b0e2`), same origin, exercising the freshly served module via a cache-busted `import()` (the served `lookup.js` was confirmed to contain the `norm(` group prefix): `1/1` → ok `RRC 1/1`; `Cr. 44/5` → ok `RRC 44/5`; `44/5a` → none (live plain search has no in-group titles); RIC `I` Nero 306 → candidates `RIC I (second edition) Nero 306`; `Price 23` → ok; `referenceNumber('RRC', '"RRC 44/5"')` → `44/5`; `Crawf 44/5` kept as typed; console clean. Pass.

Planned checks:

RRC `1/1` resolves to `RRC 1/1`; `RRC 44/5` typed as `RRC 44/5` resolves with term `Crawford 44/5`; `RRC 44/5a` → not found in CRRO (no unrelated suggestions); RIC volume `I` Nero 306 → one "Did you mean"; Price 23 unchanged.
