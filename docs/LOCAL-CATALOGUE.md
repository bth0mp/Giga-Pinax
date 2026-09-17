# Bundled reference data

The extension includes derived type databases for four of the American Numismatic Society's type series, each converted from that series' own public `nomisma.rdf` export by `scripts/import_rdf.py`. Every one of them, and each derived database here, is available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Monograms, symbols, images and auction results are excluded from all of them.

| Corpus | Source | Export | Bundled | Left out |
| --- | --- | ---: | ---: | --- |
| OCRE (RIC) | [numismatics.org/ocre](https://numismatics.org/ocre/) | `nomisma.rdf`, 117,226,810 bytes | 52,254 active types, 2,808 redirects | 1,050 ambiguous replacement chains, 1 conflicting record |
| CRRO (RRC) | [numismatics.org/crro](https://numismatics.org/crro/) | `crro.rdf`, 4,922,384 bytes | all 2,602 RRC types | nothing |
| PELLA (Price) | [numismatics.org/pella](https://numismatics.org/pella/) | `pella.rdf`, 22,154,165 bytes | 4,573 Price types | 2,274 Le Rider die combinations, 382 PELLA type numbers |
| SCO (Seleucid Coins) | [numismatics.org/sco](https://numismatics.org/sco/) | `sco.rdf`, 23,373,517 bytes | all 8,694 types | nothing |

The three new exports were retrieved on 17 September 2026; each `metadata.json` records its file's SHA-256 and byte size.

**BIGR (Bopearachchi) is not bundled and still goes online.** A Bopearachchi reference is resolved by searching BIGR and verifying every hit against the Bopearachchi citation in the hit's NUDS XML, because BIGR numbers its own types differently from Bopearachchi's series ("Euthydemus I 13.1" against "Euthydème I 24A"). That citation is in the NUDS records only: none of the 2,109 `nmo:TypeSeriesItem` records in `bigr.rdf` carries it, and the file's 910 mentions of Bopearachchi are all monogram labels. Nothing in the export can tell "Bop 24A" from "Bop 24", so bundling it could only answer with a record nobody verified. The corpus stays online until the export carries the citation.

PELLA leaves out the type series no reference the extension reads can cite: `SIMPLE_REFERENCE` reads a Price number and nothing else, so `lerider.*` and `pella.*` records could never be reached. `metadata.json` records that count, the per-group breakdown and the reason. All 184 replacement links in the PELLA export run from a Le Rider record to a PELLA one, so no redirect between bundled records exists; CRRO and SCO carry no replacement links at all.

## Coverage and provenance

Each export contains type records and their side descriptions. Individual museum specimens are separate datasets linked to those types; they are not imported. The Type link on a card opens the corpus's own page for exploring linked examples. There are no auction results or coin images in any of these files. No dataset publication date is published for any of them. `generatedOn` records when the compact files were made, not when the source data was published or last corrected.

SCO identifies the types of both parts of Seleucid Coins under `sc.1`, which is the identifier `lookup.js` already builds from an SC reference; each record's title names the part it belongs to ("Seleucid Coins (part 2) 1315.3c" is `sc.1.1315.3c`). CRRO identifiers are not always the title in lower case — "RRC 98B" is `rrc-98b` — so a reference is matched against the titles rather than turned into an identifier.

Each `extension/data/<corpus>/metadata.json` identifies its source SHA-256, byte size, record counts, replacement handling and generated files, and a corpus bundled in part also carries the count it left out and why. A shard name such as `records-1(2).json` is the RIC second-edition volume's own key, not a duplicate download: the parenthesised number is part of the identifier prefix the records carry. CRRO, PELLA and SCO have no volumes to file their records under, so each of them is one group named after its identifier prefix — `records-rrc.json`, `records-price.json`, `records-sc.json` — and would split into lettered parts by the same rule if it ever passed the cap. Source identifiers retain their exact case. Explicit replacement links are followed only when they resolve to an available canonical record. Unresolved or cyclic replacements do not produce an invented active card. Conflicting repeated records or side descriptions are withheld and recorded in the metadata; affected references can use the online fallback.

No generated file may exceed 4 MiB, because Mozilla's add-on linter rejects any non-binary file of 5 MiB or more. A group whose records pass that cap is split by identifier order into evenly sized lettered parts — `records-5.a.json` and `records-5.b.json` for RIC V — and the metadata lists each volume's parts with the identifier each one starts at, so a lookup by identifier still opens exactly one file without reading the index. The importer measures every generated file before it writes the first one, so a bundle the cap refuses leaves the data directory exactly as it was. A volume cannot be split past `records-5.z.json`: the importer, the build and the extension all refuse more parts than there are letters to name them.

`numbers.json` is OCRE's alone, and the importer's corpus table is what says so. It maps the leading integer of each title's RIC number to the positions in `index.json` that carry it, so a lookup for RIC 972 reads a few dozen titles rather than all 52,254. The other three corpora need no such index: a Crawford, Price or SC reference is compared with whole titles, or names its record outright, so nothing parses a number out of a title for them. It is derived from the index and never a source of its own: `tests/local-catalogue.test.mjs` checks every bundled title against the reference parser the lookup uses, and checks that the listed entries answer every shape of reference exactly as a scan of the whole index does. It records the number of index entries it was built from: a reader that finds a different number of entries treats the bundle as unavailable rather than answering from a stale file, and `scripts/build.py` recomputes the whole index with the importer's own function and refuses to package a bundle that disagrees.

RDF values preserve multiple authorities, denominations, materials and mints. A value the export states as uncertain is a blank node with no identifier of its own, in the RDF and in the JSON-LD alike, so neither the local card nor the online card names it.

Nomisma concept labels and classes are absent from every one of these exports, so the names travel with the package in a file of their own. `extension/data/nomisma-labels.json` is slug to English label and nothing else, for every Nomisma concept any bundled record names in a field a card shows — authority or issuer, denomination, mint, material and portrait. It is generated from the tracked snapshot `scripts/data/nomisma-labels.json`, which holds the endpoint, the query text, the retrieval date, the licence and the whole fetched result. `extension/data/NOTICE.txt` attributes it. Nomisma publishes its concepts under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), so the derived label file is CC BY 3.0 while the type records beside it stay ODbL.

Of the 1,526 concepts the four bundles name, 1,524 carry an English preferred label; `dupondius_or_as` and `uncertain_74_sco` have none and are absent from the generated file, so a card shows those two identifiers as they are. Nothing is guessed and nothing is title-cased into a label nobody published.

Three sources can name a concept on a local card, in this order: the runtime label cache that an online Nomisma lookup filled, because that is the record's own publisher answering now; `ric-people.js`, for an OCRE authority or portrait, because RIC's own spelling of a ruler is what the collector typed and what the section above the coin says; then the bundled labels. `ric-people.js` is read for OCRE alone — it was filtered against OCRE's own concepts — and where it and Nomisma spell a ruler differently, an OCRE card keeps RIC's spelling. An identifier none of the three names stays an identifier.

The label file is read lazily, once, the first time a card is built, and never for a lookup that misses. A missing or damaged one costs a card its names and never its answer: the record is still the record, with the identifiers on it, and the lookup is never reported as unavailable because of it. `tests/local-catalogue.test.mjs` compares the local card with `toCard` over the same record's JSON-LD, field by field, with the labels the package carries and with a cache that overrides them, and they are equal either way.

`ric-people.js` includes the 214 concepts that Nomisma classifies as `foaf:Person`; it excludes 58 deities, personifications, groups and other concepts. Canonical names are English preferred labels. English and Latin preferred or alternate labels are search aliases. Missing legends, descriptions and dates remain absent.

The people concept snapshot was retrieved on 15 September 2026 with one request to Nomisma's documented [`getRdf` aggregate API](https://nomisma.org/documentation/apis/), rather than one request per identifier. Its SHA-256 is `0619ff8f2bd3d1c6fc58d08a3cc77a5dce443631fad2cb81f42375198675253e`. The generated module records the endpoint, snapshot hash, generation date and inclusion counts. Volume membership is derived from active OCRE authority and obverse-portrait links; it helps suggest searches but does not alter RIC's catalogue sections or claim that every source link is historically correct.

## Runtime

Each corpus is loaded on its own and only when it is asked about: a popup that has just opened reads nothing, a Bopearachchi reference reads nothing, and a Price lookup never touches OCRE's files. A reference that names its record outright — `SC 1266.2` is `sc.1.1266.2` — opens the record from the metadata and one shard, without reading an index at all. A RIC reference reads the number index and the searchable index; a Crawford or Price reference reads the searchable index with the metadata beside it and is matched against whole titles, first as an exact title and then against the near misses of its own group, through the same `pickMatch` and `inGroup` rules the online search results go through. The metadata is read with the index because its record count is the one thing that tells the index the importer wrote from a stale one whose every title still resolves; a disagreement between the two, or metadata that cannot be read, is `unavailable` rather than a miss.

An exact title opens that record. A handful of near misses — up to five in the reference's own group — are offered as **Did you mean**, exactly as the online search offers them, and the lookup does not go online for them. For SCO those candidates are deliberately a superset of the online ones: `SC 1266.9` offers `sc.1.1266` and `sc.1.1266.2`, where ANS's own search for the base number returns `sc.1.1266` alone, though `sc.1.1266.2` is a real record of that group. They are choices the collector makes, never a record opened for him. Anything short of an exact answer or a candidate list is a local miss, and the lookup falls back online rather than reporting that the type does not exist. Local lookups require neither a network service nor ANS permission, and a local card names no concept over the network: the names are in the package. Missing data can use the existing online provider with access, and the explicit **Check online** action can request that access. Results describe their bundled source; an absent local match does not establish that a type does not exist.

acsearch price research is separate and still needs internet access and the collector's provider session. There are no auction-price records in this database. Bundled files do not modify personal collection records or enter backups. Data updates arrive with extension releases.

## Rebuilding the data

The developer converter is `scripts/import_rdf.py`. It uses Python's standard library and does not download data. From the repository root:

```powershell
python scripts/import_rdf.py "Numismatics.org RDF/nomisma.rdf" extension/data/ocre --generated-on 2026-09-14
python scripts/import_rdf.py --corpus crro "Numismatics.org RDF/crro.rdf" extension/data/crro --generated-on 2026-09-17
python scripts/import_rdf.py --corpus pella "Numismatics.org RDF/pella.rdf" extension/data/pella --generated-on 2026-09-17
python scripts/import_rdf.py --corpus sco "Numismatics.org RDF/sco.rdf" extension/data/sco --generated-on 2026-09-17
python scripts/import_people.py generate extension/data/ocre scripts/data/nomisma-ocre-concepts.rdf extension/ric-people.js --mints scripts/data/nomisma-mints.json --generated-on 2026-09-15
python scripts/import_rdf.py --write-labels
python scripts/build.py
```

`--corpus` defaults to `ocre`. Each corpus's export is at `https://numismatics.org/<corpus>/nomisma.rdf`; the importer never downloads one. `NOTICE.txt` is written by hand and the importer leaves it alone.

Use the actual conversion date when producing a new snapshot. To deliberately refresh the checked-in Nomisma snapshot, make one aggregate request before generation:

```powershell
python scripts/import_people.py fetch extension/data/ocre scripts/data/nomisma-ocre-concepts.rdf
```

The mint snapshot is refreshed the same way, one request per RIC VI-IX mint concept. It is saved with each concept's source URL, the retrieval date and the licence, and the build reads that file and never the network:

```powershell
python scripts/import_people.py fetch-mints extension/data/ocre scripts/data/nomisma-mints.json --retrieved-on 2026-09-17
```

The concept labels are refreshed the same way, from the bundled records themselves. `--fetch-labels` collects every concept the records name and asks Nomisma's SPARQL endpoint for their English preferred labels, in batches of 320 identifiers given as a `VALUES` list — five requests for the 1,526 concepts the four bundles name, under the same User-Agent `import_people.py` uses. `--write-labels` then rewrites `extension/data/nomisma-labels.json` from that snapshot and the records, with no network at all, and is what `scripts/build.py` checks the committed file against:

```powershell
python scripts/import_rdf.py --fetch-labels --retrieved-on 2026-09-17
python scripts/import_rdf.py --write-labels
```

Without the exports — which is what a contributor or a CI run has — the shards, the index, the number index and the shard map are rebuilt from the committed JSON alone, through the same code the full import writes its files with:

```powershell
python scripts/import_rdf.py --reindex extension/data/ocre
python scripts/import_rdf.py --reindex extension/data/crro
python scripts/import_rdf.py --reindex extension/data/pella
python scripts/import_rdf.py --reindex extension/data/sco
```

It reads the records back out of the shards the metadata names, takes the corpus from that metadata rather than from the command line, refuses a directory that is short of the records the metadata counts, and writes byte-identical files to the ones the full import produces. It cannot change a record, only how the records are indexed and divided into files. `python scripts/build.py` runs the same rebuild over every corpus directory before it packages anything and refuses a bundle whose generated files are not the ones the importer would write today.

The raw ANS source folder is ignored by Git; the compact data, filtered Nomisma snapshot and converters are committed so release builds need neither the exports nor network access. End users only install or reload the extension.
