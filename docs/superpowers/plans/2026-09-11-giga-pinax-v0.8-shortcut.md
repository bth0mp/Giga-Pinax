# Giga Pinax v0.8 Keyboard Shortcut

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. One task.

**Goal:** Open the popup from the keyboard with **Alt+Shift+G**, and fold in two small v0.7 review minors (refocus the chip the user was on; drop whitespace-only Recent entries).

**Why this is small:** Manifest V3's reserved `_execute_action` command opens the extension's action popup on both Chromium and Firefox with no permission and no code. A suggested key that clashes with the browser or another extension is simply not bound; the collector can set one at `brave://extensions/shortcuts` or in Firefox's Manage Extension Shortcuts.

## Global Constraints

- The only manifest change is a `commands` key exactly as below; no permissions, background, content scripts or other keys.
- Recent entries still store only `{ id, corpus, label }`; nothing acsearch-related changes; `textContent`/`title`/`dataset`/`value` only.
- Version `0.8.0` in manifests, package test and docs. The stale-version check must use a digit-bounded pattern so `web-ext@10.6.0` (the lint tool) does not match.
- Commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Working directory `Z:\Ancient Coin Browser extension`; Git Bash; quote paths. Run every verify command on its own and check its exit status; never pipe test output.

---

### Task 1: `_execute_action` shortcut, two Recent minors, 0.8.0

**Files:** `manifests/brave.json`, `manifests/firefox.json`, `tests/test_packages.py`, `extension/preferences.js`, `tests/preferences.test.mjs`, `extension/popup.js`, `README.md`, `docs/INSTALL.md`, `install/index.html`.

**Behaviour**

1. Both manifests gain, after `action`:
   ```json
   "commands": {
     "_execute_action": {
       "suggested_key": { "default": "Alt+Shift+G" },
       "description": "Open Giga Pinax"
     }
   },
   ```
   and `"version": "0.8.0"`.
2. `tests/test_packages.py`: in the manifest test, assert `manifest["commands"] == {"_execute_action": {"suggested_key": {"default": "Alt+Shift+G"}, "description": "Open Giga Pinax"}}` for both browsers; version assertion and ZIP name → `0.8.0`. The existing forbidden-keys assertion stays as is.
3. `extension/preferences.js`: `restorePreferences` drops Recent entries whose `id` or `label` is empty after `trim()` (the stored strings themselves are not trimmed).
4. `extension/popup.js` `renderRecent()`: give each chip button `dataset.key = \`${corpus}:${id}\``; before rebuilding, if focus is inside `#recent-list`, remember the focused chip's key; after rebuilding, focus the chip with that key if it still exists, else the first chip.
5. Docs: README "What it does" gains `- **Alt+Shift+G** opens the popup (change it at \`brave://extensions/shortcuts\` or in Firefox's Manage Extension Shortcuts).`; INSTALL "What to try" gains `- Press **Alt+Shift+G** to open Giga Pinax without the mouse. If nothing happens, the key is taken — set another at \`brave://extensions/shortcuts\` or in Firefox under Add-ons › ⚙ › Manage Extension Shortcuts.`; every `0.7.0` in README/INSTALL/install page → `0.8.0`. Remove stale `dist/giga-pinax-*-0.7.0.zip`.

**Tests — append to `tests/preferences.test.mjs`:**

```js
test('Recent entries with a blank id or label are dropped on restore', () => {
  const recent = [{ id: '  ', corpus: 'pella', label: 'Blank id' }, { id: 'price.1', corpus: 'pella', label: '   ' }, { id: 'price.23', corpus: 'pella', label: 'Price 23' }];
  assert.deepEqual(restorePreferences(JSON.stringify({ recent })).recent, [{ id: 'price.23', corpus: 'pella', label: 'Price 23' }]);
});
```

**Verify:** the new Python assertion and the new Node test fail first; then Node suites 45/45, Python OK, `python scripts/build.py`, `npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors` (must accept `commands`), `node --check extension/popup.js`, and `git grep -nE "(^|[^0-9.@])0\.7\.0" -- README.md docs/INSTALL.md install/index.html manifests tests/test_packages.py` prints nothing.

**Commit** the nine files: `Open the popup with Alt+Shift+G and release 0.8.0`.

## Verification (controller)

Result 2026-09-11 at `8e12caf`, in-app Chromium at 400×600 on `http://localhost:8784` (never loaded before), numismatics.org live, acsearch stubbed: `dist/brave/manifest.json` and `dist/firefox/manifest.json` both carry `commands._execute_action` with `suggested_key.default` `Alt+Shift+G` and description `Open Giga Pinax`, version `0.8.0`, no `permissions` key; web-ext lint accepted it (implementer run). Five seeded Recent entries including one blank id and one blank label → three chips, keys `crro:rrc-44.5`, `ocre:ric.1(2).ner.306`, `pella:price.3`. Focus on the third chip (`Price 3`) while an unrelated Look up (`Price 23`) resolved and rebuilt the chips → focus returned to `Price 3` (same key). Clicking the `RRC 44/5` chip → it moved first and kept focus. Focus in the Reference box during a lookup stayed there. 400 px; console clean. Pass. The Alt+Shift+G key itself needs an installed extension — listed for the user.

`dist/firefox/manifest.json` and `dist/brave/manifest.json` carry the `commands` key; web-ext lint clean. In a never-cached served tab with three Recent chips: focus the third chip, start an unrelated Look up from the Reference box while that chip keeps focus programmatically, and confirm focus returns to that same chip after the chips rebuild; clicking a chip still focuses it (now first). The shortcut itself can only be exercised in an installed extension — listed for the user.
