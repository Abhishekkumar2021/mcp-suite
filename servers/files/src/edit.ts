/**
 * Write + token-efficient editing. `editFile` does a unique find/replace (refuses
 * to guess when the match isn't unique); `editLines` replaces a line range guarded
 * by a content hash (rejects stale edits). Both support `dryRun`, returning a
 * unified diff preview instead of writing. All writes are atomic and refuse to act
 * through symlinks.
 */
import { createHash } from "node:crypto";
import { createPatch } from "diff";
import { assertWritable, atomicWrite, displayPath, readBytes, resolveInside } from "./sandbox.js";

export interface EditResult {
  applied: boolean;
  dryRun: boolean;
  diff: string;
  message: string;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function patch(name: string, before: string, after: string): string {
  return createPatch(name, before, after, "before", "after");
}

/** Create or overwrite a file (atomic). Refuses to clobber unless `overwrite`. */
export async function writeFile(
  p: string,
  content: string,
  opts: { overwrite?: boolean; dryRun?: boolean } = {},
): Promise<EditResult> {
  assertWritable();
  const abs = await resolveInside(p);
  let before = "";
  let existed = false;
  try {
    before = (await readBytes(abs)).toString("utf8");
    existed = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const diff = patch(displayPath(abs), before, content);
  if (opts.dryRun) {
    const needs = existed && !opts.overwrite ? " (requires overwrite:true to apply)" : "";
    return { applied: false, dryRun: true, diff, message: `Would ${existed ? "overwrite" : "create"} "${displayPath(abs)}".${needs}` };
  }
  if (existed && !opts.overwrite) {
    throw new Error(`"${p}" already exists. Pass overwrite:true to replace it.`);
  }
  await atomicWrite(abs, content);
  return { applied: true, dryRun: false, diff, message: `${existed ? "Overwrote" : "Created"} "${displayPath(abs)}".` };
}

/** Replace a unique occurrence of `oldText` with `newText`. */
export async function editFile(
  p: string,
  oldText: string,
  newText: string,
  opts: { dryRun?: boolean } = {},
): Promise<EditResult> {
  assertWritable();
  const abs = await resolveInside(p);
  const before = (await readBytes(abs)).toString("utf8");
  const count = before.split(oldText).length - 1;
  if (count === 0) throw new Error("oldText not found in the file.");
  if (count > 1) throw new Error(`oldText matches ${count} times — add surrounding context to make it unique.`);
  const after = before.replace(oldText, newText);
  const diff = patch(displayPath(abs), before, after);
  if (opts.dryRun) return { applied: false, dryRun: true, diff, message: "Dry run — no changes written." };
  await atomicWrite(abs, after);
  return { applied: true, dryRun: false, diff, message: `Edited "${displayPath(abs)}".` };
}

/**
 * Replace lines [startLine, endLine] (1-based, inclusive) with `newContent`.
 * If `expectedHash` is given, the current range must hash to it (stale-edit guard).
 */
export async function editLines(
  p: string,
  startLine: number,
  endLine: number,
  newContent: string,
  opts: { expectedHash?: string; dryRun?: boolean } = {},
): Promise<EditResult & { hash?: string }> {
  assertWritable();
  const abs = await resolveInside(p);
  const before = (await readBytes(abs)).toString("utf8");
  const lines = before.split("\n");
  if (startLine < 1 || endLine < startLine || startLine > lines.length) {
    throw new Error(`Invalid line range ${startLine}-${endLine} (file has ${lines.length} lines).`);
  }
  const end = Math.min(endLine, lines.length);
  const current = lines.slice(startLine - 1, end).join("\n");
  if (opts.expectedHash && sha256(current) !== opts.expectedHash) {
    throw new Error("Stale edit: the current line range doesn't match expectedHash (re-read the file).");
  }
  const after = [...lines.slice(0, startLine - 1), ...newContent.split("\n"), ...lines.slice(end)].join("\n");
  const diff = patch(displayPath(abs), before, after);
  if (opts.dryRun) return { applied: false, dryRun: true, diff, message: "Dry run — no changes written.", hash: sha256(current) };
  await atomicWrite(abs, after);
  return { applied: true, dryRun: false, diff, message: `Replaced lines ${startLine}-${end} in "${displayPath(abs)}".` };
}
