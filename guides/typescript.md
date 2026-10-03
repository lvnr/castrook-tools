# Castrook TypeScript SDK

Version: 2026-10-02
Canonical: https://castrook.com/guides/typescript.md
Human guide: https://castrook.com/docs/sdk

## Installation

castrook@0.4.0, MIT, Node.js 20.3+ and modern server runtimes. This package includes the CLI. Registry installation is verified; the release tarball also remains available.

```sh
npm install castrook@0.4.0
```

Import from castrook. Existing @castrook/sdk 0.2/0.3 tarballs remain compatibility artifacts; new projects use castrook.

## Initialize

```ts
import { Castrook, CastrookError } from 'castrook';

const api = new Castrook({ apiKey: process.env.CASTROOK_API_KEY! });
// OAuth server integrations may use { accessToken } instead.
// Default baseURL: https://castrook.com/api/v1.
```

Keep credentials on a server. They bind a workspace, mode and scopes. SDK calls retain the API's { data, meta? } envelope. Failed responses throw CastrookError with status, code, requestId and details.

## Test publishing

```ts
const { data: account } = await api.accounts.createTest({
  platform: 'facebook', name: 'API demo',
});
const { data: post } = await api.posts.create({
  text: 'Hello from Castrook.',
  account_ids: [account.id],
  platform_options: { facebook: { sandbox_outcome: 'published' } },
}, { idempotencyKey: 'api-demo-first-post-v1' });
const { data: current } = await api.posts.get(post.id);
console.log(current.status, current.targets);
```

Creation is asynchronous acceptance. Treat target states as authoritative. Persist the exact body and key before a retry; changing destination overrides or media order is a new logical post.

## Pagination and uploads

```ts
for await (const post of api.paginate(cursor =>
  api.posts.list({ status: 'published', cursor })
)) {
  console.log(post.id, post.targets);
}

const { data: asset } = await api.media.upload(fileBytes, {
  filename: 'launch.mp4', content_type: 'video/mp4', profile_id: profile.id,
});
```

media.upload handles hashing, ticket creation, direct PUT and immutable verification. Browser apps obtain a ticket from their own trusted server and call exported uploadToURL(ticket.upload, file); they never receive the Castrook credential. Then the server calls media.complete. Use only the returned storage headers during PUT, no Castrook authorization header.

Video files are at most 128 MiB. Still JPEG/PNG/WebP images are at most 20 MiB and 24 megapixels. Completion checks actual bytes/type/size/checksum. Pending or uncertain uploads remain recoverable by asset ID; inspect/complete before starting another upload. Ready assets are private and referenced scheduled posts pin them through terminal delivery. Unused assets expire after 30 days.

## Resources

profiles (list/create/get/update/delete), connectSessions (create/get/revoke), accounts (list/createTest/assignProfile/publishingOptions/acceptAnalyticsPolicy/disconnect), media (list/get/createUpload/complete/upload/delete), posts (list/create/get/cancel), analytics (posts/summary/refresh), comments (list/reply), webhooks (list/create/disable), deliveries (list), logs (list), usage (get). api(method, path, options) provides an API-relative escape hatch; secrets cannot be sent outside the configured API origin.

Requests accept cancellation and bounded safe retries. Post retries retain the same idempotency key. Allowance/account limits are never automatically retried. Respect current creator controls, live-content authorization and legal acceptance; credentials are not per-post TikTok consent.
