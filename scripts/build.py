#!/usr/bin/env python3
"""Build every deterministic release package: unpacked Brave and Firefox directories, the versioned Brave, Chrome
and Firefox zips, and the stable Brave and Firefox aliases."""

from __future__ import annotations

import argparse
import importlib.util
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
CHROME_TWIN_NAME = "chrome"
ASSET_PATHS = (
    "background.js",
    "bid-tools.css",
    "bid-tools.js",
    "browser-api.js",
    "companion-popup.css",
    "companion-popup.js",
    "companion-preferences.js",
    "core/backup.js",
    "core/csv.js",
    "core/diagnostics.js",
    "core/drafts.js",
    "core/evidence.js",
    "core/fields.js",
    "core/lot-context.js",
    "core/money.js",
    "core/projections.js",
    "core/records.js",
    "core/reminders.js",
    "core/types.js",
    "core/validate.js",
    "core/wantlist.js",
    "current-lot.js",
    "design-tokens.css",
    "popup.html",
    "popup.css",
    "popup.js",
    "popup-messages.js",
    "popup-drawing.js",
    "popup-access.js",
    "popup-shell.js",
    "theme.js",
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
    "source-launchers.js",
    "source-menu.js",
    "store.js",
    "store-builders.js",
    "store-restore.js",
    "store-schedule.js",
    "workspace.css",
    "workspace.html",
    "workspace.js",
    "workspace-editing.js",
    "workspace-forms.js",
    "workspace-views.js",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
)
# The two files a package carries at its root: the browser's manifest, and the licence the code is published under.
# A store reviewer and a collector who unzips a package both look at the root for the licence, and nothing under
# extension/ is it, so it is named here rather than being smuggled into the extension asset list.
LICENSE_SOURCE = PROJECT_ROOT / "LICENSE"
PACKAGE_ROOT_FILES = ("manifest.json", "LICENSE.txt")
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


def importer():
    """The importer module itself, so a packaged file is checked against the code that writes it, not a copy of it."""
    global _IMPORTER
    if _IMPORTER is None:
        spec = importlib.util.spec_from_file_location("giga_pinax_import_rdf", PROJECT_ROOT / "scripts" / "import_rdf.py")
        _IMPORTER = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_IMPORTER)
    return _IMPORTER


_IMPORTER = None


# The two files extension/data holds itself rather than inside a corpus directory: the Nomisma labels every corpus
# shares, and the notice that attributes them. Anything else there is still an entry the build refuses to package.
SHARED_DATA_FILES = ("NOTICE.txt", "nomisma-labels.json")


def bundled_corpora() -> tuple[str, ...]:
    """Every corpus directory under extension/data, so the package carries what is checked in and nothing else."""
    root = EXTENSION_ROOT / "data"
    known = importer().CORPORA
    corpora = []
    for path in sorted(root.iterdir()):
        if not path.is_symlink() and path.is_file() and path.name in SHARED_DATA_FILES:
            continue
        if path.is_symlink() or not path.is_dir() or path.name not in known:
            raise ValueError(f"unexpected entry under extension/data: {path.name}")
        corpora.append(path.name)
    if not corpora:
        raise ValueError("extension/data holds no bundled catalogue")
    return tuple(corpora)


def catalogue_assets(corpus: str) -> tuple[str, ...]:
    base = f"data/{corpus}"
    label = importer().CORPORA[corpus]["label"]
    try:
        metadata = json.loads(read_asset(f"{base}/metadata.json"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read bundled {label} metadata") from error
    if not isinstance(metadata, dict) or metadata.get("schemaVersion") != 1 or metadata.get("corpus") != corpus:
        raise ValueError(f"unsupported bundled {label} metadata")
    shards = metadata.get("shards")
    if not isinstance(shards, dict) or not shards:
        raise ValueError(f"bundled {label} metadata must name its shards")
    files = []
    for prefix in sorted(shards):
        parts = shards[prefix]
        if not re.fullmatch(importer().CORPORA[corpus]["groups"], prefix) or not isinstance(parts, list) or not parts:
            raise ValueError(f"unsafe bundled {label} shard name")
        # Past the twenty-sixth part there is no letter left to name one, and chr() would carry on past "z".
        if len(parts) > 26:
            raise ValueError(f"bundled {label} group {prefix} has more parts than there are letters to name them")
        # A group over the file cap is split into lettered parts in id order; one part is the whole group and takes
        # no letter. Every name is derived here, and a part starts where the one before it ended.
        for position, part in enumerate(parts):
            letter = "" if len(parts) == 1 else f".{chr(ord('a') + position)}"
            if not isinstance(part, dict) or part.get("file") != f"records-{prefix}{letter}.json":
                raise ValueError(f"unsafe bundled {label} shard name")
            first = part.get("from")
            if not isinstance(first, str) or (first == "") != (position == 0) or (position and first <= parts[position - 1].get("from")):
                raise ValueError(f"unsafe bundled {label} shard order")
            files.append(f"{base}/{part['file']}")
    # Only a corpus whose lookups need a number index ships one, and the importer's table is what says which.
    indexes = ["index.json"] + (["numbers.json"] if importer().CORPORA[corpus]["numbers"] else [])
    return (f"{base}/metadata.json", *(f"{base}/{name}" for name in indexes), f"{base}/NOTICE.txt", *files)


def local_catalogue_assets() -> tuple[str, ...]:
    corpora = bundled_corpora()
    shared = tuple(f"data/{name}" for name in SHARED_DATA_FILES)
    return shared + tuple(path for corpus in corpora for path in catalogue_assets(corpus))


def check_label_data() -> None:
    """The bundled Nomisma labels must be what the tracked snapshot and the records beside it generate. A label file
    that has drifted from either would put a name on a card that no source published for that concept."""
    snapshot_path = PROJECT_ROOT / "scripts" / "data" / importer().LABEL_FILE
    try:
        snapshot = json.loads(snapshot_path.read_bytes())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read the tracked Nomisma label snapshot: {error}") from error

    def read_corpus(name: str):
        if name not in bundled_corpora():
            return None

        def read(file_name: str, name: str = name) -> object:
            try:
                return json.loads(read_asset(f"data/{name}/{file_name}"))
            except (OSError, json.JSONDecodeError) as error:
                raise ValueError(f"cannot read the bundled {name} data: {error}") from error
        return read

    slugs = importer().bundled_slugs(read_corpus)
    payload = importer().json_bytes(importer().label_payload(snapshot, slugs))
    if read_asset(f"data/{importer().LABEL_FILE}") != payload:
        raise ValueError("the bundled Nomisma labels are stale: rerun python scripts/import_rdf.py --write-labels")


def check_catalogue_data() -> None:
    """An index, a number index or a shard map that no longer matches the records beside it is still a perfectly valid
    file: every position it lists resolves, and the lookup simply never sees what the two disagree about. Nothing at
    runtime can tell the two apart, so every derived file is rebuilt here with the importer's own code and a bundle that
    disagrees is not packaged."""
    for corpus in bundled_corpora():
        base = f"data/{corpus}"
        label = importer().CORPORA[corpus]["label"]

        def read(name: str, base: str = base, label: str = label) -> object:
            try:
                return json.loads(read_asset(f"{base}/{name}"))
            except (OSError, json.JSONDecodeError) as error:
                raise ValueError(f"cannot read the bundled {label} data: {error}") from error

        rebuilt = importer().rebuilt(read)
        for name, payload in rebuilt.items():
            if read_asset(f"{base}/{name}") != payload:
                raise ValueError(f"the bundled {label} data is stale: rerun python scripts/import_rdf.py --reindex extension/{base}")
        packaged = {path.rsplit("/", 1)[1] for path in catalogue_assets(corpus)} - {"NOTICE.txt"}
        if packaged != set(rebuilt):
            raise ValueError(f"the bundled {label} data does not hold the files the importer writes")


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


def check_manifest_versions() -> str:
    # One release carries one version: manifests that disagree would ship packages a collector cannot tell apart.
    versions = {browser: manifest_version(read_manifest(browser)[1], browser) for browser in BROWSERS}
    if len(set(versions.values())) > 1:
        listed = ", ".join(f"{browser} {version}" for browser, version in sorted(versions.items()))
        raise ValueError(f"manifest versions disagree: {listed}")
    return versions[BROWSERS[0]]


def load_inputs(browser: str) -> tuple[dict, list[tuple[str, bytes]]]:
    manifest_bytes, manifest = read_manifest(browser)

    if LICENSE_SOURCE.is_symlink() or not LICENSE_SOURCE.is_file():
        raise ValueError("required package file is missing or unsafe: LICENSE")
    inputs = [("manifest.json", manifest_bytes), ("LICENSE.txt", LICENSE_SOURCE.read_bytes())]
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


def release_zip_names(version: str) -> set[str]:
    return {f"giga-pinax-{name}-{version}.zip" for name in (*BROWSERS, CHROME_TWIN_NAME)} | {
        f"giga-pinax-{browser}.zip" for browser in BROWSERS
    }


def stale_release_zips(output_root: Path, version: str) -> list[Path]:
    # `gh release upload dist/giga-pinax-*.zip` matches by name, so an older version left in dist/ would be
    # attached to the new release beside the right packages. Clear it as part of the swap.
    current = release_zip_names(version)
    return sorted(
        path for path in output_root.glob("giga-pinax-*.zip")
        if path.name not in current and path.is_file() and not path.is_symlink()
    )


def build(selected_browsers: list[str], output_root: Path) -> list[Path]:
    version = check_manifest_versions()
    check_catalogue_data()
    check_label_data()
    output_root.mkdir(parents=True, exist_ok=True)
    stage_root = Path(tempfile.mkdtemp(prefix=".giga-pinax-build-", dir=output_root))
    try:
        # Every output — directories, versioned zips, the Chrome twin and the stable aliases — exists in staging
        # before anything moves, so a failure part-way through can never leave dist/ half old and half new.
        staged: list[tuple[Path, Path]] = []
        for browser in selected_browsers:
            staged_directory, staged_zip, browser_version = stage_browser(stage_root, browser)
            staged.append((staged_directory, output_root / browser))
            staged.append((staged_zip, output_root / staged_zip.name))
            # Copies of the same bytes: the stable alias the update buttons resolve, and Chrome's own release asset.
            copies = [f"giga-pinax-{browser}.zip"]
            if browser == CHROME_TWIN:
                copies.append(f"giga-pinax-{CHROME_TWIN_NAME}-{browser_version}.zip")
            for name in copies:
                staged_copy = stage_root / f"copy-{name}"
                shutil.copyfile(staged_zip, staged_copy)
                staged.append((staged_copy, output_root / name))

        for stale in stale_release_zips(output_root, version):
            stale.unlink()
        for staged_path, destination in staged:
            if staged_path.is_dir():
                replace_known_directory(staged_path, destination, output_root)
            else:
                replace_with_retry(staged_path, destination)
        return [destination for _, destination in staged]
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
