---
name: castrook-onboard-customers
description: Create or reuse Castrook customer profiles and secure hosted or embedded onboarding sessions, then verify connected account IDs. Use when a product or agency needs customers to authorize their social accounts without exposing server credentials.
---

# Onboard a Castrook customer

Read https://castrook.com/guides/workflows.md and https://castrook.com/docs/profiles for the current profile/session contract. Use the configured MCP, CLI or SDK; keep the user's existing integration path.

## Identify the customer and mode

Use Test unless the instruction explicitly calls for Live. Resolve the external customer ID through `GET /profiles?external_id=...` before creating a duplicate. Never identify a tenant only by a display name. Profiles, accounts and sessions must belong to the same workspace and mode.

Read/create profiles with `profiles:read`/`profiles:write`. Session creation/revocation uses `accounts:write`, status reads use `accounts:read`. In MCP use `list_profiles`, `create_profile`, `create_connection_session` and `get_connection_session` with their discovered schemas.

Profile creation is not retry-idempotent. After an ambiguous failure, recover using the external ID before creating another. Do not move an existing connected account between customers just to make a request succeed; pending resources can block account reassignment.

## Issue a private connection link

`POST /connect-sessions` takes `profile_id`, explicit `platforms` and optional exact `embed_origin`/`return_url`. Use the customer's real application origin; no wildcards. The returned `session.url` is a temporary capability. Send it only to the intended customer or embed it on their authorized page. Never place the Castrook credential in client-side code.

The customer does not need a Castrook login. They use provider OAuth in a top-level popup; the hosted portal handles platform consent and errors. Let the account owner sign in and select their actual account. Do not bypass their authorization, import platform access tokens, or turn Test results into live connection claims.

Hosted YouTube onboarding has an unchecked privacy/terms acceptance step before OAuth. Existing connections require the current policy receipt for performance data. Never accept a policy or fabricate the receipt for the account owner unless their explicit authorization covers it.

## Verify completion

For `castrook.connection` iframe events, require all of:

- `event.origin` equals the Castrook origin.
- `event.source` equals that iframe's `contentWindow`.
- `event.data.type` is exactly `castrook.connection`.
- `event.data.session_id` matches the issued session.

Then re-fetch the session/accounts from the server and verify connected status, expected profile and requested platform. A browser message alone is not continuing authorization. Completion exposes IDs/status, never credentials. A historical completed session can have no currently connected account.

Expired/revoked sessions need a new link. Revoking an unfinished session is distinct from disconnecting an account. Deleting a profile with accounts/posts/assets is refused; do not delete associated customer resources to bypass the guard.

Return the profile ID, verified connected account IDs, actual status and private next-step link only when appropriate. Preserve failed/unsupported platform states rather than announcing full onboarding success.
