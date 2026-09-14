# Giga Pinax 0.29.1

Catalogue outages previously appeared as “Check your connection” and hid the auction-search links. This patch distinguishes a catalogue server error or rate limit from a connection failure and keeps acsearch and CoinArchives searches available for a safely parsed reference.

The searches open the external providers only when selected. A failed catalogue lookup does not create a verified type card, save a result to Recent, or enable saving invented type details. Editing the reference clears the fallback links. Existing data, browser identities and permissions are unchanged.

The ANS catalogue service returned HTTP 503 during diagnosis. This update improves the extension's response to that outage; restoring catalogue data requires the provider to recover. Select **Look up** again to retry.

Verification: all 423 JavaScript tests and 13 Python tests pass; Firefox lint reports no errors, notices or warnings. Native Brave checks cover the real HTTP 503 response, exact HTTP 500 and 429 messages, external search navigation, edits and delayed-response races, and successful recovery using a catalogue response fixture. The final enabled extension has no manifest or runtime errors. Astra approved the code and light/dark layouts. Live ANS recovery and authenticated paid-provider sessions are not claimed.

## Install or update

Under **Assets**, download your browser ZIP rather than a **Source code** archive.

- **Brave or Chrome:** Extract the matching ZIP into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`. To update, replace the files in that same folder and select **Reload**. No Python is needed.
- **Firefox 142+:** Open `about:debugging`, select **This Firefox**, then **Load Temporary Add-on**, and choose the unsigned Firefox ZIP. Load the new ZIP again to update. Temporary add-ons are removed when Firefox restarts; permanent installation requires a Mozilla-signed build.

Store submission and Firefox signing still require publisher account access. These GitHub packages do not claim store publication or signing.
