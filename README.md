# Giga Pinax

A toolbar extension for desktop Brave and Firefox that looks up ancient coin types by catalogue reference. Version **0.2.0** resolves RIC references through [OCRE](https://numismatics.org/ocre/) and Price references through [PELLA](https://numismatics.org/pella/), open datasets from the American Numismatic Society published under the Open Database License.

Auction prices are not connected. acsearch's terms do not permit automated retrieval, and a permission request describing this extension's one-lookup-per-collector workflow is pending. Each result links to the type page and to a manual acsearch search you run with your own account.

## Install

Run `python scripts/build.py` to create `dist/brave`, `dist/firefox` and the matching ZIPs, then follow [the installation guide](docs/INSTALL.md). The local `install/index.html` page provides downloads and step-by-step instructions when the project root is served with `python -m http.server 8765 --bind 127.0.0.1`.

## What it does

- Guided entry for Price numbers, or RIC volume/edition, ruler section and number.
- Exact-title matching against the ANS search API; near matches are offered as a short list.
- Ruler, denomination, mint, material, date range, obverse and reverse legends and descriptions.
- Remembers your last reference and currency choice locally. Currency affects nothing yet.
- Contacts only `numismatics.org` and `nomisma.org`. Nothing about you leaves the browser.

## Checks

```powershell
node --test tests/lookup.test.mjs tests/preferences.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors
```

The runtime has no dependencies. Building uses Python's standard library. `web-ext` is used only for validation. Fixtures under `tests/fixtures/` are real API responses captured on 2026-09-10.

## History

`prototype/` preserves the original layout preview, including the median-price design that returns once pricing is arranged. Design decisions are recorded in `docs/superpowers/specs/`.
