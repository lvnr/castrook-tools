# Castrook for Python

Typed synchronous and asynchronous clients for [Castrook](https://castrook.com): customer onboarding, social publishing, scheduled durable media, comments and performance snapshots. Python 3.10+.

## Install

```sh
python -m pip install castrook
```

Version `0.4.0` is the distribution release. Registry publication is tracked separately; until publication is verified, install the built wheel:

```sh
python -m pip install dist/castrook-0.4.0-py3-none-any.whl
```

## Start with Test mode

Create a Test API key in [developer settings](https://castrook.com/dashboard/developers). Keep credentials on your server, outside source control.

```python
import os
from castrook import Castrook

with Castrook(api_key=os.environ["CASTROOK_API_KEY"]) as api:
    account = api.accounts.create_test({"platform": "instagram"})["data"]
    post = api.posts.create(
        {"text": "Hello from Castrook", "account_ids": [account["id"]]},
        idempotency_key="hello-instagram-001",
    )["data"]
    result = api.posts.wait(post["id"])["data"]
    print(result["status"], result["targets"])
```

Publishing is asynchronous. `wait()` returns published, failed, partially failed or canceled posts; inspect targets for the outcome. A polling timeout does not cancel the post. Retrieve its status before starting another publication.

The default API URL is `https://castrook.com/api/v1`. OAuth access tokens are supported with `Castrook(token=access_token)`. A token's workspace, mode and permissions are enforced by Castrook. The SDK does not silently switch a Test token to Live or refresh an OAuth token; your authorization flow manages token refresh.

## Async applications

```python
import asyncio
import os
from castrook import AsyncCastrook

async def main() -> None:
    async with AsyncCastrook(api_key=os.environ["CASTROOK_API_KEY"]) as api:
        async for account in api.accounts.iter(limit=100):
            print(account["id"], account["platform"])
        usage = (await api.usage.get())["data"]
        print(usage["publications"]["remaining"])

asyncio.run(main())
```

Reuse one client for connection pooling. A sync client can be shared across threads; use each async client on one event loop. Context managers close connections; explicit `close()` / `await close()` also work.

## Customer onboarding

```python
with Castrook(api_key=os.environ["CASTROOK_API_KEY"]) as api:
    profile = api.profiles.create({"name": "Acme", "external_id": "customer-42"})["data"]
    session = api.connect_sessions.create({
        "profile_id": profile["id"],
        "platforms": ["tiktok", "instagram", "facebook", "youtube"],
        "return_url": "https://app.example.com/settings/social",
        "embed_origin": "https://app.example.com",
    })["data"]
    # Send session["url"] privately to this customer's browser.
    # It is a short-lived capability, not a public link or an API key.
```

The hosted portal handles provider authorization and explicit legal acceptance. It needs no Castrook login for the customer. Use an exact configured embedding origin and the documented verified completion protocol. Profile deletion requires detaching connected accounts and clearing pending resource references; historical posts retain their profile ID.

## Durable uploads and scheduling

```python
with Castrook(api_key=os.environ["CASTROOK_API_KEY"]) as api:
    asset = api.media.upload("./launch.mp4", profile_id="prof_example")["data"]
    post = api.posts.create({
        "profile_id": "prof_example",
        "text": "Our launch",
        "account_ids": ["acct_instagram_example"],
        "format": "reel",
        "media_items": [{"type": "video", "asset_id": asset["id"]}],
        "scheduled_at": "2027-01-15T15:00:00Z",
    }, idempotency_key="customer-42-launch-v1")["data"]
```

Paths infer filename and content type for JPEG, PNG, WebP, MP4, MOV and WebM. Bytes and binary files are also accepted; for bytes supply `filename` and `content_type`. The convenience helper freezes the input bytes, computes SHA-256, requests a scoped ticket, uploads directly, and completes verification. It buffers at most 128 MiB of video or 20 MiB of image data; use the ticket endpoints for custom streaming workflows. An async helper offloads file preparation to a thread.

API credentials and cookies are never sent to the storage URL. Redirects are refused. Storage PUT is never retried automatically. A `412` from immutable storage only allows completion verification; it does not establish that an asset is ready.

```python
from castrook import CastrookError, sha256, upload_to_url

payload = b"...the actual MP4 bytes..."
with Castrook(api_key=os.environ["CASTROOK_API_KEY"]) as api:
    ticket = api.media.create_upload({
        "filename": "launch.mp4", "content_type": "video/mp4",
        "size": len(payload), "sha256": sha256(payload),
    })["data"]
    try:
        upload_to_url(ticket["upload"], payload)
    except CastrookError as error:
        if error.code != "media_upload_interrupted":
            raise
        # A lost acknowledgement can still have uploaded the bytes.
        # Completion safely checks the existing immutable staging object.
    asset = api.media.complete(ticket["asset"]["id"])["data"]
```

For a failed convenience upload, `error.details["asset_id"]` identifies the recoverable pending asset. Complete that asset before opening another ticket. `async_upload_to_url()` is the async standalone equivalent. Keep ticket URLs private.

## Pagination and analytics

```python
with Castrook(api_key=os.environ["CASTROOK_API_KEY"]) as api:
    for post in api.posts.iter(profile_id="prof_example", status="published", limit=100):
        print(post["id"])
    # Generic pagination works for custom list filters too.
    for row in api.paginate(lambda cursor: api.analytics.posts(
        cursor=cursor, from_="2026-10-01", to="2026-10-31",
    )):
        print(row["metrics"], row.get("reason"))
```

`list()`/`analytics.posts()` return `{data, meta}` for manual pagination. `.iter()` follows cursors lazily and stops safely on repeated or malformed cursors. Async clients support `async for` on both iterator forms.

Analytics filters choose the post creation range; counters are lifetime snapshots, not views attributed to that range. Unavailable metrics remain absent or null, with a reason. Test metrics are labeled `simulated`. YouTube performance use needs explicit owner acceptance of the current privacy policy. `accounts.accept_analytics_policy(id, acceptance)` requires the caller's exact acceptance object; the SDK never fills it, infers acceptance or bypasses the policy gate. TikTok publishing similarly requires current creator controls and approval for the exact content. Provider approval and missing scope restrictions still apply.

## Errors and retries

```python
from castrook import CastrookError

try:
    with Castrook(api_key=os.environ["CASTROOK_API_KEY"]) as api:
        api.usage.get()
except CastrookError as error:
    print(error.status, error.code, error.request_id)
    if error.is_usage_limit():
        print(error.details["reset_at"])
```

Errors expose `status`, `code`, `message`, `request_id`, `details` and `retry_after` (seconds). `status=0` means no response was confirmed. Reads and post creation with an explicit idempotency key retry transport errors, `429` and `5xx` at most twice by default. Retry waits follow `Retry-After` up to 30 seconds, otherwise bounded exponential backoff. Monthly allowance and account capacity failures are never retried. Other writes, including comment replies and new upload tickets, are not automatically retried.

Reuse the **same key and payload** when recovering the same logical post. A different key can create another publication. The SDK captures serialized bytes before retrying so mutation of the input dictionary cannot change an in-flight idempotent request.

Configure `timeout=30` (seconds per network operation, 0–600) and `max_retries=2` (0–5). Direct uploads default to 120 seconds; `media.upload(..., upload_timeout=...)` can override that. `posts.wait(..., timeout=300, poll_interval=1)` bounds polling and preserves asynchronous publication. No automatic redirect following or environment proxy inheritance is enabled. Local development may use an HTTP localhost URL; remote base URLs require HTTPS.

## Resource reference

Sync and async clients expose identical signatures. Async methods are awaited; `.iter()` and `.paginate()` are async generators.

| Resource | Methods |
| --- | --- |
| `profiles` | `list`, `iter`, `create(input)`, `get(id)`, `update(id,input)`, `delete(id)` |
| `connect_sessions` | `create(input)`, `get(id)`, `revoke(id)` |
| `accounts` | `list`, `iter`, `create_test(input)`, `publishing_options(id)`, `assign_profile(id,profile_id)`, `accept_analytics_policy(id,acceptance)`, `disconnect(id)` |
| `posts` | `list`, `iter`, `create(input,idempotency_key=...)`, `get(id)`, `cancel(id)`, `wait(id,timeout=...,poll_interval=...)` |
| `media` | `list`, `iter`, `create_upload(input)`, `upload(source,...)`, `complete(id)`, `get(id)`, `download(id)` → bytes, `delete(id)` |
| `analytics` | `posts`, `iter`, `summary`, `refresh(post_id)` |
| `comments` | `list(account_id=...,post_id=...,cursor=...)`, `iter`, `reply(input)` |
| `webhooks` | `list`, `iter`, `create(input)`, `disable(id)` |
| `deliveries` | `list`, `iter` |
| `logs` | `list`, `iter` |
| `usage` | `get()` |

List parameters are keyword arguments (`cursor`, `limit` and resource filters). Analytics uses `from_` because `from` is a Python keyword. Mutations accept typed dictionaries. `castrook.types` exports response, envelope, input and limit-detail types; `py.typed` supports static checking without model wrappers. See [the complete API reference](https://castrook.com/docs) for formats, scopes, quotas and required platform options.

## Webhook verification

```python
from castrook import verify_webhook

valid = verify_webhook(
    secret=webhook_secret,
    id=headers["webhook-id"],
    timestamp=headers["webhook-timestamp"],
    signature=headers["webhook-signature"],
    body=raw_request_body,  # bytes, before parsing JSON
)
```

Verify before parsing or acting on the payload. Default clock tolerance is five minutes. Deduplicate the event ID separately and keep the signing secret private.

## Development and release

```sh
python -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -m pytest
.venv/bin/python -m mypy
.venv/bin/python -m ruff check src tests
.venv/bin/python -m build
.venv/bin/python -m twine check dist/*
```

Tests use deterministic mocked HTTP and make no provider publications. A built wheel must also be installed into a clean external environment before release. Registry upload is a separate authenticated release step. Licensed under MIT.
