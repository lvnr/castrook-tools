"""Typed resource methods; wire preparation is shared in _contract.py."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, cast

from ._contract import next_cursor, validate_timeout
from ._polling import poll_settings, poll_timeout, terminal_post
from .errors import CastrookError
from .types import (
    Account,
    AnalyticsConsentInput,
    AnalyticsRefresh,
    AnalyticsRow,
    AnalyticsSummary,
    Comment,
    ConnectSession,
    ConnectSessionCreated,
    CreateConnectSessionInput,
    CreateMediaUploadInput,
    CreatePostInput,
    CreateProfileInput,
    CreateTestAccountInput,
    CreateWebhookInput,
    DeletedResource,
    Delivery,
    MediaAsset,
    MediaContentType,
    MediaUploadTicket,
    Page,
    Platform,
    Post,
    PostStatus,
    Profile,
    ReplyCommentInput,
    RequestLog,
    Result,
    TikTokPublishingOptions,
    UpdateProfileInput,
    UsageSummary,
    Webhook,
    WebhookCreated,
)
from .uploads import UploadSource, prepare_media

if TYPE_CHECKING:
    from .client import AsyncCastrook


class _Resource:
    def __init__(self, client: AsyncCastrook) -> None:
        self._client = client


class AsyncAccounts(_Resource):
    async def list(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        profile_id: str | None = None,
        platform: Platform | None = None,
        q: str | None = None,
    ) -> Page[Account]:
        return cast(
            Page[Account],
            await self._client._request(
                "accounts.list",
                query={
                    "cursor": cursor,
                    "limit": limit,
                    "profile_id": profile_id,
                    "platform": platform,
                    "q": q,
                },
            ),
        )

    async def iter(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        profile_id: str | None = None,
        platform: Platform | None = None,
        q: str | None = None,
    ) -> AsyncIterator[Account]:
        """Lazily fetch pages, preserving filters and guarding cursor loops."""
        seen: set[str] = {cursor} if cursor is not None else set()
        while True:
            page = await self.list(
                cursor=cursor, limit=limit, profile_id=profile_id, platform=platform, q=q
            )
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following

    async def publishing_options(self, id: str) -> Result[TikTokPublishingOptions]:
        """Read current TikTok controls before collecting exact-content consent."""
        return cast(
            Result[TikTokPublishingOptions],
            await self._client._request("accounts.publishing_options", id=id),
        )

    async def create_test(self, input: CreateTestAccountInput) -> Result[Account]:
        return cast(
            Result[Account], await self._client._request("accounts.create_test", body=input)
        )

    async def assign_profile(self, id: str, profile_id: str | None) -> Result[Account]:
        return cast(
            Result[Account],
            await self._client._request(
                "accounts.assign_profile", id=id, body={"profile_id": profile_id}
            ),
        )

    async def accept_analytics_policy(
        self, id: str, acceptance: AnalyticsConsentInput
    ) -> Result[Account]:
        """Requires explicit owner acceptance. This SDK never chooses acceptance for you."""
        if (
            acceptance.get("accepted") is not True
            or acceptance.get("privacy_policy_version") != "2026-10-02"
        ):
            raise ValueError(
                "Explicit acceptance of privacy policy version 2026-10-02 is required."
            )
        return cast(
            Result[Account],
            await self._client._request("accounts.accept_analytics_policy", id=id, body=acceptance),
        )

    async def disconnect(self, id: str) -> Result[Account]:
        return cast(Result[Account], await self._client._request("accounts.disconnect", id=id))


class AsyncPosts(_Resource):
    async def list(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        status: PostStatus | None = None,
        platform: Platform | None = None,
        profile_id: str | None = None,
        q: str | None = None,
    ) -> Page[Post]:
        return cast(
            Page[Post],
            await self._client._request(
                "posts.list",
                query={
                    "cursor": cursor,
                    "limit": limit,
                    "status": status,
                    "platform": platform,
                    "profile_id": profile_id,
                    "q": q,
                },
            ),
        )

    async def iter(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        status: PostStatus | None = None,
        platform: Platform | None = None,
        profile_id: str | None = None,
        q: str | None = None,
    ) -> AsyncIterator[Post]:
        """Lazily fetch pages, preserving filters and guarding cursor loops."""
        seen: set[str] = {cursor} if cursor is not None else set()
        while True:
            page = await self.list(
                cursor=cursor,
                limit=limit,
                status=status,
                platform=platform,
                profile_id=profile_id,
                q=q,
            )
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following

    async def create(self, input: CreatePostInput, *, idempotency_key: str) -> Result[Post]:
        return cast(
            Result[Post],
            await self._client._request(
                "posts.create", body=input, idempotency_key=idempotency_key
            ),
        )

    async def get(self, id: str) -> Result[Post]:
        return cast(Result[Post], await self._client._request("posts.get", id=id))

    async def cancel(self, id: str) -> Result[Post]:
        return cast(Result[Post], await self._client._request("posts.cancel", id=id))

    async def wait(
        self, id: str, *, timeout: float = 300, poll_interval: float = 1
    ) -> Result[Post]:
        """Wait for a terminal state; failed/partially_failed posts are returned for inspection."""
        deadline, interval = poll_settings(timeout, poll_interval)
        while True:
            result = cast(
                Result[Post], await self._client._request("posts.get", id=id, deadline=deadline)
            )
            if terminal_post(result):
                return result
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise poll_timeout(id)
            await asyncio.sleep(min(interval, remaining))


class AsyncProfiles(_Resource):
    async def list(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        q: str | None = None,
        external_id: str | None = None,
    ) -> Page[Profile]:
        return cast(
            Page[Profile],
            await self._client._request(
                "profiles.list",
                query={"cursor": cursor, "limit": limit, "q": q, "external_id": external_id},
            ),
        )

    async def iter(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        q: str | None = None,
        external_id: str | None = None,
    ) -> AsyncIterator[Profile]:
        """Lazily fetch pages, preserving filters and guarding cursor loops."""
        seen: set[str] = {cursor} if cursor is not None else set()
        while True:
            page = await self.list(cursor=cursor, limit=limit, q=q, external_id=external_id)
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following

    async def create(self, input: CreateProfileInput) -> Result[Profile]:
        return cast(Result[Profile], await self._client._request("profiles.create", body=input))

    async def get(self, id: str) -> Result[Profile]:
        return cast(Result[Profile], await self._client._request("profiles.get", id=id))

    async def update(self, id: str, input: UpdateProfileInput) -> Result[Profile]:
        return cast(
            Result[Profile], await self._client._request("profiles.update", id=id, body=input)
        )

    async def delete(self, id: str) -> Result[DeletedResource]:
        return cast(Result[DeletedResource], await self._client._request("profiles.delete", id=id))


class AsyncConnectSessions(_Resource):
    async def create(self, input: CreateConnectSessionInput) -> Result[ConnectSessionCreated]:
        """Keep the returned URL private; it grants short-lived onboarding access."""
        return cast(
            Result[ConnectSessionCreated],
            await self._client._request("connect_sessions.create", body=input),
        )

    async def get(self, id: str) -> Result[ConnectSession]:
        return cast(
            Result[ConnectSession], await self._client._request("connect_sessions.get", id=id)
        )

    async def revoke(self, id: str) -> Result[ConnectSession]:
        return cast(
            Result[ConnectSession], await self._client._request("connect_sessions.revoke", id=id)
        )


class AsyncMedia(_Resource):
    async def list(
        self, *, cursor: str | None = None, limit: int | None = None, profile_id: str | None = None
    ) -> Page[MediaAsset]:
        return cast(
            Page[MediaAsset],
            await self._client._request(
                "media.list", query={"cursor": cursor, "limit": limit, "profile_id": profile_id}
            ),
        )

    async def iter(
        self, *, cursor: str | None = None, limit: int | None = None, profile_id: str | None = None
    ) -> AsyncIterator[MediaAsset]:
        """Lazily fetch pages, preserving filters and guarding cursor loops."""
        seen: set[str] = {cursor} if cursor is not None else set()
        while True:
            page = await self.list(cursor=cursor, limit=limit, profile_id=profile_id)
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following

    async def get(self, id: str) -> Result[MediaAsset]:
        return cast(Result[MediaAsset], await self._client._request("media.get", id=id))

    async def create_upload(self, input: CreateMediaUploadInput) -> Result[MediaUploadTicket]:
        return cast(
            Result[MediaUploadTicket],
            await self._client._request("media.create_upload", body=input),
        )

    async def complete(self, id: str) -> Result[MediaAsset]:
        return cast(
            Result[MediaAsset], await self._client._request("media.complete", id=id, body={})
        )

    async def delete(self, id: str) -> Result[DeletedResource]:
        return cast(Result[DeletedResource], await self._client._request("media.delete", id=id))

    async def download(self, id: str) -> bytes:
        return cast(bytes, await self._client._request("media.download", id=id))

    async def upload(
        self,
        source: UploadSource,
        *,
        filename: str | None = None,
        content_type: MediaContentType | None = None,
        profile_id: str | None = None,
        upload_timeout: float = 120,
    ) -> Result[MediaAsset]:
        """Freeze/hash bytes → create ticket → private PUT → verify immutable completion."""
        upload_timeout = validate_timeout(upload_timeout)
        prepared = await asyncio.to_thread(
            prepare_media, source, filename, content_type, profile_id
        )
        ticket = (await self.create_upload(prepared.input))["data"]
        asset_id = ticket["asset"]["id"]
        try:
            await self._client._put_upload(ticket["upload"], prepared.data, upload_timeout)
            return await self.complete(asset_id)
        except CastrookError as error:
            details = dict(error.details) if isinstance(error.details, dict) else {}
            details["asset_id"] = asset_id
            raise CastrookError(
                error.status,
                error.code,
                error.message,
                error.request_id,
                details,
                error.retry_after,
            ) from None


class AsyncAnalytics(_Resource):
    async def posts(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        profile_id: str | None = None,
        account_id: str | None = None,
        platform: Platform | None = None,
        from_: str | None = None,
        to: str | None = None,
    ) -> Page[AnalyticsRow]:
        return cast(
            Page[AnalyticsRow],
            await self._client._request(
                "analytics.posts",
                query={
                    "cursor": cursor,
                    "limit": limit,
                    "profile_id": profile_id,
                    "account_id": account_id,
                    "platform": platform,
                    "from": from_,
                    "to": to,
                },
            ),
        )

    async def iter(
        self,
        *,
        cursor: str | None = None,
        limit: int | None = None,
        profile_id: str | None = None,
        account_id: str | None = None,
        platform: Platform | None = None,
        from_: str | None = None,
        to: str | None = None,
    ) -> AsyncIterator[AnalyticsRow]:
        """Lazily fetch pages, preserving filters and guarding cursor loops."""
        seen: set[str] = {cursor} if cursor is not None else set()
        while True:
            page = await self.posts(
                cursor=cursor,
                limit=limit,
                profile_id=profile_id,
                account_id=account_id,
                platform=platform,
                from_=from_,
                to=to,
            )
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following

    async def summary(
        self,
        *,
        profile_id: str | None = None,
        account_id: str | None = None,
        platform: Platform | None = None,
        from_: str | None = None,
        to: str | None = None,
    ) -> Result[AnalyticsSummary]:
        return cast(
            Result[AnalyticsSummary],
            await self._client._request(
                "analytics.summary",
                query={
                    "profile_id": profile_id,
                    "account_id": account_id,
                    "platform": platform,
                    "from": from_,
                    "to": to,
                },
            ),
        )

    async def refresh(self, post_id: str) -> Result[AnalyticsRefresh]:
        return cast(
            Result[AnalyticsRefresh],
            await self._client._request("analytics.refresh", id=post_id, body={}),
        )


class AsyncComments(_Resource):
    async def list(
        self, *, account_id: str, post_id: str, cursor: str | None = None
    ) -> Page[Comment]:
        return cast(
            Page[Comment],
            await self._client._request(
                "comments.list",
                query={"account_id": account_id, "post_id": post_id, "cursor": cursor},
            ),
        )

    async def iter(
        self, *, account_id: str, post_id: str, cursor: str | None = None
    ) -> AsyncIterator[Comment]:
        """Lazily fetch pages, preserving filters and guarding cursor loops."""
        seen: set[str] = {cursor} if cursor is not None else set()
        while True:
            page = await self.list(account_id=account_id, post_id=post_id, cursor=cursor)
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following

    async def reply(self, input: ReplyCommentInput) -> Result[Comment]:
        return cast(Result[Comment], await self._client._request("comments.reply", body=input))


class AsyncWebhooks(_Resource):
    async def list(self, *, cursor: str | None = None, limit: int | None = None) -> Page[Webhook]:
        return cast(
            Page[Webhook],
            await self._client._request("webhooks.list", query={"cursor": cursor, "limit": limit}),
        )

    async def iter(
        self, *, cursor: str | None = None, limit: int | None = None
    ) -> AsyncIterator[Webhook]:
        """Lazily fetch pages, preserving filters and guarding cursor loops."""
        seen: set[str] = {cursor} if cursor is not None else set()
        while True:
            page = await self.list(cursor=cursor, limit=limit)
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following

    async def create(self, input: CreateWebhookInput) -> Result[WebhookCreated]:
        return cast(
            Result[WebhookCreated], await self._client._request("webhooks.create", body=input)
        )

    async def disable(self, id: str) -> Result[Webhook]:
        return cast(Result[Webhook], await self._client._request("webhooks.disable", id=id))


class AsyncDeliveries(_Resource):
    async def list(
        self, *, cursor: str | None = None, limit: int | None = None, webhook_id: str | None = None
    ) -> Page[Delivery]:
        return cast(
            Page[Delivery],
            await self._client._request(
                "deliveries.list",
                query={"cursor": cursor, "limit": limit, "webhook_id": webhook_id},
            ),
        )

    async def iter(
        self, *, cursor: str | None = None, limit: int | None = None, webhook_id: str | None = None
    ) -> AsyncIterator[Delivery]:
        """Lazily fetch pages, preserving filters and guarding cursor loops."""
        seen: set[str] = {cursor} if cursor is not None else set()
        while True:
            page = await self.list(cursor=cursor, limit=limit, webhook_id=webhook_id)
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following


class AsyncLogs(_Resource):
    async def list(
        self, *, cursor: str | None = None, limit: int | None = None
    ) -> Page[RequestLog]:
        return cast(
            Page[RequestLog],
            await self._client._request("logs.list", query={"cursor": cursor, "limit": limit}),
        )

    async def iter(
        self, *, cursor: str | None = None, limit: int | None = None
    ) -> AsyncIterator[RequestLog]:
        """Lazily fetch pages, preserving filters and guarding cursor loops."""
        seen: set[str] = {cursor} if cursor is not None else set()
        while True:
            page = await self.list(cursor=cursor, limit=limit)
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following


class AsyncUsage(_Resource):
    async def get(self) -> Result[UsageSummary]:
        return cast(Result[UsageSummary], await self._client._request("usage.get"))
