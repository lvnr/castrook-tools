import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCLI } from "../packages/castrook-sdk/src/cli-core";
import { saveLogin } from "../packages/castrook-sdk/src/cli-auth";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "castrook-cli-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function harness(fetcher = vi.fn<typeof fetch>(), extraEnv: Partial<NodeJS.ProcessEnv> = {}) {
  let output = ""; let errors = "";
  const options = { env: { NODE_ENV: "test" as const, CASTROOK_API_KEY: "cr_test_example", CASTROOK_CONFIG_DIR: join(directory, "config"), ...extraEnv }, fetch: fetcher, stdout: (text: string) => { output += text; }, stderr: (text: string) => { errors += text; } };
  return { fetcher, options, output: () => output, errors: () => errors };
}

describe("castrook CLI tasks", () => {
  it("shows help and version without authentication or network activity", async () => {
    const h = harness();
    expect(await runCLI(["--help", "--json"], h.options)).toBe(0);
    expect(JSON.parse(h.output()).help).toContain("--publish");
    expect(h.output()).not.toContain("cr_test_example"); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("rejects credential arguments and unsupported local mode switches before a write", async () => {
    for (const arguments_ of [["posts", "create", "--api-key", "cr_live_do-not-print"], ["posts", "create", "--mode", "live", "--data", "-"], ["posts", "create", "--idempotency-key", "cr_live_do-not-print", "--data", "-"]]) {
      const h = harness(); expect(await runCLI([...arguments_, "--json"], h.options)).toBe(2);
      expect(h.output() + h.errors()).not.toContain("cr_live_do-not-print"); expect(h.fetcher).not.toHaveBeenCalled();
    }
  });
  it("shows the server's mode and sends bearer credentials only through headers", async () => {
    const h = harness(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { mode: "live", plan: "growth" } })), { CASTROOK_API_KEY: undefined, CASTROOK_ACCESS_TOKEN: `cr_oauth_${"a".repeat(43)}` });
    expect(await runCLI(["whoami", "--json"], h.options)).toBe(0);
    expect(JSON.parse(h.output())).toMatchObject({ authentication: "oauth", mode: "live", plan: "growth" });
    expect(h.output() + h.errors()).not.toContain("cr_oauth_");
    expect(h.fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: `Bearer cr_oauth_${"a".repeat(43)}` } });
  });
  it("does not automatically reuse credentials after an uncertain refresh even while access appears fresh", async () => {
    const h = harness(vi.fn<typeof fetch>(), { CASTROOK_API_KEY: undefined });
    await saveLogin(h.options.env, { version: 1, base_url: "https://castrook.com/api/v1", resource: "https://castrook.com/api/v1", client_id: "fixture-cli", access_token: `cr_oauth_${"a".repeat(43)}`, refresh_token: "fixture-one-use-token", expires_at: Date.now() + 3_600_000, scope: "usage:read", mode: "test", refresh_pending: true });
    expect(await runCLI(["whoami", "--json"], h.options)).toBe(4);
    expect(JSON.parse(h.errors()).error.code).toBe("refresh_unconfirmed");
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.output() + h.errors()).not.toContain("fixture-one-use-token");
  });
  it("keeps exact post JSON and identity stable through transient retries", async () => {
    const h = harness(vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: "platform_busy", message: "Retry." } }, { status: 503, headers: { "retry-after": "0" } })).mockResolvedValueOnce(Response.json({ data: { id: "pst_test", status: "queued" } })));
    const post = { text: "Original caption", account_ids: ["acc_test"], destinations: [{ account_id: "acc_test", text: "Customized caption", options: { title: "Exact title" } }] };
    expect(await runCLI(["posts", "create", "--data", "-", "--idempotency-key", "stable-cli-post", "--json"], { ...h.options, stdin: async () => JSON.stringify(post) })).toBe(0);
    expect(JSON.parse(h.output()).data.status).toBe("queued");
    expect(h.fetcher.mock.calls.map(call => call[1]?.body)).toEqual([JSON.stringify(post), JSON.stringify(post)]);
    expect(h.fetcher.mock.calls.every(call => new Headers(call[1]?.headers).get("idempotency-key") === "stable-cli-post")).toBe(true);
    expect(h.errors()).toBe("Idempotency key: stable-cli-post\n");
    expect(h.output()).not.toContain("Original caption");
  });
  it("never blindly repeats an ambiguous comment reply or prints a transport's credential error", async () => {
    const h = harness(vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed with cr_test_example and private token")));
    expect(await runCLI(["comments", "reply", "--data", "-", "--json"], { ...h.options, stdin: async () => JSON.stringify({ account_id: "acc_a", post_id: "pst_a", comment_id: "c1", text: "Thanks" }) })).toBe(5);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.errors()).error.code).toBe("network_error"); expect(h.errors()).not.toContain("cr_test_example"); expect(h.output()).toBe("");
  });
  it("returns quota errors with request IDs and a reusable publication key without retry loops", async () => {
    const h = harness(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "usage_limit_exceeded", message: "Allowance exhausted.", details: { reset_at: "2026-11-01T00:00:00Z", secret: "do-not-print" } }, request_id: "req_quota" }, { status: 429, headers: { "retry-after": "0" } })));
    expect(await runCLI(["posts", "create", "--data", "-", "--idempotency-key", "stable-cli-post", "--json"], { ...h.options, stdin: async () => '{"text":"Hello","account_ids":["acc_a"]}' })).toBe(3);
    expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.output()).toBe(""); expect(h.errors()).not.toContain("do-not-print");
    const failure = JSON.parse(h.errors().trim().split("\n").at(-1)!);
    expect(failure).toMatchObject({ request_id: "req_quota", error: { code: "usage_limit_exceeded", details: { reset_at: "2026-11-01T00:00:00Z", idempotency_key: "stable-cli-post" } } });
  });
  it("uses explicit cursor pagination for complete customer lists", async () => {
    const h = harness(vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{ id: "prf_a" }], meta: { next_cursor: "next/acme", has_more: true } })).mockResolvedValueOnce(Response.json({ data: [{ id: "prf_b" }], meta: { next_cursor: null, has_more: false } })));
    expect(await runCLI(["profiles", "list", "--all", "--q", "Acme & Sons", "--json"], h.options)).toBe(0);
    expect(JSON.parse(h.output()).data).toEqual([{ id: "prf_a" }, { id: "prf_b" }]);
    expect(new URL(String(h.fetcher.mock.calls[1][0])).searchParams.get("cursor")).toBe("next/acme");
    expect(new URL(String(h.fetcher.mock.calls[1][0])).searchParams.get("q")).toBe("Acme & Sons");
  });
  it("rejects malformed request JSON before making a publication request", async () => {
    const h = harness();
    expect(await runCLI(["posts", "create", "--data", "-", "--json"], { ...h.options, stdin: async () => "[]" })).toBe(2);
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.output()).toBe("");
  });
  it("uploads a spaced filename privately, permits duplicate immutable PUT and verifies completion", async () => {
    const path = join(directory, "my photo.png"); const bytes = Buffer.from([137, 80, 78, 71]); await writeFile(path, bytes);
    const upload = { asset: { id: "ast_test", status: "pending" }, upload: { url: "https://storage.example/staging?signature=private", method: "PUT", headers: { "content-type": "image/png", "if-none-match": "*" }, expires_at: new Date(Date.now() + 60_000).toISOString() } };
    const h = harness(vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: upload })).mockResolvedValueOnce(new Response(null, { status: 412 })).mockResolvedValueOnce(Response.json({ data: { id: "ast_test", status: "ready" } })));
    expect(await runCLI(["media", "upload", path, "--profile", "prf_a", "--json"], h.options)).toBe(0);
    const input = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
    expect(input).toMatchObject({ filename: "my photo.png", content_type: "image/png", size: 4, sha256: createHash("sha256").update(bytes).digest("hex"), profile_id: "prf_a" });
    expect(new Headers(h.fetcher.mock.calls[1][1]?.headers).has("authorization")).toBe(false);
    expect(h.fetcher.mock.calls[1][1]).toMatchObject({ credentials: "omit", redirect: "error" });
    expect(h.output() + h.errors()).not.toContain("signature=private"); expect(JSON.parse(h.output()).data.status).toBe("ready");
  });
  it("writes a webhook secret to a new private file and never stdout or logs", async () => {
    const secret = "whsec_do-not-log"; const path = join(directory, "webhook-secret");
    const h = harness(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { id: "whk_a", secret, status: "active" } })));
    expect(await runCLI(["webhooks", "create", "--data", "-", "--secret-file", path, "--json"], { ...h.options, stdin: async () => '{"url":"https://example.com/events","events":["post.published"]}' })).toBe(0);
    expect(await readFile(path, "utf8")).toBe(secret + "\n"); expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(h.output() + h.errors()).not.toContain(secret); expect(JSON.parse(h.output())).toMatchObject({ data: { id: "whk_a" }, secret_file: path });
    const duplicate = harness();
    expect(await runCLI(["webhooks", "create", "--data", "-", "--secret-file", path, "--json"], { ...duplicate.options, stdin: async () => "{}" })).toBe(2);
    expect(duplicate.fetcher).not.toHaveBeenCalled();
    for (const resource of ["/webhooks", "/webhooks/?q=x", "/web%68ooks"]) {
      const unsafe = harness();
      expect(await runCLI(["api", "POST", resource, "--data", "-", "--json"], { ...unsafe.options, stdin: async () => "{}" })).toBe(2);
      expect(JSON.parse(unsafe.errors()).error.code).toBe("secret_file_required"); expect(unsafe.fetcher).not.toHaveBeenCalled();
    }
  });
  it("does not pretend a failed destination wait is successful and blocks API origin escape", async () => {
    const h = harness(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { id: "pst_a", status: "partially_failed", targets: [{ status: "published" }, { status: "failed" }] } })));
    expect(await runCLI(["posts", "wait", "pst_a", "--json"], h.options)).toBe(3);
    expect(JSON.parse(h.output()).data.status).toBe("partially_failed");
    const unsafe = harness(); expect(await runCLI(["api", "GET", "//evil.example/posts", "--json"], unsafe.options)).toBe(2); expect(unsafe.fetcher).not.toHaveBeenCalled();
  });
});
