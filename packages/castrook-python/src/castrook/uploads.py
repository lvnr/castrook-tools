"""Private direct-upload helpers. A storage request never contains API credentials."""

import asyncio
import hashlib
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, cast
from urllib.parse import urlsplit

import httpx

from ._contract import validate_timeout
from .errors import CastrookError
from .types import CreateMediaUploadInput, MediaContentType, MediaUpload

MAX_MEDIA_BYTES = 128 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
UploadSource = bytes | bytearray | memoryview | str | os.PathLike[str] | BinaryIO
_CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
}
_ALLOWED_TYPES = frozenset(_CONTENT_TYPES.values())


def sha256(source: bytes | bytearray | memoryview) -> str:
    """Lowercase SHA-256 digest used by the upload-ticket contract."""
    return hashlib.sha256(source).hexdigest()


def read_source(source: UploadSource) -> tuple[bytes, str | None]:
    if isinstance(source, (bytes, bytearray, memoryview)):
        size = source.nbytes if isinstance(source, memoryview) else len(source)
        if size > MAX_MEDIA_BYTES:
            raise ValueError("Media must contain 1–134217728 bytes.")
        data, filename = bytes(source), None
    elif isinstance(source, (str, os.PathLike)):
        path = Path(source)
        with path.open("rb") as file:
            data, _ = read_source(file)
        filename = path.name
    else:
        # Bound allocation before reading a file. Freeze the bytes once so checksum,
        # ticket and upload cannot diverge if an input file later changes.
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = source.read(min(1024 * 1024, MAX_MEDIA_BYTES + 1 - size))
            if not isinstance(chunk, bytes):
                raise TypeError("Media sources must be binary files or bytes.")
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_MEDIA_BYTES:
                raise ValueError("Media must contain 1–134217728 bytes.")
        data = b"".join(chunks)
        name = getattr(source, "name", None)
        filename = Path(name).name if isinstance(name, str) else None
    if not data or len(data) > MAX_MEDIA_BYTES:
        raise ValueError("Media must contain 1–134217728 bytes.")
    return data, filename


@dataclass(frozen=True)
class PreparedMedia:
    data: bytes
    input: CreateMediaUploadInput


def prepare_media(
    source: UploadSource,
    filename: str | None,
    content_type: MediaContentType | None,
    profile_id: str | None,
) -> PreparedMedia:
    data, inferred_name = read_source(source)
    name = filename if filename is not None else inferred_name
    if not isinstance(name, str) or not name:
        raise ValueError("filename is required for a bytes source.")
    kind = (
        content_type if content_type is not None else _CONTENT_TYPES.get(Path(name).suffix.lower())
    )
    if kind not in _ALLOWED_TYPES:
        raise ValueError("Use a JPEG, PNG, WebP, MP4, MOV or WebM content_type.")
    if kind.startswith("image/") and len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Images must be at most 20 MiB.")
    upload: CreateMediaUploadInput = {
        "filename": name,
        "content_type": cast(MediaContentType, kind),
        "size": len(data),
        "sha256": sha256(data),
    }
    if profile_id is not None:
        upload["profile_id"] = profile_id
    return PreparedMedia(data, upload)


def prepare_direct_request(upload: MediaUpload, data: bytes, timeout: float) -> httpx.Request:
    try:
        url = urlsplit(upload["url"])
        _ = url.port
    except (ValueError, TypeError, KeyError):
        raise ValueError("Use a valid HTTPS direct-upload ticket.") from None
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.fragment
        or upload.get("method") != "PUT"
    ):
        raise ValueError("Use a valid HTTPS direct-upload ticket.")
    if "\\" in upload["url"] or any(ord(char) <= 32 for char in upload["url"]):
        raise ValueError("Use a valid HTTPS direct-upload ticket.")
    try:
        expiry = datetime.fromisoformat(upload["expires_at"].replace("Z", "+00:00"))
        if expiry.tzinfo is None:
            raise ValueError("Unqualified expiry")
    except (ValueError, AttributeError, KeyError):
        raise ValueError("The upload ticket must contain a valid expiry.") from None
    if expiry <= datetime.now(timezone.utc):
        raise CastrookError(
            410, "media_upload_expired", "The upload ticket has expired. Request a new ticket."
        )
    headers = upload.get("headers")
    if not isinstance(headers, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in headers.items()
    ):
        raise ValueError("Use the headers from a Castrook direct-upload ticket.")
    normalized = {key.lower(): value for key, value in headers.items()}
    if len(normalized) != len(headers):
        raise ValueError("A direct-upload ticket must not contain duplicate headers.")
    allowed = {"content-type", "content-length", "x-amz-meta-sha256", "if-none-match"}
    if not normalized.keys() <= allowed:
        raise ValueError(
            "A direct-upload ticket must not contain account credentials or unrelated headers."
        )
    if (
        normalized.get("content-type") not in _ALLOWED_TYPES
        or normalized.get("if-none-match") != "*"
    ):
        raise ValueError("Use an immutable Castrook direct-upload ticket.")
    if not data or len(data) > MAX_MEDIA_BYTES:
        raise ValueError("Media must contain 1–134217728 bytes.")
    if normalized["content-type"].startswith("image/") and len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Images must be at most 20 MiB.")
    if normalized.get("x-amz-meta-sha256") != sha256(data):
        raise ValueError("The upload content does not match the ticket's SHA-256 digest.")
    if "content-length" in normalized and normalized["content-length"] != str(len(data)):
        raise ValueError("The upload content does not match the ticket's size.")
    return httpx.Request(
        "PUT",
        upload["url"],
        headers=headers,
        content=data,
        extensions={"timeout": httpx.Timeout(validate_timeout(timeout)).as_dict()},
    )


def check_upload_response(response: httpx.Response) -> None:
    # An earlier interrupted PUT may have created the immutable staging object.
    # Completion must still verify its exact size/type/digest; 412 alone is no success claim.
    if not response.is_success and response.status_code != 412:
        raise CastrookError(
            response.status_code,
            "media_upload_failed",
            "The file could not be uploaded. Check the upload ticket and try again.",
        )


def interrupted_upload() -> CastrookError:
    return CastrookError(
        0,
        "media_upload_interrupted",
        "The upload could not be confirmed. Complete the pending asset to verify it before starting another upload.",
    )


def upload_to_url(
    upload: MediaUpload,
    source: UploadSource,
    *,
    timeout: float = 120,
    transport: httpx.BaseTransport | None = None,
) -> None:
    """PUT a private ticket without an API key. Then call ``media.complete(asset_id)``.

    Tickets are capabilities: keep them private. This function never follows a
    redirect, adds account cookies or retries an ambiguous PUT.
    """
    data, _ = read_source(source)
    request = prepare_direct_request(upload, data, timeout)
    with httpx.Client(transport=transport, trust_env=False) as client:
        try:
            response = client.send(request, auth=None, follow_redirects=False)
        except httpx.TransportError:
            raise interrupted_upload() from None
        check_upload_response(response)


async def async_upload_to_url(
    upload: MediaUpload,
    source: UploadSource,
    *,
    timeout: float = 120,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    """Async equivalent of :func:`upload_to_url`. File input is read before networking."""
    data, _ = await asyncio.to_thread(read_source, source)
    request = await asyncio.to_thread(prepare_direct_request, upload, data, timeout)
    async with httpx.AsyncClient(transport=transport, trust_env=False) as client:
        try:
            response = await client.send(request, auth=None, follow_redirects=False)
        except httpx.TransportError:
            raise interrupted_upload() from None
        check_upload_response(response)
