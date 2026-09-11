# Giga Pinax 0.17 — recent sales: period buttons, trend, last sale

**Goal:** after 0.16 the user said they "like especially the most recent date ranges". On 2026-09-11 they chose three recent-sales features: **period buttons**, a **trend** line and a **last-sale** line. They did not choose "Median by year". Everything comes from the one acsearch results page already fetched for a lookup:
- no new acsearch request;
- nothing from acsearch is stored beyond the result on show.

Release 0.17.0.

## Facts from the 0.16 code

- **Where the lots come from.** `fetchPrices` fetches one results page (`order=1`, most recent first, at most 100 lots). It returns `{ status: 'ok', summary }`, where `summary = summarise(page, currency)`.
- **Date formats.** Lot dates look like `08.07.2026`, `28.07.2026 14:00` or `2024-05-01` (all three appear in the tests).
- **How the panel is drawn.** `renderPrices(summary, currency, term)` in `popup.js` draws the panel. `shownPrices = { card, summary, currency, term }` is the only copy, and `clearPrices()` clears it. `showCheck()` reads `shownPrices.summary`.
- **What is on the panel today:**
  - `#median-amount`, `#sale-strength` (for example `Solid: 16 sales, 2024–2026`), `#sale-period` (`Out of 18 matches for “…” · 2 without a price`);
  - `#range-amount` and `#range-all`, the bar, and the check row;
  - `#sale-details` with the sale list, `#price-note` and Copy summary.

## Design

### 1. Keep the page's lots with the shown result

- `fetchPrices`'s ok outcome also returns `lots`: the page as extracted, at most 100.
- The popup keeps them as `shownPrices.lots`, in memory only, cleared with the panel like the summary.

### 2. Pure helpers in `prices.js`

All are tested with a fixed `now`.

- **`saleDate(text)`** returns a UTC `Date` for `dd.mm.yyyy` (optionally followed by a time) or `yyyy-mm-dd`, else `null`.
- **`PERIODS`** = `Object.freeze([{ value: 'all', label: 'All', years: null }, { value: '5y', label: 'Last 5 years', years: 5 }, { value: '2y', label: 'Last 2 years', years: 2 }])`.
- **`lotsInPeriod(lots, period, now)`:**
  - `all` returns every lot.
  - Otherwise it keeps the lots whose `saleDate` is on or after the same day and month N years before `now` (29 Feb falls back to 28 Feb).
  - A lot without a readable date is left out of the 5- and 2-year views.
- **`trendOf(lots, currency, now)`:**
  - It splits the counted sales into the last 2 years and earlier.
  - When both groups have **at least 3** sales, it returns `{ recent, recentCount, earlier, earlierCount, change }`, where `recent` and `earlier` are the two medians and `change` is `recent / earlier - 1`.
  - Otherwise it returns `null`.
- **`lastSale(summary)`** returns the counted sale with the latest `saleDate`, or `null`. A tie goes to the first in page order.

### 3. Period buttons

**Markup,** at the top of `#prices-panel`, above "Median hammer price":

```html
<fieldset id="period" class="period"><legend class="sr-only">Sales period</legend>
  <label><input type="radio" name="period" value="all"> All</label>
  <label><input type="radio" name="period" value="5y"> Last 5 years</label>
  <label><input type="radio" name="period" value="2y"> Last 2 years</label>
</fieldset>
```

**Look:** a row of three pills like the Recent chips. The checked one is filled with the accent, with on-accent text. The radio circle is visually hidden but still focusable. The focus ring is visible, and both themes use the existing tokens.

**Behaviour:**
- **Remembered:** the chosen period is stored in preferences as `period`, validated against `PERIODS`, default `all`, and restored at start-up.
- **On change:**
  - The panel is redrawn from `shownPrices.lots` with no request.
  - The typed check amount is kept, and `showCheck()` runs again.
  - The announcement reads `${label}: median ${median} over ${sales} (${strength}).`, or the empty message below.

### 4. Drawing a period

**Everything in the panel follows the chosen period.** The panel draws `summarise(lotsInPeriod(lots, period, now), currency)`: median, strength line, sale-period line, middle 50%, range line, bar, check a price, and Inspect sales (its count and list).

**The sale-period line:**
- For `all` it is unchanged.
- Otherwise: `Out of ${total} ${match|matches} from the last N years for “${term}”`, plus the "without a price" and "not counted" parts.

**The strength line** keeps its format; it already shows the years of the sales on show.

**A period with no counted sales:**
- `#sale-strength` reads `No sales with a price in the last N years.`
- The median amount, the range block, the check row, Inspect sales and Copy summary are hidden.
- The period buttons, the trend and the last sale stay.

**`now`** is `new Date()` at drawing time.

### 5. Trend line

- **Markup:** `<p id="sale-trend" class="sale-trend">` under the strength line.
- **Data:** `trendOf(all lots)`. It does not depend on the chosen period, since it compares recent sales with earlier ones.
- **Wording:**
  - Up: `Last 2 years: ${recent} median, up ${pct}% on earlier sales (${earlier})`.
  - Down: `… down ${pct}% …`.
  - Within ±5%: `Last 2 years: ${recent} median, about the same as earlier sales (${earlier})`.
  - `pct` is `Math.round(Math.abs(change) * 100)`.
- **Hidden** when `trendOf` returns `null`.

### 6. Last-sale line

- **Markup:** `<p id="last-sale" class="last-sale">`, under the trend line, reading `Last sale <a>08.07.2026</a> · $950`.
- **Data:** `lastSale` of the all-lots summary, whatever the period.
- **The date** links to `https://www.acsearch.info/search.html?id=${id}` (new tab, `rel="noopener noreferrer"`, `aria-label` `Last sale on acsearch, opens a new tab`).
- **The amount** is formatted like the others.
- **Hidden** when there is no counted sale.

### 7. Copy summary

The copy follows what is shown:
- When the period isn't All, the stats line names it: `Median hammer $210 (last 2 years) · middle 50% … · range … · 8 sales (moderate) matching “…” · 2024–2026`.
- It then adds a `Last sale 08.07.2026 · $950` line, and the trend sentence when shown.
- `summaryText(card, summary, currency, term, extras)` takes the period label, the last sale and the trend. It stays pure, and it is tested.

### 8. Order in the median block

1. The period buttons.
2. `Median hammer price`.
3. The amount.
4. The strength line.
5. The trend line.
6. The last-sale line.
7. The sale-period line.

The rest of the panel is unchanged.

## Tests (TDD: each fails first for the expected reason)

- **`prices`:**
  - `saleDate`: all three forms, garbage input, and 31.02.
  - `lotsInPeriod`: the boundary (exactly N years ago is kept, one day earlier is dropped), undated lots, and `all`.
  - `trendOf`: both groups at 3 or more gives the medians and the change; one group under 3 gives `null`.
  - `lastSale`: ties and unreadable dates.
  - `fetchPrices` returns `lots`.
  - `summaryText` with the period, the last sale and the trend.
- **`preferences`:** `period` restores as `all`, `5y` or `2y`; anything else becomes `all`.
- **Popup behaviour** is checked by the controller in the browser.

## Release 0.17.0

- **Version:** manifests, `tests/test_packages.py` (the version and the ZIP names), README, INSTALL and the install page. The stale check is now for `0.16.0`.
- **Docs:** README, INSTALL "What to try" and the install page describe the three features.
- **Backlog:** a Done entry for 0.17.
- **Build:** `python scripts/build.py`, so that `dist/` holds only the 0.17.0 ZIPs, apart from the tests' `keep-me.txt`.
- **Checks:** the same as 0.16.
- **Do not commit.**

## Verification (controller)

2026-09-11, in-app Chromium at 440×680 on `http://localhost:8799` (never loaded before). numismatics.org was live. acsearch was stubbed with 10 priced lots dated 2018–2026, plus one blank price and one `-`.

### All (the default)

- The pills read `All · Last 5 years · Last 2 years`, with All checked.
- Median $290; strength `Moderate: 10 sales, 2018–2026`.
- Trend: `Last 2 years: $390 median, up 70% on earlier sales ($230)`.
- `Last sale 08.07.2026 · $950`, linking to the lot.
- Sale-period line: `Out of 12 matches for “Nero 306” · 2 without a price`.
- Range line: `All 10 sales $150–$950`.
- Inspect sales lists 10.
- There is no page-level scrollbar.

### Switching periods with a checked price of 390

| Period | Median | Strength | Price check |
|---|---|---|---|
| All | $290 | `Moderate: 10 sales, 2018–2026` | `Higher than 8 of 10 sales, 1.3× the median` |
| Last 5 years | $350 | `Moderate: 7 sales, 2022–2026` | `Higher than 5 of 7 sales, 1.1× the median` |
| Last 2 years | $390 | `Thin: 4 sales, 2025–2026` | `Higher than 2 of 4 sales, 1.0× the median` |

- In the 5-year view, the sale-period line reads `Out of 9 matches from the last 5 years …` and the range line `All 7 sales $260–$950`.
- The trend and the last sale are the same in every period.
- It was still one acsearch request after all the switches.
- The period is stored (`2y`) and restored after a reload. Going back to All restores the full view.

### Empty period

For a lookup whose sales are all older than two years, the Last 2 years view shows:
- `No sales with a price in the last 2 years.`;
- the median amount, range, check row, Inspect sales and Copy summary hidden;
- the trend hidden (too few sales);
- the last sale still shown (`01.05.2020 · $200`).

All then shows `Thin: 3 sales, 2018–2020`.

### Layout and console

Body 400 px; the console is clean.

### Review

- **Six findings,** P1–P6, all fixed:
  - the period boundary now uses the collector's own date;
  - the hidden legend no longer adds a second scrollbar;
  - the checked pill shows in forced-colours mode;
  - the 5.5% rounding is corrected;
  - two doc sentences are corrected.
- **Recheck:** 120/120, all checks pass, no findings.

### Noted, not changed

With no lots at all in a period, the matches line still reads "Out of 0 matches…" under the empty message.
