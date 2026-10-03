"""Ensure archive metadata changes are tolerated while payload changes fail closed."""

import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "release_artifacts", Path(__file__).with_name("check-artifacts.py")
)
assert spec is not None and spec.loader is not None
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class ArtifactGuards(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def npm(self, name: str, *, content: bytes = b"export {};", stamp: int = 1) -> Path:
        path = self.root / name
        files = {
            "package/package.json": json.dumps({"name": "castrook", "version": "0.4.0"}).encode(),
            "package/dist/index.js": content,
        }
        with tarfile.open(path, "w:gz") as archive:
            for member, data in files.items():
                entry = tarfile.TarInfo(member)
                entry.size = len(data)
                entry.mtime = stamp
                archive.addfile(entry, io.BytesIO(data))
        return path

    def test_archive_timestamps_do_not_change_payload_identity(self) -> None:
        first = checker.inspect(self.npm("one.tgz", stamp=1), "0.4.0")
        second = checker.inspect(self.npm("two.tgz", stamp=2), "0.4.0")
        self.assertNotEqual(first["sha256"], second["sha256"])
        self.assertEqual(first["payload_sha256"], second["payload_sha256"])

    def test_changed_file_changes_payload_identity(self) -> None:
        first = checker.inspect(self.npm("one.tgz"), "0.4.0")
        second = checker.inspect(self.npm("two.tgz", content=b"changed"), "0.4.0")
        self.assertNotEqual(first["payload_sha256"], second["payload_sha256"])

    def test_wrong_version_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "version mismatch"):
            checker.inspect(self.npm("one.tgz"), "0.5.0")

    def test_tar_links_are_rejected(self) -> None:
        path = self.root / "link.tgz"
        with tarfile.open(path, "w:gz") as archive:
            entry = tarfile.TarInfo("package/dist/link")
            entry.type = tarfile.SYMTYPE
            entry.linkname = "outside"
            archive.addfile(entry)
        with self.assertRaisesRegex(ValueError, "link or special"):
            checker.payload(path)

    def test_unsafe_paths_are_rejected_without_extraction(self) -> None:
        path = self.root / "unsafe.whl"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("../outside", b"bad")
        with self.assertRaisesRegex(ValueError, "Unsafe archive"):
            checker.payload(path)
        self.assertFalse((self.root.parent / "outside").exists())

    def test_duplicate_files_are_rejected(self) -> None:
        path = self.npm("duplicate.tgz")
        with tarfile.open(path, "r:gz") as existing:
            members = [(entry, existing.extractfile(entry).read()) for entry in existing]
        with tarfile.open(path, "w:gz") as archive:
            for entry, data in [*members, members[0]]:
                archive.addfile(entry, io.BytesIO(data))
        with self.assertRaisesRegex(ValueError, "Duplicate archive"):
            checker.payload(path)


if __name__ == "__main__":
    unittest.main()
