"""Stable API errors, including useful quota and retry metadata."""

from typing import Any


class CastrookError(Exception):
    """An API, transport or protocol failure. ``status=0`` means no response was confirmed.

    A transport failure on a write can be ambiguous. Reuse the original post's
    idempotency key or recover an upload by completing its pending ``asset_id``.
    """

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        request_id: str | None = None,
        details: Any = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id
        self.details = details
        self.retry_after = retry_after

    def is_usage_limit(self) -> bool:
        return self.code == "usage_limit_exceeded"

    def is_account_limit(self) -> bool:
        return self.code in {"account_limit_reached", "account_capacity_exceeded"}

    def is_rate_limit(self) -> bool:
        return self.code == "rate_limit_exceeded"

    def __repr__(self) -> str:
        return f"CastrookError(status={self.status}, code={self.code!r}, request_id={self.request_id!r})"
