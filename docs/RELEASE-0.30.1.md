# Giga Pinax 0.30.1

RIC ruler suggestions now include verified people represented in the bundled OCRE records, including emperors missing from the mint-organised volumes VI–IX. The existing mint choices remain available. Selecting a person in one of those mint-organised volumes preserves that volume.

Local lookup checks both issuing authorities and obverse portraits. For example, `RIC VII Constantine II 287` resolves to **RIC VII Londinium 287**, whose portrait is Constantine II and issuing authority is Constantine I. `Constantinus II` is recognised as the same person's name; `Constantius II` remains a different person. Multiple matching types remain choices.

Pasted lot descriptions containing an OCRE identifier are parsed as catalogue references. An identifier is only used after checking it against the citation and person; conflicting identifiers cannot silently select a different coin. RIC price searches retain a single recognised ruler from the lot description instead of searching only its catalogue number. Price research remains independent of catalogue lookup.

The new names are packaged with the extension. No runtime database download, crawler or server is needed. Coverage reflects this OCRE snapshot and its linked Nomisma concepts; source mistakes are not automatically corrected. Museum specimens remain separate linked datasets.

## Install or update

Under **Assets**, download your browser ZIP rather than a **Source code** archive.

- **Brave or Chrome:** Extract the matching ZIP into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`. To update, replace the files in that same folder and select **Reload**. No Python or database setup is needed.
- **Firefox 142+:** Open `about:debugging`, choose **This Firefox**, select **Load Temporary Add-on**, and choose the unsigned Firefox ZIP. Load the new ZIP again to update. Temporary add-ons are removed when Firefox restarts; permanent installation requires a Mozilla-signed build.

## Verification

All 452 JavaScript tests and 23 Python tests pass with no skips. Firefox validation reports zero errors, notices or warnings. Native Brave checks cover the supplied lot, typed and Latin names, omitted volumes, similar rulers, ambiguous references, conflicting and multiple identifiers, explicit mint/person conflicts, retained volume selections and visible mismatch feedback. No ANS requests, page errors or extension errors occurred in these local lookup checks. The narrow dark layout was checked at 390 pixels. Independent price calculation and curation were verified with synthetic sale rows; paid-account access was not tested. Astra approved the code, data import and provenance. The people module regenerates byte for byte from the saved official source snapshot.
