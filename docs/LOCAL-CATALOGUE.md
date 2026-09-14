# Bundled OCRE reference data

The extension includes a derived OCRE/RIC type database from the supplied `nomisma.rdf` (117,226,810 bytes; 56,116 RDF type declarations covering 56,113 unique identifiers). The generated bundle contains 52,254 active records and 2,808 unambiguous replacement redirects. It withholds 1,050 ambiguous replacement chains and one conflicting record. OCRE is published by the American Numismatic Society. [OCRE](https://numismatics.org/ocre/) and its [data documentation](https://numismatics.org/ocre/apis) identify the type data as available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The derived database remains available under that license. Monograms and images are excluded.

## Coverage and provenance

The supplied file contains Roman Imperial type records and their descriptions. Individual museum specimens are separate datasets linked to those types; they are not imported into this bundle. The existing Type link opens the OCRE page for exploring linked examples. This file has no PELLA/Price, CRRO/Crawford, SCO/Seleucid or BIGR/Bopearachchi records, auction results or coin images. Its dataset publication date is unknown. `generatedOn` records when the compact files were made, not when the source data was published or last corrected.

`extension/data/ocre/metadata.json` identifies the source SHA-256, byte size, record counts, replacement handling and generated files. Source identifiers retain their exact case. Explicit replacement links are followed only when they resolve to an available canonical record. Unresolved or cyclic replacements do not produce an invented active card. Conflicting repeated records or side descriptions are withheld and recorded in the metadata; affected references can use the online fallback.

RDF values preserve multiple authorities, denominations, materials and mints. Nomisma concept labels are absent from this export. Existing verified label-cache values may improve presentation; unresolved identifiers remain identifiers. Missing legends, descriptions and dates remain absent.

## Runtime

The extension reads the bundled metadata and searchable index, then fetches the required volume's JSON from its own package. Local lookups require neither a network service nor ANS permission. Missing data can use the existing online provider with access, and the explicit **Check online** action can request that access. Results describe their bundled source; an absent local match does not establish that a type does not exist.

acsearch price research is separate and still needs internet access and the collector's provider session. There are no auction-price records in this database. Bundled files do not modify personal collection records or enter backups. Data updates arrive with extension releases.

## Rebuilding the data

The developer converter is `scripts/import_rdf.py`. It uses Python's standard library and does not download data. From the repository root:

```powershell
python scripts/import_rdf.py "Numismatics.org RDF/nomisma.rdf" extension/data/ocre --generated-on 2026-09-14
python scripts/build.py
```

Use the actual conversion date when producing a new snapshot. The raw source folder is ignored by Git; the compact data and converter are committed so release builds do not need the 117 MB source file. End users only install or reload the extension.
