import { promises as fs } from "node:fs";
import path from "node:path";
import { getNotesDir, INDEX_FILENAME, MAX_FILE_BYTES } from "./config.js";

/** Matches ASCII control characters (0x00–0x1f and DEL 0x7f). */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Validate a user-supplied note name. Rejects control characters, absolute
 * paths, and absurdly long names. Returns the name with a trailing ".md".
 */
export function validateName(name: string): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Note name must be a non-empty string.");
  }
  if (name.length > 512) {
    throw new Error("Note name is too long (max 512 chars).");
  }
  if (CONTROL_CHARS.test(name)) {
    throw new Error("Note name contains control characters.");
  }
  if (path.isAbsolute(name)) {
    throw new Error("Note name must be relative, not an absolute path.");
  }
  return name.endsWith(".md") ? name : `${name}.md`;
}

/** Lexical containment check: does the resolved path stay inside the notes dir? */
function lexicallyInside(dir: string, resolved: string): boolean {
  const rel = path.relative(dir, resolved);
  return rel === "" ? false : !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Verify, following symlinks, that `absPath` resolves inside the notes dir.
 * Walks up to the nearest existing ancestor (so it works for files that don't
 * exist yet), realpaths it, then re-appends the non-existing suffix lexically.
 * Defeats symlinks placed *inside* the notes dir that point outside it.
 */
async function realpathInside(absPath: string): Promise<boolean> {
  const root = await fs.realpath(getNotesDir());
  let cur = absPath;
  // Walk up until we hit a path that exists on disk.
  for (;;) {
    try {
      const realCur = await fs.realpath(cur);
      const suffix = path.relative(cur, absPath); // "" when cur === absPath
      const finalReal = suffix ? path.join(realCur, suffix) : realCur;
      const rel = path.relative(root, finalReal);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(cur);
      if (parent === cur) return false; // reached filesystem root
      cur = parent;
    }
  }
}

/**
 * Resolve a note name to a safe absolute path inside the notes dir, checking
 * both lexical traversal (`../`) and symlink escapes. Async because the symlink
 * check touches the filesystem.
 */
export async function resolveSafe(name: string): Promise<string> {
  const dir = getNotesDir();
  const resolved = path.resolve(dir, validateName(name));
  if (!lexicallyInside(dir, resolved)) {
    throw new Error(`Refusing to access "${name}": path escapes the notes directory.`);
  }
  if (!(await realpathInside(resolved))) {
    throw new Error(`Refusing to access "${name}": resolves (via symlink) outside the notes directory.`);
  }
  return resolved;
}

/** Read a note's raw text, guarding against oversized files. */
export async function readRaw(absPath: string): Promise<string> {
  const stat = await fs.stat(absPath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`Note is too large to read (${stat.size} bytes > ${MAX_FILE_BYTES} limit).`);
  }
  return fs.readFile(absPath, "utf8");
}

/** Atomically write a file: write to a temp sibling, then rename into place. */
export async function atomicWrite(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, absPath);
}

export interface NoteFile {
  name: string; // relative, no ".md", forward-slashed
  fullPath: string;
  size: number;
  mtimeMs: number;
}

/** Recursively list markdown note files, skipping dotfiles and the index cache. */
export async function listNoteFiles(): Promise<NoteFile[]> {
  const dir = getNotesDir();
  await fs.mkdir(dir, { recursive: true });
  const out: NoteFile[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === INDEX_FILENAME) continue; // skip dotfiles/cache
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const stat = await fs.stat(full);
        const rel = path.relative(dir, full).replace(/\.md$/, "").split(path.sep).join("/");
        out.push({ name: rel, fullPath: full, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  }

  await walk(dir);
  return out;
}
