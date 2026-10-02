# Castrook tools

Official MIT-licensed SDKs, CLI and integration skills for [Castrook](https://castrook.com).

| Interface | Start |
| --- | --- |
| Hosted MCP + OAuth | Add `https://castrook.com/mcp` as a Streamable HTTP server. [Guide](https://castrook.com/docs/mcp) |
| TypeScript + CLI | `npm install castrook` or `npm install -g castrook`. [Guide](https://castrook.com/docs/cli) |
| Python | `python -m pip install castrook`. [Guide](https://castrook.com/docs/python) |
| Integration skills | `npx skills add lvnr/castrook-tools`. [Guide](https://castrook.com/docs/skills) |
| Machine contract | [OpenAPI](https://castrook.com/api/openapi), [manifest](https://castrook.com/agents.json), [complete guides](https://castrook.com/llms-full.txt) |

Registry release status is stated in [agents.json](https://castrook.com/agents.json). Before the first registry release, use the matching downloadable artifacts linked there.

The CLI starts with `castrook login` in Test mode. Review workspace, mode and scopes in the browser. Publishing scopes require explicit selection; Live uses real connected accounts. API-key integrations read `CASTROOK_API_KEY` from their server environment. Never put credentials in browser bundles, URLs, scripts or logs.

Create posts with a persistent body and idempotency key, then inspect every destination's result. Queued is not published. Use verified assets for schedules. TikTok requires fresh creator choices and explicit consent for the exact content; skills and OAuth cannot supply that consent. Provider approval and capability limits still apply.

## Repository

- `packages/castrook-sdk`: zero-runtime-dependency TypeScript client + Node.js CLI.
- `packages/castrook-python`: typed sync/async Python client.
- `skills`: four installable task skills.
- `guides`, `openapi.json`, `agents.json`: exported maintained contracts.
- `examples`: matching SDK/task examples.

This repository contains public distribution code only. The hosted application and infrastructure remain private. Issues should include a request ID and redacted error; never include tokens, signed media links or customer content.

## Contributing and checks

```sh
npm ci
npm run check
python -m venv .venv
.venv/bin/python -m pip install -e 'packages/castrook-python[dev]' PyYAML
.venv/bin/python -m pytest packages/castrook-python/tests
cd packages/castrook-python
../../.venv/bin/python -m mypy
../../.venv/bin/python -m ruff check src tests
../../.venv/bin/python -m build
```

Distribution is exported from the private app with an explicit file allowlist; do not copy app code, setup evidence or secrets into this repo. `publish.yml` publishes Python with short-lived GitHub/PyPI OIDC credentials from the protected `pypi` environment. Package versions and guides are checked together before release.
