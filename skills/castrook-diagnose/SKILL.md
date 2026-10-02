---
name: castrook-diagnose
description: Diagnose Castrook delivery, account permissions, usage, media verification, comments, analytics and webhook failures using actual states and request IDs. Use for troubleshooting and bounded recovery, not speculative live publishing or automatic policy acceptance.
---

# Diagnose Castrook

Read https://castrook.com/guides/workflows.md and https://castrook.com/docs/errors. Use the current OpenAPI/tool schema and the user's existing authenticated integration.

## Inspect before retrying

Start with reads: account capabilities/status/profile/mode, usage, the post and each target, request logs/request ID, asset verification status and webhook delivery attempts. Confirm tenant/mode/resource before concluding an account or post is missing.

`get_usage` needs `usage:read` for OAuth; API keys implicitly read their own usage. MCP API errors return `isError` with structured `http_status`, request ID, mode and retry metadata. Preserve these values in a concise diagnosis; never include credentials, upload tickets, connection capabilities or unrelated customer content.

Distinguish accepted/scheduled/queued/processing from published. A provider-post ID or historic success does not prove the post is currently public. Partial failure leaves other destinations' successes intact.

## Choose the actual recovery

- 401/403: correct authentication, expiry, resource or approved scopes. Do not retry continuously or silently expand a grant.
- `usage_limit_exceeded`, account allowance/capacity failures: read remaining/reserved/reset. Wait for reset or use an already authorized workspace/plan change; no blind retry or paid upgrade.
- Idempotency conflict: inspect the saved logical request. The same key belongs to the same exact body; changed content needs a new authorized action, not a disguised retry.
- Media ambiguity: preserve the asset ID and inspect/complete. PUT 412 is not success by itself. Size/type/checksum failures require correct source bytes; in-use media cannot be deleted.
- Pending delivery: inspect target attempts/provider reason and polling state. Do not enqueue another live post to resolve an uncertain write.
- Comments: check account capability and provider access. Public TikTok posting approval does not provide comment management.
- Webhooks: inspect endpoint enabled state, response codes, attempts and signature verification of the original raw body. Deduplicate event IDs; do not expose a stored signing secret.
- Analytics: inspect status/reason, coverage and last refresh. Missing counters are null/absent, not zero. Refresh only with authorization and within the 5-minute cooldown.

A date filter selects posts; snapshots are cumulative counters, not newly earned engagement during the selected dates. Do not sum repeated snapshots as extra views.

For `privacy_consent_required`, explain the account-owner acceptance step. Never call the analytics acceptance endpoint merely to remove an error. Current policy consent must be explicit and bound to the active YouTube authorization; reconnecting needs a new receipt.

## Act within the repair request

Use bounded transient retries only where the contract permits them and respect `Retry-After`. A comment reply/profile creation/webhook creation is not automatically retry-idempotent. Inspect after ambiguity rather than repeating.

Carry out reversible authorized repairs when the evidence supports them. Request missing authentication or a material unresolved live/destructive choice only when necessary. Do not disconnect accounts, cancel pending posts, delete assets or broaden access simply because those actions could make a warning disappear.

Report the observed cause, request/post/target IDs, any completed repair and the next concrete external gate. Code readiness is separate from provider permission/review approval; refer to https://castrook.com/docs/platforms#status rather than claiming universal live availability.
