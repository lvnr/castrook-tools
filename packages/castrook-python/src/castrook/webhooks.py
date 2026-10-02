"""Webhook verification for the exact raw request body before JSON parsing."""

import hashlib
import hmac
import math
import re
import time


def verify_webhook(
    *,
    secret: str,
    id: str,
    timestamp: str,
    signature: str,
    body: str | bytes,
    tolerance_seconds: float = 300,
    now: float | None = None,
) -> bool:
    """Validate HMAC + bounded clock skew. Deduplicate the event ID separately.

    ``timestamp`` is the webhook-timestamp header, in seconds. ``now`` is Unix
    seconds (not milliseconds); it is injectable for deterministic tests.
    """
    if not re.fullmatch(r"[0-9]+", timestamp) or not re.fullmatch(r"v1=[a-f0-9]{64}", signature):
        return False
    # Avoid unbounded integer parsing of an untrusted header.
    if len(timestamp) > 16:
        return False
    when = int(timestamp)
    current = time.time() if now is None else now
    if (
        when > 2**53 - 1
        or not math.isfinite(current)
        or not math.isfinite(tolerance_seconds)
        or tolerance_seconds < 0
        or abs(current - when) > tolerance_seconds
    ):
        return False
    raw = body.encode("utf-8") if isinstance(body, str) else body
    signed = f"{id}.{timestamp}.".encode() + raw
    expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature[3:], expected)
