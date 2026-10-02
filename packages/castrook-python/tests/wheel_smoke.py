"""Run with a wheel installed in a clean external venv, from outside the repository.

No source-path injection or production writes. The distribution's public client
performs sync/async HTTP, pagination, idempotent publication and direct upload.
"""

import asyncio
import importlib.metadata
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

import castrook
from castrook import AsyncCastrook, Castrook, sha256
from castrook.types import CreatePostInput, Page, Post, Result


def run_handler(request: httpx.Request) -> httpx.Response:
    if request.url.host == "private-storage.example":
        assert request.method == "PUT"
        assert "authorization" not in request.headers and "cookie" not in request.headers
        assert request.content == b"smoke-media"
        return httpx.Response(200)
    assert request.headers["authorization"] == "Bearer cr_test_external_smoke"
    if request.url.path == "/api/v1/posts" and request.method == "POST":
        assert request.headers["idempotency-key"] == "wheel-smoke-001"
        assert json.loads(request.content)["account_ids"] == ["acct_test"]
        return httpx.Response(201, json={"data": {"id": "post_test", "status": "queued"}})
    if request.url.path == "/api/v1/posts/post_test":
        return httpx.Response(200, json={"data": {"id": "post_test", "status": "published"}})
    if request.url.path == "/api/v1/posts":
        return httpx.Response(
            200,
            json={"data": [{"id": "post_test"}], "meta": {"has_more": False, "next_cursor": None}},
        )
    if request.url.path == "/api/v1/media/uploads":
        assert json.loads(request.content)["sha256"] == sha256(b"smoke-media")
        return httpx.Response(
            201,
            json={
                "data": {
                    "asset": {"id": "asset_test"},
                    "upload": {
                        "url": "https://private-storage.example/ticket?signature=private",
                        "method": "PUT",
                        "headers": {
                            "content-type": "video/mp4",
                            "x-amz-meta-sha256": sha256(b"smoke-media"),
                            "if-none-match": "*",
                        },
                        "expires_at": (
                            datetime.now(timezone.utc) + timedelta(minutes=15)
                        ).isoformat(),
                    },
                }
            },
        )
    if request.url.path == "/api/v1/media/asset_test/complete":
        return httpx.Response(200, json={"data": {"id": "asset_test", "status": "ready"}})
    raise AssertionError("Unexpected smoke endpoint")


def sync_consumer() -> None:
    with Castrook(
        api_key="cr_test_external_smoke", transport=httpx.MockTransport(run_handler)
    ) as api:
        input: CreatePostInput = {"text": "Hello", "account_ids": ["acct_test"]}
        result: Result[Post] = api.posts.create(input, idempotency_key="wheel-smoke-001")
        assert api.posts.wait(result["data"]["id"])["data"]["status"] == "published"
        page: Page[Post] = api.posts.list()
        assert page["data"][0]["id"] == "post_test"
        assert [post["id"] for post in api.posts.iter()] == ["post_test"]
        assert api.media.upload(b"smoke-media", filename="clip.mp4")["data"]["status"] == "ready"


async def async_consumer() -> None:
    async with AsyncCastrook(
        api_key="cr_test_external_smoke", transport=httpx.MockTransport(run_handler)
    ) as api:
        result = await api.posts.create(
            {"text": "Hello", "account_ids": ["acct_test"]}, idempotency_key="wheel-smoke-001"
        )
        assert (await api.posts.wait(result["data"]["id"]))["data"]["status"] == "published"
        assert [post["id"] async for post in api.posts.iter()] == ["post_test"]
        assert (await api.media.upload(b"smoke-media", filename="clip.mp4"))["data"][
            "status"
        ] == "ready"


if __name__ == "__main__":
    assert castrook.__version__ == importlib.metadata.version("castrook") == "0.4.0"
    location = Path(castrook.__file__ or "").resolve()
    assert "site-packages" in location.parts, f"Expected installed wheel, got {location}"
    assert location.with_name("py.typed").is_file()
    sync_consumer()
    asyncio.run(async_consumer())
    print(
        "castrook 0.4.0 external installed wheel: sync, async, typing marker, post/status/pagination/upload PASS"
    )
