import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { DEFAULT_BASE_URL, type Mode } from "./index.js";

export const READ_SCOPES = ["accounts:read", "posts:read", "comments:read", "webhooks:read", "logs:read", "profiles:read", "media:read", "analytics:read", "usage:read"];
export const ALL_SCOPES = [...READ_SCOPES, "accounts:write", "posts:write", "comments:write", "webhooks:write", "profiles:write", "media:write", "analytics:write"];
export class CliError extends Error {
  constructor(public readonly exitCode: number, public readonly code: string, message: string, public readonly details?: unknown) { super(message); this.name = "CliError"; }
}
export type SavedLogin = { version: 1; base_url: string; resource: string; client_id: string; access_token: string; refresh_token?: string; expires_at: number; scope: string; mode: Mode; refresh_pending?: true };
export type AuthRuntime = { fetcher: typeof fetch; env: NodeJS.ProcessEnv; stderr: (text: string) => void; openBrowser?: (url: string) => Promise<void>; now?: () => number };
type Metadata = { issuer: string; authorization_endpoint: string; token_endpoint: string; registration_endpoint: string; revocation_endpoint: string };
const authFailure = () => new CliError(4, "authentication_required", "Run castrook login, or set CASTROOK_API_KEY in your environment.");
const now = (runtime: AuthRuntime) => (runtime.now ?? Date.now)();
const sleep = (ms: number) => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

export function configDirectory(env: NodeJS.ProcessEnv): string {
  return resolve(env.CASTROOK_CONFIG_DIR || join(env.XDG_CONFIG_HOME || (process.platform === "win32" ? env.APPDATA || homedir() : join(homedir(), ".config")), "castrook"));
}
async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.getuid && stat.uid !== process.getuid()) throw new CliError(4, "unsafe_credentials", "The Castrook configuration directory must be an owned, real directory.");
  await chmod(directory, 0o700);
}
export async function loadLogin(env: NodeJS.ProcessEnv): Promise<SavedLogin | null> {
  const directory = configDirectory(env);
  try {
    const dir = await lstat(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || process.getuid && (dir.uid !== process.getuid() || (dir.mode & 0o077) !== 0)) throw new CliError(4, "unsafe_credentials", "Secure the Castrook configuration directory to mode 700 before continuing.");
    const handle = await open(join(directory, "credentials.json"), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 65_536 || process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) throw new CliError(4, "unsafe_credentials", "Secure the Castrook credentials file to mode 600 before continuing.");
      const saved = JSON.parse(await handle.readFile("utf8")) as Partial<SavedLogin>;
      if (saved.version !== 1 || typeof saved.base_url !== "string" || saved.resource !== saved.base_url || typeof saved.client_id !== "string" || !/^cr_oauth_[A-Za-z0-9_-]{43}$/.test(saved.access_token ?? "") || !Number.isFinite(saved.expires_at) || typeof saved.scope !== "string" || !["test", "live"].includes(saved.mode ?? "") || saved.refresh_token !== undefined && typeof saved.refresh_token !== "string" || saved.refresh_pending !== undefined && saved.refresh_pending !== true) throw new Error("Invalid credentials");
      return saved as SavedLogin;
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof CliError) throw error;
    throw new CliError(4, "invalid_credentials", "The local sign-in could not be read. Run castrook login again.");
  }
}
export async function saveLogin(env: NodeJS.ProcessEnv, saved: SavedLogin): Promise<void> {
  const directory = configDirectory(env);
  await privateDirectory(directory);
  const temporary = join(directory, `credentials.${randomBytes(12).toString("hex")}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try { await handle.writeFile(JSON.stringify(saved) + "\n", "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary, join(directory, "credentials.json")); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
async function removeLogin(env: NodeJS.ProcessEnv) { await unlink(join(configDirectory(env), "credentials.json")).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
async function configLock<T>(env: NodeJS.ProcessEnv, work: () => Promise<T>): Promise<T> {
  const directory = configDirectory(env); await privateDirectory(directory);
  const path = join(directory, "refresh.lock"); let handle;
  const deadline = Date.now() + 10_000;
  while (!handle) {
    try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new CliError(4, "unsafe_credentials", "The sign-in lock is invalid.");
      if (Date.now() - stat.mtimeMs > 60_000) { await unlink(path); continue; }
      if (Date.now() >= deadline) throw new CliError(4, "authentication_busy", "Another Castrook command is refreshing this sign-in. Retry shortly.");
      await sleep(100);
    }
  }
  try { return await work(); }
  finally { await handle.close(); await unlink(path).catch(() => undefined); }
}

export function serviceBase(value = DEFAULT_BASE_URL): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new CliError(2, "invalid_base_url", "Use an HTTPS API base URL ending in /api/v1."); }
  if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, "") !== "/api/v1" || url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new CliError(2, "invalid_base_url", "Use an HTTPS API base URL ending in /api/v1 (HTTP loopback is allowed for development).");
  return url.href.replace(/\/$/, "");
}
async function oauthJSON(runtime: AuthRuntime, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await runtime.fetcher(url, { ...init, redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(30_000) }); }
  catch { throw new CliError(5, "oauth_network_error", "The sign-in request could not be confirmed. If credential rotation was interrupted, run castrook login again."); }
  let value: Record<string, unknown>;
  try { const text = await response.text(); if (text.length > 65_536) throw new Error(); value = JSON.parse(text) as Record<string, unknown>; if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); }
  catch { throw new CliError(5, "oauth_invalid_response", "The sign-in service returned an invalid response."); }
  if (!response.ok) throw new CliError(response.status >= 500 || response.status === 429 ? 5 : 4, typeof value.error === "string" && /^[a-z_]{1,80}$/.test(value.error) ? value.error : "oauth_rejected", "Sign-in was rejected. Review your consent or run castrook login again.");
  return value;
}
export async function discover(runtime: AuthRuntime, base: string): Promise<Metadata> {
  const origin = new URL(base).origin;
  const value = await oauthJSON(runtime, `${origin}/.well-known/oauth-authorization-server`);
  if (value.issuer !== origin || !Array.isArray(value.code_challenge_methods_supported) || !value.code_challenge_methods_supported.includes("S256")) throw new CliError(4, "oauth_invalid_metadata", "The sign-in service does not advertise the expected issuer and S256 support.");
  const result = { issuer: origin } as Metadata;
  for (const [key, fallback] of Object.entries({ authorization_endpoint: "/oauth/authorize", token_endpoint: "/oauth/token", registration_endpoint: "/oauth/register", revocation_endpoint: "/oauth/revoke" })) {
    let endpoint: URL;
    try { endpoint = new URL(typeof value[key] === "string" ? value[key] : origin + fallback); } catch { throw new CliError(4, "oauth_invalid_metadata", "The sign-in endpoints are invalid."); }
    if (endpoint.origin !== origin || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) throw new CliError(4, "oauth_invalid_metadata", "The sign-in endpoints must stay on the configured Castrook service.");
    result[key as keyof Omit<Metadata, "issuer">] = endpoint.href;
  }
  return result;
}
function tokenLogin(value: Record<string, unknown>, previous: Pick<SavedLogin, "base_url" | "resource" | "client_id" | "scope">, runtime: AuthRuntime): SavedLogin {
  if (typeof value.access_token !== "string" || !/^cr_oauth_[A-Za-z0-9_-]{43}$/.test(value.access_token) || typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer" || !Number.isSafeInteger(value.expires_in) || Number(value.expires_in) < 1 || Number(value.expires_in) > 86_400 || !["test", "live"].includes(String(value.castrook_mode)) || value.refresh_token !== undefined && (typeof value.refresh_token !== "string" || value.refresh_token.length > 2048)) throw new CliError(4, "oauth_invalid_token", "The sign-in service returned an invalid token. Run castrook login again.");
  const scope = typeof value.scope === "string" ? value.scope : previous.scope;
  const allowed = new Set(previous.scope.split(" "));
  if (scope.split(" ").some(permission => !allowed.has(permission))) throw new CliError(4, "oauth_invalid_scope", "The returned permissions exceed the requested access.");
  return { base_url: previous.base_url, resource: previous.resource, client_id: previous.client_id, version: 1, access_token: value.access_token, ...(typeof value.refresh_token === "string" ? { refresh_token: value.refresh_token } : {}), expires_at: now(runtime) + Number(value.expires_in) * 1000, scope, mode: value.castrook_mode as Mode };
}
function tokenRequest(runtime: AuthRuntime, endpoint: string, values: Record<string, string>) { return oauthJSON(runtime, endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(values) }); }
export async function refreshLogin(runtime: AuthRuntime, base: string, force = false): Promise<SavedLogin> {
  return configLock(runtime.env, async () => {
    const saved = await loadLogin(runtime.env);
    if (!saved || saved.base_url !== base) throw authFailure();
    if (saved.refresh_pending) throw new CliError(4, "refresh_unconfirmed", "Credential rotation was interrupted. Run castrook login again; the previous refresh token will not be reused.");
    if (!force && saved.expires_at > now(runtime) + 60_000) return saved;
    if (!saved.refresh_token) throw authFailure();
    const metadata = await discover(runtime, base);
    // Journal before sending a one-use token. A crash or ambiguous response
    // must not cause another process to replay it and revoke the token family.
    await saveLogin(runtime.env, { ...saved, refresh_pending: true });
    const response = await tokenRequest(runtime, metadata.token_endpoint, { grant_type: "refresh_token", refresh_token: saved.refresh_token, client_id: saved.client_id, resource: saved.resource });
    if (typeof response.refresh_token !== "string" || !response.refresh_token) throw new CliError(4, "oauth_invalid_token", "Credential rotation did not return a new refresh token. Run castrook login again.");
    const updated = tokenLogin(response, saved, runtime);
    await saveLogin(runtime.env, updated);
    return updated;
  });
}
export async function logout(runtime: AuthRuntime, localOnly = false): Promise<{ authenticated: false; revoked: boolean }> {
  return configLock(runtime.env, async () => {
    const saved = await loadLogin(runtime.env);
    if (!saved) return { authenticated: false, revoked: false };
    if (!localOnly) {
      const metadata = await discover(runtime, saved.base_url);
      let response: Response;
      try { response = await runtime.fetcher(metadata.revocation_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: saved.refresh_token ?? saved.access_token, token_type_hint: saved.refresh_token ? "refresh_token" : "access_token", client_id: saved.client_id }), redirect: "error", credentials: "omit", signal: AbortSignal.timeout(30_000) }); }
      catch { throw new CliError(5, "oauth_revocation_unconfirmed", "Sign-out could not be confirmed. Local credentials remain so you can retry, or use logout --local-only."); }
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) throw new CliError(5, "oauth_revocation_unconfirmed", "Sign-out was rejected. Local credentials remain so you can retry.");
    }
    await removeLogin(runtime.env);
    return { authenticated: false, revoked: !localOnly };
  });
}

async function openBrowser(url: string) {
  const [command, arguments_] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  await new Promise<void>((resolveOpen, rejectOpen) => { const child = spawn(command as string, arguments_ as string[], { stdio: "ignore", detached: true }); child.once("error", rejectOpen); child.once("spawn", () => { child.unref(); resolveOpen(); }); });
}
export async function login(runtime: AuthRuntime, options: { base: string; scopes: string[]; mode: Mode; noBrowser?: boolean; timeoutMs?: number }): Promise<SavedLogin> {
  const metadata = await discover(runtime, options.base);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  let expectedHost = ""; let consumed = false;
  let resolveCode!: (code: string) => void; let rejectCode!: (error: Error) => void;
  const callback = new Promise<string>((resolveCallback, rejectCallback) => { resolveCode = resolveCallback; rejectCode = rejectCallback; });
  // Registration can fail before the callback is awaited; do not leak a rejection.
  void callback.catch(() => undefined);
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store"); response.setHeader("referrer-policy", "no-referrer"); response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'"); response.setHeader("content-type", "text/plain; charset=utf-8");
    let url: URL;
    try { url = new URL(request.url || "/", `http://${expectedHost}`); }
    catch { response.writeHead(400); response.end("This sign-in callback is invalid."); return; }
    const receivedState = url.searchParams.get("state") || "";
    if (request.method !== "GET" || request.headers.host !== expectedHost || url.origin !== `http://${expectedHost}` || url.pathname !== "/callback" || !/^[A-Za-z0-9_-]{43}$/.test(receivedState) || !timingSafeEqual(Buffer.from(receivedState), Buffer.from(state))) { response.writeHead(400); response.end("This sign-in callback is invalid. Return to your terminal."); return; }
    if (consumed) { response.writeHead(410); response.end("This callback has already been used."); return; }
    consumed = true;
    const code = url.searchParams.get("code");
    if (url.searchParams.has("error") || !code || code.length > 2048) { response.writeHead(400); response.end("Sign-in was canceled. Return to your terminal.", () => rejectCode(new CliError(4, "authorization_denied", "Sign-in was canceled. No credentials were saved."))); return; }
    response.end("Castrook sign-in received. You can close this tab and return to your terminal.", () => resolveCode(code));
  });
  await new Promise<void>((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new CliError(5, "callback_unavailable", "The local sign-in callback could not start."); }
  expectedHost = `127.0.0.1:${address.port}`;
  const redirect = `http://${expectedHost}/callback`;
  const timer = setTimeout(() => rejectCode(new CliError(4, "authorization_timeout", "Sign-in timed out. Run castrook login again.")), options.timeoutMs ?? 300_000);
  try {
    const registered = await oauthJSON(runtime, metadata.registration_endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ client_name: "Castrook CLI", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
    if (typeof registered.client_id !== "string" || !registered.client_id || registered.client_id.length > 512) throw new CliError(4, "oauth_registration_failed", "The CLI could not register for sign-in.");
    const scope = [...new Set(options.scopes)].join(" ");
    const authorization = new URL(metadata.authorization_endpoint);
    for (const [key, value] of Object.entries({ response_type: "code", client_id: registered.client_id, redirect_uri: redirect, scope, state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", resource: options.base, castrook_mode: options.mode })) authorization.searchParams.set(key, value);
    runtime.stderr(`Open this Castrook sign-in link and approve the requested access:\n${authorization.href}\n`);
    if (!options.noBrowser) await (runtime.openBrowser ?? openBrowser)(authorization.href).catch(() => runtime.stderr("The browser could not open automatically. Use the link above.\n"));
    const code = await callback;
    const token = await tokenRequest(runtime, metadata.token_endpoint, { grant_type: "authorization_code", client_id: registered.client_id, redirect_uri: redirect, code, code_verifier: verifier, resource: options.base });
    const saved = tokenLogin(token, { base_url: options.base, resource: options.base, client_id: registered.client_id, scope }, runtime);
    await configLock(runtime.env, () => saveLogin(runtime.env, saved));
    return saved;
  } finally { clearTimeout(timer); server.close(); server.closeAllConnections(); }
}

export async function readJSONFile(path: string): Promise<unknown> {
  const handle = await open(path, "r");
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 65_536) throw new CliError(2, "invalid_input", "JSON input must be a regular file up to 64 KiB."); return JSON.parse(await handle.readFile("utf8")); }
  finally { await handle.close(); }
}
