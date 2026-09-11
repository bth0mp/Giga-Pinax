# Giga Pinax

A toolbar extension for desktop Brave and Firefox that looks up ancient coin types by catalogue reference and shows what they have sold for. Version **0.7.0** resolves RIC references through [OCRE](https://numismatics.org/ocre/), Roman Republican (Crawford RRC) references through [CRRO](https://numismatics.org/crro/) and Price references through [PELLA](https://numismatics.org/pella/), open datasets from the American Numismatic Society published under the Open Database License, then fetches up to 100 of the most recent matching sales from acsearch using your own acsearch account and shows the median hammer price, the middle 50%, and the sales behind them.

acsearch has approved this workflow for the extension: each collector uses their own account, one search runs per click, one page of results is read, and nothing from acsearch is stored. Prices require an acsearch account that includes hammer prices (Premium); without one the extension says so and links to their sign-in page.

## Install

Run `python scripts/build.py` to create `dist/brave`, `dist/firefox` and the matching ZIPs, then follow [the installation guide](docs/INSTALL.md). The local `install/index.html` page provides downloads and step-by-step instructions when the project root is served with `python -m http.server 8765 --bind 127.0.0.1`.

## What it does

- One **Reference** box: type `RIC I² Nero 306`, `Crawford 44/5` or `Price 23` and the fields fill in.
- Guided entry for Price numbers, an RRC (Crawford) number, or RIC volume/edition, ruler section and number.
- Exact-title matching against the ANS search API; near matches are offered as a short list.
- Ruler, denomination, mint, material, date range, obverse and reverse legends and descriptions.
- When a type resolves (**Look up** or a "Did you mean" choice), acsearch prices are fetched in the same click once acsearch access is granted; edit the acsearch search term and select **Get prices** to re-run it (edited terms are remembered per type).
- A **Recent** row under the form re-opens your last six types with one click.
- Median hammer price, middle 50% with a range visual, date span, and an expandable list of the sales linking to acsearch.
- Currency USD, EUR, GBP or CHF is passed to acsearch; a price quoted in a different currency is left out rather than mixed in.
- Contacts only `numismatics.org`, `nomisma.org` and `www.acsearch.info` (the last with your own session). Your preferences stay in the browser; only the reference or term you look up is sent.

## Checks

```powershell
node --test tests/lookup.test.mjs tests/prices.test.mjs tests/preferences.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
npx --yes web-ext@10.6.0 lint --source-dir dist/firefox --warnings-as-errors
```

The runtime has no dependencies. Building uses Python's standard library. `web-ext` is used only for validation. Fixtures under `tests/fixtures/` are real API responses captured on 2026-09-10 and 2026-09-11, including a logged-out acsearch page trimmed to three lots.

## History

`prototype/` preserves the original layout preview. Design decisions are recorded in `docs/superpowers/specs/`.
