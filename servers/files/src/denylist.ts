/**
 * Secret-file protection. A built-in gitignore-style denylist (credentials, keys,
 * dotfiles that commonly hold secrets) plus an optional per-root `.mcpignore`.
 * Reads of denied paths are refused; discovery (list/tree/find/search) filters
 * them out. `FS_ALLOW_SECRETS=1` disables this entirely.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { allowSecrets } from "./config.js";
import { getRoots } from "./sandbox.js";

const DEFAULT_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.keystore",
  "id_rsa",
  "id_rsa.*",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_ed25519.*",
  ".ssh/",
  ".aws/",
  ".gnupg/",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  "credentials",
  "secrets.*",
  "*.secret",
];

const cache = new Map<string, Ignore>();

async function matcherForRoot(root: string): Promise<Ignore> {
  const cached = cache.get(root);
  if (cached) return cached;
  const ig = ignore().add(DEFAULT_PATTERNS);
  try {
    const custom = await fs.readFile(path.join(root, ".mcpignore"), "utf8");
    ig.add(custom);
  } catch {
    // no .mcpignore — defaults only
  }
  cache.set(root, ig);
  return ig;
}

/** Which active root contains `abs` (if any). */
function rootOf(abs: string): string | undefined {
  return getRoots().find((r) => {
    const rel = path.relative(r, abs);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
}

/** True if `abs` matches the secret denylist (and the override is off). */
export async function isDenied(abs: string): Promise<boolean> {
  if (allowSecrets()) return false;
  const root = rootOf(abs);
  if (!root) return false;
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (!rel) return false;
  const ig = await matcherForRoot(root);
  return ig.ignores(rel);
}

/** Throw if `abs` is a denied secret path (used by read ops). */
export async function assertNotDenied(abs: string): Promise<void> {
  if (await isDenied(abs)) {
    throw new Error("Access denied: path matches the secret denylist (set FS_ALLOW_SECRETS=1 to override).");
  }
}
