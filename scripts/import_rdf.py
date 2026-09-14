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


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def write_file(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(json_bytes(value))
    temporary.replace(path)


def convert(source: Path, output: Path, generated_on: str) -> dict:
    try:
        date.fromisoformat(generated_on)
    except ValueError as error:
        raise ImportFailure("generated date must be a real ISO date") from error
    input_bytes, source_sha256 = inspect_source(source)
    records, replacements, conflicts = parse_source(source)
    aliases, replacement_skips = replacement_aliases(records, replacements, conflicts)
    active = {record_id: record for record_id, record in records.items() if record_id not in replacements and record_id not in conflicts}
    shards = defaultdict(dict)
    for record_id in sorted(active):
        parts = record_id.split(".")
        if len(parts) < 3 or parts[0] != "ric" or not VOLUME.fullmatch(parts[1]):
            raise ImportFailure(f"unsupported OCRE record id: {record_id}")
        shards[parts[1]][record_id] = active[record_id]

    output.mkdir(parents=True, exist_ok=True)
    shard_files = {}
    for prefix in sorted(shards):
        filename = f"records-{prefix}.json"
        shard_files[prefix] = filename
        write_file(output / filename, {"schemaVersion": 1, "records": shards[prefix]})
    write_file(output / "index.json", {
        "schemaVersion": 1,
        "entries": [[record_id, active[record_id]["l"]] for record_id in sorted(active)],
    })
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
        "shards": shard_files,
    }
    write_file(output / "metadata.json", metadata)
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--generated-on", required=True, help="explicit YYYY-MM-DD data generation date")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.generated_on):
        parser.error("--generated-on must be YYYY-MM-DD")
    try:
        metadata = convert(args.source, args.output, args.generated_on)
    except (ImportFailure, ET.ParseError, OSError) as error:
        print(f"RDF import failed: {error}", file=sys.stderr)
        return 1
    print(f"Imported {metadata['activeRecordCount']} active OCRE records into {len(metadata['shards'])} shards.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
