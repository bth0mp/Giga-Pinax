# Giga Pinax 0.27.2

Giga Pinax 0.27.2 adds a compact **CoinArchives Pro** disclosure to the popup Research view and the workspace Search view. Existing subscribers can sign in on CoinArchives and open its ancient-coin or world-coin Pro archive directly. The extension does not handle Pro credentials, detect login state, fetch paid data, or transfer searches automatically; the existing free CoinArchives search remains available.

The full extension was also audited across research, pricing, browser launch behavior, local records, reminders, backup and restore, accessibility, packaging, and the popup and workspace layouts. The release fixes these confirmed faults:

- Modern KM and Y references now open CoinArchives World Coins; ancient references continue to open Ancient Coins.
- Remembered acsearch terms are isolated by corpus and record, including long Unicode identifiers, so one catalogue cannot inherit another catalogue's term.
- Rapid right-click and pop-out lookups coalesce onto the latest request instead of losing it or opening duplicate windows.
- Workspace navigation exposes the active page correctly to assistive technology. Edits typed while a save is in flight remain in the editor and update the record created by that save.
- Enabling desktop alerts reconciles reminders that are already due. Failed notification delivery gets a bounded five-minute retry while the event remains relevant.
- Date-only events use their saved timezone in the popup summary.
- Merge-import preview preserves local capture drafts.
- Reminder schedules are accepted only when their complete durable state and lifecycle reserve fit the 5 MiB local-storage budget. An oversized schedule is refused atomically, without partially saving an event or silently dropping reminders.

The final source passed 355 JavaScript tests and 12 bundled Python tests. Firefox lint completed with no errors, warnings, or notices, and the source installed successfully as a temporary extension in Firefox 155 headless. Native Brave testing covered the packaged update, persisted records, concurrent popup and editor races, pop-out failure and retry, core research and companion workflows, and responsive light and dark layouts without page, runtime, or manifest errors. Paid CoinArchives and authenticated acsearch Premium sessions, full Chrome and Firefox UI passes, and audible operating-system notification sound were not tested. See [the public audit report](https://github.com/bth0mp/Giga-Pinax/blob/v0.27.2/docs/AUDIT-2026-09-12.md) for the precise coverage and remaining limits.

## Downloads

- [Brave 0.27.2 ZIP](https://github.com/bth0mp/Giga-Pinax/releases/download/v0.27.2/giga-pinax-brave-0.27.2.zip)
- [Chrome 0.27.2 ZIP](https://github.com/bth0mp/Giga-Pinax/releases/download/v0.27.2/giga-pinax-chrome-0.27.2.zip)
- [Firefox 0.27.2 ZIP](https://github.com/bth0mp/Giga-Pinax/releases/download/v0.27.2/giga-pinax-firefox-0.27.2.zip)

## Install or update

Under **Assets**, download the ZIP for your browser, not a **Source code** archive. Public downloads require no GitHub account.

- **Brave or Chrome:** Unzip the package into a permanent folder. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the folder containing `manifest.json`.
- **Firefox 142+:** Open `about:debugging`, select **This Firefox**, select **Load Temporary Add-on**, and choose the Firefox ZIP. This unsigned temporary add-on is removed when Firefox restarts.
- **Updating Brave or Chrome:** Replace the files in the same folder, then select **Reload** on the extensions page.
- **Updating Firefox:** Load the new Firefox ZIP again.

Release assets are the versioned Brave, Chrome, and Firefox packages plus the stable Brave and Firefox download aliases documented in [RELEASING.md](https://github.com/bth0mp/Giga-Pinax/blob/v0.27.2/docs/RELEASING.md).
