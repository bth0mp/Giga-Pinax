import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SITE_SCRIPT = ROOT / "scripts" / "build_site.py"
FIREFOX_MANIFEST = json.loads((ROOT / "manifests" / "firefox.json").read_text(encoding="utf-8"))
ADDON_ID = FIREFOX_MANIFEST["browser_specific_settings"]["gecko"]["id"]
VERSION = FIREFOX_MANIFEST["version"]


def load_site_script():
    spec = importlib.util.spec_from_file_location("giga_pinax_site", SITE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_xpi(path: Path, manifest: dict) -> bytes:
    with zipfile.ZipFile(path, "w") as package:
        package.writestr("manifest.json", json.dumps(manifest))
        package.writestr("META-INF/mozilla.rsa", b"signature")
    return path.read_bytes()


class FirefoxUpdateManifestTests(unittest.TestCase):
    def test_the_manifest_points_firefox_at_the_update_file_the_site_publishes(self):
        site = load_site_script()
        gecko = FIREFOX_MANIFEST["browser_specific_settings"]["gecko"]
        self.assertEqual("https://bth0mp.github.io/Giga-Pinax/firefox/updates.json", gecko["update_url"])
        self.assertEqual(gecko["update_url"], site.SITE_URL + site.UPDATES_PATH)
        # The id is what every signed version and every update is keyed by: it can never change after the first signing.
        self.assertEqual("giga-pinax@local.invalid", gecko["id"])

    def test_one_signed_version_is_offered_from_its_release_asset_with_its_hash(self):
        site = load_site_script()
        digest = "ab" * 32
        self.assertEqual(
            {"addons": {ADDON_ID: {"updates": [{
                "version": "0.34.0",
                "update_link": "https://github.com/bth0mp/Giga-Pinax/releases/download/v0.34.0/giga-pinax-firefox-0.34.0.xpi",
                "update_hash": f"sha256:{digest}",
            }]}}},
            site.update_manifest("0.34.0", digest),
        )
        self.assertEqual({"addons": {ADDON_ID: {"updates": []}}}, site.empty_update_manifest())

    def test_a_version_or_hash_that_is_not_one_is_refused(self):
        site = load_site_script()
        for version, digest in (("0.34", "ab" * 32), ("v0.34.0", "ab" * 32), ("0.34.0/../x", "ab" * 32),
                                ("0.34.0", "ab" * 31), ("0.34.0", "AB" * 32), ("0.34.0", "zz" * 32)):
            with self.subTest(version=version, digest=digest), self.assertRaises(ValueError):
                site.update_manifest(version, digest)

    def test_the_check_accepts_only_what_this_project_would_publish(self):
        site = load_site_script()
        good = site.update_manifest("0.34.0", "ab" * 32)
        self.assertEqual(good, site.check_update_manifest(json.loads(json.dumps(good))))
        self.assertEqual(site.empty_update_manifest(), site.check_update_manifest(site.empty_update_manifest()))
        entry = good["addons"][ADDON_ID]["updates"][0]
        bad = [
            [],
            {"addons": {}},
            {"addons": {"someone-else@example.com": {"updates": [entry]}}},
            {"addons": {ADDON_ID: {"updates": [entry]}, "someone-else@example.com": {"updates": []}}},
            {"addons": {ADDON_ID: {"updates": [{**entry, "update_link": entry["update_link"].replace("https:", "http:")}]}}},
            {"addons": {ADDON_ID: {"updates": [{**entry, "update_link": "https://example.com/giga-pinax-firefox-0.34.0.xpi"}]}}},
            # The link must name the release of the version it offers, or Firefox would install another build under it.
            {"addons": {ADDON_ID: {"updates": [{**entry, "version": "0.35.0"}]}}},
            {"addons": {ADDON_ID: {"updates": [{key: value for key, value in entry.items() if key != "update_hash"}]}}},
            {"addons": {ADDON_ID: {"updates": [{**entry, "update_hash": "sha1:" + "ab" * 20}]}}},
            {"addons": {ADDON_ID: {"updates": [{**entry, "update_info_url": "https://example.com"}]}}},
            {"addons": {ADDON_ID: {"updates": [entry], "extra": True}}},
        ]
        for document in bad:
            with self.subTest(document=document), self.assertRaises(ValueError):
                site.check_update_manifest(document)

    def run_script(self, *arguments: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(SITE_SCRIPT), *arguments], cwd=ROOT, capture_output=True, text=True)

    def test_the_command_hashes_the_signed_package_it_is_given(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            xpi = root / f"giga-pinax-firefox-{VERSION}.xpi"
            payload = fake_xpi(xpi, FIREFOX_MANIFEST)
            output = root / "firefox-updates.json"
            result = self.run_script("update-manifest", "--xpi", str(xpi), "--output", str(output))
            self.assertEqual(0, result.returncode, result.stderr)
            written = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(load_site_script().update_manifest(VERSION, hashlib.sha256(payload).hexdigest()), written)

    def test_the_command_refuses_a_package_that_is_not_this_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gecko = FIREFOX_MANIFEST["browser_specific_settings"]["gecko"]
            for label, manifest in (
                ("another version", {**FIREFOX_MANIFEST, "version": "0.0.1"}),
                ("another id", {**FIREFOX_MANIFEST, "browser_specific_settings": {"gecko": {**gecko, "id": "x@example.com"}}}),
                ("no update URL", {**FIREFOX_MANIFEST, "browser_specific_settings": {"gecko": {k: v for k, v in gecko.items() if k != "update_url"}}}),
            ):
                with self.subTest(label):
                    xpi = root / f"giga-pinax-firefox-{VERSION}.xpi"
                    fake_xpi(xpi, manifest)
                    output = root / "firefox-updates.json"
                    result = self.run_script("update-manifest", "--xpi", str(xpi), "--output", str(output))
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
