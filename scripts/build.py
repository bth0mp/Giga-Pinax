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
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXTENSION_ROOT = PROJECT_ROOT / "extension"
MANIFEST_ROOT = PROJECT_ROOT / "manifests"
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "dist"

BROWSERS = ("brave", "firefox")
ASSET_PATHS = (
    "popup.html",
    "popup.css",
    "popup.js",
    "sample-data.js",
    "icon.svg",
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


def load_inputs(browser: str) -> tuple[dict, list[tuple[str, bytes]]]:
    manifest_path = MANIFEST_ROOT / f"{browser}.json"
    try:
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read {manifest_path.relative_to(PROJECT_ROOT)}: {error}") from error

    inputs = [("manifest.json", manifest_bytes)]
    for relative_path in ASSET_PATHS:
        source = EXTENSION_ROOT / relative_path
        if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(EXTENSION_ROOT.resolve()):
            raise ValueError(f"required extension asset is missing or unsafe: extension/{relative_path}")
        inputs.append((relative_path, source.read_bytes()))
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
    version = manifest.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError(f"manifests/{browser}.json has no valid version")

    staged_directory = stage_root / browser
    for archive_path, data in inputs:
        destination = staged_directory / Path(archive_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)

    staged_zip = stage_root / f"coin-lookup-{browser}-{version}.zip"
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


def build(selected_browsers: list[str], output_root: Path) -> list[Path]:
    output_root.mkdir(parents=True, exist_ok=True)
    stage_root = Path(tempfile.mkdtemp(prefix=".coin-lookup-build-", dir=output_root))
    staged: list[tuple[str, Path, Path, str]] = []
    try:
        for browser in selected_browsers:
            staged_directory, staged_zip, version = stage_browser(stage_root, browser)
            staged.append((browser, staged_directory, staged_zip, version))

        results: list[Path] = []
        for browser, staged_directory, staged_zip, version in staged:
            destination_directory = output_root / browser
            destination_zip = output_root / f"coin-lookup-{browser}-{version}.zip"
            replace_known_directory(staged_directory, destination_directory, output_root)
            os.replace(staged_zip, destination_zip)
            results.extend((destination_directory, destination_zip))
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
