/**
 * Authentication: resolves a usable GitHub token from (1) an env PAT, (2) a
 * cached OAuth token (refreshed if expired), or (3) the OAuth **device flow**.
 * The device flow is hand-rolled against GitHub's 3 endpoints; tokens are cached
 * at ~/.config/mcp-github/auth.json with 0600 perms and are never logged.
 */
import { promises as fs } from "node:fs";
import {
  ACCESS_TOKEN_URL,
  DEVICE_CODE_URL,
  SCOPES,
  getAuthFile,
  getClientId,
  getConfigDir,
  getEnvToken,
} from "./config.js";

export class NotAuthenticatedError extends Error {
  constructor(msg = "Not authenticated. Run github_login, or set GITHUB_TOKEN to a Personal Access Token.") {
    super(msg);
    this.name = "NotAuthenticatedError";
  }
}

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  scope?: string;
}

interface PendingDevice {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number; // seconds
  expires_at: number; // epoch ms
}

interface Cache {
  token?: StoredToken;
  pending?: PendingDevice;
}

async function loadCache(): Promise<Cache> {
  try {
    return JSON.parse(await fs.readFile(getAuthFile(), "utf8")) as Cache;
  } catch {
    return {};
  }
}

async function saveCache(cache: Cache): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true });
  const file = getAuthFile();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

/** POST application/x-www-form-urlencoded, parse JSON. */
async function postForm(url: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return res.json();
}

/** Exchange a refresh token for a fresh access token (if the app issues them). */
async function refresh(stored: StoredToken): Promise<StoredToken | undefined> {
  const clientId = getClientId();
  if (!clientId || !stored.refresh_token) return undefined;
  const data = await postForm(ACCESS_TOKEN_URL, {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: stored.refresh_token,
  });
  if (!data.access_token) return undefined;
  return tokenFromResponse(data);
}

function tokenFromResponse(data: any): StoredToken {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : undefined,
    scope: data.scope,
  };
}

/**
 * Resolve a usable token. Order: env PAT → cached (refresh if expired) →
 * throw NotAuthenticatedError.
 */
export async function getToken(): Promise<string> {
  const env = getEnvToken();
  if (env) return env;

  const cache = await loadCache();
  const stored = cache.token;
  if (stored) {
    const expired = stored.expires_at !== undefined && Date.now() >= stored.expires_at - 30_000;
    if (!expired) return stored.access_token;
    const refreshed = await refresh(stored);
    if (refreshed) {
      await saveCache({ ...cache, token: refreshed });
      return refreshed.access_token;
    }
    // expired and not refreshable → fall through to unauthenticated
  }
  throw new NotAuthenticatedError();
}

/** How the current token was obtained (for status messaging). */
export async function authSource(): Promise<"env" | "cache" | "none"> {
  if (getEnvToken()) return "env";
  return (await loadCache()).token ? "cache" : "none";
}

export interface LoginStatus {
  state: "instructions" | "authorized" | "pending" | "error";
  message: string;
}

/**
 * Drive the device flow. First call requests a code and returns instructions;
 * subsequent calls poll the same code (resilient to MCP tool-call timeouts).
 */
export async function login(maxPollMs = 50_000): Promise<LoginStatus> {
  const clientId = getClientId();
  if (!clientId) {
    return {
      state: "error",
      message:
        "Device login needs a GitHub OAuth App. Set GITHUB_CLIENT_ID (register an OAuth App with device flow enabled), or use a Personal Access Token via GITHUB_TOKEN.",
    };
  }
  const cache = await loadCache();
  let pending = cache.pending;

  // No live pending code → request one and return instructions.
  if (!pending || Date.now() >= pending.expires_at) {
    const data = await postForm(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPES });
    if (!data.device_code) {
      return { state: "error", message: `Failed to start device flow: ${data.error_description || data.error || "unknown error"}` };
    }
    pending = {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      interval: Number(data.interval) || 5,
      expires_at: Date.now() + Number(data.expires_in || 900) * 1000,
    };
    await saveCache({ ...cache, pending });
    return {
      state: "instructions",
      message: `Open ${pending.verification_uri} and enter code ${pending.user_code}, then run github_login again to finish.`,
    };
  }

  // Live pending code → poll for authorization (bounded).
  const deadline = Date.now() + maxPollMs;
  let interval = pending.interval;
  while (Date.now() < deadline) {
    const data = await postForm(ACCESS_TOKEN_URL, {
      client_id: clientId,
      device_code: pending.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (data.access_token) {
      await saveCache({ token: tokenFromResponse(data) }); // clears pending
      return { state: "authorized", message: "Authenticated with GitHub. ✅" };
    }
    if (data.error === "authorization_pending") {
      // keep waiting
    } else if (data.error === "slow_down") {
      interval = (Number(data.interval) || interval) + 5;
    } else {
      await saveCache({ ...cache, pending: undefined });
      return { state: "error", message: `Device login failed: ${data.error_description || data.error}` };
    }
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
  return {
    state: "pending",
    message: `Still waiting for authorization. Open ${pending.verification_uri} (code ${pending.user_code}) and run github_login again.`,
  };
}

/** Clear any cached token + pending device code. */
export async function logout(): Promise<void> {
  await fs.rm(getAuthFile(), { force: true });
}
