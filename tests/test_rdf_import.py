import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "import_rdf.py"
FIXTURE = ROOT / "tests" / "fixtures" / "local-rdf-small.rdf"
BUNDLE = ROOT / "extension" / "data" / "ocre"
NAMESPACES = ("xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#' "
              "xmlns:nmo='http://nomisma.org/ontology#' "
              "xmlns:skos='http://www.w3.org/2004/02/skos/core#' "
              "xmlns:dcterms='http://purl.org/dc/terms/'")


def run_import(source, output, generated_on="2026-09-14"):
    return subprocess.run([sys.executable, str(SCRIPT), str(source), str(output),
                           "--generated-on", generated_on], text=True, capture_output=True)


def run_reindex(data):
    return subprocess.run([sys.executable, str(SCRIPT), "--reindex", str(data)], text=True, capture_output=True)


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_import_script():
    spec = importlib.util.spec_from_file_location("giga_pinax_import_rdf", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def written_digests(directory):
    """Every file by its digest: still a byte-for-byte comparison, but one a failure can print. Compared as raw bytes, a
    single differing megabyte leaves unittest pretty-printing both directories to build a diff nobody could read."""
    return {path.name: digest(path.read_bytes()) for path in sorted(directory.iterdir())}


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
                "shards": {"1": [{"file": "records-1.json", "from": ""}],
                           "2": [{"file": "records-2.json", "from": ""}],
                           "3": [{"file": "records-3.json", "from": ""}]},
            }, load(output / "metadata.json"))
            self.assertEqual({"schemaVersion": 1, "entries": [
                ["ric.1.test.1", "RIC I Test 1"], ["ric.2.test.2", "RIC II Test 2"],
                ["ric.3.current.3", "Current three"],
            ]}, load(output / "index.json"))
            # The leading integer of each title's RIC number, against the index positions carrying it. "Current three"
            # is no RIC title and no number can reach it, so it is in no list.
            self.assertEqual({"schemaVersion": 1, "entryCount": 3, "numbers": {"1": [0], "2": [1]}},
                             load(output / "numbers.json"))
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
            self.assertEqual(written_digests(one), written_digests(two))

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


class ShardCapTests(unittest.TestCase):
    def setUp(self):
        self.imports = load_import_script()

    def records(self, count, size=200):
        return {f"ric.5.x.{number:03d}": {"i": f"ric.5.x.{number:03d}", "l": "x" * size}
                for number in range(1, count + 1)}

    def part_bytes(self, part):
        return self.imports.json_bytes({"schemaVersion": 1, "records": part["records"]})

    def test_a_volume_under_the_cap_stays_one_file(self):
        records = self.records(4)
        parts = self.imports.shard_parts("5", records, cap=4096)
        self.assertEqual([{"file": "records-5.json", "from": ""}],
                         [{"file": part["file"], "from": part["from"]} for part in parts])
        self.assertEqual(records, parts[0]["records"])

    def test_an_oversized_volume_splits_by_id_order_within_the_cap(self):
        records = self.records(20)
        parts = self.imports.shard_parts("5", records, cap=2048)
        self.assertEqual(["records-5.a.json", "records-5.b.json", "records-5.c.json"],
                         [part["file"] for part in parts])
        # The first part takes everything before the second part's first id, so a reader needs no lower bound for it.
        self.assertEqual(["", "ric.5.x.008", "ric.5.x.015"], [part["from"] for part in parts])
        for part in parts:
            self.assertLessEqual(len(self.part_bytes(part)), 2048, part["file"])
            self.assertEqual(sorted(part["records"]), list(part["records"]))
        self.assertEqual(list(records), [record_id for part in parts for record_id in part["records"]])

    def test_a_record_too_large_for_any_shard_fails_loudly(self):
        with self.assertRaises(self.imports.ImportFailure):
            self.imports.shard_parts("5", self.records(2, size=4096), cap=2048)

    def test_the_number_index_keys_ascii_digits_only(self):
        # lookup.js reads a number with JavaScript's \d, which is ASCII; Python's also matches ٣ and ３, and a title keyed
        # off one of those would be listed under a number no reference can ever be parsed as.
        self.assertEqual({"1": [0]}, self.imports.number_index(
            [["ric.1.x.1", "RIC I Test 1"], ["ric.1.x.2", "RIC I Test ٣"], ["ric.1.x.3", "RIC I Test ３"]]))

    def test_a_generated_file_over_the_cap_leaves_the_data_directory_untouched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "ocre"
            self.assertEqual(0, run_import(FIXTURE, root).returncode)
            before = written_digests(root)
            metadata = load(root / "metadata.json")
            records = {record_id: record for path in sorted(root.glob("records-*.json"))
                       for record_id, record in load(path)["records"].items()}
            # A smaller bundle and a cap nothing can meet: the refusal must come before the first byte is replaced,
            # or a contributor is left with half of one import and half of another.
            del records["ric.2.test.2"]
            self.imports.CAP_BYTES = 200
            with self.assertRaises(self.imports.ImportFailure):
                self.imports.write_data(root, records, metadata)
            self.assertEqual(before, written_digests(root))

    def test_the_bundled_data_stays_under_the_cap(self):
        if not (BUNDLE / "metadata.json").is_file():
            self.skipTest("extension/data/ocre is not bundled here")
        for path in sorted(BUNDLE.glob("*.json")):
            self.assertLessEqual(path.stat().st_size, 4 * 1024 * 1024, path.name)


class ReindexTests(unittest.TestCase):
    def test_reindex_reproduces_the_full_import_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            imported, reindexed = root / "imported", root / "reindexed"
            self.assertEqual(0, run_import(FIXTURE, imported).returncode)
            shutil.copytree(imported, reindexed)
            # The derived files go first: a rebuild that silently kept them would prove nothing.
            for name in ("index.json", "numbers.json"):
                (reindexed / name).unlink()
            result = run_reindex(reindexed)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual(written_digests(imported), written_digests(reindexed))

    def test_reindex_reproduces_the_bundled_data_byte_for_byte(self):
        if not (BUNDLE / "metadata.json").is_file():
            self.skipTest("extension/data/ocre is not bundled here")
        with tempfile.TemporaryDirectory() as temporary:
            copy = Path(temporary) / "ocre"
            shutil.copytree(BUNDLE, copy)
            result = run_reindex(copy)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual({path.name: digest(path.read_bytes()) for path in sorted(BUNDLE.glob("*.json"))},
                             {name: value for name, value in written_digests(copy).items() if name.endswith(".json")})

    def test_reindex_refuses_a_data_directory_missing_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "ocre"
            self.assertEqual(0, run_import(FIXTURE, root).returncode)
            (root / "records-2.json").unlink()
            result = run_reindex(root)
            self.assertNotEqual(0, result.returncode)
            self.assertIn("reindex failed", result.stderr.lower())

    def test_reindex_takes_no_source_output_or_generated_date(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = subprocess.run([sys.executable, str(SCRIPT), "--reindex", str(root), str(FIXTURE), str(root / "out")],
                                    text=True, capture_output=True)
            self.assertNotEqual(0, result.returncode)


if __name__ == "__main__":
    unittest.main()
