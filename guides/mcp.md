# Castrook MCP

Version: 2026-10-02
Canonical: https://castrook.com/guides/mcp.md
Human guide: https://castrook.com/docs/mcp

## Connect

Add this remote Streamable HTTP MCP server to an OAuth-capable client:

```text
https://castrook.com/mcp
```

Complete Castrook sign-in and inspect the unverified requesting app name, exact callback origin, workspace, mode and permissions. The initial mode is Test unless the protocol explicitly requested another mode. Read permissions are selected initially; write permissions require an explicit selection. Remove permissions you do not need. Allow grants exactly the selected access; Cancel grants nothing.

Test and Live credentials are distinct. A local flag or request header cannot turn a Test OAuth grant into Live access. OAuth does not authorize a real social post or legal acceptance on an account owner's behalf. The CLI uses the same consent flow.

## OAuth discovery

- Authorization-server metadata: https://castrook.com/.well-known/oauth-authorization-server
- MCP protected-resource metadata: https://castrook.com/.well-known/oauth-protected-resource/mcp
- REST protected-resource metadata: https://castrook.com/.well-known/oauth-protected-resource/api/v1

Public clients use authorization-code + S256 PKCE, exact registered callbacks, state verification, resource-bound expiring access tokens and rotating refresh tokens. Register through /oauth/register or a supported HTTPS client metadata document. Authorization is /oauth/authorize; token exchange/refresh is /oauth/token; revocation is /oauth/revoke. Use the metadata's canonical endpoints. Only HTTPS remote callbacks and exact HTTP loopback IP callbacks are supported, not custom URI schemes. No client secret/password grant or platform-token passthrough.

The token resource is exactly https://castrook.com/mcp for MCP or https://castrook.com/api/v1 for REST. Do not reuse a grant for a different resource or turn a Test token into Live through a request header.

## Discover rather than guess

Initialize the MCP connection, then call tools/list. Inputs are typed and validated through the same REST handlers as the API. create_post takes {post:<REST payload>,idempotency_key:"stable-action-key"}; it does not take a flat post body. Use the tools' published schemas, descriptions and annotations. Read resources/list and prompts/list for maintained contract and task guidance. Resources are castrook://guides/{mcp,cli,typescript,python,skills,workflows} and castrook://manifest. Prompts are publish_safely and onboard_customer. The machine manifest is https://castrook.com/agents.json and REST schemas are at https://castrook.com/api/openapi.

Begin by reading accounts and current usage. Check account mode, profile, connection status and capability flags before proposing content. Read publishing options for a live TikTok account before collecting creator choices.

## Publication

Start in Test. A post creation returns acceptance and a post ID, not publication. Inspect each target using the post retrieval tool or verified webhooks. Keep one idempotency key and exactly the same post JSON for retries of the same action. A changed caption, asset order, schedule or destination is a new action requiring a new key.

For Live, the user's instruction must authorize the actual accounts, content and schedule. TikTok additionally requires the creator-facing preview, current creator settings, selected privacy, disclosures and exact per-post consent; never manufacture consent:true for unattended content.

Tool annotations describe read, write and destructive effects. They do not replace user authorization. Disconnecting an account, revoking an onboarding link, deleting media, canceling a post or disabling a webhook changes the workspace.

## Expiry and revocation

Access tokens expire. OAuth-capable clients refresh using rotating refresh tokens. Reusing a consumed refresh token revokes the family. Restart the connection when a grant expires or is revoked; do not retry authorization failures as transient errors.

The signed-in owner can inspect and revoke access in https://castrook.com/dashboard/developers under Agents. Revocation invalidates the grant's tokens. API keys remain separately managed.

## Limits

MCP has the same quotas, API errors and platform access as REST. OAuth requires usage:read for usage; API keys can read their own usage without an additional scope. Insufficient protocol scope returns HTTP 403 with WWW-Authenticate. REST errors are tool results with isError and structuredContent containing http_status/request_id/mode and retry metadata. It does not bypass TikTok comment restrictions, Meta professional/Page requirements, YouTube review restrictions or the explicit YouTube analytics policy receipt. No approval on every platform is claimed.
