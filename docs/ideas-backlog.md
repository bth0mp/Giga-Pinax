# Giga Pinax ideas backlog

Worked through by the 30-minute improvement loop. Top of each list goes first. An item moves to "Done" with its commit when it ships.

## In flight

- v0.10 Seleucid Coins (SC) via ANS SCO, plus two v0.9 quoting minors: `docs/superpowers/plans/2026-09-11-giga-pinax-v0.10-sco.md`. Streamlining item 6 (right-click lookup) still waits for the user's permission decision.

## Streamlining the extension

0. ~~**RRC follow-ups from the v0.4 review.**~~ Shipped in v0.4.1 (quoted-first search instead of id guessing). Its review's two remaining minors (RIC fields quote strip; CRRO plain-fallback exact-match test) shipped in v0.5 (`948f2d0`). Original note: (a) `RRC 1/1` is falsely "not found": CRRO's search ranks it past the first 100 of 656 hits, but `crro/id/rrc-1.1.jsonld` exists — on a search miss, try the id built from the number (`rrc-{group}.{n}`, case-sensitive, only for `^\d+(-\d+[A-Z])?\/\d+[a-z]?$`) inside the same deadline; one extra numismatics.org request, never acsearch. (b) Strip a typed `RRC` / `Crawford` / `Cr.` prefix in `buildQuery` and `defaultTerm` (today `RRC 44/5` in the field becomes `RRC RRC 44/5` and the term `Crawford RRC 44/5`). (c) Only offer "Did you mean" candidates whose title starts with the typed group (`RRC 44/`), since CRRO also matches dates. (d) Export the default-number table from `preferences.js` instead of repeating it in `popup.js`.
1. ~~**One-box reference entry.**~~ Shipped in v0.5 (see Done). Original note: Accept `RIC I² Nero 306`, `RIC 1(2) Nero 306`, `Price 23` in a single field and fill the guided fields from it. Fewer fields, faster lookups; guided fields stay for when parsing fails.
2. ~~**Get prices in the same click.**~~ Shipped in v0.6 (see Done). Original note: After acsearch permission is granted, Look up runs the type lookup and then the price fetch for that one reference. Still one acsearch request per user click.
3. ~~**Recent lookups.**~~ Shipped in v0.7 (see Done). Original note: Last 10 resolved types as one-click chips under the form, stored locally.
4. ~~**Keyboard shortcut**~~ Shipped in v0.8 (see Done). Original note: to open the popup (`commands` in the manifest, e.g. Alt+Shift+G).
5. ~~**Copy summary**~~ Shipped in v0.9 (see Done). Original note: `RIC I² Nero 306 · median $180 (9 sales, 2019–2026)` to the clipboard.
6. **Right-click lookup.** Select "RIC 306" or "Price 23" on any auction page → Giga Pinax opens on it. Needs `contextMenus` and a background worker; weigh the extra permission.
7. **Deferred review minors:** from the v0.9 review — cap each quoted raw price (e.g. 40 characters plus `…`) so a malformed page can't flood the note or the copy; squash U+0085 and other control characters in quoted prices too (`/[\s\p{Cc}]+/gu`); give sighted users visible feedback on Copy summary (briefly relabel the button `Copied`); README should say the copy also includes the years and any uncounted prices, and INSTALL's "under the median" is really "at the bottom of the prices panel"; store the card in the copy state so it can't pair with a later `currentCard`. From the v0.7 fix review — on the no-access path "Found X." can be announced twice. From the v0.7 review — a Recent chip whose label doesn't parse (e.g. an OCRE card whose label fell back to its id) leaves the guided fields stale, so the automatic acsearch term comes from the previous reference; with host access revoked in Firefox a chip lookup shows the network message instead of the permission message. (Refocusing the same chip and dropping blank entries shipped in v0.8.) (The v0.6 review's three minors shipped in v0.7.) Older: candidate list accessible name; `aria-invalid` only for not-found; drop dead `.try-it a` rules; read the label cache once per popup; `resolveLabels` option defaults.
8. **Firefox permanent install** via Mozilla's unlisted (self-distributed) signing.
9. **Giga-branded icon** set.

## Other projects to plug in

ANS runs several type corpora on the same Numishare software as OCRE and PELLA, with the same Atom search and JSON-LD records, so each is mostly a catalogue option plus a URL:

1. ~~**CRRO**~~ — shipped in v0.4 (see Done). Crawford RRC references. *Probed 2026-09-10:* `numismatics.org/crro/apis/search?q=RRC 44/5` returns title `RRC 44/5`, id `rrc-44.5`, CORS open — exact-title matching works as-is, so this is a third catalogue option plus a query rule (`RRC {number}`).
2. **SCO / Seleucid Coins Online** and **PCO / Ptolemaic Coins Online**. *Probed:* both CORS open, but titles differ from the collector's shorthand — SCO `Seleucid Coins (part 1) 1266.2` (id `sc.1.1266.2`), PCO indexes CPE not Svoronos (`Coins of the Ptolemaic Empire Vol. I, Part II, no. B549`, id `cpe.1_2.B549`). Needs a per-corpus title builder, and PCO needs a Svoronos→CPE story before it helps. *SCO update 2026-09-11:* every record lives at `sco/id/sc.1.{number}` whatever the part (`sc.1.1266.2`, `sc.1.1630.2b`, `sc.1.1`, `sc.1.1439`, `sc.1.1440` all 200), so an `SC {number}` catalogue can fetch the record directly with `lookupById('sco', 'sc.1.' + number)` — no part mapping; the quoted title only matches with the exact `(part N)`, and the plain search `SC 1266.2` already ranks the right type first as a fallback.
3. **HRC** (Hellenistic Royal Coinages) and **Coins of the Roman Empire** extensions as coverage grows.
4. **RPC Online** (Oxford, Roman Provincial Coinage) — provincial references; separate site and API, check its terms. *Probed 2026-09-11:* every URL, including the home page, answers `403 Forbidden` to a plain scripted request — bot protection, not a public API. Don't work around it; ask the RPC team about an approved integration (as with acsearch) before planning anything.
5. **Specimen thumbnails** from OCRE/PELLA example coins (IIIF images from ANS, BM, BnF) in the type card.
6. **Numista** — has an official API with a key; natural backbone for the **Giga Collection** tracker (your coins, purchase price vs current median, CSV export).
7. **Upcoming-sale alerts** (NumisBids, Sixbid, Biddr, CoinArchives) — "this type is in an auction next week". Each needs its own permission check before any fetch.

## Done

- v0.2 open-data type lookup (`fbb6ab8`).
- v0.3 acsearch prices: median, middle 50%, sales list, editable remembered term, CHF, strict one-amount parser, gesture-safe permissions (`d2c14ae`). Awaiting the first real run on a Premium account to confirm the logged-in price format.
- v0.4 Roman Republican (RRC/Crawford) references via ANS CRRO, issuer fallback for the ruler slot, acsearch term `Crawford {number}`, catalogue-aware not-found hint (`cfd6ce9`, `56d0143`).
- v0.4.1 exact references via a quoted phrase search first (fixes RRC 1/1), typed `RRC`/`Crawford`/`Cr.`/`Price` prefixes and stray quotes ignored, CRRO suggestions limited to the typed Crawford group before the five-suggestion cap, one default-number table (`db486f0`, `a89b0e2`).
- v0.5 one-box Reference entry: `RIC I² Nero 306`, `Crawford 44/5`, `Price 23` (Arabic volumes, parts, edition shorthands, curly quotes) fill the guided fields and look up in one click; unreadable input explains itself without a request; guided edits clear the box; RIC fields strip stray quotes (`948f2d0`, `a72d79a`).
- v0.6 one-click prices: a resolved type (Look up or a "Did you mean" choice) fetches its acsearch prices in the same click when acsearch access is already granted — never prompts, never stores the term, one request per action; Get prices re-runs with an edited term; stale error text cleared for screen readers (`dbfbfb6`).
- v0.7 Recent row: the last six resolved types as one-click chips (stored locally as id, corpus and title only; restore validates them), a chip fills the guided fields from its title so the acsearch term follows it, long titles ellipsize, focus stays on the chips; a hint when prices are skipped for missing acsearch access; sign-in note without "again"; docs name every way a type resolves (`8c7e010`, `feb7832`).
- v0.8 **Alt+Shift+G** opens the popup (Manifest V3 `_execute_action`, no permission; changeable in the browser's extension-shortcut settings); focus returns to the chip you were on after the Recent row refreshes; blank Recent entries are dropped on restore (`8e12caf`).
- v0.9 **Copy summary** puts the type, median, middle 50%, sale count, search term and type link on the clipboard; up to five acsearch prices the strict reader could not count are quoted in the "no hammer prices" note and the copied summary, so the first logged-in run tells us the real price format (`b0d5940`).
