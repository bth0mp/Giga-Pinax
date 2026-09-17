# Bundled OCRE reference data

The extension includes a derived OCRE/RIC type database from the supplied `nomisma.rdf` (117,226,810 bytes; 56,116 RDF type declarations covering 56,113 unique identifiers). The generated bundle contains 52,254 active records and 2,808 unambiguous replacement redirects. It withholds 1,050 ambiguous replacement chains and one conflicting record. OCRE is published by the American Numismatic Society. [OCRE](https://numismatics.org/ocre/) and its [data documentation](https://numismatics.org/ocre/apis) identify the type data as available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The derived database remains available under that license. Monograms and images are excluded.

## Coverage and provenance

The supplied file contains Roman Imperial type records and their descriptions. Individual museum specimens are separate datasets linked to those types; they are not imported into this bundle. The existing Type link opens the OCRE page for exploring linked examples. This file has no PELLA/Price, CRRO/Crawford, SCO/Seleucid or BIGR/Bopearachchi records, auction results or coin images. Its dataset publication date is unknown. `generatedOn` records when the compact files were made, not when the source data was published or last corrected.

`extension/data/ocre/metadata.json` identifies the source SHA-256, byte size, record counts, replacement handling and generated files. A shard name such as `records-1(2).json` is the RIC second-edition volume's own key, not a duplicate download: the parenthesised number is part of the identifier prefix the records carry. Source identifiers retain their exact case. Explicit replacement links are followed only when they resolve to an available canonical record. Unresolved or cyclic replacements do not produce an invented active card. Conflicting repeated records or side descriptions are withheld and recorded in the metadata; affected references can use the online fallback.

No generated file may exceed 4 MiB, because Mozilla's add-on linter rejects any non-binary file of 5 MiB or more. A volume whose records pass that cap is split by identifier order into evenly sized lettered parts — `records-5.a.json` and `records-5.b.json` for RIC V — and the metadata lists each volume's parts with the identifier each one starts at, so a lookup by identifier still opens exactly one file without reading the index. The importer measures every generated file before it writes the first one, so a bundle the cap refuses leaves the data directory exactly as it was. A volume cannot be split past `records-5.z.json`: the importer, the build and the extension all refuse more parts than there are letters to name them.

`numbers.json` maps the leading integer of each title's RIC number to the positions in `index.json` that carry it, so a lookup for RIC 972 reads a few dozen titles rather than all 52,254. It is derived from the index and never a source of its own: `tests/local-catalogue.test.mjs` checks every bundled title against the reference parser the lookup uses, and checks that the listed entries answer every shape of reference exactly as a scan of the whole index does. It records the number of index entries it was built from: a reader that finds a different number of entries treats the bundle as unavailable rather than answering from a stale file, and `scripts/build.py` recomputes the whole index with the importer's own function and refuses to package a bundle that disagrees.

RDF values preserve multiple authorities, denominations, materials and mints. Nomisma concept labels and classes are absent from the OCRE export. A separate, checked-in aggregate RDF snapshot supplies labels and classes for the 272 Nomisma concepts referenced as an authority or obverse portrait. `ric-people.js` includes the 214 concepts that Nomisma classifies as `foaf:Person`; it excludes 58 deities, personifications, groups and other concepts. Canonical names are English preferred labels. English and Latin preferred or alternate labels are search aliases. Missing legends, descriptions and dates remain absent.

The concept snapshot was retrieved on 15 September 2026 with one request to Nomisma's documented [`getRdf` aggregate API](https://nomisma.org/documentation/apis/), rather than one request per identifier. Its SHA-256 is `0619ff8f2bd3d1c6fc58d08a3cc77a5dce443631fad2cb81f42375198675253e`. Nomisma publishes its concepts under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The generated module records the endpoint, snapshot hash, generation date and inclusion counts. Volume membership is derived from active OCRE authority and obverse-portrait links; it helps suggest searches but does not alter RIC's catalogue sections or claim that every source link is historically correct.

## Runtime

The extension reads the bundled metadata, the number index and the searchable index, then fetches the required volume's JSON from its own package. Local lookups require neither a network service nor ANS permission. Missing data can use the existing online provider with access, and the explicit **Check online** action can request that access. Results describe their bundled source; an absent local match does not establish that a type does not exist.

acsearch price research is separate and still needs internet access and the collector's provider session. There are no auction-price records in this database. Bundled files do not modify personal collection records or enter backups. Data updates arrive with extension releases.

## Rebuilding the data

The developer converter is `scripts/import_rdf.py`. It uses Python's standard library and does not download data. From the repository root:

```powershell
python scripts/import_rdf.py "Numismatics.org RDF/nomisma.rdf" extension/data/ocre --generated-on 2026-09-14
python scripts/import_people.py generate extension/data/ocre scripts/data/nomisma-ocre-concepts.rdf extension/ric-people.js --mints scripts/data/nomisma-mints.json --generated-on 2026-09-15
python scripts/build.py
```

Use the actual conversion date when producing a new snapshot. To deliberately refresh the checked-in Nomisma snapshot, make one aggregate request before generation:

```powershell
python scripts/import_people.py fetch extension/data/ocre scripts/data/nomisma-ocre-concepts.rdf
```

The mint snapshot is refreshed the same way, one request per RIC VI-IX mint concept. It is saved with each concept's source URL, the retrieval date and the licence, and the build reads that file and never the network:

```powershell
python scripts/import_people.py fetch-mints extension/data/ocre scripts/data/nomisma-mints.json --retrieved-on 2026-09-17
```

Without the 117 MB export — which is what a contributor or a CI run has — the shards, the index, the number index and the shard map are rebuilt from the committed JSON alone, through the same code the full import writes its files with:

```powershell
python scripts/import_rdf.py --reindex extension/data/ocre
```

It reads the records back out of the shards the metadata names, refuses a directory that is short of the records the metadata counts, and writes byte-identical files to the ones the full import produces. It cannot change a record, only how the records are indexed and divided into files.

The raw OCRE source folder is ignored by Git; the compact data, filtered Nomisma snapshot and converters are committed so release builds do not need the 117 MB source file or network access. End users only install or reload the extension.
