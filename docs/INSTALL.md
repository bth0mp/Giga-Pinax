# Install Giga Pinax

Giga Pinax provides auction identity and duplicate checks, provenance and measurements, external photo links, fee-aware bid planning, session price curation, workflow queues and saved-coin comparison. Bundled OCRE, CRRO, PELLA, SCO, PCO and AGCO reference data answers RIC, Crawford, Price, Seleucid Coins, CPE and Newell (Demetrius Poliorcetes) lookups without a network request, and names the concepts on those cards from bundled Nomisma.org labels. Bopearachchi references always use the online services. acsearch price research remains independent of ANS catalogue availability. It never places, changes or cancels bids.

RIC ruler suggestions cover the mint-organised volumes too. For the Constantine II example, use volume **VII**, ruler **Constantine II** (or **Constantinus II**), number **287**; the included catalogue resolves **RIC VII Londinium 287** locally.

A separate CoinArchives public-results median sits beside the acsearch one. After a lookup, select **Get CoinArchives prices** and allow optional site access. It uses public hammer prices in the selected currency, with the archive's recent-additions and first-100-results limits shown alongside the sample. CoinArchives Pro remains a link to its own site.

Both searches look for the reference as a phrase, and both panels count how many results cite it (`39 of 55 results cite Price 23`) and leave the rest out of the median. The **Only results citing …** checkbox above the panels turns that filter off; a verified card with a denomination adds an **Only results naming …** switch. Where three counted sales share a dealer grade, a median per grade appears under the range, with a line for the counted results that carry no grade. Grades are read in English, German, French, Italian, Spanish and Dutch (`EF`, `vz`, `TTB`, `SPL`, `EBC`, `ZF`); a group lot graded `VF/EF` or `VF and EF` counts as the lower grade.

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

The extension requests access to the HTTPS research providers `numismatics.org`, `nomisma.org` and `www.acsearch.info`. Access to `www.coinarchives.com` is optional and requested when you select **Get CoinArchives prices**. GitHub opens only when you request a release download. An external photo link may use HTTP or HTTPS; its server is contacted only when you open saved-coin comparison.

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

1. In **Research**, try `RIC I² Nero 306`, `Crawford 44/5`, `SC 1266.2` or `Price 23`. Auction research starts from that reference while catalogue details load separately. If acsearch access is needed, select **Get prices** and sign in on acsearch with an account that includes hammer prices. Expand **Inspect sales** to exclude and restore a result for the current lookup. Under the acsearch panel, **Upcoming** lists the lots on the fetched page still to be sold, soonest first, each with **Watch** to save it as a draft with its sale day, and a strip gives the median of each year with at least three sales.
2. Open **Current source**, capture an auction page, review the extracted fields and auction context, then research it or save a draft. The capture reads the lot's own structured data and page metadata before its visible text, and refuses a page it cannot read, such as `chrome://extensions` or a local file. The workspace requires confirmation before creating the record.
3. In **Calculator**, enter a hammer and buyer premium. Expand fees and increments to add shipping, percentage or fixed payment fees, budget, minimum bid and fixed increment. A saved house preset that carries an increment ladder replaces the fixed increment while that house is selected; if the ladder's currency is not the calculator's, it says so and the fixed increment is used.
4. Open the auction workspace from **Watchlist**. Inspect the queues, select a coin, and edit auction identity, provenance, measurements, condition, external photo links and cost estimate.
5. Select two to four saved coins and open comparison. Photo servers are contacted at this point only; an unavailable image does not block comparison.
6. Open **Settings** for bundled catalogue coverage, **Appearance**, default currency, **Show specimen photos** (off until you tick it), saved house premiums and their increment ladders, **Updates**, backup/import with **Export CSV** for a spreadsheet copy of one table, **Diagnostics** to copy recent failures for a bug report, and any records that could not be read. Try `RIC II.1² Vespasian 972`, `Crawford 44/5`, `Price 23` and `SC 1266.2` with ANS access disabled to check the local type records. Prices still need internet access and an eligible acsearch session.

CoinArchives public prices load only when you select **Get CoinArchives prices** and grant optional access. CoinArchives Pro and RPC Online remain external links. Giga Pinax does not receive their credentials or import their paid results. acsearch research uses your existing provider session; sign in on acsearch itself if your account is needed to see hammer prices.

## Developer build

End users do not need Python. From the repository root, `python scripts/build.py` creates unpacked `dist/brave/` and `dist/firefox/` directories, versioned Brave, Chrome and Firefox ZIPs, and stable `giga-pinax-brave.zip` and `giga-pinax-firefox.zip` aliases — every release asset in one command. Build one unpacked target with `python scripts/build.py brave` or `python scripts/build.py firefox`.

A GitHub release includes five ZIP assets: versioned Brave, Chrome and Firefox packages plus both stable aliases. The versioned Chrome package is a byte-identical copy of the versioned Brave package. Once Mozilla signing is set up, a release also carries the signed `giga-pinax-firefox-x.y.z.xpi` and the `firefox-updates.json` the project site publishes for it. Every release body must include brief browser installation and update instructions. See [RELEASING.md](RELEASING.md).

GitHub's generated **Source code** archives are repository snapshots and are not loadable extension packages.

## Remove or preserve records

Before removing or changing extension identity, use **Settings** → **Backup and import** → **Export backup** if the records matter. Backups exclude lookup preferences, theme, the Nomisma label cache, browser sessions and live acsearch results.

An import either merges into your records or replaces them. A merge keeps the version of each record that was written last, recognises a lot you already have even when the backup names it differently, and lists everything it would change or keep, with the date each side was last edited, before you accept it. A replace, and any merge that would overwrite a record, downloads a safety copy of your current records first and names the file; if that copy cannot be made, it asks before going on. **Export raw data** writes a rescue file — everything in storage as it stands, unsaved drafts included — for the case where nothing else will load; it is not a backup and is refused by the importer.

Data written by this version uses storage schema 2 and cannot be read by 0.31.1. Export a backup before upgrading if you may want to go back.

In Brave or Chrome, remove the extension from the extensions page. In Firefox, remove a temporary install from `about:debugging` or restart Firefox, and a signed install from `about:addons`. Records created under another extension origin must be exported there and imported explicitly.
