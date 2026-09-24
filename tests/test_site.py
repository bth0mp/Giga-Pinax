import hashlib
import html
import importlib.util
import json
import re
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


def visible_text(html_text: str) -> str:
    """The words a reader sees: tags dropped, entities decoded, whitespace collapsed."""
    body = re.sub(r"<[^>]+>", "", html_text)
    return re.sub(r"\s+", " ", html.unescape(body)).strip()


def markdown_words(markdown: str) -> str:
    """The words of the Markdown subset the policy is written in, with its marks removed."""
    text = re.sub(r"^#{1,3} |^- ", "", markdown, flags=re.M)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = text.replace("**", "").replace("`", "")
    return re.sub(r"\s+", " ", text).strip()


class SiteTests(unittest.TestCase):
    def run_site(self, output: Path, *extra: str) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(SITE_SCRIPT), "site", "--output-dir", str(output), *extra],
                              cwd=ROOT, capture_output=True, text=True)

    def build(self, *extra: str) -> Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name) / "site"
        result = self.run_site(output, *extra)
        self.assertEqual(0, result.returncode, result.stderr)
        return output

    def test_the_site_is_the_index_the_privacy_policy_and_the_update_manifest(self):
        output = self.build()
        self.assertEqual(
            {"index.html", "privacy.html", "style.css", "icon.png", "firefox/updates.json"},
            {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()},
        )
        self.assertEqual((ROOT / "extension/icons/icon-128.png").read_bytes(), (output / "icon.png").read_bytes())
        # No release names a signed XPI to the build, so Firefox is offered nothing rather than an error.
        self.assertEqual(load_site_script().empty_update_manifest(),
                         json.loads((output / "firefox/updates.json").read_text(encoding="utf-8")))

    def test_the_privacy_page_says_what_docs_privacy_says(self):
        output = self.build()
        page = (output / "privacy.html").read_text(encoding="utf-8")
        policy = (ROOT / "docs/PRIVACY.md").read_text(encoding="utf-8")
        self.assertIn(markdown_words(policy), visible_text(page))
        # Every heading, list item and link of the policy is still one on the page.
        self.assertEqual(policy.count("\n## "), page.count("<h2>"))
        self.assertEqual(len([line for line in policy.splitlines() if line.startswith("- ")]), page.count("<li>"))
        self.assertIn('<a href="https://github.com/bth0mp/Giga-Pinax/issues">GitHub Issues</a>', page)
        # The page says which release's policy it is.
        self.assertIn(f"release {VERSION}", visible_text(page))

    def test_no_page_loads_anything_from_anywhere_else(self):
        output = self.build()
        for name in ("index.html", "privacy.html"):
            with self.subTest(page=name):
                page = (output / name).read_text(encoding="utf-8")
                self.assertNotIn("<script", page.lower())
                self.assertNotIn("<iframe", page.lower())
                self.assertIn("default-src 'none'", page)
                for match in re.finditer(r'<(?:link|img)\b[^>]*\b(?:href|src)="([^"]*)"', page):
                    self.assertNotRegex(match.group(1), r"^(?:[a-z]+:|//)", match.group(0))
                for match in re.finditer(r'<a\b[^>]*\bhref="([^"]*)"', page):
                    self.assertRegex(match.group(1), r"^(?:https://|[a-z-]+\.html$)", match.group(0))
        # One link home in the generated page's header, not an icon link and a text link beside it.
        privacy = (output / "privacy.html").read_text(encoding="utf-8")
        header = privacy[privacy.index("<header>"):privacy.index("</header>")]
        self.assertEqual(1, header.count('href="index.html"'))
        self.assertIn('<img src="icon.png" alt="">', header)
        index = (output / "index.html").read_text(encoding="utf-8")
        self.assertIn('href="privacy.html"', index)
        self.assertIn("https://github.com/bth0mp/Giga-Pinax/releases/latest", index)
        self.assertIn("https://github.com/bth0mp/Giga-Pinax/blob/main/CHANGELOG.md", index)
        css = (output / "style.css").read_text(encoding="utf-8")
        self.assertNotRegex(css, r"@import|url\(|@font-face")

    def test_a_signed_release_update_manifest_is_published_as_given(self):
        site = load_site_script()
        with tempfile.TemporaryDirectory() as temporary:
            updates = Path(temporary) / "firefox-updates.json"
            document = site.update_manifest("0.34.0", "cd" * 32)
            updates.write_text(json.dumps(document), encoding="utf-8")
            output = self.build("--updates", str(updates))
        self.assertEqual(document, json.loads((output / "firefox/updates.json").read_text(encoding="utf-8")))

    def test_a_foreign_update_manifest_is_refused_and_nothing_is_written(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            updates = root / "firefox-updates.json"
            updates.write_text(json.dumps({"addons": {"x@example.com": {"updates": []}}}), encoding="utf-8")
            output = root / "site"
            result = self.run_site(output, "--updates", str(updates))
            self.assertNotEqual(0, result.returncode)
            self.assertFalse(output.exists())

    def test_an_output_directory_holding_anything_else_is_left_alone(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "site"
            output.mkdir()
            (output / "keep-me.txt").write_text("somebody else's file", encoding="utf-8")
            result = self.run_site(output)
            self.assertNotEqual(0, result.returncode)
            self.assertEqual(["keep-me.txt"], [path.name for path in output.iterdir()])
        # A site built before is simply built again in place.
        output = self.build()
        result = self.run_site(output)
        self.assertEqual(0, result.returncode, result.stderr)


class PolicyMarkdownTests(unittest.TestCase):
    def test_the_markdown_the_policy_uses_becomes_html(self):
        site = load_site_script()
        self.assertEqual(
            '<h1>Title</h1>\n<p>One <strong>bold</strong> line <code>a &lt; b</code>\nwith a '
            '<a href="https://example.com/x">link text</a>.</p>\n'
            '<ul>\n<li>First <code>x</code></li>\n<li>Second</li>\n</ul>\n<h2>Next</h2>\n',
            site.markdown_to_html("# Title\n\nOne **bold** line `a < b`\nwith a [link text](https://example.com/x).\n\n"
                                  "- First `x`\n- Second\n\n## Next\n"),
        )

    def test_anything_else_is_refused_rather_than_shown_wrong(self):
        site = load_site_script()
        for markdown in (
            "| a | b |\n| - | - |\n",
            "> quoted\n",
            "1. numbered\n",
            "* starred\n",
            "```\ncode\n```\n",
            "<b>raw</b>\n",
            "An *emphasis* mark.\n",
            "An _emphasis_ mark.\n",
            "A [relative link](../CHANGELOG.md).\n",
            "A [script link](javascript:alert(1)).\n",
            "An unclosed `code span.\n",
            "#### A fourth-level heading\n",
            "  - an indented item\n",
            # Shapes that would otherwise come out as something else, not as a refusal.
            "Above\n\n---\n\nBelow\n",
            "Title\n===\n",
            "Title\n---\n",
            "***\n",
            "## Closed heading ##\n",
            "An image ![alt](https://example.com/a.png).\n",
            "Written &amp; escaped.\n",
            "A [link](https://example.com/a(b)) with a bracket.\n",
        ):
            with self.subTest(markdown=markdown), self.assertRaises(ValueError):
                site.markdown_to_html(markdown)


if __name__ == "__main__":
    unittest.main()
