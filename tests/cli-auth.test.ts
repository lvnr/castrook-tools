import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discover, loadLogin, login, logout, refreshLogin, saveLogin, type AuthRuntime, type SavedLogin } from "../packages/castrook-sdk/src/cli-auth";

const base = "https://castrook.com/api/v1";
const access = `cr_oauth_${"a".repeat(43)}`;
const metadata = { issuer: "https://castrook.com", code_challenge_methods_supported: ["S256"], authorization_endpoint: "https://castrook.com/oauth/authorize", registration_endpoint: "https://castrook.com/oauth/register", token_endpoint: "https://castrook.com/oauth/token", revocation_endpoint: "https://castrook.com/oauth/revoke" };
const token = (changed = false) => ({ access_token: changed ? `cr_oauth_${"b".repeat(43)}` : access, refresh_token: changed ? "rotated-private-refresh" : "private-refresh", expires_in: 3600, scope: "accounts:read usage:read", token_type: "Bearer", castrook_mode: "test" });
let directory: string;
let env: NodeJS.ProcessEnv;
const saved = (): SavedLogin => ({ version: 1, base_url: base, resource: base, client_id: "public-cli", access_token: access, refresh_token: "private-refresh", expires_at: Date.now() - 1000, scope: "accounts:read usage:read", mode: "test" });
function runtime(fetcher: typeof fetch): AuthRuntime { return { fetcher, env, stderr: vi.fn() }; }
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "castrook-cli-auth-")); env = { NODE_ENV: "test", CASTROOK_CONFIG_DIR: join(directory, "config") }; });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("CLI local authentication", () => {
  it("stores credentials privately and refuses loose permissions or symlink reads", async () => {
    await saveLogin(env, saved());
    expect((await stat(env.CASTROOK_CONFIG_DIR!)).mode & 0o777).toBe(0o700);
    const path = join(env.CASTROOK_CONFIG_DIR!, "credentials.json");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await loadLogin(env))?.access_token).toBe(access);
    await chmod(path, 0o644);
    await expect(loadLogin(env)).rejects.toMatchObject({ code: "unsafe_credentials" });
    await rm(path); await symlink(join(directory, "outside.json"), path);
    await expect(loadLogin(env)).rejects.toMatchObject({ code: "invalid_credentials" });
  });
  it("checks callback state, sends S256 PKCE and binds both exchanges to the exact resource", async () => {
    let redirect = ""; let authorization: URL | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("oauth-authorization-server")) return Response.json(metadata);
      if (url.endsWith("/register")) { const body = JSON.parse(String(init?.body)); redirect = body.redirect_uris[0]; expect(body).toMatchObject({ client_name: "Castrook CLI", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }); expect(new URL(redirect)).toMatchObject({ hostname: "127.0.0.1", pathname: "/callback" }); expect(Number(new URL(redirect).port)).toBeGreaterThan(0); return Response.json({ client_id: "public-cli" }); }
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("resource")).toBe(base); expect(body.get("redirect_uri")).toBe(redirect); expect(body.get("code")).toBe("one-time-code");
      expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(authorization!.searchParams.get("code_challenge"));
      return Response.json(token());
    });
    const ctx = runtime(fetcher);
    ctx.openBrowser = async raw => {
      authorization = new URL(raw);
      expect(authorization.searchParams.get("resource")).toBe(base); expect(authorization.searchParams.get("code_challenge_method")).toBe("S256"); expect(authorization.searchParams.get("castrook_mode")).toBe("live");
      expect((await fetch(`${redirect}?state=wrong&code=wrong`)).status).toBe(400);
      expect((await fetch(`${redirect}?state=${encodeURIComponent("é".repeat(43))}&code=wrong`)).status).toBe(400);
      const result = await fetch(`${redirect}?state=${authorization.searchParams.get("state")}&code=one-time-code`); expect(result.status).toBe(200); await result.text();
    };
    const result = await login(ctx, { base, scopes: ["accounts:read", "usage:read"], mode: "live", timeoutMs: 3000 });
    expect(result.mode).toBe("test"); // Server consent can retain Test despite a requested mode.
    expect((await loadLogin(env))?.refresh_token).toBe("private-refresh");
    expect(String(vi.mocked(ctx.stderr).mock.calls)).not.toContain(access);
    expect(String(vi.mocked(ctx.stderr).mock.calls)).not.toContain("private-refresh");
  });
  it("leaves no saved login after explicit authorization denial", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => String(input).endsWith("oauth-authorization-server") ? Response.json(metadata) : Response.json({ client_id: "public-cli" }));
    const ctx = runtime(fetcher); ctx.openBrowser = async raw => { const auth = new URL(raw); const callback = new URL(auth.searchParams.get("redirect_uri")!); callback.searchParams.set("state", auth.searchParams.get("state")!); callback.searchParams.set("error", "access_denied"); const response = await fetch(callback); await response.text(); };
    await expect(login(ctx, { base, scopes: ["usage:read"], mode: "test", timeoutMs: 3000 })).rejects.toMatchObject({ code: "authorization_denied" });
    expect(await loadLogin(env)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects metadata that would send credentials to another origin", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...metadata, token_endpoint: "https://evil.example/token" }));
    await expect(discover(runtime(fetcher), base)).rejects.toMatchObject({ code: "oauth_invalid_metadata" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("serializes refresh rotation across concurrent processes and keeps the returned scope/mode", async () => {
    await saveLogin(env, saved());
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      if (String(input).endsWith("oauth-authorization-server")) return Response.json(metadata);
      expect((await loadLogin(env))?.refresh_pending).toBe(true);
      const values = new URLSearchParams(String(init?.body)); expect(values.get("resource")).toBe(base); expect(values.get("refresh_token")).toBe("private-refresh");
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10)); return Response.json(token(true));
    });
    const result = await Promise.all([refreshLogin(runtime(fetcher), base), refreshLogin(runtime(fetcher), base)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.every(item => item.refresh_token === "rotated-private-refresh")).toBe(true);
    expect((await loadLogin(env))?.refresh_pending).toBeUndefined();
    expect((await stat(join(env.CASTROOK_CONFIG_DIR!, "credentials.json"))).mode & 0o777).toBe(0o600);
  });
  it("does not blindly retry an ambiguous rotating-refresh exchange", async () => {
    await saveLogin(env, saved());
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata)).mockRejectedValueOnce(new Error("refresh token private-refresh at signed URL"));
    await expect(refreshLogin(runtime(fetcher), base)).rejects.toMatchObject({ code: "oauth_network_error" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await loadLogin(env))?.refresh_token).toBe("private-refresh");
    expect((await loadLogin(env))?.refresh_pending).toBe(true);
    await expect(refreshLogin(runtime(fetcher), base)).rejects.toMatchObject({ code: "refresh_unconfirmed" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("requires a new login for a crashed or incomplete refresh instead of replaying the old token", async () => {
    await saveLogin(env, { ...saved(), expires_at: Date.now() + 3_600_000, refresh_pending: true });
    const fetcher = vi.fn<typeof fetch>();
    await expect(refreshLogin(runtime(fetcher), base, true)).rejects.toMatchObject({ code: "refresh_unconfirmed" });
    expect(fetcher).not.toHaveBeenCalled();
    await saveLogin(env, saved());
    fetcher.mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(Response.json({ ...token(true), refresh_token: undefined }));
    await expect(refreshLogin(runtime(fetcher), base)).rejects.toMatchObject({ code: "oauth_invalid_token" });
    expect((await loadLogin(env))?.refresh_pending).toBe(true);
    await expect(refreshLogin(runtime(fetcher), base)).rejects.toMatchObject({ code: "refresh_unconfirmed" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retains recoverable local credentials when revocation fails and supports explicit local-only logout", async () => {
    await saveLogin(env, saved());
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(logout(runtime(fetcher))).rejects.toMatchObject({ code: "oauth_revocation_unconfirmed" });
    expect(await readFile(join(env.CASTROOK_CONFIG_DIR!, "credentials.json"), "utf8")).toContain(access);
    expect(await logout(runtime(fetcher), true)).toEqual({ authenticated: false, revoked: false });
    expect(await loadLogin(env)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
