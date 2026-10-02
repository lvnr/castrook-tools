---
name: castrook-connect
description: Connect an agent or server integration to Castrook through MCP OAuth, the CLI, or a server-held API key, and verify scoped Test/Live access. Use for authentication and credential recovery, not customer social-account onboarding.
---

# Connect to Castrook

Read the current connection contract at https://castrook.com/guides/mcp.md or https://castrook.com/guides/cli.md for the selected client. API schemas are at https://castrook.com/api/openapi; https://castrook.com/agents.json maps REST operations to MCP tools.

## Choose the existing integration path

Preserve the user's chosen client and authentication method. Prefer an available OAuth-capable MCP connection at https://castrook.com/mcp; use the `castrook` CLI for terminal/script workflows or the SDK/REST for server code. Do not install another tool merely to complete a harmless read.

Start in Test unless the user explicitly requested Live. Test credentials cannot be switched to Live by a header or local flag. A grant is bound to one workspace, mode, resource and selected scopes.

For a new OAuth connection, direct the user through Castrook sign-in and the owner consent screen. The screen displays an unverified app name, callback origin, workspace, mode and permissions. Read scopes start selected; write scopes require explicit selection. Never approve the app or select Live/write permissions on the owner's behalf without authorization already covering that access.

CLI entrypoints: `castrook login`, `castrook whoami`, `castrook accounts list --json`, `castrook usage --json`. `login --publish` requests post/media writes; creating a new Test account also requires `accounts:write`. Use `--scopes` for the minimum scope set the task needs.

API keys stay in `CASTROOK_API_KEY` or a secure server secret. Do not ask the user to paste a key into chat. Do not put secrets in arguments, browser bundles, examples, logs or committed configuration. CLI OAuth credentials use a restricted local file; never print it.

## Verify before modifying data

Use accounts and usage reads to confirm the actual workspace/mode and account capabilities. OAuth usage reads require `usage:read`; API keys implicitly read their own usage. MCP grants bind https://castrook.com/mcp; REST/CLI grants bind https://castrook.com/api/v1. Do not reuse a token for another resource.

Report connected access accurately. A working Test read is not a live platform approval or publication. If more scopes are needed, reconnect with those requested scopes and let the owner make the new consent choice; do not silently broaden an existing grant.

On 401/403, inspect expiry/scopes/resource instead of retrying continuously. OAuth clients rotate refresh tokens; reusing a consumed refresh token revokes the token family. Reconnect after revocation or expiry. The owner can revoke grants under Developers → Agents; API keys are separate.

Connection authorization does not supply TikTok per-post creator consent or YouTube analytics legal acceptance. Handle customer social-account OAuth with the customer-onboarding workflow, not by importing platform credentials.
