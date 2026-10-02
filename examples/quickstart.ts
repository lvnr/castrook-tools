import { Castrook, CastrookError } from 'castrook';

const api = new Castrook({
  apiKey: process.env.CASTROOK_API_KEY!,
});

const { data: account } = await api.accounts.createTest({
  platform: 'facebook',
  name: 'API demo',
});

const { data: post } = await api.posts.create({
  text: 'Hello from Castrook.',
  account_ids: [account.id],
  platform_options: { facebook: { sandbox_outcome: 'published' } },
}, { idempotencyKey: 'api-demo-first-post-v1' });

console.log(post.id, post.status); // accepted; inspect final targets separately
