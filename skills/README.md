# Castrook integration skills

Product-owned MIT guidance for connecting agents, onboarding customers, publishing safely and diagnosing delivery.

Install from the public distribution repository once source access is verified:

```sh
npx skills add lvnr/castrook-tools
```

| Skill | Task |
| --- | --- |
| castrook-connect | Authenticate, choose mode/scopes and verify read access |
| castrook-onboard-customers | Profiles and private hosted/embedded connection sessions |
| castrook-publish | Validate content, upload durable media, preserve idempotency and track delivery |
| castrook-diagnose | Actual failures, permissions, quota, metrics and bounded recovery |

Skills contain no credentials and grant no account access. Authenticate through https://castrook.com/mcp, `castrook login` or a server-held API key. Test mode is the starting point. Existing user authorization is respected; platform consent and legal acceptance cannot be fabricated.

Maintained contract: https://castrook.com/guides/workflows.md. Schemas: https://castrook.com/api/openapi. Machine manifest: https://castrook.com/agents.json.

Each skill includes discoverable `SKILL.md` frontmatter and `agents/openai.yaml` metadata. No third-party skills or private SaaS source are included.
