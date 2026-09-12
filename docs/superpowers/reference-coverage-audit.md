# Reference coverage audit — what the lot reader misses

Audit date: 2026-09-12. Against `extension/lot.js` at 0.20.0 (`b4c0444`).

## What this is about

A reference typed alone in the Reference box already works for any catalogue: unknown text becomes a prices-only
**Other** card. The gap is **lot text**. `findReferences` only starts a run at a key in the `KEYS` list, so a
reference whose catalogue name is not in that list is invisible in a pasted or right-clicked lot — no row, no
prices, no acsearch search. The collector never learns it was there.

### What the reader knows today

```
BMC/RE  BMCRE  BMC  Bopearachchi  Bop.  Calicó  Calico  Cohen  Coh.  Crawford  Craw.  Cr.
RIC  RRC  RSC  RPC  RCV  SNG  HGC  BCD  Sear  SBCV  SB  SGCV  GCV  SG  Scholten  SC
Price  Pr  Mitchiner  MIG  DOC  MIBE  MIB  MIR  Sydenham  Syd.  Müller  Muller  KM  Kroll
Svoronos  McClean  Benner  CBN  BN  GRPC  ESMS  ESM  C  S
```

Guards already in place: the key must be capitalised (`keyAt`), the piece must contain a digit, `C` and `S` only
count beside a longer key in the same run, keys inside brackets are skipped unless the bracket opens on a key,
and the `Ex …` / `From …` / `Provenance:` tail is cut before anything is read.

### Method

Candidates come from everyday dealer practice across the collecting areas, then each was **run through the real
`findReferences`** to confirm it is missed rather than assumed missed. Sample results:

| Probe | Read today |
| --- | --- |
| `Crawford 344/1a; Sydenham 698; BMCRR Rome 2320; RBW 1353.` | `Crawford 344/1a`, `Sydenham 698` |
| `Prieur 1234; McAlee 677; Bellinger 12.` | *nothing* |
| `Milne 1234; Emmett 1234; Dattari 5678; Geissen 1234; K&G 24.55.` | *nothing* |
| `Hendin 1234; Meshorer 123; TJC 234; AJC II 12; Mildenberg 45.` | *nothing* |
| `Sellwood 45.10; Shore 123; Sunrise 345.` | *nothing* |
| `LT 1234; DT 123; ABC 1234; VA 1234; Hobbs 123.` | *nothing* |
| `RIC VIII 123; LRBC 1401.` | `RIC VIII 123` |
| `SC 130.2; WSM 1234; ESM 299; CSE 123.` | `SC 130.2`, `ESM 299` |

The probe script is in the session scratchpad, not the repo.

### Why the cost is asymmetric

A new key produces one **Other · prices only** row. No numismatics.org request, no type data, no new
permission. A false positive costs the collector one junk row they ignore; a miss costs them a reference they
never see and cannot price. That argues for leaning inclusive everywhere except where the abbreviation is an
ordinary word or a name that appears in lot text for other reasons.

---

## The gap list, by area

Risk column: **low** = the token is a surname or initialism that appears in lot text only as a citation;
**medium** = a word or name that could plausibly appear otherwise; **high** = an ordinary English/Latin word or
an auction house whose name shows up in the same paste.

### Roman Republic and Imperatorial

| Abbr. as dealers write it | Full title | Example | Risk |
| --- | --- | --- | --- |
| `BMCRR` | Grueber, *Coins of the Roman Republic in the British Museum* | `BMCRR Rome 2320` | low — but see note: the `BMC` key cannot catch it |
| `RBW` | the RBW (Richard B. Witschonke) Collection, CNG/NAC sale catalogues | `RBW 1353` | low |
| `CRI` / `HCRI` | Sear, *The History and Coinage of the Roman Imperators 49–27 BC* | `CRI 9`, `HCRI 419` | low |
| `Babelon` | Babelon, *Monnaies de la République romaine* | `Babelon (Julia) 12` | low |
| `Albert` | Albert, *Die Münzen der römischen Republik* | `Albert 1234` | medium — a personal name |
| `Bahrfeldt` | Bahrfeldt, *Die römische Goldmünzenprägung* | `Bahrfeldt 12` | low |
| `RRCH` | Crawford, *Roman Republican Coin Hoards* | `RRCH 231` | low — but it is a hoard inventory, not a type |

### Roman Empire

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `Hunter` | Robertson, *Roman Imperial Coins in the Hunter Coin Cabinet* | `Hunter 12` | medium — ordinary English word, usually capitalised only as the citation |
| `Woytek` | Woytek, *Die Reichsprägung des Kaisers Traianus* (MIR 14) | `Woytek 290b` | low |
| `LRBC` | Carson, Hill & Kent, *Late Roman Bronze Coinage* | `LRBC 1401` | low |
| `Cunetio` | Besly & Bland, *The Cunetio Treasure* | `Cunetio 2452` | low |
| `Normanby` | Bland & Burnett, *The Normanby Hoard* | `Normanby 1234` | low |
| `Elmer` | Elmer, *Die Münzprägung der gallischen Kaiser* | `Elmer 638` | low |
| `Mairat` | Mairat, *The Coinage of the Gallic Empire* | `Mairat 526` | low |
| `AGK` | Schulte, *Die Goldprägung der gallischen Kaiser* | `AGK 8` | low |
| `Bastien` | Bastien, *Le monnayage de l'atelier de Lyon* | `Bastien 123` | low |
| `Giard` | Giard, *Catalogue des monnaies de l'Empire romain* (BnF) | `Giard 45` | low |
| `Depeyrot` | Depeyrot, *Les monnaies d'or de …* | `Depeyrot 12/3` | low |
| `Estiot` | Estiot, *Monnaies de l'Empire romain* (Aurelian etc.) | `Estiot 123` | low |
| `Szaivert` | Szaivert, MIR volumes (Marcus Aurelius, Commodus) | `Szaivert 123` | low |
| `Gnecchi` | Gnecchi, *I medaglioni romani* | `Gnecchi 12` | low |
| `Banti` / `CNR` | Banti & Simonetti, *Corpus Nummorum Romanorum* | `Banti 12`, `CNR 34` | low |
| `Kampmann` | Kampmann, *Die Münzen der römischen Kaiser* | `Kampmann 12.3` | low |
| `Van Meter` | Van Meter, *Handbook of Roman Imperial Coins* | `Van Meter 45` | low |
| `Vagi` | Vagi, *Coinage and History of the Roman Empire* | `Vagi 456` | low |
| `Foss` | Foss, *Roman Historical Coins* | `Foss 123` | medium — short surname, but rare as plain text |
| `Mazzini` | Mazzini, *Monete imperiali romane* | `Mazzini 12` | low |
| `Biaggi` | Biaggi, *Monete e medaglioni romani in oro* | `Biaggi 123` | low |
| `Seaby` | Seaby, *Roman Silver Coins* (RSC's earlier name) | `Seaby 123` | medium — also a dealer name |
| `Cayón` / `Cayon` | Cayón, *Compendio de las monedas del Imperio Romano* | `Cayón 12` | **high** — Cayón Subastas and Aureo & Calicó are auction houses in the same text |
| `King` | King, *Roman Quinarii* | `King 12` | **high** — "King", "Kings of Macedon", "King Herod" are everywhere |
| `Pink` | Pink, *Der Aufbau der römischen Münzprägung* | `Pink 12` | **high** — a colour word in patina/toning notes |

### Roman provincial

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `Prieur` | Prieur & Prieur, *A Type Corpus of the Syro-Phoenician Tetradrachms* | `Prieur 1234` | low |
| `McAlee` | McAlee, *The Coins of Roman Antioch* | `McAlee 677` | low |
| `Varbanov` | Varbanov, *Greek Imperial Coins* (Moesia Inferior & Thrace) | `Varbanov 1234` | low |
| `AMNG` | *Die antiken Münzen Nord-Griechenlands* (Pick, Gaebler) | `AMNG I/1 1234` | low |
| `Moushmov` | Moushmov, *Ancient Coins of the Balkan Peninsula* | `Moushmov 1234` | low |
| `Lindgren` | Lindgren & Kovacs, *Ancient Bronze Coins of Asia Minor and the Levant* | `Lindgren III 456` | low |
| `GIC` | Sear, *Greek Imperial Coins and Their Values* | `GIC 1234` | low |
| `SGI` | the same book, as some dealers abbreviate it | `SGI 1234` | low — a test already asserts `SGI` is **not** SG, so it needs its own key |
| `H&J` | Hristova & Jekov, *The Local Coinage of the Roman Empire — Moesia Inferior* | `H&J 8.24.13.5` | low |
| `Bellinger` | Bellinger, *The Syrian Tetradrachms of Caracalla and Macrinus* | `Bellinger 12` | low |
| `Butcher` | Butcher, *Coinage in Roman Syria* | `Butcher 12` | low |
| `Rec.` / `Recueil` | Waddington, Babelon & Reinach, *Recueil général des monnaies grecques d'Asie Mineure* | `Rec. gén. 123` | medium — `Rec.` alone is too generic |
| `Spijkerman` | Spijkerman, *The Coins of the Decapolis and Provincia Arabia* | `Spijkerman 34` | low |
| `Rosenberger` | Rosenberger, *City-Coins of Palestine* | `Rosenberger 12` | low |
| `Kadman` | Kadman, *Corpus Nummorum Palaestinensium* | `Kadman 56` | low |
| `Sofaer` | Meshorer et al., *Coins of the Holy Land: the Sofaer Collection* | `Sofaer 78` | low |
| `Ziegler` | Ziegler, *Kilikien* | `Ziegler 123` | low |
| `Klose` | Klose, *Die Münzprägung von Smyrna* | `Klose 12` | low |

### Roman Alexandrian

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `Emmett` | Emmett, *Alexandrian Coins* | `Emmett 1234 (R2)` | low |
| `Milne` | Milne, *Catalogue of Alexandrian Coins* (Ashmolean) | `Milne 1234` | low |
| `Dattari` / `Dattari-Savio` | Dattari, *Numi Augg. Alexandrini*; Savio's plate edition | `Dattari 5678`, `Dattari-Savio Pl. 123, 456` | low |
| `Geissen` | Geissen, *Katalog alexandrinischer Kaisermünzen* (Köln) | `Geissen 1234` | low |
| `Köln` / `Koln` | the same Köln catalogue, as many dealers cite it | `Köln 1234` | medium — also a mint/place name |
| `K&G` | Kampmann & Ganschow, *Die Münzen der römischen Münzstätte Alexandria* | `K&G 24.55` | low |
| `Curtis` | Curtis, *The Tetradrachms of Roman Egypt* | `Curtis 123` | low |
| `Christiansen` | Christiansen, *Coinage in Roman Egypt* | `Christiansen 12` | low |

### Judaean

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `Hendin` | Hendin, *Guide to Biblical Coins* | `Hendin 1234`, `Hendin 6th ed. 1234` | low |
| `Meshorer` | Meshorer, *Ancient Jewish Coinage* / *A Treasury of Jewish Coins* | `Meshorer 123` | low |
| `TJC` | Meshorer, *A Treasury of Jewish Coins* | `TJC 234` | low |
| `AJC` | Meshorer, *Ancient Jewish Coinage* | `AJC II 12` | low |
| `GBC` | *Guide to Biblical Coins*, cited by initials | `GBC 1234` | low |
| `Mildenberg` | Mildenberg, *The Coinage of the Bar Kokhba War* | `Mildenberg 45` | low |

### Greek — Magna Graecia, mainland, islands, Asia Minor

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `HN Italy` | Rutter, *Historia Numorum: Italy* | `HN Italy 934` | low — `HN` alone would be weaker |
| `Vlasto` | Ravel, *The Collection of Tarentine Coins formed by M. P. Vlasto* | `Vlasto 123` | low |
| `Fischer-Bossert` | Fischer-Bossert, *Chronologie der Didrachmenprägung von Tarent* | `Fischer-Bossert 456` | low |
| `Boehringer` | Boehringer, *Die Münzen von Syrakus* | `Boehringer 123` | low |
| `Jenkins` | Jenkins, *Coins of Punic Sicily* / *Gela* | `Jenkins 45` | low |
| `Weber` | Forrer, *The Weber Collection* | `Weber 1234` | medium — common surname, and a German word in compounds |
| `Pozzi` | Naville, *Collection Pozzi* | `Pozzi 456` | low |
| `Jameson` | *Collection R. Jameson* | `Jameson 12` | low |
| `Gulbenkian` | *Catalogue of the Calouste Gulbenkian Collection* | `Gulbenkian 34` | low |
| `Traité` / `Traite` | Babelon, *Traité des monnaies grecques et romaines* | `Traité 1234` | low |
| `Thompson` | Thompson, *The Mints of Lysimachus* / *New Style Silver Coinage of Athens* | `Thompson 123` | low |
| `Troxell` | Troxell, *Studies in the Macedonian Coinage of Alexander the Great* | `Troxell 45` | low |
| `Newell` | Newell, various (ESM, WSM, SMA, Alexander hoards) | `Newell 123` | low |
| `Le Rider` | Le Rider, *Monnaies crétoises* / *Le monnayage d'argent et d'or de Philippe II* | `Le Rider 86` | low |
| `ACGC` | Kraay, *Archaic and Classical Greek Coins* | `ACGC 123` | low |
| `Grose` | Grose, *McClean Collection of Greek Coins* (the McClean catalogue's author) | `Grose 1234` | low |
| `Carradice` | Carradice, *The Coinage of Persia* (Achaemenid sigloi) | `Carradice Type IV` | low — but often has no digit, so it may still not qualify |
| `ACIP` | Villaronga & Benages, *Ancient Coinage of the Iberian Peninsula* | `ACIP 1234` | low |
| `CNH` | Villaronga, *Corpus Nummum Hispaniae* | `CNH 12` | low |
| `Klein` | *Sammlung Klein* (Greek bronze) | `Klein 123` | medium — German "klein", but lower case there, so `keyAt` mostly saves it |
| `Rosen` | *SNG Rosen* / the Rosen Collection | `Rosen 45` | medium — German "Rosen" (roses) is a capitalised noun |
| `Betlyon` | Betlyon, *The Coinage and Mints of Phoenicia* | `Betlyon 45` | low |
| `Rouvier` | Rouvier, *Numismatique des villes de la Phénicie* | `Rouvier 123` | low |
| `Noe` | Noe, *The Coinage of Metapontum* | `Noe 123` | medium — very short |
| `Asyut` | Price & Waggoner, *Coin Hoards from Asyut* | `Asyut 123` | low — hoard, not a type |
| `IGCH` | *Inventory of Greek Coin Hoards* | `IGCH 1234` | low — hoard, not a type |

### Seleucid and Ptolemaic

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `WSM` | Newell, *The Coinage of the Western Seleucid Mints* | `WSM 1234` | low — the natural partner of the already-supported `ESM` |
| `CSE` | Houghton, *Coins of the Seleucid Empire from the Collection of Arthur Houghton* | `CSE 123`, `CSE II 456` | low |
| `SMA` | Newell, *The Seleucid Mint of Antioch* | `SMA 12` | low |
| `CPE` | Lorber, *Coins of the Ptolemaic Empire* | `CPE 123` | low — the modern standard beside Svoronos, and the corpus behind ANS PCO |
| `Weiser` | Weiser, *Katalog ptolemäischer Bronzemünzen* | `Weiser 12` | low |

### Baktria, Parthia, Sasanian and the East

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `Sellwood` / `Sell.` | Sellwood, *An Introduction to the Coinage of Parthia* | `Sellwood 45.10`, `Sell. 45.10` | low |
| `Shore` | Shore, *Parthian Coins & History* | `Shore 123` | medium — ordinary English word, but capitalised only as the citation |
| `Sunrise` | *The Sunrise Collection* (Parthian, Persian, Sasanian) | `Sunrise 345` | medium — ordinary English word |
| `Göbl` / `Gobl` | Göbl, *Sasanidische Numismatik*; also his Hunnic and Kushan corpora | `Göbl I/1`, `Göbl type II/2` | low — needs the ASCII spelling too, as Müller/Muller already has |
| `SNS` | *Sylloge Nummorum Sasanidarum* (Schindel et al.) | `SNS I 123` | low |
| `Senior` | Senior, *Indo-Scythian Coins and History* | `Senior 123` | medium — ordinary English word |
| `Alram` | Alram, *Nomina propria iranica in nummis* | `Alram 123` | low |
| `Nercessian` | Nercessian, *Armenian Coins and Their Values* | `Nercessian 123` | low |
| `Jongeward` | Jongeward & Cribb, *Kushan, Kushano-Sasanian and Kidarite Coins* | `Jongeward 45` | low |
| `van 't Haaff` | van 't Haaff, *Catalogue of Elymaean Coinage* | `van 't Haaff 12.3.1` | **high** — starts lower case, so `keyAt` rejects it outright |
| `Zeno` | zeno.ru online database record number | `Zeno #12345` | low — a database id, not a catalogue |

### Byzantine and post-Roman

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `MIBEC` | Hahn & Metlich, *Money of the Incipient Byzantine Empire Continued* | `MIBEC 12` | low — `MIB`/`MIBE` are keys; this one is not, and the `MIB` key cannot catch it |
| `Ratto` | Ratto, *Monnaies byzantines* | `Ratto 1234` | medium — Rodolfo Ratto is also a historical auction house |
| `Sommer` | Sommer, *Die Münzen des Byzantinischen Reiches* | `Sommer 12.3` | medium — German "Sommer" (summer) is a capitalised noun |
| `Füeg` / `Fueg` | Füeg, *Corpus of the Nomismata* | `Füeg 12.3` | low |
| `Morrisson` | Morrisson, *Catalogue des monnaies byzantines de la BnF* | `Morrisson 12` | low |
| `Grierson` | Grierson, *Byzantine Coins* / DOC | `Grierson 34` | low |
| `Hahn` | Hahn, *Moneta Imperii Byzantini* (MIB's author, cited alone) | `Hahn 78` | low |
| `Tolstoi` | Tolstoi, *Monnaies byzantines* | `Tolstoi 56` | low |
| `Bendall` | Bendall, *Later Palaeologan Coinage* etc. | `Bendall 90` | low |
| `Berk` | Berk, *Eastern Roman Successors of the Sestertius* / *Roman Gold Coins of the Medieval World* | `Berk 45` | **high** — Harlan J. Berk is a major auction house whose name appears in titles and provenance |
| `MEC` | Grierson & Blackburn, *Medieval European Coinage* | `MEC 1, 123` | low |
| `COI` | Metlich, *The Coinage of Ostrogothic Italy* | `COI 12` | low |
| `Metlich` | the same, cited by author | `Metlich 12` | low |
| `Malloy` | Malloy, Preston & Seltman, *Coins of the Crusader States* | `Malloy 123` | low |
| `Metcalf` | Metcalf, *Coinage of the Crusades and the Latin East* | `Metcalf 456` | low |

### Celtic

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `LT` | Muret & Chabouillet / La Tour, *Atlas de monnaies gauloises* | `LT 1234`, `LT XXII 1234` | low |
| `DT` | Delestrée & Tache, *Nouvel Atlas des monnaies gauloises* | `DT 123` | low |
| `ABC` | Cottam, de Jersey, Rudd & Sills, *Ancient British Coins* | `ABC 1244` | low |
| `VA` | Van Arsdell, *Celtic Coinage of Britain* | `VA 1234` | medium — two capitals that could fall out of an uppercase legend |
| `Hobbs` | Hobbs, *British Iron Age Coins in the British Museum* | `Hobbs 123` | low |
| `Scheers` | Scheers, *Traité de numismatique celtique* | `Scheers 45` | low |
| `OTA` | Göbl, *Ostkeltischer Typenatlas* | `OTA 123` | low |
| `Mack` | Mack, *The Coinage of Ancient Britain* | `Mack 12` | medium — common surname |
| `Dembski` | Dembski, *Münzen der Kelten* | `Dembski 123` | low |
| `Kostial` | Kostial, *Kelten im Osten* (Lanz Collection) | `Kostial 123` | low |
| `Sills` | Sills, *Gaulish and Early British Gold Coinage* | `Sills 123` | low |
| `SCBI` | *Sylloge of Coins of the British Isles* | `SCBI 12` | low — already named in `lookup.js` as an Other |
| `North` | North, *English Hammered Coinage* | `North 123` | **high** — "North Africa", "north" in a die-axis or find note |
| `Allen` | Allen, *The Coins of the Coriosolites* etc. | `Allen 12` | **high** — ordinary surname, very common in prose |
| `Spink` | Spink, *Coins of England and the United Kingdom* | `Spink 123` | **high** — Spink and Spink USA are auction houses in the same text |

### Islamic

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `Album` | Album, *A Checklist of Islamic Coins* | `Album 1234` | **high** — ordinary English word, and Stephen Album Rare Coins is an auction house that appears in lot titles |
| `SICA` | *Sylloge of Islamic Coins in the Ashmolean* | `SICA 123` | low |
| `Walker` | Walker, *A Catalogue of the Arab-Sassanian / Arab-Byzantine Coins in the BM* | `Walker 456` | medium — common surname |
| `Nicol` | Nicol, *A Corpus of Fāṭimid Coins* | `Nicol 123` | low |
| `Bernardi` | Bernardi, *Arabic Gold Coins Corpus* | `Bernardi 123` | low |
| `Lavoix` | Lavoix, *Catalogue des monnaies musulmanes de la BnF* | `Lavoix 123` | low |
| `Diler` | Diler, *Islamic Mints* | `Diler 123` | low |
| `Mitchiner WOI` | Mitchiner, *Oriental Coins: The World of Islam* | `Mitchiner WOI 123` | already read — `Mitchiner` is a key |

### World and modern (the KM area, since 0.20.0)

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `Friedberg` / `Fr.` | Friedberg, *Gold Coins of the World* | `Friedberg 123`, `Fr. 456` | **high** for `Fr.` — French, franc, Frau, "fr." in weights; `Friedberg` spelled out is low |
| `Davenport` / `Dav.` | Davenport, *European Crowns and Talers* | `Dav. 1234` | medium |
| `Bitkin` | Bitkin, *Composite Catalogue of Russian Coins* | `Bitkin 12` | low |
| `Gadoury` | Gadoury, *Monnaies françaises* | `Gadoury 45` | **high** — Gadoury is an auction house in the same text |
| `Craig` | Craig, *Coins of the World 1750–1850* | `Craig 123` | **high** — surname; already named in `lookup.js` as an Other |
| `Y#` / `Yeoman` | Yeoman, *Modern World Coins* (KM's predecessor) | `Y# 123` | medium — `Y#` is safe, bare `Y` is not |
| `N#` | Numista catalogue number | `N# 12345` | low — a database id, not a catalogue |

### Cross-area

| Abbr. | Full title | Example | Risk |
| --- | --- | --- | --- |
| `DCA` | Cohen, *Dated Coins of Antiquity* | `DCA 872` | low — but note it is a different Cohen from the Roman `Cohen` key |
| `Wildwinds` | wildwinds.com attribution page | `Wildwinds (this coin)` | — has no number of its own |

---

## Ranking

### Must add — common in everyday lots

Every one of these turns up in ordinary dealer text that a collector pastes weekly, and each currently yields
nothing.

1. **BMCRR** — Grueber, *Coins of the Roman Republic in the BM*. Roman Republic. `BMCRR Rome 2320`.
2. **RBW** — the RBW Collection. Roman Republic. `RBW 1353`. The standard third line of a Republican lot after
   Crawford and Sydenham.
3. **CRI** and **HCRI** — Sear, *The History and Coinage of the Roman Imperators*. Imperatorial. `CRI 9`.
4. **Hunter** — Robertson, *Roman Imperial Coins in the Hunter Coin Cabinet*. Roman Empire. `Hunter 12`.
5. **Woytek** — *Die Reichsprägung des Kaisers Traianus*. Roman Empire (Trajan). `Woytek 290b`.
6. **LRBC** — *Late Roman Bronze Coinage*. Roman Empire. `LRBC 1401`. On nearly every 4th-century AE lot.
7. **Prieur** — *A Type Corpus of the Syro-Phoenician Tetradrachms*. Roman provincial. `Prieur 1234`.
8. **McAlee** — *The Coins of Roman Antioch*. Roman provincial. `McAlee 677`.
9. **Varbanov** — *Greek Imperial Coins*. Roman provincial (Thrace, Moesia). `Varbanov 1234`.
10. **AMNG** — *Die antiken Münzen Nord-Griechenlands*. Roman provincial / Greek. `AMNG I/1 1234`.
11. **Lindgren** — Lindgren & Kovacs. Roman provincial bronze. `Lindgren III 456`.
12. **GIC** and **SGI** — Sear, *Greek Imperial Coins and Their Values*. Roman provincial. `GIC 1234`. The
    companion to the already-supported SG, and a test already pins `SGI` as *not* SG, so it needs its own key.
13. **Emmett** — *Alexandrian Coins*. Alexandrian. `Emmett 1234 (R2)`.
14. **Milne** — *Catalogue of Alexandrian Coins*. Alexandrian. `Milne 1234`.
15. **Dattari** (and **Dattari-Savio**) — *Numi Augg. Alexandrini*. Alexandrian. `Dattari 5678`.
16. **Geissen** — *Katalog alexandrinischer Kaisermünzen*. Alexandrian. `Geissen 1234`.
17. **Hendin** — *Guide to Biblical Coins*. Judaean. `Hendin 1234`. The single most-cited Judaean reference.
18. **Meshorer** and **TJC** — *Ancient Jewish Coinage* / *A Treasury of Jewish Coins*. Judaean. `TJC 234`.
19. **WSM** — Newell, *Western Seleucid Mints*. Seleucid. `WSM 1234`. ESM is already a key; WSM is its twin.
20. **CSE** — Houghton, *Coins of the Seleucid Empire*. Seleucid. `CSE 123`.
21. **CPE** — Lorber, *Coins of the Ptolemaic Empire*. Ptolemaic. `CPE 123`.
22. **Sellwood** (and `Sell.`) — *An Introduction to the Coinage of Parthia*. Parthia. `Sellwood 45.10`.
23. **Shore** — *Parthian Coins & History*. Parthia. `Shore 123`. *Risk: ordinary English word.*
24. **Göbl** / **Gobl** — *Sasanidische Numismatik* and his Hunnic/Kushan corpora. Sasanian and Central Asia.
    `Göbl I/1`. Needs the ASCII spelling as Müller/Muller already has.
25. **HN Italy** — Rutter, *Historia Numorum: Italy*. Greek (Magna Graecia). `HN Italy 934`.
26. **Vlasto** — the Vlasto collection of Tarentine coins. Greek (Taras). `Vlasto 123`.
27. **LT** — La Tour, *Atlas de monnaies gauloises*. Celtic (Gaul). `LT 1234`.
28. **DT** — Delestrée & Tache, *Nouvel Atlas*. Celtic (Gaul). `DT 123`.
29. **ABC** — *Ancient British Coins*. Celtic (Britain). `ABC 1244`.
30. **VA** — Van Arsdell, *Celtic Coinage of Britain*. Celtic (Britain). `VA 1234`. *Risk: two capitals that
    could fall out of an uppercase legend — require the digit, which the reader already does.*
31. **Album** — *A Checklist of Islamic Coins*. Islamic. `Album 1234`. *Risk: ordinary English word and the name
    of an auction house; add a guard against "Stephen Album".*
32. **MIBEC** — *Money of the Incipient Byzantine Empire Continued*. Byzantine. `MIBEC 12`. MIB and MIBE are
    keys but neither can match MIBEC.
33. **Cunetio** — *The Cunetio Treasure*. Roman Empire (Gallic/3rd century). `Cunetio 2452`.
34. **Elmer** — *Die Münzprägung der gallischen Kaiser*. Roman Empire (Gallic). `Elmer 638`.
35. **Ratto** — *Monnaies byzantines*. Byzantine. `Ratto 1234`. *Risk: also a historical auction house.*

### Worth adding

Real catalogues a collector meets often enough to matter, low risk, but not on every other lot.

Roman: **Babelon**, **Albert**, **Bahrfeldt**, **Mairat**, **AGK**, **Normanby**, **Bastien**, **Giard**,
**Depeyrot**, **Estiot**, **Szaivert**, **Gnecchi**, **Banti**, **CNR**, **Kampmann**, **Van Meter**, **Vagi**,
**Foss**, **Mazzini**, **Biaggi**, **Seaby**.

Provincial and Levant: **Moushmov**, **H&J**, **Bellinger**, **Butcher**, **Spijkerman**, **Rosenberger**,
**Kadman**, **Sofaer**, **Ziegler**, **Klose**, **Recueil** (spelled out, not `Rec.`).

Alexandrian: **K&G**, **Curtis**, **Köln**/**Koln**, **Christiansen**.

Judaean: **AJC**, **GBC**, **Mildenberg**.

Greek: **Fischer-Bossert**, **Boehringer**, **Jenkins**, **Weber**, **Pozzi**, **Jameson**, **Gulbenkian**,
**Traité**/**Traite**, **Thompson**, **Troxell**, **Newell**, **Le Rider**, **ACGC**, **Grose**, **ACIP**,
**CNH**, **Betlyon**, **Rouvier**, **Klein**, **Rosen**, **Asyut**, **IGCH**.

Seleucid/Ptolemaic: **SMA**, **Weiser**.

East: **SNS**, **Sunrise**, **Senior**, **Alram**, **Nercessian**, **Jongeward**.

Byzantine and post-Roman: **Sommer**, **Füeg**/**Fueg**, **Morrisson**, **Grierson**, **Hahn**, **Tolstoi**,
**Bendall**, **MEC**, **COI**, **Metlich**, **Malloy**, **Metcalf**.

Celtic: **Hobbs**, **Scheers**, **OTA**, **Mack**, **Dembski**, **Kostial**, **Sills**, **SCBI**.

Islamic: **SICA**, **Walker**, **Nicol**, **Bernardi**, **Lavoix**, **Diler**.

World/modern: **Friedberg** (spelled out), **Davenport**/**Dav.**, **Bitkin**, **Y#**.

Cross-area: **DCA**, **RRCH**.

### Skip — and why

| Candidate | Why skip |
| --- | --- |
| **Berk** | Harlan J. Berk is one of the largest ancient-coin auction houses; its name is in lot titles, consignor notes and provenance that the reader sees. Almost every `Berk 45` hit would be a sale, not the book. |
| **Spink** | Same problem: Spink and Spink USA appear in the same text, and British Spink numbers are already reachable through the existing `S` key. |
| **Gadoury** | Gadoury is an auction house in acsearch's own house list. |
| **Cayón** | Cayón Subastas and Aureo & Calicó are auction houses; `Calicó` is already a key and covers the Roman gold use anyway. |
| **King** | "King", "Kings of Macedon", "Kings of Parthia", "King Herod" open thousands of Greek and Judaean headings. The book (Roman quinarii) is far rarer than the false positives. |
| **Craig** | Ordinary surname, low citation frequency; `lookup.js` already names it as an example of text that must stay Other. |
| **Allen** | Ordinary surname with several unrelated numismatic Allens; too little signal. |
| **North** | "North" is a compass word and a place-name element ("North Africa", "north of"); the English hammered catalogue is out of the collector's area anyway. |
| **Pink** | A colour word that appears in patina and toning descriptions. |
| **Fr.** (bare) | Collides with French, franc, Frau and "fr." in weight and grade notes. Add `Friedberg` spelled out instead. |
| **Rec.** (bare) | Too generic; "Rec." is also "record" and "recto". Add `Recueil` spelled out instead. |
| **van 't Haaff** | Starts lower case, so `keyAt` rejects it by design; changing that rule would cost far more than the Elymais coverage gains. |
| **A-1234** (Album's short form) | A single letter key. `C` and `S` already need the longest guard in the file; a third is not worth it. |
| **HN** (bare) | Also "Historia Numorum" generally and a common two-letter run; add `HN Italy` as the key instead. |
| **Zeno**, **N#**, **Wildwinds**, **OCRE**, **CRRO** | Database record ids and attribution sites, not catalogues; dealers cite them as links, and acsearch will not find prices by them. |
| **CH** (Coin Hoards), **Asyut**, **IGCH**, **RRCH** as *must* | Hoard inventories, not type catalogues. Listed above as "worth adding" only because dealers do write them in the reference line; they will rarely find a price. |
| **Sale-catalogue names** (`Triton`, `NAC`, `Leu`, `CNG`, `Nomos`, `NGC`) | Provenance and grading, already handled: the `Ex …` / `From …` / `Provenance:` cut and the grade guard exist for exactly these. |
| **Hoover** | HGC is already a key and is how Hoover's handbooks are actually cited. |
| **Delmonte, Vanhoudt, Divo, Herrera, Uzdenikov, Diakov** | World-coin specialist catalogues far from this collector's area; KM already covers the world-coin path. |

---

## Notes for whoever implements this

1. **A longer sibling needs its own entry.** The key pattern ends in `(?![\p{L}\d])`, so `BMC` does not match
   inside `BMCRR`, and `MIB`/`MIBE` do not match inside `MIBEC` — the whole match simply fails. `BMCRR` must be
   listed *before* `BMC`, and `MIBEC` before `MIBE` before `MIB`, because the alternation is tried in order.
2. **Four existing tests assert these are unread.** `tests/lot.test.mjs`, in *"a reference carries on only into
   a number…"*, currently pins `BMCRR Rome 2320`, `RBW 1353`, `Woytek 290b` and `Hunter 12` as **not** read.
   Those assertions exist to prove that an unknown name ends a reference without ending the run — that
   behaviour still needs a test, but with a name that stays unknown (`Thirion 123` is already used for this in
   the next test and is a safe stand-in).
3. **Non-ASCII keys need an ASCII twin**, the way `Müller`/`Muller` and `Calicó`/`Calico` already do:
   `Göbl`/`Gobl`, `Traité`/`Traite`, `Füeg`/`Fueg`, `Cayón`/`Cayon`, `Köln`/`Koln`.
4. **Multi-word keys** (`HN Italy`, `Le Rider`, `Van Meter`, `Dattari-Savio`, `Fischer-Bossert`) work as literal
   alternatives, but `.` must be escaped and the space should be `\s+` so a line break inside them still reads.
5. **`&` keys** (`K&G`, `H&J`) are safe: `&` is neither a letter nor a digit, so both word-boundary lookarounds
   behave.
6. **Guards for the risky ones.** The cheapest guard is a negative lookbehind for the house name:
   `(?<!Stephen\s)Album`, `(?<!Harlan\s(?:J\.\s)?)Berk`, `(?<!Rodolfo\s)Ratto`. The next cheapest is requiring
   the key to be followed immediately by a number token rather than allowing the four-word body — worth doing
   for `Album`, `Shore`, `Sunrise`, `Senior`, `Hunter`, `Weber`, `VA` and `Mack`.
7. **The provenance cut already helps.** `PROVENANCE` removes everything from `Ex …` / `From …` /
   `Provenance:`, which is where most auction-house names sit. It does **not** cut a lot's *title* line
   (`Heritage Auctions, Auction 61635, Lot 23312`) when the collector pastes it above the description — that is
   where `Album`, `Berk`, `Spink` and `Gadoury` would actually bite.
8. **Nothing here needs new network access.** Every added key produces an Other row: acsearch prices only, the
   existing CoinArchives link, no numismatics.org request and no new permission.
9. **`Carradice Type IV` has no digit** in the usual citation, so even with the key added it will not qualify —
   the digit requirement is right and should stay; this is simply a reference the reader cannot list.
