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
        }, report)
        self.assertIn("export const RIC_PEOPLE_SOURCE", text)
        self.assertIn('license: "CC-BY-3.0"', text)
        self.assertIn('id: "constantine_ii", name: "Constantine II"', text)
        self.assertIn('volumes: Object.freeze(["VII", "VIII"])', text)
        self.assertIn('aliases: Object.freeze(["Constantinus II."])', text)
        self.assertIn('id: "other_constantine", name: "Constantine II"', text)
        self.assertNotIn("constantinopolis_personfication", text)
        self.assertNotIn("unlabelled_person", text)
        self.assertNotIn("missing_concept", text)

    def test_snapshot_ignores_linked_provenance_subjects(self):
        module = load_module()
        snapshot = b"""<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#' xmlns:foaf='http://xmlns.com/foaf/0.1/' xmlns:skos='http://www.w3.org/2004/02/skos/core#'><foaf:Person rdf:about='http://nomisma.org/id/person'><skos:prefLabel xml:lang='en'>Person</skos:prefLabel><skos:prefLabel xml:lang='la'>Persona</skos:prefLabel><skos:altLabel xml:lang='la'>Persona.</skos:altLabel><skos:altLabel xml:lang='de'>Person DE</skos:altLabel></foaf:Person><rdf:Description rdf:about='http://nomisma.org/id/person#provenance'/></rdf:RDF>"""
        concepts = module.read_concepts(snapshot, {"person": {"7"}})
        self.assertEqual({"person"}, set(concepts))
        self.assertEqual({"Persona", "Persona."}, concepts["person"]["aliases"])

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


if __name__ == "__main__":
    unittest.main()
