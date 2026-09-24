# Giga Pinax Privacy Policy

Effective date: 17 September 2026

Giga Pinax is a browser extension for ancient-coin research and local auction and collection records. It has no Giga Pinax account, analytics, advertising or developer-operated data server. Questions may be filed publicly through [GitHub Issues](https://github.com/bth0mp/Giga-Pinax/issues). Do not include private auction, payment or collection information in a public issue.

## Information handled

Giga Pinax handles references and search terms that you enter. After you explicitly choose a context-menu or current-page command, it can also handle selected page text and the current page address to prepare editable research or an auction draft. A current-page capture reads that page's own structured data (`application/ld+json`) and its `og:` page metadata as well as its visible text, all from the page you are looking at, and it refuses a page it is not permitted to read, such as a browser settings page, an extension page or a local file. It does not monitor browsing in the background.

The extension stores information you choose to save in browser extension storage. This can include watchlist and collection records, auction identity and page links, notes, bid plans and outcomes, reminders, provenance, measurements, condition, fee estimates, saved house premiums and their bid increment ladders, collector-entered comparable sales and up to two external photo URL links per coin. Giga Pinax stores the photo URLs, not copies of the photo files.

Unsaved capture drafts, which hold the captured page text and what the page stated about the lot's sale (the price its offer gives, when it closes, a photo link and the provenance it lists), and a short ledger of recent write requests are also kept in that storage so a save is not repeated or lost. A reference you have typed is held in the browser's extension session storage while a permission prompt closes the popup, and is discarded when the browser session ends.

The research popup also keeps a few display settings in the extension page's own `localStorage`, so it opens the way you left it: your last six lookups, up to 50 price-search phrases you have edited, the research form's catalogue, number, volume, ruler or mint, currency and sales period, the light or dark theme, a cache of the Nomisma names an online card has already been given, and a copy of the default currency the popup can read before the background answers it. None of it is part of a backup or of the raw export, and all of it goes when the extension's data is removed.

## Network requests

RIC, Crawford (RRC), Price and Seleucid Coins (SC) reference lookups first check the OCRE, CRRO, PELLA and SCO data packaged inside the extension. A local match does not transmit the reference to ANS or Nomisma. If the bundled data cannot answer the lookup, the extension can use online catalogue services with provider access. If that access is disabled, an explicit **Check online** action requests it. Bopearachchi references are not bundled and always use the online services, because the citation that identifies a Bopearachchi type is only in the online records. A local match makes no Nomisma request either: the English Nomisma.org names for every authority, denomination, mint, material and portrait the bundled records carry are packaged with them, under CC BY 3.0, so a local card is named from inside the package. Ruler names on RIC cards come from the Nomisma snapshot in `ric-people.js`, which takes precedence over the bundled label file. A concept Nomisma publishes no English name for shows as the identifier the record carries, rather than a guess. Auction-price research is independent of the type record: the acsearch price search starts with every lookup once acsearch access is granted, and does so whether the type record came from inside the package or from online.

Giga Pinax sends the needed reference or derived search phrase over HTTPS to one or more independent providers — the price search with every lookup, the rest only when that research is requested:

- American Numismatic Society services at `numismatics.org` for public catalogue searches and type records;
- Nomisma.org at `nomisma.org` for public numismatic terms and labels;
- acsearch.info at `www.acsearch.info` for the sale-result search, which starts with every lookup once acsearch access is granted — the default in Brave and Chrome, where acsearch is a required host permission — and uses your existing acsearch browser session when available; and
- CoinArchives at `www.coinarchives.com` for one public results page when you explicitly request CoinArchives prices and grant optional access. This request omits credentials and does not access CoinArchives Pro.

These providers receive the request and ordinary connection data such as an IP address and process it under their own terms and privacy practices. Search text may appear in request URLs and provider logs. Giga Pinax does not control provider retention.

CoinArchives price research is requested separately from acsearch. It sends the CoinArchives query shown in Research, calculates a separate median from readable public hammer prices in the selected original currency, and keeps those rows in memory for the current research session. It does not download coin images or follow additional result pages. CoinArchives Pro, RPC Online and external source links open only when you choose them. Giga Pinax does not receive CoinArchives credentials or import paid CoinArchives data. A GitHub request occurs when you choose a release or update download; the extension does not poll GitHub in the background.

In Firefox, updates are Firefox's own business, not Giga Pinax's. The Firefox package names an update manifest, `https://bth0mp.github.io/Giga-Pinax/firefox/updates.json`, which Firefox may request periodically as it does for every add-on that names one; for a signed install it then downloads a newer signed version from the GitHub release. These are ordinary requests to GitHub, carrying connection data such as your IP address and nothing from your records. A temporary install is never updated from it.

When you open saved-coin comparison, Giga Pinax may load the external photo URL links you entered or kept from a captured page. Those photo servers can use HTTP or HTTPS and receive an ordinary image request, including connection data such as your IP address. Images are lazy-loaded with no referrer. Photo servers are not contacted when you import, list or edit a coin, and a failed image shows an unavailable-image fallback.

## Storage, retention and deletion

Saved records and preferences remain in the browser's extension storage on your device. They are not uploaded or synced to the developer. Fetched acsearch and CoinArchives rows, and acsearch inclusion choices, remain in the current research session and are not automatically added to durable collection evidence or backups. Optional CoinArchives host access can be revoked through the browser's extension permissions controls.

A record that cannot be read is set aside in the same local storage rather than discarded. Settings lists it under **Backup and import**, where it can be downloaded on its own and, where it is valid again, put back with **Restore**. Settings that cannot be read are set aside whole in the same way, house presets included, and can be downloaded from the same place.

You can edit or delete records in Giga Pinax and export or import a JSON backup, or export one table of your records at a time as a CSV file for a spreadsheet. An exported backup or CSV file leaves the browser only when you choose where to save or send it. **Export raw data** writes a rescue file that is a verbatim copy of that storage, including unsaved drafts, their captured page text and recent request ids; treat it as you would the records themselves. Replacing your records with an import, or merging one that would overwrite a record, first downloads a safety copy of your current records to your own device. Removing the extension or clearing its extension data removes local records, subject to the browser and device's own backup behavior.

Giga Pinax also keeps a short diagnostics list in the same extension storage, under a key of its own: the last 50 failures, each with when it happened, which page (research popup, workspace, Settings or background), which part (catalogue lookup, acsearch, CoinArchives, local records, page capture or reminders), what kind of failure and any HTTP status, a byte count where a reply was too large, and the extension version. It never holds a search term, reference, web address, record or page text. It stays on your device and is never sent anywhere; it is not part of a backup or the raw export. **Copy diagnostics** in Settings puts a plain-text copy on your clipboard for you to paste where you choose, and **Clear** empties the list.

Optional desktop notifications contain auction and reminder information you supplied and are created through the browser after you enable notifications.

## Use and disclosure

Data is handled only to provide the coin research, auction planning, reminders, comparison and collection features described above. The developer does not receive extension records, sell data, use it for advertising, creditworthiness or lending, or permit humans to read it. Necessary user-requested transfers to research providers, GitHub or collector-specified photo servers are described above.

Use of information received from browser APIs follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Security and changes

Core research providers use HTTPS. Explicit collector-supplied photo URLs may use HTTP; an HTTP image request is not encrypted in transit. Browser extension storage is protected by the browser profile and device, but it is not an encrypted vault. Avoid saving unrelated secrets or credentials in notes.

This policy will be updated when the extension's data practices change. Because the developer does not receive or host extension records, local records must be deleted in Giga Pinax, in the browser, or by uninstalling the extension. Requests concerning a research or photo provider's logs must be directed to that provider.
