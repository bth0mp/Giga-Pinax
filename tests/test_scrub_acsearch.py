import contextlib
import importlib.util
import io
import json
import re
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "scrub_acsearch.py"
FIXTURES = ROOT / "tests" / "fixtures"
# The marker extension/prices.js reads the results array behind; a scrubbed page must still carry it.
MARKER = "acsearch.initSearchResults = "


def load_module():
    spec = importlib.util.spec_from_file_location("giga_pinax_scrub_acsearch", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# A signed-in results page as hostile as it can be made: every kind of thing that names the collector or the session, in every place it could hide.
# Every name, address, token and lot below is invented.
HOSTILE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="csrf-token" content="4f9c2a7e1b3d5f6a8c0e2b4d6f8a0c1e">
<meta http-equiv="refresh" content="600;url=https://tracker.example/refresh">
<title>acsearch.info - Auction research</title>
<link rel="stylesheet" href="https://cdn.example/app.css">
<style>body { background: url(https://tracker.example/bg.png?uid=42); }</style>
<script src="https://www.googletagmanager.com/gtag/js?id=G-TRACK"></script>
<script>var account = { user: "Collector42", email: "collector42@example.org", token: "0123456789abcdef0123456789abcdef" }; document.cookie;</script>
<!-- rendered for collector42, session 9f8e7d6c5b4a39281706f5e4d3c2b1a0 -->
</head>
<body class="body-has-fixed-title" onload="track()">
<nav class="navbar">
  <a class="navbar-brand" href="/">acsearch.info</a>
  <ul class="nav navbar-nav navbar-right">
    <li class="dropdown">
      <a href="#" class="dropdown-toggle">Collector42 <b class="caret"></b></a>
      <ul class="dropdown-menu">
        <li><a href="/account.html?sid=a1b2c3">My account</a></li>
        <li><a href="/logout.html?token=0123456789abcdef0123456789abcdef">Logout</a></li>
      </ul>
    </li>
  </ul>
</nav>
<p class="welcome" title="collector42@example.org">Welcome back, collector42 (<a href="mailto:collector42@example.org">collector42@example.org</a>)</p>
<form action="/search.html" method="get">
  <input type="hidden" name="_token" value="4f9c2a7e1b3d5f6a8c0e2b4d6f8a0c1e">
  <label>Search term</label>
  <input name="term" value="nero 306">
  <select name="currency"><option selected>USD</option></select>
  <textarea name="note">my private note</textarea>
  <button type="submit">Search</button>
</form>
<div id="search-container" data-user="Collector42" data-session="abc" data-page="2">
  <a href="/search.html?term=nero+306&amp;category=1&amp;currency=usd&amp;order=1&amp;PHPSESSID=0123456789abcdef0123&amp;utm_source=mail">Next page</a>
  <a href="https://www.acsearch.info/record.html?id=90010001&amp;sid=deadbeef#comments">Lot 11</a>
  <a href="//acsearch.info/search.html?term=x&amp;language=QUJDREVGR0hJSktMTU5PUFFSU1RVVldY">Base64 token</a>
  <a href="https://media.acsearch.info/search.html;jsessionid=0A1B2C3D4E5F?term=y">Path session</a>
  <a href="https://evil.example/phish?u=1">Elsewhere</a>
  <a href="javascript:steal()">Script link</a>
  <img src="https://pixel.example/p.gif?uid=42" alt="">
  <img src="/media/css/images/track.gif" width="1" height="1" alt="">
  <img src="/media/images/90010001.jpg" alt="Lot 11" onerror="report()">
  <iframe src="https://ads.example/frame"></iframe>
  <script type="text/javascript">
    acsearch.initSearchResults = [{"id": 90010001, "title": "Fabricius Numismatics, Auction 4, Lot 11", "description": "Nero. As. RIC 306. Ex Collector42 collection; write to collector42@example.org. Very Fine. <\/script><b>", "image": "https://cdn.example/lot.jpg", "date": "28.07.2026", "price": "1,200 USD", "last": false, "watch": {"user": "collector42"}, "bidder": "collector42"}, {"id": 90010002, "title": "Aurelia Coins, Web Auction 9, Lot 210", "description": "Nero. As. Zitiert als [RIC I, 306]; Erhaltung: ss-vz.", "date": "19.07.2026", "price": "950 USD", "last": true}, "not a row"];
    acsearch.userEmail = 'collector42@example.org';
  </script>
</div>
</body>
</html>
"""


class ScrubHostilePageTests(unittest.TestCase):
    """One hostile page scrubbed once; each test reads one kind of removal off the result."""

    @classmethod
    def setUpClass(cls):
        cls.module = load_module()
        cls.directory = tempfile.TemporaryDirectory()
        source = Path(cls.directory.name) / "in.html"
        source.write_text(HOSTILE, encoding="utf-8")
        cls.target = Path(cls.directory.name) / "out.html"
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            cls.code = cls.module.main([str(source), str(cls.target), "--account", "collector42"])
        cls.summary, cls.errors = stdout.getvalue(), stderr.getvalue()
        cls.page = cls.target.read_text(encoding="utf-8") if cls.target.exists() else ""

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def rows(self):
        match = re.search(r"<script>" + re.escape(MARKER) + r"(\[.*\]);</script>", self.page, re.S)
        self.assertIsNotNone(match, self.page)
        return json.loads(match.group(1))

    def test_the_page_is_written_and_the_summary_says_what_went(self):
        self.assertEqual(0, self.code, self.errors)
        self.assertTrue(self.target.exists())
        for line in ("<script>", "<form>", "<input>", "<meta>", "comment", "e-mail", "account name", "account block", "tracking", "query parameter",
                     "another host", "watch", "bidder", "image"):
            self.assertIn(line, self.summary)

    def test_the_account_name_and_every_email_address_are_gone(self):
        self.assertNotRegex(self.page, re.compile("collector42", re.I))
        self.assertNotIn("@example.org", self.page)
        self.assertNotIn("mailto:", self.page)

    def test_the_account_block_goes_whole(self):
        self.assertNotIn("Logout", self.page)
        self.assertNotIn("logout.html", self.page)
        self.assertNotIn("My account", self.page)
        self.assertNotIn("navbar", self.page)

    def test_every_script_goes_but_the_results_array_rebuilt(self):
        self.assertEqual(1, len(re.findall(r"<script\b", self.page, re.I)))
        self.assertNotIn("googletagmanager", self.page)
        self.assertNotIn("document.cookie", self.page)
        self.assertNotIn("userEmail", self.page)
        # A description's "</script>" can no longer end the script early: it is written as a JSON escape.
        self.assertEqual(1, self.page.count("</script>"))

    def test_the_rows_keep_the_fields_the_parser_reads_and_nothing_else(self):
        rows = self.rows()
        self.assertEqual(2, len(rows))
        self.assertEqual({"id", "title", "description", "date", "price", "last"}, set(rows[0]))
        self.assertEqual(90010001, rows[0]["id"])
        self.assertEqual("Fabricius Numismatics, Auction 4, Lot 11", rows[0]["title"])
        self.assertEqual("28.07.2026", rows[0]["date"])
        self.assertEqual("1,200 USD", rows[0]["price"])
        self.assertIn("RIC 306.", rows[0]["description"])
        self.assertIn("Very Fine. </script><b>", rows[0]["description"])
        self.assertNotIn("collector42", rows[0]["description"].lower())
        self.assertEqual({"id": 90010002, "title": "Aurelia Coins, Web Auction 9, Lot 210", "description": "Nero. As. Zitiert als [RIC I, 306]; Erhaltung: ss-vz.",
                          "date": "19.07.2026", "price": "950 USD", "last": True}, rows[1])

    def test_forms_are_unwrapped_and_their_fields_go(self):
        for tag in ("form", "input", "select", "option", "textarea", "button"):
            self.assertNotRegex(self.page, re.compile(f"<{tag}\\b", re.I), tag)
        self.assertNotIn("my private note", self.page)
        self.assertIn("Search term", self.page)

    def test_only_the_charset_meta_is_left(self):
        self.assertEqual(['<meta charset="utf-8">'], re.findall(r"<meta\b[^>]*>", self.page, re.I))

    def test_comments_styles_frames_and_links_go(self):
        self.assertNotIn("<!--", self.page)
        for tag in ("style", "link", "iframe"):
            self.assertNotRegex(self.page, re.compile(f"<{tag}\\b", re.I), tag)
        self.assertNotIn("tracker.example", self.page)
        self.assertNotIn("ads.example", self.page)

    def test_session_and_token_attributes_and_event_handlers_go(self):
        self.assertNotIn("data-session", self.page)
        self.assertNotIn("onload", self.page)
        self.assertNotIn("onerror", self.page)
        self.assertNotIn("4f9c2a7e1b3d5f6a8c0e2b4d6f8a0c1e", self.page)
        self.assertIn('data-page="2"', self.page)
        self.assertIn('id="search-container"', self.page)

    def test_acsearch_links_keep_their_path_and_only_public_parameters(self):
        self.assertIn('href="https://www.acsearch.info/search.html?term=nero+306&amp;category=1&amp;currency=usd&amp;order=1"', self.page)
        self.assertIn('href="https://www.acsearch.info/record.html?id=90010001"', self.page)
        self.assertIn('href="https://www.acsearch.info/search.html?term=x"', self.page)
        self.assertIn('href="https://www.acsearch.info/search.html?term=y"', self.page)
        for marker in ("sid=", "PHPSESSID", "utm_source", "jsessionid", "QUJDREVGR0hJSktMTU5PUFFSU1RVVldY", "#comments"):
            self.assertNotIn(marker, self.page)

    def test_other_hosts_scripts_urls_and_tracking_pixels_go(self):
        self.assertNotIn("evil.example", self.page)
        self.assertNotIn("javascript:", self.page)
        self.assertNotIn("pixel.example", self.page)
        self.assertNotIn("track.gif", self.page)
        self.assertIn(">Elsewhere</a>", self.page)
        self.assertIn('<img src="https://www.acsearch.info/media/images/90010001.jpg" alt="Lot 11">', self.page)


class ScrubCommittedFixtureTests(unittest.TestCase):
    """The synthetic pages the suite already reads come through with every row and the login link the signed-out check reads."""

    def scrub(self, name):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "out.html"
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                code = module.main([str(FIXTURES / name), str(target), "--account", "nobody-at-all"])
            return code, target.read_text(encoding="utf-8") if target.exists() else "", stdout.getvalue()

    def test_the_results_page_keeps_every_row_as_the_parser_reads_it(self):
        code, page, _ = self.scrub("acsearch-search-nero-306.html")
        self.assertEqual(0, code)
        source = (FIXTURES / "acsearch-search-nero-306.html").read_text(encoding="utf-8")
        start = source.index(MARKER) + len(MARKER)
        original, _ = json.JSONDecoder().raw_decode(source, start)
        start = page.index(MARKER) + len(MARKER)
        scrubbed, _ = json.JSONDecoder().raw_decode(page, start)
        fields = ("id", "title", "date", "price", "description")
        self.assertEqual([{key: row[key] for key in fields} for row in original], [{key: row[key] for key in fields} for row in scrubbed])
        # extension/prices.js tells a signed-out page by its login link, relative or absolute.
        self.assertRegex(page, r"""<a\b[^>]*\bhref=["'](?:[^"']*/)?login\.html(?:[?#][^"']*)?["']""")

    def test_a_page_without_results_is_written_with_a_warning(self):
        code, page, summary = self.scrub("acsearch-search-no-results.html")
        self.assertEqual(0, code)
        self.assertIn("No results found", page)
        self.assertNotIn(MARKER, page)
        self.assertIn("no results array", summary)


class FailClosedTests(unittest.TestCase):
    def run_script(self, html, *extra):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "in.html"
            source.write_text(html, encoding="utf-8")
            target = Path(directory) / "out.html"
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = module.main([str(source), str(target), *extra])
            return code, target.exists(), stderr.getvalue()

    def results_page(self, description):
        rows = json.dumps([{"id": 1, "title": "A, Auction 1, Lot 1", "description": description, "date": "01.01.2026", "price": "100 USD"}])
        return f"<html><body><script>{MARKER}{rows};</script></body></html>"

    def test_a_logout_block_the_scrubber_cannot_place_fails_and_writes_nothing(self):
        for word in ("Logout", "Abmelden", "Log out", "Sign out"):
            with self.subTest(word=word):
                code, written, errors = self.run_script(f"<html><body><span>Signed in. {word}</span></body></html>", "--account", "collector42")
                self.assertEqual(1, code)
                self.assertFalse(written)
                self.assertIn("account block", errors)

    def test_a_session_parameter_left_in_text_fails_and_writes_nothing(self):
        for text in ("see /record.html?sid=12345", "token=abc", "PHPSESSID 0a1b"):
            with self.subTest(text=text):
                code, written, errors = self.run_script(self.results_page(text), "--account", "collector42")
                self.assertEqual(1, code)
                self.assertFalse(written)
                self.assertIn("session", errors)

    def test_an_existing_output_file_is_left_as_it_was(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "in.html"
            source.write_text("<p>Abmelden</p>", encoding="utf-8")
            target = Path(directory) / "out.html"
            target.write_text("earlier", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(1, module.main([str(source), str(target), "--account", "collector42"]))
            self.assertEqual("earlier", target.read_text(encoding="utf-8"))

    def test_the_account_name_is_required_and_must_be_long_enough_to_find(self):
        code, written, errors = self.run_script("<p>page</p>")
        self.assertEqual(2, code)
        self.assertFalse(written)
        code, written, errors = self.run_script("<p>page</p>", "--account", "ab")
        self.assertEqual(2, code)
        self.assertFalse(written)

    def test_the_input_is_never_overwritten(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "in.html"
            source.write_text("<p>page</p>", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(2, module.main([str(source), str(source), "--account", "collector42"]))
            self.assertEqual("<p>page</p>", source.read_text(encoding="utf-8"))

    def test_the_denylist_names_each_marker_it_finds(self):
        survivors = load_module().survivors
        self.assertEqual([], survivors('<meta charset="utf-8"><p>Nero. RIC 306.</p><a href="https://www.acsearch.info/search.html?term=x">x</a>', ["collector42"]))
        cases = {
            "<p>write to someone@example.org</p>": "e-mail",
            "<p>Hello Collector42</p>": "account name",
            '<a href="/logout.html">x</a>': "account block",
            "<p>?session=1</p>": "session",
            "<p>csrf</p>": "session",
            "<script>var x = 1;</script>": "<script>",
            '<meta name="viewport" content="width=device-width">': "<meta>",
            "<form></form>": "<form>",
            '<input type="hidden">': "<input>",
            "<iframe></iframe>": "<iframe>",
            "<!-- note -->": "comment",
            '<p onclick="x()">p</p>': "event handler",
            '<a href="https://evil.example/">x</a>': "another host",
            '<img src="https://www.acsearch.info/i.gif?language=0123456789abcdef0123">': "token",
            '<a href="javascript:x()">x</a>': "another host",
        }
        for html, marker in cases.items():
            with self.subTest(html=html):
                found = survivors(html, ["collector42"])
                self.assertTrue(any(marker in entry for entry in found), found)


if __name__ == "__main__":
    unittest.main()
