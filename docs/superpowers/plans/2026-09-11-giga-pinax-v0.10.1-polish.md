# Giga Pinax v0.10.1 Polish Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Clear the small, low-risk review minors that have accumulated in backlog item 7 — accessibility, visible feedback, docs accuracy and two code tidy-ups — without changing lookup or price behaviour.

## Global Constraints

- No change to what is requested from numismatics.org, nomisma.org or acsearch, or when. No new permissions, dependencies or files. `textContent`/`value`/attributes only.
- Version `0.10.1` in manifests, package test and docs (digit-bounded stale check `(^|[^0-9.@])0\.10\.0`).
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output. When editing text that contains typographic characters, copy them from the file, and never write a literal control character into any file.

---

### Task 1: ten small fixes, 0.10.1

**Files:** `extension/popup.html`, `extension/popup.js`, `extension/lookup.js`, `tests/lookup.test.mjs`, `install/index.html`, `install/styles.css`, `README.md`, `docs/INSTALL.md`, `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`.

**Behaviour**

1. `QUICK_ERROR` names SC too: `Couldn’t read that reference. Try “RIC I² Nero 306”, “Crawford 44/5”, “SC 1266.2” or “Price 23”, or use the fields below.` (The Reference-box placeholder stays as it is — it is already near the input's width.)
2. `install/index.html` "What to try" mentions `SC 1266.2` alongside the other examples.
3. **Copy summary shows visible feedback:** on success the button's text becomes `Copied` for 2 seconds, then returns to `Copy summary`; the announcement stays `Summary copied.` A failure leaves the button text unchanged and announces as today. A new copy within the 2 seconds restarts the timer.
4. **The copy state holds its card:** the state set in `renderPrices` includes the rendered card, and the Copy handler uses that card, not `currentCard`.
5. README's Copy summary bullet says it copies the type, median, middle 50%, sale count, search term, years, type link and any prices it couldn't count. INSTALL says "Select **Copy summary** at the bottom of the prices panel and paste it anywhere."
6. **The candidate list has an accessible name:** give the "Did you mean:" paragraph `id="candidates-label"` and `#candidate-list` `aria-labelledby="candidates-label"`.
7. **`aria-invalid` only when the reference was not found:** the not-found message and the one-box error keep marking their field invalid; the network error and the permission message no longer set `aria-invalid` on `#reference-number` (they still show in `#form-error`).
8. `install/styles.css`: delete the dead `.try-it a` rule (the install page no longer has a link there — confirm with a search before deleting).
9. **The nomisma label cache is read once per popup:** `labelCache` in `popup.js` loads the stored object once at start-up into memory; `get` reads memory; `set` updates memory and writes it back to `localStorage` (still tolerating storage errors).
10. **`resolveLabels` has option defaults:** `resolveLabels(slugs, { fetchImpl = fetch, cache = new Map(), signal } = {})`, so a direct call without a cache works.
11. Version 0.10.1: manifests `version`; `tests/test_packages.py` version assertion and ZIP name; every `0.10.0` in README/INSTALL/install page → `0.10.1`. Remove stale `dist/giga-pinax-*-0.10.0.zip`.

**Test — append to `tests/lookup.test.mjs`** (extend the import with `resolveLabels` if needed; `fakeFetch` and `fixture` exist):

```js
test('resolveLabels works without a cache argument', async () => {
  const fetchImpl = fakeFetch({ 'nomisma.org/id/nero.jsonld': fixture('nomisma-nero.jsonld') });
  assert.deepEqual(await resolveLabels(['nero', 'missing'], { fetchImpl }), { nero: 'Nero' });
});
```

**Verify:** the new test fails first; then Node suites 58/58, Python OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check extension/popup.js`, the digit-bounded `0.10.0` grep prints nothing, and `git grep -nP '[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}]' -- ':!*.png' ':!*.zip'` prints nothing (no literal control characters).

**Commit** the eleven files: `Polish accessibility, copy feedback and docs; release 0.10.1`.

## Verification (controller, never-cached origin, acsearch and clipboard stubbed)

Result 2026-09-11 at `e610bfe`, in-app Chromium at 400×600 on `http://localhost:8788` (never loaded before), live numismatics.org, acsearch and `navigator.clipboard.writeText` stubbed:

- `Sear 1234` → `Couldn’t read that reference. Try “RIC I² Nero 306”, “Crawford 44/5”, “SC 1266.2” or “Price 23”, or use the fields below.`; `#quick-reference` `aria-invalid="true"`, `#reference-number` unmarked. Pass.
- numismatics.org requests forced to fail → `Couldn’t reach numismatics.org. Check your connection and try again.` with no `aria-invalid` on either field; `RRC 9999/9` → not-found message and `#reference-number` `aria-invalid="true"`. Pass.
- `RIC I Nero 306` → one suggestion `RIC I (second edition) Nero 306`; `#candidate-list` `aria-labelledby="candidates-label"` whose text is `Did you mean:`; number field unmarked. Pass. (A first attempt read the page while the previous not-found error was still showing — a harness race, re-run with a specific wait.)
- `SC 1266.2` with the prices panel → 0 `localStorage.getItem('giga-pinax-labels-v1')` reads during the lookup, 4 write-throughs for the new labels; 1 acsearch request. Pass.
- Copy summary → button `Copied`, announcement `Summary copied.`, copied first line `Seleucid Coins (part 1) 1266.2`; back to `Copy summary` after ~2.3 s. Copy then change currency → panel hidden and the button already reads `Copy summary`. Pass.
- 400 px; console clean.

Planned checks:

Copy summary relabels to `Copied` and back after ~2 s; `#candidate-list` has an accessible name "Did you mean:"; a network error leaves `#reference-number` without `aria-invalid` while a not-found error sets it; `QUICK_ERROR` names SC; the label cache performs one `localStorage` read per popup load; lookups and prices otherwise unchanged; 400 px; console clean.
