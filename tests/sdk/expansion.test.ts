import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Castrook, CastrookError, uploadToURL, type MediaAsset, type MediaUploadTicket } from "../../packages/castrook-sdk/src/index";

const asset: MediaAsset = {
  id: `ast_${"a".repeat(24)}`, filename: "photo.jpg", type: "image", content_type: "image/jpeg",
  size: 4, sha256: "a".repeat(64), status: "pending", mode: "test", in_use: false,
  created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1_800_000).toISOString(),
};
function ticket(): MediaUploadTicket {
  return { asset, upload: { url: "https://storage.example.com/private/staging?signature=do-not-log", method: "PUT", headers: { "content-type": "image/jpeg", "x-amz-meta-sha256": asset.sha256, "if-none-match": "*" }, expires_at: new Date(Date.now() + 60_000).toISOString() } };
}
const client = (fetcher: typeof fetch, maxRetries = 0) => new Castrook({ apiKey: "cr_test_example", baseURL: "https://api.example.com/api/v1", fetch: fetcher, maxRetries });

describe("SDK customer and performance resources", () => {
  it("maps onboarding, profile assignment and analytics filters to the exact API paths", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: {}, meta: { next_cursor: null, has_more: false } }));
    const sdk = client(fetcher);
    const profileId = `prf_${"a".repeat(24)}`;
    await sdk.profiles.create({ name: "Acme", external_id: "customer/acme" });
    await sdk.profiles.list({ external_id: "customer/acme", q: "Acme & Sons", limit: 5 });
    await sdk.profiles.update(profileId, { external_id: null });
    await sdk.connectSessions.create({ profile_id: profileId, platforms: ["instagram"], embed_origin: "https://app.example.com" });
    await sdk.connectSessions.get("session/encoded");
    await sdk.connectSessions.revoke("session/encoded");
    await sdk.accounts.assignProfile("account/encoded", null);
    await sdk.analytics.posts({ profile_id: profileId, platform: "youtube", from: "2026-10-01", to: "2026-10-02", limit: 25 });
    await sdk.analytics.summary({ account_id: "account/encoded", to: "2026-10-02" });
    await sdk.analytics.refresh("post/encoded");
    expect(fetcher.mock.calls.map(call => [call[1]?.method, new URL(String(call[0])).pathname])).toEqual([
      ["POST", "/api/v1/profiles"], ["GET", "/api/v1/profiles"], ["PATCH", `/api/v1/profiles/${profileId}`],
      ["POST", "/api/v1/connect-sessions"], ["GET", "/api/v1/connect-sessions/session%2Fencoded"], ["DELETE", "/api/v1/connect-sessions/session%2Fencoded"],
      ["PATCH", "/api/v1/accounts/account%2Fencoded"], ["GET", "/api/v1/analytics/posts"], ["GET", "/api/v1/analytics/summary"], ["POST", "/api/v1/posts/post%2Fencoded/analytics/refresh"],
    ]);
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[1][0])).searchParams)).toEqual({ external_id: "customer/acme", q: "Acme & Sons", limit: "5" });
    expect(fetcher.mock.calls[2][1]?.body).toBe('{"external_id":null}');
    expect(fetcher.mock.calls[6][1]?.body).toBe('{"profile_id":null}');
    expect(fetcher.mock.calls[9][1]?.body).toBe("{}");
    expect(Object.fromEntries(new URL(String(fetcher.mock.calls[7][0])).searchParams)).toEqual({ profile_id: profileId, platform: "youtube", from: "2026-10-01", to: "2026-10-02", limit: "25" });
  });
  it("preserves ordered immutable assets and explicit empty destination overrides", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { id: "post" } }));
    const input = { text: "Shared", account_ids: ["ig", "fb"], media_items: [{ type: "image" as const, asset_id: asset.id }, { type: "image" as const, url: "https://cdn.example.com/second.jpg" }], destinations: [{ account_id: "fb", text: "", format: "story" as const, media_items: [{ type: "image" as const, asset_id: asset.id }] }, { account_id: "ig", text: "IG only" }] };
    await client(fetcher).posts.create(input, { idempotencyKey: "destination-content-v1" });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(input);
  });
  it("submits the exact explicit policy receipt without adding inferred acceptance", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: {} }));
    await client(fetcher).accounts.acceptAnalyticsPolicy("channel/encoded", {accepted:true,privacy_policy_version:"2026-10-02"});
    expect(new URL(String(fetcher.mock.calls[0][0])).pathname).toBe("/api/v1/accounts/channel%2Fencoded/analytics-consent");
    expect(fetcher.mock.calls[0][1]?.body).toBe('{"accepted":true,"privacy_policy_version":"2026-10-02"}');
  });
});

describe("SDK immutable direct upload", () => {
  it("hashes the original bytes, uploads without credentials, then completes verification", async () => {
    const upload = ticket();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: upload }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { ...asset, status: "ready" } }));
    const result = await client(fetcher).media.upload(bytes, { filename: "photo.jpg", content_type: "image/jpeg", profile_id: `prf_${"a".repeat(24)}` });
    expect(result.data.status).toBe("ready");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ filename: "photo.jpg", content_type: "image/jpeg", profile_id: `prf_${"a".repeat(24)}`, size: 4, sha256: createHash("sha256").update(bytes).digest("hex") });
    const storageRequest = fetcher.mock.calls[1][1]!;
    expect(storageRequest).toMatchObject({ method: "PUT", credentials: "omit", redirect: "error" });
    expect(Object.fromEntries(new Headers(storageRequest.headers))).toEqual(upload.upload.headers);
    expect(new Headers(storageRequest.headers).has("authorization")).toBe(false);
    expect(new Uint8Array(await (storageRequest.body as Blob).arrayBuffer())).toEqual(bytes);
    expect(String(fetcher.mock.calls[2][0])).toBe(`https://api.example.com/api/v1/media/${asset.id}/complete`);
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: "POST", body: "{}", headers: { Authorization: "Bearer cr_test_example" } });
  });
  it("verifies an existing immutable object after a duplicate PUT returns 412", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: ticket() }))
      .mockResolvedValueOnce(new Response("Already exists", { status: 412 }))
      .mockResolvedValueOnce(Response.json({ data: { ...asset, status: "ready" } }));
    expect((await client(fetcher).media.upload(new Blob(["jpeg"]), { filename: "photo.jpg", content_type: "image/jpeg" })).data.status).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("returns a recoverable asset ID without storage URL or provider error details after an ambiguous PUT", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: ticket() }))
      .mockRejectedValueOnce(new Error("socket failed https://storage.example.com/?signature=secret"));
    const failure = await client(fetcher, 5).media.upload(new Blob(["jpeg"]), { filename: "photo.jpg", content_type: "image/jpeg" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CastrookError);
    expect(failure).toMatchObject({ code: "media_upload_interrupted", details: { asset_id: asset.id } });
    expect(String(failure)).not.toContain("signature");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never completes or retries a rejected PUT", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: ticket() }))
      .mockResolvedValueOnce(new Response("invalid signature", { status: 403 }));
    await expect(client(fetcher, 5).media.upload(new Blob(["jpeg"]), { filename: "photo.jpg", content_type: "image/jpeg" })).rejects.toMatchObject({ status: 403, code: "media_upload_failed", details: { asset_id: asset.id } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("propagates server checksum rejection rather than treating a successful PUT as ready", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: ticket() }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "media_checksum_mismatch", message: "Digest mismatch." }, request_id: "req_checksum" }, { status: 422 }));
    await expect(client(fetcher).media.upload(new Blob(["jpeg"]), { filename: "photo.jpg", content_type: "image/jpeg" })).rejects.toMatchObject({ code: "media_checksum_mismatch", requestId: "req_checksum" });
  });
  it("rejects empty files before consuming an upload ticket", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(client(fetcher).media.upload(new Blob(), { filename: "empty.mp4", content_type: "video/mp4" })).rejects.toThrow("1–134217728");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("keyless browser upload helper", () => {
  it("rejects expiry, insecure URLs and credential headers before sending file bytes", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const upload = ticket().upload;
    await expect(uploadToURL({ ...upload, expires_at: "2020-01-01T00:00:00Z" }, new Blob(["jpeg"]), { fetch: fetcher })).rejects.toMatchObject({ code: "media_upload_expired" });
    for (const url of ["http://storage.example.com", "https://user:pass@storage.example.com", "https://storage.example.com#fragment", "broken-ticket"]) await expect(uploadToURL({ ...upload, url }, new Blob(["jpeg"]), { fetch: fetcher })).rejects.toThrow("HTTPS");
    for (const header of ["Authorization", "Cookie"]) await expect(uploadToURL({ ...upload, headers: { [header]: "private" } }, new Blob(["jpeg"]), { fetch: fetcher })).rejects.toThrow("credentials");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("passes abort through while returning a sanitized interruption error", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      controller.abort("stop");
      expect(options?.signal?.aborted).toBe(true);
      throw new Error("request canceled at secret signed URL");
    });
    await expect(uploadToURL(ticket().upload, new Blob(["jpeg"]), { fetch: fetcher, signal: controller.signal })).rejects.toMatchObject({ code: "media_upload_interrupted" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
