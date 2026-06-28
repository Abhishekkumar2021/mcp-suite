/**
 * Structural mutations: mkdir, move, recursive copy, and soft-delete to a per-root
 * trash with restore. Deletes never destroy data — they move it into `.mcp-trash`
 * and record the original location so it can be restored. All ops are dryRun-aware.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { TRASH_DIR } from "./config.js";
import { assertWritable, displayPath, getRoots, resolveInside } from "./sandbox.js";

let seq = 0;

/** Move a path, falling back to copy+remove across devices (EXDEV). */
async function movePath(src: string, dst: string): Promise<void> {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fs.rename(src, dst);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.cp(src, dst, { recursive: true });
    await fs.rm(src, { recursive: true, force: true });
  }
}

/** The active root that contains `abs` (for locating its trash dir). */
function rootFor(abs: string): string {
  for (const r of getRoots()) {
    const rel = path.relative(r, abs);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return r;
  }
  throw new Error("Path is not within any root.");
}

interface TrashEntry {
  id: string;
  originalPath: string;
  storedAt: string;
  deletedAt: string;
}

async function readManifest(trashDir: string): Promise<TrashEntry[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(trashDir, "manifest.json"), "utf8"));
  } catch {
    return [];
  }
}
async function writeManifest(trashDir: string, entries: TrashEntry[]): Promise<void> {
  await fs.mkdir(trashDir, { recursive: true });
  await fs.writeFile(path.join(trashDir, "manifest.json"), JSON.stringify(entries, null, 2));
}

export async function createDir(p: string, opts: { dryRun?: boolean } = {}): Promise<string> {
  assertWritable();
  const abs = await resolveInside(p);
  if (opts.dryRun) return `Would create directory "${displayPath(abs)}".`;
  await fs.mkdir(abs, { recursive: true });
  return `Created directory "${displayPath(abs)}".`;
}

export async function move(src: string, dst: string, opts: { overwrite?: boolean; dryRun?: boolean } = {}): Promise<string> {
  assertWritable();
  const s = await resolveInside(src);
  const d = await resolveInside(dst);
  if (!opts.overwrite) {
    try {
      await fs.lstat(d);
      throw new Error(`Destination "${dst}" already exists (pass overwrite:true).`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  if (opts.dryRun) return `Would move "${displayPath(s)}" → "${displayPath(d)}".`;
  await movePath(s, d);
  return `Moved "${displayPath(s)}" → "${displayPath(d)}".`;
}

export async function copy(src: string, dst: string, opts: { overwrite?: boolean; dryRun?: boolean } = {}): Promise<string> {
  assertWritable();
  const s = await resolveInside(src);
  const d = await resolveInside(dst);
  if (opts.dryRun) return `Would copy "${displayPath(s)}" → "${displayPath(d)}".`;
  await fs.cp(s, d, { recursive: true, force: opts.overwrite ?? false, errorOnExist: !(opts.overwrite ?? false), dereference: false });
  return `Copied "${displayPath(s)}" → "${displayPath(d)}".`;
}

export async function del(p: string, opts: { dryRun?: boolean } = {}): Promise<string> {
  assertWritable();
  const abs = await resolveInside(p);
  await fs.lstat(abs); // throws if missing
  const trashDir = path.join(rootFor(abs), TRASH_DIR);
  const id = `${Date.now()}-${seq++}`;
  const stored = path.join(trashDir, id, path.basename(abs));
  if (opts.dryRun) return `Would move "${displayPath(abs)}" to trash (recoverable via restore).`;
  await movePath(abs, stored);
  const manifest = await readManifest(trashDir);
  manifest.push({ id, originalPath: abs, storedAt: stored, deletedAt: new Date().toISOString() });
  await writeManifest(trashDir, manifest);
  return `Moved "${displayPath(abs)}" to trash (id ${id}). Restore with restore("${id}").`;
}

export interface TrashItem {
  id: string;
  originalPath: string;
  deletedAt: string;
}

/** List everything currently in the trash across all roots. */
export async function listTrash(): Promise<TrashItem[]> {
  const out: TrashItem[] = [];
  for (const r of getRoots()) {
    const entries = await readManifest(path.join(r, TRASH_DIR));
    for (const e of entries) out.push({ id: e.id, originalPath: displayPath(e.originalPath), deletedAt: e.deletedAt });
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function restore(id: string, opts: { overwrite?: boolean } = {}): Promise<string> {
  assertWritable();
  for (const r of getRoots()) {
    const trashDir = path.join(r, TRASH_DIR);
    const manifest = await readManifest(trashDir);
    const idx = manifest.findIndex((e) => e.id === id);
    if (idx === -1) continue;
    const entry = manifest[idx];
    if (!opts.overwrite) {
      try {
        await fs.lstat(entry.originalPath);
        throw new Error(`"${displayPath(entry.originalPath)}" exists again (pass overwrite:true).`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    await movePath(entry.storedAt, entry.originalPath);
    manifest.splice(idx, 1);
    await writeManifest(trashDir, manifest);
    return `Restored "${displayPath(entry.originalPath)}".`;
  }
  throw new Error(`No trashed item with id "${id}".`);
}

export async function emptyTrash(opts: { dryRun?: boolean } = {}): Promise<string> {
  assertWritable();
  let removed = 0;
  for (const r of getRoots()) {
    const trashDir = path.join(r, TRASH_DIR);
    const manifest = await readManifest(trashDir);
    removed += manifest.length;
    if (!opts.dryRun) {
      await fs.rm(trashDir, { recursive: true, force: true });
    }
  }
  return `${opts.dryRun ? "Would permanently delete" : "Permanently deleted"} ${removed} trashed item(s).`;
}
