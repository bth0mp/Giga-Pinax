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
MANIFESTS = ROOT / "manifests"
BUILD_SCRIPT = ROOT / "scripts" / "build.py"
DIST = ROOT / "dist"

ASSETS = {
    "background.js",
    "bid-tools.css",
    "bid-tools.js",
    "browser-api.js",
    "companion-popup.css",
    "companion-popup.js",
    "companion-preferences.js",
    "core/backup.js",
    "core/evidence.js",
    "core/lot-context.js",
    "core/money.js",
    "core/records.js",
    "core/reminders.js",
    "current-lot.js",
    "design-tokens.css",
    "popup.html",
    "popup.css",
    "popup.js",
    "theme.js",
    "updates.css",
    "updates.js",
    "lookup.js",
    "local-catalogue.js",
    "navigation.js",
    "preferences.js",
    "prices.js",
    "coinarchives-prices.js",
    "catalogues.js",
    "ric-people.js",
    "selection.js",
    "settings.css",
    "settings.html",
    "settings.js",
    "lot.js",
    "sample-data.js",
    "source-launchers.js",
    "source-menu.js",
    "store.js",
    "workspace.css",
    "workspace.html",
    "workspace.js",
    "icon.svg",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
}
HOST_PERMISSIONS = ["https://numismatics.org/*", "https://nomisma.org/*", "https://www.acsearch.info/*"]


class ManifestTests(unittest.TestCase):
    def load_manifest(self, browser: str) -> dict:
        return json.loads((MANIFESTS / f"{browser}.json").read_text(encoding="utf-8"))

    def test_manifests_expose_only_the_popup_and_existing_icons(self) -> None:
        for browser in ("brave", "firefox"):
            with self.subTest(browser=browser):
                manifest = self.load_manifest(browser)
                self.assertEqual(3, manifest["manifest_version"])
                self.assertEqual("Giga Pinax", manifest["name"])
                self.assertEqual("0.31.0", manifest["version"])
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
        sentinel = DIST / "keep-me.txt"
        DIST.mkdir(exist_ok=True)
        sentinel.write_text("unrelated output", encoding="utf-8")

        first = self.run_builder()
        self.assertEqual(0, first.returncode, first.stderr)

        zip_paths = {
            browser: DIST / f"giga-pinax-{browser}-0.31.0.zip"
            for browser in ("brave", "firefox")
        }
        stable_zip_paths = {
            browser: DIST / f"giga-pinax-{browser}.zip"
            for browser in ("brave", "firefox")
        }
        first_digests = {browser: self.digest(path) for browser, path in zip_paths.items()}
        self.assertEqual(
            first_digests,
            {browser: self.digest(path) for browser, path in stable_zip_paths.items()},
        )

        second = self.run_builder()
        self.assertEqual(0, second.returncode, second.stderr)
        self.assertEqual(
            first_digests,
            {browser: self.digest(path) for browser, path in zip_paths.items()},
        )
        self.assertEqual(
            first_digests,
            {browser: self.digest(path) for browser, path in stable_zip_paths.items()},
        )
        self.assertEqual("unrelated output", sentinel.read_text(encoding="utf-8"))

        metadata = json.loads((ROOT / "extension/data/ocre/metadata.json").read_text(encoding="utf-8"))
        data_paths = {"data/ocre/metadata.json", "data/ocre/index.json", "data/ocre/NOTICE.txt"}
        data_paths.update(f"data/ocre/{name}" for name in metadata["shards"].values())
        expected_paths = ASSETS | data_paths | {"manifest.json"}
        for browser, zip_path in zip_paths.items():
            with self.subTest(browser=browser):
                directory_paths = {
                    path.relative_to(DIST / browser).as_posix()
                    for path in (DIST / browser).rglob("*")
                    if path.is_file()
                }
                self.assertEqual(expected_paths, directory_paths)

                with zipfile.ZipFile(zip_path) as package:
                    self.assertEqual(expected_paths, set(package.namelist()))
                    packaged_manifest = json.loads(package.read("manifest.json"))
                source_manifest = json.loads(
                    (MANIFESTS / f"{browser}.json").read_text(encoding="utf-8")
                )
                self.assertEqual(source_manifest, packaged_manifest)

    def test_builder_rejects_unknown_browser_without_changing_outputs(self) -> None:
        before = {
            path.name: self.digest(path)
            for path in DIST.glob("giga-pinax-*.zip")
        }
        result = self.run_builder("safari")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("unsupported browser", result.stderr.lower())
        after = {
            path.name: self.digest(path)
            for path in DIST.glob("giga-pinax-*.zip")
        }
        self.assertEqual(before, after)

    def test_builder_rejects_output_outside_the_project(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            outside = Path(temporary_directory) / "dist"
            result = self.run_builder("--output-dir", str(outside))
            self.assertNotEqual(0, result.returncode)
            self.assertIn("inside the project", result.stderr.lower())
            self.assertFalse(outside.exists())


def load_build_script():
    spec = importlib.util.spec_from_file_location("giga_pinax_build", BUILD_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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
            metadata = {"schemaVersion": 1, "corpus": "ocre", "shards": {"2_1(2)": "records-2_1(2).json", "3": "records-3.json"}}
            (data / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
            (data / "unrelated-private.json").write_text("{}", encoding="utf-8")
            with mock.patch.object(build, "EXTENSION_ROOT", root):
                self.assertEqual(
                    ("data/ocre/metadata.json", "data/ocre/index.json", "data/ocre/NOTICE.txt", "data/ocre/records-2_1(2).json", "data/ocre/records-3.json"),
                    build.local_catalogue_assets(),
                )

    def test_catalogue_manifest_rejects_unsafe_or_unsupported_shards(self):
        build = load_build_script()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = root / "data/ocre"
            data.mkdir(parents=True)
            cases = [
                {"schemaVersion": 2, "corpus": "ocre", "shards": {"3": "records-3.json"}},
                {"schemaVersion": 1, "corpus": "crro", "shards": {"3": "records-3.json"}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"../secret": "records-../secret.json"}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": "../../secret.json"}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": {"3": "records-4.json"}},
                {"schemaVersion": 1, "corpus": "ocre", "shards": ["records-3.json"]},
            ]
            with mock.patch.object(build, "EXTENSION_ROOT", root):
                for metadata in cases:
                    with self.subTest(metadata=metadata):
                        (data / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
                        with self.assertRaises(ValueError):
                            build.local_catalogue_assets()


if __name__ == "__main__":
    unittest.main()
