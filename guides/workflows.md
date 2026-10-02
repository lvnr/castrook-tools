# Castrook task contract

Version: 2026-10-02
Canonical: https://castrook.com/guides/workflows.md
Human guide: https://castrook.com/docs/reference

## Authority and authentication

Canonical REST resource: https://castrook.com/api/v1. MCP endpoint: https://castrook.com/mcp. OpenAPI: https://castrook.com/api/openapi. Machine manifest: https://castrook.com/agents.json. The manifest maps current REST operations and tool references; use tools/list for actual MCP input schemas.

Success JSON is {data,meta?}; errors are {error:{code,message,details?},request_id}. x-request-id correlates diagnostics. Bearer credentials determine workspace/mode/scopes and resource. MCP grants bind https://castrook.com/mcp; REST/CLI grants bind https://castrook.com/api/v1. OAuth usage reads require usage:read, while API keys have implicit access to their own usage. Do not send dashboard session headers to override a bearer grant. API keys cannot create other keys; OAuth tools cannot create keys or return platform credentials.

## Customer onboarding

Search existing profiles by external_id before creating a duplicate. profiles:read reads, profiles:write creates/edits/deletes. Connection sessions use accounts:write to create/revoke and accounts:read to inspect. They require a profile in the same workspace/mode and explicit platforms. Account assignment uses PATCH /accounts/{id} with profile_id or null.

Send a new session.url privately to the customer or embed it in the exact configured embed_origin. The customer needs neither a Castrook login nor your API key. OAuth opens in a top-level popup.

For castrook.connection events verify origin===Castrook origin, source===iframe.contentWindow and session_id===the issued session ID, plus the exact event type. Then re-fetch the session/account from your server before treating it as current authorization. Messages contain IDs/status, no credentials. Expired/revoked sessions require a new link. Deleting a profile with resources is refused; it never silently disconnects accounts.

## Media

POST /media/uploads takes filename,size,content_type,sha256 (lowercase SHA-256 of original bytes), optional profile_id. The ticket includes a private PUT URL, exact headers and expiry. PUT original bytes with only those headers, then POST /media/{id}/complete. The service checks actual bytes and freezes the asset; status ready is required before publishing.

Keep the asset ID on uncertain network errors. PUT 412 means an object may already exist: complete and verify before deciding success/failure. Never resend a Castrook credential to storage. Image bounds: still JPEG/PNG/WebP, 20 MiB, 24 MP. Video bound: 128 MiB. Unused retention: 30 days; queued/scheduled references pin an asset until terminal delivery. In-use deletion is refused. Private content uses authenticated GET/HEAD /media/{id}/content.

## Content and publication

POST /posts requires one persisted 8–128-character Idempotency-Key and exact post JSON. text and selected account_ids are required; provide either legacy media or ordered media_items, not both. Each item has type plus exactly one url or asset_id. profile_id binds every destination.

destinations overrides each selected account's text/media/format/options. Explicit text:"" clears shared text. Format precedence is destination.format, destination.options.format, shared format, then platform_options[platform].format. Every raw option format still must be valid, even when a higher-precedence format wins.

Provider bounds:
- TikTok: one video or up to 35 photos, no mixed media. Read current creator settings; require loaded preview, current privacy choice, permitted interactions, music/commercial notices and exact creator approval. Photos show Comment control only; no Duet/Stitch.
- Instagram: professional account; feed image, Reel, up to 10 ordered image/video carousel items. Stories require a Business account, one image/video and empty caption.
- Facebook: Page; feed text, up to 10 photos or one video/Reel; Stories one image/video and empty caption.
- YouTube: one video, explicit privacy and made_for_kids; no carousel or Story. Shorts eligibility/display is decided by YouTube.

Instagram feed/carousel images outside 4:5–1.91:1 receive white padding preserving the full composition within 1080×1350. Stories/TikTok retain original aspect. Managed JPEG copies remove private metadata. Source URLs must remain available until ingestion; asset_id is preferred for durable schedules.

scheduled_at is 5 seconds to 365 days ahead with a timezone. 202 is acceptance, not publication. Track targets until terminal states; successful destinations remain successful after other failures. DELETE /posts/{id} cancels pending work before delivery and never deletes already-published social content. Do not blindly repeat ambiguous live writes or invent provider success.

## Performance and comments

analytics:read returns cached cumulative counters with coverage and fetched_at; analytics:write refreshes within a 5-minute cooldown/lease. Missing metrics are absent/null with reasons, not zeros. A date filter selects posts by creation date; it does not turn lifetime counters into engagement during that date interval.

Existing YouTube performance requires an explicit current policy receipt bound to authorization. Only after the account owner's acceptance may you POST /accounts/{id}/analytics-consent with accepted:true and privacy_policy_version:"2026-10-02" using accounts:write. Hosted YouTube onboarding collects the legal acceptance explicitly before OAuth. Reconnection needs a new receipt. Never auto-accept to repair unavailable metrics.

Read/reply to comments only when account.capabilities.comments and access allow it. Public TikTok Content Posting has no comment management; no MCP/CLI/SDK can bypass that limit.

## Diagnostics and recovery

Read the post's target error, account capabilities/status, current usage, request logs/request ID and webhook delivery attempts before modifying anything. Keep list filters stable while passing meta.next_cursor unchanged. Recovery reads, cancellation and exact post replays are monthly-request exempt but still authenticated/rate-limited.

401/403 require corrected auth/scopes. Monthly 429 usage_limit_exceeded and account_limit_reached/capacity conflicts require reset or a workspace change, not a retry loop. For ordinary transient/rate failures, respect Retry-After and bounded retry rules. Preserve successful targets and the logical post identity. Webhooks use signed raw-body verification and deduplicate event IDs.

Code readiness is separate from a provider review/permission grant. Expanded formats/insights may need provider demos and approval; consult https://castrook.com/docs/platforms#status rather than claiming universal approval.
