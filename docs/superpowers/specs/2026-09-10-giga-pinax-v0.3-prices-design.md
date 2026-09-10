# Giga Pinax v0.3: acsearch prices

## Decisions

- acsearch approved the workflow the user described to them: one collector, their own Premium account, one user-initiated reference lookup returning a median plus links to the sales. Everything below stays inside that: one request per click, no background activity, no bulk or paged collection, nothing from acsearch cached beyond the result on screen.
- Prices come from the acsearch results page fetched by the popup with the collector's own cookies. The page embeds its lots as a JSON array (`acsearch.initSearchResults = [...]`) with `id`, `title`, `description`, `image`, `date`, `price`, `last`; when the visitor is not signed in as Premium, `price` is `"*"`.
- The collector can edit the acsearch search term before it runs. No automatic filtering of lots by catalogue citation.
- The median is computed from the 100 most recent sales acsearch returns (`order=1`), one page.
- The approved median-price layout from `prototype/` returns.

## Scope

In: acsearch host permission; editable search term; one-page fetch; price parsing and statistics; median panel and sales list; sign-in and empty states; CHF currency; tests; docs; version 0.3.0.

Out: date-range filters, multiple pages, sign-in detection beyond the price check, images, RRC/CRRO, collection tracking, Mozilla signing.

## Flow

1. Type lookup runs exactly as in v0.2 and renders the type card.
2. Below the card, a **Prices** block shows a text field `acsearch search` pre-filled from the reference — RIC: `{section} {number}` (e.g. `Nero 306`); Price: `Price {number}` — and a **Get prices** button. The last term the collector used for that exact reference is restored instead of the default when one is stored.
3. Get prices requests `https://www.acsearch.info/search.html?term={encoded term}&category=1&currency={usd|eur|gbp|chf}&order=1` with `credentials: 'include'`, a 15-second `AbortController` timeout, and no other headers.
4. The response HTML is scanned for `acsearch.initSearchResults = ` followed by a JSON array terminated by `;`. The array is parsed with `JSON.parse`. Any failure to find or parse it is a network-class error (acsearch changed its page).
5. Each lot's `price` is parsed: strip everything except digits, `.`, `,`, `'` and spaces; remove thousands separators (`'`, spaces, and `,` when followed by exactly three digits); the result must be a finite non-negative number. Lots whose `price` is `"*"`, empty, or unparseable are excluded. If at least one lot exists and every lot is `"*"`, the state is **not signed in**.
6. Statistics over the included prices, sorted ascending: count; median; lower and upper quartile by linear interpolation at positions `0.25·(n−1)` and `0.75·(n−1)`; earliest and latest `date` (acsearch dates are `DD.MM.YYYY`).
7. The panel renders. The term is saved with preferences under the key of the resolved type id.

## Prices panel

Replaces the v0.2 "Prices not connected yet" placeholder inside the result card, below the obverse/reverse rows.

- Term row: label `acsearch search`, text input (max 120 chars, monospace like the reference field), primary button **Get prices** that reads **Fetching…** while pending and is disabled.
- After success: `Median hammer price` label; the median large with the currency code beside it; `n sales · {earliest year}–{latest year}` (a single year when equal; `1 sale` singular); the middle-50% block with the range text and the whisker visual, whose box and median marker are positioned proportionally between the minimum and maximum price; an expandable **Inspect sales** list (`n` in the summary) of rows `date · title` with the hammer on the right, each row's title linking to `https://www.acsearch.info/search.html?id={id}` in a new tab; the note `Hammer prices exclude buyer's fees, tax and shipping. Only the 100 most recent sales are counted.` (the second sentence appears only when acsearch returned 100 lots).
- **Search on acsearch ↗** link stays and carries the current term, currency and order.
- Formatting: `Intl.NumberFormat('en-US', {style:'currency', currency, maximumFractionDigits:0})`.

## States

| Condition | Presentation |
|---|---|
| Not signed in (all prices `*`) | Muted note, not an error: `Sign in on acsearch with your own account, then select Get prices again.` with a `Sign in ↗` link to `https://www.acsearch.info/login.html`. |
| Zero lots | `acsearch returned no sales for "{term}". Try a broader term.` |
| Lots but none priced (unsold only) | `No hammer prices among the sales acsearch returned for "{term}".` |
| Network failure, non-2xx, timeout, page shape not recognised | `Couldn't reach acsearch. Check your connection and try again.` |
| Host permission refused | `Giga Pinax needs permission to contact acsearch.info to fetch prices. Select Get prices again to allow it.` |

Errors render in a `role="alert"` element inside the Prices block, not in the reference form's error slot. Changing the reference hides the prices panel; changing only the term keeps the old numbers visible until Get prices is pressed again. Changing currency clears the prices panel (a new fetch is required since acsearch converts).

## Permissions

`host_permissions` becomes `["https://numismatics.org/*", "https://nomisma.org/*", "https://www.acsearch.info/*"]`. Get prices requests the acsearch origin via `permissions.contains` then `permissions.request` from the click handler, mirroring v0.2. Firefox `data_collection_permissions.required` stays `["none"]`: the search term travels to acsearch under the collector's own session and nothing is retained or sent elsewhere.

## Code

- New `extension/prices.js`: `buildSearchUrl({term, currency, order})`, `extractLots(html) → Lot[] | null`, `parsePrice(text) → number | null`, `summarise(lots) → {count, median, lowerQuartile, upperQuartile, min, max, earliest, latest, priced: Lot[], total, signedOut: boolean}`, `defaultTerm(reference, card)`, and `fetchPrices({term, currency}, {fetchImpl, timeoutMs}) → {status:'ok', summary} | {status:'signed-out'} | {status:'empty', term} | {status:'unpriced', term} | {status:'network'}`.
- `extension/preferences.js`: currency list gains `CHF`; preferences gain `terms: {[typeId]: string}` capped at 50 entries, oldest dropped.
- `extension/popup.{html,css,js}`: prices block, panel and states; the median/range/sale-list styles are ported from `prototype/styles.css`.
- Manifests: version `0.3.0`, host permission added.
- Docs: README, INSTALL and the install page describe the price flow, the sign-in requirement, and the approval scope.

## Testing

- `tests/prices.test.mjs` against `tests/fixtures/acsearch-search-nero-306.html` — a logged-out page captured 2026-09-10 and trimmed to its first three lots (all prices `*`) — plus synthetic lot arrays: `buildSearchUrl` encoding and parameters; `extractLots` on the fixture, on a page without the array (`null`), and on malformed JSON (`null`); `parsePrice` on `1,200`, `1'200`, `1 200`, `1200 USD`, `*`, `` and `abc`; `summarise` on 1, 2, 9 and 100 prices including unsold entries, checking median, quartiles (the spec's fixed sample `90…450` → median 180, quartiles 135–245), date span and the 100-lot flag; `fetchPrices` outcomes with a fake fetch including the signed-out page, abort/timeout, and non-2xx.
- Package and manifest tests updated for the new asset and permission list.
- `web-ext lint` clean.
- Manual, by the user on their Premium account: a real lookup returns numbers; the logged-in `price` format is confirmed and, if it differs from the synthetic cases, a trimmed logged-in fixture is added and the parser adjusted.

## Verification of assumptions (2026-09-10)

- acsearch search is a plain GET of `search.html` with `term`, `category`, `currency` (`usd|eur|chf|gbp`), `order` (`0` relevance, `1` most recent first, `2` oldest, `3` hammer descending, `4` ascending). Session cookie `PHPSESSID`.
- The results page inlines `acsearch.initSearchResults = [{id, title, description, image, date, price, last}, …]`; logged out, every `price` is `"*"`. The page reports `Results 1-100 of 647 for nero 306`.
- The logged-in `price` format has not been observed; the parser is written to tolerate common separator styles and is confirmed on the user's account after the build.
