import copy
import hashlib
import io
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from castrook import (
    AsyncCastrook,
    Castrook,
    CastrookError,
    async_upload_to_url,
    sha256,
    upload_to_url,
)
from castrook.uploads import prepare_direct_request, prepare_media, read_source


def ticket_for(data=b"media-bytes", *, content_type="video/mp4"):
    return {
        "url": "https://storage.example/private-staging?X-Amz-Signature=private-capability",
        "method": "PUT",
        "headers": {
            "content-type": content_type,
            "x-amz-meta-sha256": sha256(data),
            "if-none-match": "*",
        },
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
    }


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize("storage_status", [200, 412])
async def test_upload_flow_has_no_storage_credentials_or_cookies(async_mode, storage_status):
    source = bytearray(b"actual-media-bytes")
    original = bytes(source)
    operations = []
    upload = ticket_for(original)

    def handle(request):
        operations.append((request.method, request.url.host, request.url.path))
        if request.url.path == "/api/v1/media/uploads":
            input = json.loads(request.content)
            assert input == {
                "filename": "clip.mp4",
                "content_type": "video/mp4",
                "size": len(original),
                "sha256": hashlib.sha256(original).hexdigest(),
                "profile_id": "prof_1",
            }
            source[:] = b"changed after ticket creation"
            return httpx.Response(
                201,
                json={"data": {"asset": {"id": "asset_1"}, "upload": upload}},
                headers={"set-cookie": "account_secret=private; Domain=.example; Path=/"},
            )
        if request.url.host == "storage.example":
            assert request.method == "PUT"
            assert "authorization" not in request.headers
            assert "cookie" not in request.headers
            assert "user-agent" not in request.headers
            assert request.content == original
            assert request.headers["if-none-match"] == "*"
            assert request.headers["x-amz-meta-sha256"] == sha256(original)
            return httpx.Response(
                storage_status, headers={"set-cookie": "storage_secret=private; Path=/"}
            )
        assert request.url.path == "/api/v1/media/asset_1/complete"
        assert request.headers["authorization"] == "Bearer cr_live_owner_secret"
        assert "cookie" not in request.headers
        assert request.content == b"{}"
        return httpx.Response(200, json={"data": {"id": "asset_1", "status": "ready"}})

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_live_owner_secret", transport=httpx.MockTransport(handle)
    )
    # Even a previously populated cookie jar must not flow into either request.
    client._http.cookies.set("account_secret", "private", domain="castrook.com")
    client._http.cookies.set("storage_secret", "private", domain="storage.example")
    if async_mode:
        result = await client.media.upload(
            source, filename="clip.mp4", content_type="video/mp4", profile_id="prof_1"
        )
        await client.close()
    else:
        result = client.media.upload(
            source, filename="clip.mp4", content_type="video/mp4", profile_id="prof_1"
        )
        client.close()
    assert result["data"]["status"] == "ready"
    assert operations == [
        ("POST", "castrook.com", "/api/v1/media/uploads"),
        ("PUT", "storage.example", "/private-staging"),
        ("POST", "castrook.com", "/api/v1/media/asset_1/complete"),
    ]


@pytest.mark.parametrize("async_mode", [False, True])
async def test_lost_put_does_not_reupload_and_has_recovery_asset_id(async_mode):
    puts = []
    completes = []

    def handle(request):
        if request.url.path == "/api/v1/media/uploads":
            return httpx.Response(
                201, json={"data": {"asset": {"id": "asset_recovery"}, "upload": ticket_for()}}
            )
        if request.method == "PUT":
            puts.append(request)
            raise httpx.ReadTimeout("https://storage.example/?SECRET")
        completes.append(request)
        return httpx.Response(200, json={"data": {"id": "asset_recovery", "status": "ready"}})

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(CastrookError) as caught:
        if async_mode:
            await client.media.upload(b"media-bytes", filename="clip.mp4")
        else:
            client.media.upload(b"media-bytes", filename="clip.mp4")
    error = caught.value
    assert error.code == "media_upload_interrupted"
    assert error.details == {"asset_id": "asset_recovery"}
    assert "SECRET" not in str(error)
    assert len(puts) == 1 and completes == []
    # Explicit, safe recovery uses the original ticket's asset.
    if async_mode:
        result = await client.media.complete(error.details["asset_id"])
        await client.close()
    else:
        result = client.media.complete(error.details["asset_id"])
        client.close()
    assert result["data"]["status"] == "ready"
    assert len(completes) == 1


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize("storage_status", [307, 500])
async def test_storage_redirect_and_failure_never_follow_or_retry(async_mode, storage_status):
    requests = []

    def handle(request):
        requests.append(request)
        assert request.url.host == "storage.example"
        return httpx.Response(storage_status, headers={"Location": "https://attacker.example"})

    with pytest.raises(CastrookError) as caught:
        if async_mode:
            await async_upload_to_url(
                ticket_for(), b"media-bytes", transport=httpx.MockTransport(handle)
            )
        else:
            upload_to_url(ticket_for(), b"media-bytes", transport=httpx.MockTransport(handle))
    assert caught.value.code == "media_upload_failed"
    assert len(requests) == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"url": "http://storage.example/file"},
        {"url": "https://user:password@storage.example/file"},
        {"url": "https://storage.example/file#fragment"},
        {"method": "POST"},
        {"expires_at": "not-a-date"},
        {"expires_at": "2026-10-02T12:00:00"},
    ],
)
def test_unsafe_tickets_fail_before_network(changes):
    ticket = ticket_for()
    ticket.update(changes)
    with pytest.raises(ValueError):
        prepare_direct_request(ticket, b"media-bytes", 120)


@pytest.mark.parametrize(
    "header", ["Authorization", "Cookie", "Proxy-Authorization", "X-Api-Key", "Host"]
)
def test_forbidden_ticket_headers(header):
    ticket = ticket_for()
    ticket["headers"][header] = "private-secret"
    with pytest.raises(ValueError, match="credentials"):
        prepare_direct_request(ticket, b"media-bytes", 120)


def test_ticket_expiry_size_digest_and_immutable_precondition():
    ticket = ticket_for()
    with pytest.raises(ValueError, match="SHA-256"):
        prepare_direct_request(ticket, b"different-content", 120)
    wrong_size = copy.deepcopy(ticket)
    wrong_size["headers"]["content-length"] = "100"
    with pytest.raises(ValueError, match="size"):
        prepare_direct_request(wrong_size, b"media-bytes", 120)
    mutable = copy.deepcopy(ticket)
    mutable["headers"].pop("if-none-match")
    with pytest.raises(ValueError, match="immutable"):
        prepare_direct_request(mutable, b"media-bytes", 120)
    expired = copy.deepcopy(ticket)
    expired["expires_at"] = "2000-01-01T00:00:00Z"
    with pytest.raises(CastrookError) as caught:
        prepare_direct_request(expired, b"media-bytes", 120)
    assert caught.value.code == "media_upload_expired"


def test_file_inference_binary_input_and_empty_rejection(tmp_path):
    path = tmp_path / "CLIP.MOV"
    path.write_bytes(b"actual-media")
    prepared = prepare_media(path, None, None, None)
    assert prepared.input["content_type"] == "video/quicktime"
    assert prepared.input["filename"] == "CLIP.MOV"
    assert prepared.input["sha256"] == sha256(b"actual-media")
    assert prepared.input["size"] == 12
    assert read_source(io.BytesIO(b"abc"))[0] == b"abc"
    with pytest.raises(ValueError):
        read_source(b"")
    with pytest.raises(TypeError):
        read_source(io.StringIO("not binary"))
    with pytest.raises(ValueError, match="filename"):
        prepare_media(b"abc", None, None, None)


def test_size_guard_before_large_file_read(monkeypatch):
    monkeypatch.setattr("castrook.uploads.MAX_MEDIA_BYTES", 8)
    with pytest.raises(ValueError):
        read_source(io.BytesIO(b"too-large-file-content"))
    with pytest.raises(ValueError):
        read_source(memoryview(bytearray(16)).cast("I"))
