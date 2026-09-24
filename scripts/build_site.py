#!/usr/bin/env python3
"""The project's public site and Firefox's update manifest.

`site` builds the static site into dist/site (or --output-dir): the hand-written site/index.html and site/style.css,
privacy.html generated from docs/PRIVACY.md, the packaged icon, and firefox/updates.json - the latest release's update
manifest when --updates names it, or one that offers nothing. The Pages workflow runs it on the latest release's tag.

`update-manifest` writes the update manifest Firefox reads for a signed, self-distributed build: one entry naming the
release's XPI asset and its SHA-256. The release workflow runs it on the XPI Mozilla has just signed.

Only the Python standard library is used."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_ROOT = PROJECT_ROOT / "manifests"

SITE_URL = "https://bth0mp.github.io/Giga-Pinax/"
UPDATES_PATH = "firefox/updates.json"
RELEASE_DOWNLOAD_URL = "https://github.com/bth0mp/Giga-Pinax/releases/download/"

VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def firefox_manifest() -> dict:
    return json.loads((MANIFEST_ROOT / "firefox.json").read_text(encoding="utf-8"))


def addon_id() -> str:
    # The id every signed version and every update is keyed by. It must never change after the first signing: Firefox
    # would treat a build under another id as a different add-on and never update the installed one to it.
    return firefox_manifest()["browser_specific_settings"]["gecko"]["id"]


def xpi_name(version: str) -> str:
    return f"giga-pinax-firefox-{version}.xpi"


def xpi_url(version: str) -> str:
    return f"{RELEASE_DOWNLOAD_URL}v{version}/{xpi_name(version)}"


def update_manifest(version: str, sha256: str) -> dict:
    """Mozilla's update manifest offering one signed version, from the release asset the release workflow attaches."""
    if not isinstance(version, str) or not VERSION_PATTERN.match(version):
        raise ValueError(f"not a release version: {version!r}")
    if not isinstance(sha256, str) or not SHA256_PATTERN.match(sha256):
        raise ValueError(f"not a lower-case SHA-256: {sha256!r}")
    return {"addons": {addon_id(): {"updates": [{
        "version": version,
        "update_link": xpi_url(version),
        "update_hash": f"sha256:{sha256}",
    }]}}}


def empty_update_manifest() -> dict:
    # Published while no release carries a signed XPI: Firefox reads it as "no update", not as an error.
    return {"addons": {addon_id(): {"updates": []}}}


def check_update_manifest(document: object) -> dict:
    """Accepts only an update manifest this project would write itself: this add-on, and signed XPIs of its own
    releases, each linked from the release of the version it offers."""
    if not isinstance(document, dict) or set(document) != {"addons"}:
        raise ValueError("an update manifest holds exactly one key, addons")
    addons = document["addons"]
    if not isinstance(addons, dict) or set(addons) != {addon_id()}:
        raise ValueError(f"an update manifest names exactly the add-on {addon_id()}")
    entry = addons[addon_id()]
    if not isinstance(entry, dict) or set(entry) != {"updates"} or not isinstance(entry["updates"], list):
        raise ValueError("the add-on's entry holds exactly one key, updates, a list")
    for update in entry["updates"]:
        if not isinstance(update, dict) or set(update) != {"version", "update_link", "update_hash"}:
            raise ValueError(f"an update holds exactly version, update_link and update_hash: {update!r}")
        hash_text = update["update_hash"]
        if not isinstance(hash_text, str) or not hash_text.startswith("sha256:"):
            raise ValueError(f"not a SHA-256 update hash: {hash_text!r}")
        if update_manifest(update["version"], hash_text[len("sha256:"):])["addons"][addon_id()]["updates"][0] != update:
            raise ValueError(f"the update does not link the release of its own version: {update!r}")
    return document


def write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json.dumps(document, indent=2).encode("utf-8") + b"\n")


def write_update_manifest(xpi: Path, output: Path) -> dict:
    """The update manifest for a signed XPI of this checkout's release, refused unless the XPI is that release."""
    payload = xpi.read_bytes()
    with zipfile.ZipFile(xpi) as package:
        packaged = json.loads(package.read("manifest.json"))
    expected = firefox_manifest()
    gecko = packaged.get("browser_specific_settings", {}).get("gecko", {})
    if packaged.get("version") != expected["version"]:
        raise ValueError(f"the XPI carries version {packaged.get('version')!r}, this checkout {expected['version']!r}")
    if gecko.get("id") != addon_id():
        raise ValueError(f"the XPI carries the id {gecko.get('id')!r}, not {addon_id()!r}")
    if gecko.get("update_url") != SITE_URL + UPDATES_PATH:
        raise ValueError(f"the XPI does not name {SITE_URL + UPDATES_PATH} as its update URL")
    document = update_manifest(expected["version"], hashlib.sha256(payload).hexdigest())
    write_json(output, document)
    return document


# The Markdown docs/PRIVACY.md is written in, and nothing more: headings of three levels, paragraphs, flat "- " lists,
# `code`, **bold** and [text](https://...) links. Anything else is refused rather than shown in some other shape, so the
# published policy can only ever say what the document says.
# A rule or a setext underline (---, ===, ***, ___) would come out as paragraph text, so it is refused too.
REFUSED_LINE = re.compile(r"^(?:\s+\S|\||>|\d+[.)]\s|[*+]\s|```|~~~|<|#{4,}|#[^# ]|(?:-{3,}|={3,}|\*{3,}|_{3,})[ \t]*$)")
HEADING = re.compile(r"^(#{1,3}) (\S.*)$")
INLINE = re.compile(r"`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)")
# In plain text: marks of emphasis and code, brackets, raw HTML, an entity (& would be escaped into visible "&amp;") and
# an image (!).
REFUSED_PLAIN = re.compile(r"[`*_\[\]<&!]")


def plain_html(text: str) -> str:
    if REFUSED_PLAIN.search(text):
        raise ValueError(f"unsupported Markdown in {text!r}")
    return html.escape(text, quote=False)


def inline_html(text: str) -> str:
    parts = []
    position = 0
    for match in INLINE.finditer(text):
        parts.append(plain_html(text[position:match.start()]))
        code, bold, label, url = match.groups()
        if code is not None:
            parts.append(f"<code>{html.escape(code, quote=False)}</code>")
        elif bold is not None:
            parts.append(f"<strong>{inline_html(bold)}</strong>")
        else:
            # A relative link would point into the site rather than the repository, and any other scheme is refused.
            if not url.startswith("https://"):
                raise ValueError(f"only https links are published: {url!r}")
            # A bracket in the address ends it early in this reading, and the rest would show as text.
            if "(" in url:
                raise ValueError(f"a link address with a bracket is refused: {url!r}")
            parts.append(f'<a href="{html.escape(url, quote=True)}">{inline_html(label)}</a>')
        position = match.end()
    parts.append(plain_html(text[position:]))
    return "".join(parts)


def markdown_to_html(markdown: str) -> str:
    out = []
    for block in re.split(r"\n[ \t]*\n", markdown.strip("\n")):
        lines = block.split("\n")
        for line in lines:
            if REFUSED_LINE.match(line):
                raise ValueError(f"unsupported Markdown line: {line!r}")
        heading = HEADING.match(lines[0])
        if heading:
            if len(lines) != 1:
                raise ValueError(f"a heading stands alone in its block: {block!r}")
            if heading.group(2).rstrip().endswith("#"):
                raise ValueError(f"a closed heading would keep its trailing marks: {lines[0]!r}")
            level = len(heading.group(1))
            out.append(f"<h{level}>{inline_html(heading.group(2))}</h{level}>")
        elif all(line.startswith("- ") for line in lines):
            out.append("<ul>")
            out.extend(f"<li>{inline_html(line[2:])}</li>" for line in lines)
            out.append("</ul>")
        elif any(line.startswith(("- ", "#")) for line in lines):
            raise ValueError(f"a list or heading mixed into a paragraph: {block!r}")
        else:
            out.append(f"<p>{inline_html(chr(10).join(lines))}</p>")
    return "\n".join(out) + "\n"


SITE_ROOT = PROJECT_ROOT / "site"
PRIVACY_SOURCE = PROJECT_ROOT / "docs" / "PRIVACY.md"
ICON_SOURCE = PROJECT_ROOT / "extension" / "icons" / "icon-128.png"
SITE_FILES = ("index.html", "privacy.html", "style.css", "icon.png", UPDATES_PATH)
PAGE_HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>{title}</title>
<link rel="icon" href="icon.png">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
<a class="home" href="index.html"><img src="icon.png" alt=""><span>Giga Pinax</span></a>
</header>
<main>
"""
PAGE_FOOT = """</main>
<footer>
<p>{note}</p>
</footer>
</body>
</html>
"""


def privacy_page(version: str) -> str:
    body = markdown_to_html(PRIVACY_SOURCE.read_text(encoding="utf-8"))
    source = f"https://github.com/bth0mp/Giga-Pinax/blob/v{html.escape(version)}/docs/PRIVACY.md"
    note = f'This page is <a href="{source}">docs/PRIVACY.md</a> of release {html.escape(version)}, published as it stands.'
    return PAGE_HEAD.format(title="Privacy policy - Giga Pinax") + body + PAGE_FOOT.format(note=note)


def site_contents(updates: Path | None) -> dict[str, bytes]:
    """Every file of the site, built in memory so a refusal writes nothing."""
    if updates is None:
        update_document = empty_update_manifest()
    else:
        update_document = check_update_manifest(json.loads(updates.read_text(encoding="utf-8")))
    return {
        "index.html": (SITE_ROOT / "index.html").read_bytes(),
        "privacy.html": privacy_page(firefox_manifest()["version"]).encode("utf-8"),
        "style.css": (SITE_ROOT / "style.css").read_bytes(),
        "icon.png": ICON_SOURCE.read_bytes(),
        UPDATES_PATH: json.dumps(update_document, indent=2).encode("utf-8") + b"\n",
    }


def write_site(output: Path, updates: Path | None) -> list[Path]:
    contents = site_contents(updates)
    if output.exists():
        # Built again in place, or refused: a directory holding anything this script does not write is not the site's.
        present = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()}
        folders = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_dir()}
        if not present <= set(SITE_FILES) or not folders <= {"firefox"}:
            raise ValueError(f"{output} holds files that are not the site's; choose an empty or new directory")
    written = []
    for name, payload in contents.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        written.append(destination)
    return written


def parse_args(arguments: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    site = commands.add_parser("site", help="build the static site")
    site.add_argument("--output-dir", type=Path, default=PROJECT_ROOT / "dist" / "site", help="default: dist/site")
    site.add_argument("--updates", type=Path, help="the latest release's firefox-updates.json, if it has one")
    updates = commands.add_parser("update-manifest", help="write Firefox's update manifest for a signed XPI")
    updates.add_argument("--xpi", type=Path, required=True, help="the XPI Mozilla signed")
    updates.add_argument("--output", type=Path, required=True, help="where to write the update manifest")
    return parser.parse_args(arguments)


def main(arguments: list[str] | None = None) -> int:
    options = parse_args(sys.argv[1:] if arguments is None else arguments)
    try:
        if options.command == "update-manifest":
            write_update_manifest(options.xpi, options.output)
        elif options.command == "site":
            write_site(options.output_dir, options.updates)
    except (OSError, ValueError, KeyError, AttributeError, zipfile.BadZipFile) as error:
        print(f"build_site: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
