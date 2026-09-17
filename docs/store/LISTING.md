# Giga Pinax 0.29.0 store listing

## Name and summaries

**Name:** Giga Pinax

**Chrome short description (under 132 characters):**

> Research ancient coins and sale prices; manage local auction, provenance and collection records.

**Firefox summary:**

> Research ancient coin types and session sale prices. Plan bids, track auctions, provenance and collection records, and compare saved coins. Giga Pinax never places bids.

## Long description

Giga Pinax is a research and collection workspace for ancient-coin collectors. Enter or highlight a catalogue reference to find an open type record, review sale results, and keep the lot beside your research.

Features include:

- RIC, RRC/Crawford, Seleucid Coins, Price and Bopearachchi type lookups, plus prices-only references;
- public type data from American Numismatic Society projects and Nomisma.org;
- session sale-price research from acsearch, with collector-controlled exclusions and consistent count, range, median and summary calculations;
- auction identity and duplicate checks, workflow queues, reminders, notes and outcomes;
- bid totals and affordable-bid calculations with premium, shipping, payment fees and a collector-entered fixed increment;
- provenance, measurements, condition, external photo URL links and two-to-four coin comparison; and
- browser-local records with explicit JSON backup and import.

Research terms are sent over HTTPS to `numismatics.org`, `nomisma.org` or `www.acsearch.info` when needed for the lookup. acsearch uses the collector's existing provider session. A separate **Get CoinArchives prices** action requests optional access to `www.coinarchives.com` and reads one public results page without credentials. Its median uses only the selected original currency and identifies the public archive's coverage and result limit. CoinArchives Pro and RPC Online remain external links; Giga Pinax does not receive their credentials or import their paid results. GitHub is contacted when the collector chooses a release download.

Saved records stay in browser extension storage. Giga Pinax stores external photo URL links, not photo binaries. A collector-specified HTTP or HTTPS photo server is contacted only after saved-coin comparison opens, and each image is lazy-loaded without a referrer. Fetched acsearch rows and curation remain session-only.

Giga Pinax does not place, change or cancel bids, make purchases, offer investment advice, collect analytics, run advertising, or provide cloud sync.

**Suggested category:** Productivity, Research, or the nearest available equivalent. Do not claim a category, publisher identity, licence or paid-service requirement until the publisher selects it in the dashboard.

**Support URL:** https://github.com/bth0mp/Giga-Pinax/issues

**Privacy policy:** publish `docs/PRIVACY.md` at a durable public HTTPS URL and enter that URL before submission.

## Chrome Web Store privacy and permissions

**Single purpose:** Help ancient-coin collectors research catalogue references and sale prices, then organize auction and collection work in a local workspace.

- `contextMenus`: starts user-invoked highlighted-text research or an editable current-lot draft.
- `storage`: stores preferences, recent references, watchlists, bid plans, reminders, notes, provenance, measurements, external photo links, fee estimates, comparable sales and collection history locally.
- `activeTab` and `scripting`: temporarily extract the current page after an explicit collector action so its text and URL can be reviewed before research or saving.
- `alarms`: schedules local reminder due checks.
- `sidePanel`: opens the research workspace in Brave/Chrome's side panel.
- optional `notifications`: shows desktop reminders only after the collector enables and grants them.
- HTTPS host permissions: request public catalogue/type/label data from `numismatics.org` and `nomisma.org`, and user-requested sale-result research from `www.acsearch.info`.

In the Chrome privacy questionnaire, disclose website content and financial/payment information: selected page text and URLs are handled after explicit action, provider responses are processed, and local bid, fee, purchase and outcome fields describe financial activity. Do not claim that no data is handled or that every operation is local. Based on the reviewed behavior, the extension has no personally identifiable information, authentication information, personal communications, location, web-history tracking, or interaction telemetry use.

Certify only after comparing these statements with the final package. Data is used for the described product features, is not sold, and is not used for advertising, creditworthiness or lending. Necessary transfers occur only for requested research, requested GitHub downloads, or comparison images from collector-specified servers.

## Firefox Add-ons declarations

Keep `browser_specific_settings.gecko.id` as `giga-pinax@local.invalid` and keep the required data categories `searchTerms` and `websiteContent`. The ID is a stable unique identifier; Mozilla does not require its email-shaped domain to receive mail.

Submit only after Firefox 142+ validation supports the manifest floor. A listed public release requires Mozilla signing. The unsigned GitHub ZIP is suitable only for temporary loading through `about:debugging` and is removed when Firefox restarts.

The code is MIT licensed (`LICENSE`); bundled catalogue data keeps its ODbL 1.0 and CC BY 3.0 terms. Do not accept publisher agreements and legal attestations without the publisher's decision.
