# Installable Popup Test Build Plan

**Goal:** Package the approved popup as local Brave and Firefox test extensions.

**Architecture:** Shared static extension pages, browser-specific Manifest V3 files and a standard-library Python packager. No background scripts or host permissions. Local storage remembers sample-mode entry, currency and guided reference fields. All prices remain explicitly fictional.

**Scope:** User approved the layout and asked to continue with installable browser test versions. Keep the original `prototype/` intact. Live account detection and acsearch data retrieval remain outside this milestone. Firefox normal permanent installation requires Mozilla signing; deliver an unsigned temporary-test ZIP with accurate instructions.

**Workspace:** The repository has no commits, so no committed baseline exists for a linked worktree. Work on `codex/installable-popup` in the existing project without altering the original preview.

## Tasks

- [x] Popup: move the approved popup into `extension/popup.html` and `popup.css`, without the outside presentation controls. Show first use initially, allow sample mode, and retain a link to acsearch sign-in without claiming account verification.
- [x] State and sample behavior: add `sample-data.js` and `popup.js`. Test exact supported sample identities, suffix/section/edition mismatches, missing/corrupt preferences, USD defaults, and honest empty/error behavior. Use only local module scripts and assets.
- [x] Assets: create a simple coin mark as SVG plus 16/32/48/128px PNG variants for toolbar use.
- [x] Packaging (delegated): minimal Brave/Firefox manifests, repeatable safe ZIP build, package structure tests and installation instructions.
- [x] Verification: run JavaScript tests, Python package tests, manifest lint and inspect popup pages in the browser. Get independent final code review and address actionable findings.
- [x] Delivery: produce the two ZIPs plus unpacked folders, a local download/install page, and explain Firefox temporary-install limits.

## Interface contract

The packager includes exactly `popup.html`, `popup.css`, `popup.js`, `sample-data.js`, `icon.svg`, `icons/icon-16.png`, `icons/icon-32.png`, `icons/icon-48.png`, `icons/icon-128.png`, and a browser-specific `manifest.json` at the archive root. No filesystem credentials, repository files, scripts or tests are packaged.

## Verification scope

Browser-page visual inspection is separate from native browser extension installation. Record exactly which was completed; do not infer Brave/Firefox runtime success from in-app browser rendering alone.

## Verification results — 2026-09-10

- `node --test tests/sample-data.test.mjs`: 5 passed, 0 failed.
- `python -m unittest discover -s tests -p 'test_*.py' -v`: 6 passed. Archives rebuilt twice with identical bytes and the exact allowlisted contents.
- Mozilla `web-ext` 10.6.0 lint of the final Firefox package: 0 errors, 0 notices, 0 warnings, using `--warnings-as-errors`.
- Firefox 155.0.1: final package installed successfully as a temporary add-on through `web-ext run` in a fresh headless test profile.
- Brave 152.1.94.121: `web-ext run` started a fresh headless Chromium profile and completed its extension-loading sequence without reported load errors. This is a CLI smoke check, not a visual toolbar test.
- Packaged popup inspected in the in-app browser: first-use/sample navigation, exact Price/RIC samples, rejected suffixes, saved reference/currency on reload, nine expanded sale rows, official sign-in links and no console errors. The popup measures 400 × 600 px with internal scrolling and no horizontal body overflow. Corrected and rechecked stale screen-reader announcements after reference edits.
- Download page visually inspected; page and both ZIP URLs return HTTP 200 from the local preview server at `http://127.0.0.1:8766/install/`.
- Independent static code review found no actionable issues. Follow-up review confirmed agreement between installation page, guide, README and Firefox manifest (minimum Firefox 142).

Native browser toolbar appearance and account integration remain unverified. The builds contain fictional data only, and signing/publication are outside this milestone. Original prototype files are preserved. Test browser processes were stopped; the local download server remains available for the user.
