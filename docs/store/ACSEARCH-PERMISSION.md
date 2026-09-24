# Option: make acsearch an optional host permission

**Status: not implemented — for the owner to decide.** Nothing in the package has changed. This note sets out what the change would be, what a collector would see, and what it would gain in store review, so the decision can be taken on its own.

## Today

Both manifests list `https://www.acsearch.info/*` under `host_permissions`, beside `numismatics.org` and `nomisma.org`. In Brave and Chrome that access is granted at install, so the price search that starts with every lookup sends the search phrase to acsearch, with the collector's own acsearch session, from the first lookup on. The privacy policy, README, INSTALL and the store listing all say so ("the default in Brave and Chrome"). In Firefox the collector can withhold or revoke host access in `about:addons`, and the popup already copes with that: the automatic price search checks `permissions.contains` first, and without access it shows "Select “Get prices” to let Giga Pinax fetch acsearch prices." instead of searching.

## What would change in the code

1. **Manifests.** In `manifests/brave.json` and `manifests/firefox.json`, move `https://www.acsearch.info/*` from `host_permissions` to `optional_host_permissions`, beside `https://www.coinarchives.com/*`.
2. **Tests.** `tests/test_packages.py` pins the permission sets (`HOST_PERMISSIONS` and the `optional_host_permissions` assertion); both lists change with the manifests.
3. **Popup.** No new flow is needed: every acsearch path already goes through the checks Firefox exercises today.
   - `fetchAutomaticPrices` (`extension/popup.js`) checks `hasAcsearchAccess()` and, without access, shows the **Get prices** hint rather than searching.
   - The **Get prices** submit handler calls `requestHostAccess([ACSEARCH_ORIGIN])` synchronously inside the click, so the browser treats it as a user gesture, and reports a refusal with its own message.
   - A prices-only reference (RPC, Sear, SNG…) already requests `ACSEARCH_ORIGIN` when it is looked up, and the pending reference survives a prompt that closes the popup (`storage.session`).
   - A currency change re-prices only when access is already granted.
   Worth adding: one line in the hint on first use saying that access is asked for once and can be revoked in the browser's extension settings, and a test in `tests/popup-research.test.mjs` that a bundled lookup with acsearch not granted shows the hint and makes no acsearch request (its fakes already answer `permissions.contains` with `false` for other cases).
4. **Documents.** `docs/PRIVACY.md`, `README.md` (privacy table), `docs/INSTALL.md`, `docs/store/LISTING.md` (long description, permission list, the "unchanged" line) and `docs/store/REVIEWER-NOTES.md` drop "the default in Brave and Chrome" and say that acsearch is contacted only after the collector grants access with **Get prices**. `docs/MANUAL-TEST.md` step 10 gains the grant.
5. **Updating installs.** What Chrome does with a host that moves from required to optional on update — keep the grant the collector already had, or withhold it until asked again — must be checked on a real update from the previous release before it ships, and the release notes must say which. Either way nothing is lost: at worst an existing collector sees the **Get prices** hint once.

## What a collector would see

- **Install:** the browser's permission warning names `numismatics.org` and `nomisma.org` only.
- **First lookup:** the type card appears as today; the price panel shows the **Get prices** hint instead of a median, and nothing is sent to acsearch.
- **First Get prices:** the browser asks once for access to `www.acsearch.info`. After a yes, prices load, and every later lookup starts its price search automatically, as today. After a no, the panel says access was refused and the hint stays; nothing else changes.
- **Later:** the grant can be revoked in the browser's extension settings, which returns the popup to the hint.

## What it would gain in store review

- **A smaller install-time warning** in the Chrome Web Store and on addons.mozilla.org: one fewer site the extension "can read and change data on" from the start.
- **A credentialed request only behind a grant.** The acsearch search is sent with the collector's own session (`credentials: 'include'`). Reviewers look hard at an extension that does that to a third-party site from install; behind an explicit, revocable grant it matches the single purpose and the Limited Use statement plainly.
- **A simpler privacy answer.** "Nothing is sent to any research provider until you look something up, and nothing to acsearch until you allow it" replaces the Brave/Chrome default the policy and listing now have to disclose.
- **Consistency.** CoinArchives already works this way, so both price providers would ask before their first request.

## What it would cost

One extra click and one browser prompt before the first median, and a first lookup that shows a hint where it now shows prices. A collector who declines never gets acsearch prices until they select **Get prices** again.

## Decision needed

Whether to make `www.acsearch.info` optional in 0.34 or later, or to keep it required. If it is made optional, do items 1 to 5 above in one change, with the update behaviour of item 5 checked by hand.
