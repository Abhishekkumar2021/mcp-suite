/**
 * Search: glob-based file finding (fast-glob) and content grep (streaming JS
 * regex). Both stay inside the sandbox — patterns containing ".." are rejected,
 * symlinks are not followed, and every hit is re-checked for containment.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { MAX_RESULTS, TRASH_DIR } from "./config.js";
import { displayPath, getRoots, resolveInside } from "./sandbox.js";

const DEFAULT_EXCLUDES = ["**/node_modules/**", "**/.git/**", `**/${TRASH_DIR}/**`];

function rejectDotDot(pattern: string): void {
  if (pattern.includes("..")) throw new Error('Patterns may not contain ".." (sandbox escape).');
}

/** True if `abs` lies within one of the active roots (lexical containment). */
function insideAnyRoot(abs: string): boolean {
  return getRoots().some((r) => {
    const rel = path.relative(r, abs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

export interface FindResult {
  matches: string[];
  truncated: boolean;
}

/** Find files/dirs by glob pattern, rooted at `cwd` (default first root). */
export async function findFiles(
  pattern: string,
  opts: { cwd?: string; exclude?: string[]; type?: "file" | "dir" | "any"; limit?: number } = {},
): Promise<FindResult> {
  rejectDotDot(pattern);
  const base = opts.cwd ? await resolveInside(opts.cwd) : getRoots()[0];
  const limit = opts.limit ?? MAX_RESULTS;
  const found = await fg(pattern, {
    cwd: base,
    absolute: true,
    dot: true,
    followSymbolicLinks: false,
    onlyFiles: opts.type === "file", // false → returns files + dirs (when type is "any"/undefined)
    onlyDirectories: opts.type === "dir",
    ignore: [...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])],
    suppressErrors: true,
  });
  const safe = found.filter(insideAnyRoot);
  return { matches: safe.slice(0, limit).map(displayPath), truncated: safe.length > limit };
}

export interface ContentMatch {
  path: string;
  line: number;
  text: string;
  context?: string[];
}

export interface SearchResult {
  matches: ContentMatch[];
  filesScanned: number;
  truncated: boolean;
}

/** Build a RegExp from a literal or regex query. */
function buildRegex(query: string, regex: boolean, ignoreCase: boolean): RegExp {
  const src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(src, ignoreCase ? "i" : "");
}

/** Heuristic: treat a buffer as binary if it contains a NUL byte in the head. */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Grep file contents for `query` across files matched by `include`. */
export async function searchContent(
  query: string,
  opts: {
    cwd?: string;
    include?: string;
    exclude?: string[];
    regex?: boolean;
    ignoreCase?: boolean;
    context?: number;
    maxMatches?: number;
  } = {},
): Promise<SearchResult> {
  const include = opts.include ?? "**/*";
  rejectDotDot(include);
  const base = opts.cwd ? await resolveInside(opts.cwd) : getRoots()[0];
  const maxMatches = opts.maxMatches ?? 200;
  const ctx = Math.max(0, Math.min(opts.context ?? 0, 5));
  const re = buildRegex(query, opts.regex ?? false, opts.ignoreCase ?? false);

  const files = await fg(include, {
    cwd: base,
    absolute: true,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: [...DEFAULT_EXCLUDES, ...(opts.exclude ?? [])],
    suppressErrors: true,
  });

  const matches: ContentMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  for (const file of files) {
    if (!insideAnyRoot(file)) continue;
    let buf: Buffer;
    try {
      const st = await fs.stat(file);
      if (st.size > 5 * 1024 * 1024) continue; // skip very large files
      buf = await fs.readFile(file);
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;
    filesScanned++;
    const lines = buf.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        const m: ContentMatch = { path: displayPath(file), line: i + 1, text: lines[i].trim() };
        if (ctx > 0) m.context = lines.slice(Math.max(0, i - ctx), Math.min(lines.length, i + ctx + 1));
        matches.push(m);
        if (matches.length >= maxMatches) {
          truncated = true;
          return { matches, filesScanned, truncated };
        }
      }
    }
  }
  return { matches, filesScanned, truncated };
}
