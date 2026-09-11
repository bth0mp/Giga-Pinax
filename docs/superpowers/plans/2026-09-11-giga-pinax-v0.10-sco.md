# Giga Pinax v0.10 Seleucid Coins (SC) via ANS SCO

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Add an **SC** catalogue (Houghton–Lorber–Hoover, *Seleucid Coins*) resolved through ANS SCO, plus two price-reader hardening minors from the v0.9 review.

**Findings (probed 2026-09-11):** every SCO record lives at `numismatics.org/sco/id/sc.1.{number}.jsonld` whatever the volume part (`sc.1.1266.2`, `sc.1.1630.2b`, `sc.1.1`, `sc.1.1439`, `sc.1.1440` → 200; a base number like `sc.1.1266` is its own type). Missing numbers answer **404** (`sc.1.1266.9`, `sc.1.99999`). Titles read `Seleucid Coins (part 1) 1266.2`, so title matching against `SC 1266.2` never works; the direct record is exact and costs one request. The plain search `SC 1266` returns `Seleucid Coins (part 1) 1266` (`sc.1.1266`), which makes a good "Did you mean" for a missing sub-number. The record shape matches PELLA (`nmo:hasAuthority` `demetrius_ii_nicator`, `hasDenomination` `tetradrachm`, `hasMint` `antiocheia_syria`, `hasMaterial` `ar`, dates `-0129`/`-0128`, obverse/reverse descriptions, Greek reverse legend). CORS is open; `numismatics.org/*` is already a host permission. Fixtures `tests/fixtures/sco-sc-1-1266-2.jsonld` and `tests/fixtures/sco-search-sc-1266.xml` are real responses captured 2026-09-11 — do not edit.

## Global Constraints

- No new permissions, dependencies or files beyond those listed. RIC, RRC and Price behaviour unchanged; all existing tests keep passing except the one expectation named below.
- An SC lookup makes the record request first; only on **404** does it run one plain search (`SC {number}`) for suggestions; any other failure is a network error. All requests share the lookup's one 15 s timer. Then the usual v0.6 automatic price fetch.
- Nothing acsearch-related changes except the two quoting minors; one acsearch request per user action.
- Version `0.10.0` in manifests, package test and docs (digit-bounded stale check `(^|[^0-9.@])0\.9\.0`).
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output.

---

### Task 1: SC catalogue, quoting minors, 0.10.0

**Files:** `extension/lookup.js`, `extension/prices.js`, `extension/preferences.js`, `extension/popup.html`, `extension/popup.js`, `tests/lookup.test.mjs`, `tests/prices.test.mjs`, `tests/preferences.test.mjs`, `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`, `README.md`, `docs/INSTALL.md`, `install/index.html`, plus the two fixtures above (already on disk, staged with the plan).

**Behaviour**

1. `extension/lookup.js`
   - `referenceNumber('SC', n)` strips one leading `SC` or `Seleucid Coins` (case-insensitive, optional space) before a digit, like the RRC prefixes.
   - `buildQuery({ catalogue: 'SC', number })` → `{ corpus: 'sco', query: 'SC {n}', id: 'sc.1.{n}' }`. Other catalogues' outputs are unchanged (no `id` key).
   - Extract the part of `lookupById` that turns a fetched JSON-LD into a card (label resolution + `toCard`) into one internal helper used by `lookupById` and the SC path, so there is a single card-building code path.
   - `lookupType` for `sco`: fetch `https://numismatics.org/sco/id/{encodeURIComponent(id)}.jsonld` under the shared timer; OK → card (`status: 'ok'`); **404** → plain search `SC {n}`, keep only entries whose id is `sc.1.{base}` or starts with `sc.1.{base}.` (`base` = the number up to its first `.`), then `pickMatch(kept, query)` (so 1–5 kept → candidates, else none); any other status or a thrown fetch → `{ status: 'network' }`. `query` in outcomes is `SC {n}`.
   - `parseReference` accepts `SC 1266.2`, `SC1630.2b`, `Seleucid Coins 1266.2` → `{ catalogue: 'SC', number, volume: '', section: '' }` (number must start with a digit).
2. `extension/prices.js`
   - `defaultTerm({ catalogue: 'SC', number })` → `SC {n}` via `referenceNumber`.
   - The shared quoting of uncounted prices (used by the note and `summaryText`) squashes `/[\s\p{Cc}]+/gu` to one space, trims, and caps each quoted price at 40 characters followed by `…` when longer.
3. `extension/preferences.js`: catalogue accepts `'SC'`; `DEFAULT_NUMBER` gains `SC: '1266.2'`; Recent restore accepts corpus `'sco'`.
4. `extension/popup.html`: catalogue select gains `<option value="SC">SC (Seleucid Coins)</option>` after RRC; footer text `Type data: ANS OCRE, PELLA, CRRO &amp; SCO (ODbL)`.
5. `extension/popup.js`: `REFERENCE_LABEL.SC = 'Seleucid Coins number'`, `REFERENCE_HELP.SC = 'Example: 1266.2'`, `CORPUS_NAME.sco = 'SCO'`, `NOT_FOUND_HINT.sco = 'Check the number.'`; RIC fields stay hidden for SC.
6. Version 0.10.0: manifests (`version`; description `Look up ancient coin types by RIC, RRC, SC or Price reference and see recent acsearch hammer prices.`), `tests/test_packages.py` (version assertion and ZIP name; it asserts `"RIC"` is in the description, which still holds), README/INSTALL/install page `0.9.0` → `0.10.0`; README names SC/SCO beside the other catalogues; INSTALL "What to try" gains `- **SC 1266.2** — a tetradrachm of Demetrius II from Antioch; **SC 1266.9** doesn't exist and offers **SC 1266** instead.` Remove stale `dist/giga-pinax-*-0.9.0.zip`.

**Tests**

`tests/preferences.test.mjs`: the `DEFAULT_NUMBER` expectation becomes `{ Price: '23', RIC: '306', RRC: '44/5', SC: '1266.2' }` (the only existing expectation that changes). Append:

```js
test('SC is a remembered catalogue and sco a valid Recent corpus', () => {
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'SC' })).catalogue, 'SC');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'SC' })).number, '1266.2');
  const recent = [{ id: 'sc.1.1266.2', corpus: 'sco', label: 'Seleucid Coins (part 1) 1266.2' }];
  assert.deepEqual(restorePreferences(JSON.stringify({ recent })).recent, recent);
});
```

`tests/lookup.test.mjs` (existing helpers `fixture`, `fakeFetch` — unrouted URLs answer 404):

```js
test('SC references build the SCO record id and parse from one box', () => {
  assert.deepEqual(buildQuery({ catalogue: 'SC', number: 'SC 1266.2' }), { corpus: 'sco', query: 'SC 1266.2', id: 'sc.1.1266.2' });
  assert.equal(referenceNumber('SC', 'Seleucid Coins 1630.2b'), '1630.2b');
  assert.deepEqual(parseReference('SC 1266.2'), { catalogue: 'SC', number: '1266.2', volume: '', section: '' });
  assert.deepEqual(parseReference('sc1630.2b'), { catalogue: 'SC', number: '1630.2b', volume: '', section: '' });
  assert.equal(parseReference('SC'), null);
});

test('an SC lookup fetches the SCO record directly, without a search', async () => {
  const fetchImpl = fakeFetch({ 'sco/id/sc.1.1266.2.jsonld': fixture('sco-sc-1-1266-2.jsonld') });
  const result = await lookupType({ catalogue: 'SC', number: '1266.2' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.label, 'Seleucid Coins (part 1) 1266.2');
  assert.deepEqual([result.card.authority, result.card.denomination, result.card.mint, result.card.material, result.card.dates],
    ['demetrius_ii_nicator', 'tetradrachm', 'antiocheia_syria', 'ar', '129–128 BC']);
  assert.equal(fetchImpl.calls.filter((url) => url.includes('/apis/search')).length, 0);
});

test('a missing SC number suggests types with the same base number, and other failures are network errors', async () => {
  const near = await lookupType({ catalogue: 'SC', number: '1266.9' }, { fetchImpl: fakeFetch({ 'sco/apis/search?q=': fixture('sco-search-sc-1266.xml') }) });
  assert.equal(near.status, 'candidates');
  assert.equal(near.query, 'SC 1266.9');
  assert.deepEqual(near.candidates.map((entry) => entry.id), ['sc.1.1266']);
  const unrelated = fakeFetch({ 'sco/apis/search?q=': '<feed><entry><title>Seleucid Coins (part 2) 1630.2b</title><id>sc.1.1630.2b</id></entry></feed>' });
  assert.deepEqual(await lookupType({ catalogue: 'SC', number: '1266.9' }, { fetchImpl: unrelated }), { status: 'none', corpus: 'sco', query: 'SC 1266.9' });
  const failing = async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}) });
  assert.deepEqual(await lookupType({ catalogue: 'SC', number: '1266.2' }, { fetchImpl: failing }), { status: 'network' });
});
```

(Extend the file's import with `referenceNumber` and `parseReference` if not already imported.)

`tests/prices.test.mjs`:

```js
test('defaultTerm uses SC wording for Seleucid Coins', () => {
  assert.equal(defaultTerm({ catalogue: 'SC', number: 'SC 1266.2' }), 'SC 1266.2');
});

test('quoted uncounted prices are squashed of control characters and capped at 40 characters', () => {
  const long = `${'1'.repeat(30)} EUR ${'2'.repeat(30)}`;
  const summary = summarise([lot('100'), lot(long), lot('7\u00858 EUR')], 'USD');
  const text = summaryText({ label: 'X', corpus: 'pella', id: 'x' }, summary, 'USD', 'X');
  assert.ok(text.includes(`Not counted: “${long.slice(0, 40)}…”, “7 8 EUR”`), text);
  assert.equal(text.split('\n').length, 4);
});
```

**Verify:** new tests and the one updated expectation fail first for the expected reasons; then all Node suites pass (49 + 7 = 56), Python OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check extension/popup.js`, and `git grep -nE "(^|[^0-9.@])0\.9\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing.

**Commit** the fourteen code/doc files: `Add Seleucid Coins (SC) via ANS SCO and release 0.10.0`.

## Verification (controller, never-cached origin)

Live numismatics.org, acsearch stubbed: catalogue SC shows label `Seleucid Coins number`, help `Example: 1266.2`, default `1266.2`, RIC fields hidden; `SC 1266.2` in the Reference box → card `Seleucid Coins (part 1) 1266.2` with ruler/denomination/mint/material labels and `129–128 BC`, type link `…/sco/id/sc.1.1266.2`, acsearch term `SC 1266.2`, no SCO search request (network log), one acsearch request; `SC 1266.9` → one "Did you mean" `Seleucid Coins (part 1) 1266`; `SC 99999` → `No SC 99999 found in SCO. Check the number.`; Recent chip for the SC card re-opens it; 400 px; console clean.
