# Giga Pinax 0.29.2

Price research now starts directly from a parsed catalogue reference, independently of numismatics.org. Previously, the extension waited for an ANS type card before fetching acsearch prices. An ANS outage could therefore prevent a median even when acsearch had matching sales.

The acsearch controls and median remain available while catalogue details are loading, unavailable or awaiting a more specific match. Catalogue details arriving later do not replace an edited price term, reset included sales or relabel the active price query. Changing the reference starts a separate search and prevents older responses from overwriting it.

The extension still requires the collector's acsearch access to display hammer prices. CoinArchives opens an external search; it is not imported into the median. Failed catalogue lookups do not create verified type records. Existing data, extension identities and permissions remain unchanged.

## Install or update

Under **Assets**, download your browser ZIP rather than a **Source code** archive.

- **Brave or Chrome:** Extract the matching ZIP into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`. To update, replace the files in that same folder and select **Reload**. No Python is needed.
- **Firefox 142+:** Open `about:debugging`, select **This Firefox**, then **Load Temporary Add-on**, and choose the unsigned Firefox ZIP. Load the new ZIP again to update. Temporary add-ons are removed when Firefox restarts; permanent installation requires a Mozilla-signed build.

Store submission and Firefox signing still require publisher account access. These GitHub packages do not claim store publication or signing.

## Verification

All 427 JavaScript tests and 13 Python package tests pass. Firefox validation reports zero errors, notices or warnings. Native Brave checks cover delayed and denied permissions, catalogue outages, ambiguous and missing types, remembered terms, stale responses, currency changes, sale exclusions and copied summaries. A live ANS request returned HTTP 503 while the independent price panel remained usable with synthetic sale data. Paid-account price access was not tested. Astra completed the code and visual review; the isolated browser reported no extension errors.
