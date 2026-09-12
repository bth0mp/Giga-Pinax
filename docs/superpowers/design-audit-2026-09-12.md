# Giga Pinax — design and usability audit, 2026-09-12

Read at 0.23.0 (`manifests/brave.json:4`), code untouched. Written for the collector, not for a developer:
every finding names what he sees and what he would do next.

Read but deliberately **not** re-litigated: `docs/superpowers/plans/2026-09-12-giga-pinax-v0.23-listed-under-label.md`
(the "Portrait of Titus, listed under Vespasian." line, shipping as 0.24), and the eight design ideas already
queued in `docs/superpowers/night-audit.md` §4 (citing-sales median, provenance line, coin thumbnails in the
sales list, outlier flag, per-chip medians, CSV export, the Giga Collection). Nothing below repeats those.

No browser was run. Layout heights and contrast ratios are computed from the rules and tokens in
`extension/popup.css`; each one says so. `popup.js` line numbers are as of the 0.24 working tree, which was
changing during the audit — the function names beside them are the reliable pointer.

---

## 1. The first ten seconds

### What is on screen, in order

Reading `extension/popup.html` top to bottom, a fresh install with the stored catalogue `Price` shows:

| # | Element | What it says |
| --- | --- | --- |
| 1 | `.popup-header` | icon, **Giga Pinax**, "Ancient coin reference" |
| 2 | `#pop-out` | window icon (no text) |
| 3 | `#theme-toggle` | moon icon (no text) |
| 4 | `#quick-reference` | label **Reference**, empty, caret in it, placeholder `Titus 123 · RIC 972 · Crawford 44/5 · Price 23` |
| 5 | `#quick-help` | "Type a whole reference, or use the fields below." |
| 6 | `#catalogue` | label **Catalogue**, showing `Price` |
| 7 | `#currency` | label **Currency**, showing `USD` |
| 8 | `#reference-label` + `#reference-number` | **Price number**, pre-filled `23` |
| 9 | `#lookup-button` | **Look up** |
| 10 | `#reference-help` | "Example: Price 23" |
| 11 | `.popup-footer` | "Type data: ANS OCRE, PELLA, CRRO, SCO & BIGR (ODbL)" · acsearch ↗ |

**Eight controls** (2, 3, 4, 6, 7, 8, 9, and the footer link). Choosing `RIC` or `Bop` adds two more —
`#ric-volume` (13 options) and `#ric-section` (a datalist of 150 ruler and mint names, or 48 Bactrian kings).

### What he does first, and what fights him

He types in the box with the caret. That is right, and it is the one thing the design gets unambiguously right.

Then he looks for the button — and **the button is not next to the box he typed in.** `#lookup-button` is
welded to `#reference-number` (`popup.html:38`), two fields lower, beside a number the tool filled in by
itself. Nothing on screen says that Enter in the top box works. It does (implicit form submission), but he
has to guess.

Three things compete with the one thing he came to do:

1. **A second reference field.** Two inputs, two labels, both about references: **Reference** and
   **Price number** (or "RIC number (including any suffix)", or "Reference, as the dealer cites it"). He has
   to decide which one is for him before he can start.
2. **A pre-filled number he did not type.** `DEFAULT_NUMBER.Price` is `'23'` (`extension/preferences.js:5`).
   Press **Look up** with the top box empty and the tool confidently opens *Price 23* — an Alexander
   tetradrachm nobody asked about. `applyQuickReference()` returns `true` for an empty box
   (`popup.js:149`), so the guided fields win by default.
3. **Two icon buttons at the top right of a toolbar popup.** `#pop-out` and `#theme-toggle` sit where the eye
   lands after the title, at equal weight with each other and with nothing else on the screen. One is used
   rarely; the other changes the colour scheme.

### Which controls a beginner never needs

Of the eight, he needs **two**: `#quick-reference` and `#lookup-button`.

- `#catalogue` — the one-box already reads `RIC`, `Crawford`, `Price`, `SC`, `Bop`, `SG`, `KM#` and 150+
  other catalogue names. The select exists for when parsing fails.
- `#currency` — affects nothing until a price panel exists, which is after the first lookup.
- `#ric-volume`, `#ric-section` — the one-box fills both from `Titus 123`.
- `#theme-toggle` — see §7.
- `#pop-out` — needs a card to be worth pressing.
- the footer acsearch link — a licence and a courtesy, not a task.

**The shape of the fix is in §6 idea 2:** one box, one button, everything else behind one fold that opens
itself when the box cannot read what he typed.

---

## 2. The paths through the tool

### 2.1 Type a reference

Works. Two failures worth naming.

**A reference that exists is reported as not existing.** Type `Titus 972`. `RIC_ANY_VOLUME`
(`lookup.js:59`) reads ruler `Titus`, no volume; `ricSearch` asks OCRE for `typeNumber:"972" AND "Titus"`;
RIC II.1² files that coin in the **Vespasian** section, so nothing comes back and he gets:

> `No RIC Titus 972 found in OCRE. Check the ruler, volume and number.`

The ruler is right, the number is right, and there is nothing to check. The same reference **inside pasted
lot text** opens RIC II.1² Vespasian 972, because the lot path asks the portrait facet as well
(`pickRulers`, `lookup.js:500`). **Two paths, same coin, opposite answers.** The 0.24 plan explains the card
once he reaches it; it does not get him there from the typed path. See §6 idea 4.

**An unreadable reference gets a five-example error and no echo.**

> `Couldn’t read that reference. Try “RIC 972”, “Titus 123”, “Crawford 44/5”, “SC 1266.2”, “Bop Euthydemus I 24A” or “Price 23”, or use the fields below.`

It never repeats what he typed, so he cannot see the typo it is complaining about.

### 2.2 Paste a whole lot

The paste handler (`popup.js:625`) flattens up to 3,000 characters into a **one-line** input roughly 40
characters wide, caret at the end. So a 1,200-character lot description shows its last forty characters —
usually the provenance tail. Nothing on screen says the paste landed, how much of it landed, or that
**Look up** will now do something different from usual. This is the loudest "did that work?" moment in the
tool. See §6 idea 6.

Press Look up and one of two things happens:

- References found → `#lot-refs` appears, headed `Found in this text:`, rows like
  `RIC 972 · Titus · prices only · cf. · var.` (`lot.js:310`). If exactly one row has type data it opens at
  once; otherwise he picks.
- Nothing found → `No catalogue references found in that text.` A flat dead end: no suggestion, no next
  step, and the box still holds 1,200 characters he now has to clear by hand.

**Where the lot path disagrees with itself:** pick a row that returns several candidates and the new list
appears **above** the list he just clicked in — `#candidates` is at `popup.html:41`, `#lot-refs` at `:42`.
The question appears above the answer he was giving.

### 2.3 The guided fields

**Two silent changes.** Type `Titus` into `#ric-section` and `#ric-volume` moves to `II.1²` by itself
(`popup.js:676`). Choose `RIC I²` while `Titus` is in the ruler box and the ruler box **empties itself**
(`popup.js:658`). Both changes are explained — but only to a screen reader, through `#announcement`:

> `Volume set to II.1² (2nd ed.).`
> `Ruler cleared: Titus is not in RIC I² (2nd ed.).`

A sighted collector watches his typing vanish with no explanation at all. See §6 idea 5.

**A catalogue change invents a reference.** Switch to `RRC` and the number field becomes `44/5`, the section
`Nero`→ cleared, and a line appears below:

> `Reference changed. Select “Look up” to check it.`

The tool has replaced his reference with one of its own and is inviting him to look it up.

**A browser bubble on a field he never touched.** The form is `novalidate` but `#reference-number` is
`required` and `reportValidity()` is called by hand (`popup.js:696`). Empty both boxes, press Look up, and
the browser's own "Please fill out this field" balloon points at the *lower* field.

### 2.4 A Recent chip

One click, no permission request (`openRecent`, `popup.js:297`). Three problems:

- **With host access revoked (Firefox), a chip shows the wrong reason:** `lookupById` fails and the message
  is `Couldn’t reach numismatics.org. Check your connection and try again.` — a connection error for a
  permission problem. (Known; `docs/ideas-backlog.md` item 7, still open.)
- **A chip whose label will not parse leaves the previous coin's price.** If `parseReference(entry.label)`
  returns null (an OCRE card whose label fell back to its id), the guided fields keep the *previous*
  reference, so `chooseTerm`, `#acsearch-link` and `#coinarchives-link` all describe the previous coin while
  the card shows this one. He sees a median for the wrong type with no way to tell.
- **Six chips can fill the whole popup.** `.recent-list button` is `white-space:nowrap` with
  `max-width:100%` (`popup.css:85`), so a chip reading `RIC II, Part 1 (second edition) Vespasian 972` takes
  a full row on its own. Six of those is roughly 180 px of chips. See §2.7 and §6 idea 8.

### 2.5 Right-click a selection on a sale page

`background.js` → `showInWindow` → a 440×680 window at `popup.html?window=1&q=…`, which calls
`requestSubmit()` **at page load** (`openFrom`, `popup.js:771`).

The permission request inside the submit handler is therefore **not inside a user gesture**. If Brave and
Firefox refuse it on that basis — worth testing in the browser, I could not — the collector's very first
right-click looks nothing up and instead shows:

> `Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it.`

Pressing Look up in that window then works. The message at least carries a next step, which is why this is a
stumble rather than a wall — but the first impression of the flagship feature is an error.

### 2.6 The pop-out window

`cardUrlFor` sends **corpus and id only** (`selection.js:33`). The new window re-fetches the type, then
re-fetches the prices. So popping out:

- costs **one more acsearch request** for a panel he is already looking at;
- loses whatever he typed into **Check a price**;
- loses an edited `#price-term` unless he had pressed **Get prices** (which is what saves it).

The period survives (stored). The card survives. Nothing warns him about the rest.

### 2.7 The step every path shares: the answer arrives off screen

Measured from `popup.css`, at the 400 px width and the `max-height:600px` cap (`popup.css:38`):

| Block | Height |
| --- | --- |
| `.popup-header` | ~57 px |
| `.reference-form` (Price) | ~250 px |
| `.reference-form` (RIC, `#ric-fields` shown) | ~316 px |
| `.recent` with six long chips | ~210 px |
| `.popup-footer` | ~40 px |

The scrolling area (`.popup-scroll`) gets about **503 px**. Form + a full Recent row is ~460 px, which
leaves ~43 px for `#result` — enough for the card's title and nothing else. The 44 px median
(`.median-line strong`, `popup.css:105`) sits roughly 120 px further down.

`run()` never scrolls. So the most common outcome of pressing **Look up** is that the number he came for is
below the fold and the screen looks unchanged. This is the cheapest fix in the document: §6 idea 1.

---

## 3. Wording

### 3.1 In `popup.html`

| id / place | String | Verdict |
| --- | --- | --- |
| `h1` + `p` | "Giga Pinax" / "Ancient coin reference" | Fine. |
| `#pop-out` | name "Open in a window", tooltip "Open in a window you can resize" | Name ≠ visible label (voice control cannot say it). Make both "Open in a window you can resize". |
| `#theme-toggle` | name "Dark theme", tooltip "Switch to dark theme" | Same mismatch, and the name never changes when the theme does. |
| `label[for=quick-reference]` | "Reference" | Fine. |
| `#quick-reference@placeholder` | `Titus 123 · RIC 972 · Crawford 44/5 · Price 23` | Good — four real shapes. |
| `#quick-help` | "Type a whole reference, or use the fields below." | **Weak.** Points at the fields nobody should need, and hides the two things that save time. → **"Type a reference and press Enter. ↑ brings back a recent one."** |
| `#catalogue` options | "Other (prices only)" | **Our words twice.** → **"Anything else — HGC, SNG, BCD, Sear, KM# (prices only)"**. |
| `label[for=currency]` | "Currency" | Fine, wrong place (§7). |
| `#volume-field` | "Volume / edition" | Fine. |
| `#section-label` | "Ruler or mint section" / "King" | Fine — "mint section" is his language. |
| `#lookup-label` | "Look up" / "Looking up…" | Fine. |
| `#candidates-label` | "Did you mean:" / "Choose a type:" | "Did you mean" is wrong for a partial RIC search, where every hit is a real coin. The code already switches to "Choose a type:" for those — correct as written. |
| `#lot-refs-label` | "Found in this text:" | Fine. → "References found in this lot:" is clearer next to a second list. |
| `.recent .field-hint` | "Recent" | Fine. |
| `legend` | "Sales period" (sr-only) | Fine. |
| `.metric-label` | "Median hammer price" | **Best string in the tool.** Keep. |
| `.metric-label` | "Middle 50% of sales" | Excellent — plain English for the interquartile range. Keep. |
| `label[for=check-amount]` | "Check a price" | Good. |
| `#check-amount@placeholder` | "e.g. 500" | Fine. |
| `#sale-details summary` | "Inspect sales" | "Inspect" is a laboratory word. → **"See the sales"**. |
| `#copy-summary` | "Copy summary" / "Copied" | Fine. |
| `label[for=price-term]` | "acsearch search" | **Weak** — names a site twice and the job not at all. → **"Words searched on acsearch"**. |
| `#prices-label` | "Get prices" / "Fetching…" | Fine. |
| `#sides-details summary` | "Obverse and reverse" | Fine. |
| `#type-link` | "Type ↗" | **Our jargon** (an ANS "type"). → **"ANS record ↗"**. |
| `#rpc-link` | "RPC online ↗" | Fine. |
| `#signin-link` | "Sign in ↗" | Fine in its sentence. |
| `#acsearch-link` | "Search on acsearch ↗" | Fine — but it has no `aria-label` while its twin `#coinarchives-link` gets "Search CoinArchives for Nero 306, opens a new tab". Give both the same treatment. |
| `#lookup-prompt` | "Reference changed. Select “Look up” to check it." | **Weak.** "Select" is not what he does to a button; "check it" could mean verify or price. → delete (§7), or **"Press Look up to see this coin."** |
| `#storage-note` | "Preferences couldn’t be saved. This popup still works, but your choices may reset when reopened." | Accurate, unactionable. See §7. |
| `noscript` | "Giga Pinax needs JavaScript to look up references." | Fine. |
| `.popup-footer` | "Type data: ANS OCRE, PELLA, CRRO, SCO & BIGR (ODbL)" | Five acronyms and a licence code, permanently. → **"Type data: ANS (ODbL)"**, acronyms in the `title`. |

### 3.2 In the JavaScript

| Constant / line | String | Verdict and rewrite |
| --- | --- | --- |
| `NETWORK_MESSAGE` | "Couldn’t reach numismatics.org. Check your connection and try again." | Fine. |
| `PERMISSION_MESSAGE` | "Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it." | Two site names he has no reason to know, and "again" implies he refused something he may never have seen. → **"Giga Pinax needs your permission to read coin types from the ANS databases. Press Look up and choose Allow — once only."** |
| `ACSEARCH_PERMISSION_MESSAGE` | "…Select “Get prices” again to allow it." | Same. → **"…Press Get prices and choose Allow — once only."** |
| `ACCESS_HINT` | "Select “Get prices” to let Giga Pinax fetch acsearch prices." | States a fact, hides the reason. → **"Prices need your permission the first time. Press Get prices and choose Allow."** |
| `SIGN_IN_MESSAGE` | "acsearch didn’t show prices. Sign in with an acsearch account that includes hammer prices, then select “Get prices”." | Good — has a next step. "didn't show prices" → **"acsearch listed the sales but hid the prices."** |
| `EMPTY_TERM_MESSAGE` | "Enter a search term for acsearch, such as “Nero 306”." | Fine. |
| `EMPTY_OTHER_MESSAGE` | "Enter a reference, such as “BCD Boiotia 174b”." | Fine. |
| `COPY_FAILED_MESSAGE` | "Couldn’t copy the summary." | Fact without a next step. → **"Couldn’t copy — select the text on the card instead."** |
| `QUICK_ERROR` | "Couldn’t read that reference. Try “RIC 972”, “Titus 123”, “Crawford 44/5”, “SC 1266.2”, “Bop Euthydemus I 24A” or “Price 23”, or use the fields below." | Five examples is a catalogue, not an error, and it never echoes the input. → **"Couldn’t read “{what he typed}”. Try the catalogue and number together, like “RIC 972” or “Crawford 44/5”."** |
| `NOT_FOUND_HINT.ocre` | "Check the ruler, volume and number." | **The worst message in the tool** — it is usually wrong (see §2.1). → **"RIC sometimes files a coin under another emperor. Clear the Ruler box and press Look up again."** |
| `NOT_FOUND_HINT.crro/pella/sco` | "Check the number." | Fine. |
| `NOT_FOUND_HINT.bigr` | "Check the king and Bop number." | Fine. |
| `too-many` | "{query} matches too many types to list. Type a ruler to narrow it down." | Good. Name the field exactly: **"…Type a name in Ruler or mint section to narrow it down."** |
| `OTHER_SUMMARY` | "No open type data for this reference. Prices from acsearch only." | **"Open type data" is ours, not his.** → **"Not in the free type databases — showing sale prices only."** |
| `NO_REFERENCES_MESSAGE` | "No catalogue references found in that text." | Dead end. → **"No catalogue reference in that text. If the dealer's number is in there, type just that part — for example “RIC 972”."** |
| `CHECK_MESSAGE` | "Enter an amount such as 500." | Fine. |
| empty prices | "acsearch returned no sales for “{term}”. Try a broader term." | "Broader" is vague. → **"acsearch found no sales for “{term}”. Try dropping the catalogue name — “Nero denarius” often finds what “Nero 306” misses."** |
| unpriced | "No hammer prices among the sales acsearch returned for “{term}”. Unrecognised prices: “…”." | The quoted list is developer diagnostics on his screen. See §7. |
| `REFERENCE_HELP.RIC` | "Example: 306 with Nero. Leave the ruler blank and choose Any volume to list every type with that number." | Two instructions in a hint under a field he should rarely see. Keep only the first sentence. |
| `REFERENCE_HELP.Other` | "Example: BCD Boiotia 174b; HGC 4, 1218. No type data, only acsearch prices." | Same jargon as `OTHER_SUMMARY`; same rewrite. |
| `REFERENCE_LABEL.RIC` | "RIC number (including any suffix)" | Fine. |
| `sale-strength` | "Solid: 22 sales, 2024–2026" / "Thin: 3 sales, 2019" | **Very good.** Honest and short. Keep. |
| `none` | "No sales with a price in the last 5 years." | Fine — the period buttons above are the next step. |
| `sale-period` | "Out of 100+ matches from the last 5 years for “Nero 306” · 3 without a price · 2 not counted" | Dense, and "not counted" is ours. → **"From 100+ acsearch matches for “Nero 306” (last 5 years). 3 unsold or unpriced; 2 prices we couldn’t read."** |
| `range-all` | "All 22 sales $81–$950" | Good. |
| `check-result` | "Higher than 4 of 9 sales, 1.2× the median" | Numbers without a verdict. → **"Above 4 of 9 sales — inside the middle 50%, 1.2× the median."** (See §4.) |
| `price-note` | "Hammer prices exclude buyer’s fees, tax and shipping. Only the 100 most recent sales are counted." | Correct and important. Fold it (§4). |
| `last-sale` | "Last sale 08.07.2026 · $180" | Fine. |
| `trendText` | "Last 2 years: $180 median, up 18% on earlier sales ($152)" | Good. |
| `lotLabel` flags | "prices only", "cf.", "var." | "cf." and "var." are **his** words — keep. "prices only" is ours → **"no type record"**, or a muted "prices" badge. |
| announcements | "Found X." / "N possible matches. Choose one." / "N references found in this text." / "Currency set to USD." / "Volume set to …" / "Ruler cleared: …" / "Summary copied." / "All: median $180 over 9 sales (moderate)." | See §5.3 — the problem is not the words, it is that several of them fight for one live region and two of them are the only explanation for a visible change. |

---

## 4. The prices panel

### What it shows at once

Inside `#prices-panel`, top to bottom: three period buttons; "Median hammer price" + a 44 px number;
`#sale-strength`; `#sale-trend`; `#last-sale`; `#sale-period`; "Middle 50% of sales" + two figures + "All 22
sales $81–$950" + a whisker drawing; **Check a price**; `#check-result`; "Inspect sales (22)";
`#price-note`; **Copy summary**. Then `#prices-form` and both outside-search buttons.

That is **around fifteen numbers** before anything is folded, and no fewer than eight of them are visible
above the one control that answers his actual question.

### Yes, it is too much — but the order is the real fault

His question is not "what is the median". It is **"the lot in front of me is £450 — is that dear?"**
He arrives holding the answer's input, and the panel asks for it last, at the bottom, after making him do
the arithmetic himself.

Three specific faults:

1. **The period buttons come before the number they filter.** Three controls stand between the panel's
   heading and its headline figure.
2. **Two lines silently disagree with the rest.** `#sale-trend` and `#last-sale` are computed from the whole
   page whatever period is chosen (`renderPrices`, `popup.js:416-426`), while everything else follows the
   period. Choose "Last 2 years" and "Last sale" may name a sale outside it. Nothing on screen says so.
3. **The verdict is left to him.** "Higher than 4 of 9 sales, 1.2× the median" is a measurement. He wants
   the sentence: is this cheap, normal, or dear.

### What should be visible first

1. **Check a price**, with the answer as a sentence naming the band:
   *"$450 — above 7 of 9 sales, over the middle 50%, 1.6× the median."*
2. **The median with its strength** — "Median hammer price $280 · Solid: 22 sales, 2024–2026".
3. **The middle 50% band**, the one picture worth keeping, with its "All 22 sales $81–$950" line.

### What should fold away

Into a single `<details>` reading **"More about these sales"**: `#sale-trend`, `#last-sale`, `#sale-period`,
`#price-note`, and the period buttons (with the chosen one named in the summary line, so "Last 2 years" is
never invisible). `#sale-details` ("Inspect sales") stays folded as it is. **Copy summary** moves beside the
median, where the thing being copied is.

That leaves three blocks on first sight instead of eleven, and puts his own price at the top of them.

Worth saying plainly: the 44 px median is the biggest thing in the extension, and it is the median of
*whatever acsearch returned for a text term*. The honest correction to that is already queued (citing-sales
median, `night-audit.md` §4.2) and is a prerequisite for trusting anything in this panel.

---

## 5. Accessibility, concretely

### 5.1 Tab order

No `tabindex` anywhere, so tab order is DOM order. On first open with `Price`:

`#pop-out` → `#theme-toggle` → `#quick-reference` → `#catalogue` → `#currency` → `#reference-number` →
`#lookup-button` → footer link.

**The Look up button is the seventh stop** (ninth with RIC's two extra fields). Enter in the Reference box
works, and is the only reasonable route, but nothing says so — `#quick-help` is the place to say it (§3.1).

**After a lot pick, the choices appear behind him.** `#candidates` (`popup.html:41`) precedes `#lot-refs`
(`:42`) in the DOM. Click a lot row, get candidates, and reaching them means **Shift+Tab backwards** past
the row he just pressed.

### 5.2 Focus visibility and focus loss

- **The ring is good.** `:focus-visible {outline:3px solid var(--focus); outline-offset:2px}`
  (`popup.css:37`). `--focus` against `--bg` is **9.5:1** light and **9.7:1** dark. No complaint.
- **Focus is dropped by `renderCandidates`.** Clicking a "Did you mean" row runs `run()` → `clearOutput()`,
  which hides `#candidates` — with the clicked button still inside it. The button becomes unfocusable and
  focus falls to `<body>`, so the next Tab restarts from `#pop-out` at the top of the popup.
  `renderRecent` already solves exactly this for chips (`popup.js:360-377`); `renderCandidates` never
  learned it. Lot rows survive, because `clearOutput()` leaves `#lot-refs` visible.
- **`clearLot()`** (`popup.js:307`) replaces the lot rows outright; if one had focus — a Recent chip clicked
  by keyboard while a lot list is up — focus is lost the same way.

### 5.3 The live region, when several things change at once

`#announcement` carries **both** `role="status"` and `aria-live="polite"` (`popup.html:74`) — redundant.
The real problem is that one Look up writes to it up to four times in one turn:

1. `clearOutput()` blanks it;
2. possibly `Volume set to …` or `Ruler cleared: …`;
3. `Found RIC II, Part 1 (second edition) Vespasian 972.`;
4. `All: median $280 over 22 sales (solid).` — or `Found … Select “Get prices” …`.

Each write replaces the last. Some screen readers speak only the final string, so **the card announcement is
routinely eaten by the price announcement**. And `announce()` (`popup.js:48`, which prefixes the lot count)
is bypassed by eight direct writes to `$('announcement').textContent`, so "3 references found in this text."
leaks into some later messages and vanishes from others.

There are also **three more announcing surfaces**: `#form-error` and `#prices-error` are `role="alert"`, and
`#check-result` is `aria-live="polite"`. A failed lot pick therefore fires an alert *and* a status.

**`#check-result` announces twice per keystroke.** It is a live region *and* the `aria-describedby` target of
`#check-amount` (`popup.html:51-52`): typing `500` speaks the full sentence three times, then again as the
field's description on the next focus. Drop one of the two roles.

### 5.4 Colour contrast against the tokens in `popup.css`

Computed from `:root` (`popup.css:5-7`) and the dark set (`:16-18`, `:23-25`).

**Text — all pass:**

| Pair | Light | Dark |
| --- | --- | --- |
| `--muted` on `--bg` (11 px hints) | 4.66:1 | 7.29:1 (on `--card`) |
| `--accent` on `--card` (h2, links) | 10.6:1 | — |
| `--on-accent` on `--accent` (Look up) | 9.9:1 | 9.5:1 |
| `--gold` on `--card` (44 px median) | 4.25:1 | 9.17:1 |
| `--error` on `--bg` | 6.58:1 | 10.6:1 |

The 4.25:1 median passes only because 44 px counts as large text. Everything readable is readable.

**Controls — the failures, and an asymmetry that matters:**

| Pair | Light | Dark |
| --- | --- | --- |
| `--field` (input borders) on `--bg` | **3.21:1** ✓ | **3.94:1** ✓ |
| `--line` (chip and pill borders) on `--bg` | **1.28:1** ✗ | **1.39:1** ✗ |
| `--line` (card edge) on `--bg` | **1.28:1** ✗ | **1.39:1** ✗ |
| `--soft` (chip and pill fill) on `--bg` | 1.08:1 | 1.15:1 |

So **the box he must type in has a visible edge, and the chips he must click do not.** The six Recent chips
(`.recent-list button`, `popup.css:85`) and the two unchosen period pills (`.period label`, `:114`) read as
plain text. The chosen pill is fine (accent fill). `.result` (`:87`) has the same 1.28/1.39 edge and, in
dark, `--shadow:none` as well — the card floats with nothing to separate it from the page.

**One rule is the sole indicator of the chosen period.** `.period label:has(:checked)` (`popup.css:116`)
with the radio at `opacity:0` (`:118`). Without `:has()` there is no indicator at all, not a weaker one.

**Two targets under 24 × 24 px:** `.copy-button` ≈ 22 px (`popup.css:151`) and `.popup-footer a` ≈ 22 px
(`:156`).

### 5.5 The 400 px width

- `body {width:400px}` is fixed (`popup.css:31`). At 200 % text, `.search-row
  {grid-template-columns:minmax(60px,1fr) auto}` (`:64`) gives the button its intrinsic width first, so the
  **Reference** input collapses toward 60 px while "Look up" grows.
- The same grid governs `#price-term`. At normal size that field is about 20 characters wide — and a Bop
  term is `(Hermaeus Hermaios) "Bopearachchi 20"`, 38 characters. **He cannot see the search term he is
  being invited to edit.**
- `.catalogue-row {1fr 91px}` (`:62`) fixes the Currency column at 91 px; the word "Currency" clips before
  "USD" does.
- `@media (max-width:359px)` (`:161`) can never fire: the popup is 400 px and `.windowed body` has
  `min-width:360px` (`:52`). Nothing at all is tuned for 360–400 px, which is where the popup actually
  lives. (See §7.)
- `.popup {max-height:600px}` plus a form-and-chips stack of ~460 px is the off-screen-median problem of
  §2.7.

### 5.6 What a screen-reader user hears

**A lot list.** `<ul id="lot-list" aria-labelledby="lot-refs-label">` → "Found in this text:, list, 4
items". Each row is a button whose text is `RIC 972 · Titus · prices only · cf. · var.` The middle dots are
silent, so it is read as *"RIC 972 Titus prices only c f var, button"* — a run-on with no grammar, and
"cf." and "var." (his own abbreviations, right for the eye) are not speakable. The chosen row carries
`aria-current="true"`, which announces a bare "current"; `aria-current="location"` would say what kind.
The count — "3 references found in this text." — is written straight to `$('announcement').textContent`
(`popup.js:354`), bypassing `announce()`, so it is one of the strings that gets clobbered (§5.3).

**The candidates list.** `<ul id="candidate-list" aria-labelledby="candidates-label">` → "Did you mean:,
list, 8 items", each item the full OCRE title, which is exactly right. But the spoken announcement says
`8 possible matches. Choose one.` while the visible heading may say `Choose a type:` — three different
phrasings of one idea, and a voice-control user has no single phrase to say.

**Headings and landmarks.** Only two headings exist: `h1` "Giga Pinax" and the card's `h2`
`#result-reference`. The prices panel has no heading (it is `<section aria-label="acsearch hammer
prices">`), so heading navigation cannot reach the median. And because `<header>` and `<footer>` are
*inside* `<main class="popup">`, neither becomes a banner or contentinfo landmark — the only landmarks are
`main` and the Recent `nav`.

**The sales list.** Each row links `sale.title || "Lot 298"`, which is the auction house and lot number, not
the coin. (Already logged as `night-audit.md` 2.11; the fix is queued with the description/thumbnail idea.)

---

## 6. Design ideas worth building

Ranked by value against effort. Every one of these removes a step or prevents a mistake; none adds a
feature. Nothing here overlaps the 0.24 label or the eight ideas already in `night-audit.md` §4.

### 1. Bring the answer into view

> *"I press Look up and nothing happens. Then I notice I have to scroll."*

**Smallest version:** at the end of `renderCard`, scroll `#result` to the top of `.popup-scroll`.

**Why:** §2.7 measures it — with a full Recent row the median is entirely below the fold, and the extension's
whole purpose is that number. One line fixes the most common "did that work?" in the tool.

**Effort:** one line and a browser check.

### 2. One box, one button — fold the guided fields away

> *"There are two places to type a reference and I never know which one the button belongs to."*

**Smallest version:** wrap `#catalogue`, `#currency`, `#ric-fields`, `#reference-label`, `#reference-number`
and `#reference-help` in a `<details>` labelled **"More ways to search"**, closed by default, `open`ed
automatically whenever `parseReference` fails on the one-box (which is precisely when they help). Move
`#lookup-button` up beside `#quick-reference`. Nothing is deleted; the first screen becomes one field and
one button.

**Why:** it deletes the entire ambiguity of §1 at a stroke, cuts the first-open control count from eight to
four, reclaims ~130 px of the 503 px he has (which also helps idea 1), and keeps every escape hatch for the
day the parser fails.

**Effort:** an evening. Some care needed where `updateFields()`, `fillFields()` and `showStored()` assume
the fields are visible.

### 3. Never look up a reference he did not type

> *"I opened it, pressed Look up, and got some Alexander tetradrachm."*

**Smallest version:** two changes. (a) A catalogue change clears `#reference-number` and focuses it, instead
of filling in `DEFAULT_NUMBER[catalogue]`. (b) When the one-box is empty **and** the guided fold has not been
opened this session, refuse with "Type a reference above." instead of looking up the stored number.

**Why:** a wrong coin shown confidently is the worst failure this tool has. Today the tool invents a
reference on every catalogue change and then invites him to look it up.

**Effort:** an hour. `DEFAULT_NUMBER` stays, for the placeholder text.

### 4. Try again without the ruler before saying "not found"

> *"It says there is no Titus 972. I'm holding a Titus 972."*

**Smallest version:** in `lookupType`, when an OCRE search with a section returns `none`, retry once without
the section. If hits come back, show them through the existing "Choose a type:" list instead of the error.
One extra request, only on a miss.

**Why:** §2.1 — the typed path and the lot path currently give opposite answers about the same coin, and
every Caesar-period coin has this shape. **Build this after 0.24**, which supplies exactly the sentence the
resulting card needs ("Portrait of Titus, listed under Vespasian."). Together they turn the single most
confusing thing the tool does into the single clearest.

**Effort:** an evening, test-first against the existing `ocre-search-titus-972.xml` fixtures.

### 5. Show on screen what the tool changed by itself

> *"I typed Titus and the volume box changed. Then I changed the volume and my ruler disappeared."*

**Smallest version:** render the two strings that already exist — `Volume set to …` and `Ruler cleared: …` —
as visible `.field-hint` text under `#ric-fields`, cleared on the next edit. The text is already built
(`popup.js:664`, `:673`); only a screen reader can hear it today.

**Why:** an unexplained change in a field he is typing into is the fastest way to lose trust in a tool.
Zero new wording.

**Effort:** an hour.

### 6. Show that a lot paste landed

> *"I pasted the whole lot and the box just shows the end of it."*

**Smallest version:** on paste, when `isLot()` is true, replace `#quick-help` with **"Lot text pasted (1,240
characters). Look up will list every reference in it."**

**Why:** §2.2 — a one-line input 40 characters wide showing the tail of a 1,200-character paste looks
broken. This is the entry point to 0.18's biggest feature, and it currently gives no feedback at all until
he presses a button he is not sure he should press.

**Effort:** an hour. (A `<textarea>` that grows on lot text is the better answer and about a day; the hint
is 90 % of the value.)

### 7. Put the price question first

> *"The lot is £450. Is that dear?"*

**Smallest version:** move `#check-row` and `#check-result` above `.median-block`, and give the result a
verdict word: **"$450 — above 7 of 9 sales, over the middle 50%, 1.6× the median."** Fold `#sale-trend`,
`#last-sale`, `#sale-period` and `#price-note` into one "More about these sales" `<details>`.

**Why:** §4. He arrives holding the input the panel asks for last. Also fixes the trend/last-sale period
inconsistency by putting both behind a fold where the mismatch can be stated in words.

**Effort:** an evening — mostly markup order and one wording function. No new data.

### 8. Short Recent chips

> *"My last six lookups fill the whole window."*

**Smallest version:** label each chip with the short form already available from `parseReference(entry.label)`
— `Vespasian 972`, `Crawford 44/5` — keeping the full title in the existing `title` tooltip and in the
accessible name.

**Why:** §2.7 — six full OCRE titles are ~180 px of a 503 px view, which is most of why the median lands off
screen. Six short chips fit on two rows.

**Effort:** an hour. Careful: `openRecent` must keep using `entry.corpus`/`entry.id`, never the shortened
label.

### Considered and not worth building

- **Carry the term and the typed check amount into the pop-out window.** It would save one acsearch request
  and one retype — but the pop-out is a rare gesture, and the term is already remembered once **Get prices**
  has been pressed. Note it in the docs instead.
- **A settings screen** for currency, theme and default catalogue. Three preferences do not earn a screen in
  a toolbar popup; two of the three should be deleted or moved (§7).
- **A second live region** to stop announcements clobbering each other. The right fix is fewer announcements
  through one writer (§5.3), not more regions.

---

## 7. What to delete

The bar for a toolbar popup is high. In rough order of how much space each buys back.

### The theme toggle — `#theme-toggle`, `#icon-sun`, `#icon-moon`, `theme.js`, `THEME_KEY`

The popup already follows the operating system through `@media (prefers-color-scheme:dark)`
(`popup.css:13`). The button exists so a collector on a light desktop can have a dark popup that is open for
twenty seconds at a time.

Deleting it removes: two SVGs and a header button, `syncThemeButton`, `applyStoredTheme`, `chooseTheme`,
`restoreTheme`, `THEMES`, the `darkScheme` listener, the `THEME_KEY` branch of the cross-window `storage`
listener, `theme.js` and its test, and the whole `:root[data-theme="dark"]` block (`popup.css:21-26`) — the
duplicated dark tokens that `docs/ideas-backlog.md` item 7 is still trying to deduplicate.

**What breaks:** a collector who deliberately wants the popup's scheme to differ from his desktop's. This
was a designed 0.14 feature and he may simply like it — ask before cutting. It is the largest single
deletion available, and it is the only one on this list that is a matter of taste rather than of value.

### `@media (max-width:359px)` — `popup.css:161-166`

Unreachable. The popup is fixed at 400 px and `.windowed body` has `min-width:360px` (`:52`).
**What breaks:** nothing. Six lines. (The real gap is that nothing is tuned for 360–400 px.)

### `#lookup-prompt` — "Reference changed. Select “Look up” to check it."

Fires on every keystroke in the number field and on every catalogue change, and renders **below** where the
card was — often below the fold. The button it points at is already on screen.
**What breaks:** nothing he can see. If a cue is wanted, it belongs on the button, not in a paragraph.

### "Unrecognised prices: “…”." in the unpriced note — `popup.js:561`

Developer diagnostics on the collector's screen, added in 0.9 to learn acsearch's logged-in price format.
That format was confirmed in 0.13 ("first real logged-in price read correctly ($595)").
**What breaks:** the next unseen format goes unreported — so keep the same list in the **copied summary**
(`summaryText`'s "Not counted:" line, `prices.js:334`), where he can paste it into a bug report, and drop it
from the panel.

### `#storage-note` — "Preferences couldn’t be saved…"

An error for a condition (`localStorage` unwritable) that he cannot act on and that a normal Brave or
Firefox profile never hits. Keep the graceful in-memory fallback; delete the paragraph and its CSS.
**What breaks:** a private-window user loses a warning they could not use anyway. Two lines of HTML, one CSS
rule — low value in both directions, so cut it on the "high bar" principle.

### `role="status"` on `#announcement` — `popup.html:74`

Redundant with `aria-live="polite"` on the same element. **What breaks:** nothing.

### The footer's acronym list

"Type data: ANS OCRE, PELLA, CRRO, SCO & BIGR (ODbL)" occupies a permanent 40 px strip with five acronyms.
ODbL requires attribution to the source; "Type data: ANS (ODbL)" gives it, with the corpus list in the
link's `title`. **What breaks:** nothing legally; the detail moves out of sight.

### Move, do not delete: `#currency`

It is a permanent top-of-screen control that affects nothing until a price panel exists. Its home is the
prices panel — or the fold from idea 2. **What breaks:** switching currency becomes one click deeper, on a
setting he changes roughly never.

### Merge, do not delete: `#prices-note` and `#prices-error`

Two places for "something went wrong with prices", one muted and one red, in different parts of the card.
One element, one message, keeping `#signin-link` inside it. **What breaks:** nothing, if the merged element
keeps `role="alert"` for genuine failures and drops it for the sign-in and permission notes.

### Already known, still dead

`.ric-fields select,.ric-fields input {text-overflow:ellipsis}` (`popup.css:73`) is a no-op — the clipping
comes from `minmax(0,1fr)`. Listed in `docs/ideas-backlog.md` item 7; delete it with the next CSS pass.
