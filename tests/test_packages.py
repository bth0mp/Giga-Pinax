import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = ROOT / "manifests"
BUILD_SCRIPT = ROOT / "scripts" / "build.py"
DIST = ROOT / "dist"

ASSETS = {
    "popup.html",
    "popup.css",
    "popup.js",
    "lookup.js",
    "preferences.js",
    "prices.js",
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
                self.assertEqual("0.8.0", manifest["version"])
                self.assertEqual("popup.html", manifest["action"]["default_popup"])
                self.assertEqual(
                    {"_execute_action": {"suggested_key": {"default": "Alt+Shift+G"}, "description": "Open Giga Pinax"}},
                    manifest["commands"],
                )
                self.assertIn("RIC", manifest["description"])
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

    def test_manifests_request_only_type_data_hosts(self) -> None:
        for browser in ("brave", "firefox"):
            with self.subTest(browser=browser):
                manifest = self.load_manifest(browser)
                self.assertEqual(HOST_PERMISSIONS, manifest["host_permissions"])
                for key in ("permissions", "optional_permissions", "optional_host_permissions", "content_scripts", "background"):
                    self.assertNotIn(key, manifest)

    def test_firefox_declares_identity_and_no_data_collection(self) -> None:
        gecko = self.load_manifest("firefox")["browser_specific_settings"]["gecko"]
        self.assertRegex(gecko["id"], r"^[^@\s]+@[^@\s]+$")
        self.assertEqual("giga-pinax@local.invalid", gecko["id"])
        self.assertEqual(["none"], gecko["data_collection_permissions"]["required"])


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
            browser: DIST / f"giga-pinax-{browser}-0.8.0.zip"
            for browser in ("brave", "firefox")
        }
        first_digests = {browser: self.digest(path) for browser, path in zip_paths.items()}

        second = self.run_builder()
        self.assertEqual(0, second.returncode, second.stderr)
        self.assertEqual(
            first_digests,
            {browser: self.digest(path) for browser, path in zip_paths.items()},
        )
        self.assertEqual("unrelated output", sentinel.read_text(encoding="utf-8"))

        expected_paths = ASSETS | {"manifest.json"}
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


if __name__ == "__main__":
    unittest.main()
