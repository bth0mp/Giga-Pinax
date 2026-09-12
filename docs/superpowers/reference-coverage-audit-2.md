# Reference coverage audit, round 2 — what the lot reader still misses, and what it now over-reads

Audit date: 2026-09-12. Against `extension/lot.js` at 0.21.0 (`b229224`), which is unmodified in the working
tree. `extension/lookup.js` and `extension/prices.js` have a 0.22 change in flight; that change touches the
search-term sizing (`searchablePart`, `MAX_PART_WORDS`), not the reference-reading path, so nothing below
depends on it.

## Summary in one page

**What is covered now.** The `KEYS` list in `lot.js` has grown from 52 spellings at 0.20.0 to **201** at 0.21.0
— about 150 new ones. Roman imperial, Republican, provincial, Alexandrian, Judaean, Seleucid, Ptolemaic,
Parthian, mainstream Greek, Byzantine, Celtic and the core Islamic books are now read out of pasted lot text.
Round 1's "must add" list of 35 was implemented in full.

**How I tested.** I copied the three extension modules to a scratch folder outside the repo and ran **315
realistic lot lines** through the real `findReferences` / `lotLookup` — 190 multi-reference lot lines by area,
plus a 125-name sweep with one candidate catalogue per line. Every miss and every false positive below was
reproduced on that snapshot. Where I say something is *inferred* rather than reproduced, I say so. I did not
query acsearch or CoinArchives.

**What I found.**

| | Count |
| --- | --- |
| Catalogue names a dealer really writes that still produce **no row at all** | **102** |
| Citation *forms* rejected even though the key is already in the list | **16** |
| Junk rows the reader now invents from text that is not a reference | **29** |
| Lines where the "Ex …" cut silently swallowed every real reference | **5** |

(A further **23** names are ones round 1 deliberately skipped. I re-ran all 23 and confirmed they still
produce nothing, which is the right answer.)

The second and third rows are the new news. Round 1 only looked for missing keys. The 0.21 keys are mostly
right, but two things now bite:

1. **Sixteen citation forms that dealers actually write are rejected by the very guards that were added with
   the key.** `Hendin 6th ed. 1243`, `Dattari-Savio Pl. 123, 456` (the example written into `lot.js`'s own
   comment), `Varbanov (Eng.) 1234`, `Recueil général 123`, `Senior ISCH 123`, `Lindgren-Kovacs 123` — all
   produce nothing, although the key is present. Fixing these is worth more per line of code than any new key.
2. **A catalogue name followed by a publication year now reads as a reference.** `Crawford 1974`, `Price 1991`,
   `Sear 2000`, `Sommer 1994`, `Hendin 2010`, `Newell 1938` all produce a row. Two of them
   (`Crawford 1974` → RRC, `Price 1991` → Price) are *typed* catalogues, so the extension will go and fetch
   type data for a coin that does not exist.

---

## 1. Round 1's own list: what was left behind

Round 1 proposed 35 "must add", a long "worth adding" list, and a "skip" list. Checking each name against the
0.21 `KEYS`:

**Every "must add" name is in.** Spot-checked and confirmed reading: `Hunter 12`, `Woytek 290b`, `RBW 1353`,
`CRI 9`, `HCRI 419`, `BMCRR Rome 2320`, `MIBEC 12`, `SGI 1234`, `DCA 872`, `RRCH 231`, `Y# 31a`.

**Three names from round 1's own tables were dropped without a note.** All three reproduced as unread
(`Albert` and `Rosen` were in the "worth adding" ranking; `Noe` was in the Greek gap table but never made the
ranking):

| Name | Verdict |
| --- | --- |
| **Albert** (*Die Münzen der römischen Republik*) | **Deserves adding.** A real Republican corpus, cited `Albert 1234`. Round 1 rated it medium risk as a personal name; with the surname guard (number must follow immediately) the risk is the same as `Foss` or `Mack`, which were added. |
| **Rosen** (*SNG Rosen* / the Rosen collection) | **Rightly dropped.** `SNG Rosen 123` already reads through the `SNG` key, which is how it is nearly always written. A bare `Rosen 456` is rare, and "Rosen" is a capitalised German noun. |
| **Noe** (*The Coinage of Metapontum*) | **Marginal — I would add it.** `Noe 322` is standard on Metapontine nomoi and I reproduced the miss. Three letters is short, but "Noe" is not an English word and the surname guard demands a digit straight after. |

**The skip list holds up.** I re-ran all 23 and reproduced that every one still produces nothing, which is the
intended behaviour: `Cayón`, `King`, `Pink`, `Berk`, `Spink`, `Gadoury`, `Craig`, `North`, bare `Fr.`, bare
`Rec.`, `van 't Haaff`, `A-1234`, bare `HN`, `Zeno`, `N#`, `CH`, `Hoover`, `Delmonte`, `Vanhoudt`, `Divo`,
`Herrera`, `Uzdenikov`, `Diakov`. I agree with every one of those calls. Two comments:

- `Berk` is the one I would revisit *last*, not never. Harlan J. Berk's *Roman Gold Coins of the Medieval
  World* is genuinely cited, but the house name is unavoidable in the same paste. Leave it out.
- `Spink` stays out, but note that Spink numbers are usually written `S. 1490` or `SCBC 1490`, and **neither
  reads today**: `S 2337; North 1797` produces nothing at all, because the single letter `S` only counts when
  a longer key sits in the same run. `SCBC` is a separate, house-free abbreviation and is safe to add (below).

**Two implementation details drifted from round 1's notes.**

- Round 1 asked for `Köln`/**`Koln`**; the code has `Köln`/`Koeln`. I reproduced that **`Koln 1234` is not
  read** while `Koeln 1234` and `Köln 1234` are. The plain de-accented spelling is exactly what a copy-paste
  from a de-accented dealer page produces. Same hole for `Böhringer`: `Boehringer` and `Böhringer` read,
  **`Bohringer 411` does not**.
- Round 1's note 1 said longer keys "must be listed before" shorter ones "because the alternation is tried in
  order". I tested this directly with a standalone regex: **it is not true**. The trailing
  `(?![\p{L}\d])` makes the short match fail and the engine backtracks to the longer alternative, so
  `MIR|MIRB` and `MIRB|MIR` both match `MIRB 12` correctly. The current ordering is harmless, but nobody needs
  to spend care on it.

---

## 2. The proposals, best value first

Risk column: **low** = the word appears in lot text only as a citation; **medium** = plausible in other roles;
**high** = an ordinary word, a find-spot, or an auction house in the same paste.

"Guard" means the pattern helper in `lot.js`: `surname()` = number must follow immediately; `plateName()` =
allows a Roman numeral between key and number; `word()` = same as surname but does not join the year rule;
`notHouse()` = negative lookbehind for a house's first name.

### Tier 1 — add these

| Catalogue | Area | Key as written | Example citation | Number shape | Guard | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| **Bodenstedt** | Greek, Lesbos electrum | `Bodenstedt` | `Bodenstedt 45`, `Bodenstedt Em. 46` | digits, sometimes `Em.` in front | `surname()`, plus allowing an `Em.` prefix | low |
| **MACW** | Central Asia, India, Oriental Greek | `MACW` | `MACW 2158` | 3–4 digits | plain key | low |
| **Klat** | Islamic, Umayyad dirhams | `Klat` | `Klat 4b`, `Klat 162` | digits + optional letter | `surname()` | low |
| **SNAT** | Islamic, Sylloge Numorum Arabicorum Tübingen | `SNAT` | `SNAT Ia 123`, `SNAT XIVa 456` | volume (Roman + letter) then digits | `plate()` — the volume must be allowed through | low |
| **Balog** | Islamic, Ayyubid and Mamluk | `Balog` | `Balog 229` | digits | `surname()` | low |
| **Schindel** | Sasanian (the SNS author, cited alone) | `Schindel` | `Schindel 12` | digits, sometimes `III/1 12` | `plateName()` | low |
| **Cribb** | Kushan (and `Jongeward & Cribb`) | `Cribb` | `Cribb 12` | digits | `surname()` | low |
| **Rosenfield** | Kushan | `Rosenfield` | `Rosenfield 123` | digits | `surname()` | low |
| **Van Arsdell** | Celtic, Britain | `Van Arsdell` | `Van Arsdell 1732` | 3–4 digits | `surname()`, space as `\s+` | low — `VA` is keyed, the spelled-out name is not |
| **Delestrée** / **Delestree** | Celtic, Gaul | `Delestrée` | `Delestrée 240` | digits | `surname()` + ASCII twin | low — `DT` is keyed, the name is not |
| **Ashton** | Greek, Rhodes | `Ashton` | `Ashton 209` | digits | `surname()` | low |
| **Callataÿ** / **Callatay** | Greek die studies, Mithradates | `Callataÿ`, `de Callataÿ` | `Callataÿ D21/R3`, `Callataÿ pl. 12, D22` | **die letters first** (`D21/R3`) | needs a looser guard than `surname()` — see note below | low |
| **Draganov** | Greek, Paeonia | `Draganov` | `Draganov 434` | digits | `surname()` | low |
| **Noe** | Greek, Metapontum | `Noe` | `Noe 322` | digits | `surname()` | low |
| **Albert** | Roman Republic | `Albert` | `Albert 1234` | digits | `surname()` | medium — a first name |
| **MIRB** | Byzantine (Hahn, *Moneta Imperii Romani-Byzantini*) | `MIRB` | `MIRB 12` | digits | plain key; `MIR` cannot reach it | low |
| **Howgego** | Countermarks | `Howgego` | `Howgego 123` | digits | `surname()` | low — but note `GIC` already means Sear's *Greek Imperial Coins* in the list, and Howgego's book uses the same letters |
| **Koln** | Alexandrian, ASCII twin of the existing `Köln` | `Koln` | `Koln 1234` | digits | same as `Köln` | medium — a mint name, as `Köln` already is |
| **Bohringer** | Greek, Syracuse, ASCII twin of `Böhringer` | `Bohringer` | `Bohringer 411` | digits | same as `Böhringer` | low |

**Note on Callataÿ.** Its number normally starts with a die letter (`D21/R3`), so the `surname()` guard, which
demands a digit straight after the key, rejects it. The same shape defeats `Diler Ab-123` today (reproduced).
If you add Callataÿ you need a guard that also accepts one short letter-plus-digit token.

### Tier 2 — worth adding, lower frequency

| Catalogue | Area | Example | Shape | Guard | Risk |
| --- | --- | --- | --- | --- | --- |
| **Sabatier** | Byzantine | `Sabatier 6` | digits | `surname()` | low — but an 1862 book, cited mainly for rarities |
| **Wroth** | Byzantine / Vandal (BMC author) | `Wroth 88` | digits | `surname()` | low |
| **PCPC**, **LPC**, **Lianta**, **Anastasi**, **Spahr** | Late Byzantine, Byzantine Sicily | `PCPC 1`, `Spahr 45` | digits | plain keys / `surname()` | low |
| **Kent** | Late Roman (RIC X author) | `Kent 1287` | digits | `surname()` | **high** — "found in Kent" is a real find-spot line on British lots |
| **Demo**, **Ranieri**, **Ulrich-Bansa**, **Arslan** | Migration period | `Demo 45` | digits | `surname()` | medium for `Demo` (an ordinary word) |
| **Waddington** | Roman provincial, Asia Minor | `Waddington 456` | digits | `surname()` | low |
| **Mionnet** | Roman provincial, old but still cited | `Mionnet IV, 345` | Roman volume then digits | `plateName()` | low |
| **Imhoof-Blumer** | Greek / provincial | `Imhoof-Blumer 12` | digits | `surname()` | low |
| **Krzyzanowska**, **Jurukova** | Pisidia, Thrace | `Krzyzanowska VI/12` | Roman/digit mix | `plateName()` | low |
| **Martini** | Countermarks, Roman bronze | `Martini I-123` | Roman prefix then digits | `plateName()` | medium — a very common Italian surname |
| **Pangerl**, **Werz** | Countermarks | `Pangerl 45` | digits | `surname()` | low |
| **Goodwin** | Arab-Byzantine | `Goodwin 123` | digits | `surname()` | low |
| **Artuk**, **Zambaur**, **Vives**, **Damali**, **Pere** | Islamic regional | `Artuk 1234` | digits | `surname()` | low |
| **Saeedi**, **Paruck**, **Vondrovec** | Sasanian, Hunnic | `Saeedi 345` | digits | `surname()` | low |
| **Rudd** | Celtic, Britain | `Rudd 123` | digits | `surname()` | **high** — Chris Rudd is the main Celtic dealer; his name is in titles and provenance |
| **Kellner**, **Ziegaus**, **Castelin**, **Paulsen**, **Evans** | Celtic, Noricum / Bohemia / Britain | `Kellner 45` | digits | `surname()` | low, except `Evans` (common surname) |
| **Kinns**, **Konuk**, **Regling**, **Desneux**, **Hurter**, **Lorber**, **Gitler** | Greek regional die studies | `Konuk 12` | digits | `surname()` | low |
| **Karayotov**, **Topalov** | Greek, Black Sea | `Karayotov I, 45` | Roman volume then digits | `plateName()` | low |
| **Von Fritze** | Greek, Kyzikos electrum | `Von Fritze I, 134` | Roman volume then digits | `plateName()` | low |
| **Rajgor**, **Pieper**, **Fishman**, **Deyell**, **Whitehead**, **Altekar** | India | `Rajgor 123` | digits | `surname()` | medium for `Rajgor` — Rajgor's Auctions is a Mumbai auction house |
| **GH** / **Gupta & Hardaker** | India, punchmarked | `GH 456` | digits | `word()` | medium — two capitals |
| **Hartill** | Chinese cast coinage | `Hartill 22.1279` | chapter`.`number | `surname()` | low |
| **Schjöth** / **Schjoth**, **FD**, **Coole** | Chinese cast coinage | `Schjöth 543` | digits | `surname()` + ASCII twin; `FD` needs `word()` | low, except `FD` |
| **JNDA**, **Toda**, **Barker** | Japan, Korea, Vietnam | `JNDA 01-23` | digits with a leading zero | plain / `surname()` | low |
| **SCBC** | English hammered, sold beside Celtic | `SCBC 1490` | 3–4 digits | plain key | low — the house-free way to write a Spink number |
| **Duplessy**, **Ciani**, **Boudeau**, **Poey d'Avant** | Medieval France | `Duplessy 213` | digits | `surname()` | low |
| **CNI** | Italian medieval | `CNI VII, 45` | Roman volume then digits | `plate()` | low |
| **Dannenberg** / **Dbg**, **Hävernick** | German medieval | `Dannenberg 345` | digits | `surname()` | low; `Dbg` needs `word()` |
| **Huszár**, **Unger**, **Herinek**, **CNA** | Hungary, Austria | `Huszár 123` | digits | `surname()` + ASCII twin | low — but see the `CNH` collision note |
| **Elias**, **Gomes** | Portugal | `Elias 12` | digits | `surname()` | medium — `Elias` is a given name |
| **Dalton & Hamer** / **D&H** | British tokens | `D&H 45` | digits | `word()` | low |
| **Feuardent** | Jetons | `Feuardent 456` | digits | `surname()` | low |
| **Meshorer & Qedar** | Samarian coinage | `Meshorer & Qedar 12` | digits | needs the `&` form spelled out | low |
| **Miles** | Islamic, Umayyads of Spain | `Miles 123` | digits | `surname()` | **high** — "miles" is an ordinary English word and Latin for soldier |

**One collision to be aware of.** `CNH` is already a key for Villaronga's *Corpus Nummum Hispaniae*, but the
same letters are the standard abbreviation for *Corpus Nummorum Hungariae*. Both produce a prices-only row
with their own text, so nothing breaks — the search just won't know which country is meant.

---

## 3. What the reader now invents: false positives, all reproduced

Every line below was run through the real `findReferences`. "Listed" is exactly what came back.

### 3a. A catalogue name followed by a publication year — 20 reproduced

This is the biggest single problem. `lot.js` has a year guard, but it only fires when prose runs on in the
*same* clause. A year at the end of a sentence sails through.

**Plain keys (no year guard at all) — 12 reproduced:**

| Line | Listed |
| --- | --- |
| `See Crawford 1974, p. 745, for the chronology. Crawford 443/1; Sydenham 1006.` | **`Crawford 1974` [RRC]**, `Crawford 443/1`, `Sydenham 1006` |
| `Price 1991 dates the issue to 325 BC. Price 3949.` | **`Price 1991` [Price]**, `Price 3949` |
| `Bopearachchi 1991 assigns this to Series 24. MIG 217.` | **`Bopearachchi 1991` [Bop]**, `MIG 217` |
| `Mitchiner 1975, p. 23, illustrates a similar piece. MIG 217.` | **`Mitchiner 1975`**, `MIG 217` |
| `Sear 2000 lists this as common. RIC II 456.` | **`Sear 2000`**, `RIC II 456` |
| `Svoronos 1904 pl. 12. SNG Cop 123.` | **`Svoronos 1904`**, `SNG Cop 123` |
| `Kroll 1993 discusses the series. SNG Cop 12.` | **`Kroll 1993`**, `SNG Cop 12` |
| `Sydenham 1952 remains the standard. Crawford 443/1.` | **`Sydenham 1952`**, `Crawford 443/1` |
| `Cohen 1880 lists two variants. RIC 972.` | **`Cohen 1880`**, `RIC 972` |
| `McClean 1923 records this. SNG Cop 12.` | **`McClean 1923`**, `SNG Cop 12` |
| `DOC 1973 catalogues the type. SB 139.` | **`DOC 1973`**, `SB 139` |
| `MEC 1986 covers the period. SB 139.` | **`MEC 1986`**, `SB 139` |

The first three are the sharpest, because `Crawford`, `Price` and `Bopearachchi` are *typed* catalogues: the
row is built as a real type reference and the extension goes to numismatics.org for it. `Price 1991` is the
worst of all — 1991 is inside the real range of Price numbers, so (inferred; I did not make the request) the
collector would get a confident, completely wrong Alexander type card sitting above the correct `Price 3949`.

**Surname keys, where the year ends the sentence — 8 reproduced:**

`Published by Sommer 1994.` → **`Sommer 1994`**. `Attributed following Hendin 2010.` → **`Hendin 2010`**.
`See Metcalf 1995.` → **`Metcalf 1995`**. `Discussed in Walker 1956.` → **`Walker 1956`**.
`Compare Newell 1938.` → **`Newell 1938`**. `Dated by Estiot 2004.` → **`Estiot 2004`**.
`Cited in Grierson 1982.` → **`Grierson 1982`**. `Butcher 2004. Prieur 123.` → **`Butcher 2004`**.

Only `Butcher 2004 notes three obverse dies. Prieur 123.` is correctly rejected — because the words "notes
three obverse dies" run on inside the same clause. That is the whole of the guard.

### 3b. Auction-house names read as catalogues — 6 reproduced

| Line | Listed |
| --- | --- |
| `Aureo & Calico 300, lot 45. RIC II 123.` | **`Calico 300`**, `RIC II 123` |
| `Freeman & Sear 15, lot 123. Crawford 443/1.` | **`Sear 15`**, `Crawford 443/1` |
| `Sear 25, lot 12. RIC 123.` | **`Sear 25`**, `RIC 123` |
| `Album 46, lot 1234. SICA 123.` | **`Album 46`**, `SICA 123` |
| `Purchased from Seaby 1975. RSC 12.` | **`Seaby 1975`**, `RSC 12` |
| `Includes David R. Sear certificate no. 12345. RIC II 123.` | **`Sear certificate no. 12345`**, `RIC II 123` |

The existing house guards do work where they apply: `Stephen Album Rare Coins Auction 46`, `Harlan J. Berk`,
`Rodolfo Ratto`, `Spink 250`, `Baldwin 98`, `Heritage Auctions`, `Triton XXVI` and
`Aureo & Calico, Auction 300` all produced no junk row. The leaks are the forms where a *sale number* follows
the house name directly, and the two houses whose names are also catalogue keys — Calicó, Sear, Seaby, Album.

### 3c. Sale-price text — 2 reproduced

| Line | Listed |
| --- | --- |
| `Estimate 500 CHF. Price realized 1,200 CHF. RIC 123.` | **`Price realized 1,200`**, `RIC 123` |
| `Price realised: 1200 EUR. Hammer 1000. RIC 123.` | **`Price realised: 1200`**, `RIC 123` |

This one will be hit often, because it is exactly what you get when you copy a whole archive page. The
currency guard in `REMARKS` only strips a currency *inside brackets*.

### 3d. A Krause "C#" number read as Cohen — 1 reproduced

`CHINA, Qing. Cash. Hartill 22.334; Krause C#1-1; Y# 4.` → **`C#1-1`**, `Y# 4`. The Cohen key `C` matches
before the `#`, and the `Y#` in the same run lets the single letter through. Harmless in practice (the row's
text is the correct Craig number and that is what gets searched), but it is labelled as the wrong catalogue.

### 3e. What did **not** false-positive — the guards that are earning their keep

All of these produced no junk row, which is the right answer: `Superb EF. 3.21 g, 18 mm, 6 h`,
`NGC Ch AU 5/5, 4/5, Fine Style`, `Struck AD 69-79`, `Circa 350-300 BC`, `S C across field`,
`IMP C M AVR ANTONINVS AVG`, `C. Vibius C.f. Pansa … 90 BC`, `Lot 23312`, `Sunrise Collection`,
`Weber Collection`, `Hunter Coin Cabinet`, `Hunter 1962, lot 45`, `Ratto 1927, lot 1375`,
`Seaby 1975, lot 12`, `Gorny & Mosch 250`, `Künker 300`, `Vico 150`.

### 3f. The opposite failure: the "Ex …" cut eats real references — 5 reproduced

`PROVENANCE` deletes everything from the first sentence-initial `Ex` / `From` / `Provenance:` to the end of the
text. When a house puts provenance *before* the references — which Leu, Roma and several others do — the
collector gets nothing at all.

| Line | Listed |
| --- | --- |
| `Ex Leu 4, 25 May 1972, lot 123. RIC 972; Cohen 17.` | **(nothing)** |
| `From the Sunrise Collection. Gobl I/1; SNS II 12.` | **(nothing)** |
| `From the Weber Collection, part II. SNG ANS 123.` | **(nothing)** |
| `Ex Hunter duplicates. RIC II 45.` | **(nothing)** |
| `Provenance: Gorny & Mosch 250. RIC II 45; BMC 12.` | **(nothing)** |

For contrast, the same references in the usual order read perfectly:
`RIC 972; Cohen 17. Ex Leu 4, 25 May 1972, lot 123.` → `RIC 972`, `Cohen 17`.

This is a bigger practical loss than any missing key, because it takes out the *whole* lot rather than one row.

---

## 4. Keys that are already in the list but reject the form dealers write — 16 reproduced

These need no new key, only a looser guard. Each was reproduced: the reference on the left produced nothing,
the one on the right (same catalogue, different form) read correctly.

| Written by the dealer | Listed | The form that does work |
| --- | --- | --- |
| `Hendin 6th ed. 1243` | nothing | `Hendin 1243` |
| `Hendin 1243 (6th ed.)` | nothing | `Hendin 1243` |
| `Dattari-Savio Pl. 123, 456` | nothing | `Dattari 5678` |
| `Recueil général 123` | nothing | `Recueil 123` |
| `Varbanov (Eng.) 1234` | nothing | `Varbanov II 1234` |
| `Lindgren-Kovacs 123` | nothing | `Lindgren III 123` |
| `Senior ISCH 123` | nothing | `Senior 98.245T` |
| `Jongeward & Cribb 123` | nothing | `Jongeward 123` |
| `Meshorer & Qedar 12` | nothing | `Meshorer 123` |
| `Morrisson BnF 5/Cp/AV/12` | nothing | `Morrisson 12` |
| `Foss, Roman Historical Coins 123` | nothing | `Foss 123` |
| `Hunter, vol. III, 45` | nothing | `Hunter 12` |
| `Diler Ab-123` | nothing | `Diler 123` |
| `Newell, Sidon 12` | nothing | `Newell 123` |
| `Füeg I.A.1` | nothing | `Fueg 1.A.1` |
| `Carradice Type IV` | nothing | (no digit at all — this one is unfixable and should stay unread) |

Three patterns account for almost all of it:

1. **An edition, plate or volume word between the key and the number** — `6th ed.`, `Pl.`, `général`, `(Eng.)`,
   `vol. III`, `ISCH`, `BnF`, `Sidon`. `plateName()` already lets a *Roman numeral* through; letting one short
   word through as well would fix nine of these lines.
2. **A co-author joined by `&` or `-`** — `Jongeward & Cribb`, `Meshorer & Qedar`, `Lindgren-Kovacs`,
   `Dattari-Savio` written with a plate word after it.
3. **A number that starts with a letter** — `Füeg I.A.1`, `Diler Ab-123`, and Callataÿ's `D21/R3`.

`Dattari-Savio Pl. 123, 456` is worth singling out: that exact string is the worked example in the comment
above `pieceAfter` in `lot.js`, and it does not read.

---

## 5. Not worth it, and why

| Candidate | Why not |
| --- | --- |
| **Berk**, **Spink**, **Gadoury**, **Cayón**, **Craig**, **Allen**, **North**, **King**, **Pink** | Round 1's reasons all still hold. I re-ran each and confirmed they produce nothing today, which is correct. |
| **Miles** (Umayyads of Spain) | "Miles" is an ordinary English word and a common given name, capitalised at the start of any sentence. The Spanish-Islamic coverage is not worth the noise. |
| **Kent** (RIC X author) | "found in Kent", "a Kent hoard", "Kent, England" are normal on British lots. RIC X is already keyed as `RIC X`; citing the editor alone is rare. |
| **Rudd** | Chris Rudd is *the* Celtic coin dealer; his name is in lot titles, provenance and the ABC authorship line. `ABC` is already a key and is how the same coins are cited. Add it only if the provenance cut is made smarter first. |
| **Rajgor** | Rajgor's Auctions is an active Mumbai auction house. Same shape of problem as Berk. |
| **Demo**, **Elias**, **Evans**, **Martini** | Ordinary words or very common surnames. Add only if the year guard (section 3a) is fixed first, since that is where they would leak. |
| **Zeno**, **N#**, **Numista**, **Wildwinds**, **OCRE**, **CRRO** | Database record ids, not catalogues — and note `Zeno 12345` already misfires in a different way: `Zeno` is read as a RIC *ruler* for the facet search. |
| **Sabatier** | Real, but an 1862 book superseded by DOC, MIB and Sear. Low frequency; Tier 2 at best. |
| **Bare `S.` for Spink** | The single-letter keys already carry the most delicate guard in the file. `SCBC` gives the same coverage with no ambiguity. |
| **`Fr.`**, **`Rec.`**, **`HN`**, **`A-`** | Confirmed still out, correctly. The spelled-out `Friedberg`, `Recueil` and `HN Italy` are in and work. |
| **Chinese and East Asian catalogues as a group** (`Hartill`, `Schjöth`, `FD`, `Coole`, `JNDA`, `Toda`, `Barker`) | Real and safe, but far from this collection. `KM#` and `Y#` already cover the world-coin path. Add `Hartill` alone if anything — it is the one a Western seller writes. |
| **Medieval European catalogues as a group** | Same argument. `SCBC`, `Duplessy` and `CNI` are the three that turn up on dealer sites that also sell ancients; the rest can wait. |

---

## 6. If only three things get done

1. **Fix the year rule.** Reject a bare four-digit year in the 1500–2100 range after *any* key, not only a
   surname key and not only when prose runs on. This kills 20 reproduced junk rows, including the two that
   send a wrong request to numismatics.org.
2. **Let one short word sit between a key and its number** (`6th ed.`, `Pl.`, `général`, `(Eng.)`, `vol. III`,
   `BnF`), the way `plateName()` already lets a Roman numeral through. This recovers nine reproduced misses
   from catalogues that are *already* supported, including `Hendin 6th ed. 1243`.
3. **Stop the provenance cut from deleting references that come after it.** Cut only to the end of the
   provenance sentence, not to the end of the text. This recovers five reproduced lines where the collector
   currently gets nothing at all.

Everything in section 2 is worth less than any one of those three.

---

*Method note: the probe scripts and their output live in the session scratchpad
(`…/scratchpad/audit2/`), not in the repo. They import a pinned copy of `extension/lot.js`,
`extension/lookup.js` and `extension/catalogues.js` taken at `b229224`, so the results are not affected by the
0.22 work in flight.*
