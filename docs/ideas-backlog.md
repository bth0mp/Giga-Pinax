# Giga Pinax ideas backlog

Worked through by the 30-minute improvement loop. Top of each list goes first. An item moves to "Done" with its commit when it ships.

## In flight

- v0.3 acsearch prices: `docs/superpowers/plans/2026-09-10-giga-pinax-v0.3-prices.md`.

## Streamlining the extension

1. **One-box reference entry.** Accept `RIC I² Nero 306`, `RIC 1(2) Nero 306`, `Price 23` in a single field and fill the guided fields from it. Fewer fields, faster lookups; guided fields stay for when parsing fails.
2. **Get prices in the same click.** After acsearch permission is granted, Look up runs the type lookup and then the price fetch for that one reference. Still one acsearch request per user click.
3. **Recent lookups.** Last 10 resolved types as one-click chips under the form, stored locally.
4. **Keyboard shortcut** to open the popup (`commands` in the manifest, e.g. Alt+Shift+G).
5. **Copy summary** button: `RIC I² Nero 306 · median $180 (9 sales, 2019–2026)` to the clipboard.
6. **Right-click lookup.** Select "RIC 306" or "Price 23" on any auction page → Giga Pinax opens on it. Needs `contextMenus` and a background worker; weigh the extra permission.
7. **Deferred review minors:** candidate list accessible name; `aria-invalid` only for not-found; drop dead `.try-it a` rules; read the label cache once per popup; `resolveLabels` option defaults.
8. **Firefox permanent install** via Mozilla's unlisted (self-distributed) signing.
9. **Giga-branded icon** set.

## Other projects to plug in

ANS runs several type corpora on the same Numishare software as OCRE and PELLA, with the same Atom search and JSON-LD records, so each is mostly a catalogue option plus a URL:

1. **CRRO** (Coinage of the Roman Republic Online) — Crawford RRC references. Biggest gap for Roman collectors. *Probed 2026-09-10:* `numismatics.org/crro/apis/search?q=RRC 44/5` returns title `RRC 44/5`, id `rrc-44.5`, CORS open — exact-title matching works as-is, so this is a third catalogue option plus a query rule (`RRC {number}`).
2. **SCO / Seleucid Coins Online** and **PCO / Ptolemaic Coins Online**. *Probed:* both CORS open, but titles differ from the collector's shorthand — SCO `Seleucid Coins (part 1) 1266.2` (id `sc.1.1266.2`), PCO indexes CPE not Svoronos (`Coins of the Ptolemaic Empire Vol. I, Part II, no. B549`, id `cpe.1_2.B549`). Needs a per-corpus title builder, and PCO needs a Svoronos→CPE story before it helps.
3. **HRC** (Hellenistic Royal Coinages) and **Coins of the Roman Empire** extensions as coverage grows.
4. **RPC Online** (Oxford, Roman Provincial Coinage) — provincial references; separate site and API, check its terms.
5. **Specimen thumbnails** from OCRE/PELLA example coins (IIIF images from ANS, BM, BnF) in the type card.
6. **Numista** — has an official API with a key; natural backbone for the **Giga Collection** tracker (your coins, purchase price vs current median, CSV export).
7. **Upcoming-sale alerts** (NumisBids, Sixbid, Biddr, CoinArchives) — "this type is in an auction next week". Each needs its own permission check before any fetch.

## Done

- v0.2 open-data type lookup (`fbb6ab8`).
