# Install Giga Pinax 0.29.2

Giga Pinax provides auction identity and duplicate checks, provenance and measurements, external photo links, fee-aware bid planning, session price curation, workflow queues and saved-coin comparison. Version 0.29.2 makes acsearch price research independent of ANS catalogue availability. It never places, changes or cancels bids.

Fetched acsearch rows and inclusion choices stay in the current Research session and do not enter saved evidence or backups. Current-page extraction runs only after your action and remains editable before research or saving. Optional desktop notifications are requested only when you enable them.

## Brave or Chrome

1. Open the public [Giga Pinax releases](https://github.com/bth0mp/Giga-Pinax/releases) and choose the latest release.
2. Under **Assets**, download the versioned Brave ZIP, not a GitHub **Source code** archive. No GitHub account is required.
3. Extract the ZIP into a folder you will keep.
4. Open `brave://extensions` or `chrome://extensions`.
5. Enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`.
6. Open Giga Pinax from the extensions menu and pin it if desired.

The extension requests access to the HTTPS research providers `numismatics.org`, `nomisma.org` and `www.acsearch.info`. GitHub opens only when you request a release download. An external photo link may use HTTP or HTTPS; its server is contacted only when you open saved-coin comparison.

To update, open **Settings**, find **Updates**, and select **Download latest update**. Replace the files in the same extracted folder, select **Reload** on the extensions page, and reopen Giga Pinax. The extension does not install files silently.

## Temporary Firefox installation

Use Firefox 142 or later.

1. Open the public [Giga Pinax releases](https://github.com/bth0mp/Giga-Pinax/releases) and choose the latest release.
2. Under **Assets**, download the versioned Firefox ZIP.
3. Open `about:debugging` and select **This Firefox**.
4. Select **Load Temporary Add-on** and choose the downloaded ZIP.
5. Open Giga Pinax from Firefox's extensions menu.

Firefox removes a temporary add-on when Firefox restarts. Permanent installation requires a Mozilla-signed build; see Mozilla's [signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). To update a temporary installation, open **Settings** → **Updates**, download the latest ZIP, and load it again through `about:debugging`.

If provider access is disabled in `about:addons`, selecting **Look up** or **Get prices** requests it again. If the popup closes during the permission prompt, reopen it and repeat the action.

## First checks

1. In **Research**, try `RIC I² Nero 306`, `Crawford 44/5`, `SC 1266.2` or `Price 23`. Auction research starts from that reference while catalogue details load separately. If acsearch access is needed, select **Get prices** and sign in on acsearch with an account that includes hammer prices. Expand **Inspect sales** to exclude and restore a result for the current lookup.
2. Open **Current source**, capture an auction page, review the extracted fields and auction context, then research it or save a draft. The workspace requires confirmation before creating the record.
3. In **Calculator**, enter a hammer and buyer premium. Expand fees and increments to add shipping, percentage or fixed payment fees, budget, minimum bid and fixed increment.
4. Open the auction workspace from **Watchlist**. Inspect the queues, select a coin, and edit auction identity, provenance, measurements, condition, external photo links and cost estimate.
5. Select two to four saved coins and open comparison. Photo servers are contacted at this point only; an unavailable image does not block comparison.
6. Open **Settings** for **Appearance**, default currency, saved house premiums, **Updates**, and backup/import.

CoinArchives free and Pro and RPC Online open only when selected. Giga Pinax does not receive credentials or import paid results. acsearch research uses your existing provider session; sign in on acsearch itself if your account is needed to see hammer prices.

## Developer build

End users do not need Python. From the repository root, `python scripts/build.py` creates unpacked `dist/brave/` and `dist/firefox/` directories, versioned Brave and Firefox ZIPs, and stable `giga-pinax-brave.zip` and `giga-pinax-firefox.zip` aliases. Build one target with `python scripts/build.py brave` or `python scripts/build.py firefox`.

A GitHub release includes five ZIP assets: versioned Brave, Chrome and Firefox packages plus both stable aliases. The versioned Chrome package is a byte-identical copy of the versioned Brave package. Every release body must include brief browser installation and update instructions. See [RELEASING.md](RELEASING.md).

GitHub's generated **Source code** archives are repository snapshots and are not loadable extension packages.

## Remove or preserve records

Before removing or changing extension identity, use **Settings** → **Backup and import** → **Export backup** if the records matter. Backups exclude lookup preferences, theme, ANS label cache, browser sessions and live acsearch results.

In Brave or Chrome, remove the extension from the extensions page. In Firefox, remove it from `about:debugging` or restart Firefox. Records created under another extension origin must be exported there and imported explicitly.
