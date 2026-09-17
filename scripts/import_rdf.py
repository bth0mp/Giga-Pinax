#!/usr/bin/env python3
"""Convert an OCRE RDF/XML export into deterministic extension data shards."""

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


RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
XML = "{http://www.w3.org/XML/1998/namespace}"
NMO = "{http://nomisma.org/ontology#}"
SKOS = "{http://www.w3.org/2004/02/skos/core#}"
DC = "{http://purl.org/dc/terms/}"
ABOUT = RDF + "about"
RESOURCE = RDF + "resource"
OCRE_ID = "http://numismatics.org/ocre/id/"
NOMISMA_ID = "http://nomisma.org/id/"
VOLUME = re.compile(r"^[0-9]+(?:_[0-9]+)?(?:\([0-9]+\))?$")
SHARD_NAME = re.compile(r"records-[0-9]+(?:_[0-9]+)?(?:\([0-9]+\))?(?:\.[a-z])?\.json")
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


def parse_source(path: Path) -> tuple[dict[str, dict], dict[str, list[str]], set[str]]:
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
                if not uri.startswith(OCRE_ID):
                    raise ImportFailure(f"unsupported type URI corpus: {uri}")
                record_id = uri[len(OCRE_ID):]
                if not record_id or "/" in record_id:
                    raise ImportFailure(f"invalid OCRE id: {uri}")
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


def replacement_aliases(records: dict[str, dict], replacements: dict[str, list[str]], excluded: set[str]) -> tuple[dict[str, str], dict[str, int]]:
    targets = {}
    ambiguous_nodes = set()
    for old_id, uris in replacements.items():
        if len(uris) != 1:
            ambiguous_nodes.add(old_id)
            continue
        uri = uris[0]
        targets[old_id] = uri[len(OCRE_ID):] if uri.startswith(OCRE_ID) else None

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


def write_data(output: Path, active: dict[str, dict], metadata: dict) -> dict:
    """Every generated file, from the active records and the metadata fields only the source itself can supply."""
    shards = defaultdict(dict)
    for record_id in sorted(active):
        parts = record_id.split(".")
        if len(parts) < 3 or parts[0] != "ric" or not VOLUME.fullmatch(parts[1]):
            raise ImportFailure(f"unsupported OCRE record id: {record_id}")
        shards[parts[1]][record_id] = active[record_id]

    shard_files = {}
    files = []
    for prefix in sorted(shards):
        parts = shard_parts(prefix, shards[prefix])
        for part in parts:
            files.append((output / part["file"], {"schemaVersion": 1, "records": part["records"]}))
        shard_files[prefix] = [{"file": part["file"], "from": part["from"]} for part in parts]
    entries = [[record_id, active[record_id]["l"]] for record_id in sorted(active)]
    complete = {**metadata, "activeRecordCount": len(active), "shards": shard_files}
    files += [(output / "index.json", {"schemaVersion": 1, "entries": entries}),
              (output / "numbers.json", {"schemaVersion": 1, "numbers": number_index(entries)}),
              (output / "metadata.json", complete)]

    # Every file is measured before any of them is written, so an import the cap refuses leaves the data directory
    # exactly as it found it rather than half replaced.
    payloads = [(path, json_bytes(value)) for path, value in files]
    for path, payload in payloads:
        if len(payload) > CAP_BYTES:
            raise ImportFailure(f"{path.name} is larger than the {CAP_BYTES} byte cap")
    output.mkdir(parents=True, exist_ok=True)
    written = [path for path, _ in payloads]
    for path, payload in payloads:
        write_file(path, payload)
    # A volume that stops being split leaves the file it was split into behind, which would ship in the package.
    for stale in sorted(output.glob("records-*.json")):
        if stale not in written and SHARD_NAME.fullmatch(stale.name):
            stale.unlink()
    return complete


def convert(source: Path, output: Path, generated_on: str) -> dict:
    try:
        date.fromisoformat(generated_on)
    except ValueError as error:
        raise ImportFailure("generated date must be a real ISO date") from error
    input_bytes, source_sha256 = inspect_source(source)
    records, replacements, conflicts = parse_source(source)
    aliases, replacement_skips = replacement_aliases(records, replacements, conflicts)
    active = {record_id: record for record_id, record in records.items() if record_id not in replacements and record_id not in conflicts}
    metadata = {
        "schemaVersion": 1,
        "corpus": "ocre",
        "sourceFilename": source.name,
        "inputBytes": input_bytes,
        "sourceSha256": source_sha256,
        "generatedOn": generated_on,
        "publicationDate": None,
        "sourceUrl": "https://numismatics.org/ocre/",
        "license": "ODbL-1.0",
        "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
        "recordCount": len(records),
        "activeRecordCount": len(active),
        "aliases": aliases,
        "replacementSkips": replacement_skips,
        "conflicts": {"count": len(conflicts), "ids": sorted(conflicts)},
        "shards": {},
    }
    return write_data(output, active, metadata)


def shard_count(metadata: dict) -> int:
    return sum(len(parts) for parts in metadata["shards"].values())


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ImportFailure(f"cannot read {path.name}: {error}") from error


def reindex(data: Path) -> dict:
    """Rebuild every derived file from the records already in a data directory, where the RDF source is not at hand."""
    metadata = read_json(data / "metadata.json")
    if not isinstance(metadata, dict) or metadata.get("schemaVersion") != 1 or metadata.get("corpus") != "ocre":
        raise ImportFailure("unsupported OCRE metadata")
    shards = metadata.get("shards")
    if not isinstance(shards, dict) or not shards:
        raise ImportFailure("OCRE metadata must name its shards")
    active: dict[str, dict] = {}
    for prefix in sorted(shards):
        parts = shards[prefix]
        if not isinstance(parts, list) or not parts:
            raise ImportFailure(f"volume {prefix} names no shard file")
        for part in parts:
            name = part.get("file") if isinstance(part, dict) else None
            if not isinstance(name, str) or not SHARD_NAME.fullmatch(name):
                raise ImportFailure(f"unsafe shard name in volume {prefix}")
            records = read_json(data / name)
            records = records.get("records") if isinstance(records, dict) else None
            if not isinstance(records, dict):
                raise ImportFailure(f"{name} holds no records")
            for record_id, record in records.items():
                if not isinstance(record, dict) or record.get("i") != record_id or record_id in active:
                    raise ImportFailure(f"{name} misfiles the record {record_id}")
                active[record_id] = record
    # The counts are the source's own, so a data directory short of a shard is a broken input, never a smaller bundle.
    if metadata.get("activeRecordCount") != len(active):
        raise ImportFailure(f"the shards hold {len(active)} records, the metadata counts {metadata.get('activeRecordCount')}")
    return write_data(data, active, metadata)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?")
    parser.add_argument("output", type=Path, nargs="?")
    parser.add_argument("--generated-on", help="explicit YYYY-MM-DD data generation date")
    parser.add_argument("--reindex", type=Path, metavar="DATA_DIR",
                        help="rebuild the indexes and shards of an existing data directory, without the RDF source")
    args = parser.parse_args()
    if args.reindex is not None:
        if args.source is not None or args.output is not None or args.generated_on is not None:
            parser.error("--reindex takes no source, output or --generated-on")
        try:
            metadata = reindex(args.reindex)
        except (ImportFailure, OSError) as error:
            print(f"reindex failed: {error}", file=sys.stderr)
            return 1
        print(f"Reindexed {metadata['activeRecordCount']} active OCRE records into {shard_count(metadata)} shard files.")
        return 0
    if args.source is None or args.output is None or args.generated_on is None:
        parser.error("source, output and --generated-on are required")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.generated_on):
        parser.error("--generated-on must be YYYY-MM-DD")
    try:
        metadata = convert(args.source, args.output, args.generated_on)
    except (ImportFailure, ET.ParseError, OSError) as error:
        print(f"RDF import failed: {error}", file=sys.stderr)
        return 1
    print(f"Imported {metadata['activeRecordCount']} active OCRE records into {shard_count(metadata)} shard files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
