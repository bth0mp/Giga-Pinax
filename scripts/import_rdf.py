#!/usr/bin/env python3
"""Convert an ANS RDF/XML type export into deterministic extension data shards."""

from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
XML = "{http://www.w3.org/XML/1998/namespace}"
NMO = "{http://nomisma.org/ontology#}"
SKOS = "{http://www.w3.org/2004/02/skos/core#}"
DC = "{http://purl.org/dc/terms/}"
ABOUT = RDF + "about"
RESOURCE = RDF + "resource"
NOMISMA_ID = "http://nomisma.org/id/"
VOLUME = r"[0-9]+(?:_[0-9]+)?(?:\([0-9]+\))?"
# Every corpus this importer knows, and the three things that differ between them: the URI its records are published
# under, which of the ids it publishes the extension can actually ask for, and how those ids are grouped into shard
# files. Everything else — the parse, the cap, the split, the metadata, the reindex — is one path over this table.
# A corpus whose export the extension only cites part of names the rest here as well, so an id that belongs to neither
# set is an export shape this importer was not written for and stops the import rather than being dropped in silence.
CORPORA = {
    "ocre": {
        "label": "OCRE",
        "base": "http://numismatics.org/ocre/id/",
        "url": "https://numismatics.org/ocre/",
        "bundled": re.compile(rf"ric\.{VOLUME}\..+"),
        # The RIC volume an id names, which is the book a collector has open and the file a lookup by id opens.
        "group": lambda record_id: record_id.split(".")[1],
        "groups": VOLUME,
        "excluded": {},
        "reason": "",
        # 52,254 titles are too many to parse on every lookup, so OCRE ships an index of their RIC numbers beside them.
        "numbers": True,
    },
    "crro": {
        "label": "CRRO",
        "base": "http://numismatics.org/crro/id/",
        "url": "https://numismatics.org/crro/",
        "bundled": re.compile(r"rrc-[0-9A-Za-z][0-9A-Za-z.\-]*"),
        "group": lambda record_id: "rrc",
        "groups": "rrc",
        "excluded": {},
        "reason": "",
        "numbers": False,
    },
    "pella": {
        "label": "PELLA",
        "base": "http://numismatics.org/pella/id/",
        "url": "https://numismatics.org/pella/",
        "bundled": re.compile(r"price\.[0-9A-Za-z][0-9A-Za-z._\-]*"),
        "group": lambda record_id: "price",
        "groups": "price",
        # PELLA publishes Le Rider's Philip II die combinations and its own PELLA numbers beside Price's catalogue.
        # No reference shape the extension reads cites either, so bundling them would be weight nothing can reach.
        "excluded": {"lerider": re.compile(r"lerider\..+"), "pella": re.compile(r"pella\..+")},
        "reason": "only Price numbers are cited as PELLA references; Le Rider and PELLA type numbers are not",
        "numbers": False,
    },
    "sco": {
        "label": "SCO",
        "base": "http://numismatics.org/sco/id/",
        "url": "https://numismatics.org/sco/",
        # Every SCO record is identified under sc.1, whichever part of Seleucid Coins its title names.
        "bundled": re.compile(r"sc\.1\.[0-9A-Za-z][0-9A-Za-z._\-]*"),
        "group": lambda record_id: "sc",
        "groups": "sc",
        "excluded": {},
        "reason": "",
        "numbers": False,
    },
}
# Mozilla's add-on linter rejects any non-binary file of 5 MiB or more, so no generated file may pass this cap.
CAP_BYTES = 4 * 1024 * 1024
SHARD_LETTERS = "abcdefghijklmnopqrstuvwxyz"
SHARD_OVERHEAD = len(b'{"schemaVersion":1,"records":{}}\n')
# The leading integer of the RIC number an OCRE title ends with ("RIC II.3 Hadrian 1009-1012" -> 1009), which is the
# first thing a lookup filters on. It reads the number exactly where lookup.js reads it, as the last whitespace- or
# comma-separated token, before the word OCRE brackets after some numbers ("266 (aureus)");
# tests/local-catalogue.test.mjs proves the two agree over every bundled title. The digits are ASCII only, as JavaScript's
# \d is: Python's would also match ٣ and ３, and a title keyed off one of those would sit under a number no reference can
# ever be read as.
TITLE_NUMBER = re.compile(r"(?:^|[\s,])([0-9]+)\S*?(?:\s\([^()]*\))?$")
TAGS = {
    "prefLabel": SKOS + "prefLabel",
    "hasAuthority": NMO + "hasAuthority",
    "hasIssuer": NMO + "hasIssuer",
    "hasDenomination": NMO + "hasDenomination",
    "hasMint": NMO + "hasMint",
    "hasMaterial": NMO + "hasMaterial",
    "hasStartDate": NMO + "hasStartDate",
    "hasEndDate": NMO + "hasEndDate",
    "hasObverse": NMO + "hasObverse",
    "hasReverse": NMO + "hasReverse",
    "hasLegend": NMO + "hasLegend",
    "hasPortrait": NMO + "hasPortrait",
    "description": DC + "description",
    "isReplacedBy": DC + "isReplacedBy",
}


# The record fields that hold a Nomisma concept the card renders: authority or issuer, denomination, mint, material,
# and the portrait of either side. A value that is not a bare Nomisma identifier is a concept published elsewhere
# (CRRO cites four British Museum person URIs), which Nomisma cannot label and which is never rewritten here.
CONCEPT_KEYS = ("a", "d", "m", "x")
NOMISMA_SLUG = re.compile(r"[A-Za-z0-9._~()-]+")
# Nomisma's public SPARQL endpoint, which scripts/import_people.py's fetch subcommand already reads the same concepts
# from, under the same User-Agent. One request carries a batch of identifiers rather than one concept per request.
LABEL_ENDPOINT = "https://nomisma.org/query"
# The identifiers are relative to a BASE rather than written out: a batch of absolute URIs is many times longer once the
# query string is percent-encoded, and the endpoint answers HTTP 414 long before the batch is worth making. A relative
# IRI also needs none of the escaping a prefixed name would ("nm:-des_cos" and "nm:a(-)oros_colophon" are both illegal).
LABEL_QUERY = ("BASE <http://nomisma.org/id/>\n"
               "PREFIX skos: <http://www.w3.org/2004/02/skos/core#>\n"
               "SELECT ?id ?label WHERE { VALUES ?id { %s } ?id skos:prefLabel ?label . FILTER(lang(?label) = \"en\") }")
LABEL_BATCH = 320
LABEL_USER_AGENT = "Giga-Pinax-data-import/1"
LABEL_LICENSE = "CC-BY-3.0"
LABEL_LICENSE_URL = "https://creativecommons.org/licenses/by/3.0/"
LABEL_FILE = "nomisma-labels.json"
DEFAULT_LABEL_SNAPSHOT = Path(__file__).resolve().parent / "data" / LABEL_FILE
DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[1] / "extension" / "data"


class ImportFailure(ValueError):
    pass


def literal(element: ET.Element, name: str) -> str | None:
    candidates = [child for child in element if child.tag == TAGS[name] and (child.text or "").strip()]
    if not candidates:
        return None
    chosen = next((child for child in candidates if (child.get(XML + "lang") or "").lower().startswith("en")), candidates[0])
    return " ".join((chosen.text or "").split())


def resources(element: ET.Element, name: str) -> list[str]:
    return [value for child in element if child.tag == TAGS[name] and (value := child.get(RESOURCE))]


def compact_resource(uri: str) -> str:
    return uri[len(NOMISMA_ID):] if uri.startswith(NOMISMA_ID) else uri


def inspect_source(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    overlap = b""
    forbidden = re.compile(br"<!\s*(?:DOCTYPE|ENTITY)\b", re.IGNORECASE)
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            if size == 0:
                if chunk.startswith((b"\xff\xfe", b"\xfe\xff", b"\x00\x00\xfe\xff", b"\xff\xfe\x00\x00")):
                    raise ImportFailure("RDF input must be UTF-8 XML")
                declaration = chunk[:512].decode("ascii", "ignore")
                encoding = re.search(r"<\?xml[^>]*\bencoding\s*=\s*['\"]([^'\"]+)", declaration, re.IGNORECASE)
                if encoding and encoding.group(1).lower().replace("_", "-") not in ("utf-8", "utf8"):
                    raise ImportFailure("RDF input must be UTF-8 XML")
            digest.update(chunk)
            size += len(chunk)
            if forbidden.search(overlap + chunk):
                raise ImportFailure("DTD and entity declarations are not allowed")
            overlap = chunk[-32:]
    return size, digest.hexdigest()


def parse_source(path: Path, corpus: dict) -> tuple[dict[str, dict], dict[str, list[str]], set[str]]:
    base, label = corpus["base"], corpus["label"]
    records: dict[str, dict] = {}
    replacements: dict[str, list[str]] = {}
    sides: dict[str, dict] = {}
    conflicting_records: set[str] = set()
    conflicting_sides: set[str] = set()
    root = None
    depth = 0

    for event, element in ET.iterparse(path, events=("start", "end")):
        if event == "start":
            depth += 1
            if root is None:
                root = element
                if root.tag != RDF + "RDF":
                    raise ImportFailure("root element must be rdf:RDF")
            continue

        if depth == 2:
            uri = element.get(ABOUT)
            if element.tag == NMO + "TypeSeriesItem":
                if not uri:
                    raise ImportFailure("type record is missing rdf:about")
                if not uri.startswith(base):
                    raise ImportFailure(f"unsupported type URI corpus: {uri}")
                record_id = uri[len(base):]
                if not record_id or "/" in record_id:
                    raise ImportFailure(f"invalid {label} id: {uri}")
                title = literal(element, "prefLabel")
                if not title:
                    raise ImportFailure(f"type record is missing a label: {uri}")
                record = {"i": record_id, "l": title}
                authorities = resources(element, "hasAuthority") or resources(element, "hasIssuer")
                for key, values in (
                    ("a", authorities),
                    ("d", resources(element, "hasDenomination")),
                    ("m", resources(element, "hasMint")),
                    ("x", resources(element, "hasMaterial")),
                ):
                    if values:
                        record[key] = [compact_resource(value) for value in values]
                for key, name in (("s", "hasStartDate"), ("e", "hasEndDate")):
                    value = literal(element, name)
                    if value is not None:
                        record[key] = value
                record["o"] = {}
                record["r"] = {}
                record["_obverse"] = resources(element, "hasObverse")
                record["_reverse"] = resources(element, "hasReverse")
                replacement = resources(element, "isReplacedBy")
                if record_id in records:
                    existing = records[record_id]
                    for key in ("l", "s", "e"):
                        if key in existing and key in record and existing[key] != record[key]:
                            conflicting_records.add(record_id)
                        elif key in record:
                            existing[key] = record[key]
                    for key in ("a", "d", "m", "x", "_obverse", "_reverse"):
                        for value in record.get(key, []):
                            if value not in existing.get(key, []):
                                existing.setdefault(key, []).append(value)
                    for value in replacement:
                        if value not in replacements.setdefault(record_id, []):
                            replacements[record_id].append(value)
                    element.clear()
                    if root is not None:
                        root.clear()
                    depth -= 1
                    continue
                if replacement:
                    replacements[record_id] = replacement
                records[record_id] = record
            elif element.tag == RDF + "Description" and uri:
                side = {}
                for key, name in (("l", "hasLegend"), ("d", "description")):
                    value = literal(element, name)
                    if value is not None:
                        side[key] = value
                portraits = resources(element, "hasPortrait")
                if portraits:
                    side["p"] = [compact_resource(value) for value in portraits]
                if side:
                    if uri in sides:
                        existing = sides[uri]
                        for key in ("l", "d"):
                            if key in existing and key in side and existing[key] != side[key]:
                                conflicting_sides.add(uri)
                            elif key in side:
                                existing[key] = side[key]
                        for value in side.get("p", []):
                            if value not in existing.get("p", []):
                                existing.setdefault("p", []).append(value)
                    else:
                        sides[uri] = side
            element.clear()
            if root is not None:
                root.clear()
        depth -= 1

    for record in records.values():
        for key, side_key in (("_obverse", "o"), ("_reverse", "r")):
            refs = record.pop(key)
            if len(refs) > 1:
                conflicting_records.add(record["i"])
            if refs and refs[0] in sides:
                record[side_key] = sides[refs[0]]
                if refs[0] in conflicting_sides:
                    conflicting_records.add(record["i"])
    if not records:
        raise ImportFailure("RDF input contains no nmo:TypeSeriesItem records")
    return records, replacements, conflicting_records


def replacement_aliases(records: dict[str, dict], replacements: dict[str, list[str]], excluded: set[str], base: str) -> tuple[dict[str, str], dict[str, int]]:
    targets = {}
    ambiguous_nodes = set()
    for old_id, uris in replacements.items():
        if len(uris) != 1:
            ambiguous_nodes.add(old_id)
            continue
        uri = uris[0]
        targets[old_id] = uri[len(base):] if uri.startswith(base) else None

    aliases = {}
    ambiguous = 0
    cyclic = 0
    dangling = 0
    for source in sorted(replacements):
        seen = set()
        current = source
        while current in replacements:
            if current in ambiguous_nodes:
                ambiguous += 1
                break
            if current in seen:
                cyclic += 1
                break
            seen.add(current)
            target = targets[current]
            if target is None or target not in records or target in excluded:
                dangling += 1
                break
            current = target
        else:
            if current in records:
                aliases[source] = current
            else:
                dangling += 1
    return aliases, {"ambiguous": ambiguous, "cyclic": cyclic, "dangling": dangling}


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def json_bytes(value: object) -> bytes:
    return encoded(value) + b"\n"


def write_file(path: Path, payload: bytes) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def grouped(ids: list[str], weights: list[int], count: int) -> list[list[str]]:
    # Each part carries its share of the volume's bytes: a record opens the next part once the bytes before it have
    # passed that part's boundary, so the parts come out as even as whole records allow, in id order.
    total = sum(weights)
    groups: list[list[str]] = [[]]
    carried = 0
    for record_id, weight in zip(ids, weights):
        if groups[-1] and len(groups) < count and carried * count >= total * len(groups):
            groups.append([])
        groups[-1].append(record_id)
        carried += weight
    return groups


def shard_parts(prefix: str, records: dict[str, dict], cap: int = CAP_BYTES) -> list[dict]:
    """One volume's records as the files they are written to: one file, or several named .a, .b, ... under the cap."""
    ids = list(records)
    # What each record costs inside the file: its quoted id, the colon, the record and the comma that follows it.
    weights = [len(encoded(record_id)) + 1 + len(encoded(records[record_id])) + 1 for record_id in ids]
    sizes = dict(zip(ids, weights))

    def measure(group: list[str]) -> int:
        return SHARD_OVERHEAD + sum(sizes[record_id] for record_id in group) - 1

    for record_id, weight in zip(ids, weights):
        if SHARD_OVERHEAD + weight - 1 > cap:
            raise ImportFailure(f"record {record_id} alone is larger than the {cap} byte shard cap")
    count = 1
    while True:
        groups = grouped(ids, weights, count)
        if all(measure(group) <= cap for group in groups):
            break
        count += 1
        if count > len(SHARD_LETTERS):
            raise ImportFailure(f"volume {prefix} needs more shards than there are letters to name them")
    if len(groups) == 1:
        return [{"file": f"records-{prefix}.json", "from": "", "records": records}]
    return [{"file": f"records-{prefix}.{SHARD_LETTERS[position]}.json", "from": "" if position == 0 else group[0],
             "records": {record_id: records[record_id] for record_id in group}}
            for position, group in enumerate(groups)]


def number_index(entries: list[list[str]]) -> dict[str, list[int]]:
    """Index positions by the leading integer of each title's RIC number, so a lookup reads a few dozen titles."""
    positions: dict[str, list[int]] = defaultdict(list)
    for position, (_, title) in enumerate(entries):
        match = TITLE_NUMBER.search(title)
        if match:
            positions[match.group(1).lstrip("0") or "0"].append(position)
    return {key: positions[key] for key in sorted(positions, key=int)}


def shard_name(corpus: dict) -> re.Pattern:
    return re.compile(rf"records-{corpus['groups']}(?:\.[a-z])?\.json")


def generated(active: dict[str, dict], metadata: dict) -> tuple[dict, list[tuple[str, bytes]]]:
    """Every file the importer writes, by name, from the active records and the metadata the source itself supplies."""
    corpus = CORPORA[metadata["corpus"]]
    shards = defaultdict(dict)
    for record_id in sorted(active):
        if not corpus["bundled"].fullmatch(record_id):
            raise ImportFailure(f"unsupported {corpus['label']} record id: {record_id}")
        shards[corpus["group"](record_id)][record_id] = active[record_id]

    shard_files = {}
    files = []
    for prefix in sorted(shards):
        parts = shard_parts(prefix, shards[prefix])
        for part in parts:
            files.append((part["file"], {"schemaVersion": 1, "records": part["records"]}))
        shard_files[prefix] = [{"file": part["file"], "from": part["from"]} for part in parts]
    entries = [[record_id, active[record_id]["l"]] for record_id in sorted(active)]
    complete = {**metadata, "activeRecordCount": len(active), "shards": shard_files}
    files.append(("index.json", {"schemaVersion": 1, "entries": entries}))
    if corpus["numbers"]:
        # The entry count travels with the number index: it is the one thing that tells a reader the positions were
        # taken from the index beside them, since a stale list of positions is still a perfectly valid one.
        files.append(("numbers.json", {"schemaVersion": 1, "entryCount": len(entries), "numbers": number_index(entries)}))
    files.append(("metadata.json", complete))

    payloads = [(name, json_bytes(value)) for name, value in files]
    for name, payload in payloads:
        if len(payload) > CAP_BYTES:
            raise ImportFailure(f"{name} is larger than the {CAP_BYTES} byte cap")
    return complete, payloads


def write_data(output: Path, active: dict[str, dict], metadata: dict) -> dict:
    # Every file is measured before any of them is written, so an import the cap refuses leaves the data directory
    # exactly as it found it rather than half replaced.
    complete, payloads = generated(active, metadata)
    output.mkdir(parents=True, exist_ok=True)
    written = {name for name, _ in payloads}
    for name, payload in payloads:
        write_file(output / name, payload)
    # A volume that stops being split leaves the file it was split into behind, which would ship in the package.
    stale_names = shard_name(CORPORA[metadata["corpus"]])
    for stale in sorted(output.glob("records-*.json")):
        if stale.name not in written and stale_names.fullmatch(stale.name):
            stale.unlink()
    return complete


def excluded_counts(corpus: dict, record_ids: list[str]) -> dict:
    """The records the export publishes that no reference the extension reads can ever cite, counted by their group."""
    counts = {name: 0 for name in sorted(corpus["excluded"])}
    for record_id in record_ids:
        name = next((name for name, pattern in corpus["excluded"].items() if pattern.fullmatch(record_id)), None)
        if name is None:
            raise ImportFailure(f"unsupported {corpus['label']} record id: {record_id}")
        counts[name] += 1
    return {"count": len(record_ids), "reason": corpus["reason"], "byGroup": counts}


def convert(name: str, source: Path, output: Path, generated_on: str) -> dict:
    try:
        date.fromisoformat(generated_on)
    except ValueError as error:
        raise ImportFailure("generated date must be a real ISO date") from error
    corpus = CORPORA[name]
    input_bytes, source_sha256 = inspect_source(source)
    records, replacements, conflicts = parse_source(source, corpus)
    kept = {record_id for record_id in records if corpus["bundled"].fullmatch(record_id)}
    excluded = excluded_counts(corpus, sorted(set(records) - kept))
    # An id the corpus publishes but the extension cannot ask for is no target for a redirect either, so it joins the
    # conflicts as somewhere a replacement chain must not end.
    aliases, replacement_skips = replacement_aliases(records, replacements, conflicts | (set(records) - kept), corpus["base"])
    active = {record_id: record for record_id, record in records.items()
              if record_id in kept and record_id not in replacements and record_id not in conflicts}
    metadata = {
        "schemaVersion": 1,
        "corpus": name,
        "sourceFilename": source.name,
        "inputBytes": input_bytes,
        "sourceSha256": source_sha256,
        "generatedOn": generated_on,
        "publicationDate": None,
        "sourceUrl": corpus["url"],
        "license": "ODbL-1.0",
        "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "recordCount": len(records),
        "activeRecordCount": len(active),
        # Only a corpus that leaves something out says so, so a corpus bundled whole carries no empty claim about it.
        **({"excluded": excluded} if excluded["count"] else {}),
        "aliases": aliases,
        "replacementSkips": replacement_skips,
        "conflicts": {"count": len(conflicts), "ids": sorted(conflicts)},
        "shards": {},
    }
    return write_data(output, active, metadata)


def shard_count(metadata: dict) -> int:
    return sum(len(parts) for parts in metadata["shards"].values())


def summary(metadata: dict) -> str:
    return (f"{metadata['activeRecordCount']} active {CORPORA[metadata['corpus']]['label']} records "
            f"into {shard_count(metadata)} shard files.")


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ImportFailure(f"cannot read {path.name}: {error}") from error


def read_data(read) -> tuple[dict[str, dict], dict]:
    """The records and metadata a generated data directory already holds, read back the way the reader reads them."""
    metadata = read("metadata.json")
    name = metadata.get("corpus") if isinstance(metadata, dict) else None
    # The name is tested for being a name before it is looked up: a list or an object in that slot is broken metadata
    # like any other, and an unhashable key would otherwise raise a TypeError straight past every caller's handling.
    if not isinstance(metadata, dict) or metadata.get("schemaVersion") != 1 or not isinstance(name, str) or name not in CORPORA:
        raise ImportFailure("unsupported catalogue metadata")
    label = CORPORA[name]["label"]
    shards = metadata.get("shards")
    if not isinstance(shards, dict) or not shards:
        raise ImportFailure(f"{label} metadata must name its shards")
    safe = shard_name(CORPORA[name])
    active: dict[str, dict] = {}
    for prefix in sorted(shards):
        parts = shards[prefix]
        if not isinstance(parts, list) or not parts:
            raise ImportFailure(f"volume {prefix} names no shard file")
        for part in parts:
            file_name = part.get("file") if isinstance(part, dict) else None
            if not isinstance(file_name, str) or not safe.fullmatch(file_name):
                raise ImportFailure(f"unsafe shard name in volume {prefix}")
            records = read(file_name)
            records = records.get("records") if isinstance(records, dict) else None
            if not isinstance(records, dict):
                raise ImportFailure(f"{file_name} holds no records")
            for record_id, record in records.items():
                if not isinstance(record, dict) or record.get("i") != record_id or record_id in active:
                    raise ImportFailure(f"{file_name} misfiles the record {record_id}")
                active[record_id] = record
    # The counts are the source's own, so a data directory short of a shard is a broken input, never a smaller bundle.
    if metadata.get("activeRecordCount") != len(active):
        raise ImportFailure(f"the shards hold {len(active)} records, the metadata counts {metadata.get('activeRecordCount')}")
    return active, metadata


def reindex(data: Path) -> dict:
    """Rebuild every derived file from the records already in a data directory, where the RDF source is not at hand."""
    active, metadata = read_data(lambda name: read_json(data / name))
    return write_data(data, active, metadata)


def rebuilt(read) -> dict[str, bytes]:
    """What --reindex would write for a data directory, without writing it, so a build can compare it to what is there.
    An index, a number index or a shard map that no longer matches the records beside it is still a valid file: every
    position in it resolves and the lookup simply never sees what the two disagree about, so only rebuilding finds it."""
    active, metadata = read_data(read)
    return dict(generated(active, metadata)[1])


def record_slugs(records: dict[str, dict]) -> set[str]:
    """Every Nomisma concept the packed records name in a field the card renders."""
    slugs: set[str] = set()
    for record in records.values():
        for key in CONCEPT_KEYS:
            slugs.update(record.get(key, []))
        for side in ("o", "r"):
            slugs.update((record.get(side) or {}).get("p", []))
    return {slug for slug in slugs if NOMISMA_SLUG.fullmatch(slug)}


def bundled_slugs(read_corpus) -> set[str]:
    """The concepts every bundled corpus references, read the way the reader reads the records themselves."""
    slugs: set[str] = set()
    for name in sorted(CORPORA):
        read = read_corpus(name)
        if read is None:
            continue
        slugs |= record_slugs(read_data(read)[0])
    return slugs


def label_payload(snapshot: object, slugs: set[str]) -> dict:
    """The generated file: the English label of every bundled concept Nomisma names, and nothing else.

    A concept the snapshot does not label is left out rather than title-cased into a label nobody published, so the
    card falls back to the identifier exactly as it does today."""
    labels = snapshot.get("labels") if isinstance(snapshot, dict) else None
    if not isinstance(labels, dict):
        raise ImportFailure(f"{LABEL_FILE} holds no labels")
    kept = {}
    for slug in sorted(slugs):
        label = labels.get(slug)
        if label is None:
            continue
        if not isinstance(label, str) or not label.strip():
            raise ImportFailure(f"unusable Nomisma label for {slug}")
        kept[slug] = label
    return {"schemaVersion": 1, "labels": kept}


def fetch_labels(slugs: set[str], retrieved_on: str) -> dict:
    """One SPARQL request per batch of identifiers, and no other request: the snapshot the build reads instead of the network."""
    try:
        date.fromisoformat(retrieved_on)
    except ValueError as error:
        raise ImportFailure("retrieval date must be a real ISO date") from error
    ordered = sorted(slugs)
    labels: dict[str, str] = {}
    requests = 0
    for start in range(0, len(ordered), LABEL_BATCH):
        batch = ordered[start:start + LABEL_BATCH]
        query = LABEL_QUERY % " ".join(f"<{slug}>" for slug in batch)
        request = Request(f"{LABEL_ENDPOINT}?{urlencode({'query': query, 'output': 'json'})}",
                          headers={"Accept": "application/sparql-results+json", "User-Agent": LABEL_USER_AGENT})
        with urlopen(request, timeout=120) as response:
            if response.status != 200:
                raise ImportFailure(f"Nomisma query returned HTTP {response.status}")
            payload = json.loads(response.read())
        requests += 1
        for binding in payload.get("results", {}).get("bindings", []):
            uri = (binding.get("id") or {}).get("value") or ""
            label = " ".join(((binding.get("label") or {}).get("value") or "").split())
            if not uri.startswith(NOMISMA_ID) or not label:
                continue
            slug = uri[len(NOMISMA_ID):]
            # Two English preferred labels for one concept is not something to choose between: it stops the fetch.
            if labels.setdefault(slug, label) != label:
                raise ImportFailure(f"Nomisma gives {slug} two English labels")
    return {
        "endpoint": LABEL_ENDPOINT,
        "query": LABEL_QUERY,
        "batchSize": LABEL_BATCH,
        "requestCount": requests,
        "retrievedOn": retrieved_on,
        "license": LABEL_LICENSE,
        "licenseUrl": LABEL_LICENSE_URL,
        "requestedCount": len(ordered),
        "labelledCount": len(labels),
        "labels": dict(sorted(labels.items())),
    }


def snapshot_bytes(snapshot: dict) -> bytes:
    return (json.dumps(snapshot, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8")


def corpus_reader(root: Path):
    return lambda name: (lambda file_name: read_json(root / name / file_name)) if (root / name).is_dir() else None


def write_labels(root: Path, snapshot: Path) -> int:
    """Regenerate the bundled label file from the tracked snapshot and the records beside it. No network, same bytes every time."""
    payload = json_bytes(label_payload(read_json(snapshot), bundled_slugs(corpus_reader(root))))
    if len(payload) > CAP_BYTES:
        raise ImportFailure(f"{LABEL_FILE} is larger than the {CAP_BYTES} byte cap")
    write_file(root / LABEL_FILE, payload)
    return len(json.loads(payload)["labels"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?")
    parser.add_argument("output", type=Path, nargs="?")
    parser.add_argument("--corpus", choices=sorted(CORPORA),
                        help="which ANS type series the source exports (default: ocre)")
    parser.add_argument("--generated-on", help="explicit YYYY-MM-DD data generation date")
    parser.add_argument("--reindex", type=Path, metavar="DATA_DIR",
                        help="rebuild the indexes and shards of an existing data directory, without the RDF source")
    parser.add_argument("--fetch-labels", type=Path, nargs="?", const=DEFAULT_DATA_ROOT, metavar="DATA_ROOT",
                        help=f"fetch the English Nomisma label of every concept the bundled records name into {DEFAULT_LABEL_SNAPSHOT.name}")
    parser.add_argument("--write-labels", type=Path, nargs="?", const=DEFAULT_DATA_ROOT, metavar="DATA_ROOT",
                        help="regenerate the bundled label file from the tracked snapshot, without the network")
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_LABEL_SNAPSHOT,
                        help="the tracked Nomisma label snapshot to fetch into or generate from")
    parser.add_argument("--retrieved-on", help="explicit YYYY-MM-DD retrieval date for --fetch-labels")
    args = parser.parse_args()
    if args.fetch_labels is not None or args.write_labels is not None:
        root = args.fetch_labels if args.fetch_labels is not None else args.write_labels
        if args.source is not None or args.output is not None or args.reindex is not None or args.corpus is not None:
            parser.error("--fetch-labels and --write-labels take no source, output, --corpus or --reindex")
        try:
            if args.fetch_labels is not None:
                if not args.retrieved_on:
                    parser.error("--fetch-labels needs --retrieved-on")
                snapshot = fetch_labels(bundled_slugs(corpus_reader(root)), args.retrieved_on)
                args.snapshot.parent.mkdir(parents=True, exist_ok=True)
                write_file(args.snapshot, snapshot_bytes(snapshot))
                print(f"Fetched {snapshot['labelledCount']} of {snapshot['requestedCount']} Nomisma labels "
                      f"in {snapshot['requestCount']} requests.")
            else:
                print(f"Wrote {write_labels(root, args.snapshot)} Nomisma labels to {root / LABEL_FILE}.")
        except (ImportFailure, OSError, json.JSONDecodeError) as error:
            print(f"label import failed: {error}", file=sys.stderr)
            return 1
        return 0
    if args.reindex is not None:
        # The corpus of a data directory is its own metadata's, never the command line's.
        if args.source is not None or args.output is not None or args.generated_on is not None or args.corpus is not None:
            parser.error("--reindex takes no source, output, --corpus or --generated-on")
        try:
            metadata = reindex(args.reindex)
        except (ImportFailure, OSError) as error:
            print(f"reindex failed: {error}", file=sys.stderr)
            return 1
        print(f"Reindexed {summary(metadata)}")
        return 0
    if args.source is None or args.output is None or args.generated_on is None:
        parser.error("source, output and --generated-on are required")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.generated_on):
        parser.error("--generated-on must be YYYY-MM-DD")
    try:
        metadata = convert(args.corpus or "ocre", args.source, args.output, args.generated_on)
    except (ImportFailure, ET.ParseError, OSError) as error:
        print(f"RDF import failed: {error}", file=sys.stderr)
        return 1
    print(f"Imported {summary(metadata)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
