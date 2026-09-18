import contextlib
import importlib.util
import io
import json
import re
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "import_people.py"
SNAPSHOT = ROOT / "tests" / "fixtures" / "nomisma-people-small.json"
DATA = ROOT / "extension" / "data" / "ocre"
PEOPLE = ROOT / "extension" / "ric-people.js"
CONCEPTS = ROOT / "scripts" / "data" / "nomisma-ocre-concepts.rdf"
MINTS = ROOT / "scripts" / "data" / "nomisma-mints.json"


def load_module():
    spec = importlib.util.spec_from_file_location("giga_pinax_import_people", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PeopleImportTests(unittest.TestCase):
    def test_generate_keeps_verified_people_and_preserves_name_collisions(self):
        module = load_module()
        memberships = {
            "constantine_ii": {"7", "8"},
            "other_constantine": {"10"},
            "constantinopolis_personfication": {"7"},
            "unlabelled_person": {"8"},
            "missing_concept": {"6"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "ric-people.js"
            report = module.generate(SNAPSHOT, memberships, output, "2026-09-15")
            self.assertNotIn(b"\r\n", output.read_bytes())
            text = output.read_text(encoding="utf-8")
        self.assertEqual({
            "referencedConceptCount": 5,
            "personCount": 2,
            "excludedNonPersonCount": 1,
            "excludedMissingLabelCount": 1,
            "missingConceptCount": 1,
            "aliasCount": 2,
            "mintCount": 0,
            "mintAliasCount": 0,
        }, report)
        # Provenance travels with the file as a header comment; nothing in the extension imports it.
        self.assertNotIn("export const RIC_PEOPLE_SOURCE", text)
        self.assertIn('//   license: "CC-BY-3.0"', text)
        self.assertIn('//   snapshotSha256: "', text)
        self.assertIn('id: "constantine_ii", name: "Constantine II"', text)
        self.assertIn('volumes: Object.freeze(["VII", "VIII"])', text)
        # Aliases are case-folded with their diacritics stripped, so a heading reaches them however a dealer spells it. A Latin label both
        # Constantines carry stays on both of them, so the lookup offers the two rather than picking one; a Spanish or Greek label is no spelling
        # a dealer writes and is never read.
        self.assertIn('id: "constantine_ii", name: "Constantine II", volumes: Object.freeze(["VII", "VIII"]), aliases: Object.freeze(["constantinus ii"])', text)
        self.assertIn('id: "other_constantine", name: "Constantine II", volumes: Object.freeze(["X"]), aliases: Object.freeze(["constantinus ii"])', text)
        self.assertNotIn("Constantinus II.", text)
        self.assertNotIn("constantinus ii.", text)
        self.assertNotIn("constantin el joven", text)
        self.assertNotIn("Constantín", text)
        self.assertNotIn("constantinopolis_personfication", text)
        self.assertNotIn("unlabelled_person", text)
        self.assertNotIn("missing_concept", text)

    def test_snapshot_ignores_linked_provenance_subjects(self):
        module = load_module()
        snapshot = b"""<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#' xmlns:foaf='http://xmlns.com/foaf/0.1/' xmlns:skos='http://www.w3.org/2004/02/skos/core#'><foaf:Person rdf:about='http://nomisma.org/id/person'><skos:prefLabel xml:lang='en'>Person</skos:prefLabel><skos:prefLabel xml:lang='la'>Persona</skos:prefLabel><skos:altLabel xml:lang='la'>Persona.</skos:altLabel><skos:altLabel xml:lang='de'>Person DE</skos:altLabel></foaf:Person><rdf:Description rdf:about='http://nomisma.org/id/person#provenance'/></rdf:RDF>"""
        concepts = module.read_concepts(snapshot, {"person": {"7"}})
        self.assertEqual({"person"}, set(concepts))
        # Only the English and Latin labels are spellings a dealer writes. A label in any other language is an ordinary word of that language as
        # often as it is a name ("August", "Severe", "Marc", "Juan"), and reading those turned lot prose into rulers.
        self.assertEqual({"Person", "Persona", "Persona."}, concepts["person"]["aliases"])
        self.assertEqual({"Person"}, concepts["person"]["labels"])

    def test_memberships_use_active_authority_or_obverse_portrait(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            # A volume over the file cap ships as several parts, and every part holds records this index must see.
            (root / "metadata.json").write_text(json.dumps({
                "shards": {"7": [{"file": "records-7.a.json", "from": ""}, {"file": "records-7.b.json", "from": "ric.7.rom.1"}],
                           "8": [{"file": "records-8.json", "from": ""}]},
            }), encoding="utf-8")
            (root / "records-7.a.json").write_text(json.dumps({"records": {
                "ric.7.lon.287": {"a": ["constantine_i"], "o": {"p": ["constantine_ii"]}},
            }}), encoding="utf-8")
            (root / "records-7.b.json").write_text(json.dumps({"records": {
                "ric.7.rom.4": {"a": ["licinius"], "o": {}},
            }}), encoding="utf-8")
            (root / "records-8.json").write_text(json.dumps({"records": {
                "ric.8.lon.1": {"a": ["constantine_ii"], "o": {}},
            }}), encoding="utf-8")
            memberships = module.read_memberships(root)
        self.assertEqual({"7"}, memberships["constantine_i"])
        self.assertEqual({"7", "8"}, memberships["constantine_ii"])
        self.assertEqual({"7"}, memberships["licinius"])


    def test_aliases_are_normalised_deduplicated_and_kept_on_every_owner(self):
        module = load_module()
        self.assertEqual("faustina the younger", module.normalise_alias("  Faustina   the Younger "))
        self.assertEqual("juliano el apostata", module.normalise_alias("Juliano el Apóstata"))
        self.assertIsNone(module.normalise_alias("Κωνσταντίνος"))
        self.assertIsNone(module.normalise_alias("   "))
        rows = module.alias_rows({
            "valerian": ("Valerian", ["Valerianus", "Valerian I", "valerianus", "Valérian"]),
            "valerian_ii": ("Valerian II", ["Valerianus", "Valerian the Younger"]),
        })
        # "Valerianus" names both Valerians, so it stays on both and the lookup offers the two: dropping it lost the name altogether, and keeping
        # it on one of them would open the wrong coin. "valerianus" and "Valérian" fold onto an alias and onto the name itself.
        self.assertEqual(["valerian i", "valerianus"], rows["valerian"])
        self.assertEqual(["valerian the younger", "valerianus"], rows["valerian_ii"])

    def test_mint_rows_keep_only_a_distinct_english_modern_name(self):
        module = load_module()
        snapshot = json.dumps({"concepts": {
            "treveri": {"url": "https://nomisma.org/id/treveri.rdf",
                        "labels": [["prefLabel", "en", "Trier"], ["altLabel", "en", "Treveri"], ["prefLabel", "de", "Trier"]]},
            "londinium": {"url": "https://nomisma.org/id/londinium.rdf",
                          "labels": [["prefLabel", "en", "Londinium"], ["prefLabel", "fr", "Londres"]]},
            "unused": {"url": "https://nomisma.org/id/unused.rdf", "labels": [["prefLabel", "en", "Nowhere"]]},
        }}).encode("utf-8")
        rows = module.mint_rows(snapshot, {"treveri": "Treveri", "londinium": "Londinium", "missing": "Ostia"})
        # Nomisma titles Treveri by its modern name, so "Trier" is the alias; it gives Londinium no English name but the ancient one, and a French
        # "Londres" is neither English, nor Britain's own language, nor a spelling two of the exonym languages share, so nothing is invented for it.
        self.assertEqual([("treveri", "Treveri", ["trier"])], rows)

    def test_mint_rows_take_the_three_sourced_kinds_of_modern_name(self):
        """A mint's own country names the place as the place; English is the language this extension is read in; an exonym counts where several agree."""
        module = load_module()
        snapshot = json.dumps({"concepts": {
            # Siscia is in Croatia, so the Croatian label is its modern name, and French, German, Italian and Spanish spell the exonym the same way.
            "siscia": {"url": "x", "labels": [["prefLabel", "en", "Siscia"], ["prefLabel", "hr", "Sisak"], ["prefLabel", "fr", "Sisak"],
                                              ["prefLabel", "de", "Sisak"], ["prefLabel", "nl", "Sisak (Kroatie)"]]},
            # Lugdunum is in France, and the French label is RIC's own spelling: one Italian exonym alone is Italian's word and no more.
            "lugdunum": {"url": "x", "labels": [["prefLabel", "en", "Lugdunum"], ["prefLabel", "fr", "Lugdunum"], ["prefLabel", "it", "Lione"],
                                                ["prefLabel", "da", "Lyon"]]},
            # Ticinum's Italian label is an encyclopaedia article's title rather than a name, and the city's own name is in no label at all.
            "ticinum": {"url": "x", "labels": [["prefLabel", "en", "Ticinum"], ["prefLabel", "it", "Storia di Pavia"]]},
            "unknown_mint": {"url": "x", "labels": [["prefLabel", "en", "Somewhere"]]},
        }}).encode("utf-8")
        sections = {"siscia": "Siscia", "lugdunum": "Lugdunum", "ticinum": "Ticinum"}
        self.assertEqual([("siscia", "Siscia", ["sisak"])], module.mint_rows(snapshot, sections))
        # Every mint the bundle names has to have a modern language chosen for it by hand; one nobody has chosen stops the run.
        with self.assertRaises(ValueError) as refused:
            module.mint_rows(snapshot, {**sections, "unknown_mint": "Unknown"})
        self.assertIn("unknown_mint", str(refused.exception))

    def test_a_mint_alias_that_could_open_the_wrong_coin_is_dropped(self):
        """A mint alias resolves a section, so a spelling that names a man, two mints or an ordinary English word may not be one."""
        module = load_module()
        snapshot = json.dumps({"concepts": {
            # "Rim" is what Croatian calls Rome and an ordinary English word besides, so an English label carrying it is dropped; the Italian
            # "Roma" is the name the mint's own country writes and is kept, as "Rome" itself would be.
            "rome": {"url": "x", "labels": [["prefLabel", "en", "Rome"], ["altLabel", "en", "Rim"], ["prefLabel", "it", "Roma"]]},
            # Two mints spelling a name the same way could only ever name one of them wrongly, so neither keeps it.
            "siscia": {"url": "x", "labels": [["prefLabel", "en", "Siscia"], ["prefLabel", "hr", "Sisak"], ["prefLabel", "fr", "Sisak"]]},
            "sirmium": {"url": "x", "labels": [["prefLabel", "en", "Sirmium"], ["prefLabel", "sr", "Sisak"], ["prefLabel", "fr", "Sisak"]]},
            # A name a ruler answers to, and one carrying a ruler's name inside it, belong to the man: a place may never take his coin.
            "treveri": {"url": "x", "labels": [["prefLabel", "en", "Trier"], ["altLabel", "en", "Constantine I"],
                                               ["altLabel", "en", "Nero mint"], ["prefLabel", "de", "Trier"]]},
            # A spelling that is another mint's own RIC section would file the coins under the wrong shelf.
            "ostia": {"url": "x", "labels": [["prefLabel", "en", "Ostia"], ["altLabel", "en", "Rome"], ["prefLabel", "it", "Ostia"]]},
        }}).encode("utf-8")
        sections = {"rome": "Rome", "siscia": "Siscia", "sirmium": "Sirmium", "treveri": "Treveri", "ostia": "Ostia"}
        rows = module.mint_rows(snapshot, sections, {"constantine i", "nero"})
        self.assertEqual([("rome", "Rome", ["roma"]), ("treveri", "Treveri", ["trier"])], rows)

    def test_mints_are_read_from_the_bundled_titles_of_the_mint_volumes(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "metadata.json").write_text(json.dumps({"shards": {
                "7": [{"file": "records-7.a.json", "from": ""}, {"file": "records-7.b.json", "from": "ric.7.tr.1"}],
                "2": [{"file": "records-2.json", "from": ""}],
            }}), encoding="utf-8")
            (root / "records-7.a.json").write_text(json.dumps({"records": {
                "ric.7.lon.1": {"l": "RIC VII Londinium 1", "m": ["londinium", "treveri"]},
            }}), encoding="utf-8")
            (root / "records-7.b.json").write_text(json.dumps({"records": {
                "ric.7.tr.1": {"l": "RIC VII Treveri 1", "m": ["treveri"]},
                "ric.7.tr.17a": {"l": "RIC VII Treveri 17A: Subtype 1", "m": ["treveri"]},
            }}), encoding="utf-8")
            (root / "records-2.json").write_text(json.dumps({"records": {
                "ric.2.tr.1": {"l": "RIC II Trajan 1", "m": ["rome"]},
            }}), encoding="utf-8")
            # A subtype title names no section, a record naming two mints says nothing, and the ruler volumes are filed by person, not by mint.
            self.assertEqual({"treveri": "Treveri"}, module.read_mints(root))

    def test_generate_takes_the_tracked_mint_snapshot_by_default_and_stops_without_it(self):
        """The generated header names that snapshot, so omitting the option may not quietly mean no mints at all."""
        module = load_module()
        self.assertEqual(ROOT / "scripts" / "data" / "nomisma-mints.json", module.DEFAULT_MINTS)
        self.assertTrue(module.DEFAULT_MINTS.is_file())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data_dir = root / "ocre"
            data_dir.mkdir()
            (data_dir / "metadata.json").write_text(json.dumps({"shards": {"7": [{"file": "records-7.json", "from": ""}]}}), encoding="utf-8")
            (data_dir / "records-7.json").write_text(json.dumps({"records": {
                "ric.7.tr.1": {"l": "RIC VII Treveri 1", "m": ["treveri"], "a": ["constantine_ii"], "o": {}},
            }}), encoding="utf-8")
            tracked = root / "nomisma-mints.json"
            tracked.write_text(json.dumps({"concepts": {"treveri": {
                "url": "https://nomisma.org/id/treveri.rdf",
                "labels": [["prefLabel", "en", "Trier"], ["altLabel", "en", "Treveri"]],
            }}}), encoding="utf-8")
            output = root / "ric-people.js"
            argv = ["import_people.py", "generate", str(data_dir), str(SNAPSHOT), str(output), "--generated-on", "2026-09-15"]

            module.DEFAULT_MINTS = tracked
            printed, failed = io.StringIO(), io.StringIO()
            with unittest.mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(printed):
                self.assertEqual(0, module.main())
            self.assertEqual(1, json.loads(printed.getvalue())["mintCount"])
            self.assertIn('id: "treveri", section: "Treveri", aliases: Object.freeze(["trier"])', output.read_text(encoding="utf-8"))

            # Missing, it is an error that names the file: the header would otherwise claim a mint
            # snapshot the run never read, over an index with no mints in it.
            output.unlink()
            module.DEFAULT_MINTS = root / "gone.json"
            with unittest.mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(printed), contextlib.redirect_stderr(failed):
                self.assertEqual(1, module.main())
            self.assertIn("gone.json", failed.getvalue())
            self.assertFalse(output.exists())

    def test_a_dtd_or_entity_declaration_is_refused_before_any_xml_is_parsed(self):
        """ElementTree resolves no external entity but expands internal ones, so the declaration is refused first, as import_rdf.py refuses it."""
        module = load_module()
        rdf = ('<?xml version="1.0"?>{doctype}<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"'
               ' xmlns:skos="http://www.w3.org/2004/02/skos/core#"><skos:Concept rdf:about="http://nomisma.org/id/nero">'
               '<skos:prefLabel xml:lang="en">Nero</skos:prefLabel></skos:Concept></rdf:RDF>')
        for doctype in ('<!DOCTYPE rdf:RDF [<!ENTITY name "Nero">]>', '<!doctype rdf:RDF>', '<!  ENTITY name "Nero">'):
            payload = rdf.format(doctype=doctype).encode("utf-8")
            with self.assertRaises(ValueError):
                module.read_concepts(payload, {"nero": {"1(2)"}})
        # The same bytes without a declaration are read as before, so the guard costs a sound snapshot nothing.
        concepts = module.read_concepts(rdf.format(doctype="").encode("utf-8"), {"nero": {"1(2)"}})
        self.assertEqual({"Nero"}, concepts["nero"]["labels"])

    def test_input_that_is_not_utf_8_is_refused_before_expat_sniffs_it(self):
        """The pattern above reads UTF-8 bytes. UTF-16 spells the same declaration with a NUL between every character,
        so nothing matches - and expat, which works its own encoding out, reads and expands the entity anyway. Refused
        as import_rdf.py refuses it: by the byte order mark, and by the NUL that a mark-less UTF-16 file starts with."""
        module = load_module()
        declared = ('<!DOCTYPE rdf:RDF [<!ENTITY name "Nero">]><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"'
                    ' xmlns:skos="http://www.w3.org/2004/02/skos/core#"><skos:Concept rdf:about="http://nomisma.org/id/nero">'
                    '<skos:prefLabel xml:lang="en">&name;</skos:prefLabel></skos:Concept></rdf:RDF>')
        for encoding in ("utf-16", "utf-16-le", "utf-16-be", "utf-32-le", "utf-32-be"):
            with self.subTest(encoding=encoding), self.assertRaises(ValueError):
                module.parsed_xml(declared.encode(encoding))
        # Leading whitespace is still UTF-8, and a sound snapshot is read as before.
        self.assertIsNotNone(module.parsed_xml(b'  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>'))


@unittest.skipUnless((DATA / "metadata.json").is_file(), "extension/data/ocre is not bundled here")
class BundledDataTests(unittest.TestCase):
    """The documented rebuild command over the real bundle, which is the only place a volume is really split."""

    def test_memberships_and_mints_read_every_part_of_a_split_volume(self):
        module = load_module()
        shards = json.loads((DATA / "metadata.json").read_text(encoding="utf-8"))["shards"]
        split = {prefix: parts for prefix, parts in shards.items() if len(parts) > 1}
        self.assertTrue(split, "the bundle has no split volume for this to prove anything over")
        memberships = module.read_memberships(DATA)
        self.assertEqual(272, len(memberships))
        for prefix, parts in split.items():
            concepts = []
            for part in parts:
                records = json.loads((DATA / part["file"]).read_text(encoding="utf-8"))["records"]
                concepts.append({concept_id for record in records.values()
                                 for concept_id in list(record.get("a", [])) + list(record.get("o", {}).get("p", []))})
            # A reader that stopped at the first part would lose whoever only the later parts name.
            later = set().union(*concepts[1:]) - concepts[0]
            self.assertTrue(later, prefix)
            for concept_id in sorted(later):
                self.assertIn(prefix, memberships[concept_id])
        self.assertEqual("Treveri", module.read_mints(DATA)["treveri"])
        self.assertEqual(21, len(module.read_mints(DATA)))

    def test_every_bundled_mint_has_a_modern_language_chosen_for_it(self):
        """A mint with no language chosen stops a regeneration, so the table has to cover every mint the bundle files coins under."""
        module = load_module()
        self.assertEqual(sorted(module.read_mints(DATA)), sorted(module.MINT_COUNTRY_LANGUAGE))

    def test_the_real_snapshot_names_the_mints_it_can_and_invents_nothing_for_the_rest(self):
        """Eight of the 21 mints carry no modern name Nomisma publishes; four of those really are called something else today."""
        module = load_module()
        sections = module.read_mints(DATA)
        rulers = module.ruler_spellings(CONCEPTS.read_bytes(), module.read_memberships(DATA))
        rows = module.mint_rows(MINTS.read_bytes(), sections, rulers)
        named = {section: aliases for _, section, aliases in rows}
        self.assertEqual(["arles"], named["Arelate"])
        self.assertEqual(["roma"], named["Rome"])
        self.assertEqual(["sisak"], named["Siscia"])
        self.assertEqual(["antakya", "antioch, syria", "antiokheia pros oronten"], named["Antioch"])
        # These eight keep RIC's own spelling. Alexandria, Aquileia, Carthage and Ostia already are the name on the map; Londinium, Lugdunum,
        # Mediolanum and Ticinum are not, but "London", "Lyons" and "Pavia" are in no Nomisma label of any language and "Milan" only as "Milano",
        # so none of the four is given a name the source does not carry.
        self.assertEqual(["Alexandria", "Aquileia", "Carthage", "Londinium", "Lugdunum", "Mediolanum", "Ostia", "Ticinum"],
                         sorted(set(sections.values()) - set(named)))
        snapshot = json.loads(MINTS.read_bytes())
        for absent in ("london", "lyons", "pavia", "milan"):
            written = {module.normalise_alias(value) for concept in snapshot["concepts"].values() for _, _, value in concept["labels"]}
            self.assertNotIn(absent, written)

    def test_generate_reproduces_the_committed_people_index_byte_for_byte(self):
        module = load_module()
        committed = PEOPLE.read_bytes()
        generated_on = re.search(r'generatedOn: "(\d{4}-\d{2}-\d{2})"', committed.decode("utf-8")).group(1)
        memberships = module.read_memberships(DATA)
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "ric-people.js"
            # Exactly what docs/LOCAL-CATALOGUE.md tells a contributor to run: the mint aliases are checked against the people of the same snapshot.
            module.generate(CONCEPTS, memberships, output, generated_on,
                            module.mint_rows(MINTS.read_bytes(), module.read_mints(DATA),
                                             module.ruler_spellings(CONCEPTS.read_bytes(), memberships)))
            self.assertEqual(committed, output.read_bytes())


if __name__ == "__main__":
    unittest.main()
