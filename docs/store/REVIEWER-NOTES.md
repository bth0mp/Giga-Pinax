# Reviewer notes for Giga Pinax 0.29.0

Giga Pinax has no product account, developer server, analytics, ads, purchase flow or automatic bidding. No test credentials are required for its local workspace. acsearch results depend on the reviewer's existing acsearch session and provider response; the extension does not receive those credentials. CoinArchives Pro is an external user-opened link and is not required for review.

To exercise Research, open the popup or sidebar and try `RIC I² Nero 306`, `Crawford 44/5`, `SC 1266.2`, and `Price 23`. Type lookups contact `numismatics.org`; labels can contact `nomisma.org`; a requested price search contacts `www.acsearch.info`, all over HTTPS. Exclude and restore a sale to confirm that the visible count, range, median, comparison and copied summary share the same session-only included rows.

To exercise page capture, select reference text on a web page and use a Giga Pinax context-menu command. Current-page content and its URL are accessed only after the action and remain editable before research or save. Repeating a save does not create a second record, and a duplicate auction identity offers the existing coin rather than merging it.

In Calculator, enter a hammer and buyer premium, expand fees and increments, then add shipping, percentage/fixed payment fees, a minimum and fixed increment. Giga Pinax calculates only; it does not submit a bid.

In Watchlist, inspect the workflow queues and a saved record's auction context, provenance, measurements, condition and two photo URL fields. Compare two to four saved coins. Photo URLs are links, not local photo files: their explicitly entered HTTP or HTTPS servers are contacted only after comparison opens. Images use lazy loading and no-referrer and show an unavailable fallback.

Records, settings and manual comparable evidence use browser-local extension storage and JSON backup/import. Fetched acsearch provider rows are not saved as evidence. Notifications are optional.

The shipped JavaScript is readable and unminified. `scripts/build.py` uses only the Python standard library to copy the allowlisted extension files and the browser-specific manifest into deterministic ZIPs; it performs no transpilation, bundling or minification. From the repository root run `python scripts/build.py`. Development-only icon rendering uses Pillow through `python scripts/make_icons.py`; Pillow and store artwork tools are not packaged.

The Firefox package retains the stable ID `giga-pinax@local.invalid`. The repository has no `LICENSE`; no licence claim is included in this note.
