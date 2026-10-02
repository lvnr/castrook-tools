export type Platform = "tiktok" | "instagram" | "facebook" | "youtube";
export type Mode = "test" | "live";
export type PostStatus = "scheduled" | "queued" | "publishing" | "published" | "partially_failed" | "failed" | "canceled";
export type Page<T> = { data: T[]; meta: { next_cursor: string | null; has_more: boolean } };
export type Result<T> = { data: T };
export type Account = { id: string; profile_id?: string; platform: Platform; name: string; username: string; status: "connected" | "disconnected" | "expired"; capabilities: { publish: boolean; comments: boolean; analytics?: boolean }; mode: Mode; created_at: string; updated_at: string; analytics_consent?: {privacy_policy_version:string;accepted_at:string} };
/** Submit only after the account owner explicitly accepts the linked current privacy policy. */
export type AnalyticsConsentInput = { accepted: true; privacy_policy_version: "2026-10-02" };
export type Profile = { id: string; name: string; external_id?: string; mode: Mode; created_at: string; updated_at: string };
export type CreateProfileInput = { name: string; external_id?: string };
export type UpdateProfileInput = { name?: string; external_id?: string | null };
export type DeletedResource = { id: string; deleted: true };
export type ConnectSession = { id: string; profile_id: string; mode: Mode; platforms: Platform[]; expires_at: string; created_at: string; status: "open" | "completed" | "revoked" | "expired"; account_ids: string[]; return_url?: string; embed_origin?: string };
/** Keep the resulting URL private: it grants short-lived connection access for the selected customer. */
export type CreateConnectSessionInput = { profile_id: string; platforms: Platform[]; return_url?: string; embed_origin?: string; expires_in?: number };
export type TikTokPrivacy = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
export type TikTokPublishingOptions = { platform: "tiktok"; creator_username: string; creator_nickname: string; privacy_level_options: TikTokPrivacy[]; comment_disabled: boolean; duet_disabled: boolean; stitch_disabled: boolean; max_video_post_duration_sec: number };
/** Collect creator approval for this exact content after showing current publishing controls. OAuth consent alone is insufficient. */
export type TikTokOptions = { privacy_level: TikTokPrivacy; consent: true; /** Optional hint; server-measured media duration is authoritative. */ video_duration_sec?: number; disable_comment?: boolean; disable_duet?: boolean; disable_stitch?: boolean; brand_content_toggle?: boolean; brand_organic_toggle?: boolean; is_aigc?: boolean; video_cover_timestamp_ms?: number; format?: "feed" | "video"; title?: string; photo_cover_index?: number; auto_add_music?: boolean };
export type YouTubeOptions = { format?: "video"; title?: string; privacy_status?: "private" | "unlisted" | "public"; made_for_kids: boolean; contains_synthetic_media?: boolean; tags?: string[]; category_id?: string };
export type InstagramOptions = { format?: "feed" | "reel" | "story"; share_to_feed?: boolean; alt_text?: string };
export type FacebookOptions = { format?: "feed" | "reel" | "video" | "story"; title?: string };
/** Test keys only. Live requests reject sandbox_outcome. */
export type SandboxOptions<T> = Partial<T> & { sandbox_outcome: "published" | "failed" };
export type PlatformOptions = {
  tiktok?: TikTokOptions | SandboxOptions<TikTokOptions>;
  youtube?: YouTubeOptions | SandboxOptions<YouTubeOptions>;
  instagram?: InstagramOptions | SandboxOptions<InstagramOptions>;
  facebook?: FacebookOptions | SandboxOptions<FacebookOptions>;
};
export type ContentFormat = "feed" | "reel" | "story" | "video";
/** Exactly one URL or completed immutable asset ID. Ordered arrays preserve carousel order. */
export type MediaItem = { type: "video" | "image" } & ({ url: string; asset_id?: never } | { asset_id: string; url?: never });
export type DestinationContent = { account_id: string; text?: string; media?: { url: string; type: "video" | "image" }; media_items?: MediaItem[]; format?: ContentFormat; options?: TikTokOptions | YouTubeOptions | InstagramOptions | FacebookOptions | Record<string, unknown> };
export type CreatePostInput = { text: string; account_ids: string[]; profile_id?: string; media?: { url: string; type: "video" | "image" }; media_items?: MediaItem[]; format?: ContentFormat; destinations?: DestinationContent[]; scheduled_at?: string; platform_options?: PlatformOptions };
export type PostTarget = { account_id: string; platform: Platform; status: "queued" | "publishing" | "published" | "failed" | "canceled"; attempts: number; provider_post_id?: string; url?: string; error?: { code: string; message: string } };
export type Post = { id: string; profile_id?: string; text: string; media?: CreatePostInput["media"]; media_items?: MediaItem[]; format?: ContentFormat; destinations?: DestinationContent[]; platform_options?: PlatformOptions; status: PostStatus; scheduled_at: string | null; created_at: string; updated_at: string; targets: PostTarget[]; mode: Mode };
export type MediaContentType = "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/quicktime" | "video/webm";
export type MediaAsset = { id: string; profile_id?: string; filename: string; type: "image" | "video"; content_type: string; size: number; sha256: string; status: "pending" | "ready" | "deleting"; mode: Mode; created_at: string; expires_at: string; in_use: boolean; preview_url?: string; duration_sec?: number; width?: number; height?: number };
export type CreateMediaUploadInput = { filename: string; content_type: MediaContentType; size: number; sha256: string; profile_id?: string };
export type MediaUpload = { url: string; method: "PUT"; headers: Record<string, string>; expires_at: string };
export type MediaUploadTicket = { asset: MediaAsset; upload: MediaUpload };
export type PerformanceMetric = "views" | "reach" | "likes" | "comments" | "shares" | "saves";
export type AnalyticsRow = { id: string; post_id: string; account_id: string; platform: Platform; profile_id?: string; text: string; post_created_at: string; status: "available" | "unavailable" | "pending"; metrics: Partial<Record<PerformanceMetric, number>>; unavailable_metrics: PerformanceMetric[]; reason?: string; fetched_at: string | null; url?: string; simulated: boolean; refresh_error?: string };
/** Filters choose the post creation range. Counters are lifetime snapshots, not range-attributed views. */
export type AnalyticsFilters = { profile_id?: string; account_id?: string; platform?: Platform; from?: string; to?: string };
export type AnalyticsSummary = { totals: Record<PerformanceMetric, number | null>; coverage: Record<PerformanceMetric, { available: number; total: number }>; post_count: number; destination_count: number; available_destinations: number; last_refreshed_at: string | null; mode: Mode };
export type AnalyticsRefresh = { post_id: string; refreshed: number; rows: AnalyticsRow[]; cached: boolean };
export type Comment = { id: string; text: string; author: string; created_at: string; account_id: string; post_id: string; parent_id?: string; like_count?: number };
export type WebhookEventType = "post.published" | "post.failed" | "post.partially_failed" | "post.canceled";
export type Webhook = { id: string; url: string; description: string; events: WebhookEventType[]; status: "active" | "disabled"; mode: Mode; created_at: string };
export type Delivery = { id: string; webhook_id: string; event: WebhookEventType; post_id: string; status: "pending" | "delivered" | "failed"; attempts: number; last_status: number | null; last_error: string | null; created_at: string; next_attempt_at: string | null; delivered_at: string | null };
export type RequestLog = { id: string; request_id: string; method: string; path: string; status: number; duration_ms: number; key_id: string | null; created_at: string };
export type PlanId = "free" | "starter" | "growth" | "scale";
export type UsageMetric = "publications" | "media_bytes" | "api_requests" | "comment_requests" | "new_connections";
/** `remaining` is `max(0, limit - used - reserved)`. */
export type UsageMeter = { used: number; reserved: number; limit: number; remaining: number; reset_at: string };
/** Allowances for the key's mode. Metrics that do not apply to test mode are null. */
export type UsageSummary = {
  mode: Mode; plan: PlanId; plan_source: "subscription" | "comp" | "beta" | "free"; catalog_version: string;
  period: { start: string; end: string }; reset_at: string; grace_ends_at: string | null;
  accounts: { used: number; limit: number; remaining: number };
  publications: UsageMeter; api_requests: UsageMeter; media_bytes: UsageMeter | null; comment_requests: UsageMeter | null; new_connections: UsageMeter | null;
  rate_limit: { per_minute: number }; concurrent_ingests: number;
};
/** `usage_limit_exceeded`: new work was rejected; earlier operations remain recoverable. Do not loop retries before `reset_at`. */
export type UsageLimitDetails = { metric: UsageMetric; mode: Mode; plan: PlanId; limit: number; used: number; reserved: number; remaining: number; reset_at: string; upgrade_url: string; retry_after_seconds: number };
/** `account_limit_reached` (connecting beyond the plan) or `account_capacity_exceeded` (live publishing paused while over capacity). */
export type AccountLimitDetails = { mode: Mode; plan: PlanId; limit: number; connected: number; upgrade_url: string };
export type RateLimitDetails = { retry_after_seconds: number; limit?: number };
export type ListParams = { cursor?: string; limit?: number };
export type RequestOptions = { signal?: AbortSignal };
export type CreateOptions = RequestOptions & { idempotencyKey: string };
export type CastrookCredentials = { apiKey: string; accessToken?: never } | { accessToken: string; apiKey?: never };
export type CastrookOptions = CastrookCredentials & { baseURL?: string; timeoutMs?: number; maxRetries?: number; fetch?: typeof fetch };
export type ApiRequestOptions = RequestOptions & { body?: unknown; query?: Record<string, string | number | boolean | undefined>; idempotencyKey?: string };

export const SDK_VERSION = "0.4.0";
export const DEFAULT_BASE_URL = "https://castrook.com/api/v1";

/** Every API failure. `code` is stable; `details` carries typed limit data for limit errors. */
export class CastrookError extends Error {
  readonly name = "CastrookError";
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly requestId: string | null, public readonly details?: unknown, public readonly retryAfter?: number) { super(message); }
  /** A monthly allowance is used. Never retried automatically; wait for `details.reset_at` or upgrade. */
  isUsageLimit(): this is CastrookError & { code: "usage_limit_exceeded"; details: UsageLimitDetails } { return this.code === "usage_limit_exceeded"; }
  /** An account capacity limit. Never retried automatically; disconnect an account or upgrade. */
  isAccountLimit(): this is CastrookError & { code: "account_limit_reached" | "account_capacity_exceeded"; details: AccountLimitDetails } { return this.code === "account_limit_reached" || this.code === "account_capacity_exceeded"; }
  /** The per-minute rate was reached; `retryAfter` says when to try again. */
  isRateLimit(): this is CastrookError & { code: "rate_limit_exceeded"; details: RateLimitDetails } { return this.code === "rate_limit_exceeded"; }
}
/** Limits that another attempt cannot fix until the workspace or period changes. */
function neverRetried(code: string) { return code === "usage_limit_exceeded" || code.startsWith("account_"); }

/** Node 20.3+ / modern server runtimes. Never expose a live key in browser code. */
export class Castrook {
  private readonly fetcher: typeof fetch;
  private readonly base: string;
  private readonly timeout: number;
  private readonly retries: number;
  constructor(private readonly options: CastrookOptions) {
    if (Boolean(options.apiKey) === Boolean(options.accessToken)) throw new TypeError("Provide exactly one Castrook API key or OAuth access token.");
    if (options.apiKey && !/^cr_(test|live)_[A-Za-z0-9_-]+$/.test(options.apiKey)) throw new TypeError("A Castrook test or live API key is required.");
    if (options.accessToken && !/^cr_oauth_[A-Za-z0-9_-]{43}$/.test(options.accessToken)) throw new TypeError("A valid Castrook OAuth access token is required.");
    const url = new URL(options.baseURL ?? DEFAULT_BASE_URL);
    if (url.username || url.password || url.search || url.hash) throw new TypeError("baseURL must not contain credentials, a query, or a fragment.");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new TypeError("baseURL must use HTTPS (except local development).");
    this.base = url.href.replace(/\/$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeout = options.timeoutMs ?? 30_000;
    const retries = options.maxRetries ?? 2;
    if (!Number.isInteger(retries) || retries < 0) throw new TypeError("maxRetries must be a finite, nonnegative integer.");
    this.retries = Math.min(5, retries);
    if (!Number.isInteger(this.timeout) || this.timeout <= 0 || this.timeout > 2_147_483_647) throw new TypeError("timeoutMs must be an integer between 1 and 2147483647.");
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: object, options: RequestOptions & { idempotencyKey?: string } = {}): Promise<T> {
    const url = new URL(`${this.base}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
    const headers: Record<string, string> = { Authorization: `Bearer ${this.options.apiKey ?? this.options.accessToken}`, Accept: "application/json", "User-Agent": `castrook-sdk/${SDK_VERSION}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    // Capture the logical request once. A caller may mutate its input while a
    // request is waiting to retry, but an idempotency key must keep one payload.
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    const retryable = method === "GET" || method === "POST" && path === "/posts" && Boolean(options.idempotencyKey);
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.timeout);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let response: Response;
      try { response = await this.fetcher(url, { method, headers, ...(serializedBody === undefined ? {} : { body: serializedBody }), signal, redirect: "error", credentials: "omit" }); }
      catch (error) {
        if (!retryable || attempt >= this.retries || options.signal?.aborted) throw error;
        await wait(Math.min(500 * 2 ** attempt, 5000), options.signal);
        continue;
      }
      const requestId = response.headers.get("x-request-id");
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      const transient = retryable && attempt < this.retries && (response.status === 429 || response.status >= 500);
      if (response.status === 204 || method === "HEAD" && response.ok) return undefined as T;
      let payload: unknown;
      try { payload = await response.json(); }
      catch {
        if (transient && (retryAfter === undefined || retryAfter <= 30)) { await wait((retryAfter ?? Math.min(0.5 * 2 ** attempt, 5)) * 1000, options.signal); continue; }
        throw new CastrookError(response.status, transient ? "retry_later" : "invalid_response", transient ? "Request should be retried later." : "The API returned an invalid JSON response.", requestId, undefined, retryAfter);
      }
      if (response.ok) return payload as T;
      const data = payload as { error?: { code?: string; message?: string; details?: unknown }; request_id?: string };
      const code = data?.error?.code;
      // Allowance and account limits are never retried automatically: another
      // attempt cannot succeed before the period resets or the workspace changes.
      if (transient && !neverRetried(code ?? "")) {
        // Do not hammer a server whose Retry-After exceeds our bounded retry window.
        if (retryAfter === undefined || retryAfter <= 30) { await wait((retryAfter ?? Math.min(0.5 * 2 ** attempt, 5)) * 1000, options.signal); continue; }
        throw new CastrookError(response.status, code ?? "retry_later", data?.error?.message ?? "Request should be retried later.", requestId ?? data?.request_id ?? null, data?.error?.details, retryAfter);
      }
      throw new CastrookError(response.status, code ?? "request_failed", data?.error?.message ?? "Request failed.", requestId ?? data?.request_id ?? null, data?.error?.details, retryAfter);
    }
  }

  /** Escape hatch for REST resources. Authentication is restricted to this client's API base. */
  api<T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD", path: string, options: ApiRequestOptions = {}): Promise<T> {
    if (!["GET", "POST", "PATCH", "DELETE", "HEAD"].includes(method)) throw new TypeError("Use GET, POST, PATCH, DELETE or HEAD.");
    if ((method === "GET" || method === "HEAD") && options.body !== undefined) throw new TypeError("GET and HEAD do not accept a request body.");
    if (!path.startsWith("/") || path.startsWith("//") || /[\\#\u0000-\u0020\u007f]/.test(path)) throw new TypeError("Use an API-relative path such as /posts.");
    const base = new URL(this.base);
    const url = new URL(`${this.base}${path}`);
    if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname.replace(/\/$/, "")}/`)) throw new TypeError("The request must stay within the configured API base.");
    if (options.idempotencyKey && (method !== "POST" || path !== "/posts" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(options.idempotencyKey))) throw new TypeError("A valid idempotency key applies only to POST /posts.");
    if (method === "POST" && path === "/posts" && !options.idempotencyKey) throw new TypeError("POST /posts requires a stable idempotency key.");
    return this.request<T>(method, path, options.body, options.query, options);
  }

  readonly accounts = {
    list: (params: ListParams & { profile_id?: string; platform?: Platform; q?: string } = {}, options?: RequestOptions) => this.request<Page<Account>>("GET", "/accounts", undefined, params, options),
    /** Fetch current creator controls before collecting consent. TikTok accounts only. */
    publishingOptions: (id: string, options?: RequestOptions) => this.request<Result<TikTokPublishingOptions>>("GET", `/accounts/${encodeURIComponent(id)}/publishing-options`, undefined, undefined, options),
    createTest: (input: { platform: Platform; profile_id?: string; name?: string; username?: string }, options?: RequestOptions) => this.request<Result<Account>>("POST", "/accounts", input, undefined, options),
    assignProfile: (id: string, profileId: string | null, options?: RequestOptions) => this.request<Result<Account>>("PATCH", `/accounts/${encodeURIComponent(id)}`, { profile_id: profileId }, undefined, options),
    acceptAnalyticsPolicy: (id: string, acceptance: AnalyticsConsentInput, options?: RequestOptions) => this.request<Result<Account>>("POST", `/accounts/${encodeURIComponent(id)}/analytics-consent`, acceptance, undefined, options),
    disconnect: (id: string, options?: RequestOptions) => this.request<Result<Account>>("DELETE", `/accounts/${encodeURIComponent(id)}`, undefined, undefined, options),
  };
  readonly posts = {
    create: (input: CreatePostInput, options: CreateOptions) => { if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(options?.idempotencyKey ?? "")) throw new TypeError("idempotencyKey must contain 8–128 letters, numbers, dots, colons, underscores or hyphens. Reuse it when retrying the same logical post."); return this.request<Result<Post>>("POST", "/posts", input, undefined, options); },
    list: (params: ListParams & { status?: PostStatus; platform?: Platform; profile_id?: string; q?: string } = {}, options?: RequestOptions) => this.request<Page<Post>>("GET", "/posts", undefined, params, options),
    get: (id: string, options?: RequestOptions) => this.request<Result<Post>>("GET", `/posts/${encodeURIComponent(id)}`, undefined, undefined, options),
    cancel: (id: string, options?: RequestOptions) => this.request<Result<Post>>("DELETE", `/posts/${encodeURIComponent(id)}`, undefined, undefined, options),
  };
  readonly profiles = {
    list: (params: ListParams & { q?: string; external_id?: string } = {}, options?: RequestOptions) => this.request<Page<Profile>>("GET", "/profiles", undefined, params, options),
    create: (input: CreateProfileInput, options?: RequestOptions) => this.request<Result<Profile>>("POST", "/profiles", input, undefined, options),
    get: (id: string, options?: RequestOptions) => this.request<Result<Profile>>("GET", `/profiles/${encodeURIComponent(id)}`, undefined, undefined, options),
    update: (id: string, input: UpdateProfileInput, options?: RequestOptions) => this.request<Result<Profile>>("PATCH", `/profiles/${encodeURIComponent(id)}`, input, undefined, options),
    delete: (id: string, options?: RequestOptions) => this.request<Result<DeletedResource>>("DELETE", `/profiles/${encodeURIComponent(id)}`, undefined, undefined, options),
  };
  readonly connectSessions = {
    create: (input: CreateConnectSessionInput, options?: RequestOptions) => this.request<Result<ConnectSession & { url: string }>>("POST", "/connect-sessions", input, undefined, options),
    get: (id: string, options?: RequestOptions) => this.request<Result<ConnectSession>>("GET", `/connect-sessions/${encodeURIComponent(id)}`, undefined, undefined, options),
    revoke: (id: string, options?: RequestOptions) => this.request<Result<ConnectSession>>("DELETE", `/connect-sessions/${encodeURIComponent(id)}`, undefined, undefined, options),
  };
  readonly media = {
    list: (params: ListParams & { profile_id?: string } = {}, options?: RequestOptions) => this.request<Page<MediaAsset>>("GET", "/media", undefined, params, options),
    get: (id: string, options?: RequestOptions) => this.request<Result<MediaAsset>>("GET", `/media/${encodeURIComponent(id)}`, undefined, undefined, options),
    createUpload: (input: CreateMediaUploadInput, options?: RequestOptions) => this.request<Result<MediaUploadTicket>>("POST", "/media/uploads", input, undefined, options),
    complete: (id: string, options?: RequestOptions) => this.request<Result<MediaAsset>>("POST", `/media/${encodeURIComponent(id)}/complete`, {}, undefined, options),
    delete: (id: string, options?: RequestOptions) => this.request<Result<DeletedResource>>("DELETE", `/media/${encodeURIComponent(id)}`, undefined, undefined, options),
    /** Server convenience: hash → scoped ticket → direct PUT → immutable verification. Never forwards your API key to storage. */
    upload: async (source: Blob | Uint8Array, input: { filename: string; content_type: MediaContentType; profile_id?: string }, options?: RequestOptions): Promise<Result<MediaAsset>> => {
      const blob = source instanceof Blob ? source : new Blob([new Uint8Array(source)]);
      if (!blob.size || blob.size > 128 * 1024 * 1024) throw new TypeError("Media must contain 1–134217728 bytes.");
      if (input.content_type.startsWith("image/") && blob.size > 20 * 1024 * 1024) throw new TypeError("Images must be at most 20 MiB.");
      const checksum = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(checksum), byte => byte.toString(16).padStart(2, "0")).join("");
      const { data: ticket } = await this.media.createUpload({ ...input, size: blob.size, sha256 }, options);
      try { await uploadToURL(ticket.upload, blob, { ...options, fetch: this.fetcher, timeoutMs: Math.max(this.timeout, 120_000) }); }
      catch (error) { if (error instanceof CastrookError) throw new CastrookError(error.status, error.code, error.message, error.requestId, { asset_id: ticket.asset.id }, error.retryAfter); throw error; }
      try { return await this.media.complete(ticket.asset.id, options); }
      catch (error) {
        if (error instanceof CastrookError) {
          const details = error.details && typeof error.details === "object" && !Array.isArray(error.details) ? error.details : {};
          throw new CastrookError(error.status, error.code, error.message, error.requestId, { ...details, asset_id: ticket.asset.id }, error.retryAfter);
        }
        throw new CastrookError(0, "media_completion_interrupted", "Asset verification could not be confirmed. Retry completion for this asset before starting another upload.", null, { asset_id: ticket.asset.id });
      }
    },
  };
  readonly analytics = {
    posts: (params: ListParams & AnalyticsFilters = {}, options?: RequestOptions) => this.request<Page<AnalyticsRow>>("GET", "/analytics/posts", undefined, params, options),
    summary: (params: AnalyticsFilters = {}, options?: RequestOptions) => this.request<Result<AnalyticsSummary>>("GET", "/analytics/summary", undefined, params, options),
    refresh: (postId: string, options?: RequestOptions) => this.request<Result<AnalyticsRefresh>>("POST", `/posts/${encodeURIComponent(postId)}/analytics/refresh`, {}, undefined, options),
  };
  readonly comments = {
    list: (params: { account_id: string; post_id: string; cursor?: string }, options?: RequestOptions) => this.request<Page<Comment>>("GET", "/comments", undefined, params, options),
    reply: (input: { account_id: string; post_id: string; comment_id: string; text: string }, options?: RequestOptions) => this.request<Result<Comment>>("POST", "/comments", input, undefined, options),
  };
  readonly webhooks = {
    list: (params: ListParams = {}, options?: RequestOptions) => this.request<Page<Webhook>>("GET", "/webhooks", undefined, params, options),
    create: (input: { url: string; events: WebhookEventType[]; description?: string }, options?: RequestOptions) => this.request<Result<Webhook & { secret: string }>>("POST", "/webhooks", input, undefined, options),
    disable: (id: string, options?: RequestOptions) => this.request<Result<Webhook>>("DELETE", `/webhooks/${encodeURIComponent(id)}`, undefined, undefined, options),
  };
  readonly deliveries = { list: (params: ListParams & { webhook_id?: string } = {}, options?: RequestOptions) => this.request<Page<Delivery>>("GET", "/deliveries", undefined, params, options) };
  readonly logs = { list: (params: ListParams = {}, options?: RequestOptions) => this.request<Page<RequestLog>>("GET", "/logs", undefined, params, options) };
  /** Current allowances for this key's mode. Recovery reads do not use monthly API requests. */
  readonly usage = { get: (options?: RequestOptions) => this.request<Result<UsageSummary>>("GET", "/usage", undefined, undefined, options) };

  /** Lazily iterate a cursor-paginated list. Stops on malformed/repeated cursors. */
  async *paginate<T>(fetchPage: (cursor?: string) => Promise<Page<T>>): AsyncGenerator<T> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await fetchPage(cursor);
      for (const item of page.data) yield item;
      if (!page.meta.has_more) return;
      const next = page.meta.next_cursor;
      if (!next || seen.has(next)) throw new CastrookError(502, "invalid_pagination", "The API returned a missing or repeated cursor.", null);
      seen.add(next); cursor = next;
    } while (cursor);
  }
}

/** Browser-safe helper for a ticket obtained from your server; it never needs a Castrook key. */
export async function uploadToURL(upload: MediaUpload, source: Blob | Uint8Array, options: RequestOptions & { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<void> {
  let url: URL;
  try { url = new URL(upload.url); } catch { throw new TypeError("Use a valid HTTPS direct-upload ticket."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || upload.method !== "PUT") throw new TypeError("Use a valid HTTPS direct-upload ticket.");
  if (!Number.isFinite(Date.parse(upload.expires_at)) || Date.parse(upload.expires_at) <= Date.now()) throw new CastrookError(410, "media_upload_expired", "The upload ticket has expired. Request a new ticket.", null);
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new TypeError("timeoutMs must be a positive integer.");
  const headers = new Headers(upload.headers);
  if (headers.has("authorization") || headers.has("cookie")) throw new TypeError("A direct-upload ticket must not contain account credentials.");
  const body = source instanceof Blob ? source : new Blob([new Uint8Array(source)]);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try { response = await (options.fetch ?? globalThis.fetch)(url, { method: "PUT", headers, body, signal, credentials: "omit", redirect: "error" }); }
  catch { throw new CastrookError(0, "media_upload_interrupted", "The upload could not be confirmed. Complete the pending asset to verify it before starting another upload.", null); }
  // An immutable staging object may already exist after an interrupted PUT.
  // Completion verifies the full size/type/digest before accepting that object.
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok && response.status !== 412) throw new CastrookError(response.status, "media_upload_failed", "The file could not be uploaded. Check the upload ticket and try again.", null);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const when = Date.parse(value);
  return Number.isFinite(when) ? Math.max(0, Math.ceil((when - Date.now()) / 1000)) : undefined;
}
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Verify the exact raw request body before JSON parsing. Deduplicate the event ID separately. */
export async function verifyWebhook(input: { secret: string; id: string; timestamp: string; signature: string; body: string; toleranceSeconds?: number; now?: number }): Promise<boolean> {
  const timestamp = Number(input.timestamp);
  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(timestamp) || !Number.isFinite(now) || !/^\d+$/.test(input.timestamp) || !Number.isFinite(tolerance) || tolerance < 0 || Math.abs(now / 1000 - timestamp) > tolerance || !/^v1=[a-f0-9]{64}$/.test(input.signature)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(input.secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const hex = input.signature.slice(3);
  const signature = Uint8Array.from(hex.match(/../g) ?? [], value => parseInt(value, 16));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(`${input.id}.${input.timestamp}.${input.body}`));
}
