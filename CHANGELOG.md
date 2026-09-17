# Changelog

Notable changes to Giga Pinax, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.
Each date is the date of that version's release tag. Every release also carries the install and update steps in
[docs/INSTALL.md](docs/INSTALL.md); they are not repeated here.

## [Unreleased]

## [0.31.1] - 2026-09-15

### Fixed

- **Refine reference** searches run again. Leave the top search box empty, select a catalogue, fill its reference fields, and select **Search** or press Enter in a field. RIC volume and ruler take part in the same search, and values restored from an earlier lookup stay searchable.
- Text left in the top search box no longer overrides a newly refined reference. Top-box lookups are unchanged.

## [0.31.0] - 2026-09-15

### Added

- A separately labelled CoinArchives public-results median beside the acsearch one. Select **Get CoinArchives prices** after a lookup; the browser asks for optional access to `www.coinarchives.com` and the extension reads one public results page. No account credentials are used and the Pro archive is not read.
- The CoinArchives section states its own query, eligible sale count, date coverage and original currency, and its rows can be inspected. Coverage is auctions added in the past six months, up to the first 100 matches — not a full-archive median. The source reports hammer prices, excluding buyer premium.

### Changed

- Upcoming auctions, unposted or unreadable prices and conflicting duplicate records are excluded. Only prices in the selected currency reach the median: currencies and providers are never pooled.
- Each provider loads and fails independently. A CoinArchives retry keeps acsearch curation, and late catalogue details replace neither query. Provider rows stay in the Research session and never enter watchlist evidence or backups.

## [0.30.1] - 2026-09-15

### Added

- RIC ruler suggestions now include the verified people in the bundled records, including emperors absent from the mint-organised volumes VI–IX. Existing mint choices remain, and choosing a person keeps the selected volume. The names ship with the extension; no download, crawler or server is involved.

### Fixed

- Local lookup checks issuing authorities and obverse portraits, so `RIC VII Constantine II 287` resolves to **RIC VII Londinium 287**. `Constantinus II` is the same person; `Constantius II` is not. Several matches remain a choice.
- A pasted lot description carrying an OCRE identifier is read as a catalogue reference, and the identifier is used only after it agrees with the citation and the person. RIC price searches keep a single recognised ruler instead of searching the catalogue number alone.

## [0.30.0] - 2026-09-14

### Added

- Bundled OCRE reference data: 52,254 active Roman Imperial type records and 2,808 replacement redirects derived from the supplied RDF export, so RIC type details work without ANS access. Canonical identifiers are preserved and detailed records load from the package only when needed. Local cards, candidate choices and Settings name the data source.
- Attribution and source metadata in every package. The database is derived from American Numismatic Society OCRE data under ODbL 1.0; the conversion is reproducible from the repository.

### Changed

- Missing records keep an online fallback with an explicit **Check online** action when permission is needed. The snapshot covers OCRE/RIC only — Crawford/RRC, Price, Seleucid Coins and Bopearachchi still use their online sources — holds no auction prices or images, and has an unknown publication date. Conflicting source records are withheld and recorded in the metadata rather than guessed.

## [0.29.2] - 2026-09-14

### Fixed

- Price research starts from the parsed reference instead of waiting for an ANS type card, so an ANS outage no longer prevents a median that acsearch could supply. The acsearch controls and median stay available while catalogue details load, fail or await a more specific match.
- Catalogue details arriving later no longer replace an edited price term, reset included sales or relabel the active query, and changing the reference starts a separate search that older responses cannot overwrite.

## [0.29.1] - 2026-09-14

### Fixed

- A catalogue server error or rate limit is distinguished from a connection failure, and the acsearch and CoinArchives searches stay available for a safely parsed reference instead of being hidden behind "Check your connection". A failed lookup still creates no verified type card, saves nothing to Recent and enables no invented details; editing the reference clears the fallback links.

## [0.29.0] - 2026-09-14

### Added

- Auction page, house, sale and lot identity on captured coins, with duplicate lots detected rather than silently merged.
- Weight, diameter, condition, up to two external photo links, sourced provenance notes, shipping, payment fees and bid increments on a record.
- Total bid cost and the highest affordable hammer on a collector-entered increment grid.
- Closing soon, Needs research, Planned, Active and Completed queues, with timed deadlines distinguished from date-only auction starts.
- Comparison of two to four saved coins. Giga Pinax stores photo URLs, not photo files, and an external HTTP or HTTPS photo server is contacted only once comparison opens.
- Session curation of acsearch results: count, range, median, comparison and copied summary all follow the same included rows.

### Changed

- Auction context carries through current-page capture into Research, and save actions are guarded against repeated clicks. Schema version 1, existing records, the 5 MiB storage bound and the rule that Giga Pinax never places bids are all unchanged.

## [0.28.0] - 2026-09-13

### Added

- Research in the browser's native side panel or sidebar, with the toolbar popup still available for quick lookups.
- A compact watchlist beside one selected-coin detail pane, including optional private lot notes.
- One **Sources** menu for acsearch and the free and Pro CoinArchives routes, and a Settings view for theme, default bid currency, saved house premiums, updates and backup/import.

### Changed

- The shared calculator works from hammer plus buyer premium or from a total budget, with saved house premiums available wherever it appears. Shipping and tax stay outside its totals.
- Storage remains schema 1, so 0.27 records load without migration, and durable changes still use revision-checked commands.

## [0.27.2] - 2026-09-12

### Added

- A compact **CoinArchives Pro** disclosure in Research and in the workspace Search view. Existing subscribers can sign in on CoinArchives and open its ancient- or world-coin Pro archive directly; the extension handles no Pro credentials, detects no login state and fetches no paid data.

### Fixed

- Modern KM and Y references open CoinArchives World Coins; ancient references still open Ancient Coins.
- Remembered acsearch terms are isolated by corpus and record, so one catalogue cannot inherit another's term.
- Rapid right-click and pop-out lookups coalesce onto the latest request instead of losing it or opening duplicate windows.
- Workspace navigation reports the active page to assistive technology, and edits typed while a save is in flight reach the record that save creates.
- Enabling desktop alerts reconciles reminders already due, and failed delivery retries for five minutes while the event is still relevant. Date-only events use their saved timezone in the popup summary.
- Merge-import preview preserves local capture drafts.
- A reminder schedule is accepted only when its durable state and lifecycle reserve fit the 5 MiB budget; an oversized schedule is refused atomically rather than partly saved.

The accompanying audit of research, pricing, launch behaviour, records, reminders, backup, accessibility, packaging and layout is in [docs/AUDIT-2026-09-12.md](docs/AUDIT-2026-09-12.md).

## [0.27.1] - 2026-09-12

### Added

- **Updates** under the popup header, showing the installed version, opening the stable package for the current browser from the latest GitHub release, and opening the releases page. The repository is public, so no GitHub account is needed, and no credential or token is stored in the extension.

### Changed

- The extension never checks GitHub in the background, compares versions or installs an update silently; a download is always a deliberate action.

## [0.27.0] - 2026-09-12

### Added

- An auction companion beside research: Research, Calculator and Watchlist tabs in the existing 400 px popup.
- Exact hammer-plus-buyer's-premium calculation in USD, EUR, GBP and CHF, with per-currency exposure kept separate throughout.
- An editable current-page capture and a reviewed reference-to-watchlist handoff carrying only the displayed reference, a type label and a source page URL.
- A local workspace for lots, ranked alternatives, planned and externally active bids, reminders, outcomes, collection history, saved comparables and validated backups.

### Changed

- acsearch stays scoped to one collector action, one results page and session-only display. Fetched rows, prices, identifiers, medians and claims are never written into drafts, records, exports or backups. Saved comparables are collector-entered and their statistics stay separate from the live price panel's.

[Unreleased]: https://github.com/bth0mp/Giga-Pinax/compare/v0.31.1...HEAD
[0.31.1]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.31.1
[0.31.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.31.0
[0.30.1]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.30.1
[0.30.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.30.0
[0.29.2]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.29.2
[0.29.1]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.29.1
[0.29.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.29.0
[0.28.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.28.0
[0.27.2]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.27.2
[0.27.1]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.27.1
[0.27.0]: https://github.com/bth0mp/Giga-Pinax/releases/tag/v0.27.0
