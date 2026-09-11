# Giga Pinax v0.5 One-Box Reference Entry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Let a collector type a whole reference — `RIC I² Nero 306`, `Crawford 44/5`, `Price 23` — in one field. It fills the guided fields (which stay as the fallback and show what was understood) and looks the type up in the same click.

**Findings (OCRE titles sampled 2026-09-11):** `RIC I (second edition) Nero 306`; `RIC II, Part 1 (second edition) Titus 100`; `RIC II, Part 3 (second edition) Hadrian 12`; `RIC IV Septimius Severus 266 (aureus)`; `RIC V Aurelian 1`; `RIC VI Antioch 1` / `RIC VII Aquileia 1` (mint as section); `RIC IX Antioch 56A`. Parts appear only in volume II; the edition appears as `(second edition)`; the section is a ruler or a mint; numbers carry letter suffixes and sometimes a parenthetical. A near-miss parse still reaches the right type through the existing quoted-then-plain search and its "Did you mean" list, so the parser only needs to be good, not exhaustive.

## Global Constraints

- No new permissions, dependencies or files beyond those listed. Nothing acsearch-related changes. Type lookup still sends at most two searches plus the record and labels, under one deadline.
- The permission request stays the first asynchronous call in the submit handler; parsing is synchronous and happens before it.
- The one-box text is never stored; guided fields are stored as today.
- Version `0.5.0` in manifests, package test and docs.
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output.

---

### Task 1: `parseReference`, one-box UI, RIC quote strip, 0.5.0

**Files:** `extension/lookup.js`, `extension/popup.html`, `extension/popup.css`, `extension/popup.js`, `tests/lookup.test.mjs`, `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`, `README.md`, `docs/INSTALL.md`, `install/index.html`.

**Behaviour**

1. `extension/lookup.js` exports `parseReference(text) → { catalogue, number, volume, section } | null` (`volume`/`section` are `''` unless RIC). Input is whitespace-collapsed and stray `"` removed.
   - **RRC:** leading `RRC`, `Crawford`, `Cr.` or `Cr` (case-insensitive), then a number starting with a digit, e.g. `44/5`, `197-198B/1a` → `{ catalogue: 'RRC', number }`.
   - **Price:** leading `Price`, then a number starting with a digit, e.g. `23`, `3a` → `{ catalogue: 'Price', number }`.
   - **RIC:** leading `RIC`, optional `vol.`, then a volume: a Roman numeral I–X or an Arabic 1–10 (converted to Roman); an optional part written `.3`, `/3`, `,3`, `, Part 3` or ` part 3` → `, Part 3`; an optional second-edition marker written `²`, `2` directly after the volume or part only when written `(2)`, `(2nd ed.)`, `(2nd ed)`, `2nd ed.`, `2nd edition`, `(2nd edition)` or `(second edition)` → ` (2nd edition)`. Then the section (one or more words) and finally the number: the last token that starts with a digit, optionally followed by a parenthetical (`266 (aureus)`). Volume output format: `{ROMAN}{, Part N}{ (2nd edition)}` — e.g. `I (2nd edition)`, `II, Part 3 (2nd edition)`, `IV`.
   - Anything else → `null` (e.g. `''`, `hello`, `RIC Nero 306` with no volume, `RIC I Nero` with no number, `Sear 1234`).
2. `buildQuery` strips stray `"` from the RIC volume, section and number (today only RRC/Price numbers go through `referenceNumber`).
3. `extension/popup.html`: at the top of the form, before the catalogue row:
   ```html
   <div class="quick-row"><label for="quick-reference">Reference</label><input id="quick-reference" name="quick" maxlength="120" autocomplete="off" spellcheck="false" placeholder="RIC I² Nero 306 · Crawford 44/5 · Price 23" aria-describedby="quick-help"><p id="quick-help" class="field-hint">Type a whole reference, or use the fields below.</p></div>
   ```
   `extension/popup.css`: `.quick-row {margin-bottom:12px;}` and `.quick-row input {font-family:Consolas,"Liberation Mono",monospace; font-weight:600;}`.
4. `extension/popup.js`:
   - Import `parseReference`. `const QUICK_ERROR = 'Couldn’t read that reference. Try “RIC I² Nero 306”, “Crawford 44/5” or “Price 23”, or use the fields below.';`
   - `applyQuickReference()` returns `true` when the box is empty or parses (then it sets catalogue, number, and for RIC volume and section, and calls `updateFields()`), `false` when it doesn't parse.
   - The box's `change` event applies it and saves preferences when it parses (so the fields show what was understood before Look up).
   - Submit handler, all synchronous before the first await: `preventDefault`; `if (!applyQuickReference()) { clearOutput(); showError(QUICK_ERROR); return; }` (no permission request, no network); then `requestHostAccess(...)`, `savePreferences()`, await access, run the lookup as today.
   - Editing any guided field or changing the catalogue clears the one-box, so a stale one-box value can never override a correction.
5. Version 0.5.0: manifests `version`, `tests/test_packages.py` (version assertion and ZIP name), every `0.4.1` in README/INSTALL/install page; README "What it does" gains `- One **Reference** box: type \`RIC I² Nero 306\`, \`Crawford 44/5\` or \`Price 23\` and the fields fill in.`; INSTALL "What to try" gains `- Type **RIC I² Nero 306** in the Reference box and select **Look up**; the RIC fields fill in and the type resolves.`; the install page's "What to try" paragraph mentions the Reference box. Remove stale `dist/giga-pinax-*-0.4.1.zip`.

**Tests — append to `tests/lookup.test.mjs`** (extend the import with `parseReference`):

```js
test('parseReference reads whole RIC, RRC and Price references', () => {
  const ric = (volume, section, number) => ({ catalogue: 'RIC', volume, section, number });
  const cases = [
    ['RIC I² Nero 306', ric('I (2nd edition)', 'Nero', '306')],
    ['RIC I (2nd ed.) Nero 306', ric('I (2nd edition)', 'Nero', '306')],
    ['ric 1(2) nero 306', ric('I (2nd edition)', 'nero', '306')],
    ['RIC I 2nd edition Nero 306', ric('I (2nd edition)', 'Nero', '306')],
    ['RIC I (second edition) Nero 306', ric('I (2nd edition)', 'Nero', '306')],
    ['RIC II.3 Hadrian 12', ric('II, Part 3', 'Hadrian', '12')],
    ['RIC II, Part 3 (2nd ed.) Hadrian 12', ric('II, Part 3 (2nd edition)', 'Hadrian', '12')],
    ['RIC 2/3² Hadrian 12', ric('II, Part 3 (2nd edition)', 'Hadrian', '12')],
    ['RIC vol. IV Septimius Severus 266', ric('IV', 'Septimius Severus', '266')],
    ['RIC IV Septimius Severus 266 (aureus)', ric('IV', 'Septimius Severus', '266 (aureus)')],
    ['RIC VII Antioch 1', ric('VII', 'Antioch', '1')],
    ['RIC IX Antioch 56A', ric('IX', 'Antioch', '56A')],
    ['Crawford 44/5', { catalogue: 'RRC', number: '44/5', volume: '', section: '' }],
    ['RRC 44/5', { catalogue: 'RRC', number: '44/5', volume: '', section: '' }],
    ['cr. 197-198B/1a', { catalogue: 'RRC', number: '197-198B/1a', volume: '', section: '' }],
    ['  Price   23 ', { catalogue: 'Price', number: '23', volume: '', section: '' }],
    ['"Price 3a"', { catalogue: 'Price', number: '3a', volume: '', section: '' }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseReference(text), expected, text);
  for (const text of ['', 'hello', 'RIC Nero 306', 'RIC I Nero', 'Sear 1234', 'Price', 'Crawford', 'RIC XI Nero 1']) {
    assert.equal(parseReference(text), null, text);
  }
});

test('a parsed one-box reference feeds buildQuery the OCRE title shape', () => {
  assert.deepEqual(buildQuery(parseReference('RIC I² Nero 306')), { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' });
  assert.deepEqual(buildQuery(parseReference('RIC II, Part 3 (2nd ed.) Hadrian 12')), { corpus: 'ocre', query: 'RIC II, Part 3 (second edition) Hadrian 12' });
  assert.deepEqual(buildQuery({ catalogue: 'RIC', volume: 'I (2nd edition)"', section: '"Nero', number: '306"' }), { corpus: 'ocre', query: 'RIC I (second edition) Nero 306' });
});

test('an exact title found only by the CRRO plain fallback survives the group filter', async () => {
  const fetchImpl = fakeFetch({
    'crro/apis/search?q=%22': '<feed></feed>',
    'crro/apis/search?q=': '<feed><entry><title>RRC 44/5</title><id>rrc-44.5</id></entry><entry><title>RRC 480/5</title><id>rrc-480.5</id></entry></feed>',
    'crro/id/rrc-44.5.jsonld': fixture('crro-rrc-44-5.jsonld'),
  });
  const result = await lookupType({ catalogue: 'RRC', number: '44/5' }, { fetchImpl, cache: new Map() });
  assert.equal(result.status, 'ok');
  assert.equal(result.card.label, 'RRC 44/5');
});
```

**Verify:** new tests fail first for the expected reasons; then Node suites 40/40, Python OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check extension/popup.js`, and `git grep -n "0\.4\.1" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing.

**Commit** the eleven files: `Add one-box reference entry and release 0.5.0`.

## Verification (controller, never-cached origin)

Typing `RIC I² Nero 306` and pressing Enter fills RIC / `I (2nd edition)` / `Nero` / `306` and resolves; `Crawford 44/5` switches to RRC and resolves; `Price 23` resolves; `Sear 1234` shows the one-box error with no network request; editing the number field after a one-box lookup clears the box; RIC `II.3 Hadrian 12` offers `RIC II, Part 3 (second edition) Hadrian 12` as a suggestion or resolves; 400 px; console clean.
