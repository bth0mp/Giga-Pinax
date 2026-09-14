import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "import_rdf.py"
FIXTURE = ROOT / "tests" / "fixtures" / "local-rdf-small.rdf"
NAMESPACES = ("xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#' "
              "xmlns:nmo='http://nomisma.org/ontology#' "
              "xmlns:skos='http://www.w3.org/2004/02/skos/core#' "
              "xmlns:dcterms='http://purl.org/dc/terms/'")


def run_import(source, output, generated_on="2026-09-14"):
    return subprocess.run([sys.executable, str(SCRIPT), str(source), str(output),
                           "--generated-on", generated_on], text=True, capture_output=True)


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


class RdfImportTests(unittest.TestCase):
    def test_import_writes_active_index_metadata_aliases_and_joined_cards(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "ocre"
            result = run_import(FIXTURE, output)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual({
                "schemaVersion": 1, "corpus": "ocre", "sourceFilename": "local-rdf-small.rdf",
                "inputBytes": FIXTURE.stat().st_size,
                "sourceSha256": hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
                "generatedOn": "2026-09-14", "publicationDate": None,
                "sourceUrl": "https://numismatics.org/ocre/", "license": "ODbL-1.0",
                "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
                "recordCount": 8, "activeRecordCount": 3,
                "aliases": {"ric.3.old.1": "ric.3.current.3", "ric.3.old.2": "ric.3.current.3"},
                "replacementSkips": {"ambiguous": 0, "cyclic": 2, "dangling": 1},
                "conflicts": {"count": 0, "ids": []},
                "shards": {"1": "records-1.json", "2": "records-2.json", "3": "records-3.json"},
            }, load(output / "metadata.json"))
            self.assertEqual({"schemaVersion": 1, "entries": [
                ["ric.1.test.1", "RIC I Test 1"], ["ric.2.test.2", "RIC II Test 2"],
                ["ric.3.current.3", "Current three"],
            ]}, load(output / "index.json"))
            self.assertEqual({
                "i": "ric.1.test.1", "l": "RIC I Test 1",
                "a": ["authority_one", "authority_two"], "d": ["denarius", "aureus"],
                "m": ["rome"], "x": ["ar"], "s": "-0009", "e": "0014",
                "o": {"l": "OBV ONE", "d": "English obverse", "p": ["person_one", "person_two"]},
                "r": {"l": "REV ONE", "d": "English reverse",
                      "p": ["http://example.test/not-a-nomisma-slug"]},
            }, load(output / "records-1.json")["records"]["ric.1.test.1"])
            self.assertEqual({"i": "ric.2.test.2", "l": "RIC II Test 2",
                              "a": ["issuer_only"], "o": {}, "r": {}},
                             load(output / "records-2.json")["records"]["ric.2.test.2"])

    def test_import_is_byte_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            one, two = root / "one", root / "two"
            self.assertEqual(0, run_import(FIXTURE, one).returncode)
            self.assertEqual(0, run_import(FIXTURE, two).returncode)
            self.assertEqual({p.name: p.read_bytes() for p in one.iterdir()},
                             {p.name: p.read_bytes() for p in two.iterdir()})

    def test_import_quarantines_conflicting_repeated_subject(self):
        body = f"""<rdf:RDF {NAMESPACES}>
          <nmo:TypeSeriesItem rdf:about='http://numismatics.org/ocre/id/ric.1.x.1'><skos:prefLabel>One</skos:prefLabel></nmo:TypeSeriesItem>
          <nmo:TypeSeriesItem rdf:about='http://numismatics.org/ocre/id/ric.1.x.1'><skos:prefLabel>Different</skos:prefLabel></nmo:TypeSeriesItem>
        </rdf:RDF>"""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / "conflict.rdf"
            source.write_text(body, encoding="utf-8")
            result = run_import(source, root / "out")
            self.assertEqual(0, result.returncode, result.stderr)
            metadata = load(root / "out" / "metadata.json")
            self.assertEqual({"count": 1, "ids": ["ric.1.x.1"]}, metadata["conflicts"])
            self.assertEqual(0, metadata["activeRecordCount"])

    def test_import_skips_a_replacement_that_splits_into_multiple_records(self):
        body = f"""<rdf:RDF {NAMESPACES}>
          <nmo:TypeSeriesItem rdf:about='http://numismatics.org/ocre/id/ric.1.old.1'><skos:prefLabel>Old</skos:prefLabel><dcterms:isReplacedBy rdf:resource='http://numismatics.org/ocre/id/ric.1.new.1'/><dcterms:isReplacedBy rdf:resource='http://numismatics.org/ocre/id/ric.1.new.2'/></nmo:TypeSeriesItem>
          <nmo:TypeSeriesItem rdf:about='http://numismatics.org/ocre/id/ric.1.new.1'><skos:prefLabel>New 1</skos:prefLabel></nmo:TypeSeriesItem>
          <nmo:TypeSeriesItem rdf:about='http://numismatics.org/ocre/id/ric.1.new.2'><skos:prefLabel>New 2</skos:prefLabel></nmo:TypeSeriesItem>
        </rdf:RDF>"""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); source = root / "split.rdf"
            source.write_text(body, encoding="utf-8")
            result = run_import(source, root / "out")
            self.assertEqual(0, result.returncode, result.stderr)
            metadata = load(root / "out" / "metadata.json")
            self.assertEqual({}, metadata["aliases"])
            self.assertEqual({"ambiguous": 1, "cyclic": 0, "dangling": 0},
                             metadata["replacementSkips"])
            self.assertEqual(2, metadata["activeRecordCount"])

    def test_import_rejects_unsafe_or_invalid_input(self):
        type_xml = (f"<rdf:RDF {NAMESPACES}><nmo:TypeSeriesItem "
                    "rdf:about='http://numismatics.org/ocre/id/ric.1.x.1'>"
                    "<skos:prefLabel>One</skos:prefLabel></nmo:TypeSeriesItem></rdf:RDF>")
        cases = [
            ("<!DOCTYPE rdf:RDF [<!ENTITY x 'bad'>]><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'/>",
             "DTD and entity declarations are not allowed", "2026-09-14", "utf-8"),
            ("<!DOCTYPE rdf:RDF [<!ENTITY x 'bad'>]><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'/>",
             "RDF input must be UTF-8 XML", "2026-09-14", "utf-16"),
            (f"<rdf:RDF {NAMESPACES}><nmo:TypeSeriesItem rdf:about='http://numismatics.org/pella/id/price.1'><skos:prefLabel>Price 1</skos:prefLabel></nmo:TypeSeriesItem></rdf:RDF>",
             "unsupported type URI corpus", "2026-09-14", "utf-8"),
            ("<RDF xmlns='wrong'/>", "root element must be rdf:RDF", "2026-09-14", "utf-8"),
            ("<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'/>",
             "contains no nmo:TypeSeriesItem", "2026-09-14", "utf-8"),
            (type_xml, "generated date must be a real ISO date", "2026-02-30", "utf-8"),
        ]
        for body, message, generated_on, encoding in cases:
            with self.subTest(message=message), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary); source = root / "bad.rdf"
                source.write_text(body, encoding=encoding)
                result = run_import(source, root / "out", generated_on)
                self.assertNotEqual(0, result.returncode)
                self.assertIn(message, result.stderr)


if __name__ == "__main__":
    unittest.main()
