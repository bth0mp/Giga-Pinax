import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"
MANIFESTS = ROOT / "manifests"
BUILD_SCRIPT = ROOT / "scripts" / "build.py"
DIST = ROOT / "dist"

VERSION = json.loads((MANIFESTS / "brave.json").read_text(encoding="utf-8"))["version"]
HOST_PERMISSIONS = ["https://numismatics.org/*", "https://nomisma.org/*", "https://www.acsearch.info/*"]


def load_build_script():
    spec = importlib.util.spec_from_file_location("giga_pinax_build", BUILD_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def packaged_paths() -> set[str]:
    build = load_build_script()
    return set(build.ASSET_PATHS) | set(build.local_catalogue_assets())


class ManifestTests(unittest.TestCase):
    def load_manifest(self, browser: str) -> dict:
        return json.loads((MANIFESTS / f"{browser}.json").read_text(encoding="utf-8"))

    def test_manifests_expose_only_the_popup_and_existing_icons(self) -> None:
        for browser in ("brave", "firefox"):
            with self.subTest(browser=browser):
                manifest = self.load_manifest(browser)
                self.assertEqual(3, manifest["manifest_version"])
                self.assertEqual("Giga Pinax", manifest["name"])
                self.assertEqual(VERSION, manifest["version"])
                self.assertEqual("popup.html", manifest["action"]["default_popup"])
                self.assertEqual(
                    {"_execute_action": {"suggested_key": {"default": "Alt+Shift+G"}, "description": "Open Giga Pinax"}},
                    manifest["commands"],
                )
                self.assertIn("ancient coin", manifest["description"].lower())
                self.assertNotIn("sample", manifest["description"].lower())

                icon_paths = set(manifest["icons"].values())
                action_icon_paths = set(manifest["action"]["default_icon"].values())
                self.assertEqual(
                    {
                        "icons/icon-16.png",
                        "icons/icon-32.png",
                        "icons/icon-48.png",
                        "icons/icon-128.png",
                    },
                    icon_paths,
                )
                self.assertTrue(action_icon_paths.issubset(icon_paths))
                for relative_path in icon_paths | {manifest["action"]["default_popup"]}:
                    self.assertTrue((ROOT / "extension" / relative_path).is_file())

    def test_manifests_request_only_integrated_hosts_and_browser_permissions(self) -> None:
        for browser in ("brave", "firefox"):
            with self.subTest(browser=browser):
                manifest = self.load_manifest(browser)
                self.assertEqual(HOST_PERMISSIONS, manifest["host_permissions"])
                expected = {"storage", "activeTab", "scripting", "contextMenus", "alarms"}
                if browser == "brave":
                    expected.add("sidePanel")
                self.assertEqual(expected, set(manifest["permissions"]))
                self.assertEqual(["notifications"], manifest["optional_permissions"])
                self.assertEqual(["https://www.coinarchives.com/*"], manifest["optional_host_permissions"])
                for key in ("content_scripts", "offscreen"):
                    self.assertNotIn(key, manifest)
                self.assertNotIn("tabs", manifest["permissions"])

    def test_manifests_declare_the_context_menu_background(self) -> None:
        self.assertEqual(
            {"service_worker": "background.js", "type": "module"},
            self.load_manifest("brave")["background"],
        )
        self.assertEqual(
            {"scripts": ["background.js"], "type": "module"},
            self.load_manifest("firefox")["background"],
        )

    def test_firefox_preserves_identity_and_declares_transmitted_data(self) -> None:
        gecko = self.load_manifest("firefox")["browser_specific_settings"]["gecko"]
        self.assertRegex(gecko["id"], r"^[^@\s]+@[^@\s]+$")
        self.assertEqual("giga-pinax@local.invalid", gecko["id"])
        self.assertEqual(
            {"searchTerms", "websiteContent"},
            set(gecko["data_collection_permissions"]["required"]),
        )

    def test_manifests_declare_native_research_documents(self) -> None:
        self.assertEqual("popup.html?panel=1", self.load_manifest("brave")["side_panel"]["default_path"])
        self.assertEqual("popup.html?panel=1", self.load_manifest("firefox")["sidebar_action"]["default_panel"])


class AssetCoverageTests(unittest.TestCase):
    def test_the_package_carries_every_file_under_extension(self) -> None:
        present = {path.relative_to(EXTENSION).as_posix() for path in EXTENSION.rglob("*") if path.is_file()}
        packaged = packaged_paths()
        missing = sorted(present - packaged)
        extra = sorted(packaged - present)
        self.assertEqual(
            ([], []),
            (missing, extra),
            f"extension files the build never packages: {missing or 'none'}; "
            f"packaged paths with no file under extension/: {extra or 'none'}",
        )


class PackageBuildTests(unittest.TestCase):
    def run_builder(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(BUILD_SCRIPT), *arguments],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    @staticmethod
    def digest(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_builder_creates_repeatable_allowlisted_directories_and_zips(self) -> None:
        # The real dist/ is the collector's own output; build into a temporary root instead.
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_root = Path(temporary_directory).resolve()
            sentinel = output_root / "keep-me.txt"
            sentinel.write_text("unrelated output", encoding="utf-8")
            build = load_build_script()

            build.build(list(build.BROWSERS), output_root)
            zip_paths = {
                name: output_root / f"giga-pinax-{name}-{VERSION}.zip"
                for name in ("brave", "chrome", "firefox")
            }
            stable_zip_paths = {
                browser: output_root / f"giga-pinax-{browser}.zip"
                for browser in build.BROWSERS
            }
            first_digests = {name: self.digest(path) for name, path in zip_paths.items()}
            self.assertEqual(first_digests["brave"], first_digests["chrome"])
            self.assertEqual(
                {browser: first_digests[browser] for browser in build.BROWSERS},
                {browser: self.digest(path) for browser, path in stable_zip_paths.items()},
            )

            build.build(list(build.BROWSERS), output_root)
            self.assertEqual(first_digests, {name: self.digest(path) for name, path in zip_paths.items()})
            self.assertEqual(
                {browser: first_digests[browser] for browser in build.BROWSERS},
                {browser: self.digest(path) for browser, path in stable_zip_paths.items()},
            )
            self.assertEqual("unrelated output", sentinel.read_text(encoding="utf-8"))

            expected_paths = packaged_paths() | {"manifest.json"}
            for browser in build.BROWSERS:
                with self.subTest(browser=browser):
                    directory = output_root / browser
                    directory_paths = {
                        path.relative_to(directory).as_posix()
                        for path in directory.rglob("*")
                        if path.is_file()
                    }
                    self.assertEqual(expected_paths, directory_paths)

                    with zipfile.ZipFile(zip_paths[browser]) as package:
                        self.assertEqual(expected_paths, set(package.namelist()))
                        packaged_manifest = json.loads(package.read("manifest.json"))
                    source_manifest = json.loads(
                        (MANIFESTS / f"{browser}.json").read_text(encoding="utf-8")
                    )
                    self.assertEqual(source_manifest, packaged_manifest)

            self.assertEqual(
                {"brave", "firefox", "keep-me.txt"}
                | {path.name for path in zip_paths.values()}
                | {path.name for path in stable_zip_paths.values()},
                {path.name for path in output_root.iterdir()},
            )

    def test_builder_refuses_manifests_whose_versions_disagree(self) -> None:
        build = load_build_script()
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_root = Path(temporary_directory).resolve()
            manifests = output_root / "manifests"
            manifests.mkdir()
            for browser, version in (("brave", VERSION), ("firefox", "0.0.1")):
                manifest = json.loads((MANIFESTS / f"{browser}.json").read_text(encoding="utf-8"))
                manifest["version"] = version
                (manifests / f"{browser}.json").write_text(json.dumps(manifest), encoding="utf-8")
            with mock.patch.object(build, "MANIFEST_ROOT", manifests):
                with self.assertRaises(ValueError) as raised:
                    build.build(list(build.BROWSERS), output_root / "dist")
        self.assertIn("version", str(raised.exception).lower())
        self.assertIn("0.0.1", str(raised.exception))

    def test_builder_leaves_the_previous_output_when_a_later_browser_fails(self) -> None:
        build = load_build_script()
        real_stage_browser = build.stage_browser

        def stage_every_browser_but_firefox(stage_root: Path, browser: str):
            if browser == "firefox":
                raise ValueError("staging failed")
            return real_stage_browser(stage_root, browser)

        with tempfile.TemporaryDirectory() as temporary_directory:
            output_root = Path(temporary_directory).resolve()
            build.build(["brave"], output_root)
            # A witness inside the previous dist/brave/: swapping the new Brave in would delete the whole directory,
            # so this file surviving is what tells a staged build apart from one that swaps as each browser finishes.
            witness = output_root / "brave" / "previous-build.marker"
            witness.write_text("the output standing before the failed build", encoding="utf-8")
            before = {path.name: self.digest(path) for path in output_root.glob("*.zip")}

            with mock.patch.object(build, "stage_browser", side_effect=stage_every_browser_but_firefox) as staging:
                with self.assertRaises(ValueError):
                    build.build(list(build.BROWSERS), output_root)
            # Brave really was staged: the guard is about the swap, not about failing before any work happened.
            self.assertEqual(["brave", "firefox"], [call.args[1] for call in staging.call_args_list])

            self.assertTrue(witness.is_file(), "the failed build replaced dist/brave/ before firefox failed")
            self.assertEqual(before, {path.name: self.digest(path) for path in output_root.glob("*.zip")})
            self.assertFalse((output_root / "firefox").exists())
            self.assertEqual([], [path for path in output_root.iterdir() if path.name.startswith(".giga-pinax-build-")])

    def test_builder_clears_release_zips_left_by_an_older_version(self) -> None:
        # `gh release upload dist/giga-pinax-*.zip` would attach a stale package alongside the new ones.
        build = load_build_script()
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_root = Path(temporary_directory).resolve()
            build.build(list(build.BROWSERS), output_root)
            stale = [output_root / f"giga-pinax-{name}-0.0.1.zip" for name in ("brave", "chrome", "firefox")]
            for path in stale:
                path.write_bytes(b"an older release")
            unrelated = output_root / "notes.zip"
            unrelated.write_bytes(b"not a release package")

            build.build(list(build.BROWSERS), output_root)

            self.assertEqual([], [path.name for path in stale if path.exists()])
            self.assertTrue(unrelated.is_file())
            self.assertEqual(
                {f"giga-pinax-{name}-{VERSION}.zip" for name in ("brave", "chrome", "firefox")}
                | {f"giga-pinax-{browser}.zip" for browser in build.BROWSERS},
                {path.name for path in output_root.glob("giga-pinax-*.zip")},
            )

    def test_builder_rejects_unknown_browser_without_changing_outputs(self) -> None:
        before = sorted(path.name for path in DIST.glob("*")) if DIST.is_dir() else None
        result = self.run_builder("safari")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("unsupported browser", result.stderr.lower())
        after = sorted(path.name for path in DIST.glob("*")) if DIST.is_dir() else None
        self.assertEqual(before, after)

    def test_builder_rejects_output_outside_the_project(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            outside = Path(temporary_directory) / "dist"
            result = self.run_builder("--output-dir", str(outside))
            self.assertNotEqual(0, result.returncode)
            self.assertIn("inside the project", result.stderr.lower())
            self.assertFalse(outside.exists())


class ReplaceRetryTests(unittest.TestCase):
    def test_retries_a_transient_access_denied(self) -> None:
        build = load_build_script()
        denied = PermissionError(13, "Access is denied")
        with mock.patch.object(build.os, "replace", side_effect=[denied, None]) as replace, \
                mock.patch.object(build.time, "sleep"):
            build.replace_with_retry(Path("staged.zip"), Path("dist.zip"))
        self.assertEqual(2, replace.call_count)

    def test_gives_up_after_the_last_attempt(self) -> None:
        build = load_build_script()
        denied = PermissionError(13, "Access is denied")
        with mock.patch.object(build.os, "replace", side_effect=denied) as replace, \
                mock.patch.object(build.time, "sleep"):
            with self.assertRaises(PermissionError):
                build.replace_with_retry(Path("staged.zip"), Path("dist.zip"))
        self.assertEqual(5, replace.call_count)


class LocalCataloguePackageTests(unittest.TestCase):
    def test_catalogue_assets_follow_only_validated_manifest_shards(self):
        build = load_build_script()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "data/ocre"
            data.mkdir(parents=True)
            metadata = {"schemaVersion": 1, "corpus": "ocre", "shards": {
                "2_1(2)": [{"file": "records-2_1(2).json", "from": ""}],
                "3": [{"file": "records-3.a.json", "from": ""}, {"file": "records-3.b.json", "from": "ric.3.x.5"}],
            }}
            (data / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
            (data / "unrelated-private.json").write_text("{}", encoding="utf-8")
            with mock.patch.object(build, "EXTENSION_ROOT", root):
                self.assertEqual(
                    ("data/ocre/metadata.json", "data/ocre/index.json", "data/ocre/numbers.json", "data/ocre/NOTICE.txt",
                     "data/ocre/records-2_1(2).json", "data/ocre/records-3.a.json", "data/ocre/records-3.b.json"),
                    build.local_catalogue_assets(),
                )

    def test_catalogue_manifest_rejects_unsafe_or_unsupported_shards(self):
        build = load_build_script()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "data/ocre"
            data.mkdir(parents=True)
            part = [{"file": "records-3.json", "from": ""}]
            cases = [
                {"schemaVersion": 2, "corpus": "ocre", "shards": {"3": part}},
                {"schemaVersion": 1, "corpus": "crro", "shards": {"3": part}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"../secret": [{"file": "records-../secret.json", "from": ""}]}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": [{"file": "../../secret.json", "from": ""}]}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": [{"file": "records-4.json", "from": ""}]}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": ["records-3.json"]},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": "records-3.json"}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": []}},
                # One part is the whole volume and carries no letter; several are lettered in order from the first.
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": [{"file": "records-3.a.json", "from": ""}]}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": [{"file": "records-3.json", "from": ""}, {"file": "records-3.b.json", "from": "ric.3.x.5"}]}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": [{"file": "records-3.a.json", "from": ""}, {"file": "records-3.c.json", "from": "ric.3.x.5"}]}},
                # A part's first id is what a lookup compares against, so the first must have none and the rest must rise.
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": [{"file": "records-3.a.json", "from": "ric.3.x.1"}, {"file": "records-3.b.json", "from": "ric.3.x.5"}]}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": [{"file": "records-3.a.json", "from": ""}, {"file": "records-3.b.json", "from": ""}]}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": [{"file": "records-3.a.json", "from": ""}, {"file": "records-3.b.json"}]}},
                # Past "z" there is no letter left to name a part, and chr() would carry on into punctuation.
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": [
                    {"file": f"records-3.{chr(ord('a') + position)}.json", "from": "" if position == 0 else f"ric.3.x.{position:03d}"}
                    for position in range(27)]}},
            ]
            with mock.patch.object(build, "EXTENSION_ROOT", root):
                for metadata in cases:
                    with self.subTest(metadata=metadata):
                        (data / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
                        with self.assertRaises(ValueError):
                            build.local_catalogue_assets()


if __name__ == "__main__":
    unittest.main()
