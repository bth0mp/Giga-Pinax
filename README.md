# Ancient Coin Lookup

An ancient-coin reference extension for desktop Brave and Firefox. Version **0.1.1** is an installable **sample-data test build** of the approved layout. It fixes the toolbar popup collapsing into a narrow strip.

## Install the test build

Run `python scripts/build.py` to create `dist/brave`, `dist/firefox`, and the two corresponding ZIP files. Follow [the installation guide](docs/INSTALL.md) for Brave's unpacked install or Firefox's temporary install. The Firefox ZIP is unsigned and is removed on browser restart.

The local `install/index.html` page provides downloads and step-by-step instructions when served from the project root. No web server is needed once an extension is installed.

## Original layout preview

Open `prototype/index.html` directly in a browser, or serve the project with:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Then visit `http://127.0.0.1:8765/prototype/`.

Use the controls beside the popup to switch between first use and lookup, or system/light/dark appearance. Try the Price/RIC selector, currency selector and expandable sample sales.

## Scope

All sales and prices are fictional. Supported preview references are Price 23 and RIC I (2nd edition), Nero 306. Currency switching demonstrates formatting, not conversion. Signing in opens acsearch's official page; the preview does not handle credentials or verify account access.

The `prototype/` folder preserves the original design preview. The installable `extension/` code remembers sample-mode entry, currency and reference fields locally. Live acsearch retrieval, account integration, Mozilla signing and extension-store publication remain future work. No acsearch content is scraped or bundled.

Design decisions are recorded in `docs/superpowers/specs/2026-09-10-popup-design.md`.

## Checks

```powershell
node --test tests/sample-data.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors
```

The runtime has no dependencies. Building uses Python's standard library. The optional `scripts/render-icons.ps1` regenerates the included toolbar PNGs on Windows. Mozilla's `web-ext` tool is used only for validation.
