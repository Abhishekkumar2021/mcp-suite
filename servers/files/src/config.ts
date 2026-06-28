import { homedir } from "node:os";
import path from "node:path";

/** Server version (kept in lockstep with package.json + index.ts). */
export const VERSION = "0.1.0";

/** Refuse to read any single file larger than this (memory / context guard). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

/** Cap entries returned by listings / search to keep responses bounded. */
export const MAX_RESULTS = 1000;

/** Maximum recursion depth for tree / recursive search / copy. */
export const MAX_DEPTH = 32;

/** Directory (inside a root) where soft-deleted files are moved. */
export const TRASH_DIR = ".mcp-trash";

/** Expand a leading "~" and resolve to an absolute path. */
function expand(p: string): string {
  const t = p.trim();
  const e = t.startsWith("~") ? path.join(homedir(), t.slice(1)) : t;
  return path.resolve(e);
}

/**
 * Configured sandbox roots from FS_ROOTS (comma- or os-path-separator-delimited).
 * Returns absolute paths (existence + realpath canonicalization happen in sandbox.ts).
 */
export function getConfiguredRoots(): string[] {
  const raw = process.env.FS_ROOTS;
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[,:;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(expand);
}

/** When true, all mutating tools are disabled (read-only sharing). */
export function isReadOnly(): boolean {
  const v = (process.env.FS_READONLY ?? "").toLowerCase();
  return v === "1" || v === "true";
}
