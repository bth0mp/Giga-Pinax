# Giga Pinax v0.15, part 2 — a window you can resize, the full price range, any other reference

**Goal:** Four reports from the user (2026-09-11), made after the first v0.15 plan (`2026-09-11-giga-pinax-v0.15-ric-by-number-or-ruler.md`). They go into the same uncommitted 0.15.0 release, on top of part 1.

1. "I also want the ability to drag the browser extension to make it longer if I want."
2. "It only did 300 when a coin clearly shows 950. Have a look into it." This was SC 2195.5c: 22 sales, median $170, middle 50% $134–$337, and a top sale of $950 on 08.07.2026.
3. "I also want the ability to do BCD Boiotia 174b; HGC 4, 1218."
4. "Also let the King field for Bop work the same way." Part 1 already covers this: the Ruler/King field is one type-to-search input.

**The user's decisions (2026-09-11):**
- Any reference that has no type database gets prices only, not just BCD and HGC.
- The window always opens at the default size; its size is not remembered.

## 0. Part-1 follow-ups (designer decisions and review findings)

1. **Types stored with a word after the number.** A partial RIC search whose number has no parenthetical also asks for those types. OCRE stores them as `{n}_{word}`, for example `266_aureus`.
   - When the number matches `^\d+[a-z]*$` (case-insensitive), add `OR typeNumber:{n}_*`, once for each case variant the number already gets. For example: `(typeNumber:"266" OR typeNumber:266_*)`.
   - The title filter then keeps `266 (aureus)` for a typed `266`. A typed `266 (aureus)` still keeps only that type.
   - Recapture the affected fixtures live with the new `q`.
2. **List label.** A list from a partial RIC search (a number, or a ruler with no volume) is labelled `Choose a type:`. The loose "Did you mean" suggestions and the Bop list keep `Did you mean:`.
3. **Choosing an unlisted volume** (a parsed `IV, Part 1`) no longer clears the ruler. Only a listed volume that lacks the ruler clears it.
4. **Confirmed findings** from the part-1 review are listed in the workflow prompt. Apply them first.

## 1. A window you can resize

**Finding:** browsers fix a toolbar popup's size; nobody can drag it, and Chromium and Firefox cap it at 800×600. The right-click window can be dragged: `background.js` opens it with `type:'popup'` at 440×680. But `popup.css` pins `body {width:400px}` and `.popup {max-height:600px}`, so its content never grows.

- **Header pop-out button,** placed before the theme toggle:
  - Markup: `<button id="pop-out" class="icon-button" type="button" aria-label="Open in a window" title="Open in a window you can resize">`.
  - Its icon is an open-in-window SVG (a square with an arrow), `aria-hidden`, in the toggle's stroke style.
  - It is hidden when the page is already windowed.
  - Both header buttons sit at the right: only the first carries `margin-left:auto`, with an 8px gap.
- **Clicking it:**
  - Opens `popup.html?window=1`. When a card is shown, it adds `&q=<card label, URL-encoded>`, so the window shows the same type through the existing auto-submit.
  - Uses `api.windows.create({ url: api.runtime.getURL(…), type: 'popup', width: 440, height: 680 })`, then `window.close()`.
  - Without `api.windows` (a plain tab), it calls `window.open(url, '_blank', 'popup,width=440,height=680')`.
- **Right-click:** `popupUrlFor` in `extension/selection.js` returns `popup.html?window=1&q=…`, and its tests follow.
- **Windowed layout:**
  - `popup.js` adds the class `windowed` to `<html>` when the URL has `window=1`.
  - `popup.css`: `.windowed body {width:auto; min-width:360px}` and `.windowed .popup {height:100vh; max-height:none}`. The header and footer stay put and the middle scrolls, so dragging the window longer or wider enlarges the page.
  - The toolbar popup is unchanged.

## 2. The full price range

**Finding:** the $950 sale is counted. It appears in the sales list, and that list only shows counted lots. "$134–$337" is the middle 50%: a quarter of the 22 prices lie above it ($950, $455, $425, $399, $375, $359…). The panel draws the lowest-to-highest whisker but never prints those numbers.

- **Range line:** `popup.html` gets `<p id="range-all" class="range-all"></p>` under `#range-amount`. `popup.js` fills it with `All ${count} sales ${min}–${max}`; with one sale it reads `1 sale ${min}`. It uses the muted 11px hint style.
- **Uncounted lots:**
  - `summarise` (`prices.js`) also returns `unpriced`: the count of lots whose price text has no digit (unsold, unpriced, blank or `*`-style markers).
  - When there are uncounted lots, the sale-period line prints `· N without a price` for the unpriced ones and `· M not counted` for the rest (`total − count − unpriced`). Each part is printed only when it is non-zero.
- **Copy summary:** `Median hammer $170 · middle 50% $134–$337 · range $81–$950 · 22 sales matching “…” · 2012–2026`.

## 3. Any other reference: prices only

**Findings (2026-09-11):**
- **No open type data** covers BCD Boiotia or HGC:
  - IRIS/ARCH (greekcoinage.org, Numishare, 13,277 IRIS types) cites no HGC at all.
  - Its 35 BCD records all come from the BCD Peloponnesos (Leu 96, 2006) and BCD Euboia (Lanz 111, 2002) sale catalogues. `"BCD Boiotia 174"` gives 0 hits.
- **acsearch phrase matching** (logged-out searches; the first request 302s to `cookie_check=1`, so use a cookie jar):
  - `"HGC 4, 1218"` and `"HGC 4 1218"` both give 6 lots; the comma is ignored.
  - Unquoted `HGC 4 1218` gives 58 lots, mostly other types (HGC 6, 1218…).
  - `BCD Boiotia 174b` gives 6 lots, quoted or not.
  - `("BCD Boiotia 174b" "HGC 4 1218")` gives 8 lots, the union, including two Solidus lots that write "174 b". So an either-or of exact phrases works.

**Design:**

- **`parseReference(text)`:**
  - **Parts:** the text (after today's length cap and unquote) is split on `;` into trimmed, non-empty parts.
  - **A type reference wins:** the first part that part 1's rules read (RRC/Price/SC, Bop, RIC including the new forms) is returned. So `SC 2195.5c; SNG Spaer 1712` looks up SC 2195.5c.
  - **The fallback:** otherwise, when the whole text contains **a letter and a digit** and does not start (case-insensitively) with `RIC`, `RRC`, `Cr`, `Price`, `SC`, `Seleucid` or `Bop`, the result is `{ catalogue: 'Other', number: <the whole squashed text>, volume: '', section: '' }`.
  - **Still errors:** unread text in a supported catalogue stays `null`, so the "couldn't read" error still catches typos (`Bopearachi 9C`, `RIC XI Nero 1`, `Crawf 44/5`). Text with no digit stays `null` (`hello`, `Price`), and so does text with no letter (`972`, which part 1 pins).
  - **Test cases:** `Sear 1234`, `HGC 4, 1218`, `BCD Boiotia 174b; HGC 4, 1218`, `SNG Cop 123`, `RPC I 1234` and `hello 5` become Other. Part 1's still-`null` tests change to match.
- **`buildQuery` / `lookupType` / `lookupById`:** `Other` makes **no network request**. It returns `{ status: 'ok', card }` with a card built from the text:
  - `corpus: 'other'`, and `id` and `label` both equal to the text;
  - null authority, denomination, mint, material and dates;
  - empty obverse and reverse.
  - `lookupById('other', id)` builds the same card, so Recent chips work.
- **`defaultTerm` (`prices.js`):** each `;` part becomes an exact phrase, quotes stripped.
  - One part: `"HGC 4, 1218"`.
  - Several parts, either-or: `("BCD Boiotia 174b" "HGC 4, 1218")`.
- **Catalogue select:** a new last option, `<option value="Other">Other (prices only)</option>`.
  - `REFERENCE_LABEL.Other`: `Reference, as the dealer cites it`.
  - `REFERENCE_HELP.Other`: `Example: BCD Boiotia 174b; HGC 4, 1218. No type data, only acsearch prices.`
  - Other shows no RIC or Bop fields.
- **`preferences.js`:**
  - `restorePreferences` accepts `Other`.
  - `DEFAULT_NUMBER.Other` is `'BCD Boiotia 174b'`.
  - The Recent corpora accept `'other'`.
- **Card:**
  - For `corpus === 'other'`, the summary line reads `No open type data for this reference. Prices from acsearch only.`
  - The Type ↗ link and the obverse/reverse list (`<dl class="sides">`, which gets an id) are hidden, and shown again for any other card.
  - The prices form, auto-fetch, Get prices, Copy summary and the acsearch button work as for any card.
  - `summaryText` omits the numismatics.org link line for an Other card.
- **Look up permissions:** a Look up whose catalogue is Other requests only `ACSEARCH_ORIGIN`, because it contacts nothing else. The request is still synchronous and first in the submit handler. Every other catalogue requests `HOST_ORIGINS` as today.
- **Copy:**
  - The Reference placeholder stays as in part 1.
  - `QUICK_ERROR` stays as in part 1.
  - README, INSTALL and the install page say that any other reference (BCD, HGC, SNG, Sear…) gets acsearch prices without a type record, and that `;`-separated references are searched together.

## Tests (TDD)

- **`lookup`:**
  - The parse cases above, including the still-`null` list.
  - An Other lookup makes zero fetches.
  - The `;` rule: a type reference wins, otherwise the text becomes Other.
  - The `_*` query and the parenthetical filter.
- **`prices`:**
  - `defaultTerm` for Other: one part and several parts.
  - `summarise` `unpriced`.
  - `summaryText` with the range line and without the link line for Other.
- **`preferences`:** Other and `'other'` in Recent restore.
- **`selection`:** the `window=1` URL.
- **Popup behaviour** is checked by the controller in the browser.

## Release: still 0.15.0

- **Version:** no bump. Part 2 ships in the same uncommitted 0.15.0 as part 1.
- **README, INSTALL and the install page** gain the part-2 features.
- **Backlog:** the v0.15 Done entry is extended with part 2, and the "without a price" idea is removed from item 7.
- **Build:** `python scripts/build.py`.
- **Checks:** the same Verify block as part 1.
- **Do not commit.**

## Verification (controller)

Part 1, 2026-09-11. Checked in in-app Chromium, 440×680, on `http://localhost:8795` (never loaded before), against live numismatics.org with acsearch stubbed. The pane was not drawing, so the checks drove the popup's own handlers with DOM events and `requestSubmit`.

**Reference box:**

| Input | Result |
|---|---|
| `RIC 972` | 6 types, in volume order |
| `RIC 1` | the too-many message |
| `Titus 123` | fields II.1² / Titus / 123, the card, term `Titus 123` |
| `Hadrian 12` | the II.3² card; fields refilled to II.3² |
| `RIC 266` | 39 types |
| `RIC I² Nero 306` | the card, term `Nero 306` |
| `RIC I Nero 306` | one "Did you mean" |
| `Crawford 44/5`, `SC 1266.2`, `Price 23` | their cards |
| `Bop Hermaeus 20` | the card, term `(Hermaeus Hermaios) "Bopearachchi 20"` |
| `Bop 9C` | 8 kings |
| `Sear 1234` | the one-box error |
| `RIC 9999999` | not found |

**Lists and fields:**
- Picking `Hadrian 972` from the list gives fields II.3² / Hadrian / 972 and the term `Hadrian 972`.
- Typing a ruler sets the volume:

  | Typed | Volume |
  |---|---|
  | `Titus`, `titus` | II.1² |
  | `Hadrian` | Any volume |
  | `Tit` | unchanged |

- Titus, then choosing I², clears the ruler.
- Bop King: the `Any king` placeholder, 48 suggestions, not required.
- The Recent chip `…Nero 306`, clicked while on Bop, gives RIC / I² / Nero / 306 and the card.
- A stored v0.14 profile (RIC / I² / Claudius / 972) restores; Look up says "No RIC I (second edition) Claudius 972 found in OCRE".

**Prices, layout and console:**
- 8 acsearch fetches, one per resolved type.
- Body 400 px. The placeholder takes 329 of 346 px. The Ruler input matches the Volume select: 36 px high, 12 px text, same border.
- The console is clean.
- Not checkable here: the datalist dropdown rendering, which needs a drawn pane or real Brave.

### Review rounds

- **Part-1 review:** five Opus lenses (Fable usage had run out), each finding checked by a skeptic. 16 of 18 findings were confirmed. They included a wrong-coin risk (sibling sections such as "Gallienus (joint reign)" were hidden), a volume missing from the Solr query, "Salonina (2)" dropped as a subtype, and trailing punctuation.
- **Fix and part 2:** all 16 were applied, together with the three follow-ups and part 2. A second five-lens review confirmed 16 more; 15 were fixed. G13 (the ANS id `sc.1.689.10.` with a stray dot) was skipped on purpose.
- **The recheck's one remaining finding:** OCRE's split-section parenthetical in the acsearch term ("Leo I (East) 605"). The controller fixed it test-first.

### Final combined check

2026-09-11, on `http://localhost:8796` (never loaded before), 440×680. numismatics.org was live; acsearch was stubbed with nine priced lots plus a blank price and a `-` price.

**Reference box:**

| Input | Result |
|---|---|
| `RIC 972` | "Choose a type:" with the six types, one numismatics.org request |
| `Gallienus 123` | the sole-reign and joint-reign types |
| `Titus 123` | the card and term `Titus 123` |
| `RIC I² 12` | 10 types |
| `RIC 1` | too many |
| `Leo I 605` | one (East) type; choosing it gives the term `Leo I 605` |
| `BCD Boiotia 174b; HGC 4, 1218` | an Other card (see below) |
| `Sear 1234` | an Other card |
| `SC 2195.5c; SNG Spaer 1712` | the SC card |
| `Crawford 44/5;` | RRC 44/5 |
| `Bop Hermaeus 20` | the card and its Bop term |
| `hello`, `972` | the one-box error |
| `Craw. 44/5` | the one-box error; the `Craw.` prefix is 0.16 item 1 |

- **The Titus 123 prices panel:** `All 9 sales $120–$1,200`, and `9 sales matching “Titus 123” · 2024–2026 · 2 without a price`.
- **The Other card:** "No open type data for this reference. Prices from acsearch only."; the Type link and the sides are hidden; the term is `("BCD Boiotia 174b" "HGC 4, 1218")`; 0 numismatics.org requests.

**Typing and announcements:** typing Titus announces "Volume set to II.1² (2nd ed.)."; then choosing I² announces "Ruler cleared: Titus is not in I² (2nd ed.)."

**Pop-out and windowed layout:**
- In the toolbar layout (body 400 px) the pop-out button is shown, and it opens `popup.html?window=1&corpus=ocre&id=ric.2_1%282%29.tit.123`.
- A window opened with `corpus=other` restores the Other card and its term.
- In a window: the body is 440 px, the popup fills the viewport (680 px, and 900 px after resizing), the footer sits at the bottom, and the pop-out button is hidden.

**Console and checks:**
- The console shows only the expected plain-tab acsearch CORS lines, once the stub was gone.
- Checks: node 104/104, python 12 OK, `make_icons --check`, build, `node --check`, web-ext lint 0/0/0, and the stale-version grep prints nothing.

**Not checkable here:** the datalist dropdown and the real toolbar popup. The user checks those in Brave.
