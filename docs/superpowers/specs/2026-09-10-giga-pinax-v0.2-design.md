# Giga Pinax v0.2: real reference lookup

## Decisions

- Project and extension are named **Giga Pinax**.
- acsearch price retrieval is deferred until acsearch answers a permission request. Their terms (§2.1(b)) forbid "software for the systematic collection of data and content"; each collector using their own Premium account satisfies §3.3 but not §2.1(b). No code in this version requests, reads or parses acsearch content.
- acsearch sign-in detection is also deferred; the right mechanism depends on what acsearch offers.
- Reference resolution uses the American Numismatic Society's open type corpora: OCRE for RIC and PELLA for Price. Both are Open Database License 1.0 and expose a search API and per-record JSON-LD.
- Sample mode, the fictional prices and the welcome screen are removed from the extension. The approved price layout remains in `prototype/` and returns when pricing is real.

## Scope

In: rename; live type lookup for RIC and Price; "Search on acsearch" link; host permissions; tests; docs and packaging updates; version 0.2.0.

Out: acsearch prices, sign-in detection, RRC/CRRO, images in the popup, Mozilla signing, store listing, icon redesign, collection tracking.

## Rename

| Where | Value |
|---|---|
| Manifest `name` | `Giga Pinax` |
| Manifest `description` | `Look up ancient coin types by RIC or Price reference using open numismatic data.` |
| Manifest `version` | `0.2.0` |
| Firefox gecko id | `giga-pinax@local.invalid` (nothing has shipped, so changing the id is safe) |
| Popup `<title>` and `<h1>` | `Giga Pinax`; tagline `Ancient coin reference` |
| ZIP names | `giga-pinax-{browser}-{version}.zip` |
| Storage key | `giga-pinax-preferences-v1` (old key is simply ignored) |
| README, INSTALL, install page | updated to match |

## Lookup flow

1. Collector picks catalogue (Price or RIC), fills the guided fields, submits.
2. Build a search query:
   - Price: `Price {number}`
   - RIC: `RIC {volume} {section} {number}`, with edition words normalised so `I (2nd edition)` becomes `I (second edition)` to match OCRE titles.
3. `GET https://numismatics.org/{ocre|pella}/apis/search?q={query}` returns an Atom feed. Each `<entry>` has `<title>` and `<id>`/`<link>` holding the record URI.
4. Pick the entry whose title equals the query, case-insensitive after collapsing whitespace. If none matches exactly and there are 1–5 entries, show them as a pick-list. If there are 0 entries, show the not-found message. If more than 5 and none exact, show the not-found message with a hint to check the fields.
5. `GET https://numismatics.org/{corpus}/id/{id}.jsonld`. From the `@graph`: `skos:prefLabel`, `nmo:hasAuthority`, `nmo:hasDenomination`, `nmo:hasMint`, `nmo:hasMaterial`, `nmo:hasStartDate`, `nmo:hasEndDate`, and the obverse/reverse nodes' `nmo:hasLegend` and `dcterms:description`. Any field may be absent; render what exists.
6. Authority, denomination, mint and material are nomisma URIs. Resolve each to its English `skos:prefLabel` from `https://nomisma.org/id/{slug}.jsonld`, fetched in parallel and cached in `localStorage` under `giga-pinax-labels-v1`. A label that fails to resolve falls back to the slug.
7. Render the result card. A lookup uses one 15-second `AbortController` deadline shared by the search request, the record request and the label requests.

All request logic lives in a new `extension/lookup.js` as pure functions (`buildQuery`, `pickMatch`, `parseFeed`, `toCard`) plus one `lookupType(reference, fetchImpl)` that composes them. `popup.js` only wires DOM to `lookupType`.

## Result card

Replaces the sample results section.

- Catalogue code, e.g. `RIC I (second edition) Nero 306`, in the existing `.catalogue-code` style.
- Summary line: `Nero · As · Rome · Bronze · AD 62–68`. Dates: negative years render as `BC`, positive as `AD`; equal start/end render once.
- Obverse: legend on one line, description on the next. Reverse: same.
- Links: `Type ↗` to `https://numismatics.org/{corpus}/id/{id}` and `Search on acsearch ↗` to `https://www.acsearch.info/search.html?term={encoded prefLabel}`. Both open in a new tab with `rel="noopener noreferrer"`.
- Price panel: the text `Prices not connected yet. Use "Search on acsearch" to view sales with your own account.` in the existing `.range-block` style. No amounts, no range visual.

## Screens and state

- The popup opens directly on the lookup form. The welcome screen, `try-sample`, `help-button` and sample ribbon are removed.
- Footer keeps the acsearch link; the "Account not verified" status text is removed.
- Remembered preferences: catalogue, currency, number, volume, section. Currency stays as a preference for the future price feature but affects nothing now; the selector remains so collectors' choice is kept.
- Defaults when nothing is stored: Price 23; for RIC, `I (2nd edition)` / `Nero` / `306`.
- Editing any field hides the current result and shows the existing "Reference changed" prompt. Submitting shows a "Looking up…" state on the button until the request settles.

## Errors

| Condition | Message |
|---|---|
| Zero results, or many results with no exact match | `No {query} found in {OCRE|PELLA}. Check the volume, edition and number.` |
| 1–5 results, none exact | Pick-list of titles; choosing one runs step 5. |
| Network failure, non-2xx, timeout, unparseable body | `Couldn't reach numismatics.org. Check your connection and try again.` |
| Firefox host permission refused | `Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types.` with a button that re-requests. |

Errors go in the existing `#form-error` alert. No fabricated result is ever shown.

## Permissions

`host_permissions`: `https://numismatics.org/*` and `https://nomisma.org/*` in both manifests. Firefox MV3 treats these as optional at install, so the submit handler calls `browser.permissions.request({origins: [...]})` when `permissions.contains` is false; Chromium grants at install and the call is a no-op. Firefox `data_collection_permissions.required` stays `["none"]`: no collector data leaves the browser.

## Packaging

`scripts/build.py` asset list gains `lookup.js` and drops `sample-data.js`. ZIP naming changes to `giga-pinax-{browser}-{version}.zip`. `tests/test_packages.py` updated to match. Deterministic build behaviour unchanged.

## Testing

- `tests/lookup.test.mjs` (Node test runner, no dependencies) using fixture files saved from real responses in `tests/fixtures/`: OCRE search feed for `nero 306`, PELLA search feed for `price 23` (exact match ranks second), OCRE JSON-LD for `ric.1(2).ner.306`, PELLA JSON-LD for `price.23`, and one nomisma label. Cover: query building including edition normalisation; exact-match picking and the pick-list/none cases; JSON-LD to card with missing fields; date rendering for BC, AD and single-year; timeout and non-2xx producing the network error.
- `tests/sample-data.test.mjs` is deleted with `sample-data.js`.
- `python -m unittest` package tests pass with the new file list and names.
- `web-ext lint --warnings-as-errors` is clean.
- Manual in Brave and Firefox: Price 23, RIC I (2nd edition) Nero 306, RIC I (2nd edition) Nero 999999, offline; confirm the Firefox permission prompt appears once and the popup opens at full width.

## Verification of assumptions (2026-09-10)

- OCRE and PELLA JSON-LD, Atom search, ODbL license and field names confirmed against live responses.
- acsearch search is `GET https://www.acsearch.info/search.html?term=…`; hammer prices are hidden behind login for non-Premium visitors.
- nomisma.org records expose `skos:prefLabel` with `@language: "en"`.
