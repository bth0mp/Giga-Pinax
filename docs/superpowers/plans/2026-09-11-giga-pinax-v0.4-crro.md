# Giga Pinax v0.4 CRRO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Roman Republican coinage: an `RRC` catalogue option resolved through ANS CRRO, with acsearch prices defaulting to the `Crawford {number}` term.

**Why:** Backlog item "CRRO" — the biggest coverage gap for Roman collectors, and CRRO runs the same Numishare stack as OCRE/PELLA. Probed 2026-09-11: `numismatics.org/crro/apis/search?q=RRC 44/5` returns entries `RRC 480/5` and `RRC 44/5` (exact title wins); the record JSON-LD names `nmo:hasIssuer` (`anonymous`) instead of `nmo:hasAuthority`; CORS is open; `numismatics.org/*` is already a host permission. On acsearch (logged out, page 1) `Crawford 44/5` returns 107 lots, `Cr. 44/5` 99, `RRC 44/5` 17.

## Global Constraints

- No new permissions, dependencies or files beyond those listed. Node built-in test runner only.
- Existing Price and RIC behaviour unchanged; all existing tests keep passing unmodified.
- Fixtures `tests/fixtures/crro-search-rrc-44-5.xml`, `crro-rrc-44-5.jsonld`, `nomisma-denarius.jsonld` are real responses captured 2026-09-11; do not edit them.
- Version `0.4.0`: manifests, ZIPs `giga-pinax-{browser}-0.4.0.zip`, docs.
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths.

---

### Task 1: RRC through lookup, preferences, prices and popup

**Files:** `extension/lookup.js`, `extension/preferences.js`, `extension/prices.js`, `extension/popup.html`, `extension/popup.js`, `tests/lookup.test.mjs`, `tests/prices.test.mjs`, `tests/preferences.test.mjs`.

- [ ] **Step 1: Append the failing tests**

Append to `tests/lookup.test.mjs` (its imports already include `buildQuery, parseFeed, pickMatch, toCard, nomismaSlugs, nomismaLabel` and helpers `fixture`, `json`):

```js
test('CRRO: RRC references build a CRRO query and fall back to the issuer as authority', () => {
  assert.deepEqual(buildQuery({ catalogue: 'RRC', number: ' 44/5 ' }), { corpus: 'crro', query: 'RRC 44/5' });
  assert.equal(pickMatch(parseFeed(fixture('crro-search-rrc-44-5.xml')), 'RRC 44/5').entry.id, 'rrc-44.5');
  const jsonld = json('crro-rrc-44-5.jsonld');
  assert.deepEqual(nomismaSlugs(jsonld), ['anonymous', 'denarius', 'rome', 'ar']);
  const card = toCard(jsonld, 'crro', { anonymous: 'Anonymous', denarius: 'Denarius', rome: 'Rome', ar: 'Silver' });
  assert.equal(card.id, 'rrc-44.5');
  assert.equal(card.label, 'RRC 44/5');
  assert.deepEqual([card.authority, card.denomination, card.mint, card.material, card.dates], ['Anonymous', 'Denarius', 'Rome', 'Silver', '211 BC']);
  assert.deepEqual(card.obverse, { legend: null, description: 'Helmeted head of Roma, right. Border of dots.' });
  assert.equal(card.reverse.legend, 'ROMA');
  assert.equal(nomismaLabel(json('nomisma-denarius.jsonld'), 'denarius'), 'Denarius');
});

test('authority still wins over issuer when a record has both', () => {
  const jsonld = { '@graph': [{ '@id': 'http://numismatics.org/crro/id/x', 'skos:prefLabel': [{ '@value': 'X' }],
    'nmo:hasAuthority': [{ '@id': 'http://nomisma.org/id/nero' }], 'nmo:hasIssuer': [{ '@id': 'http://nomisma.org/id/anonymous' }] }] };
  assert.deepEqual(nomismaSlugs(jsonld), ['nero']);
  assert.equal(toCard(jsonld, 'crro', {}).authority, 'nero');
});
```

Append to `tests/prices.test.mjs`:

```js
test('defaultTerm uses Crawford wording for RRC, which acsearch lists far more often', () => {
  assert.equal(defaultTerm({ catalogue: 'RRC', number: ' 44/5 ' }), 'Crawford 44/5');
});
```

Append to `tests/preferences.test.mjs`:

```js
test('RRC is a remembered catalogue with its own default number', () => {
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'RRC' })).catalogue, 'RRC');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'RRC' })).number, '44/5');
  assert.equal(restorePreferences(JSON.stringify({ catalogue: 'RPC' })).catalogue, 'Price');
});
```

- [ ] **Step 2: Run and confirm the new tests fail** — `node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs`; expect exactly the four new tests to fail.

- [ ] **Step 3: Implement**

- `extension/lookup.js`
  - `buildQuery`: before the Price return, `if (catalogue === 'RRC') return { corpus: 'crro', query: squash(`RRC ${squash(number)}`) };`
  - Authority falls back to issuer: in both `nomismaSlugs` and `toCard`, the authority slot uses `nmo:hasAuthority` when present, otherwise `nmo:hasIssuer`. Keep one source of truth for the field list (e.g. `const NAMED_FIELDS = [['nmo:hasAuthority', 'nmo:hasIssuer'], ['nmo:hasDenomination'], ['nmo:hasMint'], ['nmo:hasMaterial']];` with a helper that returns the first present slug), so the two functions cannot drift.
- `extension/preferences.js`: `catalogue` accepts `'RIC'` or `'RRC'`, else `'Price'`; the default `number` is `{ Price: '23', RIC: '306', RRC: '44/5' }[catalogue]`.
- `extension/prices.js` `defaultTerm`: RRC → `Crawford {number}` (whitespace-collapsed); RIC and Price unchanged.
- `extension/popup.html`: catalogue select gains `<option value="RRC">RRC (Crawford)</option>` after RIC; footer text `Type data: ANS OCRE, PELLA &amp; CRRO (ODbL)`.
- `extension/popup.js`:
  - `const DEFAULT_NUMBER = { Price: '23', RIC: '306', RRC: '44/5' };` and the catalogue-change handler uses it.
  - `updateFields`: RIC fields only for RIC; label `RIC number (including any suffix)` / `Crawford number` / `Price number`; help `Example: I (2nd edition), Nero 306` / `Example: RRC 44/5` / `Example: Price 23`.
  - Not-found message uses `const CORPUS_NAME = { ocre: 'OCRE', pella: 'PELLA', crro: 'CRRO' };`.

- [ ] **Step 4: Verify** — the three Node suites all pass (25 existing + 4 new = 29), `node --check extension/popup.js`, `python -m unittest discover -s tests -p 'test_*.py'` OK.

- [ ] **Step 5: Commit** exactly the eight files, message `Add Roman Republican (RRC) references via ANS CRRO`.

---

### Task 2: Version 0.4.0 and docs

**Files:** `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`, `README.md`, `docs/INSTALL.md`, `install/index.html`.

- [ ] Manifests: `"version": "0.4.0"`; description `Look up ancient coin types by RIC, RRC or Price reference and see recent acsearch hammer prices.` (keeps "RIC", no "sample"). Nothing else changes.
- [ ] `tests/test_packages.py`: `0.3.0` → `0.4.0` in the version assertion and the ZIP f-string. Run the Python suite; `rm -f dist/giga-pinax-*-0.3.0.zip`.
- [ ] Docs: every `0.3.0` → `0.4.0`; README's opening sentence names "RIC references through OCRE, Roman Republican (Crawford RRC) references through [CRRO](https://numismatics.org/crro/) and Price references through PELLA"; README's "Guided entry" bullet adds "or an RRC (Crawford) number"; INSTALL "What to try" adds a bullet `**RRC 44/5** — an anonymous Roman Republican denarius; its acsearch search starts as "Crawford 44/5".`; install page intro adds "RRC" alongside RIC and Price.
- [ ] Verify: Node suites, Python suite, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, and `git grep -n "0\.3\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing.
- [ ] Commit the six files, message `Release 0.4.0 with Roman Republican references`.

---

## Verification

Result 2026-09-11 (in-app Chromium, `extension/popup.html` served from a fresh origin `http://127.0.0.1:8777` — the `localhost` origin held a stale cached `lookup.js` module from earlier sessions and queried PELLA): RRC option labelled `RRC (Crawford)`, label `Crawford number`, help `Example: RRC 44/5`, default `44/5`, RIC fields hidden; RRC 44/5 → `RRC 44/5`, `Anonymous · Denarius · Rome · Silver · 211 BC`, obverse description with no legend, reverse `ROMA` / `Dioscuri galloping right. Line border.`, type link `https://numismatics.org/crro/id/rrc-44.5`, term `Crawford 44/5`, acsearch link `term=Crawford+44%2F5`; `RRC 9999/9` → `No RRC 9999/9 found in CRRO. Check the number.`; RIC Nero 306 and Price 23 still resolve; 400 px; no errors. Pass.

Planned check — controller, after Task 1, in a served tab: RRC 44/5 resolves to `RRC 44/5`, summary `Anonymous · Denarius · Rome · Silver · 211 BC`, reverse legend `ROMA`, type link `https://numismatics.org/crro/id/rrc-44.5`, acsearch term `Crawford 44/5`; switching catalogue fills `44/5` and hides the RIC fields; Price 23 and RIC Nero 306 still resolve; console clean.
