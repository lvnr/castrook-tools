import hashlib
import hmac

import httpx
import pytest

from castrook import AsyncCastrook, Castrook, CastrookError, verify_webhook


@pytest.mark.parametrize("async_mode", [False, True])
async def test_resource_and_generic_pagination_preserve_filters(async_mode):
    queries = []

    def handle(request):
        queries.append(dict(request.url.params))
        assert request.url.params["profile_id"] == "prof_1"
        assert request.url.params["limit"] == "10"
        if "cursor" not in request.url.params:
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "acct_1"}],
                    "meta": {"has_more": True, "next_cursor": "opaque/+?cursor"},
                },
            )
        assert request.url.params["cursor"] == "opaque/+?cursor"
        return httpx.Response(
            200, json={"data": [{"id": "acct_2"}], "meta": {"has_more": False, "next_cursor": None}}
        )

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    if async_mode:
        rows = [row async for row in client.accounts.iter(profile_id="prof_1", limit=10)]
        generic = [
            row
            async for row in client.paginate(
                lambda cursor: client.accounts.list(cursor=cursor, profile_id="prof_1", limit=10)
            )
        ]
        await client.close()
    else:
        rows = list(client.accounts.iter(profile_id="prof_1", limit=10))
        generic = list(
            client.paginate(
                lambda cursor: client.accounts.list(cursor=cursor, profile_id="prof_1", limit=10)
            )
        )
        client.close()
    assert rows == generic == [{"id": "acct_1"}, {"id": "acct_2"}]
    assert len(queries) == 4


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize(
    "meta",
    [
        {"has_more": True, "next_cursor": None},
        {"has_more": True, "next_cursor": "initial"},
        {"has_more": "yes", "next_cursor": "next"},
    ],
)
async def test_malformed_or_repeated_pagination_is_bounded(async_mode, meta):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"data": [], "meta": meta})

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(CastrookError) as caught:
        if async_mode:
            [row async for row in client.posts.iter(cursor="initial")]
        else:
            list(client.posts.iter(cursor="initial"))
    assert caught.value.code == "invalid_pagination"
    assert len(calls) == 1
    if async_mode:
        await client.close()
    else:
        client.close()


@pytest.mark.parametrize("async_mode", [False, True])
async def test_wait_preserves_failure_outcome_and_reduces_http_timeout(async_mode):
    calls = []

    def handle(request):
        calls.append(request)
        assert request.method == "GET"
        assert 0 < request.extensions["timeout"]["read"] <= 5
        status = "queued" if len(calls) == 1 else "partially_failed"
        return httpx.Response(
            200,
            json={
                "data": {
                    "id": "post_1",
                    "status": status,
                    "targets": [{"status": "failed", "error": {"code": "missing_scope"}}],
                }
            },
        )

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    if async_mode:
        result = await client.posts.wait("post_1", timeout=5, poll_interval=0.1)
        await client.close()
    else:
        result = client.posts.wait("post_1", timeout=5, poll_interval=0.1)
        client.close()
    assert result["data"]["status"] == "partially_failed"
    assert len(calls) == 2


@pytest.mark.parametrize("async_mode", [False, True])
async def test_wait_timeout_does_not_cancel_or_recreate(async_mode):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"data": {"id": "post_1", "status": "scheduled"}})

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_test_example", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(CastrookError) as caught:
        if async_mode:
            await client.posts.wait("post_1", timeout=0.05, poll_interval=0.1)
        else:
            client.posts.wait("post_1", timeout=0.05, poll_interval=0.1)
    assert caught.value.code == "poll_timeout"
    assert caught.value.details == {"post_id": "post_1"}
    assert {r.method for r in calls} == {"GET"}
    if async_mode:
        await client.close()
    else:
        client.close()


@pytest.mark.parametrize("async_mode", [False, True])
@pytest.mark.parametrize(
    "acceptance",
    [
        {},
        {"accepted": False, "privacy_policy_version": "2026-10-02"},
        {"accepted": 1, "privacy_policy_version": "2026-10-02"},
        {"accepted": True, "privacy_policy_version": "old-version"},
    ],
)
async def test_consent_never_inferred_or_defaulted(async_mode, acceptance):
    def reject(request):
        pytest.fail("No API call may fabricate or fix legal acceptance")

    client = (AsyncCastrook if async_mode else Castrook)(
        api_key="cr_live_example", transport=httpx.MockTransport(reject)
    )
    with pytest.raises(ValueError):
        if async_mode:
            await client.accounts.accept_analytics_policy("acct_yt", acceptance)
        else:
            client.accounts.accept_analytics_policy("acct_yt", acceptance)
    if async_mode:
        await client.close()
    else:
        client.close()


def test_unavailable_analytics_remains_missing_and_not_zero():
    payload = {
        "data": {
            "totals": {"views": None, "reach": None},
            "coverage": {"views": {"available": 0, "total": 1}},
            "mode": "live",
        }
    }
    with Castrook(
        api_key="cr_live_example",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload)),
    ) as client:
        assert client.analytics.summary() == payload


def test_exact_raw_body_webhook_signature_and_replay_window():
    raw = b'{ "text": "hello" }\n'
    secret = "whsec_private"
    timestamp = "1790900000"
    signature = (
        "v1="
        + hmac.new(
            secret.encode(), b"evt_1." + timestamp.encode() + b"." + raw, hashlib.sha256
        ).hexdigest()
    )
    values = dict(
        secret=secret,
        id="evt_1",
        timestamp=timestamp,
        signature=signature,
        body=raw,
        now=1790900001,
    )
    assert verify_webhook(**values)
    assert not verify_webhook(**{**values, "body": b'{"text":"hello"}'})
    assert not verify_webhook(**{**values, "id": "evt_2"})
    assert not verify_webhook(**{**values, "now": 1790900301})
    assert not verify_webhook(**{**values, "timestamp": "1" * 10000})
    assert not verify_webhook(**{**values, "signature": signature.upper()})
    assert not verify_webhook(**{**values, "tolerance_seconds": -1})
