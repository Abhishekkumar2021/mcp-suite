/**
 * Git operations over isomorphic-git (pure-JS; no git binary). Every function
 * resolves its repo path through the sandbox first. isomorphic-git has no
 * high-level diff, so diffs are computed by walking two trees and producing a
 * unified patch per changed file via the `diff` library (size-capped).
 */
import fs from "node:fs";
import git from "isomorphic-git";
import { createPatch } from "diff";
import { DEFAULT_LOG_DEPTH, MAX_DIFF_BYTES, MAX_LOG_DEPTH } from "./config.js";
import { resolveRepo } from "./sandbox.js";

const depthOf = (n?: number) => Math.min(Math.max(n ?? DEFAULT_LOG_DEPTH, 1), MAX_LOG_DEPTH);
const firstLine = (s: string) => s.split("\n")[0];

function mapCommit(entry: any) {
  const c = entry.commit;
  return {
    oid: entry.oid.slice(0, 10),
    message: firstLine(c.message).trim(),
    author: `${c.author.name} <${c.author.email}>`,
    date: new Date(c.author.timestamp * 1000).toISOString(),
  };
}

// --- Read ----------------------------------------------------------------

export async function status(repoPath: string) {
  const dir = await resolveRepo(repoPath);
  const branch = (await git.currentBranch({ fs, dir, fullname: false })) || "(detached)";
  const matrix = await git.statusMatrix({ fs, dir });
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  for (const [file, head, workdir, stage] of matrix) {
    if (head === 0 && workdir === 0 && stage === 0) continue;
    if (head === 0 && stage === 0 && workdir === 2) {
      untracked.push(file);
      continue;
    }
    if (stage !== head && !(head === 0 && stage === 0)) staged.push(file);
    if ((workdir === 2 && stage !== 2) || (workdir === 0 && head !== 0 && stage !== 0)) unstaged.push(file);
  }
  return { branch, staged, unstaged, untracked };
}

export async function log(repoPath: string, ref?: string, depth?: number, filepath?: string) {
  const dir = await resolveRepo(repoPath);
  const commits = await git.log({ fs, dir, ref: ref || "HEAD", depth: depthOf(depth), filepath, force: true });
  return commits.map(mapCommit);
}

export async function searchLog(repoPath: string, query: string, depth?: number) {
  const dir = await resolveRepo(repoPath);
  const q = query.toLowerCase();
  const commits = await git.log({ fs, dir, depth: depthOf(depth) });
  return commits.filter((c) => c.commit.message.toLowerCase().includes(q)).map(mapCommit);
}

export async function listBranches(repoPath: string) {
  const dir = await resolveRepo(repoPath);
  return git.listBranches({ fs, dir });
}

export async function listTags(repoPath: string) {
  const dir = await resolveRepo(repoPath);
  return git.listTags({ fs, dir });
}

export async function currentBranch(repoPath: string) {
  const dir = await resolveRepo(repoPath);
  return (await git.currentBranch({ fs, dir, fullname: false })) || "(detached HEAD)";
}

export async function readFileAtRef(repoPath: string, filepath: string, ref?: string) {
  const dir = await resolveRepo(repoPath);
  const oid = await git.resolveRef({ fs, dir, ref: ref || "HEAD" });
  const { blob } = await git.readBlob({ fs, dir, oid, filepath });
  const buf = Buffer.from(blob);
  if (buf.length > MAX_DIFF_BYTES) return `(file too large: ${buf.length} bytes)`;
  return buf.toString("utf8");
}

export interface FileChange {
  path: string;
  type: "add" | "modify" | "remove";
  patch?: string;
}

/** Walk two trees (or a tree vs WORKDIR) and list per-file changes (+ optional patch). */
async function computeDiff(dir: string, treeA: any, treeB: any, opts: { filepath?: string; withPatch?: boolean }): Promise<FileChange[]> {
  const out = (await git.walk({
    fs,
    dir,
    trees: [treeA, treeB],
    map: async (fp, entries) => {
      if (fp === ".") return undefined;
      if (fp === ".git" || fp.startsWith(".git/")) return null; // never descend into .git
      const [a, b] = entries as any[];
      const aType = a && (await a.type());
      const bType = b && (await b.type());
      if (aType === "tree" || bType === "tree") return undefined; // recurse into dirs
      const aOid = a ? await a.oid() : undefined;
      const bOid = b ? await b.oid() : undefined;
      if (aOid === bOid) return undefined; // unchanged
      if (opts.filepath && fp !== opts.filepath) return undefined;
      const type: FileChange["type"] = !aOid ? "add" : !bOid ? "remove" : "modify";
      const change: FileChange = { path: fp, type };
      if (opts.withPatch) {
        try {
          const aBuf = a ? Buffer.from((await a.content()) ?? new Uint8Array()) : Buffer.alloc(0);
          const bBuf = b ? Buffer.from((await b.content()) ?? new Uint8Array()) : Buffer.alloc(0);
          change.patch =
            aBuf.length > MAX_DIFF_BYTES || bBuf.length > MAX_DIFF_BYTES
              ? "(diff too large to render)"
              : createPatch(fp, aBuf.toString("utf8"), bBuf.toString("utf8"), "a", "b");
        } catch {
          change.patch = "(binary or unreadable)";
        }
      }
      return change;
    },
  })) as (FileChange | undefined | null)[];
  return out.filter((c): c is FileChange => !!c).slice(0, 500);
}

/** Diff: refA..refB, or refA..WORKDIR, or HEAD..WORKDIR by default. */
export async function diff(repoPath: string, opts: { refA?: string; refB?: string; filepath?: string; patch?: boolean } = {}) {
  const dir = await resolveRepo(repoPath);
  const treeA = git.TREE({ ref: opts.refA || "HEAD" });
  const treeB = opts.refB ? git.TREE({ ref: opts.refB }) : git.WORKDIR();
  return computeDiff(dir, treeA, treeB, { filepath: opts.filepath, withPatch: opts.patch ?? true });
}

/** Accept a ref, an abbreviated oid, or a full oid → full oid. */
async function toOid(dir: string, oidOrRef: string): Promise<string> {
  try {
    return await git.resolveRef({ fs, dir, ref: oidOrRef });
  } catch {
    /* not a ref */
  }
  if (oidOrRef.length < 40) {
    try {
      return await git.expandOid({ fs, dir, oid: oidOrRef });
    } catch {
      /* not a short oid */
    }
  }
  return oidOrRef;
}

export async function showCommit(repoPath: string, oidOrRef: string) {
  const dir = await resolveRepo(repoPath);
  const oid = await toOid(dir, oidOrRef);
  const { commit } = await git.readCommit({ fs, dir, oid });
  const parent = commit.parent[0];
  let files: FileChange[];
  if (parent) {
    files = await computeDiff(dir, git.TREE({ ref: parent }), git.TREE({ ref: oid }), { withPatch: false });
  } else {
    // Root commit: everything is added.
    const all = (await git.walk({
      fs,
      dir,
      trees: [git.TREE({ ref: oid })],
      map: async (fp, [e]) => {
        if (fp === "." || !e || (await (e as any).type()) === "tree") return undefined;
        return { path: fp, type: "add" } as FileChange;
      },
    })) as (FileChange | undefined)[];
    files = all.filter((c): c is FileChange => !!c).slice(0, 500);
  }
  return {
    oid: oid.slice(0, 10),
    author: `${commit.author.name} <${commit.author.email}>`,
    date: new Date(commit.author.timestamp * 1000).toISOString(),
    message: commit.message.trim(),
    parents: commit.parent.map((p) => p.slice(0, 10)),
    files,
  };
}

// --- Write (gated by GIT_WRITABLE in index.ts) ---------------------------

export async function stage(repoPath: string, filepath: string) {
  const dir = await resolveRepo(repoPath);
  await git.add({ fs, dir, filepath });
  return `Staged ${filepath}.`;
}

export async function unstage(repoPath: string, filepath: string) {
  const dir = await resolveRepo(repoPath);
  await git.resetIndex({ fs, dir, filepath });
  return `Unstaged ${filepath}.`;
}

export async function commit(repoPath: string, message: string, name?: string, email?: string) {
  const dir = await resolveRepo(repoPath);
  const author = name && email ? { name, email } : undefined;
  try {
    const oid = await git.commit({ fs, dir, message, ...(author ? { author } : {}) });
    return { oid: oid.slice(0, 10), message: firstLine(message).trim() };
  } catch (err) {
    if (/author/i.test((err as Error).message)) {
      throw new Error("No commit author. Pass name + email, or configure git user.name/user.email.");
    }
    throw err;
  }
}

export async function createBranch(repoPath: string, ref: string, checkout = false) {
  const dir = await resolveRepo(repoPath);
  await git.branch({ fs, dir, ref, checkout });
  return `Created branch ${ref}${checkout ? " and checked it out" : ""}.`;
}

export async function checkout(repoPath: string, ref: string) {
  const dir = await resolveRepo(repoPath);
  await git.checkout({ fs, dir, ref });
  return `Checked out ${ref}.`;
}
