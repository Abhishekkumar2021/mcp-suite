/**
 * Read-side operations: file reads (with head/tail/line-window pagination),
 * media (base64), stat, directory listing, recursive tree, and change detection.
 * All paths flow through the sandbox; reads of symlinks that resolve outside the
 * roots are rejected by `resolveInside`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAX_DEPTH, MAX_RESULTS, TRASH_DIR } from "./config.js";
import { displayPath, readBytes, resolveInside } from "./sandbox.js";

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
  pdf: "application/pdf", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm", json: "application/json", zip: "application/zip",
};

export interface ReadResult {
  text: string;
  truncated: boolean;
  totalLines: number;
  returnedLines: number;
}

/** Read a text file, optionally a head/tail or 1-based line window. */
export async function readFile(
  p: string,
  opts: { head?: number; tail?: number; offset?: number; limit?: number } = {},
): Promise<ReadResult> {
  const abs = await resolveInside(p);
  const text = (await readBytes(abs)).toString("utf8");
  const lines = text.split("\n");
  const total = lines.length;

  let slice = lines;
  let truncated = false;
  if (opts.head != null) {
    slice = lines.slice(0, opts.head);
    truncated = slice.length < total;
  } else if (opts.tail != null) {
    slice = lines.slice(Math.max(0, total - opts.tail));
    truncated = slice.length < total;
  } else if (opts.offset != null || opts.limit != null) {
    const start = Math.max(0, (opts.offset ?? 1) - 1);
    const end = opts.limit != null ? start + opts.limit : total;
    slice = lines.slice(start, end);
    truncated = start > 0 || end < total;
  }
  return { text: slice.join("\n"), truncated, totalLines: total, returnedLines: slice.length };
}

export interface MediaResult {
  base64: string;
  mimeType: string;
  bytes: number;
}

/** Read a binary/media file as base64 with a guessed MIME type. */
export async function readMedia(p: string): Promise<MediaResult> {
  const abs = await resolveInside(p);
  const buf = await readBytes(abs);
  const ext = path.extname(abs).slice(1).toLowerCase();
  return { base64: buf.toString("base64"), mimeType: MIME[ext] ?? "application/octet-stream", bytes: buf.length };
}

export interface StatResult {
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  mtime: string;
  ctime: string;
  birthtime: string;
  mode: string;
}

/** File/dir metadata (does not follow a final symlink — reports it as such). */
export async function stat(p: string): Promise<StatResult> {
  const abs = await resolveInside(p);
  const st = await fs.lstat(abs);
  const type = st.isDirectory() ? "dir" : st.isSymbolicLink() ? "symlink" : st.isFile() ? "file" : "other";
  return {
    path: displayPath(abs),
    type,
    size: st.size,
    mtime: new Date(st.mtimeMs).toISOString(),
    ctime: new Date(st.ctimeMs).toISOString(),
    birthtime: new Date(st.birthtimeMs).toISOString(),
    mode: (st.mode & 0o777).toString(8),
  };
}

export interface DirEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
}

export interface ListResult {
  entries: DirEntry[];
  total: number;
  truncated: boolean;
}

/** List a directory's immediate children, sorted, with sizes. */
export async function listDir(
  p: string,
  opts: { sortBy?: "name" | "size" | "mtime"; limit?: number } = {},
): Promise<ListResult> {
  const abs = await resolveInside(p);
  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const entries: Array<DirEntry & { mtimeMs: number }> = [];
  for (const d of dirents) {
    let size = 0;
    let mtimeMs = 0;
    try {
      const st = await fs.lstat(path.join(abs, d.name));
      size = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      // ignore unstatable entry
    }
    const type = d.isDirectory() ? "dir" : d.isSymbolicLink() ? "symlink" : d.isFile() ? "file" : "other";
    entries.push({ name: d.name, type, size, mtimeMs });
  }
  const by = opts.sortBy ?? "name";
  entries.sort((a, b) =>
    by === "size" ? b.size - a.size : by === "mtime" ? b.mtimeMs - a.mtimeMs : a.name.localeCompare(b.name),
  );
  const total = entries.length;
  const limit = opts.limit ?? MAX_RESULTS;
  const page = entries.slice(0, limit).map(({ name, type, size }) => ({ name, type, size }));
  return { entries: page, total, truncated: total > page.length };
}

/** Render a recursive tree (depth- and node-capped; does not follow symlinks). */
export async function tree(
  p: string,
  opts: { depth?: number; exclude?: string[] } = {},
): Promise<string> {
  const abs = await resolveInside(p);
  const maxDepth = Math.min(opts.depth ?? 4, MAX_DEPTH);
  const exclude = new Set(opts.exclude ?? []);
  const lines: string[] = [displayPath(abs) || "."];
  let count = 0;
  let capped = false;

  async function walk(dir: string, depth: number, prefix: string): Promise<void> {
    if (depth > maxDepth || capped) return;
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 0; i < dirents.length; i++) {
      const d = dirents[i];
      if (exclude.has(d.name) || d.name === TRASH_DIR) continue;
      if (count >= MAX_RESULTS) {
        capped = true;
        return;
      }
      count++;
      const last = i === dirents.length - 1;
      const branch = last ? "└── " : "├── ";
      lines.push(`${prefix}${branch}${d.name}${d.isDirectory() ? "/" : ""}`);
      if (d.isDirectory() && !d.isSymbolicLink()) {
        await walk(path.join(dir, d.name), depth + 1, prefix + (last ? "    " : "│   "));
      }
    }
  }

  await walk(abs, 1, "");
  if (capped) lines.push(`… (truncated at ${MAX_RESULTS} entries)`);
  return lines.join("\n");
}

export interface ChangedFile {
  path: string;
  mtime: string;
}

/** List files modified at/after `sinceMs`, recursively (poll-based change detection). */
export async function changedSince(p: string, sinceMs: number): Promise<{ files: ChangedFile[]; truncated: boolean }> {
  const abs = await resolveInside(p);
  const out: ChangedFile[] = [];
  let capped = false;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || capped) return;
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (d.name === TRASH_DIR || d.isSymbolicLink()) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        await walk(full, depth + 1);
      } else if (d.isFile()) {
        try {
          const st = await fs.lstat(full);
          if (st.mtimeMs >= sinceMs) {
            if (out.length >= MAX_RESULTS) {
              capped = true;
              return;
            }
            out.push({ path: displayPath(full), mtime: new Date(st.mtimeMs).toISOString() });
          }
        } catch {
          // ignore
        }
      }
    }
  }

  await walk(abs, 1);
  out.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return { files: out, truncated: capped };
}
