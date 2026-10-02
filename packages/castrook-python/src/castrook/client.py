"""Synchronous and asynchronous clients with one shared HTTP request contract."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator, Mapping
from types import TracebackType
from typing import Any, TypeVar

import httpx

from . import _async_resources, _resources
from ._contract import (
    DEFAULT_BASE_URL,
    QueryValue,
    config,
    next_cursor,
    parse_response,
    prepare_request,
    request_from_spec,
    retry_delay,
    transport_error,
)
from ._polling import poll_timeout
from .types import MediaUpload, Page
from .uploads import check_upload_response, interrupted_upload, prepare_direct_request

T = TypeVar("T")


class Castrook:
    """Thread-safe, connection-pooled server client. Close it or use a context manager.

    Pass an API key (Test/Live) or an OAuth access token, never both. Each token's
    mode and scopes are enforced by the service; the SDK cannot change them.
    Timeout is in seconds per network operation. Retry waits are bounded to 30s.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        token: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30,
        max_retries: int = 2,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._settings = config(api_key, token, base_url, timeout, max_retries)
        self._http = httpx.Client(
            transport=transport, trust_env=False, timeout=timeout, follow_redirects=False
        )
        self.accounts = _resources.Accounts(self)
        self.posts = _resources.Posts(self)
        self.profiles = _resources.Profiles(self)
        self.connect_sessions = _resources.ConnectSessions(self)
        self.media = _resources.Media(self)
        self.analytics = _resources.Analytics(self)
        self.comments = _resources.Comments(self)
        self.webhooks = _resources.Webhooks(self)
        self.deliveries = _resources.Deliveries(self)
        self.logs = _resources.Logs(self)
        self.usage = _resources.Usage(self)

    def __enter__(self) -> Castrook:
        self._http.__enter__()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    @property
    def is_closed(self) -> bool:
        return self._http.is_closed

    def _request(
        self,
        operation: str,
        *,
        id: str | None = None,
        body: Any = None,
        query: Mapping[str, QueryValue] | None = None,
        idempotency_key: str | None = None,
        deadline: float | None = None,
    ) -> Any:
        spec = prepare_request(
            self._settings,
            operation,
            id=id,
            body=body,
            query=query,
            idempotency_key=idempotency_key,
        )
        for attempt in range(self._settings.max_retries + 1):
            timeout = self._settings.timeout
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise poll_timeout(id)
                timeout = min(timeout, remaining)
            try:
                response = self._http.send(
                    request_from_spec(spec, timeout), auth=None, follow_redirects=False
                )
                outcome = parse_response(response, spec)
                if outcome.error is None:
                    return outcome.payload
                error = outcome.error
            except httpx.TransportError as caught:
                error = transport_error(caught)
            delay = retry_delay(spec, error, attempt, self._settings.max_retries)
            if delay is None:
                raise error from None
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if delay >= remaining:
                    raise poll_timeout(id)
            time.sleep(delay)
        raise AssertionError("Unreachable retry state")

    def _put_upload(self, upload: MediaUpload, data: bytes, timeout: float) -> None:
        request = prepare_direct_request(upload, data, timeout)
        try:
            # The API client's cookies, default auth and headers are never merged.
            response = self._http.send(request, auth=None, follow_redirects=False)
        except httpx.TransportError:
            raise interrupted_upload() from None
        check_upload_response(response)

    def paginate(
        self, fetch_page: Callable[[str | None], Page[T]], *, cursor: str | None = None
    ) -> Iterator[T]:
        """Iterate any cursor-paginated resource, preserving the caller's filters."""
        seen = {cursor} if cursor is not None else set()
        while True:
            page = fetch_page(cursor)
            following = next_cursor(page, seen)
            yield from page["data"]
            if following is None:
                return
            cursor = following


class AsyncCastrook:
    """Async counterpart of Castrook. Use one client per event loop."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        token: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30,
        max_retries: int = 2,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._settings = config(api_key, token, base_url, timeout, max_retries)
        self._http = httpx.AsyncClient(
            transport=transport, trust_env=False, timeout=timeout, follow_redirects=False
        )
        self.accounts = _async_resources.AsyncAccounts(self)
        self.posts = _async_resources.AsyncPosts(self)
        self.profiles = _async_resources.AsyncProfiles(self)
        self.connect_sessions = _async_resources.AsyncConnectSessions(self)
        self.media = _async_resources.AsyncMedia(self)
        self.analytics = _async_resources.AsyncAnalytics(self)
        self.comments = _async_resources.AsyncComments(self)
        self.webhooks = _async_resources.AsyncWebhooks(self)
        self.deliveries = _async_resources.AsyncDeliveries(self)
        self.logs = _async_resources.AsyncLogs(self)
        self.usage = _async_resources.AsyncUsage(self)

    async def __aenter__(self) -> AsyncCastrook:
        await self._http.__aenter__()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.close()

    async def close(self) -> None:
        await self._http.aclose()

    @property
    def is_closed(self) -> bool:
        return self._http.is_closed

    async def _request(
        self,
        operation: str,
        *,
        id: str | None = None,
        body: Any = None,
        query: Mapping[str, QueryValue] | None = None,
        idempotency_key: str | None = None,
        deadline: float | None = None,
    ) -> Any:
        spec = prepare_request(
            self._settings,
            operation,
            id=id,
            body=body,
            query=query,
            idempotency_key=idempotency_key,
        )
        for attempt in range(self._settings.max_retries + 1):
            timeout = self._settings.timeout
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise poll_timeout(id)
                timeout = min(timeout, remaining)
            try:
                response = await self._http.send(
                    request_from_spec(spec, timeout), auth=None, follow_redirects=False
                )
                outcome = parse_response(response, spec)
                if outcome.error is None:
                    return outcome.payload
                error = outcome.error
            except httpx.TransportError as caught:
                error = transport_error(caught)
            delay = retry_delay(spec, error, attempt, self._settings.max_retries)
            if delay is None:
                raise error from None
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if delay >= remaining:
                    raise poll_timeout(id)
            await asyncio.sleep(delay)
        raise AssertionError("Unreachable retry state")

    async def _put_upload(self, upload: MediaUpload, data: bytes, timeout: float) -> None:
        request = await asyncio.to_thread(prepare_direct_request, upload, data, timeout)
        try:
            response = await self._http.send(request, auth=None, follow_redirects=False)
        except httpx.TransportError:
            raise interrupted_upload() from None
        check_upload_response(response)

    async def paginate(
        self, fetch_page: Callable[[str | None], Awaitable[Page[T]]], *, cursor: str | None = None
    ) -> AsyncIterator[T]:
        seen = {cursor} if cursor is not None else set()
        while True:
            page = await fetch_page(cursor)
            following = next_cursor(page, seen)
            for item in page["data"]:
                yield item
            if following is None:
                return
            cursor = following
