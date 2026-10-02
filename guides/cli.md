# Castrook CLI

Version: 2026-10-02
Canonical: https://castrook.com/guides/cli.md
Human guide: https://castrook.com/docs/cli

## Install and authenticate

Requires Node.js 20.3 or later.

The target npm release is castrook@0.4.0, including the TypeScript SDK and CLI. Registry publication is pending until verified. Use the downloadable package:

```sh
npm install -g https://castrook.com/downloads/castrook-0.4.0.tgz
castrook login
castrook accounts list --json
castrook usage --json
```

After the npm release is verified, use npm install -g castrook@0.4.0 or npx castrook login. Login uses OAuth authorization-code + PKCE, defaults to Test and does not require copying an API key. Inspect app, callback, workspace, mode and permissions in the browser. Write scopes are unchecked until you select them.

To create a new simulated account and post, request --scopes "accounts:read accounts:write posts:read posts:write usage:read" and explicitly select the write scopes. accounts create-test --data @account.json accepts {"platform":"facebook","name":"API demo"}.

Use castrook login --publish to request posts:write and media:write in addition to the default reads; the owner still explicitly selects write permissions. --mode live requests Live access and requires Live consent. --scopes accepts a space-separated scope list. --no-browser prints the authorization URL when the browser cannot be opened.

For server automation set CASTROOK_API_KEY securely in the environment. Never put a key/token in command arguments or committed files. OAuth credentials are stored locally with restricted permissions; do not print, copy or share that file. A mode flag cannot override a token's bound mode.

## Create a Test post

Choose a simulated Facebook account from castrook accounts list, or create one using the accounts create-test command. Save this body to post.json with your actual Test account ID:

```json
{
  "text": "Hello from Castrook.",
  "account_ids": ["acc_replace_with_your_test_account_id"],
  "platform_options": {
    "facebook": { "sandbox_outcome": "published" }
  }
}
```

```sh
castrook posts create --data @post.json --idempotency-key cli-first-post-v1 --json
castrook posts get pst_replace_with_returned_id --json
castrook posts wait pst_replace_with_returned_id --json
```

--data - reads JSON from stdin. Keep the body and key for an interrupted creation. Reuse both for the exact logical retry; do not generate a new key to resolve an ambiguous publication. Scheduled posts add scheduled_at with an explicit timezone, between 5 seconds and 365 days ahead.

## Commands

- accounts: list, create-test, options, assign, disconnect.
- profiles: list, create, get, update, delete.
- connections: create, get, revoke; these are customer onboarding sessions.
- media: upload FILE, list, get, complete, delete. upload hashes and verifies the file; --profile assigns it to a customer.
- posts: create, list, get, cancel, wait.
- analytics: posts, summary, refresh.
- comments: list --account ID --post ID, reply --data @reply.json.
- webhooks: list, create --data @hook.json --secret-file PATH, disable.
- deliveries: list; logs: list; usage.
- whoami, refresh, logout. logout revokes the OAuth grant; --local-only removes only local credentials.

Run command --help for exact arguments. List commands support --all for pagination; all commands support --json. JSON results go to stdout, errors/progress to stderr, so output can be piped. A webhook's one-time secret must be written to --secret-file, not stdout.

## Recovery

401/403 means authentication or permissions need correction. 409 may mean idempotency/content conflict, an active operation or an in-use asset: inspect the returned code. Respect Retry-After for ordinary rate limits. A monthly usage/account limit requires waiting for reset or changing the workspace; repeated retries cannot fix it.

A media PUT's ambiguous failure may have succeeded. Keep the asset ID and try media complete or get before starting a replacement upload. A PUT 412 is followed by authoritative completion verification, not treated as proof of valid media.

Live TikTok posts still need current creator settings and exact creator approval. Analytics consent cannot be assumed or submitted by a tool without the account owner's authorization.
