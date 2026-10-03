"""Compare release payloads with freshly built packages, without extracting archives."""

import hashlib
import json
import sys
import tarfile
import zipfile
from email.parser import BytesParser
from pathlib import Path, PurePosixPath


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def payload(path: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}

    def add(name: str, data: bytes) -> None:
        parts = PurePosixPath(name).parts
        if not parts or name.startswith("/") or ".." in parts or "\\" in name:
            raise ValueError("Unsafe archive path")
        if name in files:
            raise ValueError("Duplicate archive member")
        files[name] = data

    if path.suffix == ".whl":
        with zipfile.ZipFile(path) as archive:
            for entry in archive.infolist():
                if entry.is_dir():
                    continue
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("Archive symlink")
                add(entry.filename, archive.read(entry))
    else:
        with tarfile.open(path, "r:gz") as archive:
            for entry in archive.getmembers():
                if entry.isdir():
                    continue
                if not entry.isfile():
                    raise ValueError("Archive link or special file")
                stream = archive.extractfile(entry)
                if stream is None:
                    raise ValueError("Unreadable archive member")
                add(entry.name, stream.read())
    if not files:
        raise ValueError("Empty package")
    return files


def inspect(path: Path, version: str) -> dict[str, object]:
    files = payload(path)
    if path.suffix == ".tgz":
        if any(
            name not in {"package/package.json", "package/README.md", "package/LICENSE"}
            and not name.startswith("package/dist/")
            for name in files
        ):
            raise ValueError("Unexpected npm package file")
        meta = json.loads(files["package/package.json"])
        if meta["name"] != "castrook" or meta["version"] != version:
            raise ValueError("npm package name/version mismatch")
    else:
        metadata_paths = [
            name for name in files
            if name.endswith((".dist-info/METADATA", "/PKG-INFO"))
        ]
        if len(metadata_paths) != 1:
            raise ValueError("Expected one Python package metadata file")
        meta = BytesParser().parsebytes(files[metadata_paths[0]])
        if meta["Name"] != "castrook" or meta["Version"] != version:
            raise ValueError("Python package name/version mismatch")
    inventory = sorted((name, digest(data)) for name, data in files.items())
    return {
        "name": path.name,
        "bytes": path.stat().st_size,
        "sha256": digest(path.read_bytes()),
        "payload_sha256": digest(json.dumps(inventory, separators=(",", ":")).encode()),
    }


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("Usage: check-artifacts.py VERSION CANDIDATE_DIR FRESH_BUILD_DIR")
    version, candidate, fresh = sys.argv[1:]
    names = [
        f"castrook-{version}.tgz",
        f"castrook-{version}-py3-none-any.whl",
        f"castrook-{version}.tar.gz",
    ]
    records = []
    for name in names:
        record = inspect(Path(candidate) / name, version)
        expected = inspect(Path(fresh) / name, version)
        if record["payload_sha256"] != expected["payload_sha256"]:
            raise ValueError(f"Release payload differs from checked source: {name}")
        records.append(record)
    print(json.dumps(records))


if __name__ == "__main__":
    main()
