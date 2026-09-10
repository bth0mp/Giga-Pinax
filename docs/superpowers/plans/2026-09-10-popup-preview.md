# Popup Preview Implementation Plan

> **For agentic workers:** This is one reversible layout-preview task. Implement locally and use independent design review plus browser verification.

**Goal:** Make the approved popup choices concrete and reviewable.

**Architecture:** Static HTML, CSS and a small DOM script, served locally or opened directly. A presentation frame supplies preview-only controls outside the popup. No extension APIs or remote data integration.

**Tech Stack:** HTML, CSS, JavaScript; Python standard-library local server for visual review.

**Spec:** `docs/superpowers/specs/2026-09-10-popup-design.md`

## Global constraints

- Desktop Brave and Firefox layout target.
- USD initially; system theme initially.
- No authentication claims, credentials, scraping, fabricated source links or live price claims.
- Clearly label fictional results and currency-format demonstrations.
- Use no external dependencies.

## Task: build and inspect the popup preview

- [x] Create `prototype/index.html` with external preview controls, a 400px popup, first-use and lookup states, labelled guided fields, result summary and sample-sale disclosure.
- [x] Create `prototype/styles.css` with the spec's semantic palette, system/light/dark modes, visible focus and responsive preview frame.
- [x] Create `prototype/preview.js` to switch states, show RIC-specific fields, validate the two fixture references, format sample currencies and remember the currency choice. External sign-in must not update connection state.
- [x] Create `README.md` explaining how to open the preview and its integration limits.
- [x] Verify syntax with `node --check prototype/preview.js`, then inspect and exercise the UI through the browser tool. This reversible visual prototype uses browser checks rather than a new automated test framework.
- [x] Record verified behaviors and prepare the preview for delivery.

## Verification evidence

- JavaScript syntax check passed after allowing Node to resolve the sandbox-protected parent path.
- Inspected first-use and result screens in light and dark modes in the Codex in-app browser.
- Currency changes preserve the visible results and update amounts; the selected currency persists through reload. Restored USD for delivery.
- RIC selection reveals volume/edition and ruler/mint section. Unsupported `306A` shows an explicit preview-only message and hides stale results; restoring `306` displays the sample again.
- The expanded disclosure contains nine fictional sales; summary shows 180 median and 135–245 middle 50%.
- Fixed narrow-grid overflow; at a 375px viewport the popup content has matching 334px client/scroll widths, including RIC fields.
- Keyboard Tab reaches the primary button with a solid visible focus outline. No warning/error console entries were captured.
- The sign-in link targets acsearch's official login page; no real login was attempted.
- Native Brave/Firefox installation, store signing, live account access and real prices remain untested and outside this preview.
