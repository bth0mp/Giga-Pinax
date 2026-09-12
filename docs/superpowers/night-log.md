# Night build log (2026-09-12)

The user asked for a 30-minute loop: "Constantly improve the tool. Look for all Ancient coin references and ensure they are included. Do audits, design ideas etc etc."

Each tick picks the next item, builds it test-first through a workflow, verifies it in the browser and commits it. Keep every release small, green and revertible.

## State

- **Shipped tonight:** 0.15 through 0.20 (RIC by number or ruler, prices-only Other references, pop-out window, price check, one lookup window, RPC links, period buttons with trend and last sale, whole lot text, Sear Greek, Krause KM#).
- **Now:** 0.21 — catalogue coverage for lot text.

## Why 0.21

A single reference typed in the box already works for any catalogue: unknown text becomes a prices-only Other card. Lot text is different — `findReferences` only starts a run at a **known** catalogue key, so a reference whose name is missing is never listed. The repo's own tests treat `Woytek 290b` and `RBW 1353` as unlisted, and both are everyday Roman citations.

## Queue (revisit each tick)

1. **0.21 catalogue coverage** — add the missing ancient-coin keys, with the ambiguous ones checked for false positives.
2. **Deferred review minors** — backlog item 7 still lists a dozen (announcement duplication, stale guided fields from an unparsable Recent chip, the label cache's inherited keys, `light-dark()` token duplication).
3. **Design ideas** — the user's open offers: the Giga Collection, a median from citing sales only, a "Titus as Caesar" label.
4. **Audits** — accessibility, the 400 px layout, and a ponytail pass for anything that can be deleted.

## Rules for the night

- Test-first, every release green: node tests, python tests, `node --check`, web-ext lint, a build, and the stale-version grep.
- Browser-check each release on a port that has never been loaded.
- Commit and push each finished release, and record its hash in the backlog, as with 0.15–0.20.
- Never query acsearch or CoinArchives from an agent; the controller may probe sparingly.

## Tick 1 (00:0x–01:0x) — 0.21 catalogue coverage

- **Audit:** `docs/superpowers/reference-coverage-audit.md` lists 130+ candidates with area, example citation and risk note. Confirmed misses included whole areas: `Hendin 1188; Meshorer 123; TJC 234` and `Sellwood 45.10; Shore 123` read nothing at all.
- **Built:** ~160 keys added to `lot.js` KEYS, grouped by area, all prices-only. Guards: `word()` (number straight after), `surname()` (the number is the whole reference), `plate()` (a plate numeral may intervene), `notHouse()` (Stephen Album, Rodolfo Ratto).
- **Review:** 17 findings confirmed and fixed, including seven keys whose `\.` had become a wildcard and a bare `Albert` that read world-coin headings as references.
- **Recheck:** 164/164 tests, but four findings left — two high (unguarded surnames; `Sear GCV` losing its Sear Greek normalisation), one medium (`runOn` comparing against a dropped key), one low (`Y#` unnormalised). An agent is fixing all four test-first.
- **Next:** browser-check on port 8807, then commit and push as 0.21.0.

## Queue after 0.21 (from `docs/superpowers/night-audit.md`)

1. "Listed under Vespasian" section-mismatch label — high value, small effort.
2. Median from citing sales only — high value; the audit says it is cheaper than it looks.
3. Surface the provenance the lot reader already finds and throws away.
4. Show the coin and its thumbnail in the sales list.
5. Flag outliers in the median (1.5×IQR, the quartiles are already computed).
6. Remember the last price check per Recent chip.
