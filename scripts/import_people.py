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
# scripts/import_rdf.py refuses the same two declarations before it parses anything. Its check is not importable: it lives inside inspect_source(),
# which takes a Path and digests the whole file as it goes, and this script is loaded by its file path (the tests load it that way too), so "scripts"
# is on no import path. The pattern and the raise are copied here instead, once, in front of every parse this script makes.
FORBIDDEN_DECLARATION = re.compile(br"<!\s*(?:DOCTYPE|ENTITY)\b", re.IGNORECASE)
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
# The tracked mint snapshot the generated header names. It is where fetch-mints writes, and the only
# one a regeneration should read, so the option defaults to it rather than to no mints at all.
DEFAULT_MINTS = Path(__file__).resolve().parent / "data" / "nomisma-mints.json"


def parsed_xml(payload: bytes):
    """The RDF/XML of a snapshot or a fetched response, parsed. ElementTree expands internal entities, so a declaration is refused before it can."""
    # The pattern reads UTF-8 bytes. The same declaration written in UTF-16 or UTF-32 carries a NUL between every
    # character and matches nothing, while expat works the encoding out for itself and expands the entity: input that is
    # not UTF-8 is turned away first, by its byte order mark or by the NUL such a file carries among its first four
    # bytes, exactly as scripts/import_rdf.py turns it away.
    if payload.startswith((b"\xff\xfe", b"\xfe\xff", b"\x00\x00\xfe\xff", b"\xff\xfe\x00\x00")) or b"\x00" in payload[:4]:
        raise ValueError("RDF input must be UTF-8 XML")
    if FORBIDDEN_DECLARATION.search(payload):
        raise ValueError("DTD and entity declarations are not allowed")
    return ET.fromstring(payload)


def read_memberships(data_dir: Path) -> dict[str, set[str]]:
    metadata = json.loads((data_dir / "metadata.json").read_text(encoding="utf-8"))
    memberships: dict[str, set[str]] = {}
    for prefix, parts in metadata["shards"].items():
        if prefix not in VOLUMES:
            raise ValueError(f"unsupported RIC volume prefix: {prefix}")
        # A volume over the packaging file cap ships as several parts, and every one of them holds records of that volume.
        for part in parts:
            payload = json.loads((data_dir / part["file"]).read_text(encoding="utf-8"))
            for record in payload["records"].values():
                ids = list(record.get("a", [])) + list(record.get("o", {}).get("p", []))
                for concept_id in ids:
                    if not SLUG.fullmatch(concept_id):
                        raise ValueError(f"unsupported Nomisma concept id: {concept_id}")
                    memberships.setdefault(concept_id, set()).add(prefix)
    return memberships


MINT_VOLUMES = {"6", "7", "8", "9"}
# RIC VI-IX are filed by mint, so a record's own title names the mint section it belongs to. A subtype title ("Treveri 17A: Subtype") is not a
# section, and a record naming no mint or several cannot say which section is whose.
MINT_TITLE = re.compile(r"^RIC (?:VI|VII|VIII|IX) ([^:]+) \S+$")
MINT_ENDPOINT = "https://nomisma.org/id/{concept_id}.rdf"


def read_mints(data_dir: Path) -> dict[str, str]:
    """The Nomisma mint concept behind each RIC VI-IX section, read from the bundled records' own titles."""
    metadata = json.loads((data_dir / "metadata.json").read_text(encoding="utf-8"))
    sections: dict[str, set[str]] = {}
    for prefix, parts in metadata["shards"].items():
        if prefix not in MINT_VOLUMES:
            continue
        for part in parts:
            payload = json.loads((data_dir / part["file"]).read_text(encoding="utf-8"))
            for record in payload["records"].values():
                title = MINT_TITLE.match(record.get("l") or "")
                ids = record.get("m") or []
                if not title or len(ids) != 1:
                    continue
                if not SLUG.fullmatch(ids[0]):
                    raise ValueError(f"unsupported Nomisma concept id: {ids[0]}")
                sections.setdefault(ids[0], set()).add(title.group(1))
    # A concept whose records disagree about the section names it: nothing is guessed, and it is left out.
    return {concept_id: next(iter(names)) for concept_id, names in sorted(sections.items()) if len(names) == 1}


def fetch_mint_snapshot(mint_ids, output: Path, retrieved_on: str) -> int:
    """One GET per mint concept, saved verbatim as one snapshot the build reads instead of the network."""
    date.fromisoformat(retrieved_on)
    concepts = {}
    for concept_id in sorted(set(mint_ids)):
        url = MINT_ENDPOINT.format(concept_id=concept_id)
        request = Request(url, headers={"Accept": "application/rdf+xml", "User-Agent": "Giga-Pinax-data-import/1"})
        with urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise OSError(f"Nomisma returned HTTP {response.status} for {url}")
            payload = response.read()
        root = parsed_xml(payload)
        labels = sorted({(child.tag.replace(SKOS, ""), (child.get(XML + "lang") or "").lower(), " ".join(child.text.split()))
                         for node in root if (node.get(RDF + "about") or "") == NOMISMA_ID + concept_id
                         for child in node if child.tag in (SKOS + "prefLabel", SKOS + "altLabel") and child.text})
        concepts[concept_id] = {"url": url, "labels": [list(label) for label in labels]}
    snapshot = {
        "requestUrl": MINT_ENDPOINT,
        "retrievedOn": retrieved_on,
        "license": LICENSE,
        "licenseUrl": LICENSE_URL,
        "concepts": concepts,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes((json.dumps(snapshot, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8"))
    return len(concepts)


def mint_rows(snapshot_bytes: bytes, sections: dict[str, str]) -> list[tuple[str, str, list[str]]]:
    """Each RIC mint section with the modern English name Nomisma gives its concept.

    Nomisma titles a mint concept by its modern name and keeps the ancient one beside it ("Trier", altLabel "Treveri"), so the alias is every
    English label that is not the section RIC files the coins under. A concept with no English label of its own is left out rather than invented.
    """
    snapshot = json.loads(snapshot_bytes)
    rows = []
    for concept_id, section in sorted(sections.items(), key=lambda item: item[1]):
        concept = snapshot.get("concepts", {}).get(concept_id)
        if not concept:
            continue
        own = normalise_alias(section)
        aliases = sorted({alias for _, lang, value in concept["labels"] if lang.split("-")[0] == "en"
                          for alias in [normalise_alias(value)] if alias and alias != own})
        if aliases:
            rows.append((concept_id, section, aliases))
    return rows


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
    parsed_xml(payload)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)


def binding_value(binding, key):
    value = binding.get(key, {})
    return value.get("value") if isinstance(value, dict) else None


def written_language(tag) -> bool:
    """Whether a label's language is one a dealer writes a Roman ruler's name in: English or Latin."""
    code = (tag.get("xml:lang") if isinstance(tag, dict) else tag) or ""
    return code.lower().split("-")[0] in ("en", "la")


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
    """The aliases each person keeps: normalised, de-duplicated, never their own name.

    A spelling two people share ("Valerianus" is the Latin name of both Valerians) is kept on both of them. The lookup already handles a name with
    several owners by offering them all, and that is the honest answer: dropping the alias loses the name, and keeping it on one owner alone would
    open somebody else's coin.
    """
    normalised = {}
    for concept_id, (name, labels) in people.items():
        own = normalise_alias(name)
        aliases = []
        for label in labels:
            alias = normalise_alias(label)
            if alias and alias != own and alias not in aliases:
                aliases.append(alias)
        normalised[concept_id] = aliases
    return {concept_id: sorted(aliases) for concept_id, aliases in normalised.items()}


def read_concepts(snapshot_bytes: bytes, memberships) -> dict:
    concepts = {}
    if snapshot_bytes.lstrip().startswith(b"{"):
        payload = json.loads(snapshot_bytes)
        bindings = payload.get("results", {}).get("bindings", [])
        rows = ((binding_value(b, "id"), binding_value(b, "label"),
                 binding_value(b, "altLabel") if written_language(b.get("altLabel")) else None,
                 binding_value(b, "type")) for b in bindings)
    else:
        root = parsed_xml(snapshot_bytes)
        extracted = []
        for node in root:
            uri = node.get(RDF + "about")
            types = [node.tag[1:].replace("}", "", 1)] if node.tag.startswith("{") else []
            types += [child.get(RDF + "resource") for child in node if child.tag == RDF + "type"]
            labels = [child.text.strip() for child in node if child.tag == SKOS + "prefLabel" and child.text
                      and (child.get(XML + "lang") or "").lower().startswith("en")]
            # Only the English and Latin labels, which are the spellings a dealer writes. Every other language was tried and had to be taken out:
            # its labels are ordinary words of that language as often as they are names ("August", "Severe", "Marc", "Juan", "Mario"), and a lot's
            # prose then named rulers nobody wrote down.
            aliases = [child.text.strip() for child in node if child.tag in (SKOS + "prefLabel", SKOS + "altLabel") and child.text
                       and written_language(child.get(XML + "lang"))]
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


def generate(snapshot: Path, memberships: dict[str, set[str]], output: Path, generated_on: str, mints=()) -> dict:
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
    rows = [(concept_id, name, volumes, kept[concept_id]) for concept_id, name, volumes, _ in rows]

    report = {
        "referencedConceptCount": len(memberships),
        "personCount": len(rows),
        "excludedNonPersonCount": non_person,
        "excludedMissingLabelCount": missing_label,
        "missingConceptCount": missing_concept,
        "aliasCount": sum(len(aliases) for _, _, _, aliases in rows),
        "mintCount": len(mints),
        "mintAliasCount": sum(len(aliases) for _, _, aliases in mints),
    }
    source = {
        "endpoint": ENDPOINT,
        "snapshotSha256": hashlib.sha256(snapshot_bytes).hexdigest(),
        "generatedOn": generated_on,
        "license": LICENSE,
        "licenseUrl": LICENSE_URL,
        **report,
    }
    # The provenance is a header comment, not an export: nothing in the extension read it, and the
    # licence, snapshot digest and counts have to travel with the file whether or not code uses them.
    lines = [
        "// Generated from the bundled OCRE records, one official Nomisma aggregate RDF snapshot and the tracked Nomisma mint snapshot.",
        "// Source:",
        *(f"//   {key}: {json.dumps(value, ensure_ascii=False)}" for key, value in source.items()),
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
    lines.append("]);")
    lines += [
        "",
        "// The modern name Nomisma gives each RIC VI-IX mint section, in English only. A mint whose concept carries no English name but the one RIC",
        "// files it under has no alias here, and none was invented for it.",
        "export const RIC_MINTS = Object.freeze([",
    ]
    for concept_id, section, aliases in mints:
        lines.append(
            "  Object.freeze({ "
            f"id: {json.dumps(concept_id, ensure_ascii=False)}, section: {json.dumps(section, ensure_ascii=False)}, "
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
    mints = subparsers.add_parser("fetch-mints", help="fetch one Nomisma concept per RIC VI-IX mint section")
    mints.add_argument("data_dir", type=Path)
    mints.add_argument("snapshot", type=Path)
    mints.add_argument("--retrieved-on", required=True)
    build = subparsers.add_parser("generate", help="generate the offline JavaScript people index")
    build.add_argument("data_dir", type=Path)
    build.add_argument("snapshot", type=Path)
    build.add_argument("output", type=Path)
    build.add_argument("--mints", type=Path, default=DEFAULT_MINTS)
    build.add_argument("--generated-on", required=True)
    args = parser.parse_args()
    try:
        if args.command == "fetch-mints":
            sections = read_mints(args.data_dir)
            print(f"Fetched {fetch_mint_snapshot(sections, args.snapshot, args.retrieved_on)} Nomisma mint concepts, one request each.")
            return 0
        memberships = read_memberships(args.data_dir)
        if args.command == "fetch":
            fetch_snapshot(memberships, args.snapshot)
            print(f"Fetched {len(memberships)} Nomisma concepts in one query.")
        else:
            # Said here rather than left to the header: a run with no mint snapshot would write a
            # file claiming one, with none of the eight mint sections in it.
            if not args.mints.is_file():
                raise ValueError(f"mint snapshot not found: {args.mints}")
            report = generate(args.snapshot, memberships, args.output, args.generated_on,
                              mint_rows(args.mints.read_bytes(), read_mints(args.data_dir)))
            print(json.dumps(report, sort_keys=True))
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"People import failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
