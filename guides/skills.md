# Castrook integration skills

Version: 2026-10-02
Canonical: https://castrook.com/guides/skills.md
Human guide: https://castrook.com/docs/skills

## Install

The public source repository is lvnr/castrook-tools. Install its product-owned integration skills:

```sh
npx skills add lvnr/castrook-tools
```

Choose your coding agent in the installer. The skills are product-owned MIT integration guidance; they do not install credentials or grant account access. Authenticate separately using MCP OAuth, castrook login, or a server-held API key.

## Choose a task

- castrook-connect: connect an agent or server integration, inspect mode/scopes, verify harmless reads, recover expired/revoked credentials.
- castrook-onboard-customers: create/reuse customer profiles, private hosted/embedded connection sessions and verified completion.
- castrook-publish: preview and validate per-destination content, use durable assets, preserve idempotency, schedule and inspect asynchronous results.
- castrook-diagnose: inspect capabilities, usage, post targets, analytics availability, request IDs and webhook delivery without speculative retries.

Invocation syntax depends on the host. In a skill-aware coding agent, request the matching skill by name. Test mode is the starting point unless your instruction explicitly authorizes Live. Existing authorization persists for the action it actually covers; the skills do not impose another approval round for routine authorized work.

## Guardrails that matter

No credential is placed in browser bundles, command arguments, screenshots or public code. Hosted connection URLs and direct PUT URLs are temporary capabilities and should be shared only with their intended recipient.

OAuth access is not social-platform account consent, TikTok per-post approval or YouTube analytics policy acceptance. Skills do not manufacture those attestations. Live publishing needs authorized content/destinations/schedule; destructive actions must be in scope.

The guides reflect implemented APIs, not blanket platform approval. They route unsupported TikTok comments to an honest limitation and leave missing performance metrics unavailable. Use https://castrook.com/agents.json and https://castrook.com/api/openapi for the current contract.
