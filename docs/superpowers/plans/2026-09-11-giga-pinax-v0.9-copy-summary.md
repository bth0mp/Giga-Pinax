# Giga Pinax v0.9 Copy Summary and Unrecognised Prices

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** (1) A **Copy summary** button in the prices panel puts a plain-text summary of the result on the clipboard. (2) When acsearch returns prices the strict parser cannot count (an unknown format or another currency), show up to five of those raw price strings — in the "no hammer prices" note, and in the copied summary — so the collector can report the logged-in price format in one step. The logged-in format is still unobserved; this turns the first real run into actionable evidence.

## Global Constraints

- Nothing from acsearch is stored. Raw price strings are only shown transiently and copied when the collector presses **Copy summary**. Still one acsearch request per user action; no new permissions (clipboard `writeText` is used only inside the button's click handler).
- An "unrecognised" example is a raw `price` string that contains at least one digit and did not parse (strict parser or currency mismatch). Blank, `*`, and digit-free markers (e.g. `-`, `unsold`) are never examples. At most 5, in page order.
- Existing outcomes keep their shape; `examples` is added to the `unpriced` outcome **only when non-empty**.
- Version `0.9.0` in manifests, package test and docs (digit-bounded stale-version check).
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output.

---

### Task 1: uncounted examples, `summaryText`, Copy button, 0.9.0

**Files:** `extension/prices.js`, `tests/prices.test.mjs`, `extension/popup.html`, `extension/popup.css`, `extension/popup.js`, `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`, `README.md`, `docs/INSTALL.md`, `install/index.html`.

**Behaviour**

1. `extension/prices.js`
   - `summarise(lots, currency)` also returns `uncounted`: raw `price` strings of lots that were not counted, contain at least one digit, first 5 in page order.
   - `fetchPrices` `unpriced` outcome becomes `{ status: 'unpriced', term, examples }` when `summary.uncounted` is non-empty, otherwise unchanged `{ status: 'unpriced', term }`.
   - `export function summaryText(card, summary, currency, term)` returns lines joined with `\n`:
     1. `card.label`
     2. `Median hammer {median} · middle 50% {lower}–{upper} · {n} {sale|sales} matching “{term}”` then ` · {earliest}–{latest}` (or ` · {year}` when equal, omitted when null)
     3. only if `summary.uncounted.length`: `Not counted: “a”, “b”`
     4. `https://numismatics.org/{card.corpus}/id/{encodeURIComponent(card.id)}`
     Amounts use `Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })`.
2. `extension/popup.html`: inside `#prices-panel`, after `#price-note`: `<button id="copy-summary" class="text-button copy-button" type="button">Copy summary</button>`. `extension/popup.css`: `.copy-button {padding:8px 0 0;}`.
3. `extension/popup.js`
   - `renderPrices` keeps the rendered `summary`, `currency` and `term` in module state for the button (cleared by `clearPrices()`).
   - Copy click: `navigator.clipboard.writeText(summaryText(currentCard, lastSummary, lastCurrency, lastTerm))`; on success `#announcement` = `Summary copied.`; on failure (rejected promise or no clipboard API) `#announcement` = `Couldn’t copy the summary.` Nothing else changes on failure.
   - The unpriced note appends, when `outcome.examples` exists, ` Unrecognised prices: “a”, “b”.` (typographic quotes, comma-separated) after the existing sentence.
4. Version 0.9.0: manifests; `tests/test_packages.py` version assertion and ZIP name; every `0.8.0` in README/INSTALL/install page. README "What it does" gains `- **Copy summary** copies the type, median, middle 50%, sale count, search term and type link as plain text.`; INSTALL "What to try" gains `- Select **Copy summary** under the median and paste it anywhere.` and, under the sign-in bullet, `- If the popup says no hammer prices could be counted, it quotes up to five prices exactly as acsearch showed them — send that line so the price reader can learn the format.` Remove stale `dist/giga-pinax-*-0.8.0.zip`.

**Tests — `tests/prices.test.mjs`**

Extend the import with `summaryText`. The currency-mismatch case in the existing `fetchPrices` test (`lot('200 EUR')`, `lot('300 EUR')` with `currency: 'USD'`) now expects `{ status: 'unpriced', term, examples: ['200 EUR', '300 EUR'] }`; update only that expectation. Append:

```js
test('summarise lists up to five raw prices it could not count, skipping blanks, * and digit-free markers', () => {
  const lots = [lot('100'), lot(''), lot('*'), lot('-'), lot('1.200,- €'), lot('3000 CHF (3300 USD)'), lot('abc'), lot('x1'), lot('x2'), lot('x3'), lot('x4')];
  assert.deepEqual(summarise(lots, 'USD').uncounted, ['1.200,- €', '3000 CHF (3300 USD)', 'x1', 'x2', 'x3']);
  assert.deepEqual(summarise([lot('100'), lot('')], 'USD').uncounted, []);
});

test('fetchPrices quotes unrecognised prices only when there are some', async () => {
  const page = (lots) => `<script>acsearch.initSearchResults = ${JSON.stringify(lots)};</script>`;
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot('1.200,- €'), lot('')])) }), { status: 'unpriced', term: 'q', examples: ['1.200,- €'] });
  assert.deepEqual(await fetchPrices({ term: 'q', currency: 'USD' }, { fetchImpl: fakeFetch(page([lot(''), lot('-')])) }), { status: 'unpriced', term: 'q' });
});

test('summaryText produces a shareable plain-text summary', () => {
  const amounts = ['90', '110', '135', '165', '180', '215', '245', '310', '450'];
  const summary = summarise(amounts.map((price, i) => lot(price, `01.01.${2020 + (i % 4)}`, String(i))).concat([lot('1.200,- €')]), 'USD');
  assert.equal(summaryText({ label: 'Price 23', corpus: 'pella', id: 'price.23' }, summary, 'USD', 'Price 23'), [
    'Price 23',
    'Median hammer $180 · middle 50% $135–$245 · 9 sales matching “Price 23” · 2020–2023',
    'Not counted: “1.200,- €”',
    'https://numismatics.org/pella/id/price.23',
  ].join('\n'));
  const one = summarise([lot('500', '01.01.2024')], 'CHF');
  assert.equal(summaryText({ label: 'RRC 1/1', corpus: 'crro', id: 'rrc-1.1' }, one, 'CHF', 'Crawford 1/1'), [
    'RRC 1/1',
    'Median hammer CHF 500 · middle 50% CHF 500–CHF 500 · 1 sale matching “Crawford 1/1” · 2024',
    'https://numismatics.org/crro/id/rrc-1.1',
  ].join('\n'));
});
```

(`lot(price, date, id)` and `fakeFetch` already exist in that file.)

**Verify:** new tests and the updated expectation fail first for the expected reasons; then Node suites 48/48, Python OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check extension/popup.js`, and `git grep -nE "(^|[^0-9.@])0\.8\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing.

**Commit** the eleven files: `Add Copy summary, quote unrecognised prices, release 0.9.0`.

## Verification (controller, never-cached origin, acsearch stubbed, clipboard stubbed)

Result 2026-09-11 at `b0d5940`, in-app Chromium at 400×600 on `http://localhost:8785` (never loaded before), numismatics.org live, acsearch and `navigator.clipboard.writeText` stubbed:

- Look up `Price 23` with nine priced lots plus `1.200,- €` → period `9 sales matching “Price 23” · 2020–2023 · 1 not counted`; 1 acsearch request.
- Copy summary → captured text exactly `Price 23` / `Median hammer $180 · middle 50% $135–$245 · 9 sales matching “Price 23” · 2020–2023` / `Not counted: “1.200,- €”` / `https://numismatics.org/pella/id/price.23`; announcement `Summary copied.`; no extra acsearch request.
- `writeText` rejecting → announcement `Couldn’t copy the summary.`
- Page of `1.200,- €`, `200 EUR` and a blank → note `No hammer prices among the sales acsearch returned for “Price 23”. Unrecognised prices: “1.200,- €”, “200 EUR”.`, panel hidden, 1 request.
- 400 px; console clean. Pass.

Planned checks:

With `navigator.clipboard.writeText` wrapped to capture its argument: Look up Price 23 with nine priced lots plus `1.200,- €` → period line ends `· 1 not counted`; Copy summary → captured text equals the four expected lines and the announcement reads `Summary copied.`; with `writeText` rejecting → `Couldn’t copy the summary.`; a page of only `1.200,- €` and `200 EUR` → note `No hammer prices among the sales acsearch returned for “Price 23”. Unrecognised prices: “1.200,- €”, “200 EUR”.`; exactly one acsearch request per action; 400 px; console clean.
