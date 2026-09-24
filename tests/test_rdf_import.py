import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "import_rdf.py"
FIXTURE = ROOT / "tests" / "fixtures" / "local-rdf-small.rdf"
DATA = ROOT / "extension" / "data"
BUNDLE = DATA / "ocre"
# The corpora bundled beside OCRE, each with a trimmed export of its own under tests/fixtures.
CORPUS_FIXTURES = {name: ROOT / "tests" / "fixtures" / f"{name}-rdf-small.rdf" for name in ("crro", "pella", "sco", "pco", "agco")}
NAMESPACES = ("xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#' "
              "xmlns:nmo='http://nomisma.org/ontology#' "
              "xmlns:skos='http://www.w3.org/2004/02/skos/core#' "
              "xmlns:dcterms='http://purl.org/dc/terms/'")


def run_import(source, output, generated_on="2026-09-14", corpus=None):
    corpus_argument = ["--corpus", corpus] if corpus else []
    return subprocess.run([sys.executable, str(SCRIPT), *corpus_argument, str(source), str(output),
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
            # A byte order mark is what the check above reads; without one the same UTF-16 text is bytes with a NUL in
            # every other place, which the declaration pattern never matches - and expat, which sniffs the encoding for
            # itself, then reads and expands the entity the guard was there to refuse.
            ("<!DOCTYPE rdf:RDF [<!ENTITY x 'bad'>]><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'/>",
             "RDF input must be UTF-8 XML", "2026-09-14", "utf-16-le"),
            ("<!DOCTYPE rdf:RDF [<!ENTITY x 'bad'>]><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'/>",
             "RDF input must be UTF-8 XML", "2026-09-14", "utf-16-be"),
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


class CorpusImportTests(unittest.TestCase):
    """The three corpora bundled beside OCRE, through the same importer: only the corpus table differs."""

    def imported(self, corpus):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name) / corpus
        result = run_import(CORPUS_FIXTURES[corpus], output, "2026-09-17", corpus=corpus)
        self.assertEqual(0, result.returncode, result.stderr)
        return output

    def test_crro_bundles_every_rrc_type_in_one_group_and_needs_no_number_index(self):
        output = self.imported("crro")
        # No numbers.json: RRC references name their record outright, so nothing parses 2,602 titles for a number.
        self.assertEqual(["index.json", "metadata.json", "records-rrc.json"],
                         sorted(path.name for path in output.iterdir()))
        metadata = load(output / "metadata.json")
        self.assertEqual(("crro", 4, 4, "https://numismatics.org/crro/"),
                         (metadata["corpus"], metadata["recordCount"], metadata["activeRecordCount"],
                          metadata["sourceUrl"]))
        # A corpus that leaves nothing out makes no claim about what it left out.
        self.assertNotIn("excluded", metadata)
        self.assertEqual({"rrc": [{"file": "records-rrc.json", "from": ""}]}, metadata["shards"])
        self.assertEqual([["rrc-1.1", "RRC 1/1"], ["rrc-44.5", "RRC 44/5"], ["rrc-44.6", "RRC 44/6"],
                          ["rrc-98b", "RRC 98B"]], load(output / "index.json")["entries"])
        records = load(output / "records-rrc.json")["records"]
        # CRRO names the issuer where OCRE names the authority, and it goes in the same slot.
        self.assertEqual({
            "i": "rrc-44.5", "l": "RRC 44/5", "a": ["anonymous"], "d": ["denarius"], "m": ["rome"], "x": ["ar"],
            "s": "-0211", "e": "-0211",
            "o": {"d": "Helmeted head of Roma, right. Border of dots.", "p": ["roma"]},
            "r": {"l": "ROMA", "d": "Dioscuri galloping right. Line border.", "p": ["dioscuri"]},
        }, records["rrc-44.5"])
        # A mint the export states as uncertain is a blank node with no resource of its own, and the JSON-LD the online
        # card is built from carries it the same way: neither side names a mint, so neither invents one.
        self.assertNotIn("m", records["rrc-98b"])
        # A portrait Nomisma does not publish keeps its whole URI, as OCRE's do.
        self.assertEqual(["http://collection.britishmuseum.org/id/person-institution/60208"],
                         records["rrc-98b"]["o"]["p"])

    def test_pella_bundles_only_price_types_and_counts_what_it_leaves_out(self):
        output = self.imported("pella")
        metadata = load(output / "metadata.json")
        self.assertEqual((4, 2), (metadata["recordCount"], metadata["activeRecordCount"]))
        self.assertEqual({"count": 2, "reason": metadata["excluded"]["reason"],
                          "byGroup": {"lerider": 1, "pella": 1}}, metadata["excluded"])
        self.assertIn("Price", metadata["excluded"]["reason"])
        self.assertEqual([["price.23", "Price 23"], ["price.24", "Price 24"]], load(output / "index.json")["entries"])
        # The one replacement in the fixture is a Le Rider die combination replaced by a PELLA number: neither is
        # bundled, so the redirect would land on a record that is not here and is dropped rather than followed.
        self.assertEqual({}, metadata["aliases"])
        self.assertEqual(1, metadata["replacementSkips"]["dangling"])

    def test_sco_keeps_every_part_of_seleucid_coins_under_its_sc_1_identifier(self):
        output = self.imported("sco")
        entries = dict(load(output / "index.json")["entries"])
        # SCO titles a record with the part of the book it is in, but identifies every one of them under sc.1, which is
        # the identifier lookup.js builds from "SC 1315.3c".
        self.assertEqual("Seleucid Coins (part 2) 1315.3c", entries["sc.1.1315.3c"])
        self.assertEqual({"sc": [{"file": "records-sc.json", "from": ""}]}, load(output / "metadata.json")["shards"])

    def test_pco_bundles_only_lorber_cpe_types_and_no_redirect_out_of_svoronos(self):
        output = self.imported("pco")
        metadata = load(output / "metadata.json")
        self.assertEqual((6, 3), (metadata["recordCount"], metadata["activeRecordCount"]))
        self.assertEqual({"count": 3, "reason": metadata["excluded"]["reason"], "byGroup": {"svoronos": 3}}, metadata["excluded"])
        self.assertIn("Svoronos", metadata["excluded"]["reason"])
        # Both parts of CPE volume I, part 2 numbering its bronzes with a B, in one group; the identifier keeps its case.
        self.assertEqual([["cpe.1_1.330", "Coins of the Ptolemaic Empire Vol. I, Part 1, no. 330"],
                          ["cpe.1_1.466A", "Coins of the Ptolemaic Empire Vol. I, Part 1, no. 466A"],
                          ["cpe.1_2.B146", "Coins of the Ptolemaic Empire Vol. I, Part II, no. B146"]],
                         load(output / "index.json")["entries"])
        self.assertEqual({"cpe": [{"file": "records-cpe.json", "from": ""}]}, metadata["shards"])
        # Two Svoronos numbers are replaced by the CPE types they became. No lookup asks for a Svoronos record by id, so the
        # links are no aliases: they are kept as PCO's own concordance, which a Svoronos citation is read through.
        self.assertEqual({}, metadata["aliases"])
        self.assertEqual({"ambiguous": 0, "cyclic": 0, "dangling": 0}, metadata["replacementSkips"])
        self.assertEqual({"svoronos-1904.487": ["cpe.1_1.330"], "svoronos-1904.71": ["cpe.1_2.B146"]}, metadata["concordance"])
        record = load(output / "records-cpe.json")["records"]["cpe.1_1.330"]
        self.assertEqual({
            "i": "cpe.1_1.330", "l": "Coins of the Ptolemaic Empire Vol. I, Part 1, no. 330", "a": ["ptolemy_ii"], "d": ["decadrachm"],
            "m": ["alexandreia_egypt"], "x": ["ar"], "s": "-0270", "e": "-0246",
            "o": {"d": "Veiled Head of deified Arsinoe II right, with ram's horn, wearing diademed stephane, lotus scepter over far "
                       "shoulder, sometimes with serpent coiled around shaft, dotted border", "p": ["arsinoe_ii"]},
            "r": {"l": "ΑΡΣΙΝΟΗΣ l., ΦΙΛΑΔΕΛΦΟΥ r.", "d": "Double Cornucopiae bound with royal diadem, containing pyramidal cakes, "
                  "pomegranate, and other fruits, a grape cluster hanging from the rim of each horn, dotted border"},
        }, record)

    def test_a_svoronos_link_is_kept_only_when_every_type_it_names_is_bundled(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            base = "http://numismatics.org/pco/id/"
            def record(record_id, *targets):
                links = "".join(f"<dcterms:isReplacedBy rdf:resource='{base}{target}'/>" for target in targets)
                return f"<nmo:TypeSeriesItem rdf:about='{base}{record_id}'><skos:prefLabel xml:lang='en'>{record_id}</skos:prefLabel>{links}</nmo:TypeSeriesItem>"
            source = root / "pco.rdf"
            source.write_text(f"<rdf:RDF {NAMESPACES}>" + "".join([
                record("cpe.1_1.1"), record("cpe.1_1.2"),
                # Two types for one number is offered as two; a link to a type the export does not hold, or a Svoronos record, is not kept.
                record("svoronos-1904.9", "cpe.1_1.2", "cpe.1_1.1"), record("svoronos-1904.8", "cpe.1_1.3"),
                record("svoronos-1904.7", "cpe.1_1.1", "cpe.1_1.3"), record("svoronos-1904.6", "svoronos-1904.5"), record("svoronos-1904.5"),
            ]) + "</rdf:RDF>", encoding="utf-8")
            result = run_import(source, root / "pco", corpus="pco")
            self.assertEqual(0, result.returncode, result.stderr)
            metadata = load(root / "pco" / "metadata.json")
            self.assertEqual({"svoronos-1904.9": ["cpe.1_1.1", "cpe.1_1.2"]}, metadata["concordance"])
            self.assertEqual({}, metadata["aliases"])

    def test_agco_bundles_every_newell_demetrius_type(self):
        output = self.imported("agco")
        metadata = load(output / "metadata.json")
        self.assertEqual((2, 2), (metadata["recordCount"], metadata["activeRecordCount"]))
        self.assertNotIn("excluded", metadata)
        self.assertEqual({"ambiguous": 0, "cyclic": 0, "dangling": 0}, metadata["replacementSkips"])
        self.assertEqual({"newell": [{"file": "records-newell.json", "from": ""}]}, metadata["shards"])
        self.assertEqual([["newell.demetrius.1", "Newell Demetrius Poliorcetes, no. 1"],
                          ["newell.demetrius.45", "Newell Demetrius Poliorcetes, no. 45"]], load(output / "index.json")["entries"])
        self.assertEqual(["index.json", "metadata.json", "records-newell.json"], sorted(path.name for path in output.iterdir()))

    def test_every_corpus_import_is_byte_deterministic_and_reindexes_to_the_same_bytes(self):
        for corpus, fixture in CORPUS_FIXTURES.items():
            with self.subTest(corpus=corpus), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                one, two = root / "one", root / "two"
                self.assertEqual(0, run_import(fixture, one, corpus=corpus).returncode)
                self.assertEqual(0, run_import(fixture, two, corpus=corpus).returncode)
                self.assertEqual(written_digests(one), written_digests(two))
                (two / "index.json").unlink()
                result = run_reindex(two)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(written_digests(one), written_digests(two))

    def test_an_export_of_another_corpus_or_an_unknown_identifier_is_refused(self):
        cases = [
            ("crro", CORPUS_FIXTURES["sco"], "unsupported type URI corpus"),
            ("sco", CORPUS_FIXTURES["crro"], "unsupported type URI corpus"),
            # PELLA is the one corpus this bundles only part of, so an identifier in neither set stops the import
            # instead of being dropped without a word.
            ("pella", None, "unsupported PELLA record id"),
        ]
        for corpus, fixture, message in cases:
            with self.subTest(corpus=corpus), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = fixture
                if source is None:
                    source = root / "unknown.rdf"
                    source.write_text(f"""<rdf:RDF {NAMESPACES}>
                      <nmo:TypeSeriesItem rdf:about='http://numismatics.org/pella/id/newton.1'>
                        <skos:prefLabel>Newton 1</skos:prefLabel></nmo:TypeSeriesItem></rdf:RDF>""", encoding="utf-8")
                result = run_import(source, root / "out", corpus=corpus)
                self.assertNotEqual(0, result.returncode)
                self.assertIn(message, result.stderr)

    def test_reindex_takes_its_corpus_from_the_data_it_rebuilds(self):
        output = self.imported("sco")
        result = subprocess.run([sys.executable, str(SCRIPT), "--reindex", str(output), "--corpus", "crro"],
                                text=True, capture_output=True)
        self.assertNotEqual(0, result.returncode)
        self.assertEqual(0, run_reindex(output).returncode)
        self.assertEqual("sco", load(output / "metadata.json")["corpus"])


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
            self.skipTest("extension/data is not bundled here")
        for path in sorted([*DATA.glob("*.json"), *DATA.glob("*/*.json")]):
            self.assertLessEqual(path.stat().st_size, 4 * 1024 * 1024, str(path.relative_to(DATA)))


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
            self.skipTest("extension/data is not bundled here")
        for bundle in sorted(path for path in DATA.iterdir() if path.is_dir()):
            with self.subTest(corpus=bundle.name), tempfile.TemporaryDirectory() as temporary:
                copy = Path(temporary) / bundle.name
                shutil.copytree(bundle, copy)
                result = run_reindex(copy)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual({path.name: digest(path.read_bytes()) for path in sorted(bundle.glob("*.json"))},
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


class LabelTests(unittest.TestCase):
    """The Nomisma label snapshot and the file generated from it. Neither path makes a request here."""

    def setUp(self):
        self.imports = load_import_script()

    def records(self, **fields):
        return {"records": {"x.1": {"i": "x.1", "l": "X 1", **fields}}}

    def test_every_concept_field_the_card_renders_is_collected_and_a_foreign_uri_is_not(self):
        museum = "http://collection.britishmuseum.org/id/person-institution/60208"
        collected = self.imports.record_slugs(self.records(
            a=["anonymous"], d=["denarius"], m=["rome"], x=["ar"],
            o={"p": ["roma", museum]}, r={"p": ["dioscuri"]})["records"])
        # A concept published somewhere other than Nomisma is kept whole on the record and asked of nobody.
        self.assertEqual({"anonymous", "denarius", "rome", "ar", "roma", "dioscuri"}, collected)

    def test_a_nomisma_concept_written_over_https_is_the_same_concept(self):
        # ANS writes a few links as https://nomisma.org/id/... (RIC II.3 Hadrian quinarii in the 2026-09-24 export); they
        # name the same concept as the http form, so the card gets its label rather than a raw address.
        self.assertEqual("quinarius", self.imports.compact_resource("https://nomisma.org/id/quinarius"))
        self.assertEqual("quinarius", self.imports.compact_resource("http://nomisma.org/id/quinarius"))
        museum = "https://collection.britishmuseum.org/id/person-institution/60208"
        self.assertEqual(museum, self.imports.compact_resource(museum))

    def test_a_concept_the_snapshot_does_not_label_is_left_out_rather_than_invented(self):
        payload = self.imports.label_payload({"labels": {"ar": "Silver"}}, {"ar", "dupondius_or_as"})
        self.assertEqual({"schemaVersion": 1, "labels": {"ar": "Silver"}}, payload)
        with self.assertRaises(self.imports.ImportFailure):
            self.imports.label_payload({"retrievedOn": "2026-09-17"}, {"ar"})
        with self.assertRaises(self.imports.ImportFailure):
            self.imports.label_payload({"labels": {"ar": ""}}, {"ar"})

    def test_the_generated_label_file_is_sorted_and_byte_identical_whenever_it_runs(self):
        snapshot = {"labels": {"rome": "Rome", "ar": "Silver", "denarius": "Denarius"}}
        first = self.imports.json_bytes(self.imports.label_payload(snapshot, {"rome", "ar", "denarius"}))
        second = self.imports.json_bytes(self.imports.label_payload(snapshot, {"denarius", "ar", "rome"}))
        self.assertEqual(first, second)
        self.assertEqual(["ar", "denarius", "rome"], list(json.loads(first)["labels"]))

    def test_the_tracked_snapshot_records_where_its_labels_came_from(self):
        snapshot = load(ROOT / "scripts" / "data" / "nomisma-labels.json")
        self.assertEqual(self.imports.LABEL_ENDPOINT, snapshot["endpoint"])
        self.assertEqual(self.imports.LABEL_QUERY, snapshot["query"])
        self.assertEqual(("CC-BY-3.0", "https://creativecommons.org/licenses/by/3.0/"),
                         (snapshot["license"], snapshot["licenseUrl"]))
        self.assertRegex(snapshot["retrievedOn"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertTrue(all(isinstance(label, str) and label.strip() for label in snapshot["labels"].values()))

    def test_the_bundled_label_file_is_what_the_snapshot_and_the_records_generate(self):
        if not (BUNDLE / "metadata.json").is_file():
            self.skipTest("extension/data is not bundled here")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for bundle in sorted(path for path in DATA.iterdir() if path.is_dir()):
                shutil.copytree(bundle, root / bundle.name)
            result = subprocess.run([sys.executable, str(SCRIPT), "--write-labels", str(root)],
                                    text=True, capture_output=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual(digest((DATA / "nomisma-labels.json").read_bytes()),
                             digest((root / "nomisma-labels.json").read_bytes()))

    def test_the_bundled_label_file_labels_every_concept_nomisma_names_and_no_other(self):
        if not (BUNDLE / "metadata.json").is_file():
            self.skipTest("extension/data is not bundled here")
        labels = load(DATA / "nomisma-labels.json")["labels"]
        wanted = self.imports.bundled_slugs(self.imports.corpus_reader(DATA))
        self.assertTrue(set(labels) <= wanted, sorted(set(labels) - wanted)[:5])
        snapshot = load(ROOT / "scripts" / "data" / "nomisma-labels.json")["labels"]
        self.assertEqual(sorted(wanted & set(snapshot)), sorted(labels))

    def test_a_metadata_corpus_that_is_no_name_at_all_fails_the_import_not_the_interpreter(self):
        # A corpus key of the wrong shape must be an ImportFailure like every other broken metadata: a raw TypeError
        # out of the membership test would escape the build's and the importer's own error handling.
        for corpus in ([], {}, {"ocre": 1}, 7, None):
            with self.subTest(corpus=corpus), self.assertRaises(self.imports.ImportFailure):
                self.imports.read_data(lambda name: {"schemaVersion": 1, "corpus": corpus, "shards": {}})


class RefreshTests(unittest.TestCase):
    """The monthly data refresh (.github/workflows/refresh-data.yml): which exports it downloads, which corpora it imports again, and
    the counts it reports for the pull request. Nothing here reaches the network: the label fetch is handed a stand-in."""

    def setUp(self):
        self.imports = load_import_script()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.exports, self.data = self.root / "exports", self.root / "data"
        self.exports.mkdir()
        # Every corpus's export as the workflow saves it, and the data those exports were imported into.
        for name, corpus in self.imports.CORPORA.items():
            fixture = FIXTURE if name == "ocre" else CORPUS_FIXTURES[name]
            shutil.copyfile(fixture, self.exports / corpus["export"])
            self.assertEqual(0, run_import(self.exports / corpus["export"], self.data / name, "2026-09-17", corpus=name).returncode)
        self.snapshot = self.root / "labels.json"
        self.snapshot.write_bytes(self.imports.snapshot_bytes(
            {"retrievedOn": "2026-09-17", "requestedCount": 1, "labelledCount": 1, "labels": {"ar": "Silver"}}))

    def test_every_corpus_names_the_export_it_is_downloaded_from_and_saved_as(self):
        exports = self.imports.export_list()
        self.assertEqual(sorted(self.imports.CORPORA), sorted(name for name, _, _ in exports))
        for name, url, file_name in exports:
            self.assertEqual(f"{self.imports.CORPORA[name]['url']}nomisma.rdf", url)
        # OCRE's export keeps the name ANS gives it, which is what its metadata has always recorded; the others are saved under their own.
        self.assertIn(("ocre", "https://numismatics.org/ocre/nomisma.rdf", "nomisma.rdf"), exports)
        self.assertIn(("pco", "https://numismatics.org/pco/nomisma.rdf", "pco.rdf"), exports)
        result = subprocess.run([sys.executable, str(SCRIPT), "--list-exports"], text=True, capture_output=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("ocre https://numismatics.org/ocre/nomisma.rdf nomisma.rdf", result.stdout.splitlines())

    def test_an_export_that_has_not_changed_is_not_imported_again(self):
        before = {name: written_digests(self.data / name) for name in self.imports.CORPORA}
        report = self.imports.refresh(self.exports, self.data, "2026-10-01")
        self.assertEqual([], report["changed"])
        # Not even the generation date moves: the files are the ones the last import wrote.
        self.assertEqual(before, {name: written_digests(self.data / name) for name in self.imports.CORPORA})
        self.assertIn("| CRRO | unchanged | 4 | 4 | 0 |", report["summary"])

    def test_a_changed_export_is_imported_again_and_its_counts_reported(self):
        crro = self.exports / "crro.rdf"
        text = crro.read_text(encoding="utf-8")
        start = text.index("<nmo:TypeSeriesItem rdf:about=\"http://numismatics.org/crro/id/rrc-44.6\"")
        end = text.index("</nmo:TypeSeriesItem>", start) + len("</nmo:TypeSeriesItem>")
        crro.write_text(text[:start] + text[end:], encoding="utf-8")
        untouched = written_digests(self.data / "sco")
        report = self.imports.refresh(self.exports, self.data, "2026-10-01")
        self.assertEqual(["crro"], report["changed"])
        self.assertEqual("2026-10-01", load(self.data / "crro" / "metadata.json")["generatedOn"])
        self.assertEqual(untouched, written_digests(self.data / "sco"))
        self.assertIn("| CRRO | changed | 4 → 3 | 4 → 3 | 0 |", report["summary"])

    def test_a_missing_export_stops_the_refresh_before_anything_is_written(self):
        (self.exports / "agco.rdf").unlink()
        (self.exports / "crro.rdf").write_text((self.exports / "crro.rdf").read_text(encoding="utf-8").replace("RRC 44/5", "RRC 44/5 "),
                                              encoding="utf-8")
        before = written_digests(self.data / "crro")
        with self.assertRaises(self.imports.ImportFailure):
            self.imports.refresh(self.exports, self.data, "2026-10-01")
        self.assertEqual(before, written_digests(self.data / "crro"))

    def test_labels_nomisma_still_gives_the_same_leave_the_snapshot_as_it_was(self):
        before = self.snapshot.read_bytes()
        answer = lambda slugs, retrieved_on: {"retrievedOn": retrieved_on, "requestedCount": 1, "labelledCount": 1, "labels": {"ar": "Silver"}}
        self.assertFalse(self.imports.refresh_labels(self.data, self.snapshot, "2026-10-01", fetch=answer))
        self.assertEqual(before, self.snapshot.read_bytes())
        self.assertTrue((self.data / "nomisma-labels.json").is_file())
        changed = lambda slugs, retrieved_on: {**answer(slugs, retrieved_on), "labels": {"ar": "Silver", "rome": "Rome"}}
        self.assertTrue(self.imports.refresh_labels(self.data, self.snapshot, "2026-10-01", fetch=changed))
        self.assertEqual("2026-10-01", load(self.snapshot)["retrievedOn"])


class CorpusTableTests(unittest.TestCase):
    """The importer's CORPORA table and the extension's LOCAL_CORPORA are two languages saying the same thing. They stay
    apart on purpose, but a corpus added, renamed or relabelled in one and not the other would write files no lookup can
    find, so the two are checked against each other and against the directories the data actually lives in."""

    def setUp(self):
        source = (ROOT / "extension" / "local-catalogue.js").read_text(encoding="utf-8")
        body = source.split("LOCAL_CORPORA = Object.freeze({", 1)[1].split("\n});", 1)[0]
        self.local = {name: {"uri": uri, "label": label} for name, uri, label
                      in re.findall(r"(\w+): \{ uri: '([^']+)', label: '([^']+)'", body)}
        self.assertEqual(6, len(self.local), "LOCAL_CORPORA could not be read")

    def test_the_two_tables_name_the_same_corpora_as_the_bundled_directories(self):
        corpora = sorted(load_import_script().CORPORA)
        self.assertEqual(corpora, sorted(self.local))
        self.assertEqual(corpora, sorted(path.name for path in DATA.iterdir() if path.is_dir()))

    def test_each_corpus_agrees_on_its_label_and_its_identifier_prefix(self):
        corpora = load_import_script().CORPORA
        for name, entry in sorted(self.local.items()):
            with self.subTest(corpus=name):
                self.assertEqual(corpora[name]["label"], entry["label"])
                # OCRE's card has written https since the bundle existed and the importer writes ANS's own http, which is
                # the one field where the two deliberately differ; the path they name must still be the same.
                self.assertEqual(corpora[name]["base"].split("://", 1)[1], entry["uri"].split("://", 1)[1])


if __name__ == "__main__":
    unittest.main()
