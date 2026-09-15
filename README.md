# Giga Pinax

Giga Pinax 0.31.1 is a Brave, Chrome and Firefox extension for researching ancient coin types and sale prices, planning auction activity, and keeping local collection records. It never places, changes or cancels bids.

Research supports RIC, RRC/Crawford, Seleucid Coins, Price and Bopearachchi type records, plus prices-only references such as RPC, Sear, SNG, BCD, HGC and Krause numbers. Paste a whole lot description to extract its catalogue references, or use the context menu on selected text. Public type and label data comes from American Numismatic Society projects and Nomisma.org. Requested sale-price research uses the collector's existing acsearch browser session.

The 0.29 workspace adds auction page, house, sale and lot identity; duplicate checks; closing-soon, research, planned, active and completed queues; provenance; measurements and condition; external photo URL links; reminders and outcomes; and comparison of two to four saved coins. The calculator includes buyer premium, shipping, percentage and fixed payment fees, and the highest affordable bid on a collector-entered fixed increment.

Version 0.30 bundles 52,254 active Roman Imperial type records and 2,808 replacement redirects derived from the supplied OCRE RDF export. RIC searches check a local index and load the relevant details from packaged files. Local results need no ANS connection; missing records can use the existing online lookup. This snapshot does not cover Crawford/RRC, Price, Seleucid Coins or Bopearachchi. Settings identifies the bundled data and its coverage. The export's publication date is unknown, and unresolved Nomisma identifiers are not guessed. See [local catalogue data and attribution](docs/LOCAL-CATALOGUE.md).

Version 0.30.1 adds verified people to the RIC ruler/mint suggestions, including those missing from the mint-organised volumes VI–IX. For example, choose **VII**, enter **Constantine II** and **287**, or paste the lot description containing `OCRE ric.7.lon.287`. The local lookup distinguishes the obverse portrait from the issuing authority. Verified Latin names such as **Constantinus II** are recognised too. See [release notes](docs/RELEASE-0.30.1.md).

Version 0.31 adds a separate CoinArchives public-results median. In Research, select **Get CoinArchives prices** and allow optional site access. The extension reads one public results page and counts eligible hammer prices in the selected original currency, excluding upcoming auctions and missing prices. It shows its own query, sample and coverage: auctions added in the past six months, up to the first 100 matches. Currency values and the two providers' results are never pooled. CoinArchives Pro remains an external link.

Version 0.31.1 fixes **Refine reference** searches. With the top search box empty, select the catalogue and enter its reference fields, then select **Search** or press Enter in a field. RIC volume and ruler fields work the same way, including restored valid values. Old text left in the top box no longer overrides a newly refined reference. Native top-box lookup safety remains in place. See [release notes](docs/RELEASE-0.31.1.md).

Fetched provider rows remain in Research. Excluding an acsearch result updates its count, range, median, comparison and copied summary from the same included rows, and curation resets with a new lookup. Provider rows are not copied into saved comparable evidence.

Price research starts from the entered reference independently of ANS catalogue lookup. With existing acsearch access, the extension fetches available hammer prices and calculates the median while catalogue details load separately. An ANS outage, missing match or request for a more specific type does not block price research. acsearch prices require an account with access to hammer prices; CoinArchives public prices do not require a Pro account. Catalogue details arriving later do not replace the active price query or its curated results.

Captured auction context follows a coin into Research and an editable watchlist draft. Saving from a result carries the resolved reference, type link and available captured auction context; saving from Current source carries the reviewed capture. The collector confirms the record in the workspace. Duplicate auction identity opens the existing coin rather than silently merging it.

Saved records use browser extension storage and can be exported and imported as JSON. Giga Pinax stores external photo URLs rather than photo binaries. Their explicit HTTP or HTTPS servers are contacted only after comparison opens; images are lazy-loaded without a referrer and display an unavailable fallback on failure.

## Install

Open the public [Giga Pinax releases](https://github.com/bth0mp/Giga-Pinax/releases), choose the latest release, and download the browser ZIP under **Assets** rather than GitHub's **Source code** archives. Public downloads require no GitHub account.

- **Brave or Chrome:** Extract the Brave ZIP, open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`.
- **Firefox 142+:** Open `about:debugging`, select **This Firefox**, choose **Load Temporary Add-on**, and select the unsigned Firefox ZIP. The temporary add-on is removed when Firefox restarts; permanent installation requires a Mozilla-signed build.

For updates, open **Settings**, find **Updates**, and select **Download latest update**. Brave or Chrome users replace the files in the existing extracted folder and select **Reload**. Firefox users load the new unsigned ZIP again. Giga Pinax opens a fixed public GitHub asset URL and does not poll GitHub or install updates silently. See [the installation guide](docs/INSTALL.md).

## Using 0.29

- Use **Research** for a reference or pasted lot text. **Refine reference** exposes catalogue-specific fields. **Inspect sales** lets you include or exclude acsearch rows for the current lookup and **Reset** restores them.
- Use **Current source** to capture the page you are viewing, review its fields and auction context, then research it or save an editable draft.
- Use **Calculator** for total and affordable-bid planning. Its optional fees and increments section accepts shipping, payment fees, minimum bid and fixed increment.
- Use **Watchlist** to open the full workspace. Its queue covers all open lots, closing soon, needs research, planned, active and completed records. Auction-start labels are distinct from lot deadlines; date-only events do not gain invented times.
- In a selected coin, edit auction identity, measurements, condition, two photo links, sourced provenance and cost estimate. **Open auction** and **Research reference** lead to separate destinations. Select two to four coins to compare their recorded fields and labelled currencies.
- Open **Settings** from the header or workspace for **Appearance**, default currency, saved house premiums, **Updates**, and backup/import.

Useful examples include `RIC I² Nero 306`, `Crawford 44/5`, `SC 1266.2`, `Bop Euthydemus I 24A`, `Price 23`, `RPC I 1234`, `SG 6829`, and `Netherlands KM# 123`. Ambiguous references produce choices rather than an invented result. CoinArchives Pro and RPC Online are external links opened only when selected; Giga Pinax does not receive their credentials or import their paid results.

Online lookups contact `numismatics.org`, `nomisma.org` and `www.acsearch.info` over HTTPS. CoinArchives price requests contact `www.coinarchives.com` only after a dedicated user action and optional permission grant. Bundled RIC results do not contact ANS or Nomisma; independent auction-price research still contacts acsearch when enabled. GitHub is contacted only for a user-requested release download. Explicit collector-supplied comparison photos may come from HTTP or HTTPS hosts. See [the privacy policy](docs/PRIVACY.md).

## Development and release

The runtime has no dependencies. `python scripts/build.py` copies an explicit allowlist into deterministic Brave and Firefox packages. `python scripts/make_icons.py` needs Pillow only to reproduce the icon PNGs. `web-ext` is used only for Firefox validation.

```powershell
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors
```

Each GitHub release carries five ZIP assets: versioned Brave, Chrome and Firefox packages plus stable `giga-pinax-brave.zip` and `giga-pinax-firefox.zip` aliases. The versioned Chrome ZIP is a byte-identical copy of the Brave ZIP. Every release body includes brief installation and update instructions; see [the release guide](docs/RELEASING.md).

Companion backups contain records and settings. Lookup preferences, theme, ANS label cache, browser sessions and live acsearch results are outside the backup. Browser storage does not move between extension identities; export from the original installation and import explicitly.
