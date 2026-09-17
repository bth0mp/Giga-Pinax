# Tracked data snapshots

Three files fetched from [Nomisma.org](https://nomisma.org/) and checked in, so a build reads
them instead of the network. Every generated file under `extension/` is rebuilt from these, and
nothing in this directory is edited by hand: each one is written by the script named below.

All three hold Nomisma concept data, which Nomisma publishes under
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) (`CC-BY-3.0`).

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
- **Retrieved:** 2026-09-17 (the file's `retrievedOn` field).
- **SHA-256:** not recorded; the file carries `requestUrl`, `retrievedOn`, `license` and
  `licenseUrl`.
- **Licence:** `CC-BY-3.0`, recorded in the file's `license` and `licenseUrl` fields.
- **Written by:** `python scripts/import_people.py fetch-mints extension/data/ocre
  scripts/data/nomisma-mints.json --retrieved-on YYYY-MM-DD`.
- **Generates:** the `RIC_MINTS` table in `extension/ric-people.js`.

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
