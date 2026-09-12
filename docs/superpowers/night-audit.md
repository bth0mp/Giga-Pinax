# Giga Pinax night audit — 2026-09-12

Whole-extension read at 0.20.0 (`b4c0444`), nothing changed. Covers `extension/*.js`, `popup.html`, `popup.css`, the six
`tests/*.test.mjs` files, the two Python test files, and `docs/ideas-backlog.md` item 7.

State on arrival: `node --test tests/*.test.mjs` → **157 pass, 0 fail**. (`node --test tests/` fails, because it tries to run
the two `.py` files as Node tests — the README's explicit file list at line 37 is the working command.)

Findings marked **(verified)** were reproduced by running the module against the repo's own fixtures.

---

## 1. Correctness risks still open

Ranked by how likely each is to put a wrong coin or a wrong price in front of the collector.

### 1.1 A comma inside a RIC volume title silently drops the whole RIC reference — **(verified)**

`extension/lot.js:90` (`pieceAfter`, `let ended = typed`), with `extension/lot.js:18` (`SEP` splits on `", "`) and
`extension/lot.js:155` (`kept` drops a piece with no digit).

For a typed catalogue `ended` starts `true`, so no later chunk is ever appended; if the first chunk holds no digit the
reference ends up as bare `"RIC VII"` and is dropped for having no digit. Reproduced:

| lot text | references found |
| --- | --- |
| `Constantine. RIC VII, Treveri 368; LRBC 45.` | **none** |
| `Vespasian. Denarius. RIC II, Part 1 (second edition) 1073; RSC 43.` | `RSC 43` only |
| `Hadrian. RIC II, Part 3 (second edition) 1234; BMC 1.` | `BMC 1` only |
| `Vespasian. Denarius. RIC II.1 1073; RSC 43.` | both (works) |

The second row is OCRE's *own* title spelling. The first row is ordinary dealer house style. Worse, a short line like
`Constantine. RIC VII, Treveri 368; LRBC 45.` is not long enough and names too few keys to be lot text, so `isLot`
(`extension/lot.js:174`) is false, `parseReference` fails, and the collector gets `QUICK_ERROR` ("Couldn't read that
reference") for a perfectly normal citation. Sketch of a fix: when the first chunk matched `WORDS` rather than `BODY` (no
digit yet), keep appending chunks until one carries a digit, then apply the `ended` rule.

### 1.2 A description that opens with provenance loses every reference — **(verified)**

`extension/lot.js:24` (`PROVENANCE`) with `extension/lot.js:135` (`text = cut ? cleaned.slice(0, cut.index) : cleaned`).

The cut is unconditional, so a provenance sentence at position 0 truncates the lot to the empty string. Reproduced:

- `Ex CNG 100, lot 55. Trajan. Denarius. RIC 128; RSC 1.` → **none**
- `From the Giga Collection. Trajan. Denarius. RIC 128; RSC 1.` → **none**
- `Provenance: Leu 5.⏎Trajan. Denarius. RIC 128; RSC 1.` → **none**
- `Trajan. Denarius. RIC 128; RSC 1. Ex CNG 100, lot 55.` → both (works)

Many houses lead with the pedigree. The visible result is `NO_REFERENCES_MESSAGE` with no hint why. A cut at index 0 —
or one that leaves no key behind — should be ignored, or the provenance span should be excised rather than everything
after it.

### 1.3 The median is computed over lots that never cite the type — **(verified)**

`extension/prices.js:31-33` — `extractLots` keeps only `id`, `title`, `date`, `price` and throws away the `description`
field that acsearch already ships in the same inline JSON.

In the repo's own `tests/fixtures/acsearch-search-nero-306.html`, **1 of the 3 lots is not the type at all** (an RPC I
3648 Cappadocian drachm of Nero, matched because acsearch ANDs loose words). Nothing on the panel tells the collector
that a third of the median's basis is a different coin. This is the largest wrong-price risk in the extension, and the
fix is cheap because the data is already in hand and `findReferences` already knows how to read a lot description — see
design idea 2.

### 1.4 An unmarked price is accepted as whatever currency is selected

`extension/prices.js:50-63` (`parsePrice`), with the standing ponytail note at `extension/prices.js:49`.

`marks.length === 0` skips the currency check entirely, so a bare `1 500` counts and is then formatted with the chosen
currency at `extension/popup.js:385`. The signed-in acsearch price format is still unconfirmed (backlog "In flight"),
so the very first Premium run is also the first test of this assumption. Worth a defensive step before that run: when
*no* lot on a page carries a currency mark, say so on the panel rather than assuming the selected currency.

### 1.5 The nomisma label cache returns inherited `Object.prototype` keys

`extension/popup.js:57` — `get(slug) { return this.labels[slug]; }` on a plain object.

A slug of `constructor`, `toString` or `valueOf` returns a function, which `resolveLabels`
(`extension/lookup.js:317`) then stores as a label and `toCard` (`extension/lookup.js:266`) puts into the card's
authority / denomination / mint / material line. One word fixes it (`Object.hasOwn`), matching the care already taken at
`extension/popup.js:249` and `extension/catalogues.js:106`. Listed in backlog item 7, still open.

### 1.6 "Summary copied." is announced even when the panel changed mid-copy

`extension/popup.js:709` sets the announcement *before* the `shownPrices !== shown` guard at `extension/popup.js:710`.
Backlog item 7, still open; a two-line reorder.

### 1.7 "Found X." is announced twice on the no-access path

`extension/popup.js:255` (`renderCard`'s `announce`) then `extension/popup.js:513`
(`announce(\`Found ${…}. ${ACCESS_HINT}\`)`). Backlog item 7, still open.

### 1.8 A candidate or chip label that doesn't parse leaves the guided fields stale

`extension/popup.js:271` and `extension/popup.js:288` both guard `fillFields` behind `if (parsed)`. The repair in
`run()` (`extension/popup.js:492-497`) covers `ocre`, `pella`, `other` and BIGR cards but **not `crro` or `sco`**, so a
CRRO or SCO card whose label ever fails `parseReference` prices the previous reference's term. Backlog item 7, still
open; the corpus gap is new.

### 1.9 A changed acsearch page reads as a network outage

`extension/prices.js:21-24` keys everything on the literal marker `acsearch.initSearchResults = `; a miss returns
`null`, and `extension/prices.js:290` turns that into `status:'network'` unless the page happens to say "No results
found". If acsearch renames the variable, every price check reports "Couldn't reach acsearch" for a page that loaded
perfectly. A distinct `status:'unreadable'` with its own message would stop the collector chasing their connection.

### 1.10 "Last sale" comes from the whole page while the rest follows the period

`extension/popup.js:406` (`lastSale(page)`) against `extension/popup.js:389` (`summary` from
`lotsInPeriod`). A "Last 2 years" period with no counted sale renders `No sales with a price in the last 2 years.`
(`extension/popup.js:402`) directly above a `Last sale 12.03.2019 · $180` row. Deliberate per the comment at
`extension/popup.js:381-383`, but the two lines contradict each other on screen.

### 1.11 `verifyBop` truncates at 24 hits without saying so

`extension/lookup.js:383` with `VERIFY_LIMIT` at `extension/lookup.js:26`. A bare series with more than 24 BIGR hits can
return `none` while the real match sat at position 25. Backlog item 7 already asks for a note at the `none` return
(`extension/lookup.js:409`); still open.

### 1.12 "Titus 1073" is silently re-filed under a volume, then filtered out by its own ruler — **(verified)**

`extension/popup.js:139` (`fillFields` applies `volumeFor(parsed.section, '')`) then `extension/lookup.js:464`
(`byRuler` in `pickRic`).

A typed `Titus 1073` becomes `RIC II.1² Titus 1073`; the real coin is `RIC II.1² Vespasian 1073` (Titus as Caesar).
Verified against `tests/fixtures/ocre-search-titus-1073.xml`: the exact search misses, and only OCRE's loose fallback
rescues it as a bare `Did you mean: RIC II, Part 1 (second edition) Vespasian 1073` — with no word about why Titus
turned into Vespasian. The lot-text path handles this correctly (facet search,
`extension/lookup.js:485-490`); the typed path does not. This is exactly the collector's open offer — see design idea 1.

---

## 2. Accessibility and UX in the popup at 400 px, both themes

Measured contrast ratios below are computed from the tokens at `extension/popup.css:5-7` (light) and
`extension/popup.css:16-18` / `:23-25` (dark).

### 2.1 The theme toggle's accessible name never changes — WCAG 2.5.3

`extension/popup.html:21` carries a static `aria-label="Dark theme"`; `extension/popup.js:73` updates only `title`. The
visible label (the tooltip, "Switch to light theme") is therefore not contained in the accessible name, so voice control
cannot hit the control by what it says, and a screen reader announces the wrong direction. Same one-line fix as the
`title` line already does.

### 2.2 `#pop-out` has the same mismatch

`extension/popup.html:18` — name "Open in a window", visible tooltip "Open in a window you can resize". Lower stakes,
same rule.

### 2.3 Recent chips and unchecked period pills have no visible boundary — WCAG 1.4.11

`extension/popup.css:85` (`.recent-list button`) and `extension/popup.css:114` (`.period label`) rely on
`--line` + `--soft`:

| pair | light | dark |
| --- | --- | --- |
| `--line` on `--bg` | **1.28:1** | **1.39:1** |
| `--line` on `--card` | **1.43:1** | **1.31:1** |
| `--soft` on `--bg` | **1.08:1** | **1.15:1** |

Both the border and the fill are effectively invisible, so the chips and the two unchosen period pills read as plain
text rather than controls. The chosen pill is fine (accent fill). 3:1 on the border would fix both.

### 2.4 The result card has no edge in the dark theme

`extension/popup.css:87` (`.result`) is separated from the page only by a `--line` border at **1.31:1**, and
`--shadow` is `none` in dark (`extension/popup.css:18`, `:25`). In light the card at least gains 1.11:1 of fill
difference plus the shadow; in dark there is nothing.

### 2.5 The price check announces itself twice on every keystroke

`extension/popup.html:51-52` — `#check-result` is `aria-live="polite"` *and* the `aria-describedby` target of
`#check-amount`. Typing "500" speaks the full "Higher than 4 of 9 sales, 1.2× the median" on each character, and the same
text is re-read as the field's description on focus. Drop one of the two roles.

### 2.6 Two touch targets under 24 × 24 CSS px — WCAG 2.5.8

- `extension/popup.css:151` `.copy-button {padding:8px 0 0}` → roughly 22 px tall (12 px text, no bottom padding).
- `extension/popup.css:156` `.popup-footer a {padding:4px 0}` → roughly 22 px tall.

Everything else clears it (`.candidate-list .text-button` ≈ 30 px, `summary` 40 px, `.type-link` ≈ 26 px).

### 2.7 The selected sales period depends entirely on `:has()`

`extension/popup.css:116` is the only rule that marks the chosen pill, and the radio itself is `opacity:0`
(`extension/popup.css:118`). On an engine without `:has()` there is *no* indicator of which period is active — not a
weaker one, none. A `:checked + span` fallback or a plain `aria-pressed`-style class set from
`extension/popup.js:694` would be belt-and-braces.

### 2.8 Nothing reflows at large text

`extension/popup.css:31` fixes `body {width:400px}`, and `extension/popup.css:64`
`.search-row {grid-template-columns:minmax(60px,1fr) auto}` gives the "Look up" button (icon + label) its intrinsic
width first. At 200 % text the reference input collapses toward its 60 px floor while the button grows. The windowed
mode inherits the same grid, where reflow *is* expected. Likewise `extension/popup.css:62`
`.catalogue-row {1fr 91px}` — the hard 91 px column clips the word "Currency" before it clips "USD".

### 2.9 The only breakpoint is unreachable in the popup

`extension/popup.css:161` `@media (max-width:359px)` never fires at 400 px, and
`extension/popup.css:52` `.windowed body {min-width:360px}` forces a horizontal scrollbar the moment the window is
dragged under 360. Nothing is tuned between 360 and 400, which is where the popup actually lives.

### 2.10 Two ways of speaking, so the lot note leaks and drops unpredictably

`extension/popup.js:46` defines `announce()` (which prefixes `lotNote`), but eight places write
`$('announcement').textContent` directly — `extension/popup.js:341`, `:446`, `:470`, `:633`, `:644`, `:660`, `:709`,
`:715`. The result is that "3 references found in this text." is prefixed to some later messages and dropped from
others, and a currency change after a lot lookup repeats the lot count. One writer, one rule.

### 2.11 A sales row never says which coin it is

`extension/popup.js:432` renders `sale.title || \`Lot ${sale.id}\``, and acsearch's `title` is only the auction house
and lot number ("Lucernae, Auction 31, Lot 298"). The `description` that names the coin, its metal, its grade and its
reference is discarded at `extension/prices.js:31`. "Inspect sales" is therefore a list the collector cannot inspect.

### 2.12 Minor

- `extension/popup.html:74` — `#announcement` carries both `role="status"` and `aria-live="polite"` (redundant), and
  `clearOutput()` (`extension/popup.js:191`) blanks it in the same task as the next write, which some AT coalesces away.
- `extension/popup.css:70`, `:108`, `:125`, `:150`, `:155` — a lot of 11 px `--muted` body copy. It passes AA
  (4.66:1 on `--bg`, 5.20:1 on `--card`) but 11 px is small for the age profile of a coin catalogue's audience.
- The theme button's 1.43:1 hairline edge (`extension/popup.css:43`) is already noted in backlog item 7 as decorative.

---

## 3. Simplification (ponytail)

### Duplicated logic

1. **Year-range string, written twice** — `extension/prices.js:323` and `extension/popup.js:400` are the same
   `earliest === latest ? earliest : \`${earliest}–${latest}\``. Export one helper from `prices.js`.
2. **Plural "sale/sales", written twice** — `extension/popup.js:367` (`sales`) and `extension/prices.js:322`. Export
   `sales` from `prices.js` and delete the popup's copy.
3. **`squash` and `unpunctuate`, written twice each** — `extension/lookup.js:7` / `extension/prices.js:7`, and
   `extension/lookup.js:69` / `extension/lot.js:29` (with a gratuitous `.trim()` difference).
4. **The Crawford prefix alternation, five copies** — `extension/lookup.js:15` (`PREFIX.RRC`),
   `extension/lookup.js:44` (`SIMPLE_REFERENCE.RRC`), `extension/lookup.js:67` (`NAMED`),
   `extension/lot.js:11-13` (`KEYS`) and `extension/lot.js:84` (`TYPED_KEY_WORD`). One exported source string built
   into each regex would make "add a new Crawford spelling" a one-line change instead of a five-line hunt.
5. **`SUPPORTED` and `TYPED_KEY` are near-identical** — `extension/lookup.js:64` vs `extension/lot.js:173`, differing
   only by `Seleucid|` and the BIGR title. One of them should be derived from the other.
6. **Two "Other" text cleaners** — `extension/prices.js:88` (`otherParts`) re-splits on `;`, re-strips quotes and
   brackets, and re-normalises SG/KM, all of which `extension/lookup.js:101-103` (`otherPart`/`otherNumber`) already
   does. `otherParts` should consume the already-normalised number.
7. **Two sources for the default volume** — `extension/preferences.js:52` hardcodes `'I (2nd edition)'` where
   `extension/popup.js:622` uses `RIC_VOLUMES[0].value`. `preferences.js` already imports from `prices.js`; importing
   from `catalogues.js` costs nothing.
8. **Four parallel maps keyed by corpus/catalogue** — `extension/popup.js:21-24` (`CORPUS_NAME`, `NOT_FOUND_HINT`,
   `REFERENCE_LABEL`, `REFERENCE_HELP`). Two maps of small objects read better and cannot drift out of step.
9. **Dark tokens written out twice** — `extension/popup.css:13-20` and `extension/popup.css:21-26`, eleven tokens each.
   `light-dark()` per token deletes the second block entirely (Chromium 123+, Firefox 120+; both browsers in scope).
   Already backlog item 7.
10. **The theme rule in three places** — `extension/theme.js:6`, `extension/preferences.js:12` (`restoreTheme`),
    `extension/popup.js:78` (`applyStoredTheme`). Already backlog item 7. `theme.js` cannot import (pre-paint classic
    script), so the honest minimum is two.

### Dead or redundant

11. `extension/selection.js:5` — `export { MAX_LOT }` is a pass-through used only by `tests/selection.test.mjs:3`,
    which can import it from `lot.js` directly.
12. `extension/popup.js:530` — `runPrices` calls `clearPrices()` at line 529 (which does `priceRequestId += 1`)
    immediately before `const id = ++priceRequestId`. Every run burns two tickets; harmless, but it makes the race
    logic read as if it had a bug.
13. `extension/popup.css:73` — `text-overflow:ellipsis` on the `.ric-fields` selects is a no-op (a `<select>` clips,
    it does not ellipsise; the clipping actually comes from `minmax(0,1fr)`). Already backlog item 7.

### Tests that pin source text rather than behaviour

14. `tests/preferences.test.mjs:161-167` — asserts `theme.js` *contains* `"=== 'light'"`, `'dataset.theme = theme'` and
    the key literal. It proves nothing about behaviour and forbids harmless rewrites. A ~10-line test that evaluates the
    file against a stub `localStorage` and a stub `documentElement` and asserts the resulting `dataset.theme` for
    `'light'`, `'dark'`, `'Dark'`, `null` and a throwing storage would test the real thing. Already backlog item 7.
15. `tests/test_icons.py:32-37` — pins the SVG's exact path data (`d="M22 92 44 78 62 86 84 60 106 66"`), the `rx`/fill
    hex strings, and `self.assertEqual(3, svg.count('fill="#F1E7D8"'))`. Backlog item 9 is a Giga-branded icon set;
    this test will break on that redesign for no behavioural reason. The behavioural half is already in
    `IconFileTests.test_the_four_pngs_are_square_8_bit_rgba_at_their_sizes` and the Pillow re-render check.
16. `tests/test_packages.py:51` (and the zip names at `:118`) pin `"0.20.0"` — every release edits the test. Read the
    version from one manifest and assert the other matches it.

### The coverage hole

17. **`extension/popup.js` is 786 lines with no test file at all.** The six `.test.mjs` files cover the six pure
    modules; every render path, every `requestId` / `priceRequestId` race, `showLot`'s auto-open decision, the
    announcement logic and the whole permission dance are untested. Several findings above (1.5, 1.6, 1.7, 1.8, 2.10)
    live entirely in that file. A small `linkedom`/`happy-dom` harness — or just extracting the pure decision helpers
    (`rangePercent`, the "drawn from" string, the announcement text) into a testable module — would be the highest-value
    test work available.

---

## 4. Design ideas worth building, ranked by value against effort

### 1. "Listed under Vespasian" — the section-mismatch label *(the collector's open offer)*

**Value: high. Effort: small (one evening).** The single most confusing thing the extension currently does is turn a
typed `Titus 1073` into a "Did you mean: RIC II, Part 1 (second edition) Vespasian 1073" with no explanation
(finding 1.12). Every Caesar-period coin has this shape: Titus and Domitian as Caesar sit in the Vespasian section,
Gordian III as Caesar in his own, Valerian II under Valerian. The information needed is already on both sides — the
typed `section` from `currentReference()` and the card's own section from `parseReference(card.label)`. When they differ,
`renderCard` prints one line under the reference: *"Titus — listed under Vespasian in RIC II.1²."* The same comparison
drives the candidate list, so a "Did you mean" row reads *"RIC II.1² Vespasian 1073 — Titus as Caesar"* rather than
looking like a mistake. Going further, when the typed ruler yields nothing, retry once without the section before
reporting "not found", so the collector never sees a dead end for a coin that exists. No new network calls, no new
storage, one new line in the card.

### 2. Median from citing sales only *(the collector's open offer)*

**Value: very high. Effort: small-to-medium.** This is cheaper than it looks and fixes the biggest correctness risk
(1.3). acsearch already ships a `description` field per lot in the same inline JSON that `extractLots` parses — the full
dealer text, references included — and the extension already owns a parser for exactly that text (`findReferences` in
`lot.js`). Keep `description` at `extension/prices.js:31`, run each lot's description through `findReferences`, and mark
a lot **citing** when any reference it names matches the card's catalogue and number. Then offer the median two ways:
"All matches" and "Citing this reference", the second shown by default once it rests on enough sales
(`medianStrength`'s existing `>= 5` is the natural threshold). The panel gains one line — *"9 of 23 sales cite RIC I
306"* — which is the single most honest number the extension could show, and the "Inspect sales" rows can carry a
"cites" marker so the collector can audit it. The 1-in-3 miss rate in the repo's own fixture is the argument.

### 3. Surface the provenance instead of discarding it

**Value: medium. Effort: small.** `lot.js` already finds the provenance sentence and throws away everything after it —
and, per finding 1.2, throws away *everything* when it comes first. Fixing the bug and using the span are the same
change: excise the provenance span rather than truncating at it, then show what was excised as a card line,
*"Provenance: Ex CNG 100, lot 55."* Pedigree is a real part of a coin's value to a collector, it is the one piece of a
lot description the extension currently destroys, and the fix is a net line reduction. Pairs naturally with a future
Giga Collection, where the pedigree belongs on the stored coin.

### 4. Show the coin, not the lot number, in the sales list — with the thumbnail

**Value: medium-high. Effort: small.** The same `extractLots` change as idea 2 also unlocks `description` and `image`.
"Inspect sales" today reads "Lucernae, Auction 31, Lot 298" (finding 2.11); with the description it can read the first
clause of the actual coin line plus its grade, and acsearch's own `image` URL gives a 40 px specimen thumbnail per row.
That partly delivers "Other projects" item 5 (specimen photos) without touching OCRE/IIIF or adding a host permission,
since the images are on acsearch's own media host — though that host does need checking against the manifest's origins
before anything is fetched, and a row of images changes the popup's weight, so it belongs behind the existing
`<details>`.

### 5. Flag the outliers in the median

**Value: medium. Effort: small.** `summarise` already sorts the amounts and computes both quartiles, so an outlier test
is three lines (1.5 × IQR either side of the box, the standard rule). Mark those sales in the list and add a single
line — *"2 sales are far outside the middle 50%; median without them $165"* — rather than an on/off toggle, so the
collector sees both numbers at once and decides. A gold-plated or holed specimen at 8× the median is the most common way
an otherwise good median misleads.

### 6. Remember the last price check on each Recent chip

**Value: medium. Effort: small.** The Recent list already stores `{id, corpus, label}` per type
(`extension/preferences.js:61`); adding `{median, currency, count, checkedAt}` to the same entry costs one field and no
new request. The chip then carries a subtitle — *"$180 · 9 sales · 3 days ago"* — so the collector scanning a dealer's
page sees their last six valuations without opening any of them, and a stale one announces itself. It is also the
natural storage shape to grow into the Giga Collection, so building it here is not throwaway work.

### 7. Export the sales list

**Value: medium. Effort: small.** One `<a download>` with a Blob of the `summary.priced` rows as CSV — date, house, lot,
price, link, and (after idea 2) whether it cites. Extensions can download freely, unlike a hosted page. It costs almost
nothing, it gives the collector somewhere to put the data the extension cannot itself hold, and it is the cheapest
possible answer to "I want my own records" while the real Collection is still unbuilt.

### 8. The Giga Collection *(the collector's open offer)*

**Value: very high. Effort: large — a project, not a night.** Their own coins against today's median. The honest sketch:
a coin is a stored reference plus what they paid, when, and from whom, so the storage schema is the Recent entry
(idea 6) plus three fields and a note; the view is a table of coins with cost, latest median, and the gap. The hard
parts are not the UI. **(a)** Re-pricing N coins is N acsearch requests — the extension's whole discipline is one
request per user gesture, so a collection view must either price on demand, one row at a time, or ask for an explicit
"refresh all" with a visible count and a delay between requests; **(b)** `localStorage` is the wrong home for a
collection the collector cannot afford to lose, so this needs import/export (idea 7's CSV, read back) before it needs
anything else — losing a collection to a cleared profile would be worse than never having built it; **(c)** the median
is only as good as the term, and a portfolio that quietly totals 40 loose-term medians is a confident wrong number, so
idea 2 should land first and the collection should show the citing-sales count per row. Build 6 and 7 first; they are
the foundation and each is useful alone.

---

## Suggested order for the next nights

1. **lot.js fixes** — findings 1.1 and 1.2, with idea 3 folded into the second. Pure functions, fully testable, fixes
   two silent misses on ordinary dealer text.
2. **Keep `description` in `extractLots`** — unlocks ideas 2 and 4, and fixes finding 1.3.
3. **The "listed under" label** — idea 1, the collector's own offer, small and visible.
4. **The popup.js one-liners** — findings 1.5, 1.6, 1.7, 1.8, plus accessibility 2.1, 2.2, 2.5. All small, all in one
   file, and they clear most of backlog item 7's still-open list.
5. **Contrast and target sizes** — accessibility 2.3, 2.4, 2.6, 2.7. Token-level CSS work.
6. **A test harness for popup.js** — simplification 17, before the file grows further.
