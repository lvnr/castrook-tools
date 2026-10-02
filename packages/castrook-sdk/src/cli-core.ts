import { randomUUID } from "node:crypto";
import { basename, extname, resolve } from "node:path";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { Castrook, CastrookError, SDK_VERSION, DEFAULT_BASE_URL, type AnalyticsFilters, type CreateConnectSessionInput, type CreatePostInput, type CreateProfileInput, type MediaContentType, type Page, type Platform, type Post, type PostStatus, type UpdateProfileInput, type WebhookEventType } from "./index.js";
import { ALL_SCOPES, READ_SCOPES, CliError, loadLogin, login, logout, readJSONFile, refreshLogin, serviceBase, type AuthRuntime } from "./cli-auth.js";

type Writer = (text: string) => void;
export type CliRuntime = { env?: NodeJS.ProcessEnv; stdout?: Writer; stderr?: Writer; stdin?: () => Promise<string>; fetch?: typeof fetch; openBrowser?: (url: string) => Promise<void>; now?: () => number; loginTimeoutMs?: number };
type Parsed = { words: string[]; flags: Map<string, string | true> };
const booleanFlags = new Set(["json", "help", "version", "publish", "no-browser", "all", "unassign", "local-only"]);
const valueFlags = new Set(["data", "base-url", "request-timeout", "scopes", "mode", "profile", "name", "external-id", "platform", "q", "limit", "cursor", "status", "from", "to", "account", "post", "webhook", "content-type", "idempotency-key", "wait-timeout", "interval", "secret-file"]);
const commonFlags = ["json", "help", "base-url", "request-timeout"];
const listFlags = ["limit", "cursor", "all"];
const filters = ["profile", "account", "platform", "from", "to"];
const commandFlags: Record<string, string[]> = {
  login: ["scopes", "publish", "mode", "no-browser"], logout: ["local-only"], refresh: [], whoami: [], usage: [],
  "accounts list": [...listFlags, "profile", "platform", "q"], "accounts create-test": ["data"], "accounts options": [], "accounts assign": ["profile", "unassign"], "accounts disconnect": [],
  "profiles list": [...listFlags, "external-id", "q"], "profiles create": ["data", "name", "external-id"], "profiles get": [], "profiles update": ["data"], "profiles delete": [],
  "connections create": ["data"], "connections get": [], "connections revoke": [],
  "media list": [...listFlags, "profile"], "media upload": ["profile", "content-type"], "media get": [], "media complete": [], "media delete": [],
  "posts list": [...listFlags, "profile", "platform", "status", "q"], "posts create": ["data", "idempotency-key"], "posts get": [], "posts cancel": [], "posts wait": ["wait-timeout", "interval"],
  "analytics posts": [...listFlags, ...filters], "analytics summary": filters, "analytics refresh": [],
  "comments list": ["account", "post", "cursor", "all"], "comments reply": ["data"],
  "webhooks list": listFlags, "webhooks create": ["data", "secret-file"], "webhooks disable": [],
  "deliveries list": [...listFlags, "webhook"], "logs list": listFlags, "api": ["data", "idempotency-key"],
};
export const HELP = `Castrook ${SDK_VERSION} — publish, schedule and inspect social content

Usage: castrook COMMAND [OPTIONS]

  login [--publish] [--scopes 'accounts:read posts:write ...'] [--mode test|live]
  logout [--local-only]                 Revoke the sign-in and remove local credentials
  refresh                              Rotate the saved OAuth credentials
  whoami                               Show the active authentication and mode
  accounts list|create-test|options|assign|disconnect
  profiles list|create|get|update|delete
  connections create|get|revoke         Customer account onboarding links
  media upload FILE [--profile ID]      Verify and freeze a durable private asset
  media list|get|complete|delete
  posts create --data @post.json [--idempotency-key KEY]
  posts list|get|cancel|wait ID          Wait exits 3 if delivery fails or is canceled
  analytics posts|summary|refresh
  comments list --account ID --post ID  Reply with comments reply --data @reply.json
  webhooks list|create|disable          Create requires --data and --secret-file PATH
  deliveries list [--webhook ID]
  logs list
  usage
  api METHOD /resource [--data @file]   JSON REST escape hatch; API-relative paths only

Options:
  --json                 JSON on stdout; errors/progress stay on stderr
  --data @FILE | -       Request JSON from a file or stdin; no inline secret arguments
  --all                  Follow all list pages (bounded to 10,000 items)
  --limit N --cursor C    List page size and cursor
  --profile ID           Filter/group customer resources
  --base-url URL         Override https://castrook.com/api/v1 (HTTP loopback for dev)
  --request-timeout MS   Per-request timeout (default 30000)
  --help --version

Authentication: CASTROOK_API_KEY or CASTROOK_ACCESS_TOKEN environment variables,
or castrook login. Default login asks for read access and Test mode. --publish adds
posts:write and media:write. Use --scopes for other explicit permissions. OAuth
mode is bound to the grant; a local flag cannot turn a Test grant into Live access.
Use files for exact publishing content. TikTok creator approval is still required.
Exit codes: 0 success, 2 input, 3 operation/delivery, 4 authentication, 5 network.
`;

function parse(argv: string[]): Parsed {
  const words: string[] = []; const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--") { words.push(...argv.slice(i + 1)); break; }
    if (!argument.startsWith("--")) { if (argument.startsWith("-")) throw new CliError(2, "invalid_option", "Use long option names such as --json and --data."); words.push(argument); continue; }
    const equal = argument.indexOf("="); const name = argument.slice(2, equal < 0 ? undefined : equal);
    if (!booleanFlags.has(name) && !valueFlags.has(name)) throw new CliError(2, "invalid_option", `Unknown option --${name.replace(/[^a-z-]/gi, "")}. Credentials belong in environment variables, never arguments.`);
    if (flags.has(name)) throw new CliError(2, "invalid_option", `Use --${name} only once.`);
    if (booleanFlags.has(name)) { if (equal >= 0) throw new CliError(2, "invalid_option", `Use --${name} without a value.`); flags.set(name, true); continue; }
    const value = equal >= 0 ? argument.slice(equal + 1) : argv[++i];
    if (!value || value.startsWith("--")) throw new CliError(2, "invalid_option", `Provide a value for --${name}.`);
    flags.set(name, value);
  }
  return { words, flags };
}
function value(args: Parsed, flag: string): string | undefined { const result = args.flags.get(flag); return typeof result === "string" ? result : undefined; }
function required(args: Parsed, flag: string): string { const result = value(args, flag); if (!result) throw new CliError(2, "missing_input", `Provide --${flag}.`); return result; }
function integer(args: Parsed, flag: string, fallback: number, maximum: number): number {
  const raw = value(args, flag); if (raw === undefined) return fallback;
  const result = Number(raw); if (!/^\d+$/.test(raw) || !Number.isSafeInteger(result) || result < 1 || result > maximum) throw new CliError(2, "invalid_input", `--${flag} must be an integer between 1 and ${maximum}.`); return result;
}
function id(words: string[]): string { if (words.length !== 1 || !words[0] || /[\u0000-\u0020\u007f]/.test(words[0])) throw new CliError(2, "missing_input", "Provide one resource ID."); return words[0]; }
function noWords(words: string[]) { if (words.length) throw new CliError(2, "invalid_input", "This command does not accept extra positional arguments."); }
function publicationKey(args: Parsed): string {
  const key = value(args, "idempotency-key") ?? randomUUID();
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(key) || /^cr_(?:test|live|oauth|refresh)_/.test(key)) throw new CliError(2, "invalid_idempotency_key", "Use a public 8–128 character idempotency key, never an account credential.");
  return key;
}
function redact(value_: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value_ === "string") return value_.replace(/cr_(?:test|live|oauth|refresh)_[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 1500);
  if (Array.isArray(value_)) return value_.slice(0, 50).map(item => redact(item, depth + 1));
  if (value_ && typeof value_ === "object") return Object.fromEntries(Object.entries(value_).filter(([key]) => !/token|secret|authorization|password|cookie/i.test(key)).map(([key, item]) => [key, redact(item, depth + 1)]));
  return value_;
}
async function readStdin(): Promise<string> { let text = ""; for await (const chunk of process.stdin) { text += chunk.toString(); if (Buffer.byteLength(text) > 65_536) throw new CliError(2, "invalid_input", "JSON input must be at most 64 KiB."); } return text; }
async function body(args: Parsed, runtime: CliRuntime): Promise<Record<string, unknown>> {
  const source = required(args, "data"); let parsed: unknown;
  try {
    if (source === "-") { const text = await (runtime.stdin ?? readStdin)(); if (Buffer.byteLength(text) > 65_536) throw new CliError(2, "invalid_input", "JSON input must be at most 64 KiB."); parsed = JSON.parse(text); }
    else if (source.startsWith("@") && source.length > 1) parsed = await readJSONFile(source.slice(1));
    else throw new CliError(2, "invalid_input", "Use --data @file.json or --data - for stdin.");
  } catch (error) { if (error instanceof CliError) throw error; throw new CliError(2, "invalid_json", "The JSON input could not be read. Use a valid file or stdin object."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CliError(2, "invalid_json", "Request JSON must be an object.");
  return parsed as Record<string, unknown>;
}
function pageParams(args: Parsed) { return { ...(value(args, "limit") ? { limit: integer(args, "limit", 50, 100) } : {}), ...(value(args, "cursor") ? { cursor: value(args, "cursor") } : {}) }; }
async function list<T>(client: Castrook, args: Parsed, fetchPage: (cursor?: string) => Promise<Page<T>>) {
  if (!args.flags.has("all")) return fetchPage(value(args, "cursor"));
  if (args.flags.has("cursor")) throw new CliError(2, "invalid_input", "Use --all or --cursor, not both.");
  const data: T[] = [];
  for await (const item of client.paginate(fetchPage)) { if (data.length >= 10_000) throw new CliError(3, "list_too_large", "The list exceeds 10,000 items. Use filters or explicit pages."); data.push(item); }
  return { data, meta: { next_cursor: null, has_more: false } };
}
function analyticsFilters(args: Parsed): AnalyticsFilters { return { profile_id: value(args, "profile"), account_id: value(args, "account"), platform: value(args, "platform") as Platform | undefined, from: value(args, "from"), to: value(args, "to") }; }
function contentType(filename: string, override?: string): MediaContentType {
  const known: Record<string, MediaContentType> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };
  const selected = override ?? known[extname(filename).toLowerCase()];
  if (!Object.values(known).includes(selected as MediaContentType)) throw new CliError(2, "unsupported_media", "Use JPEG, PNG, WebP, MP4, MOV or WebM; set --content-type if the filename has no extension."); return selected as MediaContentType;
}

/** Scriptable entry point. The bin delegates here; tests can inject IO and a transport. */
export async function runCLI(argv: string[], runtime: CliRuntime = {}): Promise<number> {
  const env = runtime.env ?? process.env; const out = runtime.stdout ?? (text => process.stdout.write(text)); const err = runtime.stderr ?? (text => process.stderr.write(text));
  const json = argv.includes("--json"); let attemptKey: string | undefined;
  try {
    const args = parse(argv);
    if (args.flags.has("version")) { out(json ? JSON.stringify({ version: SDK_VERSION }) + "\n" : SDK_VERSION + "\n"); return 0; }
    if (!args.words.length || args.flags.has("help") || args.words[0] === "help") { out(json ? JSON.stringify({ version: SDK_VERSION, help: HELP, scopes: ALL_SCOPES }) + "\n" : HELP); return 0; }
    const top = args.words[0]; const standalone = ["login", "logout", "refresh", "whoami", "usage", "api"].includes(top);
    const action = standalone ? "" : args.words[1] ?? "list";
    const command = standalone ? top : `${top} ${action}`;
    const rest = args.words.slice(standalone ? 1 : 2);
    if (!(command in commandFlags)) throw new CliError(2, "unknown_command", "Unknown command. Run castrook --help for supported tasks.");
    const allowed = new Set([...commonFlags, ...commandFlags[command]]);
    for (const name of args.flags.keys()) if (!allowed.has(name)) throw new CliError(2, "invalid_option", `--${name} is not supported for this command.`);
    // Reject bad list arguments before an API request can mutate anything.
    if (args.flags.has("all") && args.flags.has("cursor")) throw new CliError(2, "invalid_input", "Use --all or --cursor, not both.");
    const auth: AuthRuntime = { fetcher: runtime.fetch ?? globalThis.fetch, env, stderr: err, openBrowser: runtime.openBrowser, now: runtime.now };
    let base = serviceBase(value(args, "base-url") ?? env.CASTROOK_BASE_URL ?? DEFAULT_BASE_URL);
    const write = (result: unknown) => out(JSON.stringify(result, null, json ? undefined : 2) + "\n");
    if (command === "login") {
      noWords(rest); const mode = value(args, "mode") ?? "test";
      if (mode !== "test" && mode !== "live") throw new CliError(2, "invalid_mode", "Choose --mode test or --mode live.");
      if (args.flags.has("publish") && args.flags.has("scopes")) throw new CliError(2, "invalid_input", "Choose --publish or exact --scopes, not both.");
      const scopes = value(args, "scopes")?.split(/[\s,]+/).filter(Boolean) ?? [...READ_SCOPES, ...(args.flags.has("publish") ? ["posts:write", "media:write"] : [])];
      if (!scopes.length || scopes.some(scope => !ALL_SCOPES.includes(scope))) throw new CliError(2, "invalid_scope", "Use scopes from castrook --help --json.");
      const saved = await login(auth, { base, mode, scopes, noBrowser: args.flags.has("no-browser"), timeoutMs: runtime.loginTimeoutMs });
      write({ authenticated: true, mode: saved.mode, scopes: saved.scope.split(" "), expires_at: new Date(saved.expires_at).toISOString() }); return 0;
    }
    if (command === "logout") { noWords(rest); write(await logout(auth, args.flags.has("local-only"))); return 0; }
    if (command === "refresh") {
      noWords(rest); const previous = await loadLogin(env); if (!value(args, "base-url") && !env.CASTROOK_BASE_URL && previous) base = serviceBase(previous.base_url);
      const saved = await refreshLogin(auth, base, true); write({ authenticated: true, mode: saved.mode, scopes: saved.scope.split(" "), expires_at: new Date(saved.expires_at).toISOString() }); return 0;
    }
    if (env.CASTROOK_API_KEY && env.CASTROOK_ACCESS_TOKEN) throw new CliError(2, "ambiguous_credentials", "Set only one of CASTROOK_API_KEY or CASTROOK_ACCESS_TOKEN.");
    const authentication: "api_key" | "oauth" = env.CASTROOK_API_KEY ? "api_key" : "oauth";
    let scopes: string[] | undefined; let expiresAt: string | undefined;
    let credentials: { apiKey: string } | { accessToken: string };
    if (env.CASTROOK_API_KEY) credentials = { apiKey: env.CASTROOK_API_KEY };
    else if (env.CASTROOK_ACCESS_TOKEN) credentials = { accessToken: env.CASTROOK_ACCESS_TOKEN };
    else {
      const previous = await loadLogin(env); if (!previous) throw new CliError(4, "authentication_required", "Run castrook login, or set CASTROOK_API_KEY in your environment.");
      if (previous.refresh_pending) throw new CliError(4, "refresh_unconfirmed", "Credential rotation was interrupted. Run castrook login again; the previous refresh token will not be reused.");
      if (!value(args, "base-url") && !env.CASTROOK_BASE_URL) base = serviceBase(previous.base_url);
      if (previous.base_url !== base) throw new CliError(4, "credential_origin_mismatch", "The saved sign-in belongs to another API base. Sign in explicitly for this service.");
      const saved = previous.expires_at > (runtime.now ?? Date.now)() + 60_000 ? previous : await refreshLogin(auth, base);
      credentials = { accessToken: saved.access_token }; scopes = saved.scope.split(" "); expiresAt = new Date(saved.expires_at).toISOString();
    }
    const fetcher: typeof fetch = async (input, init) => { try { return await auth.fetcher(input, init); } catch { throw new CliError(5, "network_error", "The API request could not be confirmed. Inspect the resource before retrying a write."); } };
    const client = new Castrook({ ...credentials, baseURL: base, fetch: fetcher, timeoutMs: integer(args, "request-timeout", 30_000, 2_147_483_647) });
    const page = pageParams(args); let result: unknown;
    switch (command) {
      case "whoami": { noWords(rest); const { data: usage } = await client.usage.get(); result = { authenticated: true, authentication, mode: usage.mode, plan: usage.plan, base_url: base, ...(scopes ? { scopes } : {}), ...(expiresAt ? { expires_at: expiresAt } : {}) }; break; }
      case "usage": noWords(rest); result = await client.usage.get(); break;
      case "accounts list": noWords(rest); result = await list(client, args, cursor => client.accounts.list({ ...page, cursor, profile_id: value(args, "profile"), platform: value(args, "platform") as Platform | undefined, q: value(args, "q") })); break;
      case "accounts create-test": noWords(rest); if (env.CASTROOK_API_KEY?.startsWith("cr_live_") || (await client.usage.get()).data.mode !== "test") throw new CliError(3, "test_mode_required", "Simulated accounts require a Test grant or Test API key. Connect Live accounts using connections create."); result = await client.accounts.createTest(await body(args, runtime) as { platform: Platform }); break;
      case "accounts options": result = await client.accounts.publishingOptions(id(rest)); break;
      case "accounts assign": if (Boolean(value(args, "profile")) === args.flags.has("unassign")) throw new CliError(2, "invalid_input", "Choose --profile ID or --unassign."); result = await client.accounts.assignProfile(id(rest), args.flags.has("unassign") ? null : required(args, "profile")); break;
      case "accounts disconnect": result = await client.accounts.disconnect(id(rest)); break;
      case "profiles list": noWords(rest); result = await list(client, args, cursor => client.profiles.list({ ...page, cursor, external_id: value(args, "external-id"), q: value(args, "q") })); break;
      case "profiles create": noWords(rest); if (args.flags.has("data") && (args.flags.has("name") || args.flags.has("external-id"))) throw new CliError(2, "invalid_input", "Use --data or profile field flags, not both."); result = await client.profiles.create(args.flags.has("data") ? await body(args, runtime) as CreateProfileInput : { name: required(args, "name"), ...(value(args, "external-id") ? { external_id: value(args, "external-id") } : {}) }); break;
      case "profiles get": result = await client.profiles.get(id(rest)); break;
      case "profiles update": result = await client.profiles.update(id(rest), await body(args, runtime) as UpdateProfileInput); break;
      case "profiles delete": result = await client.profiles.delete(id(rest)); break;
      case "connections create": noWords(rest); result = await client.connectSessions.create(await body(args, runtime) as CreateConnectSessionInput); break;
      case "connections get": result = await client.connectSessions.get(id(rest)); break;
      case "connections revoke": result = await client.connectSessions.revoke(id(rest)); break;
      case "media list": noWords(rest); result = await list(client, args, cursor => client.media.list({ ...page, cursor, profile_id: value(args, "profile") })); break;
      case "media upload": {
        if (rest.length !== 1 || !rest[0] || /[\u0000-\u001f\u007f]/.test(rest[0])) throw new CliError(2, "missing_input", "Provide one media file path.");
        const filename = rest[0]; const selectedType = contentType(filename, value(args, "content-type"));
        const handle = await open(filename, "r"); let bytes: Buffer;
        try { const stat = await handle.stat(); if (!stat.isFile() || stat.size < 1 || stat.size > (selectedType.startsWith("image/") ? 20 : 128) * 1024 * 1024) throw new CliError(2, "invalid_media", "Use a regular file up to 20 MiB for images or 128 MiB for videos."); bytes = await handle.readFile(); }
        finally { await handle.close(); }
        err("Uploading and verifying private media…\n"); result = await client.media.upload(bytes, { filename: basename(filename), content_type: selectedType, ...(value(args, "profile") ? { profile_id: value(args, "profile") } : {}) }); break;
      }
      case "media get": result = await client.media.get(id(rest)); break;
      case "media complete": result = await client.media.complete(id(rest)); break;
      case "media delete": result = await client.media.delete(id(rest)); break;
      case "posts list": noWords(rest); result = await list(client, args, cursor => client.posts.list({ ...page, cursor, profile_id: value(args, "profile"), platform: value(args, "platform") as Platform | undefined, status: value(args, "status") as PostStatus | undefined, q: value(args, "q") })); break;
      case "posts create": noWords(rest); attemptKey = publicationKey(args); err(`Idempotency key: ${attemptKey}\n`); result = await client.posts.create(await body(args, runtime) as CreatePostInput, { idempotencyKey: attemptKey }); break;
      case "posts get": result = await client.posts.get(id(rest)); break;
      case "posts cancel": result = await client.posts.cancel(id(rest)); break;
      case "posts wait": {
        const postId = id(rest); const timeout = integer(args, "wait-timeout", 300, 86_400) * 1000; const interval = integer(args, "interval", 2, 60) * 1000; const deadline = Date.now() + timeout;
        let post: Post;
        while (true) { post = (await client.posts.get(postId)).data; if (["published", "partially_failed", "failed", "canceled"].includes(post.status)) break; if (Date.now() >= deadline) throw new CliError(3, "delivery_pending", "Delivery is still pending. Poll the same post; do not create another publication.", { post_id: postId, status: post.status }); await new Promise(resolveWait => setTimeout(resolveWait, Math.min(interval, Math.max(1, deadline - Date.now())))); }
        write({ data: post }); return post.status === "published" ? 0 : 3;
      }
      case "analytics posts": noWords(rest); result = await list(client, args, cursor => client.analytics.posts({ ...analyticsFilters(args), ...page, cursor })); break;
      case "analytics summary": noWords(rest); result = await client.analytics.summary(analyticsFilters(args)); break;
      case "analytics refresh": result = await client.analytics.refresh(id(rest)); break;
      case "comments list": noWords(rest); result = await list(client, args, cursor => client.comments.list({ account_id: required(args, "account"), post_id: required(args, "post"), cursor })); break;
      case "comments reply": noWords(rest); result = await client.comments.reply(await body(args, runtime) as { account_id: string; post_id: string; comment_id: string; text: string }); break;
      case "webhooks list": noWords(rest); result = await list(client, args, cursor => client.webhooks.list({ ...page, cursor })); break;
      case "webhooks create": {
        noWords(rest); const input = await body(args, runtime); const path = resolve(required(args, "secret-file"));
        const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
        let saved = false;
        try { const created = await client.webhooks.create(input as { url: string; events: WebhookEventType[] }); await handle.writeFile(created.data.secret + "\n", "utf8"); await handle.sync(); saved = true; const { secret: _secret, ...publicWebhook } = created.data; void _secret; result = { data: publicWebhook, secret_file: path }; }
        finally { await handle.close(); if (!saved) await unlink(path).catch(() => undefined); }
        break;
      }
      case "webhooks disable": result = await client.webhooks.disable(id(rest)); break;
      case "deliveries list": noWords(rest); result = await list(client, args, cursor => client.deliveries.list({ ...page, cursor, webhook_id: value(args, "webhook") })); break;
      case "logs list": noWords(rest); result = await list(client, args, cursor => client.logs.list({ ...page, cursor })); break;
      case "api": {
        if (rest.length !== 2 || !["GET", "POST", "PATCH", "DELETE"].includes(rest[0])) throw new CliError(2, "invalid_input", "Use api GET|POST|PATCH|DELETE /resource [--data @file].");
        if (rest[0] === "GET" && args.flags.has("data")) throw new CliError(2, "invalid_input", "GET does not accept --data.");
        // This response contains a one-time credential. The dedicated command
        // prepares its private output file before creating the remote resource.
        if (rest[0] === "POST") {
          let pathname: string;
          try { pathname = decodeURIComponent(new URL(`${base}${rest[1]}`).pathname).replace(/\/+$/, ""); }
          catch { throw new CliError(2, "invalid_input", "Use an API-relative resource path."); }
          if (pathname === "/api/v1/webhooks") throw new CliError(2, "secret_file_required", "Use webhooks create with --secret-file to save its one-time credential privately.");
        }
        attemptKey = args.flags.has("idempotency-key") || rest[0] === "POST" && rest[1] === "/posts" ? publicationKey(args) : undefined; if (attemptKey) err(`Idempotency key: ${attemptKey}\n`);
        result = await client.api(rest[0] as "GET" | "POST" | "PATCH" | "DELETE", rest[1], { ...(args.flags.has("data") ? { body: await body(args, runtime) } : {}), ...(attemptKey ? { idempotencyKey: attemptKey } : {}) }); break;
      }
    }
    write(result); return 0;
  } catch (failure) {
    const fileError = ["ENOENT", "EACCES", "EISDIR", "EEXIST"].includes((failure as NodeJS.ErrnoException)?.code || "");
    const error = failure instanceof CliError ? failure : failure instanceof CastrookError ? new CliError(failure.status === 401 || failure.status === 403 ? 4 : failure.status >= 500 || failure.status === 0 ? 5 : 3, failure.code, failure.message, failure.details) : fileError ? new CliError(2, "local_file_error", "A local file could not be opened. Check its path and permissions; output files must not already exist.") : failure instanceof TypeError ? new CliError(2, "invalid_input", failure.message) : new CliError(5, "operation_unconfirmed", "The operation could not be confirmed. Inspect the resource before retrying a write.");
    const details = { ...(error.details && typeof error.details === "object" ? redact(error.details) as object : {}), ...(attemptKey ? { idempotency_key: attemptKey } : {}) };
    const envelope = { error: { code: error.code, message: redact(error.message), ...(Object.keys(details).length ? { details } : {}) }, ...(failure instanceof CastrookError && failure.requestId ? { request_id: failure.requestId } : {}) };
    err(json ? JSON.stringify(envelope) + "\n" : `${error.code}: ${redact(error.message)}${attemptKey ? ` Retry the same JSON with --idempotency-key ${attemptKey}.` : ""}\n`);
    return error.exitCode;
  }
}
