# Giga Pinax 0.27.0

Version 0.27.0 keeps the complete Giga Pinax research and session acsearch workflow and adds an auction companion.

## Added

- Research, Calculator, and Watchlist tabs in the existing 400 px popup.
- Exact hammer-plus-buyer's-premium calculation in USD, EUR, GBP, and CHF.
- An editable current-page capture and a reviewed reference-to-watchlist handoff.
- A full local workspace for lots, ranked alternatives, planned and externally active bids, reminders, outcomes, collection history, saved comparables, and validated companion backups.
- Separate per-currency exposure and CHF support throughout companion records.

## Data boundary

The existing project-recorded acsearch approval remains scoped to one collector action, one results page, and session-only display. Fetched acsearch rows, prices, identifiers, medians, and claims are never written into watchlist drafts, companion records, exports, or backups. A watchlist handoff contains only the displayed reference, a type label, and a source page URL for review.

Saved comparables are collector-entered or separately authorized records. Their median-of-halves statistics remain separate from the interpolated statistics in the live Research price panel.

## Updating

If Giga Pinax is already loaded from this repository's `dist/brave` directory, open `brave://extensions` and select **Reload**. Existing Giga lookup preferences, Recent references, edited acsearch terms, theme, and ANS label cache stay under their existing localStorage keys. Companion records use their independent browser `storage.local` root.

Companion records created under another extension origin do not move automatically. Export a companion JSON backup from that installation and import it through the 0.27 workspace.

## Verification

The combined source passed 325 JavaScript tests and all 12 Python checks, including the icon-render comparison, deterministic packaging and output-path safeguards. Firefox lint reported zero errors, notices and warnings, and Firefox155 loaded the temporary add-on. Sol implemented the integration; Astra reviewed the design, backend, interface, package and final layout correction with no open source findings.

An isolated Brave profile was upgraded from0.26.0 to0.27.0 at the same extension path. Its Giga preferences, edited terms, Recent references, theme and label cache survived unchanged. Native checks covered research with intercepted source fixtures, no requests on tab changes, calculator/CHF, lookup-window reuse, manual capture fallback, confirmed watchlist drafts, planned versus active exposure, reminders and badge acknowledgement, saved comparables, outcome corrections, and backup restore with stale-preview rejection. No real provider account or session was used for testing.

Full Firefox UI, real toolbar/context-menu interaction and audible OS notifications remain unverified. Reminder delivery and system sound retain the browser/OS limits described in the installation guide.
