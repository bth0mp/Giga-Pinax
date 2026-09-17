#!/usr/bin/env python3
"""Fetch one Nomisma concept snapshot and generate the static RIC people index."""

from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ENDPOINT = "https://nomisma.org/apis/getRdf"
NOMISMA_ID = "http://nomisma.org/id/"
FOAF_PERSON = "http://xmlns.com/foaf/0.1/Person"
RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
SKOS = "{http://www.w3.org/2004/02/skos/core#}"
XML = "{http://www.w3.org/XML/1998/namespace}"
LICENSE = "CC-BY-3.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/3.0/"
SLUG = re.compile(r"^[A-Za-z0-9._~-]+$")
VOLUMES = {
    "1(2)": "I (2nd edition)",
    "2": "II",
    "2_1(2)": "II, Part 1 (2nd edition)",
    "2_3(2)": "II, Part 3 (2nd edition)",
    "3": "III",
    "4": "IV",
    "5": "V",
    "6": "VI",
    "7": "VII",
    "8": "VIII",
    "9": "IX",
    "10": "X",
}
VOLUME_ORDER = {volume: index for index, volume in enumerate(VOLUMES.values())}


def read_memberships(data_dir: Path) -> dict[str, set[str]]:
    metadata = json.loads((data_dir / "metadata.json").read_text(encoding="utf-8"))
    memberships: dict[str, set[str]] = {}
    for prefix, filename in metadata["shards"].items():
        if prefix not in VOLUMES:
            raise ValueError(f"unsupported RIC volume prefix: {prefix}")
        payload = json.loads((data_dir / filename).read_text(encoding="utf-8"))
        for record in payload["records"].values():
            ids = list(record.get("a", [])) + list(record.get("o", {}).get("p", []))
            for concept_id in ids:
                if not SLUG.fullmatch(concept_id):
                    raise ValueError(f"unsupported Nomisma concept id: {concept_id}")
                memberships.setdefault(concept_id, set()).add(prefix)
    return memberships


def fetch_snapshot(concept_ids, output: Path) -> None:
    identifiers = "|".join(sorted(set(concept_ids)))
    request = Request(
        f"{ENDPOINT}?{urlencode({'identifiers': identifiers, 'format': 'xml'})}",
        headers={"Accept": "application/rdf+xml", "User-Agent": "Giga-Pinax-data-import/1"},
    )
    with urlopen(request, timeout=60) as response:
        if response.status != 200:
            raise OSError(f"Nomisma query returned HTTP {response.status}")
        payload = response.read()
    ET.fromstring(payload)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)


def binding_value(binding, key):
    value = binding.get(key, {})
    return value.get("value") if isinstance(value, dict) else None


def normalise_alias(label: str) -> str | None:
    """One alias as the extension compares names: folded, its diacritics stripped, its spacing squashed.

    None for anything the extension could never match: a label in another script, or nothing at all. Dealers write Latin script, so a Greek or
    Cyrillic spelling of a ruler's name would only weigh down the bundled table. The full stop of an abbreviated Latin label ("Constantinus II.")
    is no part of the name either, and left on it would outrank the same name without it.
    """
    stripped = "".join(part for part in unicodedata.normalize("NFD", label or "") if not unicodedata.combining(part))
    folded = " ".join(stripped.casefold().split()).rstrip(".").strip()
    return folded if folded and folded.isascii() else None


def alias_rows(people: dict[str, tuple[str, list[str]]]) -> dict[str, list[str]]:
    """The aliases each person keeps: normalised, de-duplicated, never their own name, never one that names two people."""
    normalised = {}
    for concept_id, (name, labels) in people.items():
        own = normalise_alias(name)
        aliases = []
        for label in labels:
            alias = normalise_alias(label)
            if alias and alias != own and alias not in aliases:
                aliases.append(alias)
        normalised[concept_id] = aliases
    owners: dict[str, int] = {}
    for aliases in normalised.values():
        for alias in aliases:
            owners[alias] = owners.get(alias, 0) + 1
    return {concept_id: sorted(alias for alias in aliases if owners[alias] == 1) for concept_id, aliases in normalised.items()}


def read_concepts(snapshot_bytes: bytes, memberships) -> dict:
    concepts = {}
    if snapshot_bytes.lstrip().startswith(b"{"):
        payload = json.loads(snapshot_bytes)
        bindings = payload.get("results", {}).get("bindings", [])
        rows = ((binding_value(b, "id"), binding_value(b, "label"),
                 binding_value(b, "altLabel"), binding_value(b, "type")) for b in bindings)
    else:
        root = ET.fromstring(snapshot_bytes)
        extracted = []
        for node in root:
            uri = node.get(RDF + "about")
            types = [node.tag[1:].replace("}", "", 1)] if node.tag.startswith("{") else []
            types += [child.get(RDF + "resource") for child in node if child.tag == RDF + "type"]
            labels = [child.text.strip() for child in node if child.tag == SKOS + "prefLabel" and child.text
                      and (child.get(XML + "lang") or "").lower().startswith("en")]
            # Every prefLabel and altLabel Nomisma files, whatever language it is under: a heading spelling is a heading spelling ("Valerian I" is
            # Nomisma's Norwegian label for Valerian, "Constantius I" its Romanian one), and normalise_alias drops the scripts a dealer never writes.
            aliases = [child.text.strip() for child in node if child.tag in (SKOS + "prefLabel", SKOS + "altLabel") and child.text]
            extracted.extend((uri, label, alias, concept_type) for concept_type in types if concept_type
                             for label in labels or [None] for alias in aliases or [None])
        rows = extracted
    for uri, label, alternate, concept_type in rows:
        if not uri or not uri.startswith(NOMISMA_ID):
            continue
        concept_id = uri[len(NOMISMA_ID):]
        if concept_id not in memberships:
            continue
        concept = concepts.setdefault(concept_id, {"labels": set(), "aliases": set(), "types": set()})
        if label: concept["labels"].add(label)
        if alternate: concept["aliases"].add(alternate)
        if concept_type: concept["types"].add(concept_type)
    return concepts


def generate(snapshot: Path, memberships: dict[str, set[str]], output: Path, generated_on: str) -> dict:
    date.fromisoformat(generated_on)
    snapshot_bytes = snapshot.read_bytes()
    concepts = read_concepts(snapshot_bytes, memberships)

    rows = []
    non_person = missing_label = missing_concept = 0
    for concept_id in sorted(memberships):
        concept = concepts.get(concept_id)
        if concept is None:
            missing_concept += 1
            continue
        if FOAF_PERSON not in concept["types"]:
            non_person += 1
            continue
        if len(concept["labels"]) != 1:
            missing_label += 1
            continue
        name = next(iter(concept["labels"]))
        volumes = sorted((VOLUMES[prefix] for prefix in memberships[concept_id]), key=VOLUME_ORDER.get)
        rows.append((concept_id, name, volumes, sorted(concept["aliases"])))

    kept = alias_rows({concept_id: (name, labels) for concept_id, name, _, labels in rows})
    offered = sum(len({normalise_alias(label) for label in labels} - {None, normalise_alias(name)}) for _, name, _, labels in rows)
    rows = [(concept_id, name, volumes, kept[concept_id]) for concept_id, name, volumes, _ in rows]

    report = {
        "referencedConceptCount": len(memberships),
        "personCount": len(rows),
        "excludedNonPersonCount": non_person,
        "excludedMissingLabelCount": missing_label,
        "missingConceptCount": missing_concept,
        "aliasCount": sum(len(aliases) for _, _, _, aliases in rows),
        "droppedAliasCount": offered - sum(len(aliases) for _, _, _, aliases in rows),
    }
    source = {
        "endpoint": ENDPOINT,
        "snapshotSha256": hashlib.sha256(snapshot_bytes).hexdigest(),
        "generatedOn": generated_on,
        "license": LICENSE,
        "licenseUrl": LICENSE_URL,
        **report,
    }
    lines = [
        "// Generated from the bundled OCRE records and one official Nomisma aggregate RDF snapshot.",
        "export const RIC_PEOPLE_SOURCE = Object.freeze({",
        *(f"  {key}: {json.dumps(value, ensure_ascii=False)}," for key, value in source.items()),
        "});",
        "",
        "export const RIC_PEOPLE = Object.freeze([",
    ]
    for concept_id, name, volumes, aliases in rows:
        lines.append(
            "  Object.freeze({ "
            f"id: {json.dumps(concept_id, ensure_ascii=False)}, name: {json.dumps(name, ensure_ascii=False)}, "
            f"volumes: Object.freeze({json.dumps(volumes, ensure_ascii=False)}), "
            f"aliases: Object.freeze({json.dumps(aliases, ensure_ascii=False)})"
            " }),"
        )
    lines.append("]);\n")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes("\n".join(lines).encode("utf-8"))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    fetch = subparsers.add_parser("fetch", help="make the single official Nomisma bulk request")
    fetch.add_argument("data_dir", type=Path)
    fetch.add_argument("snapshot", type=Path)
    build = subparsers.add_parser("generate", help="generate the offline JavaScript people index")
    build.add_argument("data_dir", type=Path)
    build.add_argument("snapshot", type=Path)
    build.add_argument("output", type=Path)
    build.add_argument("--generated-on", required=True)
    args = parser.parse_args()
    try:
        memberships = read_memberships(args.data_dir)
        if args.command == "fetch":
            fetch_snapshot(memberships, args.snapshot)
            print(f"Fetched {len(memberships)} Nomisma concepts in one query.")
        else:
            report = generate(args.snapshot, memberships, args.output, args.generated_on)
            print(json.dumps(report, sort_keys=True))
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"People import failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
