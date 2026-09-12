# Night build log (2026-09-12)

The user asked for a 30-minute loop: "Constantly improve the tool. Look for all Ancient coin references and ensure they are included. Do audits, design ideas etc etc."

Each tick picks the next item, builds it test-first through a workflow, verifies it in the browser and commits it. Keep every release small, green and revertible.

## State

- **Shipped tonight:** 0.15 through 0.21 (RIC by number or ruler, prices-only Other references, pop-out window, price check, one lookup window, RPC links, period buttons with trend and last sale, whole lot text, Sear Greek, Krause KM#, every ancient catalogue in lot text).
- **Now:** 0.22 — the two search guards carried over from 0.21's recheck.

## Why 0.21

A single reference typed in the box already works for any catalogue: unknown text becomes a prices-only Other card. Lot text is different — `findReferences` only starts a run at a **known** catalogue key, so a reference whose name is missing is never listed. The repo's own tests treat `Woytek 290b` and `RBW 1353` as unlisted, and both are everyday Roman citations.

## Queue (revisit each tick)

1. **0.21 catalogue coverage** — add the missing ancient-coin keys, with the ambiguous ones checked for false positives.
2. **Deferred review minors** — backlog item 7 still lists a dozen (announcement duplication, stale guided fields from an unparsable Recent chip, the label cache's inherited keys, `light-dark()` token duplication).
3. **Design ideas** — the user's open offers: the Giga Collection, a median from citing sales only, a "Titus as Caesar" label.
4. **Audits** — accessibility, the 400 px layout, and a ponytail pass for anything that can be deleted.

## Rules for the night

- Test-first, every release green: node tests, python tests, `node --check`, web-ext lint, a build, and the stale-version grep.
- Browser-check each release on a port that has never been loaded, and **stub `window.fetch` before the first probe**: the popup auto-fetches prices when access looks granted, so an unstubbed probe run fires a real acsearch request per lookup. (Learned the hard way in tick 2 — five went out, CORS-blocked, before I noticed.)
- Commit and push each finished release, and record its hash in the backlog, as with 0.15–0.20.
- Never query acsearch or CoinArchives from an agent; the controller may probe sparingly.

## Tick 1 (00:0x–01:0x) — 0.21 catalogue coverage

- **Audit:** `docs/superpowers/reference-coverage-audit.md` lists 130+ candidates with area, example citation and risk note. Confirmed misses included whole areas: `Hendin 1188; Meshorer 123; TJC 234` and `Sellwood 45.10; Shore 123` read nothing at all.
- **Built:** ~160 keys added to `lot.js` KEYS, grouped by area, all prices-only. Guards: `word()` (number straight after), `surname()` (the number is the whole reference), `plate()` (a plate numeral may intervene), `notHouse()` (Stephen Album, Rodolfo Ratto).
- **Review:** 17 findings confirmed and fixed, including seven keys whose `\.` had become a wildcard and a bare `Albert` that read world-coin headings as references.
- **Recheck:** 164/164 tests, but four findings left — two high (unguarded surnames; `Sear GCV` losing its Sear Greek normalisation), one medium (`runOn` comparing against a dropped key), one low (`Y#` unnormalised). An agent is fixing all four test-first.
- **Browser check (port 8807):** Judaean (`Hendin 1188`, `TJC 48`, `AJC II 233`), Parthian (`Sellwood 24.2`, `Shore 74`, `Sunrise 304`), Republic (`Crawford 344/1a` opening RRC 344/1a, plus `Sydenham 698`, `BMCRR Rome 2320`, `RBW 1353`), Alexandrian, `LRBC 1215`, `Sear GCV 2757`; prose listed nothing, single references unchanged, body 400 px, console clean.
- **Shipped:** 170/170 tests, lint 0/0/0, `1f0eb83` + backlog `b229224`, pushed `b4c0444..b229224`.
- **Carried over:** `Y#` still searches acsearch category 1 and links CoinArchives `/a/`; an Other reference with no catalogue key still becomes a prices-only search for a whole sentence.

## Tick 2 (01:0x–) — 0.22 search guards

Both carried-over gaps, since each sends the collector to a search that cannot match:

1. **`Y#` is Krause too.** 0.21 normalises it; `prices.js` never learned it. Four places (`KM_PART`, `kmPart`, `otherTerm`, `coinArchivesTerm`) must accept `Y` beside `KM`, so a `Y# 31` searches Modern and links `/w/`.
2. **A sentence is not a reference.** Any text with a letter and a digit that no catalogue reads becomes an exact-phrase acsearch search, so a pasted grade-and-provenance line returns a median of unrelated lots. Rule: each `;` part must be at most seven words; when none qualifies, show the usual "couldn't read that reference" instead of a card.

Workflow `giga-pinax-v0-22-search-guards`: implement, two review lenses (guards, regressions and release hygiene), adversarial verify, fix, recheck.

## Queue after 0.22 — reading fixes first

Round 2 of the coverage audit (`docs/superpowers/reference-coverage-audit-2.md`, 315 real lot lines through the real reader) says the next release should not add keys at all. Three reading faults beat every new catalogue:

- **A year is read as a type number.** `Butcher 2004 notes…` is guarded, but `Butcher 2004. Prieur 123.` is not — 20 reproduced. Three are worse than junk because the key is a typed catalogue: `Crawford 1974`, `Bopearachchi 1991` and above all **`Price 1991`**, where 1991 is a real Price number, so the collector gets a confident, wrong Alexander card.
- **Provenance before the references deletes them.** The `Ex …` cut runs to the end of the text, so `Ex Leu 4, 25 May 1972, lot 123. RIC 972; Cohen 17.` lists **nothing at all**.
- **16 citation forms are refused although the key is already there** — including `Dattari-Savio Pl. 123, 456`, the worked example in `lot.js`'s own comment. One short word between the key and the number would fix most of them.

Then: `Price realized 1,200 CHF`, `Aureo & Calicó 300, lot 45` → `Calico 300`, `Freeman & Sear 15` → `Sear 15`, `Album 46, lot 1234`, and a Sear certificate number all produce rows today. Only after those, the 102 unread catalogue names and the `Koln`/`Bohringer` de-accented spellings.

## Queue after that (from `docs/superpowers/night-audit.md`)

1. "Listed under Vespasian" section-mismatch label — **planned**: `docs/superpowers/plans/2026-09-12-giga-pinax-v0.23-listed-under-label.md`. The probes settled it: `nmo:hasPortrait` is already on the obverse node of the record the extension fetches, so this is rendering, not data. Guard rails the plan fixed: read the obverse only (the reverse portrait is a deity), keep `portrait_facet` for searching but never for the label (it matches a reverse portrait too), and print a name only when RIC itself has a section under it.
2. Median from citing sales only — high value; the audit says it is cheaper than it looks.
3. Surface the provenance the lot reader already finds and throws away.
4. Show the coin and its thumbnail in the sales list.
5. Flag outliers in the median (1.5×IQR, the quartiles are already computed).
6. Remember the last price check per Recent chip.
