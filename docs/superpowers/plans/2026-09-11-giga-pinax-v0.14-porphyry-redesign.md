# Giga Pinax v0.14 Porphyry redesign, light/dark switch and a new icon

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Give the popup the look the user chose on 2026-09-11 from the mockups, style **G · Porphyry** (wine-purple on parchment, gold hairlines, serif headings, the result as a rounded card, pill-shaped Recent chips), add a sun/moon **light/dark switch** in the header that follows the system until clicked and remembers the click, and replace the toolbar icon with icon 3, **Pinax columns with a price line**, on a porphyry tile (the user accepted the purple tile at 128/48/32/16 px on parchment and near-black). Release 0.14.0. No lookup, price, preference, right-click or dropdown behaviour changes.

**Findings (2026-09-11):** Every colour the user chose passes WCAG AA where it is used (table below, computed with the WCAG relative-luminance formula in Python; the ratios are exact to two decimals). Two *derived* tokens needed care: (1) muted text `#7A6680` reaches only 4.32:1 on the natural chip fill `#F1E9DD`, so muted text never sits on `--soft` — chips carry ink text, and the footer and the middle-50% inset sit on the parchment `--bg` (4.66:1) instead; (2) the hairline `#E4D6C6` is 1.43:1 on white, fine for decorative rules but not for an input's boundary (WCAG 1.4.11 wants 3:1), so fields get their own warm taupe border `--field` (`#9A8372`: 3.58:1 on white, 3.21:1 on parchment; dark `#8A6482`: 3.72:1 / 3.94:1). The gold median `#9C7424` is 4.25:1 on white, which passes as large text (44 px) and is never used for small text. The icon script below was run against Pillow 12.3.0 in a scratch directory: four RGBA PNGs of the right sizes with transparent corners (757 / 1 547 / 2 224 / 5 643 bytes), byte-identical across two runs, and the 16 px render is legible with the heavier cut (2 px columns, 1.75 px lintel, 1.25 px price line); the master geometry at 16 px gives a 0.9 px line that disappears. `matchMedia('(prefers-color-scheme: dark)')` and a classic `<script>` in `<head>` both work in MV3 popups in Brave and Firefox; a stylesheet `<link>` that follows the script is render-blocking, so a `data-theme` set by that script is in place before the first paint and there is no flash. `[hidden] {display:none !important}` already applies to inline SVG, so the two icons in the toggle can be switched with `hidden`. Georgia's default figures are old-style; `font-variant-numeric: lining-nums` is requested for the median and is honoured only where the font has the feature (Georgia Pro, Palatino Linotype), so the median may show old-style numerals, as the mockup did.

## Open points for the controller

- **Theme storage:** its own key `giga-pinax-theme-v1` holding the bare string `light` or `dark` (no JSON), so `theme.js` can read it in one line before paint and `restorePreferences` and its tests stay untouched. Anything else, including a missing key or unreadable storage, means "follow the system". A failed write shows the existing storage note (it says "Preferences couldn't be saved", which the theme is).
- **Flash:** none by construction (`theme.js` runs before the render-blocking stylesheet); `popup.js` re-validates the stored value on start-up, so a tampered `data-theme` set by anything else is corrected. There is no accepted-flash fallback to sign off.
- **Toggle semantics:** one button labelled `Dark theme` with `aria-pressed` true while dark is shown; its icon shows what a click switches *to* (moon in light, sun in dark) and its `title` says so. A system-scheme change while the popup is open updates the button (and the theme, through the media query) until the button is clicked.
- **Palette:** none of the eight user colours per mode was changed. Derived and listed in full below: `--soft`, `--field`, `--accent-soft`, `--accent-hover`, `--gold-line`, `--focus`, `--error`, `--shadow`. The taupe field border is visibly heavier than the hairlines; that is the 3:1 boundary rule, not a taste choice.
- **Layout:** side padding goes from 20 px to 16 px (8/12/16 rhythm) and the result is a card inset 16 px with 16 px inner padding, so card content is 32 px narrower than before (336 px); every long string already wraps or clips. The header, form and chips sit on the parchment; only the result is white.
- **Icon:** 48 and 128 px use the master geometry exactly; 16 and 32 px use the same axes and end points with a heavier cut (lintel 14 tall, columns 16 wide, price line 10 wide, all in the 128 grid). The old `scripts/render-icons.ps1` (teal circle) is deleted; `python scripts/make_icons.py` replaces it and needs Pillow, a dev tool only. The pixel-equality test skips when Pillow is missing and will fail if a future Pillow changes LANCZOS output, in which case re-run the script and commit the PNGs.
- **Install page:** adopts the palette through its tokens and serif headings only (two lines and two rules); no toggle there, it follows the system.
- Backlog bookkeeping is left to the controller.

## Global Constraints

- No behaviour change to lookups, prices, preferences semantics, right-click or dropdowns; all 78 existing Node tests and 9 Python tests keep passing unchanged. No new permissions, host permissions or runtime dependencies; nothing fetched at runtime (no web fonts). New files: `extension/theme.js` (the one tiny theme script), `scripts/make_icons.py`, `tests/test_icons.py`; deleted: `scripts/render-icons.ps1`. `textContent`/attributes/`hidden` only; never innerHTML with data. Every id, class and `hidden` hook that `popup.js` uses today keeps working; markup changes only where named.
- Pillow is used only by `scripts/make_icons.py` and (optionally) `tests/test_icons.py`; never imported by `scripts/build.py`, the extension or `tests/test_packages.py`.
- Version `0.14.0` in manifests, package test and docs (digit-bounded stale check `(^|[^0-9.@])0\.13\.0`); `theme.js` added to `scripts/build.py` `ASSET_PATHS` and `tests/test_packages.py` `ASSETS`.
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Git Bash; start commands with `cd "Z:/Ancient Coin Browser extension"`; run every verify command on its own and check its exit status; never pipe test output. Copy typographic characters (`’ “ ” ² – · ↗ ⌄`) from the files, and never write a literal control character into any file. `Z:` is an SMB share (build.py already retries a denied zip replace).

---

### Task 1: Porphyry popup, theme switch, icon, 0.14.0

**Files:** `extension/popup.html`, `extension/popup.css`, `extension/popup.js`, `extension/preferences.js`, new `extension/theme.js`, `extension/icon.svg`, `extension/icons/icon-16.png`, `extension/icons/icon-32.png`, `extension/icons/icon-48.png`, `extension/icons/icon-128.png` (regenerated), new `scripts/make_icons.py`, deleted `scripts/render-icons.ps1`, `scripts/build.py`, `tests/test_packages.py`, new `tests/test_icons.py`, `tests/preferences.test.mjs`, `manifests/brave.json`, `manifests/firefox.json`, `README.md`, `docs/INSTALL.md`, `install/index.html`, `install/styles.css`.

**Palette (final values)**

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#F7F2EA` | `#140811` | page, header, form, footer, middle-50% inset |
| `--card` | `#FFFFFF` | `#1F0E1B` | result card, inputs, theme button |
| `--soft` | `#F1E9DD` | `#2A1526` | Recent chips (ink text only) |
| `--ink` | `#2A1433` | `#F3E6EE` | body text |
| `--muted` | `#7A6680` | `#B99AAE` | hints, summary, footer, labels |
| `--line` | `#E4D6C6` | `#3E2238` | decorative hairlines, card edge, chip edge |
| `--field` | `#9A8372` | `#8A6482` | input and select borders |
| `--accent` | `#6B1F5C` | `#D8B25A` | brand name, type title, links, buttons, legends, range box |
| `--accent-hover` | `#5A184D` | `#E4C271` | primary button hover |
| `--on-accent` | `#FDF6EC` | `#1A0A15` | text on buttons |
| `--accent-soft` | `#F1E4EE` | `#3B2036` | middle-50% box fill |
| `--gold` | `#9C7424` | `#D8B25A` | the median number (44 px serif) |
| `--gold-line` | `#D9C48F` | `#5C4622` | gold hairlines: under the header, above the median, above the footer |
| `--focus` | `#6B1F5C` | `#D8B25A` | focus ring |
| `--error` | `#A0283C` | `#FFA6B3` | form and price errors, storage note |
| `--shadow` | `0 1px 2px rgba(42,20,51,.06)` | `none` | the result card |

**Contrast (WCAG AA; normal text ≥ 4.5, large text ≥ 3, meaningful boundaries ≥ 3)**

| Pair | Light | Dark | Where | Verdict |
|---|---|---|---|---|
| ink on bg | 15.12 | 16.19 | form labels, prompts | pass |
| ink on card | 16.85 | 15.27 | inputs, sides, sale list | pass |
| ink on soft | 13.99 | 14.07 | Recent chips | pass |
| muted on bg | 4.66 | 7.73 | hints, footer, subtitle, range labels | pass |
| muted on card | 5.20 | 7.30 | summary, citation, dt, notes, sale dates | pass |
| accent on bg | 9.54 | 9.73 | brand name, footer link | pass |
| accent on card | 10.63 | 9.18 | type title, Type link, legends, text buttons | pass |
| on-accent on accent | 9.91 | 9.50 | Look up, Get prices, Search on acsearch | pass |
| on-accent on accent-hover | 11.70 | 11.16 | hovered buttons | pass |
| gold on card | 4.25 | 9.18 | median number, 44 px (large) | pass (≥ 3; light also < 4.5, so gold is never small text) |
| error on bg | 6.58 | 10.59 | storage note | pass |
| error on card | 7.33 | 9.99 | form-error inside the card (prices) and on bg (lookup: 6.58 / 10.59) | pass |
| field on card | 3.58 | 3.72 | input borders (boundary) | pass |
| field on bg | 3.21 | 3.94 | input borders against the form background | pass |
| accent on accent-soft | 8.64 | 7.22 | range box border and median line on the box fill | pass |
| focus on bg / card | 9.54 / 10.63 | 9.73 / 9.18 | focus ring | pass |
| muted on soft | 4.32 | 6.72 | not used in light: no muted text on `--soft` | n/a |
| line on card | 1.43 | 1.31 | decorative hairlines, card edge (not a required boundary: the card also differs by fill in light and has the shadow) | exempt |
| gold-line on bg | decorative | decorative | hairlines | exempt |

**Behaviour**

1. `extension/theme.js` (new; a classic script, no `import`/`export`):

   ```js
   // Runs before the stylesheet so a remembered light or dark choice paints first (MV3 forbids inline scripts, hence this file).
   // Same key and values as THEME_KEY and restoreTheme in preferences.js; anything else, or unreadable storage, leaves the system scheme.
   (() => {
     let theme = null;
     try { theme = localStorage.getItem('giga-pinax-theme-v1'); } catch { /* follow the system */ }
     if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
   })();
   ```

2. `extension/preferences.js`: after `export const RECENT_LIMIT = 6;` add

   ```js
   export const THEME_KEY = 'giga-pinax-theme-v1';
   export const THEMES = Object.freeze(['light', 'dark']);
   // The stored light/dark choice, or '' for "follow the system"; theme.js applies the same rule before the first paint.
   export const restoreTheme = (raw) => (THEMES.includes(raw) ? raw : '');
   ```

   Nothing else in the file changes.

3. `extension/popup.html` (everything not shown is unchanged, including every id, `hidden` and class the script uses):
   - In `<head>`, add `<script src="theme.js"></script>` on its own line **before** `<link rel="stylesheet" href="popup.css">` (the `popup.js` module line stays after the stylesheet). Keep `<meta name="color-scheme" content="light dark">`.
   - Replace the header with:

     ```html
     <header class="popup-header">
       <img class="brand-icon" src="icons/icon-48.png" width="32" height="32" alt="">
       <div><h1>Giga Pinax</h1><p>Ancient coin reference</p></div>
       <button id="theme-toggle" class="icon-button" type="button" aria-label="Dark theme" aria-pressed="false" title="Switch to dark theme">
         <svg id="icon-moon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
         <svg id="icon-sun" aria-hidden="true" viewBox="0 0 24 24" hidden><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
       </button>
     </header>
     ```

   - The result section gains the `card` class: `<section id="result" class="result card" aria-labelledby="result-reference" hidden>`. No other markup change: the form, chips, prices form, prices panel, footer and notes keep their elements and ids.

4. `extension/popup.css`: replace the whole file with the following (the two dark blocks are deliberately identical: the first applies the system scheme unless the stored choice is light, the second applies a stored dark choice whatever the system says):

   ```css
   /* Porphyry: wine-purple on parchment, gold hairlines, serif headings. Light tokens on :root; the dark set is repeated for the system
      scheme (unless the stored choice is light) and for a stored dark choice (theme.js sets data-theme before the first paint). */
   :root {
     color-scheme: light;
     --bg:#F7F2EA; --card:#FFFFFF; --soft:#F1E9DD; --ink:#2A1433; --muted:#7A6680; --line:#E4D6C6; --field:#9A8372;
     --accent:#6B1F5C; --accent-hover:#5A184D; --on-accent:#FDF6EC; --accent-soft:#F1E4EE;
     --gold:#9C7424; --gold-line:#D9C48F; --focus:#6B1F5C; --error:#A0283C; --shadow:0 1px 2px rgba(42,20,51,.06);
     --font-ui:"Segoe UI",-apple-system,BlinkMacSystemFont,Arial,sans-serif;
     --font-serif:Georgia,"Iowan Old Style","Palatino Linotype",serif;
     --font-mono:Consolas,"Liberation Mono",monospace;
     font-family:var(--font-ui); color:var(--ink); background:var(--bg); font-synthesis:none;
   }
   @media (prefers-color-scheme:dark) {
     :root:not([data-theme="light"]) {
       color-scheme: dark;
       --bg:#140811; --card:#1F0E1B; --soft:#2A1526; --ink:#F3E6EE; --muted:#B99AAE; --line:#3E2238; --field:#8A6482;
       --accent:#D8B25A; --accent-hover:#E4C271; --on-accent:#1A0A15; --accent-soft:#3B2036;
       --gold:#D8B25A; --gold-line:#5C4622; --focus:#D8B25A; --error:#FFA6B3; --shadow:none;
     }
   }
   :root[data-theme="dark"] {
     color-scheme: dark;
     --bg:#140811; --card:#1F0E1B; --soft:#2A1526; --ink:#F3E6EE; --muted:#B99AAE; --line:#3E2238; --field:#8A6482;
     --accent:#D8B25A; --accent-hover:#E4C271; --on-accent:#1A0A15; --accent-soft:#3B2036;
     --gold:#D8B25A; --gold-line:#5C4622; --focus:#D8B25A; --error:#FFA6B3; --shadow:none;
   }
   * {box-sizing:border-box;}
   [hidden] {display:none !important;}
   html,body {margin:0; padding:0;}
   /* Popup autosizing starts narrow; a viewport-based cap prevents it from growing. */
   body {width:400px; background:var(--bg);}
   button,input,select {font:inherit;}
   button,select {cursor:pointer;}
   a {color:var(--accent); text-underline-offset:3px;}
   a:hover {text-decoration-thickness:2px;}
   p,h1,h2 {margin:0;}
   :focus-visible {outline:3px solid var(--focus); outline-offset:2px;}
   .popup {width:100%; max-height:600px; display:flex; flex-direction:column; overflow:hidden;}
   .popup-header {display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--gold-line); flex-shrink:0;}
   .brand-icon {border-radius:8px; flex-shrink:0;}
   h1 {font-family:var(--font-serif); font-size:17px; line-height:1.2; font-weight:600; letter-spacing:0; color:var(--accent);}
   .popup-header p {font-size:11px; margin-top:2px; color:var(--muted);}
   .icon-button {margin-left:auto; width:32px; height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--line); border-radius:999px; background:var(--card); color:var(--ink); flex-shrink:0;}
   .icon-button:hover {border-color:var(--accent); color:var(--accent);}
   .icon-button svg {width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round;}
   .text-button {border:0; background:transparent; color:var(--accent); font-weight:600; font-size:12px; padding:12px;}
   .text-button:hover {text-decoration:underline; text-underline-offset:3px;}
   .popup-scroll {overflow-y:auto; scrollbar-width:thin; scrollbar-color:var(--line) transparent; min-height:0;}
   .reference-form {padding:12px 16px; border-bottom:1px solid var(--line);}
   label {display:block; font-size:12px; font-weight:600; margin-bottom:6px;}
   select,input {width:100%; height:36px; border:1px solid var(--field); border-radius:8px; background:var(--card); color:var(--ink); padding:0 10px; min-width:0; font-size:13px;}
   select:hover,input:hover {border-color:var(--accent);}
   select:focus-visible,input:focus-visible {border-color:var(--accent); outline-offset:1px;}
   .quick-row {margin-bottom:12px;}
   .quick-row input {font-family:var(--font-mono); font-weight:600;}
   .catalogue-row {display:grid; grid-template-columns:1fr 91px; gap:12px; margin-bottom:12px;}
   .catalogue-row select {font-weight:600;}
   .search-row {display:grid; grid-template-columns:minmax(60px,1fr) auto; gap:8px;}
   .search-row input {height:40px; font-size:15px; font-weight:600; font-family:var(--font-mono);}
   .primary-button {display:inline-flex; justify-content:center; align-items:center; gap:8px; min-height:40px; padding:0 14px; background:var(--accent); color:var(--on-accent); border:1px solid transparent; border-radius:8px; font-size:12px; font-weight:650; text-decoration:none;}
   .primary-button:hover {background:var(--accent-hover);}
   .primary-button svg {width:16px; height:16px; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; fill:none;}
   .primary-button[disabled] {opacity:.6; cursor:progress;}
   .field-hint {font-size:11px; line-height:1.4; color:var(--muted); margin-top:6px;}
   .ric-fields {display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; margin-bottom:12px;}
   .ric-fields.single {grid-template-columns:minmax(0,1fr);}
   .ric-fields select {font-size:12px; text-overflow:ellipsis;}
   .ric-fields label {font-size:11px;}
   .form-error {color:var(--error); font-size:12px; line-height:1.5; padding-top:8px;}
   .candidates {padding-top:6px;}
   .candidate-list {list-style:none; margin:0; padding:0;}
   .candidate-list .text-button {display:block; width:100%; text-align:left; padding:8px 0; border-top:1px solid var(--line);}
   .recent {padding:8px 16px 12px; border-bottom:1px solid var(--line);}
   .recent .field-hint {margin-top:0;}
   .recent-list {list-style:none; margin:6px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:6px;}
   .recent-list li {min-width:0; max-width:100%;}
   .recent-list button {max-width:100%; border:1px solid var(--line); border-radius:999px; background:var(--soft); color:var(--ink); font-size:11px; padding:5px 12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
   .recent-list button:hover {border-color:var(--accent); color:var(--accent);}
   .result {margin:12px 16px; padding:16px; background:var(--card); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow);}
   .type-heading {display:flex; align-items:flex-start; gap:10px;}
   .catalogue-code {font-family:var(--font-serif); font-size:16px; line-height:1.3; font-weight:600; letter-spacing:0; color:var(--accent); overflow-wrap:anywhere;}
   .type-heading p {font-size:11px; line-height:1.3; color:var(--muted); margin-top:4px;}
   .type-link {margin-left:auto; text-decoration:none; font-size:12px; white-space:nowrap; padding:4px 0 8px 8px;}
   .type-link:hover {text-decoration:underline;}
   .sides {margin:12px 0 0; display:grid; gap:8px;}
   .sides div {display:grid; grid-template-columns:62px 1fr; gap:8px; font-size:12px; line-height:1.45;}
   .sides dt {color:var(--muted); font-weight:600;}
   .sides dd {margin:0; display:grid; gap:2px; min-width:0;}
   .legend {font-family:var(--font-mono); font-size:11px; letter-spacing:.03em; color:var(--accent); overflow-wrap:anywhere;}
   .metric-label {font-size:12px; color:var(--muted);}
   .prices {margin-top:16px; padding-top:12px; border-top:1px solid var(--line);}
   .prices-note {font-size:12px; line-height:1.5; color:var(--muted); padding-top:8px;}
   .prices-note a {white-space:nowrap;}
   .median-block {margin-top:12px; padding-top:12px; border-top:1px solid var(--gold-line);}
   .median-line {display:flex; align-items:baseline; gap:8px; margin-top:2px;}
   .median-line strong {font-family:var(--font-serif); font-size:44px; line-height:1.05; letter-spacing:-.02em; font-weight:400; color:var(--gold); font-variant-numeric:lining-nums tabular-nums;}
   #median-currency {font-size:12px; font-weight:600; color:var(--muted);}
   .sale-period {font-size:11px; color:var(--muted); margin-top:6px;}
   .range-block {background:var(--bg); border:1px solid var(--line); border-radius:10px; margin-top:12px; padding:10px 12px; display:flex; align-items:center; gap:12px;}
   .range-block strong {display:block; font-size:16px; font-weight:600; letter-spacing:-.01em; margin-top:2px; font-variant-numeric:tabular-nums;}
   .range-visual {position:relative; height:22px; width:100px; margin-left:auto; flex-shrink:0;}
   .range-whisker {position:absolute; top:10px; left:0; right:0; border-top:1px solid var(--muted);}
   .range-whisker::before,.range-whisker::after {content:""; position:absolute; height:9px; border-left:1px solid var(--muted); top:-5px;}
   .range-whisker::after {right:0;}
   .range-box {position:absolute; top:2px; height:17px; border:1px solid var(--accent); background:var(--accent-soft); border-radius:3px;}
   .range-median {position:absolute; height:21px; border-left:2px solid var(--accent); top:0;}
   .sale-details {margin-top:12px; border-top:1px solid var(--line); border-bottom:1px solid var(--line);}
   .sale-details summary {list-style:none; cursor:pointer; display:flex; justify-content:space-between; align-items:center; min-height:40px; font-size:12px; font-weight:600;}
   .sale-details summary::-webkit-details-marker {display:none;}
   .sale-count {display:flex; align-items:center; gap:12px; color:var(--muted);}
   .chevron {font-size:15px;}
   .sale-details[open] .chevron {transform:rotate(180deg);}
   .sale-list {list-style:none; padding:0; margin:0 0 4px;}
   .sale-list li {display:flex; gap:10px; justify-content:space-between; align-items:center; padding:8px 0; border-top:1px solid var(--line); font-size:12px;}
   .sale-list li span {color:var(--muted); min-width:0; overflow-wrap:anywhere;}
   .sale-list li strong {font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap;}
   .price-note {font-size:11px; line-height:1.5; color:var(--muted); margin-top:8px;}
   .copy-button {padding:8px 0 0;}
   .acsearch-button {margin-top:12px; width:100%;}
   .popup-footer {padding:8px 16px; min-height:40px; font-size:11px; color:var(--muted); border-top:1px solid var(--gold-line); display:flex; align-items:center; justify-content:space-between; gap:8px; flex-shrink:0; background:var(--bg);}
   .popup-footer a {text-decoration:none; padding:4px 0;}
   .popup-footer a:hover {text-decoration:underline;}
   .lookup-prompt,.storage-note {font-size:12px; line-height:1.5; padding:12px 16px; color:var(--muted);}
   .storage-note {color:var(--error);}
   .sr-only {position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0;}
   @media (max-width:359px) {
     .popup-header,.reference-form,.recent,.popup-footer,.lookup-prompt,.storage-note {padding-left:12px; padding-right:12px;}
     .result {margin-left:12px; margin-right:12px; padding:12px;}
     .primary-button {padding:0 10px;}
     .range-visual {width:70px;}
   }
   ```

   The `[hidden]`, `body {width:400px}`, `.popup {max-height:600px}`, `.sr-only`, `.ric-fields` grid, `.search-row`, `.range-*` geometry and the `details` rules keep their old values or hooks; only tokens, fonts, radii, spacing and hover states change, and `button:hover,a:hover {filter:brightness(.92)}` is replaced by the explicit hover rules above.

5. `extension/popup.js`:
   - Preferences import becomes `import { DEFAULT_NUMBER, DEFAULT_SECTION, STORAGE_KEY, THEME_KEY, rememberRecent, rememberTerm, restorePreferences, restoreTheme } from './preferences.js';`.
   - After the `labelCache` object (before `currentReference`) add:

     ```js
     // Light or dark: the popup follows the system scheme until the header button is used. That choice is stored under its own key as a bare
     // 'light' or 'dark' (theme.js applies it before the first paint; restoreTheme validates it here too, so anything else falls back to the system).
     const darkScheme = matchMedia('(prefers-color-scheme: dark)');
     const shownTheme = () => document.documentElement.dataset.theme || (darkScheme.matches ? 'dark' : 'light');

     // The button is "pressed" while dark is shown, and its icon shows what a click switches to: a moon in light, a sun in dark.
     function syncThemeButton() {
       const dark = shownTheme() === 'dark';
       $('theme-toggle').setAttribute('aria-pressed', String(dark));
       $('theme-toggle').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
       $('icon-sun').hidden = !dark;
       $('icon-moon').hidden = dark;
     }

     function applyStoredTheme() {
       let theme = '';
       try { theme = restoreTheme(localStorage.getItem(THEME_KEY)); } catch { /* unreadable storage: follow the system */ }
       if (theme) document.documentElement.dataset.theme = theme;
       else delete document.documentElement.dataset.theme;
     }

     // A click switches to the opposite of what is shown and remembers it; a failed write shows the storage note like any other preference.
     function chooseTheme(theme) {
       document.documentElement.dataset.theme = theme;
       try { localStorage.setItem(THEME_KEY, theme); }
       catch { $('storage-note').hidden = false; }
       syncThemeButton();
     }
     ```

   - Start-up: after `renderRecent();` add `applyStoredTheme();` and `syncThemeButton();` (two lines).
   - Listeners: directly before the right-click block (`// A right-click lookup opens popup.html?q=…`) add

     ```js
     $('theme-toggle').addEventListener('click', () => chooseTheme(shownTheme() === 'dark' ? 'light' : 'dark'));
     // Only matters while following the system: shownTheme reads a stored choice first.
     darkScheme.addEventListener('change', syncThemeButton);
     ```

   - Nothing else changes: `currentReference`, `savePreferences`, `fillSelects`, `renderCard`, `renderPrices`, `run`, `runPrices`, the submit handlers and the `?q=` path are untouched.

6. Icon.
   - `extension/icon.svg` becomes exactly (one line, no trailing text):

     ```svg
     <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#6B1F5C"/><rect x="28" y="30" width="72" height="12" rx="3" fill="#F1E7D8"/><rect x="36" y="42" width="12" height="54" fill="#F1E7D8"/><rect x="80" y="42" width="12" height="54" fill="#F1E7D8"/><path d="M22 92 44 78 62 86 84 60 106 66" fill="none" stroke="#E8BE5A" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>
     ```

   - `scripts/make_icons.py` (new; exact content, verified against Pillow 12.3.0):

     ```python
     #!/usr/bin/env python3
     """Render extension/icons/icon-{16,32,48,128}.png from the geometry of extension/icon.svg with Pillow (a development tool only).

     The icon is drawn at 1024 px with the SVG's own numbers (a 128-unit viewBox, scaled by 8) and downsampled with LANCZOS, so the PNGs
     match the SVG; below 48 px the lintel, columns and price line are drawn heavier (same axes and end points) so they survive at 16 and 32 px.
     Usage: python scripts/make_icons.py [--check]. --check writes nothing and exits 1 when a committed PNG differs from a fresh render.
     """

     from __future__ import annotations

     import sys
     from pathlib import Path

     from PIL import Image, ImageChops, ImageDraw

     ICON_DIRECTORY = Path(__file__).resolve().parents[1] / "extension" / "icons"
     SIZES = (16, 32, 48, 128)
     CANVAS = 1024  # 8 x the 128-unit viewBox
     TILE = "#6B1F5C"
     IVORY = "#F1E7D8"
     GOLD = "#E8BE5A"
     LINE = ((22, 92), (44, 78), (62, 86), (84, 60), (106, 66))

     # Master geometry (icon.svg) for 48 and 128 px; a heavier cut for 16 and 32 px, with the same axes and end points.
     MASTER = {"lintel": (28, 30, 72, 12), "columns": ((36, 42, 12, 54), (80, 42, 12, 54)), "stroke": 7}
     SMALL = {"lintel": (28, 29, 72, 14), "columns": ((34, 42, 16, 54), (78, 42, 16, 54)), "stroke": 10}


     def render(size: int) -> Image.Image:
         geometry = MASTER if size >= 48 else SMALL
         scale = CANVAS / 128
         image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
         draw = ImageDraw.Draw(image)

         def box(x: float, y: float, width: float, height: float) -> tuple[float, float, float, float]:
             return (x * scale, y * scale, (x + width) * scale, (y + height) * scale)

         draw.rounded_rectangle(box(0, 0, 128, 128), radius=28 * scale, fill=TILE)
         draw.rounded_rectangle(box(*geometry["lintel"]), radius=3 * scale, fill=IVORY)
         for column in geometry["columns"]:
             draw.rectangle(box(*column), fill=IVORY)
         stroke = geometry["stroke"] * scale
         points = [(x * scale, y * scale) for x, y in LINE]
         draw.line(points, fill=GOLD, width=round(stroke), joint="curve")
         for x, y in (points[0], points[-1]):  # round caps
             draw.ellipse((x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2), fill=GOLD)
         return image.resize((size, size), Image.Resampling.LANCZOS)


     def matches(path: Path, fresh: Image.Image) -> bool:
         if not path.is_file():
             return False
         with Image.open(path) as committed:
             return committed.mode == "RGBA" and committed.size == fresh.size and ImageChops.difference(committed, fresh).getbbox() is None


     def main(arguments: list[str]) -> int:
         check = arguments == ["--check"]
         if arguments and not check:
             print("usage: make_icons.py [--check]", file=sys.stderr)
             return 2
         ICON_DIRECTORY.mkdir(parents=True, exist_ok=True)
         stale = []
         for size in SIZES:
             target = ICON_DIRECTORY / f"icon-{size}.png"
             fresh = render(size)
             if check:
                 if not matches(target, fresh):
                     stale.append(target.name)
             else:
                 fresh.save(target, format="PNG", optimize=True)
                 print(f"extension/icons/{target.name}")
         if stale:
             print(f"stale: {', '.join(stale)} (run python scripts/make_icons.py)", file=sys.stderr)
             return 1
         return 0


     if __name__ == "__main__":
         raise SystemExit(main(sys.argv[1:]))
     ```

   - Run `python scripts/make_icons.py` once and commit the four regenerated PNGs (RGBA, transparent corners; expect `git status` to list exactly the four). Then `python scripts/make_icons.py --check` exits 0.
   - Delete `scripts/render-icons.ps1` (`git rm scripts/render-icons.ps1`); nothing references it.

7. `scripts/build.py`: `ASSET_PATHS` gains `"theme.js"` directly after `"popup.js"`. `tests/test_packages.py`: `ASSETS` gains `"theme.js"`, and both `0.13.0` occurrences (version assertion, ZIP name) become `0.14.0`.

8. Version 0.14.0 and docs:
   - `manifests/brave.json`, `manifests/firefox.json`: `"version": "0.14.0"` (description unchanged).
   - `README.md`: intro `Version **0.14.0**`; after the **Alt+Shift+G** bullet add `- A light or dark look: the popup follows your system theme until you select the sun or moon button in the header, and that choice is remembered.`; the paragraph after the checks block becomes `The runtime has no dependencies. Building uses Python's standard library; `python scripts/make_icons.py` redraws the toolbar icon PNGs from the geometry of `extension/icon.svg` and needs Pillow, a development tool that is never packaged. `web-ext` is used only for validation. Fixtures under `tests/fixtures/` are real API responses captured on 2026-09-10 and 2026-09-11, including a logged-out acsearch page trimmed to three lots.` (the checks block itself is unchanged).
   - `docs/INSTALL.md`: every `0.13.0` → `0.14.0` (intro, two ZIP names in the block, Brave step 1, Firefox step 4); in "What to try", after the `Close and reopen the popup` line add `- Select the sun or moon button in the header: the popup switches between its light and dark look and remembers the choice; until then it follows your system theme.`
   - `install/index.html`: `0.13.0` → `0.14.0` in the eyebrow, the intro and both ZIP links; in "What to try", append to the third paragraph (after `Your choices stay in your browser.`) the sentence ` Select the sun or moon in the header to switch between the light and dark look; until you do, the popup follows your system theme.`
   - `install/styles.css`: replace lines 1 and 2 with

     ```css
     :root{color-scheme:light dark;--canvas:#F7F2EA;--surface:#fff;--ink:#2A1433;--muted:#7A6680;--border:#E4D6C6;--accent:#6B1F5C;--on-accent:#FDF6EC;--soft:#F1E9DD;font-family:"Segoe UI",Arial,sans-serif;background:var(--canvas);color:var(--ink)}
     @media(prefers-color-scheme:dark){:root{--canvas:#140811;--surface:#1F0E1B;--ink:#F3E6EE;--muted:#B99AAE;--border:#3E2238;--accent:#D8B25A;--on-accent:#1A0A15;--soft:#2A1526}}
     ```

     and in line 3 replace `h1{font-size:32px;font-weight:600;letter-spacing:-.04em;margin-top:4px}h2{font-size:25px;font-weight:600;letter-spacing:-.025em}` with `h1{font-family:Georgia,"Iowan Old Style","Palatino Linotype",serif;font-size:32px;font-weight:600;letter-spacing:-.01em;margin-top:4px}h2{font-family:Georgia,"Iowan Old Style","Palatino Linotype",serif;font-size:25px;font-weight:600;letter-spacing:-.01em}`. Nothing else in the file changes (the page keeps following the system; the icon paths already point at the regenerated PNGs).
   - Remove the stale `dist/giga-pinax-*-0.13.0.zip` after building.

**Tests**

`tests/preferences.test.mjs`: the imports become

```js
import { readFileSync } from 'node:fs';
import { restorePreferences, rememberTerm, rememberRecent, RECENT_LIMIT, STORAGE_KEY, CURRENCIES, DEFAULT_NUMBER, DEFAULT_SECTION, THEME_KEY, THEMES, restoreTheme } from '../extension/preferences.js';
```

(the `node:test` and `node:assert/strict` imports stay), and append:

```js
test('restoreTheme keeps only an exact light or dark choice; anything else follows the system', () => {
  assert.equal(THEME_KEY, 'giga-pinax-theme-v1');
  assert.deepEqual([...THEMES], ['light', 'dark']);
  assert.ok(Object.isFrozen(THEMES));
  assert.equal(restoreTheme('light'), 'light');
  assert.equal(restoreTheme('dark'), 'dark');
  for (const raw of [null, undefined, '', 'Dark', 'system', 'auto', ' dark', '"dark"', 0, {}, []]) assert.equal(restoreTheme(raw), '', String(raw));
});

test('theme.js is a classic pre-paint script that reads the same key and accepts the same two values', () => {
  const source = readFileSync(new URL('../extension/theme.js', import.meta.url), 'utf8');
  assert.ok(source.includes(`'${THEME_KEY}'`));
  assert.ok(!/^\s*(?:import|export)\b/m.test(source));
  for (const theme of THEMES) assert.ok(source.includes(`=== '${theme}'`), theme);
  assert.ok(source.includes('dataset.theme = theme'));
});
```

`tests/test_icons.py` (new):

```python
import importlib.util
import struct
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "extension" / "icons"
SVG = ROOT / "extension" / "icon.svg"
SCRIPT = ROOT / "scripts" / "make_icons.py"
SIZES = (16, 32, 48, 128)
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_header(path: Path) -> tuple[int, int, int, int]:
    data = path.read_bytes()
    assert data[:8] == PNG_SIGNATURE, path
    assert data[12:16] == b"IHDR", path
    width, height, bit_depth, colour_type = struct.unpack(">IIBB", data[16:26])
    return width, height, bit_depth, colour_type


class IconFileTests(unittest.TestCase):
    def test_the_four_pngs_are_square_8_bit_rgba_at_their_sizes(self) -> None:
        for size in SIZES:
            with self.subTest(size=size):
                self.assertEqual((size, size, 8, 6), png_header(ICONS / f"icon-{size}.png"))

    def test_the_master_svg_is_the_porphyry_pinax(self) -> None:
        svg = SVG.read_text(encoding="utf-8")
        self.assertIn('viewBox="0 0 128 128"', svg)
        self.assertIn('rx="28" fill="#6B1F5C"', svg)
        self.assertEqual(3, svg.count('fill="#F1E7D8"'))
        self.assertIn('stroke="#E8BE5A" stroke-width="7"', svg)
        self.assertIn('d="M22 92 44 78 62 86 84 60 106 66"', svg)
        self.assertNotIn("#0B3B36", svg)


@unittest.skipUnless(importlib.util.find_spec("PIL"), "Pillow is not installed (development tool only)")
class IconRenderTests(unittest.TestCase):
    def test_committed_pngs_match_a_fresh_render_and_the_svg_colours(self) -> None:
        spec = importlib.util.spec_from_file_location("giga_pinax_make_icons", SCRIPT)
        make_icons = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(make_icons)
        svg = SVG.read_text(encoding="utf-8")
        for colour in (make_icons.TILE, make_icons.IVORY, make_icons.GOLD):
            self.assertIn(colour, svg)
        for size in SIZES:
            with self.subTest(size=size):
                fresh = make_icons.render(size)
                self.assertEqual("RGBA", fresh.mode)
                self.assertEqual((0, 0, 0, 0), fresh.getpixel((0, 0)))
                self.assertTrue(make_icons.matches(ICONS / f"icon-{size}.png", fresh))


if __name__ == "__main__":
    unittest.main()
```

(`PNG_SIGNATURE` is an escaped bytes literal; the source file contains only printable ASCII. The Node cases and `restoreTheme` were run against a scratch copy of `preferences.js` and `theme.js`; the Pillow render was run in a scratch directory on 2026-09-11: sizes, mode, transparent corners and run-to-run byte equality confirmed.)

**Verify:** new tests fail first for the expected reasons (`THEME_KEY`/`restoreTheme` not exported, `theme.js` missing, old icon geometry, `make_icons.py` missing); then `node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs tests/selection.test.mjs tests/catalogues.test.mjs` 80/80 (78 + 2), `python -m unittest discover -s tests -p "test_*.py"` 12 OK (9 + 3), `python scripts/make_icons.py --check` exit 0, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check` on each of `extension/theme.js`, `extension/popup.js`, `extension/preferences.js`, `git grep -nE "(^|[^0-9.@])0\.13\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing, and `git grep -nP '[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}]' -- ':!*.png' ':!*.zip'` prints nothing. Confirm `dist/` holds only `0.14.0` ZIPs, `dist/brave/theme.js` exists, `dist/brave/icons/icon-16.png` is the new file (same digest as `extension/icons/icon-16.png`), and `git status` shows no `scripts/render-icons.ps1`.

**Commit** the twenty-two paths (three new, one deleted, four binary): `Redesign the popup in Porphyry with a light/dark switch, a new Pinax icon and release 0.14.0`.

## Verification (controller)

Result 2026-09-11 at `19ce68e`, in-app Chromium 440×680 on `http://localhost:8793` (never loaded before), live numismatics.org, acsearch stubbed with the nine fictional lots below:

- Light (system light, nothing stored): body `#F7F2EA`, card `#FFFFFF`, ink `#2A1433`, title and median in the Georgia stack, median `$240` in `#9C7424`, 9 sales, term `(Hermaeus Hermaios) "Bopearachchi 20"`, body 400 px; `<head>` order `theme.js` → `popup.css` → `popup.js`; toggle `aria-label="Dark theme"`, `aria-pressed="false"`. Screenshot (lower half): parchment page, white rounded card, porphyry sale links and full-width porphyry `Search on acsearch`, footer on parchment. Pass.
- Dark (system dark, nothing stored): body `#140811`, card `#1F0E1B`, ink `#F3E6EE`, gold `#D8B25A` Look up button with `#1A0A15` text, median `$240` in `#D8B25A`, citation `Bopearachchi Hermaios 20`, `aria-pressed="true"`, 400 px. Pass (computed styles; dark screenshots timed out because the pane was not drawing).
- Toggle from light: flips at once to the dark tokens, stores `dark`, `aria-pressed="true"`; reload with system light → dark; stored `nonsense` → follows the system, no `data-theme`; `setItem` throwing → the theme still flips, the storage note appears, no error. Pass.
- Install page: serif headings, ink `#2A1433`, new 48 px icon loads, version `0.14.0`. Pass.
- Icons viewed at 128/48/32/16: porphyry tile, ivory lintel and columns, gold rising line; the 16 px one still reads as the mark. Pass.
- Review found the toggle glyph never swapped (`.hidden` is a no-op on `<svg>`; a dark screenshot showed the moon in dark mode). Fix round `88f8282` (`toggleAttribute('hidden', …)`), re-checked on `http://localhost:8794`: system light → moon shown (18 px), sun hidden, `aria-pressed="false"`; click → dark, sun shown, moon hidden, `aria-pressed="true"`; click again → light, moon; system dark with nothing stored → sun, `aria-pressed="true"`. Pass.

Planned checks:

Planned checks, in the in-app Chromium on a never-loaded localhost origin (never cached), e.g. `python -m http.server 8793 --bind 127.0.0.1` from the repo root and `http://localhost:8793/extension/popup.html` in a 440×680 window (popup body 400 px), live numismatics.org. `prefers-color-scheme` is emulated per tab (the browser tool's `resize_window` `colorScheme`, or DevTools › Rendering › Emulate CSS media feature). acsearch is unreachable from a plain tab (CORS), so to **show the prices panel** paste this in the tab's console before the lookup (fictional lots, so the panel renders; `fetchPrices` reads the global `fetch` on each call, and a plain tab has no permissions API, so the lookup fetches prices itself):

```js
const realFetch = window.fetch;
const lots = [['2401','01.02.2024','$120'],['2402','15.03.2024','$150'],['2403','22.05.2024','$180'],['2404','09.09.2024','$200'],['2405','30.11.2024','$240'],
  ['2501','14.01.2025','$260'],['2502','03.04.2025','$300'],['2503','21.06.2025','$350'],['2601','12.02.2026','$1,200']]
  .map(([id, date, price]) => ({ id, title: `Fictional test lot ${id}`, date, price }));
window.fetch = (url, init) => String(url).startsWith('https://www.acsearch.info/')
  ? Promise.resolve(new Response(`<script>acsearch.initSearchResults = ${JSON.stringify(lots)};</script>`, { status: 200 }))
  : realFetch(url, init);
```

- **Empty popup, light and dark:** screenshots with the emulated scheme light then dark and no stored theme (`localStorage.removeItem('giga-pinax-theme-v1')`). Parchment `#F7F2EA` page / near-black `#140811`; serif `Giga Pinax` in porphyry / gold; gold hairline under the header and above the footer; white / `#1F0E1B` inputs with the taupe border; the theme button at the header's right showing a moon (light) or a sun (dark), `aria-pressed` `false` / `true`, title `Switch to dark theme` / `Switch to light theme`; `document.body.scrollWidth` 400; footer on the page colour (not a grey band).
- **`Bop Hermaeus 20` card, both modes:** the result is a white / `#1F0E1B` rounded card inset 16 px with a 1 px edge (light: faint shadow); title `Bactrian and Indo-Greek Coinage Hermaeus 20` in the serif, citation and summary muted, `Type ↗` right-aligned; obverse/reverse as before; the prices form inside the card; term `(Hermaeus Hermaios) "Bopearachchi 20"` unchanged. Screenshots.
- **Prices panel (with the stub), both modes:** `Median hammer price` label, `$240` in the 44 px serif gold (old-style or lining figures depending on the font, both accepted), `9 sales matching …`, the middle-50% inset on the parchment / page colour with the porphyry / gold box, `Inspect sales` with nine rows, `Copy summary`, the full-width `Search on acsearch` button. Screenshots.
- **Toggle:** click → the theme flips at once and `localStorage.getItem('giga-pinax-theme-v1')` is `'dark'` (or `'light'`); the icon and `aria-pressed` follow; reload → the same theme. Emulate the opposite system scheme → no change while a choice is stored. `localStorage.removeItem(...)` + reload → follows the emulated scheme again, and toggling the emulation while the popup is open changes both the theme and the button.
- **No flash:** with emulated light and `localStorage.setItem('giga-pinax-theme-v1','dark')`, reload several times: the first frame is dark (no light flash). `[...document.head.children].map((e) => e.tagName + ' ' + (e.src || e.href || ''))` lists `theme.js` before `popup.css` before `popup.js`. With a stored `'nonsense'`, the popup follows the system and `document.documentElement.dataset.theme` is undefined after load.
- **Storage failure:** in the console, `Object.defineProperty(localStorage.__proto__, 'setItem', { value() { throw new Error('quota'); } })`, then click the toggle: the theme still flips, the storage note appears, no console error; reload restores the real storage.
- **Contrast spot checks** (`getComputedStyle`): ink `rgb(42, 20, 51)` on the card `rgb(255, 255, 255)`; input `border-color` `rgb(154, 131, 114)` light / `rgb(138, 100, 130)` dark; median `color` `rgb(156, 116, 36)` light / `rgb(216, 178, 90)` dark; footer text `rgb(122, 102, 128)` on `rgb(247, 242, 234)`; primary button `rgb(107, 31, 92)` with text `rgb(253, 246, 236)` light, `rgb(216, 178, 90)` with `rgb(26, 10, 21)` dark. These pairs are the table's 16.85 / 3.58 / 3.72 / 4.25 / 9.18 / 4.66 / 9.91 / 9.50 rows.
- **Earlier flows in both modes:** RIC with the volume and section selects (`V` + `Carausius issuing for Diocletian/Maximian` keeps the body at 400 px); Bop with the King list; `Crawford 44/5`, `SC 1266.2`, `Price 23` cards; `Bop-9C` pick-list (text buttons, hairline-separated); `RIC I Nero 306` "Did you mean"; Recent chips as pills (soft fill, ink text, accent edge on hover, ellipsis on the BIGR title); `Copy summary` relabels to `Copied`; errors: `Bopearachi 9C` (one-box error in `--error`), `RIC I² Nero 9999999` (not found), and the prices note with the sign-in link when the stub is removed and the real acsearch fails (network message in `--error`). Keyboard: Tab reaches the theme button (visible 3 px ring), Space toggles it.
- **Right-click window:** `popup.html?q=Bop%20Hermaeus%2020` resolves without a click and shows the stored theme.
- **Icons:** open `extension/icons/icon-16.png`, `-32`, `-48`, `-128` and `icon.svg`: porphyry rounded tile, ivory lintel and two columns, gold rising price line; the 16 px one still reads as columns with a line; corners transparent (view against both a light and a dark page). `install/index.html` shows the new icon, the parchment / near-black palette and serif headings.
- **Console:** clean apart from the expected plain-tab acsearch CORS lines when the stub is not installed; `dist/brave/manifest.json` version `0.14.0`.
