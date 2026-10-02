"""Shared bounded polling rules."""

import math
import time
from typing import Any

from .errors import CastrookError


def poll_settings(timeout: float, poll_interval: float) -> tuple[float, float]:
    if isinstance(timeout, bool) or not math.isfinite(timeout) or not 0 < timeout <= 3600:
        raise ValueError("Polling timeout must be between 0 and 3600 seconds.")
    if (
        isinstance(poll_interval, bool)
        or not math.isfinite(poll_interval)
        or not 0.1 <= poll_interval <= 60
    ):
        raise ValueError("poll_interval must be between 0.1 and 60 seconds.")
    return time.monotonic() + timeout, poll_interval


def terminal_post(result: Any) -> bool:
    post = result.get("data") if isinstance(result, dict) else None
    if not isinstance(post, dict) or not isinstance(post.get("status"), str):
        raise CastrookError(502, "invalid_response", "The API returned an invalid post.")
    return post["status"] in {"published", "partially_failed", "failed", "canceled"}


def poll_timeout(id: str | None) -> CastrookError:
    return CastrookError(
        0,
        "poll_timeout",
        "The post is still pending. Retrieve its status before starting another publication.",
        details={"post_id": id},
    )
