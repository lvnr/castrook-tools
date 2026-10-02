# Castrook Python SDK

Version: 2026-10-02
Canonical: https://castrook.com/guides/python.md
Human guide: https://castrook.com/docs/python

## Installation

castrook==0.4.0, MIT, Python 3.10+. Registry publication is pending until an external install is verified. Install the release wheel:

```sh
python -m pip install https://castrook.com/downloads/castrook-0.4.0-py3-none-any.whl
```

After registry verification use python -m pip install castrook==0.4.0.

## Synchronous client

```python
import os
from castrook import Castrook, CastrookError

with Castrook(api_key=os.environ["CASTROOK_API_KEY"]) as api:
    account = api.accounts.create_test({
        "platform": "facebook", "name": "API demo"
    })["data"]
    post = api.posts.create({
        "text": "Hello from Castrook.",
        "account_ids": [account["id"]],
        "platform_options": {
            "facebook": {"sandbox_outcome": "published"}
        },
    }, idempotency_key="python-demo-first-post-v1")["data"]
    current = api.posts.get(post["id"])["data"]
    print(current["status"], current["targets"])
```

The canonical base URL defaults to https://castrook.com/api/v1. Use token=access_token for an OAuth grant, or api_key for a server-held key. Both bind a workspace/mode/scopes. The API envelope remains a dictionary with data and optional meta; typed response definitions support editors. CastrookError preserves HTTP status, API code, request ID and details.

## Async client

```python
from castrook import AsyncCastrook

async with AsyncCastrook(api_key=api_key) as api:
    async for post in api.posts.iter(status="published"):
        print(post["id"], post["targets"])
```

Resource method names use snake_case. Body inputs are dictionaries. Lists accept keyword filters; for analytics use from_ for the JSON from field.

## Upload and schedule

```python
with Castrook(api_key=api_key) as api:
    asset = api.media.upload(
        "/path/to/launch.mp4", profile_id=profile_id
    )["data"]
    post = api.posts.create({
        "text": "Launch day.",
        "account_ids": [account_id],
        "profile_id": profile_id,
        "media_items": [{"type": "video", "asset_id": asset["id"]}],
        "scheduled_at": scheduled_at_iso8601,
    }, idempotency_key="customer-42-launch-v1")["data"]
```

Paths infer filename/type; bytes need explicit filename and content_type. upload hashes original bytes, creates the private ticket, sends only returned storage headers, then completes verification. media.create_upload and media.complete expose individual stages; media.download returns authenticated bytes. Videos are bounded to 128 MiB; still images to 20 MiB/24 megapixels.

Schedule only authorized content with an explicit timezone, between 5 seconds and 365 days in the future. Provider-specific options still apply (including YouTube made_for_kids and privacy, and TikTok creator approval); the example is a content shape, not permission to act on a live account.

## Lists and resources

for post in api.posts.iter(status="published"): walks lazy pagination. Use api.paginate(lambda cursor: api.posts.list(cursor=cursor)) for custom filters. Keep filters fixed across cursors.

posts.wait(id, timeout=300, poll_interval=1) follows an accepted post within a bounded wait; distant schedules can outlast it.

profiles, connect_sessions, accounts, media, posts, analytics, comments, webhooks, deliveries, logs and usage cover the same REST resources as TypeScript. Examples: accounts.publishing_options/assign_profile/accept_analytics_policy; analytics.posts(from_=..., to=...)/summary/refresh; comments.reply; webhooks.disable.

The client uses bounded timeouts and safe retries. Persist a post's body and idempotency_key across ambiguity. Never turn missing metrics into zero, retry usage exhaustion continuously, manufacture consent or print secrets. See https://castrook.com/guides/workflows.md for task decisions.
