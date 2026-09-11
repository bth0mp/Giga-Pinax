# Giga Pinax 0.18 — whole lot text

**Goal:** the user's pick (2026-09-11): "Paste or right-click a whole lot description; Giga Pinax finds every reference in it and offers them."

Example, a biddr lot:

> TITUS, AD 69-79. AR, Denarius. Rome. Obv: T CAESAR VESPASIANVS. Head of Titus, laureate, right. Rev: ANNONA AVG. … Ref: RIC 972; Cohen 17; BMC 319.

Release 0.18.0.

**User decision (2026-09-11):** a lot with exactly one reference that has type data (RIC, RRC, SC, Price or Bop) opens that type at once. All of the lot's references stay listed above the card to switch to. With several, nothing is fetched until the user picks one.

**Built on the committed 0.17.0.** Where this plan differs from the code (prices panel, period buttons, lookup helpers), follow the code.

## Research (2026-09-11, 45+ lots from 16 houses)

The research sources were biddr (Katz, Numismad, NAC, DEMOS, Roma, Tauler & Fau), Leu, Nomos, CNG, CGB, the repo's acsearch fixture, and OCRE Solr.

### Today's `parseReference`

- **Returns `null`** for these whole lines: `Ref: RIC 972; Cohen 17; BMC 319.`, `BMC 256. Cohen 336. RIC 1073.`, `RIC² 1180`, `RIC.112`, `RIC IV 92 var.` and `Cf. RIC 20 (aureus)`.
- **Misreads a ruler in brackets** as a denomination: `RIC 268 (Elagabalus)` gives number `268 (Elagabalus)`.
- **Reads bare mint text as RIC:** `Rome 79` becomes RIC Rome 79.
- **Turns `Died 140/1` into Other.**

### How dealers separate references

| House | Separator |
|---|---|
| CNG, Roma, Lucernae, Künker | `;` |
| Katz, NAC, Tauler & Fau | `, ` |
| Leu, Nomos | `. ` |
| CGB | ` - ` |

- **Equivalence:** `=`.
- **A glued `.` or `-`:** `RIC.112`, `Doc-8h`, `Sear-734`.
- **Kept inside one reference:** a comma or a dot, as in `HGC 12, 72`, `RPC IV.1, 4790`, `RIC II.1`, `SC 165.1a`, `BCD Peloponnesos 665.1`.

### Markers

- `Ref:` and `cf.` / `Cf.` before a reference.
- `var.`, `var. (obv. legend)`, `(this coin illustrated)`, `(misdescribed)`, `(aureus)` and `passim` after it.
- A price inside a reference: `RCV.2517 (544$)`.
- Rarity words.
- `Not in the major references`.

### Catalogue forms

| Catalogue | Forms |
|---|---|
| RIC | `RIC 972`, `RIC I 306`, `RIC II.1 357 (Titus)`, `RIC III (Antoninus Pius) 394a`, `RIC II.1 (Vespasian) 696`, `RIC 268 (Elagabalus)`, `RIC² 1180`, `RIC.112`, `RIC IV 34a-b var.` |
| Crawford | `Crawford 344/1a` |
| RSC | `RSC 365a`, `RSC Carisia 1a` |
| Cohen | `Cohen 17`, `C 36`, `Coh. 284`, `C.309` |
| BMC | `BMC 319`, `BMCRE 606`, `BMC/RE.72` |
| RPC | `RPC I 3648`, `RPC 2044`, `RPC IV.1, 4790` |
| SNG | `SNG ANS 216`, `SNG Keckman 547-8`, `SNG von Aulock 8305` |
| HGC | `HGC 12, 72` |
| BCD | `BCD Peloponnesos 665.1` |
| Sear | `S 7756`, `Sear-734`, `SB 738`, `SBCV-243`, `RCV.2517` |
| SC | `SC 165.1a` |
| Price | `Price 3426`, `Pr-458` |
| Bopearachchi, Mitchiner | `Bopearachchi 1C`, `Mitchiner 215t`, `MIG 113d` |
| Others | `Calicó 620`, `DOC 13e`, `MIB 11`, `MIR 36, 1322d`, `Sydenham 698`, `Müller 1375`, `Kroll 15`, `McClean 4078`, `Benner 5`, `CBN 137` |

### How the ruler appears

- **In the heading:**
  - `TITUS, AD 69-79.`
  - `Titus, as Caesar, 69-79.`
  - `Divus Vespasian… Struck under Titus`
  - `Claudius with Nero, as Caesar`
  - `Julia Maesa`
  - `Diva Faustina I` (OCRE's portrait is named "Faustina the Elder")
  - `Vespasianus`
- **Most reliable, when present:** in the reference itself, `RIC 268 (Elagabalus)`.

### Things that must never read as a reference

| Kind | Examples |
|---|---|
| Dates | `AD 69-79`, `c. 386-338 BC` (`c.` looks like Cohen), `Died 140/1`, `95/4-94/3 BC`, `RY 13 = 539/40 CE` |
| Weights, sizes, die axes | `3.00g`, `2,81 g`, `27 mm`, `6h` |
| Grades | `NGC Choice VF 5/5 - 4/5` |
| Legends | `S - C`, `COS VI` |
| Denominations | `AE17`, `EL 1/24 Stater` |
| Provenance | `Triton VIII (2005, 1132)` (looks like RIC VIII), `NAC 27 (2004, 282)` |
| Sale numbers and prices | `Lot 23312`, `Est. 200 EUR` |
| Die-link codes | `(A16/P5)` |
| Mint and number | `Rome, 79.` |

### OCRE facets (live)

| Query | Hits |
|---|---|
| `typeNumber:"972" AND portrait_facet:"Titus"` | 1: II.1² Vespasian 972 |
| `typeNumber:"972" AND authority_facet:"Titus"` | 0 |
| `typeNumber:"1073" AND (portrait_facet:"Titus" OR authority_facet:"Titus")` | 1: the Leu lot |
| `typeNumber:"268" AND portrait_facet:"Julia Maesa"` | 1: IV Elagabalus 268 |
| `portrait_facet:"Faustina I"` | 0 |
| `portrait_facet:"Faustina the Elder"` | 439 |

- **Today's phrase narrowing** `typeNumber:"972" AND "Titus"` also matches Antoninus Pius, whose full name contains Titus. `pickRic`'s section filter then drops both hits, so "RIC Titus 972" is "none" today.
- **OR groups must stay bracketed.** Unbracketed, `typeNumber:394a_* OR typeNumber:394A_*` returned 51,853 hits.

## Design

### 1. `findReferences(text)` in `lookup.js`

It is pure and tested. It returns `{ references: [...], rulers: [...] }`.

1. **Clean the text.**
   - Remove `INVISIBLE`, turn en and em dashes into `-`, and squash whitespace while keeping the line breaks.
   - At most 3,000 characters.
2. **Cut the provenance tail.** Drop everything from the first sentence or line that starts with `Ex `, `From ` or `Provenance`.
3. **Find reference runs.**
   - **Where a run starts:** only at a known catalogue key, optionally preceded by `Ref:` or `cf.`, with a glued `.` or `-` allowed. The keys are: RIC, RRC, Crawford, Cr., RSC, Cohen, Coh., BMC, BMCRE, BMC/RE, RPC, SNG, HGC, BCD, Sear, RCV, SB, SBCV, SC, Price, Pr, Bopearachchi, Bop., Mitchiner, MIG, Calicó/Calico, DOC, MIB, MIBE, MIR, Sydenham/Syd., Müller/Muller, Kroll, Svoronos, McClean, Benner, CBN, BN, GRPC, ESM, ESMS.
   - **Single-letter keys:** `C` (Cohen) and `S` (Sear) count only when a longer key sits in the same run. This drops `c. 386-338 BC` and `S - C`, and keeps `C.309 - RIC.112`.
   - **Where a run continues:** across `;`, `,`, `. `, ` - ` and `=`, while the next piece is word(s) plus a number (`Kroll 15`).
   - **Where a run stops:** at anything else, such as grade text.
4. **Split a run** only at a separator followed by a catalogue key or `cf.`. So `HGC 12, 72`, `RPC IV.1, 4790`, `RIC II.1` and `SC 165.1a` stay whole.
5. **Normalise each piece.**
   - A leading `cf.` becomes the flag `cf`; a trailing `var.`, with its bracket, becomes the flag `variant`.
   - Drop `(this coin…)`, `(misdescribed)`, `passim` and bracketed prices.
   - A bracket naming a RIC section (`volumesOf` finds it) becomes the section: `RIC 268 (Elagabalus)` becomes section Elagabalus, number 268.
   - `RIC²` becomes `RIC`. `V-1` becomes `V.1`.
   - A range (`34a-b`, `547-8`) uses its first number.
6. **Read each piece** with `parseReference`. Anything that is not a type reference becomes an Other reference, with the text as the dealer wrote it. Duplicates are dropped.
7. **Rulers:** names in the text before the first reference.
   - Matching ignores case, after removing `Divus` / `Diva` and `as Caesar`.
   - Names are matched against RIC person sections (volumes I–V and X). Mint names are left out.
   - Several names are kept, so "Claudius with Nero" gives both.

### 2. A RIC reference with rulers from the text

**The query:** `(typeNumber clauses) AND (portrait_facet:"A" OR authority_facet:"A" [OR … "B"])`.
- Everything stays bracketed.
- The volume phrase is added when the reference names a volume.
- It keeps `pickRic`'s number, subtype and volume filters, and skips the section filter: a Titus-as-Caesar coin sits in the Vespasian section.

**Outcomes:**

| Hits | What happens |
|---|---|
| Exactly one | The type opens. |
| Several | "Choose a type:" |
| None | One retry without the rulers (today's partial search), offered only as "Choose a type:" and never opened automatically. |

A ruler inside the reference itself (`(Elagabalus)`) still goes through today's path.

### 3. The popup

- **Pasting.** The Reference box takes up to 3,000 characters. A paste reads `clipboardData` `text/plain`, keeping the line breaks for `findReferences`, and the box shows it on one line.
- **When the lot-text path runs.** On Look up, or right-click, when the text is over 120 characters, or `findReferences` finds 2 or more references.
- **The list.** "Found in this text:" reuses `#candidates`, with one row per reference in text order, each labelled as the dealer wrote it plus a tag:
  - `RIC 972 · Titus`;
  - `Cohen 17 · prices only`;
  - `cf.` and `var.` tags.
- **Exactly one type-data reference** (RIC, RRC, SC, Price or Bop) also opens at once, with the list staying above the card.
- **Several:** nothing is fetched until the user picks one.
- **Picking a row** fills the guided fields, as a Recent chip does, and looks the reference up. A RIC row with text rulers uses the facet search; an Other row gives its prices-only card.
- **No references found:** `No catalogue references found in that text.`
- **Right-click.**
  - `selectionQuery` keeps its 120-character cap and its ";" cut for short, single references.
  - When a selection holds two or more catalogue keys, or is longer than 120 characters, up to 3,000 characters are kept, cut at a word boundary.

### 4. Tests

- **Parsing cases:** the research table's rows, as short strings in the tests.
- **Must-ignore strings:** `c. 386-338 BC`, `S - C`, `Died 140/1`, `NGC Choice VF 5/5 - 4/5`, `Triton VIII (2005, 1132)`, `Rome, 79.`, `RY 13 = 539/40`, `RCV.2517 (544$)`, `EL 1/24`, `AE17`.
- **Live-captured fixtures** for the facet queries: Titus 972, Titus 1073, and Julia Maesa 268.
- **The retry** when the facet search finds nothing.
- **`selectionQuery`** for lot-length selections.

## Release 0.18.0

As before:
- The version goes in the manifests, the package test and the docs.
- The backlog gets a Done entry.
- `python scripts/build.py`, then the checks.
- Do not commit.

## Verification (controller)

### Round 1: `http://localhost:8800`

2026-09-11, the first integrated build, never loaded before, 440×680. numismatics.org was live; acsearch was stubbed.

**It found a HIGH bug the node tests missed.** Opening any lot row, automatically or by click, filled blank fields and showed "No Price found in PELLA". The cause: `showLot` handed the finder's wrapper `{ text, reference, typed, … }` to `fillFields` and `lookupType` instead of its `reference`. The same mix-up hid the RIC "· Titus" tag. The review round confirmed the same bug three times (M1, M14, M20) and fixed it with `lotLookup`/`lotLabel` in `lot.js`, with tests.

### Round 2: `http://localhost:8801`

After the review round's 28 fixes, never loaded before.

| Test | Result |
|---|---|
| The biddr Titus lot | rows `RIC 972 · Titus` (chosen), `Cohen 17 · prices only`, `BMC 319 · prices only`; it opens at once as RIC II, Part 1 (second edition) Vespasian 972, with fields RIC / II.1² / Vespasian / 972, term `Vespasian 972`, prices shown |
| Picking Cohen 17 | the Other card `Cohen 17`, term `"Cohen 17"`, 0 numismatics.org requests |
| Julia Maesa | RIC IV Elagabalus 268 |
| Two typed references | the list, `3 references found in this text.`, 0 requests |
| A long text with no references | `No catalogue references found in that text.`, 0 requests |
| `RIC 972` | `Choose a type:` with 6 types |
| `Titus 123` | the card |
| ArrowUp, then Enter on the recalled label | reopens its card |
| A multi-line paste | line breaks become `. ` (`… Cohen 17. Ex CNG 105, lot 123`) |
| Console | clean |

### Round 3: `http://localhost:8802` (final)

After one agent fixed the recheck's last three `lot.js` edge cases test-first (node 143/143, lint 0/0/0), on a port never loaded before.

| Input | Result |
|---|---|
| `SELEUCID KINGDOM. Antiochus VII Euergetes, 138-129 BC. AE. SC 2069` | a lot with one row, `SC 2069`; opens Seleucid Coins (part 2) 2069 |
| `Titus. Denarius. RIC 972 (Scarce); Cohen 17` | `RIC 972 · Titus` (the rarity note dropped); opens RIC II, Part 1 (second edition) Vespasian 972 |
| `… RIC 268 (Elagabalus), BMC 76, Thirion 123, S 7756, C 36` | rows RIC 268, BMC 76, S 7756 and C 36; opens RIC IV Elagabalus 268 |
| The biddr Titus lot | unchanged: opens Vespasian 972 with fields RIC / II.1² / Vespasian / 972 |
| `Crawford 44/5` | unchanged |

- Console clean.
- `dist/brave/lot.js` is identical to the source; `dist/` holds only the 0.18.0 ZIPs.
- Python tests OK; the stale 0.17.0 grep prints nothing.
