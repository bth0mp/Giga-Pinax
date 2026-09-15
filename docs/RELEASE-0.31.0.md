# Giga Pinax 0.31.0

Research now offers two separately labelled medians: the existing acsearch median and a CoinArchives public-results median. After looking up a coin, choose **Get CoinArchives prices**. The browser requests optional access to `www.coinarchives.com`, and the extension reads one public search-results page. CoinArchives requests do not use account credentials or access the Pro archive.

The CoinArchives section shows its actual search query, eligible sale count, date coverage and original currency. It excludes upcoming auctions, unposted or unreadable prices and conflicting duplicate records. Only prices in the selected currency contribute to its median; currencies and providers are never pooled. The period filter uses auction dates. Inspection shows the sale rows behind the CoinArchives statistic, while acsearch keeps its existing exclusion and price-check controls.

CoinArchives public coverage is **auctions added in the past six months, up to the first 100 matches**. This is not a full-archive median or a guarantee that every auction occurred within six months. The source reports hammer prices, excluding buyer premium. See the [CoinArchives FAQ](https://www.coinarchives.com/faq.php). Pro access remains an external link.

Each provider loads and reports failures independently. A CoinArchives retry does not discard acsearch curation, and late catalogue details do not replace either source's query. Live provider rows remain in the Research session and are not added to watchlist evidence or backups. Existing local OCRE/RIC data remains included.

## Install or update

Under **Assets**, download your browser ZIP rather than a **Source code** archive.

- **Brave or Chrome:** Extract the matching ZIP into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`. To update, replace the files in that same folder and select **Reload**. No Python or database setup is needed.
- **Firefox 142+:** Open `about:debugging`, choose **This Firefox**, select **Load Temporary Add-on**, and choose the unsigned Firefox ZIP. Load the new ZIP again to update. Temporary add-ons are removed when Firefox restarts; permanent installation requires a Mozilla-signed build.

For CoinArchives prices, select **Get CoinArchives prices** in Research and allow the optional site permission. Declining it leaves the other research features available.

## Verification

- 468 JavaScript tests and 23 Python tests passed. Firefox package validation reported no errors, warnings or notices.
- Isolated Brave checks covered separate medians, source retries, acsearch sale exclusions, wrong-query rejection, unavailable currencies, periods with no sales and delayed responses after a reference or currency change. The supplied RIC VII Londinium 287 example still resolves from the bundled catalogue.
- The parser was checked against one public CoinArchives page and an independent calculation of its prices. Browser tests used that saved page and acsearch fixtures. Permission allow/deny outcomes were simulated; acceptance of the browser's native permission prompt was not automated. No Pro-account scraping or full-archive pricing is included.
