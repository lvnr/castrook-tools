---
name: castrook-publish
description: Prepare and publish or schedule authorized content through Castrook with durable media, destination-specific validation, stable idempotency and per-target delivery tracking. Use for real publishing workflows or Test simulations, including carousels and Stories.
---

# Publish with Castrook

Read https://castrook.com/guides/workflows.md and the relevant https://castrook.com/docs/content / https://castrook.com/docs/platforms contracts. Discover current MCP schemas or use the existing CLI/SDK. Preserve the requested integration path.

## Resolve the intended action

Start in Test unless Live is explicit. Inspect account mode, profile, connected status, publishing capability and current usage. Existing authorization persists for the content/destinations/schedule it covers; do not add another permission round for routine authorized work. If a material live destination, content choice or schedule is unspecified, prepare the reviewable content and resolve that missing choice before publishing.

OAuth/API access is not TikTok per-post consent. Before each live TikTok post, use `get_publishing_options` (REST `GET /accounts/{id}/publishing-options`), show a loadable preview, current creator identity/limits, manually selected privacy, permitted interactions, music-use notices and commercial disclosures. Set `consent:true` only after the creator actually approves that exact content and schedule. Do not infer it from an earlier post, OAuth or generic unattended posting permission.

## Upload and validate

Prefer durable `asset_id` media for scheduling. CLI `media upload FILE` or SDK `media.upload` hashes, transfers and verifies the file. For individual stages: create an upload ticket, PUT original bytes using only its returned headers, then complete verification. Do not send a Castrook credential to storage.

Keep the pending asset ID on ambiguous transfer errors. PUT 412 still requires authoritative completion verification. Recover with get/complete before creating a replacement. Limits: videos 128 MiB; still JPEG/PNG/WebP images 20 MiB and 24 MP. Ready assets are private. Unused files expire after 30 days; pending scheduled/queued work pins files through terminal delivery.

Use selected `account_ids`, required `text`, optional `profile_id` and either legacy `media` or ordered `media_items`. Each media item has `type` plus exactly one `url` or `asset_id`. `destinations` can override caption, media, format and options per selected account; `text:""` clears a shared caption.

Supported bounds:
- TikTok: one video or up to 35 photos; no mixed media. Photo controls show comments, not Duet/Stitch.
- Instagram: professional feed/Reel or up to 10 mixed carousel items; Stories need a Business account, one asset and empty caption.
- Facebook: Page feed text/up to 10 photos/one video or Reel; Stories one asset and empty caption.
- YouTube: one video with explicit privacy and `made_for_kids`; no carousel/Story. YouTube determines Shorts presentation.

Format precedence: destination format → destination options format → shared format → platform options format. All supplied formats must be valid even when overridden. Use caption/platform limits from the actual schema rather than truncating the user's content silently.

## Preserve one logical request

Persist the exact JSON and an 8–128-character idempotency key before creating a post. MCP `create_post` takes `{post:<REST body>,idempotency_key}`. CLI uses `posts create --data @post.json --idempotency-key KEY`. REST requires `Idempotency-Key`.

On an interrupted creation, retry only the same body and key. Changed text, media order, destination or schedule is a new logical action with a new key. Never generate a new key merely to bypass uncertainty.

`scheduled_at` is an ISO timestamp with timezone, 5 seconds to 365 days ahead. API acceptance is asynchronous and not proof of publication. Track post/target state or verified signed webhooks until terminal; preserve successes when other destinations fail. Canceling pending work does not delete published content and can conflict once delivery begins.

For monthly usage/capacity errors, inspect usage/reset or the plan instead of retrying loops. For uncertain live writes, inspect the existing request and provider error before proposing recovery. Report final per-destination results and remaining uncertainty accurately.
