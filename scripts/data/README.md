# Tracked data snapshots

Four files fetched and checked in, so a build reads them instead of the network. Every generated
file under `extension/` is rebuilt from these, and nothing in this directory is edited by hand:
each one is written by the script named below.

Three of them come from [Nomisma.org](https://nomisma.org/) and hold Nomisma concept data, which
Nomisma publishes under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/)
(`CC-BY-3.0`). The fourth comes from [Wikidata](https://www.wikidata.org/), which dedicates its
structured data to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (`CC0-1.0`).

## nomisma-labels.json

- **Source endpoint:** `https://nomisma.org/query` (Nomisma's public SPARQL endpoint), read in
  batches of 320 identifiers; the query text is recorded in the file's own `query` field.
- **Retrieved:** 2026-09-17 (the file's `retrievedOn` field).
- **SHA-256:** not recorded. The file carries its own provenance instead: `endpoint`, `query`,
  `retrievedOn`, `license`, `licenseUrl`, `requestCount`, `requestedCount` and `labelledCount`.
- **Licence:** `CC-BY-3.0`, recorded in the file's `license` and `licenseUrl` fields.
- **Written by:** `python scripts/import_rdf.py --fetch-labels --retrieved-on YYYY-MM-DD`.
- **Generates:** `extension/data/nomisma-labels.json`, through
  `python scripts/import_rdf.py --write-labels`. `extension/data/NOTICE.txt` attributes it.

## nomisma-mints.json

- **Source endpoint:** `https://nomisma.org/id/{concept_id}.rdf`, one request per mint concept;
  the template is recorded in the file's `requestUrl` field and each concept's own URL beside its
  labels.
- **Retrieved:** 2026-09-18 (the file's `retrievedOn` field).
- **SHA-256:** not recorded; the file carries `requestUrl`, `retrievedOn`, `license` and
  `licenseUrl`.
- **Licence:** `CC-BY-3.0`, recorded in the file's `license` and `licenseUrl` fields.
- **Written by:** `python scripts/import_people.py fetch-mints extension/data/ocre
  scripts/data/nomisma-mints.json --retrieved-on YYYY-MM-DD`.
- **Holds:** each concept's `skos:prefLabel` and `skos:altLabel` values with their language tags,
  and, under `matches`, every `skos:closeMatch` and `skos:exactMatch` URI the concept carries —
  Pleiades, GeoNames, DBpedia, the British Museum, Getty and Wikidata alike. The links are what
  says which Wikidata item is the same place; only the Wikidata ones are ever followed.
- **Generates:** the `RIC_MINTS` table in `extension/ric-people.js`, and the fetch list for
  `wikidata-mints.json` below.

## wikidata-mints.json

- **Source endpoint:** `https://www.wikidata.org/wiki/Special:EntityData/{entity_id}.json`, one
  request per Wikidata item a mint concept links to and one more per town those items lead to — 22
  items and 10 towns, 32 requests; the template is in the file's `requestUrl` field and each item's
  own URL beside its labels.
- **Retrieved:** 2026-09-18 (the file's `retrievedOn` field).
- **SHA-256:** not recorded; the file carries `requestUrl`, `retrievedOn`, `license`, `licenseUrl`
  and `licenseStatement`.
- **Licence:** `CC0-1.0`. Wikidata dedicates its structured data, the labels and aliases here
  included, to the public domain; the dedication is recorded in the file's `license`, `licenseUrl`
  and `licenseStatement` fields, in `extension/data/NOTICE.txt` and in the generated
  `extension/ric-people.js` header.
- **Written by:** `python scripts/import_people.py fetch-wikidata scripts/data/nomisma-mints.json
  scripts/data/wikidata-mints.json --retrieved-on YYYY-MM-DD`. Which items are fetched is decided
  by the `matches` links in `nomisma-mints.json` and by nothing else, so the two files travel
  together and a regeneration stops if one of them no longer holds what the other names.
- **Holds:** under `entities`, each linked item's labels and aliases, the classes its `P31` says it
  is an instance of, and the targets of `P1366` (replaced by), `P276` (location) and `P131`
  (located in the administrative territorial entity); under `targets`, the same for each town one
  of those three statements leads to, with the item and property that led there under `from`. Only
  the languages a name can be taken from are kept — English, French, German, Italian, Spanish and
  the language of the country each linking mint stands in today — and no description, sitelink or
  other statement is written down. The three statements are recorded because Nomisma links four of
  the mints to the *Roman* city, which every language titles by the Latin name: the town standing
  there now is reached by one hop from that item and by nothing else, and the hop is decided from
  what is written here rather than from the network.
- **Generates:** the `RIC_MINTS` table in `extension/ric-people.js`, together with
  `nomisma-mints.json`.

## nomisma-ocre-concepts.rdf

- **Source endpoint:** `https://nomisma.org/apis/getRdf`, one request naming every concept the
  bundled OCRE records refer to, saved verbatim as it was returned.
- **Retrieved:** not recorded in the file, which is the aggregate RDF exactly as Nomisma returned
  it and carries no provenance of its own. The generated
  `extension/ric-people.js` header records the run that read it: `generatedOn: "2026-09-15"`.
- **SHA-256:** `0619ff8f2bd3d1c6fc58d08a3cc77a5dce443631fad2cb81f42375198675253e`, recorded in the
  `snapshotSha256` field of the `extension/ric-people.js` header so a regeneration can be checked
  against the same bytes.
- **Licence:** none inline. Nomisma publishes this data under `CC-BY-3.0`, and the generated
  `extension/ric-people.js` header records `license` and `licenseUrl` for it.
- **Written by:** `python scripts/import_people.py fetch extension/data/ocre
  scripts/data/nomisma-ocre-concepts.rdf`.
- **Generates:** the `RIC_PEOPLE` table in `extension/ric-people.js`.

Both importers refuse a DOCTYPE or ENTITY declaration, and any input that is not UTF-8, before
parsing any of it.
