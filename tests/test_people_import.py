import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "import_people.py"
SNAPSHOT = ROOT / "tests" / "fixtures" / "nomisma-people-small.json"


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
        self.assertIn("export const RIC_PEOPLE_SOURCE", text)
        self.assertIn('license: "CC-BY-3.0"', text)
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
            (root / "metadata.json").write_text(json.dumps({
                "shards": {"7": "records-7.json", "8": "records-8.json"},
            }), encoding="utf-8")
            (root / "records-7.json").write_text(json.dumps({"records": {
                "ric.7.lon.287": {"a": ["constantine_i"], "o": {"p": ["constantine_ii"]}},
            }}), encoding="utf-8")
            (root / "records-8.json").write_text(json.dumps({"records": {
                "ric.8.lon.1": {"a": ["constantine_ii"], "o": {}},
            }}), encoding="utf-8")
            memberships = module.read_memberships(root)
        self.assertEqual({"7"}, memberships["constantine_i"])
        self.assertEqual({"7", "8"}, memberships["constantine_ii"])


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
        # "Londres" is not an English modern name, so nothing is invented for it.
        self.assertEqual([("treveri", "Treveri", ["trier"])], rows)

    def test_mints_are_read_from_the_bundled_titles_of_the_mint_volumes(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "metadata.json").write_text(json.dumps({"shards": {"7": "records-7.json", "2": "records-2.json"}}), encoding="utf-8")
            (root / "records-7.json").write_text(json.dumps({"records": {
                "ric.7.tr.1": {"l": "RIC VII Treveri 1", "m": ["treveri"]},
                "ric.7.tr.17a": {"l": "RIC VII Treveri 17A: Subtype 1", "m": ["treveri"]},
                "ric.7.lon.1": {"l": "RIC VII Londinium 1", "m": ["londinium", "treveri"]},
            }}), encoding="utf-8")
            (root / "records-2.json").write_text(json.dumps({"records": {
                "ric.2.tr.1": {"l": "RIC II Trajan 1", "m": ["rome"]},
            }}), encoding="utf-8")
            # A subtype title names no section, a record naming two mints says nothing, and the ruler volumes are filed by person, not by mint.
            self.assertEqual({"treveri": "Treveri"}, module.read_mints(root))


if __name__ == "__main__":
    unittest.main()
