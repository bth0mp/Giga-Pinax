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
WIKIDATA = ROOT / "scripts" / "data" / "wikidata-mints.json"


def load_module():
    spec = importlib.util.spec_from_file_location("giga_pinax_import_people", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    """One canned HTTP response, as urlopen hands it over: a context manager with a status and bytes to read."""

    def __init__(self, payload: bytes, status: int = 200):
        self.payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self) -> bytes:
        return self.payload


def canned(pages: dict[str, bytes], asked: list | None = None):
    """A urlopen stand-in that answers from a URL to bytes table and records what was asked for, so no test of a fetch touches the network."""
    def opener(request, timeout=None):
        if asked is not None:
            asked.append((request.full_url, request.get_header("User-agent")))
        if request.full_url not in pages:
            raise AssertionError(f"unexpected request: {request.full_url}")
        return FakeResponse(pages[request.full_url])
    return opener


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

    def test_the_mint_snapshot_records_the_concept_links_it_finds_and_follows_none_of_them(self):
        """Nomisma says which Wikidata item is the same place; the snapshot has to carry that link, and every other vocabulary's link with it."""
        module = load_module()
        rdf = ('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:skos="http://www.w3.org/2004/02/skos/core#">'
               '<skos:Concept rdf:about="http://nomisma.org/id/treveri"><skos:prefLabel xml:lang="en">Trier</skos:prefLabel>'
               '<skos:closeMatch rdf:resource="http://www.wikidata.org/entity/Q3138"/>'
               '<skos:exactMatch rdf:resource="https://pleiades.stoa.org/places/109188"/>'
               '<skos:closeMatch rdf:resource="http://www.wikidata.org/entity/Q322168"/></skos:Concept>'
               # A subject that is not the concept itself carries links of its own, and none of them belongs to this mint.
               '<rdf:Description rdf:about="http://nomisma.org/id/treveri#provenance">'
               '<skos:closeMatch rdf:resource="http://www.wikidata.org/entity/Q999999"/></rdf:Description></rdf:RDF>').encode("utf-8")
        asked = []
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "nomisma-mints.json"
            with unittest.mock.patch.object(module, "urlopen", canned({"https://nomisma.org/id/treveri.rdf": rdf}, asked)):
                self.assertEqual(1, module.fetch_mint_snapshot(["treveri"], output, "2026-09-18"))
            snapshot = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual([("https://nomisma.org/id/treveri.rdf", module.USER_AGENT)], asked)
        concept = snapshot["concepts"]["treveri"]
        self.assertEqual(["http://www.wikidata.org/entity/Q3138", "http://www.wikidata.org/entity/Q322168",
                          "https://pleiades.stoa.org/places/109188"], concept["matches"])
        self.assertEqual([["prefLabel", "en", "Trier"]], concept["labels"])
        self.assertEqual("2026-09-18", snapshot["retrievedOn"])
        # Only the Wikidata links are ever followed, in the order the concept lists them, and a link of another subject is not this mint's.
        self.assertEqual(["Q3138", "Q322168"], module.mint_entity_ids(concept))
        self.assertEqual([], module.mint_entity_ids({"labels": []}))
        self.assertEqual([], module.mint_entity_ids({"matches": ["https://sws.geonames.org/2821164/", "http://dbpedia.org/resource/Trier"]}))

    def test_the_wikidata_snapshot_keeps_the_languages_a_name_is_taken_from_and_names_the_mints_with_no_link(self):
        """One GET per linked item, under a User-Agent naming the script; the rest of the item — every statement it carries — is never read."""
        module = load_module()
        mints = json.dumps({"concepts": {
            "treveri": {"url": "x", "labels": [], "matches": ["http://www.wikidata.org/entity/Q3138"]},
            # Nomisma links Thessalonica to no Wikidata item at all, so nothing is fetched for it and the run has to say so.
            "thessalonica": {"url": "x", "labels": [], "matches": ["https://pleiades.stoa.org/places/491741"]},
        }}).encode("utf-8")
        item = json.dumps({"entities": {"Q3138": {
            "labels": {"en": {"language": "en", "value": "Trier"}, "de": {"language": "de", "value": "Trier"},
                       "fr": {"language": "fr", "value": "Trèves"}, "pl": {"language": "pl", "value": "Trewir"}},
            "aliases": {"en": [{"language": "en", "value": "Augusta  Treverorum"}], "pl": [{"language": "pl", "value": "Treviri"}]},
            "descriptions": {"en": {"language": "en", "value": "city in Rhineland-Palatinate, Germany"}},
            "claims": {"P1366": [{"mainsnak": {"datavalue": {"type": "wikibase-entityid", "value": {"id": "Q42"}}}}]},
        }}}).encode("utf-8")
        asked = []
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "wikidata-mints.json"
            pages = {"https://www.wikidata.org/wiki/Special:EntityData/Q3138.json": item}
            with unittest.mock.patch.object(module, "urlopen", canned(pages, asked)):
                count, unlinked = module.fetch_wikidata_snapshot(mints, output, "2026-09-18")
            written = output.read_bytes()
            snapshot = json.loads(written.decode("utf-8"))
        self.assertEqual((1, ["thessalonica"]), (count, unlinked))
        self.assertEqual([("https://www.wikidata.org/wiki/Special:EntityData/Q3138.json", module.USER_AGENT)], asked)
        # German is Trier's own country's language and the five exonym languages are always asked for; Polish is neither, so no Polish spelling is
        # kept. A label and an alias are told apart as Nomisma tells them apart, and the spacing is squashed as it is squashed there.
        self.assertEqual([["altLabel", "en", "Augusta Treverorum"], ["prefLabel", "de", "Trier"],
                          ["prefLabel", "en", "Trier"], ["prefLabel", "fr", "Trèves"]], snapshot["entities"]["Q3138"]["labels"])
        self.assertEqual("https://www.wikidata.org/wiki/Special:EntityData/Q3138.json", snapshot["entities"]["Q3138"]["url"])
        # Wikidata dedicates its structured data to the public domain, and the statement travels with the file that holds it.
        self.assertEqual("CC0-1.0", snapshot["license"])
        self.assertEqual("https://creativecommons.org/publicdomain/zero/1.0/", snapshot["licenseUrl"])
        self.assertIn("CC0 1.0", snapshot["licenseStatement"])
        # Nothing of the item beyond its names is written down: a statement naming another item could otherwise put a name on a mint by itself.
        self.assertNotIn(b"P1366", written)
        self.assertNotIn(b"Q42", written)
        self.assertNotIn(b"Rhineland", written)

    def test_a_wikidata_label_joins_the_nomisma_ones_under_the_same_three_rules(self):
        """The two sources are merged before a name is chosen, so either may be the language that earns it and neither outranks the other."""
        module = load_module()
        mints = json.dumps({"concepts": {
            # Nomisma writes Serdica's modern name in Bulgarian alone, which is no script a dealer types; Wikidata's English label is "Sofia".
            "serdica": {"url": "x", "labels": [["prefLabel", "en", "Serdica"], ["prefLabel", "bg", "София"]],
                        "matches": ["http://www.wikidata.org/entity/Q472"]},
            # Neither source alone writes "Sisak" twice over, and together English and Croatian do.
            "siscia": {"url": "x", "labels": [["prefLabel", "hr", "Sisak"]], "matches": ["http://www.wikidata.org/entity/Q192119"]},
        }}).encode("utf-8")
        wikidata = json.dumps({"entities": {
            "Q472": {"url": "x", "labels": [["prefLabel", "en", "Sofia"], ["altLabel", "en", "Sredets"], ["prefLabel", "pl", "Sofiaa"]]},
            "Q192119": {"url": "x", "labels": [["prefLabel", "en", "Sisak"]]},
        }}).encode("utf-8")
        sections = {"serdica": "Serdica", "siscia": "Siscia"}
        rows = module.mint_rows(mints, sections, (), wikidata)
        self.assertEqual([("serdica", "Serdica", ["sofia", "sredets"]), ("siscia", "Siscia", ["sisak"])], rows)
        # Without the Wikidata snapshot the same call is WP-F's: Nomisma's labels alone, and the links go unread.
        self.assertEqual([("siscia", "Siscia", ["sisak"])], module.mint_rows(mints, sections))
        # The Nomisma snapshot's own links say which item belongs to which mint, so a Wikidata snapshot that no longer holds one of them is out of
        # step with it, and the run stops rather than quietly dropping the names that item carried.
        with self.assertRaises(ValueError) as refused:
            module.mint_rows(mints, sections, (), json.dumps({"entities": {"Q472": {"url": "x", "labels": []}}}).encode("utf-8"))
        self.assertIn("Q192119", str(refused.exception))

    def test_a_nickname_a_different_place_or_a_two_letter_code_is_not_a_name(self):
        """Wikidata lists epithets, neighbours and codes beside a city's names, and a lot heading naming no ruler is read for the earliest mint
        spelling in it — so "the Eternal City" on a Trier coin would file it under Rome."""
        module = load_module()
        mints = json.dumps({"concepts": {
            "rome": {"url": "x", "labels": [["prefLabel", "it", "Roma"]], "matches": ["http://www.wikidata.org/entity/Q220"]},
            "ambianum": {"url": "x", "labels": [["prefLabel", "fr", "Amiens"]], "matches": ["http://www.wikidata.org/entity/Q41604"]},
        }}).encode("utf-8")
        wikidata = json.dumps({"entities": {
            "Q220": {"url": "x", "labels": [["prefLabel", "en", "Rome"], ["altLabel", "en", "The Eternal City"], ["altLabel", "en", "Rome, Italy"],
                                            ["altLabel", "it", "Caput Mundi"], ["altLabel", "it", "Urbe"], ["altLabel", "it", "RM"]]},
            "Q41604": {"url": "x", "labels": [["prefLabel", "fr", "Amiens"], ["altLabel", "fr", "Longpré-lès-Amiens"],
                                              ["altLabel", "fr", "Samarobriva"]]},
        }}).encode("utf-8")
        rows = module.mint_rows(mints, {"rome": "Rome", "ambianum": "Amiens"}, (), wikidata)
        # "Rome, Italy" is the name with its country beside it and stays; the epithets, the province code "RM" and the neighbouring commune go.
        self.assertEqual([("ambianum", "Amiens", ["samarobriva"]), ("rome", "Rome", ["roma", "rome, italy"])], rows)
        # Each refusal is keyed by the concept it belongs to, so none of them can take a real name from another mint.
        self.assertIn(("rome", "the eternal city"), module.NOT_A_NAME)
        self.assertNotIn(("ambianum", "the eternal city"), module.NOT_A_NAME)
        self.assertEqual(3, module.MINIMUM_NAME_LENGTH)

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

    def test_generate_takes_both_tracked_mint_snapshots_by_default_and_stops_without_either(self):
        """The generated header names both snapshots, so omitting an option may not quietly mean no mints, or mints with half their names."""
        module = load_module()
        self.assertEqual(ROOT / "scripts" / "data" / "nomisma-mints.json", module.DEFAULT_MINTS)
        self.assertEqual(ROOT / "scripts" / "data" / "wikidata-mints.json", module.DEFAULT_WIKIDATA)
        self.assertTrue(module.DEFAULT_MINTS.is_file())
        self.assertTrue(module.DEFAULT_WIKIDATA.is_file())
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
                "matches": ["http://www.wikidata.org/entity/Q3138"],
            }}}), encoding="utf-8")
            linked = root / "wikidata-mints.json"
            linked.write_text(json.dumps({"entities": {"Q3138": {
                "url": "https://www.wikidata.org/wiki/Special:EntityData/Q3138.json",
                "labels": [["altLabel", "en", "Triers"]],
            }}}), encoding="utf-8")
            output = root / "ric-people.js"
            argv = ["import_people.py", "generate", str(data_dir), str(SNAPSHOT), str(output), "--generated-on", "2026-09-15"]

            module.DEFAULT_MINTS, module.DEFAULT_WIKIDATA = tracked, linked
            printed, failed = io.StringIO(), io.StringIO()
            with unittest.mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(printed):
                self.assertEqual(0, module.main())
            self.assertEqual(1, json.loads(printed.getvalue())["mintCount"])
            self.assertIn('id: "treveri", section: "Treveri", aliases: Object.freeze(["trier", "triers"])', output.read_text(encoding="utf-8"))
            # Wikidata's CC0 dedication travels in the generated header, beside Nomisma's CC-BY, because that is where the names ended up.
            self.assertIn('//   wikidataLicense: "CC0-1.0"', output.read_text(encoding="utf-8"))

            # Missing, either is an error that names the file: the header would otherwise claim a snapshot
            # the run never read, over an index with no mints in it or with half of each mint's names.
            for missing, kept in (("DEFAULT_MINTS", "DEFAULT_WIKIDATA"), ("DEFAULT_WIKIDATA", "DEFAULT_MINTS")):
                output.unlink(missing_ok=True)
                setattr(module, missing, root / "gone.json")
                with unittest.mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(printed), contextlib.redirect_stderr(failed):
                    self.assertEqual(1, module.main())
                self.assertIn("gone.json", failed.getvalue())
                self.assertFalse(output.exists())
                setattr(module, missing, {"DEFAULT_MINTS": tracked, "DEFAULT_WIKIDATA": linked}[missing])
                self.assertTrue(getattr(module, kept).is_file())

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

    def test_every_mint_but_one_carries_a_wikidata_link_and_every_linked_item_is_in_the_snapshot(self):
        """Nomisma's own closeMatch links decide which items are read, so the two tracked files have to agree about the whole set of them."""
        module = load_module()
        concepts = json.loads(MINTS.read_bytes())["concepts"]
        entities = json.loads(WIKIDATA.read_bytes())["entities"]
        linked = {concept_id: module.mint_entity_ids(concept) for concept_id, concept in concepts.items()}
        # Thessalonica is the one mint Nomisma links to no Wikidata item at all, so it keeps only the names Nomisma itself publishes.
        self.assertEqual(["thessalonica"], sorted(concept_id for concept_id, ids in linked.items() if not ids))
        self.assertEqual(sorted({entity_id for ids in linked.values() for entity_id in ids}), sorted(entities))
        # Ticinum and Treveri each link two items; one request was made per item, not per mint.
        self.assertEqual(22, len(entities))
        self.assertEqual(["Q28215083", "Q396445"], linked["ticinum"])
        for entity in entities.values():
            self.assertTrue(entity["url"].startswith("https://www.wikidata.org/wiki/Special:EntityData/"))

    def test_the_real_snapshots_name_the_mints_they_can_and_invent_nothing_for_the_rest(self):
        """Three of the 21 mints carry no modern name either source publishes, and two of those really are called something else today."""
        module = load_module()
        sections = module.read_mints(DATA)
        rulers = module.ruler_spellings(CONCEPTS.read_bytes(), module.read_memberships(DATA))
        rows = module.mint_rows(MINTS.read_bytes(), sections, rulers, WIKIDATA.read_bytes())
        named = {section: aliases for _, section, aliases in rows}
        self.assertEqual(["arles"], named["Arelate"])
        self.assertEqual(["citta di roma", "roma", "rome, italy"], named["Rome"])
        self.assertEqual(["sisak"], named["Siscia"])
        # What Wikidata adds where Nomisma had nothing to add: Bulgaria's capital is the name Serdica goes by today, and Nomisma writes it in
        # Cyrillic alone. The four names the mint volumes were asked for are not among them; see the assertion below.
        self.assertEqual(["serdika", "sofia", "sofija", "sredets", "sredez"], named["Serdica"])
        self.assertEqual(["carthago", "colonia julia carthago", "mint of carthage"], named["Carthage"])
        self.assertEqual(["augusta treverorum", "treverer", "trevirer", "treviri", "trier", "triers"], named["Treveri"])
        # These three keep RIC's own spelling. Aquileia already is the name on the map; Mediolanum and Ticinum are not, but the Wikidata items
        # Nomisma links them to are the Roman city and an article about it, and both are titled by the Latin name in every language kept.
        self.assertEqual(["Aquileia", "Mediolanum", "Ticinum"], sorted(set(sections.values()) - set(named)))
        # The point of the exercise, asserted rather than assumed. The Wikidata items Nomisma links Londinium, Lugdunum, Mediolanum and Ticinum to
        # are the Roman city, not the town standing there now, so none of these five names is reachable and none of them is invented: a lot written
        # "London" or "Milan" is still looked up by RIC's own spelling.
        for absent in ("london", "lyon", "lyons", "pavia", "milan"):
            self.assertEqual([], [section for section, aliases in named.items() if absent in aliases], absent)
        # Four of the five are written nowhere in either file, in any of the ~80 languages the Nomisma snapshot carries or the six the Wikidata one
        # keeps. "Lyon" is the exception and is no more reachable for it: the one label spelling it is Danish, which is neither France's language,
        # nor English, nor one of the five whose shared exonyms count.
        written = {module.normalise_alias(value)
                   for holder in (json.loads(MINTS.read_bytes())["concepts"], json.loads(WIKIDATA.read_bytes())["entities"])
                   for entry in holder.values() for _, _, value in entry["labels"]}
        for absent in ("london", "lyons", "pavia", "milan"):
            self.assertNotIn(absent, written)
        self.assertEqual({"da"}, {lang for _, lang, value in json.loads(MINTS.read_bytes())["concepts"]["lugdunum"]["labels"]
                                  if module.normalise_alias(value) == "lyon"})

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
                                             module.ruler_spellings(CONCEPTS.read_bytes(), memberships), WIKIDATA.read_bytes()))
            self.assertEqual(committed, output.read_bytes())


if __name__ == "__main__":
    unittest.main()
