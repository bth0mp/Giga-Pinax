# Giga Pinax store listing

## Name and summaries

**Name:** Giga Pinax

**Chrome short description (under 132 characters):**

> Research ancient coins and sale prices; manage local auction, provenance and collection records.

**Firefox summary:**

> Research ancient coin types and session sale prices. Plan bids, track auctions, provenance and collection records, and compare saved coins. Giga Pinax never places bids.

## Long description

Giga Pinax is a research and collection workspace for ancient-coin collectors. Enter or highlight a catalogue reference to find an open type record, review sale results, and keep the lot beside your research.

Features include:

- RIC, RRC/Crawford, Seleucid Coins, Price, CPE (Ptolemaic), Newell (Demetrius Poliorcetes) and Bopearachchi type lookups, plus prices-only references;
- 69,996 type records packaged inside the extension, derived from the American Numismatic Society's OCRE, CRRO, PELLA, SCO, PCO and AGCO data, with the English Nomisma.org name of the concepts they carry, so the type record for a RIC, Crawford, Price, Seleucid Coins, CPE or Newell Demetrius reference is resolved and named from inside the package, with no request to numismatics.org or nomisma.org and with the network disabled;
- public type data from American Numismatic Society projects and Nomisma.org for a reference the package does not hold, and for every Bopearachchi reference;
- session sale-price research from acsearch, searched as the phrase dealers cite, counting how many results cite the reference and keeping the rest out of the median, with collector-controlled exclusions, an optional denomination filter, medians per dealer grade, and consistent count, range, median and summary calculations;
- auction identity and duplicate checks, workflow queues, reminders, notes and outcomes, with a collection history that totals recorded hammer, worked-out cost and invoice amounts within each currency beside the collector's own saved comparables, never as a valuation;
- bid totals and affordable-bid calculations in fourteen currencies, each in its own minor units and never converted, with premium, VAT on the premium, a platform fee on the hammer, shipping, payment fees and either a collector-entered fixed increment or a collector-entered house increment ladder;
- provenance, measurements, condition, external photo URL links and two-to-four coin comparison;
- browser-local records with explicit JSON backup, a reviewed merge or replace import that copies the current records to disk first, a raw rescue export, and a formula-safe CSV export of one table at a time; and
- a local diagnostics list of recent failures, with no search terms, references, addresses or record text, that stays on the device until you copy it.

Research terms are sent over HTTPS to `numismatics.org` and `nomisma.org` when a lookup needs them; a reference whose type record is in the packaged data sends neither of them anything, unless the collector has switched on **Show specimen photos**, which then asks `nomisma.org` for that type's photographed specimens. The price search that starts with every lookup sends the search phrase to `www.acsearch.info` whenever acsearch access is granted, which is the default in Chrome and Brave. acsearch uses the collector's existing provider session. A separate **Get CoinArchives prices** action requests optional access to `www.coinarchives.com` and reads one public results page without credentials. Its median uses only the selected original currency and identifies the public archive's coverage and result limit. CoinArchives Pro and RPC Online remain external links; Giga Pinax does not receive their credentials or import their paid results. GitHub is contacted when the collector chooses a release download. A Firefox install names the project's update manifest (`https://bth0mp.github.io/Giga-Pinax/firefox/updates.json`), which Firefox itself may check, as it does for every add-on that names one; a signed install downloads a newer signed version from the GitHub release.

Saved records stay in browser extension storage. The research popup keeps its own display settings in the extension page's `localStorage` instead: the last six lookups, up to 50 edited price-search phrases, the research form's fields, the theme, a cache of Nomisma names and a copy of the default currency. None of it is part of a backup or the raw export, and all of it goes with the extension's data. Giga Pinax stores external photo URL links, not photo binaries. A collector-specified HTTP or HTTPS photo server is contacted only after saved-coin comparison opens, and each image is lazy-loaded without a referrer. **Show specimen photos**, off by default in Settings, makes a card for one type ask `nomisma.org` which museum coins of it are photographed and load up to three pairs of photos straight from those museums' servers, lazy-loaded without a referrer; the museums see the collector's IP address, and nothing about the photos is stored. The setting itself is kept in the same `localStorage`. Fetched acsearch rows and curation remain session-only.

Giga Pinax does not place, change or cancel bids, make purchases, offer investment advice, collect analytics, run advertising, or provide cloud sync.

**Suggested category:** Productivity, Research, or the nearest available equivalent. Do not claim a category, publisher identity, licence or paid-service requirement until the publisher selects it in the dashboard.

**Support URL:** https://github.com/bth0mp/Giga-Pinax/issues

**Privacy policy:** https://bth0mp.github.io/Giga-Pinax/privacy.html — `docs/PRIVACY.md` of the latest published release, generated and published by the Pages workflow (see [RELEASING.md](../RELEASING.md#publishing-the-site)). The URL answers only once the owner has turned GitHub Pages on and a release carrying the site (0.34.0 or later) has been published; open it and compare it with `docs/PRIVACY.md` of the submitted version before entering it.

**Homepage:** https://bth0mp.github.io/Giga-Pinax/ (same condition), or the repository https://github.com/bth0mp/Giga-Pinax.

## Chrome Web Store privacy and permissions

**Single purpose:** Help ancient-coin collectors research catalogue references and sale prices, then organize auction and collection work in a local workspace.

- `contextMenus`: starts user-invoked highlighted-text research or an editable current-lot draft.
- `storage`: stores preferences, watchlists, bid plans, reminders (with the browser's time-zone name, such as `Europe/London`, so a sale day's reminders go off on the collector's clock), notes, provenance, measurements, external photo links, fee estimates, comparable sales, collection history and the want list locally.
- `activeTab` and `scripting`: temporarily extract the current page after an explicit collector action so its structured data, metadata, visible text and URL can be reviewed before research or saving. A page the extension may not read, such as a browser settings page or a local file, is refused rather than captured.
- `alarms`: schedules local reminder due checks.
- `sidePanel`: opens the research workspace in Brave/Chrome's side panel.
- optional `notifications`: shows desktop reminders only after the collector enables and grants them.
- HTTPS host permissions: request public catalogue/type/label data from `numismatics.org` and `nomisma.org`, and the sale-result search that starts with every lookup from `www.acsearch.info`, using the collector's existing acsearch session.
- optional host permission `https://www.coinarchives.com/*`: reads one public results page, only after the collector selects **Get CoinArchives prices** and grants it.

The permission set is unchanged from 0.33.0. The bundled catalogue data removed network requests, not permissions: the online fallback still needs the same hosts. Whether `www.acsearch.info` should become an optional host permission, asked for on first use, is written up for the owner's decision in [ACSEARCH-PERMISSION.md](ACSEARCH-PERMISSION.md); nothing has changed yet.

In the Chrome privacy questionnaire, disclose website content and financial/payment information: selected page text and URLs are handled after explicit action, provider responses are processed, and local bid, fee, purchase and outcome fields describe financial activity. Do not claim that no data is handled or that every operation is local. Based on the reviewed behavior, the extension has no personally identifiable information, authentication information, personal communications, web-history tracking, or interaction telemetry use, and no location use beyond the browser's time-zone name (a region such as `America/New_York`), which is kept in local extension storage with a sale day's reminders and in the backups the collector exports, and is never transmitted.

Certify only after comparing these statements with the final package. Data is used for the described product features, is not sold, and is not used for advertising, creditworthiness or lending. Necessary transfers occur only for requested research, requested GitHub downloads, comparison images from collector-specified servers, or, with **Show specimen photos** switched on, museum specimen photos.

## Firefox Add-ons declarations

Keep `browser_specific_settings.gecko.id` as `giga-pinax@local.invalid` and keep the required data categories `searchTerms` and `websiteContent`. The ID is a stable unique identifier; Mozilla does not require its email-shaped domain to receive mail.

Giga Pinax is distributed for Firefox from its GitHub releases. Once the owner adds AMO API credentials to the repository, the release workflow has Mozilla sign each version on the **unlisted** channel and attaches the signed XPI, which installs permanently and updates itself from `https://bth0mp.github.io/Giga-Pinax/firefox/updates.json` (see [RELEASING.md](../RELEASING.md#signing-the-firefox-package)). Unlisted signing needs no listing copy, screenshots or category. The unsigned GitHub ZIP is suitable only for temporary loading through `about:debugging` and is removed when Firefox restarts.

A **listed** addons.mozilla.org release is a separate decision. Its package must not carry `browser_specific_settings.gecko.update_url` (the Firefox lint refuses it without `--self-hosted`), and AMO would then deliver updates itself. The same id `giga-pinax@local.invalid` would have to be used, since signed installs are keyed by it. Submit only after Firefox 142+ validation supports the manifest floor.

The code is MIT licensed (`LICENSE`); bundled catalogue data keeps its ODbL 1.0 and CC BY 3.0 terms. Do not accept publisher agreements and legal attestations without the publisher's decision.
