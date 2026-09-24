#!/usr/bin/env python3
"""Scrub an acsearch.info results page saved from a signed-in session, so it can be committed as a test fixture.

    python scripts/scrub_acsearch.py IN.html OUT.html --account NAME [--account EMAIL ...]

Kept: the page's element structure and text, and the results array (acsearch.initSearchResults) the extension reads, rebuilt with only the fields
of a lot: id, title, description, date, price and last. Removed: every <script> (the results array is written back as one plain script of its
own), <style>, <form> (its children stay, its fields go), <input>, <select>, <textarea>, <button>, frames and embedded objects, every <meta>
but the charset, comments, the account block around a Logout/Abmelden link, event handlers, session and token attributes, tracking pixels, links
and images on any host but acsearch.info, and every URL query parameter but a public few. Each --account value and every e-mail address is
replaced wherever it stands, the results' own text included.

The finished page is then searched for a denylist of markers (an e-mail address, an account name, a Logout block, a session or token parameter,
a script, a form field, a comment, a link off acsearch.info...). If any survives, the script exits 1 and writes nothing. Standard library only;
it reads one local file and writes another, and never touches the network.
"""

from __future__ import annotations

import argparse
from collections import Counter
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit


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
ATTRIBUTES = frozenset({"class", "id", "title", "alt", "lang", "dir", "colspan", "rowspan", "width", "height", "align", "valign", "role", "scope",
                        "type", "target", "rel", "datetime", "href", "src", "style"})

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
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


class Scrubber:
    def __init__(self, accounts: list[str]):
        self.accounts = [re.compile(re.escape(name), re.I) for name in accounts]
        self.removed: Counter[str] = Counter()
        self.dropped_fields: Counter[str] = Counter()
        self.account_text: list[str] = []
        self.results_arrays = 0

    def text(self, value: str) -> str:
        value, count = EMAIL.subn(EMAIL_PLACEHOLDER, value)
        self.removed["e-mail addresses replaced"] += count
        for pattern in self.accounts:
            value, count = pattern.subn(ACCOUNT_PLACEHOLDER, value)
            self.removed["account name mentions replaced"] += count
        return value

    def names_account(self, value: str) -> bool:
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
            elif key not in ATTRIBUTES and not key.startswith(("data-", "aria-")):
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
            elif key == "style" and re.search(r"url\s*\(|expression|@import", value, re.I):
                self.removed["style attributes with a URL removed"] += 1
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
            rows, _ = json.JSONDecoder().raw_decode(script, begin)
        except ValueError:
            return None
        if not isinstance(rows, list):
            return None
        kept = []
        for row in rows:
            if not isinstance(row, dict):
                self.removed["result entries that were not lots removed"] += 1
                continue
            clean = {}
            for key, value in row.items():
                if key in ROW_FIELDS and (value is None or isinstance(value, (str, int, float, bool))):
                    clean[key] = self.text(value) if isinstance(value, str) else value
                else:
                    self.dropped_fields[key] += 1
            kept.append(clean)
        self.results_arrays += 1
        # "<", ">" and "&" occur in JSON only inside strings; as escapes they can never end the script or open a tag, and JSON.parse reads them back.
        data = json.dumps(kept, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
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


def survivors(page: str, accounts: list[str]) -> list[str]:
    """Every denylisted marker still in a finished page, named; an empty list is a page fit to write."""
    found = []
    if EMAIL.search(page):
        found.append("an e-mail address")
    lowered = page.lower()
    found += [f"the account name {name!r}" for name in accounts if name.lower() in lowered]
    if LOGOUT.search(page):
        found.append("a Logout/Abmelden account block")
    if SESSION_MARKERS.search(page):
        found.append("a session or token marker (sid=, session=, token=, csrf, PHPSESSID, a cookie)")
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
    for value in re.findall(r"""\b(?:href|src)\s*=\s*["']([^"']*)["']""", page, re.I):
        value = html.unescape(value)
        if value != "#" and not value.startswith(ORIGIN + "/"):
            found.append(f"a link to another host or scheme: {value[:80]}")
        elif any(TOKEN.search(item) for _, item in parse_qsl(urlsplit(value).query, keep_blank_values=True)):
            found.append(f"a token in a URL query: {value[:80]}")
    return list(dict.fromkeys(found))


def scrub(source: str, accounts: list[str]) -> tuple[str, Scrubber, int]:
    builder = TreeBuilder()
    builder.feed(source)
    builder.close()
    scrubber = Scrubber(accounts)
    page = scrubber.emit(builder.root, builder.doctype)
    return page, scrubber, builder.comments


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

    page, scrubber, comments = scrub(source, accounts)
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

    found = survivors(page, accounts)
    if found:
        print(f"scrub_acsearch: refusing to write {args.target}; still in the scrubbed page:", file=sys.stderr)
        for entry in found:
            print(f"  - {entry}", file=sys.stderr)
        return 1
    args.target.write_text(page, encoding="utf-8", newline="\n")
    print(f"Wrote {args.target}. Read it through before committing it: nothing automatic knows every way a page can name you.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
