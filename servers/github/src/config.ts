import { homedir } from "node:os";
import path from "node:path";

/** Server version (kept in lockstep with package.json + index.ts). */
export const VERSION = "0.2.0";

/** OAuth scopes requested by the device flow (space-separated). */
export const SCOPES = "repo read:org notifications";

/** Default page size for list/search endpoints. */
export const DEFAULT_PER_PAGE = 30;

/** Per-request timeout (ms) — a stuck request aborts instead of hanging. */
export function requestTimeoutMs(): number {
  const n = Number(process.env.GITHUB_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** Max items returned by paginated list tools (bounds response size). */
export const MAX_ITEMS = 300;

/** REST API base URL — override for GitHub Enterprise Server via GITHUB_API_URL. */
export function getApiBaseUrl(): string {
  return process.env.GITHUB_API_URL?.trim().replace(/\/+$/, "") || "https://api.github.com";
}

/** Optional path to append a JSON-lines audit log of mutations. */
export function getAuditLogPath(): string | undefined {
  return process.env.GITHUB_AUDIT_LOG?.trim() || undefined;
}

/** GitHub OAuth endpoints (device flow). */
export const DEVICE_CODE_URL = "https://github.com/login/device/code";
export const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * Public OAuth-App client id for the device flow (no client secret needed).
 * Register a GitHub OAuth App with device flow enabled and set GITHUB_CLIENT_ID.
 * The PAT path works without this.
 */
export function getClientId(): string | undefined {
  return process.env.GITHUB_CLIENT_ID?.trim() || undefined;
}

/** A Personal Access Token from the environment, if provided. */
export function getEnvToken(): string | undefined {
  return (process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN)?.trim() || undefined;
}

/** Config directory for the cached token (XDG-aware). */
export function getConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), ".config");
  return path.join(base, "mcp-github");
}

/** Path to the 0600 token cache. */
export function getAuthFile(): string {
  return path.join(getConfigDir(), "auth.json");
}

/** When true, write tools are not registered. */
export function isReadOnly(): boolean {
  const v = (process.env.GITHUB_READONLY ?? "").toLowerCase();
  return v === "1" || v === "true";
}
