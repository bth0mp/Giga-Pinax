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

## Tick 3 (02:0x-) — 0.23 reading fixes

Shipped `65802a9`. The audit's own advice was overruled on one point: it asked for any 1500-2100 number after a key to be refused as a year, which would
have thrown away real coins (Price runs past 3900; Sear, Hendin, Svoronos and SNG Copenhagen all have numbers in that range). Evidence decides instead,
and with none the reference is kept — a stray prices-only row costs the collector less than a lost reference.

The review round earned its keep: 15 confirmed findings, most of them regressions the implementer's own tests missed, and the recheck found five more.
The high one was mine to fix — the name guard lived inside a case-insensitive pattern, so `17.21 g, 8 h. Sear 2537` read the die axis as a forename's
initial and dropped Sear. Fixed by reading both name guards case-sensitively outside the key pattern, where a capital really is a capital.

**Next:** 0.24, the "listed under Vespasian" label (plan already written), then the 102 unread catalogue names from the round-2 audit.

## Queue after 0.24 — the design audit's own top five

`docs/superpowers/design-audit-2026-09-12.md`, measured against popup.css rather than guessed:

1. **The answer arrives off screen.** Header 57 px + form 250 px (316 with the RIC fields) + a full Recent row 210 px is about 460 px of a ~503 px scroll area, so the card lands in the last 43 px and the median sits ~120 px below that. `run()` never scrolls. The commonest outcome of pressing Look up is a screen that looks unchanged. One line.
2. **Look up is not beside the box he types in.** It sits two fields lower, next to a number the tool pre-filled itself, and an empty top box still runs a lookup — of a coin nobody asked for.
3. **Two paths disagree about one coin.** Typed `Titus 972` says it cannot be found; the same reference inside pasted lot text opens Vespasian 972. 0.24 explains the card once he reaches it, but does not get him there from the typed path — retry without the ruler, and let 0.24's line say what happened.
4. **Two field changes are explained only to screen readers** (`Volume set to ...`, `Ruler cleared: ...`). The strings exist; showing them is an hour.
5. **Focus and contrast:** the Recent chips he is meant to click have a 1.28:1 border, a clicked candidate row drops focus to `<body>`, and `#check-result` is both a live region and an `aria-describedby` target, so it speaks three times while he types an amount.

Also proposed: invert the prices panel so the price check and its verdict come first; fold trend, last sale and the fee note into one "More about these sales" (and note that trend and last sale ignore the chosen period). Deletions to consider, the theme toggle among them — that one is his taste, so ask before touching it.

## Tick 4 (03:0x-) — 0.24 the listed-under line

Shipped `4c9ced6`. The live probes across two dozen records are what made it safe to print a person's name beside a coin: the reverse portrait is a
deity (Annona on Vespasian 972 itself), `portrait_facet` matches a reverse portrait so it can never build the label, and obverse portraits are often not
people at all. Two gates keep a wrong name off the card, and both are deliberate under-claims.

The review's one surviving finding was mine to decide: the sibling sentence was ungated, so it would have spoken on every ordinary card in a split
volume - RIC V's Gallienus types alone are over four thousand. It now speaks only after the portrait sentence, where it answers the collector's next
question instead of interrupting a card he was happy with.

Carried: the extra nomisma label request is still spent on RIC VI-IX lookups where the section gate will discard it. Parallel, cached, same deadline, so
it costs no serial time; worth skipping if the request budget ever matters.

**Next:** 0.25 from the design audit - the card arriving off screen is the biggest thing left in the tool.

## 0.26 planned — and the list is much shorter than the audit's 102

`docs/superpowers/plans/2026-09-13-giga-pinax-v0.26-missing-catalogues.md`. **26 names are worth adding, not 102**, and the reason is not risk per key:

- **The rows would search the wrong place.** `searchCategory` sends a row to acsearch's Modern category only when every part is Krause, so `SCBC 1490`, `Duplessy 213`, `Hartill 22.1279`, `JNDA 01-23`, `Huszar 123` and `D&H 45` would all be searched in **Ancient coins**, where they cannot exist. That drops the whole medieval / East-Asian / Ottoman / token block however safely it reads. **Worth its own change: teach `searchCategory` the non-ancient catalogues, not just Krause.**
- **The Reference box already reads them.** Typing `Klat 686` works today with no key at all — `KEYS` only affects pasted lot text, so these names buy convenience, not capability.
- **Four of the 102 already read** (`Noe`, `Koln`, `Bohringer`, and `Meshorer & Qedar`, which 0.23's co-author infix handles), and 0.23 closed 12 of the audit's 16 "right key, wrong form" misses. The audit's own priority list is two-thirds done.

Two candidates died on contact with the real code: `Albert` breaks the repo's own 0.23 test (`SAXONY. Albert 1485-1500` becomes a row), and `Cribb` steals `Jongeward & Cribb 123` unless it carries the co-author guard. `Callataÿ` reads the wrong number from its real citation form. All reproduced, none argued.

About 10 lines in `lot.js` and 70 in tests.

## Tick 5 (05:0x-) — 0.25 the first ten seconds

Shipped `6892e4a`. Two things worth remembering from this one.

**The audit was wrong about its own headline case.** It reported that typed `Titus 972` errors while the lot path finds Vespasian 972. Run live against
OCRE at both 0.24 and 0.25, a typed `Titus 972` already offers Vespasian 972 as a one-row choice. The retry still earns its place for a real miss, and
it never opens another ruler's coin unless 0.24's line explains it and the portrait is the ruler that was typed - but the docs now say what happens,
not what the audit assumed. Run the premise, not just the fix.

**The verification pane never paints, so it cannot see a smooth scroll.** `requestAnimationFrame` never fires there and `scrollIntoView({behavior:
'smooth'})` moves nothing, while `'auto'` works. The reveal is now scheduled on timers rather than animation frames - which is right anyway, since a
popup that is not being painted should still put the answer where he will see it - and the browser check forces `'auto'` to measure the result. Before:
the card's top sat 455 px into a 498 px panel. After: the panel scrolls to it and the heading is in view.

**Next:** 0.26, and the separator shapes (`Pieper-2753`, `Deyell # 8a`) lead it, ahead of the 26 keys.

## 0.27 queued — the price audit answers his "300 when a coin clearly shows 950"

`docs/superpowers/price-audit-2026-09-13.md`, and **the complaint needs no bug to explain it**. A page built with nothing but the correct coin, every
lot genuine, grades in the proportions the type really appears in, run through the repo's own `summarise()`: **median $239 against a $950 asking price,
labelled "Solid"**. The median of the EF sales alone was $1,450. The median is a *type* median across every grade; he is looking at one *coin* in one
grade. Both numbers are right, and the tool never says which it is showing. Grade mix fires on every search there is.

Ordered by what protects him from a bad bid:

1. **Say what the median is** — one permanent sentence under it. A text change, and the most valuable thing in the file.
2. **The total is already in the page and thrown away.** The fixture's own header reads `Results 1-100 of 623 for nero 306`; the card says "Out of 100+ matches".
3. **A gated lot is reported as unsold.** The page marks `Log in` and `Premium` lots, and `summarise` only treats `*` as signed-out.
4. **The strength indicator counts sales and measures nothing else**, so his own example holds: 40 sales spread tenfold read "Solid" (真 band ±59%), 8 tight sales read "Moderate" (±7%). Replace with a confidence band from order statistics; below six counted sales no 95% band exists at all - arithmetic, not taste.
5. **The trend cries wolf.** Monte Carlo on a flat market: it announces a move **95% of the time**, claims 20% or more **80% of the time**, and once claimed up 668%. Raising the threshold does not fix it. Gating on non-overlapping medians gives 0% false alarms and still catches a real move.
6. **The trend ignores the chosen period** - always a two-year comparison, which is how "No sales in the last 2 years" ends up beside "Last sale 12.03.2019".
7. **The range bar is linear on prices that are log-distributed**, so half the sales squash into the left 8% and any realistic price he types flies far right and looks extravagant. `Math.log` inside `rangePercent` is the whole fix.
8. **`saleDate` rejects `1.7.2026` and `2026/07/01`**, so a period button can silently drop *recent* sales and move the median 80%.
9. **Outliers: compute, never apply.** 1.5x IQR flags ten genuine high-grade sales and drags the median down - it would make his complaint worse - and catches none of the wrong coins or forgeries on a poisoned page.

Unverifiable tonight and worth watching on his first real run: no signed-in acsearch page has ever been seen by this code. The `Not counted:` line is the thing to read first.

*Housekeeping: `2b3e7f2` swept the in-flight 0.26 edits to `docs/INSTALL.md` and `docs/ideas-backlog.md` into the audit commit, so that one commit
advertises 0.26 while the manifests still read 0.25. The working tree was untouched and the release commit that follows makes it consistent. Stage
explicit paths, not `-A -- docs`, while a build is running.*

## Tick 6 (06:0x-) — 0.26 separator shapes and 26 catalogues

Shipped `e09513c`. This workflow's own review/verify/fix/recheck chain hit the weekly Opus usage limit partway through (the user switched the session to
Sonnet 5 to keep going). Implementation and two of the three review lenses had already completed; I finished the job myself directly rather than
re-spawning agents: read every finding out of the workflow's journal (including the separators lens, whose own verify step never ran and so was silently
dropped by the script's `filter(Boolean)` - worth remembering for the next script), applied the six confirmed fixes test-first, and ran the full release
check battery and a browser check myself.

The best find of the six: a long non-digit run straight after a key (a rule of dots, a run-together identifier) backtracked in `BODY` at up to O(n^4) -
2,900 dots hung the single-threaded popup for what would have been several minutes (I killed a 120s-timeout test run rather than wait for the real one
to finish). Pre-existing since long before tonight, surfaced only because this review timed the reader. Fixed to milliseconds with no test regression:
each token after the first must now cost a space, which makes the split unambiguous.

Also fixed: "Agrippina Senior, 37-41" and "Newell. 1938" no longer read as citations of their own (the separator work was reading the reader's own
sentence boundary as a house's separator); "Price:1,200" stays untyped so it can never open a wrong PELLA coin for a hammer amount; two countermark
corpora no longer swallow the host coin's ruler; a co-author's hyphen can no longer steal Jongeward's reference for Cribb alone; Prieto y Vives is
attributed to its own book instead of Vives y Escudero's at the same number.

Noted for later, not fixed tonight (both queued in the 0.26 backlog entry): the accepted stray-publication-year leak is now three separator spellings
wide across 23 more author names, which is one more reason `OVER_RANGE` narrowing is worth doing next; and an `Other` row's acsearch phrase keeps the
dealer's separator verbatim, so the same coin cited with a hyphen and with a space searches two different exact phrases.

Also noticed in the browser check, unrelated to any 0.26 change and confirmed byte-identical back to 0.25: a short lot line naming only one catalogue
key ("KUSHAN. Vima Kadphises. AV Dinar. Jongeward-Cribb 123.") does not go down the lot-list path at all - `isLot` needs 2+ keys or 120+ characters -
and instead searches acsearch for the WHOLE sentence as one Other reference. Not a regression, but a design gap worth a future tick: a single short
reference embedded in a one-line heading probably wants the same "list one row" treatment full lot text gets.

**Next:** 0.27, the price-honesty pass (see the price audit above).
