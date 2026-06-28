/**
 * Security boundary: every `repo` path a tool receives must resolve inside one of
 * the configured GIT_ROOTS, checked both lexically and via realpath (so a symlink
 * can't point a "repo" outside the sandbox). Mirrors the files server's sandbox.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getConfiguredRoots } from "./config.js";

let activeRoots: string[] = [];

function isInside(root: string, p: string): boolean {
  if (p === root) return true;
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

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

export async function initRootsFromEnv(): Promise<string[]> {
  const configured = getConfiguredRoots();
  if (configured.length === 0) return [];
  return setRoots(configured);
}

export function getRoots(): string[] {
  return activeRoots;
}

function validate(p: string): void {
  if (typeof p !== "string" || p.length === 0) throw new Error("Repo path must be a non-empty string.");
  if (p.length > 4096) throw new Error("Repo path is too long.");
  if (/[\u0000-\u001f\u007f]/.test(p)) throw new Error("Repo path contains control characters.");
}

/** Following symlinks of the nearest existing ancestor, is `abs` inside a root? */
async function realpathContained(abs: string): Promise<boolean> {
  let cur = abs;
  for (;;) {
    try {
      const real = await fs.realpath(cur);
      const suffix = path.relative(cur, abs);
      const finalReal = suffix ? path.join(real, suffix) : real;
      return activeRoots.some((r) => isInside(r, finalReal));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = path.dirname(cur);
      if (parent === cur) return false;
      cur = parent;
    }
  }
}

/**
 * Resolve a repo path to a safe absolute working-tree dir inside the sandbox.
 * Absolute paths must fall inside a root; relative paths resolve against the
 * first root. Throws on lexical or symlink escape.
 */
export async function resolveRepo(p: string): Promise<string> {
  validate(p);
  if (activeRoots.length === 0) throw new Error("No GIT_ROOTS configured; the server is not sandboxed.");
  const candidate = path.isAbsolute(p) ? path.resolve(p) : path.resolve(activeRoots[0], p);
  if (!activeRoots.some((r) => isInside(r, candidate))) {
    throw new Error(`Refusing to access "${p}": outside the allowed root(s).`);
  }
  if (!(await realpathContained(candidate))) {
    throw new Error(`Refusing to access "${p}": resolves (via symlink) outside the allowed root(s).`);
  }
  return candidate;
}
