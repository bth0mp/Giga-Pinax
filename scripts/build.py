#!/usr/bin/env python3
"""Build deterministic Brave and Firefox test packages."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = PROJECT_ROOT / "extension"
MANIFEST_ROOT = PROJECT_ROOT / "manifests"
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "dist"

BROWSERS = ("brave", "firefox")
CHROME_TWIN = "brave"  # Chrome loads the Brave package unchanged, so its release asset is a byte-identical copy.
ASSET_PATHS = (
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
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
)
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def parse_args(arguments: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "browsers",
        nargs="*",
        metavar="BROWSER",
        help="browser package(s) to build; defaults to brave and firefox",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="output directory inside the project (default: dist)",
    )
    args = parser.parse_args(arguments)

    selected = args.browsers or list(BROWSERS)
    unknown = sorted(set(selected) - set(BROWSERS))
    if unknown:
        parser.error(f"unsupported browser: {', '.join(unknown)}")
    args.browsers = list(dict.fromkeys(selected))
    return args


def validated_output_root(candidate: Path) -> Path:
    output_root = (PROJECT_ROOT / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
    try:
        output_root.relative_to(DEFAULT_OUTPUT_ROOT)
    except ValueError as error:
        raise ValueError("output directory must be inside the project dist directory") from error
    return output_root


def read_asset(relative_path: str) -> bytes:
    source = EXTENSION_ROOT / relative_path
    if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(EXTENSION_ROOT.resolve()):
        raise ValueError(f"required extension asset is missing or unsafe: extension/{relative_path}")
    return source.read_bytes()


def local_catalogue_assets() -> tuple[str, ...]:
    base = "data/ocre"
    try:
        metadata = json.loads(read_asset(f"{base}/metadata.json"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("cannot read bundled OCRE metadata") from error
    if not isinstance(metadata, dict) or metadata.get("schemaVersion") != 1 or metadata.get("corpus") != "ocre":
        raise ValueError("unsupported bundled OCRE metadata")
    shards = metadata.get("shards")
    if not isinstance(shards, dict) or not shards:
        raise ValueError("bundled OCRE metadata must name its shards")
    for prefix, filename in shards.items():
        if not re.fullmatch(r"[0-9]+(?:_[0-9]+)?(?:\([0-9]+\))?", prefix) or filename != f"records-{prefix}.json":
            raise ValueError("unsafe bundled OCRE shard name")
    return (f"{base}/metadata.json", f"{base}/index.json", f"{base}/NOTICE.txt",
            *(f"{base}/{shards[prefix]}" for prefix in sorted(shards)))


def read_manifest(browser: str) -> tuple[bytes, dict]:
    manifest_path = MANIFEST_ROOT / f"{browser}.json"
    try:
        manifest_bytes = manifest_path.read_bytes()
        return manifest_bytes, json.loads(manifest_bytes)
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read manifests/{browser}.json: {error}") from error


def manifest_version(manifest: dict, browser: str) -> str:
    version = manifest.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError(f"manifests/{browser}.json has no valid version")
    return version


def agreed_version() -> str:
    # One release carries one version: manifests that disagree would ship packages a collector cannot tell apart.
    versions = {browser: manifest_version(read_manifest(browser)[1], browser) for browser in BROWSERS}
    if len(set(versions.values())) > 1:
        listed = ", ".join(f"{browser} {version}" for browser, version in sorted(versions.items()))
        raise ValueError(f"manifest versions disagree: {listed}")
    return versions[BROWSERS[0]]


def load_inputs(browser: str) -> tuple[dict, list[tuple[str, bytes]]]:
    manifest_bytes, manifest = read_manifest(browser)

    inputs = [("manifest.json", manifest_bytes)]
    for relative_path in (*ASSET_PATHS, *local_catalogue_assets()):
        inputs.append((relative_path, read_asset(relative_path)))
    return manifest, inputs


def write_deterministic_zip(destination: Path, inputs: list[tuple[str, bytes]]) -> None:
    with zipfile.ZipFile(destination, "w") as package:
        for archive_path, data in inputs:
            info = zipfile.ZipInfo(archive_path, ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            package.writestr(info, data)


def stage_browser(stage_root: Path, browser: str) -> tuple[Path, Path, str]:
    manifest, inputs = load_inputs(browser)
    version = manifest_version(manifest, browser)

    staged_directory = stage_root / browser
    for archive_path, data in inputs:
        destination = staged_directory / Path(archive_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)

    staged_zip = stage_root / f"giga-pinax-{browser}-{version}.zip"
    write_deterministic_zip(staged_zip, inputs)
    return staged_directory, staged_zip, version


def replace_known_directory(staged: Path, destination: Path, output_root: Path) -> None:
    resolved = destination.resolve()
    if resolved.parent != output_root or destination.name not in BROWSERS:
        raise ValueError(f"refusing to replace unexpected output path: {destination}")
    if destination.exists():
        is_junction = getattr(destination, "is_junction", lambda: False)()
        if destination.is_symlink() or is_junction or not destination.is_dir():
            raise ValueError(f"refusing to replace unsafe output path: {destination}")
        shutil.rmtree(destination)
    shutil.move(str(staged), str(destination))


def replace_with_retry(source: Path, destination: Path, attempts: int = 5) -> None:
    # ponytail: a network drive briefly denies overwriting a just-written zip
    # (WinError 5, ~1 build in 12); retry for up to ~1 s, then give up with the real error.
    for attempt in range(attempts):
        try:
            os.replace(source, destination)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.2)


def build(selected_browsers: list[str], output_root: Path) -> list[Path]:
    agreed_version()
    output_root.mkdir(parents=True, exist_ok=True)
    stage_root = Path(tempfile.mkdtemp(prefix=".giga-pinax-build-", dir=output_root))
    staged: list[tuple[str, Path, Path, str]] = []
    try:
        for browser in selected_browsers:
            staged_directory, staged_zip, version = stage_browser(stage_root, browser)
            staged.append((browser, staged_directory, staged_zip, version))

        results: list[Path] = []
        for browser, staged_directory, staged_zip, version in staged:
            destination_directory = output_root / browser
            destination_zip = output_root / f"giga-pinax-{browser}-{version}.zip"
            # Copies of the same bytes: the stable alias the update buttons resolve, and Chrome's own release asset.
            copies = [(stage_root / f"giga-pinax-{browser}-stable.zip", output_root / f"giga-pinax-{browser}.zip")]
            if browser == CHROME_TWIN:
                chrome_zip = f"giga-pinax-chrome-{version}.zip"
                copies.append((stage_root / chrome_zip, output_root / chrome_zip))
            for staged_copy, _ in copies:
                shutil.copyfile(staged_zip, staged_copy)
            replace_known_directory(staged_directory, destination_directory, output_root)
            replace_with_retry(staged_zip, destination_zip)
            for staged_copy, destination_copy in copies:
                replace_with_retry(staged_copy, destination_copy)
            results.extend((destination_directory, destination_zip, *(destination for _, destination in copies)))
        return results
    finally:
        if stage_root.exists():
            if stage_root.resolve().parent != output_root:
                raise ValueError("refusing to clean up an unexpected staging directory")
            shutil.rmtree(stage_root)


def main(arguments: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if arguments is None else arguments)
    try:
        output_root = validated_output_root(args.output_dir)
        results = build(args.browsers, output_root)
    except (OSError, ValueError) as error:
        print(f"build failed: {error}", file=sys.stderr)
        return 1

    for path in results:
        print(path.relative_to(PROJECT_ROOT).as_posix())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
