/**
 * The security boundary. Every filesystem path used by any tool must pass through
 * `resolveInside`, which enforces the sandbox: a path may only resolve inside one
 * of the active roots, checked both lexically and via realpath (so a symlink
 * placed inside a root cannot point out). Mutating ops additionally refuse to act
 * *through* a symlink. All roots are realpath-canonicalized once, up front.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getConfiguredRoots, isReadOnly, MAX_FILE_BYTES } from "./config.js";

let activeRoots: string[] = [];

/** True if `p` is the root itself or strictly inside it (lexical check). */
function isInside(root: string, p: string): boolean {
  if (p === root) return true;
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Canonicalize + install the given roots (must exist). Returns the resolved set. */
export async function setRoots(dirs: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const d of dirs) {
    try {
      resolved.push(await fs.realpath(d));
    } catch {
      throw new Error(`Root directory does not exist or is inaccessible: ${d}`);
    }
  }
  activeRoots = [...new Set(resolved)];
  return activeRoots;
}

/** Initialize roots from FS_ROOTS. Returns [] if none configured (caller decides). */
export async function initRootsFromEnv(): Promise<string[]> {
  const configured = getConfiguredRoots();
  if (configured.length === 0) return [];
  return setRoots(configured);
}

export function getRoots(): string[] {
  return activeRoots;
}

/** Reject empty / overlong names, NUL bytes and other control characters. */
export function validateName(p: string): void {
  if (typeof p !== "string" || p.length === 0) throw new Error("Path must be a non-empty string.");
  if (p.length > 4096) throw new Error("Path is too long.");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) throw new Error("Path contains control characters.");
}

/**
 * Following symlinks of the nearest existing ancestor, is `abs` inside a root?
 * Works for paths that don't exist yet (new files). Roots are already realpath'd,
 * so the comparison is canonical on both sides.
 */
async function realpathContained(abs: string): Promise<boolean> {
  let cur = abs;
  for (;;) {
    try {
      const real = await fs.realpath(cur);
      const suffix = path.relative(cur, abs); // "" when cur === abs
      const finalReal = suffix ? path.join(real, suffix) : real;
      return activeRoots.some((r) => isInside(r, finalReal));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(cur);
      if (parent === cur) return false; // filesystem root
      cur = parent;
    }
  }
}

/**
 * Resolve a user-supplied path to a safe absolute path inside the sandbox.
 * Absolute paths must fall inside a root; relative paths resolve against the
 * first root. Throws on lexical escape or symlink escape.
 */
export async function resolveInside(p: string): Promise<string> {
  validateName(p);
  if (activeRoots.length === 0) {
    throw new Error("No roots configured; the server is not sandboxed to any directory.");
  }
  const candidate = path.isAbsolute(p) ? path.resolve(p) : path.resolve(activeRoots[0], p);
  if (!activeRoots.some((r) => isInside(r, candidate))) {
    throw new Error(`Refusing to access "${p}": outside the allowed root(s).`);
  }
  if (!(await realpathContained(candidate))) {
    throw new Error(`Refusing to access "${p}": resolves (via symlink) outside the allowed root(s).`);
  }
  return candidate;
}

/** Refuse to operate *through* a symlink (TOCTOU-safe for write/edit/delete). */
export async function ensureNotSymlink(abs: string): Promise<void> {
  try {
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink()) throw new Error(`Refusing to modify a symlink: ${abs}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // missing is fine (new file)
  }
}

/** Throw if the server is read-only. */
export function assertWritable(): void {
  if (isReadOnly()) throw new Error("Server is read-only (FS_READONLY); mutations are disabled.");
}

/** Read a file's bytes with a size guard. */
export async function readBytes(abs: string): Promise<Buffer> {
  const st = await fs.stat(abs);
  if (st.size > MAX_FILE_BYTES) {
    throw new Error(`File too large (${st.size} bytes > ${MAX_FILE_BYTES} limit).`);
  }
  return fs.readFile(abs);
}

/** Atomic write: temp sibling + rename. Refuses to write through a symlink. */
export async function atomicWrite(abs: string, data: string | Buffer): Promise<void> {
  await ensureNotSymlink(abs);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, abs);
}

/** Display a path relative to its containing root (falls back to absolute). */
export function displayPath(abs: string): string {
  for (const r of activeRoots) {
    if (isInside(r, abs)) {
      const rel = path.relative(r, abs);
      return rel === "" ? abs : rel;
    }
  }
  return abs;
}
