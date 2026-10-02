import { describe, expect, it, vi } from "vitest";
import { Castrook, SDK_VERSION, DEFAULT_BASE_URL } from "../packages/castrook-sdk/src/index";
import metadata from "../packages/castrook-sdk/package.json";

describe("castrook distribution SDK", () => {
  it("defaults to the canonical API and accepts mode-bound OAuth bearer credentials", async () => {
    const accessToken = `cr_oauth_${"a".repeat(43)}`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { mode: "test" } }));
    const sdk = new Castrook({ accessToken, fetch: fetcher });
    await sdk.usage.get();
    expect(String(fetcher.mock.calls[0][0])).toBe(`${DEFAULT_BASE_URL}/usage`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", credentials: "omit", headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": `castrook-sdk/${SDK_VERSION}` } });
    expect(metadata).toMatchObject({ name: "castrook", version: SDK_VERSION, bin: { castrook: "./dist/cli.js" }, license: "MIT" });
    expect(metadata).not.toHaveProperty("dependencies");
  });
  it("requires exactly one valid credential and never accepts an arbitrary OAuth prefix", () => {
    expect(() => new Castrook({} as never)).toThrow("exactly one");
    expect(() => new Castrook({ apiKey: "cr_test_example", accessToken: `cr_oauth_${"a".repeat(43)}` } as never)).toThrow("exactly one");
    for (const accessToken of ["secret", "cr_oauth_short", `cr_oauth_${"a".repeat(44)}`]) expect(() => new Castrook({ accessToken })).toThrow("valid Castrook OAuth");
    expect(() => new Castrook({ apiKey: "cr_test_example" })).not.toThrow();
  });
  it("keeps lower-level API calls within the configured resource and never retries unsupported writes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));
    const sdk = new Castrook({ apiKey: "cr_test_example", fetch: fetcher });
    for (const path of ["https://evil.example/posts", "//evil.example/posts", "/../../../oauth/token", "/%2e%2e/%2e%2e/oauth/token", "/posts#secret", "/posts\\escape"]) expect(() => sdk.api("GET", path)).toThrow();
    expect(() => sdk.api("POST", "/comments", { body: {}, idempotencyKey: "unsafe-reply" })).toThrow("only to POST /posts");
    expect(() => sdk.api("POST", "/posts", { body: {} })).toThrow("stable idempotency key");
    expect(() => sdk.api("GET", "/profiles", { body: {} })).toThrow("request body");
    expect(fetcher).not.toHaveBeenCalled();
    await sdk.api("GET", "/profiles", { query: { q: "Acme & Sons", limit: 10 } });
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)).toEqual({ q: "Acme & Sons", limit: "10" });
  });
  it("keeps the asset ID and server details when upload verification fails without repeating a write", async () => {
    const ticket = { asset: { id: "ast_recoverable" }, upload: { url: "https://storage.example/file?signature=private", method: "PUT", headers: {}, expires_at: new Date(Date.now() + 60_000).toISOString() } };
    for (const completion of [
      () => Response.json({ error: { code: "media_checksum_mismatch", message: "Digest did not match.", details: { metric: "sha256" } }, request_id: "req_media" }, { status: 422 }),
      () => { throw new TypeError("transport failed with cr_test_example"); },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: ticket })).mockResolvedValueOnce(new Response(null, { status: 204 })).mockImplementationOnce(async () => completion());
      const sdk = new Castrook({ apiKey: "cr_test_example", fetch: fetcher });
      const failure = await sdk.media.upload(new Uint8Array([1, 2, 3]), { filename: "video.mp4", content_type: "video/mp4" }).catch(error => error);
      expect(failure).toMatchObject({ details: { asset_id: "ast_recoverable" } });
      if (failure.status === 422) expect(failure).toMatchObject({ code: "media_checksum_mismatch", requestId: "req_media", details: { metric: "sha256" } });
      else { expect(failure).toMatchObject({ code: "media_completion_interrupted", status: 0 }); expect(failure.message).not.toContain("cr_test_example"); }
      expect(fetcher).toHaveBeenCalledTimes(3);
    }
  });
});
