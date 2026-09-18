#!/usr/bin/env python3
"""Fetch the Nomisma and Wikidata concept snapshots and generate the static RIC people and mint index."""

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
# Every request this script makes names the script, so nomisma.org and wikidata.org can see who asked and where to complain.
USER_AGENT = "Giga-Pinax-import_people.py/1 (+https://github.com/bth0mp/Giga-Pinax)"
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
# The language the mint's own modern country writes its name in. A country spells the place it holds as the place, so that label is the modern name
# a dealer means when he writes it, while every other language only offers its own exonym. The choice is made per mint, by hand, from where the mint
# stands today, and a mint concept missing from this table stops the run rather than quietly losing its name. Several of these languages write in a
# script the extension can never match (Arabic, Bulgarian, Greek, Serbian Cyrillic); normalise_alias drops those, and nothing is transliterated.
MINT_COUNTRY_LANGUAGE = {
    "alexandreia_egypt": "ar",     # Alexandria, Egypt
    "ambianum": "fr",              # Amiens, France
    "antiocheia_syria": "tr",      # Antakya, Turkey
    "aquileia": "it",              # Aquileia, Italy
    "arelate": "fr",               # Arles, France
    "carthage": "ar",              # Carthage, Tunisia
    "constantinople": "tr",        # Istanbul, Turkey
    "cyzicus": "tr",               # Erdek, Turkey
    "heraclea_thracica": "tr",     # Marmara Ereglisi, Turkey
    "londinium": "en",             # London, United Kingdom
    "lugdunum": "fr",              # Lyon, France
    "mediolanum": "it",            # Milan, Italy
    "nicomedia": "tr",             # Izmit, Turkey
    "ostia": "it",                 # Ostia, Italy
    "rome": "it",                  # Rome, Italy
    "serdica": "bg",               # Sofia, Bulgaria
    "sirmium": "sr",               # Sremska Mitrovica, Serbia
    "siscia": "hr",                # Sisak, Croatia
    "thessalonica": "el",          # Thessaloniki, Greece
    "ticinum": "it",               # Pavia, Italy
    "treveri": "de",               # Trier, Germany
}
# The languages whose spelling of a foreign city is the Latin-script exonym a dealer writing in English still puts on a ticket. One of them alone is
# that language's own word and no more ("Lione" is Italian for Lyon, "Cizico" Italian for Cyzicus); a spelling two of them share, once folded and
# stripped of its diacritics, is the exonym they have in common ("Arles" in French, German and Italian, "Sisak" in all four beside English).
EXONYM_LANGUAGES = frozenset({"en", "fr", "de", "it", "es"})
EXONYM_AGREEMENT = 2
# Spellings that are not a name of the mint, listed with the concept they belong to so this can never quietly take a real name from another mint.
# Three kinds, and nothing is guessed at beyond what is written here:
#   an encyclopaedia article's title — Nomisma's Italian label for Ticinum is "Storia di Pavia", and the Wikidata item Nomisma links beside the
#   Roman city is Q396445, the article "history of Pavia". Neither is the city's name in any language, so Ticinum keeps RIC's own spelling;
#   a nickname — prose about the city rather than a name a ticket carries, and the reason it must go is that a lot heading naming no ruler is read
#   for the earliest mint spelling in it, so "From the days of the Eternal City. Trier mint. RIC 12" would be filed under Rome;
#   a whole different place — Longpre-les-Amiens is a commune of its own, and the "espace urbain" is the statistical built-up area around Amiens
#   rather than the town the mint stood in.
# Italian "Urbe" is here as a nickname: it is what Italian calls Rome, and also the ordinary Italian and Spanish word for a city, which is exactly
# what ORDINARY_ENGLISH keeps out of the table in English.
NOT_A_NAME = frozenset((concept_id, alias) for concept_id, aliases in {
    "alexandreia_egypt": ["mediterranean's bride", "pearl of the mediterranean"],
    "ambianum": ["espace urbain d'amiens", "la petite venise du nord", "longpre-les-amiens"],
    "constantinople": ["the city of the world's desire"],
    "rome": ["capital of the world", "caput mundi", "citta dei sette colli", "citta eterna", "city of marble", "city of seven hills",
             "eternal city", "the capital of the world", "the city of marble", "the eternal city", "urbe"],
    "ticinum": ["history of pavia", "pavia history", "storia di pavia"],
}.items() for alias in aliases)
# An alias that is an ordinary English word would read a mint out of a sentence that named no mint at all. These two are what Croatian calls Rome
# ("Rim") and what German and Danish call it ("Rom"), and both are ordinary English words. "Rome" itself is kept: RIC heads a section with it.
ORDINARY_ENGLISH = frozenset({"rim", "rom"})
# RIC VI-IX are filed by mint, so a record's own title names the mint section it belongs to. A subtype title ("Treveri 17A: Subtype") is not a
# section, and a record naming no mint or several cannot say which section is whose.
MINT_TITLE = re.compile(r"^RIC (?:VI|VII|VIII|IX) ([^:]+) \S+$")
MINT_ENDPOINT = "https://nomisma.org/id/{concept_id}.rdf"
# A Nomisma mint concept links the same place in other vocabularies with skos:closeMatch and skos:exactMatch: Pleiades, GeoNames, DBpedia, the
# British Museum, Getty and Wikidata. Every one of those URIs is kept in the snapshot, because the link is the thing the snapshot has to record;
# only the Wikidata ones are followed, and only to the entity data endpoint below.
MINT_MATCHES = (SKOS + "closeMatch", SKOS + "exactMatch")
WIKIDATA_ENTITY = re.compile(r"^https?://www\.wikidata\.org/entity/(Q[1-9][0-9]*)$")
WIKIDATA_ENDPOINT = "https://www.wikidata.org/wiki/Special:EntityData/{entity_id}.json"
# Wikidata releases its structured data — labels and aliases included — into the public domain under CC0 1.0. It travels with the snapshot and with
# the generated file, because an attribution has to be readable wherever the data ends up.
WIKIDATA_LICENSE = "CC0-1.0"
WIKIDATA_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"
WIKIDATA_LICENSE_STATEMENT = ("Wikidata's structured data, including the labels and aliases kept here, is dedicated to the public domain under the "
                              "Creative Commons CC0 1.0 Universal Public Domain Dedication.")
# The tracked Wikidata snapshot, beside the Nomisma one: where fetch-wikidata writes and the only file a regeneration should read.
DEFAULT_WIKIDATA = Path(__file__).resolve().parent / "data" / "wikidata-mints.json"
# An alias of one or two characters is a code rather than a name — Wikidata lists "RM", Rome's Italian province code, among Roma's aliases — and a
# heading has runs of two letters in it that name no place at all.
MINIMUM_NAME_LENGTH = 3


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
        request = Request(url, headers={"Accept": "application/rdf+xml", "User-Agent": USER_AGENT})
        with urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise OSError(f"Nomisma returned HTTP {response.status} for {url}")
            payload = response.read()
        root = parsed_xml(payload)
        own = [node for node in root if (node.get(RDF + "about") or "") == NOMISMA_ID + concept_id]
        labels = sorted({(child.tag.replace(SKOS, ""), (child.get(XML + "lang") or "").lower(), " ".join(child.text.split()))
                         for node in own
                         for child in node if child.tag in (SKOS + "prefLabel", SKOS + "altLabel") and child.text})
        # The concept's links to the same place in other vocabularies, kept whole and sorted so the snapshot is the same file every time.
        matches = sorted({child.get(RDF + "resource") for node in own
                          for child in node if child.tag in MINT_MATCHES and child.get(RDF + "resource")})
        concepts[concept_id] = {"url": url, "labels": [list(label) for label in labels], "matches": matches}
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


def mint_entity_ids(concept) -> list[str]:
    """The Wikidata items one mint concept links to, in the order the snapshot holds its matches. Every other vocabulary's URI is left alone."""
    found = (WIKIDATA_ENTITY.match(uri) for uri in concept.get("matches", ()))
    return list(dict.fromkeys(match.group(1) for match in found if match))


def fetch_wikidata_snapshot(mints_bytes: bytes, output: Path, retrieved_on: str) -> tuple[int, list[str]]:
    """One GET per Wikidata item a mint concept links to, saved as the second tracked snapshot the build reads instead of the network.

    Only the labels and aliases are kept, and only in the languages a name is taken from: English, the four other exonym languages, and the language
    of the country each linking mint stands in today. Nothing else of the item is read, so no statement of it can put a name on a mint by itself.
    """
    date.fromisoformat(retrieved_on)
    concepts = json.loads(mints_bytes).get("concepts", {})
    wanted: dict[str, set[str]] = {}
    unlinked = []
    for concept_id, concept in sorted(concepts.items()):
        entity_ids = mint_entity_ids(concept)
        if not entity_ids:
            unlinked.append(concept_id)
            continue
        if concept_id not in MINT_COUNTRY_LANGUAGE:
            raise ValueError(f"no modern country language chosen for mint concept: {concept_id}")
        for entity_id in entity_ids:
            wanted.setdefault(entity_id, set(EXONYM_LANGUAGES)).add(MINT_COUNTRY_LANGUAGE[concept_id])
    entities = {}
    for entity_id, languages in sorted(wanted.items()):
        url = WIKIDATA_ENDPOINT.format(entity_id=entity_id)
        request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
        with urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise OSError(f"Wikidata returned HTTP {response.status} for {url}")
            payload = json.loads(response.read())
        item = payload.get("entities", {}).get(entity_id)
        if not item:
            raise ValueError(f"Wikidata returned no entity for {entity_id}")
        labels = {("prefLabel", lang, " ".join(value["value"].split()))
                  for lang, value in item.get("labels", {}).items() if lang in languages}
        labels |= {("altLabel", lang, " ".join(value["value"].split()))
                   for lang, values in item.get("aliases", {}).items() if lang in languages for value in values}
        entities[entity_id] = {"url": url, "labels": [list(label) for label in sorted(labels)]}
    snapshot = {
        "requestUrl": WIKIDATA_ENDPOINT,
        "retrievedOn": retrieved_on,
        "license": WIKIDATA_LICENSE,
        "licenseUrl": WIKIDATA_LICENSE_URL,
        "licenseStatement": WIKIDATA_LICENSE_STATEMENT,
        "entities": entities,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes((json.dumps(snapshot, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8"))
    return len(entities), unlinked


def concept_spellings(concept) -> dict[str, set[str]]:
    """Every normalised spelling in a mint concept's labels, with the base languages that write it."""
    spellings: dict[str, set[str]] = {}
    for _, lang, value in concept["labels"]:
        alias = normalise_alias(value)
        if alias:
            spellings.setdefault(alias, set()).add(lang.split("-")[0])
    return spellings


def mint_spellings(concept, entities) -> dict[str, set[str]]:
    """One mint's spellings from both snapshots at once: Nomisma's own labels and those of the Wikidata items it links to.

    The two sources are merged before any name is chosen, not after, so a spelling only one of them writes is weighed by the same rule as the rest:
    Wikidata's English label "Sofia" and Nomisma's Bulgarian one are the one place, and either may be the language that earns the name.
    """
    spellings = concept_spellings(concept)
    for entity in entities:
        for alias, languages in concept_spellings(entity).items():
            spellings.setdefault(alias, set()).update(languages)
    return spellings


def mint_names(spellings: dict[str, set[str]], section: str, language: str) -> set[str]:
    """The modern names Nomisma really writes for one mint, from three sources and no fourth.

    Nomisma titles some mint concepts by the modern name and keeps the ancient one beside it ("Trier", altLabel "Treveri"), and others by the ancient
    name alone; Wikidata, reached through the concept's own closeMatch link, writes the same place again. Three kinds of label are a modern name a
    dealer would write, so three kinds are taken from either source: every label in the language of the country the mint stands in today, which names
    the place as the place; every English label, which is the spelling this extension is read in; and a Latin-script exonym that several of
    EXONYM_LANGUAGES spell the same way. Nothing else is taken, and nothing is transliterated, shortened or title-cased into a name neither source
    publishes: the section RIC files the coins under is always reachable, so a missing alias costs a spelling, never a coin.
    """
    own = normalise_alias(section)
    taken = set()
    for alias, languages in spellings.items():
        exonyms = languages & EXONYM_LANGUAGES
        if language in languages or "en" in languages or len(exonyms) >= EXONYM_AGREEMENT:
            taken.add(alias)
    return {alias for alias in taken if alias != own and len(alias) >= MINIMUM_NAME_LENGTH}


def word_runs(alias: str) -> set[str]:
    """Every run of whole words in an alias, so "contains" is read by words and never inside one ("Arles" is no part of "Charles")."""
    words = alias.split(" ")
    return {" ".join(words[first:last]) for first in range(len(words)) for last in range(first + 1, len(words) + 1)}


def mint_rows(snapshot_bytes: bytes, sections: dict[str, str], rulers=(), wikidata_bytes: bytes | None = None) -> list[tuple[str, str, list[str]]]:
    """Each RIC mint section with the modern names Nomisma and Wikidata give its concept, less every name that could open somebody else's coin.

    A mint alias resolves a section and never a ruler, so a spelling that is also a ruler's — or that carries one inside it — is dropped rather than
    left to choose between a place and a man. So is a spelling two mints share, which could only name one of them wrongly, one that is another mint's
    own RIC section, one that is an ordinary English word, and one listed in NOT_A_NAME as an article's title or a whole different place. A mint left
    with nothing keeps RIC's own spelling and no alias is invented for it.
    """
    snapshot = json.loads(snapshot_bytes)
    entities = json.loads(wikidata_bytes).get("entities", {}) if wikidata_bytes else {}
    ruler_names = {spelling for spelling in rulers if spelling}
    section_names = {alias for alias in map(normalise_alias, sections.values()) if alias}
    taken = {}
    for concept_id, section in sections.items():
        concept = snapshot.get("concepts", {}).get(concept_id)
        if not concept:
            continue
        if concept_id not in MINT_COUNTRY_LANGUAGE:
            raise ValueError(f"no modern country language chosen for mint concept: {concept_id}")
        # The Nomisma snapshot's own closeMatch links say which Wikidata items belong to this mint, so the two files cannot disagree about that; a
        # linked item the Wikidata snapshot does not hold means the pair is out of step, and the run stops rather than quietly losing its names.
        linked = []
        for entity_id in mint_entity_ids(concept) if wikidata_bytes else []:
            if entity_id not in entities:
                raise ValueError(f"Wikidata snapshot is missing {entity_id}, linked from mint concept {concept_id}")
            linked.append(entities[entity_id])
        spellings = mint_spellings(concept, linked)
        taken[concept_id] = {alias for alias in mint_names(spellings, section, MINT_COUNTRY_LANGUAGE[concept_id])
                             if (concept_id, alias) not in NOT_A_NAME}
    shared = {alias for alias in set().union(*taken.values(), set())
              if sum(alias in aliases for aliases in taken.values()) > 1}
    rows = []
    for concept_id, section in sorted(sections.items(), key=lambda item: item[1]):
        aliases = sorted(alias for alias in taken.get(concept_id, set())
                         if alias not in shared and alias not in section_names and alias not in ORDINARY_ENGLISH
                         and not word_runs(alias) & ruler_names)
        if aliases:
            rows.append((concept_id, section, aliases))
    return rows


def ruler_spellings(snapshot_bytes: bytes, memberships) -> set[str]:
    """Every spelling the generated people table answers to, normalised as it holds them: what a mint alias may not be, and may not carry."""
    concepts = read_concepts(snapshot_bytes, memberships)
    return {alias for concept in concepts.values() if FOAF_PERSON in concept["types"]
            for label in concept["labels"] | concept["aliases"] for alias in [normalise_alias(label)] if alias}


def fetch_snapshot(concept_ids, output: Path) -> None:
    identifiers = "|".join(sorted(set(concept_ids)))
    request = Request(
        f"{ENDPOINT}?{urlencode({'identifiers': identifiers, 'format': 'xml'})}",
        headers={"Accept": "application/rdf+xml", "User-Agent": USER_AGENT},
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
        # The mint aliases below come from Nomisma's labels and, through Nomisma's own closeMatch links, from Wikidata's. Wikidata puts its
        # structured data in the public domain, and the statement has to travel with the file whatever else is in it.
        "mintAliasSources": [ENDPOINT, WIKIDATA_ENDPOINT],
        "wikidataLicense": WIKIDATA_LICENSE,
        "wikidataLicenseUrl": WIKIDATA_LICENSE_URL,
        **report,
    }
    # The provenance is a header comment, not an export: nothing in the extension read it, and the
    # licence, snapshot digest and counts have to travel with the file whether or not code uses them.
    lines = [
        "// Generated from the bundled OCRE records, one official Nomisma aggregate RDF snapshot and the tracked Nomisma and Wikidata mint snapshots.",
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
        "// The modern names Nomisma and Wikidata give each RIC VI-IX mint section: their labels in the language of the country the mint stands in today,",
        "// their English labels, and the Latin-script exonym several of English, French, German, Italian and Spanish spell alike. The Wikidata items are",
        "// the ones Nomisma's own skos:closeMatch links name, and their labels and aliases are CC0. A name that is also a ruler's, that two mints share,",
        "// that is an ordinary English word or that names a whole different place is dropped, and a mint neither source gives a modern name has no alias",
        "// here: none was invented for it, and RIC's own spelling always reaches it.",
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
    linked = subparsers.add_parser("fetch-wikidata", help="fetch one Wikidata item per closeMatch link in the Nomisma mint snapshot")
    linked.add_argument("mints", type=Path)
    linked.add_argument("snapshot", type=Path)
    linked.add_argument("--retrieved-on", required=True)
    build = subparsers.add_parser("generate", help="generate the offline JavaScript people index")
    build.add_argument("data_dir", type=Path)
    build.add_argument("snapshot", type=Path)
    build.add_argument("output", type=Path)
    build.add_argument("--mints", type=Path, default=DEFAULT_MINTS)
    build.add_argument("--wikidata", type=Path, default=DEFAULT_WIKIDATA)
    build.add_argument("--generated-on", required=True)
    args = parser.parse_args()
    try:
        if args.command == "fetch-mints":
            sections = read_mints(args.data_dir)
            print(f"Fetched {fetch_mint_snapshot(sections, args.snapshot, args.retrieved_on)} Nomisma mint concepts, one request each.")
            return 0
        if args.command == "fetch-wikidata":
            count, unlinked = fetch_wikidata_snapshot(args.mints.read_bytes(), args.snapshot, args.retrieved_on)
            print(f"Fetched {count} Wikidata items, one request each.")
            # Named rather than passed over: a mint Nomisma links to nothing keeps only the names Nomisma itself publishes, and a
            # reader of this run has to be told which mints those are instead of finding the gap later in the generated table.
            if unlinked:
                print(f"No Wikidata closeMatch link for: {', '.join(unlinked)}")
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
            if not args.wikidata.is_file():
                raise ValueError(f"Wikidata mint snapshot not found: {args.wikidata}")
            # The people the same run generates are what a mint alias is checked against, so a name that opens a man's coin can never also open a
            # mint's section: the two tables are read from the one snapshot, and neither can drift out of step with the other.
            rulers = ruler_spellings(args.snapshot.read_bytes(), memberships)
            report = generate(args.snapshot, memberships, args.output, args.generated_on,
                              mint_rows(args.mints.read_bytes(), read_mints(args.data_dir), rulers, args.wikidata.read_bytes()))
            print(json.dumps(report, sort_keys=True))
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"People import failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
