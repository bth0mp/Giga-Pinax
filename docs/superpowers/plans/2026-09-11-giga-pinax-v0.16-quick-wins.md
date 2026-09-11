# Giga Pinax 0.16 — quick wins: dealer-proof right-click, price check, median strength, ready cursor, faster Bop, one window, RPC links, price-first card

> **Read with the code.** This plan was drafted before 0.15.0's last review round. Where it differs from the committed 0.15.0 (`8cf81e7`), follow the code:
> - The pop-out and right-click URLs are built by `cardUrlFor` / `popupUrlFor` in `selection.js`, and a window restores a card by `corpus` and `id`.
> - The Other fallback's `SUPPORTED` prefix rule already includes `Craw`.
> - Trailing `.,;:` is already stripped.
> - The RIC acsearch term already drops a split-section parenthetical.

**Goal:** the user's list (2026-09-11), which came from another session's ideas workflow, with "Start working on these". It builds on the verified 0.15.0 (parts 1 and 2).

**Quick wins**
1. **Right-click on real sale pages.** Today these fail: `Crawford 44/5;`, `Craw. 44/5`, and text with the hidden characters dealer pages add.
2. **Is this price fair?** Type a bid or an asking price and see, for example, "higher than 16 of 23 sales, 1.6× the median", marked on the range bar.
3. **How far to trust the median.** For example "Solid: 38 sales, 2024–2026" or "Thin: 3 sales", plus how many matches that is out of.
4. **Cursor ready on open.** Alt+Shift+G, type, Enter; the up arrow brings back the last reference.
5. **Faster, sturdier Bopearachchi.** One request instead of up to 24, and a network hiccup no longer reads as "not found".
6. **One lookup window.** Each right-click reuses the open Giga Pinax window.

**Medium**

7. **Price any coin from the same box.** RPC, Sear, RSC, HGC and SNG references get a prices-only card; that part is already done by 0.15 part 2's Other catalogue. RPC also gets a link the user opens themselves.
8. **Median in view straight away.** The price sits under the title, and the legends fold away.

## 1. Right-click on real sale pages

- **One `INVISIBLE` pattern,** exported from `lookup.js`: `/[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g`.
  - `parseReference` removes these before anything else. Pasted text carries them too.
  - `selection.js` removes them before its 120-character cap, and calls `toWellFormed()` when it exists, so a lone surrogate can't make `encodeURIComponent` throw.
  - Whitespace squashing already turns NBSP and other Unicode spaces into plain spaces.
- **Trailing punctuation:** `.,;:` is already stripped (0.15 fix F16).
- **Crawford abbreviations:** the RRC prefix also accepts `Craw`, `Craw.`, `Crawf` and `Crawf.`, in both `PREFIX.RRC` and `SIMPLE_REFERENCE.RRC`: `Craw(?:f|ford)?\.?`, alongside `RRC` and `Cr.`. The Other fallback's error prefixes stay as they are: `Cr` already covers these.
- **Tests,** with real-looking strings:
  - `Crawford 44/5;`, `Craw. 44/5`, `Crawf. 44/5`
  - `RIC​ I² Nero 306`
  - `SC 2195.5c­`
  - `Bop Hermaeus 20`
  - `﻿Price 23`
  - `selectionQuery('\uD800Price 23')` does not throw.

## 2. Is this price fair?

- **`prices.js`:** `priceCheck(summary, amount)` returns `{ below, count, ratio }`.
  - `below` is the number of counted sales strictly under the amount.
  - `ratio` is `amount / median`.
- **The prices panel** gets a row after the range block:
  - `<label for="check-amount">Check a price</label>`
  - `<input id="check-amount" inputmode="decimal" autocomplete="off" placeholder="e.g. 500">`
  - `<p id="check-result" class="field-hint" aria-live="polite">`
- **On `input`,** the text is read with `parsePrice(text, currency)`, the strict reader already used for acsearch prices:
  - **blank:** no result, no marker;
  - **unreadable:** `Enter an amount such as 500.`;
  - **readable:** `Higher than ${below} of ${count} sales, ${ratio.toFixed(1)}× the median`, with "sale" when the count is 1.
- **The marker** is `<span id="range-check" class="range-check" hidden>` on the range bar:
  - It uses the same `percent()` as the median line and is clamped to 0–100%.
  - Outside the lowest–highest range it sits at the end, with a class that draws an outward caret.
  - Its colour differs from the median line: ink, with the gold outline.
- **Cleared:** `clearPrices()` clears the input, the result and the marker, so a new lookup or a currency change starts empty.
- **Kept out:** nothing is stored, and Copy summary is unchanged.

## 3. How far to trust the median

- **`prices.js`:** `medianStrength(count)` returns `Thin` for 1–4 sales, `Moderate` for 5–14 and `Solid` for 15 or more. It is not "Fair", which would clash with item 2.
- **The median block** gets a line `#sale-strength` under the amount:
  - The format is `${label}: ${count} ${sale|sales}, ${earliest}–${latest}`.
  - With one year it shows just that year; with no years, no year part.
- **The `#sale-period` line becomes** `Out of ${total}${capped ? '+' : ''} matches for “${term}”`, followed by 0.15's `· N without a price` and `· M not counted`.
- **The announcement:** `Median $170 over 22 sales (solid).`
- **Copy summary:** `… · 22 sales (solid) matching “…” · …`.

## 4. Cursor ready on open

- **Focus:** the Reference box has `autofocus` and also gets `focus()` at the end of start-up, because Firefox popups can ignore `autofocus`. A right-click window also ends with the focus there after its lookup.
- **ArrowUp** (no modifier) in the Reference box, when it is empty or shows a recalled entry, fills the next older `preferences.recent` label, with the caret at the end.
- **ArrowDown** goes back towards newer entries, and finally to empty.
- **Typing** anything resets the position.
- **No new storage.** Recent labels parse into references: OCRE titles, BIGR titles through their chips, and Other text.

## 5. Faster, sturdier Bopearachchi

- **One batched request:** `verifyBop` fetches all hits' NUDS at once, `https://numismatics.org/bigr/apis/getNuds?identifiers=${ids.map(encodeURIComponent).join('|')}`.
  - It returns `<nudsGroup>` with one `<nuds>` per record (probed 2026-09-11).
  - The group is split per `<nuds …>…</nuds>` and mapped by `<recordId>`. Each record's Bop idno is read with the existing `bopCitation`.
  - `VERIFY_LIMIT` (24) stays, now costing one request.
  - Capture a real `getNuds` fixture for the tests. The Bop 9C and Euthydemus I 24A tests switch to it.
- **Fail closed:**
  - If the batch fails (network or HTTP error), the lookup returns `network`, not `none`. This fixes the v0.12 minor about "all .xml failed → not found".
  - A record missing from the group, or without a Bop idno, stays unverified as today.
- **The single-card path** keeps its one `.xml` fetch: Recent chips and right-click with a known id.

## 6. One lookup window

- **`background.js`,** on a menu click: `runtime.sendMessage({ type: 'giga-pinax-lookup', q })`.
  - **A windowed page answers.** A popup page with `window=1` handles it: it puts `q` in the Reference box, calls `requestSubmit()`, and answers `{ windowId }` from `windows.getCurrent()`. The background then calls `windows.update(windowId, { focused: true })`.
  - **No answer:** if the send rejects (no receiver), the background falls back to `windows.create`, as today.
  - **The toolbar popup** (not windowed) ignores the message.
- **The pop-out button** (0.15 part 2) uses the same path: if a window is already open, it sends the shown card's label there and closes the toolbar popup.
- **No new permission:** runtime messaging and the `windows` API need none.
- **Tests:** the URL and message helpers in `selection.js`, if extracted. The background is checked by the controller.

## 7. RPC links on prices-only cards

- **An Other reference in RPC form** gets an **RPC online ↗** link in the Type link's place:
  - `RPC I 1234`, `RPC I, 1234` and `RPC V.2 1234` (also `/2` and `, Part 2`).
  - It links to `https://rpc.ashmus.ox.ac.uk/coins/${volume}/${number}`, with the volume in Arabic numerals and a part as `.2`: `coins/5.2/1234`.
  - `coins/1/1234` answered 200 on 2026-09-11.
- **Only the user opens it.** Giga Pinax never fetches RPC, and no host permission is added.
- **Pure helper** `rpcUrl(text)`, returning null for anything else, with tests.
- **Copy:** `aria-label` `View ${reference} on RPC Online, opens a new tab`.

## 8. Median in view straight away

- **New card order:**
  1. The heading: title, summary, citation, Type ↗ / RPC ↗.
  2. The prices panel: median, strength, range, Check a price, Inspect sales, Copy summary. The prices note takes this place when there are no prices.
  3. The acsearch search form: term and Get prices.
  4. `<details id="sides-details" class="sides-details"><summary>Obverse and reverse</summary><dl class="sides">…</dl></details>`, closed by default.
  5. Search on acsearch.
- **Hidden for Other cards:** the whole details block (they have no sides).
- **Style:** the summary line matches Inspect sales (12px, 600, chevron). The dark and light tokens are unchanged.

## Release 0.16.0

- **Version:** manifests, `tests/test_packages.py`, README, INSTALL and the install page. The stale check becomes `0.15.0`.
- **Docs:** README, INSTALL "What to try" and the install page describe each item.
- **Backlog:**
  - A Done entry for 0.16.
  - The v0.11 minors (invisible characters, `toWellFormed`) and the v0.12 minor ("all .xml fail → not found") are removed from item 7.
- **Build and checks:** `python scripts/build.py`, then the same Verify block as 0.15.

## Verification (controller)

2026-09-11, in-app Chromium at 440×680, on never-loaded origins. numismatics.org was live and acsearch was stubbed; the reviews made no acsearch requests. The pane was not drawing, so the checks drove the popup's own handlers with DOM events and `requestSubmit`.

### Port 8797 (0.16 as the workflow built it)

- **Focus:** the Reference box has focus on open.
- **Dealer text:** `Craw. 44/5`, `Crawf. 44/5`, `RIC` + zero-width space + ` I² Nero 306`, `SC 2195.5c` + soft hyphen, and a BOM + `Price 23` all resolve.
- **Bop requests:** `Bop 9C` gives 8 kings from 2 numismatics.org requests, one of them the `getNuds` batch. `Bop Hermaeus 20` takes 3.
- **RPC:** `RPC I 1234` gives an Other card whose `RPC online ↗` link goes to `rpc.ashmus.ox.ac.uk/coins/1/1234`; the Type link is hidden.
- **Card order for `Titus 123`:** heading → prices panel → prices note → search form → a closed "Obverse and reverse" fold → Search on acsearch.
- **Median strength:** `Solid: 16 sales, 2024–2026`, then `Out of 18 matches for “Titus 123” · 2 without a price` and `All 16 sales $110–$1,200`. The announcement reads "Median $195 USD over 16 sales (solid)."
- **Check a price:**

  | Typed | Result | Marker |
  |---|---|---|
  | 288 | "Higher than 13 of 16 sales, 1.5× the median" | at 16.3% |
  | $1,500 | "Higher than 16 of 16 sales, 7.7× the median" | right end, outward caret |
  | 50 | "Higher than 0 of 16 sales, 0.3× the median" | left end, outward caret |
  | abc | "Enter an amount such as 500." | hidden |
  | blank | cleared | hidden |

- **Recall:** ArrowUp and ArrowDown walk the Recent labels and return to an empty box.
- **The Other card** hides the fold, the RPC link and the Type link.
- **Layout:** body 400 px.

### Review

- **Confirmed:** 8 findings (H1–H8). A reused window priced a card with its old term and saved its old preferences over the newer ones (H3–H8). Hidden characters in the guided fields were not removed (H1), and `NAMED` did not know Craw (H2).
- **Fixed:** all 8.
- **The recheck's three low findings,** fixed by the controller:
  - The storage listener keeps a recalled label's position when the Recent list shifts.
  - It applies a theme chosen in another page.
  - A pop-out with no card only brings the open window forward.

### Port 8798 (final code)

- **Focus:** the Reference box has focus on open.
- **Theme:** a theme stored from another same-origin page flips this page to dark (sun shown, `aria-pressed="true"`) and back to light.
- **Recall across pages:**
  - Setup: Recent is [Price 23, Hermaeus 20], and the Hermaeus title was recalled with ArrowUp twice.
  - Another page then prepends RRC 44/5 to Recent. The recall holds, and Enter opens the Hermaeus 20 card instead of "Couldn't read".
- **Console:** clean.

### Checks

node 111/111, python 12 OK, `make_icons --check`, `node --check`, build (`dist/brave/popup.js` is identical to the source), web-ext lint 0/0/0, the stale `0.15.0` grep printed nothing, and `dist/` holds only the 0.16.0 ZIPs.

### Not checkable here

These need real Brave:
- The datalist dropdown and focus inside a real toolbar popup.
- One-window reuse and `windows.update` focus. They need extension messaging, and Windows may only flash the taskbar button.
