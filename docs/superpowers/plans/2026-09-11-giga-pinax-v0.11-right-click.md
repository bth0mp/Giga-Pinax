# Giga Pinax v0.11 Right-Click Lookup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Select a reference on any page (`RIC I² Nero 306`, `Crawford 44/5`, `SC 1266.2`, `Price 23`), right-click, choose **Look up “…” in Giga Pinax**, and see the type and its prices without typing. Approved by the user on 2026-09-11, including the new `contextMenus` permission and a background script.

**Design:** a background script registers one selection-only context-menu item. Clicking it opens `popup.html?q=<selection>` in a small popup window (`windows.create`, no permission needed). The popup reads `q`, puts it in the Reference box and submits, so the existing one-box parsing, lookup, suggestions, errors and one-click prices all apply unchanged. A window is used instead of the toolbar popup because passing text into `action.openPopup()` reliably across Brave and Firefox would need a third permission (`storage`) or gesture-fragile tricks.

## Global Constraints

- Permissions become exactly `["contextMenus"]`; `host_permissions` unchanged. No `storage`, `tabs`, `scripting`, `activeTab`, content scripts or optional permissions. The background script never reads pages; it only receives `info.selectionText` when the collector clicks the menu item.
- Brave manifest: `"background": { "service_worker": "background.js", "type": "module" }`. Firefox manifest: `"background": { "scripts": ["background.js"], "type": "module" }`. Firefox `data_collection_permissions.required` stays `["none"]`.
- Selection text is untrusted page content: whitespace-collapsed, trimmed, capped at 120 characters, passed only through `encodeURIComponent` into the URL and only through `.value` into the input.
- Nothing about lookups or prices changes; the auto-submitted form follows the same rules as a typed one (the permission request stays the first async call in the submit handler; acsearch is contacted only when access is already granted).
- Version `0.11.0` in manifests, package test and docs (digit-bounded stale check `(^|[^0-9.@])0\.10\.1`).
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output. Never write a literal control character into a file.

---

### Task 1: context menu, selection hand-off, 0.11.0

**Files:** create `extension/selection.js`, `extension/background.js`, `tests/selection.test.mjs`; modify `extension/popup.js`, `manifests/brave.json`, `manifests/firefox.json`, `scripts/build.py`, `tests/test_packages.py`, `README.md`, `docs/INSTALL.md`, `install/index.html`.

**`extension/selection.js`** (pure, testable in Node):

```js
export const MAX_SELECTION = 120;

export function selectionQuery(text) {
  return Array.from(String(text ?? '').replace(/\s+/g, ' ').trim()).slice(0, MAX_SELECTION).join('').trim();
}

export function popupUrlFor(text) {
  return `popup.html?q=${encodeURIComponent(selectionQuery(text))}`;
}

export function queryFromSearch(search) {
  return selectionQuery(new URLSearchParams(String(search ?? '')).get('q'));
}
```

**`extension/background.js`:**

```js
import { popupUrlFor, selectionQuery } from './selection.js';

const api = globalThis.browser ?? globalThis.chrome;
const MENU_ID = 'giga-pinax-lookup';

function createMenu() {
  Promise.resolve(api.contextMenus.removeAll()).then(() => {
    api.contextMenus.create({ id: MENU_ID, title: 'Look up “%s” in Giga Pinax', contexts: ['selection'] });
  });
}

api.runtime.onInstalled.addListener(createMenu);
api.runtime.onStartup.addListener(createMenu);

api.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!selectionQuery(info.selectionText)) return;
  api.windows.create({ url: api.runtime.getURL(popupUrlFor(info.selectionText)), type: 'popup', width: 440, height: 680 });
});
```

(Listeners are registered synchronously at top level, as both browsers require for non-persistent backgrounds.)

**`extension/popup.js`:** import `queryFromSearch`; at the end of start-up (after preferences are applied and `renderRecent()` has run), `const selected = queryFromSearch(location.search); if (selected) { $('quick-reference').value = selected; $('reference-form').requestSubmit(); }`. Nothing else changes.

**Manifests:** both gain `"permissions": ["contextMenus"]` and their `background` key as in the constraints; `version` `0.11.0`; all other keys unchanged.

**`scripts/build.py`:** `ASSET_PATHS` gains `"background.js"` and `"selection.js"`.

**`tests/test_packages.py`:** `ASSETS` gains both files; the forbidden-keys assertion drops `permissions` and `background` and keeps `optional_permissions`, `optional_host_permissions`, `content_scripts`; add assertions that `manifest["permissions"] == ["contextMenus"]` for both browsers, `brave["background"] == {"service_worker": "background.js", "type": "module"}` and `firefox["background"] == {"scripts": ["background.js"], "type": "module"}`; version assertion and ZIP name `0.11.0`.

**`tests/selection.test.mjs`:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SELECTION, selectionQuery, popupUrlFor, queryFromSearch } from '../extension/selection.js';

test('selectionQuery collapses whitespace, trims and caps at 120 characters without splitting a character', () => {
  assert.equal(selectionQuery('  RIC I²\n Nero\t306  '), 'RIC I² Nero 306');
  assert.equal(selectionQuery(''), '');
  assert.equal(selectionQuery(undefined), '');
  assert.equal(selectionQuery('x'.repeat(200)).length, MAX_SELECTION);
  assert.equal(MAX_SELECTION, 120);
  assert.equal(selectionQuery(`${'1'.repeat(119)}😀tail`), `${'1'.repeat(119)}😀`);
});

test('popupUrlFor encodes the cleaned selection into the popup query', () => {
  assert.equal(popupUrlFor(' Crawford 44/5 '), 'popup.html?q=Crawford%2044%2F5');
  assert.equal(popupUrlFor('<img src=x onerror=alert(1)>'), 'popup.html?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
});

test('queryFromSearch reads and cleans q, and is empty without it', () => {
  assert.equal(queryFromSearch('?q=SC%201266.2'), 'SC 1266.2');
  assert.equal(queryFromSearch(`?q=${encodeURIComponent('  Price   23 ')}`), 'Price 23');
  assert.equal(queryFromSearch(''), '');
  assert.equal(queryFromSearch('?other=1'), '');
});
```

**Docs:** README "What it does" gains `- Select a reference on any page, right-click and choose **Look up “…” in Giga Pinax** — it opens in a small window and looks the type and its prices up.` The README checks block adds `tests/selection.test.mjs` to the `node --test` line. INSTALL: every `0.10.1` → `0.11.0`; the intro states the extension now asks for one browser permission, `contextMenus`, to add that right-click item, and that selected text is sent only when you choose the item, only to numismatics.org (and acsearch for prices, as before); "What to try" gains `- Select **RIC I² Nero 306** on any web page, right-click and choose **Look up “RIC I² Nero 306” in Giga Pinax**.` Install page: version, one-line mention of the right-click item. Remove stale `dist/giga-pinax-*-0.10.1.zip`.

**Verify:** new tests fail first (missing module / manifest contract); then `node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs tests/selection.test.mjs` 61/61, Python OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors` (must accept the Firefox background and `contextMenus`), `node --check extension/popup.js`, `node --check extension/background.js`, the digit-bounded `0.10.1` grep prints nothing, and the control-character grep prints nothing. Confirm `dist/brave` and `dist/firefox` each contain `background.js` and `selection.js` and the right `background` key.

**Commit** the eleven files: `Add right-click lookup and release 0.11.0`.

## Verification (controller)

Result 2026-09-11 at `61933d5`, in-app Chromium in a 440×680 window (the size the context menu opens) on `http://localhost:8789` (never loaded before), live numismatics.org:

- No `q` → normal popup, Reference box empty, nothing looked up. Pass.
- `?q=RIC%20I%C2%B2%20Nero%20306` → with no click: box `RIC I² Nero 306`, fields RIC / `I (2nd edition)` / `Nero` / `306`, card `RIC I (second edition) Nero 306`, acsearch term `Nero 306`. Pass.
- `?q=Crawford%2044%2F5` → `RRC 44/5`, term `Crawford 44/5`, added to Recent. Pass.
- `?q=Sear%201234` → text kept in the box, the one-box error, box `aria-invalid="true"`, 0 numismatics.org requests. Pass.
- `?q=<b>x</b> <img src=x onerror=…>` (encoded) → literal text in the box, no `<b>` or extra `<img>` in the DOM, the `onerror` never ran. Pass.
- A 300-character `q` → box holds exactly 120 characters. Pass.
- Popup body 400 px inside the window. Console: only the expected CORS errors for the automatic acsearch fetch from a plain tab (the installed extension's host permission lifts CORS).
- `dist/brave/manifest.json`: version `0.11.0`, permissions `["contextMenus"]`, background service worker module, the three host permissions; `background.js` and `selection.js` present.

The context-menu item itself runs only in the installed extension — the user checks it in Brave.

In a never-cached served tab: `popup.html?q=RIC%20I%C2%B2%20Nero%20306` resolves `RIC I (second edition) Nero 306` without any click; `?q=Sear%201234` shows the one-box error with the text in the box and no numismatics.org request; a 300-character `q` arrives capped at 120; `?q=%3Cb%3Ex%3C%2Fb%3E` appears as literal text in the box; no `q` → normal popup. The context-menu item itself needs the installed extension — the user checks it in Brave.
