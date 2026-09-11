# Giga Pinax v0.6 One-Click Prices

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** When a type resolves — from **Look up** or from choosing a "Did you mean" suggestion — fetch its acsearch prices in the same click, so a reference becomes a median with one action. **Get prices** stays for re-running with an edited term and for granting acsearch access the first time.

**Scope check:** acsearch approved exactly this shape — a collector initiates one catalogue-reference lookup with their own account and receives a median plus links to the sales. It is still one user-initiated action, one acsearch results page, nothing stored from acsearch.

## Global Constraints

- At most one acsearch request per user action (Look up click / Enter, suggestion click, Get prices click). The automatic fetch only runs when acsearch host access is **already** granted: check with `permissions.contains({ origins: [ACSEARCH_ORIGIN] })` (no prompt, no gesture needed). Without access the prices form waits for **Get prices**, which requests access in its own gesture as today. The type-lookup permission request stays the first asynchronous call in the submit handler and is unchanged.
- The automatic fetch uses the term already in the prices field (remembered term, else the default term) and the currency selected at the moment the type rendered, and it does **not** store the term; only an explicit **Get prices** submission remembers a term.
- A newer lookup, a reference edit, a catalogue change or a currency change must cancel the effect of an in-flight automatic fetch exactly as they do for a manual one (same `priceRequestId` guard).
- Nothing else about prices changes (strict parser, `credentials: 'include'`, `cache: 'no-store'`, 15 s timeout, textContent-only DOM).
- Version `0.6.0` in manifests, package test and docs.
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output.

---

### Task 1: automatic price fetch after a resolved type, two a11y fixes, 0.6.0

**Files:** `extension/popup.js`, `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`, `README.md`, `docs/INSTALL.md`, `install/index.html`.

**Behaviour (`extension/popup.js`)**

1. `async function hasAcsearchAccess()` → `true` when there is no `permissions.contains` API (plain page), else the result of `permissions.contains({ origins: [ACSEARCH_ORIGIN] })`, `false` if that throws or rejects.
2. `runPrices(term, currency, { remember = true } = {})` — only calls `rememberTerm` / `savePreferences` when `remember` is true. The Get prices submit handler keeps calling it with the default (remembering).
3. After `run()` renders a card (`outcome.status === 'ok'`), still inside the same `run()` and only while `id === requestId`: capture `const term = $('price-term').value.trim(); const currency = $('currency').value;` synchronously right after `renderCard`, then `if (term && await hasAcsearchAccess() && id === requestId) runPrices(term, currency, { remember: false });`. This covers both Look up and suggestion clicks, since both go through `run()`.
4. A11y fix 1: `clearOutput()` also empties `#form-error`'s text (so a hidden stale message is not read through `aria-describedby`).
5. A11y fix 2: in the reference-form submit handler, when `reportValidity()` fails, first clear any earlier one-box error (`#form-error` hidden and emptied, `aria-invalid` removed from `#quick-reference`) before returning.

**Docs and version**

6. Manifests `version` `0.6.0`; `tests/test_packages.py` version assertion and ZIP name `0.6.0`; every `0.5.0` in README/INSTALL/install page → `0.6.0`. Remove stale `dist/giga-pinax-*-0.5.0.zip`.
7. README "What it does": replace the "editable acsearch search term … **Get prices** button" bullet with `- **Look up** also fetches acsearch prices in the same click once acsearch access is granted; edit the acsearch search term and select **Get prices** to re-run it (edited terms are remembered per type).`
8. INSTALL "What to try": replace the "Select **Get prices**…" bullet with `- **Look up** fetches prices too. If you are not signed in on acsearch, the popup says so with a sign-in link; sign in with an account that includes hammer prices, then select **Get prices**.` and keep the edit-the-term bullet. The install page's try-it paragraph says Look up shows the type and its recent hammer prices together.

**Verify:** Node suites still 41/41 (no pure-module change), Python suite OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors`, `node --check extension/popup.js`, and `git grep -n "0\.5\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing.

**Commit** the seven files: `Fetch prices in the same click as Look up and release 0.6.0`.

## Verification (controller, never-cached origin, acsearch stubbed)

With `window.fetch` wrapped so `https://www.acsearch.info/` returns a stub page and every other request is real: Look up `Price 23` → type card then the median panel with exactly one acsearch request and no term stored; choosing a suggestion (RIC `I` Nero 306) → one acsearch request; Get prices after editing the term → one more request and the term stored; with `chrome.permissions` stubbed so `contains` resolves `false`, Look up makes zero acsearch requests and Get prices still works; changing currency during an automatic fetch leaves no panel; the one-box error path and not-found path make zero acsearch requests; 400 px; console clean.
