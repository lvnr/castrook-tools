# Castrook SDK and CLI

Typed publishing, scheduling, customer onboarding, comments and performance for TikTok, Instagram, Facebook and YouTube. Version 0.4.0 combines the SDK and `castrook` command in one package with zero runtime dependencies. Requires Node.js 20.3+; the SDK also supports modern server runtimes and a keyless browser upload helper.

```sh
npm install castrook
# To install the command globally:
npm install -g castrook
castrook --version
```

The API base defaults to `https://castrook.com/api/v1`. [API reference](https://castrook.com/docs/reference), [CLI guide](https://castrook.com/docs/cli), [TypeScript guide](https://castrook.com/docs/sdk).

## CLI

```sh
castrook login
castrook whoami --json
castrook accounts list --all --json
castrook usage --json
```

Sign-in opens the browser and requests read permissions in Test mode. It uses S256 PKCE, a random state and an ephemeral `127.0.0.1` callback. `--no-browser` prints the sign-in URL for you to open. The resulting access is bound to the workspace, approved scopes and mode. `castrook login --publish` explicitly requests `posts:write` and `media:write` in addition to read access. For Live access, use `castrook login --publish --mode live` and approve Live in the browser; the server's decision is authoritative. Other write permissions require an exact `--scopes` request. A command cannot switch an existing Test grant into Live.

To exercise account creation and publication in Test:

```sh
castrook login --scopes 'accounts:read accounts:write posts:read posts:write usage:read'
printf '{"platform":"youtube","name":"QA"}' | castrook accounts create-test --data - --json
# Put the returned account ID in post.json:
castrook posts create --data @post.json --idempotency-key qa-post-001 --json
castrook posts wait pst_returned_id --json
```

`post.json`:

```json
{"text":"Hello from Castrook","account_ids":["acc_returned_id"]}
```

Keep exact captions, titles, destination overrides and platform controls in request files. The CLI sends your content unchanged and never supplies TikTok approval, privacy settings or YouTube audience choices. Post creation prints its public idempotency key on stderr; save and reuse it with the same JSON after an uncertain result. Supplying `--idempotency-key` makes that identity stable across separate runs. Acceptance is distinct from delivery: `posts wait` reports the terminal post and exits 3 for failed, partially failed or canceled delivery.

| Task | Command |
| --- | --- |
| Inspect accounts | `castrook accounts list --profile prf_example --all --json` |
| Current TikTok controls | `castrook accounts options acc_example --json` |
| Create a customer | `castrook profiles create --name 'Acme Studio' --external-id customer_acme --json` |
| Customer onboarding | `castrook connections create --data @connection.json --json` |
| Upload private media | `castrook media upload './launch clip.mp4' --profile prf_example --json` |
| Recover upload verification | `castrook media complete ast_example --json` |
| Schedule exact content | `castrook posts create --data @post.json --idempotency-key launch-2026-10-02 --json` |
| Inspect or cancel | `castrook posts get pst_example --json` / `castrook posts cancel pst_example --json` |
| Read performance | `castrook analytics summary --profile prf_example --from 2026-10-01 --to 2026-10-31 --json` |
| Refresh performance | `castrook analytics refresh pst_example --json` |
| List comments | `castrook comments list --account acc_example --post pst_example --all --json` |
| Reply | `castrook comments reply --data @reply.json --json` |
| Create webhook | `castrook webhooks create --data @webhook.json --secret-file ./castrook-webhook-secret --json` |
| Delivery attempts | `castrook deliveries list --webhook whk_example --all --json` |
| Request history | `castrook logs list --all --json` |
| Other JSON REST requests | `castrook api GET /profiles --json` |

Use `castrook --help` for commands and `castrook --help --json` for the supported OAuth scopes. OAuth calls to usage require `usage:read`; API keys have usage access implicitly. Request bodies come from `--data @file.json` or `--data -` for stdin, never inline JSON. List commands return one cursor page unless `--all` is supplied; complete iteration is bounded to 10,000 resources. Errors and progress go to stderr; `--json` keeps stdout suitable for scripts. Exit codes are 0 success, 2 invalid input, 3 operation/delivery failure, 4 authentication/access, and 5 transport/service failure.

For automation, inject `CASTROOK_API_KEY` through your secret manager instead of browser login. `CASTROOK_ACCESS_TOKEN` accepts an already issued OAuth token; set exactly one of these variables. No command accepts credentials as arguments. The CLI uses `CASTROOK_BASE_URL` or `--base-url` for an explicit alternate API base and refuses to forward a saved sign-in to a different service. `CASTROOK_CONFIG_DIR` overrides the private config directory; its default is `$XDG_CONFIG_HOME/castrook` or `~/.config/castrook` (AppData on Windows). On Unix, the directory is mode 700 and credentials mode 600; unsafe ownership, permissions and symlinks are rejected. Refresh rotation is serialized, journaled before exchange and saved atomically. Expiring saved access tokens refresh automatically; `castrook refresh` forces rotation. An interrupted or uncertain rotation requires `castrook login` again and never reuses the old refresh token. `castrook logout` revokes server access before removing credentials. `--local-only` removes the local file without server revocation.

Webhook creation writes its one-time signing secret to a new file with mode 600 and never prints it. Use the dedicated command and provide a file that does not already exist; the generic API command refuses webhook creation. Treat hosted connection links and signed upload tickets as private capabilities. SDK and CLI retries apply to reads and idempotent post creation; other writes, direct PUTs and rotating token exchanges are never replayed automatically. A comment timeout may represent a successful reply; inspect before repeating it.

## TypeScript SDK

```ts
import { Castrook, CastrookError, verifyWebhook } from 'castrook';

const castrook = new Castrook({
  apiKey: process.env.CASTROOK_API_KEY!,
});

const { data: account } = await castrook.accounts.createTest({ platform: 'youtube' });
const { data: post } = await castrook.posts.create({
  text: 'One request. Every next post.',
  account_ids: [account.id],
  platform_options: { youtube: { sandbox_outcome: 'published' } },
}, { idempotencyKey: 'launch-video-v1' });

console.log(post.id, post.status); // accepted; inspect delivery separately
for await (const post of castrook.paginate(cursor => castrook.posts.list({ cursor }))) {
  console.log(post.id, post.targets);
}
```

You can instead construct `new Castrook({accessToken: process.env.CASTROOK_ACCESS_TOKEN!})` with an OAuth grant. Supply exactly one credential; tokens retain their server-approved mode and scopes. Keep both credentials on your server.

Use a test key for this example. Test keys create simulated accounts, delivery and performance; `sandbox_outcome: 'failed'` exercises destination failures. Test posts can omit media. Live accounts connect through the dashboard or a hosted customer connection link. `sandbox_outcome` is rejected in live mode. Live YouTube requires one video and explicit `made_for_kids`; TikTok requires the creator's current privacy selection and approval for each post.

## Customer onboarding

Create one profile per customer or brand. An optional `external_id` connects it to your application's customer ID and is unique within the workspace and mode. The returned hosted URL connects accounts to that profile without granting dashboard or API-key access.

```ts
const { data: profile } = await castrook.profiles.create({
  name: 'Acme Studio', external_id: 'customer_acme',
});
const { data: session } = await castrook.connectSessions.create({
  profile_id: profile.id,
  platforms: ['instagram', 'facebook', 'tiktok', 'youtube'],
  return_url: 'https://app.example.com/connections',
  embed_origin: 'https://app.example.com', // omit for a standalone portal
});
// Return session.url only to this customer; never send your API key to a browser.
// The URL is returned once and expires after 30 minutes by default.
const { data: progress } = await castrook.connectSessions.get(session.id);
console.log(progress.status, progress.account_ids);
```

`expires_in` accepts 60–1800 seconds. Revocation and expiry prevent pending OAuth callbacks from connecting accounts. `connectSessions.revoke(id)` closes a link without disconnecting accounts already connected. `accounts.assignProfile(accountId, profileId)` groups an existing account; `null` clears it. Moving accounts is blocked while their posts are pending. Before deleting a profile, move/unassign its accounts, finish or cancel pending posts, and delete its media. Terminal post and analytics history keeps the original profile ID and does not block deletion.

Embedded completion sends a `castrook.connection` message to the exact `embed_origin`. In the parent, validate the origin, the actual iframe window and the issued session ID before acting:

```ts
const portalOrigin = new URL(session.url).origin;
window.addEventListener('message', event => {
  if (event.origin !== portalOrigin || event.source !== iframe.contentWindow ||
      event.data?.type !== 'castrook.connection' ||
      event.data?.session_id !== session.id || event.data?.status !== 'completed') return;
  // Ask your own server to re-fetch connectSessions.get(session.id) and accounts.
});
```

A message is a notification, not proof of continued account access. Re-fetch the server-side connection/account state before publishing, especially when it happens later. Capability URLs and upload tickets must stay out of public logs and analytics.

## Direct uploads and destination content

`media.upload` handles the server workflow: hash bytes, request a ticket, upload directly, then verify and freeze an immutable asset. Videos support MP4, MOV and WebM up to 128 MiB. JPEG, PNG and WebP still images must fully decode within 20 MiB and 24 megapixels. Unsupported, truncated or mismatched files never become ready assets.

```ts
import { readFile } from 'node:fs/promises';

const { data: asset } = await castrook.media.upload(await readFile('./photo.jpg'), {
  filename: 'photo.jpg', content_type: 'image/jpeg', profile_id: profile.id,
});
const { data: accounts } = await castrook.accounts.list({ profile_id: profile.id });
const instagram = accounts.find(account => account.platform === 'instagram');
const facebook = accounts.find(account => account.platform === 'facebook');
if (!instagram || !facebook) throw new Error('Connect Instagram and Facebook first.');

await castrook.posts.create({
  profile_id: profile.id,
  text: 'New work from Acme Studio.',
  account_ids: [instagram.id, facebook.id],
  media_items: [{ type: 'image', asset_id: asset.id }],
  destinations: [
    { account_id: instagram.id, text: 'New work. #AcmeStudio', format: 'feed' },
    { account_id: facebook.id, text: '', format: 'story' },
  ],
}, { idempotencyKey: 'acme-launch-photo-v1' });
```

Ordered `media_items` accepts exactly one `url` or ready `asset_id` per item. Legacy single `{url,type}` `media` remains supported; do not combine it with `media_items`. Destination override IDs must be unique selected accounts. Explicit fields override shared fields; omitted fields inherit them. Empty captions are meaningful, and an empty destination `media_items` explicitly removes inherited media. A supplied `profile_id` must match all destination accounts and profile-scoped assets.

TikTok supports one video or up to 35 images; Instagram supports one image/Reel, up to 10 images/videos in a carousel, or one-asset Stories for Business accounts; Facebook Pages supports text, up to 10 feed photos, one video/Reel or one-asset Stories; YouTube supports one video. Stories require empty captions because the APIs do not overlay text. Omitted `format` preserves existing platform defaults. Platform-specific controls can be shared through `platform_options` or overridden through a destination's `options`.

Format precedence is destination `format`, destination `options.format`, shared `format`, then the selected platform's shared `platform_options.format`. Every supplied option format must be valid for that platform, even when a higher-precedence value wins.

For browser uploads, your server creates the ticket. Return only its scoped upload fields to the customer and use the keyless helper:

```ts
import { uploadToURL, type MediaUpload } from 'castrook';
// ticket comes from your server; file is a browser File or Blob.
await uploadToURL(ticket.upload as MediaUpload, file);
// Ask your server to call castrook.media.complete(ticket.asset.id).
```

The PUT uses the exact returned headers, no bearer key or cookies, and rejects redirects. Tickets expire within 15 minutes. A repeated immutable PUT may return 412; completion still verifies the existing object's size, type and digest. After an interrupted PUT or completion, `CastrookError.details` includes `asset_id` so your server can inspect the asset and retry completion before creating another ticket. Server error codes and request IDs are preserved. Upload creation and PUT are never retried automatically. Completion remains available after the monthly API allowance is exhausted.

Unreferenced ready assets expire after 30 days. Accepted scheduled posts pin assets through terminal delivery plus a recovery window; `media.delete` rejects assets still in use. New uploaded bytes count once per asset, and managed reuse across destinations incurs no additional ingest allowance debit. External HTTPS sources must remain unchanged and available through dispatch. TikTok videos downloaded from external URLs are measured and staged on verified temporary URLs for 48 hours; `video_duration_sec` is only a compatibility hint, not the enforced duration.

## TikTok creator consent

For TikTok accounts, call `castrook.accounts.publishingOptions(accountId)` with `accounts:read` before displaying publishing controls. It returns the current creator nickname, privacy choices, disabled interactions and maximum video duration. Show those values, let the creator select privacy without a default, and collect explicit consent. Test accounts return deterministic settings; other platforms currently return `publishing_options_unavailable`.

The SDK is server transport; it does not implement the creator-facing TikTok flow. Your application must show an editable caption and media preview, current creator identity/settings, and the required commercial disclosures and policy notices. Keep interactions off initially and unavailable choices disabled. Only send `consent: true` after the creator approves that exact post, destination, visibility and schedule. Account OAuth and possession of an API key do not establish approval for future content. Recollect approval after changing the content or publishing choices. Do not turn this flag into an unconditional background-job default or use Castrook to copy arbitrary videos from other platforms. Follow [TikTok's sharing requirements](https://developers.tiktok.com/docs/en/content-sharing-guidelines) in every client experience.

For commercial content, present a disclosure control initially off, then require an own-brand and/or third-party selection when enabled. Explain the promotional-content or paid-partnership label. Third-party branded content cannot use `SELF_ONLY`; show TikTok's Branded Content Policy alongside Music Usage Confirmation for that choice. Photo posts use the same `video.publish` permission as video, have comment controls without duet/stitch, and support a title, cover index and approved auto-music choice. Post acceptance means queueing: show processing/final delivery state and explain that TikTok visibility may take a few minutes. Approval and eligibility remain app/account-specific.

Never expose your key to a browser. Idempotency keys contain 8–128 letters, numbers, dots, colons, underscores or hyphens. Reuse a key only for the same logical post and payload. A timeout on a non-idempotent comment reply may mean the platform accepted it: inspect before retrying. List comments for a post before replying so Castrook can verify each comment belongs to that destination.

Post text is limited to 5,000 characters, or 2,200 for live Instagram and TikTok video captions; TikTok photo descriptions allow 4,000 and photo titles 90. Replies allow 2,000. To schedule, set `scheduled_at` to an RFC 3339 timestamp between five seconds and 365 days in the future. Acceptance returns the post's current state; poll it or receive a webhook for the final result.

The client retries GET and idempotent post requests on transport errors, HTTP 429 and 5xx. It honors bounded Retry-After, permits cancellation through AbortSignal, uses a 30-second timeout per attempt, and never follows redirects with credentials. The default is two retries. Set `maxRetries: 0` to disable retries; retry counts must be nonnegative integers and are capped at five. If Retry-After exceeds 30 seconds, the client returns `CastrookError` with the server's `code` and `retryAfter` for your job scheduler.

## Performance

```ts
const { data: summary } = await castrook.analytics.summary({
  profile_id: profile.id, from: '2026-10-01', to: '2026-10-31',
});
console.log(summary.totals.views, summary.coverage.views);
const { data: refreshed } = await castrook.analytics.refresh(post.id);
console.log(refreshed.cached, refreshed.rows);
```

Date filters choose posts by creation date. Counters are lifetime snapshots, not engagement earned during the selected period. The default range is the last 30 UTC days; the maximum is one year. A date-only `to` includes that UTC day. `analytics.posts` paginates per-destination snapshots; `analytics.summary` returns totals and availability coverage. A metric with no data has a `null` total; missing row fields never become invented zeros. Test counters are marked `simulated:true`.

Availability varies by permission, visibility and media format. TikTok Display API requires `video.list` approval plus fresh account consent and supports public-video counters; private/photo metrics may be unavailable. Instagram requires its insights permission, Facebook requires `read_insights`, and basic YouTube views/likes/comments use the existing publishing scope. YouTube snapshots follow authorization and deletion/expiry rules. A provider error preserves the last successful snapshot with `refresh_error`.

Existing YouTube connections require explicit account-owner acceptance of the current [privacy policy](https://castrook.com/privacy) before the new performance-data use. After that acceptance, call `castrook.accounts.acceptAnalyticsPolicy(accountId, {accepted:true, privacy_policy_version:'2026-10-02'})` with `accounts:write`. The returned account includes its timestamped `analytics_consent`. Never infer acceptance from OAuth or record it without the owner's action. Receipts are bound to the authorization revision and do not survive reconnection. Without acceptance, rows report `privacy_consent_required` and new statistics reads are blocked. Hosted YouTube onboarding collects acceptance in its legal step.

Refreshes have a five-minute cooldown (`cached:true`) and return 409 while another refresh holds the lease. Cached analytics reads use no monthly API allowance; fresh refresh operations do. Summary ranges above 5,000 destinations return `analytics_range_too_large` rather than partial totals.

## Usage and limits

Plans include monthly allowances and a per-minute API rate. `castrook.usage.get()` returns them for the credential's mode; API keys have implicit access and OAuth grants need `usage:read`. The lookup uses no monthly API allowance. Authentication and per-minute limits still apply. Live and test keys have separate allowances; metrics that do not apply to test mode are `null`.

```ts
const { data: usage } = await castrook.usage.get();
console.log(usage.publications.remaining, 'publications left until', usage.reset_at);
```

Each destination reserves one publication when accepted for its scheduled period. Before the first publishing request, Castrook atomically claims a unit in the current period. Success consumes that claimed unit even if processing finishes after reset; failure or cancellation releases it. An exact idempotent replay reserves nothing. `remaining` is `limit - used - reserved`.

Cached status/resource reads, usage, cancellations, disconnects, disabling webhooks and exact post replays use no monthly API allowance. Authentication, scopes and minute rate limits still apply. Comment requests and fresh publishing-option lookups remain metered.

Limit errors are typed. The client never retries them automatically, because another attempt cannot succeed until the period resets or the workspace changes:

- `usage_limit_exceeded` (429): a monthly allowance is used. This rejected request creates no new work; earlier accepted operations remain recoverable with status reads or exact post replays. A destination error concerns delivery of an already accepted post. Limits never create charges. `details` has `metric`, `limit`, `used`, `reserved`, `remaining`, `reset_at` and `upgrade_url`. Do not loop new-work retries before `reset_at`.
- `account_limit_reached` (409): connecting would exceed the plan (or 10 test accounts).
- `account_capacity_exceeded` (409): the workspace has more connected live accounts than its plan allows. New live posts are blocked until an account is disconnected or the plan is upgraded; nothing is deleted.
- `rate_limit_exceeded` (429): the per-minute rate was reached. Retried automatically when Retry-After is 30 seconds or less.

Every response reports the rate in `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`. Requests that end in a server error do not count toward the monthly allowance.

```ts
try {
  await castrook.posts.get('pst_example');
} catch (error) {
  if (error instanceof CastrookError) {
    if (error.isUsageLimit()) console.error(`${error.details.metric} allowance used until ${error.details.reset_at}`);
    else if (error.isAccountLimit()) console.error(`${error.details.connected} of ${error.details.limit} accounts connected`);
    else console.error(error.code, error.requestId);
  }
}
```

## Webhooks

```ts
// In an HTTPS webhook handler, before JSON.parse:
const raw = await request.text();
const valid = await verifyWebhook({
  secret: process.env.CASTROOK_WEBHOOK_SECRET!,
  id: request.headers.get('webhook-id') ?? '',
  timestamp: request.headers.get('webhook-timestamp') ?? '',
  signature: request.headers.get('webhook-signature') ?? '',
  body: raw,
});
if (!valid) return new Response('Invalid signature', { status: 401 });
// Persist and deduplicate webhook-id, enqueue your work, then acknowledge.
return new Response(null, { status: 204 });
```

Signatures use HMAC-SHA256 over `webhook-id.webhook-timestamp.raw-body`. Timestamp tolerance defaults to 300 seconds. Delivery is at least once; a valid signature does not replace deduplication.
