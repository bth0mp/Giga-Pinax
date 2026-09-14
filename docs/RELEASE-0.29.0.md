# Giga Pinax 0.29.0

Version 0.29.0 turns the local watchlist into a fuller auction workflow while preserving schema version 1, existing records, the 5 MiB storage bound, and the rule that Giga Pinax never places bids.

## New in this release

- Capture and edit auction page, house, sale and lot identity. Duplicate lots are detected without silently merging records.
- Record weight, diameter, condition, up to two external photo links, sourced provenance notes, shipping, payment fees and bid increments.
- Calculate total bid cost and the highest affordable hammer on a collector-entered increment grid.
- Curate acsearch results for the current session; counts, range, median, comparison and copied summaries use the same included rows.
- Work through Closing soon, Needs research, Planned, Active and Completed queues, with timed deadlines distinguished from date-only auction starts.
- Compare two to four saved coins. External HTTP or HTTPS photo servers are contacted only after comparison opens; Giga Pinax stores URL links rather than photo files.
- Carry auction context through current-page capture and Research while keeping save actions guarded against repeated clicks.

Core catalogue lookups use `numismatics.org`, `nomisma.org` and `www.acsearch.info` over HTTPS. acsearch uses the collector's existing provider session. CoinArchives, RPC and GitHub release pages open only when selected. Live provider rows are not written to saved evidence.

## Install or update

Under the GitHub release **Assets**, download the ZIP for your browser rather than a **Source code** archive.

- **Brave or Chrome:** Extract the Chromium ZIP, open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the extracted folder. For an update, replace the files in that same folder and select **Reload**.
- **Firefox 142+:** Open `about:debugging`, choose **This Firefox**, select **Load Temporary Add-on**, and choose the unsigned Firefox ZIP. Load the new ZIP again to update. The temporary add-on is removed when Firefox restarts; permanent installation requires a Mozilla-signed build.

Existing local records remain in place when the same extension identity is reloaded. Export a JSON backup before updating if the records matter.
