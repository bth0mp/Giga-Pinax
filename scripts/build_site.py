#!/usr/bin/env python3
"""The project's public site and Firefox's update manifest.

`update-manifest` writes the update manifest Firefox reads for a signed, self-distributed build: one entry naming the
release's XPI asset and its SHA-256. The release workflow runs it on the XPI Mozilla has just signed.

Only the Python standard library is used."""

from __future__ import annotations

import argparse
import hashlib
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


def parse_args(arguments: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    updates = commands.add_parser("update-manifest", help="write Firefox's update manifest for a signed XPI")
    updates.add_argument("--xpi", type=Path, required=True, help="the XPI Mozilla signed")
    updates.add_argument("--output", type=Path, required=True, help="where to write the update manifest")
    return parser.parse_args(arguments)


def main(arguments: list[str] | None = None) -> int:
    options = parse_args(sys.argv[1:] if arguments is None else arguments)
    try:
        if options.command == "update-manifest":
            write_update_manifest(options.xpi, options.output)
    except (OSError, ValueError, KeyError, AttributeError, zipfile.BadZipFile) as error:
        print(f"build_site: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
