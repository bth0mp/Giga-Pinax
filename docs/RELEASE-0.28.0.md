# Giga Pinax 0.28.0

This release brings research and auction planning into one consistent collector interface.

- Open research in the browser’s native side panel or sidebar while the toolbar popup remains available for quick lookups.
- Work from a compact watchlist and one selected-coin detail pane, including optional private lot notes.
- Calculate hammer plus buyer premium or the maximum affordable hammer from a total budget. Saved house premiums are available wherever the shared calculator appears.
- Use one Sources menu for acsearch and the free and Pro CoinArchives routes.
- Manage theme, default bid currency, house premiums, updates and backup/import from Settings.

Storage remains schema 1 and existing 0.27 records load without migration. Durable changes still use revision-checked commands. Fetched provider prices remain session-only, and shipping and tax are excluded from calculator totals.

## Install or update

For Brave or Chrome, download the versioned Chromium ZIP, extract it into a permanent folder, enable Developer mode at `brave://extensions` or `chrome://extensions`, and choose **Load unpacked**. To update, extract the new files over that same folder and select **Reload**.

For Firefox 142 or later, open `about:debugging`, choose **This Firefox**, select **Load Temporary Add-on**, and choose the Firefox ZIP. This build is unsigned and temporary, so Firefox removes it at restart; load the ZIP again after restarting.

## Validation

- 379 JavaScript tests and 13 Python packaging tests passed.
- Firefox extension lint completed with zero warnings, and the package installed temporarily in Firefox 155.
- Native Brave 153 checks covered side-panel opening, query preservation across tab changes, complete schema-1 record preservation from 0.27.2, calculator and premium-preset behavior in a German locale, Settings backup download and import, and workspace save-race handling.

Paid logged-in source sessions, the complete Firefox sidebar interface, and a separate Chrome interface pass were not tested.
