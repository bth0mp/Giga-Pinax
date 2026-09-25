# Install Giga Pinax

Giga Pinax provides auction identity and duplicate checks, provenance and measurements, external photo links, fee-aware bid planning, session price curation, workflow queues and saved-coin comparison. Bundled OCRE, CRRO, PELLA, SCO, PCO and AGCO reference data answers RIC, Crawford, Price, Seleucid Coins, CPE and Newell (Demetrius Poliorcetes) lookups without a network request, and names the concepts on those cards from bundled Nomisma.org labels. Bopearachchi references always use the online services. acsearch price research remains independent of ANS catalogue availability. It never places, changes or cancels bids.

RIC ruler suggestions cover the mint-organised volumes too. For the Constantine II example, use volume **VII**, ruler **Constantine II** (or **Constantinus II**), number **287**; the included catalogue resolves **RIC VII Londinium 287** locally.

A separate CoinArchives public-results median sits beside the acsearch one. After a lookup, select **Get CoinArchives prices** and allow optional site access. It uses public hammer prices in the selected currency, with the archive's recent-additions and first-100-results limits shown alongside the sample. CoinArchives Pro remains a link to its own site.

Both searches look for the reference as a phrase, and both panels count how many results cite it and leave the rest out of the median: under the acsearch median one sentence says what it rests on (`Median of 39 sales citing Price 23, 2019–2026 (55 results, 2 unpriced)`), and the CoinArchives panel keeps its line (`39 of 55 results cite Price 23`). The **Citing …** pill beside the sales period, above the panels, turns that filter off; a verified card with a denomination adds a **Naming …** pill. Each is a checkbox whose tooltip says the whole rule (**Only results citing …**). Where three counted sales share a dealer grade, a median per grade appears under the range, with a line for the counted results that carry no grade. Grades are read in English, German, French, Italian, Spanish and Dutch (`EF`, `GVF`, `Fdc`, `BU`, `vz`, `Stgl.`, `TTB`, `SPL`, `Spl`, `EBC`, `ZF`, and `S/C` behind the weight or a closing remark such as `Brillo original.`); a group lot graded `VF/EF` or `VF and EF` counts as the lower grade.

**Refine reference** searches directly: leave the top box empty, choose a catalogue, fill its reference fields, and select **Search** or press Enter in a field. For RIC, the volume and ruler fields participate in the same search.

What changed in each version is listed in the [changelog](../CHANGELOG.md).

Fetched acsearch and CoinArchives rows and acsearch inclusion choices stay in the current Research session and do not enter saved evidence or backups. Current-page extraction runs only after your action and remains editable before research or saving. Optional desktop notifications are requested only when you enable them.

## Brave or Chrome

1. Open the public [Giga Pinax releases](https://github.com/bth0mp/Giga-Pinax/releases) and choose the latest release.
2. Under **Assets**, download the versioned Brave ZIP, not a GitHub **Source code** archive. No GitHub account is required.
3. Extract the ZIP into a folder you will keep.
4. Open `brave://extensions` or `chrome://extensions`.
5. Enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`.
6. Open Giga Pinax from the extensions menu and pin it if desired.

The extension requests access to the HTTPS research providers `numismatics.org`, `nomisma.org` and `www.acsearch.info`. Access to `www.coinarchives.com` is optional and requested when you select **Get CoinArchives prices**. GitHub opens only when you request a release download or select **How it works ↗** at the foot of the popup, which opens this guide's first checks. An external photo link may use HTTP or HTTPS; its server is contacted only when you open saved-coin comparison.

To update, open **Settings**, find **Updates**, and select **Download latest update**. Download and extract the new Brave ZIP, replace the files in the same extracted folder, select **Reload** on `brave://extensions` or `chrome://extensions`, and reopen Giga Pinax. The extension does not install files silently.

The **Updates** card is hidden on a Chrome Web Store install, where the store keeps the extension up to date: the card goes by the update URL the store writes into the manifest it serves. It is hidden on a signed Firefox install too, which Firefox keeps up to date from the project's update manifest; Firefox tells the page which kind of install it is. An unpacked install and a temporary Firefox install keep it.

## Signed Firefox installation

Use Firefox 142 or later. A release built after the owner set up Mozilla signing carries a signed package, `giga-pinax-firefox-x.y.z.xpi`, beside the ZIPs.

1. Open the public [Giga Pinax releases](https://github.com/bth0mp/Giga-Pinax/releases) and choose the latest release.
2. Under **Assets**, select `giga-pinax-firefox-x.y.z.xpi` in Firefox, and confirm the installation Firefox offers.
3. Open Giga Pinax from Firefox's extensions menu.

A signed install stays installed when Firefox restarts, and Firefox keeps it up to date by itself: it checks `https://bth0mp.github.io/Giga-Pinax/firefox/updates.json` for a newer signed version, as it checks every installed add-on, and downloads that version from the GitHub release. Mozilla signs it without listing it on addons.mozilla.org. Settings shows no **Updates** card for it. If the release has no `.xpi` asset, use the temporary installation below.

## Temporary Firefox installation

Use Firefox 142 or later.

1. Open the public [Giga Pinax releases](https://github.com/bth0mp/Giga-Pinax/releases) and choose the latest release.
2. Under **Assets**, download the versioned Firefox ZIP.
3. Open `about:debugging` and select **This Firefox**.
4. Select **Load Temporary Add-on** and choose the downloaded ZIP.
5. Open Giga Pinax from Firefox's extensions menu.

Firefox removes a temporary unsigned add-on when Firefox restarts. Permanent installation requires a Mozilla-signed build, above; see Mozilla's [signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). To update a temporary installation on Firefox 142 or later, open **Settings** → **Updates**, download the latest Firefox ZIP, and load it again through `about:debugging`.

Bundled RIC, Crawford, Price, Seleucid Coins, CPE and Newell (Demetrius Poliorcetes) results work even if ANS access is disabled in `about:addons`. If an online fallback needs access, select **Check online**; a reference the bundle does not hold, every Bopearachchi lookup and **Get prices** request their respective provider access. If the popup closes during a permission prompt, reopen it: the reference you typed is still in the Reference box, so the lookup can simply be repeated.

## First checks

1. In **Research**, try `RIC I² Nero 306`, `Crawford 44/5`, `SC 1266.2` or `Price 23`. Auction research starts from that reference while catalogue details load separately. If acsearch access is needed, select **Get prices** (under **Change search**, which opens by itself when prices need it) and sign in on acsearch with an account that includes hammer prices (acsearch shows hammer prices to subscribers; without an account, **Get CoinArchives prices** gives the free public results instead). Expand **Inspect sales** to exclude and restore a result for the current lookup. **Watch** beside **Type** puts the coin on your watchlist in one step and says so under the card (**Watching · Open · Undo**); a coin already saved under that reference shows where it stands instead, as a **Watching** pill (`Watching · £650 bid · in 7 days`) that opens it, with the whole sentence as its tooltip. Under the acsearch panel, **Upcoming** lists the lots on the fetched page still to be sold, soonest first, each with **Watch** to save it to the watchlist in one step (with **Open** and **Undo** under the list, and **Add** to attach its sale day as an auction), and a strip gives the median of each year with at least three sales. **Ctrl+K** (**⌘K** on a Mac) brings the keyboard back to the Reference box from any tab.
2. Open **Capture the lot page you’re on** (it opens by itself in the toolbar popup over a web page), capture an auction page, review the extracted fields and auction context, then research it or save a draft. The capture reads the lot's own structured data and page metadata before its visible text, and refuses a page it cannot read, such as `chrome://extensions` or a local file. The workspace requires confirmation before creating the record.
3. In **Calculator**, enter a maximum hammer and buyer's premium. Expand fees and increments to add VAT on the premium (charged on the premium alone, as Künker's 19 % on a 25 % premium), a live-bidding platform's fee on the hammer, import VAT or duty (charged on hammer, premium and shipping when the coin crosses a border, and paid to the carrier or customs, so no payment fee is added to it), shipping, percentage or fixed payment fees, budget, minimum bid and fixed increment; the percentage payment fee applies to the hammer, premium, VAT, platform fee and shipping. A saved house preset that carries an increment ladder replaces the fixed increment while that house is selected, and the calculator says which of its tiers the bid stands on; if the ladder's currency is not the calculator's, it says so and the fixed increment is used. Every amount is in one of fourteen currencies (USD, EUR, GBP, CHF, AUD, CAD, CZK, DKK, HKD, HUF, JPY, NOK, PLN, SEK) and never converted; a yen amount is whole yen, so `1,200,000.50` is refused. Amounts may be typed with a thousands separator: `1,200` is twelve hundred where your browser groups thousands with a comma, and `1.200` where it groups them with a point; where that mark is the decimal mark instead, the calculator asks you to write the amount without the separator.
4. Open the workspace with **Workspace** at the top of the popup. Inspect the queues, select a coin, and edit auction identity, provenance, measurements, condition, external photo links and cost estimate. Its **Want list** keeps the types you are hunting, and **Settings** keeps a backup.
5. Select a reference on any web page and right-click it: **Look up … in Giga Pinax** opens it in the lookup window. The side-panel button at the top of the popup keeps the popup open beside the page, and **Ctrl+K** brings the keyboard back to the Reference box.
6. Select two to four saved coins and open comparison. Photo servers are contacted at this point only; an unavailable image does not block comparison.
7. Open **Settings** for bundled catalogue coverage, **Appearance**, default currency, your usual **Import VAT / duty %** for a sale in another currency (off until you type it), **Show specimen photos** (off until you tick it), saved house premiums with their VAT on the premium, platform fee and increment ladders (**Copy or paste house presets** hands them to another browser as text), **Updates**, backup/import with **Export CSV** for a spreadsheet copy of one table, **Diagnostics** to copy recent failures for a bug report, and any records that could not be read. Try `RIC II.1² Vespasian 972`, `Crawford 44/5`, `Price 23` and `SC 1266.2` with ANS access disabled to check the local type records. Prices still need internet access and an eligible acsearch session.

CoinArchives public prices load only when you select **Get CoinArchives prices** and grant optional access. CoinArchives Pro and RPC Online remain external links. Giga Pinax does not receive their credentials or import their paid results. acsearch research uses your existing provider session; sign in on acsearch itself if your account is needed to see hammer prices.

## Developer build

End users do not need Python. From the repository root, `python scripts/build.py` creates unpacked `dist/brave/` and `dist/firefox/` directories, versioned Brave, Chrome and Firefox ZIPs, and stable `giga-pinax-brave.zip` and `giga-pinax-firefox.zip` aliases — every ZIP a release carries, in one command; the signed Firefox XPI and its `firefox-updates.json` come from the release workflow. Build one unpacked target with `python scripts/build.py brave` or `python scripts/build.py firefox`.

A GitHub release includes five ZIP assets: versioned Brave, Chrome and Firefox packages plus both stable aliases. The versioned Chrome package is a byte-identical copy of the versioned Brave package. Once Mozilla signing is set up, a release also carries the signed `giga-pinax-firefox-x.y.z.xpi` and the `firefox-updates.json` the project site publishes for it. Every release body must include brief browser installation and update instructions. See [RELEASING.md](RELEASING.md).

GitHub's generated **Source code** archives are repository snapshots and are not loadable extension packages.

## Remove or preserve records

Before removing or changing extension identity, use **Settings** → **Backup and import** → **Export backup** if the records matter. Backups exclude lookup preferences, theme, the Nomisma label cache, browser sessions and live acsearch results.

An import either merges into your records or replaces them. A merge keeps the version of each record that was written last, recognises a lot you already have even when the backup names it differently, and lists everything it would change or keep, with the date each side was last edited, before you accept it. A replace, and any merge that would overwrite a record, downloads a safety copy of your current records first and names the file; if that copy cannot be made, it asks before going on. **Export raw data** writes a rescue file — everything in storage as it stands, unsaved drafts included — for the case where nothing else will load; it is not a backup and is refused by the importer.

Data written by this version uses storage schema 2 and cannot be read by 0.31.1. Export a backup before upgrading if you may want to go back.

In Brave or Chrome, remove the extension from the extensions page. In Firefox, remove a temporary install from `about:debugging` or restart Firefox, and a signed install from `about:addons`. Records created under another extension origin must be exported there and imported explicitly.
