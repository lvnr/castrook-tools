"""One request, parsing and retry contract used by both transports."""

import json
import math
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

from .errors import CastrookError

SDK_VERSION = "0.4.0"
DEFAULT_BASE_URL = "https://castrook.com/api/v1"
QueryValue = str | int | float | bool | None


@dataclass(frozen=True)
class Endpoint:
    method: str
    path: str
    binary: bool = False
    idempotent_post: bool = False


# Routes and retry eligibility live here, rather than in independent sync/async implementations.
ENDPOINTS = {
    "accounts.list": Endpoint("GET", "/accounts"),
    "accounts.publishing_options": Endpoint("GET", "/accounts/{id}/publishing-options"),
    "accounts.create_test": Endpoint("POST", "/accounts"),
    "accounts.assign_profile": Endpoint("PATCH", "/accounts/{id}"),
    "accounts.accept_analytics_policy": Endpoint("POST", "/accounts/{id}/analytics-consent"),
    "accounts.disconnect": Endpoint("DELETE", "/accounts/{id}"),
    "posts.create": Endpoint("POST", "/posts", idempotent_post=True),
    "posts.list": Endpoint("GET", "/posts"),
    "posts.get": Endpoint("GET", "/posts/{id}"),
    "posts.cancel": Endpoint("DELETE", "/posts/{id}"),
    "profiles.list": Endpoint("GET", "/profiles"),
    "profiles.create": Endpoint("POST", "/profiles"),
    "profiles.get": Endpoint("GET", "/profiles/{id}"),
    "profiles.update": Endpoint("PATCH", "/profiles/{id}"),
    "profiles.delete": Endpoint("DELETE", "/profiles/{id}"),
    "connect_sessions.create": Endpoint("POST", "/connect-sessions"),
    "connect_sessions.get": Endpoint("GET", "/connect-sessions/{id}"),
    "connect_sessions.revoke": Endpoint("DELETE", "/connect-sessions/{id}"),
    "media.list": Endpoint("GET", "/media"),
    "media.get": Endpoint("GET", "/media/{id}"),
    "media.create_upload": Endpoint("POST", "/media/uploads"),
    "media.complete": Endpoint("POST", "/media/{id}/complete"),
    "media.delete": Endpoint("DELETE", "/media/{id}"),
    "media.download": Endpoint("GET", "/media/{id}/content", binary=True),
    "analytics.posts": Endpoint("GET", "/analytics/posts"),
    "analytics.summary": Endpoint("GET", "/analytics/summary"),
    "analytics.refresh": Endpoint("POST", "/posts/{id}/analytics/refresh"),
    "comments.list": Endpoint("GET", "/comments"),
    "comments.reply": Endpoint("POST", "/comments"),
    "webhooks.list": Endpoint("GET", "/webhooks"),
    "webhooks.create": Endpoint("POST", "/webhooks"),
    "webhooks.disable": Endpoint("DELETE", "/webhooks/{id}"),
    "deliveries.list": Endpoint("GET", "/deliveries"),
    "logs.list": Endpoint("GET", "/logs"),
    "usage.get": Endpoint("GET", "/usage"),
}


@dataclass(frozen=True)
class ClientConfig:
    token: str
    base_url: str
    timeout: float
    max_retries: int


def validate_timeout(timeout: float) -> float:
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)):
        raise ValueError("timeout must be a number of seconds between 0 and 600.")
    if not math.isfinite(timeout) or timeout <= 0 or timeout > 600:
        raise ValueError("timeout must be a number of seconds between 0 and 600.")
    return float(timeout)


def config(
    api_key: str | None,
    token: str | None,
    base_url: str,
    timeout: float,
    max_retries: int,
) -> ClientConfig:
    if api_key is not None and token is not None:
        raise ValueError("Pass either api_key or token, not both.")
    credential = token if token is not None else api_key
    if not isinstance(credential, str) or not re.fullmatch(
        r"cr_(test|live|oauth)_[A-Za-z0-9_-]+", credential
    ):
        raise ValueError("A Castrook test/live API key or OAuth access token is required.")
    if not isinstance(base_url, str):
        raise ValueError("base_url must be an HTTPS URL.")
    try:
        parsed = urlsplit(base_url)
        _ = parsed.port
    except ValueError:
        raise ValueError("base_url must be a valid HTTPS URL.") from None
    if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
        raise ValueError("base_url must not include credentials, a query or a fragment.")
    local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise ValueError("base_url must use HTTPS, except for local development.")
    if any(ord(char) <= 32 for char in base_url) or "\\" in base_url:
        raise ValueError("base_url must not contain whitespace, control characters or backslashes.")
    if (
        isinstance(max_retries, bool)
        or not isinstance(max_retries, int)
        or not 0 <= max_retries <= 5
    ):
        raise ValueError("max_retries must be an integer between 0 and 5.")
    return ClientConfig(credential, base_url.rstrip("/"), validate_timeout(timeout), max_retries)


@dataclass(frozen=True)
class RequestSpec:
    method: str
    url: str
    headers: dict[str, str]
    content: bytes | None
    binary: bool
    retryable: bool


def prepare_request(
    settings: ClientConfig,
    operation: str,
    *,
    id: str | None = None,
    body: Any = None,
    query: Mapping[str, QueryValue] | None = None,
    idempotency_key: str | None = None,
) -> RequestSpec:
    endpoint = ENDPOINTS[operation]
    path = endpoint.path
    if "{id}" in path:
        if not isinstance(id, str) or not id or id in {".", ".."}:
            raise ValueError("A nonempty resource ID is required.")
        path = path.replace("{id}", quote(id, safe=""))
    if endpoint.idempotent_post:
        if not isinstance(idempotency_key, str) or not re.fullmatch(
            r"[A-Za-z0-9_.:-]{8,128}", idempotency_key
        ):
            raise ValueError(
                "idempotency_key must contain 8–128 letters, numbers, dots, colons, underscores or hyphens."
            )
    elif idempotency_key is not None:
        raise ValueError("This endpoint does not support idempotency keys.")
    params = {key: value for key, value in (query or {}).items() if value is not None}
    suffix = str(httpx.QueryParams(params))
    url = f"{settings.base_url}{path}" + (f"?{suffix}" if suffix else "")
    headers = {
        "Authorization": f"Bearer {settings.token}",
        "Accept": "application/octet-stream" if endpoint.binary else "application/json",
        "User-Agent": f"castrook-python/{SDK_VERSION}",
    }
    content: bytes | None = None
    if body is not None:
        # Serialize once: retries keep the same logical payload even if the caller changes its dictionary.
        content = json.dumps(
            body, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    return RequestSpec(
        endpoint.method,
        url,
        headers,
        content,
        endpoint.binary,
        endpoint.method == "GET" or endpoint.idempotent_post,
    )


def request_from_spec(spec: RequestSpec, timeout: float) -> httpx.Request:
    # Explicit Request + send(auth=None) avoids default client cookies/auth/header merging.
    return httpx.Request(
        spec.method,
        spec.url,
        headers=spec.headers,
        content=spec.content,
        extensions={"timeout": httpx.Timeout(timeout).as_dict()},
    )


def parse_retry_after(value: str | None, *, now: float | None = None) -> float | None:
    if value is None:
        return None
    try:
        seconds = float(value)
        if math.isfinite(seconds):
            return max(0.0, seconds)
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(value).timestamp()
        return max(0.0, math.ceil(when - (time.time() if now is None else now)))
    except (ValueError, TypeError, OverflowError):
        return None


@dataclass(frozen=True)
class ResponseOutcome:
    payload: Any = None
    error: CastrookError | None = None


def parse_response(response: httpx.Response, spec: RequestSpec) -> ResponseOutcome:
    request_id = response.headers.get("x-request-id")
    retry_after = parse_retry_after(response.headers.get("retry-after"))
    if response.is_redirect:
        return ResponseOutcome(
            error=CastrookError(
                response.status_code,
                "unexpected_redirect",
                "The API returned a redirect. Check the canonical base_url.",
                request_id,
            )
        )
    if response.is_success and spec.binary:
        return ResponseOutcome(payload=response.content)
    try:
        payload = response.json()
    except (ValueError, UnicodeDecodeError):
        return ResponseOutcome(
            error=CastrookError(
                response.status_code,
                "invalid_response",
                "The API returned an invalid JSON response.",
                request_id,
                retry_after=retry_after,
            )
        )
    if response.is_success:
        if not isinstance(payload, dict) or "data" not in payload:
            return ResponseOutcome(
                error=CastrookError(
                    response.status_code,
                    "invalid_response",
                    "The API returned an invalid response envelope.",
                    request_id,
                )
            )
        return ResponseOutcome(payload=payload)
    data = payload if isinstance(payload, dict) else {}
    error = data.get("error")
    error = error if isinstance(error, dict) else {}
    payload_request_id = data.get("request_id")
    if request_id is None and isinstance(payload_request_id, str):
        request_id = payload_request_id
    code = error.get("code")
    message = error.get("message")
    return ResponseOutcome(
        error=CastrookError(
            response.status_code,
            code if isinstance(code, str) else "request_failed",
            message if isinstance(message, str) else "Request failed.",
            request_id,
            error.get("details"),
            retry_after,
        )
    )


def retry_delay(
    spec: RequestSpec, error: CastrookError, attempt: int, max_retries: int
) -> float | None:
    if not spec.retryable or attempt >= max_retries:
        return None
    if error.code == "usage_limit_exceeded" or error.code.startswith("account_"):
        return None
    transient = error.status == 0 or error.status == 429 or error.status >= 500
    if not transient:
        return None
    if error.retry_after is not None:
        return error.retry_after if error.retry_after <= 30 else None
    return min(0.5 * 2.0**attempt, 5.0)


def transport_error(error: httpx.TransportError) -> CastrookError:
    code = "request_timeout" if isinstance(error, httpx.TimeoutException) else "connection_error"
    return CastrookError(
        0,
        code,
        "The request could not be confirmed. Recover the original operation before starting another write.",
    )


def next_cursor(page: Any, seen: set[str]) -> str | None:
    if not isinstance(page, dict) or not isinstance(page.get("data"), list):
        raise CastrookError(502, "invalid_pagination", "The API returned an invalid page.")
    meta = page.get("meta")
    if not isinstance(meta, dict) or not isinstance(meta.get("has_more"), bool):
        raise CastrookError(
            502, "invalid_pagination", "The API returned invalid pagination metadata."
        )
    if not meta["has_more"]:
        return None
    cursor = meta.get("next_cursor")
    if not isinstance(cursor, str) or not cursor or cursor in seen:
        raise CastrookError(
            502, "invalid_pagination", "The API returned a missing or repeated cursor."
        )
    seen.add(cursor)
    return cursor
