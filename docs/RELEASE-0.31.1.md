# Giga Pinax 0.31.1

This patch restores searches entered through **Refine reference**. You can leave the top search box empty, select a catalogue, fill its reference fields and select **Search**. Pressing Enter in a refined field runs the same search. RIC volume and ruler fields work with the number, and valid values restored from an earlier lookup remain searchable.

Text left over in the top box no longer overrides a newly refined reference. Existing top Reference lookups continue to work.

## Install or update

Under **Assets**, download your browser ZIP rather than a **Source code** archive.

- **Brave or Chrome:** Extract the matching browser ZIP into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`. To update, replace the files in that folder with the new ZIP contents and select **Reload**.
- **Firefox 142+:** Open `about:debugging`, choose **This Firefox**, select **Load Temporary Add-on**, and choose the unsigned Firefox ZIP. Load the new ZIP again to update. Firefox removes temporary add-ons when it restarts; permanent installation requires a Mozilla-signed build.

No Python or database setup is needed.

## Verification

- 472 JavaScript tests and 23 Python tests passed. Firefox package validation reported no errors, warnings or notices.
- Isolated Brave checks reproduced the old saved-field failure, then verified Search and native Enter for restored RRC 234/1 and RIC VII Constantine II 287 fields. Stale top text, empty-field validation, shared loading state and existing top-box lookups were also checked.
- The Search button fits the 320-pixel side panel. No extension runtime or manifest errors were reported. Browser price and network responses used fixtures; the RIC example used the bundled catalogue.
