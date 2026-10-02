"""Verify every sync/async resource against the same external REST contract."""

import inspect
import json
from importlib.metadata import version

import httpx
import pytest

from castrook import AsyncCastrook, Castrook, __version__
from castrook._contract import ENDPOINTS

POST_INPUT = {"text": "Hello", "account_ids": ["acct_1"]}
UPLOAD_INPUT = {"filename": "image.png", "content_type": "image/png", "size": 4, "sha256": "a" * 64}
CONSENT = {"accepted": True, "privacy_policy_version": "2026-10-02"}
CASES = [
    (
        "accounts.list",
        (),
        {"profile_id": "prof_1", "platform": "youtube", "q": "a & b", "limit": 10},
        "GET",
        "/accounts",
        None,
    ),
    (
        "accounts.publishing_options",
        ("acct_1",),
        {},
        "GET",
        "/accounts/acct_1/publishing-options",
        None,
    ),
    (
        "accounts.create_test",
        ({"platform": "youtube"},),
        {},
        "POST",
        "/accounts",
        {"platform": "youtube"},
    ),
    (
        "accounts.assign_profile",
        ("acct_1", None),
        {},
        "PATCH",
        "/accounts/acct_1",
        {"profile_id": None},
    ),
    (
        "accounts.accept_analytics_policy",
        ("acct_1", CONSENT),
        {},
        "POST",
        "/accounts/acct_1/analytics-consent",
        CONSENT,
    ),
    ("accounts.disconnect", ("acct_1",), {}, "DELETE", "/accounts/acct_1", None),
    (
        "posts.create",
        (POST_INPUT,),
        {"idempotency_key": "hello-post-001"},
        "POST",
        "/posts",
        POST_INPUT,
    ),
    (
        "posts.list",
        (),
        {"status": "scheduled", "profile_id": "prof_1", "q": "launch", "cursor": "cursor_1"},
        "GET",
        "/posts",
        None,
    ),
    ("posts.get", ("post_1",), {}, "GET", "/posts/post_1", None),
    ("posts.cancel", ("post_1",), {}, "DELETE", "/posts/post_1", None),
    ("profiles.list", (), {"external_id": "customer_1", "q": "Acme"}, "GET", "/profiles", None),
    ("profiles.create", ({"name": "Acme"},), {}, "POST", "/profiles", {"name": "Acme"}),
    ("profiles.get", ("prof_1",), {}, "GET", "/profiles/prof_1", None),
    (
        "profiles.update",
        ("prof_1", {"external_id": None}),
        {},
        "PATCH",
        "/profiles/prof_1",
        {"external_id": None},
    ),
    ("profiles.delete", ("prof_1",), {}, "DELETE", "/profiles/prof_1", None),
    (
        "connect_sessions.create",
        ({"profile_id": "prof_1", "platforms": ["youtube"]},),
        {},
        "POST",
        "/connect-sessions",
        {"profile_id": "prof_1", "platforms": ["youtube"]},
    ),
    ("connect_sessions.get", ("cs_1",), {}, "GET", "/connect-sessions/cs_1", None),
    ("connect_sessions.revoke", ("cs_1",), {}, "DELETE", "/connect-sessions/cs_1", None),
    ("media.list", (), {"profile_id": "prof_1"}, "GET", "/media", None),
    ("media.get", ("asset_1",), {}, "GET", "/media/asset_1", None),
    ("media.create_upload", (UPLOAD_INPUT,), {}, "POST", "/media/uploads", UPLOAD_INPUT),
    ("media.complete", ("asset_1",), {}, "POST", "/media/asset_1/complete", {}),
    ("media.delete", ("asset_1",), {}, "DELETE", "/media/asset_1", None),
    ("media.download", ("asset_1",), {}, "GET", "/media/asset_1/content", None),
    (
        "analytics.posts",
        (),
        {
            "profile_id": "prof_1",
            "account_id": "acct_1",
            "platform": "youtube",
            "from_": "2026-10-01",
            "to": "2026-10-31",
        },
        "GET",
        "/analytics/posts",
        None,
    ),
    (
        "analytics.summary",
        (),
        {"from_": "2026-10-01", "to": "2026-10-31"},
        "GET",
        "/analytics/summary",
        None,
    ),
    ("analytics.refresh", ("post_1",), {}, "POST", "/posts/post_1/analytics/refresh", {}),
    (
        "comments.list",
        (),
        {"account_id": "acct_1", "post_id": "provider_post_1", "cursor": "provider_cursor"},
        "GET",
        "/comments",
        None,
    ),
    (
        "comments.reply",
        (
            {
                "account_id": "acct_1",
                "post_id": "provider_post_1",
                "comment_id": "comment_1",
                "text": "Thank you",
            },
        ),
        {},
        "POST",
        "/comments",
        {
            "account_id": "acct_1",
            "post_id": "provider_post_1",
            "comment_id": "comment_1",
            "text": "Thank you",
        },
    ),
    ("webhooks.list", (), {"limit": 20}, "GET", "/webhooks", None),
    (
        "webhooks.create",
        ({"url": "https://example.com/events", "events": ["post.published"]},),
        {},
        "POST",
        "/webhooks",
        {"url": "https://example.com/events", "events": ["post.published"]},
    ),
    ("webhooks.disable", ("wh_1",), {}, "DELETE", "/webhooks/wh_1", None),
    ("deliveries.list", (), {"webhook_id": "wh_1"}, "GET", "/deliveries", None),
    ("logs.list", (), {"cursor": "cursor_1", "limit": 10}, "GET", "/logs", None),
    ("usage.get", (), {}, "GET", "/usage", None),
]


@pytest.mark.parametrize("async_mode", [False, True], ids=["sync", "async"])
@pytest.mark.parametrize("operation,args,kwargs,method,path,body", CASES, ids=[c[0] for c in CASES])
async def test_all_rest_resources(async_mode, operation, args, kwargs, method, path, body):
    seen = []

    def handle(request):
        seen.append(request)
        assert request.url.host == "castrook.com"
        assert request.method == method
        assert request.url.path == "/api/v1" + path
        assert request.headers["authorization"] == "Bearer cr_oauth_owner_test"
        assert request.headers["user-agent"] == "castrook-python/0.4.0"
        assert request.headers.get("cookie") is None
        if body is not None:
            assert json.loads(request.content) == body
        else:
            assert request.content == b""
        for key, value in kwargs.items():
            if key != "idempotency_key":
                assert request.url.params["from" if key == "from_" else key] == str(value)
        assert "None" not in str(request.url)
        if operation == "posts.create":
            assert request.headers["idempotency-key"] == "hello-post-001"
        else:
            assert "idempotency-key" not in request.headers
        if operation == "media.download":
            return httpx.Response(
                200, content=b"actual-media", headers={"content-type": "image/png"}
            )
        return httpx.Response(200, json={"data": {"id": "resource_1"}})

    cls = AsyncCastrook if async_mode else Castrook
    client = cls(token="cr_oauth_owner_test", transport=httpx.MockTransport(handle))
    resource, name = operation.split(".")
    call = getattr(getattr(client, resource), name)
    result = await call(*args, **kwargs) if async_mode else call(*args, **kwargs)
    if operation == "media.download":
        assert result == b"actual-media"
    else:
        assert result["data"]["id"] == "resource_1"
    if async_mode:
        await client.close()
    else:
        client.close()
    assert client.is_closed
    assert len(seen) == 1


def test_operation_matrix_is_complete():
    assert {row[0] for row in CASES} == set(ENDPOINTS)


def test_versions_agree_with_installed_metadata():
    assert __version__ == "0.4.0" == version("castrook")


async def test_resource_signatures_match_between_sync_and_async():
    sync = Castrook(api_key="cr_test_example")
    asynchronous = AsyncCastrook(api_key="cr_test_example")
    for resource in {row[0].split(".")[0] for row in CASES}:
        for name in dir(getattr(sync, resource)):
            if name.startswith("_"):
                continue
            assert (
                inspect.signature(getattr(getattr(sync, resource), name)).parameters
                == inspect.signature(getattr(getattr(asynchronous, resource), name)).parameters
            )
    sync.close()
    await asynchronous.close()


@pytest.mark.parametrize(
    "base_url",
    [
        "http://example.com/api/v1",
        "https://user:password@castrook.com/api/v1",
        "https://castrook.com/api/v1?key=secret",
        "https://castrook.com/api/v1#secret",
        "https://castrook.com:bad",
        "https://castrook.com\\@evil.example",
        "https://castrook.com/\napi/v1",
    ],
)
def test_unsafe_base_urls_rejected(base_url):
    with pytest.raises(ValueError):
        Castrook(api_key="cr_test_example", base_url=base_url)


@pytest.mark.parametrize(
    "key", ["", "secret", "cr_live_unsafe\nAuthorization: hello", "cr_test_has space"]
)
def test_invalid_credentials_rejected(key):
    with pytest.raises(ValueError):
        Castrook(api_key=key)


def test_credentials_are_not_in_client_or_error_repr():
    with Castrook(api_key="cr_live_very_secret") as client:
        assert "very_secret" not in repr(client)
    with pytest.raises(ValueError, match="either"):
        Castrook(api_key="cr_test_a", token="cr_oauth_b")


@pytest.mark.parametrize(
    "kwargs",
    [
        {"timeout": 0},
        {"timeout": float("inf")},
        {"timeout": 601},
        {"max_retries": -1},
        {"max_retries": 6},
        {"max_retries": True},
    ],
)
def test_invalid_timeout_and_retries(kwargs):
    with pytest.raises(ValueError):
        Castrook(api_key="cr_test_example", **kwargs)


def test_loopback_http_and_escaped_resource_ids():
    def handle(request):
        assert request.url.raw_path == b"/api/v1/posts/id%2Fwith%3Fquery%23fragment"
        return httpx.Response(200, json={"data": {"id": "resource"}})

    with Castrook(
        api_key="cr_test_example",
        base_url="http://[::1]:8080/api/v1/",
        transport=httpx.MockTransport(handle),
    ) as client:
        client.posts.get("id/with?query#fragment")
        with pytest.raises(ValueError):
            client.posts.get("..")
