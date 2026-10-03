# Castrook tools

Official MIT-licensed SDKs, CLI and integration skills for [Castrook](https://castrook.com).

| Interface | Start |
| --- | --- |
| Hosted MCP + OAuth | Add `https://castrook.com/mcp` as a Streamable HTTP server. [Guide](https://castrook.com/docs/mcp) |
| TypeScript + CLI | `npm install castrook` or `npm install -g castrook`. [Guide](https://castrook.com/docs/cli) |
| Python | [Install the Python SDK](https://castrook.com/docs/python); the guide selects the verified registry release or downloadable wheel. |
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

## Local checks and release

Local checks are the primary release workflow. Use Node.js 22.12+ and Python 3.10+; the CLI itself supports Node.js 20.3+. GitHub billing, Actions and trusted publishing are not prerequisites. Dependency installation downloads public packages; these commands make no Castrook API calls.

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -e 'packages/castrook-python[dev]' PyYAML
npm run check
```

`check` validates the export allowlist, package/API/guide versions, SDK/CLI build and tests, installable skills, Python tests/strict types/lint, npm and Python builds, strict Twine checks, and fresh installed npm/wheel consumers. Archive builds happen in a temporary directory. `CASTROOK_RELEASE_PYTHON` can point to an existing development virtual environment instead of `.venv`.

Prepare a new version from the checked source:

```sh
npm run release:prepare
```

To preserve already tested archives exactly, use a directory containing the matching npm tarball, Python wheel and source archive. For 0.4.0 these are `castrook-0.4.0.tgz`, `castrook-0.4.0-py3-none-any.whl` and `castrook-0.4.0.tar.gz`:

```sh
npm run release:prepare -- --artifacts /path/to/tested-archives
npm run release:verify
```

Preparation reruns the checks and compares every archive file's contents with fresh builds of the checked source. It copies the exact archive bytes into `dist/releases/VERSION/`, refuses to overwrite different bytes for the same version, and records source commit/digest, package version, tool versions and archive SHA-256 digests in `dist/release-manifest.json`. Generated output is locally ignored by Git. Verification fails if the source or any prepared archive changes. These scripts do not handle credentials or upload anything.

After reviewing the manifest, the owner can publish those exact files with authenticated local tools:

```sh
npm run release:verify
npm login
npm publish ./dist/releases/0.4.0/castrook-0.4.0.tgz --access public --ignore-scripts
.venv/bin/python -m twine upload --repository pypi ./dist/releases/0.4.0/castrook-0.4.0-py3-none-any.whl ./dist/releases/0.4.0/castrook-0.4.0.tar.gz
```

Use the manifest's version in place of `0.4.0`. Complete npm's interactive sign-in and Twine's hidden credential prompt or your configured keyring; never put registry tokens in command arguments, source files or logs. A registry's existing name/version cannot be replaced. Publication is complete only after fresh installs from each registry pass the consumer checks; local preparation alone does not mark the published status in `agents.json`.

The single GitHub workflow is optional and manual (`workflow_dispatch`). Pushes and pull requests do not start it, and it has no publishing job or registry credential access. Distribution is exported from the private app with an explicit file allowlist; do not copy app code, setup evidence or secrets into this repo.

CLI references: [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/), [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/), [Python build](https://build.pypa.io/en/stable/), [Twine check](https://twine.readthedocs.io/en/stable/#twine-check), [Python package upload](https://packaging.python.org/en/latest/tutorials/packaging-projects/).
