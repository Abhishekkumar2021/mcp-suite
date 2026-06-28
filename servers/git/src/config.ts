import { homedir } from "node:os";
import path from "node:path";

/** Server version (kept in lockstep with package.json + index.ts). */
export const VERSION = "0.1.0";

/** Default / max number of commits returned by log-style tools. */
export const DEFAULT_LOG_DEPTH = 50;
export const MAX_LOG_DEPTH = 1000;

/** Cap a single file's unified diff to keep responses bounded. */
export const MAX_DIFF_BYTES = 200 * 1024;

/** Expand a leading "~" and resolve to an absolute path. */
function expand(p: string): string {
  const t = p.trim();
  const e = t.startsWith("~") ? path.join(homedir(), t.slice(1)) : t;
  return path.resolve(e);
}

/** Configured sandbox roots from GIT_ROOTS (comma/:/;-separated). */
export function getConfiguredRoots(): string[] {
  const raw = process.env.GIT_ROOTS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[,:;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(expand);
}

/** When true, local write tools (stage/commit/branch/checkout) are registered. */
export function isWritable(): boolean {
  const v = (process.env.GIT_WRITABLE ?? "").toLowerCase();
  return v === "1" || v === "true";
}
