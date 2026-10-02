import json

import httpx
import pytest

from castrook import AsyncCastrook, Castrook, CastrookError
from castrook._contract import parse_retry_after


@pytest.fixture
def sleeps(monkeypatch):
    delays = []
    monkeypatch.setattr("castrook.client.time.sleep", lambda delay: delays.append(delay))

    async def sleep(delay):
        delays.append(delay)

    monkeypatch.setattr("castrook.client.asyncio.sleep", sleep)
    return delays


@pytest.mark.parametrize("async_mode", [False, True])
async def test_safe_reads_retry_network_and_503(async_mode, sleeps):
    calls = []

    def handle(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadTimeout("Sensitive URL and key must never appear in our error")
        if len(calls) == 2:
            return httpx.Response(
                503,
                json={"error": {"code": "temporarily_unavailable", "message": "Retry"}},
                headers={"Retry-After": "0"},
            )
        return httpx.Response(200, json={"data": {"mode": "test"}})

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    result = await client.usage.get() if async_mode else client.usage.get()
    assert result["data"]["mode"] == "test"
    assert sleeps == [0.5, 0]
    assert len(calls) == 3
    assert len({str(req.url) for req in calls}) == 1
    if async_mode:
        await client.close()
    else:
        client.close()


@pytest.mark.parametrize("async_mode", [False, True])
async def test_post_retries_exact_frozen_body_and_key(async_mode, sleeps):
    input = {"text": "Original", "account_ids": ["acct_1"]}
    calls = []

    def handle(request):
        calls.append(request)
        if len(calls) == 1:
            input["text"] = "Changed by another task"
            return httpx.Response(500, json={"error": {"code": "internal_error"}})
        return httpx.Response(201, json={"data": {"id": "post_1"}})

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_live_example", transport=httpx.MockTransport(handle)
    )
    if async_mode:
        await client.posts.create(input, idempotency_key="exact-logical-post-001")
        await client.close()
    else:
        client.posts.create(input, idempotency_key="exact-logical-post-001")
        client.close()
    assert len(calls) == 2
    assert calls[0].content == calls[1].content
    assert json.loads(calls[1].content)["text"] == "Original"
    assert {r.headers["idempotency-key"] for r in calls} == {"exact-logical-post-001"}


@pytest.mark.parametrize(
    "code,details",
    [
        ("usage_limit_exceeded", {"metric": "api_requests", "reset_at": "2026-11-01T00:00:00Z"}),
        ("account_limit_reached", {"connected": 3}),
        ("account_capacity_exceeded", {"connected": 50}),
    ],
)
@pytest.mark.parametrize("async_mode", [False, True])
async def test_permanent_limits_never_retry_and_preserve_details(code, details, async_mode, sleeps):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(
            429,
            json={
                "error": {"code": code, "message": "Limit reached", "details": details},
                "request_id": "req_payload",
            },
            headers={"Retry-After": "0"},
        )

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(CastrookError) as caught:
        if async_mode:
            await client.usage.get()
        else:
            client.usage.get()
    error = caught.value
    assert error.code == code
    assert error.status == 429
    assert error.details == details
    assert error.request_id == "req_payload"
    assert error.is_usage_limit() == (code == "usage_limit_exceeded")
    assert error.is_account_limit() == code.startswith("account_")
    assert sleeps == [] and len(calls) == 1
    if async_mode:
        await client.close()
    else:
        client.close()


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize(
    "code,retry_after,expected_calls",
    [
        ("rate_limit_exceeded", "0", 3),
        ("rate_limit_exceeded", "31", 1),
        ("temporarily_unavailable", "30", 3),
    ],
)
async def test_rate_retry_is_bounded(async_mode, code, retry_after, expected_calls, sleeps):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(
            429,
            json={
                "error": {
                    "code": code,
                    "message": "Please wait",
                    "details": {"retry_after_seconds": int(retry_after)},
                }
            },
            headers={"Retry-After": retry_after, "X-Request-ID": "req_header"},
        )

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(CastrookError) as caught:
        if async_mode:
            await client.accounts.list()
        else:
            client.accounts.list()
    assert len(calls) == expected_calls
    assert len(sleeps) == expected_calls - 1
    assert caught.value.retry_after == int(retry_after)
    assert caught.value.request_id == "req_header"
    if async_mode:
        await client.close()
    else:
        client.close()


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize(
    "operation,input",
    [
        ("profiles.create", {"name": "Acme"}),
        (
            "comments.reply",
            {"account_id": "acct_1", "post_id": "post_1", "comment_id": "comment_1", "text": "Hi"},
        ),
        ("connect_sessions.create", {"profile_id": "prof_1", "platforms": ["youtube"]}),
        (
            "media.create_upload",
            {"filename": "file.mp4", "size": 2, "content_type": "video/mp4", "sha256": "a" * 64},
        ),
    ],
)
async def test_ambiguous_non_idempotent_writes_never_retry(async_mode, operation, input, sleeps):
    calls = []

    def handle(request):
        calls.append(request)
        raise httpx.ReadTimeout("secret-capability-url")

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    resource, method = operation.split(".")
    call = getattr(getattr(client, resource), method)
    with pytest.raises(CastrookError) as caught:
        if async_mode:
            await call(input)
        else:
            call(input)
    assert caught.value.status == 0
    assert caught.value.code == "request_timeout"
    assert "secret-capability" not in str(caught.value)
    assert len(calls) == 1 and not sleeps
    if async_mode:
        await client.close()
    else:
        client.close()


@pytest.mark.parametrize("async_mode", [False, True])
async def test_invalid_json_retry_only_for_transient_status(async_mode, sleeps):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(503 if len(calls) == 1 else 200, content=b"not JSON")

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(CastrookError, match="invalid JSON") as caught:
        if async_mode:
            await client.usage.get()
        else:
            client.usage.get()
    assert len(calls) == 2 and caught.value.code == "invalid_response"
    if async_mode:
        await client.close()
    else:
        client.close()


@pytest.mark.parametrize("async_mode", [False, True])
async def test_redirect_does_not_forward_credentials(async_mode, sleeps):
    calls = []

    def handle(request):
        calls.append(request)
        assert request.url.host == "castrook.com"
        return httpx.Response(307, headers={"Location": "https://attacker.example/"})

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_live_very_secret", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(CastrookError) as caught:
        if async_mode:
            await client.usage.get()
        else:
            client.usage.get()
    assert caught.value.code == "unexpected_redirect"
    assert len(calls) == 1 and not sleeps
    if async_mode:
        await client.close()
    else:
        client.close()


@pytest.mark.parametrize("key", ["short", "has spaces invalid", "x" * 129, "line\nbreak"])
def test_posts_reject_invalid_idempotency_keys_before_network(key):
    with (
        Castrook(api_key="cr_test_example") as client,
        pytest.raises(ValueError, match="idempotency_key"),
    ):
        client.posts.create({"text": "hello", "account_ids": []}, idempotency_key=key)


def test_retry_after_dates_and_invalid_values():
    assert parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT", now=1445412478) == 2
    assert parse_retry_after("-5") == 0
    assert parse_retry_after("garbage") is None
    assert parse_retry_after("inf") is None
