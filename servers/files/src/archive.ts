/**
 * Archive + integrity: zip/unzip (pure-JS via fflate, with zip-slip protection),
 * file checksums, and duplicate detection. Unzip validates that every entry stays
 * inside the destination directory before writing.
 */
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { zipSync, unzipSync } from "fflate";
import { MAX_RESULTS, TRASH_DIR } from "./config.js";
import { assertWritable, atomicWrite, displayPath, readBytes, resolveInside } from "./sandbox.js";

/** Collect files under `abs` (recursively), keyed by a name relative to `baseForName`. */
async function collectFiles(abs: string, baseForName: string, out: Record<string, Uint8Array>): Promise<void> {
  const st = await fs.lstat(abs);
  if (st.isSymbolicLink()) return; // never archive through symlinks
  if (st.isFile()) {
    out[path.relative(baseForName, abs).split(path.sep).join("/")] = new Uint8Array(await fs.readFile(abs));
    return;
  }
  if (st.isDirectory()) {
    for (const d of await fs.readdir(abs)) {
      if (d === TRASH_DIR) continue;
      await collectFiles(path.join(abs, d), baseForName, out);
    }
  }
}

/** Create a zip archive at `dest` from one or more source paths. */
export async function zip(sources: string[], dest: string, opts: { dryRun?: boolean } = {}): Promise<string> {
  assertWritable();
  if (sources.length === 0) throw new Error("No source paths given.");
  const files: Record<string, Uint8Array> = {};
  for (const src of sources) {
    const abs = await resolveInside(src);
    await collectFiles(abs, path.dirname(abs), files);
  }
  const destAbs = await resolveInside(dest);
  const count = Object.keys(files).length;
  if (opts.dryRun) return `Would archive ${count} file(s) into "${displayPath(destAbs)}".`;
  await atomicWrite(destAbs, Buffer.from(zipSync(files)));
  return `Created "${displayPath(destAbs)}" with ${count} file(s).`;
}

/** True if `target` stays inside `base` (zip-slip guard). */
function insideDir(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Extract a zip into `destDir`, rejecting any entry that escapes it. */
export async function unzip(
  zipPath: string,
  destDir: string,
  opts: { overwrite?: boolean; dryRun?: boolean } = {},
): Promise<string> {
  assertWritable();
  const zipAbs = await resolveInside(zipPath);
  const dest = await resolveInside(destDir);
  const entries = unzipSync(new Uint8Array(await readBytes(zipAbs)));

  const toWrite: Array<[string, Uint8Array]> = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue; // directory entry
    if (name.includes("..") || path.isAbsolute(name)) throw new Error(`Unsafe archive entry: ${name}`);
    const target = path.resolve(dest, name);
    if (!insideDir(dest, target)) throw new Error(`Zip-slip blocked: entry "${name}" escapes the destination.`);
    toWrite.push([target, data]);
  }
  if (opts.dryRun) return `Would extract ${toWrite.length} file(s) into "${displayPath(dest)}".`;

  for (const [target, data] of toWrite) {
    if (!opts.overwrite) {
      try {
        await fs.lstat(target);
        throw new Error(`"${displayPath(target)}" exists (pass overwrite:true).`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
  return `Extracted ${toWrite.length} file(s) into "${displayPath(dest)}".`;
}

/** List the entries in a zip archive without extracting. */
export async function listArchive(zipPath: string): Promise<Array<{ name: string; bytes: number }>> {
  const zipAbs = await resolveInside(zipPath);
  const entries = unzipSync(new Uint8Array(await readBytes(zipAbs)));
  return Object.entries(entries)
    .filter(([name]) => !name.endsWith("/"))
    .map(([name, data]) => ({ name, bytes: data.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Compute a checksum of a file. */
export async function hashFile(p: string, algo: "sha256" | "sha1" | "md5" = "sha256"): Promise<string> {
  const abs = await resolveInside(p);
  return createHash(algo).update(await readBytes(abs)).digest("hex");
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  paths: string[];
}

/** Find duplicate files under `dir` by grouping on size, then sha256. */
export async function findDuplicates(dir: string): Promise<DuplicateGroup[]> {
  const base = await resolveInside(dir);
  const bySize = new Map<number, string[]>();

  async function walk(d: string, depth: number): Promise<void> {
    if (depth > 32) return;
    let dirents;
    try {
      dirents = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of dirents) {
      if (e.name === TRASH_DIR || e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile()) {
        try {
          const st = await fs.lstat(full);
          if (st.size === 0) continue;
          (bySize.get(st.size) ?? bySize.set(st.size, []).get(st.size)!).push(full);
        } catch {
          // ignore
        }
      }
    }
  }
  await walk(base, 0);

  const groups: DuplicateGroup[] = [];
  for (const [size, paths] of bySize) {
    if (paths.length < 2) continue; // only size-collisions can be dupes
    const byHash = new Map<string, string[]>();
    for (const f of paths) {
      try {
        const h = createHash("sha256").update(await fs.readFile(f)).digest("hex");
        (byHash.get(h) ?? byHash.set(h, []).get(h)!).push(f);
      } catch {
        // ignore
      }
    }
    for (const [hash, fpaths] of byHash) {
      if (fpaths.length > 1) groups.push({ hash, size, paths: fpaths.map(displayPath) });
    }
  }
  return groups.slice(0, MAX_RESULTS);
}
