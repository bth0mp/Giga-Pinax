#!/usr/bin/env python3
"""Scrub an acsearch.info results page saved from a signed-in session, so it can be committed as a test fixture.

    python scripts/scrub_acsearch.py IN.html OUT.html --account NAME [--account EMAIL ...]

Kept: the page's element structure and text, and the results array (acsearch.initSearchResults) the extension reads, rebuilt with only the fields
of a lot: id, title, description, date, price and last. Removed: every <script> (the results array is written back as one plain script of its
own), <style>, <form> (its children stay, its fields go), <input>, <select>, <textarea>, <button>, frames and embedded objects, every <meta> but
the charset, comments, the account block around a Logout/Abmelden link, links to the collector's own area (watchlist, favourites), every attribute
off a short list (style and data-* included), event handlers, session and token attributes, tracking pixels, links and images on any host but
acsearch.info or whose path holds a token or the account, and every URL query parameter but a public few. Each --account value (as a whole word)
and every e-mail address is replaced wherever it stands, the results' own text included, after invisible characters are taken out.

The finished page is then searched for a denylist of markers (an e-mail address, an account name, a Logout block, a session or token parameter,
the collector's own bid or watchlist, a token or data: URL in the text, a script, a form field, a comment, a link off acsearch.info...), in the
markup and again in its text with the tags taken out, entities read, compatibility forms folded and invisible characters dropped, so a name split
by <b> or <wbr> is still found. If any survives, or anything goes wrong, the script exits 1 and writes nothing. Standard library only; it reads
one local file and writes another, and never touches the network.
"""

from __future__ import annotations

import argparse
from collections import Counter
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata
from urllib.parse import parse_qsl, unquote, urlencode, urljoin, urlsplit


ORIGIN = "https://www.acsearch.info"
# The same marker extension/prices.js reads the results array behind.
MARKER = "acsearch.initSearchResults = "
# What extractLots reads from a lot (id, title, description, date, price), and the page's own end-of-list flag. Anything else a signed-in row
# carries (a watch state, the collector's own bid) is dropped and named in the summary; add a field here only once it is known to be public.
ROW_FIELDS = ("id", "title", "description", "date", "price", "last")
# The query parameters kept on an acsearch link: term, category, currency and order are exactly what buildSearchUrl sends, language is the page's
# own language switch, page is paging through results and id names a public lot record. Every other parameter goes.
PUBLIC_PARAMS = frozenset({"term", "category", "currency", "order", "language", "page", "id"})
ACCOUNT_PLACEHOLDER = "[collector]"
EMAIL_PLACEHOLDER = "[e-mail removed]"
MIN_ACCOUNT = 3

VOID = frozenset({"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "keygen"})
# Elements dropped with everything inside them. <script> is handled on its own (the results array is rebuilt from it) and <meta> keeps the charset.
DROPPED = frozenset({
    "style", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet", "param", "link", "base", "input", "select",
    "option", "optgroup", "datalist", "textarea", "button", "keygen", "output", "audio", "video", "source", "track", "canvas", "svg", "math", "map",
    "area", "portal",
})
# An element whose opening closes the same kind left open before it, as a browser does ("<li>a<li>b").
AUTO_CLOSE = {"li": {"li"}, "p": {"p"}, "tr": {"tr", "td", "th"}, "td": {"td", "th"}, "th": {"td", "th"}, "dt": {"dt", "dd"}, "dd": {"dt", "dd"}}
# Nothing the extension reads is in an attribute (extractLots reads the results array alone), so only these stay, aria-* besides. A data-* or a
# style attribute is the likeliest place for a per-user number or a tracking URL; allow one here by name only once it is known to be public.
ATTRIBUTES = frozenset({"class", "id", "title", "alt", "lang", "dir", "colspan", "rowspan", "width", "height", "align", "valign", "role", "scope",
                        "type", "target", "rel", "datetime", "href", "src"})

# An address with an accented domain or a percent-encoded or fullwidth at sign counts too.
EMAIL = re.compile(r"[\w.%+-]+(?:@|%40|\uff20)[\w-]+(?:\.[\w-]+)*\.[^\W\d_]{2,}")
# Characters that render as nothing (zero-width space and joiners, word joiner, soft hyphen, BOM...), which can hide a name from a plain search.
INVISIBLE = re.compile("[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufe00-\ufe0f\ufeff]")
# A run of 20+ base64 characters standing alone in text. It is a token (an id, hex, base64, a JWT segment, a UUID) when a piece of it between
# hyphens or underscores, of 6 or more characters, mixes letters and digits; "Numismatik-Naumann-Auktion-64-Los-123" is a dealer's reference.
TEXT_RUN = re.compile(r"(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{20,}(?![A-Za-z0-9+/=_-])")
MIXED = re.compile(r"(?=[^\d]*\d)(?=[^A-Za-z]*[A-Za-z])")
DATA_URL = re.compile(r"\bdata:[\w.+-]*/?[\w.+-]*[;,]", re.I)
# The collector's own bid, bidder number or watchlist: never public text on a results page. English and German, as acsearch is.
OWN_BID = re.compile(
    r"\b(?:your|my)\s+(?:(?:current|highest|max(?:imum)?)\s+)?bids?\b|\b(?:ihr|mein)e?s?\s+(?:aktuelles\s+)?(?:höchst|maximal)?gebote?\b"
    r"|\bhighest\s+bidder\b|\bbidder\s*(?:no|nr|number|id)\b|\bbieter[\s-]*(?:nummer|nr)\b"
    r"|\bkundennummer\b|\bkunden[\s-]*nr\b|\bcustomer\s*(?:no|nr|number|id)\b"
    r"|\bwatch[\s-]?list\b|\bmerkliste\b|\bbeobachtungsliste\b",
    re.I,
)
# A link to the collector's own area of the site, which a signed-in page carries in its menus: removed whole, as the account block is. The words
# anywhere else (a count, a row) are still refused by OWN_BID.
OWN_AREA = re.compile(r"watch[\s_-]?list|merkliste|beobachtungsliste|favou?rites?|my[\s_-]*acsearch", re.I)
# A value of 20 or more hex or base64 characters: a session id, a token or a signed hash.
TOKEN = re.compile(r"[A-Za-z0-9+/=_-]{20,}")
# In an attribute other than a URL, where a class list holds long hyphenated words ("body-has-fixed-title"), a token is such a run with a digit
# and a letter in it.
ATTRIBUTE_TOKEN = re.compile(r"(?=[A-Za-z0-9+/=_-]*\d)(?=[A-Za-z0-9+/=_-]*[A-Za-z])[A-Za-z0-9+/=_-]{20,}")
SESSION_WORDS = re.compile(r"sid|sessid|session|token|csrf|xsrf|auth|cookie", re.I)
SESSION_MARKERS = re.compile(
    r"(?<![A-Za-z0-9_])(?:sid|sessid|phpsessid|jsessionid|session|session_?id|_?token|access_token|auth_?token|csrf(?:_?token)?|xsrf(?:_?token)?)\s*="
    r"|phpsessid|jsessionid|csrf|xsrf|document\.cookie|set-cookie",
    re.I,
)
LOGOUT = re.compile(r"\b(?:log[\s_-]?out|log[\s_-]?off|sign[\s_-]?out|abmelden|ausloggen)\b", re.I)
NAVIGATION = re.compile(r"navbar", re.I)
FORBIDDEN_TAGS = ("form", "input", "select", "option", "textarea", "button", "iframe", "frame", "object", "embed", "link", "base", "style",
                  "noscript", "template", "svg")


class Element:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag: str, attrs: list[tuple[str, str | None]], parent: "Element | None"):
        self.tag, self.attrs, self.children, self.parent = tag, attrs, [], parent

    def attr(self, name: str) -> str:
        return next((value or "" for key, value in self.attrs if key == name), "")

    def text(self) -> str:
        parts, stack = [], [self]
        while stack:
            node = stack.pop()
            if isinstance(node, str):
                parts.append(node)
            else:
                stack.extend(reversed(node.children))
        return " ".join(" ".join(parts).split())


class TreeBuilder(HTMLParser):
    """A plain element tree from html.parser, closing what a browser would close; comments and processing instructions are never kept."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element("#root", [], None)
        self.current = self.root
        self.doctype = False
        self.comments = 0

    def handle_starttag(self, tag, attrs):
        while self.current.tag in AUTO_CLOSE.get(tag, ()):
            self.current = self.current.parent
        element = Element(tag, attrs, self.current)
        self.current.children.append(element)
        if tag not in VOID:
            self.current = element

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.current = self.current.parent

    def handle_endtag(self, tag):
        node = self.current
        while node is not self.root and node.tag != tag:
            node = node.parent
        if node is not self.root:
            self.current = node.parent

    def handle_data(self, data):
        self.current.children.append(data)

    def handle_decl(self, decl):
        self.doctype = self.doctype or decl.lower().startswith("doctype")

    def handle_comment(self, data):
        self.comments += 1

    def unknown_decl(self, data):
        self.comments += 1


class ScrubError(Exception):
    """A page the scrubber refuses to go on with; the message is the one line the collector sees."""


# The account name as a whole word, whatever its case: "Otho" is not replaced inside "Othonian". Not next to a letter or digit; an underscore or
# any punctuation ends it.
def account_pattern(name: str) -> re.Pattern:
    return re.compile(r"(?<![^\W_])" + re.escape(name) + r"(?![^\W_])", re.I)


class Scrubber:
    def __init__(self, accounts: list[str]):
        self.accounts = [account_pattern(name) for name in accounts]
        self.removed: Counter[str] = Counter()
        self.dropped_fields: Counter[str] = Counter()
        self.account_text: list[str] = []
        self.results_arrays = 0
        self.in_rows = 0

    def text(self, value: str, row: bool = False) -> str:
        value, count = INVISIBLE.subn("", value)
        self.removed["invisible characters removed"] += count
        value, count = EMAIL.subn(EMAIL_PLACEHOLDER, value)
        self.removed["e-mail addresses replaced"] += count
        for pattern in self.accounts:
            value, count = pattern.subn(ACCOUNT_PLACEHOLDER, value)
            self.removed["account name mentions replaced"] += count
            self.in_rows += count if row else 0
        return value

    def names_account(self, value: str) -> bool:
        value = INVISIBLE.sub("", value)
        return bool(EMAIL.search(value)) or any(pattern.search(value) for pattern in self.accounts)

    # A link on acsearch.info, as the acsearch origin and its path, with only the public parameters whose values hold no token; None for any
    # other host or scheme. A path's ";jsessionid=..." and the fragment go too.
    def url(self, value: str) -> str | None:
        value = value.strip()
        if value.startswith("#"):
            return "#"
        try:
            parts = urlsplit(urljoin(ORIGIN + "/", value))
            host = (parts.hostname or "").lower()
        except ValueError:
            return None
        if parts.scheme not in ("http", "https") or not (host == "acsearch.info" or host.endswith(".acsearch.info")):
            return None
        path = parts.path.split(";")[0] or "/"
        # A path is kept as it is written, so one holding a token or the account (as /profile/NAME/ or percent-encoded) loses the link instead.
        if path_token(path) or self.names_account(unquote(path)):
            self.removed["links whose path holds a token or the account removed"] += 1
            return None
        kept = []
        for key, item in parse_qsl(parts.query, keep_blank_values=True):
            if key.lower() in PUBLIC_PARAMS and not TOKEN.search(item) and not self.names_account(item):
                kept.append((key, item))
            else:
                self.removed["URL query parameters removed"] += 1
        if parts.fragment:
            self.removed["URL fragments removed"] += 1
        return ORIGIN + path + (f"?{urlencode(kept)}" if kept else "")

    def attributes(self, element: Element) -> list[tuple[str, str]] | None:
        kept = []
        for key, value in element.attrs:
            value = value or ""
            if key.startswith("on"):
                self.removed["event handler attributes removed"] += 1
            elif key not in ATTRIBUTES and not key.startswith("aria-"):
                self.removed[f"{key} attributes removed"] += 1
            elif SESSION_WORDS.search(key) or (key not in ("href", "src") and (SESSION_MARKERS.search(value) or ATTRIBUTE_TOKEN.search(value))):
                self.removed["session or token attributes removed"] += 1
            elif key in ("href", "src"):
                rewritten = self.url(value)
                if rewritten is None:
                    if element.tag == "img":
                        return None
                    self.removed["links to another host or scheme removed"] += 1
                else:
                    kept.append((key, rewritten))
            elif self.names_account(value):
                self.removed["attributes naming the account removed"] += 1
            else:
                kept.append((key, value))
        return kept

    def results(self, script: str) -> str | None:
        start = script.find(MARKER)
        if start < 0:
            return None
        begin = start + len(MARKER)
        begin += len(script[begin:]) - len(script[begin:].lstrip())
        try:
            rows, _ = json.JSONDecoder(parse_constant=refuse_constant).raw_decode(script, begin)
        except (ValueError, RecursionError) as error:
            raise ScrubError(f"the results array could not be read as JSON ({type(error).__name__}: {str(error)[:120]})") from None
        if not isinstance(rows, list):
            raise ScrubError("the results array is not a list")
        kept = []
        for row in rows:
            if not isinstance(row, dict):
                self.removed["result entries that were not lots removed"] += 1
                continue
            clean = {}
            for key, value in row.items():
                if key in ROW_FIELDS and (value is None or isinstance(value, (str, int, float, bool))):
                    clean[key] = self.text(value, row=True) if isinstance(value, str) else value
                else:
                    self.dropped_fields[key] += 1
            kept.append(clean)
        self.results_arrays += 1
        # "<", ">" and "&" occur in JSON only inside strings; as escapes they can never end the script or open a tag, and JSON.parse reads them back.
        data = json.dumps(kept, ensure_ascii=False, allow_nan=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        return f"<script>{MARKER}{data};</script>"

    # The block a Logout/Abmelden link sits in names the collector beside it: the whole navigation bar when it is in one, else its outermost list
    # item, else its nearest division.
    def account_blocks(self, root: Element) -> set[int]:
        blocks, stack = {}, [root]
        while stack:
            node = stack.pop()
            if isinstance(node, str):
                continue
            stack.extend(node.children)
            if node.tag != "a" or not (LOGOUT.search(node.attr("href")) or LOGOUT.search(node.text())):
                continue
            ancestors, parent = [], node.parent
            while parent is not None and parent.tag not in ("#root", "html", "body", "head"):
                ancestors.append(parent)
                parent = parent.parent
            navigation = [item for item in ancestors if item.tag in ("nav", "header") or NAVIGATION.search(item.attr("class"))]
            items = [item for item in ancestors if item.tag == "li"]
            division = next((item for item in ancestors if item.tag == "div"), None)
            block = navigation[-1] if navigation else items[-1] if items else division or node
            blocks[id(block)] = block
        for block in blocks.values():
            self.account_text.append(block.text()[:120])
        self.removed["account blocks removed"] += len(blocks)
        return set(blocks)

    def emit(self, root: Element, doctype: bool) -> str:
        blocks = self.account_blocks(root)
        out = ["<!DOCTYPE html>\n"] if doctype else []
        stack: list[tuple[object, bool]] = [(child, False) for child in reversed(root.children)]
        while stack:
            node, closing = stack.pop()
            if closing:
                out.append(f"</{node.tag}>")
                continue
            if isinstance(node, str):
                out.append(html.escape(self.text(node), quote=False))
                continue
            tag = node.tag
            if id(node) in blocks:
                continue
            if tag == "script":
                rebuilt = self.results("".join(child for child in node.children if isinstance(child, str)))
                if rebuilt:
                    out.append(rebuilt)
                else:
                    self.removed["<script> elements removed"] += 1
                continue
            if tag == "meta":
                if node.attr("charset"):
                    out.append('<meta charset="utf-8">')
                else:
                    self.removed["<meta> elements removed"] += 1
                continue
            if tag in DROPPED:
                self.removed[f"<{tag}> elements removed"] += 1
                continue
            if tag == "a" and own_area_link(node):
                self.removed["own-area links removed (watchlist, favourites)"] += 1
                continue
            if tag == "form":
                self.removed["<form> elements unwrapped"] += 1
                stack.extend((child, False) for child in reversed(node.children))
                continue
            attributes = self.attributes(node)
            if tag == "img" and (attributes is None or not any(key == "src" for key, _ in attributes)
                                 or any(key in ("width", "height") and value.strip().lower() in ("0", "1", "0px", "1px") for key, value in attributes)):
                self.removed["tracking pixels and images on another host removed"] += 1
                continue
            rendered = "".join(f' {key}="{html.escape(value, quote=True)}"' for key, value in attributes or [])
            out.append(f"<{tag}{rendered}>")
            if tag not in VOID:
                stack.append((node, True))
                stack.extend((child, False) for child in reversed(node.children))
        return "".join(out) + "\n"


# A path segment holding a token, read unquoted: "/s/0123456789abcdef0123456789abcdef/r.html", never "/media/images/90010001.jpg" as a whole.
def path_token(path: str) -> bool:
    return any(ATTRIBUTE_TOKEN.search(segment) for segment in folded(unquote(path)).split("/"))


def refuse_constant(name: str):
    raise ValueError(f"{name} is not JSON")


def folded(text: str) -> str:
    return INVISIBLE.sub("", unicodedata.normalize("NFKC", text))


def own_area_link(node: Element) -> bool:
    try:
        path = unquote(urlsplit(node.attr("href")).path)
    except ValueError:
        path = ""
    return bool(OWN_AREA.fullmatch(node.text()) or OWN_AREA.search(path))


def token_runs(text: str) -> tuple[list[str], list[str]]:
    """The 20+ character runs in text that are tokens, and those that only look like one (a hyphenated reference), for a warning."""
    tokens, lookalikes = [], []
    for run in TEXT_RUN.findall(text):
        if any(len(piece) >= 6 and MIXED.match(piece) for piece in re.split(r"[-_]", run)):
            tokens.append(run)
        elif MIXED.match(run):
            lookalikes.append(run)
    return tokens, lookalikes


# The page's text as a reader sees it, two ways: `joined` takes tags out ("<b>Collec</b>tor42" and "Collector<wbr>42" read whole) and `spaced`
# puts a space for each (so adjacent cells stay words of their own). Entities are read, compatibility forms folded (fullwidth letters) and
# invisible characters dropped; the strings of every results array are added, read as JSON reads them and then as HTML, since a dealer's
# description carries markup and character references too.
def text_views(page: str) -> tuple[str, str]:
    strings = []
    for match in re.finditer(re.escape(MARKER), page):
        try:
            rows, _ = json.JSONDecoder(parse_constant=refuse_constant).raw_decode(page, match.end())
        except (ValueError, RecursionError):
            continue
        stack = [rows]
        while stack:
            item = stack.pop()
            if isinstance(item, str):
                strings.append(item)
            elif isinstance(item, list):
                stack.extend(item)
            elif isinstance(item, dict):
                stack.extend(item.values())

    def view(separator: str) -> str:
        strip = lambda text: re.sub(r"<[^>]*>", separator, text)  # noqa: E731
        return folded("\n".join([html.unescape(strip(page))] + [strip(html.unescape(strip(text))) for text in strings]))

    return view(""), view(" ")


def survivors(page: str, accounts: list[str]) -> list[str]:
    """Every denylisted marker still in a finished page, named; an empty list is a page fit to write."""
    found = []
    joined, spaced = text_views(page)
    if EMAIL.search(page) or EMAIL.search(joined):
        found.append("an e-mail address")
    # The name anywhere, even inside a longer word: a refusal over "Othonian" is the cheap side of missing a name split by a tag.
    lowered = (page.casefold(), joined.casefold())
    names = [(name, folded(name).casefold()) for name in accounts]
    found += [f"the account name {name!r}" for name, key in names if any(key in text for text in lowered)]
    if LOGOUT.search(page) or LOGOUT.search(spaced):
        found.append("a Logout/Abmelden account block")
    if SESSION_MARKERS.search(page) or SESSION_MARKERS.search(spaced):
        found.append("a session or token marker (sid=, session=, token=, csrf, PHPSESSID, a cookie)")
    if OWN_BID.search(spaced):
        found.append(f"the collector's own bid, bidder number or watchlist ({OWN_BID.search(spaced).group(0)!r}); report it so the scrubber learns "
                     "to remove it")
    tokens, _ = token_runs(spaced)
    if tokens:
        found.append(f"a token in the text: {tokens[0][:40]}")
    if DATA_URL.search(spaced) or DATA_URL.search(page):
        found.append("a data: URL")
    for tag in re.findall(r"<script\b[^>]*>", page, re.I):
        if tag != "<script>":
            found.append("a <script> other than the results array")
    for match in re.finditer(r"<script>", page):
        if not page.startswith(MARKER, match.end()):
            found.append("a <script> other than the results array")
    if any(tag != '<meta charset="utf-8">' for tag in re.findall(r"<meta\b[^>]*>", page, re.I)):
        found.append("a <meta> other than the charset")
    found += [f"a <{tag}> element" for tag in FORBIDDEN_TAGS if re.search(f"<{tag}\\b", page, re.I)]
    if "<!--" in page:
        found.append("a comment")
    if re.search(r"<[a-z][^>]*\son[a-z]+\s*=", page, re.I):
        found.append("an event handler attribute")
    if re.search(r"<[a-z][^>]*\sstyle\s*=", page, re.I):
        found.append("a style attribute")
    if re.search(r"<[a-z][^>]*\sdata-[^\s=>]*\s*=", page, re.I):
        found.append("a data-* attribute")
    for value in re.findall(r"""\b(?:href|src)\s*=\s*["']([^"']*)["']""", page, re.I):
        value = html.unescape(value)
        if value != "#" and not value.startswith(ORIGIN + "/"):
            found.append(f"a link to another host or scheme: {value[:80]}")
            continue
        parts = urlsplit(value)
        if path_token(parts.path):
            found.append(f"a token in a URL path: {value[:80]}")
        if any(TOKEN.search(item) for _, item in parse_qsl(parts.query, keep_blank_values=True)):
            found.append(f"a token in a URL query: {value[:80]}")
        decoded = folded(unquote(value))
        found += [f"the account name {name!r} in a URL" for name, key in names if key in decoded.casefold()]
        if EMAIL.search(decoded):
            found.append("an e-mail address in a URL")
    return list(dict.fromkeys(found))


def scrub(source: str, accounts: list[str]) -> tuple[str, Scrubber, int]:
    builder = TreeBuilder()
    builder.feed(source)
    builder.close()
    scrubber = Scrubber(accounts)
    page = scrubber.emit(builder.root, builder.doctype)
    return page, scrubber, builder.comments


# Written beside the target and moved into place whole, so a failure part-way leaves no half-written page and an earlier one as it was.
def write(target: Path, page: str) -> None:
    handle, temporary = tempfile.mkstemp(prefix=".scrub-", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(page)
        os.replace(temporary, target)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scrub a saved signed-in acsearch.info results page for use as a test fixture.")
    parser.add_argument("source", type=Path, help="the page as saved from the browser (HTML only)")
    parser.add_argument("target", type=Path, help="where to write the scrubbed page; nothing is written if any marker survives")
    parser.add_argument("--account", action="append", default=[], metavar="NAME",
                        help="your acsearch user name or e-mail address, as the page shows it; repeat for each (required)")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exit:
        return int(exit.code or 0)
    accounts = [name.strip() for name in args.account if name.strip()]
    if not accounts:
        print("scrub_acsearch: give --account with the user name the page shows when signed in, so it can be removed and checked for.", file=sys.stderr)
        return 2
    if any(len(name) < MIN_ACCOUNT for name in accounts):
        print(f"scrub_acsearch: an --account value shorter than {MIN_ACCOUNT} characters would match ordinary text.", file=sys.stderr)
        return 2
    if args.source.resolve() == args.target.resolve():
        print("scrub_acsearch: the output must be another file; the saved page is never overwritten.", file=sys.stderr)
        return 2
    try:
        source = args.source.read_bytes().decode("utf-8", errors="replace")
    except OSError as error:
        print(f"scrub_acsearch: cannot read {args.source}: {error}", file=sys.stderr)
        return 2

    try:
        page, scrubber, comments = scrub(source, accounts)
    except ScrubError as error:
        print(f"scrub_acsearch: refusing to write {args.target}: {error}", file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001 - any failure is one line and no output, never a half-scrubbed page
        print(f"scrub_acsearch: refusing to write {args.target}: {type(error).__name__}: {str(error)[:200]}", file=sys.stderr)
        return 1
    scrubber.removed["comments removed"] += comments
    print(f"Scrubbed {args.source.name}:")
    for reason, count in sorted(scrubber.removed.items()):
        if count:
            print(f"  {count:5}  {reason}")
    for field, count in sorted(scrubber.dropped_fields.items()):
        print(f"  {count:5}  result rows lost their {field!r} field (not one of {', '.join(ROW_FIELDS)})")
    for text in scrubber.account_text:
        print(f"  account block removed: {text!r}")
    if not scrubber.results_arrays:
        print("  warning: no results array (acsearch.initSearchResults) was found; the extension reads nothing from this page.")
    for run in token_runs(text_views(page)[1])[1][:5]:
        print(f"  warning: {run[:60]!r} looks like a token but reads as a hyphenated reference; check it is public text.")
    if scrubber.in_rows:
        print(f"  warning: the account name was replaced {scrubber.in_rows} times in lot text (titles and descriptions); if it is also a word "
              "dealers write, such as a ruler's name, those lots now read [collector] there.")

    found = survivors(page, accounts)
    if found:
        print(f"scrub_acsearch: refusing to write {args.target}; still in the scrubbed page:", file=sys.stderr)
        for entry in found:
            print(f"  - {entry}", file=sys.stderr)
        return 1
    try:
        write(args.target, page)
    except Exception as error:  # noqa: BLE001
        print(f"scrub_acsearch: could not write {args.target}: {type(error).__name__}: {str(error)[:200]}", file=sys.stderr)
        return 1
    print(f"Wrote {args.target}. Read it through before committing it: nothing automatic knows every way a page can name you.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
