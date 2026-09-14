# Giga Pinax 0.30.0

Roman Imperial reference lookups now check bundled OCRE data before contacting numismatics.org. The package includes 52,254 active type records and 2,808 replacement redirects derived from the supplied RDF export. It preserves canonical identifiers and loads detailed records only when needed. Local type cards, candidate choices and Settings identify the data source.

RIC type details can work without ANS access. Missing records retain an online fallback, with an explicit **Check online** action when permission is needed. The bundled snapshot covers OCRE/RIC only: Crawford/RRC, Price, Seleucid Coins and Bopearachchi still use their existing online sources. Individual museum specimens remain in separate linked datasets, accessible through the type pages. The export's publication date is unknown. It contains no auction prices or coin images, and missing labels are not invented.

Median prices remain independent of catalogue lookup and still need internet access and an acsearch account with hammer-price access. CoinArchives remains an external search. Existing extension identities and permissions are preserved.

The bundled type database is derived from American Numismatic Society OCRE data under ODbL 1.0. Packages include attribution and source metadata; reproducible conversion instructions are in the repository. Conflicting source records are withheld from local results and recorded in the metadata.

## Install or update

Under **Assets**, download your browser ZIP rather than a **Source code** archive.

- **Brave or Chrome:** Extract the matching ZIP into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`. To update, replace the files in that same folder and select **Reload**. The local catalogue is included; no Python, database setup or server is needed.
- **Firefox 142+:** Open `about:debugging`, select **This Firefox**, then **Load Temporary Add-on**, and choose the unsigned Firefox ZIP. Load the new ZIP again to update. Temporary add-ons are removed when Firefox restarts; permanent installation requires a Mozilla-signed build.

Store submission and Firefox signing still require publisher account access. These GitHub packages do not claim store publication or signing.

## Verification

All 439 JavaScript tests and 20 Python tests pass with no skips. Firefox validation reports zero errors, notices or warnings. Native Brave checks cover offline cards, candidate choices, saved-reference redirects, corrupted-bundle recovery, denied and delayed permissions, stale responses, independent price curation and narrow layouts. The isolated browser reported no extension or page errors. Every active index entry and alias target was checked against the generated shards, and the packaged data was compared byte for byte. Price checks used synthetic sale rows; paid-account access was not tested. Astra approved the code, data conversion, packaging and visual review.
