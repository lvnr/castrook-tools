"""Dictionary-shaped types matching Castrook's JSON wire contract.

Missing analytics metrics are absent/null, never assumed to be zero. Timestamps
are ISO 8601 strings. Test data is explicitly identified by the response's mode.
"""

from typing import Any, Generic, Literal, TypeVar

from typing_extensions import NotRequired, TypedDict

T = TypeVar("T")
Platform = Literal["tiktok", "instagram", "facebook", "youtube"]
Mode = Literal["test", "live"]
PostStatus = Literal[
    "scheduled", "queued", "publishing", "published", "partially_failed", "failed", "canceled"
]
ContentFormat = Literal["feed", "reel", "story", "video"]
PerformanceMetric = Literal["views", "reach", "likes", "comments", "shares", "saves"]
MediaContentType = Literal[
    "image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"
]
WebhookEventType = Literal[
    "post.published", "post.failed", "post.partially_failed", "post.canceled"
]
PlanId = Literal["free", "starter", "growth", "scale"]
UsageMetric = Literal[
    "publications", "media_bytes", "api_requests", "comment_requests", "new_connections"
]
TikTokPrivacy = Literal[
    "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"
]


class Result(TypedDict, Generic[T]):
    data: T


class PageMeta(TypedDict):
    next_cursor: str | None
    has_more: bool


class Page(TypedDict, Generic[T]):
    data: list[T]
    meta: PageMeta


class AccountCapabilities(TypedDict):
    publish: bool
    comments: bool
    analytics: NotRequired[bool]


class AnalyticsConsentReceipt(TypedDict):
    privacy_policy_version: str
    accepted_at: str


class Account(TypedDict):
    id: str
    profile_id: NotRequired[str]
    platform: Platform
    name: str
    username: str
    status: Literal["connected", "disconnected", "expired"]
    capabilities: AccountCapabilities
    mode: Mode
    created_at: str
    updated_at: str
    analytics_consent: NotRequired[AnalyticsConsentReceipt]


class AnalyticsConsentInput(TypedDict):
    """Only submit after explicit account-owner acceptance; never infer consent."""

    accepted: Literal[True]
    privacy_policy_version: Literal["2026-10-02"]


class CreateTestAccountInput(TypedDict):
    platform: Platform
    profile_id: NotRequired[str]
    name: NotRequired[str]
    username: NotRequired[str]


class Profile(TypedDict):
    id: str
    name: str
    external_id: NotRequired[str]
    mode: Mode
    created_at: str
    updated_at: str


class CreateProfileInput(TypedDict):
    name: str
    external_id: NotRequired[str]


class UpdateProfileInput(TypedDict, total=False):
    name: str
    external_id: str | None


class DeletedResource(TypedDict):
    id: str
    deleted: Literal[True]


class ConnectSession(TypedDict):
    id: str
    profile_id: str
    mode: Mode
    platforms: list[Platform]
    expires_at: str
    created_at: str
    status: Literal["open", "completed", "revoked", "expired"]
    account_ids: list[str]
    return_url: NotRequired[str]
    embed_origin: NotRequired[str]


class ConnectSessionCreated(ConnectSession):
    """The URL is a private, expiring capability for this customer's onboarding."""

    url: str


class CreateConnectSessionInput(TypedDict):
    profile_id: str
    platforms: list[Platform]
    return_url: NotRequired[str]
    embed_origin: NotRequired[str]
    expires_in: NotRequired[int]


class TikTokPublishingOptions(TypedDict):
    platform: Literal["tiktok"]
    creator_username: str
    creator_nickname: str
    privacy_level_options: list[TikTokPrivacy]
    comment_disabled: bool
    duet_disabled: bool
    stitch_disabled: bool
    max_video_post_duration_sec: int


class TikTokOptions(TypedDict):
    """Show current creator controls and obtain approval for this exact content."""

    privacy_level: TikTokPrivacy
    consent: Literal[True]
    video_duration_sec: NotRequired[float]
    disable_comment: NotRequired[bool]
    disable_duet: NotRequired[bool]
    disable_stitch: NotRequired[bool]
    brand_content_toggle: NotRequired[bool]
    brand_organic_toggle: NotRequired[bool]
    is_aigc: NotRequired[bool]
    video_cover_timestamp_ms: NotRequired[int]
    format: NotRequired[Literal["feed", "video"]]
    title: NotRequired[str]
    photo_cover_index: NotRequired[int]
    auto_add_music: NotRequired[bool]


class YouTubeOptions(TypedDict):
    made_for_kids: bool
    format: NotRequired[Literal["video"]]
    title: NotRequired[str]
    privacy_status: NotRequired[Literal["private", "unlisted", "public"]]
    contains_synthetic_media: NotRequired[bool]
    tags: NotRequired[list[str]]
    category_id: NotRequired[str]


class InstagramOptions(TypedDict, total=False):
    format: Literal["feed", "reel", "story"]
    share_to_feed: bool
    alt_text: str


class FacebookOptions(TypedDict, total=False):
    format: Literal["feed", "reel", "video", "story"]
    title: str


class SandboxOptions(TypedDict):
    """Deterministic outcome override; rejected by live keys."""

    sandbox_outcome: Literal["published", "failed"]


class TikTokTestOptions(SandboxOptions):
    privacy_level: NotRequired[TikTokPrivacy]
    consent: NotRequired[Literal[True]]
    video_duration_sec: NotRequired[float]
    disable_comment: NotRequired[bool]
    disable_duet: NotRequired[bool]
    disable_stitch: NotRequired[bool]
    brand_content_toggle: NotRequired[bool]
    brand_organic_toggle: NotRequired[bool]
    is_aigc: NotRequired[bool]
    video_cover_timestamp_ms: NotRequired[int]
    format: NotRequired[Literal["feed", "video"]]
    title: NotRequired[str]
    photo_cover_index: NotRequired[int]
    auto_add_music: NotRequired[bool]


class YouTubeTestOptions(SandboxOptions):
    made_for_kids: NotRequired[bool]
    format: NotRequired[Literal["video"]]
    title: NotRequired[str]
    privacy_status: NotRequired[Literal["private", "unlisted", "public"]]
    contains_synthetic_media: NotRequired[bool]
    tags: NotRequired[list[str]]
    category_id: NotRequired[str]


class InstagramTestOptions(InstagramOptions):
    sandbox_outcome: Literal["published", "failed"]


class FacebookTestOptions(FacebookOptions):
    sandbox_outcome: Literal["published", "failed"]


class PlatformOptions(TypedDict, total=False):
    tiktok: TikTokOptions | TikTokTestOptions
    youtube: YouTubeOptions | YouTubeTestOptions
    instagram: InstagramOptions | InstagramTestOptions
    facebook: FacebookOptions | FacebookTestOptions


class LegacyMedia(TypedDict):
    url: str
    type: Literal["image", "video"]


class URLMediaItem(TypedDict):
    type: Literal["image", "video"]
    url: str


class AssetMediaItem(TypedDict):
    type: Literal["image", "video"]
    asset_id: str


MediaItem = URLMediaItem | AssetMediaItem


class DestinationContent(TypedDict):
    account_id: str
    text: NotRequired[str]
    media: NotRequired[LegacyMedia]
    media_items: NotRequired[list[MediaItem]]
    format: NotRequired[ContentFormat]
    options: NotRequired[
        TikTokOptions | YouTubeOptions | InstagramOptions | FacebookOptions | dict[str, Any]
    ]


class CreatePostInput(TypedDict):
    text: str
    account_ids: list[str]
    profile_id: NotRequired[str]
    media: NotRequired[LegacyMedia]
    media_items: NotRequired[list[MediaItem]]
    format: NotRequired[ContentFormat]
    destinations: NotRequired[list[DestinationContent]]
    scheduled_at: NotRequired[str]
    platform_options: NotRequired[PlatformOptions]


class PostTargetError(TypedDict):
    code: str
    message: str


class PostTarget(TypedDict):
    account_id: str
    platform: Platform
    status: Literal["queued", "publishing", "published", "failed", "canceled"]
    attempts: int
    provider_post_id: NotRequired[str]
    url: NotRequired[str]
    error: NotRequired[PostTargetError]


class Post(TypedDict):
    id: str
    profile_id: NotRequired[str]
    text: str
    media: NotRequired[LegacyMedia]
    media_items: NotRequired[list[MediaItem]]
    format: NotRequired[ContentFormat]
    destinations: NotRequired[list[DestinationContent]]
    platform_options: NotRequired[PlatformOptions]
    status: PostStatus
    scheduled_at: str | None
    created_at: str
    updated_at: str
    targets: list[PostTarget]
    mode: Mode


class MediaAsset(TypedDict):
    id: str
    profile_id: NotRequired[str]
    filename: str
    type: Literal["image", "video"]
    content_type: str
    size: int
    sha256: str
    status: Literal["pending", "ready", "deleting"]
    mode: Mode
    created_at: str
    expires_at: str
    in_use: bool
    preview_url: NotRequired[str]
    duration_sec: NotRequired[float]
    width: NotRequired[int]
    height: NotRequired[int]


class CreateMediaUploadInput(TypedDict):
    filename: str
    content_type: MediaContentType
    size: int
    sha256: str
    profile_id: NotRequired[str]


class MediaUpload(TypedDict):
    url: str
    method: Literal["PUT"]
    headers: dict[str, str]
    expires_at: str


class MediaUploadTicket(TypedDict):
    asset: MediaAsset
    upload: MediaUpload


class PerformanceMetrics(TypedDict, total=False):
    views: float
    reach: float
    likes: float
    comments: float
    shares: float
    saves: float


class AnalyticsRow(TypedDict):
    id: str
    post_id: str
    account_id: str
    platform: Platform
    profile_id: NotRequired[str]
    text: str
    post_created_at: str
    status: Literal["available", "unavailable", "pending"]
    metrics: PerformanceMetrics
    unavailable_metrics: list[PerformanceMetric]
    reason: NotRequired[str]
    fetched_at: str | None
    url: NotRequired[str]
    simulated: bool
    refresh_error: NotRequired[str]


class AnalyticsFilters(TypedDict, total=False):
    profile_id: str
    account_id: str
    platform: Platform
    from_: str
    to: str


class MetricCoverage(TypedDict):
    available: int
    total: int


class AnalyticsSummary(TypedDict):
    totals: dict[PerformanceMetric, float | None]
    coverage: dict[PerformanceMetric, MetricCoverage]
    post_count: int
    destination_count: int
    available_destinations: int
    last_refreshed_at: str | None
    mode: Mode


class AnalyticsRefresh(TypedDict):
    post_id: str
    refreshed: int
    rows: list[AnalyticsRow]
    cached: bool


class Comment(TypedDict):
    id: str
    text: str
    author: str
    created_at: str
    account_id: str
    post_id: str
    parent_id: NotRequired[str]
    like_count: NotRequired[int]


class ReplyCommentInput(TypedDict):
    account_id: str
    post_id: str
    comment_id: str
    text: str


class Webhook(TypedDict):
    id: str
    url: str
    description: str
    events: list[WebhookEventType]
    status: Literal["active", "disabled"]
    mode: Mode
    created_at: str


class WebhookCreated(Webhook):
    secret: str


class CreateWebhookInput(TypedDict):
    url: str
    events: list[WebhookEventType]
    description: NotRequired[str]


class Delivery(TypedDict):
    id: str
    webhook_id: str
    event: WebhookEventType
    post_id: str
    status: Literal["pending", "delivered", "failed"]
    attempts: int
    last_status: int | None
    last_error: str | None
    created_at: str
    next_attempt_at: str | None
    delivered_at: str | None


class RequestLog(TypedDict):
    id: str
    request_id: str
    method: str
    path: str
    status: int
    duration_ms: int
    key_id: str | None
    created_at: str


class UsageMeter(TypedDict):
    used: int
    reserved: int
    limit: int
    remaining: int
    reset_at: str


class UsageAccounts(TypedDict):
    used: int
    limit: int
    remaining: int


class UsagePeriod(TypedDict):
    start: str
    end: str


class UsageRateLimit(TypedDict):
    per_minute: int


class UsageSummary(TypedDict):
    mode: Mode
    plan: PlanId
    plan_source: Literal["subscription", "comp", "beta", "free"]
    catalog_version: str
    period: UsagePeriod
    reset_at: str
    grace_ends_at: str | None
    accounts: UsageAccounts
    publications: UsageMeter
    api_requests: UsageMeter
    media_bytes: UsageMeter | None
    comment_requests: UsageMeter | None
    new_connections: UsageMeter | None
    rate_limit: UsageRateLimit
    concurrent_ingests: int


class UsageLimitDetails(TypedDict):
    metric: UsageMetric
    mode: Mode
    plan: PlanId
    limit: int
    used: int
    reserved: int
    remaining: int
    reset_at: str
    upgrade_url: str
    retry_after_seconds: int


class AccountLimitDetails(TypedDict):
    mode: Mode
    plan: PlanId
    limit: int
    connected: int
    upgrade_url: str


class RateLimitDetails(TypedDict):
    retry_after_seconds: int
    limit: NotRequired[int]
