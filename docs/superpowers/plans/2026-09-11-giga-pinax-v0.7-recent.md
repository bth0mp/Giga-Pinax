# Giga Pinax v0.7 Recent Lookups

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Show the collector's last six resolved types as one-click chips under the form. A chip re-opens its type (and, with v0.6, its prices) in one click and fills the guided fields from the type's title so the acsearch term follows the chip. Also three small fixes from the v0.6 review.

## Global Constraints

- Recent entries are stored locally inside the existing preferences object (`giga-pinax-preferences-v1`) as `recent: [{ id, corpus, label }]`, newest first, at most 6, deduplicated by `corpus` + `id`. Only those three string fields are stored — nothing from acsearch, no prices.
- `restorePreferences` treats `recent` as untrusted: array of plain objects whose `id` and `label` are non-empty strings (capped at 120 characters) and whose `corpus` is one of `ocre`, `pella`, `crro`; anything else is dropped; duplicates after the first are dropped; then capped at 6.
- A chip click is a user action like a "Did you mean" click: one type lookup via `lookupById`, then at most one automatic acsearch request under the v0.6 rules (only with access already granted). It makes no permission request.
- Chip labels reach the DOM only via `textContent` / `title`.
- Version `0.7.0` in manifests, package test and docs.
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output.

---

### Task 1: recent chips, three v0.6 minors, 0.7.0

**Files:** `extension/preferences.js`, `extension/popup.html`, `extension/popup.css`, `extension/popup.js`, `tests/preferences.test.mjs`, `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`, `README.md`, `docs/INSTALL.md`, `install/index.html`.

**Behaviour**

1. `extension/preferences.js`: `export const RECENT_LIMIT = 6;` `restorePreferences` returns an extra `recent` array per the constraints. `export function rememberRecent(preferences, card)` returns preferences with `{ id: card.id, corpus: card.corpus, label: card.label }` (labels capped at 120) first, any older copy with the same `corpus` + `id` removed, capped at `RECENT_LIMIT`; it never mutates its input.
2. `extension/popup.html`: between `</form>` and `<section id="result" …>`:
   ```html
   <nav id="recent" class="recent" aria-label="Recent lookups" hidden><p class="field-hint">Recent</p><ul id="recent-list" class="recent-list"></ul></nav>
   ```
3. `extension/popup.css`:
   ```css
   .recent {padding:8px 20px 10px; border-bottom:1px solid var(--border);}
   .recent .field-hint {margin-top:0;}
   .recent-list {list-style:none; margin:4px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:6px;}
   .recent-list button {max-width:100%; border:1px solid var(--border); border-radius:999px; background:var(--soft); color:var(--ink); font-size:11px; padding:4px 10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
   ```
   and add `.recent` to the `@media (max-width:359px)` padding rule.
4. `extension/popup.js`:
   - Import `rememberRecent` (and `parseReference` is already imported).
   - Extract the field-filling part of `applyQuickReference()` into `fillFields(parsed)` (sets catalogue, number, and for RIC volume and section, then `updateFields()`), used by both.
   - `renderRecent()`: rebuilds `#recent-list` from `preferences.recent` with one `<li><button type="button">` per entry (`textContent` and `title` = label); hides `#recent` when empty. Called once at start-up and whenever `recent` changes.
   - Chip click: clear the one-box; `const parsed = parseReference(entry.label); if (parsed) { fillFields(parsed); savePreferences(); }`; then `run(() => lookupById(entry.corpus, entry.id, { cache: labelCache }))`.
   - In `run()`'s `'ok'` branch, right after `renderCard(outcome.card)`: `preferences = rememberRecent(preferences, outcome.card); savePreferences(); renderRecent();`
5. v0.6 minors:
   - `SIGN_IN_MESSAGE` becomes `acsearch didn’t show prices. Sign in with an acsearch account that includes hammer prices, then select “Get prices”.` (no "again").
   - When a type resolves, the term is non-empty and acsearch access is **not** already granted, show the prices note (no sign-in link) `Select “Get prices” to let Giga Pinax fetch acsearch prices.` instead of silently waiting — under the same `id === requestId` and `ticket === priceRequestId` guards as the automatic fetch.
   - README and INSTALL: where they say acsearch is contacted when **Look up** fetches prices, say instead "when a type resolves (**Look up** or a "Did you mean" choice)".
6. Version 0.7.0: manifests `version`; `tests/test_packages.py` version assertion and ZIP name; every `0.6.0` in README/INSTALL/install page. README "What it does" gains `- A **Recent** row under the form re-opens your last six types with one click.`; INSTALL "What to try" gains `- Look up two or three types, close and reopen the popup, and choose one from **Recent**.` Remove stale `dist/giga-pinax-*-0.6.0.zip`.

**Tests — `tests/preferences.test.mjs`**

Extend the import with `rememberRecent, RECENT_LIMIT`. The new `recent` field changes two existing expectations: add `recent: []` to the `defaults` object and to the expected object in "saved preferences are constrained, trimmed…". No other existing assertion changes. Append:

```js
test('recent lookups are restored, sanitised, deduplicated and capped', () => {
  const entry = (id, corpus = 'pella', label = id) => ({ id, corpus, label });
  const saved = restorePreferences(JSON.stringify({ recent: [
    entry('price.23', 'pella', 'Price 23'), { id: 'x', corpus: 'evil', label: 'X' }, { id: 7, corpus: 'ocre', label: 'Y' },
    entry('price.23', 'pella', 'dupe'), 'junk', null, entry('rrc-44.5', 'crro', 'RRC 44/5'), entry('', 'ocre', 'empty id'),
  ] }));
  assert.deepEqual(saved.recent, [entry('price.23', 'pella', 'Price 23'), entry('rrc-44.5', 'crro', 'RRC 44/5')]);
  assert.equal(restorePreferences(JSON.stringify({ recent: Array.from({ length: 10 }, (_, i) => entry(`price.${i}`)) })).recent.length, RECENT_LIMIT);
  assert.deepEqual(restorePreferences(JSON.stringify({ recent: 'nope' })).recent, []);
  assert.equal(restorePreferences(JSON.stringify({ recent: [entry('p', 'pella', 'L'.repeat(200))] })).recent[0].label.length, 120);
  assert.equal(RECENT_LIMIT, 6);
});

test('rememberRecent puts the newest type first, drops its older copy, keeps six and stores only id, corpus and label', () => {
  let preferences = restorePreferences(null);
  const before = preferences;
  for (let i = 0; i < 8; i += 1) preferences = rememberRecent(preferences, { id: `price.${i}`, corpus: 'pella', label: `Price ${i}`, uri: 'u', obverse: {} });
  assert.deepEqual(before.recent, []);
  assert.deepEqual(preferences.recent.map((e) => e.id), ['price.7', 'price.6', 'price.5', 'price.4', 'price.3', 'price.2']);
  preferences = rememberRecent(preferences, { id: 'price.4', corpus: 'pella', label: 'Price 4' });
  assert.deepEqual(preferences.recent.map((e) => e.id), ['price.4', 'price.7', 'price.6', 'price.5', 'price.3', 'price.2']);
  assert.deepEqual(Object.keys(preferences.recent[0]), ['id', 'corpus', 'label']);
  preferences = rememberRecent(preferences, { id: 'price.4', corpus: 'ocre', label: 'Other corpus, same id' });
  assert.equal(preferences.recent.filter((e) => e.id === 'price.4').length, 2);
});
```

**Verify:** new tests fail first for the expected reasons; then Node suites 43/43, Python OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check extension/popup.js`, and `git grep -n "0\.6\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing.

**Commit** the eleven files: `Add recent lookups and release 0.7.0`.

## Verification (controller, never-cached origin, acsearch stubbed)

Fresh storage: no Recent row. Look up Price 23, RIC I² Nero 306 and RRC 44/5 → Recent shows `RRC 44/5`, `RIC I (second edition) Nero 306`, `Price 23` (newest first). Reload → same chips. With the guided fields on Price, click the RRC chip → fields switch to RRC / `44/5`, card `RRC 44/5`, acsearch term `Crawford 44/5`, exactly one acsearch request; the chip moves first. Looking up an existing type again does not duplicate it; a seventh type drops the oldest. `chrome.permissions.contains` stubbed `false` → after Look up, the prices note reads `Select “Get prices” to let Giga Pinax fetch acsearch prices.` and 0 acsearch requests. Signed-out stub → note without "again". Long labels ellipsize within 400 px; console clean.
