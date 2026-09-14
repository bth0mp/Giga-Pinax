# Giga Pinax Privacy Policy

Effective date: 14 September 2026

Giga Pinax is a browser extension for ancient-coin research and local auction and collection records. It has no Giga Pinax account, analytics, advertising or developer-operated data server. Questions may be filed publicly through [GitHub Issues](https://github.com/bth0mp/Giga-Pinax/issues). Do not include private auction, payment or collection information in a public issue.

## Information handled

Giga Pinax handles references and search terms that you enter. After you explicitly choose a context-menu or current-page command, it can also handle selected page text and the current page address to prepare editable research or an auction draft. It does not monitor browsing in the background.

The extension stores information you choose to save in browser extension storage. This can include watchlist and collection records, auction identity and page links, notes, bid plans and outcomes, reminders, provenance, measurements, condition, fee estimates, collector-entered comparable sales and up to two external photo URL links per coin. Giga Pinax stores the photo URLs, not copies of the photo files.

## Network requests

When you request research, Giga Pinax sends the needed reference or derived search phrase over HTTPS to one or more independent providers:

- American Numismatic Society services at `numismatics.org` for public catalogue searches and type records;
- Nomisma.org at `nomisma.org` for public numismatic terms and labels; and
- acsearch.info at `www.acsearch.info` for the requested session sale-result search, using your existing acsearch browser session when available.

These providers receive the request and ordinary connection data such as an IP address and process it under their own terms and privacy practices. Search text may appear in request URLs and provider logs. Giga Pinax does not control provider retention.

CoinArchives free and Pro, RPC Online and GitHub release controls open external pages only when you choose them. Giga Pinax does not receive CoinArchives credentials or import paid data. A GitHub request occurs when you choose a release or update download; the extension does not poll GitHub in the background.

When you open saved-coin comparison, Giga Pinax may load the external photo URL links you entered. Those photo servers can use HTTP or HTTPS and receive an ordinary image request, including connection data such as your IP address. Images are lazy-loaded with no referrer. Photo servers are not contacted when you import, list or edit a coin, and a failed image shows an unavailable-image fallback.

## Storage, retention and deletion

Saved records and preferences remain in the browser's extension storage on your device. They are not uploaded or synced to the developer. Fetched acsearch rows and inclusion choices remain in the current research session and are not automatically added to durable collection evidence.

You can edit or delete records in Giga Pinax and export or import a JSON backup. An exported backup leaves the browser only when you choose where to save or send it. Removing the extension or clearing its extension data removes local records, subject to the browser and device's own backup behavior.

Optional desktop notifications contain auction and reminder information you supplied and are created through the browser after you enable notifications.

## Use and disclosure

Data is handled only to provide the coin research, auction planning, reminders, comparison and collection features described above. The developer does not receive extension records, sell data, use it for advertising, creditworthiness or lending, or permit humans to read it. Necessary user-requested transfers to research providers, GitHub or collector-specified photo servers are described above.

Use of information received from browser APIs follows the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Security and changes

Core research providers use HTTPS. Explicit collector-supplied photo URLs may use HTTP; an HTTP image request is not encrypted in transit. Browser extension storage is protected by the browser profile and device, but it is not an encrypted vault. Avoid saving unrelated secrets or credentials in notes.

This policy will be updated when the extension's data practices change. Because the developer does not receive or host extension records, local records must be deleted in Giga Pinax, in the browser, or by uninstalling the extension. Requests concerning a research or photo provider's logs must be directed to that provider.
