# Giga Pinax 0.26 — the catalogues the lot reader still misses

**Goal:** work through the 102 catalogue names in `docs/superpowers/reference-coverage-audit-2.md` §2, decide which
of them the reader should learn, and add only those. Release 0.26.0.

**The short answer, before any of the detail:** **26 of the names are worth adding, as 27 entries in the `KEYS`
list. Four were added already, in 0.22/0.23, without anyone noticing. The remaining seventy-odd are not worth
it** — and §5 says why, name by name.

---

## How I tested

The audit was written against `lot.js` at **0.21.0**. Since then 0.22, 0.23 and 0.24 have landed, so every claim
in it had to be re-run before it could be trusted.

I copied `lot.js`, `lookup.js`, `catalogues.js` and `prices.js` **out of the repo at `69ab39d` (0.24.0)** into
the session scratchpad and ran the real `findReferences`, `lotLabel`, `defaultTerm` and `searchCategory` over
them. Nothing in the repo was touched; the 0.25 work in flight in `popup.js`, `popup.css`, `popup.html` and
`lookup.js` cannot affect these results, because the copies are pinned to the commit.

Three passes:

1. **Coverage.** One realistic lot line per candidate — **101 lines**, the 96 distinct names in the audit's two
   tables plus the accent twins and the `Bodenstedt Em.` form. Confirms what produces nothing *today*.
2. **Danger.** A second copy of `lot.js` with every candidate key **actually added**, then sixty-odd sentences
   that are not citations — a scholar's surname with a year, an auction house with a sale number, a ruler's
   reign dates, a find-spot, a grading term, a legend, an ordinary English word — run through both copies side
   by side. This is the only honest way to test a guard: a key that is not in the file cannot false-positive.
3. **Regression.** The repo's own `tests/lot.test.mjs`, unchanged except for its import line, run against the
   patched copy. **42/42 pass with the recommended set.** Two of the 42 failed with the full candidate list, and
   both failures are decisive — see Batch D.

I did not query acsearch or CoinArchives. Every claim about search phrases below comes from running
`prices.js`'s own `defaultTerm`, `coinArchivesTerm` and `searchCategory` on the rows the reader produced.

**Where a claim comes from.** Everything in a "today / with the plan" column, every false positive, and every
regression result was **run**, and can be re-run from the scratchpad. The *citation forms* — that Bodenstedt
numbers by emission, that Callataÿ cites die pairs, that Van Arsdell is the spelled-out `VA` — come from the
catalogues themselves, not from a probe; where I was unsure of a form I wrote the uncertainty down rather than
asserting it. Nothing in the recommended 26 depends on a form I could not reproduce reading.

---

## What the audit got right, and what has already been fixed

**Four of the audit's 102 already read at 0.24** and nobody recorded it. Reproduced:

| Name | Today |
|---|---|
| `Noe 322` | `Noe 322` — added in 0.23 |
| `Koln 1234` | `Koln 1234` — the ASCII twin was added |
| `Bohringer 411` | `Bohringer 411` — the ASCII twin was added |
| `Meshorer & Qedar 12` | `Meshorer & Qedar 12` — reads through 0.23's co-author infix, no key needed |

**0.23 also closed 12 of the audit's 16 "right key, wrong form" misses** (§4 of the audit). All reproduced
reading correctly now: `Hendin 6th ed. 1243` → `Hendin 1243`, `Dattari-Savio Pl. 123, 456`,
`Varbanov (Eng.) 1234`, `Recueil général 123`, `Senior ISCH 123`, `Jongeward & Cribb 123`,
`Morrisson BnF 5/Cp/AV/12`, `Hunter, vol. III, 45` → `Hunter III, 45`, `Diler Ab-123`, `Füeg I.A.1`,
`Hendin 1243 (6th ed.)`, `Meshorer & Qedar 12`.

Still unread, and **out of scope here**: `Foss, Roman Historical Coins 123` and `Newell, Sidon 12` (a whole
book title or a mint name between key and number). `Carradice Type IV` has no digit and stays unread, correctly.

**The remaining 97 produce no row.** Reproduced, one line each.

---

## 1. The batches

Risk is judged on one question only: **what else, in real lot text, is spelled exactly like this key and has a
number after it?** The guards in `lot.js` are the vocabulary:

| Guard | What it does |
|---|---|
| plain key | matches anywhere, no condition |
| `word(key)` | the number must follow immediately (through the closed infix list) |
| `surname(key)` | as `word`, and the number must be the *whole* reference — this is what refuses `Butcher 2004 notes three obverse dies` |
| `plate(key)` | allows a Roman numeral between key and number (`LT XXII 1234`) |
| `plateName(key)` | `surname` + the Roman numeral (`Lindgren III 456`) |
| `notHouse(first, key)` | negative lookbehind — `(?<!Stephen\s)Album`, `(?<!Rodolfo\s)Ratto` |

There is no helper called `named` in `lot.js` at 0.24; `plateName` is the closest thing and is what that note
meant.

### Batch A — plain keys, nothing in English or dealer boilerplate looks like them

Acronyms no sentence contains. No guard, one array entry each.

| Key | Example citation | Number shape | Guard | The false positive I worried about, and what happened |
|---|---|---|---|---|
| **MACW** | `MACW 2158` | 3–4 digits | plain | `See MACW 1975 for the series.` → **no row** (the `see` cue catches it). `MACW 1975.` with no cue would give a stray row, like any key. |
| **SNAT** | `SNAT XIVa 456`, `SNAT Ia 123` | volume (Roman + a lower-case letter), then digits | plain — **no volume guard needed**; `BODY` already reads up to four words before the digit. Reproduced both forms. | None found. The letters are Sylloge Numorum Arabicorum Tübingen and nothing else. |
| **MIRB** | `MIRB 12` | digits | plain | `MIR 12; MIRB 34. RIC V 45.` → `MIR 12`, `MIRB 34`, `RIC V 45`. The existing `MIR` key does **not** swallow it; the audit's note on backtracking is right. |

`PCPC`, `LPC`, `CNI`, `CNA`, `SCBC` and `JNDA` are also technically Batch A, and `D&H` is one entry away from
it (`word('D&H')`, so the `&` cannot drift). All six reproduced reading cleanly on a realistic line — `SCBC 1490`,
`CNI VII, 45`, `JNDA 01-23`, `D&H 45`, `PCPC 1`, `LPC 45` — and none false-positived. They are cut in §5 for a
different reason entirely: §4 shows their rows would be searched in the wrong half of acsearch.

### Batch B — keys that need a guard already in the file

Every one of these reads correctly with the stated guard, and every one survived its danger sentence.
`plateName` where the catalogue is cited by volume, `surname` otherwise.

| Key | Example citation | Number shape | Guard | The sentence that would falsely trigger it — and what stops it |
|---|---|---|---|---|
| **Bodenstedt** | `Bodenstedt Em. 46`, `Bodenstedt 45` | digits, often behind `Em.` | `surname` + the `Em` infix (Batch C) | `Bodenstedt 1981.` — a bare year. Nothing stops it; see §3. |
| **Klat** | `Klat 686` | digits, sometimes a letter (`4b`) | `surname` | `Klat 2002.` — bare year, unstopped. `Wasit, AH 96. Klat 686` reads both correctly. |
| **Balog** | `Balog 229` | digits | `surname` | `Ex the Balog collection, 1980. Album 1000.` → **no row** (provenance cut). `Balog 1980.` → leaks; §3. |
| **Schindel** | `Schindel 12`, `Schindel III 12` | digits, sometimes a volume | `plateName` | `Schindel 2004.` → leaks, §3. Separately, `Schindel III/1 12` → **no row** (the `/` in the volume) — a miss, not a wrong row. |
| **Cribb** | `Cribb 12` | digits | `notHouse('&', surname('Cribb'))` | **`Jongeward & Cribb 123`.** With a plain `surname('Cribb')` this reads as **`Cribb 123`** and the Jongeward row is lost — it broke the repo's own test 36. The `(?<!&\s)` lookbehind fixes it; 42/42 then pass. |
| **Rosenfield** | `Rosenfield 123` | digits | `surname` | `Published by Rosenfield 1967. Gobl 57.` → **no row** (`published by` cue). `Rosenfield 1967.` bare → leaks; §3. |
| **Van Arsdell** | `Van Arsdell 1732` | 3–4 digits | `surname` (a literal space, as `Van Meter` already has) | `Ex Van Arsdell 1989, lot 12. ABC 2445.` → **no row** (provenance cut). `Van Arsdell 1989.` bare → leaks; §3. `clean()` has already squashed runs of spaces to one, so the literal space is safe. |
| **Delestrée** / **Delestree** | `Delestrée 240` | digits | `surname` ×2, accented and ASCII, as `Köln`/`Koeln`/`Koln` already are | `Delestree 2002, pl. 12. DT 240.` → **no row** (the `pl.` behind the year is bibliographic evidence). Both spellings reproduced reading. |
| **Ashton** | `Ashton 209` | digits | `surname` | `Ex the Ashton hoard, found at Ashton 1985. ABC 1567.` → **no row** — the provenance cut takes the sentence. `Found at Ashton 1985.` on its own would leak; see §3. |
| **Draganov** | `Draganov 434` | digits | `surname` | `Draganov 2000.` → leaks, §3. Nothing else in a Paeonian lot is spelled this way. |
| **Howgego** | `Howgego 123` | digits | `surname` | `Countermark discussed by Howgego 1985.` → **no row** (`discussed by` cue). `Howgego 1985.` bare → leaks; §3. |
| **Sabatier** | `Sabatier 6` | digits, often 1–2 | `surname` | `Sabatier 1862.` — bare year, unstopped. |
| **Wroth** | `Wroth 88` | digits | `surname` | `Wroth 1908 catalogued this.` → **no row** (`catalogued` is in `ARGUES`). |
| **Goodwin** | `Goodwin 123` | digits | `surname` | A common English surname, so two were tried: `Ex the Goodwin collection. Album 3512.` → **no row** (provenance cut); `Goodwin 2005 discusses the mint. Album 3512.` → **no row** (`discusses` is in `ARGUES`). |
| **Artuk** | `Artuk 1234` | digits | `surname` | `ARTUQID. Artuk bin Eksuk, AH 495-502. AE Dirham. Album 1827.` → **no row** — the dynasty's founder has a word, not a digit, after his name. `Artuk 1970.` → leaks; §3. |
| **Vives** | `Vives 123` | digits | `surname` | Spanish *vives*, "you live" — lower case, and `keyAt` demands a capital. No row. |
| **Saeedi** | `Saeedi 345` | digits | `surname` | `Saeedi 2007.` → leaks, §3. No other reading in a Sasanian lot. |
| **Paruck** | `Paruck 345` | digits | `surname` | `Paruck 1924.` → leaks, §3. No other reading. |
| **Vondrovec** | `Vondrovec 345` | digits | `surname` | `Vondrovec 2014, vol. II. SNS II 12.` → **no row** (`vol.` behind the year). Bare `Vondrovec 2014.` → leaks; §3. |
| **Lorber** | `Lorber 12` | digits | `surname` | `Purchased from the Lorber estate, 2019. CPE B123.` → **no row** (provenance cut). `Lorber 2018 lists two. CPE B123.` → **no row** (`lists` is in `ARGUES`). Bare `Lorber 2018.` → leaks; §3. |
| **Pangerl** | `Pangerl 45` | digits | `surname` | `Pangerl 2013.` → leaks, §3. No other reading. |
| **Karayotov** | `Karayotov I, 45` | Roman volume, then digits | `plateName` | `Karayotov 1994.` → leaks, §3. No other reading. |
| **Von Fritze** | `Von Fritze I, 134` | Roman volume, then digits | `plateName` | `Von Fritze 1912.` — bare year, leaks; §3. **And one coverage limit worth knowing:** `von Fritze I, 134` with a lower-case *von* gives **no row at all**, because `keyAt` demands a capital. Only the capitalised spelling reads. |

**Also safe but deferred** — all reproduced reading, all survived their danger sentences, all cut in §5:
`Lianta`, `Anastasi` (`Anastasius I, 491-518` correctly gives no row — the `-us` blocks the key boundary),
`Spahr`, `Ranieri`, `Ulrich-Bansa`, `Waddington`, `Imhoof-Blumer`, `Jurukova`, `Werz`, `Zambaur`, `Damali`,
`Kellner`, `Ziegaus`, `Castelin`, `Paulsen`, `Kinns`, `Konuk`, `Regling`, `Desneux`, `Hurter`, `Gitler`,
`Topalov`, `Pieper`, `Fishman`, `Deyell`, `Altekar`, `Mionnet`, `Martini`, `Krzyzanowska`, `Hartill`,
`Schjöth`/`Schjoth`, `Duplessy`, `Boudeau`, `Poey d'Avant`, `Dannenberg`, `Dbg`, `Hävernick`/`Havernick`,
`Huszár`/`Huszar`, `Herinek`, `Feuardent`, `Dalton & Hamer`, `SCBC`, `CNI`, `CNA`, `PCPC`, `LPC`, `JNDA`, `D&H`.

### Batch C — one new guard, and one only

**`Em` in the kept-infix list.** One catalogue in the whole list needs it: Bodenstedt numbers his Mytilene
hektai by emission and dealers write `Bodenstedt Em. 46`. `Em.` is neither an edition word (it is part of the
reference, not a remark on the book) nor currently anything, so the key never reaches its number.

```js
// today
const KEPT = String.raw`(?:[&-]\s*\p{Lu}\p{L}+|\(?(?:[Pp]ls?|Eng|Engl|ISCH|BnF|Sidon|[Gg][ée]n[ée]rale?)\.?\)?)`;
// proposed — one token added
const KEPT = String.raw`(?:[&-]\s*\p{Lu}\p{L}+|\(?(?:[Pp]ls?|Eng|Engl|ISCH|BnF|Sidon|Em|[Gg][ée]n[ée]rale?)\.?\)?)`;
```

What the guard must do: allow the literal word `Em` (with or without a full stop) between a key and its number,
and **keep it in the reference text**, because `Bodenstedt Em. 46` and `Bodenstedt 46` are different numbers in
that book.

Side effects, all reproduced against 0.24 with and without the change:

| Line | Today | With the change |
|---|---|---|
| `Gobl Em. 60` | `Gobl Em. 60` | `Gobl Em. 60` — unchanged, and this is how Göbl's Hunnic emissions are cited |
| `Emission 3, Rome. RIC 12.` | `RIC 12` | `RIC 12` — unchanged |
| `Em. 12` alone | nothing | nothing — `Em` is only an infix, never a key |
| `Emmett 838 (R2)` | `Emmett 838` | `Emmett 838` — unchanged |

`node --test` on the repo's own `lot.test.mjs`: **42/42 with this change in place.**

**Two guards I built, tested, and then threw away.** Both are in the scratchpad; neither should be written.

- *A volume numeral carrying a letter* (`[IVXL]+\p{Ll}?`) for `SNAT XIVa`. Not needed: `SNAT` as a plain key
  already reads `SNAT XIVa 456` and `SNAT Ia 123`, because `BODY` takes up to four words before the digit. No
  customer, no guard.
- *A die-study number opening on a capital glued to its digits* (`\p{Lu}\d`) for Callataÿ's `D21/R3`. The
  audit named Diler's `Ab-123` as the other customer — but **`Diler Ab-123` already reads at 0.24**, because
  0.23's `NUMBER` accepts a letter token with a separator. That leaves Callataÿ alone, and Callataÿ is Batch D.

### Batch D — do not add these

| Key | Why not — reproduced unless marked |
|---|---|
| **Albert** | **It breaks the repo's own test 25**, which was written on purpose: `SAXONY. Albert 1485-1500. Groschen. KM# 12.` yields **`Albert 1485-1500`** as a reference. That test's comment already settled this: "Albert I and II head Belgian, Monegasque and Saxon lots far more often than Rainer Albert's handbook is cited." The audit did not know the test existed. |
| **Callataÿ** | The real citation is `Callataÿ pl. 12, D22` — with a `pl.` allowed through, that reads as **`Callatay pl. 12`**, the plate number, not the die pair. A wrong number is worse than no number. `de Callataÿ D21/R3` reads as **nothing**, because the lower-case `de` fails `keyAt` and the longer alternative swallows the shorter one. And a die pair is unique to one coin: the acsearch phrase would find nothing by construction. |
| **Kent** | `CELTIC. AV Stater. Found in Kent 1987. ABC 2445.` → **`Kent 1987`** and `ABC 2445`. A find-spot with a find date is ordinary British lot text. (`Kent, 1987` with a comma happens to be dropped — that is an accident of `NUMBER_ONLY`, not a guard.) |
| **Miles** | `Miles 123 were struck at Rome. RIC II 234.` → **`Miles 123`**. Capitalised at the start of a sentence, "Miles" is an ordinary English word; nothing in the file distinguishes it. |
| **Demo** | `Demo 45 is the Croatian corpus. MEC 1, 132.` → **`Demo 45`**. Same shape of problem. |
| **Rudd** | `Rudd 123. ABC 1567.` → **`Rudd 123`**. Chris Rudd's own stock numbers are written exactly that way. `Ex Chris Rudd 123` is saved only by the provenance cut; a dealer who writes it without "Ex" is not. And `ABC` — Rudd's own book — is already a key. |
| **Rajgor** | `Rajgor 24, lot 112. Senior 12.` → **`Rajgor 24`**. The `SALE` guard only covers keys in `HOUSE_KEY`; Rajgor's Auctions is not in it, and putting it there would mean adding the key *and* an exception for it. |
| **Arslan** | `SELJUQ. Alp Arslan 1063-1072 AD. AR Dirham. Album 1670.` → **`Arslan 1063-1072`**. Two Seljuq sultans are called Arslan; the reign dates follow the name. (`Kilij Arslan IV 1248-1265` is safe — the regnal numeral blocks it — but `Alp Arslan` has none.) |
| **Evans** | `CELTIC. Evans 1890. VA 1732.` → **`Evans 1890`**. Sir John Evans's *Coins of the Ancient Britons* is cited by year as often as by number, and "Evans" is one of the commonest British surnames in provenance. |
| **Pere, Toda, Coole, Unger, Elias, Gomes, Barker, Whitehead, Ciani, GH, FD** | Ordinary words in the languages these lots are written in (`toda`, `père`, `unger`), very common surnames, or two-letter acronyms. Each was reproduced firing on its own citation, which is the point — there is nothing in the file to tell them apart from the noise. `GH 456` fires after `Good VF.` and `D&H 45` after it too; neither is *wrong*, but two letters is the same delicacy as the `C`/`S` keys, which carry the most careful guard in the file. Not for a release that is supposed to reduce invented rows. |
| **Berk, Spink, Gadoury, Cayón, Craig, Allen, North, King, Pink, bare `S.`, `Fr.`, `Rec.`, `HN`, `A-`, `Zeno`, `N#`** | Round 1 and round 2 both said no. Re-ran all of them: still nothing, still right. |

---

## 2. Every key in this plan was run before it was proposed

The scratchpad holds four scripts — `sweep.mjs` (coverage), `patch.mjs` / `patch2.mjs` (build the patched
readers), `danger.mjs` (false positives) and a copy of the repo's `lot.test.mjs` with its import redirected.
Nothing was proposed that was not run. The recommended 26, on a realistic lot line, today and with the plan:

| Line | Today | With the plan |
|---|---|---|
| `LESBOS, Mytilene. EL Hekte. Bodenstedt Em. 46; SNG Cop 312.` | `SNG Cop 312` | `Bodenstedt Em. 46`, `SNG Cop 312` |
| `INDO-SCYTHIAN. Azes II. AR Tetradrachm. MACW 2158; Senior 98.245T.` | `Senior 98.245T` | `MACW 2158`, `Senior 98.245T` |
| `UMAYYAD. AR Dirham. Wasit, AH 96. Klat 686; Album 128.` | `Album 128` | `Klat 686`, `Album 128` |
| `SAMANID. AR Dirham. SNAT XIVa 456; Album 1449.` | `Album 1449` | `SNAT XIVa 456`, `Album 1449` |
| `MAMLUK. AR Dirham. Balog 229; Album 1000.` | `Album 1000` | `Balog 229`, `Album 1000` |
| `SASANIAN. Shapur II. AR Drachm. Schindel 12; SNS II 12.` | `SNS II 12` | `Schindel 12`, `SNS II 12` |
| `KUSHAN. Vima Kadphises. AV Dinar. Cribb 12; MACW 3005.` | *(nothing)* | `Cribb 12`, `MACW 3005` |
| `KUSHAN. Kanishka I. AV Dinar. Rosenfield 123; Gobl 57.` | `Gobl 57` | `Rosenfield 123`, `Gobl 57` |
| `CELTIC, Britain. AV Stater. Van Arsdell 1732; ABC 2445.` | `ABC 2445` | `Van Arsdell 1732`, `ABC 2445` |
| `CELTIC, Gaul. AV Stater. Delestrée 240; DT 240.` | `DT 240` | `Delestrée 240`, `DT 240` |
| `CARIA, Rhodes. AR Drachm. Ashton 209; SNG Keckman 552.` | `SNG Keckman 552` | `Ashton 209`, `SNG Keckman 552` |
| `PAEONIA. Patraos. AR Tetradrachm. Draganov 434; SNG ANS 1035.` | `SNG ANS 1035` | `Draganov 434`, `SNG ANS 1035` |
| `BYZANTINE. Phocas. AE Follis. MIRB 12; SB 640.` | `SB 640` | `MIRB 12`, `SB 640` |
| `ROMAN. AE As, countermarked. Howgego 123; RIC I 543.` | `RIC I 543` | `Howgego 123`, `RIC I 543` |
| `BYZANTINE. Justinian I. AE Follis. Sabatier 6; SB 163.` | `SB 163` | `Sabatier 6`, `SB 163` |
| `VANDALS. Gunthamund. AR Siliqua. Wroth 88; MEC 1, 21.` | `MEC 1, 21` | `Wroth 88`, `MEC 1, 21` |
| `ARAB-BYZANTINE. AE Fals. Goodwin 123; Album 3512.` | `Album 3512` | `Goodwin 123`, `Album 3512` |
| `ARTUQID. AE Dirham. Artuk 1234; Album 1827.` | `Album 1827` | `Artuk 1234`, `Album 1827` |
| `SPAIN, Umayyad. AR Dirham. Vives 123; Album 340.` | `Album 340` | `Vives 123`, `Album 340` |
| `SASANIAN. Khusro II. AR Drachm. Saeedi 345; SNS III 12.` | `SNS III 12` | `Saeedi 345`, `SNS III 12` |
| `SASANIAN. Ardashir I. AR Drachm. Paruck 345; SNS I 12.` | `SNS I 12` | `Paruck 345`, `SNS I 12` |
| `HUNNIC. Alchon. AR Drachm. Vondrovec 345; Gobl Em. 60.` | `Gobl Em. 60` | `Vondrovec 345`, `Gobl Em. 60` |
| `PTOLEMAIC. Ptolemy II. AE Drachm. Lorber 12; CPE B123.` | `CPE B123` | `Lorber 12`, `CPE B123` |
| `MYSIA, Kyzikos. EL Stater. Von Fritze I, 134; SNG France 12.` | `SNG France 12` | `Von Fritze I, 134`, `SNG France 12` |
| `THRACE, Mesembria. AV Stater. Karayotov I, 45; SNG Cop 12.` | `SNG Cop 12` | `Karayotov I, 45`, `SNG Cop 12` |
| `ROMAN. AE As, countermarked. Pangerl 45; RIC I 543.` | `RIC I 543` | `Pangerl 45`, `RIC I 543` |

**Known limits of the recommended set**, reproduced and accepted (each is a miss, never a wrong number):

- `Schindel III/1 12` — a `/` inside the volume. `Schindel 12` and `Schindel III 12` read.
- `Krzyzanowska VI/12` — same. (Deferred key anyway; `VI, 12` reads.)
- `Mionnet Suppl. VII, 12` — `Suppl.` is in neither word list. (Deferred key.)
- `Poey d'Avant 1234` reads with a straight apostrophe, **not** with a curly `’`; `clean()` does not fold it.
  (Deferred key — but worth knowing, because the same hole exists for any key with an apostrophe.)

---

## 3. The one danger the whole batch shares: a year at the end of a sentence

This is not a property of any new key. It is already true of every surname key in the file, and the project has
already decided it is acceptable. Reproduced against **0.24 as it stands, no changes**:

| Line | Listed today |
|---|---|
| `GREEK. AR Tetradrachm. Newell 1938. SNG Cop 12.` | **`Newell 1938`**, `SNG Cop 12` |
| `JUDAEA. Prutah. Hendin 2010. TJC 234.` | **`Hendin 2010`**, `TJC 234` |
| `ROMAN. Sommer 1994. RIC II 45.` | **`Sommer 1994`**, `RIC II 45` |
| `BYZANTINE. Grierson 1982. SB 139.` | **`Grierson 1982`**, `SB 139` |

`lot.js` says why, in its own comment above `OVER_RANGE`: a bare 1500–2100 number is kept unless a citation cue
stands in front of it or a page, plate or verb of argument stands behind it, "since Price runs past 3900 and
Sear, Hendin, Svoronos and SNG Copenhagen all have real numbers in that range, and losing one of those costs the
collector more than a stray prices-only row does." `tests/lot.test.mjs` test 40 writes the same decision down:
`A rare provincial bronze. Butcher 2004. Prieur 123.` keeps **both**.

So `Klat 2002.`, `Sabatier 1862.`, `Von Fritze 1912.`, `Bodenstedt 1981.` will each give a stray prices-only
row in a bibliography sentence, exactly as `Newell 1938` does. **That is the accepted behaviour, and it is the
main reason not to add sixty names.** Every surname key is one more author whose publication year can be
mistaken for a number — and unlike Sear or Hendin, none of these books has real numbers up in the 1900s, so
none of them earns the exemption the comment was written for.

A future release could narrow `OVER_RANGE` to "any surname key whose catalogue has no number above 1500" and
kill all of it at once. That would be worth more than this whole plan. It is **not** in scope here.

---

## 4. What this does to the acsearch search, and where it stops being useful

Every row here is `catalogue: 'Other'`, so the card is **prices only** and the search term is
`otherTerm(number)` — the dealer's own string, as one exact phrase. Run through the real `defaultTerm`:

| Row | acsearch term | CoinArchives term |
|---|---|---|
| `Bodenstedt Em. 46` | `"Bodenstedt Em. 46"` | `Bodenstedt Em. 46` |
| `MACW 2158` | `"MACW 2158"` | `MACW 2158` |
| `Klat 686` | `"Klat 686"` | `Klat 686` |
| `SNAT XIVa 456` | `"SNAT XIVa 456"` | `SNAT XIVa 456` |
| `Von Fritze I, 134` | `"Von Fritze I, 134"` | `Von Fritze I, 134` |
| `Callatay D21/R3` | `"Callatay D21/R3"` | `Callatay D21/R3` |

**Batch A's phrase is the phrase.** `MACW 2158`, `MIRB 12`, `SNAT XIVa 456` — an acronym and a number is the
only way anyone writes them, so what the dealer writes and what the sale descriptions on acsearch contain are
the same string. Good.

**Batch B's phrase is the phrase for the plain-digit keys** (`Klat 686`, `Balog 229`, `Ashton 209`,
`Draganov 434`, `Van Arsdell 1732`, `Rosenfield 123`, `Vives 123`, `Saeedi 345`, `Howgego 123`) and **not** for
four of them:

- **`Bodenstedt Em. 46`** — the same coin is cited `Bodenstedt 46` and `Bodenstedt Em 46` as often as with the
  full stop. The exact phrase finds one of the three. Reading it right and searching it narrow is still better
  than not reading it, but the collector will sometimes have to edit the term.
- **`Delestrée 240` vs `Delestree 240`** — two different phrases. The reader will now understand both, but the
  *search* keeps whichever the dealer wrote, so an accented paste finds only accented sales. `prices.js`
  already solves exactly this shape for Sear (`("Sear 6829" "SG 6829")`) and Krause
  (`("KM 123" "Krause/Mishler 123")`); it does not do it for accents. Same for `Schjöth`, `Hävernick`,
  `Huszár` — all deferred.
- **`Von Fritze I, 134`** and **`Karayotov I, 45`** — dealers also write `von Fritze 134` and `Fritze I 134`.
  The volume in the phrase narrows it.
- **`Sabatier 6`**, **`PCPC 1`** — a one-digit number inside an exact phrase is short enough to be noise.

**Flagged as too noisy to be useful even when read correctly:** `Callatay D21/R3` (a die pair belongs to one
coin — there is nothing to median), `GH 456` and `FD 123` (two letters plus a number will appear inside
unrelated text), `Sabatier 6`, `PCPC 1`, `LPC 45` (one- and two-digit numbers behind a rare abbreviation).

**And the finding that decides §5.** `searchCategory` sends a row to acsearch's **Modern coins** category only
when every part of it is Krause. Reproduced:

| Row | acsearch category | CoinArchives section |
|---|---|---|
| `SCBC 1490` | **1 — Ancient coins** | `a` |
| `Duplessy 213` | **1 — Ancient coins** | `a` |
| `Hartill 22.1279` | **1 — Ancient coins** | `a` |
| `JNDA 01-23` | **1 — Ancient coins** | `a` |
| `Huszar 123` | **1 — Ancient coins** | `a` |
| `D&H 45` | **1 — Ancient coins** | `a` |
| `KM# 123` | 2 — Modern coins | `w` |

An English hammered penny, a French gros, a Qing cash and a Meiji yen would all be searched in the Ancients
category and in the ancients half of CoinArchives, where they cannot exist. The row would read correctly and
find nothing, every time. **Every medieval, East Asian, Ottoman and British-token key in the audit's Tier 2 is
therefore off the table until `searchCategory` learns about them** — which is its own change, in `prices.js`,
not this one.

*(Aside, its own ticket: `kmPart` in `prices.js` does not recognise `KM# Y-A25.1`, a real Krause spelling for
Japan, so even that row falls back to the Ancients category. Nothing here depends on it.)*

---

## 5. What not to do, and the cut-off

**The plainest fact in this whole investigation:** typing `Klat 686` into the Reference box **already works
today**, with no key at all. Reproduced — `parseReference('Klat 686')` returns an `Other` reference and the term
is `"Klat 686"`. The `KEYS` table only matters for text that is *pasted as a whole lot*. So what these 102 names
buy is not "can the extension price this coin" — it always could — but "does the reference get lifted out of a
paragraph automatically". That is worth real convenience, and it is worth nothing at all if the row it lifts out
is wrong.

**So the cut-off is: add a name only if all four are true.**

1. It reads correctly on the form dealers actually write, reproduced.
2. Its danger sentence produces no row, reproduced.
3. Its search phrase is the phrase acsearch would hold — an ancient coin, and a number long enough to be
   distinctive.
4. The catalogue is the *primary* reference on coins that trade in volume, not a die study cited beside a
   primary reference that is already a key.

**26 names pass.** Rule 4 is what cuts the list from about fifty to twenty-six, and it is the honest one: `SNG Cop`, `SNG ANS`,
`HGC`, `RPC`, `Album`, `SB`, `MEC`, `Dembski`, `Varbanov` and `Meshorer` are already keys, and on nearly every
lot where `Kinns`, `Konuk`, `Regling`, `Desneux`, `Hurter`, `Jurukova`, `Topalov`, `Krzyzanowska`, `Ranieri` or
`Ulrich-Bansa` appears, one of those stands beside it and the lot already gives a row. Adding the die study buys
a second row for the same coin, with a rarer phrase that will more often come back empty.

**Box-ticking, in my judgement — every one of these is safe, and none of them earns its line:**

| Cut | Why |
|---|---|
| `Kinns`, `Konuk`, `Regling`, `Desneux`, `Hurter`, `Gitler`, `Topalov`, `Jurukova`, `Krzyzanowska`, `Mionnet`, `Imhoof-Blumer`, `Waddington` | Regional die studies and 19th-century corpora. Always cited beside `SNG`, `BMC` or `RPC`, which already read. |
| `Lianta`, `Anastasi`, `Spahr`, `PCPC`, `LPC` | Late-Byzantine and Byzantine Sicily. `SB` and `DOC` already read on every one of those lots, and the numbers are one or two digits. |
| `Ranieri`, `Ulrich-Bansa`, `Demo`, `Arslan` | Migration period. `MEC` already reads; two of the four are Batch D anyway. |
| `Pieper`, `Fishman`, `Deyell`, `Altekar`, `Whitehead`, `Rajgor`, `GH` | India. Far from this collection, and `MACW` (which *is* in the 26) is the one a Western seller writes. |
| `Hartill`, `Schjöth`, `FD`, `Coole`, `JNDA`, `Toda`, `Barker` | East Asia. Searched in the wrong acsearch category (§4). If any one ever goes in, `Hartill` alone. |
| `SCBC`, `Duplessy`, `Ciani`, `Boudeau`, `Poey d'Avant`, `CNI`, `Dannenberg`, `Dbg`, `Hävernick`, `Huszár`, `Unger`, `Herinek`, `CNA`, `Elias`, `Gomes`, `D&H`, `Dalton & Hamer`, `Feuardent`, `Damali`, `Pere` | Medieval and modern Europe, Ottoman, tokens, jetons. Same wrong-category problem, on top of the `Elias`/`Unger`/`Pere` word risk. |
| `Martini`, `Werz`, `Zambaur`, `Kellner`, `Ziegaus`, `Castelin`, `Paulsen` | Genuinely marginal. `Pangerl` is in the 26 because countermark lots cite it alone; `Martini` is the same book family but also the commonest Italian surname there is. |
| **Everything in Batch D** | §1. |

**And the thing to do instead.** The audit's own §6 said the reading fixes were worth more than any new key,
and after re-running everything I agree, with one correction: **two of its three have already been done.** 0.23
fixed the intervening-word rule (12 of 16 forms recovered) and the provenance cut (all five lines recovered).
What is left is **the year rule** — §3 above, 20 reproduced junk rows at 0.21 and still leaking today on
`Newell 1938`, `Hendin 2010`, `Sommer 1994`, `Grierson 1982`. Narrowing `OVER_RANGE` to every surname key whose
catalogue has no number above 1500 would remove more wrong rows than these 26 keys add right ones. **If only
one thing gets built, build that, not this.**

---

## 6. The change

One file, `extension/lot.js`. Nothing else in `extension/` is touched — no `popup.js`, no `lookup.js`, no
`prices.js`, so the 0.25 work in flight is untouched.

### 6.1 `KEPT` gains one token

As in Batch C. Widen the comment above `DROPPED`/`KEPT` by one clause: an emission tag is part of the reference,
like a plate.

### 6.2 `notHouse`'s comment widens

`notHouse('&', surname('Cribb'))` uses the existing helper for a new purpose: not an auction house's forename
but a co-author's ampersand. The comment above it currently reads "Two catalogues carry an auction house's name
as well"; it should say that the same lookbehind keeps a second author from stealing the first author's
reference (`Jongeward & Cribb 123`).

### 6.3 `KEYS` gains 27 entries (26 catalogues — Delestrée is there twice, accented and plain)

Placed in the existing area comments, not in a block of their own:

```js
// Roman provincial and the Levant — countermarks.
surname('Howgego'), surname('Pangerl'),
// the Greek world
surname('Bodenstedt'), surname('Ashton'), surname('Draganov'), plateName('Von Fritze'), plateName('Karayotov'),
// Seleucid and Ptolemaic, then the East
surname('Lorber'), plateName('Schindel'), surname('Saeedi'), surname('Paruck'), surname('Vondrovec'),
'MACW', notHouse('&', surname('Cribb')), surname('Rosenfield'),
// Byzantium and after, then the Celts and the Islamic world
'MIRB', surname('Sabatier'), surname('Wroth'), surname('Van Arsdell'), surname('Delestrée'), surname('Delestree'),
'SNAT', surname('Klat'), surname('Balog'), surname('Goodwin'), surname('Artuk'), surname('Vives'),
```

Ordering does not matter (the audit proved the trailing boundary makes the engine backtrack), but keep the
single letters last, as the file's own comment asks.

**Nothing else changes.** No new helper, no change to `NUMBER`, `NUMBER_ONLY`, `plate`, `publicationYear`,
`SALE`, `PERSON_KEY` or `withoutProvenance`.

---

## 7. Tests

In `tests/lot.test.mjs`, in that file's existing style — `texts(...)`, `only(...)`, `other(...)`, a comment
above each group saying what rule it pins. Three new `test(...)` blocks, and one line added to an existing one.

```js
test('the countermark, Kushan, Sasanian and Islamic corpora are keys', () => {
  // Each is cited as the whole reference, so the surname guard is enough; every line also carries a key that reads today.
  assert.deepEqual(texts('ROMAN. AE As, countermarked. Howgego 123; RIC I 543.'), ['Howgego 123', 'RIC I 543']);
  assert.deepEqual(texts('ROMAN. AE As, countermarked TIB IM. Pangerl 45. RIC I 543.'), ['Pangerl 45', 'RIC I 543']);
  assert.deepEqual(texts('KUSHAN. Kanishka I. AV Dinar. Rosenfield 123; Gobl 57.'), ['Rosenfield 123', 'Gobl 57']);
  assert.deepEqual(texts('SASANIAN. Shapur II. AR Drachm. Schindel 12; SNS II 12.'), ['Schindel 12', 'SNS II 12']);
  assert.deepEqual(texts('SASANIAN. Khusro II. AR Drachm. Saeedi 345; SNS III 12.'), ['Saeedi 345', 'SNS III 12']);
  assert.deepEqual(texts('SASANIAN. Ardashir I. AR Drachm. Paruck 345; SNS I 12.'), ['Paruck 345', 'SNS I 12']);
  assert.deepEqual(texts('HUNNIC. Alchon. AR Drachm. Vondrovec 345; Gobl Em. 60.'), ['Vondrovec 345', 'Gobl Em. 60']);
  assert.deepEqual(texts('UMAYYAD. AR Dirham. Wasit, AH 96. Klat 686; Album 128.'), ['Klat 686', 'Album 128']);
  assert.deepEqual(texts('MAMLUK. AR Dirham. Balog 229; Album 1000.'), ['Balog 229', 'Album 1000']);
  assert.deepEqual(texts('ARAB-BYZANTINE. AE Fals. Goodwin 123; Album 3512.'), ['Goodwin 123', 'Album 3512']);
  assert.deepEqual(texts('ARTUQID. AE Dirham. Artuk 1234; Album 1827.'), ['Artuk 1234', 'Album 1827']);
  assert.deepEqual(texts('SPAIN, Umayyad. AR Dirham. Vives 123; Album 340.'), ['Vives 123', 'Album 340']);
  // A plain key needs no guard: SNAT carries its volume as a word, and MIRB is not swallowed by MIR.
  assert.deepEqual(texts('SAMANID. AR Dirham. SNAT XIVa 456; Album 1449.'), ['SNAT XIVa 456', 'Album 1449']);
  assert.deepEqual(texts('SAMANID. AR Dirham. SNAT Ia 123.'), ['SNAT Ia 123']);
  assert.deepEqual(texts('INDO-SCYTHIAN. AR Tetradrachm. MACW 2158; Senior 98.245T.'), ['MACW 2158', 'Senior 98.245T']);
  assert.deepEqual(texts('ROMAN. AR Antoninianus. MIR 12; MIRB 34. RIC V 45.'), ['MIR 12', 'MIRB 34', 'RIC V 45']);
  assert.deepEqual(texts('BYZANTINE. Phocas. AE Follis. MIRB 12; SB 640.'), ['MIRB 12', 'SB 640']);
  // Byzantine and Vandal, beside the keys that already read.
  assert.deepEqual(texts('BYZANTINE. Justinian I. AE Follis. Sabatier 6; SB 163.'), ['Sabatier 6', 'SB 163']);
  assert.deepEqual(texts('VANDALS. Gunthamund. AR Siliqua. Wroth 88; MEC 1, 21.'), ['Wroth 88', 'MEC 1, 21']);
  // The Greek keys, one of them cited by plate volume.
  assert.deepEqual(texts('CARIA, Rhodes. AR Drachm. Ashton 209; SNG Keckman 552.'), ['Ashton 209', 'SNG Keckman 552']);
  assert.deepEqual(texts('PAEONIA. Patraos. AR Tetradrachm. Draganov 434; SNG ANS 1035.'), ['Draganov 434', 'SNG ANS 1035']);
  assert.deepEqual(texts('MYSIA, Kyzikos. EL Stater. Von Fritze I, 134; SNG France 12.'), ['Von Fritze I, 134', 'SNG France 12']);
  assert.deepEqual(texts('THRACE, Mesembria. AV Stater. Karayotov I, 45; SNG Cop 12.'), ['Karayotov I, 45', 'SNG Cop 12']);
  assert.deepEqual(texts('PTOLEMAIC. Ptolemy II. AE Drachm. Lorber 12; CPE B123.'), ['Lorber 12', 'CPE B123']);
  // The Celtic names, beside the abbreviations that already read.
  assert.deepEqual(texts('CELTIC, Britain. AV Stater. Van Arsdell 1732; ABC 2445.'), ['Van Arsdell 1732', 'ABC 2445']);
  assert.deepEqual(texts('CELTIC, Gaul. AV Stater. Delestrée 240; DT 240.'), ['Delestrée 240', 'DT 240']);
  assert.deepEqual(texts('CELTIC, Gaul. AV Stater. LT XXII 1234; Delestree 240.'), ['LT XXII 1234', 'Delestree 240']);
  // Every one of them is prices only, and the row is the text the dealer wrote.
  assert.deepEqual(only('MAMLUK. AR Dirham. Balog 229.'),
    { text: 'Balog 229', reference: other('Balog 229'), cf: false, variant: false, typed: false });
});

test('an emission tag belongs to the reference, and a co-author does not steal it', () => {
  // Bodenstedt numbers Mytilene by emission, so "Em." is part of the number, not a remark on the book.
  assert.deepEqual(texts('LESBOS, Mytilene. EL Hekte. Bodenstedt Em. 46; SNG Cop 312.'), ['Bodenstedt Em. 46', 'SNG Cop 312']);
  assert.deepEqual(texts('LESBOS, Mytilene. EL Hekte. Bodenstedt Em 46.'), ['Bodenstedt Em 46']);
  assert.deepEqual(texts('LESBOS, Mytilene. EL Hekte. Bodenstedt 46.'), ['Bodenstedt 46']);
  const found = only('LESBOS, Mytilene. EL Hekte. Bodenstedt Em. 46.');
  assert.equal(lotLabel(found, []), 'Bodenstedt Em. 46 · prices only');
  // Göbl's Hunnic emissions read the same way, as they did before.
  assert.deepEqual(texts('HUNNIC. AR Drachm. Gobl Em. 60.'), ['Gobl Em. 60']);
  // "Em" is an infix, never a key of its own, and no ordinary word starting with it becomes one.
  assert.deepEqual(texts('GREEK. AR Stater. Em. 12.'), []);
  assert.deepEqual(texts('ROMAN. AR Denarius. Emission 3, Rome. RIC 12.'), ['RIC 12']);
  assert.deepEqual(texts('EGYPT. Emmett 838 (R2).'), ['Emmett 838']);
  // Cribb is the second author of the Kushan corpus: his key must not take Jongeward's reference away.
  assert.deepEqual(texts('KUSHAN. Vima Kadphises. AV Dinar. Jongeward & Cribb 123.'), ['Jongeward & Cribb 123']);
  assert.deepEqual(texts('KUSHAN. Vima Kadphises. AV Dinar. Cribb 12; MACW 3005.'), ['Cribb 12', 'MACW 3005']);
  // The other co-author forms are unchanged.
  assert.deepEqual(texts('SAMARIA. AR Obol. Meshorer & Qedar 12.'), ['Meshorer & Qedar 12']);
  assert.deepEqual(texts('ALEXANDRIA. Tetradrachm. Dattari-Savio Pl. 123, 456.'), ['Dattari-Savio Pl. 123, 456']);
});

test('the names left out are left out, and a scholar’s year is still not a number', () => {
  // A ruler, a find-spot, a dealer and an ordinary English word all read as themselves, so none of them is a key.
  assert.deepEqual(texts('SAXONY. Albert 1485-1500. Groschen. KM# 12.'), ['KM# 12']);
  assert.deepEqual(texts('CELTIC, Britain. AV Stater. Found in Kent 1987. ABC 2445.'), ['ABC 2445']);
  assert.deepEqual(texts('SELJUQ. Alp Arslan 1063-1072 AD. AR Dirham. Album 1670.'), ['Album 1670']);
  assert.deepEqual(texts('CELTIC, Britain. AR Unit. Rudd 123. ABC 1567.'), ['ABC 1567']);
  assert.deepEqual(texts('INDIA. AR Drachm. Rajgor 24, lot 112. Senior 12.'), ['Senior 12']);
  assert.deepEqual(texts('ROMAN EMPIRE. Trajan. AR Denarius. Miles 123 were struck at Rome. RIC II 234.'), ['RIC II 234']);
  assert.deepEqual(texts('OSTROGOTHS. AE Nummus. Demo 45 is the Croatian corpus. MEC 1, 132.'), ['MEC 1, 132']);
  assert.deepEqual(texts('CELTIC, Britain. AV Stater. Evans 1890. VA 1732.'), ['VA 1732']);
  assert.deepEqual(texts('PONTOS. AR Tetradrachm. Callatay pl. 12, D22. SNG BM 1043.'), ['SNG BM 1043']);
  // A new key is a name like the others: a cue or a verb of argument in its own clause still says "book".
  assert.deepEqual(texts('ROMAN. AE As. Countermark discussed by Howgego 1985. RIC I 543.'), ['RIC I 543']);
  assert.deepEqual(texts('BYZANTINE. AE Follis. Wroth 1908 catalogued this. SB 163.'), ['SB 163']);
  assert.deepEqual(texts('GREEK. AR Drachm. See Ashton 1988, p. 12. SNG Keckman 552.'), ['SNG Keckman 552']);
  assert.deepEqual(texts('ISLAMIC. AR Dirham. Klat 2002, pl. 3. Album 128.'), ['Album 128']);
  // A provenance sentence still takes its own names with it.
  assert.deepEqual(texts('GREEK. AR Stater. From the Lorber estate, 2019. CPE B123.'), ['CPE B123']);
  assert.deepEqual(texts('CELTIC. AR Unit. Ex the Ashton hoard, found at Ashton 1985. ABC 1567.'), ['ABC 1567']);
});
```

**One line into the existing "the de-accented spellings are keys as their accented ones are" test**, beside
`Köln`/`Koln` and `Böhringer`/`Bohringer`:

```js
assert.deepEqual(texts('CELTIC, Gaul. AV Stater. Delestree 240.'), ['Delestree 240']);
```

**No change to `tests/lookup.test.mjs`, `tests/prices.test.mjs` or any fixture.** These rows are `Other`
references; `parseReference` and `defaultTerm` already handle them and were verified unchanged.

**All three blocks above were run, exactly as written, against a copy of `lot.js` carrying exactly the change
in §6: 3/3 pass, alongside the repo's own 42/42.** One assertion had to be dropped along the way and the reason
is worth keeping: `Gitler & Tal XV.12O` was in the first draft, and it fails — because `Gitler` is *cut*, so
there is no key to reach it. That is the rule working, not a bug. `Dattari-Savio Pl. 123, 456` stands in its
place as the co-author line that does read.

### Verification by hand, in the browser

At 440×680, acsearch signed in:

| Paste | Expect |
|---|---|
| a Mytilene hekte lot with `Bodenstedt Em. 46; SNG Cop 312` | two rows, both **prices only**, the first labelled `Bodenstedt Em. 46 · prices only` |
| an Umayyad dirham lot with `Klat 686; Album 128` | two rows; the `Klat 686` card searches `"Klat 686"` in Ancients |
| a Kushan lot with `Jongeward & Cribb 123` | **one** row, `Jongeward & Cribb 123` — not two |
| a Titus lot (`RIC 972; Cohen 17; BMC 319`) | unchanged from 0.25 |
| any lot with `Newell 1938.` in it | still gives the stray `Newell 1938` row — known, §3, not this release |

---

## 8. Size

| File | Change |
|---|---|
| `extension/lot.js` | 27 array entries (≈6 lines), 1 token in `KEPT`, 2 comment lines widened — **≈10 lines** |
| `tests/lot.test.mjs` | 3 new tests, ≈55 assertions — **≈70 lines** |
| `README.md` | one sentence in the paragraph that lists what the lot reader knows |
| `manifests/*.json` ×2 | version 0.26.0 |

**≈85 lines, one sitting.** The risk is concentrated in six characters (`Em|` in `KEPT` and `'&', ` in the
Cribb entry); everything else is data. The regression evidence is already in hand: the repo's 42 `lot.test.mjs`
tests pass against a copy of `lot.js` carrying exactly this change.

---

*Method note: the probe scripts (`sweep.mjs`, `patch.mjs`, `patch2.mjs`, `danger.mjs`, and the redirected copy
of `lot.test.mjs`) live in the session scratchpad, not in the repo. They import copies of `extension/lot.js`,
`lookup.js`, `catalogues.js` and `prices.js` taken at `69ab39d` (0.24.0), so nothing here is affected by the
0.25 change in flight. acsearch and CoinArchives were never queried; every search-term claim comes from running
`prices.js`'s own functions.*

## Appendix: the Indian citation forms, confirmed on real dealer pages

Added after the plan was drafted, from a research pass over Stephen Album (SARC) catalogue PDFs, NumisBids, Zeno, CoinIndia and dealer listings. It is
evidence the plan asked for and could not get in time, and it **confirms three of the plan's rejections and adds one new one**:

- **Rajgor: reject, confirmed.** Rajgor's Auctions is a real auction house in Mumbai, and Dilip Rajgor's books are themselves sold as book lots
  ("D. Rajgor, Standard catalogue of Sultanate coins of India, New Delhi 1991, 230 pp."). The key is a house and a book title as often as a catalogue.
- **Whitehead: reject, the riskiest name examined.** Four confirmed collisions, all in coin text: the British Museum's `ex R.B. Whitehead bequest`
  provenance, `R.B. Whitehead, NC 1940` as an article author, the medal maker Whitehead & Hoag, and `W.B. Whitehead` as a token issuer's own name.
- **GH: reject.** `GH¢`/`GH₵` is the Ghanaian cedi's currency sign, so it appears in world listings, and case-insensitive matching on the letter pair
  catches Ghana, Ghaznavid, Ghorid and Lodz Ghetto. Also `Hardaker` alone is a different catalogue from `GH`, so the two must never be merged.
- **Altekar: a parse problem, not a name problem.** The surname is rare and safe, but it is almost never followed by a bare number — the real forms are
  `Altekar pl. II, 16` and `Altekar, Bayana Hoard # Pl. II-7`. A plain surname guard would mostly miss, or would read a plate number as a type number.

The house styles are worth recording whatever we add, since they shape every Indian and Islamic lot:

| House | Shape | Examples |
| --- | --- | --- |
| Stephen Album | `Name-Number`, hyphen, no space; names truncated to 2-3 letters; `var` glued on; `-` alone means unlisted | `Pieper-2753`, `Deyell-252`, `GH-109`, `De-253`, `TF-S5`, `Pieper-3601var` |
| CNG | `Name Number`, space, no hash; en-dash for "not in" | `Cf. Deyell 150`, `Rajgor Type 2331`, `Whitehead -` |
| Marudhar and Indian houses | `Author # Number`, spaces round the hash, in brackets, often after an initial | `(Deyell # 8a)`, `(W. Pieper # 195)`, `(A.M. Fishman # 21.1.158)` |
| Shopify dealers | contracted to the point of dropping the author | `(F&T#HS27)`, `(F/T #LH4)`, `(HS15)` |

Two of those shapes are ones the reader does not handle at all: **a hyphen with no space** (`Pieper-2753`) and **a hash with spaces round it**
(`Deyell # 8a`). That is worth more than any of the 26 keys — those forms cover every Indian and Islamic lot from two of the biggest sellers in the
area, for keys we already have. It should lead 0.26.

Numbers in this area are also not plain digits: letter-code numbers (`Fishman-7A`, `M54`, `HS27`, `LH4`), dotted numbers (`21.1.158`), variant suffixes
(`GH 61v4`), and glued `var`. Any key added here needs a number shape that admits them, or it will read the key and drop the number.

## Appendix 2: forty names checked against real dealer text

From a pass over CNG, Leu, Nomos, Künker, Gorny & Mosch, Stephen Album, Chris Rudd, Baldwin's, NumisBids, biddr, Zeno, WildWinds and the ANS. Two
findings reshape this plan; the rest are mechanics we should encode whatever we add.

### Eight names are not the string a dealer writes

Keying on the author gets near-zero recall on these, because the trade cites the work, not the writer:

| We would have added | What dealers actually write |
| --- | --- |
| Schindel | `SNS` (and never `Sch-`: 19 of 20 corpus hits are Scholten) |
| Lorber | `CPE`, bronze `CPE B454` |
| Ziegaus | `Flesche` / `Slg. Flesche` — the collection, not the author |
| Castelin (Swiss volume) | `SLM` |
| Rudd | `ABC` — and Chris Rudd Ltd is a dealer, so in a 50-lot Celtic sale "Rudd" appeared 15 times and **none** were references |
| Rosenfield / Jongeward & Cribb | `ANS Kushan` |
| Gitler | `Gitler & Tal`, never bare |
| Delestrée | `DT` |

Three more are never followed by a number at all: **Kinns** (always a page), **Topalov** (title, then `p. 337, 7`), **Zambaur** (a mint-and-date index —
zero lot hits anywhere; a `Zambaur \d+` rule would fire only on mistakes).

### The dangerous ones, with the sentence that proves it

- **Miles** — the worst of the forty. An ordinary English word, and a NumisBids search for it returns Greek electrum on the *Lydo-Milesian standard*,
  not Islamic coins at all. Also "ex Miles collection".
- **Pere** — the Catalan kings. `Pere III (1336-1387). Barcelona. Croat.` would be read as Pere 1336. (0.23's year rule catches the bare year; the
  bracketed reign date is what to watch.)
- **Van Arsdell's `VA`** — `Alexandria, VA 22314`. Capping the main number at four digits kills it, since ZIP codes are five.
- **Vives** — `Prieto y Vives` is a different catalogue entirely, and Spanish banknotes carry "Luis Vives".
- **Goodwin** — only half its hits are references, and a grade follows the name verbatim: `Goodwin, VF, RRR`.
- **Hurter** — an English noun, and Silvia Hurter ran Bank Leu, so her name is a cataloguer, an editor and a pedigree.
- **Ashton**, **Konuk** (Turkish for "guest"), **Kellner** (German for "waiter"), **Damali** (Turkish for "checkered"), **GH** (the Ghanaian cedi).

### Mechanics worth encoding whatever we add

- **A dash where a digit belongs means "not in this reference"** — `VA-`, `ABC-`, `Flesche -.`, `SLM -.`, `SNS--`, `Cribb---`. In one Chris Rudd sale
  `VA-,` appears fourteen times. Each is a row we must never list.
- **The separator is the house's, not the catalogue's**: hyphen at Stephen Album (`Pieper-2753`), space at CNG and Leu, **dot** at the museums
  (`Paruck.285`, `Klat.587b`, `Vondrovec.001A`), **colon** at some (`SNAT-XIVc:336`).
- **A word often sits between name and number**: `Em.` (Bodenstedt), `Type`/`Typ`, `Class`, `Pl.`, `p.`, `& Tal`, and `vergl.`/`vgl.` meaning compare.
- **A Roman numeral means four different things** — volume, group, plate or class, depending on the catalogue.
- **A grade token straight after a name is never a number**: VF, VG, XF, EF, UNC, MS, RRR.
- **`ex `, `Ex `, `Slg. ` or "From the ... Collection" in front of a surname means provenance**, not a reference. That one rule kills most bad Rudd,
  Evans, Hurter and Miles hits.
- **A hyphen is not always a range**: `VA 620-7` is a sub-number, `Paulsen 620-628` and `Regling 166-167` are ranges.

### What this does to the plan

The three names it clears as genuinely safe — **Bodenstedt**, **Desneux**, **Klat**, plus **Vondrovec** and **SNAT** — are already in the recommended
set. What it removes is the temptation to add the other side of the list. And it confirms the appendix-1 conclusion: the separator and negative-citation
rules are worth more than the names, because they apply to every key already in the file.
